import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  LUNAR_YEAR_PROFILE_ERROR,
  calculateBazi,
  calculateBaziFromPillars,
  calculateBaziFlow,
  compareBaziWithExpected,
  getBaziTimeRuntimeProvenance,
  getLunarYearProfile,
} from '@fengshui/bazi-engine'
import {
  compareWenzhenExpected,
  createWenzhenFixtureReport,
  summarizeWenzhenAcceptance,
  validateWenzhenCaptureMatrix,
  validateWenzhenFixture,
  WENZHEN_ASSERTION_COVERAGE_CATEGORIES,
  type AcceptedDifferenceClassification,
  type WenzhenFixture,
  type WenzhenExpected,
  type WenzhenAssertionCoverageCategory,
  type ReportableWenzhenFixture,
} from '@fengshui/bazi-engine/wenzhen-fixtures'
import type {
  BaziCalculationInput,
  BaziCalculationResult,
  BaziRuleProfileState,
  BaziRuleProfileVersionReference,
  BaziRuleTimeDefaults,
  BirthInput,
  ChartProfile,
  ChartProfileMetadata,
  ChartProfileRelationship,
  ChartVersion,
  CycleQuery,
  ManualFourPillarsInput,
  PublishedBaziRuleProfileVersion,
  ReportGenerationProvenance,
  ReportPhase,
  ReportPipelineCheckpoint,
  ReportQualityReview,
  ReportRecord,
  ResidenceProfile,
  ResidenceSnapshot,
  ReportStageTiming,
  ReportSubmission,
  VisionObservation,
  NineGridInput,
  NineGridResult,
} from '@fengshui/domain'
import { analyzeFloorPlanNineGrid } from '@fengshui/domain'
import {
  ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA,
  SELECTABLE_BIRTHPLACE_TREE,
  birthInputFromPlace,
  findAdministrativeBirthplaceByCode,
  findBirthplace,
  findBirthplaceByCode,
  searchBirthplaces,
  searchAdministrativeBirthplaces,
  validateAdministrativeBirthplaceDataset,
} from '@fengshui/geo-data'
import {
  generateReport,
  hasMinimumCompatibilityFacts,
  reasonAboutCompatibilityWithHarness,
  reviewReportWithHarness,
  reviseReportWithHarness,
  type ProfessionalReasoner,
  type ReportGenerator,
} from './harness.js'
import { REPORT_VALIDATOR_VERSION, ReportValidationError } from './report-validator.js'
import {
  InvalidKnowledgeTransitionError,
  KnowledgePublicationValidationError,
  KnowledgeRepository,
  KnowledgeRevisionConflictError,
  parseKnowledgeAssetRequest,
} from './knowledge.js'
import type { KnowledgeStore } from './knowledge.js'
import { MediaClaimConflictError, MediaOwnershipError, MediaStore } from './media.js'
import { LostReportLeaseError, ReportArchiveConflictError, ReportRepository } from './repository.js'
import type { ReportStore } from './repository.js'
import { ResidenceRepository, ResidenceRevisionConflictError, residenceSnapshotFromSubmission, sameResidenceSnapshot, type ResidenceStore } from './residences.js'
import {
  ReportQualityReviewError,
  runReportQualityWorkflow,
  type ReportDraft,
  type ReportQualityReviewer,
  type ReportQualityWorkflowState,
  type ReportReviser,
} from './report-quality.js'
import { buildPersonHouseCompatibilityAssessment, evaluatePublishedRules } from './rules.js'
import { DeepSeekVisionAnalyzer, type VisionAnalyzer } from './vision.js'
import { ChartProfileAlreadyExistsError, ChartProfileLimitExceededError, ChartRepository, ChartRevisionConflictError, ChartVersionRestoreConflictError, type ChartStore } from './charts.js'
import {
  BaziRuleProfileReferencedError,
  BaziRuleProfileRepository,
  BaziRuleProfileRevisionConflictError,
  BaziRuleProfileValidationError,
  DuplicateBaziRuleProfileKeyError,
  InvalidBaziRuleProfileTransitionError,
  parseBaziRuleProfileRevisionRequest,
  type BaziRuleProfileStore,
  type CreateBaziRuleProfileInput,
  type ReviseBaziRuleProfileInput,
} from './rule-profiles.js'
import { FileWenzhenFixtureStore, type WenzhenFixtureStore } from './wenzhen-store.js'
import { FileAccountStore, hashPassword, normalizeUsername, verifyPassword, type AccountStore } from './auth.js'
import { FileWenzhenEvidenceStore, WENZHEN_EVIDENCE_MAX_BYTES } from './wenzhen-evidence-store.js'
import { checkReportReadiness } from './config.js'
import {
  ChartPdfUnavailableError,
  productionChartPdfRenderer,
  type ChartPdfRenderer,
} from './chart-pdf.js'
import {
  productionReportPdfRenderer,
  ReportPdfUnavailableError,
  type ReportPdfRenderer,
} from './report-pdf.js'

type BirthInputRequest = Partial<BirthInput> & Pick<BirthInput, 'date' | 'time'>
type BaziCalculationRequest = (BirthInputRequest | ManualFourPillarsInput) & { ruleProfileVersionId?: string }
type ChartCreationRequest = BaziCalculationRequest & {
  label?: string
  relationship?: ChartProfileRelationship
}
type BaziFlowRequest = { birth?: BirthInputRequest; query?: CycleQuery; ruleProfileVersionId?: string }
type ChartVersionRequest = BaziCalculationRequest & { expectedRevision?: number }
type ChartVersionRestoreRequest = { expectedRevision?: number }
type ResidenceSnapshotRequest = Partial<ResidenceSnapshot> & Pick<ResidenceSnapshot, 'label' | 'facing'> & { expectedRevision?: number }
type ResidenceRestoreVersionRequest = { sourceVersionId?: string; expectedRevision?: number }
type PublicReportSummary = {
  id: string
  status: ReportRecord['status']
  archivedAt?: string
  phase?: ReportPhase
  createdAt: string
  chartProfileId?: string
  chartVersionId?: string
  residenceProfileId?: string
  residenceVersionId?: string
  residenceFacing?: string
  photoCount: number
  hasReport: boolean
  reportPreview?: string
}
type AdminChartProfileSummary = {
  id: string
  label: string
  relationship: ChartProfileRelationship
  revision: number
  createdAt: string
  updatedAt: string
  deletedAt?: string
  currentVersion: {
    id: string
    version: number
    createdAt: string
    pillars: readonly string[]
    birth?: {
      date: string
      time: string
      locationName?: string
      placeCode?: string
      calendarSystem?: BirthInput['calendarSystem']
    }
  }
}
type AdminUserOverview = {
  user: {
    id: string
    username: string
    displayName: string
    status: string
    createdAt: string
    updatedAt: string
    lastLoginAt?: string
    hasBoundWorkspace: boolean
  }
  charts: AdminChartProfileSummary[]
  residences: AdminResidenceProfileSummary[]
  reports: {
    active: PublicReportSummary[]
    archived: PublicReportSummary[]
    countsByChartProfileId: Record<string, { active: number; archived: number }>
    countsByResidenceProfileId: Record<string, { active: number; archived: number }>
  }
}
type AdminResidenceProfileSummary = {
  id: string
  label: string
  facing: string
  revision: number
  createdAt: string
  updatedAt: string
  currentVersion: {
    id: string
    version: number
    createdAt: string
  }
}
type StoredChartFlowRequest = {
  chartVersionId?: string
  targetDate?: string
  targetTime?: string
}
type ReportSubmissionRequest = Omit<ReportSubmission, 'visionConsent' | 'calculationInput' | 'birth'> & {
  visionConsent?: boolean
  calculationInput?: BirthInputRequest | ManualFourPillarsInput
  /** Legacy request alias accepted only for birth-data submissions. */
  birth?: BirthInputRequest
}

const compatibilityQualityReviewer: ReportQualityReviewer = async (_record, _draft, attempt): Promise<ReportQualityReview> => ({
  schemaVersion: 'report-quality-review-v1',
  verdict: 'pass',
  score: 100,
  issues: [],
  reviewedAt: new Date().toISOString(),
  attempt,
})

const compatibilityReportReviser: ReportReviser = async (_record, draft): Promise<ReportDraft> => draft
const compatibilityProfessionalReasoner: ProfessionalReasoner = async (record) => {
  if (!record.compatibility) throw new Error('deterministic compatibility assessment is missing')
  return record.compatibility
}
const DEFAULT_PROFESSIONAL_REASONING_TIMEOUT_MS = 60_000
const MIN_PROFESSIONAL_REASONING_TIMEOUT_MS = 5_000
const MAX_PROFESSIONAL_REASONING_TIMEOUT_MS = 300_000
const MAX_CHART_PROFILE_LABEL_LENGTH = 40
const CHART_PROFILE_RELATIONSHIPS = new Set<ChartProfileRelationship>(['self', 'partner', 'parent', 'child', 'other'])

function parseChartProfileMetadata(input: Pick<ChartCreationRequest, 'label' | 'relationship'>): ChartProfileMetadata {
  const label = input.label === undefined ? '我的命盘' : input.label.trim()
  const relationship = input.relationship ?? 'self'
  if (!label || label.length > MAX_CHART_PROFILE_LABEL_LENGTH) {
    throw new Error(`label must be between 1 and ${MAX_CHART_PROFILE_LABEL_LENGTH} characters`)
  }
  if (!CHART_PROFILE_RELATIONSHIPS.has(relationship)) {
    throw new Error('relationship must be one of self, partner, parent, child or other')
  }
  return { label, relationship }
}

export function professionalReasoningTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PROFESSIONAL_REASONING_TIMEOUT_MS?.trim()
  if (!raw) return DEFAULT_PROFESSIONAL_REASONING_TIMEOUT_MS
  if (!/^\d+$/u.test(raw)) return DEFAULT_PROFESSIONAL_REASONING_TIMEOUT_MS
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < MIN_PROFESSIONAL_REASONING_TIMEOUT_MS || value > MAX_PROFESSIONAL_REASONING_TIMEOUT_MS) {
    return DEFAULT_PROFESSIONAL_REASONING_TIMEOUT_MS
  }
  return value
}

async function withProfessionalReasoningTimeout<T>(work: Promise<T>, timeoutMs = professionalReasoningTimeoutMs()): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`professional reasoning timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function buildApp(
  repository: ReportStore = new ReportRepository(fileURLToPath(new URL('../../../.data/reports.json', import.meta.url))),
  mediaStore = new MediaStore(fileURLToPath(new URL('../../../.data/uploads/', import.meta.url))),
  knowledge: KnowledgeStore = new KnowledgeRepository(fileURLToPath(new URL('../../../.data/knowledge.json', import.meta.url))),
  reportGenerator: ReportGenerator | ((record: ReportRecord) => Promise<string>) = generateReport,
  visionAnalyzer: VisionAnalyzer = new DeepSeekVisionAnalyzer(mediaStore),
  charts: ChartStore = new ChartRepository(fileURLToPath(new URL('../../../.data/charts.json', import.meta.url))),
  ruleProfiles: BaziRuleProfileStore = new BaziRuleProfileRepository(fileURLToPath(new URL('../../../.data/bazi-rule-profiles.json', import.meta.url))),
  wenzhenRuntimeFixtureStore: string | WenzhenFixtureStore = fileURLToPath(new URL('../../../.data/wenzhen-fixture-store.json', import.meta.url)),
  wenzhenEvidenceStore: FileWenzhenEvidenceStore = new FileWenzhenEvidenceStore(fileURLToPath(new URL('../../../.data/evidence/wenzhen/', import.meta.url))),
  reportQualityReviewer?: ReportQualityReviewer,
  reportReviser?: ReportReviser,
  professionalReasoner?: ProfessionalReasoner,
  chartPdfRenderer: ChartPdfRenderer = productionChartPdfRenderer,
  reportPdfRenderer: ReportPdfRenderer = productionReportPdfRenderer,
  residences: ResidenceStore = new ResidenceRepository(fileURLToPath(new URL('../../../.data/residences.json', import.meta.url))),
  accounts: AccountStore = new FileAccountStore(fileURLToPath(new URL('../../../.data/accounts.json', import.meta.url))),
) {
  const app = Fastify()
  // Production uses two independent Harness roles. Tests and local injected
  // renderers retain an explicit compatibility seam unless they inject their
  // own reviewer/reviser, so a fake writer never triggers a real model call.
  const activeReportQualityReviewer = reportQualityReviewer
    ?? (reportGenerator === generateReport ? reviewReportWithHarness : compatibilityQualityReviewer)
  const activeReportReviser = reportReviser
    ?? (reportGenerator === generateReport ? reviseReportWithHarness : compatibilityReportReviser)
  const activeProfessionalReasoner = professionalReasoner
    ?? (reportGenerator === generateReport ? reasonAboutCompatibilityWithHarness : compatibilityProfessionalReasoner)
  const reviewReportWithLocalFallback: ReportQualityReviewer = async (record, draft, attempt) => {
    try {
      return await activeReportQualityReviewer(record, draft, attempt)
    } catch (error) {
      if (draft.generationProvenance?.validatorResult !== 'pass') throw error
      app.log.warn({ err: error, reportId: record.id }, 'quality reviewer failed; accepting validator-approved draft with local fallback review')
      return {
        schemaVersion: 'report-quality-review-v1',
        verdict: 'pass',
        score: 82,
        issues: [{
          code: 'quality-reviewer-unavailable',
          severity: 'low',
          message: '独立质量审核 Agent 暂不可用；本报告已通过服务端发布校验，本地兜底允许展示。',
        }],
        reviewedAt: new Date().toISOString(),
        attempt,
      }
    }
  }
  const wenzhenStore = typeof wenzhenRuntimeFixtureStore === 'string'
    ? new FileWenzhenFixtureStore(wenzhenRuntimeFixtureStore)
    : wenzhenRuntimeFixtureStore
  const wenzhenFixturePath = fileURLToPath(new URL('../../../packages/bazi-engine/tests/fixtures/wenzhen/samples.json', import.meta.url))
  const wenzhenCaptureMatrixPath = fileURLToPath(new URL('../../../packages/bazi-engine/tests/fixtures/wenzhen/capture-matrix.json', import.meta.url))
  const directions = new Set(['north', 'east', 'south', 'west', 'unknown'])
  const rooms = new Set(['overview', 'living-room', 'bedroom', 'kitchen', 'bathroom', 'entrance', 'other'])
  const publicationStates = new Set(['draft', 'in-review', 'published', 'archived'])
  const reportWorkerId = `api-${process.pid}-${randomBytes(6).toString('hex')}`
  const reportLeaseTtlMs = 15 * 60 * 1000
  const reportShareTtlMs = 7 * 24 * 60 * 60 * 1000
  const reportShareTokenBytes = 32
  const maxReportShareTokenLength = 128
  const acceptedDifferenceClassifications: ReadonlySet<string> = new Set<AcceptedDifferenceClassification>([
    'dependency',
    'school-rule',
    'timezone-location',
    'display-rounding',
    'bug',
  ])
  const wenzhenExpectedKeys: ReadonlySet<string> = new Set([
    'pillars',
    'timeCorrectionRuleVersion',
    'correctedLocalTime',
    'correctionMinutes',
    'timeProfile',
    'pillarDetails',
    'luckCycles',
    'annualCycles',
    'monthlyCycles',
    'dailyCycles',
    'hourlyCycles',
  ])
  const mediaRetentionMs = 24 * 60 * 60 * 1000
  const legacyTimeCorrectionRuleVersion = 'true-solar-v2-zone-meridian-equation-of-time'
  const reportCitationLimit = 8
  const activeReports = new Map<string, Promise<void>>()
  const adminToken = process.env.ADMIN_API_TOKEN
  const adminActor = process.env.ADMIN_ACTOR_ID ?? 'local-admin'
  const knowledgeReaderToken = process.env.KNOWLEDGE_MCP_TOKEN
  const principalCookieName = 'fengshui_principal'
  const userSessionCookieName = 'fengshui_user_session'
  const userSessionTtlMs = 30 * 24 * 60 * 60 * 1000
  const adminUsername = process.env.ADMIN_USERNAME?.trim()
  const adminPassword = process.env.ADMIN_PASSWORD
  const adminSessionCookieName = 'fengshui_admin_session'
  const adminSessionTtlMs = 12 * 60 * 60 * 1000
  const adminSessionMaxAgeSeconds = Math.floor(adminSessionTtlMs / 1000)
  const adminLoginMaxAttempts = 10
  const adminLoginWindowMs = 15 * 60 * 1000
  const adminSessions = new Map<string, { actor: string; expiresAt: number }>()
  const adminLoginAttempts = new Map<string, { count: number; resetAt: number }>()
  function adminLoginConfigured() {
    return Boolean(adminUsername && adminPassword)
  }
  function adminApiConfigured() {
    return Boolean(adminToken) || adminLoginConfigured()
  }
  function matchesBearerToken(authorization: string | undefined, expectedToken: string | undefined) {
    if (!expectedToken || !authorization?.startsWith('Bearer ')) return false
    const candidate = Buffer.from(authorization.slice('Bearer '.length))
    const expected = Buffer.from(expectedToken)
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  }
  function verifyAdminPassword(candidate: string) {
    if (!adminPassword) return false
    const submitted = Buffer.from(candidate)
    const expected = Buffer.from(adminPassword)
    return submitted.length === expected.length && timingSafeEqual(submitted, expected)
  }
  function adminSessionFromCookie(cookieHeader: string | undefined) {
    const token = cookieValue(cookieHeader, adminSessionCookieName)
    if (!token) return undefined
    const key = tokenHash(token)
    const session = adminSessions.get(key)
    if (!session) return undefined
    if (session.expiresAt <= Date.now()) { adminSessions.delete(key); return undefined }
    return session
  }
  function pruneExpiredAdminSessions() {
    const now = Date.now()
    for (const [key, session] of adminSessions) if (session.expiresAt <= now) adminSessions.delete(key)
  }
  function loginRateLimited(key: string) {
    const entry = adminLoginAttempts.get(key)
    if (!entry) return false
    if (entry.resetAt <= Date.now()) { adminLoginAttempts.delete(key); return false }
    return entry.count >= adminLoginMaxAttempts
  }
  function recordLoginFailure(key: string) {
    const entry = adminLoginAttempts.get(key)
    if (!entry || entry.resetAt <= Date.now()) adminLoginAttempts.set(key, { count: 1, resetAt: Date.now() + adminLoginWindowMs })
    else entry.count += 1
  }
  function requireAdmin(request: { headers: { authorization?: string; cookie?: string } }, reply: { code(statusCode: number): { send(payload: object): unknown } }) {
    if (!adminApiConfigured()) return reply.code(503).send({ error: 'admin API is not configured' })
    if (matchesBearerToken(request.headers.authorization, adminToken)) return
    if (adminSessionFromCookie(request.headers.cookie)) return
    return reply.code(401).send({ error: 'admin authorization required' })
  }
  function requireKnowledgeReader(authorization: string | undefined, reply: { code(statusCode: number): { send(payload: object): unknown } }) {
    if (!knowledgeReaderToken) {
      if (process.env.NODE_ENV === 'production') return reply.code(503).send({ error: 'knowledge reader API is not configured' })
      return
    }
    if (!matchesBearerToken(authorization, knowledgeReaderToken)) return reply.code(401).send({ error: 'knowledge reader authorization required' })
  }
  function tokenHash(token: string) {
    return createHash('sha256').update(token).digest('hex')
  }
  function tokenHashMatches(candidateToken: string | undefined, expectedHash: string | undefined) {
    if (!candidateToken || !expectedHash) return false
    if (candidateToken.length > maxReportShareTokenLength || expectedHash.length !== 64) return false
    const candidate = Buffer.from(tokenHash(candidateToken), 'hex')
    const expected = Buffer.from(expectedHash, 'hex')
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  }
  function hasCurrentValidatorApproval(record: ReportRecord) {
    return record.generationProvenance?.validatorResult === 'pass' &&
      record.generationProvenance.validatorVersion === REPORT_VALIDATOR_VERSION
  }
  function reportCanBeShared(record: ReportRecord) {
    return !record.archivedAt &&
      record.status === 'completed' &&
      Boolean(record.report?.trim()) &&
      hasCurrentValidatorApproval(record) &&
      record.qualityReviews?.at(-1)?.verdict === 'pass' &&
      (record.qualityStatus === undefined || record.qualityStatus === 'passed')
  }
  function hasSelectedBirthplace(input: Partial<BirthInput> | undefined): input is BirthInputRequest & { province: string; city: string; district: string } {
    return Boolean(
      typeof input?.province === 'string' && input.province.trim() &&
      typeof input.city === 'string' && input.city.trim() &&
      typeof input.district === 'string' && input.district.trim(),
    )
  }
  function hasValidBirthInput(input: Partial<BirthInput> | undefined): input is BirthInputRequest {
    if (typeof input?.date !== 'string' || !input.date.trim() || typeof input.time !== 'string' || !input.time.trim()) return false
    if (input.placeCode !== undefined) return true
    if (hasSelectedBirthplace(input)) return true
    return Boolean(typeof input.locationName === 'string' && input.locationName.trim() && Number.isFinite(input.longitude))
  }
  function isWenzhenExpectedPreview(value: unknown): value is WenzhenExpected {
    return typeof value === 'object' && value !== null && !Array.isArray(value) &&
      Object.prototype.hasOwnProperty.call(value, 'pillars') &&
      Object.keys(value).every((key) => wenzhenExpectedKeys.has(key))
  }
  function hasPersistableBirthInput(input: Partial<BirthInput> | undefined): input is BirthInputRequest & { placeCode: string } {
    return Boolean(
      hasValidBirthInput(input) &&
      typeof input.placeCode === 'string' &&
      input.placeCode.trim(),
    )
  }
  function normalizeBirthInput(input: BirthInputRequest, defaults?: BaziRuleTimeDefaults): BirthInput {
    const withDefaults: BirthInputRequest = defaults ? {
      ...input,
      ...(input.timezone === undefined ? { timezone: defaults.timezone } : {}),
      ...(input.dstPolicy === undefined ? { dstPolicy: defaults.dstPolicy } : {}),
      ...(input.useTrueSolarTime === undefined ? { useTrueSolarTime: defaults.useTrueSolarTime } : {}),
      ...(input.timeCorrectionRuleVersion === undefined ? { timeCorrectionRuleVersion: defaults.timeCorrectionRuleVersion ?? legacyTimeCorrectionRuleVersion } : {}),
      ...(input.dayBoundary === undefined ? { dayBoundary: defaults.dayBoundary } : {}),
      ...(input.luckMethod === undefined ? { luckMethod: defaults.luckMethod } : {}),
    } : {
      ...input,
      ...(input.timeCorrectionRuleVersion === undefined ? { timeCorrectionRuleVersion: legacyTimeCorrectionRuleVersion } : {}),
    }
    if (withDefaults.placeCode !== undefined) {
      if (typeof withDefaults.placeCode !== 'string') throw new Error('birthplace code must be a string')
      const placeCode = withDefaults.placeCode.trim()
      const administrative = placeCode ? findAdministrativeBirthplaceByCode(placeCode) : undefined
      if (!administrative) throw new Error('birthplace code is not in the configured city database')
      if (!administrative.selectable) throw new Error('birthplace does not have a reviewed coordinate and cannot be calculated')
      const place = findBirthplaceByCode(placeCode)
      if (!place) throw new Error('birthplace does not have a reviewed coordinate and cannot be calculated')
      const suppliedNames = [
        ['province', withDefaults.province, place.province.name],
        ['city', withDefaults.city, place.city.name],
        ['district', withDefaults.district, place.district.name],
      ] as const
      const mismatch = suppliedNames.find(([, supplied, canonical]) => supplied !== undefined && (typeof supplied !== 'string' || supplied.trim() !== canonical))
      if (mismatch) throw new Error(`${mismatch[0]} does not match birthplace code`)
      return { ...withDefaults, ...birthInputFromPlace(place.province, place.city, place.district) }
    }
    const suppliedAdministrativeNames = [withDefaults.province, withDefaults.city, withDefaults.district]
    if (suppliedAdministrativeNames.some((value) => value !== undefined)) {
      if (!hasSelectedBirthplace(withDefaults)) throw new Error('province, city and district must be provided together')
      const place = findBirthplace(withDefaults.province.trim(), withDefaults.city.trim(), withDefaults.district.trim())
      if (!place) throw new Error('birthplace is not in the configured city database')
      return { ...withDefaults, ...birthInputFromPlace(place.province, place.city, place.district) }
    }
    if (withDefaults.geoDataVersion !== undefined) throw new Error('geoDataVersion requires a selected birthplace code')
    const locationName = typeof withDefaults.locationName === 'string' ? withDefaults.locationName.trim() : ''
    if (!locationName || !Number.isFinite(withDefaults.longitude)) throw new Error('legacy birthplace requires locationName and longitude')
    return { ...withDefaults, locationName, longitude: withDefaults.longitude! }
  }
  function ruleProfileReference(version: PublishedBaziRuleProfileVersion): BaziRuleProfileVersionReference {
    return {
      profileId: version.profileId,
      versionId: version.versionId,
      version: version.version,
      key: version.key,
      name: version.name,
      contentHash: version.contentHash,
    }
  }
  function publicRuleProfileVersion(version: PublishedBaziRuleProfileVersion) {
    const summarize = ({ enabled, method, ruleSetVersion }: PublishedBaziRuleProfileVersion['definition']['assessments']['strength']) => ({
      enabled,
      method,
      ruleSetVersion,
    })
    return {
      ...version,
      definition: {
        ...(version.definition.schemaVersion === 2 ? { schemaVersion: 2 as const } : {}),
        timeDefaults: version.definition.timeDefaults,
        assessments: {
          strength: summarize(version.definition.assessments.strength),
          pattern: summarize(version.definition.assessments.pattern),
          ...(version.definition.assessments.elementPreference
            ? { elementPreference: summarize(version.definition.assessments.elementPreference) }
            : {}),
          shenSha: summarize(version.definition.assessments.shenSha),
        },
      },
    }
  }
  async function validateRuleProfileKnowledgeSources(profileId: string) {
    const profile = (await ruleProfiles.list()).find((item) => item.id === profileId)
    if (!profile) return false
    if (profile.workingDefinition.schemaVersion !== 2) return true
    const sourceVersionIds = [...new Set(Object.values(profile.workingDefinition.assessments)
      .flatMap((assessment) => assessment.rules ?? [])
      .flatMap((rule) => rule.sourceVersionIds))]
    for (const versionId of sourceVersionIds) {
      if (!await knowledge.getVersion(versionId)) {
        throw new BaziRuleProfileValidationError(`referenced knowledge version not found: ${versionId}`)
      }
    }
    return true
  }
  async function resolveCalculationInput(birth: BirthInputRequest, ruleProfileVersionId?: unknown) {
    if (ruleProfileVersionId === undefined) return { birth: normalizeBirthInput(birth) }
    if (typeof ruleProfileVersionId !== 'string' || !ruleProfileVersionId.trim()) {
      throw new Error('ruleProfileVersionId must identify an active published rule profile version')
    }
    const version = await ruleProfiles.getActiveVersion(ruleProfileVersionId.trim())
    if (!version) throw new Error('selected bazi rule profile version is not active')
    return {
      birth: normalizeBirthInput(birth, version.definition.timeDefaults),
      ruleProfileVersion: ruleProfileReference(version),
      executableRuleProfileVersion: version,
    }
  }
  async function resolveRuleProfileReferenceOnly(ruleProfileVersionId?: unknown) {
    if (ruleProfileVersionId === undefined) return {}
    if (typeof ruleProfileVersionId !== 'string' || !ruleProfileVersionId.trim()) {
      throw new Error('ruleProfileVersionId must identify an active published rule profile version')
    }
    const version = await ruleProfiles.getActiveVersion(ruleProfileVersionId.trim())
    if (!version) throw new Error('selected bazi rule profile version is not active')
    return { ruleProfileVersion: ruleProfileReference(version) }
  }
  function isManualFourPillarsInput(input: unknown): input is ManualFourPillarsInput {
    return Boolean(input && typeof input === 'object' && (input as { inputMode?: unknown }).inputMode === 'manual-four-pillars')
  }
  async function calculateRequest(
    input: unknown,
    ruleProfileVersionId?: unknown,
    requirePersistableBirth = false,
  ): Promise<{
    calculationInput: BaziCalculationInput
    bazi: BaziCalculationResult
    birth?: BirthInput
    ruleProfileVersion?: BaziRuleProfileVersionReference
  }> {
    if (isManualFourPillarsInput(input)) {
      const bazi = calculateBaziFromPillars(input)
      return {
        calculationInput: bazi.inputSnapshot,
        bazi,
        ...await resolveRuleProfileReferenceOnly(ruleProfileVersionId),
      }
    }
    const birth = input as Partial<BirthInput> | undefined
    if (requirePersistableBirth ? !hasPersistableBirthInput(birth) : !hasValidBirthInput(birth)) {
      throw new Error(requirePersistableBirth
        ? 'valid birth date, time and a non-empty birthplace code are required to save a chart'
        : 'valid birth date, time and birthplace selection or longitude are required')
    }
    const resolved = await resolveCalculationInput(birth as BirthInputRequest, ruleProfileVersionId)
    return {
      calculationInput: resolved.birth,
      birth: resolved.birth,
      bazi: calculateBazi(resolved.birth, resolved.executableRuleProfileVersion),
      ...(resolved.ruleProfileVersion ? { ruleProfileVersion: resolved.ruleProfileVersion } : {}),
    }
  }
  function reportSubmissionFromCalculation(
    request: ReportSubmissionRequest,
    calculationInput: BaziCalculationInput,
    birth: BirthInput | undefined,
    ruleProfileVersionId?: string,
  ): ReportSubmission {
    const { birth: _ignoredBirth, calculationInput: _ignoredInput, ...base } = request
    if (calculationInput.inputMode === 'manual-four-pillars') {
      return {
        ...base,
        visionConsent: true,
        calculationInput: structuredClone(calculationInput),
        ...(ruleProfileVersionId ? { ruleProfileVersionId } : {}),
      }
    }
    const normalizedBirth = birth ?? calculationInput
    return {
      ...base,
      visionConsent: true,
      calculationInput: structuredClone(calculationInput),
      birth: structuredClone(normalizedBirth),
      ...(ruleProfileVersionId ? { ruleProfileVersionId } : {}),
    }
  }
  function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
    const entry = cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
    if (!entry) return undefined
    try { return decodeURIComponent(entry.slice(name.length + 1)) } catch { return undefined }
  }
  async function authenticatedUser(cookieHeader: string | undefined) {
    const token = cookieValue(cookieHeader, userSessionCookieName)
    if (!token) return undefined
    const result = await accounts.findSessionByTokenHash(tokenHash(token))
    if (!result || result.user.status !== 'active' || !result.user.principalId) return undefined
    return result
  }
  async function principalFromCookie(cookieHeader: string | undefined) {
    const authenticated = await authenticatedUser(cookieHeader)
    if (authenticated?.user.principalId) {
      return { id: authenticated.user.principalId, kind: 'anonymous' as const, tokenHash: '', createdAt: authenticated.user.createdAt }
    }
    const token = cookieValue(cookieHeader, principalCookieName)
    return token ? charts.findPrincipalByTokenHash(tokenHash(token)) : undefined
  }
  async function ensureAnonymousPrincipal(cookieHeader: string | undefined, reply: { header(name: string, value: string): unknown }) {
    const existing = await principalFromCookie(cookieHeader)
    if (existing) return existing
    const token = randomBytes(32).toString('base64url')
    const principal = { id: crypto.randomUUID(), kind: 'anonymous' as const, tokenHash: tokenHash(token), createdAt: new Date().toISOString() }
    await charts.createPrincipal(principal)
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
    reply.header('set-cookie', `${principalCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`)
    return principal
  }
  function publicReportRecord(record: ReportRecord) {
    const { principalId: _principalId, shareAccess: _shareAccess, pipelineCheckpoint: _pipelineCheckpoint, qualityError: _qualityError, submission, vision, generationProvenance, reviewDraft: _reviewDraft, report, ...publicRecord } = record
    const { photos, ...publicSubmission } = submission
    return {
      ...publicRecord,
      submission: {
        ...publicSubmission,
        photos: photos.map(({ fileId: _fileId, ...photo }) => photo),
      },
      ...(vision
        ? { vision: vision.map(({ fileId: _fileId, ...observation }) => observation) }
        : {}),
      ...(generationProvenance ? { generationProvenance: publicGenerationProvenance(generationProvenance) } : {}),
      ...(record.status === 'completed' && report ? { report } : {}),
    }
  }
  function publicReportSummary(record: ReportRecord): PublicReportSummary {
    const hasCurrentReport = record.status === 'completed'
      && Boolean(record.report)
      && record.generationProvenance?.validatorVersion === REPORT_VALIDATOR_VERSION
      && record.generationProvenance.validatorResult === 'pass'
    const reportPreview = hasCurrentReport ? record.report?.replace(/\s+/gu, ' ').trim().slice(0, 120) : undefined
    return {
      id: record.id,
      status: record.status,
      ...(record.archivedAt ? { archivedAt: record.archivedAt } : {}),
      ...(record.phase ? { phase: record.phase } : {}),
      createdAt: record.createdAt,
      ...(record.chartProfileId ? { chartProfileId: record.chartProfileId } : {}),
      ...(record.chartVersionId ? { chartVersionId: record.chartVersionId } : {}),
      ...(record.residenceProfileId ? { residenceProfileId: record.residenceProfileId } : {}),
      ...(record.residenceVersionId ? { residenceVersionId: record.residenceVersionId } : {}),
      ...(record.submission.residence?.facing ? { residenceFacing: record.submission.residence.facing } : {}),
      photoCount: record.submission.photos.length,
      hasReport: hasCurrentReport,
      ...(reportPreview ? { reportPreview } : {}),
    }
  }
  function publicAdminChartSummary(profile: ChartProfile): AdminChartProfileSummary {
    const currentVersion = profile.currentVersion
    const birth = currentVersion.birth
    return {
      id: profile.id,
      label: profile.label,
      relationship: profile.relationship,
      revision: profile.revision,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      ...(profile.deletedAt ? { deletedAt: profile.deletedAt } : {}),
      currentVersion: {
        id: currentVersion.id,
        version: currentVersion.version,
        createdAt: currentVersion.createdAt,
        pillars: currentVersion.bazi.pillars,
        ...(birth ? {
          birth: {
            date: birth.date,
            time: birth.time,
            ...(birth.locationName ? { locationName: birth.locationName } : {}),
            ...(birth.placeCode ? { placeCode: birth.placeCode } : {}),
            ...(birth.calendarSystem ? { calendarSystem: birth.calendarSystem } : {}),
          },
        } : {}),
      },
    }
  }
  function adminReportCountsByChartProfileId(active: readonly PublicReportSummary[], archived: readonly PublicReportSummary[]): Record<string, { active: number; archived: number }> {
    const counts: Record<string, { active: number; archived: number }> = {}
    const add = (report: PublicReportSummary, key: 'active' | 'archived') => {
      const chartProfileId = report.chartProfileId
      if (!chartProfileId) return
      counts[chartProfileId] ??= { active: 0, archived: 0 }
      counts[chartProfileId][key] += 1
    }
    active.forEach((report) => add(report, 'active'))
    archived.forEach((report) => add(report, 'archived'))
    return counts
  }
  function adminReportCountsByResidenceProfileId(active: readonly PublicReportSummary[], archived: readonly PublicReportSummary[]): Record<string, { active: number; archived: number }> {
    const counts: Record<string, { active: number; archived: number }> = {}
    const add = (report: PublicReportSummary, key: 'active' | 'archived') => {
      const residenceProfileId = report.residenceProfileId
      if (!residenceProfileId) return
      counts[residenceProfileId] ??= { active: 0, archived: 0 }
      counts[residenceProfileId][key] += 1
    }
    active.forEach((report) => add(report, 'active'))
    archived.forEach((report) => add(report, 'archived'))
    return counts
  }
  function publicAdminResidenceSummary(profile: ResidenceProfile): AdminResidenceProfileSummary {
    return {
      id: profile.id,
      label: profile.currentVersion.snapshot.label,
      facing: profile.currentVersion.snapshot.facing,
      revision: profile.revision,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      currentVersion: {
        id: profile.currentVersion.id,
        version: profile.currentVersion.version,
        createdAt: profile.currentVersion.createdAt,
      },
    }
  }
  function parseResidenceSnapshot(input: Partial<ResidenceSnapshot> | undefined): ResidenceSnapshot {
    if (!input || typeof input.label !== 'string' || !input.label.trim() || typeof input.facing !== 'string' || !directions.has(input.facing)) {
      throw new Error('valid residence label and facing are required')
    }
    return {
      schemaVersion: 'residence-snapshot-v1',
      label: input.label,
      facing: input.facing as ResidenceSnapshot['facing'],
      ...(typeof input.layoutNote === 'string' && input.layoutNote.trim() ? { layoutNote: input.layoutNote } : {}),
    }
  }
  function validateReportFloorPlan(value: unknown): string | undefined {
    if (value === undefined) return undefined
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'floorPlan must be an object'
    const input = value as Partial<NineGridInput>
    const boundary = input.boundary
    if (!boundary || ![boundary.x, boundary.y, boundary.width, boundary.height].every(Number.isFinite)
      || boundary.width <= 0 || boundary.height <= 0) return 'floorPlan boundary must be finite and positive'
    if (!input.orientation || input.orientation.northUp !== true
      || typeof input.orientation.evidenceRef !== 'string'
      || !input.orientation.evidenceRef.trim()
      || input.orientation.evidenceRef.length > 200) return 'floorPlan must explicitly provide north-up orientation evidence'
    if (!Array.isArray(input.rooms) || input.rooms.length < 1 || input.rooms.length > 40) return 'floorPlan must contain 1-40 rooms'
    if (input.overrides !== undefined) return 'floorPlan overrides are restricted to the expert workflow'
    const roomKinds = new Set(['entrance', 'living-room', 'bedroom', 'kitchen', 'bathroom', 'balcony', 'study', 'other'])
    const insideBoundary = (point: { x: unknown; y: unknown }) => Number.isFinite(point.x) && Number.isFinite(point.y)
      && Number(point.x) >= boundary.x && Number(point.x) <= boundary.x + boundary.width
      && Number(point.y) >= boundary.y && Number(point.y) <= boundary.y + boundary.height
    for (const room of input.rooms) {
      if (!room || typeof room !== 'object'
        || typeof room.id !== 'string' || !room.id.trim() || room.id.length > 80
        || !roomKinds.has(room.kind)
        || typeof room.evidenceRef !== 'string' || !room.evidenceRef.trim() || room.evidenceRef.length > 200
        || (room.label !== undefined && (typeof room.label !== 'string' || room.label.length > 80))) return 'floorPlan contains an invalid room'
      const hasCenter = Boolean(room.center && insideBoundary(room.center))
      const polygon = room.polygon
      const hasPolygon = Array.isArray(polygon) && polygon.length >= 3 && polygon.length <= 80 && polygon.every(insideBoundary)
      if (!hasCenter && !hasPolygon) return 'each floorPlan room requires an in-bound center or polygon'
    }
    try {
      const analysis = analyzeFloorPlanNineGrid(input as NineGridInput)
      return analysis.status === 'unavailable' ? analysis.reason : undefined
    } catch {
      return 'floorPlan geometry is invalid'
    }
  }
  function reportResidenceLabel(request: ReportSubmissionRequest): string {
    const maybeLabel = (request as { residenceLabel?: unknown }).residenceLabel
    return typeof maybeLabel === 'string' && maybeLabel.trim() ? maybeLabel.trim() : '报告住宅'
  }
  async function resolveReportResidence(request: ReportSubmissionRequest, principalId: string) {
    const requestProfileId = typeof request.residenceProfileId === 'string' && request.residenceProfileId.trim()
      ? request.residenceProfileId.trim()
      : undefined
    const requestVersionId = typeof request.residenceVersionId === 'string' && request.residenceVersionId.trim()
      ? request.residenceVersionId.trim()
      : undefined
    if (requestProfileId || requestVersionId) {
      if (!requestProfileId || !requestVersionId) throw Object.assign(new Error('residenceProfileId and residenceVersionId must be provided together'), { statusCode: 400 })
      const profile = await residences.getProfile(requestProfileId, principalId)
      if (!profile) throw Object.assign(new Error('residence not found'), { statusCode: 404 })
      if (profile.currentVersion.id !== requestVersionId) throw Object.assign(new Error('residence was updated elsewhere; reload before creating the report'), { statusCode: 409, profile })
      const requestedSnapshot = residenceSnapshotFromSubmission(request.residence, profile.currentVersion.snapshot.label)
      if (!sameResidenceSnapshot(profile.currentVersion.snapshot, requestedSnapshot)) {
        throw Object.assign(new Error('report residence fields do not match the selected residence version'), { statusCode: 409, profile })
      }
      return profile
    }
    return residences.createProfile(principalId, residenceSnapshotFromSubmission(request.residence, reportResidenceLabel(request)))
  }
  function publicGenerationProvenance(value: ReportGenerationProvenance): ReportGenerationProvenance {
    return {
      schemaVersion: value.schemaVersion,
      provider: value.provider,
      model: value.model,
      baseUrlLabel: value.baseUrlLabel,
      harnessProfile: value.harnessProfile,
      patchSha256: value.patchSha256,
      plugin: { id: value.plugin.id, version: value.plugin.version, sha256: value.plugin.sha256 },
      skill: { name: value.skill.name, version: value.skill.version, sha256: value.skill.sha256 },
      promptSchemaVersion: value.promptSchemaVersion,
      promptSha256: value.promptSha256,
      validatorVersion: value.validatorVersion,
      validatorResult: value.validatorResult,
      generatedAt: value.generatedAt,
      inputSha256: value.inputSha256,
      ...(value.reportSha256 ? { reportSha256: value.reportSha256 } : {}),
    }
  }
  function sourceBookKey(version: { title: string; sourceLabel: string; body: string }) {
    const metadataBook = version.body.match(/^bookTitle:\s*(.+)$/m)?.[1]?.trim()
    if (metadataBook) return metadataBook.replace(/\.pdf$/iu, '')
    const metadataSourceFile = version.body.match(/^sourceFile:\s*(.+)$/m)?.[1]?.trim()
    if (metadataSourceFile) return metadataSourceFile.replace(/\.pdf$/iu, '')
    return version.title.replace(/\s+p\.\d+(?:-\d+)?\s+.*$/u, '').trim() || version.sourceLabel
  }
  function reportKnowledgeQueries(submission: ReportSubmission, bazi: BaziCalculationResult, vision: readonly VisionObservation[] = []) {
    const elementLabels = { wood: '木', fire: '火', earth: '土', metal: '金', water: '水' } as const
    const directionLabels = { north: '北向', east: '东向', south: '南向', west: '西向', unknown: '' } as const
    const roomLabels = { overview: '全屋户型', 'living-room': '客厅 明堂', bedroom: '卧室 床位', kitchen: '厨房 灶位', bathroom: '卫生间 厕占中宫', entrance: '入户 玄关 门向', other: '其他空间' } as const
    const visionFactLabels: Record<string, string> = {
      'kitchen.south': '厨房 南方 离方 火 灶位',
      'bathroom.near-center': '卫生间 厕所 中宫 水厕',
      'circulation.entry-balcony-aligned': '入户 阳台 穿堂 气口 门路',
      'daylight.visible': '采光 明堂 窗户 阳光',
      'window.visible': '窗户 明堂 气口',
      'balcony.visible': '阳台 明堂 外局',
    }
    const chartTerms = [
      bazi.dayMaster && `日主${bazi.dayMaster.stem}${elementLabels[bazi.dayMaster.element]}`,
      bazi.assessments?.strength?.status === 'derived' && bazi.assessments.strength.conclusion,
      bazi.assessments?.pattern?.status === 'derived' && bazi.assessments.pattern.conclusion,
      bazi.assessments?.elementPreference?.status === 'derived' && bazi.assessments.elementPreference.conclusion,
      ...(bazi.assessments?.shenSha?.status === 'derived' ? (bazi.assessments.shenSha.items ?? []) : []),
    ].filter(Boolean)
    const visionTerms = vision.flatMap((observation) => [
      roomLabels[observation.room],
      observation.summary,
      ...observation.observedElements,
      ...(observation.facts ?? []).flatMap((fact) => [visionFactLabels[fact.code], fact.evidence]),
    ]).filter(Boolean)
    const residenceTerms = [
      '人宅合拍',
      '玄空风水',
      '坐向 山向 向首 元运 飞星',
      directionLabels[submission.residence.facing],
      submission.residence.layoutNote,
      ...submission.photos.flatMap((photo) => [roomLabels[photo.room], directionLabels[photo.facing], photo.note]),
      ...visionTerms,
    ].filter(Boolean)
    return [
      [...residenceTerms, ...chartTerms].join(' '),
      ['玄空', '坐向', '山向', '向首', directionLabels[submission.residence.facing], submission.residence.layoutNote].filter(Boolean).join(' '),
      ['阳宅', '宅形', '门窗', '格局', ...submission.photos.map((photo) => roomLabels[photo.room]), ...visionTerms].filter(Boolean).join(' '),
      ['五行', '命盘', ...chartTerms].filter(Boolean).join(' '),
    ].filter((query, index, queries) => query.trim() && queries.indexOf(query) === index)
  }
  async function retrieveReportCitations(submission: ReportSubmission, bazi: BaziCalculationResult, vision: readonly VisionObservation[] = []) {
    const ranked = new Map<string, { version: Awaited<ReturnType<KnowledgeStore['search']>>[number]; rank: number }>()
    let rank = 0
    for (const query of reportKnowledgeQueries(submission, bazi, vision)) {
      const hits = await knowledge.search(query, 12)
      for (const version of hits) {
        if (version.kind !== 'article') continue
        if (!ranked.has(version.versionId)) ranked.set(version.versionId, { version, rank })
        rank += 1
      }
    }
    const candidates = [...ranked.values()].sort((left, right) => left.rank - right.rank).map((entry) => entry.version)
    const selected: typeof candidates = []
    const selectedIds = new Set<string>()
    const sourceCounts = new Map<string, number>()
    const take = (version: typeof candidates[number], maxPerSource: number) => {
      if (selected.length >= reportCitationLimit || selectedIds.has(version.versionId)) return
      const source = sourceBookKey(version)
      if ((sourceCounts.get(source) ?? 0) >= maxPerSource) return
      selected.push(version)
      selectedIds.add(version.versionId)
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1)
    }
    for (const version of candidates) take(version, 1)
    for (const version of candidates) take(version, 2)
    for (const version of candidates) take(version, reportCitationLimit)
    return selected.slice(0, reportCitationLimit).map((version) => ({
      id: version.assetId,
      version: version.version,
      title: version.title,
      sourceLabel: version.sourceLabel.replace(/\s+sha256:[a-f0-9]+$/iu, ''),
      excerpt: version.exactExcerpt.slice(0, 280),
      versionId: version.versionId,
      contentHash: version.contentHash,
    }))
  }
  async function readWenzhenFixtureFile(path: string): Promise<{ metadata?: unknown; samples: WenzhenFixture[] }> {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || !('samples' in parsed) || !Array.isArray(parsed.samples)) {
        throw new Error('WenZhen fixture file must contain a samples array')
      }
      return {
        metadata: 'metadata' in parsed ? parsed.metadata : undefined,
        samples: parsed.samples.map((sample, index) => validateWenzhenFixture(sample, `${path}#samples[${index}]`)),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { samples: [] }
      throw error
    }
  }
  async function readWenzhenFixtures(): Promise<{ metadata: unknown; samples: WenzhenFixture[] }> {
    const bundled = await readWenzhenFixtureFile(wenzhenFixturePath)
    const runtime = await wenzhenStore.list()
    const ids = new Set<string>()
    const samples: WenzhenFixture[] = []
    for (const sample of [...bundled.samples, ...runtime]) {
      if (ids.has(sample.sampleId)) throw new Error(`duplicate WenZhen sampleId: ${sample.sampleId}`)
      ids.add(sample.sampleId)
      samples.push(sample)
    }
    return { metadata: bundled.metadata ?? {}, samples }
  }
  async function readWenzhenCaptureMatrix() {
    const parsed = JSON.parse(await readFile(wenzhenCaptureMatrixPath, 'utf8')) as unknown
    return validateWenzhenCaptureMatrix(parsed, wenzhenCaptureMatrixPath)
  }
  async function appendRuntimeWenzhenFixture(fixture: ReportableWenzhenFixture): Promise<WenzhenFixture> {
    const bundled = await readWenzhenFixtureFile(wenzhenFixturePath)
    if (bundled.samples.some((sample) => sample.sampleId === fixture.sampleId)) {
      throw new Error('WenZhen sampleId already exists')
    }
    return wenzhenStore.append(fixture)
  }
  app.register(multipart, { limits: { files: 1, fileSize: 10 * 1024 * 1024 } })
  const pruneExpiredMedia = async () => {
    try { await mediaStore.pruneExpired(mediaRetentionMs) }
    catch (error) { app.log.error({ err: error }, 'expired media cleanup failed') }
  }
  const reportLease = () => {
    const now = new Date()
    return {
      workerId: reportWorkerId,
      now: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + reportLeaseTtlMs).toISOString(),
    }
  }
  const refreshReportLease = (record: ReportRecord) => {
    const lease = reportLease()
    record.runLease = {
      workerId: lease.workerId,
      leasedAt: record.runLease?.leasedAt ?? lease.now,
      expiresAt: lease.leaseExpiresAt,
      attempt: record.runLease?.attempt ?? 1,
    }
  }
  const processReport = async (record: ReportRecord) => {
    const claimedWorkerId = record.runLease?.workerId
    const claimedAttempt = record.runLease?.attempt
    let terminalStatusPersisted = false
    let reportDelivered = record.status === 'completed' && Boolean(record.report?.trim())
    const saveClaimedReport = async () => {
      if (!claimedWorkerId || typeof claimedAttempt !== 'number') throw new LostReportLeaseError(record.id)
      await repository.saveClaimed(record, { workerId: claimedWorkerId, attempt: claimedAttempt })
    }
    type ProcessingReportPhase = ReportStageTiming['phase']
    class ReportProgressPersistenceError extends Error {
      constructor(readonly phase: ReportPhase, readonly cause: unknown) {
        super(`failed to persist report phase: ${phase}`)
      }
    }
    const processingPhases = new Set<ReportPhase>([
      'vision-analyzing',
      'rules-evaluating',
      'professional-reasoning',
      'harness-generating',
      'quality-reviewing',
      'harness-revising',
    ])
    const openTimingIndex = () => {
      const timings = record.stageTimings ?? []
      for (let index = timings.length - 1; index >= 0; index -= 1) {
        const timing = timings[index]
        if (timing && !timing.completedAt && !timing.outcome) return index
      }
      return -1
    }
    const closeOpenStageTiming = (outcome: ReportStageTiming['outcome']) => {
      const index = openTimingIndex()
      if (index < 0) return
      const timings = [...(record.stageTimings ?? [])]
      const timing = timings[index]
      if (!timing) return
      const completedAt = new Date().toISOString()
      const startedAt = Date.parse(timing.startedAt)
      timings[index] = {
        ...timing,
        completedAt,
        durationMs: Number.isFinite(startedAt) ? Math.max(0, Date.parse(completedAt) - startedAt) : 0,
        outcome,
      }
      record.stageTimings = timings
    }
    const failLatestStageTiming = () => {
      const openIndex = openTimingIndex()
      if (openIndex >= 0) {
        closeOpenStageTiming('failed')
        return
      }
      const timings = [...(record.stageTimings ?? [])]
      const latestIndex = timings.length - 1
      const latest = timings[latestIndex]
      if (!latest) return
      const completedAt = new Date().toISOString()
      const startedAt = Date.parse(latest.startedAt)
      timings[latestIndex] = {
        ...latest,
        completedAt,
        durationMs: Number.isFinite(startedAt) ? Math.max(0, Date.parse(completedAt) - startedAt) : 0,
        outcome: 'failed',
      }
      record.stageTimings = timings
    }
    const startStageTiming = (phase: ProcessingReportPhase) => {
      closeOpenStageTiming('completed')
      record.stageTimings = [
        ...(record.stageTimings ?? []),
        { phase, startedAt: new Date().toISOString() },
      ]
    }
    const checkpoint = (): ReportPipelineCheckpoint | undefined => record.pipelineCheckpoint?.schemaVersion === 'report-pipeline-checkpoint-v1'
      ? record.pipelineCheckpoint
      : undefined
    const markCheckpoint = (stage: keyof Omit<ReportPipelineCheckpoint, 'schemaVersion'>, value: NonNullable<ReportPipelineCheckpoint[typeof stage]>) => {
      record.pipelineCheckpoint = {
        schemaVersion: 'report-pipeline-checkpoint-v1',
        ...(checkpoint() ?? {}),
        [stage]: value,
      }
    }
    const checkpointTime = () => ({ completedAt: new Date().toISOString() })
    const hasCheckpointedCitations = () => Boolean(checkpoint()?.citations && record.citations)
    const hasCheckpointedVision = () => Boolean(checkpoint()?.vision && record.vision)
    const hasCheckpointedRules = () => Boolean(checkpoint()?.rules && record.evaluatedRules && record.compatibility)
    const hasCheckpointedProfessionalReasoning = () => Boolean(checkpoint()?.professionalReasoning && record.compatibility)
    const hasCheckpointedHarnessDraft = () => Boolean(checkpoint()?.harnessDraft && record.reviewDraft?.report)
    const failedProvenance = (error: unknown) => error instanceof ReportValidationError
      ? error.generationProvenance
      : error && typeof error === 'object' && 'generationProvenance' in error
        ? (error as { generationProvenance?: ReportGenerationProvenance }).generationProvenance
        : undefined
    const safeFailureReason = (error: unknown): string => {
      const raw = error instanceof Error ? error.message : String(error)
      return raw.replace(/\s+/gu, ' ').trim().slice(0, 220) || 'unknown error'
    }
    const pipelineFailureMessage = (error: unknown, phase: ReportPhase): string => {
      if (phase === 'vision-analyzing') return `图片识别失败：${safeFailureReason(error)}`
      if (phase === 'rules-evaluating') return `规则评估失败：${safeFailureReason(error)}`
      if (phase === 'professional-reasoning') return `专业推理失败：${safeFailureReason(error)}`
      if (error instanceof ReportValidationError) return `报告校验失败：${error.reasons.slice(0, 3).join('；')}`
      if (phase === 'harness-generating') return `Harness 报告生成失败：${safeFailureReason(error)}`
      if (phase === 'quality-reviewing') return '报告质量审核失败'
      if (phase === 'harness-revising') return 'Harness 报告修订失败'
      return `报告生成失败：${safeFailureReason(error)}`
    }
    const saveFailedReport = async (error: unknown, message: string, logMessage: string) => {
      const provenance = failedProvenance(error) ?? record.reviewDraft?.generationProvenance
      if (provenance) record.generationProvenance = provenance
      if (error instanceof ReportQualityReviewError) {
        record.qualityReviews = error.qualityReviews
        record.revisionCount = error.revisionCount
      }
      app.log.error({ err: error, reportId: record.id }, logMessage)
      failLatestStageTiming()
      record.status = 'failed'
      record.phase = 'failed'
      delete record.runLease
      record.error = message
      try { await saveClaimedReport() }
      catch (retryError) {
        if (retryError instanceof LostReportLeaseError) throw retryError
        app.log.error({ err: retryError, reportId: record.id }, 'failed report status persistence failed')
        return false
      }
      terminalStatusPersisted = true
      return true
    }
    const advanceReportPhase = async (phase: Exclude<ReportPhase, 'completed' | 'failed'>) => {
      record.status = 'running'
      record.phase = phase
      refreshReportLease(record)
      if (processingPhases.has(phase)) startStageTiming(phase as ProcessingReportPhase)
      try {
        await saveClaimedReport()
      } catch (error) {
        if (error instanceof LostReportLeaseError) throw error
        await saveFailedReport(error, 'Report progress persistence failed', 'report progress persistence failed')
        throw new ReportProgressPersistenceError(phase, error)
      }
    }
    const advanceQualityPhase = async (phase: 'quality-reviewing' | 'harness-revising') => {
      record.status = 'completed'
      record.qualityStatus = 'running'
      record.phase = phase
      refreshReportLease(record)
      startStageTiming(phase)
      await saveClaimedReport()
    }
    try {
      closeOpenStageTiming('failed')
      if (!hasCheckpointedVision()) {
        await advanceReportPhase('vision-analyzing')
        record.vision = await visionAnalyzer.analyze(record.submission.photos)
        if (record.submission.floorPlan) {
          record.floorPlanAnalysis = analyzeFloorPlanNineGrid(record.submission.floorPlan)
          record.vision = appendNineGridObservation(record.vision, record.floorPlanAnalysis)
        }
        markCheckpoint('vision', checkpointTime())
        await saveClaimedReport()
      }

      if (!hasCheckpointedCitations()) {
        record.citations = await retrieveReportCitations(record.submission, record.bazi, record.vision ?? [])
        markCheckpoint('citations', checkpointTime())
        await saveClaimedReport()
      }

      if (!hasCheckpointedRules()) {
        await advanceReportPhase('rules-evaluating')
        const vision = record.vision
        if (!vision) throw new Error('vision output is missing before rule evaluation')
        // Pass every active version so matched rules can resolve their immutable
        // expert-source references; the evaluator itself executes only rule assets.
        record.evaluatedRules = evaluatePublishedRules(await knowledge.search('', Number.MAX_SAFE_INTEGER), { bazi: record.bazi, residence: record.submission.residence, vision })
        record.compatibility = buildPersonHouseCompatibilityAssessment({ bazi: record.bazi, residence: record.submission.residence, vision, evaluatedRules: record.evaluatedRules })
        markCheckpoint('rules', checkpointTime())
        await saveClaimedReport()
      }
      const deterministicCompatibility = record.compatibility
      if (!deterministicCompatibility) throw new Error('compatibility output is missing before report generation')
      // The deterministic layer deliberately stays conservative. Once chart,
      // residence, publishable vision facts and governed sources are present,
      // the professional Agent may derive a bounded person-house assessment
      // even when no deterministic supportive/conflict rule fired.
      const hasReasoningEvidence = hasMinimumCompatibilityFacts(record)
      if (!hasCheckpointedProfessionalReasoning() && hasReasoningEvidence) {
        let professionalReasoningOutcome: NonNullable<ReportPipelineCheckpoint['professionalReasoning']>['outcome'] = 'enhanced'
        try {
          await advanceReportPhase('professional-reasoning')
          record.compatibility = await withProfessionalReasoningTimeout(activeProfessionalReasoner(record))
        } catch (error) {
          // The deterministic assessment is already evidence-bounded and auditable.
          // A model-format or availability failure must not discard that valid result.
          app.log.warn({ err: error, reportId: record.id }, 'professional reasoning enhancement failed; retaining deterministic compatibility')
          record.compatibility = deterministicCompatibility
          professionalReasoningOutcome = 'deterministic-fallback'
        }
        markCheckpoint('professionalReasoning', { ...checkpointTime(), outcome: professionalReasoningOutcome })
        await saveClaimedReport()
      } else if (!hasCheckpointedProfessionalReasoning()) {
        markCheckpoint('professionalReasoning', { ...checkpointTime(), outcome: 'not-required' })
        await saveClaimedReport()
      }

      if (!hasCheckpointedHarnessDraft()) {
        await advanceReportPhase('harness-generating')
        const rawGenerated = await reportGenerator(record)
        // A string is accepted only as a compatibility seam for existing injected
        // test/local renderers. Production generateReport always returns the
        // explicit result object and is the only path that claims provenance.
        const generated = typeof rawGenerated === 'string' ? { report: rawGenerated } : rawGenerated
        record.reviewDraft = {
          report: generated.report,
          ...(generated.generationProvenance ? { generationProvenance: generated.generationProvenance } : {}),
          createdAt: new Date().toISOString(),
          revisionAttempt: 0,
        }
        markCheckpoint('harnessDraft', { ...checkpointTime(), revisionAttempt: 0 })
        await saveClaimedReport()
      }
      const generated = {
        report: record.reviewDraft!.report,
        ...(record.reviewDraft!.generationProvenance ? { generationProvenance: record.reviewDraft!.generationProvenance } : {}),
      }
      if (!reportDelivered) {
        record.report = generated.report
        if (generated.generationProvenance) record.generationProvenance = generated.generationProvenance
        record.qualityStatus = 'pending'
        record.revisionCount = record.revisionCount ?? 0
        closeOpenStageTiming('completed')
        record.status = 'completed'
        record.phase = 'completed'
        record.completedAt = new Date().toISOString()
        delete record.error
        delete record.qualityError
        try {
          await saveClaimedReport()
        } catch (error) {
          if (error instanceof LostReportLeaseError) throw error
          await saveFailedReport(error, 'Report result persistence failed', 'initial report persistence failed')
          return
        }
        reportDelivered = true
      }
      const qualityCheckpoint = checkpoint()?.qualityWorkflow
      let qualityResumeState: ReportQualityWorkflowState | undefined
      if (qualityCheckpoint) {
        if (!record.reviewDraft || !record.qualityReviews || typeof record.revisionCount !== 'number') {
          throw new Error('report quality checkpoint is incomplete')
        }
        qualityResumeState = {
          report: record.reviewDraft.report,
          ...(record.reviewDraft.generationProvenance ? { generationProvenance: record.reviewDraft.generationProvenance } : {}),
          qualityReviews: record.qualityReviews,
          revisionCount: record.revisionCount,
          draftHash: qualityCheckpoint.draftHash,
          reviewHashes: qualityCheckpoint.reviewHashes,
        }
      }
      const reviewed = await runReportQualityWorkflow(
        record,
        generated,
        reviewReportWithLocalFallback,
        activeReportReviser,
        advanceQualityPhase,
        {
          ...(qualityResumeState ? { resumeState: qualityResumeState } : {}),
          onProgress: async (progress) => {
            record.reviewDraft = {
              report: progress.report,
              ...(progress.generationProvenance ? { generationProvenance: progress.generationProvenance } : {}),
              createdAt: new Date().toISOString(),
              revisionAttempt: progress.revisionCount,
            }
            record.qualityReviews = progress.qualityReviews
            record.revisionCount = progress.revisionCount
            markCheckpoint('harnessDraft', { ...checkpointTime(), revisionAttempt: progress.revisionCount })
            markCheckpoint('qualityWorkflow', {
              ...checkpointTime(),
              event: progress.event,
              draftHash: progress.draftHash,
              reviewHashes: progress.reviewHashes,
              revisionCount: progress.revisionCount,
            })
            await saveClaimedReport()
          },
        },
      )
      record.report = reviewed.report
      record.reviewDraft = {
        report: reviewed.report,
        ...(reviewed.generationProvenance ? { generationProvenance: reviewed.generationProvenance } : {}),
        createdAt: new Date().toISOString(),
        revisionAttempt: reviewed.revisionCount,
      }
      if (reviewed.generationProvenance) record.generationProvenance = reviewed.generationProvenance
      record.qualityReviews = reviewed.qualityReviews
      record.revisionCount = reviewed.revisionCount
      record.qualityStatus = 'passed'
      closeOpenStageTiming('completed')
      record.status = 'completed'
      record.phase = 'completed'
      delete record.runLease
      delete record.error
      try {
        await saveClaimedReport()
        terminalStatusPersisted = true
      } catch (error) {
        if (error instanceof LostReportLeaseError) throw error
        app.log.error({ err: error, reportId: record.id }, 'final report persistence failed')
        failLatestStageTiming()
        record.status = 'failed'
        record.phase = 'failed'
        delete record.runLease
        record.error = 'Report result persistence failed'
        try { await saveClaimedReport() }
        catch (retryError) {
          if (retryError instanceof LostReportLeaseError) throw retryError
          app.log.error({ err: retryError, reportId: record.id }, 'failed report status persistence failed')
          return
        }
        terminalStatusPersisted = true
      }
    } catch (error) {
      if (error instanceof LostReportLeaseError) {
        app.log.warn({ err: error, reportId: record.id }, 'report worker lost lease; stopping without overwriting newer work')
      } else if (reportDelivered) {
        app.log.warn({ err: error, reportId: record.id }, 'background report quality enhancement failed; keeping delivered report')
        failLatestStageTiming()
        record.status = 'completed'
        record.phase = 'completed'
        record.qualityStatus = 'failed'
        record.qualityError = '报告后台质检未完成'
        delete record.runLease
        try {
          await saveClaimedReport()
          terminalStatusPersisted = true
        } catch (saveError) {
          if (saveError instanceof LostReportLeaseError) throw saveError
          app.log.error({ err: saveError, reportId: record.id }, 'report quality failure persistence failed')
        }
      } else if (!(error instanceof ReportProgressPersistenceError)) {
        await saveFailedReport(error, pipelineFailureMessage(error, record.phase ?? 'queued'), 'report pipeline failed')
      }
    } finally {
      if (claimedWorkerId === reportWorkerId) await repository.releaseReportLease(record.id, reportWorkerId)
      if (terminalStatusPersisted) await removeReportMedia(record)
    }
  }
  const removeReportMedia = async (record: ReportRecord) => {
    // Evidence-replay reports reference the source report's already-cleaned upload
    // identifiers only as immutable observation metadata. They neither claim nor
    // own those files, so terminal cleanup must not touch them again.
    if (record.sourceReportId) return
    const removals = await Promise.allSettled(record.submission.photos.map((photo) => record.principalId
      ? mediaStore.removeClaimed(photo.fileId, record.principalId, record.id)
      : mediaStore.remove(photo.fileId)))
    removals.forEach((result, index) => { if (result.status === 'rejected') app.log.warn({ err: result.reason, fileId: record.submission.photos[index]?.fileId }, 'processed image cleanup failed') })
  }
  const recoverQueuedReports = async () => {
    for (;;) {
      const record = await repository.claimNextReport(reportLease())
      if (!record) return
      startClaimedReport(record)
    }
  }
  const startClaimedReport = (record: ReportRecord) => {
    if (activeReports.has(record.id)) return
    const task = processReport(record).finally(() => activeReports.delete(record.id))
    activeReports.set(record.id, task)
  }
  const startReport = (id: string) => {
    if (activeReports.has(id)) return
    void (async () => {
      const record = await repository.claimReport(id, reportLease())
      if (!record) return
      startClaimedReport(record)
    })().catch((error) => app.log.error({ err: error, reportId: id }, 'report claim failed'))
  }
  const mediaCleanupTimer = setInterval(() => { void pruneExpiredMedia() }, 60 * 60 * 1000)
  mediaCleanupTimer.unref()
  app.addHook('onReady', pruneExpiredMedia)
  app.addHook('onReady', async () => {
    void recoverQueuedReports().catch((error) => app.log.error({ err: error }, 'queued report recovery failed'))
  })
  app.addHook('onClose', async () => {
    clearInterval(mediaCleanupTimer)
    await Promise.allSettled(activeReports.values())
    await Promise.all([repository.close(), knowledge.close(), charts.close(), residences.close(), ruleProfiles.close(), wenzhenStore.close(), accounts.close()])
  })
  app.get('/health', async () => ({ status: 'ok', service: 'fengshui-api' }))
  app.get('/ready', async (_request, reply) => {
    try {
      await Promise.all([repository.ping(), knowledge.ping(), charts.ping(), residences.ping(), ruleProfiles.ping(), wenzhenStore.ping(), accounts.ping()])
      return { status: 'ready', service: 'fengshui-api' }
    } catch (error) {
      app.log.error({ err: error }, 'readiness check failed')
      return reply.code(503).send({ status: 'not-ready', service: 'fengshui-api' })
    }
  })
  app.get('/ready/report', async (_request, reply) => {
    const readiness = await checkReportReadiness()
    const reasons = [...readiness.reasons]
    let publishedExpertKnowledge = false
    let publishedRules = false
    let publishedKnowledgeVersions = 0
    let publishedRuleVersions = 0
    try {
      const versions = await knowledge.search('', Number.MAX_SAFE_INTEGER)
      publishedKnowledgeVersions = versions.filter((version) => version.kind !== 'rule').length
      publishedRuleVersions = versions.filter((version) => version.kind === 'rule').length
      publishedExpertKnowledge = publishedKnowledgeVersions > 0
      publishedRules = publishedRuleVersions > 0
      if (!publishedExpertKnowledge) reasons.push('missing_published_expert_knowledge')
    } catch (error) {
      app.log.error({ err: error }, 'report knowledge readiness check failed')
      reasons.push('knowledge_store_unavailable')
    }
    const ready = reasons.length === 0
    const payload = {
      status: ready ? 'ready' : 'not-ready',
      service: 'fengshui-api',
      checks: {
        deepseekApiKey: !readiness.reasons.includes('missing_deepseek_api_key'),
        knowledgeMcpToken: !readiness.reasons.includes('missing_knowledge_mcp_token'),
        harnessArtifacts: !readiness.reasons.includes('missing_harness_artifact'),
        publishedExpertKnowledge,
        publishedRules,
      },
      knowledge: {
        publishedExpertKnowledge: publishedKnowledgeVersions,
        publishedRules: publishedRuleVersions,
      },
      reasons,
    }
    return ready ? payload : reply.code(503).send(payload)
  })
  app.get('/v1/bazi/runtime', async (_request, reply) => {
    const { provider, tzdbVersion, icuVersion } = getBaziTimeRuntimeProvenance()
    return reply
      .header('Cache-Control', 'public, max-age=3600')
      .send({
        runtime: {
          provider,
          ...(tzdbVersion ? { tzdbVersion } : {}),
          ...(icuVersion ? { icuVersion } : {}),
        },
      })
  })
  app.get('/v1/birthplaces/dataset', async () => ({ dataset: ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA }))
  app.get('/v1/birthplaces/tree', async () => ({ tree: SELECTABLE_BIRTHPLACE_TREE, dataset: ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA }))
  app.get('/v1/birthplaces/integrity', async () => validateAdministrativeBirthplaceDataset())
  app.get('/v1/birthplaces/administrative/dataset', async () => ({ dataset: ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA }))
  app.get('/v1/birthplaces/administrative/integrity', async () => validateAdministrativeBirthplaceDataset())
  app.get<{ Querystring: { q?: string; limit?: string; offset?: string } }>('/v1/birthplaces/administrative', async (request) => {
    const limit = Number.parseInt(request.query.limit ?? '', 10)
    const offset = Number.parseInt(request.query.offset ?? '', 10)
    return searchAdministrativeBirthplaces({
      query: request.query.q,
      ...(Number.isFinite(limit) ? { limit } : {}),
      ...(Number.isFinite(offset) ? { offset } : {}),
    })
  })
  app.get<{ Params: { code: string } }>('/v1/birthplaces/administrative/:code', async (request, reply) => {
    const birthplace = findAdministrativeBirthplaceByCode(request.params.code)
    return birthplace
      ? { birthplace, dataset: ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA }
      : reply.code(404).send({ error: 'birthplace not found' })
  })
  app.get<{ Querystring: { q?: string; provinceCode?: string; cityCode?: string; limit?: string; offset?: string } }>('/v1/birthplaces', async (request) => {
    const limit = Number.parseInt(request.query.limit ?? '', 10)
    const offset = Number.parseInt(request.query.offset ?? '', 10)
    return searchBirthplaces({
      query: request.query.q,
      provinceCode: request.query.provinceCode,
      cityCode: request.query.cityCode,
      ...(Number.isFinite(limit) ? { limit } : {}),
      ...(Number.isFinite(offset) ? { offset } : {}),
    })
  })
  app.get<{ Params: { code: string } }>('/v1/birthplaces/:code', async (request, reply) => {
    const birthplace = findBirthplaceByCode(request.params.code)
    return birthplace ? { birthplace, dataset: ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA } : reply.code(404).send({ error: 'birthplace not found' })
  })
  app.get<{ Params: { year: string } }>('/v1/calendar/lunar-years/:year', async (request, reply) => {
    if (!/^\d+$/.test(request.params.year)) {
      return reply.code(400).send({ error: LUNAR_YEAR_PROFILE_ERROR })
    }
    try {
      return getLunarYearProfile(Number(request.params.year))
    } catch {
      return reply.code(400).send({ error: LUNAR_YEAR_PROFILE_ERROR })
    }
  })
  app.post<{ Body: BaziCalculationRequest }>('/v1/bazi', async (request, reply) => {
    try {
      const { ruleProfileVersionId, ...input } = request.body ?? {} as BaziCalculationRequest
      const resolved = await calculateRequest(input, ruleProfileVersionId)
      return {
        calculationInput: resolved.calculationInput,
        ...(resolved.birth ? { birth: resolved.birth } : {}),
        bazi: resolved.bazi,
        ...(resolved.ruleProfileVersion ? { ruleProfileVersion: resolved.ruleProfileVersion } : {}),
      }
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message })
    }
  })
  app.post<{ Body: BaziFlowRequest }>('/v1/bazi/flow', async (request, reply) => {
    const { birth, query, ruleProfileVersionId } = request.body ?? {}
    if (!hasValidBirthInput(birth)) {
      return reply.code(400).send({ error: 'valid birth date, time and birthplace selection or longitude are required' })
    }
    if (!query?.targetDate) {
      return reply.code(400).send({ error: 'targetDate is required for flow calculation' })
    }
    try {
      const resolved = await resolveCalculationInput(birth, ruleProfileVersionId)
      return {
        birth: resolved.birth,
        flow: calculateBaziFlow(resolved.birth, query),
        ...(resolved.ruleProfileVersion ? { ruleProfileVersion: resolved.ruleProfileVersion } : {}),
      }
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message })
    }
  })
  app.get('/v1/bazi/wenzhen/diff', async (_request, reply) => {
    try {
      const { metadata, samples } = await readWenzhenFixtures()
      const reportable = samples.filter((sample): sample is ReportableWenzhenFixture => sample.status !== 'pending-manual-verification')
      const pending = samples.filter((sample) => sample.status === 'pending-manual-verification')
      const reports = reportable.map((sample) => createWenzhenFixtureReport(sample))
      const captureMatrix = await readWenzhenCaptureMatrix()
      const coverage = Object.fromEntries(WENZHEN_ASSERTION_COVERAGE_CATEGORIES.map((category) => [
        category,
        reports.filter((report) => report.assertionCoverage.categories.includes(category)).length,
      ])) as Record<WenzhenAssertionCoverageCategory, number>
      return {
        generatedAt: new Date().toISOString(),
        metadata,
        totals: {
          all: samples.length,
          reportable: reportable.length,
          pending: pending.length,
          matched: reports.filter((item) => item.outcome === 'passed').length,
          accepted: reports.filter((item) => item.outcome === 'accepted-difference').length,
          mismatched: reports.filter((item) => item.outcome === 'failed').length,
        },
        coverage,
        captureMatrix: summarizeWenzhenAcceptance(captureMatrix, reports, reportable),
        pendingSamples: pending.map((sample) => ({
          sampleId: sample.sampleId,
          source: sample.source,
          notes: sample.notes ?? '',
        })),
        reports,
      }
    } catch (error) {
      requestLogWarn(app, error, 'WenZhen diff fixtures are unavailable')
      return reply.code(503).send({ error: 'WenZhen diff fixtures are unavailable' })
    }
  })
  app.post('/v1/bazi/wenzhen/evidence', async (request, reply) => {
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    try {
      const image = await request.file({ limits: { files: 1, fileSize: WENZHEN_EVIDENCE_MAX_BYTES } })
      if (!image) return reply.code(400).send({ error: 'WenZhen evidence image is required' })
      const bytes = await image.toBuffer()
      return reply.code(201).send(await wenzhenEvidenceStore.save({ mimeType: image.mimetype, bytes }))
    } catch (error) {
      const code = (error as { code?: string }).code
      const message = (error as Error).message
      request.log.warn({ err: error }, 'WenZhen evidence upload rejected')
      if (code === 'FST_REQ_FILE_TOO_LARGE' || message.includes('exceeds')) {
        return reply.code(413).send({ error: `WenZhen evidence must not exceed ${WENZHEN_EVIDENCE_MAX_BYTES} bytes` })
      }
      return reply.code(400).send({ error: message || 'invalid WenZhen evidence upload' })
    }
  })
  app.post<{ Body: {
    sampleId?: string
    source?: string
    status?: 'verified' | 'accepted-difference'
    capturedAt?: string
    sourceUrl?: string
    evidenceRef?: string
    birth?: BirthInputRequest
    flowQuery?: CycleQuery
    expected?: WenzhenExpected
    acceptedDifferences?: readonly { path?: string; reason?: string; classification?: AcceptedDifferenceClassification }[]
    acceptedAt?: unknown
    acceptedBy?: unknown
  } }>('/v1/bazi/wenzhen/fixtures', async (request, reply) => {
    const body = request.body ?? {}
    const status = body.status ?? 'verified'
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    try {
      if (body.acceptedAt !== undefined || body.acceptedBy !== undefined) {
        throw new Error('acceptedAt and acceptedBy are server-controlled fields')
      }
      if (status === 'accepted-difference' && Array.isArray(body.acceptedDifferences)) {
        body.acceptedDifferences.forEach((difference, index) => {
          const classification = difference?.classification
          if (classification === undefined) {
            throw new Error(`acceptedDifferences[${index}].classification is required for new accepted-difference fixtures`)
          }
          if (typeof classification !== 'string' || !acceptedDifferenceClassifications.has(classification)) {
            throw new Error(`acceptedDifferences[${index}].classification is unsupported`)
          }
          if (classification === 'bug') {
            throw new Error(`acceptedDifferences[${index}].classification bug cannot be accepted as a compatible difference`)
          }
        })
      }
      const evidence = await wenzhenEvidenceStore.verify(body.evidenceRef ?? '')
      const resolved = await resolveCalculationInput(body.birth as BirthInputRequest)
      const fixture = validateWenzhenFixture({
        schemaVersion: 'wenzhen-fixture-v1',
        sampleId: body.sampleId,
        source: body.source ?? 'wenzhen-admin-manual-capture',
        status,
        capturedAt: body.capturedAt,
        sourceUrl: body.sourceUrl ?? 'https://pcbz.iwzwh.com/#/paipan/index',
        evidenceRef: evidence.evidenceRef,
        birth: resolved.birth,
        ...(body.flowQuery === undefined ? {} : { flowQuery: body.flowQuery }),
        expected: body.expected,
        ...(status === 'accepted-difference' ? {
          acceptedAt: new Date().toISOString(),
          acceptedBy: adminActor,
          acceptedDifferences: body.acceptedDifferences,
        } : {}),
      }, 'wenzhenRuntimeFixture') as ReportableWenzhenFixture
      const report = createWenzhenFixtureReport(fixture)
      if (status === 'verified' && report.outcome !== 'passed') {
        throw new Error('verified fixture must pass every current asserted difference')
      }
      if (status === 'accepted-difference' && report.outcome !== 'accepted-difference') {
        throw new Error('accepted-difference fixture must accept every current difference and no stale paths')
      }
      return reply.code(201).send({
        fixture: await appendRuntimeWenzhenFixture(fixture),
        report,
      })
    } catch (error) {
      const message = (error as Error).message
      return reply.code(message.includes('already exists') ? 409 : 400).send({ error: message })
    }
  })
  app.post<{ Body: {
    sampleId?: string
    source?: string
    birth?: BirthInputRequest
    flowQuery?: CycleQuery
    expected?: unknown
  } }>('/v1/bazi/compare', async (request, reply) => {
    const { sampleId, source, birth, flowQuery, expected } = request.body ?? {}
    if (!sampleId?.trim() || !source?.trim() || !birth || !hasValidBirthInput(birth) || !expected) {
      return reply.code(400).send({ error: 'sampleId, source, valid birth input and expected values are required' })
    }
    const expectedPillars = typeof expected === 'object' && expected !== null && 'pillars' in expected
      ? (expected as { pillars?: unknown }).pillars
      : undefined
    if (Array.isArray(expectedPillars) && (expectedPillars.length !== 4 || expectedPillars.some((pillar) => typeof pillar !== 'string' || pillar.length !== 2))) {
      return reply.code(400).send({ error: 'expected pillars must contain four stem-branch pairs' })
    }
    try {
      const resolved = await resolveCalculationInput(birth)
      const report = isWenzhenExpectedPreview(expected)
        ? compareWenzhenExpected(sampleId.trim(), source.trim(), resolved.birth, expected, flowQuery)
        : {
            ...compareBaziWithExpected(
              sampleId.trim(),
              source.trim(),
              resolved.birth,
              expected as Parameters<typeof compareBaziWithExpected>[3],
            ),
            pathSemantics: 'legacy-field-v1' as const,
          }
      return {
        birth: resolved.birth,
        report,
      }
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message })
    }
  })
  app.get('/v1/charts/current', async (request) => {
    const principal = await principalFromCookie(request.headers.cookie)
    return { profile: principal ? (await charts.getCurrentProfile(principal.id) ?? null) : null }
  })
  app.get('/v1/charts', async (request) => {
    const principal = await principalFromCookie(request.headers.cookie)
    return { profiles: principal ? await charts.listProfiles(principal.id) : [] }
  })
  app.post<{ Body: ChartCreationRequest }>('/v1/charts', async (request, reply) => {
    let calculated
    let metadata
    try {
      const { ruleProfileVersionId, label, relationship, ...input } = request.body ?? {} as ChartCreationRequest
      metadata = parseChartProfileMetadata({ label, relationship })
      calculated = await calculateRequest(input, ruleProfileVersionId, true)
    } catch (error) { return reply.code(400).send({ error: (error as Error).message }) }
    const principal = await ensureAnonymousPrincipal(request.headers.cookie, reply)
    try {
      return reply.code(201).send({ profile: await charts.createProfile(
        principal.id,
        calculated.calculationInput,
        calculated.bazi,
        metadata,
        calculated.ruleProfileVersion,
      ) })
    } catch (error) {
      if (error instanceof ChartProfileLimitExceededError) return reply.code(409).send({ error: error.message })
      throw error
    }
  })
  app.post<{ Params: { id: string }; Body: ChartVersionRequest }>('/v1/charts/:id/versions', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(401).send({ error: 'chart access required' })
    const { expectedRevision, ruleProfileVersionId, ...input } = request.body ?? {} as ChartVersionRequest
    if (!Number.isInteger(expectedRevision)) return reply.code(400).send({ error: 'valid chart input and expectedRevision are required to save a chart version' })
    if (!isManualFourPillarsInput(input) && !hasPersistableBirthInput(input)) {
      return reply.code(400).send({ error: 'valid birth date, time, a non-empty birthplace code and expectedRevision are required to save a chart version' })
    }
    let calculated
    try {
      calculated = await calculateRequest(input, ruleProfileVersionId, true)
    } catch (error) { return reply.code(400).send({ error: (error as Error).message }) }
    try {
      const profile = await charts.appendVersion(
        request.params.id,
        principal.id,
        expectedRevision!,
        calculated.calculationInput,
        calculated.bazi,
        calculated.ruleProfileVersion,
      )
      return profile ? { profile } : reply.code(404).send({ error: 'chart not found' })
    } catch (error) {
      if (error instanceof ChartRevisionConflictError) return reply.code(409).send({
        error: 'chart was updated elsewhere; reload before saving',
        profile: await charts.getProfile(request.params.id, principal.id),
      })
      throw error
    }
  })
  app.get<{ Params: { id: string } }>('/v1/charts/:id/versions', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(401).send({ error: 'chart access required' })
    const versions = await charts.listVersions(request.params.id, principal.id)
    return versions ? { versions } : reply.code(404).send({ error: 'chart not found' })
  })
  app.get<{ Params: { id: string; versionId: string } }>('/v1/charts/:id/versions/:versionId/pdf', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(401).send({ error: 'chart access required' })
    const version = await charts.getVersion(request.params.id, principal.id, request.params.versionId)
    if (!version) return reply.code(404).send({ error: 'chart or version not found' })
    if (isManualFourPillarsInput(version.calculationInput) || 'inputMode' in version.bazi) {
      return reply.code(422).send({ error: 'PDF export for manual four-pillar charts is not supported yet' })
    }
    try {
      const pdf = await chartPdfRenderer.render({
        profileId: version.profileId,
        version: version.version,
        birth: version.birth ?? version.calculationInput,
        bazi: version.bazi,
        savedAt: version.createdAt,
      })
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="bazi-chart-v${version.version}.pdf"`)
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(pdf)
    } catch (error) {
      request.log.error({ err: error, chartProfileId: version.profileId, chartVersionId: version.id }, 'chart PDF generation failed')
      if (error instanceof ChartPdfUnavailableError) {
        return reply.code(503).send({ error: 'chart PDF generation unavailable' })
      }
      return reply.code(503).send({ error: 'chart PDF generation unavailable' })
    }
  })
  app.post<{ Params: { id: string; versionId: string }; Body: ChartVersionRestoreRequest }>('/v1/charts/:id/versions/:versionId/restore', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(401).send({ error: 'chart access required' })
    const { expectedRevision } = request.body ?? {}
    if (!Number.isInteger(expectedRevision)) return reply.code(400).send({ error: 'expectedRevision is required' })
    try {
      const profile = await charts.restoreVersion(request.params.id, principal.id, request.params.versionId, expectedRevision!)
      return profile ? { profile } : reply.code(404).send({ error: 'chart or version not found' })
    } catch (error) {
      if (error instanceof ChartRevisionConflictError) return reply.code(409).send({
        error: 'chart was updated elsewhere; reload before restoring',
        profile: await charts.getProfile(request.params.id, principal.id),
      })
      if (error instanceof ChartVersionRestoreConflictError) return reply.code(409).send({ error: error.message })
      throw error
    }
  })
  app.post<{ Params: { id: string }; Body: StoredChartFlowRequest }>('/v1/charts/:id/flow', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(401).send({ error: 'chart access required' })
    const { chartVersionId, targetDate, targetTime } = request.body ?? {}
    if (typeof chartVersionId !== 'string' || !chartVersionId.trim()) {
      return reply.code(400).send({ error: 'chartVersionId is required for stored chart flow calculation' })
    }
    if (typeof targetDate !== 'string' || !targetDate.trim()) {
      return reply.code(400).send({ error: 'targetDate is required for stored chart flow calculation' })
    }
    if (targetTime !== undefined && (typeof targetTime !== 'string' || !targetTime.trim())) {
      return reply.code(400).send({ error: 'targetTime must be a non-empty time string when provided' })
    }
    const profile = await charts.getProfile(request.params.id, principal.id)
    if (!profile) return reply.code(404).send({ error: 'chart not found' })
    if (profile.currentVersion.id !== chartVersionId.trim()) {
      return reply.code(409).send({ error: 'chart was updated elsewhere; reload before calculating flow', profile })
    }
    if (profile.currentVersion.calculationInput.inputMode === 'manual-four-pillars') {
      return reply.code(422).send({
        error: 'flow calculation is unavailable for manual four-pillar input without a birth-time source',
        reason: 'pending-source-required',
      })
    }
    try {
      const query: CycleQuery = {
        targetDate: targetDate.trim(),
        ...(targetTime !== undefined ? { targetTime: targetTime.trim() } : {}),
      }
      return {
        flow: calculateBaziFlow(profile.currentVersion.birth ?? profile.currentVersion.calculationInput, query),
        chartProfileId: profile.id,
        chartVersionId: profile.currentVersion.id,
        ruleProfileVersion: profile.currentVersion.ruleProfileVersion ?? null,
      }
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message })
    }
  })
  app.delete<{ Params: { id: string } }>('/v1/charts/:id', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(401).send({ error: 'chart access required' })
    const deleted = await charts.softDeleteProfile(request.params.id, principal.id)
    return deleted ? reply.code(204).send() : reply.code(404).send({ error: 'chart not found' })
  })
  app.post<{ Params: { id: string } }>('/v1/charts/:id/restore', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(401).send({ error: 'chart access required' })
    try {
      const profile = await charts.restoreProfile(request.params.id, principal.id)
      return profile ? { profile } : reply.code(404).send({ error: 'chart not found or is already active' })
    } catch (error) {
      if (error instanceof ChartProfileAlreadyExistsError || error instanceof ChartProfileLimitExceededError) return reply.code(409).send({
        error: error instanceof ChartProfileLimitExceededError
          ? 'chart profile limit exceeded; archive an active profile before restoring this profile'
          : 'an active chart profile already exists; remove it before restoring this profile',
        profile: await charts.getCurrentProfile(principal.id),
      })
      throw error
    }
  })
  app.get('/v1/residences', async (request) => {
    const principal = await principalFromCookie(request.headers.cookie)
    return { profiles: principal ? await residences.listProfiles(principal.id) : [] }
  })
  app.post<{ Body: ResidenceSnapshotRequest }>('/v1/residences', async (request, reply) => {
    let snapshot
    try {
      snapshot = parseResidenceSnapshot(request.body)
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message })
    }
    const principal = await ensureAnonymousPrincipal(request.headers.cookie, reply)
    return reply.code(201).send({ profile: await residences.createProfile(principal.id, snapshot) })
  })
  app.post<{ Params: { id: string }; Body: ResidenceSnapshotRequest }>('/v1/residences/:id/versions', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(401).send({ error: 'residence access required' })
    const { expectedRevision } = request.body ?? {}
    if (!Number.isInteger(expectedRevision)) return reply.code(400).send({ error: 'expectedRevision is required' })
    let snapshot
    try {
      snapshot = parseResidenceSnapshot(request.body)
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message })
    }
    try {
      const profile = await residences.appendVersion(request.params.id, principal.id, expectedRevision!, snapshot)
      return profile ? { profile } : reply.code(404).send({ error: 'residence not found' })
    } catch (error) {
      if (error instanceof ResidenceRevisionConflictError) return reply.code(409).send({
        error: 'residence was updated elsewhere; reload before saving',
        profile: await residences.getProfile(request.params.id, principal.id),
      })
      throw error
    }
  })
  app.get<{ Params: { id: string } }>('/v1/residences/:id/versions', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(401).send({ error: 'residence access required' })
    const versions = await residences.listVersions(request.params.id, principal.id)
    return versions ? { versions } : reply.code(404).send({ error: 'residence not found' })
  })
  app.post<{ Params: { id: string }; Body: ResidenceRestoreVersionRequest }>('/v1/residences/:id/versions/restore', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(401).send({ error: 'residence access required' })
    const { sourceVersionId, expectedRevision } = request.body ?? {}
    if (typeof sourceVersionId !== 'string' || !sourceVersionId.trim() || !Number.isInteger(expectedRevision)) {
      return reply.code(400).send({ error: 'sourceVersionId and expectedRevision are required' })
    }
    try {
      const profile = await residences.restoreVersion(request.params.id, principal.id, sourceVersionId.trim(), expectedRevision!)
      return profile ? { profile } : reply.code(404).send({ error: 'residence or version not found' })
    } catch (error) {
      if (error instanceof ResidenceRevisionConflictError) return reply.code(409).send({
        error: 'residence was updated elsewhere; reload before restoring',
        profile: await residences.getProfile(request.params.id, principal.id),
      })
      throw error
    }
  })
  app.delete<{ Params: { id: string } }>('/v1/residences/:id', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(401).send({ error: 'residence access required' })
    const deleted = await residences.softDeleteProfile(request.params.id, principal.id)
    return deleted ? reply.code(204).send() : reply.code(404).send({ error: 'residence not found' })
  })
  app.post<{ Params: { id: string } }>('/v1/residences/:id/restore', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(401).send({ error: 'residence access required' })
    const profile = await residences.restoreProfile(request.params.id, principal.id)
    return profile ? { profile } : reply.code(404).send({ error: 'residence not found or is already active' })
  })
  app.post<{ Body: { username?: unknown; password?: unknown } }>('/v1/admin/sessions', async (request, reply) => {
    if (!adminLoginConfigured()) return reply.code(503).send({ error: 'admin login is not configured' })
    const attemptKey = request.ip || 'unknown'
    if (loginRateLimited(attemptKey)) return reply.code(429).send({ error: 'too many login attempts; try again later' })
    const { username, password } = request.body ?? {}
    if (typeof username !== 'string' || typeof password !== 'string' || username.trim() !== adminUsername || !verifyAdminPassword(password)) {
      recordLoginFailure(attemptKey)
      return reply.code(401).send({ error: 'invalid admin credentials' })
    }
    adminLoginAttempts.delete(attemptKey)
    pruneExpiredAdminSessions()
    const token = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + adminSessionTtlMs
    adminSessions.set(tokenHash(token), { actor: adminActor, expiresAt })
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
    reply.header('set-cookie', `${adminSessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${adminSessionMaxAgeSeconds}${secure}`)
    return { username: adminUsername, actor: adminActor, expiresAt: new Date(expiresAt).toISOString() }
  })
  app.post<{ Body: { username?: unknown; displayName?: unknown; password?: unknown } }>('/v1/admin/users', async (request, reply) => {
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    const { username, displayName, password } = request.body ?? {}
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,40}$/.test(username.trim())) return reply.code(400).send({ error: 'username must be 3-40 letters, numbers, dots, underscores or hyphens' })
    if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 60) return reply.code(400).send({ error: 'displayName is required and must not exceed 60 characters' })
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) return reply.code(400).send({ error: 'password must be 8-128 characters' })
    try {
      const user = await accounts.createUser({ username: normalizeUsername(username), displayName, passwordHash: await hashPassword(password) })
      return reply.code(201).send({ user })
    } catch (error) {
      if ((error as Error).message.includes('username') || (error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'username already exists' })
      throw error
    }
  })
  app.get('/v1/admin/users', async (request, reply) => {
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    return { users: await accounts.listUsers() }
  })
  app.get<{ Params: { id: string } }>('/v1/admin/users/:id/overview', async (request, reply) => {
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    const user = await accounts.getUser(request.params.id)
    if (!user) return reply.code(404).send({ error: 'user not found' })
    const baseUser: AdminUserOverview['user'] = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      ...(user.lastLoginAt ? { lastLoginAt: user.lastLoginAt } : {}),
      hasBoundWorkspace: Boolean(user.principalId),
    }
    if (!user.principalId) {
      return {
        user: baseUser,
        charts: [],
        residences: [],
        reports: { active: [], archived: [], countsByChartProfileId: {}, countsByResidenceProfileId: {} },
      } satisfies AdminUserOverview
    }
    const [profiles, residenceProfiles, activeRecords, archivedRecords] = await Promise.all([
      charts.listProfiles(user.principalId, true),
      residences.listProfiles(user.principalId),
      repository.listByPrincipal(user.principalId, false),
      repository.listByPrincipal(user.principalId, true),
    ])
    const active = activeRecords.map(publicReportSummary)
    const archived = archivedRecords.map(publicReportSummary)
    return {
      user: baseUser,
      charts: profiles.map(publicAdminChartSummary),
      residences: residenceProfiles.map(publicAdminResidenceSummary),
      reports: {
        active,
        archived,
        countsByChartProfileId: adminReportCountsByChartProfileId(active, archived),
        countsByResidenceProfileId: adminReportCountsByResidenceProfileId(active, archived),
      },
    } satisfies AdminUserOverview
  })
  app.patch<{ Params: { id: string }; Body: { status?: unknown } }>('/v1/admin/users/:id/status', async (request, reply) => {
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    if (request.body?.status !== 'active' && request.body?.status !== 'disabled') return reply.code(400).send({ error: 'status must be active or disabled' })
    const user = await accounts.setUserStatus(request.params.id, request.body.status)
    return user ? { user } : reply.code(404).send({ error: 'user not found' })
  })
  app.post<{ Params: { id: string }; Body: { password?: unknown } }>('/v1/admin/users/:id/reset-password', async (request, reply) => {
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    const password = request.body?.password
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) return reply.code(400).send({ error: 'password must be 8-128 characters' })
    const user = await accounts.setPassword(request.params.id, await hashPassword(password))
    return user ? { user } : reply.code(404).send({ error: 'user not found' })
  })
  app.post<{ Body: { username?: unknown; password?: unknown } }>('/v1/auth/login', async (request, reply) => {
    const { username, password } = request.body ?? {}
    if (typeof username !== 'string' || typeof password !== 'string') return reply.code(401).send({ error: 'invalid credentials' })
    const stored = await accounts.findUserByUsername(username)
    if (!stored || stored.status !== 'active' || !(await verifyPassword(password, stored.passwordHash))) return reply.code(401).send({ error: 'invalid credentials' })
    let user = stored
    if (!user.principalId) {
      const anonymousToken = cookieValue(request.headers.cookie, principalCookieName)
      let principal = anonymousToken ? await charts.findPrincipalByTokenHash(tokenHash(anonymousToken)) : undefined
      if (!principal) principal = await charts.createPrincipal({ id: crypto.randomUUID(), kind: 'anonymous', tokenHash: tokenHash(randomBytes(32).toString('base64url')), createdAt: new Date().toISOString() })
      const bound = await accounts.bindPrincipal(user.id, principal.id)
      if (!bound) return reply.code(401).send({ error: 'invalid credentials' })
      user = { ...user, ...bound }
    }
    const token = randomBytes(32).toString('base64url')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + userSessionTtlMs)
    await accounts.createSession({ id: crypto.randomUUID(), userId: user.id, tokenHash: tokenHash(token), createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() })
    const loggedInUser = await accounts.recordLogin(user.id, now.toISOString()) ?? user
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
    reply.header('set-cookie', `${userSessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(userSessionTtlMs / 1000)}${secure}`)
    return { authenticated: true, user: { id: loggedInUser.id, username: loggedInUser.username, displayName: loggedInUser.displayName, status: loggedInUser.status } }
  })
  app.get('/v1/auth/session', async (request, reply) => {
    const authenticated = await authenticatedUser(request.headers.cookie)
    if (!authenticated) return reply.code(401).send({ error: 'authentication required' })
    const { user } = authenticated
    return { authenticated: true, user: { id: user.id, username: user.username, displayName: user.displayName, status: user.status } }
  })
  app.post('/v1/auth/logout', async (request, reply) => {
    const token = cookieValue(request.headers.cookie, userSessionCookieName)
    if (token) await accounts.revokeSession(tokenHash(token))
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
    reply.header('set-cookie', `${userSessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`)
    return { ok: true }
  })
  app.get('/v1/admin/sessions', async (request, reply) => {
    const session = adminSessionFromCookie(request.headers.cookie)
    if (!session) return reply.code(401).send({ error: 'admin session required' })
    return { username: adminUsername, actor: session.actor, expiresAt: new Date(session.expiresAt).toISOString() }
  })
  app.delete('/v1/admin/sessions', async (request, reply) => {
    const token = cookieValue(request.headers.cookie, adminSessionCookieName)
    if (token) adminSessions.delete(tokenHash(token))
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
    reply.header('set-cookie', `${adminSessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`)
    return { ok: true }
  })
  app.get('/v1/admin/dashboard', async (request, reply) => {
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    const [reportStats, chartStats, assets, profiles, activeVersions, fixtures] = await Promise.all([
      repository.reportStats(),
      charts.chartStats(),
      knowledge.list(),
      ruleProfiles.list(),
      ruleProfiles.listActiveVersions(),
      wenzhenStore.list(),
    ])
    const knowledgeCounts = { total: assets.length, draft: 0, inReview: 0, published: 0, archived: 0, article: 0, rule: 0, skill: 0 }
    for (const asset of assets) {
      if (asset.state === 'draft') knowledgeCounts.draft += 1
      else if (asset.state === 'in-review') knowledgeCounts.inReview += 1
      else if (asset.state === 'published') knowledgeCounts.published += 1
      else if (asset.state === 'archived') knowledgeCounts.archived += 1
      if (asset.kind === 'article') knowledgeCounts.article += 1
      else if (asset.kind === 'rule') knowledgeCounts.rule += 1
      else if (asset.kind === 'skill') knowledgeCounts.skill += 1
    }
    const ruleProfileCounts = { total: profiles.length, draft: 0, inReview: 0, published: 0, archived: 0, activeVersions: activeVersions.length }
    for (const profile of profiles) {
      if (profile.state === 'draft') ruleProfileCounts.draft += 1
      else if (profile.state === 'in-review') ruleProfileCounts.inReview += 1
      else if (profile.state === 'published') ruleProfileCounts.published += 1
      else if (profile.state === 'archived') ruleProfileCounts.archived += 1
    }
    return {
      generatedAt: new Date().toISOString(),
      reports: reportStats,
      charts: chartStats,
      knowledge: knowledgeCounts,
      ruleProfiles: ruleProfileCounts,
      wenzhen: { fixtures: fixtures.length },
    }
  })
  app.get<{ Querystring: { q?: string; state?: string } }>('/v1/bazi-rule-profiles', async (request, reply) => {
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    const needle = (request.query.q ?? '').trim().toLowerCase()
    const state = request.query.state
    const profiles = await ruleProfiles.list()
    return profiles.filter((profile) =>
      (!needle || profile.name.toLowerCase().includes(needle)) &&
      (!state || profile.state === state))
  })
  app.get('/v1/bazi-rule-profile-versions/active', async () => (await ruleProfiles.listActiveVersions()).map(publicRuleProfileVersion))
  app.post<{ Body: CreateBaziRuleProfileInput }>('/v1/bazi-rule-profiles', async (request, reply) => {
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    try {
      return reply.code(201).send(await ruleProfiles.create(request.body, adminActor))
    } catch (error) {
      if (error instanceof DuplicateBaziRuleProfileKeyError) return reply.code(409).send({ error: error.message })
      if (error instanceof BaziRuleProfileValidationError) return reply.code(400).send({ error: error.message })
      throw error
    }
  })
  app.post<{ Params: { id: string }; Body: ReviseBaziRuleProfileInput & { expectedRevision?: number } }>('/v1/bazi-rule-profiles/:id/revisions', async (request, reply) => {
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    try {
      const { input, expectedRevision } = parseBaziRuleProfileRevisionRequest(request.body)
      const profile = await ruleProfiles.revise(request.params.id, input, adminActor, expectedRevision)
      return profile ? reply.code(201).send(profile) : reply.code(404).send({ error: 'bazi rule profile not found' })
    } catch (error) {
      if (error instanceof BaziRuleProfileRevisionConflictError) return reply.code(409).send({ error: error.message })
      if (error instanceof InvalidBaziRuleProfileTransitionError) return reply.code(409).send({ error: error.message })
      if (error instanceof BaziRuleProfileValidationError) return reply.code(400).send({ error: error.message })
      throw error
    }
  })
  app.post<{ Params: { id: string }; Body: { state?: BaziRuleProfileState } }>('/v1/bazi-rule-profiles/:id/state', async (request, reply) => {
    const state = request.body?.state
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    try {
      if (!state) return reply.code(400).send({ error: 'state is required' })
      if (state === 'published' && !await validateRuleProfileKnowledgeSources(request.params.id)) {
        return reply.code(404).send({ error: 'bazi rule profile not found' })
      }
      const profile = await ruleProfiles.setState(request.params.id, state, adminActor)
      return profile ?? reply.code(404).send({ error: 'bazi rule profile not found' })
    } catch (error) {
      if (error instanceof InvalidBaziRuleProfileTransitionError) return reply.code(409).send({ error: error.message })
      if (error instanceof BaziRuleProfileValidationError) return reply.code(400).send({ error: error.message })
      throw error
    }
  })
  app.get<{ Params: { id: string } }>('/v1/bazi-rule-profiles/:id/versions', async (request, reply) => {
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    const versions = await ruleProfiles.listVersions(request.params.id)
    return versions ?? reply.code(404).send({ error: 'bazi rule profile not found' })
  })
  app.delete<{ Params: { id: string } }>('/v1/bazi-rule-profiles/:id', async (request, reply) => {
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    try {
      if (await charts.referencesRuleProfile(request.params.id)) {
        return reply.code(409).send({ error: 'bazi rule profile has a published version referenced by a saved chart' })
      }
      const deleted = await ruleProfiles.delete(request.params.id)
      return deleted ? reply.code(204).send() : reply.code(404).send({ error: 'bazi rule profile not found' })
    } catch (error) {
      if (error instanceof BaziRuleProfileReferencedError) return reply.code(409).send({ error: error.message })
      throw error
    }
  })
  app.get<{ Querystring: { q?: string; kind?: string; state?: string } }>('/v1/knowledge', async (request, reply) => {
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    const needle = (request.query.q ?? '').trim().toLowerCase()
    const kind = request.query.kind
    const state = request.query.state
    const assets = await knowledge.list()
    return assets.filter((asset) =>
      (!needle || asset.title.toLowerCase().includes(needle)) &&
      (!kind || asset.kind === kind) &&
      (!state || asset.state === state))
  })
  app.get<{ Querystring: { q?: string; limit?: string } }>('/v1/knowledge/search', async (request, reply) => {
    const unauthorized = requireKnowledgeReader(request.headers.authorization, reply)
    if (unauthorized) return unauthorized
    const requestedLimit = Number.parseInt(request.query.limit ?? '', 10)
    const limit = Number.isFinite(requestedLimit) ? Math.min(10, Math.max(1, requestedLimit)) : 5
    return knowledge.search(request.query.q ?? '', limit)
  })
  app.get<{ Params: { id: string } }>('/v1/knowledge/:id/versions', async (request, reply) => requireAdmin(request, reply) ?? knowledge.listVersions(request.params.id))
  app.delete<{ Params: { id: string } }>('/v1/knowledge/:id', async (request, reply) => {
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    if (await repository.isKnowledgeCited(request.params.id)) {
      return reply.code(409).send({ error: 'knowledge asset is cited by a saved report and cannot be deleted' })
    }
    const deleted = await knowledge.delete(request.params.id)
    return deleted ? reply.code(204).send() : reply.code(404).send({ error: 'asset not found' })
  })
  app.post<{ Body: unknown }>('/v1/knowledge', async (request, reply) => {
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    try {
      return reply.code(201).send(await knowledge.create(parseKnowledgeAssetRequest(request.body, 'create'), adminActor))
    } catch (error) {
      if (error instanceof KnowledgePublicationValidationError) return reply.code(400).send({ error: error.message })
      throw error
    }
  })
  app.post<{ Params: { id: string }; Body: unknown }>('/v1/knowledge/:id/revisions', async (request, reply) => {
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    try {
      const revision = parseKnowledgeAssetRequest(request.body, 'revise')
      const revised = await knowledge.revise(request.params.id, revision.input, adminActor, revision.expectedRevision)
      return revised ? reply.code(201).send(revised) : reply.code(404).send({ error: 'asset not found' })
    } catch (error) {
      if (error instanceof KnowledgeRevisionConflictError) return reply.code(409).send({ error: error.message })
      if (error instanceof InvalidKnowledgeTransitionError) return reply.code(409).send({ error: error.message })
      if (error instanceof KnowledgePublicationValidationError) return reply.code(400).send({ error: error.message })
      throw error
    }
  })
  app.post<{ Params: { id: string }; Body: { state?: 'draft' | 'in-review' | 'published' | 'archived' } }>('/v1/knowledge/:id/state', async (request, reply) => {
    const state = request.body?.state
    const unauthorized = requireAdmin(request, reply)
    if (unauthorized) return unauthorized
    if (!state || !publicationStates.has(state)) return reply.code(400).send({ error: 'valid state is required' })
    try {
      return (await knowledge.setState(request.params.id, state, adminActor)) ?? reply.code(404).send({ error: 'asset not found' })
    } catch (error) {
      if (error instanceof InvalidKnowledgeTransitionError) return reply.code(409).send({ error: error.message })
      if (error instanceof KnowledgePublicationValidationError) return reply.code(400).send({ error: error.message })
      return reply.code(400).send({ error: (error as Error).message })
    }
  })
  app.post('/v1/media', async (request, reply) => {
    if (request.headers['x-vision-consent'] !== 'accepted') return reply.code(400).send({ error: 'explicit vision consent is required before upload' })
    try {
      const principal = await ensureAnonymousPrincipal(request.headers.cookie, reply)
      const image = await request.file()
      if (!image) return reply.code(400).send({ error: 'image is required' })
      const bytes = await image.toBuffer()
      return reply.code(201).send(await mediaStore.save({ filename: image.filename, mimetype: image.mimetype, bytes, ownerId: principal.id }))
    } catch (error) {
      request.log.warn({ err: error }, 'media upload rejected')
      return reply.code(400).send({ error: 'invalid image upload' })
    }
  })
  app.get<{ Querystring: { archived?: string; chartProfileId?: string; residenceProfileId?: string } }>('/v1/reports', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return { reports: [] }
    try {
      const reports = await repository.listByPrincipal(principal.id, request.query.archived === 'true')
      return {
        reports: reports.filter((record) =>
          (!request.query.chartProfileId || record.chartProfileId === request.query.chartProfileId)
          && (!request.query.residenceProfileId || record.residenceProfileId === request.query.residenceProfileId))
          .map(publicReportSummary),
      }
    } catch (error) {
      request.log.error({ err: error }, 'report list retrieval failed')
      return reply.code(503).send({ error: 'reports unavailable' })
    }
  })
  app.get<{ Params: { id: string } }>('/v1/reports/:id', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(404).send({ error: 'report not found' })
    const record = await repository.getOwned(request.params.id, principal.id)
    if (!record) return reply.code(404).send({ error: 'report not found' })
    return publicReportRecord(record)
  })
  app.get<{ Params: { id: string } }>('/v1/reports/:id/pdf', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(404).send({ error: 'report not found' })
    const record = await repository.getOwned(request.params.id, principal.id)
    if (!record) return reply.code(404).send({ error: 'report not found' })
    if (record.archivedAt || record.status !== 'completed' || !record.report?.trim() || !hasCurrentValidatorApproval(record)) {
      return reply.code(409).send({ error: 'report is not ready for PDF export' })
    }
    if ('inputMode' in record.bazi || typeof record.bazi.correctedLocalTime !== 'string' || typeof record.bazi.correctionMinutes !== 'number') {
      return reply.code(422).send({ error: 'PDF export for reports using manual four-pillar charts is not supported yet' })
    }
    try {
      const pdf = await reportPdfRenderer.render({
        id: record.id,
        status: record.status,
        createdAt: record.createdAt,
        report: record.report,
        chartProfileId: record.chartProfileId,
        chartVersionId: record.chartVersionId,
        residenceProfileId: record.residenceProfileId,
        residenceVersionId: record.residenceVersionId,
        bazi: {
          pillars: record.bazi.pillars,
          correctedLocalTime: record.bazi.correctedLocalTime,
          correctionMinutes: record.bazi.correctionMinutes,
          ruleVersion: record.bazi.ruleVersion,
          timeCorrectionRuleVersion: record.bazi.timeCorrectionRuleVersion,
          professional: record.bazi.professional,
          timeProfile: record.bazi.timeProfile,
        },
        vision: record.vision,
        citations: record.citations,
        evaluatedRules: record.evaluatedRules,
      })
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="fengshui-report-${record.id}.pdf"`)
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(pdf)
    } catch (error) {
      request.log.error({ err: error, reportId: record.id }, 'report PDF generation failed')
      if (error instanceof ReportPdfUnavailableError) {
        return reply.code(503).send({ error: 'report PDF generation unavailable' })
      }
      return reply.code(503).send({ error: 'report PDF generation unavailable' })
    }
  })
  app.post<{ Params: { id: string } }>('/v1/reports/:id/share', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(404).send({ error: 'report not found' })
    const record = await repository.getOwned(request.params.id, principal.id)
    if (!record) return reply.code(404).send({ error: 'report not found' })
    if (!reportCanBeShared(record)) return reply.code(409).send({ error: 'report is not ready to share' })
    const token = randomBytes(reportShareTokenBytes).toString('base64url')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + reportShareTtlMs).toISOString()
    record.shareAccess = { tokenHash: tokenHash(token), createdAt: now.toISOString(), expiresAt }
    await repository.save(record)
    return reply.header('Cache-Control', 'private, no-store').send({ token, expiresAt })
  })
  app.delete<{ Params: { id: string } }>('/v1/reports/:id/share', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(404).send({ error: 'report not found' })
    const record = await repository.getOwned(request.params.id, principal.id)
    if (!record) return reply.code(404).send({ error: 'report not found' })
    if (record.shareAccess) {
      delete record.shareAccess
      await repository.save(record)
    }
    return reply.header('Cache-Control', 'private, no-store').code(204).send()
  })
  app.delete<{ Params: { id: string } }>('/v1/reports/:id', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(404).send({ error: 'report not found' })
    try {
      const archived = await repository.archiveOwned(request.params.id, principal.id, new Date().toISOString())
      return archived
        ? reply.header('Cache-Control', 'private, no-store').code(204).send()
        : reply.code(404).send({ error: 'report not found' })
    } catch (error) {
      if (error instanceof ReportArchiveConflictError) return reply.code(409).send({ error: error.message })
      throw error
    }
  })
  app.post<{ Params: { id: string } }>('/v1/reports/:id/restore', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(404).send({ error: 'report not found' })
    try {
      const restored = await repository.restoreOwned(request.params.id, principal.id)
      return restored
        ? reply.header('Cache-Control', 'private, no-store').send(publicReportRecord(restored))
        : reply.code(404).send({ error: 'report not found' })
    } catch (error) {
      if (error instanceof ReportArchiveConflictError) return reply.code(409).send({ error: error.message })
      throw error
    }
  })
  app.post<{ Params: { id: string } }>('/v1/reports/:id/regenerate', async (request, reply) => {
    const principal = await principalFromCookie(request.headers.cookie)
    if (!principal) return reply.code(404).send({ error: 'report not found' })
    const source = await repository.getOwned(request.params.id, principal.id)
    if (!source) return reply.code(404).send({ error: 'report not found' })
    if (source.status !== 'completed'
      || !source.chartProfileId
      || !source.chartVersionId
      || !source.residenceProfileId
      || !source.residenceVersionId
      || !source.vision?.length) {
      return reply.code(409).send({ error: 'report does not contain complete saved evidence for regeneration' })
    }

    const [chartVersion, residenceVersion] = await Promise.all([
      charts.getVersion(source.chartProfileId, principal.id, source.chartVersionId),
      residences.getVersion(source.residenceProfileId, principal.id, source.residenceVersionId),
    ])
    if (!chartVersion || !residenceVersion) {
      return reply.code(409).send({ error: 'report immutable versions are unavailable for regeneration' })
    }

    const {
      calculationInput: _sourceCalculationInput,
      birth: _sourceBirth,
      residence: _sourceResidence,
      ...sourceSubmissionMetadata
    } = structuredClone(source.submission)
    const submissionBase = {
      ...sourceSubmissionMetadata,
      chartProfileId: source.chartProfileId,
      chartVersionId: chartVersion.id,
      residenceProfileId: source.residenceProfileId,
      residenceVersionId: residenceVersion.id,
      residence: {
        facing: residenceVersion.snapshot.facing,
        ...(residenceVersion.snapshot.layoutNote ? { layoutNote: residenceVersion.snapshot.layoutNote } : {}),
      },
    }
    const submission: ReportSubmission = chartVersion.calculationInput.inputMode === 'manual-four-pillars'
      ? {
          ...submissionBase,
          calculationInput: structuredClone(chartVersion.calculationInput),
        }
      : {
          ...submissionBase,
          calculationInput: structuredClone(chartVersion.calculationInput),
          birth: structuredClone(chartVersion.birth ?? chartVersion.calculationInput),
        }
    const createdAt = new Date().toISOString()
    const record: ReportRecord = {
      id: crypto.randomUUID(),
      sourceReportId: source.id,
      principalId: principal.id,
      status: 'queued',
      phase: 'queued',
      createdAt,
      submission,
      bazi: structuredClone(chartVersion.bazi),
      chartProfileId: source.chartProfileId,
      chartVersionId: chartVersion.id,
      residenceProfileId: source.residenceProfileId,
      residenceVersionId: residenceVersion.id,
      vision: structuredClone(source.vision),
      ...(source.floorPlanAnalysis ? { floorPlanAnalysis: structuredClone(source.floorPlanAnalysis) } : {}),
      pipelineCheckpoint: {
        schemaVersion: 'report-pipeline-checkpoint-v1',
        vision: { completedAt: createdAt },
      },
    }
    await repository.save(record)
    const publicRecord = publicReportRecord(record)
    startReport(record.id)
    return reply.header('Cache-Control', 'private, no-store').code(202).send(publicRecord)
  })
  app.get<{ Params: { id: string } }>('/v1/shared-reports/:id', async (request, reply) => {
    const record = await repository.get(request.params.id)
    const shareAccess = record?.shareAccess
    const expiresAtMs = shareAccess ? Date.parse(shareAccess.expiresAt) : Number.NaN
    if (!record || !shareAccess || !reportCanBeShared(record) || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return reply.code(404).send({ error: 'report not found' })
    }
    const token = request.headers['x-report-share-token']
    if (!tokenHashMatches(typeof token === 'string' ? token : undefined, shareAccess.tokenHash)) {
      return reply.code(404).send({ error: 'report not found' })
    }
    return reply.header('Cache-Control', 'private, no-store').send(publicReportRecord(record))
  })
  app.post<{ Body: ReportSubmissionRequest }>('/v1/reports', async (request, reply) => {
    if (request.body?.visionConsent !== true) return reply.code(400).send({ error: 'explicit vision consent is required' })
    if (!request.body.residence || !directions.has(request.body.residence.facing) || !request.body.photos?.length || request.body.photos.length > 12 || request.body.photos.some((photo) => typeof photo.fileId !== 'string' || !rooms.has(photo.room) || !directions.has(photo.facing))) return reply.code(400).send({ error: 'valid chart input, residence and 1-12 photos are required' })
    const floorPlanError = validateReportFloorPlan(request.body.floorPlan)
    if (floorPlanError) return reply.code(400).send({ error: floorPlanError })
    let bazi
    let submission: ReportSubmission
    let chartProfileId: string | undefined
    let chartVersionId: string | undefined
    let residenceProfileId: string | undefined
    let residenceVersionId: string | undefined
    let reportPrincipalId: string | undefined
    const reportId = crypto.randomUUID()
    if (request.body.chartProfileId) {
      if (!request.body.chartVersionId) return reply.code(400).send({ error: 'chartVersionId is required with chartProfileId' })
      const principal = await principalFromCookie(request.headers.cookie)
      if (!principal) return reply.code(401).send({ error: 'chart access required' })
      const profile = await charts.getProfile(request.body.chartProfileId, principal.id)
      if (!profile) return reply.code(404).send({ error: 'chart not found' })
      if (profile.currentVersion.id !== request.body.chartVersionId) return reply.code(409).send({ error: 'chart was updated elsewhere; reload before creating the report', profile })
      const requestedRuleProfileVersionId = typeof request.body.ruleProfileVersionId === 'string'
        ? request.body.ruleProfileVersionId.trim()
        : undefined
      if (request.body.ruleProfileVersionId !== undefined && !requestedRuleProfileVersionId) {
        return reply.code(400).send({ error: 'ruleProfileVersionId must identify the chart version rule profile' })
      }
      const boundRuleProfileVersionId = profile.currentVersion.ruleProfileVersion?.versionId
      if (requestedRuleProfileVersionId && requestedRuleProfileVersionId !== boundRuleProfileVersionId) {
        return reply.code(409).send({ error: 'selected bazi rule profile version does not match the chart version', profile })
      }
      submission = reportSubmissionFromCalculation(
        request.body,
        profile.currentVersion.calculationInput,
        profile.currentVersion.birth,
        boundRuleProfileVersionId,
      )
      bazi = profile.currentVersion.bazi
      chartProfileId = profile.id
      chartVersionId = profile.currentVersion.id
      reportPrincipalId = principal.id
    } else {
      const rawCalculationInput = request.body.calculationInput ?? request.body.birth
      if (!isManualFourPillarsInput(rawCalculationInput) && !hasPersistableBirthInput(rawCalculationInput)) {
        return reply.code(400).send({ error: 'valid birth date, time and a non-empty birthplace code are required to create a report without a saved chart version' })
      }
      let calculated
      try {
        calculated = await calculateRequest(rawCalculationInput, request.body.ruleProfileVersionId, true)
      } catch (error) { return reply.code(400).send({ error: (error as Error).message }) }
      submission = reportSubmissionFromCalculation(
        request.body,
        calculated.calculationInput,
        calculated.birth,
        calculated.ruleProfileVersion?.versionId,
      )
      bazi = calculated.bazi
      const principal = await ensureAnonymousPrincipal(request.headers.cookie, reply)
      reportPrincipalId = principal.id
      const current = await charts.getCurrentProfile(principal.id)
      try {
        const ruleVersionMatches = current?.currentVersion.ruleProfileVersion?.versionId === calculated.ruleProfileVersion?.versionId
        const profile = current
          ? JSON.stringify(current.currentVersion.calculationInput) === JSON.stringify(calculated.calculationInput) && ruleVersionMatches
            ? current
            : await charts.appendVersion(current.id, principal.id, current.revision, calculated.calculationInput, bazi, calculated.ruleProfileVersion)
          : await charts.createProfile(
            principal.id,
            calculated.calculationInput,
            bazi,
            { label: '我的命盘', relationship: 'self' },
            calculated.ruleProfileVersion,
          )
        if (!profile) return reply.code(404).send({ error: 'chart not found' })
        chartProfileId = profile.id
        chartVersionId = profile.currentVersion.id
      } catch (error) {
        if (error instanceof ChartRevisionConflictError) return reply.code(409).send({ error: 'chart was updated elsewhere; reload before creating the report' })
        throw error
      }
    }
    if (!reportPrincipalId) throw new Error('report principal was not resolved')
    try {
      const residenceProfile = await resolveReportResidence(request.body, reportPrincipalId)
      residenceProfileId = residenceProfile.id
      residenceVersionId = residenceProfile.currentVersion.id
      const { facing, layoutNote } = residenceProfile.currentVersion.snapshot
      submission = {
        ...submission,
        residenceProfileId,
        residenceVersionId,
        residence: {
          facing,
          ...(layoutNote ? { layoutNote } : {}),
        },
      }
    } catch (error) {
      const statusCode = Number((error as { statusCode?: unknown }).statusCode)
      if (statusCode === 400 || statusCode === 404 || statusCode === 409) {
        const body: Record<string, unknown> = { error: (error as Error).message }
        const profile = (error as { profile?: unknown }).profile
        if (profile) body.profile = profile
        return reply.code(statusCode).send(body)
      }
      throw error
    }
    const claimedPhotoIds: string[] = []
    try {
      for (const photo of request.body.photos) {
        await mediaStore.claim(photo.fileId, reportPrincipalId, reportId)
        claimedPhotoIds.push(photo.fileId)
      }
    } catch (error) {
      await Promise.allSettled(claimedPhotoIds.map((fileId) => mediaStore.releaseClaim(fileId, reportPrincipalId!, reportId)))
      if (error instanceof MediaClaimConflictError) return reply.code(409).send({ error: 'one or more uploaded photos are already attached to another report' })
      if (error instanceof MediaOwnershipError) return reply.code(400).send({ error: 'one or more uploaded photos are missing or invalid' })
      return reply.code(400).send({ error: 'one or more uploaded photos are missing or invalid' })
    }
      const record: ReportRecord = {
      id: reportId,
      principalId: reportPrincipalId,
      status: 'queued',
      phase: 'queued',
      createdAt: new Date().toISOString(),
      submission,
      bazi,
      ...(chartProfileId ? { chartProfileId, chartVersionId } : {}),
      ...(residenceProfileId ? { residenceProfileId, residenceVersionId } : {}),
    }
    await repository.save(record)
    try {
      record.citations = await retrieveReportCitations(submission, bazi)
      record.pipelineCheckpoint = {
        schemaVersion: 'report-pipeline-checkpoint-v1',
        citations: { completedAt: new Date().toISOString() },
      }
    } catch (error) {
      app.log.error({ err: error, reportId: record.id }, 'knowledge retrieval failed for queued report')
      record.status = 'failed'
      record.phase = 'failed'
      record.error = 'Knowledge retrieval failed'
      await repository.save(record)
      await removeReportMedia(record)
      return reply.code(202).send(publicReportRecord(record))
    }
    try {
      await repository.save(record)
    } catch (error) {
      app.log.error({ err: error, reportId: record.id }, 'queued report citation persistence failed')
      record.status = 'failed'
      record.phase = 'failed'
      record.error = 'Report result persistence failed'
      await repository.save(record)
      await removeReportMedia(record)
      return reply.code(202).send(publicReportRecord(record))
    }
    const publicRecord = publicReportRecord(record)
    startReport(record.id)
    return reply.code(202).send(publicRecord)
  })
  return app
}

function requestLogWarn(app: ReturnType<typeof Fastify>, error: unknown, message: string) {
  app.log.warn({ err: error }, message)
}

function appendNineGridObservation(
  observations: readonly VisionObservation[],
  analysis: NineGridResult,
): readonly VisionObservation[] {
  if (analysis.status !== 'derived') {
    return [
      ...observations,
      {
        fileId: 'floorplan-nine-grid',
        room: 'overview',
        summary: '九宫格程序分析未形成可发布事实。',
        observedElements: [],
        uncertainties: [analysis.reason, ...analysis.limitations],
        schemaVersion: 'vision-observation-v2',
        modelVersion: analysis.algorithmVersion,
        promptVersion: 'residence-facts-v2',
        facts: [],
      },
    ]
  }
  if (analysis.facts.length === 0) {
    return [
      ...observations,
      {
        fileId: 'floorplan-nine-grid',
        room: 'overview',
        summary: '九宫格程序分析未命中南侧厨房或近中宫卫生间。',
        observedElements: analysis.rooms.map((room) => `${room.label ?? room.roomId}:${room.sector}`),
        uncertainties: analysis.limitations,
        schemaVersion: 'vision-observation-v2',
        modelVersion: analysis.algorithmVersion,
        promptVersion: 'residence-facts-v2',
        facts: [],
      },
    ]
  }
  return [
    ...observations,
    {
      fileId: 'floorplan-nine-grid',
      room: 'overview',
      summary: '九宫格程序分析形成可复算户型事实。',
      observedElements: analysis.facts.map((fact) => fact.evidence),
      uncertainties: analysis.limitations,
      schemaVersion: 'vision-observation-v2',
      modelVersion: analysis.algorithmVersion,
      promptVersion: 'residence-facts-v2',
      facts: analysis.facts.map((fact) => ({
        code: fact.code,
        confidence: fact.confidence,
        evidence: fact.evidence,
        scope: 'floor-plan-topology',
        source: 'program-nine-grid',
      })),
    },
  ]
}
