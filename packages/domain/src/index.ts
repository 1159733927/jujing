import type { NineGridInput, NineGridResult } from './nine-grid.js'

export type Direction = 'north' | 'east' | 'south' | 'west' | 'unknown'

export interface ResidencePhotoInput {
  fileId: string
  room: 'overview' | 'living-room' | 'bedroom' | 'kitchen' | 'bathroom' | 'entrance' | 'other'
  facing: Direction
  note?: string
}

export interface ResidenceSnapshot {
  schemaVersion: 'residence-snapshot-v1'
  label: string
  facing: Direction
  layoutNote?: string
}

export interface ResidenceVersion {
  id: string
  profileId: string
  version: number
  snapshot: ResidenceSnapshot
  createdAt: string
  restoredFromVersionId?: string
}

export interface ResidenceProfile {
  id: string
  principalId: string
  revision: number
  createdAt: string
  updatedAt: string
  currentVersion: ResidenceVersion
  deletedAt?: string
}

export type TrueSolarTimeRuleVersion =
  | 'true-solar-v2-zone-meridian-equation-of-time'
  | 'true-solar-v3-standard-time-equation-of-time'

export type TimeCorrectionRuleVersion = TrueSolarTimeRuleVersion | 'civil-time-v1-no-solar-correction'

export interface BirthInput {
  date: string
  time: string
  locationName: string
  longitude: number
  /** Defaults to solar for legacy chart inputs. */
  calendarSystem?: 'solar' | 'lunar'
  /** A lunar leap month is represented explicitly instead of overloading the month number. */
  lunarLeapMonth?: boolean
  province?: string
  city?: string
  district?: string
  /** Administrative division code captured with the selected birthplace. */
  placeCode?: string
  /** Geography dataset version used to resolve coordinates and timezone. */
  geoDataVersion?: string
  latitude?: number
  /** IANA time-zone identifier. Defaults to Asia/Shanghai for legacy inputs. */
  timezone?: string
  /** Apply the historical civil-time DST offset before traditional time correction. */
  dstPolicy?: 'auto' | 'ignore'
  /** Whether the day pillar changes at civil midnight or at the beginning of Zi hour (23:00). */
  dayBoundary?: 'midnight' | 'zi-hour-start'
  /** Configurable start-of-luck algorithm exposed by lunar-typescript. */
  luckMethod?: 'sect1' | 'sect2'
  /** Defaults to true for legacy chart inputs. */
  useTrueSolarTime?: boolean
  /** Explicit algorithm selection; omitted legacy inputs replay with the v2 rule. */
  timeCorrectionRuleVersion?: TrueSolarTimeRuleVersion
  gender?: 'male' | 'female'
}

/**
 * A chart entered as four known Gan-Zhi pillars. It intentionally carries no
 * implied civil date, location, solar-time correction, or luck-cycle origin.
 */
export interface ManualFourPillarsInput {
  readonly inputMode: 'manual-four-pillars'
  readonly pillars: readonly [string, string, string, string]
  readonly gender?: 'male' | 'female'
}

/** Existing birth-data callers remain valid because their discriminator is optional. */
export type BirthDataCalculationInput = BirthInput & { readonly inputMode?: 'birth-data' }

/** Explicit input union for calculation entry points that support both workflows. */
export type BaziCalculationInput = BirthDataCalculationInput | ManualFourPillarsInput

export interface PendingSourceRequired {
  readonly status: 'unavailable'
  readonly reason: 'pending-source-required'
}

export interface BaziInputSnapshot {
  calendarSystem: 'solar' | 'lunar'
  sourceDate: string
  sourceTime: string
  normalizedSolarDate: string
  normalizedSolarTime: string
  locationName: string
  province?: string
  city?: string
  district?: string
  placeCode?: string
  geoDataVersion?: string
  longitude: number
  latitude?: number
  timezone: string
  utcOffsetMinutes: number
  standardUtcOffsetMinutes: number
  daylightSavingMinutes: number
  timeAmbiguous?: boolean
  dstPolicy: 'auto' | 'ignore'
  dayBoundary: 'midnight' | 'zi-hour-start'
  luckMethod: 'sect1' | 'sect2'
  useTrueSolarTime: boolean
  timeCorrectionRuleVersion: TimeCorrectionRuleVersion
  lunarLeapMonth?: boolean
  normalizedLunarDate: string
  normalizedLunarLeapMonth: boolean
}

/** Runtime data source used by Intl timezone resolution; optional only on legacy charts. */
export interface BaziTimeRuntimeProvenance {
  provider: 'node-intl'
  nodeVersion?: string
  icuVersion?: string
  tzdbVersion?: string
  unicodeVersion?: string
  cldrVersion?: string
}

export interface BaziTimeProfile {
  timezone: string
  utcOffsetMinutes: number
  standardUtcOffsetMinutes: number
  daylightSavingMinutes: number
  standardMeridian: number
  trueSolarCorrectionMinutes: number
  timeCorrectionRuleVersion: TimeCorrectionRuleVersion
  dayBoundary: 'midnight' | 'zi-hour-start'
  dstPolicy: 'auto' | 'ignore'
  luckMethod: 'sect1' | 'sect2'
  runtimeProvenance?: BaziTimeRuntimeProvenance
}

/** Lifecycle of the editable rule-profile record, not of an immutable published version. */
export type BaziRuleProfileState = 'draft' | 'in-review' | 'published' | 'archived'

/** Defaults supplied by a school profile when a new calculation request omits an override. */
export interface BaziRuleTimeDefaults {
  readonly timezone: string
  readonly dstPolicy: 'auto' | 'ignore'
  readonly useTrueSolarTime: boolean
  /** Optional only for legacy rule profiles; normalization writes v2 explicitly. */
  readonly timeCorrectionRuleVersion?: TrueSolarTimeRuleVersion
  readonly dayBoundary: 'midnight' | 'zi-hour-start'
  readonly luckMethod: 'sect1' | 'sect2'
}

export type BaziAssessmentName = 'strength' | 'pattern' | 'elementPreference' | 'shenSha'

export type BaziAssessmentFactPath =
  | 'dayMaster.stem'
  | 'dayMaster.element'
  | 'dayMaster.yinYang'
  | `pillars.${'year' | 'month' | 'day' | 'hour'}.${'stem' | 'branch'}`
  | `tenGods.${'year' | 'month' | 'day' | 'hour'}`
  | `fiveElements.counts.${'wood' | 'fire' | 'earth' | 'metal' | 'water'}`
  | 'balance.supportScore'
  | 'balance.oppositionScore'
  | 'balance.netScore'
  | 'balance.rootCount'
  | 'balance.resourceCount'
  | 'balance.monthCommandSupports'
  | 'monthCommand.branch'
  | 'monthCommand.mainQiStem'
  | 'monthCommand.mainQiElement'
  | 'monthCommand.mainQiTenGod'
  | 'monthCommand.mainQiVisibleAt'
  | 'monthCommand.supportsDayMasterBaseline'
  | 'supportDimensions.monthCommandSupports'
  | 'supportDimensions.rootedAt'
  | 'supportDimensions.visiblePeerAt'
  | 'supportDimensions.visibleResourceAt'
  | `hiddenStems.${'year' | 'month' | 'day' | 'hour'}`
  | 'pillarDetails.shenSha.names'
  | 'relations.kinds'

export type BaziAssessmentOperator = 'equals' | 'in' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists'

export interface BaziAssessmentCondition {
  readonly fact: BaziAssessmentFactPath
  readonly operator: BaziAssessmentOperator
  readonly value?: string | number | boolean | readonly string[]
}

export interface BaziAssessmentRuleOutput {
  readonly code: string
  readonly label: string
  readonly targets?: readonly ('year' | 'month' | 'day' | 'hour')[]
  /** Machine-readable support/balance candidates; never a complete useful-god verdict. */
  readonly elementDirection?: ElementBalanceDirection
}

export interface ElementBalanceDirection {
  readonly scope: 'support-balance-baseline'
  readonly direction: 'add-support' | 'reduce-support' | 'balanced-undetermined'
  readonly candidateElements: readonly FiveElement[]
  readonly cautiousElements: readonly FiveElement[]
  readonly limitations: readonly string[]
}

/** A data-only rule. It cannot execute scripts or read arbitrary object paths. */
export interface BaziAssessmentRule {
  readonly id: string
  readonly priority: number
  readonly all: readonly BaziAssessmentCondition[]
  readonly output: BaziAssessmentRuleOutput
  /** Immutable expert-knowledge versions that justify this rule. */
  readonly sourceVersionIds: readonly string[]
}

/** Selects one deterministic implementation and its independently versioned rule set. */
export interface BaziAssessmentMethodConfig {
  readonly enabled: boolean
  readonly method: string
  readonly ruleSetVersion: string
  /** Present only on schemaVersion 2 decision-table profiles. */
  readonly rules?: readonly BaziAssessmentRule[]
}

export interface BaziRuleAssessmentMethods {
  readonly strength: BaziAssessmentMethodConfig
  readonly pattern: BaziAssessmentMethodConfig
  /** Optional on historical profiles created before preference analysis existed. */
  readonly elementPreference?: BaziAssessmentMethodConfig
  readonly shenSha: BaziAssessmentMethodConfig
}

/** Complete executable content that is hashed when a profile is published. */
export interface BaziRuleProfileDefinition {
  /** Omitted on legacy profiles; new executable profiles use schemaVersion 2. */
  readonly schemaVersion?: 2
  readonly timeDefaults: BaziRuleTimeDefaults
  readonly assessments: BaziRuleAssessmentMethods
}

/**
 * Mutable authoring record for one school/profile. Editing replaces its working definition;
 * it never mutates a previously published version.
 */
export interface BaziRuleProfile {
  id: string
  key: string
  name: string
  description?: string
  state: BaziRuleProfileState
  revision: number
  workingDefinition: BaziRuleProfileDefinition
  currentPublishedVersionId?: string
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
  submittedForReviewAt?: string
  submittedForReviewBy?: string
  reviewedAt?: string
  reviewedBy?: string
  archivedAt?: string
  archivedBy?: string
}

/** Immutable executable snapshot created by a successful profile publication. */
export interface PublishedBaziRuleProfileVersion {
  readonly profileId: string
  readonly versionId: string
  readonly version: number
  readonly key: string
  readonly name: string
  readonly description?: string
  readonly definition: BaziRuleProfileDefinition
  readonly contentHash: string
  readonly submittedForReviewAt: string
  readonly submittedForReviewBy: string
  readonly reviewedAt: string
  readonly reviewedBy: string
  readonly publishedAt: string
  readonly publishedBy: string
}

/** Immutable provenance copied onto each chart version at calculation time. */
export interface BaziRuleProfileVersionReference {
  readonly profileId: string
  readonly versionId: string
  readonly version: number
  readonly key: string
  readonly name: string
  readonly contentHash: string
}

export interface CalendarConversion {
  solarDate: string
  lunarDate: string
  lunarLeapMonth: boolean
  lunarYear: number
  lunarMonth: number
  lunarDay: number
  ruleVersion: string
}

interface ReportSubmissionBase {
  visionConsent: true
  /** Requested published rule version; persisted as report provenance when present. */
  ruleProfileVersionId?: string
  chartProfileId?: string
  chartVersionId?: string
  residenceProfileId?: string
  residenceVersionId?: string
  residence: { facing: Direction; layoutNote?: string }
  /** Optional structured whole-home geometry used for deterministic nine-grid floor-plan facts. */
  floorPlan?: NineGridInput
  photos: readonly ResidencePhotoInput[]
}

/**
 * New report submissions always persist the actual calculation input. `birth`
 * remains a compatibility projection for birth-data submissions and is
 * forbidden for manual four-pillar submissions.
 */
export type ReportSubmission = ReportSubmissionBase & (
  | {
      calculationInput: BirthDataCalculationInput
      birth?: BirthInput
    }
  | {
      calculationInput: ManualFourPillarsInput
      birth?: never
    }
)

export interface BaziChart {
  ruleVersion: string
  calendarRuleVersion?: string
  timeCorrectionRuleVersion?: string
  /** Exact normalized input used for this calculation; absent only on legacy persisted charts. */
  inputSnapshot?: BaziInputSnapshot
  /** Present on charts calculated after luck-cycle support; optional for legacy snapshots. */
  luckRuleVersion?: string
  timeProfile?: BaziTimeProfile
  correctedLocalTime: string
  correctionMinutes: number
  pillars: readonly [string, string, string, string]
  /** Structured, deterministic fields used by the report pipeline. */
  dayMaster?: DayMaster
  fiveElements?: FiveElementSummary
  /** Transparent baseline facts for governed strength/preference rules; not a school conclusion by itself. */
  balance?: BaziBalanceFacts
  /** Objective month-command facts used by governed school rules; not a pattern verdict. */
  monthCommand?: BaziMonthCommandFacts
  /** Auditable locations behind the traditional 得令/得地/得助 vocabulary. */
  supportDimensions?: BaziSupportDimensionFacts
  tenGods?: readonly string[]
  hiddenStems?: readonly (readonly string[])[]
  relations?: readonly BaziRelation[]
  luckCycles?: readonly LuckCycle[]
  luckPendingReason?: 'gender-required'
  /** Legacy persisted natal charts may contain query-state cycles; new calculations keep them in BaziFlowChart only. */
  annualCycles?: readonly AnnualCycle[]
  monthlyCycles?: readonly MonthlyCycle[]
  dailyCycles?: readonly DailyCycle[]
  hourlyCycles?: readonly HourlyCycle[]
  assessments?: ProfessionalAssessments
  /** Optional professional fields derived directly from the calendar library. */
  professional?: ProfessionalChartFields
  /** Per-pillar presentation rows matching the traditional chart table. */
  pillarDetails?: readonly PillarDetail[]
}

/**
 * Deterministic result for manual four-pillar input. Source-dependent outputs
 * are represented explicitly rather than populated with synthetic dates.
 */
export interface ManualFourPillarsChart {
  readonly inputMode: 'manual-four-pillars'
  readonly ruleVersion: string
  readonly inputSnapshot: ManualFourPillarsInput
  readonly pillars: readonly [string, string, string, string]
  readonly dayMaster: DayMaster
  readonly fiveElements: FiveElementSummary
  readonly balance?: BaziBalanceFacts
  readonly monthCommand?: BaziMonthCommandFacts
  readonly supportDimensions?: BaziSupportDimensionFacts
  readonly tenGods: readonly [string, string, string, string]
  readonly hiddenStems: readonly [readonly string[], readonly string[], readonly string[], readonly string[]]
  readonly relations: readonly BaziRelation[]
  readonly professional: ProfessionalChartFields
  readonly pillarDetails: readonly [PillarDetail, PillarDetail, PillarDetail, PillarDetail]
  readonly assessments: ProfessionalAssessments
  readonly birthDateTime: PendingSourceRequired
  readonly correctedLocalTime: PendingSourceRequired
  readonly correctionMinutes: PendingSourceRequired
  readonly solarTermBoundary: PendingSourceRequired
  readonly luckStartDate: PendingSourceRequired
  readonly luckStartAge: PendingSourceRequired
  readonly luckCycles: PendingSourceRequired
  readonly annualCycles: PendingSourceRequired
  readonly monthlyCycles: PendingSourceRequired
  readonly dailyCycles: PendingSourceRequired
  readonly hourlyCycles: PendingSourceRequired
}

export type BaziCalculationResult = BaziChart | ManualFourPillarsChart

export interface ProfessionalChartFields {
  naYin: readonly string[]
  voidBranches: readonly string[]
  twelveGrowthStages: readonly string[]
  method: 'lunar-typescript-eight-char-v1'
  ruleVersion: string
}

export interface PillarDetail {
  pillar: string
  heavenlyStem: string
  earthlyBranch: string
  stemTenGod: string
  hiddenStems: readonly HiddenStemDetail[]
  naYin: string
  voidBranches: string
  twelveGrowthStage: string
  selfSitting: string
  shenSha: ShenShaAssessment
}

export interface HiddenStemDetail {
  stem: string
  tenGod: string
}

export interface ShenShaAssessment {
  status: 'derived' | 'pending-school-rule'
  ruleVersion: string
  names?: readonly string[]
}

export type FiveElement = 'wood' | 'fire' | 'earth' | 'metal' | 'water'

export interface DayMaster {
  stem: string
  element: FiveElement
  yinYang: 'yin' | 'yang'
}

export interface FiveElementSummary {
  /** Counts are a transparent baseline (visible stems + branch elements). */
  counts: Readonly<Record<FiveElement, number>>
  method: 'visible-stems-and-branches-v1'
}

export interface BaziBalanceFacts {
  readonly method: 'seasonal-support-baseline-v1'
  readonly supportScore: number
  readonly oppositionScore: number
  readonly netScore: number
  readonly rootCount: number
  readonly resourceCount: number
  readonly monthCommandSupports: boolean
  readonly contributions: readonly {
    source: string
    element: FiveElement
    weight: number
    side: 'support' | 'opposition'
  }[]
}

export interface BaziMonthCommandFacts {
  readonly method: 'month-command-facts-v1'
  readonly branch: string
  readonly mainQiStem: string
  readonly mainQiElement: FiveElement
  readonly mainQiTenGod: string
  /** Visible pillar stems equal to the month branch's main qi. */
  readonly mainQiVisibleAt: readonly ('year' | 'month' | 'day' | 'hour')[]
  /** Factual support relation under the transparent support-balance baseline. */
  readonly supportsDayMasterBaseline: boolean
}

export type BaziPillarPosition = 'year' | 'month' | 'day' | 'hour'

export interface BaziSupportDimensionFacts {
  readonly method: 'support-dimensions-facts-v1'
  readonly monthCommandSupports: boolean
  /** Branch positions whose hidden stems contain the day master's own element. */
  readonly rootedAt: readonly BaziPillarPosition[]
  /** Visible stems, excluding the day stem itself, of the day master's own element. */
  readonly visiblePeerAt: readonly Exclude<BaziPillarPosition, 'day'>[]
  /** Visible stems, excluding the day stem itself, that generate the day master. */
  readonly visibleResourceAt: readonly Exclude<BaziPillarPosition, 'day'>[]
}

export interface BaziRelation {
  kind: 'combination' | 'clash' | 'punishment' | 'harm' | 'break'
  members: readonly [number, number]
  detail: string
}

export interface LuckCycle {
  index: number
  pillar: string
  startAge?: number
  endAge?: number
  startDate?: string
  endDate?: string
  direction?: 'forward' | 'backward'
  status: 'derived' | 'pending-gender' | 'pending-school-rule'
}

export interface AnnualCycle {
  year: number
  pillar: string
  /** Twelve solar-term month pillars when the selected luck profile supports them. */
  months?: readonly MonthlyCycle[]
  status: 'derived' | 'pending-school-rule' | 'pending-gender'
}

export interface MonthlyCycle {
  year: number
  month: number
  /** The month name follows the library's solar-term month convention. */
  monthName: string
  /** Inclusive start of this solar-term month in corrected-local wall-clock minute precision, formatted YYYY-MM-DDTHH:mm:00. */
  startAt: string
  /** Exclusive end of this solar-term month in corrected-local wall-clock minute precision, formatted YYYY-MM-DDTHH:mm:00. */
  endAt: string
  startTerm: string
  endTerm: string
  pillar?: string
  status: 'derived' | 'pending-gender' | 'pending-school-rule'
}

/** Reserved explicitly so the UI can distinguish unsupported finer granularity. */
export interface DailyCycle {
  date: string
  pillar?: string
  status: 'derived' | 'pending-school-rule'
}

export interface HourlyCycle {
  dateTime: string
  pillar?: string
  /** Start of the traditional two-hour slot, expressed as civil clock hour 0-23. */
  startHour?: number
  earthlyBranch?: string
  status: 'derived' | 'pending-school-rule'
}

/** Explicit target for a flow-chart query; it is separate from immutable birth data. */
export interface CycleQuery {
  /** Civil date in the birth chart's configured timezone, formatted YYYY-MM-DD. */
  targetDate: string
  /** Civil time formatted HH:mm. Defaults to 12:00 when omitted. */
  targetTime?: string
}

/**
 * Deterministic dynamic cycles for one birth chart and target moment. This response is
 * query state, not a new immutable birth-chart version.
 */
export interface BaziFlowChart {
  ruleVersion: string
  target: {
    date: string
    time: string
    timezone: string
    dayBoundary: 'midnight' | 'zi-hour-start'
    boundaryTimeBasis: 'corrected-local-solar-term-wall-v2'
  }
  selection: {
    luckCycleIndex?: number
    year: number
    monthYear: number
    month: number
    date: string
    hourSlotStart: number
  }
  /** Deterministic target-moment chart summary for displaying LiuNian/LiuYue/LiuRi/LiuShi context. */
  targetChart: Pick<BaziChart, 'correctedLocalTime' | 'correctionMinutes' | 'pillars' | 'dayMaster' | 'fiveElements' | 'tenGods' | 'pillarDetails' | 'relations'>
  luckCycles: readonly LuckCycle[]
  annualCycles: readonly AnnualCycle[]
  monthlyCycles: readonly MonthlyCycle[]
  dailyCycles: readonly DailyCycle[]
  hourlyCycles: readonly HourlyCycle[]
}

export type ProfessionalAssessmentStatus = 'derived' | 'pending-school-rule' | 'unresolved'
export type ProfessionalAssessmentReason = 'legacy-profile' | 'disabled' | 'no-match' | 'conflict'

export interface ProfessionalAssessmentProvenance {
  profileVersionId: string
  profileContentHash: string
  assessment: BaziAssessmentName
  method: 'decision-table-v1'
  ruleSetVersion: string
  matchedRuleIds: readonly string[]
  sourceVersionIds: readonly string[]
  factsHash: string
}

export interface ProfessionalAssessmentResult {
  status: ProfessionalAssessmentStatus
  ruleVersion: string
  reason?: ProfessionalAssessmentReason
  conclusion?: string
  items?: readonly string[]
  elementDirection?: ElementBalanceDirection
  provenance?: ProfessionalAssessmentProvenance
}

export interface ProfessionalAssessments {
  strength: ProfessionalAssessmentResult
  pattern: ProfessionalAssessmentResult
  /** Optional only when reading an immutable historical chart. */
  elementPreference?: ProfessionalAssessmentResult
  shenSha: ProfessionalAssessmentResult
}

export interface PrincipalRecord {
  id: string
  kind: 'anonymous'
  tokenHash: string
  createdAt: string
}

export type UserAccountStatus = 'active' | 'disabled'

export interface UserAccount {
  id: string
  username: string
  displayName: string
  status: UserAccountStatus
  /** Bound on first login, allowing an existing anonymous workspace to be claimed safely. */
  principalId?: string
  /** Last successful C-end login. Admin-only operational metadata. */
  lastLoginAt?: string
  createdAt: string
  updatedAt: string
}

export interface UserSession {
  id: string
  userId: string
  tokenHash: string
  expiresAt: string
  createdAt: string
}

interface ChartVersionBase {
  id: string
  profileId: string
  version: number
  /** Absent only for legacy charts calculated before governed rule profiles existed. */
  ruleProfileVersion?: BaziRuleProfileVersionReference
  /** Present when this immutable version was created by restoring an earlier version snapshot. */
  restoredFromVersionId?: string
  createdAt: string
}

/**
 * Immutable chart output with its exact input. The union preserves input/result
 * correlation and makes it impossible to attach a fabricated birth record to a
 * manual four-pillar version.
 */
export type ChartVersion = ChartVersionBase & (
  | {
      calculationInput: BirthDataCalculationInput
      /** Compatibility projection for existing birth-chart consumers. */
      birth?: BirthInput
      bazi: BaziChart
    }
  | {
      calculationInput: ManualFourPillarsInput
      birth?: never
      bazi: ManualFourPillarsChart
    }
)

/** Raw legacy JSON shape accepted only at deserialization boundaries. */
export type LegacyChartVersion = ChartVersionBase & {
  calculationInput?: never
  birth: BirthInput
  bazi: BaziChart
}

/** Storage readers normalize this union into `ChartVersion` before returning it. */
export type StoredChartVersion = ChartVersion | LegacyChartVersion

export type ChartProfileRelationship = 'self' | 'partner' | 'parent' | 'child' | 'other'

export interface ChartProfileMetadata {
  label: string
  relationship: ChartProfileRelationship
}

export interface ChartProfile {
  id: string
  principalId: string
  /** User-facing identity for selecting among the owner's personal and family charts. */
  label: string
  relationship: ChartProfileRelationship
  revision: number
  createdAt: string
  updatedAt: string
  currentVersion: ChartVersion
  deletedAt?: string
}

export interface BaziComparisonMismatch {
  path: string
  category: 'pillar' | 'time-correction' | 'calendar' | 'professional-field' | 'luck-cycle' | 'fine-cycle' | 'assessment' | 'display' | 'unexplained'
  expected: unknown
  actual: unknown
}

export interface BaziComparisonReport {
  sampleId: string
  source: string
  matched: boolean
  comparedPaths: readonly string[]
  mismatches: readonly BaziComparisonMismatch[]
}

export interface VisionObservation {
  fileId: string
  room: ResidencePhotoInput['room']
  summary: string
  observedElements: readonly string[]
  uncertainties: readonly string[]
  schemaVersion?: 'vision-observation-v2'
  modelVersion?: string
  promptVersion?: 'residence-facts-v2'
  facts?: readonly VisionFact[]
}

export type VisionFactCode =
  | 'daylight.visible'
  | 'window.visible'
  | 'balcony.visible'
  | 'kitchen.south'
  | 'bathroom.near-center'
  | 'circulation.entry-balcony-aligned'

export interface VisionFact {
  code: VisionFactCode
  confidence: number
  evidence: string
  scope: 'visible-detail' | 'floor-plan-topology'
  source: 'vision-model' | 'program-nine-grid'
}

export interface ReportCitation {
  id: string
  version: number
  versionId: string
  contentHash: string
  title: string
  sourceLabel: string
  excerpt: string
}

export interface EvaluatedRuleConclusion {
  code: string
  text: string
  level: 'info' | 'attention'
  effect?: 'supportive' | 'conflict' | 'neutral' | 'needs-confirmation'
  severity?: 'low' | 'medium' | 'high'
}

export interface EvaluatedRule {
  assetId: string
  version: number
  versionId: string
  contentHash: string
  title: string
  priority: number
  conclusions: readonly EvaluatedRuleConclusion[]
  sourceVersionIds?: readonly string[]
  sourceLabels?: readonly string[]
  sourceExcerpts?: readonly string[]
  conflictGroup?: string
}

export type PersonHouseCompatibilityLevel = 'supportive' | 'conflict' | 'mixed' | 'neutral' | 'insufficient-evidence'

export interface CompatibilityAction {
  /** Preserve and amplify a supportive condition, or reduce a conflicting condition. */
  kind: 'amplify' | 'mitigate'
  location: string
  action: string
  intendedEffect: string
  verification: string
  safety: 'reversible-low-risk'
}

export interface PersonHouseCompatibilityPoint {
  conclusion: string
  ruleTitle: string
  ruleVersion: number
  ruleVersionId: string
  level: EvaluatedRuleConclusion['level']
  effect?: NonNullable<EvaluatedRuleConclusion['effect']>
  severity?: NonNullable<EvaluatedRuleConclusion['severity']>
  /** Present when a professional reasoning Agent produced the point. */
  chartEvidence?: string
  residenceEvidence?: string
  sourceLabel?: string
  origin?: 'deterministic-rule' | 'professional-agent'
  /** Optional for backward compatibility; newly generated professional points always include actions. */
  actions?: readonly CompatibilityAction[]
}

export interface PersonHouseCompatibilityAssessment {
  assessable: boolean
  overallLevel: PersonHouseCompatibilityLevel
  confidence: 'high' | 'medium' | 'low'
  positiveMatches: readonly PersonHouseCompatibilityPoint[]
  conflicts: readonly PersonHouseCompatibilityPoint[]
  neutralOrUnknown: readonly string[]
  criticalMissingFacts: readonly string[]
}

export interface ReportGenerationArtifactProvenance {
  readonly id: string
  readonly version: string
  readonly sha256: string
}

export interface ReportGenerationSkillProvenance {
  readonly name: string
  readonly version: string
  readonly sha256: string
}

/**
 * Local, model-independent evidence for replaying one Harness generation.
 * It intentionally contains no prompt body, file path, credential or URL
 * component other than a sanitized host label.
 */
export interface ReportGenerationProvenance {
  readonly schemaVersion: 'report-generation-provenance-v1'
  readonly provider: string
  readonly model: string
  readonly baseUrlLabel: string
  readonly harnessProfile: string
  readonly patchSha256: string
  readonly plugin: ReportGenerationArtifactProvenance
  readonly skill: ReportGenerationSkillProvenance
  readonly promptSchemaVersion: string
  readonly promptSha256: string
  readonly validatorVersion: string
  readonly validatorResult: 'pass' | 'fail' | 'not-run'
  readonly validationWarnings?: readonly string[]
  readonly generatedAt: string
  readonly inputSha256: string
  readonly reportSha256?: string
}

/** Persisted server-side progress for a report whose terminal status is still queued. */
export type ReportPhase =
  | 'queued'
  | 'vision-analyzing'
  | 'rules-evaluating'
  | 'professional-reasoning'
  | 'harness-generating'
  | 'quality-reviewing'
  | 'harness-revising'
  | 'completed'
  | 'failed'

export interface ReportStageTiming {
  readonly phase: Exclude<ReportPhase, 'queued' | 'completed' | 'failed'>
  readonly startedAt: string
  readonly completedAt?: string
  readonly durationMs?: number
  readonly outcome?: 'completed' | 'failed'
}

export type ReportQualityIssueSeverity = 'high' | 'medium' | 'low'

export interface ReportQualityIssue {
  readonly code: string
  readonly severity: ReportQualityIssueSeverity
  readonly section?: string
  readonly message: string
}

/** Structured result produced by the independent report-review Agent. */
export interface ReportQualityReview {
  readonly schemaVersion: 'report-quality-review-v1'
  readonly verdict: 'pass' | 'revise' | 'manual-review'
  readonly score: number
  readonly issues: readonly ReportQualityIssue[]
  readonly reviewedAt: string
  readonly attempt: number
}

/** Private draft retained for operational review; never expose through public report APIs. */
export interface ReportReviewDraft {
  readonly report: string
  readonly generationProvenance?: ReportGenerationProvenance
  readonly createdAt: string
  readonly revisionAttempt: number
}

export interface ReportPipelineCheckpoint {
  readonly schemaVersion: 'report-pipeline-checkpoint-v1'
  readonly citations?: { readonly completedAt: string }
  readonly vision?: { readonly completedAt: string }
  readonly rules?: { readonly completedAt: string }
  readonly professionalReasoning?: {
    readonly completedAt: string
    readonly outcome: 'enhanced' | 'deterministic-fallback' | 'not-required'
  }
  readonly harnessDraft?: {
    readonly completedAt: string
    readonly revisionAttempt: number
  }
  readonly qualityWorkflow?: {
    readonly completedAt: string
    readonly event: 'review-completed' | 'revision-drafted'
    readonly draftHash: string
    readonly reviewHashes: readonly string[]
    readonly revisionCount: number
  }
}

export interface ReportRecord {
  id: string
  /** Soft archive marker. Archived reports remain owner-readable but cannot be shared or processed. */
  archivedAt?: string
  /** Direct lineage parent when this report was regenerated from immutable saved evidence. */
  sourceReportId?: string
  /**
   * Anonymous principal that owns this report. Optional only so legacy JSON can
   * still be deserialized; records without an owner must never be exposed.
   */
  principalId?: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  /** Report delivery and editorial enhancement are independent lifecycles. */
  qualityStatus?: 'pending' | 'running' | 'passed' | 'failed'
  qualityError?: string
  runLease?: {
    readonly workerId: string
    readonly leasedAt: string
    readonly expiresAt: string
    readonly attempt: number
  }
  /** Private bearer-token hash for a time-limited report share link. Never expose through public APIs. */
  shareAccess?: {
    readonly tokenHash: string
    readonly createdAt: string
    readonly expiresAt: string
  }
  /** Missing only on reports created before phase tracking was introduced. */
  phase?: ReportPhase
  /** Append-only stage timings for diagnosing slow model and vision calls. */
  stageTimings?: readonly ReportStageTiming[]
  /** Durable business checkpoints used to resume without repeating completed model stages. */
  pipelineCheckpoint?: ReportPipelineCheckpoint
  createdAt: string
  completedAt?: string
  submission: ReportSubmission
  bazi: BaziCalculationResult
  chartProfileId?: string
  chartVersionId?: string
  residenceProfileId?: string
  residenceVersionId?: string
  vision?: readonly VisionObservation[]
  floorPlanAnalysis?: NineGridResult
  citations?: readonly ReportCitation[]
  evaluatedRules?: readonly EvaluatedRule[]
  compatibility?: PersonHouseCompatibilityAssessment
  /** Missing on reports created before generation provenance v1. */
  generationProvenance?: ReportGenerationProvenance
  /** Immutable review trail; attempt 0 reviews the first generated report. */
  qualityReviews?: readonly ReportQualityReview[]
  /** Number of model-authored revisions applied after the initial draft. */
  revisionCount?: number
  /** Latest validator-approved draft, retained privately for failure diagnosis and audit. */
  reviewDraft?: ReportReviewDraft
  report?: string
  error?: string
}

export * from './floorplan-fixtures.js'
export * from './nine-grid.js'
