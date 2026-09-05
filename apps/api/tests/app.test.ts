import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BaziRuleProfileDefinition, PersonHouseCompatibilityAssessment, ReportGenerationProvenance, ReportPhase, ReportPipelineCheckpoint, ReportQualityReview, ReportRecord, ReportStageTiming, VisionObservation } from '@fengshui/domain'
import { CALENDAR_RULE_VERSION, calculateBazi, calculateBaziFlow } from '@fengshui/bazi-engine'
import { buildApp } from '../src/app.js'
import { demoKnowledgeAssets } from '../src/demo-knowledge.js'
import { ensureDemoBaziRuleProfile } from '../src/demo-rule-profile.js'
import { ChartRepository } from '../src/charts.js'
import { MediaStore } from '../src/media.js'
import { KnowledgeRepository } from '../src/knowledge.js'
import { LostReportLeaseError, ReportRepository } from '../src/repository.js'
import { ResidenceRepository } from '../src/residences.js'
import { BaziRuleProfileRepository } from '../src/rule-profiles.js'
import { FileWenzhenEvidenceStore } from '../src/wenzhen-evidence-store.js'
import { runReportQualityWorkflow, type ReportDraft, type ReportQualityReviewer, type ReportQualityWorkflowProgress, type ReportReviser } from '../src/report-quality.js'
import { ChartPdfUnavailableError, type ChartPdfRenderer } from '../src/chart-pdf.js'
import { ReportPdfUnavailableError, type ReportPdfRenderer } from '../src/report-pdf.js'
import { REPORT_VALIDATOR_VERSION } from '../src/report-validator.js'

class TestMediaStore extends MediaStore {
  override async exists(): Promise<boolean> { return true }
  override async claim(): Promise<void> {}
  override async releaseClaim(): Promise<void> {}
  override async removeClaimed(_fileId: string, _principalId: string, _reportId: string): Promise<void> {}
}

class TrackingMediaStore extends TestMediaStore {
  readonly removed: string[] = []
  readonly removedClaimed: string[] = []
  override async remove(fileId: string): Promise<void> { this.removed.push(fileId) }
  override async removeClaimed(fileId: string): Promise<void> { this.removedClaimed.push(fileId) }
}

const expectedDemoPublishedExpertKnowledge = demoKnowledgeAssets.filter((asset) => asset.kind !== 'rule').length
const expectedDemoPublishedRules = demoKnowledgeAssets.filter((asset) => asset.kind === 'rule').length

class RecordingReportRepository extends ReportRepository {
  readonly savedStatuses: ReportRecord['status'][] = []
  readonly savedPhases: ReportPhase[] = []
  private recordSave(record: ReportRecord): void {
    this.savedStatuses.push(record.status)
    if (record.phase && this.savedPhases.at(-1) !== record.phase) {
      this.savedPhases.push(record.phase)
    }
  }
  override async save(record: ReportRecord): Promise<void> {
    this.recordSave(record)
    await super.save(record)
  }
  override async saveClaimed(record: ReportRecord, fence: Parameters<ReportRepository['saveClaimed']>[1]): Promise<void> {
    this.recordSave(record)
    await super.saveClaimed(record, fence)
  }
}

class SearchFailureKnowledgeRepository extends KnowledgeRepository {
  override async search(): Promise<never> { throw new Error('simulated knowledge search failure') }
}

class TestWenzhenEvidenceStore extends FileWenzhenEvidenceStore {
  override async verify(evidenceRef: string) {
    if (!evidenceRef) throw new Error('WenZhen evidence does not exist')
    return { evidenceRef, sha256: '0'.repeat(64), mimeType: 'image/png' as const, size: 1 }
  }
}

const persistableBirth = (time = '09:30') => ({ date: '1992-08-18', time, placeCode: '330106' })
const dynamicWenzhenBirth = {
  calendarSystem: 'solar' as const,
  date: '1992-08-21',
  time: '12:03',
  locationName: '浙江省 杭州市 西湖区',
  longitude: 120.1302,
  latitude: 30.2595,
  timezone: 'Asia/Shanghai',
  useTrueSolarTime: true,
  dstPolicy: 'auto' as const,
  dayBoundary: 'midnight' as const,
  luckMethod: 'sect1' as const,
  gender: 'male' as const,
}
const dynamicWenzhenFlowQuery = { targetDate: '2026-09-01', targetTime: '15:30' }
const baselineWenzhenSampleIds = [
  'wz-020-professional-table',
  'wz-021-lichun-boundary-before',
  'wz-022-late-zi-day-boundary',
  'wz-023-urumqi-dst-ignore',
  'wz-024-lunar-leap-fourth-month',
  'wz-025-dynamic-year-month-public',
]
const baselineWenzhenTimeAndProfessionalCount = 5
const baselineWenzhenDynamicCount = 1
const baziRuleProfileDefinition: BaziRuleProfileDefinition = {
  timeDefaults: {
    timezone: 'Asia/Shanghai',
    dstPolicy: 'auto',
    useTrueSolarTime: true,
    dayBoundary: 'zi-hour-start',
    luckMethod: 'sect1',
  },
  assessments: {
    strength: { enabled: true, method: 'weighted-seasonal-v1', ruleSetVersion: '1.0.0' },
    pattern: { enabled: true, method: 'school-pattern-v1', ruleSetVersion: '1.0.0' },
    shenSha: { enabled: false, method: 'disabled', ruleSetVersion: '1.0.0' },
  },
}
const createBaziRuleProfilePayload = {
  key: 'demo-school',
  name: '演示流派',
  description: '用于测试的规则档案',
  workingDefinition: baziRuleProfileDefinition,
}
const reviseBaziRuleProfilePayload = (expectedRevision: unknown) => ({
  name: '演示流派第二版',
  description: '修订后的规则档案',
  workingDefinition: baziRuleProfileDefinition,
  expectedRevision,
})

const generationProvenance = (validatorResult: ReportGenerationProvenance['validatorResult'] = 'pass'): ReportGenerationProvenance => ({
  schemaVersion: 'report-generation-provenance-v1',
  provider: 'deepseek-official',
  model: 'deepseek-chat',
  baseUrlLabel: 'api.deepseek.com',
  harnessProfile: 'headless',
  patchSha256: '1'.repeat(64),
  plugin: { id: '@fengshui-report/dsh-fengshui-report', version: '0.0.1', sha256: '2'.repeat(64) },
  skill: { name: 'fengshui-report', version: `sha256:${'3'.repeat(64)}`, sha256: '3'.repeat(64) },
  promptSchemaVersion: 'fengshui-report-prompt-v1',
  promptSha256: '4'.repeat(64),
  validatorVersion: REPORT_VALIDATOR_VERSION,
  validatorResult,
  generatedAt: '2026-09-01T00:00:00.000Z',
  inputSha256: '5'.repeat(64),
  ...(validatorResult === 'pass' ? { reportSha256: '6'.repeat(64) } : {}),
})

const qualityReview = (
  verdict: ReportQualityReview['verdict'],
  attempt: number,
  options: Partial<Pick<ReportQualityReview, 'score' | 'issues'>> = {},
): ReportQualityReview => ({
  schemaVersion: 'report-quality-review-v1',
  verdict,
  score: options.score ?? (verdict === 'pass' ? 96 : 61),
  issues: options.issues ?? (verdict === 'pass' ? [] : [{
    code: 'missing-person-house-fit',
    severity: 'high',
    section: '人宅合拍结论',
    message: '报告没有明确说明命盘和住宅是否合拍',
  }]),
  reviewedAt: new Date().toISOString(),
  attempt,
})

const expectCompletedTiming = (timing: ReportStageTiming | undefined, phase: ReportStageTiming['phase']) => {
  expect(timing).toMatchObject({
    phase,
    outcome: 'completed',
    startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
    completedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
    durationMs: expect.any(Number),
  })
  expect(timing?.durationMs).toBeGreaterThanOrEqual(0)
}

const expectFailedTiming = (timing: ReportStageTiming | undefined, phase: ReportStageTiming['phase']) => {
  expect(timing).toMatchObject({
    phase,
    outcome: 'failed',
    startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
    completedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
    durationMs: expect.any(Number),
  })
  expect(timing?.durationMs).toBeGreaterThanOrEqual(0)
}

async function testApp(report = '测试报告', options: {
  wenzhenRuntimeFixturePath?: string
  chartPdfRenderer?: ChartPdfRenderer
  reportPdfRenderer?: ReportPdfRenderer
  reportGenerationProvenance?: ReportGenerationProvenance
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'fengshui-api-'))
  return buildApp(
    new ReportRepository(join(directory, 'reports.json')),
    new TestMediaStore(join(directory, 'uploads')),
    new KnowledgeRepository(join(directory, 'knowledge.json')),
    async () => ({ report, generationProvenance: options.reportGenerationProvenance }),
    { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '测试可见空间', observedElements: ['自然采光'], uncertainties: ['画面外区域'] })) },
    new ChartRepository(join(directory, 'charts.json')),
    new BaziRuleProfileRepository(join(directory, 'bazi-rule-profiles.json')),
    options.wenzhenRuntimeFixturePath ?? join(directory, 'wenzhen-fixtures.json'),
    new TestWenzhenEvidenceStore(join(directory, 'wenzhen-evidence')),
    undefined,
    undefined,
    undefined,
    options.chartPdfRenderer,
    options.reportPdfRenderer,
    new ResidenceRepository(join(directory, 'residences.json')),
  )
}

type TestApp = Awaited<ReturnType<typeof testApp>>
type TestCycleQuery = { targetDate: string; targetTime?: string }
type TestCycleRow = { year?: number; month?: number; date?: string; startHour?: number; pillar: string; earthlyBranch?: string }

async function dynamicWenzhenExpected(app: TestApp, birth: object, flowQuery: TestCycleQuery) {
  const chart = await app.inject({ method: 'POST', url: '/v1/bazi', payload: birth })
  const flow = await app.inject({ method: 'POST', url: '/v1/bazi/flow', payload: { birth, query: flowQuery } })
  expect(chart.statusCode).toBe(200)
  expect(flow.statusCode).toBe(200)
  const chartBody = chart.json()
  const flowBody = flow.json()
  const selection = flowBody.flow.selection as { year: number; monthYear: number; month: number; date: string; hourSlotStart: number }
  const annual = (flowBody.flow.annualCycles as TestCycleRow[]).find((cycle) => cycle.year === selection.year)!
  const monthly = (flowBody.flow.monthlyCycles as TestCycleRow[]).find((cycle) => cycle.year === selection.monthYear && cycle.month === selection.month)!
  const daily = (flowBody.flow.dailyCycles as TestCycleRow[]).find((cycle) => cycle.date === selection.date)!
  const hourly = (flowBody.flow.hourlyCycles as TestCycleRow[]).find((cycle) => cycle.startHour === selection.hourSlotStart)!
  return {
    expected: {
      pillars: chartBody.bazi.pillars,
      annualCycles: [{ year: selection.year, pillar: annual.pillar }],
      monthlyCycles: [{ year: selection.monthYear, month: selection.month, pillar: monthly.pillar }],
      dailyCycles: [{ date: selection.date, pillar: daily.pillar }],
      hourlyCycles: [{ startHour: selection.hourSlotStart, earthlyBranch: hourly.earthlyBranch, pillar: hourly.pillar }],
    },
    selection,
    hourlyPillar: hourly.pillar,
  }
}

afterEach(() => vi.unstubAllEnvs())

const demoKnowledgeHeaders = {
  authorization: 'Bearer test-admin-token',
}

function stubDemoKnowledgeActors() {
  vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
  vi.stubEnv('ADMIN_ACTOR_ID', 'knowledge-editor')
}

async function seedDemoKnowledgeForReportReadiness(app: TestApp) {
  for (const asset of demoKnowledgeAssets) {
    const created = await app.inject({ method: 'POST', url: '/v1/knowledge', headers: demoKnowledgeHeaders, payload: asset })
    expect(created.statusCode).toBe(201)
    const published = await app.inject({ method: 'POST', url: `/v1/knowledge/${created.json().id}/state`, headers: demoKnowledgeHeaders, payload: { state: 'published' } })
    expect(published.statusCode).toBe(200)
  }
}

const reportPayload = (fileId = 'quality-photo.jpg') => ({
  visionConsent: true,
  birth: persistableBirth(),
  residence: { facing: 'south' as const, layoutNote: '客厅连接阳台' },
  photos: [{ fileId, room: 'living-room' as const, facing: 'south' as const }],
})

const testBirth = { date: '1992-08-18', time: '09:30', locationName: '杭州市', longitude: 120.1551 }
const testVision = (fileId = 'resume-photo.jpg', summary = '已持久化视觉结果'): VisionObservation[] => [
  { fileId, room: 'living-room', summary, observedElements: [], uncertainties: [] },
]
const testCompatibility = (): PersonHouseCompatibilityAssessment => ({
  assessable: false,
  overallLevel: 'insufficient-evidence',
  confidence: 'low',
  positiveMatches: [],
  conflicts: [],
  neutralOrUnknown: ['测试记录没有足够可评估事实。'],
  criticalMissingFacts: [],
})
const checkpoint = (partial: Omit<Partial<ReportPipelineCheckpoint>, 'schemaVersion'>): ReportPipelineCheckpoint => ({
  schemaVersion: 'report-pipeline-checkpoint-v1',
  ...partial,
})
const completedAt = '2026-09-01T00:00:00.000Z'
const queuedReportRecord = (overrides: Partial<ReportRecord> = {}): ReportRecord => ({
  id: `queued-${crypto.randomUUID()}`,
  status: 'queued',
  phase: 'queued',
  createdAt: new Date().toISOString(),
  submission: {
    visionConsent: true,
    calculationInput: testBirth,
    birth: testBirth,
    residence: { facing: 'south' },
    photos: [{ fileId: 'resume-photo.jpg', room: 'living-room', facing: 'south' }],
  },
  bazi: calculateBazi(testBirth),
  ...overrides,
})

async function createShareableReportFixture(
  reportText = '人宅合拍正式报告',
): Promise<{ app: ReturnType<typeof buildApp>; repository: ReportRepository; reportId: string; ownerCookie: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'fengshui-share-report-'))
  const repository = new ReportRepository(join(directory, 'reports.json'))
  const app = buildApp(
    repository,
    new TestMediaStore(join(directory, 'uploads')),
    new KnowledgeRepository(join(directory, 'knowledge.json')),
    async () => ({ report: reportText, generationProvenance: generationProvenance('pass') }),
    { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '分享测试空间', observedElements: [], uncertainties: [] })) },
    new ChartRepository(join(directory, 'charts.json')),
  )
  const created = await app.inject({ method: 'POST', url: '/v1/reports', payload: reportPayload(`share-${crypto.randomUUID()}.jpg`) })
  expect(created.statusCode).toBe(202)
  const reportId = created.json().id as string
  const ownerCookie = String(created.headers['set-cookie']).split(';')[0]
  await vi.waitFor(async () => expect(await repository.get(reportId)).toMatchObject({
    status: 'completed',
    generationProvenance: { validatorResult: 'pass' },
    qualityReviews: [{ verdict: 'pass' }],
    report: reportText,
  }))
  return { app, repository, reportId, ownerCookie }
}

const pngUploadPayload = (boundary: string, filename = 'room.png') => Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00]),
  Buffer.from(`\r\n--${boundary}--\r\n`),
])

describe('report readiness', () => {
  it('reports ready when model, knowledge bridge and Harness artifacts are configured', async () => {
    stubDemoKnowledgeActors()
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    vi.stubEnv('KNOWLEDGE_MCP_TOKEN', 'test-knowledge-token')
    const app = await testApp()
    await seedDemoKnowledgeForReportReadiness(app)
    const response = await app.inject({ method: 'GET', url: '/ready/report' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'ready',
      service: 'fengshui-api',
      checks: { deepseekApiKey: true, knowledgeMcpToken: true, publishedExpertKnowledge: true, publishedRules: true, harnessArtifacts: true },
      knowledge: { publishedExpertKnowledge: expectedDemoPublishedExpertKnowledge, publishedRules: expectedDemoPublishedRules },
      reasons: [],
    })
    expect(response.body).not.toContain('test-deepseek-key')
    expect(response.body).not.toContain('test-knowledge-token')
    await app.close()
  })

  it('fails report readiness without exposing the missing DeepSeek key value', async () => {
    stubDemoKnowledgeActors()
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    vi.stubEnv('KNOWLEDGE_MCP_TOKEN', 'test-knowledge-token')
    const app = await testApp()
    await seedDemoKnowledgeForReportReadiness(app)
    const response = await app.inject({ method: 'GET', url: '/ready/report' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      status: 'not-ready',
      checks: { deepseekApiKey: false, knowledgeMcpToken: true, publishedExpertKnowledge: true, publishedRules: true, harnessArtifacts: true },
      reasons: ['missing_deepseek_api_key'],
    })
    expect(response.body).not.toContain('test-knowledge-token')
    await app.close()
  })

  it('allows local demo report readiness to use the file knowledge store without a knowledge bridge token', async () => {
    stubDemoKnowledgeActors()
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    vi.stubEnv('KNOWLEDGE_MCP_TOKEN', '')
    const app = await testApp()
    await seedDemoKnowledgeForReportReadiness(app)
    const response = await app.inject({ method: 'GET', url: '/ready/report' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      status: 'ready',
      checks: { deepseekApiKey: true, knowledgeMcpToken: true, publishedExpertKnowledge: true, publishedRules: true, harnessArtifacts: true },
      reasons: [],
    })
    expect(response.body).not.toContain('test-deepseek-key')
    await app.close()
  })

  it('requires the knowledge bridge token for production report readiness', async () => {
    stubDemoKnowledgeActors()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    vi.stubEnv('KNOWLEDGE_MCP_TOKEN', '')
    const app = await testApp()
    await seedDemoKnowledgeForReportReadiness(app)
    const response = await app.inject({ method: 'GET', url: '/ready/report' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      status: 'not-ready',
      checks: { deepseekApiKey: true, knowledgeMcpToken: false, publishedExpertKnowledge: true, publishedRules: true, harnessArtifacts: true },
      reasons: ['missing_knowledge_mcp_token'],
    })
    expect(response.body).not.toContain('test-deepseek-key')
    await app.close()
  })

  it('fails report readiness without exposing local artifact paths', async () => {
    stubDemoKnowledgeActors()
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    vi.stubEnv('KNOWLEDGE_MCP_TOKEN', 'test-knowledge-token')
    const missingArtifactRoot = await mkdtemp(join(tmpdir(), 'fengshui-report-ready-missing-artifact-'))
    vi.stubEnv('FENGSHUI_PROJECT_ROOT', missingArtifactRoot)
    const app = await testApp()
    await seedDemoKnowledgeForReportReadiness(app)
    const response = await app.inject({ method: 'GET', url: '/ready/report' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      status: 'not-ready',
      checks: { deepseekApiKey: true, knowledgeMcpToken: true, publishedExpertKnowledge: true, publishedRules: true, harnessArtifacts: false },
      reasons: ['missing_harness_artifact'],
    })
    expect(response.body).not.toContain(missingArtifactRoot)
    expect(response.body).not.toContain('/Users/')
    expect(response.body).not.toContain('test-deepseek-key')
    expect(response.body).not.toContain('test-knowledge-token')
    await app.close()
  })

  it('fails report readiness when published expert sources are missing while treating deterministic rules as an optional enhancement', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    vi.stubEnv('KNOWLEDGE_MCP_TOKEN', 'test-knowledge-token')
    const app = await testApp()
    const response = await app.inject({ method: 'GET', url: '/ready/report' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      status: 'not-ready',
      checks: { deepseekApiKey: true, knowledgeMcpToken: true, publishedExpertKnowledge: false, publishedRules: false, harnessArtifacts: true },
      knowledge: { publishedExpertKnowledge: 0, publishedRules: 0 },
      reasons: ['missing_published_expert_knowledge'],
    })
    expect(response.body).not.toContain('test-deepseek-key')
    expect(response.body).not.toContain('test-knowledge-token')
    await app.close()
  })
})

describe('admin knowledge authorization', () => {
  it('rejects missing and incorrect administrator tokens', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const app = await testApp()
    const missing = await app.inject({ method: 'GET', url: '/v1/knowledge' })
    const incorrect = await app.inject({ method: 'POST', url: '/v1/knowledge', headers: { authorization: 'Bearer wrong-token' }, payload: { kind: 'article', title: '标题', sourceLabel: '来源', body: '正文' } })
    expect(missing.statusCode).toBe(401)
    expect(incorrect.statusCode).toBe(401)
    await app.close()
  })

  it('exposes published knowledge via search after single-admin direct publication', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    vi.stubEnv('ADMIN_ACTOR_ID', 'knowledge-editor')
    const app = await testApp()
    const authorization = { authorization: 'Bearer test-admin-token' }
    const created = await app.inject({ method: 'POST', url: '/v1/knowledge', headers: authorization, payload: { kind: 'article', title: '客厅采光', sourceLabel: '测试专家', body: '客厅采光观察资料', tags: ['客厅'] } })
    expect(created.statusCode).toBe(201)

    const draftSearch = await app.inject({ method: 'GET', url: '/v1/knowledge/search?q=采光' })
    expect(draftSearch.statusCode).toBe(200)
    expect(draftSearch.json()).toEqual([])

    const directPublication = await app.inject({ method: 'POST', url: `/v1/knowledge/${created.json().id}/state`, headers: authorization, payload: { state: 'published' } })
    expect(directPublication.statusCode).toBe(200)
    expect(directPublication.json()).toMatchObject({ submittedForReviewBy: 'knowledge-editor', reviewedBy: 'knowledge-editor:reviewer' })
    const list = await app.inject({ method: 'GET', url: '/v1/knowledge', headers: authorization })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toHaveLength(1)
    const publishedSearch = await app.inject({ method: 'GET', url: '/v1/knowledge/search?q=采光' })
    expect(publishedSearch.statusCode).toBe(200)
    expect(publishedSearch.json()).toHaveLength(1)
    expect(publishedSearch.json()[0]).toMatchObject({ versionId: expect.stringContaining(':v1:'), contentHash: expect.stringMatching(/^[a-f0-9]{64}$/), submittedForReviewBy: 'knowledge-editor', reviewedBy: 'knowledge-editor:reviewer', publishedBy: 'knowledge-editor:reviewer' })
    const limitedSearch = await app.inject({ method: 'GET', url: '/v1/knowledge/search?q=采光&limit=10' })
    expect(limitedSearch.statusCode).toBe(200)
    await app.close()
  })

  it('publishes in-review knowledge from one administrator while keeping distinct audit actors', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    vi.stubEnv('ADMIN_ACTOR_ID', 'knowledge-editor')
    vi.stubEnv('ADMIN_REVIEWER_ACTOR_ID', 'knowledge-reviewer')
    const app = await testApp()
    const authorization = { authorization: 'Bearer test-admin-token' }
    const created = await app.inject({ method: 'POST', url: '/v1/knowledge', headers: authorization, payload: { kind: 'article', title: '玄关纳气', sourceLabel: '测试专家', body: '玄关纳气资料', tags: ['玄关'] } })
    expect(created.statusCode).toBe(201)

    const submitted = await app.inject({ method: 'POST', url: `/v1/knowledge/${created.json().id}/state`, headers: authorization, payload: { state: 'in-review' } })
    expect(submitted.statusCode).toBe(200)

    const published = await app.inject({ method: 'POST', url: `/v1/knowledge/${created.json().id}/state`, headers: authorization, payload: { state: 'published' } })
    expect(published.statusCode).toBe(200)
    expect(published.json()).toMatchObject({
      state: 'published',
      submittedForReviewBy: 'knowledge-editor',
      reviewedBy: 'knowledge-reviewer',
    })
    expect(published.json().submittedForReviewBy).not.toBe(published.json().reviewedBy)
    const versions = await app.inject({ method: 'GET', url: `/v1/knowledge/${created.json().id}/versions`, headers: authorization })
    expect(versions.statusCode).toBe(200)
    expect(versions.json()[0]).toMatchObject({
      submittedForReviewBy: 'knowledge-editor',
      reviewedBy: 'knowledge-reviewer',
      publishedBy: 'knowledge-reviewer',
    })
    await app.close()
  })

  it('protects the knowledge search bridge when an internal reader token is configured', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    vi.stubEnv('KNOWLEDGE_MCP_TOKEN', 'test-reader-token')
    const app = await testApp()
    const unauthorized = await app.inject({ method: 'GET', url: '/v1/knowledge/search?q=采光' })
    expect(unauthorized.statusCode).toBe(401)
    const authorized = await app.inject({
      method: 'GET',
      url: '/v1/knowledge/search?q=采光',
      headers: { authorization: 'Bearer test-reader-token' },
    })
    expect(authorized.statusCode).toBe(200)
    await app.close()
  })

  it('validates knowledge requests without coercing malformed fields and normalizes duplicate tags', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const app = await testApp()
    const headers = { authorization: 'Bearer test-admin-token' }
    const base = { kind: 'article', title: '客厅资料', sourceLabel: '测试专家', body: '有明确来源的资料。', tags: [' 客厅 ', '客厅', '采光'] }
    const created = await app.inject({ method: 'POST', url: '/v1/knowledge', headers, payload: base })
    expect(created.statusCode).toBe(201)
    expect(created.json().tags).toEqual(['客厅', '采光'])

    const invalidPayloads = [
      { ...base, kind: 'video' },
      { ...base, body: '   ' },
      { ...base, body: 'x'.repeat(200_001) },
      { ...base, tags: '客厅' },
      { ...base, tags: [42] },
      { ...base, tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`) },
      { ...base, tags: ['x'.repeat(41)] },
      { ...base, unsupported: true },
    ]
    for (const payload of invalidPayloads) {
      const response = await app.inject({ method: 'POST', url: '/v1/knowledge', headers, payload })
      expect(response.statusCode).toBe(400)
    }
    await app.close()
  })

  it('revises published knowledge with an optimistic lock while preserving the published snapshot', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    vi.stubEnv('ADMIN_ACTOR_ID', 'knowledge-editor')
    const app = await testApp()
    const admin = { authorization: 'Bearer test-admin-token' }
    const created = await app.inject({
      method: 'POST',
      url: '/v1/knowledge',
      headers: admin,
      payload: { kind: 'article', title: '客厅资料', sourceLabel: '测试专家', body: '第一版。', tags: ['客厅'] },
    })
    await app.inject({ method: 'POST', url: `/v1/knowledge/${created.json().id}/state`, headers: admin, payload: { state: 'published' } })
    const versionsBefore = await app.inject({ method: 'GET', url: `/v1/knowledge/${created.json().id}/versions`, headers: admin })
    const immutableVersion = versionsBefore.json()[0]

    const revised = await app.inject({
      method: 'POST',
      url: `/v1/knowledge/${created.json().id}/revisions`,
      headers: admin,
      payload: { kind: 'article', title: '客厅资料', sourceLabel: '测试专家', body: '第二版草稿。', tags: ['客厅'], expectedRevision: 1 },
    })
    expect(revised.statusCode).toBe(201)
    expect(revised.json()).toMatchObject({ version: 2, state: 'draft', body: '第二版草稿。' })
    const versionsAfter = await app.inject({ method: 'GET', url: `/v1/knowledge/${created.json().id}/versions`, headers: admin })
    expect(versionsAfter.json()).toEqual([immutableVersion])

    const conflict = await app.inject({
      method: 'POST',
      url: `/v1/knowledge/${created.json().id}/revisions`,
      headers: admin,
      payload: { kind: 'article', title: '冲突修订', sourceLabel: '测试专家', body: '不应覆盖。', tags: [], expectedRevision: 1 },
    })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json().error).toContain('revision conflict')
    await app.close()
  })
})

describe('admin bazi rule profile revisions', () => {
  it('requires a positive integer expectedRevision on every revision request', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const app = await testApp()
    const headers = { authorization: 'Bearer test-admin-token' }
    const created = await app.inject({
      method: 'POST',
      url: '/v1/bazi-rule-profiles',
      headers,
      payload: createBaziRuleProfilePayload,
    })
    expect(created.statusCode).toBe(201)

    const missingRevision = await app.inject({
      method: 'POST',
      url: `/v1/bazi-rule-profiles/${created.json().id}/revisions`,
      headers,
      payload: {
        name: '缺少版本号',
        workingDefinition: baziRuleProfileDefinition,
      },
    })
    expect(missingRevision.statusCode).toBe(400)
    expect(missingRevision.json()).toEqual({ error: 'expectedRevision must be a positive integer' })

    for (const expectedRevision of [0, -1, 1.5, '1']) {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/bazi-rule-profiles/${created.json().id}/revisions`,
        headers,
        payload: reviseBaziRuleProfilePayload(expectedRevision),
      })
      expect(response.statusCode, `expectedRevision=${String(expectedRevision)}`).toBe(400)
      expect(response.json()).toEqual({ error: 'expectedRevision must be a positive integer' })
    }
    await app.close()
  })

  it('revises a draft with the current revision and rejects stale profile updates', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    vi.stubEnv('ADMIN_ACTOR_ID', 'rule-editor')
    const app = await testApp()
    const headers = { authorization: 'Bearer test-admin-token' }
    const created = await app.inject({
      method: 'POST',
      url: '/v1/bazi-rule-profiles',
      headers,
      payload: createBaziRuleProfilePayload,
    })
    expect(created.statusCode).toBe(201)

    const revised = await app.inject({
      method: 'POST',
      url: `/v1/bazi-rule-profiles/${created.json().id}/revisions`,
      headers,
      payload: reviseBaziRuleProfilePayload(1),
    })
    expect(revised.statusCode).toBe(201)
    expect(revised.json()).toMatchObject({ name: '演示流派第二版', revision: 2, state: 'draft', updatedBy: 'rule-editor' })

    const stale = await app.inject({
      method: 'POST',
      url: `/v1/bazi-rule-profiles/${created.json().id}/revisions`,
      headers,
      payload: reviseBaziRuleProfilePayload(1),
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ error: 'bazi rule profile revision conflict' })
    await app.close()
  })

  it('keeps missing and locked bazi rule profile revision responses stable', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const app = await testApp()
    const headers = { authorization: 'Bearer test-admin-token' }

    const missing = await app.inject({
      method: 'POST',
      url: `/v1/bazi-rule-profiles/${crypto.randomUUID()}/revisions`,
      headers,
      payload: reviseBaziRuleProfilePayload(1),
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toEqual({ error: 'bazi rule profile not found' })

    const created = await app.inject({
      method: 'POST',
      url: '/v1/bazi-rule-profiles',
      headers,
      payload: createBaziRuleProfilePayload,
    })
    await app.inject({
      method: 'POST',
      url: `/v1/bazi-rule-profiles/${created.json().id}/state`,
      headers,
      payload: { state: 'in-review' },
    })
    const locked = await app.inject({
      method: 'POST',
      url: `/v1/bazi-rule-profiles/${created.json().id}/revisions`,
      headers,
      payload: reviseBaziRuleProfilePayload(1),
    })
    expect(locked.statusCode).toBe(409)
    expect(locked.json().error).toContain('invalid bazi rule profile transition')
    await app.close()
  })
})

describe('admin physical deletion', () => {
  it('rejects knowledge deletion without admin credentials', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const app = await testApp()
    const response = await app.inject({ method: 'DELETE', url: `/v1/knowledge/${crypto.randomUUID()}` })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('physically deletes an uncited knowledge asset and its versions', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const app = await testApp()
    const admin = { authorization: 'Bearer test-admin-token' }
    const created = await app.inject({ method: 'POST', url: '/v1/knowledge', headers: admin, payload: { kind: 'article', title: '待删除资料', sourceLabel: '测试', body: '内容', tags: ['测试'] } })
    expect(created.statusCode).toBe(201)
    const id = created.json().id
    const published = await app.inject({ method: 'POST', url: `/v1/knowledge/${id}/state`, headers: admin, payload: { state: 'published' } })
    expect(published.statusCode).toBe(200)
    const del = await app.inject({ method: 'DELETE', url: `/v1/knowledge/${id}`, headers: admin })
    expect(del.statusCode).toBe(204)
    const list = await app.inject({ method: 'GET', url: '/v1/knowledge', headers: admin })
    expect(list.statusCode).toBe(200)
    expect(list.json().map((a: { id: string }) => a.id)).not.toContain(id)
    const versions = await app.inject({ method: 'GET', url: `/v1/knowledge/${id}/versions`, headers: admin })
    expect(versions.statusCode).toBe(200)
    expect(versions.json()).toEqual([])
    await app.close()
  })

  it('returns 404 when deleting an unknown knowledge asset', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const app = await testApp()
    const admin = { authorization: 'Bearer test-admin-token' }
    const response = await app.inject({ method: 'DELETE', url: `/v1/knowledge/${crypto.randomUUID()}`, headers: admin })
    expect(response.statusCode).toBe(404)
    await app.close()
  })

  it('blocks deletion of a knowledge asset cited by a stored report', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    vi.stubEnv('ADMIN_ACTOR_ID', 'knowledge-editor')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-delete-cited-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const knowledge = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      knowledge,
      async () => ({ report: '带依据的测试报告' }),
      { analyze: async (photos) => photos.map((photo) => ({
        fileId: photo.fileId,
        room: photo.room,
        summary: '客厅有自然采光',
        observedElements: ['自然采光'],
        uncertainties: [],
        schemaVersion: 'vision-observation-v2' as const,
        promptVersion: 'residence-facts-v2' as const,
        modelVersion: 'test-vision',
        facts: [{ code: 'daylight.visible' as const, confidence: 0.95, evidence: '画面显示客厅有自然光', scope: 'visible-detail' as const, source: 'vision-model' as const }],
      })) },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const adminHeaders = { authorization: 'Bearer test-admin-token' }
    const xCreated = await app.inject({ method: 'POST', url: '/v1/knowledge', headers: adminHeaders, payload: { kind: 'article', title: '客厅采光与南向阳台观察', sourceLabel: '测试专家', body: '客厅采光充足，南向阳台带来良好自然光线', tags: ['客厅', '采光', '南向'] } })
    expect(xCreated.statusCode).toBe(201)
    const xId = xCreated.json().id
    const xPublished = await app.inject({ method: 'POST', url: `/v1/knowledge/${xId}/state`, headers: adminHeaders, payload: { state: 'published' } })
    expect(xPublished.statusCode).toBe(200)
    const yCreated = await app.inject({ method: 'POST', url: '/v1/knowledge', headers: adminHeaders, payload: { kind: 'article', title: '厨房水路走向', sourceLabel: '测试专家', body: '厨房水槽与管道位置说明', tags: ['厨房'] } })
    expect(yCreated.statusCode).toBe(201)
    const yId = yCreated.json().id
    const yPublished = await app.inject({ method: 'POST', url: `/v1/knowledge/${yId}/state`, headers: adminHeaders, payload: { state: 'published' } })
    expect(yPublished.statusCode).toBe(200)
    const reportResponse = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south', layoutNote: '客厅采光与南向阳台' },
      photos: [{ fileId: 'evidence-photo.jpg', room: 'living-room', facing: 'south', note: '客厅自然采光' }],
    } })
    expect(reportResponse.statusCode).toBe(202)
    const rid = reportResponse.json().id
    await vi.waitFor(async () => expect(await repository.get(rid)).toMatchObject({ status: 'completed' }))
    const stored = await repository.get(rid)
    expect(stored?.citations?.some((c: { id: string }) => c.id === xId)).toBe(true)
    const deleteX = await app.inject({ method: 'DELETE', url: `/v1/knowledge/${xId}`, headers: adminHeaders })
    expect(deleteX.statusCode).toBe(409)
    const deleteY = await app.inject({ method: 'DELETE', url: `/v1/knowledge/${yId}`, headers: adminHeaders })
    expect(deleteY.statusCode).toBe(204)
    await app.close()
  })

  it('physically deletes an unreferenced bazi rule profile', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const app = await testApp()
    const admin = { authorization: 'Bearer test-admin-token' }
    const created = await app.inject({ method: 'POST', url: '/v1/bazi-rule-profiles', headers: admin, payload: createBaziRuleProfilePayload })
    expect(created.statusCode).toBe(201)
    const id = created.json().id
    const published = await app.inject({ method: 'POST', url: `/v1/bazi-rule-profiles/${id}/state`, headers: admin, payload: { state: 'published' } })
    expect(published.statusCode).toBe(200)
    const del = await app.inject({ method: 'DELETE', url: `/v1/bazi-rule-profiles/${id}`, headers: admin })
    expect(del.statusCode).toBe(204)
    const list = await app.inject({ method: 'GET', url: '/v1/bazi-rule-profiles', headers: admin })
    expect(list.statusCode).toBe(200)
    expect(list.json().map((p: { id: string }) => p.id)).not.toContain(id)
    const versions = await app.inject({ method: 'GET', url: `/v1/bazi-rule-profiles/${id}/versions`, headers: admin })
    expect(versions.statusCode).toBe(404)
    await app.close()
  })

  it('returns 404 when deleting an unknown bazi rule profile', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const app = await testApp()
    const admin = { authorization: 'Bearer test-admin-token' }
    const response = await app.inject({ method: 'DELETE', url: `/v1/bazi-rule-profiles/${crypto.randomUUID()}`, headers: admin })
    expect(response.statusCode).toBe(404)
    await app.close()
  })

  it('blocks deletion of a bazi rule profile referenced by a stored chart', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const app = await testApp()
    const admin = { authorization: 'Bearer test-admin-token' }
    const created = await app.inject({ method: 'POST', url: '/v1/bazi-rule-profiles', headers: admin, payload: createBaziRuleProfilePayload })
    expect(created.statusCode).toBe(201)
    const id = created.json().id
    const published = await app.inject({ method: 'POST', url: `/v1/bazi-rule-profiles/${id}/state`, headers: admin, payload: { state: 'published' } })
    expect(published.statusCode).toBe(200)
    const versionId = published.json().currentPublishedVersionId
    expect(versionId).toBeTruthy()
    const chart = await app.inject({ method: 'POST', url: '/v1/charts', payload: { ...persistableBirth(), ruleProfileVersionId: versionId } })
    expect(chart.statusCode).toBe(201)
    const del = await app.inject({ method: 'DELETE', url: `/v1/bazi-rule-profiles/${id}`, headers: admin })
    expect(del.statusCode).toBe(409)
    await app.close()
  })
})

describe('admin dashboard', () => {
  it('requires admin credentials', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const app = await testApp()
    const response = await app.inject({ method: 'GET', url: '/v1/admin/dashboard' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('aggregates consumer-facing counts for the monitoring dashboard', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const app = await testApp()
    const authorization = { authorization: 'Bearer test-admin-token' }

    const empty = await app.inject({ method: 'GET', url: '/v1/admin/dashboard', headers: authorization })
    expect(empty.statusCode).toBe(200)
    expect(empty.json()).toMatchObject({
      reports: { total: 0, queued: 0, completed: 0, failed: 0, last24h: 0 },
      charts: { total: 0, active: 0, deleted: 0 },
      knowledge: { total: 0, published: 0, article: 0, rule: 0, skill: 0 },
      ruleProfiles: { total: 0, published: 0, activeVersions: 0 },
      wenzhen: { fixtures: 0 },
    })
    expect(typeof empty.json().generatedAt).toBe('string')

    const article = await app.inject({ method: 'POST', url: '/v1/knowledge', headers: authorization, payload: { kind: 'article', title: '客厅采光', sourceLabel: '测试专家', body: '客厅采光观察资料', tags: ['客厅'] } })
    expect(article.statusCode).toBe(201)
    const publishedArticle = await app.inject({ method: 'POST', url: `/v1/knowledge/${article.json().id}/state`, headers: authorization, payload: { state: 'published' } })
    expect(publishedArticle.statusCode).toBe(200)

    const profile = await app.inject({ method: 'POST', url: '/v1/bazi-rule-profiles', headers: authorization, payload: createBaziRuleProfilePayload })
    expect(profile.statusCode).toBe(201)
    const publishedProfile = await app.inject({ method: 'POST', url: `/v1/bazi-rule-profiles/${profile.json().id}/state`, headers: authorization, payload: { state: 'published' } })
    expect(publishedProfile.statusCode).toBe(200)

    const chart = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth() })
    expect(chart.statusCode).toBe(201)

    const populated = await app.inject({ method: 'GET', url: '/v1/admin/dashboard', headers: authorization })
    expect(populated.statusCode).toBe(200)
    expect(populated.json()).toMatchObject({
      reports: { total: 0 },
      charts: { total: 1, active: 1, deleted: 0 },
      knowledge: { total: 1, published: 1, article: 1 },
      ruleProfiles: { total: 1, published: 1, activeVersions: 1 },
    })
    await app.close()
  })
})

describe('report API', () => {
  it('persists seeded expert citations and deterministic rule hits into a generated report', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    vi.stubEnv('ADMIN_ACTOR_ID', 'knowledge-editor')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-evidence-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const knowledge = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      knowledge,
      async () => ({ report: '带依据的测试报告' }),
      { analyze: async (photos) => photos.map((photo) => ({
        fileId: photo.fileId,
        room: photo.room,
        summary: '客厅有自然采光',
        observedElements: ['自然采光'],
        uncertainties: [],
        schemaVersion: 'vision-observation-v2' as const,
        promptVersion: 'residence-facts-v2' as const,
        modelVersion: 'test-vision',
        facts: [{ code: 'daylight.visible' as const, confidence: 0.95, evidence: '画面显示客厅有自然光', scope: 'visible-detail' as const, source: 'vision-model' as const }],
      })) },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const adminHeaders = {
      authorization: 'Bearer test-admin-token',
    }
    for (const asset of demoKnowledgeAssets) {
      const created = await app.inject({ method: 'POST', url: '/v1/knowledge', headers: adminHeaders, payload: asset })
      expect(created.statusCode).toBe(201)
      const published = await app.inject({ method: 'POST', url: `/v1/knowledge/${created.json().id}/state`, headers: adminHeaders, payload: { state: 'published' } })
      expect(published.statusCode).toBe(200)
    }

    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south', layoutNote: '客厅采光与南向阳台' },
      photos: [{ fileId: 'evidence-photo.jpg', room: 'living-room', facing: 'south', note: '客厅自然采光' }],
    } })
    expect(response.statusCode).toBe(202)
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'completed',
      phase: 'completed',
      report: '带依据的测试报告',
    }))
    const stored = await repository.get(response.json().id)
    expect(stored?.citations?.map((item) => item.title)).toEqual(
      expect.arrayContaining(['客厅采光与明堂感的基础观察']),
    )
    expect(stored?.citations?.every((item) => item.title !== '住宅报告生成 Skill：先证据后建议')).toBe(true)
    expect(stored?.evaluatedRules?.map((item) => item.title)).toEqual(['南向住宅基础观察提示', '客厅自然采光复核提示'])
    expect(stored?.evaluatedRules?.[0]).toMatchObject({
      versionId: expect.stringContaining(':v1:'),
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      conclusions: expect.arrayContaining([expect.objectContaining({ code: 'south-facing-baseline' })]),
    })
    await app.close()
  })

  it('adds deterministic nine-grid floor-plan facts before report rule evaluation', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    vi.stubEnv('ADMIN_ACTOR_ID', 'knowledge-editor')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-nine-grid-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const knowledge = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      knowledge,
      async () => ({ report: '九宫格依据报告' }),
      { analyze: async (photos) => photos.map((photo) => ({
        fileId: photo.fileId,
        room: photo.room,
        summary: '视觉模型未产出户型拓扑事实',
        observedElements: [],
        uncertainties: [],
        schemaVersion: 'vision-observation-v2' as const,
        promptVersion: 'residence-facts-v2' as const,
        modelVersion: 'test-vision',
        facts: [],
      })) },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const adminHeaders = { authorization: 'Bearer test-admin-token' }
    for (const asset of demoKnowledgeAssets) {
      const created = await app.inject({ method: 'POST', url: '/v1/knowledge', headers: adminHeaders, payload: asset })
      expect(created.statusCode).toBe(201)
      const published = await app.inject({ method: 'POST', url: `/v1/knowledge/${created.json().id}/state`, headers: adminHeaders, payload: { state: 'published' } })
      expect(published.statusCode).toBe(200)
    }

    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      calculationInput: {
        inputMode: 'manual-four-pillars',
        pillars: ['丁丑', '癸卯', '戊午', '庚申'],
      },
      residence: { facing: 'unknown', layoutNote: '上北下南，厨房在南侧，卫生间靠近中宫。' },
      floorPlan: {
        boundary: { x: 0, y: 0, width: 1000, height: 800 },
        orientation: { northUp: true, evidenceRef: 'plan:demo:north-up' },
        rooms: [
          {
            id: 'kitchen',
            kind: 'kitchen',
            label: '厨房',
            center: { x: 500, y: 720 },
            evidenceRef: 'plan:demo:kitchen-center',
          },
          {
            id: 'bathroom',
            kind: 'bathroom',
            label: '卫生间',
            center: { x: 520, y: 420 },
            evidenceRef: 'plan:demo:bathroom-center',
          },
        ],
      },
      photos: [{ fileId: 'nine-grid-plan.jpg', room: 'overview', facing: 'unknown', note: '全屋户型图，上北下南。' }],
    } })

    expect(response.statusCode).toBe(202)
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'completed',
      phase: 'completed',
      report: '九宫格依据报告',
    }))
    const stored = await repository.get(response.json().id)
    expect(stored?.floorPlanAnalysis).toMatchObject({ status: 'derived', algorithmVersion: 'floorplan-nine-grid-v1' })
    expect(stored?.vision?.at(-1)).toMatchObject({
      fileId: 'floorplan-nine-grid',
      facts: expect.arrayContaining([
        expect.objectContaining({ code: 'kitchen.south', source: 'program-nine-grid' }),
        expect.objectContaining({ code: 'bathroom.near-center', source: 'program-nine-grid' }),
      ]),
    })
    expect(stored?.evaluatedRules?.map((item) => item.title)).toEqual(expect.arrayContaining([
      '南侧厨房与土日主火土合参提示',
      '近中宫卫生间与土性稳定需求冲突提示',
    ]))
    expect(stored?.compatibility).toMatchObject({
      assessable: true,
      overallLevel: 'mixed',
      positiveMatches: [expect.objectContaining({ conclusion: expect.stringContaining('火土关系') })],
      conflicts: [expect.objectContaining({ conclusion: expect.stringContaining('近中宫水厕位置') })],
      neutralOrUnknown: ['住宅整体朝向未确认；本次只评估不依赖整体朝向的局部格局事实。'],
    })
    await app.close()
  })

  it.each([
    {
      name: 'unconfirmed orientation',
      floorPlan: {
        boundary: { x: 0, y: 0, width: 100, height: 100 },
        orientation: { northUp: false, evidenceRef: 'plan:north' },
        rooms: [{ id: 'kitchen', kind: 'kitchen', center: { x: 50, y: 80 }, evidenceRef: 'plan:kitchen' }],
      },
    },
    {
      name: 'out-of-bound room',
      floorPlan: {
        boundary: { x: 0, y: 0, width: 100, height: 100 },
        orientation: { northUp: true, evidenceRef: 'plan:north' },
        rooms: [{ id: 'kitchen', kind: 'kitchen', center: { x: 150, y: 80 }, evidenceRef: 'plan:kitchen' }],
      },
    },
    {
      name: 'public manual override',
      floorPlan: {
        boundary: { x: 0, y: 0, width: 100, height: 100 },
        orientation: { northUp: true, evidenceRef: 'plan:north' },
        rooms: [{ id: 'kitchen', kind: 'kitchen', center: { x: 50, y: 80 }, evidenceRef: 'plan:kitchen' }],
        overrides: [{ code: 'kitchen.south', decision: 'assert', confidence: 1, actor: 'anonymous', reason: 'force', evidenceRef: 'plan:override' }],
      },
    },
  ])('rejects invalid floor-plan geometry before creating a report: $name', async ({ floorPlan }) => {
    const app = await testApp('九宫格请求校验')
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: { ...reportPayload('invalid-nine-grid.jpg'), floorPlan },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('floorPlan')
    await app.close()
  })

  it('retrieves diverse published book citations for report generation without citing rules or skills', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-citation-diversity-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const knowledge = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const books = [
      '中州派【玄空风水】第1篇-玄空基础',
      '中州派【玄空风水】第2篇-玄空理气入门',
      '中州派【玄空风水】第3篇-水法宅形补遗概要',
      '中州派【玄空风水】第4篇-玄空古赋',
      '中州派【玄空风水】第5篇-阳宅运用篇',
    ]
    for (const book of books) {
      const asset = await knowledge.create({
        kind: 'article',
        title: `${book} p.1 住宅坐向`,
        tags: ['玄空风水', '坐向', '山向', '厨房', '卫生间', '客厅'],
        sourceLabel: `中州派玄空风水 p.1 sha256:${'a'.repeat(12)}`,
        body: `sourceFile: ${book}.pdf\nbookTitle: ${book}\n玄空风水判断住宅，要结合坐向、山向、门路、厨房灶位、卫生间与客厅明堂。`,
      })
      await knowledge.setState(asset.id, 'published', 'knowledge-reviewer')
    }
    for (let index = 0; index < 8; index += 1) {
      const asset = await knowledge.create({
        kind: 'article',
        title: `中州派【玄空风水】第1篇-玄空基础 p.${index + 2} 重复资料`,
        tags: ['玄空风水', '坐向', '厨房'],
        sourceLabel: `中州派玄空风水 p.${index + 2} sha256:${'b'.repeat(12)}`,
        body: `sourceFile: 中州派【玄空风水】第1篇-玄空基础.pdf\nbookTitle: 中州派【玄空风水】第1篇-玄空基础\n重复命中资料：厨房灶位与南向坐向。`,
      })
      await knowledge.setState(asset.id, 'published', 'knowledge-reviewer')
    }
    const rule = await knowledge.create({
      kind: 'rule',
      title: '不应成为 citation 的规则',
      tags: ['玄空风水', '坐向'],
      body: '规则资产应进入规则评估，不应作为专家资料 citation。',
      sourceLabel: '测试规则',
      rule: { priority: 1, conditions: [{ fact: 'residence.facing', operator: 'equals', value: 'south' }], conclusions: [{ code: 'south', text: '南向条件。', level: 'info' }] },
    })
    await knowledge.setState(rule.id, 'published', 'knowledge-reviewer')
    const skill = await knowledge.create({ kind: 'skill', title: '不应成为 citation 的 Skill', tags: ['玄空风水'], body: 'Skill 资产不应进入 citation。', sourceLabel: '测试 Skill' })
    await knowledge.setState(skill.id, 'published', 'knowledge-reviewer')

    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      knowledge,
      async () => ({ report: '多来源依据测试报告' }),
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '测试空间', observedElements: ['自然采光'], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south', layoutNote: '南向住宅，厨房在南，卫生间近中宫，客厅连接阳台' },
      photos: [
        { fileId: 'diverse-overview.jpg', room: 'overview', facing: 'north', note: '全屋户型图' },
        { fileId: 'diverse-kitchen.jpg', room: 'kitchen', facing: 'south', note: '厨房灶位' },
      ],
    } })
    expect(response.statusCode).toBe(202)
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({ status: 'completed' }))
    const stored = await repository.get(response.json().id)
    expect(stored?.citations?.length).toBeLessThanOrEqual(8)
    expect(stored?.citations?.some((item) => item.title === rule.title || item.title === skill.title)).toBe(false)
    const citedBooks = new Set(stored?.citations?.map((item) => item.title.replace(/\s+p\.\d+(?:-\d+)?\s+.*$/u, '')))
    expect(citedBooks).toEqual(new Set(books))
    await app.close()
  })

  it('uses structured vision facts when retrieving expert citations for report generation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-vision-fact-citations-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const knowledge = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const asset = await knowledge.create({
      kind: 'article',
      title: '厕占中宫核验依据',
      tags: ['玄空风水', '卫生间', '厕占中宫'],
      sourceLabel: '中州派玄空风水 p.21 sha256:cccccccccccc',
      body: 'sourceFile: 中州派【玄空风水】第5篇-阳宅运用篇.pdf\nbookTitle: 中州派【玄空风水】第5篇-阳宅运用篇\n卫生间接近中宫时，需要作为阳宅内六事重点核验项。',
    })
    await knowledge.setState(asset.id, 'published', 'knowledge-reviewer')

    let generatedRecord: ReportRecord | undefined
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      knowledge,
      async (record) => { generatedRecord = record; return { report: '视觉事实检索测试报告' } },
      { analyze: async (photos): Promise<VisionObservation[]> => photos.map((photo) => ({
        fileId: photo.fileId,
        room: photo.room,
        summary: '户型图显示卫生间靠近中宫。',
        observedElements: [],
        uncertainties: [],
        facts: [{ code: 'bathroom.near-center', confidence: 0.9, evidence: '卫生间靠近住宅中宫', scope: 'floor-plan-topology', source: 'vision-model' }],
      })) },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south', layoutNote: '三室户型，待结合命盘复核' },
      photos: [{ fileId: 'vision-citation-overview.jpg', room: 'overview', facing: 'north', note: '全屋户型图' }],
    } })
    expect(response.statusCode).toBe(202)
    await vi.waitFor(() => expect(generatedRecord?.citations?.map((item) => item.title)).toContain('厕占中宫核验依据'))
    await app.close()
  })

  it('uses derived chart pattern and shen-sha terms when retrieving report citations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-chart-assessment-citations-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const knowledge = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const patternAsset = await knowledge.create({
      kind: 'article',
      title: '伤官候选依据',
      tags: ['伤官'],
      sourceLabel: '测试专家',
      body: '月令主气为伤官时，需要复核透干和制化。',
    })
    const patternPublished = await knowledge.setState(patternAsset.id, 'published', 'knowledge-reviewer')
    const shenShaAsset = await knowledge.create({
      kind: 'article',
      title: '禄神符号依据',
      tags: ['禄神'],
      sourceLabel: '测试专家',
      body: '命盘出现禄神时，仅作为传统符号摘要使用。',
    })
    await knowledge.setState(shenShaAsset.id, 'published', 'knowledge-reviewer')
    const ruleProfiles = new BaziRuleProfileRepository(join(directory, 'bazi-rule-profiles.json'))
    const activeRuleProfile = await ensureDemoBaziRuleProfile(
      ruleProfiles,
      'knowledge-editor',
      'knowledge-reviewer',
      patternPublished?.currentPublishedVersionId,
    )
    if (!activeRuleProfile) throw new Error('expected seeded demo bazi rule profile')

    let generatedRecord: ReportRecord | undefined
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      knowledge,
      async (record) => { generatedRecord = record; return { report: '命盘专业字段检索报告' } },
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
      ruleProfiles,
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      ruleProfileVersionId: activeRuleProfile.versionId,
      birth: { date: '1992-08-21', time: '12:03', placeCode: '330106' },
      residence: { facing: 'south', layoutNote: '住宅平面待结合命盘复核' },
      photos: [{ fileId: 'chart-assessment-overview.jpg', room: 'overview', facing: 'north', note: '全屋户型图' }],
    } })
    expect(response.statusCode).toBe(202)
    await vi.waitFor(() => expect(generatedRecord?.citations?.map((item) => item.title)).toEqual(expect.arrayContaining([
      '伤官候选依据',
      '禄神符号依据',
    ])))
    expect(generatedRecord?.bazi.assessments?.pattern).toMatchObject({
      status: 'derived',
      conclusion: expect.stringContaining('伤官'),
    })
    expect(generatedRecord?.bazi.assessments?.shenSha?.items?.some((item) => item.includes('禄神'))).toBe(true)
    await app.close()
  })

  it('returns an authoritative lunar-year profile with the engine rule version', async () => {
    const app = await testApp()
    const response = await app.inject({ method: 'GET', url: '/v1/calendar/lunar-years/2023' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      year: 2023,
      leapMonth: 2,
      ruleVersion: CALENDAR_RULE_VERSION,
      months: expect.arrayContaining([
        { month: 2, leap: false, days: 30 },
        { month: 2, leap: true, days: 29 },
      ]),
    })
    expect(response.json().months).toHaveLength(13)
    await app.close()
  })

  it('rejects nonnumeric and out-of-range lunar profile years with a stable error', async () => {
    const app = await testApp()
    const expected = { error: 'lunar year must be an integer between 1801 and 2100' }
    for (const year of ['not-a-year', '1800', '2101', '2023.5']) {
      const response = await app.inject({ method: 'GET', url: `/v1/calendar/lunar-years/${year}` })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual(expected)
    }
    await app.close()
  })

  it('includes both supported lunar-year profile boundaries', async () => {
    const app = await testApp()
    for (const year of [1801, 2100]) {
      const response = await app.inject({ method: 'GET', url: `/v1/calendar/lunar-years/${year}` })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ year, ruleVersion: CALENDAR_RULE_VERSION })
      expect(response.json().months.length).toBeGreaterThanOrEqual(12)
    }
    await app.close()
  })

  it('searches the national administrative hierarchy without inventing coordinates', async () => {
    const app = await testApp()
    const response = await app.inject({ method: 'GET', url: '/v1/birthplaces/administrative?q=%E6%8B%89%E8%90%A8&limit=10' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      dataset: { id: 'cn-administrative-geonames-reviewed-coordinates', coverage: 'licensed-partial', source: { license: expect.stringContaining('CC BY 4.0') } },
      items: expect.arrayContaining([expect.objectContaining({ city: expect.objectContaining({ name: '拉萨市' }) })]),
    })
    await app.close()
  })

  it('does not substitute an arbitrary district coordinate for province or city codes', async () => {
    const app = await testApp()
    expect((await app.inject({ method: 'GET', url: '/v1/birthplaces/330000' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/v1/birthplaces/330100' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/v1/birthplaces/330106' })).statusCode).toBe(200)
    await app.close()
  })

  it('exposes birthplace dataset metadata and integrity for selector clients', async () => {
    const app = await testApp()
    const dataset = await app.inject({ method: 'GET', url: '/v1/birthplaces/dataset' })
    const tree = await app.inject({ method: 'GET', url: '/v1/birthplaces/tree' })
    const integrity = await app.inject({ method: 'GET', url: '/v1/birthplaces/integrity' })
    expect(dataset.statusCode).toBe(200)
    expect(dataset.json()).toMatchObject({
      dataset: {
        id: 'cn-administrative-geonames-reviewed-coordinates',
        coverage: 'licensed-partial',
        coordinateSystem: 'WGS84',
        statistics: { selectableDistrictCount: 2614, unavailableDistrictCount: 697 },
      },
    })
    expect(tree.statusCode).toBe(200)
    expect(tree.json()).toMatchObject({
      dataset: { id: 'cn-administrative-geonames-reviewed-coordinates', version: expect.any(String) },
      tree: expect.arrayContaining([
        expect.objectContaining({
          name: '浙江省',
          cities: expect.arrayContaining([
            expect.objectContaining({
              name: '杭州市',
              districts: expect.arrayContaining([
                expect.objectContaining({ name: '西湖区', code: '330106', longitude: 120.13333, latitude: 30.26667 }),
              ]),
            }),
          ]),
        }),
      ]),
    })
    expect(JSON.stringify(tree.json().tree)).not.toContain('"selectable":false')
    expect(integrity.statusCode).toBe(200)
    expect(integrity.json()).toMatchObject({
      complete: true,
      issues: [],
      selectableDistrictCount: 2614,
      unavailableDistrictCount: 697,
    })
    await app.close()
  })

  it('searches birthplaces and resolves an administrative code through the API', async () => {
    const app = await testApp()
    const search = await app.inject({ method: 'GET', url: '/v1/birthplaces?q=杭州&limit=2' })
    expect(search.statusCode).toBe(200)
    expect(search.json()).toMatchObject({
      total: expect.any(Number),
      limit: 2,
      offset: 0,
      dataset: { version: expect.any(String) },
    })
    expect(search.json().items).toHaveLength(2)
    expect(search.json().items[0]).toMatchObject({ province: { name: '浙江省' }, city: { name: '杭州市' } })

    const byCode = await app.inject({ method: 'GET', url: '/v1/birthplaces/330106' })
    expect(byCode.statusCode).toBe(200)
    expect(byCode.json()).toMatchObject({
      birthplace: { province: { name: '浙江省' }, city: { name: '杭州市' }, district: { name: '西湖区', longitude: 120.13333 } },
    })
    expect((await app.inject({ method: 'GET', url: '/v1/birthplaces/999999' })).statusCode).toBe(404)
    await app.close()
  })

  it('keeps administrative metadata, integrity and detail routes ahead of the selectable dynamic route', async () => {
    const app = await testApp()
    const dataset = await app.inject({ method: 'GET', url: '/v1/birthplaces/administrative/dataset' })
    const integrity = await app.inject({ method: 'GET', url: '/v1/birthplaces/administrative/integrity' })
    const selectable = await app.inject({ method: 'GET', url: '/v1/birthplaces/administrative/110101' })
    const unavailable = await app.inject({ method: 'GET', url: '/v1/birthplaces/administrative/110118' })
    const unknown = await app.inject({ method: 'GET', url: '/v1/birthplaces/administrative/999999' })

    expect(dataset.statusCode).toBe(200)
    expect(dataset.json()).toMatchObject({ dataset: {
      coverage: 'licensed-partial',
      statistics: { selectableDistrictCount: 2614, unavailableDistrictCount: 697 },
    } })
    expect(integrity.statusCode).toBe(200)
    expect(integrity.json()).toMatchObject({
      districtCount: 3311,
      selectableDistrictCount: 2614,
      unavailableDistrictCount: 697,
      complete: true,
    })
    expect(selectable.statusCode).toBe(200)
    expect(selectable.json()).toMatchObject({ birthplace: { selectable: true, district: { code: '110101', name: '东城区' } } })
    expect(unavailable.statusCode).toBe(200)
    expect(unavailable.json()).toMatchObject({ birthplace: { selectable: false, district: { code: '110118', name: '密云区' } } })
    expect(unknown.statusCode).toBe(404)
    await app.close()
  })

  it('resolves code-only birth input and replaces client coordinate provenance with canonical data', async () => {
    const app = await testApp()
    const codeOnly = await app.inject({ method: 'POST', url: '/v1/bazi', payload: {
      date: '1992-08-18', time: '09:30', placeCode: '110101',
    } })
    expect(codeOnly.statusCode).toBe(200)
    expect(codeOnly.json().birth).toMatchObject({
      province: '北京市', city: '北京市', district: '东城区', placeCode: '110101',
      locationName: '北京市 北京市 东城区', longitude: 116.41834, latitude: 39.93264,
      timezone: 'Asia/Shanghai',
    })
    expect(codeOnly.json().birth.geoDataVersion).toMatch(/^province-city-china@/)

    const spoofed = await app.inject({ method: 'POST', url: '/v1/bazi', payload: {
      date: '1992-08-18', time: '09:30', placeCode: '110101',
      province: '北京市', city: '北京市', district: '东城区',
      locationName: '伪造地点', longitude: 1, latitude: 2, timezone: 'Etc/UTC', geoDataVersion: 'forged-v1',
    } })
    expect(spoofed.statusCode).toBe(200)
    expect(spoofed.json().birth).toMatchObject({
      locationName: '北京市 北京市 东城区', longitude: 116.41834, latitude: 39.93264,
      timezone: 'Asia/Shanghai',
    })
    expect(spoofed.json().birth.geoDataVersion).not.toBe('forged-v1')
    await app.close()
  })

  it('rejects each administrative name contradiction against a selected code', async () => {
    const app = await testApp()
    for (const contradictory of [
      { province: '天津市', city: '北京市', district: '东城区', expected: 'province' },
      { province: '北京市', city: '天津市', district: '东城区', expected: 'city' },
      { province: '北京市', city: '北京市', district: '西城区', expected: 'district' },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/v1/bazi', payload: {
        date: '1992-08-18', time: '09:30', placeCode: '110101', ...contradictory,
      } })
      expect(response.statusCode).toBe(400)
      expect(response.json().error).toContain(contradictory.expected)
    }
    await app.close()
  })

  it('rejects unknown and unavailable place codes for calculation', async () => {
    const app = await testApp()
    for (const placeCode of ['999999', '110118']) {
      const response = await app.inject({ method: 'POST', url: '/v1/bazi', payload: {
        date: '1992-08-18', time: '09:30', placeCode,
      } })
      expect(response.statusCode).toBe(400)
    }
    await app.close()
  })

  it('keeps structured-name compatibility canonical and rejects forged provenance on free text legacy input', async () => {
    const app = await testApp()
    const structured = await app.inject({ method: 'POST', url: '/v1/bazi', payload: {
      date: '1992-08-18', time: '09:30', province: '浙江省', city: '杭州市', district: '西湖区',
      locationName: '伪造地点', longitude: 0, latitude: 0, timezone: 'Etc/UTC', geoDataVersion: 'forged-v1',
    } })
    expect(structured.statusCode).toBe(200)
    expect(structured.json().birth).toMatchObject({
      placeCode: '330106', locationName: '浙江省 杭州市 西湖区', longitude: 120.13333,
      latitude: 30.26667, timezone: 'Asia/Shanghai',
    })
    expect(structured.json().birth.geoDataVersion).not.toBe('forged-v1')

    const legacy = await app.inject({ method: 'POST', url: '/v1/bazi', payload: {
      date: '1992-08-18', time: '09:30', locationName: '杭州市', longitude: 120.1551,
      geoDataVersion: 'forged-v1',
    } })
    expect(legacy.statusCode).toBe(400)
    expect(legacy.json().error).toContain('geoDataVersion')
    await app.close()
  })

  it('calculates a standalone chart without requiring residence photos', async () => {
    const app = await testApp()
    const response = await app.inject({ method: 'POST', url: '/v1/bazi', payload: {
      date: '1992-08-18', time: '09:30', locationName: '杭州市', longitude: 120.1551,
    } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      birth: { locationName: '杭州市' },
      bazi: {
        ruleVersion: 'bazi-v5-stem-branch-relations',
        timeCorrectionRuleVersion: 'true-solar-v2-zone-meridian-equation-of-time',
        inputSnapshot: { calendarSystem: 'solar', timezone: 'Asia/Shanghai', useTrueSolarTime: true },
      },
    })
    expect(response.json().bazi.pillars).toHaveLength(4)
    await app.close()
  })

  it('calculates target flow cycles without requiring residence photos', async () => {
    const app = await testApp()
    const response = await app.inject({ method: 'POST', url: '/v1/bazi/flow', payload: {
      birth: {
        date: '1992-08-18', time: '09:30', locationName: '杭州市', longitude: 120.1551,
        timezone: 'Asia/Shanghai', useTrueSolarTime: false, gender: 'male',
      },
      query: { targetDate: '2026-09-01', targetTime: '15:57' },
    } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      flow: {
        ruleVersion: 'flow-v4-timezone-projected-jie-boundaries',
        target: { date: '2026-09-01', time: '15:57', timezone: 'Asia/Shanghai', boundaryTimeBasis: 'corrected-local-solar-term-wall-v2' },
        selection: { luckCycleIndex: 3, year: 2026, monthYear: expect.any(Number), month: 7, date: '2026-09-01', hourSlotStart: 15 },
        luckCycles: expect.any(Array),
        annualCycles: expect.arrayContaining([expect.objectContaining({ year: 2026, pillar: '丙午' })]),
        monthlyCycles: expect.arrayContaining([expect.objectContaining({
          year: 2026,
          month: 7,
          monthName: '七',
          startAt: '2026-08-07T19:43:00',
          endAt: '2026-09-07T22:42:00',
          startTerm: '立秋',
          endTerm: '白露',
          pillar: '丙申',
        })]),
        dailyCycles: expect.arrayContaining([expect.objectContaining({ date: '2026-09-01', pillar: '戊寅' })]),
        hourlyCycles: expect.arrayContaining([expect.objectContaining({ startHour: 15, earthlyBranch: '申', pillar: '庚申' })]),
      },
    })
    await app.close()
  })

  it('rejects malformed flow target queries', async () => {
    const app = await testApp()
    const response = await app.inject({ method: 'POST', url: '/v1/bazi/flow', payload: {
      birth: persistableBirth(),
      query: { targetDate: '2026-02-29' },
    } })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('target date/time')
    await app.close()
  })

  it('returns a machine-readable external chart comparison', async () => {
    const app = await testApp()
    const response = await app.inject({ method: 'POST', url: '/v1/bazi/compare', payload: {
      sampleId: 'manual-wenzhen-001',
      source: 'wenzhen-manual-capture',
      birth: { date: '1992-08-18', time: '09:30', placeCode: '330106' },
      expected: { pillars: ['壬申', '戊申', '丙寅', '甲午'] },
    } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      birth: {
        placeCode: '330106',
        locationName: '浙江省 杭州市 西湖区',
        longitude: 120.13333,
        latitude: 30.26667,
        timezone: 'Asia/Shanghai',
        geoDataVersion: expect.stringContaining('geonames-cn@2026-08-31.64057955b60e'),
      },
      report: {
        sampleId: 'manual-wenzhen-001',
        source: 'wenzhen-manual-capture',
        matched: false,
        comparedPaths: ['pillars'],
        pathSemantics: 'wenzhen-leaf-v1',
        mismatches: [{ path: 'pillars[3]', category: 'pillar', expected: '甲午' }],
      },
    })
    await app.close()
  })

  it('previews dynamic WenZhen expectations only against an explicit flow query', async () => {
    const app = await testApp()
    const { expected } = await dynamicWenzhenExpected(app, dynamicWenzhenBirth, dynamicWenzhenFlowQuery)

    const preview = await app.inject({ method: 'POST', url: '/v1/bazi/compare', payload: {
      sampleId: 'wz-dynamic-preview-001',
      source: 'wenzhen-admin-manual-check',
      birth: dynamicWenzhenBirth,
      flowQuery: dynamicWenzhenFlowQuery,
      expected,
    } })
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({
      report: {
        matched: true,
        comparedPaths: ['pillars', 'annualCycles', 'monthlyCycles', 'dailyCycles', 'hourlyCycles'],
        pathSemantics: 'wenzhen-leaf-v1',
        mismatches: [],
      },
    })

    const missingQuery = await app.inject({ method: 'POST', url: '/v1/bazi/compare', payload: {
      sampleId: 'wz-dynamic-preview-missing-query',
      source: 'wenzhen-admin-manual-check',
      birth: dynamicWenzhenBirth,
      expected,
    } })
    expect(missingQuery.statusCode).toBe(400)
    expect(missingQuery.json().error).toContain('flowQuery is required')

    const invalidQuery = await app.inject({ method: 'POST', url: '/v1/bazi/compare', payload: {
      sampleId: 'wz-dynamic-preview-invalid-query',
      source: 'wenzhen-admin-manual-check',
      birth: dynamicWenzhenBirth,
      flowQuery: { targetDate: '2023-02-29' },
      expected,
    } })
    expect(invalidQuery.statusCode).toBe(400)
    expect(invalidQuery.json().error).toContain('flowQuery is not calculable')
    await app.close()
  })

  it('rejects incomplete dynamic WenZhen capture templates at the API boundary', async () => {
    const app = await testApp()
    const chart = await app.inject({ method: 'POST', url: '/v1/bazi', payload: dynamicWenzhenBirth })
    expect(chart.statusCode).toBe(200)

    const response = await app.inject({ method: 'POST', url: '/v1/bazi/compare', payload: {
      sampleId: 'wz-dynamic-template-empty',
      source: 'wenzhen-admin-manual-check',
      birth: dynamicWenzhenBirth,
      flowQuery: dynamicWenzhenFlowQuery,
      expected: {
        pillars: chart.json().bazi.pillars,
        annualCycles: [{ year: 2026, pillar: '' }],
      },
    } })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('annualCycles[0].pillar must be a non-empty captured value')
    await app.close()
  })

  it('keeps the legacy comparison response contract for payloads without fixture-required pillars', async () => {
    const app = await testApp()
    const response = await app.inject({ method: 'POST', url: '/v1/bazi/compare', payload: {
      sampleId: 'legacy-professional-preview',
      source: 'legacy-external-comparison',
      birth: { date: '1992-08-18', time: '09:30', placeCode: '330106' },
      expected: { correctedLocalTime: '2000-01-01T00:00' },
    } })

    expect(response.statusCode).toBe(200)
    expect(response.json().report).toMatchObject({
      sampleId: 'legacy-professional-preview',
      source: 'legacy-external-comparison',
      matched: false,
      comparedPaths: ['correctedLocalTime'],
      pathSemantics: 'legacy-field-v1',
      mismatches: [{ path: 'correctedLocalTime', category: 'time-correction', expected: '2000-01-01T00:00' }],
    })
    await app.close()
  })

  it('exposes the WenZhen fixture diff dashboard without counting pending samples as parity', async () => {
    const app = await testApp()
    const response = await app.inject({ method: 'GET', url: '/v1/bazi/wenzhen/diff' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      metadata: { schemaVersion: 'wenzhen-fixture-v1' },
      totals: {
        all: expect.any(Number),
        reportable: baselineWenzhenSampleIds.length,
        pending: 0,
        matched: baselineWenzhenSampleIds.length,
        mismatched: 0,
      },
      coverage: {
        pillars: baselineWenzhenSampleIds.length,
        'time-correction': baselineWenzhenTimeAndProfessionalCount,
        'professional-table': baselineWenzhenTimeAndProfessionalCount,
        'luck-cycles': 1,
        'dynamic-cycles': baselineWenzhenDynamicCount,
      },
      captureMatrix: {
        totalPlanned: 31,
        verifiedPlanned: baselineWenzhenSampleIds.length,
        pendingCapture: 25,
        reportableFixtures: baselineWenzhenSampleIds.length,
        passedFixtures: baselineWenzhenSampleIds.length,
        failedFixtures: 0,
        pendingCaptureIds: expect.arrayContaining(['wz-025-lichun-boundary-after']),
        readiness: {
          allPlannedCaptured: false,
          everyVerifiedPlanHasPassingFixture: true,
          noUnplannedFixtures: true,
          noFailedFixtures: true,
          stage1ParityClaimReady: false,
        },
      },
      reports: expect.arrayContaining(baselineWenzhenSampleIds.map((sampleId) => expect.objectContaining({ sampleId, outcome: 'passed' }))),
    })
    expect(response.json().pendingSamples).toEqual([])
    await app.close()
  })

  it('lets administrators persist manually captured WenZhen fixtures for future diff runs', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-wenzhen-fixture-'))
    const app = await testApp('测试报告', { wenzhenRuntimeFixturePath: join(directory, 'runtime-wenzhen.json') })
    const authorization = { authorization: 'Bearer test-admin-token' }
    const payload = {
      sampleId: 'wz-runtime-verified-001',
      source: 'wenzhen-admin-manual-capture',
      capturedAt: '2026-09-01T05:00:00Z',
      evidenceRef: `evidence/wenzhen/sha256-${'1'.repeat(64)}.png`,
      birth: { date: '1992-08-21', time: '12:03', calendarSystem: 'solar', placeCode: '330106', useTrueSolarTime: true, dstPolicy: 'auto', dayBoundary: 'midnight', luckMethod: 'sect1', gender: 'male' },
      expected: { pillars: ['壬申', '戊申', '己巳', '庚午'] },
    }

    const unauthorized = await app.inject({ method: 'POST', url: '/v1/bazi/wenzhen/fixtures', payload })
    expect(unauthorized.statusCode).toBe(401)

    const created = await app.inject({ method: 'POST', url: '/v1/bazi/wenzhen/fixtures', headers: authorization, payload })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({
      fixture: { sampleId: 'wz-runtime-verified-001', status: 'verified', birth: { locationName: '浙江省 杭州市 西湖区', longitude: 120.13333, latitude: 30.26667 } },
      report: { sampleId: 'wz-runtime-verified-001', outcome: 'passed' },
    })

    const diff = await app.inject({ method: 'GET', url: '/v1/bazi/wenzhen/diff' })
    expect(diff.statusCode).toBe(200)
    expect(diff.json()).toMatchObject({
      totals: { reportable: baselineWenzhenSampleIds.length + 1, matched: baselineWenzhenSampleIds.length + 1, mismatched: 0 },
      coverage: {
        pillars: baselineWenzhenSampleIds.length + 1,
        'time-correction': baselineWenzhenTimeAndProfessionalCount,
        'professional-table': baselineWenzhenTimeAndProfessionalCount,
        'luck-cycles': 1,
        'dynamic-cycles': baselineWenzhenDynamicCount,
      },
      reports: expect.arrayContaining([expect.objectContaining({ sampleId: 'wz-runtime-verified-001', outcome: 'passed' })]),
    })

    const duplicate = await app.inject({ method: 'POST', url: '/v1/bazi/wenzhen/fixtures', headers: authorization, payload })
    expect(duplicate.statusCode).toBe(409)
    await app.close()
  })

  it('rejects a verified WenZhen fixture when its asserted result does not match', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-wenzhen-invalid-verified-'))
    const app = await testApp('测试报告', { wenzhenRuntimeFixturePath: join(directory, 'runtime-wenzhen.json') })
    const authorization = { authorization: 'Bearer test-admin-token' }

    const created = await app.inject({
      method: 'POST',
      url: '/v1/bazi/wenzhen/fixtures',
      headers: authorization,
      payload: {
        sampleId: 'wz-runtime-invalid-verified-001',
        source: 'wenzhen-admin-manual-capture',
        capturedAt: '2026-09-01T05:00:00Z',
        evidenceRef: `evidence/wenzhen/sha256-${'2'.repeat(64)}.png`,
        birth: { date: '1992-08-21', time: '12:03', calendarSystem: 'solar', placeCode: '330106', useTrueSolarTime: true, dstPolicy: 'auto', dayBoundary: 'midnight', luckMethod: 'sect1', gender: 'male' },
        expected: { pillars: ['甲子', '甲子', '甲子', '甲子'] },
      },
    })

    expect(created.statusCode).toBe(400)
    expect(created.json()).toEqual({ error: 'verified fixture must pass every current asserted difference' })

    const diff = await app.inject({ method: 'GET', url: '/v1/bazi/wenzhen/diff' })
    expect(diff.statusCode).toBe(200)
    expect(diff.json().reports).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sampleId: 'wz-runtime-invalid-verified-001' }),
    ]))
    await app.close()
  })

  it('persists verified dynamic WenZhen fixtures with their explicit flow query', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-wenzhen-dynamic-fixture-'))
    const runtimeFixturePath = join(directory, 'runtime-wenzhen.json')
    const app = await testApp('测试报告', { wenzhenRuntimeFixturePath: runtimeFixturePath })
    const authorization = { authorization: 'Bearer test-admin-token' }
    const birth = dynamicWenzhenBirth
    const flowQuery = dynamicWenzhenFlowQuery
    const { expected } = await dynamicWenzhenExpected(app, birth, flowQuery)

    const created = await app.inject({ method: 'POST', url: '/v1/bazi/wenzhen/fixtures', headers: authorization, payload: {
      sampleId: 'wz-runtime-dynamic-verified-001',
      source: 'wenzhen-admin-manual-capture',
      capturedAt: '2026-09-01T05:00:00Z',
      evidenceRef: `evidence/wenzhen/sha256-${'7'.repeat(64)}.png`,
      birth,
      flowQuery,
      expected,
    } })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({
      fixture: { sampleId: 'wz-runtime-dynamic-verified-001', status: 'verified', flowQuery },
      report: { sampleId: 'wz-runtime-dynamic-verified-001', outcome: 'passed' },
    })
    expect(created.json().report.assertionCoverage.categories).toContain('dynamic-cycles')

    const persisted = JSON.parse(await readFile(runtimeFixturePath, 'utf8')) as { samples: unknown[] }
    expect(persisted.samples).toEqual([expect.objectContaining({ sampleId: 'wz-runtime-dynamic-verified-001', flowQuery })])

    const diff = await app.inject({ method: 'GET', url: '/v1/bazi/wenzhen/diff' })
    expect(diff.statusCode).toBe(200)
    expect(diff.json()).toMatchObject({
      totals: { reportable: baselineWenzhenSampleIds.length + 1, matched: baselineWenzhenSampleIds.length + 1, mismatched: 0 },
      coverage: { 'dynamic-cycles': baselineWenzhenDynamicCount + 1 },
      reports: expect.arrayContaining([expect.objectContaining({ sampleId: 'wz-runtime-dynamic-verified-001', outcome: 'passed' })]),
    })
    await app.close()
  })

  it('serializes concurrent WenZhen fixture saves without dropping either sample', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-wenzhen-concurrent-'))
    const app = await testApp('测试报告', { wenzhenRuntimeFixturePath: join(directory, 'runtime-wenzhen.json') })
    const authorization = { authorization: 'Bearer test-admin-token' }
    const basePayload = {
      source: 'wenzhen-admin-manual-capture',
      capturedAt: '2026-09-01T05:00:00Z',
      birth: { date: '1992-08-21', time: '12:03', calendarSystem: 'solar', placeCode: '330106', useTrueSolarTime: true, dstPolicy: 'auto', dayBoundary: 'midnight', luckMethod: 'sect1', gender: 'male' },
      expected: { pillars: ['壬申', '戊申', '己巳', '庚午'] },
    }

    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST', url: '/v1/bazi/wenzhen/fixtures', headers: authorization,
        payload: { ...basePayload, sampleId: 'wz-concurrent-001', evidenceRef: `evidence/wenzhen/sha256-${'2'.repeat(64)}.png` },
      }),
      app.inject({
        method: 'POST', url: '/v1/bazi/wenzhen/fixtures', headers: authorization,
        payload: { ...basePayload, sampleId: 'wz-concurrent-002', evidenceRef: `evidence/wenzhen/sha256-${'3'.repeat(64)}.png` },
      }),
    ])
    expect([first.statusCode, second.statusCode]).toEqual([201, 201])

    const diff = await app.inject({ method: 'GET', url: '/v1/bazi/wenzhen/diff' })
    expect(diff.statusCode).toBe(200)
    expect(diff.json().totals).toMatchObject({ reportable: baselineWenzhenSampleIds.length + 2, matched: baselineWenzhenSampleIds.length + 2, mismatched: 0 })
    expect(diff.json().reports.map((report: { sampleId: string }) => report.sampleId).sort()).toEqual([
      ...baselineWenzhenSampleIds,
      'wz-concurrent-001',
      'wz-concurrent-002',
    ])
    await app.close()
  })

  it('lets administrators accept a fully explained WenZhen difference with server-owned review identity', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    vi.stubEnv('ADMIN_ACTOR_ID', 'knowledge-editor')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-wenzhen-accepted-'))
    const runtimeFixturePath = join(directory, 'runtime-wenzhen.json')
    const app = await testApp('测试报告', { wenzhenRuntimeFixturePath: runtimeFixturePath })
    const response = await app.inject({
      method: 'POST',
      url: '/v1/bazi/wenzhen/fixtures',
      headers: { authorization: 'Bearer test-admin-token' },
      payload: {
        sampleId: 'wz-runtime-accepted-001',
        source: 'wenzhen-admin-manual-capture',
        status: 'accepted-difference',
        capturedAt: '2026-09-01T05:00:00Z',
        evidenceRef: `evidence/wenzhen/sha256-${'4'.repeat(64)}.png`,
        birth: { date: '1992-08-21', time: '12:03', calendarSystem: 'solar', placeCode: '330106', useTrueSolarTime: true, dstPolicy: 'auto', dayBoundary: 'midnight', luckMethod: 'sect1', gender: 'male' },
        expected: { pillars: ['癸酉', '戊申', '己巳', '庚午'] },
        acceptedDifferences: [{ path: 'pillars[0]', reason: '人工复核确认问真截图中的年柱与当前规则版本存在已知口径差异', classification: 'school-rule' }],
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      fixture: {
        status: 'accepted-difference',
        acceptedBy: 'knowledge-editor',
        acceptedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        acceptedDifferences: [{ path: 'pillars[0]', classification: 'school-rule' }],
      },
      report: {
        outcome: 'accepted-difference',
        staleAcceptedPaths: [],
        differences: [{ path: 'pillars[0]', accepted: true }],
      },
    })
    const persisted = JSON.parse(await readFile(runtimeFixturePath, 'utf8')) as { samples: unknown[] }
    expect(persisted.samples).toEqual([
      expect.objectContaining({
        sampleId: 'wz-runtime-accepted-001',
        acceptedBy: 'knowledge-editor',
        acceptedDifferences: [{
          path: 'pillars[0]',
          reason: '人工复核确认问真截图中的年柱与当前规则版本存在已知口径差异',
          classification: 'school-rule',
        }],
      }),
    ])
    await app.close()
  })

  it('persists accepted dynamic WenZhen differences with admin auth and rejects unauthorized requests', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    vi.stubEnv('ADMIN_ACTOR_ID', 'knowledge-editor')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-wenzhen-dynamic-accepted-'))
    const app = await testApp('测试报告', { wenzhenRuntimeFixturePath: join(directory, 'runtime-wenzhen.json') })
    const birth = dynamicWenzhenBirth
    const flowQuery = dynamicWenzhenFlowQuery
    const { expected, selection, hourlyPillar } = await dynamicWenzhenExpected(app, birth, flowQuery)
    const acceptedPath = `hourlyCycles{startHour=${selection.hourSlotStart}}.pillar`
    const payload = {
      sampleId: 'wz-runtime-dynamic-accepted-001',
      source: 'wenzhen-admin-manual-capture',
      status: 'accepted-difference',
      capturedAt: '2026-09-01T05:00:00Z',
      evidenceRef: `evidence/wenzhen/sha256-${'8'.repeat(64)}.png`,
      birth,
      flowQuery,
      expected: {
        pillars: expected.pillars,
        hourlyCycles: [{
          startHour: selection.hourSlotStart,
          pillar: hourlyPillar === '甲子' ? '乙丑' : '甲子',
        }],
      },
      acceptedDifferences: [{ path: acceptedPath, reason: '人工复核确认动态时柱与问真截图存在已知口径差异', classification: 'school-rule' }],
    }

    const unauthorizedAttempt = await app.inject({
      method: 'POST', url: '/v1/bazi/wenzhen/fixtures',
      headers: { authorization: 'Bearer wrong-token' },
      payload,
    })
    expect(unauthorizedAttempt.statusCode).toBe(401)

    const adminAttempt = await app.inject({
      method: 'POST', url: '/v1/bazi/wenzhen/fixtures',
      headers: { authorization: 'Bearer test-admin-token' },
      payload,
    })
    expect(adminAttempt.statusCode).toBe(201)
    expect(adminAttempt.json()).toMatchObject({
      fixture: { status: 'accepted-difference', acceptedBy: 'knowledge-editor', flowQuery },
      report: {
        outcome: 'accepted-difference',
        staleAcceptedPaths: [],
        differences: [{ path: acceptedPath, accepted: true }],
      },
    })
    await app.close()
  })

  it('round-trips preview leaf paths into accepted differences and rejects missing or stale paths', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    vi.stubEnv('ADMIN_ACTOR_ID', 'knowledge-editor')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-wenzhen-preview-accept-'))
    const app = await testApp('test report', { wenzhenRuntimeFixturePath: join(directory, 'runtime-wenzhen.json') })
    const birth = {
      date: '1992-08-21', time: '12:03', calendarSystem: 'solar', placeCode: '330106',
      useTrueSolarTime: true, dstPolicy: 'auto', dayBoundary: 'midnight', luckMethod: 'sect1', gender: 'male',
    }
    const expected = { pillars: ['癸酉', '丁未', '己巳', '庚午'] }
    const preview = await app.inject({ method: 'POST', url: '/v1/bazi/compare', payload: {
      sampleId: 'wz-preview-roundtrip-001',
      source: 'wenzhen-admin-manual-check',
      birth,
      expected,
    } })
    expect(preview.statusCode).toBe(200)
    const previewReport = preview.json().report as {
      pathSemantics: string
      mismatches: { path: string }[]
    }
    const previewPaths = previewReport.mismatches.map((item) => item.path)
    expect(previewReport.pathSemantics).toBe('wenzhen-leaf-v1')
    expect(previewPaths).toEqual(['pillars[0]', 'pillars[1]'])

    const basePayload = {
      sampleId: 'wz-preview-roundtrip-001',
      source: 'wenzhen-admin-manual-capture',
      status: 'accepted-difference',
      capturedAt: '2026-09-01T05:00:00Z',
      evidenceRef: `evidence/wenzhen/sha256-${'6'.repeat(64)}.png`,
      birth,
      expected,
    }
    const acceptedDifferences = previewPaths.map((path) => ({
      path,
      reason: `expert reviewed ${path}`,
      classification: 'school-rule',
    }))
    const authorization = { authorization: 'Bearer test-admin-token' }

    const incomplete = await app.inject({
      method: 'POST', url: '/v1/bazi/wenzhen/fixtures', headers: authorization,
      payload: { ...basePayload, acceptedDifferences: acceptedDifferences.slice(0, 1) },
    })
    expect(incomplete.statusCode).toBe(400)

    const stale = await app.inject({
      method: 'POST', url: '/v1/bazi/wenzhen/fixtures', headers: authorization,
      payload: {
        ...basePayload,
        acceptedDifferences: [
          ...acceptedDifferences,
          { path: 'pillars[3]', reason: 'stale preview path', classification: 'school-rule' },
        ],
      },
    })
    expect(stale.statusCode).toBe(400)

    const created = await app.inject({
      method: 'POST', url: '/v1/bazi/wenzhen/fixtures', headers: authorization,
      payload: { ...basePayload, acceptedDifferences },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({
      fixture: {
        status: 'accepted-difference',
        acceptedBy: 'knowledge-editor',
        acceptedDifferences,
      },
      report: {
        outcome: 'accepted-difference',
        staleAcceptedPaths: [],
      },
    })
    expect(created.json().report.differences.map((item: { path: string }) => item.path)).toEqual(previewPaths)
    await app.close()
  })

  it('requires and persists flowQuery for dynamic WenZhen cycle expectations', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-wenzhen-flow-'))
    const runtimeFixturePath = join(directory, 'runtime-wenzhen.json')
    const app = await testApp('test report', { wenzhenRuntimeFixturePath: runtimeFixturePath })
    const { expected } = await dynamicWenzhenExpected(app, dynamicWenzhenBirth, dynamicWenzhenFlowQuery)

    const missingFlow = await app.inject({
      method: 'POST',
      url: '/v1/bazi/compare',
      payload: {
        sampleId: 'wz-flow-preview-001',
        source: 'wenzhen-admin-manual-check',
        birth: dynamicWenzhenBirth,
        expected,
      },
    })
    expect(missingFlow.statusCode).toBe(400)
    expect(missingFlow.json().error).toContain('flowQuery is required')

    const preview = await app.inject({
      method: 'POST',
      url: '/v1/bazi/compare',
      payload: {
        sampleId: 'wz-flow-preview-001',
        source: 'wenzhen-admin-manual-check',
        birth: dynamicWenzhenBirth,
        flowQuery: dynamicWenzhenFlowQuery,
        expected,
      },
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.json().report).toMatchObject({
      sampleId: 'wz-flow-preview-001',
      matched: true,
      mismatches: [],
      pathSemantics: 'wenzhen-leaf-v1',
    })

    const saved = await app.inject({
      method: 'POST',
      url: '/v1/bazi/wenzhen/fixtures',
      headers: { authorization: 'Bearer test-admin-token' },
      payload: {
        sampleId: 'wz-flow-runtime-001',
        source: 'wenzhen-admin-manual-capture',
        capturedAt: '2026-09-01T05:00:00Z',
        evidenceRef: `evidence/wenzhen/sha256-${'7'.repeat(64)}.png`,
        birth: dynamicWenzhenBirth,
        flowQuery: dynamicWenzhenFlowQuery,
        expected,
      },
    })
    expect(saved.statusCode).toBe(201)
    expect(saved.json()).toMatchObject({
      fixture: {
        sampleId: 'wz-flow-runtime-001',
        flowQuery: dynamicWenzhenFlowQuery,
      },
      report: {
        outcome: 'passed',
        assertionCoverage: { categories: expect.arrayContaining(['dynamic-cycles']) },
      },
    })
    const persisted = JSON.parse(await readFile(runtimeFixturePath, 'utf8')) as { samples: unknown[] }
    expect(persisted.samples).toEqual([expect.objectContaining({
      sampleId: 'wz-flow-runtime-001',
      flowQuery: dynamicWenzhenFlowQuery,
    })])
    await app.close()
  })

  it('fail-closes malformed, incomplete, stale, matched, and client-forged accepted differences', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    vi.stubEnv('ADMIN_ACTOR_ID', 'knowledge-editor')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-wenzhen-invalid-accepted-'))
    const app = await testApp('测试报告', { wenzhenRuntimeFixturePath: join(directory, 'runtime-wenzhen.json') })
    const authorization = { authorization: 'Bearer test-admin-token' }
    const basePayload = {
      source: 'wenzhen-admin-manual-capture',
      status: 'accepted-difference',
      capturedAt: '2026-09-01T05:00:00Z',
      evidenceRef: `evidence/wenzhen/sha256-${'5'.repeat(64)}.png`,
      birth: { date: '1992-08-21', time: '12:03', calendarSystem: 'solar', placeCode: '330106', useTrueSolarTime: true, dstPolicy: 'auto', dayBoundary: 'midnight', luckMethod: 'sect1', gender: 'male' },
    }
    const mismatchExpected = { pillars: ['癸酉', '丁未', '己巳', '庚午'] }
    const cases = [
      {
        sampleId: 'wz-accepted-missing-reason',
        expected: mismatchExpected,
        acceptedDifferences: [{ path: 'pillars[0]', reason: '', classification: 'school-rule' }, { path: 'pillars[1]', reason: '已复核', classification: 'school-rule' }],
      },
      {
        sampleId: 'wz-accepted-missing-path',
        expected: mismatchExpected,
        acceptedDifferences: [{ path: 'pillars[0]', reason: '仅接受第一处差异', classification: 'school-rule' }],
      },
      {
        sampleId: 'wz-accepted-stale-path',
        expected: { pillars: ['癸酉', '戊申', '己巳', '庚午'] },
        acceptedDifferences: [{ path: 'pillars[0]', reason: '真实差异', classification: 'dependency' }, { path: 'pillars[1]', reason: '过期差异路径', classification: 'dependency' }],
      },
      {
        sampleId: 'wz-accepted-matched',
        expected: { pillars: ['壬申', '戊申', '己巳', '庚午'] },
        acceptedDifferences: [{ path: 'pillars[0]', reason: '不能给一致样例伪造差异', classification: 'display-rounding' }],
      },
      {
        sampleId: 'wz-accepted-forged-actor',
        expected: { pillars: ['癸酉', '戊申', '己巳', '庚午'] },
        acceptedDifferences: [{ path: 'pillars[0]', reason: '已复核', classification: 'timezone-location' }],
        acceptedAt: '2020-01-01T00:00:00Z',
        acceptedBy: 'client-forged-reviewer',
      },
      {
        sampleId: 'wz-accepted-missing-classification',
        expected: { pillars: ['癸酉', '戊申', '己巳', '庚午'] },
        acceptedDifferences: [{ path: 'pillars[0]', reason: '新提交必须选择差异分类' }],
      },
      {
        sampleId: 'wz-accepted-invalid-classification',
        expected: { pillars: ['癸酉', '戊申', '己巳', '庚午'] },
        acceptedDifferences: [{ path: 'pillars[0]', reason: '非法分类不得入库', classification: 'implementation-detail' }],
      },
      {
        sampleId: 'wz-accepted-bug-classification',
        expected: { pillars: ['癸酉', '戊申', '己巳', '庚午'] },
        acceptedDifferences: [{ path: 'pillars[0]', reason: '已确认为产品缺陷', classification: 'bug' }],
      },
    ]

    for (const item of cases) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/bazi/wenzhen/fixtures',
        headers: authorization,
        payload: { ...basePayload, ...item },
      })
      expect(response.statusCode, item.sampleId).toBe(400)
    }

    const diff = await app.inject({ method: 'GET', url: '/v1/bazi/wenzhen/diff' })
    expect(diff.statusCode).toBe(200)
    expect(diff.json().totals.reportable).toBe(baselineWenzhenSampleIds.length)
    expect(diff.json().reports).toEqual(expect.arrayContaining(baselineWenzhenSampleIds.map((sampleId) => expect.objectContaining({ sampleId, outcome: 'passed' }))))
    await app.close()
  })

  it('rejects malformed external comparison pillars', async () => {
    const app = await testApp()
    const response = await app.inject({ method: 'POST', url: '/v1/bazi/compare', payload: {
      sampleId: 'bad', source: 'manual',
      birth: persistableBirth(),
      expected: { pillars: ['壬申'] },
    } })
    expect(response.statusCode).toBe(400)
    await app.close()
  })

  it('accepts a selected district and lunar calendar settings as traceable chart input', async () => {
    const app = await testApp()
    const response = await app.inject({ method: 'POST', url: '/v1/bazi', payload: {
      calendarSystem: 'lunar', date: '2024-01-01', time: '12:00',
      province: '北京市', city: '北京市', district: '东城区', useTrueSolarTime: false,
    } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      birth: {
        calendarSystem: 'lunar',
        province: '北京市',
        city: '北京市',
        district: '东城区',
        locationName: '北京市 北京市 东城区',
        longitude: 116.41834,
        latitude: 39.93264,
        timezone: 'Asia/Shanghai',
      },
      bazi: {
        calendarRuleVersion: 'calendar-v2-round-trip-lunar-typescript',
        timeCorrectionRuleVersion: 'civil-time-v1-no-solar-correction',
        correctionMinutes: 0,
        inputSnapshot: { normalizedSolarDate: '2024-02-10', latitude: 39.93264 },
      },
    })
    await app.close()
  })

  it('rejects an invalid standalone chart request', async () => {
    const app = await testApp()
    const response = await app.inject({ method: 'POST', url: '/v1/bazi', payload: { date: 'not-a-date' } })
    expect(response.statusCode).toBe(400)
    await app.close()
  })

  it('requires an authoritative birthplace code for every new persisted chart version and unbound report', async () => {
    const app = await testApp()
    const legacyBirth = { date: '1992-08-18', time: '09:30', locationName: '杭州市', longitude: 120.1551 }

    const chartRejected = await app.inject({ method: 'POST', url: '/v1/charts', payload: legacyBirth })
    expect(chartRejected.statusCode).toBe(400)
    expect(chartRejected.json()).toEqual({ error: 'valid birth date, time and a non-empty birthplace code are required to save a chart' })

    const emptyCodeRejected = await app.inject({ method: 'POST', url: '/v1/charts', payload: { ...legacyBirth, placeCode: '  ' } })
    expect(emptyCodeRejected.statusCode).toBe(400)
    expect(emptyCodeRejected.json()).toEqual({ error: 'valid birth date, time and a non-empty birthplace code are required to save a chart' })

    const created = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth() })
    expect(created.statusCode).toBe(201)
    const cookie = String(created.headers['set-cookie']).split(';')[0]
    const versionRejected = await app.inject({
      method: 'POST',
      url: `/v1/charts/${created.json().profile.id}/versions`,
      headers: { cookie },
      payload: { ...legacyBirth, expectedRevision: 1 },
    })
    expect(versionRejected.statusCode).toBe(400)
    expect(versionRejected.json()).toEqual({ error: 'valid birth date, time, a non-empty birthplace code and expectedRevision are required to save a chart version' })

    const reportRejected = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: {
        visionConsent: true,
        birth: legacyBirth,
        residence: { facing: 'south' },
        photos: [{ fileId: 'private-photo-id.jpg', room: 'living-room', facing: 'south' }],
      },
    })
    expect(reportRejected.statusCode).toBe(400)
    expect(reportRejected.json()).toEqual({ error: 'valid birth date, time and a non-empty birthplace code are required to create a report without a saved chart version' })
    await app.close()
  })

  it('creates, restores and versions an anonymous chart using an opaque cookie', async () => {
    const app = await testApp()
    const created = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth() })
    expect(created.statusCode).toBe(201)
    expect(created.headers['set-cookie']).toContain('fengshui_principal=')
    expect(created.headers['set-cookie']).toContain('HttpOnly')
    expect(created.json().profile).toMatchObject({ revision: 1, currentVersion: { version: 1, birth: { placeCode: '330106', locationName: '浙江省 杭州市 西湖区' } } })
    expect(created.json().profile.currentVersion.bazi.timeProfile.runtimeProvenance).toEqual({
      provider: 'node-intl',
      nodeVersion: process.versions.node,
      ...(process.versions.icu ? { icuVersion: process.versions.icu } : {}),
      ...(process.versions.tz ? { tzdbVersion: process.versions.tz } : {}),
      ...(process.versions.unicode ? { unicodeVersion: process.versions.unicode } : {}),
      ...(process.versions.cldr ? { cldrVersion: process.versions.cldr } : {}),
    })

    const cookie = String(created.headers['set-cookie']).split(';')[0]
    const restored = await app.inject({ method: 'GET', url: '/v1/charts/current', headers: { cookie } })
    expect(restored.json().profile.id).toBe(created.json().profile.id)
    expect(restored.json().profile.currentVersion.bazi.timeProfile.runtimeProvenance)
      .toEqual(created.json().profile.currentVersion.bazi.timeProfile.runtimeProvenance)

    const updated = await app.inject({ method: 'POST', url: `/v1/charts/${created.json().profile.id}/versions`, headers: { cookie }, payload: {
      ...persistableBirth('10:30'), expectedRevision: 1,
    } })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().profile).toMatchObject({ revision: 2, currentVersion: { version: 2, birth: { time: '10:30' } } })

    const stale = await app.inject({ method: 'POST', url: `/v1/charts/${created.json().profile.id}/versions`, headers: { cookie }, payload: {
      ...persistableBirth('11:30'), expectedRevision: 1,
    } })
    expect(stale.statusCode).toBe(409)

    const versions = await app.inject({ method: 'GET', url: `/v1/charts/${created.json().profile.id}/versions`, headers: { cookie } })
    expect(versions.statusCode).toBe(200)
    expect(versions.json().versions.map((version: { version: number }) => version.version)).toEqual([2, 1])
    await app.close()
  })

  it('creates and lists multiple named chart profiles for the same anonymous principal', async () => {
    const app = await testApp()
    expect((await app.inject({ method: 'GET', url: '/v1/charts' })).json()).toEqual({ profiles: [] })

    const ownChart = await app.inject({
      method: 'POST',
      url: '/v1/charts',
      payload: { ...persistableBirth(), label: '  我的命盘  ', relationship: 'self' },
    })
    expect(ownChart.statusCode).toBe(201)
    expect(ownChart.json().profile).toMatchObject({ label: '我的命盘', relationship: 'self' })
    const cookie = String(ownChart.headers['set-cookie']).split(';')[0]

    const familyChart = await app.inject({
      method: 'POST',
      url: '/v1/charts',
      headers: { cookie },
      payload: { ...persistableBirth('10:30'), label: '妈妈', relationship: 'parent' },
    })
    expect(familyChart.statusCode).toBe(201)
    expect(familyChart.json().profile).toMatchObject({ label: '妈妈', relationship: 'parent' })
    expect(familyChart.json().profile.id).not.toBe(ownChart.json().profile.id)

    const listed = await app.inject({ method: 'GET', url: '/v1/charts', headers: { cookie } })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().profiles).toHaveLength(2)
    expect(listed.json().profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ownChart.json().profile.id, label: '我的命盘', relationship: 'self' }),
      expect.objectContaining({ id: familyChart.json().profile.id, label: '妈妈', relationship: 'parent' }),
    ]))

    const current = await app.inject({ method: 'GET', url: '/v1/charts/current', headers: { cookie } })
    expect(current.statusCode).toBe(200)
    expect(current.json().profile.id).toBe(familyChart.json().profile.id)
    await app.close()
  })

  it('validates chart profile labels and relationships before persisting a chart', async () => {
    const app = await testApp()
    const emptyLabel = await app.inject({
      method: 'POST',
      url: '/v1/charts',
      payload: { ...persistableBirth(), label: '   ', relationship: 'self' },
    })
    expect(emptyLabel.statusCode).toBe(400)
    expect(emptyLabel.json()).toEqual({ error: 'label must be between 1 and 40 characters' })

    const longLabel = await app.inject({
      method: 'POST',
      url: '/v1/charts',
      payload: { ...persistableBirth(), label: 'x'.repeat(41), relationship: 'self' },
    })
    expect(longLabel.statusCode).toBe(400)

    const invalidRelationship = await app.inject({
      method: 'POST',
      url: '/v1/charts',
      payload: { ...persistableBirth(), label: '测试', relationship: 'friend' },
    })
    expect(invalidRelationship.statusCode).toBe(400)
    expect(invalidRelationship.json()).toEqual({ error: 'relationship must be one of self, partner, parent, child or other' })
    await app.close()
  })

  it('exports the requested immutable chart version as a private PDF download', async () => {
    const rendered: Array<{ version?: number; time: string }> = []
    const app = await testApp('测试报告', { chartPdfRenderer: {
      render: async (snapshot) => {
        rendered.push({ version: snapshot.version, time: snapshot.birth.time })
        return Buffer.from('%PDF-1.7\nexact historical chart')
      },
    } })
    const created = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth() })
    const cookie = String(created.headers['set-cookie']).split(';')[0]
    const profileId = created.json().profile.id as string
    const firstVersionId = created.json().profile.currentVersion.id as string
    const updated = await app.inject({
      method: 'POST',
      url: `/v1/charts/${profileId}/versions`,
      headers: { cookie },
      payload: { ...persistableBirth('10:30'), expectedRevision: 1 },
    })
    expect(updated.statusCode).toBe(200)

    const response = await app.inject({
      method: 'GET',
      url: `/v1/charts/${profileId}/versions/${firstVersionId}/pdf`,
      headers: { cookie },
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('application/pdf')
    expect(response.headers['content-disposition']).toBe('attachment; filename="bazi-chart-v1.pdf"')
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
    expect(rendered).toEqual([{ version: 1, time: '09:30' }])
    await app.close()
  })

  it('does not expose chart PDF versions without ownership and keeps deleted owner history available', async () => {
    const renderer: ChartPdfRenderer = { render: async () => Buffer.from('%PDF-1.7\nprivate') }
    const app = await testApp('测试报告', { chartPdfRenderer: renderer })
    const created = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth() })
    const ownerCookie = String(created.headers['set-cookie']).split(';')[0]
    const profileId = created.json().profile.id as string
    const versionId = created.json().profile.currentVersion.id as string
    expect((await app.inject({ method: 'GET', url: `/v1/charts/${profileId}/versions/${versionId}/pdf` })).statusCode).toBe(401)

    const other = await app.inject({
      method: 'POST',
      url: '/v1/charts',
      payload: { date: '1993-01-01', time: '08:00', placeCode: '110101' },
    })
    const otherCookie = String(other.headers['set-cookie']).split(';')[0]
    const crossOwner = await app.inject({
      method: 'GET',
      url: `/v1/charts/${profileId}/versions/${versionId}/pdf`,
      headers: { cookie: otherCookie },
    })
    expect(crossOwner.statusCode).toBe(404)
    expect(crossOwner.json()).toEqual({ error: 'chart or version not found' })

    await app.inject({ method: 'DELETE', url: `/v1/charts/${profileId}`, headers: { cookie: ownerCookie } })
    const deletedOwnerExport = await app.inject({
      method: 'GET',
      url: `/v1/charts/${profileId}/versions/${versionId}/pdf`,
      headers: { cookie: ownerCookie },
    })
    expect(deletedOwnerExport.statusCode).toBe(200)
    await app.close()
  })

  it('returns a stable 503 response when the chart PDF runtime is unavailable', async () => {
    const app = await testApp('测试报告', { chartPdfRenderer: {
      render: async () => { throw new ChartPdfUnavailableError('local browser path must stay private') },
    } })
    const created = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth() })
    const cookie = String(created.headers['set-cookie']).split(';')[0]
    const profile = created.json().profile
    const response = await app.inject({
      method: 'GET',
      url: `/v1/charts/${profile.id}/versions/${profile.currentVersion.id}/pdf`,
      headers: { cookie },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'chart PDF generation unavailable' })
    expect(response.body).not.toContain('local browser path')
    await app.close()
  })

  it('restores a historical chart version by appending a new audited current version', async () => {
    const app = await testApp()
    const created = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth() })
    const cookie = String(created.headers['set-cookie']).split(';')[0]
    const profileId = created.json().profile.id as string
    const originalVersionId = created.json().profile.currentVersion.id as string
    const updated = await app.inject({ method: 'POST', url: `/v1/charts/${profileId}/versions`, headers: { cookie }, payload: {
      ...persistableBirth('10:30'), expectedRevision: 1,
    } })
    expect(updated.statusCode).toBe(200)

    const restored = await app.inject({
      method: 'POST',
      url: `/v1/charts/${profileId}/versions/${originalVersionId}/restore`,
      headers: { cookie },
      payload: {
        expectedRevision: 2,
        date: '2001-01-01',
        time: '23:59',
        locationName: '客户端不应覆盖',
        longitude: 1,
      },
    })
    expect(restored.statusCode).toBe(200)
    expect(restored.json().profile).toMatchObject({
      id: profileId,
      revision: 3,
      currentVersion: {
        version: 3,
        birth: { time: '09:30', placeCode: '330106', locationName: '浙江省 杭州市 西湖区', longitude: 120.13333 },
        restoredFromVersionId: originalVersionId,
      },
    })
    expect(restored.json().profile.currentVersion.id).not.toBe(originalVersionId)

    const versions = await app.inject({ method: 'GET', url: `/v1/charts/${profileId}/versions`, headers: { cookie } })
    expect(versions.statusCode).toBe(200)
    expect(versions.json().versions.map((version: { version: number }) => version.version)).toEqual([3, 2, 1])
    expect(versions.json().versions[2]).toMatchObject({ id: originalVersionId, version: 1, birth: { time: '09:30' } })
    expect(versions.json().versions[0]).toMatchObject({ restoredFromVersionId: originalVersionId })
    await app.close()
  })

  it('rejects historical chart version restore without ownership, current revision, or active profile', async () => {
    const ownerApp = await testApp()
    const created = await ownerApp.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth() })
    const cookie = String(created.headers['set-cookie']).split(';')[0]
    const profileId = created.json().profile.id as string
    const versionId = created.json().profile.currentVersion.id as string

    const unauthenticated = await ownerApp.inject({
      method: 'POST',
      url: `/v1/charts/${profileId}/versions/${versionId}/restore`,
      payload: { expectedRevision: 1 },
    })
    expect(unauthenticated.statusCode).toBe(401)

    const other = await ownerApp.inject({ method: 'POST', url: '/v1/charts', payload: {
      date: '1993-01-01', time: '08:00', placeCode: '110101',
    } })
    const otherCookie = String(other.headers['set-cookie']).split(';')[0]
    const crossPrincipal = await ownerApp.inject({
      method: 'POST',
      url: `/v1/charts/${profileId}/versions/${versionId}/restore`,
      headers: { cookie: otherCookie },
      payload: { expectedRevision: 1 },
    })
    expect(crossPrincipal.statusCode).toBe(404)

    const stale = await ownerApp.inject({
      method: 'POST',
      url: `/v1/charts/${profileId}/versions/${versionId}/restore`,
      headers: { cookie },
      payload: { expectedRevision: 0 },
    })
    expect(stale.statusCode).toBe(409)

    const currentVersion = await ownerApp.inject({
      method: 'POST',
      url: `/v1/charts/${profileId}/versions/${versionId}/restore`,
      headers: { cookie },
      payload: { expectedRevision: 1 },
    })
    expect(currentVersion.statusCode).toBe(409)
    expect(currentVersion.json().error).toContain('current chart version')

    const missingVersion = await ownerApp.inject({
      method: 'POST',
      url: `/v1/charts/${profileId}/versions/${crypto.randomUUID()}/restore`,
      headers: { cookie },
      payload: { expectedRevision: 1 },
    })
    expect(missingVersion.statusCode).toBe(404)

    expect((await ownerApp.inject({ method: 'DELETE', url: `/v1/charts/${profileId}`, headers: { cookie } })).statusCode).toBe(204)
    const deleted = await ownerApp.inject({
      method: 'POST',
      url: `/v1/charts/${profileId}/versions/${versionId}/restore`,
      headers: { cookie },
      payload: { expectedRevision: 1 },
    })
    expect(deleted.statusCode).toBe(409)
    expect(deleted.json().error).toContain('deleted chart profile')
    await ownerApp.close()
  })

  it('does not expose chart mutation to a browser without the anonymous credential', async () => {
    const app = await testApp()
    const created = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth() })
    const profileId = created.json().profile.id
    const update = await app.inject({ method: 'POST', url: `/v1/charts/${profileId}/versions`, payload: {
      date: '1992-08-18', time: '10:30', locationName: '杭州市', longitude: 120.1551, expectedRevision: 1,
    } })
    const remove = await app.inject({ method: 'DELETE', url: `/v1/charts/${profileId}` })
    const versions = await app.inject({ method: 'GET', url: `/v1/charts/${profileId}/versions` })
    const restore = await app.inject({ method: 'POST', url: `/v1/charts/${profileId}/restore` })
    expect(update.statusCode).toBe(401)
    expect(remove.statusCode).toBe(401)
    expect(versions.statusCode).toBe(401)
    expect(restore.statusCode).toBe(401)
    await app.close()
  })

  it('soft-deletes and restores a chart profile with historical versions intact', async () => {
    const app = await testApp()
    const created = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth() })
    const cookie = String(created.headers['set-cookie']).split(';')[0]
    const profileId = created.json().profile.id
    const updated = await app.inject({ method: 'POST', url: `/v1/charts/${profileId}/versions`, headers: { cookie }, payload: {
      ...persistableBirth('10:30'), expectedRevision: 1,
    } })
    expect(updated.statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: `/v1/charts/${profileId}`, headers: { cookie } })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/v1/charts/current', headers: { cookie } })).json()).toEqual({ profile: null })
    const versionsWhileDeleted = await app.inject({ method: 'GET', url: `/v1/charts/${profileId}/versions`, headers: { cookie } })
    expect(versionsWhileDeleted.statusCode).toBe(200)
    expect(versionsWhileDeleted.json().versions).toHaveLength(2)
    const restored = await app.inject({ method: 'POST', url: `/v1/charts/${profileId}/restore`, headers: { cookie } })
    expect(restored.statusCode).toBe(200)
    expect(restored.json().profile).toMatchObject({ id: profileId, revision: 2, currentVersion: { version: 2 } })
    expect((await app.inject({ method: 'GET', url: '/v1/charts/current', headers: { cookie } })).json().profile.id).toBe(profileId)
    await app.close()
  })

  it('returns a conflict when restoring a chart would exceed the active profile limit', async () => {
    const app = await testApp()
    const archived = await app.inject({ method: 'POST', url: '/v1/charts', payload: { ...persistableBirth(), label: '待恢复命盘' } })
    const cookie = String(archived.headers['set-cookie']).split(';')[0]
    const archivedProfileId = archived.json().profile.id as string
    expect((await app.inject({ method: 'DELETE', url: `/v1/charts/${archivedProfileId}`, headers: { cookie } })).statusCode).toBe(204)
    for (let index = 0; index < 10; index += 1) {
      const created = await app.inject({
        method: 'POST',
        url: '/v1/charts',
        headers: { cookie },
        payload: { ...persistableBirth(), label: `活跃命盘 ${index + 1}`, relationship: 'other' },
      })
      expect(created.statusCode).toBe(201)
    }

    const restored = await app.inject({ method: 'POST', url: `/v1/charts/${archivedProfileId}/restore`, headers: { cookie } })
    expect(restored.statusCode).toBe(409)
    expect(restored.json().error).toContain('limit exceeded')
    await app.close()
  })

  it('rejects a report without photo evidence', async () => {
    const app = await testApp()
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: { birth: {} } })
    expect(response.statusCode).toBe(400)
    await app.close()
  })

  it('rejects an otherwise valid report without explicit vision consent', async () => {
    const app = await testApp()
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: {
        birth: { date: '1992-08-18', time: '09:30', locationName: '杭州市', longitude: 120.1551 },
        residence: { facing: 'south' },
        photos: [{ fileId: 'private-photo-id.jpg', room: 'living-room', facing: 'south' }],
      },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('consent')
    await app.close()
  })

  it('rejects report jobs with more than 12 photos', async () => {
    const app = await testApp()
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: {
        visionConsent: true,
        birth: { date: '1992-08-18', time: '09:30', locationName: '杭州市', longitude: 120.1551 },
        residence: { facing: 'south' },
        photos: Array.from({ length: 13 }, (_, index) => ({ fileId: `photo-${index}.jpg`, room: 'living-room', facing: 'south' })),
      },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('1-12 photos')
    await app.close()
  })

  it('requires chartVersionId whenever chartProfileId is provided', async () => {
    const app = await testApp()
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: {
        visionConsent: true,
        chartProfileId: 'chart-profile-without-version',
        birth: { date: '1992-08-18', time: '09:30', locationName: '杭州市', longitude: 120.1551 },
        residence: { facing: 'south' },
        photos: [{ fileId: 'private-photo-id.jpg', room: 'living-room', facing: 'south' }],
      },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'chartVersionId is required with chartProfileId' })
    await app.close()
  })

  it('persists a failed report when vision analysis throws', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-vision-failure-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '不应生成' }),
      { analyze: async () => { throw new Error('simulated vision failure') } },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south' },
      photos: [{ fileId: 'vision-failure.jpg', room: 'living-room', facing: 'south' }],
    } })
    expect(response.statusCode).toBe(202)
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'failed',
      phase: 'failed',
      error: '图片识别失败：simulated vision failure',
    }))
    await app.close()
  })

  it('persists a failed report when report generation throws', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-generator-failure-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => { throw new Error('simulated report generator failure') },
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south' },
      photos: [{ fileId: 'generator-failure.jpg', room: 'living-room', facing: 'south' }],
    } })
    expect(response.statusCode).toBe(202)
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'failed',
      phase: 'failed',
      error: 'Harness 报告生成失败：simulated report generator failure',
    }))
    const stored = await repository.get(response.json().id)
    expect(stored?.stageTimings?.map((timing) => [timing.phase, timing.outcome])).toEqual([
      ['vision-analyzing', 'completed'],
      ['rules-evaluating', 'completed'],
      ['harness-generating', 'failed'],
    ])
    expectFailedTiming(stored?.stageTimings?.at(-1), 'harness-generating')
    await app.close()
  })

  it('keeps the deterministic compatibility result when professional reasoning enhancement fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-professional-reasoning-failure-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    let generatedCompatibility: ReportRecord['compatibility']
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async (record) => {
        generatedCompatibility = record.compatibility
        return { report: '确定性报告' }
      },
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => { throw new Error('simulated malformed professional reasoning') },
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south' },
      photos: [{ fileId: 'reasoning-failure.jpg', room: 'living-room', facing: 'south' }],
    } })
    expect(response.statusCode).toBe(202)
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'completed',
      phase: 'completed',
      report: '确定性报告',
    }))
    expect(generatedCompatibility).toBeDefined()
    await app.close()
  })

  it('persists queued then failed when knowledge retrieval throws and keeps the report queryable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-knowledge-failure-'))
    const repository = new RecordingReportRepository(join(directory, 'reports.json'))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new SearchFailureKnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '不应生成' }),
      { analyze: async () => { throw new Error('vision must not run after knowledge failure') } },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south', layoutNote: '客厅连接阳台' },
      photos: [{ fileId: 'knowledge-failure.jpg', room: 'living-room', facing: 'south' }],
    } })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({ status: 'failed', phase: 'failed', error: 'Knowledge retrieval failed' })
    expect(JSON.stringify(response.json())).not.toContain('knowledge-failure.jpg')
    expect(repository.savedStatuses).toEqual(['queued', 'failed'])
    expect(repository.savedPhases).toEqual(['queued', 'failed'])
    const cookie = String(response.headers['set-cookie']).split(';')[0]
    const stored = await app.inject({ method: 'GET', url: `/v1/reports/${response.json().id}`, headers: { cookie } })
    expect(stored.statusCode).toBe(200)
    expect(stored.json()).toMatchObject({ status: 'failed', phase: 'failed', error: 'Knowledge retrieval failed' })
    expect((await app.inject({ method: 'GET', url: `/v1/reports/${response.json().id}` })).statusCode).toBe(404)
    await app.close()
  })

  it('recovers a persisted queued report when the API starts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-queued-recovery-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const birth = { date: '1992-08-18', time: '09:30', locationName: '杭州市', longitude: 120.1551 }
    const queued: ReportRecord = {
      id: 'queued-report-to-recover',
      status: 'queued',
      createdAt: new Date().toISOString(),
      submission: {
        visionConsent: true,
        calculationInput: birth,
        birth,
        residence: { facing: 'south' },
        photos: [{ fileId: 'queued-photo.jpg', room: 'living-room', facing: 'south' }],
      },
      bazi: calculateBazi(birth),
    }
    await repository.save(queued)
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '恢复后的报告' }),
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '恢复测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
    )
    await app.ready()
    await vi.waitFor(async () => expect(await repository.get(queued.id)).toMatchObject({
      status: 'completed',
      phase: 'completed',
      report: '恢复后的报告',
    }))
    await app.close()
  })

  it('resumes checkpointed vision without rerunning the vision analyzer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-resume-vision-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const queued = queuedReportRecord({
      id: 'checkpointed-vision-report',
      citations: [],
      vision: testVision(),
      pipelineCheckpoint: checkpoint({
        citations: { completedAt },
        vision: { completedAt },
      }),
    })
    await repository.save(queued)
    const analyzer = vi.fn(async () => { throw new Error('vision must not rerun') })
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '复用视觉报告' }),
      { analyze: analyzer },
      new ChartRepository(join(directory, 'charts.json')),
    )
    await app.ready()
    await vi.waitFor(async () => expect(await repository.get(queued.id)).toMatchObject({
      status: 'completed',
      report: '复用视觉报告',
      vision: [{ summary: '已持久化视觉结果' }],
      pipelineCheckpoint: {
        citations: { completedAt },
        vision: { completedAt },
        rules: { completedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u) },
        harnessDraft: { revisionAttempt: 0 },
      },
    }))
    expect(analyzer).not.toHaveBeenCalled()
    await app.close()
  })

  it('resumes checkpointed rules without rerunning vision or rule evaluation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-resume-rules-'))
    const repository = new RecordingReportRepository(join(directory, 'reports.json'))
    const queued = queuedReportRecord({
      id: 'checkpointed-rules-report',
      citations: [],
      vision: testVision(),
      evaluatedRules: [],
      compatibility: testCompatibility(),
      pipelineCheckpoint: checkpoint({
        citations: { completedAt },
        vision: { completedAt },
        rules: { completedAt },
        professionalReasoning: { completedAt, outcome: 'not-required' },
      }),
    })
    await repository.save(queued)
    const analyzer = vi.fn(async () => { throw new Error('vision must not rerun') })
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '复用规则报告' }),
      { analyze: analyzer },
      new ChartRepository(join(directory, 'charts.json')),
    )
    await app.ready()
    await vi.waitFor(async () => expect(await repository.get(queued.id)).toMatchObject({
      status: 'completed',
      report: '复用规则报告',
      evaluatedRules: [],
      compatibility: { overallLevel: 'insufficient-evidence' },
    }))
    expect(analyzer).not.toHaveBeenCalled()
    expect(repository.savedPhases).not.toContain('vision-analyzing')
    expect(repository.savedPhases).not.toContain('rules-evaluating')
    await app.close()
  })

  it('resumes a checkpointed validator-passing draft at quality review without rerunning the generator', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-resume-draft-quality-'))
    const repository = new RecordingReportRepository(join(directory, 'reports.json'))
    const queued = queuedReportRecord({
      id: 'checkpointed-draft-report',
      citations: [],
      vision: testVision(),
      evaluatedRules: [],
      compatibility: testCompatibility(),
      reviewDraft: {
        report: '已持久化草稿',
        generationProvenance: generationProvenance('pass'),
        createdAt: completedAt,
        revisionAttempt: 0,
      },
      pipelineCheckpoint: checkpoint({
        citations: { completedAt },
        vision: { completedAt },
        rules: { completedAt },
        professionalReasoning: { completedAt, outcome: 'not-required' },
        harnessDraft: { completedAt, revisionAttempt: 0 },
      }),
    })
    await repository.save(queued)
    const generator = vi.fn(async () => { throw new Error('generator must not rerun') })
    const reviewer = vi.fn<ReportQualityReviewer>(async (_record, draft, attempt) => {
      expect(draft).toMatchObject({ report: '已持久化草稿', generationProvenance: { validatorResult: 'pass' } })
      return qualityReview('pass', attempt)
    })
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      generator,
      { analyze: async () => { throw new Error('vision must not rerun') } },
      new ChartRepository(join(directory, 'charts.json')),
      new BaziRuleProfileRepository(join(directory, 'bazi-rule-profiles.json')),
      join(directory, 'wenzhen-fixtures.json'),
      new TestWenzhenEvidenceStore(join(directory, 'wenzhen-evidence')),
      reviewer,
      async (_record, draft) => draft,
    )
    await app.ready()
    await vi.waitFor(async () => expect(await repository.get(queued.id)).toMatchObject({
      status: 'completed',
      report: '已持久化草稿',
      qualityReviews: [{ verdict: 'pass', attempt: 0 }],
      pipelineCheckpoint: {
        qualityWorkflow: {
          event: 'review-completed',
          revisionCount: 0,
          draftHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
          reviewHashes: [expect.stringMatching(/^[a-f0-9]{64}$/u)],
        },
      },
    }))
    expect(generator).not.toHaveBeenCalled()
    expect(reviewer).toHaveBeenCalledTimes(1)
    expect(repository.savedPhases).toEqual(['queued', 'completed', 'quality-reviewing', 'completed'])
    await app.close()
  })

  it('resumes after a persisted revise review without repeating that review', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-resume-quality-progress-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const base = queuedReportRecord({ id: 'checkpointed-quality-progress-report' })
    const progress: ReportQualityWorkflowProgress[] = []
    await expect(runReportQualityWorkflow(
      base,
      { report: '待修订草稿', generationProvenance: generationProvenance('pass') },
      async () => qualityReview('revise', 0),
      async () => { throw new Error('simulated crash before revision') },
      undefined,
      { onProgress: async (entry) => { progress.push(entry) } },
    )).rejects.toThrow('simulated crash before revision')
    const savedProgress = progress.at(-1)!
    expect(savedProgress.event).toBe('review-completed')

    const queued = queuedReportRecord({
      ...base,
      citations: [],
      vision: testVision(),
      evaluatedRules: [],
      compatibility: testCompatibility(),
      reviewDraft: {
        report: savedProgress.report,
        generationProvenance: savedProgress.generationProvenance,
        createdAt: completedAt,
        revisionAttempt: savedProgress.revisionCount,
      },
      qualityReviews: savedProgress.qualityReviews,
      revisionCount: savedProgress.revisionCount,
      pipelineCheckpoint: checkpoint({
        citations: { completedAt },
        vision: { completedAt },
        rules: { completedAt },
        professionalReasoning: { completedAt, outcome: 'not-required' },
        harnessDraft: { completedAt, revisionAttempt: 0 },
        qualityWorkflow: {
          completedAt,
          event: savedProgress.event,
          draftHash: savedProgress.draftHash,
          reviewHashes: savedProgress.reviewHashes,
          revisionCount: savedProgress.revisionCount,
        },
      }),
    })
    await repository.save(queued)
    const reviewer = vi.fn<ReportQualityReviewer>(async (_record, draft, attempt) => {
      expect(attempt).toBe(1)
      expect(draft.report).toBe('修订后草稿')
      return qualityReview('pass', attempt)
    })
    const reviser = vi.fn<ReportReviser>(async (_record, draft, review, nextAttempt) => {
      expect(draft.report).toBe('待修订草稿')
      expect(review).toMatchObject({ verdict: 'revise', attempt: 0 })
      expect(nextAttempt).toBe(1)
      return { report: '修订后草稿', generationProvenance: generationProvenance('pass') }
    })
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => { throw new Error('generator must not rerun') },
      { analyze: async () => { throw new Error('vision must not rerun') } },
      new ChartRepository(join(directory, 'charts.json')),
      new BaziRuleProfileRepository(join(directory, 'bazi-rule-profiles.json')),
      join(directory, 'wenzhen-fixtures.json'),
      new TestWenzhenEvidenceStore(join(directory, 'wenzhen-evidence')),
      reviewer,
      reviser,
    )
    await app.ready()
    await vi.waitFor(async () => expect(await repository.get(queued.id)).toMatchObject({
      status: 'completed',
      report: '修订后草稿',
      revisionCount: 1,
      qualityReviews: [{ attempt: 0, verdict: 'revise' }, { attempt: 1, verdict: 'pass' }],
      pipelineCheckpoint: { qualityWorkflow: { event: 'review-completed', revisionCount: 1 } },
    }))
    expect(reviser).toHaveBeenCalledTimes(1)
    expect(reviewer).toHaveBeenCalledTimes(1)
    await app.close()
  })

  it('does not delete report media when the worker loses its report lease', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-lost-lease-media-'))
    let lostLeaseObserved!: () => void
    const lostLease = new Promise<void>((resolve) => { lostLeaseObserved = resolve })
    class LoseVisionLeaseRepository extends ReportRepository {
      override async saveClaimed(record: ReportRecord, fence: Parameters<ReportRepository['saveClaimed']>[1]): Promise<void> {
        if (record.phase === 'vision-analyzing') {
          lostLeaseObserved()
          throw new LostReportLeaseError(record.id)
        }
        return super.saveClaimed(record, fence)
      }
    }
    const repository = new LoseVisionLeaseRepository(join(directory, 'reports.json'))
    const mediaStore = new TrackingMediaStore(join(directory, 'uploads'))
    const app = buildApp(
      repository,
      mediaStore,
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '不应生成' }),
      { analyze: async () => [] },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: reportPayload('lost-lease-photo.jpg') })
    expect(response.statusCode).toBe(202)
    await lostLease
    await app.close()
    expect(mediaStore.removed).toEqual([])
    expect(mediaStore.removedClaimed).toEqual([])
  })

  it('retrieves and checkpoints missing citations before resuming a checkpointed draft', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-resume-missing-citations-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const knowledge = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const article = await knowledge.create({
      kind: 'article',
      title: '恢复补查引用依据',
      sourceLabel: '测试专家',
      body: '南向住宅和客厅采光需要结合命盘做综合判断。',
      tags: ['南向', '客厅'],
    })
    await knowledge.setState(article.id, 'published', 'knowledge-reviewer')
    const queued = queuedReportRecord({
      id: 'missing-citations-resume-report',
      vision: testVision(),
      evaluatedRules: [],
      compatibility: testCompatibility(),
      reviewDraft: { report: '已有草稿', createdAt: completedAt, revisionAttempt: 0 },
      pipelineCheckpoint: checkpoint({
        vision: { completedAt },
        rules: { completedAt },
        professionalReasoning: { completedAt, outcome: 'not-required' },
        harnessDraft: { completedAt, revisionAttempt: 0 },
      }),
    })
    await repository.save(queued)
    const reviewer = vi.fn<ReportQualityReviewer>(async (record, draft, attempt) => {
      expect(record.citations?.map((citation) => citation.title)).toContain('恢复补查引用依据')
      expect(draft.report).toBe('已有草稿')
      return qualityReview('pass', attempt)
    })
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      knowledge,
      async () => { throw new Error('generator must not rerun') },
      { analyze: async () => { throw new Error('vision must not rerun') } },
      new ChartRepository(join(directory, 'charts.json')),
      new BaziRuleProfileRepository(join(directory, 'bazi-rule-profiles.json')),
      join(directory, 'wenzhen-fixtures.json'),
      new TestWenzhenEvidenceStore(join(directory, 'wenzhen-evidence')),
      reviewer,
      async (_record, draft) => draft,
    )
    await app.ready()
    await vi.waitFor(async () => expect(await repository.get(queued.id)).toMatchObject({
      status: 'completed',
      citations: [expect.objectContaining({ title: '恢复补查引用依据' })],
      pipelineCheckpoint: { citations: { completedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u) } },
    }))
    expect(reviewer).toHaveBeenCalledTimes(1)
    await app.close()
  })

  it('recovers a stale queued processing phase from vision analysis', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-stale-phase-recovery-'))
    const repository = new RecordingReportRepository(join(directory, 'reports.json'))
    const birth = { date: '1992-08-18', time: '09:30', locationName: '杭州市', longitude: 120.1551 }
    const queued: ReportRecord = {
      id: 'stale-harness-phase-report',
      status: 'queued',
      phase: 'harness-generating',
      createdAt: new Date().toISOString(),
      submission: {
        visionConsent: true,
        calculationInput: birth,
        birth,
        residence: { facing: 'south' },
        photos: [{ fileId: 'stale-phase-photo.jpg', room: 'living-room', facing: 'south' }],
      },
      bazi: calculateBazi(birth),
      vision: [{ fileId: 'stale-phase-photo.jpg', room: 'living-room', summary: '旧视觉结果', observedElements: [], uncertainties: [] }],
      stageTimings: [{ phase: 'harness-generating', startedAt: '2026-09-01T00:00:00.000Z' }],
    }
    await repository.save(queued)
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '重新恢复后的报告' }),
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '重跑视觉结果', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
    )
    await app.ready()
    await vi.waitFor(async () => expect(await repository.get(queued.id)).toMatchObject({
      status: 'completed',
      phase: 'completed',
      report: '重新恢复后的报告',
      vision: [{ summary: '重跑视觉结果' }],
    }))
    expect(repository.savedPhases).toEqual(['harness-generating', 'vision-analyzing', 'rules-evaluating', 'harness-generating', 'completed', 'quality-reviewing', 'completed'])
    const stored = await repository.get(queued.id)
    expect(stored?.stageTimings?.at(0)?.phase).toBe('harness-generating')
    expectFailedTiming(stored?.stageTimings?.at(0), 'harness-generating')
    await app.close()
  })

  it('persists every report processing phase in order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-phase-order-'))
    const repository = new RecordingReportRepository(join(directory, 'reports.json'))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '阶段报告' }),
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '阶段测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south' },
      photos: [{ fileId: 'phase-order.jpg', room: 'living-room', facing: 'south' }],
    } })
    expect(response.statusCode).toBe(202)
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'completed',
      phase: 'completed',
      report: '阶段报告',
    }))
    expect(repository.savedPhases).toEqual(['queued', 'vision-analyzing', 'rules-evaluating', 'harness-generating', 'completed', 'quality-reviewing', 'completed'])
    const stored = await repository.get(response.json().id)
    expect(stored?.stageTimings?.map((timing) => timing.phase)).toEqual([
      'vision-analyzing',
      'rules-evaluating',
      'harness-generating',
      'quality-reviewing',
    ])
    const expectedTimingPhases: ReportStageTiming['phase'][] = ['vision-analyzing', 'rules-evaluating', 'harness-generating', 'quality-reviewing']
    stored?.stageTimings?.forEach((timing, index) => {
      expectCompletedTiming(timing, expectedTimingPhases[index]!)
    })
    expect(JSON.stringify(stored?.stageTimings)).not.toContain('阶段报告')
    await app.close()
  })

  it('completes only after the first quality review passes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-quality-pass-'))
    const repository = new RecordingReportRepository(join(directory, 'reports.json'))
    const reviewer = vi.fn<ReportQualityReviewer>(async (_record, draft, attempt) => {
      expect(draft.report).toBe('首版合拍报告')
      return qualityReview('pass', attempt)
    })
    const reviser = vi.fn<ReportReviser>(async (_record, draft) => draft)
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '首版合拍报告' }),
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '阶段测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
      new BaziRuleProfileRepository(join(directory, 'bazi-rule-profiles.json')),
      join(directory, 'wenzhen-fixtures.json'),
      new TestWenzhenEvidenceStore(join(directory, 'wenzhen-evidence')),
      reviewer,
      reviser,
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: reportPayload('quality-pass.jpg') })
    expect(response.statusCode).toBe(202)
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'completed',
      phase: 'completed',
      report: '首版合拍报告',
      revisionCount: 0,
      qualityReviews: [{ verdict: 'pass', attempt: 0 }],
    }))
    expect(reviewer).toHaveBeenCalledTimes(1)
    expect(reviser).not.toHaveBeenCalled()
    await app.close()
  })

  it('exposes the first report to its owner while background quality review is still running', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-quality-background-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    let releaseReviewer!: () => void
    const reviewerGate = new Promise<void>((resolve) => { releaseReviewer = resolve })
    const reviewer = vi.fn<ReportQualityReviewer>(async (_record, _draft, attempt) => {
      await reviewerGate
      return qualityReview('pass', attempt)
    })
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '无需等待质检即可阅读的首版报告', generationProvenance: generationProvenance('pass') }),
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '阶段测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
      new BaziRuleProfileRepository(join(directory, 'bazi-rule-profiles.json')),
      join(directory, 'wenzhen-fixtures.json'),
      new TestWenzhenEvidenceStore(join(directory, 'wenzhen-evidence')),
      reviewer,
      async (_record, draft) => draft,
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: reportPayload('quality-background.jpg') })
    const cookie = String(response.headers['set-cookie']).split(';')[0]
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'completed',
      phase: 'quality-reviewing',
      qualityStatus: 'running',
      report: '无需等待质检即可阅读的首版报告',
    }))

    const detail = await app.inject({ method: 'GET', url: `/v1/reports/${response.json().id}`, headers: { cookie } })
    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({ status: 'completed', qualityStatus: 'running', report: '无需等待质检即可阅读的首版报告' })
    expect((await app.inject({ method: 'POST', url: `/v1/reports/${response.json().id}/share`, headers: { cookie } })).statusCode).toBe(409)

    releaseReviewer()
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({ qualityStatus: 'passed', phase: 'completed' }))
    expect((await app.inject({ method: 'POST', url: `/v1/reports/${response.json().id}/share`, headers: { cookie } })).statusCode).toBe(200)
    await app.close()
  })

  it('revises through Harness and completes when quality review later passes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-quality-revise-'))
    const repository = new RecordingReportRepository(join(directory, 'reports.json'))
    const reviewer = vi.fn<ReportQualityReviewer>(async (_record, draft, attempt) => (
      draft.report === '修订后合拍报告' ? qualityReview('pass', attempt) : qualityReview('revise', attempt)
    ))
    const reviser = vi.fn<ReportReviser>(async (_record, draft, review, nextAttempt): Promise<ReportDraft> => ({
      ...draft,
      report: `${review.issues[0]?.code ?? 'quality'} 修订后合拍报告`.replace(/^missing-person-house-fit /u, ''),
    }))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '首版废话报告' }),
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '阶段测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
      new BaziRuleProfileRepository(join(directory, 'bazi-rule-profiles.json')),
      join(directory, 'wenzhen-fixtures.json'),
      new TestWenzhenEvidenceStore(join(directory, 'wenzhen-evidence')),
      reviewer,
      reviser,
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: reportPayload('quality-revise.jpg') })
    expect(response.statusCode).toBe(202)
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'completed',
      phase: 'completed',
      report: '修订后合拍报告',
      revisionCount: 1,
      qualityReviews: [{ verdict: 'revise', attempt: 0 }, { verdict: 'pass', attempt: 1 }],
    }))
    expect(repository.savedPhases).toEqual(['queued', 'vision-analyzing', 'rules-evaluating', 'harness-generating', 'completed', 'quality-reviewing', 'harness-revising', 'quality-reviewing', 'completed'])
    const stored = await repository.get(response.json().id)
    expect(stored?.stageTimings?.map((timing) => [timing.phase, timing.outcome])).toEqual([
      ['vision-analyzing', 'completed'],
      ['rules-evaluating', 'completed'],
      ['harness-generating', 'completed'],
      ['quality-reviewing', 'completed'],
      ['harness-revising', 'completed'],
      ['quality-reviewing', 'completed'],
    ])
    expect(reviser).toHaveBeenCalledTimes(1)
    await app.close()
  })

  it('keeps the delivered report when one Harness revision still does not pass review', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-quality-exhausted-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const reviewer = vi.fn<ReportQualityReviewer>(async (_record, _draft, attempt) => qualityReview('revise', attempt))
    const reviser = vi.fn<ReportReviser>(async (_record, draft, _review, nextAttempt) => ({ ...draft, report: `仍不合格 ${nextAttempt}` }))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '首版不合格' }),
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '阶段测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
      new BaziRuleProfileRepository(join(directory, 'bazi-rule-profiles.json')),
      join(directory, 'wenzhen-fixtures.json'),
      new TestWenzhenEvidenceStore(join(directory, 'wenzhen-evidence')),
      reviewer,
      reviser,
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: reportPayload('quality-exhausted.jpg') })
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'completed',
      phase: 'completed',
      qualityStatus: 'failed',
      qualityError: '报告后台质检未完成',
      report: '首版不合格',
      revisionCount: 1,
      qualityReviews: [{ attempt: 0 }, { attempt: 1 }],
    }))
    const stored = await repository.get(response.json().id)
    expect(stored?.stageTimings?.at(-1)?.phase).toBe('quality-reviewing')
    expectFailedTiming(stored?.stageTimings?.at(-1), 'quality-reviewing')
    expect(reviewer).toHaveBeenCalledTimes(2)
    expect(reviser).toHaveBeenCalledTimes(1)
    await app.close()
  })

  it('keeps the delivered report without exposing reviewer exceptions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-quality-reviewer-error-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '包含敏感调试片段的草稿' }),
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '阶段测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
      new BaziRuleProfileRepository(join(directory, 'bazi-rule-profiles.json')),
      join(directory, 'wenzhen-fixtures.json'),
      new TestWenzhenEvidenceStore(join(directory, 'wenzhen-evidence')),
      async () => { throw new Error('model output leaked: secret draft body') },
      async (_record, draft) => draft,
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: reportPayload('quality-reviewer-error.jpg') })
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'completed',
      phase: 'completed',
      qualityStatus: 'failed',
      qualityError: '报告后台质检未完成',
      report: '包含敏感调试片段的草稿',
    }))
    const stored = await repository.get(response.json().id)
    expect(JSON.stringify(stored)).not.toContain('secret draft body')
    await app.close()
  })

  it('keeps a validator-approved report available when the independent reviewer is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-quality-reviewer-degraded-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '已通过服务端发布校验的报告', generationProvenance: generationProvenance('pass') }),
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '阶段测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
      new BaziRuleProfileRepository(join(directory, 'bazi-rule-profiles.json')),
      join(directory, 'wenzhen-fixtures.json'),
      new TestWenzhenEvidenceStore(join(directory, 'wenzhen-evidence')),
      async () => { throw new Error('simulated reviewer outage') },
      async (_record, draft) => draft,
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: reportPayload('quality-reviewer-degraded.jpg') })
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'completed',
      phase: 'completed',
      qualityStatus: 'passed',
      report: '已通过服务端发布校验的报告',
      reviewDraft: { report: '已通过服务端发布校验的报告', generationProvenance: { validatorResult: 'pass' } },
      generationProvenance: { validatorResult: 'pass' },
      qualityReviews: [expect.objectContaining({
        attempt: 0,
        verdict: 'pass',
        score: 82,
        issues: [expect.objectContaining({ code: 'quality-reviewer-unavailable', severity: 'low' })],
      })],
    }))
    const stored = await repository.get(response.json().id)
    expect(stored?.report).toBe('已通过服务端发布校验的报告')
    expect(stored?.stageTimings?.at(-1)?.phase).toBe('quality-reviewing')
    expectCompletedTiming(stored?.stageTimings?.at(-1), 'quality-reviewing')
    await app.close()
  })

  it('keeps a validator-approved report visible to its owner when quality review does not pass', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-quality-manual-review-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '只应留在私有记录的草稿正文', generationProvenance: generationProvenance('pass') }),
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '阶段测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
      new BaziRuleProfileRepository(join(directory, 'bazi-rule-profiles.json')),
      join(directory, 'wenzhen-fixtures.json'),
      new TestWenzhenEvidenceStore(join(directory, 'wenzhen-evidence')),
      async (_record, _draft, attempt) => qualityReview('manual-review', attempt),
      async (_record, draft) => draft,
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: reportPayload('quality-manual-review.jpg') })
    const cookie = String(response.headers['set-cookie']).split(';')[0]
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'completed',
      phase: 'completed',
      qualityStatus: 'failed',
      qualityError: '报告后台质检未完成',
      reviewDraft: { report: '只应留在私有记录的草稿正文', generationProvenance: { validatorResult: 'pass' } },
      qualityReviews: [{ verdict: 'manual-review', attempt: 0 }],
    }))
    expect((await repository.get(response.json().id))?.report).toBe('只应留在私有记录的草稿正文')
    const detail = await app.inject({ method: 'GET', url: `/v1/reports/${response.json().id}`, headers: { cookie } })
    const list = await app.inject({ method: 'GET', url: '/v1/reports', headers: { cookie } })
    expect(detail.statusCode).toBe(200)
    expect(detail.json()).not.toHaveProperty('reviewDraft')
    expect(detail.json().report).toBe('只应留在私有记录的草稿正文')
    expect(list.statusCode).toBe(200)
    expect(list.json().reports[0]).toMatchObject({ id: response.json().id, status: 'completed', hasReport: true })
    expect(list.json().reports[0].reportPreview).toContain('只应留在私有记录的草稿正文')
    await app.close()
  })

  it('returns only the formal report in completed report detail', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-public-formal-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '首版草稿正文' }),
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '阶段测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
      new BaziRuleProfileRepository(join(directory, 'bazi-rule-profiles.json')),
      join(directory, 'wenzhen-fixtures.json'),
      new TestWenzhenEvidenceStore(join(directory, 'wenzhen-evidence')),
      async (_record, draft, attempt) => draft.report === '正式报告正文' ? qualityReview('pass', attempt) : qualityReview('revise', attempt),
      async (_record, draft) => ({ ...draft, report: '正式报告正文' }),
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: reportPayload('quality-formal-report.jpg') })
    const cookie = String(response.headers['set-cookie']).split(';')[0]
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'completed',
      phase: 'completed',
      report: '正式报告正文',
      revisionCount: 1,
    }))
    const detail = await app.inject({ method: 'GET', url: `/v1/reports/${response.json().id}`, headers: { cookie } })
    expect(detail.statusCode).toBe(200)
    expect(detail.json()).toMatchObject({ status: 'completed', report: '正式报告正文' })
    expect(detail.json()).not.toHaveProperty('reviewDraft')
    expect(JSON.stringify(detail.json())).not.toContain('首版草稿正文')
    await app.close()
  })

  it('fails closed when an intermediate rule phase save fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-rule-phase-failure-'))
    class FailRulePhaseOnce extends ReportRepository {
      private failed = false
      override async save(record: ReportRecord): Promise<void> {
        if (!this.failed && record.phase === 'rules-evaluating') {
          this.failed = true
          throw new Error('simulated rule phase persistence failure')
        }
        return super.save(record)
      }
      override async saveClaimed(record: ReportRecord, fence: Parameters<ReportRepository['saveClaimed']>[1]): Promise<void> {
        if (!this.failed && record.phase === 'rules-evaluating') {
          this.failed = true
          throw new Error('simulated rule phase persistence failure')
        }
        return super.saveClaimed(record, fence)
      }
    }
    const repository = new FailRulePhaseOnce(join(directory, 'reports.json'))
    const reportGenerator = vi.fn(async () => ({ report: '不应生成' }))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      reportGenerator,
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '阶段测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south' },
      photos: [{ fileId: 'rule-phase-failure.jpg', room: 'living-room', facing: 'south' }],
    } })
    expect(response.statusCode).toBe(202)
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'failed',
      phase: 'failed',
      error: 'Report progress persistence failed',
    }))
    const stored = await repository.get(response.json().id)
    expect(stored?.stageTimings?.map((timing) => [timing.phase, timing.outcome])).toEqual([
      ['vision-analyzing', 'completed'],
      ['rules-evaluating', 'failed'],
    ])
    expect(reportGenerator).not.toHaveBeenCalled()
    await app.close()
  })

  it('fails closed when the Harness phase save fails before generation starts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-harness-phase-failure-'))
    class FailHarnessPhaseOnce extends ReportRepository {
      private failed = false
      override async save(record: ReportRecord): Promise<void> {
        if (!this.failed && record.phase === 'harness-generating') {
          this.failed = true
          throw new Error('simulated harness phase persistence failure')
        }
        return super.save(record)
      }
      override async saveClaimed(record: ReportRecord, fence: Parameters<ReportRepository['saveClaimed']>[1]): Promise<void> {
        if (!this.failed && record.phase === 'harness-generating') {
          this.failed = true
          throw new Error('simulated harness phase persistence failure')
        }
        return super.saveClaimed(record, fence)
      }
    }
    const repository = new FailHarnessPhaseOnce(join(directory, 'reports.json'))
    const reportGenerator = vi.fn(async () => ({ report: '不应生成' }))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      reportGenerator,
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '阶段测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south' },
      photos: [{ fileId: 'harness-phase-failure.jpg', room: 'living-room', facing: 'south' }],
    } })
    expect(response.statusCode).toBe(202)
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'failed',
      phase: 'failed',
      error: 'Report progress persistence failed',
    }))
    expect(reportGenerator).not.toHaveBeenCalled()
    await app.close()
  })

  it('calculates BaZi and returns the injected report', async () => {
    const app = await testApp('有依据的文化型报告')
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: {
        visionConsent: true,
        birth: persistableBirth(),
        residence: { facing: 'south', layoutNote: '客厅连接阳台' },
        photos: [{ fileId: 'private-photo-id.jpg', room: 'living-room', facing: 'south' }],
      },
    })
    expect(response.statusCode).toBe(202)
    const queued = response.json()
    expect(queued).toMatchObject({
      status: 'queued',
      phase: 'queued',
      chartProfileId: expect.any(String),
      chartVersionId: expect.any(String),
      bazi: { ruleVersion: 'bazi-v5-stem-branch-relations' },
    })
    expect(queued).not.toHaveProperty('pipelineCheckpoint')
    expect(response.headers['set-cookie']).toContain('fengshui_principal=')
    const cookie = String(response.headers['set-cookie']).split(';')[0]
    await vi.waitFor(async () => expect(await app.inject({ method: 'GET', url: `/v1/reports/${queued.id}`, headers: { cookie } }))
      .toMatchObject({ statusCode: 200 }))
    await vi.waitFor(async () => {
      const detail = (await app.inject({ method: 'GET', url: `/v1/reports/${queued.id}`, headers: { cookie } })).json()
      expect(detail).toMatchObject({ status: 'completed', phase: 'completed', report: '有依据的文化型报告' })
      expect(detail).not.toHaveProperty('pipelineCheckpoint')
    })
    await app.close()
  })

  it('persists generation provenance and returns only the public provenance schema', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-provenance-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const unsafeProvenance = {
      ...generationProvenance(),
      localPath: '/Users/private/project/harness.patch.yml',
      apiKey: 'must-not-leak',
    } as ReportGenerationProvenance
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '可审计报告', generationProvenance: unsafeProvenance }),
      { analyze: async () => [] },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south' },
      photos: [{ fileId: 'provenance-photo.jpg', room: 'overview', facing: 'south' }],
    } })
    const cookie = String(response.headers['set-cookie']).split(';')[0]
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'completed',
      generationProvenance: generationProvenance(),
    }))
    const stored = await app.inject({ method: 'GET', url: `/v1/reports/${response.json().id}`, headers: { cookie } })
    expect(stored.json().generationProvenance).toEqual(generationProvenance())
    expect(JSON.stringify(stored.json())).not.toContain('/Users/private')
    expect(JSON.stringify(stored.json())).not.toContain('must-not-leak')
    await app.close()
  })

  it('persists known not-run provenance when the Harness runner fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-provenance-failure-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const failure = Object.assign(new Error('simulated Harness runner failure'), {
      generationProvenance: generationProvenance('not-run'),
    })
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => { throw failure },
      { analyze: async () => [] },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south' },
      photos: [{ fileId: 'failed-provenance-photo.jpg', room: 'overview', facing: 'south' }],
    } })
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'failed',
      phase: 'failed',
      generationProvenance: generationProvenance('not-run'),
    }))
    await app.close()
  })

  it('keeps legacy reports without generation provenance readable', async () => {
    const app = await testApp('历史报告')
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south' },
      photos: [{ fileId: 'legacy-provenance-photo.jpg', room: 'overview', facing: 'south' }],
    } })
    const cookie = String(response.headers['set-cookie']).split(';')[0]
    await new Promise((resolve) => setTimeout(resolve, 10))
    const stored = await app.inject({ method: 'GET', url: `/v1/reports/${response.json().id}`, headers: { cookie } })
    expect(stored.statusCode).toBe(200)
    expect(stored.json()).not.toHaveProperty('generationProvenance')
    await app.close()
  })

  it('binds reports to the anonymous principal and keeps private media identifiers out of public responses', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-owner-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '归属可验证报告' }),
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '归属测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const created = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south' },
      photos: [{ fileId: 'owner-private-photo.jpg', room: 'living-room', facing: 'south', note: '客厅全景' }],
    } })
    expect(created.statusCode).toBe(202)
    const reportId = created.json().id as string
    const ownerCookie = String(created.headers['set-cookie']).split(';')[0]
    expect(created.json()).not.toHaveProperty('principalId')
    expect(created.json().submission.photos).toEqual([{ room: 'living-room', facing: 'south', note: '客厅全景' }])
    expect(JSON.stringify(created.json())).not.toContain('owner-private-photo.jpg')

    await vi.waitFor(async () => expect(await repository.get(reportId)).toMatchObject({ status: 'completed' }))
    const internal = await repository.get(reportId)
    expect(internal).toMatchObject({
      principalId: expect.any(String),
      submission: { photos: [{ fileId: 'owner-private-photo.jpg' }] },
      vision: [{ fileId: 'owner-private-photo.jpg' }],
    })

    const ownerRead = await app.inject({ method: 'GET', url: `/v1/reports/${reportId}`, headers: { cookie: ownerCookie } })
    expect(ownerRead.statusCode).toBe(200)
    expect(ownerRead.json()).not.toHaveProperty('principalId')
    expect(ownerRead.json().submission.photos[0]).not.toHaveProperty('fileId')
    expect(ownerRead.json().vision[0]).not.toHaveProperty('fileId')
    expect(JSON.stringify(ownerRead.json())).not.toContain('owner-private-photo.jpg')

    const withoutCookie = await app.inject({ method: 'GET', url: `/v1/reports/${reportId}` })
    expect(withoutCookie.statusCode).toBe(404)
    expect(withoutCookie.json()).toEqual({ error: 'report not found' })

    const otherPrincipal = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth('10:30') })
    const otherCookie = String(otherPrincipal.headers['set-cookie']).split(';')[0]
    const otherRead = await app.inject({ method: 'GET', url: `/v1/reports/${reportId}`, headers: { cookie: otherCookie } })
    expect(otherRead.statusCode).toBe(404)
    expect(otherRead.json()).toEqual({ error: 'report not found' })

    const enumerated = await app.inject({ method: 'GET', url: `/v1/reports/${crypto.randomUUID()}`, headers: { cookie: ownerCookie } })
    expect(enumerated.statusCode).toBe(404)
    expect(enumerated.json()).toEqual({ error: 'report not found' })
    await app.close()
  })

  it('creates a protected share token only for an owned validated quality-passed report', async () => {
    const { app, repository, reportId, ownerCookie } = await createShareableReportFixture('分享页可见的正式报告')
    const shared = await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/share`, headers: { cookie: ownerCookie } })
    expect(shared.statusCode).toBe(200)
    expect(shared.headers['cache-control']).toBe('private, no-store')
    expect(shared.json()).toMatchObject({ token: expect.any(String), expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u) })
    expect(shared.json().token).toHaveLength(43)
    expect(shared.json()).not.toHaveProperty('tokenHash')
    expect(await repository.get(reportId)).toMatchObject({
      shareAccess: {
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
        expiresAt: shared.json().expiresAt,
      },
    })

    const read = await app.inject({
      method: 'GET',
      url: `/v1/shared-reports/${reportId}`,
      headers: { 'x-report-share-token': shared.json().token },
    })
    expect(read.statusCode).toBe(200)
    expect(read.headers['cache-control']).toBe('private, no-store')
    expect(read.json()).toMatchObject({ id: reportId, status: 'completed', report: '分享页可见的正式报告' })
    expect(read.json()).not.toHaveProperty('principalId')
    expect(read.json()).not.toHaveProperty('shareAccess')
    expect(read.json().submission.photos[0]).not.toHaveProperty('fileId')
    expect(JSON.stringify(read.json())).not.toContain('share-')
    await app.close()
  })

  it('archives a terminal report into an owner-only recycle bin and restores it', async () => {
    const { app, repository, reportId, ownerCookie } = await createShareableReportFixture('可归档的正式报告')
    const shared = await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/share`, headers: { cookie: ownerCookie } })
    expect(shared.statusCode).toBe(200)

    const otherPrincipal = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth('10:30') })
    const otherCookie = String(otherPrincipal.headers['set-cookie']).split(';')[0]
    expect((await app.inject({ method: 'DELETE', url: `/v1/reports/${reportId}`, headers: { cookie: otherCookie } })).statusCode).toBe(404)

    const archived = await app.inject({ method: 'DELETE', url: `/v1/reports/${reportId}`, headers: { cookie: ownerCookie } })
    expect(archived.statusCode).toBe(204)
    expect(archived.headers['cache-control']).toBe('private, no-store')
    expect(await repository.get(reportId)).toMatchObject({ archivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u) })
    expect(await repository.get(reportId)).not.toHaveProperty('shareAccess')

    const activeList = await app.inject({ method: 'GET', url: '/v1/reports', headers: { cookie: ownerCookie } })
    expect(activeList.json()).toEqual({ reports: [] })
    const recycleBin = await app.inject({ method: 'GET', url: '/v1/reports?archived=true', headers: { cookie: ownerCookie } })
    expect(recycleBin.statusCode).toBe(200)
    expect(recycleBin.json().reports).toEqual([expect.objectContaining({
      id: reportId,
      archivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
    })])
    expect((await app.inject({ method: 'GET', url: `/v1/reports/${reportId}`, headers: { cookie: ownerCookie } })).statusCode).toBe(200)

    expect((await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/share`, headers: { cookie: ownerCookie } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'GET', url: `/v1/shared-reports/${reportId}`, headers: { 'x-report-share-token': shared.json().token } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/v1/reports/${reportId}/pdf`, headers: { cookie: ownerCookie } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/restore`, headers: { cookie: otherCookie } })).statusCode).toBe(404)

    const restored = await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/restore`, headers: { cookie: ownerCookie } })
    expect(restored.statusCode).toBe(200)
    expect(restored.headers['cache-control']).toBe('private, no-store')
    expect(restored.json()).not.toHaveProperty('archivedAt')
    expect((await app.inject({ method: 'GET', url: '/v1/reports', headers: { cookie: ownerCookie } })).json().reports)
      .toEqual([expect.objectContaining({ id: reportId })])
    expect((await app.inject({ method: 'GET', url: '/v1/reports?archived=true', headers: { cookie: ownerCookie } })).json())
      .toEqual({ reports: [] })
    await app.close()
  })

  it('rejects report archive transitions that are not valid terminal-state changes', async () => {
    const { app, repository, reportId, ownerCookie } = await createShareableReportFixture()
    const completed = await repository.get(reportId)
    expect(completed).toBeTruthy()
    await repository.save({ ...completed!, status: 'running', phase: 'harness-generating' })

    const runningArchive = await app.inject({ method: 'DELETE', url: `/v1/reports/${reportId}`, headers: { cookie: ownerCookie } })
    expect(runningArchive.statusCode).toBe(409)

    await repository.save({ ...completed!, status: 'failed', phase: 'failed' })
    expect((await app.inject({ method: 'DELETE', url: `/v1/reports/${reportId}`, headers: { cookie: ownerCookie } })).statusCode).toBe(204)
    expect((await app.inject({ method: 'DELETE', url: `/v1/reports/${reportId}`, headers: { cookie: ownerCookie } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/restore`, headers: { cookie: ownerCookie } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/restore`, headers: { cookie: ownerCookie } })).statusCode).toBe(404)
    await app.close()
  })

  it('regenerates from the source report immutable chart, residence and saved vision evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-regenerate-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const media = new TrackingMediaStore(join(directory, 'uploads'))
    const charts = new ChartRepository(join(directory, 'charts.json'))
    const residences = new ResidenceRepository(join(directory, 'residences.json'))
    const visionAnalyzer = vi.fn(async (photos: ReportRecord['submission']['photos']) => photos.map((photo) => ({
      fileId: photo.fileId,
      room: photo.room,
      summary: '已保存的客厅视觉事实',
      observedElements: ['南向采光'],
      uncertainties: [],
    })))
    const generatedRecords: ReportRecord[] = []
    const app = buildApp(
      repository,
      media,
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async (record) => {
        generatedRecords.push(structuredClone(record))
        return { report: `报告-${generatedRecords.length}` }
      },
      { analyze: visionAnalyzer },
      charts,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      residences,
    )
    const chartResponse = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth() })
    const cookie = String(chartResponse.headers['set-cookie']).split(';')[0]
    const chart = chartResponse.json().profile
    const residenceResponse = await app.inject({
      method: 'POST',
      url: '/v1/residences',
      headers: { cookie },
      payload: { label: '原始住宅', facing: 'south', layoutNote: '原始户型' },
    })
    const residence = residenceResponse.json().profile
    const created = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: { cookie },
      payload: {
        visionConsent: true,
        chartProfileId: chart.id,
        chartVersionId: chart.currentVersion.id,
        residenceProfileId: residence.id,
        residenceVersionId: residence.currentVersion.id,
        residence: { facing: 'south', layoutNote: '原始户型' },
        photos: [{ fileId: 'immutable-evidence.jpg', room: 'living-room', facing: 'south', note: '原始用户标注' }],
      },
    })
    const sourceId = created.json().id as string
    await vi.waitFor(async () => expect(await repository.get(sourceId)).toMatchObject({ status: 'completed' }))
    const source = (await repository.get(sourceId))!
    await repository.save({
      ...source,
      citations: [{
        id: 'stale-citation',
        version: 1,
        versionId: 'stale-citation:v1',
        contentHash: 'a'.repeat(64),
        title: '旧引用不得复用',
        sourceLabel: '旧资料',
        excerpt: '旧摘要',
      }],
    })

    expect((await app.inject({
      method: 'POST',
      url: `/v1/charts/${chart.id}/versions`,
      headers: { cookie },
      payload: { ...persistableBirth('10:30'), expectedRevision: 1 },
    })).statusCode).toBe(200)
    expect((await app.inject({
      method: 'POST',
      url: `/v1/residences/${residence.id}/versions`,
      headers: { cookie },
      payload: { label: '已更新住宅', facing: 'north', layoutNote: '新户型', expectedRevision: 1 },
    })).statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: `/v1/charts/${chart.id}`, headers: { cookie } })).statusCode).toBe(204)
    expect((await app.inject({ method: 'DELETE', url: `/v1/residences/${residence.id}`, headers: { cookie } })).statusCode).toBe(204)

    const regeneratedResponse = await app.inject({ method: 'POST', url: `/v1/reports/${sourceId}/regenerate`, headers: { cookie } })
    expect(regeneratedResponse.statusCode).toBe(202)
    expect(regeneratedResponse.headers['cache-control']).toBe('private, no-store')
    expect(regeneratedResponse.json()).toMatchObject({
      sourceReportId: sourceId,
      status: 'queued',
      chartVersionId: chart.currentVersion.id,
      residenceVersionId: residence.currentVersion.id,
      submission: {
        residence: { facing: 'south', layoutNote: '原始户型' },
        photos: [{ room: 'living-room', facing: 'south', note: '原始用户标注' }],
      },
    })
    expect(regeneratedResponse.json().id).not.toBe(sourceId)
    const regeneratedId = regeneratedResponse.json().id as string
    await vi.waitFor(async () => expect(await repository.get(regeneratedId)).toMatchObject({ status: 'completed' }))
    const regenerated = (await repository.get(regeneratedId))!
    expect(regenerated.bazi).toEqual(chart.currentVersion.bazi)
    expect(regenerated.submission.calculationInput).toEqual(chart.currentVersion.calculationInput)
    expect(regenerated.vision).toEqual(source.vision)
    expect(regenerated.citations).toEqual([])
    expect(regenerated.evaluatedRules).toBeDefined()
    expect(regenerated.pipelineCheckpoint).toMatchObject({
      vision: { completedAt: expect.any(String) },
      citations: { completedAt: expect.any(String) },
      rules: { completedAt: expect.any(String) },
    })
    expect(generatedRecords[1]?.citations).toEqual([])
    expect(visionAnalyzer).toHaveBeenCalledTimes(1)
    expect(media.removedClaimed).toEqual(['immutable-evidence.jpg'])
    await app.close()
  })

  it('keeps regeneration owner-only and rejects incomplete saved evidence', async () => {
    const { app, repository, reportId, ownerCookie } = await createShareableReportFixture()
    const other = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth('10:30') })
    const otherCookie = String(other.headers['set-cookie']).split(';')[0]
    expect((await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/regenerate` })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/regenerate`, headers: { cookie: otherCookie } })).statusCode).toBe(404)

    const source = (await repository.get(reportId))!
    await repository.save({ ...source, vision: [] })
    const missingVision = await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/regenerate`, headers: { cookie: ownerCookie } })
    expect(missingVision.statusCode).toBe(409)
    expect(missingVision.json()).toEqual({ error: 'report does not contain complete saved evidence for regeneration' })

    await repository.save({ ...source, status: 'failed', phase: 'failed' })
    expect((await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/regenerate`, headers: { cookie: ownerCookie } })).statusCode).toBe(409)
    await app.close()
  })

  it('keeps report sharing owner-only and fails shared reads closed', async () => {
    const { app, reportId, ownerCookie } = await createShareableReportFixture()
    const otherPrincipal = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth('10:30') })
    const otherCookie = String(otherPrincipal.headers['set-cookie']).split(';')[0]
    expect((await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/share`, headers: { cookie: otherCookie } })).statusCode).toBe(404)

    const shared = await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/share`, headers: { cookie: ownerCookie } })
    expect(shared.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/v1/shared-reports/${reportId}` })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/v1/shared-reports/${reportId}`, headers: { 'x-report-share-token': 'wrong-token' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/v1/shared-reports/${reportId}`, headers: { 'x-report-share-token': 'x'.repeat(129) } })).statusCode).toBe(404)
    await app.close()
  })

  it('rejects sharing reports that are not completed, validator-approved and quality-passed', async () => {
    const { app, repository, reportId, ownerCookie } = await createShareableReportFixture()
    const completed = await repository.get(reportId)
    expect(completed).toBeTruthy()
    await repository.save({ ...completed!, status: 'queued', phase: 'queued' })
    expect((await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/share`, headers: { cookie: ownerCookie } })).statusCode).toBe(409)
    await repository.save({ ...completed!, report: undefined })
    expect((await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/share`, headers: { cookie: ownerCookie } })).statusCode).toBe(409)
    await repository.save({ ...completed!, generationProvenance: generationProvenance('fail') })
    expect((await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/share`, headers: { cookie: ownerCookie } })).statusCode).toBe(409)
    await repository.save({
      ...completed!,
      generationProvenance: { ...generationProvenance('pass'), validatorVersion: 'generated-report-validator-v9' },
    })
    expect((await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/share`, headers: { cookie: ownerCookie } })).statusCode).toBe(409)
    await repository.save({ ...completed!, qualityReviews: [qualityReview('manual-review', 0)] })
    expect((await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/share`, headers: { cookie: ownerCookie } })).statusCode).toBe(409)
    await app.close()
  })

  it('rotates, expires and revokes protected report share tokens', async () => {
    const { app, repository, reportId, ownerCookie } = await createShareableReportFixture()
    const first = await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/share`, headers: { cookie: ownerCookie } })
    const second = await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/share`, headers: { cookie: ownerCookie } })
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(second.json().token).not.toBe(first.json().token)
    expect((await app.inject({ method: 'GET', url: `/v1/shared-reports/${reportId}`, headers: { 'x-report-share-token': first.json().token } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/v1/shared-reports/${reportId}`, headers: { 'x-report-share-token': second.json().token } })).statusCode).toBe(200)

    const stored = await repository.get(reportId)
    await repository.save({ ...stored!, shareAccess: { ...stored!.shareAccess!, expiresAt: '2000-01-01T00:00:00.000Z' } })
    expect((await app.inject({ method: 'GET', url: `/v1/shared-reports/${reportId}`, headers: { 'x-report-share-token': second.json().token } })).statusCode).toBe(404)

    const third = await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/share`, headers: { cookie: ownerCookie } })
    expect(third.statusCode).toBe(200)
    const revoked = await app.inject({ method: 'DELETE', url: `/v1/reports/${reportId}/share`, headers: { cookie: ownerCookie } })
    expect(revoked.statusCode).toBe(204)
    expect(await repository.get(reportId)).not.toHaveProperty('shareAccess')
    expect((await app.inject({ method: 'GET', url: `/v1/shared-reports/${reportId}`, headers: { 'x-report-share-token': third.json().token } })).statusCode).toBe(404)
    await app.close()
  })

  it('fails a shared read closed when report quality is downgraded or expiry data is malformed', async () => {
    const { app, repository, reportId, ownerCookie } = await createShareableReportFixture()
    const shared = await app.inject({ method: 'POST', url: `/v1/reports/${reportId}/share`, headers: { cookie: ownerCookie } })
    expect(shared.statusCode).toBe(200)
    const headers = { 'x-report-share-token': shared.json().token }
    const stored = await repository.get(reportId)
    expect(stored).toBeTruthy()

    await repository.save({ ...stored!, qualityReviews: [qualityReview('manual-review', 0)] })
    expect((await app.inject({ method: 'GET', url: `/v1/shared-reports/${reportId}`, headers })).statusCode).toBe(404)

    await repository.save({
      ...stored!,
      generationProvenance: { ...generationProvenance('pass'), validatorVersion: 'generated-report-validator-v9' },
    })
    expect((await app.inject({ method: 'GET', url: `/v1/shared-reports/${reportId}`, headers })).statusCode).toBe(404)

    await repository.save({ ...stored!, shareAccess: { ...stored!.shareAccess!, expiresAt: 'not-a-date' } })
    expect((await app.inject({ method: 'GET', url: `/v1/shared-reports/${reportId}`, headers })).statusCode).toBe(404)
    await app.close()
  })

  it('exports only an owned completed report as a private server-rendered PDF', async () => {
    const rendered: Array<{
      id: string
      report?: string
      chartProfileId?: string
      chartVersionId?: string
      residenceProfileId?: string
      residenceVersionId?: string
    }> = []
    const app = await testApp('# 明确结论\n\n- 户型与命盘整体合拍。', {
      reportGenerationProvenance: generationProvenance('pass'),
      reportPdfRenderer: {
        render: async (snapshot) => {
          rendered.push({
            id: snapshot.id,
            report: snapshot.report,
            chartProfileId: snapshot.chartProfileId,
            chartVersionId: snapshot.chartVersionId,
            residenceProfileId: snapshot.residenceProfileId,
            residenceVersionId: snapshot.residenceVersionId,
          })
          return Buffer.from('%PDF-1.7\nowned report')
        },
      },
    })
    const created = await app.inject({ method: 'POST', url: '/v1/reports', payload: reportPayload('pdf-owner.jpg') })
    expect(created.statusCode).toBe(202)
    const reportId = created.json().id as string
    const ownerCookie = String(created.headers['set-cookie']).split(';')[0]
    await vi.waitFor(async () => expect((await app.inject({ method: 'GET', url: `/v1/reports/${reportId}`, headers: { cookie: ownerCookie } })).json()).toMatchObject({ status: 'completed' }))

    const response = await app.inject({ method: 'GET', url: `/v1/reports/${reportId}/pdf`, headers: { cookie: ownerCookie } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('application/pdf')
    expect(response.headers['content-disposition']).toBe(`attachment; filename="fengshui-report-${reportId}.pdf"`)
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
    expect(rendered).toEqual([{
      id: reportId,
      report: '# 明确结论\n\n- 户型与命盘整体合拍。',
      chartProfileId: expect.any(String),
      chartVersionId: expect.any(String),
      residenceProfileId: expect.any(String),
      residenceVersionId: expect.any(String),
    }])

    expect((await app.inject({ method: 'GET', url: `/v1/reports/${reportId}/pdf` })).statusCode).toBe(404)
    const other = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth('10:30') })
    const otherCookie = String(other.headers['set-cookie']).split(';')[0]
    expect((await app.inject({ method: 'GET', url: `/v1/reports/${reportId}/pdf`, headers: { cookie: otherCookie } })).statusCode).toBe(404)
    await app.close()
  })

  it('fails PDF export closed for reports approved by an older validator version', async () => {
    const { app, repository, reportId, ownerCookie } = await createShareableReportFixture()
    const stored = await repository.get(reportId)
    await repository.save({
      ...stored!,
      generationProvenance: { ...generationProvenance('pass'), validatorVersion: 'generated-report-validator-v9' },
    })

    const response = await app.inject({ method: 'GET', url: `/v1/reports/${reportId}/pdf`, headers: { cookie: ownerCookie } })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'report is not ready for PDF export' })
    await app.close()
  })

  it('returns a stable 503 when report PDF rendering is unavailable', async () => {
    const app = await testApp('可导出的报告', {
      reportGenerationProvenance: generationProvenance('pass'),
      reportPdfRenderer: { render: async () => { throw new ReportPdfUnavailableError('private executable path') } },
    })
    const created = await app.inject({ method: 'POST', url: '/v1/reports', payload: reportPayload('pdf-unavailable.jpg') })
    const reportId = created.json().id as string
    const cookie = String(created.headers['set-cookie']).split(';')[0]
    await vi.waitFor(async () => expect((await app.inject({ method: 'GET', url: `/v1/reports/${reportId}`, headers: { cookie } })).json()).toMatchObject({ status: 'completed' }))
    const response = await app.inject({ method: 'GET', url: `/v1/reports/${reportId}/pdf`, headers: { cookie } })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'report PDF generation unavailable' })
    expect(response.body).not.toContain('private executable path')
    await app.close()
  })

  it('lists only the current anonymous principal reports as safe newest-first summaries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-list-owner-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '归属摘要报告正文，包含报告结论但不包含内部输入。', generationProvenance: generationProvenance('pass') }),
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '列表测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const first = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south', layoutNote: '不能在列表暴露的完整住宅描述' },
      photos: [{ fileId: 'list-private-photo-first.jpg', room: 'living-room', facing: 'south', note: '不能在列表暴露的照片备注' }],
    } })
    const ownerCookie = String(first.headers['set-cookie']).split(';')[0]
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await app.inject({ method: 'POST', url: '/v1/reports', headers: { cookie: ownerCookie }, payload: {
      visionConsent: true,
      chartProfileId: first.json().chartProfileId,
      chartVersionId: first.json().chartVersionId,
      residence: { facing: 'north', layoutNote: '第二份完整描述也不能出现在列表' },
      photos: [{ fileId: 'list-private-photo-second.jpg', room: 'bedroom', facing: 'north', note: '第二份照片备注' }],
    } })
    expect(first.statusCode).toBe(202)
    expect(second.statusCode).toBe(202)

    await vi.waitFor(async () => {
      await expect(repository.get(first.json().id)).resolves.toMatchObject({ status: 'completed', phase: 'completed' })
      await expect(repository.get(second.json().id)).resolves.toMatchObject({ status: 'completed', phase: 'completed' })
    })

    expect((await app.inject({ method: 'GET', url: '/v1/reports' })).json()).toEqual({ reports: [] })

    const ownerList = await app.inject({ method: 'GET', url: '/v1/reports', headers: { cookie: ownerCookie } })
    expect(ownerList.statusCode).toBe(200)
    expect(ownerList.json().reports.map((report: { id: string }) => report.id)).toEqual([second.json().id, first.json().id])
    expect(ownerList.json().reports[0]).toMatchObject({
      id: second.json().id,
      status: 'completed',
      phase: 'completed',
      chartProfileId: first.json().chartProfileId,
      chartVersionId: first.json().chartVersionId,
      residenceFacing: 'north',
      photoCount: 1,
      hasReport: true,
    })
    expect(JSON.stringify(ownerList.json())).not.toContain('"fileId"')
    expect(JSON.stringify(ownerList.json())).not.toContain('list-private-photo')
    expect(JSON.stringify(ownerList.json())).not.toContain('完整住宅描述')
    expect(JSON.stringify(ownerList.json())).not.toContain('照片备注')
    expect(JSON.stringify(ownerList.json())).not.toContain('visionConsent')
    expect(JSON.stringify(ownerList.json())).not.toContain('generationProvenance')
    expect(JSON.stringify(ownerList.json())).not.toContain('principalId')

    const stale = await repository.get(second.json().id)
    expect(stale?.generationProvenance).toBeDefined()
    await repository.save({
      ...stale!,
      generationProvenance: {
        ...stale!.generationProvenance!,
        validatorVersion: 'generated-report-validator-v2-human-readable',
      },
    })
    const staleList = await app.inject({ method: 'GET', url: '/v1/reports', headers: { cookie: ownerCookie } })
    expect(staleList.json().reports[0]).toMatchObject({ id: second.json().id, hasReport: false })
    expect(staleList.json().reports[0]).not.toHaveProperty('reportPreview')

    const otherPrincipal = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth('10:30') })
    const otherCookie = String(otherPrincipal.headers['set-cookie']).split(';')[0]
    const otherList = await app.inject({ method: 'GET', url: '/v1/reports', headers: { cookie: otherCookie } })
    expect(otherList.statusCode).toBe(200)
    expect(otherList.json()).toEqual({ reports: [] })
    await app.close()
  })

  it('filters report history by the selected owned chart profile without leaking other members or accounts', async () => {
    const app = await testApp('成员筛选报告正文')
    const selfChart = await app.inject({
      method: 'POST',
      url: '/v1/charts',
      payload: { ...persistableBirth(), label: '我', relationship: 'self' },
    })
    const cookie = String(selfChart.headers['set-cookie']).split(';')[0]
    const selfProfile = selfChart.json().profile
    const partnerChart = await app.inject({
      method: 'POST',
      url: '/v1/charts',
      headers: { cookie },
      payload: { ...persistableBirth('10:30'), label: '妻子', relationship: 'partner' },
    })
    const partnerProfile = partnerChart.json().profile
    const selfResidenceResponse = await app.inject({
      method: 'POST',
      url: '/v1/residences',
      headers: { cookie },
      payload: { label: '自住房', facing: 'south', layoutNote: '自住房客厅朝南' },
    })
    const partnerResidenceResponse = await app.inject({
      method: 'POST',
      url: '/v1/residences',
      headers: { cookie },
      payload: { label: '妻子住宅', facing: 'north', layoutNote: '妻子档案住宅朝北' },
    })
    expect(selfResidenceResponse.statusCode).toBe(201)
    expect(partnerResidenceResponse.statusCode).toBe(201)
    const selfResidence = selfResidenceResponse.json().profile
    const partnerResidence = partnerResidenceResponse.json().profile

    const selfReport = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: { cookie },
      payload: {
        ...reportPayload('self-member-report.jpg'),
        chartProfileId: selfProfile.id,
        chartVersionId: selfProfile.currentVersion.id,
        residenceProfileId: selfResidence.id,
        residenceVersionId: selfResidence.currentVersion.id,
        residence: selfResidence.currentVersion.snapshot,
      },
    })
    const partnerReport = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: { cookie },
      payload: {
        ...reportPayload('partner-member-report.jpg'),
        chartProfileId: partnerProfile.id,
        chartVersionId: partnerProfile.currentVersion.id,
        residenceProfileId: partnerResidence.id,
        residenceVersionId: partnerResidence.currentVersion.id,
        residence: partnerResidence.currentVersion.snapshot,
      },
    })
    expect(selfReport.statusCode).toBe(202)
    expect(partnerReport.statusCode).toBe(202)

    const allReports = await app.inject({ method: 'GET', url: '/v1/reports', headers: { cookie } })
    expect(allReports.statusCode).toBe(200)
    expect(allReports.json().reports.map((report: { id: string }) => report.id).sort()).toEqual([
      partnerReport.json().id,
      selfReport.json().id,
    ].sort())

    const selfOnly = await app.inject({ method: 'GET', url: `/v1/reports?chartProfileId=${selfProfile.id}`, headers: { cookie } })
    expect(selfOnly.statusCode).toBe(200)
    expect(selfOnly.json().reports).toEqual([expect.objectContaining({
      id: selfReport.json().id,
      chartProfileId: selfProfile.id,
      residenceFacing: 'south',
    })])

    const partnerOnly = await app.inject({ method: 'GET', url: `/v1/reports?chartProfileId=${partnerProfile.id}`, headers: { cookie } })
    expect(partnerOnly.statusCode).toBe(200)
    expect(partnerOnly.json().reports).toEqual([expect.objectContaining({
      id: partnerReport.json().id,
      chartProfileId: partnerProfile.id,
      residenceFacing: 'north',
    })])
    const selfResidenceOnly = await app.inject({ method: 'GET', url: `/v1/reports?residenceProfileId=${selfResidence.id}`, headers: { cookie } })
    expect(selfResidenceOnly.statusCode).toBe(200)
    expect(selfResidenceOnly.json().reports).toEqual([expect.objectContaining({
      id: selfReport.json().id,
      chartProfileId: selfProfile.id,
      residenceProfileId: selfResidence.id,
      residenceVersionId: selfResidence.currentVersion.id,
      residenceFacing: 'south',
    })])
    const mismatchedMemberResidence = await app.inject({
      method: 'GET',
      url: `/v1/reports?chartProfileId=${selfProfile.id}&residenceProfileId=${partnerResidence.id}`,
      headers: { cookie },
    })
    expect(mismatchedMemberResidence.statusCode).toBe(200)
    expect(mismatchedMemberResidence.json()).toEqual({ reports: [] })

    await vi.waitFor(async () => {
      expect((await app.inject({ method: 'GET', url: `/v1/reports/${partnerReport.json().id}`, headers: { cookie } })).json())
        .toMatchObject({ status: 'completed' })
    })
    const archived = await app.inject({ method: 'DELETE', url: `/v1/reports/${partnerReport.json().id}`, headers: { cookie } })
    expect(archived.statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `/v1/reports?chartProfileId=${partnerProfile.id}`, headers: { cookie } })).json())
      .toEqual({ reports: [] })
    const partnerRecycleBin = await app.inject({ method: 'GET', url: `/v1/reports?archived=true&chartProfileId=${partnerProfile.id}`, headers: { cookie } })
    expect(partnerRecycleBin.json().reports).toEqual([expect.objectContaining({
      id: partnerReport.json().id,
      chartProfileId: partnerProfile.id,
      archivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
    })])
    const partnerResidenceRecycleBin = await app.inject({
      method: 'GET',
      url: `/v1/reports?archived=true&residenceProfileId=${partnerResidence.id}`,
      headers: { cookie },
    })
    expect(partnerResidenceRecycleBin.json().reports).toEqual([expect.objectContaining({
      id: partnerReport.json().id,
      residenceProfileId: partnerResidence.id,
      archivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
    })])

    const otherPrincipal = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth('11:30') })
    const otherCookie = String(otherPrincipal.headers['set-cookie']).split(';')[0]
    const crossAccountFiltered = await app.inject({
      method: 'GET',
      url: `/v1/reports?chartProfileId=${selfProfile.id}`,
      headers: { cookie: otherCookie },
    })
    expect(crossAccountFiltered.statusCode).toBe(200)
    expect(crossAccountFiltered.json()).toEqual({ reports: [] })
    const crossAccountResidenceFiltered = await app.inject({
      method: 'GET',
      url: `/v1/reports?residenceProfileId=${selfResidence.id}`,
      headers: { cookie: otherCookie },
    })
    expect(crossAccountResidenceFiltered.statusCode).toBe(200)
    expect(crossAccountResidenceFiltered.json()).toEqual({ reports: [] })
    await app.close()
  })

  it('lets administrators inspect a user workspace overview without leaking credentials or raw report inputs', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token')
    const app = await testApp('后台账号详情报告正文', { reportGenerationProvenance: generationProvenance('pass') })
    const authorization = { authorization: 'Bearer test-admin-token' }
    const username = `customer-overview-${randomUUID().slice(0, 8)}`

    const issued = await app.inject({
      method: 'POST',
      url: '/v1/admin/users',
      headers: authorization,
      payload: { username, displayName: '客户详情', password: 'initial-pass' },
    })
    expect(issued.statusCode).toBe(201)
    const userId = issued.json().user.id as string

    expect((await app.inject({ method: 'GET', url: `/v1/admin/users/${userId}/overview` })).statusCode).toBe(401)
    const empty = await app.inject({ method: 'GET', url: `/v1/admin/users/${userId}/overview`, headers: authorization })
    expect(empty.statusCode).toBe(200)
    expect(empty.json()).toMatchObject({
      user: { id: userId, username, displayName: '客户详情', hasBoundWorkspace: false },
      charts: [],
      residences: [],
      reports: { active: [], archived: [], countsByChartProfileId: {}, countsByResidenceProfileId: {} },
    })

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username, password: 'initial-pass' },
    })
    expect(login.statusCode).toBe(200)
    const cookie = String(login.headers['set-cookie']).split(';')[0]
    const selfChart = await app.inject({
      method: 'POST',
      url: '/v1/charts',
      headers: { cookie },
      payload: { ...persistableBirth(), label: '本人', relationship: 'self' },
    })
    const partnerChart = await app.inject({
      method: 'POST',
      url: '/v1/charts',
      headers: { cookie },
      payload: { ...persistableBirth('10:30'), label: '伴侣', relationship: 'partner' },
    })
    const selfProfile = selfChart.json().profile
    const partnerProfile = partnerChart.json().profile
    const selfReport = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: { cookie },
      payload: {
        ...reportPayload('admin-overview-self-private-file.jpg'),
        chartProfileId: selfProfile.id,
        chartVersionId: selfProfile.currentVersion.id,
        residence: { facing: 'south', layoutNote: '后台详情不应泄漏的完整住宅备注' },
      },
    })
    const partnerReport = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: { cookie },
      payload: {
        ...reportPayload('admin-overview-partner-private-file.jpg'),
        chartProfileId: partnerProfile.id,
        chartVersionId: partnerProfile.currentVersion.id,
        residence: { facing: 'north', layoutNote: '伴侣住宅备注不应完整展示' },
      },
    })
    await vi.waitFor(async () => {
      await expect(app.inject({ method: 'GET', url: `/v1/reports/${selfReport.json().id}`, headers: { cookie } }))
        .resolves.toMatchObject({ statusCode: 200 })
      expect((await app.inject({ method: 'GET', url: `/v1/reports/${partnerReport.json().id}`, headers: { cookie } })).json())
        .toMatchObject({ status: 'completed' })
    })
    expect((await app.inject({ method: 'DELETE', url: `/v1/reports/${partnerReport.json().id}`, headers: { cookie } })).statusCode).toBe(204)

    const overview = await app.inject({ method: 'GET', url: `/v1/admin/users/${userId}/overview`, headers: authorization })

    expect(overview.statusCode).toBe(200)
    const payload = overview.json()
    expect(payload.user).toMatchObject({ id: userId, username, displayName: '客户详情', hasBoundWorkspace: true })
    expect(payload.user).not.toHaveProperty('principalId')
    expect(payload.user).not.toHaveProperty('passwordHash')
    expect(payload.charts.map((profile: { label: string }) => profile.label).sort()).toEqual(['伴侣', '本人'])
    expect(payload.charts[0]).toMatchObject({
      currentVersion: {
        id: expect.any(String),
        version: expect.any(Number),
        pillars: expect.arrayContaining([expect.any(String)]),
      },
    })
    expect(payload.residences).toHaveLength(2)
    expect(payload.residences[0]).toMatchObject({
      id: expect.any(String),
      label: expect.any(String),
      facing: expect.stringMatching(/^(south|north)$/u),
      currentVersion: { id: expect.any(String), version: 1 },
    })
    expect(payload.reports.active).toEqual([expect.objectContaining({
      id: selfReport.json().id,
      chartProfileId: selfProfile.id,
      residenceFacing: 'south',
    })])
    expect(payload.reports.archived).toEqual([expect.objectContaining({
      id: partnerReport.json().id,
      chartProfileId: partnerProfile.id,
      archivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
    })])
    expect(payload.reports.countsByChartProfileId).toMatchObject({
      [selfProfile.id]: { active: 1, archived: 0 },
      [partnerProfile.id]: { active: 0, archived: 1 },
    })
    const selfResidenceId = payload.reports.active[0].residenceProfileId
    const partnerResidenceId = payload.reports.archived[0].residenceProfileId
    expect(payload.reports.countsByResidenceProfileId).toMatchObject({
      [selfResidenceId]: { active: 1, archived: 0 },
      [partnerResidenceId]: { active: 0, archived: 1 },
    })
    expect(JSON.stringify(payload)).not.toContain('passwordHash')
    expect(JSON.stringify(payload)).not.toContain('admin-overview-self-private-file')
    expect(JSON.stringify(payload)).not.toContain('完整住宅备注')
    expect((await app.inject({ method: 'GET', url: `/v1/admin/users/${randomUUID()}/overview`, headers: authorization })).statusCode).toBe(404)
    await app.close()
  })

  it('binds reports to an immutable residence version and reuses the selected residence profile', async () => {
    const app = await testApp('住宅版本绑定报告')
    const createdResidence = await app.inject({
      method: 'POST',
      url: '/v1/residences',
      payload: { label: '滨江南向住宅', facing: 'south', layoutNote: '客厅连接阳台' },
    })
    expect(createdResidence.statusCode).toBe(201)
    const cookie = String(createdResidence.headers['set-cookie']).split(';')[0]
    const residence = createdResidence.json().profile

    const createdReport = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: { cookie },
      payload: {
        ...reportPayload('residence-bound-photo.jpg'),
        residenceProfileId: residence.id,
        residenceVersionId: residence.currentVersion.id,
      },
    })

    expect(createdReport.statusCode).toBe(202)
    expect(createdReport.json()).toMatchObject({
      residenceProfileId: residence.id,
      residenceVersionId: residence.currentVersion.id,
      submission: {
        residenceProfileId: residence.id,
        residenceVersionId: residence.currentVersion.id,
        residence: { facing: 'south', layoutNote: '客厅连接阳台' },
      },
    })
    const reports = await app.inject({ method: 'GET', url: '/v1/reports', headers: { cookie } })
    expect(reports.json().reports[0]).toMatchObject({
      residenceProfileId: residence.id,
      residenceVersionId: residence.currentVersion.id,
      residenceFacing: 'south',
    })
    const residences = await app.inject({ method: 'GET', url: '/v1/residences', headers: { cookie } })
    expect(residences.json().profiles).toHaveLength(1)
    await app.close()
  })

  it('rejects a report when selected residence version does not match submitted fields', async () => {
    const app = await testApp('住宅版本不匹配报告')
    const createdResidence = await app.inject({
      method: 'POST',
      url: '/v1/residences',
      payload: { label: '西侧卧室住宅', facing: 'south', layoutNote: '主卧在西侧' },
    })
    const cookie = String(createdResidence.headers['set-cookie']).split(';')[0]
    const residence = createdResidence.json().profile

    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: { cookie },
      payload: {
        ...reportPayload('residence-mismatch-photo.jpg'),
        residence: { facing: 'north', layoutNote: '主卧在西侧' },
        residenceProfileId: residence.id,
        residenceVersionId: residence.currentVersion.id,
      },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error).toBe('report residence fields do not match the selected residence version')
    await app.close()
  })

  it('fails closed when a legacy stored report has no owner principal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-ownerless-report-'))
    const repository = new ReportRepository(join(directory, 'reports.json'))
    const birth = { date: '1992-08-18', time: '09:30', locationName: '杭州市', longitude: 120.1551 }
    const legacy: ReportRecord = {
      id: 'legacy-ownerless-report',
      status: 'completed',
      createdAt: new Date().toISOString(),
      submission: {
        visionConsent: true,
        calculationInput: birth,
        birth,
        residence: { facing: 'south' },
        photos: [{ fileId: 'legacy-private-photo.jpg', room: 'overview', facing: 'south' }],
      },
      bazi: calculateBazi(birth),
      report: '旧报告',
    }
    await repository.save(legacy)
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '不应生成' }),
      { analyze: async () => [] },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const principal = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth() })
    const cookie = String(principal.headers['set-cookie']).split(';')[0]
    const response = await app.inject({ method: 'GET', url: `/v1/reports/${legacy.id}`, headers: { cookie } })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'report not found' })
    expect((await repository.get(legacy.id))?.submission.photos[0]?.fileId).toBe('legacy-private-photo.jpg')
    await app.close()
  })

  it('normalizes code-only report birth input before storing the chart version', async () => {
    const app = await testApp('地点证据报告')
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: {
        visionConsent: true,
        birth: { date: '1992-08-21', time: '12:03', placeCode: '659001', useTrueSolarTime: true },
        residence: { facing: 'south', layoutNote: '客厅连接阳台' },
        photos: [{ fileId: 'private-photo-id.jpg', room: 'living-room', facing: 'south' }],
      },
    })

    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({
      submission: {
        birth: {
          province: '新疆维吾尔自治区',
          city: '新疆维吾尔自治区-自治区直辖县级行政区划',
          district: '石河子市',
          placeCode: '659001',
          locationName: '新疆维吾尔自治区 新疆维吾尔自治区-自治区直辖县级行政区划 石河子市',
          longitude: 86.01961,
          latitude: 44.32011,
          timezone: 'Asia/Shanghai',
          geoDataVersion: expect.stringContaining('geonames-cn@2026-08-31.64057955b60e'),
        },
      },
      bazi: {
        inputSnapshot: {
          placeCode: '659001',
          longitude: 86.01961,
          latitude: 44.32011,
          useTrueSolarTime: true,
        },
      },
      chartProfileId: expect.any(String),
      chartVersionId: expect.any(String),
    })
    await app.close()
  })

  it('rejects report birthplace codes without reviewed coordinates', async () => {
    const app = await testApp('不应生成')
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: {
        visionConsent: true,
        birth: { date: '1992-08-21', time: '12:03', placeCode: '110118', useTrueSolarTime: true },
        residence: { facing: 'south', layoutNote: '客厅连接阳台' },
        photos: [{ fileId: 'private-photo-id.jpg', room: 'living-room', facing: 'south' }],
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('birthplace does not have a reviewed coordinate and cannot be calculated')
    await app.close()
  })

  it('ignores client-supplied report coordinates when birthplace code is selected', async () => {
    const app = await testApp('地点防伪报告')
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: {
        visionConsent: true,
        birth: {
          date: '1992-08-21',
          time: '12:03',
          placeCode: '659001',
          locationName: '伪造地点',
          longitude: 1,
          latitude: 2,
          timezone: 'Etc/UTC',
          geoDataVersion: 'forged-client-version',
          useTrueSolarTime: true,
        },
        residence: { facing: 'south', layoutNote: '客厅连接阳台' },
        photos: [{ fileId: 'private-photo-id.jpg', room: 'living-room', facing: 'south' }],
      },
    })

    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({
      submission: {
        birth: {
          placeCode: '659001',
          locationName: '新疆维吾尔自治区 新疆维吾尔自治区-自治区直辖县级行政区划 石河子市',
          longitude: 86.01961,
          latitude: 44.32011,
          timezone: 'Asia/Shanghai',
          geoDataVersion: expect.stringContaining('geonames-cn@2026-08-31.64057955b60e'),
        },
      },
      bazi: {
        inputSnapshot: {
          placeCode: '659001',
          longitude: 86.01961,
          latitude: 44.32011,
          useTrueSolarTime: true,
        },
      },
    })
    await app.close()
  })

  it('binds a report to the exact current version of an owned chart profile', async () => {
    const app = await testApp('命盘版本绑定报告')
    const chart = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth() })
    const cookie = String(chart.headers['set-cookie']).split(';')[0]
    const profile = chart.json().profile
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: { cookie },
      payload: {
        visionConsent: true,
        chartProfileId: profile.id,
        chartVersionId: profile.currentVersion.id,
        birth: { date: '2000-01-01', time: '00:00', locationName: '不应采用', longitude: 120 },
        residence: { facing: 'south' },
        photos: [{ fileId: 'private-photo-id.jpg', room: 'living-room', facing: 'south' }],
      },
    })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({
      chartProfileId: profile.id,
      chartVersionId: profile.currentVersion.id,
      submission: { birth: profile.currentVersion.birth },
      bazi: profile.currentVersion.bazi,
    })
    await app.close()
  })

  it('rejects a stale chart version when another tab has updated the profile', async () => {
    const app = await testApp()
    const chart = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth() })
    const cookie = String(chart.headers['set-cookie']).split(';')[0]
    const original = chart.json().profile
    await app.inject({ method: 'POST', url: `/v1/charts/${original.id}/versions`, headers: { cookie }, payload: {
      ...persistableBirth('10:30'), expectedRevision: 1,
    } })
    const response = await app.inject({ method: 'POST', url: '/v1/reports', headers: { cookie }, payload: {
      visionConsent: true,
      chartProfileId: original.id,
      chartVersionId: original.currentVersion.id,
      birth: original.currentVersion.birth,
      residence: { facing: 'south' },
      photos: [{ fileId: 'private-photo-id.jpg', room: 'living-room', facing: 'south' }],
    } })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ profile: { revision: 2, currentVersion: { version: 2 } } })
    await app.close()
  })

  it('rejects report jobs that reference a missing upload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-missing-media-'))
    const app = buildApp(
      new ReportRepository(join(directory, 'reports.json')),
      new MediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '不应生成' }),
      { analyze: async () => [] },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south' },
      photos: [{ fileId: 'missing-photo.jpg', room: 'living-room', facing: 'south' }],
    } })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('missing')
    await app.close()
  })

  it('rejects report jobs that try to reuse another principal upload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-media-owner-api-'))
    const app = buildApp(
      new ReportRepository(join(directory, 'reports.json')),
      new MediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '不应生成' }),
      { analyze: async () => [] },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const boundary = 'fengshui-cross-owner-boundary'
    const upload = await app.inject({
      method: 'POST',
      url: '/v1/media',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-vision-consent': 'accepted' },
      payload: pngUploadPayload(boundary),
    })
    expect(upload.statusCode).toBe(201)
    const otherPrincipal = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth('10:30') })
    const otherCookie = String(otherPrincipal.headers['set-cookie']).split(';')[0]

    const response = await app.inject({ method: 'POST', url: '/v1/reports', headers: { cookie: otherCookie }, payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south' },
      photos: [{ fileId: upload.json().fileId, room: 'overview', facing: 'south' }],
    } })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('missing or invalid')
    await app.close()
  })

  it('persists a failed status when the first final write fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-api-'))
    class FailFinalWriteOnce extends ReportRepository {
      private failed = false
      override async save(record: Parameters<ReportRepository['save']>[0]) {
        if (!this.failed && record.phase === 'completed') {
          this.failed = true
          throw new Error('simulated final write failure')
        }
        return super.save(record)
      }
      override async saveClaimed(record: ReportRecord, fence: Parameters<ReportRepository['saveClaimed']>[1]): Promise<void> {
        if (!this.failed && record.phase === 'completed') {
          this.failed = true
          throw new Error('simulated final write failure')
        }
        return super.saveClaimed(record, fence)
      }
    }
    const repository = new FailFinalWriteOnce(join(directory, 'reports.json'))
    const app = buildApp(
      repository,
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => ({ report: '合规报告' }),
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '测试空间', observedElements: [], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
    )
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: {
        visionConsent: true,
        birth: persistableBirth(),
        residence: { facing: 'south' },
        photos: [{ fileId: 'private-photo-id.jpg', room: 'living-room', facing: 'south' }],
      },
    })
    await vi.waitFor(async () => expect(await repository.get(response.json().id)).toMatchObject({
      status: 'failed',
      phase: 'failed',
      error: 'Report result persistence failed',
    }))
    const stored = await repository.get(response.json().id)
    expect(stored).toMatchObject({ status: 'failed', phase: 'failed', error: 'Report result persistence failed' })
    expectFailedTiming(stored?.stageTimings?.at(-1), 'harness-generating')
    await app.close()
  })

  it('runs professional reasoning when governed evidence is complete even if deterministic rules stay neutral', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-rule-report-'))
    const knowledge = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const rule = await knowledge.create({
      kind: 'rule', title: '南向规则', tags: ['南向'], body: '南向住宅的结构化文化规则。', sourceLabel: '测试专家',
      rule: { priority: 50, conditions: [{ fact: 'residence.facing', operator: 'equals', value: 'south' }], conclusions: [{ code: 'south-facing', text: '记录南向条件。', level: 'info', effect: 'neutral' }] },
    })
    await knowledge.setState(rule.id, 'in-review', 'knowledge-editor')
    await knowledge.setState(rule.id, 'published', 'knowledge-reviewer')
    const article = await knowledge.create({ kind: 'article', title: '客厅采光依据', tags: ['living-room'], body: '保持自然采光。', sourceLabel: '测试专家' })
    await knowledge.setState(article.id, 'in-review', 'knowledge-editor')
    await knowledge.setState(article.id, 'published', 'knowledge-reviewer')
    let generatedRecord: ReportRecord | undefined
    const professionalReasoner = vi.fn(async (record: ReportRecord) => record.compatibility!)
    const app = buildApp(
      new ReportRepository(join(directory, 'reports.json')),
      new TestMediaStore(join(directory, 'uploads')),
      knowledge,
      async (record) => { generatedRecord = record; return { report: '规则报告' } },
      { analyze: async (photos) => photos.map((photo) => ({ fileId: photo.fileId, room: photo.room, summary: '测试空间', observedElements: ['南向采光面'], uncertainties: [] })) },
      new ChartRepository(join(directory, 'charts.json')),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      professionalReasoner,
    )
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: {
      visionConsent: true,
      birth: persistableBirth(),
      residence: { facing: 'south' },
      photos: [{ fileId: 'rule-photo.jpg', room: 'living-room', facing: 'south' }],
    } })
    expect(response.statusCode).toBe(202)
    const cookie = String(response.headers['set-cookie']).split(';')[0]
    await vi.waitFor(() => expect(generatedRecord?.evaluatedRules).toHaveLength(1))
    await vi.waitFor(async () => expect(await app.inject({ method: 'GET', url: `/v1/reports/${response.json().id}`, headers: { cookie } }))
      .toMatchObject({ statusCode: 200, body: expect.stringContaining('"status":"completed"') }))
    expect(generatedRecord?.evaluatedRules?.[0]?.versionId).toContain(`${rule.id}:v1:`)
    expect(generatedRecord?.compatibility).toMatchObject({ assessable: false, overallLevel: 'insufficient-evidence' })
    expect(professionalReasoner).toHaveBeenCalledOnce()
    const stored = await app.inject({ method: 'GET', url: `/v1/reports/${response.json().id}`, headers: { cookie } })
    expect(stored.json().evaluatedRules?.[0]).toMatchObject({ title: '南向规则', versionId: expect.stringContaining(`${rule.id}:v1:`), contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(stored.json().citations?.[0]).toMatchObject({ id: article.id, versionId: expect.stringContaining(`${article.id}:v1:`), contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    await app.close()
  })

  it('stores an accepted image and rejects non-images', async () => {
    const app = await testApp()
    const boundary = 'fengshui-test-boundary'
    const accepted = await app.inject({
      method: 'POST', url: '/v1/media',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-vision-consent': 'accepted' },
      payload: pngUploadPayload(boundary),
    })
    expect(accepted.statusCode).toBe(201)
    expect(accepted.json().fileId).toMatch(/\.png$/)
    expect(accepted.headers['set-cookie']).toContain('fengshui_principal=')

    const rejected = await app.inject({
      method: 'POST', url: '/v1/media',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-vision-consent': 'accepted' },
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\nnot-an-image\r\n--${boundary}--\r\n`,
    })
    expect(rejected.statusCode).toBe(400)
    await app.close()
  })
})
