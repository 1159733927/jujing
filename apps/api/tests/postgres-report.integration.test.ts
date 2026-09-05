import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import type { BaziChart, BirthInput, ReportGenerationProvenance, ReportRecord, ResidenceSnapshot } from '@fengshui/domain'
import { LostReportLeaseError, ReportArchiveConflictError } from '../src/repository.js'
import { PostgresChartRepository, PostgresReportRepository, PostgresResidenceRepository, runMigrations } from '../src/storage/postgres.js'

const connectionString = process.env.TEST_DATABASE_URL
const describeWithDatabase = connectionString ? describe : describe.skip
const ownedSchemas: string[] = []

function schemaName(): string {
  return `report_it_${randomUUID().replaceAll('-', '_')}`
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function isolatedPool(schema: string): Pool {
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required')
  return new Pool({
    connectionString,
    options: `-c search_path=${schema}`,
  })
}

async function createMigratedPool(): Promise<Pool> {
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required')
  const schema = schemaName()
  ownedSchemas.push(schema)
  const admin = new Pool({ connectionString })
  await admin.query(`create schema ${quoteIdentifier(schema)}`)
  await admin.end()

  const pool = isolatedPool(schema)
  await runMigrations(pool, fileURLToPath(new URL('../migrations/', import.meta.url)))
  return pool
}

function birthInput(): BirthInput {
  return {
    calendarSystem: 'solar',
    date: '1992-08-18',
    time: '09:30',
    locationName: '浙江省 杭州市 西湖区',
    province: '浙江省',
    city: '杭州市',
    district: '西湖区',
    placeCode: '330106',
    geoDataVersion: 'test-fixture-v1',
    longitude: 120.1551,
    latitude: 30.2741,
    timezone: 'Asia/Shanghai',
    useTrueSolarTime: true,
    dstPolicy: 'auto',
    dayBoundary: 'midnight',
    luckMethod: 'sect1',
    gender: 'male',
  }
}

function baziChart(): BaziChart {
  return {
    ruleVersion: 'bazi-v5-stem-branch-relations',
    correctedLocalTime: '1992-08-18T09:28:00.000+08:00',
    correctionMinutes: -2,
    pillars: ['壬申', '戊申', '丙寅', '癸巳'],
  }
}

function residenceSnapshot(): ResidenceSnapshot {
  return {
    schemaVersion: 'residence-snapshot-v1',
    label: '滨江南向住宅',
    facing: 'south',
    layoutNote: '客厅连接阳台',
  }
}

async function createChartReference(pool: Pool): Promise<{ principalId: string; chartProfileId: string; chartVersionId: string }> {
  const charts = new PostgresChartRepository(pool)
  const principal = await charts.createPrincipal(`report-principal-${randomUUID()}`)
  const profile = await charts.createProfile(
    principal.id,
    birthInput(),
    baziChart(),
    { label: '我的命盘', relationship: 'self' },
  )
  return { principalId: principal.id, chartProfileId: profile.id, chartVersionId: profile.currentVersion.id }
}

async function createResidenceReference(pool: Pool, principalId: string): Promise<{ residenceProfileId: string; residenceVersionId: string; snapshot: ResidenceSnapshot }> {
  const profile = await new PostgresResidenceRepository(pool).createProfile(principalId, residenceSnapshot())
  return {
    residenceProfileId: profile.id,
    residenceVersionId: profile.currentVersion.id,
    snapshot: profile.currentVersion.snapshot,
  }
}

function reportRecord(
  ids: { principalId: string; chartProfileId: string; chartVersionId: string },
  overrides: Partial<ReportRecord> = {},
): ReportRecord {
  return {
    id: randomUUID(),
    principalId: ids.principalId,
    status: 'queued',
    createdAt: '2026-09-01T00:00:00.000Z',
    submission: {
      visionConsent: true,
      calculationInput: birthInput(),
      birth: birthInput(),
      residence: { facing: 'south', layoutNote: '客厅连接阳台' },
      photos: [{ fileId: 'report-photo.jpg', room: 'living-room', facing: 'south' }],
    },
    bazi: baziChart(),
    chartProfileId: ids.chartProfileId,
    chartVersionId: ids.chartVersionId,
    ...overrides,
  }
}

function provenance(): ReportGenerationProvenance {
  return {
    schemaVersion: 'report-generation-provenance-v1',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    baseUrlLabel: 'api.deepseek.com',
    harnessProfile: 'fengshui-report',
    patchSha256: '1'.repeat(64),
    plugin: { id: 'fengshui-report-plugin', version: '0.0.1', sha256: '2'.repeat(64) },
    skill: { name: 'fengshui-report', version: '0.0.1', sha256: '3'.repeat(64) },
    promptSchemaVersion: 'fengshui-report-prompt-v1',
    promptSha256: '4'.repeat(64),
    validatorVersion: 'report-validator-v1',
    validatorResult: 'pass',
    generatedAt: '2026-09-01T00:01:00.000Z',
    inputSha256: '5'.repeat(64),
    reportSha256: '6'.repeat(64),
  }
}

afterEach(async () => {
  if (!connectionString) return
  while (ownedSchemas.length) {
    const schema = ownedSchemas.pop()
    if (!schema?.startsWith('report_it_')) continue
    const admin = new Pool({ connectionString })
    try {
      await admin.query(`drop schema if exists ${quoteIdentifier(schema)} cascade`)
    } finally {
      await admin.end()
    }
  }
})

describeWithDatabase('PostgresReportRepository integration', () => {
  it('saves a queued report and reads back its chart and owner identifiers from JSON payload', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ids = await createChartReference(pool)
      const queued = reportRecord(ids)

      await repository.save(queued)

      expect(await repository.get(queued.id)).toMatchObject({
        id: queued.id,
        status: 'queued',
        principalId: ids.principalId,
        chartProfileId: ids.chartProfileId,
        chartVersionId: ids.chartVersionId,
      })
    } finally {
      await repository.close()
    }
  })

  it('persists residence profile and version identifiers for report history filters', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ids = await createChartReference(pool)
      const residence = await createResidenceReference(pool, ids.principalId)
      const queued = reportRecord(ids, {
        residenceProfileId: residence.residenceProfileId,
        residenceVersionId: residence.residenceVersionId,
        submission: {
          visionConsent: true,
          calculationInput: birthInput(),
          birth: birthInput(),
          residence: residence.snapshot,
          residenceProfileId: residence.residenceProfileId,
          residenceVersionId: residence.residenceVersionId,
          photos: [{ fileId: 'residence-bound-report-photo.jpg', room: 'overview', facing: 'south' }],
        },
      })

      await repository.save(queued)

      expect(await repository.get(queued.id)).toMatchObject({
        id: queued.id,
        residenceProfileId: residence.residenceProfileId,
        residenceVersionId: residence.residenceVersionId,
        submission: {
          residenceProfileId: residence.residenceProfileId,
          residenceVersionId: residence.residenceVersionId,
          residence: residence.snapshot,
        },
      })
      expect((await repository.listByPrincipal(ids.principalId)).map((item) => ({
        id: item.id,
        residenceProfileId: item.residenceProfileId,
        residenceVersionId: item.residenceVersionId,
      }))).toEqual([{
        id: queued.id,
        residenceProfileId: residence.residenceProfileId,
        residenceVersionId: residence.residenceVersionId,
      }])
    } finally {
      await repository.close()
    }
  })

  it('lists only queued reports in created-at order', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ids = await createChartReference(pool)
      const laterQueued = reportRecord(ids, { createdAt: '2026-09-01T00:02:00.000Z' })
      const completed = reportRecord(ids, { status: 'completed', createdAt: '2026-09-01T00:01:00.000Z', report: '已完成报告' })
      const earlierQueued = reportRecord(ids, { createdAt: '2026-09-01T00:00:00.000Z' })

      await repository.save(laterQueued)
      await repository.save(completed)
      await repository.save(earlierQueued)

      expect((await repository.listQueued()).map((item) => item.id)).toEqual([earlierQueued.id, laterQueued.id])
    } finally {
      await repository.close()
    }
  })

  it('lists one principal reports newest first without ownerless or other-principal records', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ownerIds = await createChartReference(pool)
      const otherIds = await createChartReference(pool)
      const older = reportRecord(ownerIds, { createdAt: '2026-09-01T00:00:00.000Z' })
      const ownerless = reportRecord(ownerIds, { principalId: undefined, createdAt: '2026-09-01T00:01:00.000Z' })
      const other = reportRecord(otherIds, { createdAt: '2026-09-01T00:02:00.000Z' })
      const newer = reportRecord(ownerIds, { createdAt: '2026-09-01T00:03:00.000Z', status: 'completed', report: '最新报告' })

      await repository.save(older)
      await repository.save(ownerless)
      await repository.save(other)
      await repository.save(newer)

      expect((await repository.listByPrincipal(ownerIds.principalId)).map((item) => item.id)).toEqual([newer.id, older.id])
      expect(await repository.listByPrincipal('00000000-0000-4000-8000-000000000000')).toEqual([])
    } finally {
      await repository.close()
    }
  })

  it('reads one report only when the requested principal owns it', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ownerIds = await createChartReference(pool)
      const otherIds = await createChartReference(pool)
      const ownerReport = reportRecord(ownerIds)
      const otherReport = reportRecord(otherIds)

      await repository.save(ownerReport)
      await repository.save(otherReport)

      expect(await repository.getOwned(ownerReport.id, ownerIds.principalId)).toMatchObject({
        id: ownerReport.id,
        principalId: ownerIds.principalId,
      })
      expect(await repository.getOwned(ownerReport.id, otherIds.principalId)).toBeUndefined()
      expect(await repository.getOwned('00000000-0000-4000-8000-000000000000', ownerIds.principalId)).toBeUndefined()
    } finally {
      await repository.close()
    }
  })

  it('updates a queued report to completed with citations and generation provenance intact', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ids = await createChartReference(pool)
      const queued = reportRecord(ids)
      const completed: ReportRecord = {
        ...queued,
        status: 'completed',
        report: '有依据的文化型报告',
        citations: [{
          id: 'source-1',
          version: 2,
          versionId: 'source-1:v2:0123456789abcdef',
          contentHash: '7'.repeat(64),
          title: '客厅采光资料',
          sourceLabel: '专家库',
          excerpt: '保持自然采光。',
        }],
        generationProvenance: provenance(),
      }

      await repository.save(queued)
      await repository.save(completed)

      expect(await repository.get(queued.id)).toMatchObject({
        status: 'completed',
        report: completed.report,
        citations: completed.citations,
        generationProvenance: completed.generationProvenance,
      })
      expect(await repository.listQueued()).toEqual([])
    } finally {
      await repository.close()
    }
  })

  it('persists report phase updates in the JSON payload and queued index', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ids = await createChartReference(pool)
      const queued = reportRecord(ids, { phase: 'queued' })
      const harness = { ...queued, phase: 'harness-generating' as const }
      const completed = { ...queued, status: 'completed' as const, phase: 'completed' as const, report: '阶段完成报告' }

      await repository.save(queued)
      await repository.save(harness)
      expect(await repository.get(queued.id)).toMatchObject({ status: 'queued', phase: 'harness-generating' })
      expect((await repository.listQueued()).map((item) => item.id)).toEqual([queued.id])

      await repository.save(completed)
      expect(await repository.get(queued.id)).toMatchObject({ status: 'completed', phase: 'completed', report: completed.report })
      expect(await repository.listQueued()).toEqual([])
    } finally {
      await repository.close()
    }
  })

  it('claims one queued report atomically and leaves duplicate workers empty-handed', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ids = await createChartReference(pool)
      const queued = reportRecord(ids, { phase: 'queued' })
      await repository.save(queued)

      const claims = await Promise.all([
        repository.claimReport(queued.id, {
          workerId: 'worker-a',
          now: '2026-09-01T00:00:00.000Z',
          leaseExpiresAt: '2026-09-01T00:15:00.000Z',
        }),
        repository.claimReport(queued.id, {
          workerId: 'worker-b',
          now: '2026-09-01T00:00:00.000Z',
          leaseExpiresAt: '2026-09-01T00:15:00.000Z',
        }),
      ])

      expect(claims.filter(Boolean)).toHaveLength(1)
      expect(await repository.get(queued.id)).toMatchObject({
        status: 'running',
        runLease: { attempt: 1 },
      })
      expect(await repository.listQueued()).toEqual([])
    } finally {
      await repository.close()
    }
  })

  it('reclaims expired running reports but skips active leases', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ids = await createChartReference(pool)
      const active = reportRecord(ids, {
        id: randomUUID(),
        status: 'running',
        runLease: {
          workerId: 'worker-active',
          leasedAt: '2026-09-01T00:00:00.000Z',
          expiresAt: '2026-09-01T00:15:00.000Z',
          attempt: 1,
        },
      })
      const expired = reportRecord(ids, {
        id: randomUUID(),
        status: 'running',
        createdAt: '2026-09-01T00:01:00.000Z',
        phase: 'harness-generating',
        runLease: {
          workerId: 'dead-worker',
          leasedAt: '2026-09-01T00:00:00.000Z',
          expiresAt: '2026-09-01T00:05:00.000Z',
          attempt: 2,
        },
      })
      await repository.save(active)
      await repository.save(expired)

      const claimed = await repository.claimNextReport({
        workerId: 'worker-b',
        now: '2026-09-01T00:06:00.000Z',
        leaseExpiresAt: '2026-09-01T00:21:00.000Z',
      })

      expect(claimed).toMatchObject({
        id: expired.id,
        status: 'running',
        phase: 'harness-generating',
        runLease: { workerId: 'worker-b', attempt: 3 },
      })
      await expect(repository.claimNextReport({
        workerId: 'worker-c',
        now: '2026-09-01T00:06:00.000Z',
        leaseExpiresAt: '2026-09-01T00:21:00.000Z',
      })).resolves.toBeUndefined()
    } finally {
      await repository.close()
    }
  })

  it('releases a report lease only for the owning worker', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ids = await createChartReference(pool)
      const queued = reportRecord(ids)
      await repository.save(queued)
      const claimed = await repository.claimReport(queued.id, {
        workerId: 'worker-a',
        now: '2026-09-01T00:00:00.000Z',
        leaseExpiresAt: '2026-09-01T00:15:00.000Z',
      })
      expect(claimed?.runLease).toBeDefined()

      await repository.releaseReportLease(queued.id, 'worker-b')
      expect((await repository.get(queued.id))?.runLease).toBeDefined()
      await repository.releaseReportLease(queued.id, 'worker-a')
      expect((await repository.get(queued.id))?.runLease).toBeUndefined()
    } finally {
      await repository.close()
    }
  })

  it('rejects stale claimed saves after an expired lease is reclaimed', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ids = await createChartReference(pool)
      const queued = reportRecord(ids)
      await repository.save(queued)
      const workerA = await repository.claimReport(queued.id, {
        workerId: 'worker-a',
        now: '2026-09-01T00:00:00.000Z',
        leaseExpiresAt: '2026-09-01T00:05:00.000Z',
      })
      const workerB = await repository.claimReport(queued.id, {
        workerId: 'worker-b',
        now: '2026-09-01T00:06:00.000Z',
        leaseExpiresAt: '2026-09-01T00:21:00.000Z',
      })
      expect(workerA).toMatchObject({ runLease: { workerId: 'worker-a', attempt: 1 } })
      expect(workerB).toMatchObject({ runLease: { workerId: 'worker-b', attempt: 2 } })

      await expect(repository.saveClaimed(
        { ...workerA!, status: 'completed', phase: 'completed', report: 'worker-a stale result', runLease: undefined },
        { workerId: 'worker-a', attempt: 1 },
      )).rejects.toBeInstanceOf(LostReportLeaseError)
      expect(await repository.get(queued.id)).toMatchObject({ status: 'running', runLease: { workerId: 'worker-b', attempt: 2 } })

      await repository.saveClaimed(
        { ...workerB!, status: 'completed', phase: 'completed', report: 'worker-b final result', runLease: undefined },
        { workerId: 'worker-b', attempt: 2 },
      )
      expect(await repository.get(queued.id)).toMatchObject({
        status: 'completed',
        report: 'worker-b final result',
      })
      expect((await repository.get(queued.id))?.runLease).toBeUndefined()
    } finally {
      await repository.close()
    }
  })

  it('persists a failed report status and keeps it out of queued recovery', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ids = await createChartReference(pool)
      const failed = reportRecord(ids, { status: 'failed', error: 'Vision or Harness report generation failed' })

      await repository.save(failed)

      expect(await repository.get(failed.id)).toMatchObject({ status: 'failed', error: failed.error })
      expect(await repository.listQueued()).toEqual([])
    } finally {
      await repository.close()
    }
  })

  it('preserves every distinct report saved concurrently', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ids = await createChartReference(pool)
      const first = reportRecord(ids, { createdAt: '2026-09-01T00:00:00.000Z' })
      const second = reportRecord(ids, { createdAt: '2026-09-01T00:01:00.000Z' })

      await Promise.all([repository.save(first), repository.save(second)])

      expect((await repository.listQueued()).map((item) => item.id)).toEqual([first.id, second.id])
    } finally {
      await repository.close()
    }
  })

  it('keeps one complete payload when concurrent saves target the same report id', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ids = await createChartReference(pool)
      const queued = reportRecord(ids)
      const completed = { ...queued, status: 'completed' as const, report: '并发完成报告', citations: [] }
      const failed = { ...queued, status: 'failed' as const, error: '并发失败报告' }

      await Promise.all([repository.save(completed), repository.save(failed)])

      const stored = await repository.get(queued.id)
      expect(stored).toBeDefined()
      expect([completed, failed]).toContainEqual(stored)
      expect((await pool.query('select count(*)::int as count from reports where id = $1', [queued.id])).rows[0]?.count).toBe(1)
    } finally {
      await repository.close()
    }
  })

  it('archives and restores a terminal owner report while separating active and archived lists', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ids = await createChartReference(pool)
      const completed = reportRecord(ids, {
        status: 'completed',
        report: '已完成报告',
        runLease: {
          workerId: 'quality-worker',
          leasedAt: '2026-09-01T00:00:00.000Z',
          expiresAt: '2026-09-01T00:15:00.000Z',
          attempt: 1,
        },
        shareAccess: {
          tokenHash: 'a'.repeat(64),
          createdAt: '2026-09-01T00:01:00.000Z',
          expiresAt: '2026-09-08T00:01:00.000Z',
        },
      })
      await repository.save(completed)

      const archivedAt = '2026-09-02T03:04:05.000Z'
      await expect(repository.archiveOwned(completed.id, ids.principalId, archivedAt)).resolves.toMatchObject({
        id: completed.id,
        archivedAt,
      })
      const archived = await repository.get(completed.id)
      expect(archived).not.toHaveProperty('shareAccess')
      expect(archived).not.toHaveProperty('runLease')
      expect(await repository.listByPrincipal(ids.principalId)).toEqual([])
      expect((await repository.listByPrincipal(ids.principalId, true)).map((item) => item.id)).toEqual([completed.id])

      await expect(repository.restoreOwned(completed.id, ids.principalId)).resolves.not.toHaveProperty('archivedAt')
      expect((await repository.listByPrincipal(ids.principalId)).map((item) => item.id)).toEqual([completed.id])
      expect(await repository.listByPrincipal(ids.principalId, true)).toEqual([])
    } finally {
      await repository.close()
    }
  })

  it('rejects archive state conflicts without revealing reports owned by another principal', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ownerIds = await createChartReference(pool)
      const otherIds = await createChartReference(pool)
      const queued = reportRecord(ownerIds)
      await repository.save(queued)

      await expect(repository.archiveOwned(queued.id, ownerIds.principalId, '2026-09-02T00:00:00.000Z'))
        .rejects.toBeInstanceOf(ReportArchiveConflictError)
      await expect(repository.archiveOwned(queued.id, otherIds.principalId, '2026-09-02T00:00:00.000Z'))
        .resolves.toBeUndefined()
      await expect(repository.restoreOwned(queued.id, ownerIds.principalId)).resolves.toBeUndefined()
      await expect(repository.restoreOwned(queued.id, otherIds.principalId)).resolves.toBeUndefined()
    } finally {
      await repository.close()
    }
  })

  it('allows exactly one concurrent archive and one concurrent restore operation to change state', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ids = await createChartReference(pool)
      const completed = reportRecord(ids, { status: 'completed', report: '并发归档报告' })
      await repository.save(completed)

      const archiveResults = await Promise.allSettled([
        repository.archiveOwned(completed.id, ids.principalId, '2026-09-02T00:00:00.000Z'),
        repository.archiveOwned(completed.id, ids.principalId, '2026-09-02T00:00:01.000Z'),
      ])
      expect(archiveResults.every((result) => result.status === 'fulfilled')).toBe(true)
      expect(archiveResults.filter((result) => result.status === 'fulfilled' && result.value)).toHaveLength(1)
      expect(archiveResults.filter((result) => result.status === 'fulfilled' && !result.value)).toHaveLength(1)

      const restoreResults = await Promise.allSettled([
        repository.restoreOwned(completed.id, ids.principalId),
        repository.restoreOwned(completed.id, ids.principalId),
      ])
      expect(restoreResults.every((result) => result.status === 'fulfilled')).toBe(true)
      expect(restoreResults.filter((result) => result.status === 'fulfilled' && result.value)).toHaveLength(1)
      expect(restoreResults.filter((result) => result.status === 'fulfilled' && !result.value)).toHaveLength(1)
    } finally {
      await repository.close()
    }
  })

  it('persists report lineage columns and never claims an archived record', async () => {
    const pool = await createMigratedPool()
    const repository = new PostgresReportRepository(pool)
    try {
      const ids = await createChartReference(pool)
      const source = reportRecord(ids, { status: 'completed', report: '原始报告' })
      const archivedQueued = reportRecord(ids, {
        sourceReportId: source.id,
        archivedAt: '2026-09-02T00:00:00.000Z',
      })
      await repository.save(source)
      await repository.save(archivedQueued)

      const row = await pool.query<{ archived_at: Date; source_report_id: string }>(
        'select archived_at, source_report_id from reports where id = $1',
        [archivedQueued.id],
      )
      expect(row.rows[0]?.archived_at.toISOString()).toBe(archivedQueued.archivedAt)
      expect(row.rows[0]?.source_report_id).toBe(source.id)
      await expect(repository.claimReport(archivedQueued.id, {
        workerId: 'worker-a',
        now: '2026-09-02T00:00:00.000Z',
        leaseExpiresAt: '2026-09-02T00:15:00.000Z',
      })).resolves.toBeUndefined()
      await expect(repository.claimNextReport({
        workerId: 'worker-b',
        now: '2026-09-02T00:00:00.000Z',
        leaseExpiresAt: '2026-09-02T00:15:00.000Z',
      })).resolves.toBeUndefined()
    } finally {
      await repository.close()
    }
  })
})
