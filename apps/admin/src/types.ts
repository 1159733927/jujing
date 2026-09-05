// Shared domain and API-response types for the admin console.
// These mirror the shapes returned by the Fastify API (apps/api/src/app.ts).

export type AssetState = 'draft' | 'in-review' | 'published' | 'archived'
export type AssetKind = 'article' | 'rule' | 'skill'

export type AssetRuleCondition = { fact: string; operator: string; value: string | readonly string[] | boolean }
export type AssetRuleConclusion = { code: string; text: string; level: 'info' | 'attention' }
export type AssetRule = {
  priority: number
  conditions: readonly AssetRuleCondition[]
  conclusions: readonly AssetRuleConclusion[]
}

export type Asset = {
  id: string
  version: number
  state: AssetState
  kind: AssetKind
  title: string
  tags: string[]
  body: string
  sourceLabel: string
  currentPublishedVersionId?: string
  createdAt?: string
  createdBy?: string
  updatedAt?: string
  updatedBy?: string
  submittedForReviewBy?: string
  reviewedAt?: string
  reviewedBy?: string
  archivedAt?: string
  rule?: AssetRule
}

export type KnowledgeRevisionDraft = {
  assetId: string
  expectedRevision: number
  kind: AssetKind
  title: string
  sourceLabel: string
  tagsText: string
  body: string
  rule?: AssetRule
}

export type PublishedKnowledgeVersionOption = {
  versionId: string
  version: number
  title: string
  assetId?: string
  kind?: AssetKind
  contentHash?: string
  sourceLabel?: string
  tags?: string[]
  body?: string
  publishedAt?: string
  publishedBy?: string
  reviewedAt?: string
  reviewedBy?: string
}

export type RuleProfileState = 'draft' | 'in-review' | 'published' | 'archived'
export type AssessmentName = 'strength' | 'pattern' | 'shenSha'
export type TrueSolarTimeRuleVersion =
  | 'true-solar-v2-zone-meridian-equation-of-time'
  | 'true-solar-v3-standard-time-equation-of-time'

export type DecisionCondition = { fact: string; operator: string; value?: string | number | boolean | string[] }
export type DecisionRule = {
  id: string
  priority: number
  all: DecisionCondition[]
  output: { code: string; label: string; targets?: ('year' | 'month' | 'day' | 'hour')[] }
  sourceVersionIds: string[]
}
export type RuleMethodConfig = { enabled: boolean; method: string; ruleSetVersion: string; rules?: DecisionRule[] }

export type RuleProfileDefinition = {
  schemaVersion?: 2
  timeDefaults: {
    timezone: string
    dstPolicy: 'auto' | 'ignore'
    useTrueSolarTime: boolean
    timeCorrectionRuleVersion: TrueSolarTimeRuleVersion
    dayBoundary: 'midnight' | 'zi-hour-start'
    luckMethod: 'sect1' | 'sect2'
  }
  assessments: { strength: RuleMethodConfig; pattern: RuleMethodConfig; shenSha: RuleMethodConfig }
}

export type RuleProfile = {
  id: string
  key: string
  name: string
  description?: string
  state: RuleProfileState
  revision: number
  workingDefinition: RuleProfileDefinition
  currentPublishedVersionId?: string
  updatedAt: string
}

export type PublishedRuleProfileVersion = {
  profileId: string
  versionId: string
  version: number
  contentHash: string
  publishedAt: string
  publishedBy: string
}

export type RuleProfileDraft = {
  key: string
  name: string
  description: string
  definition: RuleProfileDefinition
  expectedRevision?: number
}

export type WenzhenDifferenceClassification = 'dependency' | 'school-rule' | 'timezone-location' | 'display-rounding' | 'bug'
export type AcceptableWenzhenDifferenceClassification = Exclude<WenzhenDifferenceClassification, 'bug'>
export type WenzhenDifferenceClassificationSelection = WenzhenDifferenceClassification | ''
export type WenzhenAssertionCoverageCategory = 'pillars' | 'time-correction' | 'professional-table' | 'luck-cycles' | 'dynamic-cycles'
export type WenzhenAssertionCoverage = Record<WenzhenAssertionCoverageCategory, number>
export type WenzhenMismatch = { path: string; category: string; expected: unknown; actual: unknown }
export type AcceptedWenzhenDifference = { path: string; reason: string; classification: AcceptableWenzhenDifferenceClassification }
export type WenzhenAcceptanceValidation =
  | { ok: true; acceptedDifferences: AcceptedWenzhenDifference[] }
  | { ok: false; code: 'missing-reason' | 'missing-classification' | 'bug'; path: string; message: string }

export type WenzhenDiffResponse = {
  totals: { all: number; reportable: number; pending: number; matched: number; accepted: number; mismatched: number }
  coverage: WenzhenAssertionCoverage
  pendingSamples: { sampleId?: string; source?: string; notes?: string }[]
}

export type WenzhenCompareResponse = {
  report: {
    sampleId: string
    matched: boolean
    mismatches: { path: string; category: string; expected: unknown; actual: unknown }[]
  }
}

export type WenzhenFixtureSaveResponse = {
  fixture: { sampleId: string; status: 'verified' | 'accepted-difference' }
  report: {
    sampleId: string
    matched: boolean
    outcome: 'passed' | 'failed' | 'accepted-difference'
    differences: { path: string; category: string; expected: unknown; actual: unknown }[]
  }
}

export type WenzhenEvidenceUploadResponse = {
  evidenceRef: string
  sha256: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  size: number
}

export type WenzhenCaptureDraft = {
  sampleId: string
  capturedAt: string
  sourceUrl: string
  evidenceRef: string
  flowTargetDate: string | null
  flowTargetTime: string | null
  calendarSystem: 'solar' | 'lunar'
  lunarLeapMonth: boolean
  date: string
  time: string
  placeCode: string
  placeLabel: string
  placeLongitude?: number
  placeLatitude?: number
  placeTimezone: string
  placeCoordinateStatus: string
  placeCoordinateSource: string
  placeCoordinateLicense: string
  placeDataVersion: string
  gender: 'male' | 'female'
  useTrueSolarTime: boolean
  dstPolicy: 'auto' | 'ignore'
  dayBoundary: 'midnight' | 'zi-hour-start'
  luckMethod: 'sect1' | 'sect2'
  pillars: string
  expectedJson: string
}

export type BaziFlowSelection = {
  year: number
  monthYear: number
  month: number
  date: string
  hourSlotStart: number
}

export type BaziFlowResponse = {
  flow: {
    selection: BaziFlowSelection
    monthlyCycles: { year: number; month: number }[]
    targetChart: { correctedLocalTime: string; correctionMinutes: number }
  }
}

export type AdminBirthplaceResult = {
  province: { code: string; name: string }
  city: { code: string; name: string; timezone?: string }
  district: {
    code: string
    name: string
    longitude?: number
    latitude?: number
    coordinate?: { confidence?: string; sourceLabel?: string; license?: string }
  }
  selectable: boolean
  datasetVersion?: string
}

export type AdminBirthplaceSearchResponse = {
  total: number
  items: AdminBirthplaceResult[]
  dataset?: { version?: string }
}

export type AdminSession = { username: string; actor: string; expiresAt: string }

export type UserAccountStatus = 'active' | 'disabled'

export type UserAccount = {
  id: string
  username: string
  displayName: string
  status: UserAccountStatus
  principalId?: string
  createdAt: string
  updatedAt: string
  lastLoginAt?: string
}

export type AdminChartProfileSummary = {
  id: string
  label: string
  relationship: 'self' | 'partner' | 'parent' | 'child' | 'other'
  revision: number
  createdAt: string
  updatedAt: string
  deletedAt?: string
  currentVersion: {
    id: string
    version: number
    createdAt: string
    pillars: string[]
    birth?: {
      date: string
      time: string
      locationName?: string
      placeCode?: string
      calendarSystem?: string
    }
  }
}

export type AdminReportSummary = {
  id: string
  status: 'queued' | 'completed' | 'failed'
  phase?: string
  createdAt: string
  archivedAt?: string
  chartProfileId?: string
  chartVersionId?: string
  residenceProfileId?: string
  residenceVersionId?: string
  residenceFacing?: string
  photoCount: number
  hasReport: boolean
  reportPreview?: string
}

export type AdminResidenceProfileSummary = {
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

export type UserAccountOverview = {
  user: Omit<UserAccount, 'principalId'> & { hasBoundWorkspace: boolean }
  charts: AdminChartProfileSummary[]
  residences: AdminResidenceProfileSummary[]
  reports: {
    active: AdminReportSummary[]
    archived: AdminReportSummary[]
    countsByChartProfileId: Record<string, { active: number; archived: number }>
    countsByResidenceProfileId: Record<string, { active: number; archived: number }>
  }
}

export type DashboardSnapshot = {
  generatedAt: string
  reports: { total: number; queued: number; completed: number; failed: number; last24h: number }
  charts: { total: number; active: number; deleted: number }
  knowledge: { total: number; draft: number; inReview: number; published: number; archived: number; article: number; rule: number; skill: number }
  ruleProfiles: { total: number; draft: number; inReview: number; published: number; archived: number; activeVersions: number }
  wenzhen: { fixtures: number }
}

export type LoadState = 'disconnected' | 'loading' | 'ready' | 'empty' | 'error'
