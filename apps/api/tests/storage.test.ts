import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { QueryResult, QueryResultRow } from 'pg'
import type { BaziRuleProfileDefinition, BaziRuleProfileVersionReference, ReportRecord } from '@fengshui/domain'
import type { ReportableWenzhenFixture } from '@fengshui/bazi-engine/wenzhen-fixtures'
import { buildApp } from '../src/app.js'
import { ChartRepository, ChartRevisionConflictError } from '../src/charts.js'
import { assertRuntimeEnvironment } from '../src/config.js'
import { KnowledgeRepository, KnowledgeRevisionConflictError, knowledgeSearchTerms, type AuditedPublishedKnowledgeVersion } from '../src/knowledge.js'
import { MediaStore } from '../src/media.js'
import { LostReportLeaseError, ReportArchiveConflictError, ReportRepository, type ReportStore } from '../src/repository.js'
import { BaziRuleProfileReferencedError, BaziRuleProfileRevisionConflictError, DuplicateBaziRuleProfileKeyError, InvalidBaziRuleProfileTransitionError } from '../src/rule-profiles.js'
import { resolveStorageConfig } from '../src/storage/factory.js'
import { KnowledgeImmutableVersionConflictError, PostgresBaziRuleProfileRepository, PostgresChartRepository, PostgresKnowledgeRepository, PostgresReportRepository, PostgresWenzhenFixtureRepository, insertPublishedVersion, runMigrations, type PoolLike } from '../src/storage/postgres.js'

const sampleRecord: ReportRecord = {
  id: '8bfe199e-5e1e-4d62-a7b8-c1f87b7e91c5',
  status: 'queued',
  createdAt: '2026-08-30T00:00:00.000Z',
  submission: {
    visionConsent: true,
    calculationInput: { date: '1992-08-18', time: '09:30', locationName: '杭州市', longitude: 120.1551 },
    birth: { date: '1992-08-18', time: '09:30', locationName: '杭州市', longitude: 120.1551 },
    residence: { facing: 'south', layoutNote: '客厅连接阳台' },
    photos: [{ fileId: 'recovery-photo.jpg', room: 'living-room', facing: 'south' }],
  },
  bazi: {
    ruleVersion: 'bazi-v1-beijing-true-solar',
    correctedLocalTime: '1992-08-18T09:30:00.000+08:00',
    correctionMinutes: 0,
    pillars: ['壬申', '戊申', '丙寅', '癸巳'],
  },
}

const verifiedWenzhenFixture: ReportableWenzhenFixture = {
  sampleId: 'wz-postgres-verified-one',
  source: 'wenzhen-manual-capture',
  capturedAt: '2026-08-30T12:00:00+08:00',
  sourceUrl: 'https://pcbz.iwzwh.com/#/paipan/index',
  evidenceRef: `evidence/wenzhen/sha256-${'b'.repeat(64)}.png`,
  status: 'verified',
  birth: {
    calendarSystem: 'solar',
    date: '1992-08-21',
    time: '12:03',
    locationName: '浙江省 杭州市 西湖区',
    longitude: 120.1302,
    latitude: 30.2595,
    timezone: 'Asia/Shanghai',
    useTrueSolarTime: true,
    dstPolicy: 'auto',
    dayBoundary: 'midnight',
    luckMethod: 'sect1',
    gender: 'male',
  },
  expected: { pillars: ['壬申', '戊申', '己巳', '庚午'] },
}

const ruleProfileDefinition: BaziRuleProfileDefinition = {
  timeDefaults: { timezone: 'Asia/Shanghai', dstPolicy: 'auto', useTrueSolarTime: true, dayBoundary: 'zi-hour-start', luckMethod: 'sect1' },
  assessments: {
    strength: { enabled: true, method: 'weighted-seasonal-v1', ruleSetVersion: '1.0.0' },
    pattern: { enabled: true, method: 'school-pattern-v1', ruleSetVersion: '1.0.0' },
    shenSha: { enabled: false, method: 'disabled', ruleSetVersion: '1.0.0' },
  },
}

const ruleProfileReference: BaziRuleProfileVersionReference = {
  profileId: 'profile-rule-one',
  versionId: 'profile-rule-one:v1:0123456789abcdef',
  version: 1,
  key: 'test-school',
  name: '测试流派',
  contentHash: '0'.repeat(64),
}

const auditedKnowledgeVersion: AuditedPublishedKnowledgeVersion = {
  assetId: 'a9cdd1e8-53a4-4acd-98e3-43745314fab0',
  version: 1,
  versionId: 'a9cdd1e8-53a4-4acd-98e3-43745314fab0:v1:0123456789abcdef',
  contentHash: '0'.repeat(64),
  kind: 'article',
  title: '不可变知识版本',
  tags: ['审核'],
  body: '发布后不得静默覆盖。',
  sourceLabel: '存储测试',
  exactExcerpt: '发布后不得静默覆盖。',
  submittedForReviewAt: '2026-08-31T10:00:00.000Z',
  submittedForReviewBy: 'knowledge-editor',
  reviewedAt: '2026-08-31T10:05:00.000Z',
  reviewedBy: 'knowledge-reviewer',
  publishedAt: '2026-08-31T10:05:00.000Z',
  publishedBy: 'knowledge-reviewer',
}

function knowledgeVersionRow(version: AuditedPublishedKnowledgeVersion, overrides: Record<string, unknown> = {}): QueryResultRow {
  return {
    version_id: version.versionId,
    asset_id: version.assetId,
    version: version.version,
    content_hash: version.contentHash,
    kind: version.kind,
    title: version.title,
    tags: version.tags,
    body: version.body,
    source_label: version.sourceLabel,
    exact_excerpt: version.exactExcerpt,
    submitted_for_review_at: version.submittedForReviewAt,
    submitted_for_review_by: version.submittedForReviewBy,
    reviewed_at: version.reviewedAt,
    reviewed_by: version.reviewedBy,
    published_at: version.publishedAt,
    published_by: version.publishedBy,
    rule: version.rule ?? null,
    ...overrides,
  }
}

function knowledgeAssetRow(overrides: Record<string, unknown> = {}): QueryResultRow {
  return {
    id: auditedKnowledgeVersion.assetId,
    version: 1,
    state: 'published',
    kind: auditedKnowledgeVersion.kind,
    title: auditedKnowledgeVersion.title,
    tags: auditedKnowledgeVersion.tags,
    body: auditedKnowledgeVersion.body,
    source_label: auditedKnowledgeVersion.sourceLabel,
    created_at: '2026-08-31T09:00:00.000Z',
    created_by: 'knowledge-editor',
    updated_at: auditedKnowledgeVersion.publishedAt,
    updated_by: auditedKnowledgeVersion.publishedBy,
    submitted_for_review_at: auditedKnowledgeVersion.submittedForReviewAt,
    submitted_for_review_by: auditedKnowledgeVersion.submittedForReviewBy,
    reviewed_at: auditedKnowledgeVersion.reviewedAt,
    reviewed_by: auditedKnowledgeVersion.reviewedBy,
    archived_at: null,
    archived_by: null,
    current_published_version_id: auditedKnowledgeVersion.versionId,
    rule: null,
    ...overrides,
  }
}

class MemoryRuleProfilePool implements PoolLike {
  private readonly profiles = new Map<string, Record<string, unknown>>()
  private readonly versions: Array<Record<string, unknown>> = []

  async query<T extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
    return this.dispatch<T>(text, values)
  }

  async connect() {
    return { query: this.dispatch.bind(this), release: vi.fn() }
  }

  async end(): Promise<void> {}

  private async dispatch<T extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
    const sql = text.replace(/\s+/g, ' ').trim().toLowerCase()
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback' || sql === 'select 1') return queryResult<T>([])
    if (sql.startsWith('insert into bazi_rule_profiles')) {
      if ([...this.profiles.values()].some((profile) => profile.profile_key === values[1])) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' })
      }
      const row = {
        id: values[0], profile_key: values[1], name: values[2], description: values[3], state: 'draft', revision: 1,
        working_definition: JSON.parse(String(values[4])), current_published_version_id: null,
        created_at: values[5], created_by: values[6], updated_at: values[5], updated_by: values[6],
        submitted_for_review_at: null, submitted_for_review_by: null, reviewed_at: null, reviewed_by: null,
        archived_at: null, archived_by: null,
      }
      this.profiles.set(String(values[0]), row)
      return queryResult([row as unknown as T])
    }
    if (sql === 'select * from bazi_rule_profiles where id = $1 for update') {
      const row = this.profiles.get(String(values[0]))
      return queryResult(row ? [row as unknown as T] : [])
    }
    if (sql.startsWith('update bazi_rule_profiles') && sql.includes('revision = revision + 1')) {
      const row = this.profiles.get(String(values[0]))!
      if (Number(row.revision) !== Number(values[6])) return queryResult<T>([], 0)
      Object.assign(row, {
        name: values[1], description: values[2], state: 'draft', revision: Number(row.revision) + 1,
        working_definition: JSON.parse(String(values[3])), updated_at: values[4], updated_by: values[5],
        submitted_for_review_at: null, submitted_for_review_by: null, reviewed_at: null, reviewed_by: null,
        archived_at: null, archived_by: null,
      })
      return queryResult([row as unknown as T])
    }
    if (sql.startsWith('update bazi_rule_profiles') && sql.includes("state = 'in-review'")) {
      const row = this.profiles.get(String(values[0]))!
      Object.assign(row, { state: 'in-review', updated_at: values[1], updated_by: values[2], submitted_for_review_at: values[1], submitted_for_review_by: values[2] })
      return queryResult([row as unknown as T])
    }
    if (sql.startsWith('select coalesce(max(version)')) {
      const next = this.versions.filter((version) => version.profile_id === values[0]).reduce((highest, version) => Math.max(highest, Number(version.version)), 0) + 1
      return queryResult([{ next_version: next } as unknown as T])
    }
    if (sql.startsWith('insert into bazi_rule_profile_versions')) {
      const row = {
        version_id: values[0], profile_id: values[1], version: values[2], profile_key: values[3], name: values[4],
        description: values[5], definition: JSON.parse(String(values[6])), content_hash: values[7],
        submitted_for_review_at: values[8], submitted_for_review_by: values[9], reviewed_at: values[10],
        reviewed_by: values[11], published_at: values[10], published_by: values[11],
      }
      this.versions.push(row)
      return queryResult<T>([])
    }
    if (sql.startsWith('update bazi_rule_profiles') && sql.includes("state = 'published'")) {
      const row = this.profiles.get(String(values[0]))!
      Object.assign(row, { state: 'published', current_published_version_id: values[1], updated_at: values[2], updated_by: values[3], reviewed_at: values[2], reviewed_by: values[3] })
      return queryResult([row as unknown as T])
    }
    if (sql.startsWith('update bazi_rule_profiles') && sql.includes("state = 'archived'")) {
      const row = this.profiles.get(String(values[0]))!
      Object.assign(row, { state: 'archived', updated_at: values[1], updated_by: values[2], archived_at: values[1], archived_by: values[2] })
      return queryResult([row as unknown as T])
    }
    if (sql === 'select id from bazi_rule_profiles where id = $1') {
      return queryResult(this.profiles.has(String(values[0])) ? [{ id: values[0] } as unknown as T] : [])
    }
    if (sql.startsWith('select * from bazi_rule_profile_versions where profile_id')) {
      return queryResult(this.versions.filter((version) => version.profile_id === values[0]).sort((left, right) => Number(right.version) - Number(left.version)) as T[])
    }
    if (sql.startsWith('select v.* from bazi_rule_profile_versions v join bazi_rule_profiles p')) {
      const active = this.versions.filter((version) => {
        const profile = this.profiles.get(String(version.profile_id))
        return profile?.state !== 'archived' && profile?.current_published_version_id === version.version_id
          && (!values.length || version.version_id === values[0])
      })
      return queryResult(active as T[])
    }
    if (sql.startsWith('select * from bazi_rule_profiles order by')) return queryResult([...this.profiles.values()] as T[])
    throw new Error(`unhandled test SQL: ${sql}`)
  }
}

function queryResult<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { rows, rowCount, command: '', oid: 0, fields: [] }
}

describe('storage configuration', () => {
  it('defaults production to postgres and fails closed without DATABASE_URL', () => {
    expect(() => resolveStorageConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow('DATABASE_URL')
  })

  it('does not allow file storage in production', () => {
    expect(() => resolveStorageConfig({ NODE_ENV: 'production', STORAGE_DRIVER: 'file' } as NodeJS.ProcessEnv)).toThrow('production requires')
  })

  it('requires model, admin and internal knowledge secrets in production', () => {
    expect(() => assertRuntimeEnvironment({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow('DEEPSEEK_API_KEY')
    expect(() => assertRuntimeEnvironment({
      NODE_ENV: 'production',
      DEEPSEEK_API_KEY: 'configured-model',
      ADMIN_API_TOKEN: 'configured-editor',
      KNOWLEDGE_MCP_TOKEN: 'configured-reader',
    } as NodeJS.ProcessEnv)).not.toThrow()
    expect(() => assertRuntimeEnvironment({
      NODE_ENV: 'production',
      DEEPSEEK_API_KEY: 'replace-with-your-deepseek-api-key',
      ADMIN_API_TOKEN: 'replace-with-a-long-random-admin-token',
      KNOWLEDGE_MCP_TOKEN: 'replace-with-a-long-random-internal-reader-token',
    } as NodeJS.ProcessEnv)).toThrow('example placeholder values')
  })

  it('defaults development to file storage', () => {
    expect(resolveStorageConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).driver).toBe('file')
  })
})

describe('readiness and queued recovery', () => {
  it('reports not-ready when a store ping fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-ready-'))
    const failingReports: ReportStore = {
      get: async () => undefined,
      getOwned: async () => undefined,
      save: async () => undefined,
      saveClaimed: async () => undefined,
      listQueued: async () => [],
      claimReport: async () => undefined,
      claimNextReport: async () => undefined,
      releaseReportLease: async () => undefined,
      listByPrincipal: async () => [],
      archiveOwned: async () => undefined,
      restoreOwned: async () => undefined,
      isKnowledgeCited: async () => false,
      reportStats: async () => ({ total: 0, queued: 0, completed: 0, failed: 0, last24h: 0 }),
      ping: async () => { throw new Error('store offline') },
      close: async () => undefined,
    }
    const app = buildApp(
      failingReports,
      new MediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => '不会生成',
      { analyze: async () => [] },
    )
    const response = await app.inject({ method: 'GET', url: '/ready' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ status: 'not-ready' })
    await app.close()
  })

  it('recovers queued report records when the app becomes ready', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-recover-'))
    const reports = new ReportRepository(join(directory, 'reports.json'))
    await reports.save(sampleRecord)
    const app = buildApp(
      reports,
      new MediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => '恢复后的报告',
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '恢复识别', observedElements: ['采光'], uncertainties: [] })) },
    )
    await app.ready()
    await vi.waitFor(async () => expect(await reports.get(sampleRecord.id)).toMatchObject({ status: 'completed', phase: 'completed', report: '恢复后的报告' }))
    await app.close()
  })

  it('persists report phase updates in the file repository payload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-phase-storage-'))
    const reports = new ReportRepository(join(directory, 'reports.json'))
    await reports.save({ ...sampleRecord, phase: 'queued' })
    await reports.save({ ...sampleRecord, phase: 'harness-generating' })
    await reports.save({ ...sampleRecord, status: 'completed', phase: 'completed', report: '完成报告' })

    expect(await reports.get(sampleRecord.id)).toMatchObject({ status: 'completed', phase: 'completed', report: '完成报告' })
    expect(await reports.listQueued()).toEqual([])
  })

  it('round-trips support dimension facts in file-backed report records', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-support-dimensions-'))
    const reports = new ReportRepository(join(directory, 'reports.json'))
    const supportDimensions: NonNullable<ReportRecord['bazi']['supportDimensions']> = {
      method: 'support-dimensions-facts-v1',
      monthCommandSupports: true,
      rootedAt: ['month', 'day'],
      visiblePeerAt: ['hour'],
      visibleResourceAt: ['year'],
    }
    const record: ReportRecord = {
      ...sampleRecord,
      id: '44444444-4444-4444-8444-444444444444',
      bazi: { ...sampleRecord.bazi, supportDimensions },
    }

    await reports.save(record)

    expect((await reports.get(record.id))?.bazi.supportDimensions).toEqual(supportDimensions)
  })

  it('keeps legacy file-backed report records readable when support dimensions are missing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-legacy-support-dimensions-'))
    const path = join(directory, 'reports.json')
    const legacyRecord: ReportRecord = {
      ...sampleRecord,
      id: '55555555-5555-4555-8555-555555555555',
      bazi: { ...sampleRecord.bazi, supportDimensions: undefined },
    }
    await writeFile(path, JSON.stringify([legacyRecord], null, 2), { mode: 0o600 })
    const reports = new ReportRepository(path)

    expect((await reports.get(legacyRecord.id))?.bazi.supportDimensions).toBeUndefined()
    expect((await reports.listQueued()).map((record) => record.id)).toEqual([legacyRecord.id])
  })

  it('lists file-backed reports by owner newest first', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-owner-list-storage-'))
    const reports = new ReportRepository(join(directory, 'reports.json'))
    const older = { ...sampleRecord, id: '11111111-1111-4111-8111-111111111111', principalId: 'owner-a', createdAt: '2026-08-30T00:00:00.000Z' }
    const other = { ...sampleRecord, id: '22222222-2222-4222-8222-222222222222', principalId: 'owner-b', createdAt: '2026-08-30T00:01:00.000Z' }
    const newer = { ...sampleRecord, id: '33333333-3333-4333-8333-333333333333', principalId: 'owner-a', createdAt: '2026-08-30T00:02:00.000Z' }

    await reports.save(older)
    await reports.save(other)
    await reports.save(newer)

    expect((await reports.listByPrincipal('owner-a')).map((item) => item.id)).toEqual([newer.id, older.id])
    expect((await reports.listByPrincipal('missing-owner')).map((item) => item.id)).toEqual([])
  })

  it('reads file-backed reports only for the matching owner and returns an isolated copy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-owner-get-storage-'))
    const reports = new ReportRepository(join(directory, 'reports.json'))
    const record = { ...sampleRecord, id: '66666666-6666-4666-8666-666666666666', principalId: 'owner-a' }

    await reports.save(record)

    const owned = await reports.getOwned(record.id, 'owner-a')
    expect(owned).toMatchObject({ id: record.id, principalId: 'owner-a' })
    expect(await reports.getOwned(record.id, 'owner-b')).toBeUndefined()
    expect(await reports.getOwned('77777777-7777-4777-8777-777777777777', 'owner-a')).toBeUndefined()

    owned!.status = 'failed'
    owned!.submission.residence.layoutNote = '外部修改不应污染存储'
    expect(await reports.getOwned(record.id, 'owner-a')).toMatchObject({
      status: 'queued',
      submission: { residence: { layoutNote: '客厅连接阳台' } },
    })
  })

  it('archives and restores only owned terminal reports while separating active and archived lists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-archive-storage-'))
    const reports = new ReportRepository(join(directory, 'reports.json'))
    const completed: ReportRecord = {
      ...sampleRecord,
      id: '88888888-8888-4888-8888-888888888888',
      principalId: 'owner-a',
      status: 'completed',
      phase: 'completed',
      report: '已完成报告',
      shareAccess: { tokenHash: 'hash', createdAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-09-08T00:00:00.000Z' },
      runLease: { workerId: 'worker-a', leasedAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-09-01T00:15:00.000Z', attempt: 1 },
    }
    await reports.save(completed)

    await expect(reports.archiveOwned(completed.id, 'owner-b', '2026-09-02T00:00:00.000Z')).resolves.toBeUndefined()
    const archived = await reports.archiveOwned(completed.id, 'owner-a', '2026-09-02T00:00:00.000Z')
    expect(archived).toMatchObject({ id: completed.id, archivedAt: '2026-09-02T00:00:00.000Z' })
    expect(archived?.shareAccess).toBeUndefined()
    expect(archived?.runLease).toBeUndefined()
    await expect(reports.archiveOwned(completed.id, 'owner-a', '2026-09-03T00:00:00.000Z')).resolves.toBeUndefined()
    expect(await reports.listByPrincipal('owner-a')).toEqual([])
    expect((await reports.listByPrincipal('owner-a', true)).map((item) => item.id)).toEqual([completed.id])

    await expect(reports.restoreOwned(completed.id, 'owner-b')).resolves.toBeUndefined()
    const restored = await reports.restoreOwned(completed.id, 'owner-a')
    expect(restored?.archivedAt).toBeUndefined()
    await expect(reports.restoreOwned(completed.id, 'owner-a')).resolves.toBeUndefined()
    expect((await reports.listByPrincipal('owner-a')).map((item) => item.id)).toEqual([completed.id])
    expect(await reports.listByPrincipal('owner-a', true)).toEqual([])
  })

  it('allows exactly one concurrent archive and restore transition and accepts failed reports', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-archive-atomic-'))
    const reports = new ReportRepository(join(directory, 'reports.json'))
    const failed: ReportRecord = {
      ...sampleRecord,
      id: '99999999-9999-4999-8999-999999999999',
      principalId: 'owner-a',
      status: 'failed',
      phase: 'failed',
      error: '模型服务暂时不可用',
    }
    await reports.save(failed)

    const archived = await Promise.all([
      reports.archiveOwned(failed.id, 'owner-a', '2026-09-02T00:00:00.000Z'),
      reports.archiveOwned(failed.id, 'owner-a', '2026-09-03T00:00:00.000Z'),
    ])
    expect(archived.filter(Boolean)).toHaveLength(1)
    expect(archived.find(Boolean)?.archivedAt).toBe('2026-09-02T00:00:00.000Z')

    const restored = await Promise.all([
      reports.restoreOwned(failed.id, 'owner-a'),
      reports.restoreOwned(failed.id, 'owner-a'),
    ])
    expect(restored.filter(Boolean)).toHaveLength(1)
    expect((await reports.get(failed.id))?.archivedAt).toBeUndefined()
  })

  it('rejects archiving non-terminal reports without changing them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-archive-conflict-'))
    const reports = new ReportRepository(join(directory, 'reports.json'))
    const queued = { ...sampleRecord, principalId: 'owner-a' }
    await reports.save(queued)

    await expect(reports.archiveOwned(queued.id, 'owner-a', '2026-09-02T00:00:00.000Z'))
      .rejects.toBeInstanceOf(ReportArchiveConflictError)
    expect(await reports.get(queued.id)).toMatchObject({ status: 'queued' })
    expect((await reports.listQueued()).map((item) => item.id)).toEqual([queued.id])
  })

  it('never lists or claims an archived report even when its payload looks recoverable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-archive-claim-'))
    const reports = new ReportRepository(join(directory, 'reports.json'))
    const archivedQueued: ReportRecord = {
      ...sampleRecord,
      principalId: 'owner-a',
      archivedAt: '2026-09-02T00:00:00.000Z',
    }
    await reports.save(archivedQueued)

    expect(await reports.listQueued()).toEqual([])
    await expect(reports.claimReport(archivedQueued.id, {
      workerId: 'worker-a',
      now: '2026-09-03T00:00:00.000Z',
      leaseExpiresAt: '2026-09-03T00:15:00.000Z',
    })).resolves.toBeUndefined()
    await expect(reports.claimNextReport({
      workerId: 'worker-a',
      now: '2026-09-03T00:00:00.000Z',
      leaseExpiresAt: '2026-09-03T00:15:00.000Z',
    })).resolves.toBeUndefined()
  })
})

describe('postgres storage primitives', () => {
  it('uses parameterized report writes without interpolating payload values', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const pool = {
      query: async (text: string, values?: readonly unknown[]) => {
        calls.push({ text, values })
        return { rows: [], rowCount: 0, command: '', oid: 0, fields: [] }
      },
      connect: vi.fn(),
      end: async () => undefined,
    }
    await new PostgresReportRepository(pool).save({ ...sampleRecord, report: '敏感报告正文' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.text).toContain('$4::jsonb')
    expect(calls[0]!.text).toContain('chart_version_id')
    expect(calls[0]!.text).not.toContain(sampleRecord.id)
    expect(calls[0]!.text).not.toContain('敏感报告正文')
    expect(calls[0]!.values).toHaveLength(8)
  })

  it('uses a parameterized owner filter for postgres report reads', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const record = { ...sampleRecord, principalId: 'owner-a' }
    const pool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
        calls.push({ text, values })
        return queryResult([{ payload: record } as unknown as T])
      },
      connect: vi.fn(),
      end: vi.fn(),
    }

    await expect(new PostgresReportRepository(pool).getOwned(record.id, 'owner-a')).resolves.toEqual(record)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.text).toContain('where id = $1')
    expect(calls[0]!.text).toContain("payload->>'principalId' = $2")
    expect(calls[0]!.text).not.toContain(record.id)
    expect(calls[0]!.text).not.toContain('owner-a')
    expect(calls[0]!.values).toEqual([record.id, 'owner-a'])
  })

  it('claims postgres reports with a parameterized atomic status update', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const claimed = {
      ...sampleRecord,
      status: 'running' as const,
      runLease: {
        workerId: 'worker-a',
        leasedAt: '2026-09-01T00:00:00.000Z',
        expiresAt: '2026-09-01T00:15:00.000Z',
        attempt: 1,
      },
    }
    const pool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
        calls.push({ text, values })
        return queryResult([{ payload: claimed } as unknown as T])
      },
      connect: vi.fn(),
      end: vi.fn(),
    }

    await expect(new PostgresReportRepository(pool).claimReport(sampleRecord.id, {
      workerId: 'worker-a',
      now: '2026-09-01T00:00:00.000Z',
      leaseExpiresAt: '2026-09-01T00:15:00.000Z',
    })).resolves.toMatchObject({ status: 'running', runLease: { workerId: 'worker-a' } })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.text).toContain('update reports')
    expect(calls[0]!.text).toContain("status = 'running'")
    expect(calls[0]!.text).toContain("status = 'queued'")
    expect(calls[0]!.text).toContain("payload#>>'{runLease,expiresAt}' <= $3")
    expect(calls[0]!.text).toContain('returning payload')
    expect(calls[0]!.text).not.toContain(sampleRecord.id)
    expect(calls[0]!.values).toEqual([
      'worker-a',
      '2026-09-01T00:15:00.000Z',
      '2026-09-01T00:00:00.000Z',
      sampleRecord.id,
    ])
  })

  it('fences postgres claimed saves by worker id and lease attempt', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const running = {
      ...sampleRecord,
      status: 'running' as const,
      runLease: {
        workerId: 'worker-a',
        leasedAt: '2026-09-01T00:00:00.000Z',
        expiresAt: '2026-09-01T00:15:00.000Z',
        attempt: 1,
      },
    }
    const pool: PoolLike = {
      query: async (text: string, values?: readonly unknown[]) => {
        calls.push({ text, values })
        return queryResult([], 1)
      },
      connect: vi.fn(),
      end: vi.fn(),
    }

    await expect(new PostgresReportRepository(pool).saveClaimed(
      { ...running, status: 'completed', phase: 'completed', report: '完成报告', runLease: undefined },
      { workerId: 'worker-a', attempt: 1 },
    )).resolves.toBeUndefined()

    expect(calls).toHaveLength(1)
    expect(calls[0]!.text).toContain("payload#>>'{runLease,workerId}' = $6")
    expect(calls[0]!.text).toContain("(payload#>>'{runLease,attempt}')::int = $7")
    expect(calls[0]!.text).not.toContain('完成报告')
    expect(calls[0]!.values).toEqual([
      running.id,
      'completed',
      JSON.stringify({ ...running, status: 'completed', phase: 'completed', report: '完成报告', runLease: undefined }),
      null,
      null,
      'worker-a',
      1,
      null,
      null,
    ])

    const stalePool: PoolLike = {
      query: async () => queryResult([], 0),
      connect: vi.fn(),
      end: vi.fn(),
    }
    await expect(new PostgresReportRepository(stalePool).saveClaimed(running, { workerId: 'worker-a', attempt: 1 }))
      .rejects.toBeInstanceOf(LostReportLeaseError)
  })

  it('stores verified WenZhen fixtures with a parameterized append-only insert', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const pool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
        calls.push({ text, values })
        return queryResult<T>([])
      },
      connect: vi.fn(),
      end: vi.fn(),
    }
    const repository = new PostgresWenzhenFixtureRepository(pool)
    await expect(repository.append(verifiedWenzhenFixture)).resolves.toEqual(verifiedWenzhenFixture)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.text).toContain('insert into wenzhen_fixtures')
    expect(calls[0]!.text).toContain('$2::jsonb')
    expect(calls[0]!.text).not.toContain(verifiedWenzhenFixture.sampleId)
    expect(calls[0]!.values).toEqual([verifiedWenzhenFixture.sampleId, JSON.stringify(verifiedWenzhenFixture)])
  })

  it('rejects duplicate or non-reportable WenZhen fixtures and validates rows on read', async () => {
    const duplicatePool: PoolLike = {
      query: async () => { throw Object.assign(new Error('duplicate key'), { code: '23505' }) },
      connect: vi.fn(),
      end: vi.fn(),
    }
    await expect(new PostgresWenzhenFixtureRepository(duplicatePool).append(verifiedWenzhenFixture))
      .rejects.toThrow(`WenZhen sampleId already exists: ${verifiedWenzhenFixture.sampleId}`)

    const pending = { sampleId: 'wz-pending', source: 'manual', status: 'pending-manual-verification' }
    const invalidRowPool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>() => queryResult([{ payload: pending } as unknown as T]),
      connect: vi.fn(),
      end: vi.fn(),
    }
    await expect(new PostgresWenzhenFixtureRepository(invalidRowPool).list()).rejects.toThrow('must be verified or accepted-difference')
    await expect(new PostgresWenzhenFixtureRepository(invalidRowPool).append(pending as never)).rejects.toThrow('must be verified or accepted-difference')
  })

  it('lists WenZhen fixtures and delegates health and lifecycle to the shared pool', async () => {
    const queries: string[] = []
    const query: PoolLike['query'] = async <T extends QueryResultRow = QueryResultRow>(text: string) => {
      queries.push(text)
      if (text === 'select 1') return queryResult<T>([])
      return queryResult([{ payload: verifiedWenzhenFixture } as unknown as T])
    }
    const end = vi.fn(async () => undefined)
    const pool: PoolLike = { query, connect: vi.fn(), end }
    const repository = new PostgresWenzhenFixtureRepository(pool)
    await expect(repository.list()).resolves.toEqual([verifiedWenzhenFixture])
    await expect(repository.ping()).resolves.toBeUndefined()
    await expect(repository.close()).resolves.toBeUndefined()
    expect(queries).toContain('select payload from wenzhen_fixtures order by created_at asc, sample_id asc')
    expect(queries).toContain('select 1')
    expect(end).toHaveBeenCalledOnce()
  })

  it('records migrations and keeps published knowledge versions asset/version unique', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-migration-'))
    const migrationDir = join(directory, 'migrations')
    await mkdir(migrationDir)
    await writeFile(join(migrationDir, '001_test.sql'), 'create table example(id text primary key);')
    const statements: string[] = []
    const client = {
      query: async (text: string) => {
        statements.push(text)
        return { rows: [], rowCount: 0, command: '', oid: 0, fields: [] }
      },
      release: vi.fn(),
    }
    const pool: PoolLike = {
      query: client.query,
      connect: async () => client,
      end: async () => undefined,
    }
    await runMigrations(pool, migrationDir)
    expect(statements).toEqual(expect.arrayContaining(['begin', 'commit']))
    expect(client.release).toHaveBeenCalledOnce()
    expect(statements.some((statement) => statement.includes('schema_migrations'))).toBe(true)

    const schema = await readFile(fileURLToPath(new URL('../migrations/001_initial_storage.sql', import.meta.url)), 'utf8')
    expect(schema).toContain('unique (asset_id, version)')
    const chartSchema = await readFile(fileURLToPath(new URL('../migrations/002_chart_profiles.sql', import.meta.url)), 'utf8')
    expect(chartSchema).toContain('create table if not exists principals')
    expect(chartSchema).toContain('create table if not exists chart_profiles')
    expect(chartSchema).toContain('create table if not exists chart_versions')
    expect(chartSchema).toContain('unique (profile_id, version)')
    expect(chartSchema).toContain('chart_profiles_one_active_per_principal_idx')
    expect(chartSchema).toContain('add column if not exists chart_version_id uuid references chart_versions(id)')
    expect(chartSchema).toContain('owner_user_id uuid')
    const ruleProfileSchema = await readFile(fileURLToPath(new URL('../migrations/003_bazi_rule_profiles.sql', import.meta.url)), 'utf8')
    expect(ruleProfileSchema).toContain('create table if not exists bazi_rule_profiles')
    expect(ruleProfileSchema).toContain('create table if not exists bazi_rule_profile_versions')
    expect(ruleProfileSchema).toContain('unique (profile_id, version)')
    expect(ruleProfileSchema).toContain('profile_key text not null unique')
    const chartRuleProfileSchema = await readFile(fileURLToPath(new URL('../migrations/004_chart_rule_profile_versions.sql', import.meta.url)), 'utf8')
    expect(chartRuleProfileSchema).toContain('rule_profile_version_id text')
    expect(chartRuleProfileSchema).toContain('references bazi_rule_profile_versions(version_id) on delete restrict')
    expect(chartRuleProfileSchema).toContain('rule_profile_version jsonb')
    expect(chartRuleProfileSchema).toContain("rule_profile_version ->> 'versionId' = rule_profile_version_id")
    const chartRestoreSchema = await readFile(fileURLToPath(new URL('../migrations/005_chart_version_restore_audit.sql', import.meta.url)), 'utf8')
    expect(chartRestoreSchema).toContain('restored_from_version_id uuid')
    expect(chartRestoreSchema).toContain('references chart_versions(id) on delete restrict')
    const wenzhenSchema = await readFile(fileURLToPath(new URL('../migrations/006_wenzhen_fixtures.sql', import.meta.url)), 'utf8')
    expect(wenzhenSchema).toContain('create table if not exists wenzhen_fixtures')
    expect(wenzhenSchema).toContain('sample_id text primary key')
    expect(wenzhenSchema).toContain("payload ->> 'sampleId' = sample_id")
    expect(wenzhenSchema).toContain("payload ->> 'status' in ('verified', 'accepted-difference')")
    expect(wenzhenSchema).toContain('before update or delete on wenzhen_fixtures')
    const knowledgeAuditSchema = await readFile(fileURLToPath(new URL('../migrations/007_knowledge_review_audit.sql', import.meta.url)), 'utf8')
    expect(knowledgeAuditSchema).toContain('submitted_for_review_by')
    expect(knowledgeAuditSchema).toContain('reviewed_by')
    expect(knowledgeAuditSchema).toContain('published_by')
    expect(knowledgeAuditSchema).toContain('submitted_for_review_by <> reviewed_by')
    const calculationInputSchema = await readFile(fileURLToPath(new URL('../migrations/008_chart_calculation_input.sql', import.meta.url)), 'utf8')
    expect(calculationInputSchema).toContain('add column if not exists calculation_input jsonb')
    expect(calculationInputSchema).toContain('set calculation_input = birth')
    expect(calculationInputSchema).toContain('alter column birth drop not null')
    expect(calculationInputSchema).toContain("calculation_input ->> 'inputMode' = 'manual-four-pillars'")
  })

  it('discovers the chart rule-profile migration from the real migration directory', async () => {
    const applied: unknown[][] = []
    const client = {
      query: async <T = unknown>(text: string, values?: unknown[]) => {
        if (text === 'select filename from schema_migrations where filename = $1') return { rows: [] as T[], rowCount: 0, command: '', oid: 0, fields: [] }
        if (text === 'insert into schema_migrations (filename) values ($1)') applied.push(values ?? [])
        return { rows: [] as T[], rowCount: 0, command: '', oid: 0, fields: [] }
      },
      release: vi.fn(),
    }
    const pool: PoolLike = {
      query: client.query,
      connect: async () => client,
      end: async () => undefined,
    }
    await runMigrations(pool, fileURLToPath(new URL('../migrations/', import.meta.url)))
    expect(applied.map((values) => values[0])).toContain('004_chart_rule_profile_versions.sql')
    expect(applied.map((values) => values[0])).toContain('005_chart_version_restore_audit.sql')
    expect(applied.map((values) => values[0])).toContain('006_wenzhen_fixtures.sql')
    expect(applied.map((values) => values[0])).toContain('007_knowledge_review_audit.sql')
    expect(applied.map((values) => values[0])).toContain('008_chart_calculation_input.sql')
    expect(applied.map((values) => values[0])).toContain('009_knowledge_published_version_pointer.sql')
  })

  it('allows only a byte-for-byte equivalent immutable knowledge snapshot on insert conflict', async () => {
    const statements: string[] = []
    const query = async <T extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<T>> => {
      statements.push(text)
      if (text.includes('insert into knowledge_versions')) return queryResult<T>([], 0)
      if (text.includes('select * from knowledge_versions')) return queryResult<T>([knowledgeVersionRow(auditedKnowledgeVersion) as T])
      return queryResult<T>([])
    }
    await expect(insertPublishedVersion({ query }, auditedKnowledgeVersion)).resolves.toBeUndefined()
    expect(statements.some((statement) => statement.includes('on conflict do nothing'))).toBe(true)
    expect(statements.some((statement) => statement.includes('version_id = $3'))).toBe(true)

    const conflictingQuery = async <T extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<T>> => {
      if (text.includes('insert into knowledge_versions')) return queryResult<T>([], 0)
      if (text.includes('select * from knowledge_versions')) return queryResult<T>([knowledgeVersionRow(auditedKnowledgeVersion, { body: '被篡改的正文' }) as T])
      return queryResult<T>([])
    }
    await expect(insertPublishedVersion({ query: conflictingQuery }, auditedKnowledgeVersion)).rejects.toBeInstanceOf(KnowledgeImmutableVersionConflictError)
  })

  it('rolls back the knowledge publication transaction when an immutable version conflicts', async () => {
    const statements: string[] = []
    const submittedAt = '2026-08-31T10:00:00.000Z'
    const assetRow = {
      id: auditedKnowledgeVersion.assetId,
      version: 1,
      state: 'in-review',
      kind: 'article',
      title: auditedKnowledgeVersion.title,
      tags: auditedKnowledgeVersion.tags,
      body: auditedKnowledgeVersion.body,
      source_label: auditedKnowledgeVersion.sourceLabel,
      created_at: submittedAt,
      created_by: 'knowledge-editor',
      updated_at: submittedAt,
      updated_by: 'knowledge-editor',
      submitted_for_review_at: submittedAt,
      submitted_for_review_by: 'knowledge-editor',
      reviewed_at: null,
      reviewed_by: null,
      archived_at: null,
      archived_by: null,
      rule: null,
    }
    const client = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> => {
        statements.push(text)
        if (text.includes('select * from knowledge_assets') && text.includes('for update')) return queryResult<T>([assetRow as unknown as T])
        if (text.includes('insert into knowledge_versions')) return queryResult<T>([], 0)
        if (text.includes('select * from knowledge_versions')) return queryResult<T>([])
        if (text.includes('update knowledge_assets')) {
          return queryResult<T>([{ ...assetRow, state: 'published', updated_at: values[2], updated_by: values[3], reviewed_at: values[6], reviewed_by: values[7], current_published_version_id: values[10] } as unknown as T])
        }
        return queryResult<T>([])
      },
      release: vi.fn(),
    }
    const pool: PoolLike = { query: client.query, connect: async () => client, end: async () => undefined }
    const repository = new PostgresKnowledgeRepository(pool)

    await expect(repository.setState(auditedKnowledgeVersion.assetId, 'published', 'knowledge-reviewer')).rejects.toBeInstanceOf(KnowledgeImmutableVersionConflictError)
    expect(statements).toContain('rollback')
    expect(statements).not.toContain('commit')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('locks and revises a postgres knowledge asset only at the expected revision', async () => {
    const statements: Array<{ text: string; values?: readonly unknown[] }> = []
    const current = knowledgeAssetRow()
    const client = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<QueryResult<T>> => {
        statements.push({ text, values })
        if (text.includes('select * from knowledge_assets') && text.includes('for update')) {
          return queryResult<T>([current as T])
        }
        if (text.includes('update knowledge_assets')) {
          return queryResult<T>([knowledgeAssetRow({
            version: values[1],
            state: values[2],
            kind: values[3],
            title: values[4],
            tags: JSON.parse(String(values[5])),
            body: values[6],
            source_label: values[7],
            updated_at: values[10],
            updated_by: values[11],
            submitted_for_review_at: null,
            submitted_for_review_by: null,
            reviewed_at: null,
            reviewed_by: null,
          }) as T])
        }
        return queryResult<T>([])
      },
      release: vi.fn(),
    }
    const pool: PoolLike = { query: client.query, connect: async () => client, end: async () => undefined }

    const revised = await new PostgresKnowledgeRepository(pool).revise(auditedKnowledgeVersion.assetId, {
      kind: 'article',
      title: '不可变知识版本（修订稿）',
      tags: ['审核', '修订'],
      body: '新正文只进入工作草稿。',
      sourceLabel: '存储测试',
    }, 'second-editor', 1)

    expect(revised).toMatchObject({ version: 2, state: 'draft', title: '不可变知识版本（修订稿）', updatedBy: 'second-editor' })
    expect(revised).toMatchObject({ currentPublishedVersionId: auditedKnowledgeVersion.versionId })
    expect(statements.map(({ text }) => text)).toEqual([
      'begin',
      'select * from knowledge_assets where id = $1 for update',
      expect.stringContaining('update knowledge_assets'),
      'commit',
    ])
    expect(statements.some(({ text }) => text.includes('knowledge_versions'))).toBe(false)
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('normalizes direct postgres knowledge creates before persistence', async () => {
    const statements: Array<{ text: string; values?: readonly unknown[] }> = []
    const pool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> => {
        statements.push({ text, values })
        return queryResult<T>([])
      },
      connect: vi.fn(),
      end: async () => undefined,
    }

    const created = await new PostgresKnowledgeRepository(pool).create({
      kind: 'article',
      title: '  归一化标题  ',
      tags: [' 入户 ', '入户', '客厅'],
      body: '  归一化正文。  ',
      sourceLabel: '  存储测试  ',
    })

    expect(created).toMatchObject({
      title: '归一化标题',
      tags: ['入户', '客厅'],
      body: '归一化正文。',
      sourceLabel: '存储测试',
    })
    expect(statements).toHaveLength(1)
    expect(statements[0]?.values?.[5]).toBe(JSON.stringify(['入户', '客厅']))
    expect(statements[0]?.values?.[6]).toBe('归一化正文。')
  })

  it('rejects invalid direct postgres knowledge input before issuing a query', async () => {
    const pool: PoolLike = {
      query: vi.fn(),
      connect: vi.fn(),
      end: async () => undefined,
    }
    const repository = new PostgresKnowledgeRepository(pool)

    await expect(repository.create({
      kind: 'article',
      title: '  ',
      tags: [],
      body: '正文',
      sourceLabel: '测试',
    })).rejects.toThrow('title must contain')
    await expect(repository.revise('asset-one', {
      kind: 'article',
      title: '标题',
      tags: [],
      body: '正文',
      sourceLabel: '测试',
      rule: { priority: 1, conditions: [], conclusions: [] },
    })).rejects.toThrow('rule is only allowed for rule assets')

    expect(pool.query).not.toHaveBeenCalled()
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('uses parameterized literal substring semantics for postgres knowledge search terms', async () => {
    const statements: Array<{ text: string; values?: readonly unknown[] }> = []
    const pool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> => {
        statements.push({ text, values })
        return queryResult<T>([])
      },
      connect: vi.fn(),
      end: async () => undefined,
    }

    await new PostgresKnowledgeRepository(pool).search('% _ \\ 入户')

    expect(statements).toHaveLength(1)
    expect(statements[0]?.text).toContain('position(term in lower(')
    expect(statements[0]?.text).toContain('a.current_published_version_id = v.version_id')
    expect(statements[0]?.text).not.toContain("a.version = v.version")
    expect(statements[0]?.text).not.toContain(' like ')
    expect(statements[0]?.values).toEqual([knowledgeSearchTerms('% _ \\ 入户'), 5])
  })

  it('segments a natural Chinese question before postgres knowledge search', async () => {
    const statements: Array<{ text: string; values?: readonly unknown[] }> = []
    const pool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> => {
        statements.push({ text, values })
        return queryResult<T>([])
      },
      connect: vi.fn(),
      end: async () => undefined,
    }

    const query = '我想改善家中入户区域的动线问题，应该注意什么？'
    await new PostgresKnowledgeRepository(pool).search(query)

    expect(statements).toHaveLength(1)
    expect(statements[0]?.values?.[0]).toEqual(knowledgeSearchTerms(query))
    expect(statements[0]?.values?.[0]).toEqual(expect.arrayContaining(['改善', '家中', '入户', '区域', '动线', '问题', '注意', '什么']))
  })

  it('reads only the explicitly pointed knowledge version for empty search and published rules', async () => {
    const statements: string[] = []
    const pool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<T>> => {
        statements.push(text)
        return queryResult<T>([])
      },
      connect: vi.fn(),
      end: async () => undefined,
    }
    const repository = new PostgresKnowledgeRepository(pool)

    await repository.search('')
    await repository.publishedRules()

    expect(statements).toHaveLength(2)
    for (const statement of statements) {
      expect(statement).toContain('a.current_published_version_id = v.version_id')
      expect(statement).not.toContain('a.version = v.version')
    }
  })

  it('rolls back a stale postgres knowledge revision without updating the asset', async () => {
    const statements: string[] = []
    const client = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<T>> => {
        statements.push(text)
        if (text.includes('select * from knowledge_assets') && text.includes('for update')) {
          return queryResult<T>([knowledgeAssetRow({ version: 2 }) as T])
        }
        return queryResult<T>([])
      },
      release: vi.fn(),
    }
    const pool: PoolLike = { query: client.query, connect: async () => client, end: async () => undefined }

    await expect(new PostgresKnowledgeRepository(pool).revise(auditedKnowledgeVersion.assetId, {
      kind: 'article',
      title: '过期编辑',
      tags: [],
      body: '不得覆盖更新版本。',
      sourceLabel: '存储测试',
    }, 'stale-editor', 1)).rejects.toBeInstanceOf(KnowledgeRevisionConflictError)

    expect(statements).toEqual([
      'begin',
      'select * from knowledge_assets where id = $1 for update',
      'rollback',
    ])
    expect(statements.some((text) => text.includes('update knowledge_assets'))).toBe(false)
    expect(statements).not.toContain('commit')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('serializes file-backed chart writes and rejects stale revisions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-charts-'))
    const charts = new ChartRepository(join(directory, 'charts.json'))
    const principal = await charts.createPrincipal('hash-one')
    const duplicate = await charts.createPrincipal('hash-one')
    expect(duplicate.id).toBe(principal.id)

    const sampleBirth = sampleRecord.submission.birth!
    const profile = await charts.createProfile(principal.id, sampleBirth, sampleRecord.bazi, { label: '我的命盘', relationship: 'self' }, ruleProfileReference)
    await expect(charts.createProfile(principal.id, sampleBirth, sampleRecord.bazi, { label: '家人命盘', relationship: 'parent' })).resolves.toMatchObject({ label: '家人命盘', relationship: 'parent' })
    await expect(charts.listProfiles(principal.id)).resolves.toHaveLength(2)
    const staleWrite = charts.appendVersion(profile.id, principal.id, 1, { ...sampleBirth, time: '10:00' }, sampleRecord.bazi, { ...ruleProfileReference, versionId: 'profile-rule-one:v2:fedcba9876543210', version: 2 })
    const winningWrite = charts.appendVersion(profile.id, principal.id, 1, { ...sampleBirth, time: '11:00' }, sampleRecord.bazi)
    const outcomes = await Promise.allSettled([staleWrite, winningWrite])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({ reason: expect.any(ChartRevisionConflictError) })
    await expect(charts.getCurrentProfile(principal.id)).resolves.toMatchObject({ revision: 2 })
    const versions = await charts.listVersions(profile.id, principal.id)
    expect(versions?.find((version) => version.version === 1)?.ruleProfileVersion).toEqual(ruleProfileReference)
    const restored = await charts.restoreVersion(profile.id, principal.id, versions!.find((version) => version.version === 1)!.id, 2)
    expect(restored).toMatchObject({ revision: 3, currentVersion: { version: 3, restoredFromVersionId: versions!.find((version) => version.version === 1)!.id } })
    expect(restored!.currentVersion.birth).toEqual(versions!.find((version) => version.version === 1)!.birth)
  })

  it('reads an exact file-backed chart version only for its owner, including after soft deletion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-chart-version-'))
    const charts = new ChartRepository(join(directory, 'charts.json'))
    const owner = await charts.createPrincipal('exact-version-owner')
    const stranger = await charts.createPrincipal('exact-version-stranger')
    const sampleBirth = sampleRecord.submission.birth!
    const profile = await charts.createProfile(owner.id, sampleBirth, sampleRecord.bazi, { label: '我的命盘', relationship: 'self' }, ruleProfileReference)
    const firstVersionId = profile.currentVersion.id

    const exact = await charts.getVersion(profile.id, owner.id, firstVersionId)
    expect(exact).toEqual(profile.currentVersion)
    expect(await charts.getVersion(profile.id, owner.id, 'missing-version')).toBeUndefined()
    expect(await charts.getVersion(profile.id, stranger.id, firstVersionId)).toBeUndefined()

    ;(exact as unknown as { bazi: { pillars: string[] } }).bazi.pillars[0] = '甲子'
    expect((await charts.getVersion(profile.id, owner.id, firstVersionId))?.bazi.pillars[0]).toBe(profile.currentVersion.bazi.pillars[0])

    await charts.softDeleteProfile(profile.id, owner.id)
    expect(await charts.getVersion(profile.id, owner.id, firstVersionId)).toEqual(profile.currentVersion)
  })

  it('loads an exact postgres chart version with one ownership join query', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const pool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
        calls.push({ text, values })
        return queryResult([{
          id: 'version-one',
          profile_id: 'profile-one',
          version: 1,
          calculation_input: sampleRecord.submission.birth,
          birth: sampleRecord.submission.birth,
          bazi: sampleRecord.bazi,
          rule_profile_version_id: ruleProfileReference.versionId,
          rule_profile_version: ruleProfileReference,
          restored_from_version_id: null,
          created_at: '2026-08-30T00:00:00.000Z',
        } as unknown as T])
      },
      connect: async () => { throw new Error('not used') },
      end: async () => undefined,
    }

    await expect(new PostgresChartRepository(pool).getVersion('profile-one', 'principal-one', 'version-one'))
      .resolves.toMatchObject({ id: 'version-one', profileId: 'profile-one', version: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.text).toContain('join chart_profiles p on p.id = v.profile_id')
    expect(calls[0]?.values).toEqual(['version-one', 'profile-one', 'principal-one'])
  })

  it('uses a postgres transaction and row lock when appending chart versions', async () => {
    const statements: Array<{ text: string; values?: readonly unknown[] }> = []
    const client = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
        statements.push({ text, values })
        if (text.includes('for update')) return queryResult([{ id: 'profile-one', revision: 1 } as unknown as T])
        if (text.includes('returning p.id')) {
          return queryResult([{
              id: 'profile-one',
              principal_id: 'principal-one',
              revision: 2,
              created_at: '2026-08-30T00:00:00.000Z',
              updated_at: '2026-08-30T00:01:00.000Z',
              deleted_at: null,
              version_id: 'version-two',
              version: 2,
              birth: sampleRecord.submission.birth,
              bazi: sampleRecord.bazi,
              rule_profile_version_id: ruleProfileReference.versionId,
              rule_profile_version: ruleProfileReference,
              version_created_at: '2026-08-30T00:01:00.000Z',
            } as unknown as T])
        }
        return queryResult<T>([])
      },
      release: vi.fn(),
    }
    const pool: PoolLike = {
      query: client.query,
      connect: async () => client,
      end: async () => undefined,
    }
    const updated = await new PostgresChartRepository(pool).appendVersion(
      'profile-one',
      'principal-one',
      1,
      sampleRecord.submission.birth!,
      sampleRecord.bazi,
      ruleProfileReference,
    )
    expect(updated).toMatchObject({ revision: 2, currentVersion: { version: 2, ruleProfileVersion: ruleProfileReference } })
    expect(statements.map((call) => call.text)).toEqual(expect.arrayContaining(['begin', 'commit']))
    expect(statements.some((call) => call.text.includes('for update'))).toBe(true)
    const insert = statements.find((call) => call.text.includes('insert into chart_versions'))
    expect(insert?.text).toContain('rule_profile_version_id')
    expect(insert?.values).toEqual(expect.arrayContaining([ruleProfileReference.versionId, JSON.stringify(ruleProfileReference)]))
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rolls back postgres chart appends on revision conflict', async () => {
    const statements: string[] = []
    const client = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string) => {
        statements.push(text)
        if (text.includes('for update')) return queryResult([{ id: 'profile-one', revision: 3 } as unknown as T])
        return queryResult<T>([])
      },
      release: vi.fn(),
    }
    const pool: PoolLike = {
      query: client.query,
      connect: async () => client,
      end: async () => undefined,
    }
    await expect(new PostgresChartRepository(pool).appendVersion(
      'profile-one',
      'principal-one',
      2,
      sampleRecord.submission.birth!,
      sampleRecord.bazi,
    )).rejects.toBeInstanceOf(ChartRevisionConflictError)
    expect(statements).toEqual(expect.arrayContaining(['begin', 'rollback']))
    expect(statements.some((statement) => statement.includes('insert into chart_versions'))).toBe(false)
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('uses a postgres transaction and row lock when restoring chart versions', async () => {
    const statements: Array<{ text: string; values?: readonly unknown[] }> = []
    const client = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
        statements.push({ text, values })
        if (text.includes('from chart_profiles') && text.includes('for update')) return queryResult([{ id: 'profile-one', revision: 2, deleted_at: null } as unknown as T])
        if (text.includes('from chart_versions where id')) {
          return queryResult([{
            id: 'version-one',
            profile_id: 'profile-one',
            version: 1,
            birth: sampleRecord.submission.birth,
            bazi: sampleRecord.bazi,
            rule_profile_version_id: ruleProfileReference.versionId,
            rule_profile_version: ruleProfileReference,
            restored_from_version_id: null,
            created_at: '2026-08-30T00:00:00.000Z',
          } as unknown as T])
        }
        if (text.includes('returning p.id')) {
          return queryResult([{
            id: 'profile-one',
            principal_id: 'principal-one',
            revision: 3,
            created_at: '2026-08-30T00:00:00.000Z',
            updated_at: '2026-08-30T00:01:00.000Z',
            deleted_at: null,
            version_id: 'version-three',
            version: 3,
            birth: sampleRecord.submission.birth,
            bazi: sampleRecord.bazi,
            rule_profile_version_id: ruleProfileReference.versionId,
            rule_profile_version: ruleProfileReference,
            restored_from_version_id: 'version-one',
            version_created_at: '2026-08-30T00:01:00.000Z',
          } as unknown as T])
        }
        return queryResult<T>([])
      },
      release: vi.fn(),
    }
    const pool: PoolLike = {
      query: client.query,
      connect: async () => client,
      end: async () => undefined,
    }
    const restored = await new PostgresChartRepository(pool).restoreVersion('profile-one', 'principal-one', 'version-one', 2)
    expect(restored).toMatchObject({ revision: 3, currentVersion: { version: 3, restoredFromVersionId: 'version-one', ruleProfileVersion: ruleProfileReference } })
    expect(statements.map((call) => call.text)).toEqual(expect.arrayContaining(['begin', 'commit']))
    expect(statements.some((call) => call.text.includes('for update'))).toBe(true)
    const insert = statements.find((call) => call.text.includes('insert into chart_versions'))
    expect(insert?.text).toContain('restored_from_version_id')
    expect(insert?.values).toEqual(expect.arrayContaining(['version-one', ruleProfileReference.versionId, JSON.stringify(ruleProfileReference)]))
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('keeps the postgres bazi rule profile lifecycle transactional and published versions immutable', async () => {
    const repository = new PostgresBaziRuleProfileRepository(new MemoryRuleProfilePool())
    const input = { key: 'postgres-school', name: '数据库流派', workingDefinition: ruleProfileDefinition }
    const created = await repository.create(input, 'creator')
    await expect(repository.create(input, 'creator')).rejects.toBeInstanceOf(DuplicateBaziRuleProfileKeyError)

    await repository.setState(created.id, 'in-review', 'submitter')
    await repository.setState(created.id, 'published', 'publisher')
    expect(await repository.listActiveVersions()).toEqual([expect.objectContaining({ profileId: created.id, version: 1 })])
    const firstActive = (await repository.listActiveVersions())[0]!
    expect(await repository.getActiveVersion(firstActive.versionId)).toEqual(firstActive)
    const firstVersions = await repository.listVersions(created.id)
    expect(firstVersions).toHaveLength(1)
    expect(firstVersions![0]).toMatchObject({ version: 1, submittedForReviewBy: 'submitter', publishedBy: 'publisher' })
    const immutableFirst = structuredClone(firstVersions![0])

    const revised = await repository.revise(created.id, {
      name: '数据库流派第二版',
      workingDefinition: { ...ruleProfileDefinition, timeDefaults: { ...ruleProfileDefinition.timeDefaults, luckMethod: 'sect2' } },
    }, 'editor', 1)
    expect(revised).toMatchObject({ state: 'draft', revision: 2, currentPublishedVersionId: immutableFirst.versionId })
    expect(await repository.listActiveVersions()).toEqual([immutableFirst])
    expect(await repository.getActiveVersion(immutableFirst.versionId)).toEqual(immutableFirst)
    expect((await repository.listVersions(created.id))![0]).toEqual(immutableFirst)
    await expect(repository.revise(created.id, {
      name: '旧版本不应覆盖',
      workingDefinition: ruleProfileDefinition,
    }, 'stale-editor', 1)).rejects.toBeInstanceOf(BaziRuleProfileRevisionConflictError)
    expect((await repository.list())[0]).toMatchObject({ revision: 2, name: '数据库流派第二版', updatedBy: 'editor' })

    await repository.setState(created.id, 'in-review', 'second-submitter')
    expect(await repository.listActiveVersions()).toEqual([immutableFirst])
    expect(await repository.getActiveVersion(immutableFirst.versionId)).toEqual(immutableFirst)
    await repository.setState(created.id, 'published', 'second-publisher')
    const versions = await repository.listVersions(created.id)
    expect(versions!.map((version) => version.version)).toEqual([2, 1])
    expect(versions![1]).toEqual(immutableFirst)
    expect(versions![0]!.contentHash).not.toBe(immutableFirst.contentHash)
    expect(await repository.listActiveVersions()).toEqual([versions![0]])
    expect(await repository.getActiveVersion(versions![0]!.versionId)).toEqual(versions![0])
    expect(await repository.getActiveVersion(immutableFirst.versionId)).toBeUndefined()

    const archived = await repository.setState(created.id, 'archived', 'archiver')
    expect(archived).toMatchObject({ state: 'archived', currentPublishedVersionId: versions![0]!.versionId })
    expect(await repository.listActiveVersions()).toEqual([])
    expect(await repository.getActiveVersion(versions![0]!.versionId)).toBeUndefined()
    await expect(repository.revise(created.id, {
      name: '不允许复活的流派',
      workingDefinition: ruleProfileDefinition,
    }, 'editor', 2)).rejects.toEqual(new InvalidBaziRuleProfileTransitionError('archived', 'draft'))
  })

  it('reports whether any stored report cites a knowledge asset', async () => {
    const citedPool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
        expect(text).toContain('from reports')
        expect(text).toContain('@>')
        expect(values).toEqual(['asset-1'])
        return queryResult<T>([{ exists: true } as unknown as T])
      },
      connect: vi.fn(),
      end: async () => undefined,
    }
    await expect(new PostgresReportRepository(citedPool).isKnowledgeCited('asset-1')).resolves.toBe(true)

    const notCitedPool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>() => queryResult<T>([{ exists: false } as unknown as T]),
      connect: vi.fn(),
      end: async () => undefined,
    }
    await expect(new PostgresReportRepository(notCitedPool).isKnowledgeCited('asset-1')).resolves.toBe(false)

    const emptyPool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>() => queryResult<T>([]),
      connect: vi.fn(),
      end: async () => undefined,
    }
    await expect(new PostgresReportRepository(emptyPool).isKnowledgeCited('asset-1')).resolves.toBe(false)
  })

  it('reports whether any stored chart references a rule profile', async () => {
    const referencedPool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => {
        expect(text).toContain('chart_versions')
        expect(text).toContain('bazi_rule_profile_versions')
        expect(values).toEqual(['profile-1'])
        return queryResult<T>([{ exists: true } as unknown as T])
      },
      connect: vi.fn(),
      end: async () => undefined,
    }
    await expect(new PostgresChartRepository(referencedPool).referencesRuleProfile('profile-1')).resolves.toBe(true)

    const notReferencedPool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>() => queryResult<T>([{ exists: false } as unknown as T]),
      connect: vi.fn(),
      end: async () => undefined,
    }
    await expect(new PostgresChartRepository(notReferencedPool).referencesRuleProfile('profile-1')).resolves.toBe(false)
  })

  it('physically deletes a knowledge asset nulling the pointer before its versions', async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = []
    const client = {
      query: async (text: string, values: readonly unknown[] = []) => {
        calls.push({ text: text.replace(/\s+/g, ' ').trim(), values })
        return queryResult([], 1)
      },
      release: vi.fn(),
    }
    const pool: PoolLike = { query: client.query, connect: async () => client, end: async () => undefined }
    await expect(new PostgresKnowledgeRepository(pool).delete('asset-1')).resolves.toBe(true)
    const sql = calls.map((c) => c.text.toLowerCase()).filter((t) => !['begin', 'commit', 'rollback'].includes(t))
    expect(sql[0]).toContain('update knowledge_assets')
    expect(sql[0]).toContain('current_published_version_id = null')
    expect(sql[1]).toContain('delete from knowledge_versions')
    expect(sql[2]).toContain('delete from knowledge_assets')
    expect(calls.some((c) => c.text.toLowerCase() === 'commit')).toBe(true)
    expect(client.release).toHaveBeenCalled()

    const emptyCalls: Array<{ text: string; values: readonly unknown[] }> = []
    const emptyClient = {
      query: async (text: string, values: readonly unknown[] = []) => {
        emptyCalls.push({ text: text.replace(/\s+/g, ' ').trim(), values })
        return queryResult([], 0)
      },
      release: vi.fn(),
    }
    const emptyPool: PoolLike = { query: emptyClient.query, connect: async () => emptyClient, end: async () => undefined }
    await expect(new PostgresKnowledgeRepository(emptyPool).delete('asset-1')).resolves.toBe(false)
  })

  it('physically deletes a rule profile and maps a foreign-key violation to a referenced error', async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = []
    const client = {
      query: async (text: string, values: readonly unknown[] = []) => {
        calls.push({ text: text.replace(/\s+/g, ' ').trim(), values })
        return queryResult([], 1)
      },
      release: vi.fn(),
    }
    const pool: PoolLike = { query: client.query, connect: async () => client, end: async () => undefined }
    await expect(new PostgresBaziRuleProfileRepository(pool).delete('profile-1')).resolves.toBe(true)
    const sql = calls.map((c) => c.text.toLowerCase()).filter((t) => !['begin', 'commit', 'rollback'].includes(t))
    expect(sql[0]).toContain('update bazi_rule_profiles')
    expect(sql[0]).toContain('current_published_version_id = null')
    expect(sql[1]).toContain('delete from bazi_rule_profile_versions')
    expect(sql[2]).toContain('delete from bazi_rule_profiles')

    const fkCalls: Array<{ text: string; values: readonly unknown[] }> = []
    const fkClient = {
      query: async (text: string, values: readonly unknown[] = []) => {
        const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase()
        fkCalls.push({ text: normalized, values })
        if (normalized.includes('delete from bazi_rule_profile_versions')) {
          throw Object.assign(new Error('fk'), { code: '23503' })
        }
        return queryResult([], 1)
      },
      release: vi.fn(),
    }
    const fkPool: PoolLike = { query: fkClient.query, connect: async () => fkClient, end: async () => undefined }
    await expect(new PostgresBaziRuleProfileRepository(fkPool).delete('profile-1')).rejects.toBeInstanceOf(BaziRuleProfileReferencedError)
    expect(fkCalls.some((c) => c.text === 'rollback')).toBe(true)
    expect(fkClient.release).toHaveBeenCalled()
  })

  it('aggregates report counts for the dashboard', async () => {
    const pool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string) => {
        expect(text).toContain('from reports')
        expect(text).toContain("filter (where status = 'queued')")
        return queryResult<T>([{ total: 5, queued: 2, completed: 2, failed: 1, last24h: 3 } as unknown as T])
      },
      connect: vi.fn(),
      end: async () => undefined,
    }
    await expect(new PostgresReportRepository(pool).reportStats()).resolves.toEqual({ total: 5, queued: 2, completed: 2, failed: 1, last24h: 3 })

    const emptyPool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>() => queryResult<T>([]),
      connect: vi.fn(),
      end: async () => undefined,
    }
    await expect(new PostgresReportRepository(emptyPool).reportStats()).resolves.toEqual({ total: 0, queued: 0, completed: 0, failed: 0, last24h: 0 })
  })

  it('aggregates chart profile counts for the dashboard', async () => {
    const pool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string) => {
        expect(text).toContain('from chart_profiles')
        expect(text).toContain('deleted_at is null')
        return queryResult<T>([{ total: 4, active: 3, deleted: 1 } as unknown as T])
      },
      connect: vi.fn(),
      end: async () => undefined,
    }
    await expect(new PostgresChartRepository(pool).chartStats()).resolves.toEqual({ total: 4, active: 3, deleted: 1 })

    const emptyPool: PoolLike = {
      query: async <T extends QueryResultRow = QueryResultRow>() => queryResult<T>([]),
      connect: vi.fn(),
      end: async () => undefined,
    }
    await expect(new PostgresChartRepository(emptyPool).chartStats()).resolves.toEqual({ total: 0, active: 0, deleted: 0 })
  })
})
