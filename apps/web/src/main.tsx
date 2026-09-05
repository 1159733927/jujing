import { FormEvent, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { BaziFlowChart, ReportPhase } from '@fengshui/domain'
import { downloadChartPdf, exportChartAsPng, type ChartExportSnapshot } from './chart-export'
import { downloadReportPdf } from './report-export'
import { ReportMarkdown } from './report-markdown'
import { buildReportGenerationSummary, type ReportGenerationProvenance } from './report-provenance'
import {
  canSubmitReport,
  fetchReportReadiness,
  reportReadinessLoading,
  reportReadinessSubmitError,
  type ReportReadinessState,
} from './report-readiness'
import {
  isLunarDateValid,
  lunarMonthDays,
  lunarMonthOptions,
  normalizeLunarYearProfile,
  type LunarMonthOption,
  type LunarYearProfile,
} from './lunar-year-profile'
import './styles.css'

export const CURRENT_REPORT_VALIDATOR_VERSION = 'generated-report-validator-v18-consumer-action-gate'

type Direction = 'north' | 'east' | 'south' | 'west' | 'unknown'
type Room = 'overview' | 'living-room' | 'bedroom' | 'kitchen' | 'bathroom' | 'entrance' | 'other'
type ReportStatus = 'idle' | 'uploading' | ReportPhase | 'cancelled'
type PhotoDraft = { id: string; file: File; name: string; preview: string; room: Room; facing: Direction; note: string; sizeLabel: string }
type StableVersion = { version: number; versionId: string; contentHash: string }
type VisionObservation = { room: string; summary: string; observedElements?: string[]; uncertainties?: string[] }
type BaziRelation = { kind: 'combination' | 'clash' | 'punishment' | 'harm' | 'break'; detail: string }
type TrueSolarTimeRuleVersion = 'true-solar-v2-zone-meridian-equation-of-time' | 'true-solar-v3-standard-time-equation-of-time'
type PillarDetail = {
  hiddenStems?: { stem: string; tenGod: string }[]
  naYin?: string
  voidBranches?: string
  twelveGrowthStage?: string
  selfSitting?: string
  shenSha?: { status?: 'derived' | 'pending-school-rule'; ruleVersion?: string; names?: string[] }
}
type BirthInput = {
  date: string
  time: string
  locationName: string
  longitude: number
  latitude?: number
  timezone?: string
  calendarSystem?: 'solar' | 'lunar'
  lunarLeapMonth?: boolean
  province?: string
  city?: string
  district?: string
  placeCode?: string
  geoDataVersion?: string
  useTrueSolarTime?: boolean
  timeCorrectionRuleVersion?: TrueSolarTimeRuleVersion
  dstPolicy?: 'auto' | 'ignore'
  dayBoundary?: 'midnight' | 'zi-hour-start'
  luckMethod?: 'sect1' | 'sect2'
  gender?: 'male' | 'female'
}
export type ManualFourPillarsInput = {
  inputMode: 'manual-four-pillars'
  pillars: readonly [string, string, string, string]
  gender?: 'male' | 'female'
}
type BirthCalculationInput = BirthInput & { inputMode?: 'birth-data' }
type ChartCalculationInput = BirthCalculationInput | ManualFourPillarsInput
type PendingSourceRequired = { status: 'unavailable'; reason: 'pending-source-required' }
type BirthplaceCoordinateEvidence = {
  sourceLabel?: string
  license?: string
  confidence?: 'verified' | 'derived-centroid' | 'manual-demo' | 'unavailable' | string
  note?: string
}
type BirthplaceDistrict = { code: string; name: string; longitude?: number; latitude?: number; coordinate?: BirthplaceCoordinateEvidence }
type BirthplaceCity = { code: string; name: string; timezone: string; districts: readonly BirthplaceDistrict[] }
type BirthplaceProvince = { code: string; name: string; cities: readonly BirthplaceCity[] }
type BaziRuleTimeDefaults = {
  timezone: string
  dstPolicy: 'auto' | 'ignore'
  useTrueSolarTime: boolean
  timeCorrectionRuleVersion?: TrueSolarTimeRuleVersion
  dayBoundary: 'midnight' | 'zi-hour-start'
  luckMethod: 'sect1' | 'sect2'
}
type BaziRuleProfileDefinition = {
  timeDefaults: BaziRuleTimeDefaults
  assessments: Record<string, unknown>
}
type BaziRuleProfileVersionReference = {
  profileId: string
  versionId: string
  version: number
  key: string
  name: string
  contentHash: string
}
type PublishedBaziRuleProfileVersion = BaziRuleProfileVersionReference & {
  description?: string
  definition: BaziRuleProfileDefinition
  publishedAt: string
}
type BaziChart = {
  pillars: string[]
  correctedLocalTime: string
  correctionMinutes: number
  ruleVersion?: string
  timeCorrectionRuleVersion?: string
  dayMaster?: { stem?: string; element?: string; yinYang?: string } | string
  fiveElements?: { counts?: Partial<Record<'wood' | 'fire' | 'earth' | 'metal' | 'water', number>>; method?: string } | Partial<Record<'木' | '火' | '土' | '金' | '水', number>>
  balance?: BaziBalanceFacts
  monthCommand?: BaziMonthCommandFacts
  supportDimensions?: BaziSupportDimensionFacts
  tenGods?: string[]
  hiddenStems?: string[][]
  relations?: (string | BaziRelation)[]
  nayin?: string[]
  voidBranches?: string[]
  growthStages?: string[]
  luckCycles?: { index?: number; label?: string; pillar?: string; startAge?: number; startDate?: string; endDate?: string; direction?: 'forward' | 'backward'; status?: 'derived' | 'pending-gender' | 'pending-school-rule' }[]
  annualCycles?: { year?: number; pillar?: string; label?: string; status?: 'derived' | 'pending-gender' | 'pending-school-rule' }[]
  monthlyCycles?: { year?: number; month?: number; monthName?: string; pillar?: string; label?: string; status?: string; startAt?: string; endAt?: string; startTerm?: string; endTerm?: string }[]
  dailyCycles?: { date?: string; pillar?: string; label?: string; status?: string }[]
  hourlyCycles?: { dateTime?: string; date?: string; hour?: string; startHour?: number; earthlyBranch?: string; pillar?: string; label?: string; status?: string }[]
  timeProfile?: {
    timezone: string
    utcOffsetMinutes: number
    standardUtcOffsetMinutes: number
    daylightSavingMinutes: number
    standardMeridian: number
    trueSolarCorrectionMinutes: number
    timeCorrectionRuleVersion?: string
    dayBoundary: 'midnight' | 'zi-hour-start'
    dstPolicy: 'auto' | 'ignore'
    luckMethod: 'sect1' | 'sect2'
    runtimeProvenance?: {
      provider: 'node-intl'
      nodeVersion?: string
      icuVersion?: string
      tzdbVersion?: string
      unicodeVersion?: string
      cldrVersion?: string
    }
  }
  pillarDetails?: PillarDetail[]
  professional?: {
    naYin?: string[]
    voidBranches?: string[]
    twelveGrowthStages?: string[]
    ruleVersion?: string
  }
  assessments?: {
    strength?: ProfessionalAssessment
    pattern?: ProfessionalAssessment
    elementPreference?: ProfessionalAssessment
    shenSha?: ProfessionalAssessment
  }
}
type BaziBalanceFacts = {
  method: 'seasonal-support-baseline-v1'
  supportScore: number
  oppositionScore: number
  netScore: number
  rootCount: number
  resourceCount: number
  monthCommandSupports: boolean
  contributions?: { source: string; element: string; weight: number; side: 'support' | 'opposition' }[]
}
type BaziMonthCommandFacts = {
  method: 'month-command-facts-v1'
  branch: string
  mainQiStem: string
  mainQiElement: 'wood' | 'fire' | 'earth' | 'metal' | 'water'
  mainQiTenGod: string
  mainQiVisibleAt: ('year' | 'month' | 'day' | 'hour')[]
  supportsDayMasterBaseline: boolean
}
type BaziSupportDimensionFacts = {
  method: 'support-dimensions-facts-v1'
  monthCommandSupports: boolean
  rootedAt: ('year' | 'month' | 'day' | 'hour')[]
  visiblePeerAt: ('year' | 'month' | 'hour')[]
  visibleResourceAt: ('year' | 'month' | 'hour')[]
}
type ManualFourPillarsChart = Omit<BaziChart, 'correctedLocalTime' | 'correctionMinutes' | 'luckCycles' | 'annualCycles' | 'monthlyCycles' | 'dailyCycles' | 'hourlyCycles'> & {
  inputMode: 'manual-four-pillars'
  inputSnapshot: ManualFourPillarsInput
  correctedLocalTime: PendingSourceRequired
  correctionMinutes: PendingSourceRequired
  solarTermBoundary: PendingSourceRequired
  luckStartDate: PendingSourceRequired
  luckStartAge: PendingSourceRequired
  luckCycles: PendingSourceRequired
  annualCycles: PendingSourceRequired
  monthlyCycles: PendingSourceRequired
  dailyCycles: PendingSourceRequired
  hourlyCycles: PendingSourceRequired
}
type ChartCalculationResult = BaziChart | ManualFourPillarsChart
type ProfessionalAssessment = {
  conclusion?: string
  items?: string[]
  status?: 'derived' | 'pending-review' | 'pending-school-rule' | 'unresolved'
  reason?: 'legacy-profile' | 'disabled' | 'no-match' | 'conflict'
  ruleVersion?: string
  elementDirection?: {
    scope: 'support-balance-baseline'
    direction: 'add-support' | 'reduce-support' | 'balanced-undetermined'
    candidateElements: ('wood' | 'fire' | 'earth' | 'metal' | 'water')[]
    cautiousElements: ('wood' | 'fire' | 'earth' | 'metal' | 'water')[]
    limitations: string[]
  }
  provenance?: { matchedRuleIds?: string[]; sourceVersionIds?: string[]; factsHash?: string }
}
type ChartDetailTab = 'compatibility' | 'natal' | 'professional' | 'cycles' | 'params' | 'settings'
type PublicBaziRuntime = Pick<NonNullable<NonNullable<BaziChart['timeProfile']>['runtimeProvenance']>, 'provider' | 'tzdbVersion' | 'icuVersion'>

export function TimezoneDataVersion({ provenance, currentProvenance }: {
  provenance?: NonNullable<BaziChart['timeProfile']>['runtimeProvenance']
  currentProvenance?: PublicBaziRuntime | null
}) {
  if (!provenance) return <>旧版本未记录</>
  const parts = [
    provenance.tzdbVersion ? `时区数据 ${provenance.tzdbVersion}` : '',
    provenance.icuVersion ? `ICU ${provenance.icuVersion}` : '',
  ].filter(Boolean)
  const savedVersion = parts.length > 0 ? parts.join(' · ') : '版本未记录'
  if (currentProvenance === undefined) return <>{savedVersion} · 正在核对当前环境</>
  const comparableKeys = ['tzdbVersion', 'icuVersion'] as const
  const savedKeys = comparableKeys.filter((key) => provenance[key])
  if (
    currentProvenance === null
    || savedKeys.length === 0
    || savedKeys.some((key) => !currentProvenance[key])
  ) {
    return <>{savedVersion} · 当前环境版本暂不可核对</>
  }
  const mismatch = savedKeys.some((key) => provenance[key] !== currentProvenance[key])
  return <>{savedVersion} · {mismatch ? '与当前排盘环境不同，建议重新排盘生成新版本' : '与当前排盘环境一致'}</>
}

export const chartPageTabs: { key: ChartDetailTab; label: string }[] = [
  { key: 'compatibility', label: '合盘' },
  { key: 'natal', label: '生辰' },
  { key: 'cycles', label: '流盘' },
]
export const chartUtilityTabs: { key: ChartDetailTab; label: string }[] = [
  { key: 'professional', label: '专业详情' },
  { key: 'params', label: '参数' },
  { key: 'settings', label: '设置' },
]
export const professionalPillarMatrixRowLabels = ['干神', '天干', '地支', '藏干', '支神', '纳音', '空亡', '地势', '自坐', '神煞'] as const
type ChartVersion = {
  id: string
  profileId: string
  version: number
  calculationInput?: ChartCalculationInput
  /** Kept for backward compatibility with birth-data versions created before the input union. */
  birth?: BirthInput
  bazi: ChartCalculationResult
  ruleProfileVersion?: BaziRuleProfileVersionReference
  createdAt: string
}
type ChartProfile = { id: string; revision: number; createdAt: string; updatedAt: string; deletedAt?: string; currentVersion: ChartVersion }
type ChartRelationship = 'self' | 'partner' | 'parent' | 'child' | 'other'
type MemberChartProfile = ChartProfile & { label?: string; relationship?: ChartRelationship }
type AuthUser = { id: string; username: string; displayName: string; status: 'active' | 'disabled' }
type AuthSession = { authenticated: true; user: AuthUser }
type ResidenceSnapshot = {
  schemaVersion?: 'residence-snapshot-v1'
  label: string
  facing: Direction
  layoutNote?: string
}
type ResidenceVersion = {
  id: string
  profileId: string
  version: number
  snapshot: ResidenceSnapshot
  createdAt: string
  restoredFromVersionId?: string
}
type ResidenceProfile = {
  id: string
  principalId?: string
  revision: number
  createdAt: string
  updatedAt: string
  deletedAt?: string
  currentVersion: ResidenceVersion
}
type ChartSnapshot = {
  profileId?: string
  revision?: number
  versionId?: string
  version?: number
  calculationInput: ChartCalculationInput
  birth?: BirthInput
  bazi: ChartCalculationResult
  ruleProfileVersion?: BaziRuleProfileVersionReference
  savedAt: string
}
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}
type Report = {
  id: string
  status: 'queued' | 'completed' | 'failed'
  archivedAt?: string
  phase?: ReportPhase
  createdAt?: string
  report?: string
  error?: string
  submission?: { calculationInput: ChartCalculationInput; birth?: BirthInput }
  chartProfileId?: string
  chartVersionId?: string
  residenceProfileId?: string
  residenceVersionId?: string
  bazi: ChartCalculationResult
  vision?: VisionObservation[]
  citations?: ({ title: string; sourceLabel: string; excerpt?: string } & StableVersion)[]
  evaluatedRules?: ({ title: string; priority: number; conclusions: { code?: string; level?: string; text: string }[] } & StableVersion)[]
  generationProvenance?: ReportGenerationProvenance & { validatorVersion?: string }
}
type ReportSummary = {
  id: string
  status: 'queued' | 'completed' | 'failed'
  phase?: ReportPhase
  createdAt: string
  chartProfileId?: string
  chartVersionId?: string
  residenceProfileId?: string
  residenceVersionId?: string
  residenceFacing?: Direction
  photoCount: number
  hasReport: boolean
  reportPreview?: string
  error?: string
}
type WenzhenDiffResponse = {
  generatedAt: string
  totals: { all: number; reportable: number; pending: number; matched: number; accepted: number; mismatched: number }
  coverage: WenzhenAssertionCoverage
  pendingSamples: { sampleId?: string; notes?: string }[]
  reports: { sampleId: string; fixtureStatus: string; matched: boolean; outcome: string; differences: { path: string; category: string }[] }[]
}
type WenzhenAssertionCoverageCategory = 'pillars' | 'time-correction' | 'professional-table' | 'luck-cycles' | 'dynamic-cycles'
type WenzhenAssertionCoverage = Record<WenzhenAssertionCoverageCategory, number>
export const wenzhenAssertionCoverageLabels: Record<WenzhenAssertionCoverageCategory, string> = {
  pillars: '四柱',
  'time-correction': '时间校正',
  'professional-table': '专业表',
  'luck-cycles': '大运',
  'dynamic-cycles': '流盘',
}
export function formatWenzhenAssertionCoverage(coverage: Partial<WenzhenAssertionCoverage> = {}) {
  return Object.entries(wenzhenAssertionCoverageLabels).map(([category, label]) => ({
    category: category as WenzhenAssertionCoverageCategory,
    label,
    count: coverage[category as WenzhenAssertionCoverageCategory] ?? 0,
  }))
}
type BirthplaceResolved = {
  province: BirthplaceProvince
  city: BirthplaceCity
  district: BirthplaceDistrict
  selectable?: boolean
}
type BirthplaceSearchResponse = {
  total: number
  limit: number
  offset: number
  items: BirthplaceResolved[]
  dataset?: BirthplaceDatasetMetadata
  selectableDistrictCount?: number
  unavailableDistrictCount?: number
}
type BirthplaceTreeResponse = {
  tree: BirthplaceProvince[]
  dataset: BirthplaceDatasetMetadata
}
type BirthplaceDatasetSource = { label: string; url?: string; license: string; notes: string }
type BirthplaceDatasetMetadata = {
  id: string
  version: string
  label: string
  coverage: 'demo-sample' | 'administrative-only' | 'licensed-partial' | 'production'
  source: BirthplaceDatasetSource
  generatedAt: string
  coordinateSystem: 'WGS84'
  timezonePolicy: 'city-default-iana'
  sources?: BirthplaceDatasetSource[]
  statistics?: {
    administrativeDistrictCount: number
    licensedCoordinateCount: number
    manualFallbackCoordinateCount: number
    selectableDistrictCount: number
    unavailableDistrictCount: number
  }
}

const MAX_PHOTOS = 12
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const CHART_STORAGE_KEY = 'fengshui:chart:v1'
const DELETED_CHART_STORAGE_KEY = 'fengshui:chart:deleted:v1'
const BIRTH_STORAGE_KEY = 'fengshui:birth:v1'
const MANUAL_PILLARS_STORAGE_KEY = 'fengshui:manual-four-pillars:v1'
const CHART_INPUT_MODE_STORAGE_KEY = 'fengshui:chart-input-mode:v1'
const RULE_PROFILE_STORAGE_KEY = 'fengshui:bazi-rule-profile-version:v1'
const LOCAL_OWNER_STORAGE_KEY = 'fengshui:local-owner:v1'
const ACCOUNT_SCOPED_STORAGE_KEYS = [CHART_STORAGE_KEY, DELETED_CHART_STORAGE_KEY, BIRTH_STORAGE_KEY, MANUAL_PILLARS_STORAGE_KEY, CHART_INPUT_MODE_STORAGE_KEY, RULE_PROFILE_STORAGE_KEY]
const DEFAULT_BIRTHPLACE = { province: '浙江省', city: '杭州市', district: '西湖区' } as const
const DEFAULT_GEO_DATA_VERSION = 'province-city-china@8.5.8+geonames-cn@2026-08-31.64057955b60e'
const DEFAULT_TRUE_SOLAR_TIME_RULE_VERSION: TrueSolarTimeRuleVersion = 'true-solar-v2-zone-meridian-equation-of-time'
const TRUE_SOLAR_TIME_RULE_VERSION_LABELS: Record<TrueSolarTimeRuleVersion, string> = {
  'true-solar-v2-zone-meridian-equation-of-time': '兼容算法 v2（默认）',
  'true-solar-v3-standard-time-equation-of-time': '精细算法 v3（试验）',
}
const TRUE_SOLAR_TIME_RULE_VERSION_OPTIONS = Object.entries(TRUE_SOLAR_TIME_RULE_VERSION_LABELS) as [TrueSolarTimeRuleVersion, string][]
export const defaultBirth: BirthInput = {
  date: '1992-08-18', time: '09:30', locationName: '浙江省 杭州市 西湖区', longitude: 120.13333,
  latitude: 30.26667, timezone: 'Asia/Shanghai', calendarSystem: 'solar', useTrueSolarTime: true,
  timeCorrectionRuleVersion: DEFAULT_TRUE_SOLAR_TIME_RULE_VERSION,
  province: '浙江省', city: '杭州市', district: '西湖区', placeCode: '330106', geoDataVersion: DEFAULT_GEO_DATA_VERSION,
  dstPolicy: 'auto', dayBoundary: 'midnight', luckMethod: 'sect1',
}

const HEAVENLY_STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const
const EARTHLY_BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const
export const SEXAGENARY_CYCLE = Array.from({ length: 60 }, (_, index) => `${HEAVENLY_STEMS[index % 10]}${EARTHLY_BRANCHES[index % 12]}`)
export const defaultManualFourPillarsInput: ManualFourPillarsInput = {
  inputMode: 'manual-four-pillars',
  pillars: ['甲子', '丙寅', '戊辰', '庚午'],
}

export function isManualFourPillarsInput(value: unknown): value is ManualFourPillarsInput {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<ManualFourPillarsInput>
  return input.inputMode === 'manual-four-pillars'
    && Array.isArray(input.pillars)
    && input.pillars.length === 4
    && input.pillars.every((pillar) => typeof pillar === 'string' && SEXAGENARY_CYCLE.includes(pillar))
    && (input.gender === undefined || input.gender === 'male' || input.gender === 'female')
}

export function normalizeManualFourPillarsInput(value: unknown): ManualFourPillarsInput {
  if (!isManualFourPillarsInput(value)) return defaultManualFourPillarsInput
  return {
    inputMode: 'manual-four-pillars',
    pillars: [...value.pillars] as [string, string, string, string],
    ...(value.gender ? { gender: value.gender } : {}),
  }
}

export function calculationInputFromVersion(version: { calculationInput?: unknown; birth?: unknown }): ChartCalculationInput {
  if (isManualFourPillarsInput(version.calculationInput)) return normalizeManualFourPillarsInput(version.calculationInput)
  if (version.calculationInput && typeof version.calculationInput === 'object') {
    const inputMode = (version.calculationInput as { inputMode?: unknown }).inputMode
    if (inputMode === 'manual-four-pillars') throw new Error('版本数据合同错误：calculationInput 中的手动四柱无效。')
    if (inputMode !== undefined && inputMode !== 'birth-data') throw new Error('版本数据合同错误：calculationInput 的输入模式未知。')
    return version.calculationInput as BirthCalculationInput
  }
  if (version.birth && typeof version.birth === 'object') {
    if ((version.birth as { inputMode?: unknown }).inputMode === 'manual-four-pillars') {
      throw new Error('版本数据合同错误：手动四柱只能存放在 calculationInput，不能使用旧 birth 字段。')
    }
    return version.birth as BirthInput
  }
  throw new Error('命盘版本缺少可恢复的输入快照。')
}

export function canCalculateChartInput(input: ChartCalculationInput): boolean {
  return isManualFourPillarsInput(input) || hasCompleteBirthplaceEvidence(input)
}

function isManualFourPillarsChart(value: ChartCalculationResult): value is ManualFourPillarsChart {
  return 'inputMode' in value && value.inputMode === 'manual-four-pillars'
}

function isBirthDataBaziChart(value: ChartCalculationResult): value is BaziChart {
  return typeof value.correctedLocalTime === 'string' && typeof value.correctionMinutes === 'number'
}

export function selectFlowCycleDisplaySources(bazi?: ChartCalculationResult | null, flow?: BaziFlowChart | null) {
  const birthChart = bazi && !isManualFourPillarsChart(bazi) ? bazi : undefined
  return {
    luckCycles: flow?.luckCycles ?? birthChart?.luckCycles,
    annualCycles: flow?.annualCycles,
    monthlyCycles: flow?.monthlyCycles,
    dailyCycles: flow?.dailyCycles,
    hourlyCycles: flow?.hourlyCycles,
  }
}

export type FlowTimelineCard = {
  label: '大运' | '流年' | '流月' | '流日' | '流时'
  pillar: string
  detail: string
  state: 'active' | 'pending'
}

const flowTimelineCardLabels: FlowTimelineCard['label'][] = ['大运', '流年', '流月', '流日', '流时']

function flowPendingCards(reason = '计算流盘后显示当前命中'): FlowTimelineCard[] {
  return flowTimelineCardLabels.map((label) => ({ label, pillar: '待计算', detail: reason, state: 'pending' }))
}

function flowCycleStatusLabel(status?: string) {
  if (status === 'derived') return '已计算'
  if (status === 'pending-gender') return '需补性别'
  if (status === 'pending-school-rule') return '待流派规则'
  return '待计算'
}

function flowCard(patch: Omit<FlowTimelineCard, 'state'> & { pending?: boolean }): FlowTimelineCard {
  return {
    label: patch.label,
    pillar: patch.pillar || '待计算',
    detail: patch.detail || '待计算',
    state: patch.pending || !patch.pillar ? 'pending' : 'active',
  }
}

export function buildFlowTimelineCards(flow?: BaziFlowChart | null): FlowTimelineCard[] {
  if (!flow) return flowPendingCards()
  const selectedLuck = flow.luckCycles.find((cycle) => cycle.index === flow.selection.luckCycleIndex)
    ?? flow.luckCycles.find((_, index) => index + 1 === flow.selection.luckCycleIndex)
  const selectedAnnual = flow.annualCycles.find((cycle) => cycle.year === flow.selection.year)
  const selectedMonthly = flow.monthlyCycles.find((cycle) => cycle.year === flow.selection.monthYear && cycle.month === flow.selection.month)
    ?? flow.monthlyCycles.find((cycle) => cycle.month === flow.selection.month)
  const selectedDaily = flow.dailyCycles.find((cycle) => cycle.date === flow.selection.date)
  const selectedHourly = flow.hourlyCycles.find((cycle) => cycle.startHour === flow.selection.hourSlotStart)
  const hourlyTime = selectedHourly?.dateTime?.split(' ')[1]?.slice(0, 5)

  return [
    flowCard({
      label: '大运',
      pillar: selectedLuck?.pillar ?? '',
      detail: selectedLuck
        ? `${selectedLuck.startAge ?? '待'}岁起 · ${selectedLuck.startDate ?? '起始待算'} — ${selectedLuck.endDate ?? '结束待算'} · ${flowCycleStatusLabel(selectedLuck.status)}`
        : '目标时间未落入已计算大运',
      pending: !selectedLuck,
    }),
    flowCard({
      label: '流年',
      pillar: selectedAnnual?.pillar ?? '',
      detail: selectedAnnual ? `${selectedAnnual.year}年 · ${flowCycleStatusLabel(selectedAnnual.status)}` : `${flow.selection.year}年待计算`,
      pending: !selectedAnnual,
    }),
    flowCard({
      label: '流月',
      pillar: selectedMonthly?.pillar ?? '',
      detail: selectedMonthly
        ? `${selectedMonthly.year}年${selectedMonthly.monthName ?? selectedMonthly.month}月 · ${selectedMonthly.startTerm ?? '节气待算'}`
        : `${flow.selection.monthYear}年${flow.selection.month}月待计算`,
      pending: !selectedMonthly?.pillar,
    }),
    flowCard({
      label: '流日',
      pillar: selectedDaily?.pillar ?? '',
      detail: selectedDaily ? `${selectedDaily.date} · ${flowCycleStatusLabel(selectedDaily.status)}` : `${flow.selection.date}待计算`,
      pending: !selectedDaily?.pillar,
    }),
    flowCard({
      label: '流时',
      pillar: selectedHourly?.pillar ?? '',
      detail: selectedHourly
        ? `${hourlyTime ?? `${flow.selection.hourSlotStart}:00`} · ${selectedHourly.earthlyBranch ? `${selectedHourly.earthlyBranch}时 · ` : ''}${flowCycleStatusLabel(selectedHourly.status)}`
        : `${flow.selection.hourSlotStart}:00 时段待计算`,
      pending: !selectedHourly?.pillar,
    }),
  ]
}

function demoDistrict(code: string, name: string, longitude: number, latitude: number): BirthplaceDistrict {
  return { code, name, longitude, latitude }
}

const BIRTHPLACE_TREE: readonly BirthplaceProvince[] = [
  { code: '110000', name: '北京市', cities: [{ code: '110100', name: '北京市', timezone: 'Asia/Shanghai', districts: [
    demoDistrict('110101', '东城区', 116.4164, 39.9286),
    demoDistrict('110105', '朝阳区', 116.4436, 39.9219),
    demoDistrict('110108', '海淀区', 116.2981, 39.9593),
  ] }] },
  { code: '310000', name: '上海市', cities: [{ code: '310100', name: '上海市', timezone: 'Asia/Shanghai', districts: [
    demoDistrict('310101', '黄浦区', 121.4842, 31.2317),
    demoDistrict('310104', '徐汇区', 121.4368, 31.1883),
    demoDistrict('310115', '浦东新区', 121.5447, 31.2215),
  ] }] },
  { code: '330000', name: '浙江省', cities: [
    { code: '330100', name: '杭州市', timezone: 'Asia/Shanghai', districts: [
      demoDistrict('330102', '上城区', 120.1973, 30.2265),
      demoDistrict('330106', '西湖区', 120.1302, 30.2595),
      demoDistrict('330108', '滨江区', 120.2119, 30.2084),
    ] },
    { code: '330200', name: '宁波市', timezone: 'Asia/Shanghai', districts: [
      demoDistrict('330203', '海曙区', 121.5508, 29.8598),
      demoDistrict('330212', '鄞州区', 121.5466, 29.8173),
    ] },
  ] },
  { code: '320000', name: '江苏省', cities: [
    { code: '320100', name: '南京市', timezone: 'Asia/Shanghai', districts: [
      demoDistrict('320102', '玄武区', 118.7977, 32.0486),
      demoDistrict('320106', '鼓楼区', 118.7698, 32.0664),
    ] },
    { code: '320500', name: '苏州市', timezone: 'Asia/Shanghai', districts: [
      demoDistrict('320508', '姑苏区', 120.6174, 31.3356),
      demoDistrict('320506', '吴中区', 120.6323, 31.2623),
    ] },
  ] },
  { code: '440000', name: '广东省', cities: [
    { code: '440100', name: '广州市', timezone: 'Asia/Shanghai', districts: [
      demoDistrict('440104', '越秀区', 113.2668, 23.1289),
      demoDistrict('440106', '天河区', 113.3612, 23.1247),
    ] },
    { code: '440300', name: '深圳市', timezone: 'Asia/Shanghai', districts: [
      demoDistrict('440304', '福田区', 114.0556, 22.5219),
      demoDistrict('440305', '南山区', 113.9305, 22.5333),
    ] },
  ] },
  { code: '510000', name: '四川省', cities: [{ code: '510100', name: '成都市', timezone: 'Asia/Shanghai', districts: [
    demoDistrict('510104', '锦江区', 104.1173, 30.5987),
    demoDistrict('510107', '武侯区', 104.0434, 30.6418),
  ] }] },
  { code: '420000', name: '湖北省', cities: [{ code: '420100', name: '武汉市', timezone: 'Asia/Shanghai', districts: [
    demoDistrict('420106', '武昌区', 114.3167, 30.554),
    demoDistrict('420103', '江汉区', 114.2708, 30.6015),
  ] }] },
  { code: '610000', name: '陕西省', cities: [{ code: '610100', name: '西安市', timezone: 'Asia/Shanghai', districts: [
    demoDistrict('610103', '碑林区', 108.9343, 34.2304),
    demoDistrict('610113', '雁塔区', 108.9486, 34.2225),
  ] }] },
  { code: '650000', name: '新疆维吾尔自治区', cities: [
    { code: '650100', name: '乌鲁木齐市', timezone: 'Asia/Shanghai', districts: [
      demoDistrict('650102', '天山区', 87.6317, 43.7944),
      demoDistrict('650103', '沙依巴克区', 87.5982, 43.8009),
    ] },
    { code: '653000', name: '克孜勒苏柯尔克孜自治州', timezone: 'Asia/Shanghai', districts: [
      demoDistrict('653024', '乌恰县', 75.2597, 39.7191),
      demoDistrict('653001', '阿图什市', 76.1684, 39.7162),
    ] },
  ] },
]

function birthInputFromPlace(province: BirthplaceProvince, city: BirthplaceCity, district: BirthplaceDistrict, geoDataVersion = 'web-demo-fallback-2026.08') {
  return {
    province: province.name,
    city: city.name,
    district: district.name,
    placeCode: district.code,
    geoDataVersion,
    locationName: `${province.name} ${city.name} ${district.name}`,
    longitude: district.longitude,
    latitude: district.latitude,
    timezone: city.timezone,
  }
}

function flattenBirthplaceTree(tree: readonly BirthplaceProvince[]): BirthplaceResolved[] {
  return tree.flatMap((province) => province.cities.flatMap((city) => city.districts.map((district) => ({ province, city, district }))))
}

export function resolveBirthplaceFromTree(tree: readonly BirthplaceProvince[], birth: Pick<BirthInput, 'placeCode' | 'locationName' | 'province' | 'city' | 'district'>): BirthplaceResolved {
  const usableTree = tree.length ? tree : BIRTHPLACE_TREE
  const places = flattenBirthplaceTree(usableTree)
  const normalized = birth.locationName || `${DEFAULT_BIRTHPLACE.province} ${DEFAULT_BIRTHPLACE.city} ${DEFAULT_BIRTHPLACE.district}`
  const byCode = birth.placeCode ? places.find((place) => place.district.code === birth.placeCode) : undefined
  if (byCode) return byCode
  const byNames = birth.province && birth.city && birth.district
    ? places.find((place) => place.province.name === birth.province && place.city.name === birth.city && place.district.name === birth.district)
    : undefined
  if (byNames) return byNames
  return places.find((place) => normalized.includes(place.province.name) && normalized.includes(place.city.name) && normalized.includes(place.district.name))
    ?? places[0]
    ?? { province: BIRTHPLACE_TREE[2], city: BIRTHPLACE_TREE[2].cities[0], district: BIRTHPLACE_TREE[2].cities[0].districts[1] }
}

export function normalizeBirthplaceDatasetMetadata(payload: unknown): BirthplaceDatasetMetadata {
  if (!payload || typeof payload !== 'object') throw new Error('出生地点数据版本信息不正确。')
  const value = payload as Partial<BirthplaceDatasetMetadata>
  const source = value.source as Partial<BirthplaceDatasetSource> | undefined
  if (!value.id || !value.version || !value.label || !value.coverage || !source?.label || !source.license || !source.notes) {
    throw new Error('出生地点数据版本信息不完整。')
  }
  if (!['demo-sample', 'administrative-only', 'licensed-partial', 'production'].includes(value.coverage)) {
    throw new Error('出生地点数据覆盖状态无法识别。')
  }
  return value as BirthplaceDatasetMetadata
}

export function buildBirthplaceSearchUrl({ query = '', limit = 8, offset = 0 }: { query?: string; limit?: number; offset?: number }) {
  const params = new URLSearchParams()
  const trimmed = query.trim()
  if (trimmed) params.set('q', trimmed)
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  return `/api/v1/birthplaces/administrative?${params.toString()}`
}

export function buildBirthplaceTreeUrl() {
  return '/api/v1/birthplaces/tree'
}

export function normalizeBirthplaceTreeResponse(payload: unknown): BirthplaceTreeResponse {
  if (!payload || typeof payload !== 'object') throw new Error('出生地点树接口返回格式不正确。')
  const value = payload as Partial<BirthplaceTreeResponse>
  if (!Array.isArray(value.tree)) throw new Error('出生地点树接口缺少省市区列表。')
  const tree = value.tree
    .filter((province) => province?.name && province?.code && Array.isArray(province.cities))
    .map((province) => ({
      ...province,
      cities: province.cities
        .filter((city) => city?.name && city?.code && Array.isArray(city.districts))
        .map((city) => ({
          ...city,
          districts: city.districts.filter((district) => district?.name && district?.code && hasUsableCoordinatePair(district.longitude, district.latitude)),
        }))
        .filter((city) => city.districts.length > 0),
    }))
    .filter((province) => province.cities.length > 0)
  return {
    tree,
    dataset: normalizeBirthplaceDatasetMetadata(value.dataset),
  }
}

export function normalizeBirthplaceSearchResponse(payload: unknown): BirthplaceSearchResponse {
  if (!payload || typeof payload !== 'object') throw new Error('出生地点接口返回格式不正确。')
  const value = payload as Partial<BirthplaceSearchResponse>
  if (!Array.isArray(value.items)) throw new Error('出生地点接口缺少地点列表。')
  return {
    total: Number.isFinite(value.total) ? Number(value.total) : value.items.length,
    limit: Number.isFinite(value.limit) ? Number(value.limit) : value.items.length,
    offset: Number.isFinite(value.offset) ? Number(value.offset) : 0,
    items: value.items.filter((item) => item?.province?.name && item?.city?.name && item?.district?.name),
    dataset: value.dataset ? normalizeBirthplaceDatasetMetadata(value.dataset) : undefined,
    selectableDistrictCount: Number.isFinite(value.selectableDistrictCount) ? Number(value.selectableDistrictCount) : undefined,
    unavailableDistrictCount: Number.isFinite(value.unavailableDistrictCount) ? Number(value.unavailableDistrictCount) : undefined,
  }
}

export function normalizeActiveRuleProfileVersions(payload: unknown): PublishedBaziRuleProfileVersion[] {
  const versions = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { versions?: unknown }).versions)
      ? (payload as { versions: unknown[] }).versions
      : undefined
  if (!versions) throw new Error('排盘规则接口返回格式不正确。')
  const valid = versions.every((item): item is PublishedBaziRuleProfileVersion => {
    if (!item || typeof item !== 'object') return false
    const version = item as Partial<PublishedBaziRuleProfileVersion>
    const defaults = version.definition?.timeDefaults
    return Boolean(
      version.profileId
      && version.versionId
      && Number.isInteger(version.version)
      && version.key
      && version.name
      && version.contentHash
      && defaults
      && typeof defaults.timezone === 'string'
      && ['auto', 'ignore'].includes(defaults.dstPolicy)
      && typeof defaults.useTrueSolarTime === 'boolean'
      && (defaults.timeCorrectionRuleVersion === undefined || isTrueSolarTimeRuleVersion(defaults.timeCorrectionRuleVersion))
      && ['midnight', 'zi-hour-start'].includes(defaults.dayBoundary)
      && ['sect1', 'sect2'].includes(defaults.luckMethod),
    )
  })
  if (!valid) throw new Error('排盘规则接口包含无法使用的版本资料。')
  return versions
}

export function applyRuleTimeDefaults(birth: BirthInput, version: PublishedBaziRuleProfileVersion): BirthInput {
  const defaults = version.definition.timeDefaults
  return {
    ...birth,
    // The place resolver owns timezone provenance. A rule profile may only supply
    // a default when legacy input has no resolved location timezone.
    timezone: birth.timezone || defaults.timezone,
    dstPolicy: defaults.dstPolicy,
    useTrueSolarTime: defaults.useTrueSolarTime,
    ...(defaults.timeCorrectionRuleVersion || birth.timeCorrectionRuleVersion ? { timeCorrectionRuleVersion: defaults.timeCorrectionRuleVersion ?? birth.timeCorrectionRuleVersion } : {}),
    dayBoundary: defaults.dayBoundary,
    luckMethod: defaults.luckMethod,
  }
}

export function buildChartVersionRequest(
  calculationInput: ChartCalculationInput,
  ruleProfileVersionId: string,
  expectedRevision?: number,
) {
  return {
    ...calculationInput,
    ...(ruleProfileVersionId ? { ruleProfileVersionId } : {}),
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  }
}

export function buildBaziFlowRequest(
  chartVersionId: string,
  targetDate: string,
  targetTime: string,
) {
  return {
    chartVersionId,
    targetDate,
    targetTime,
  }
}

export function buildChartVersionRestoreRequest(expectedRevision: number) {
  return { expectedRevision }
}

export function canRestoreChartVersion(versionId: string, currentVersionId?: string): boolean {
  return Boolean(currentVersionId && versionId && versionId !== currentVersionId)
}

export function restoreChartVersionErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 409) return '命盘已在另一页面更新，请刷新后重试恢复历史版本。'
  return cause instanceof Error ? cause.message : '历史版本恢复失败。'
}

export function restoredChartAuditMessage(version: Pick<ChartVersion, 'version' | 'createdAt'>): string {
  return `已恢复历史 v${version.version} 为当前版本；来源版本创建于 ${new Date(version.createdAt).toLocaleString('zh-CN')}，服务端已记录恢复审计。`
}

export function mergeRestoredChartVersionHistory(versions: ChartVersion[] | null, restored: ChartVersion): ChartVersion[] | null {
  if (!versions) return versions
  const next = versions.filter((version) => version.id !== restored.id)
  return [restored, ...next].sort((left, right) => right.version - left.version)
}

export function buildReportChartBinding(
  selectedRuleProfileVersionId: string,
  chart: Pick<ChartSnapshot, 'profileId' | 'versionId' | 'ruleProfileVersion'> | null,
) {
  const selectedMatchesChart = (chart?.ruleProfileVersion?.versionId ?? '') === selectedRuleProfileVersionId
  return {
    ...(selectedRuleProfileVersionId ? { ruleProfileVersionId: selectedRuleProfileVersionId } : {}),
    ...(selectedMatchesChart && chart?.profileId && chart.versionId
      ? { chartProfileId: chart.profileId, chartVersionId: chart.versionId }
      : {}),
  }
}

type ReportResidenceInput = { facing: FormDataEntryValue | null; layoutNote: FormDataEntryValue | null }
type SelectedReportResidence = { profile: ResidenceProfile; snapshot: ResidenceSnapshot }
type UploadedReportPhoto = { fileId: string; room: Room; facing: Direction; note: string }

export function normalizeResidenceProfilesResponse(payload: unknown): ResidenceProfile[] {
  const profiles = payload && typeof payload === 'object' && Array.isArray((payload as { profiles?: unknown }).profiles)
    ? (payload as { profiles: unknown[] }).profiles
    : undefined
  if (!profiles) throw new Error('住宅档案接口返回格式不正确。')
  return profiles.filter((item): item is ResidenceProfile => {
    if (!item || typeof item !== 'object') return false
    const profile = item as Partial<ResidenceProfile>
    const version = profile.currentVersion
    const snapshot = version?.snapshot
    return Boolean(
      profile.id
      && Number.isInteger(profile.revision)
      && version?.id
      && version.profileId
      && Number.isInteger(version.version)
      && snapshot?.label
      && snapshot.facing
      && Object.prototype.hasOwnProperty.call(directionLabels, snapshot.facing),
    )
  })
}

export function residenceSnapshotFromForm(form: Pick<FormData, 'get'>): ResidenceSnapshot {
  const label = String(form.get('residenceLabel') ?? '').trim() || '本次住宅'
  const facingValue = form.get('residenceFacing')
  const facing = typeof facingValue === 'string' && Object.prototype.hasOwnProperty.call(directionLabels, facingValue)
    ? facingValue as Direction
    : 'unknown'
  const layoutNote = String(form.get('layoutNote') ?? '').trim()
  return {
    schemaVersion: 'residence-snapshot-v1',
    label,
    facing,
    ...(layoutNote ? { layoutNote } : {}),
  }
}

export function buildSelectedResidenceBinding(selected: SelectedReportResidence | null) {
  return selected ? {
    residenceProfileId: selected.profile.id,
    residenceVersionId: selected.profile.currentVersion.id,
  } : {}
}

export function buildReportSubmissionPayload({
  visionConsent,
  birth,
  chart,
  selectedRuleProfileVersionId,
  residence,
  selectedResidence,
  photos,
}: {
  visionConsent: boolean
  birth: BirthInput
  chart: Pick<ChartSnapshot, 'profileId' | 'versionId' | 'calculationInput' | 'birth' | 'ruleProfileVersion'> | null
  selectedRuleProfileVersionId: string
  residence: ReportResidenceInput
  selectedResidence?: SelectedReportResidence | null
  photos: readonly UploadedReportPhoto[]
}) {
  const residenceBinding = buildSelectedResidenceBinding(selectedResidence ?? null)
  const residenceLabel = selectedResidence?.snapshot.label ?? (
    typeof (residence as ResidenceSnapshot).label === 'string' && (residence as ResidenceSnapshot).label.trim()
      ? (residence as ResidenceSnapshot).label.trim()
      : undefined
  )
  const residencePayload = {
    ...(residenceLabel ? { residenceLabel } : {}),
    ...residenceBinding,
  }
  if (chart && isManualFourPillarsInput(chart.calculationInput)) {
    if (!chart.profileId || !chart.versionId) throw new Error('手动四柱命盘尚未保存，请先到“我的命盘”保存后再生成报告。')
    return {
      visionConsent,
      ...(chart.ruleProfileVersion?.versionId ? { ruleProfileVersionId: chart.ruleProfileVersion.versionId } : {}),
      chartProfileId: chart.profileId,
      chartVersionId: chart.versionId,
      residence,
      ...residencePayload,
      photos,
    }
  }
  if (chart?.profileId && chart.versionId) {
    return {
      visionConsent,
      ...(chart.ruleProfileVersion?.versionId ? { ruleProfileVersionId: chart.ruleProfileVersion.versionId } : {}),
      chartProfileId: chart.profileId,
      chartVersionId: chart.versionId,
      residence,
      ...residencePayload,
      photos,
    }
  }

  return {
    visionConsent,
    birth,
    ...(chart && chart.birth && JSON.stringify(chart.birth) === JSON.stringify(birth)
      ? buildReportChartBinding(selectedRuleProfileVersionId, chart)
      : buildReportChartBinding(selectedRuleProfileVersionId, null)),
    residence,
    ...residencePayload,
    photos,
  }
}

export function reportSubmissionInputError(chart: Pick<ChartSnapshot, 'profileId' | 'versionId' | 'calculationInput'> | null, birth: BirthInput): string {
  if (chart && isManualFourPillarsInput(chart.calculationInput)) {
    return chart.profileId && chart.versionId ? '' : '手动四柱命盘尚未保存，请先到“我的命盘”保存后再生成报告。'
  }
  if (!chart?.profileId || !chart.versionId) return '请先到“我的命盘”生成并保存命盘，再生成住宅报告。'
  return hasCompleteBirthplaceEvidence(birth) ? '' : '请先从服务端地点库选择带坐标证据的出生地点，再生成报告。'
}

export function chooseRuleProfileSelection(
  currentSelection: string,
  chart: Pick<ChartSnapshot, 'ruleProfileVersion'> | null,
  activeVersions: readonly PublishedBaziRuleProfileVersion[],
): string {
  const activeIds = new Set(activeVersions.map((version) => version.versionId))
  if (currentSelection && activeIds.has(currentSelection)) return currentSelection
  const boundVersionId = chart?.ruleProfileVersion?.versionId ?? ''
  if (boundVersionId && activeIds.has(boundVersionId)) return boundVersionId
  return activeVersions[0]?.versionId ?? ''
}

export function birthInputFromResolvedPlace(place: BirthplaceResolved, geoDataVersion: string) {
  if (!isPlaceSelectable(place)) throw new Error('该出生地点缺少经纬度证据，暂不可用于排盘。')
  if (!geoDataVersion.trim()) throw new Error('出生地点缺少数据版本，暂不可用于排盘。')
  return {
    province: place.province.name,
    city: place.city.name,
    district: place.district.name,
    placeCode: place.district.code,
    locationName: `${place.province.name} ${place.city.name} ${place.district.name}`,
    longitude: place.district.longitude!,
    latitude: place.district.latitude!,
    timezone: place.city.timezone,
    geoDataVersion,
  }
}

export function isPlaceSelectable(place: BirthplaceResolved) {
  return place.selectable !== false && hasUsableCoordinatePair(place.district.longitude, place.district.latitude)
}

export function isBirthplaceSelectionActive(birth: Pick<BirthInput, 'placeCode'>, place: BirthplaceResolved): boolean {
  return Boolean(birth.placeCode && birth.placeCode === place.district.code)
}

export function hasCompleteBirthplaceEvidence(birth: Pick<BirthInput, 'province' | 'city' | 'district' | 'placeCode' | 'longitude' | 'latitude' | 'timezone' | 'geoDataVersion'>): boolean {
  return Boolean(
    birth.province?.trim()
    && birth.city?.trim()
    && birth.district?.trim()
    && birth.placeCode?.trim()
    && birth.geoDataVersion?.trim()
    && birth.timezone?.trim()
    && hasUsableCoordinatePair(birth.longitude, birth.latitude),
  )
}

function hasUsableCoordinatePair(longitude: unknown, latitude: unknown): longitude is number {
  return Number.isFinite(longitude) && Number.isFinite(latitude) && !(longitude === 0 && latitude === 0)
}

function isTrueSolarTimeRuleVersion(value: unknown): value is TrueSolarTimeRuleVersion {
  return value === 'true-solar-v2-zone-meridian-equation-of-time' || value === 'true-solar-v3-standard-time-equation-of-time'
}

export function normalizeStoredBirthInput(payload: unknown, fallback: BirthInput = defaultBirth): BirthInput {
  if (!payload || typeof payload !== 'object') return fallback
  const value = payload as Partial<BirthInput>
  return {
    ...fallback,
    ...value,
    date: typeof value.date === 'string' ? value.date : fallback.date,
    time: typeof value.time === 'string' ? value.time : fallback.time,
    locationName: typeof value.locationName === 'string' ? value.locationName : '',
    longitude: Number.isFinite(value.longitude) ? Number(value.longitude) : Number.NaN,
    latitude: Number.isFinite(value.latitude) ? Number(value.latitude) : undefined,
    timezone: typeof value.timezone === 'string' ? value.timezone : undefined,
    province: typeof value.province === 'string' ? value.province : undefined,
    city: typeof value.city === 'string' ? value.city : undefined,
    district: typeof value.district === 'string' ? value.district : undefined,
    placeCode: typeof value.placeCode === 'string' ? value.placeCode : undefined,
    geoDataVersion: typeof value.geoDataVersion === 'string' ? value.geoDataVersion : undefined,
    useTrueSolarTime: typeof value.useTrueSolarTime === 'boolean' ? value.useTrueSolarTime : fallback.useTrueSolarTime,
    timeCorrectionRuleVersion: isTrueSolarTimeRuleVersion(value.timeCorrectionRuleVersion)
      ? value.timeCorrectionRuleVersion
      : fallback.timeCorrectionRuleVersion ?? DEFAULT_TRUE_SOLAR_TIME_RULE_VERSION,
  }
}

export function birthplaceFallbackMessage(reason: string): string {
  return `${reason}；当前仅显示少量本地演示地点，不代表全国覆盖。`
}

export function coordinateConfidenceLabel(confidence?: string): string {
  return ({
    verified: '已审核',
    'derived-centroid': '行政区中心点',
    'manual-demo': '演示坐标',
    unavailable: '坐标待补充',
  } as Record<string, string>)[confidence ?? ''] ?? (confidence || '坐标可用')
}

export function birthplaceDatasetAttribution(dataset?: BirthplaceDatasetMetadata): string {
  return dataset ? `${dataset.source.label} · ${dataset.source.license}` : '待读取服务端归因'
}

export function BirthplacePicker({ birth, setBirth }: { birth: BirthInput; setBirth: (birth: BirthInput) => void }) {
  const completeEvidence = hasCompleteBirthplaceEvidence(birth)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(birth.locationName)
  const [serverTree, setServerTree] = useState<BirthplaceProvince[]>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState('')
  const [apiPlaces, setApiPlaces] = useState<BirthplaceResolved[]>([])
  const [apiTotal, setApiTotal] = useState(0)
  const [apiDataset, setApiDataset] = useState<BirthplaceSearchResponse['dataset']>()
  const [apiLoading, setApiLoading] = useState(false)
  const [apiLoadingMore, setApiLoadingMore] = useState(false)
  const [apiError, setApiError] = useState('')
  const [usingFallback, setUsingFallback] = useState(false)
  const [selectedResolvedPlace, setSelectedResolvedPlace] = useState<BirthplaceResolved>()
  const pageSize = 8
  const pickerTree = serverTree.length ? serverTree : BIRTHPLACE_TREE
  const selected = resolveBirthplaceFromTree(pickerTree, birth)
  const applyPlace = (province: BirthplaceProvince, city: BirthplaceCity, district: BirthplaceDistrict, closeAfterSelect = false) => {
    if (!Number.isFinite(district.longitude) || !Number.isFinite(district.latitude)) return
    const geoDataVersion = serverTree.length ? apiDataset?.version ?? birth.geoDataVersion ?? DEFAULT_GEO_DATA_VERSION : 'web-demo-fallback-2026.08'
    setBirth({
      ...birth,
      ...birthInputFromPlace(province, city, { ...district, longitude: district.longitude!, latitude: district.latitude! }, geoDataVersion),
      longitude: district.longitude!,
      latitude: district.latitude!,
    })
    setSelectedResolvedPlace({ province, city, district, selectable: true })
    setUsingFallback(serverTree.length === 0)
    if (closeAfterSelect) setOpen(false)
  }
  const applyApiPlace = (place: BirthplaceResolved) => {
    if (!isPlaceSelectable(place)) {
      setApiError('该行政区已收录，但坐标证据待补充，暂不可排盘。')
      return
    }
    if (!apiDataset?.version) {
      setApiError('地点服务未返回数据版本，暂不能保存为可复算出生地点。')
      return
    }
    setBirth({
      ...birth,
      ...birthInputFromResolvedPlace(place, apiDataset.version),
    } as BirthInput)
    setSelectedResolvedPlace(place)
    setUsingFallback(false)
    setOpen(false)
  }
  const fetchApiPlaces = async ({ nextQuery, offset, append, signal }: { nextQuery: string; offset: number; append: boolean; signal?: AbortSignal }) => {
    const offline = typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine
    if (offline) throw new Error(birthplaceFallbackMessage('当前浏览器处于离线状态'))
    const response = await fetch(buildBirthplaceSearchUrl({ query: nextQuery, limit: pageSize, offset }), { signal })
    if (!response.ok) throw new Error(birthplaceFallbackMessage(`出生地点接口暂不可用（HTTP ${response.status}）`))
    const data = normalizeBirthplaceSearchResponse(await response.json())
    setApiPlaces((current) => append ? [...current, ...data.items] : data.items)
    setApiTotal(data.total)
    setApiDataset(data.dataset)
    setApiError('')
    setUsingFallback(false)
  }
  useEffect(() => {
    if (!open) return
    if (serverTree.length) return
    const controller = new AbortController()
    setTreeLoading(true)
    setTreeError('')
    void requestJson<BirthplaceTreeResponse>(buildBirthplaceTreeUrl(), {
      signal: controller.signal,
      timeoutMs: 15_000,
    }).then((result) => {
      if (controller.signal.aborted) return
      const normalized = normalizeBirthplaceTreeResponse(result)
      setServerTree(normalized.tree)
      setApiDataset(normalized.dataset)
      setUsingFallback(false)
    }).catch((error) => {
      if ((error as Error).name === 'AbortError') return
      setTreeError(error instanceof Error ? error.message : birthplaceFallbackMessage('出生地点树接口暂不可用'))
      setUsingFallback(true)
    }).finally(() => {
      if (!controller.signal.aborted) setTreeLoading(false)
    })
    return () => controller.abort()
  }, [open, serverTree.length])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const handle = window.setTimeout(() => {
      setApiLoading(true)
      fetchApiPlaces({ nextQuery: query, offset: 0, append: false, signal: controller.signal })
        .catch((error) => {
          if ((error as Error).name === 'AbortError') return
          setApiPlaces([])
          setApiTotal(0)
          setApiError(error instanceof Error ? error.message : birthplaceFallbackMessage('出生地点接口暂不可用'))
          setUsingFallback(true)
        })
        .finally(() => {
          if (!controller.signal.aborted) setApiLoading(false)
        })
    }, 250)
    return () => {
      window.clearTimeout(handle)
      controller.abort()
    }
  }, [open, query])
  useEffect(() => {
    const controller = new AbortController()
    void requestJson<{ dataset: BirthplaceDatasetMetadata }>('/api/v1/birthplaces/administrative/dataset', {
      signal: controller.signal,
      timeoutMs: 15_000,
    }).then((result) => {
      if (!controller.signal.aborted) setApiDataset(normalizeBirthplaceDatasetMetadata(result.dataset))
    }).catch(() => {
      // Search remains usable and will return the same metadata. Failure is shown
      // only when the user opens the picker and the primary search also fails.
    })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (!birth.placeCode) {
      setSelectedResolvedPlace(undefined)
      return
    }
    const controller = new AbortController()
    void requestJson<{ birthplace: BirthplaceResolved; dataset: BirthplaceDatasetMetadata }>(`/api/v1/birthplaces/administrative/${encodeURIComponent(birth.placeCode)}`, {
      signal: controller.signal,
      timeoutMs: 15_000,
    }).then((result) => {
      if (controller.signal.aborted) return
      setSelectedResolvedPlace(result.birthplace)
      setApiDataset(normalizeBirthplaceDatasetMetadata(result.dataset))
    }).catch(() => {
      // Legacy or demo-only saved places can still be replaced through the picker.
    })
    return () => controller.abort()
  }, [birth.placeCode])
  const loadMore = async () => {
    setApiLoadingMore(true)
    try {
      await fetchApiPlaces({ nextQuery: query, offset: apiPlaces.length, append: true })
    } catch (error) {
      setApiError(error instanceof Error ? error.message : '无法加载更多出生地点。')
      setUsingFallback(true)
    } finally {
      setApiLoadingMore(false)
    }
  }
  const hasMore = apiPlaces.length < apiTotal
  return <div className="birthplace-field wide">
    <label>出生地点</label>
    <button className="birthplace-trigger" type="button" onClick={() => {
      setQuery(birth.locationName)
      setOpen(true)
    }}>
      <span>{birth.locationName || '请选择省 / 市 / 区县'}</span>
      <small>点击选择 · 系统自动解析经纬度和时区</small>
    </button>
    <div className="location-summary" aria-live="polite">
      <span><small>时区</small><b>{birth.timezone ?? selected.city.timezone}</b></span>
      <span><small>地点编码</small><b>{birth.placeCode || '待选择'}</b></span>
      <span><small>坐标证据</small><b>{selectedResolvedPlace ? coordinateConfidenceLabel(selectedResolvedPlace.district.coordinate?.confidence) : (completeEvidence ? '已保存' : '待选择')}</b></span>
    </div>
    <details className="location-evidence">
      <summary>依据详情</summary>
      <dl>
        <div><dt>经纬度</dt><dd>{Number.isFinite(birth.latitude) && Number.isFinite(birth.longitude) ? `${birth.latitude!.toFixed(5)}°N · ${birth.longitude!.toFixed(5)}°E` : '待选择'}</dd></div>
        <div><dt>数据版本</dt><dd>{birth.geoDataVersion || apiDataset?.version || '待读取'}</dd></div>
        <div><dt>覆盖状态</dt><dd>{apiDataset?.coverage === 'licensed-partial' ? '授权坐标部分覆盖' : apiDataset?.coverage || '待读取'}</dd></div>
        <div><dt>来源与许可</dt><dd>{birthplaceDatasetAttribution(apiDataset)}</dd></div>
      </dl>
      {apiDataset?.sources?.map((source) => <p key={`${source.label}-${source.license}`}><b>{source.label}</b> · {source.license}{source.url ? <> · <a href={source.url} target="_blank" rel="noreferrer">来源</a></> : null}</p>)}
      {selectedResolvedPlace?.district.coordinate?.sourceLabel && <p>本地点坐标：{selectedResolvedPlace.district.coordinate.sourceLabel} · {selectedResolvedPlace.district.coordinate.license || '许可待读取'}</p>}
    </details>
    {!completeEvidence && <p className="inline-warning" role="status">当前地点缺少可复算证据，请点击选择省 / 市 / 区县后保存命盘。</p>}
    {open && <div className="picker-backdrop" role="dialog" aria-modal="true" aria-label="选择出生地点">
      <div className="location-picker">
        <div className="picker-head">
          <button type="button" className="today" onClick={() => setQuery('')}>清</button>
          <div>
            <p className="kicker">BIRTHPLACE</p>
            <h3>选择出生地点</h3>
          </div>
          <button type="button" className="close-picker" aria-label="关闭出生地点选择器" onClick={() => setOpen(false)}>×</button>
        </div>
        <section className="birthplace-search" aria-label="出生地点搜索">
          <div className="birthplace-search-head">
            <label>搜索省市区县<input aria-label="搜索出生地点" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入省市区县，例如 杭州、西湖、北京" autoFocus /></label>
            <span data-state={apiError ? 'fallback' : 'api'}>{apiError ? '演示回退' : '服务端行政地点库'}</span>
          </div>
          <div className="birthplace-api-state" aria-live="polite">
            {apiLoading ? '正在搜索出生地点…' : apiError ? apiError : `已从服务端匹配 ${apiTotal} 个地点${apiDataset?.version ? ` · 数据版本 ${apiDataset.version}` : ''}`}
          </div>
          {!apiLoading && apiPlaces.length > 0 && <div className="birthplace-result-list">
            {apiPlaces.map((place) => {
              const key = place.district.code || `${place.province.name}-${place.city.name}-${place.district.name}`
              const active = isBirthplaceSelectionActive(birth, place)
              const selectable = isPlaceSelectable(place)
              return <button type="button" key={key} className="birthplace-result" data-selected={active} data-disabled={!selectable} disabled={!selectable} onClick={() => applyApiPlace(place)}>
                <b>{place.province.name} {place.city.name} {place.district.name}</b>
                <small>{selectable ? `${place.city.timezone} · 地点编码 ${place.district.code} · ${coordinateConfidenceLabel(place.district.coordinate?.confidence)}` : '行政区已收录 · 坐标待补充，暂不可排盘'}</small>
              </button>
            })}
          </div>}
          {!apiLoading && !apiError && apiPlaces.length === 0 && <p className="birthplace-empty">没有匹配地点，请换省、市、区县名称或行政区划代码重试。</p>}
          {hasMore && <button type="button" className="load-more-birthplaces" disabled={apiLoadingMore} onClick={loadMore}>{apiLoadingMore ? '加载中…' : `加载更多（${apiPlaces.length}/${apiTotal}）`}</button>}
        </section>
        <fieldset className={`birthplace-picker ${serverTree.length ? '' : 'fallback-active'}`}>
          <legend>{serverTree.length ? '省 / 市 / 区县选择器' : '本地演示地点（服务端树加载失败时使用）'}</legend>
          <label>省份<select aria-label="出生省份" value={selected.province.name} onChange={(event) => {
            const province = pickerTree.find((item) => item.name === event.target.value) ?? pickerTree[0]
            applyPlace(province, province.cities[0], province.cities[0].districts[0])
          }}>{pickerTree.map((province) => <option key={province.name}>{province.name}</option>)}</select></label>
          <label>城市<select aria-label="出生城市" value={selected.city.name} onChange={(event) => {
            const city = selected.province.cities.find((item) => item.name === event.target.value) ?? selected.province.cities[0]
            applyPlace(selected.province, city, city.districts[0])
          }}>{selected.province.cities.map((city) => <option key={city.name}>{city.name}</option>)}</select></label>
          <label>区县<select aria-label="出生区县" value={selected.district.name} onChange={(event) => {
            const district = selected.city.districts.find((item) => item.name === event.target.value) ?? selected.city.districts[0]
            applyPlace(selected.province, selected.city, district, true)
          }}>{selected.city.districts.map((district) => <option key={district.name}>{district.name}</option>)}</select></label>
        </fieldset>
        {treeLoading && <p className="picker-hint">正在加载服务端省市区树…</p>}
        {treeError && <p className="picker-hint fallback-note">{treeError}</p>}
        {usingFallback && <p className="picker-hint fallback-note">本地回退只含少量演示城市，不代表全国行政区划或全国坐标覆盖。</p>}
        <p className="picker-hint">用户只需要选出生地点；经纬度、时区、地点编码和数据版本会跟随命盘一起保存，用于真太阳时复算。</p>
      </div>
    </div>}
  </div>
}
const directionLabels: Record<Direction, string> = { north: '北', east: '东', south: '南', west: '西', unknown: '不确定' }
const genderLabels: Record<NonNullable<BirthInput['gender']>, string> = { male: '男', female: '女' }
const roomLabels: Record<Room, string> = {
  overview: '全屋/户型',
  'living-room': '客厅',
  bedroom: '卧室',
  kitchen: '厨房',
  bathroom: '卫生间',
  entrance: '入户',
  other: '其他',
}

function formatRoomLabel(room: string): string {
  return Object.prototype.hasOwnProperty.call(roomLabels, room) ? roomLabels[room as Room] : room
}

function formatFiveElements(value: NonNullable<BaziChart['fiveElements']>): string {
  const labels: Record<string, string> = { wood: '木', fire: '火', earth: '土', metal: '金', water: '水' }
  const counts = 'counts' in value && value.counts ? value.counts : value as Partial<Record<'木' | '火' | '土' | '金' | '水', number>>
  return Object.entries(counts).map(([key, amount]) => `${labels[key] ?? key}${amount ?? 0}`).join(' · ')
}

export function formatDayMaster(value: BaziChart['dayMaster'] | undefined): string {
  if (!value) return '待计算'
  if (typeof value === 'string') return value
  const elementLabels: Record<string, string> = { wood: '木', fire: '火', earth: '土', metal: '金', water: '水' }
  const yinYangLabels: Record<string, string> = { yang: '阳', yin: '阴' }
  return [
    value.stem,
    value.element ? elementLabels[value.element] ?? value.element : undefined,
    value.yinYang ? yinYangLabels[value.yinYang] ?? value.yinYang : undefined,
  ].filter(Boolean).join(' · ') || '待计算'
}

function timezoneLabel(timezone?: string): string {
  if (!timezone) return 'Asia/Shanghai · UTC+8'
  return timezone === 'Asia/Shanghai' ? 'Asia/Shanghai · UTC+8' : timezone
}

function relationLabel(relation: string | BaziRelation): string {
  return typeof relation === 'string' ? relation : relation.detail
}

type GanZhiRelationGroup = { label: '天干' | '地支'; value: string }

export function buildGanZhiRelationGroups(
  relations: readonly (string | BaziRelation)[] | undefined,
): GanZhiRelationGroup[] {
  const stemChars = new Set<string>(HEAVENLY_STEMS)
  const branchChars = new Set<string>(EARTHLY_BRANCHES)
  const groups: Record<GanZhiRelationGroup['label'], string[]> = { 天干: [], 地支: [] }
  for (const relation of relations ?? []) {
    const detail = relationLabel(relation)
    const chars = Array.from(detail)
    const stemHits = chars.filter((char) => stemChars.has(char)).length
    const branchHits = chars.filter((char) => branchChars.has(char)).length
    if (stemHits >= 2 && stemHits >= branchHits) groups.天干.push(detail)
    else if (branchHits >= 2) groups.地支.push(detail)
  }
  return (['天干', '地支'] as const).map((label) => ({
    label,
    value: groups[label].length ? groups[label].join('、') : '未发现已支持的合冲关系',
  }))
}

const OLD_CHART_RECALCULATION_REQUIRED = '旧命盘需重新排算'
type ProfessionalDisplayBazi = {
  professional?: BaziChart['professional']
  relations?: readonly (string | BaziRelation)[]
  /** Legacy pre-professional fields are accepted only to detect that recalculation is required. */
  voidBranches?: string[]
  nayin?: string[]
  growthStages?: string[]
}

export function formatProfessionalField(
  bazi: ProfessionalDisplayBazi | undefined | null,
  key: keyof NonNullable<BaziChart['professional']>,
  index: number,
): string {
  if (!bazi) return '待计算'
  if (!bazi.professional) return OLD_CHART_RECALCULATION_REQUIRED
  const value = bazi.professional[key]
  if (Array.isArray(value)) return value[index] || '待计算'
  return '待计算'
}

export function formatProfessionalPillarMatrixValue(
  bazi: ChartCalculationResult | Pick<BaziChart, 'professional' | 'pillars' | 'tenGods' | 'hiddenStems' | 'pillarDetails' | 'assessments'> | undefined | null,
  label: (typeof professionalPillarMatrixRowLabels)[number],
  index: number,
  gender?: BirthInput['gender'],
): string {
  if (!bazi) return '待计算'
  const pillarDetails = 'pillarDetails' in bazi ? bazi.pillarDetails?.[index] : undefined
  const fromProfessional = (key: keyof NonNullable<BaziChart['professional']>) => formatProfessionalField(bazi as ProfessionalDisplayBazi, key, index)
  const pendingIfEmpty = (value: string | undefined) => value && value.trim() ? value : '待计算'
  switch (label) {
    case '干神':
      if (index === 2) return gender === 'female' ? '女主' : gender === 'male' ? '男主' : '日主'
      return pendingIfEmpty('tenGods' in bazi ? bazi.tenGods?.[index] : undefined)
    case '天干':
      return pendingIfEmpty('pillars' in bazi ? bazi.pillars[index]?.slice(0, 1) : undefined)
    case '地支':
      return pendingIfEmpty('pillars' in bazi ? bazi.pillars[index]?.slice(1, 2) : undefined)
    case '藏干':
      return pendingIfEmpty(pillarDetails?.hiddenStems?.map((item) => item.stem).join('、') || ('hiddenStems' in bazi ? bazi.hiddenStems?.[index]?.join('、') : undefined))
    case '支神':
      return pendingIfEmpty(pillarDetails?.hiddenStems?.map((item) => item.tenGod).join('、'))
    case '纳音':
      return pendingIfEmpty(pillarDetails?.naYin || fromProfessional('naYin'))
    case '空亡':
      return pendingIfEmpty(pillarDetails?.voidBranches || fromProfessional('voidBranches'))
    case '地势':
      return pendingIfEmpty(pillarDetails?.twelveGrowthStage || fromProfessional('twelveGrowthStages'))
    case '自坐':
      return pendingIfEmpty(pillarDetails?.selfSitting)
    case '神煞':
      return pendingIfEmpty(pillarDetails?.shenSha?.names?.join('、') || ('assessments' in bazi ? bazi.assessments?.shenSha?.items?.join('、') : undefined))
  }
}

const elementToneByChar: Record<string, 'wood' | 'fire' | 'earth' | 'metal' | 'water'> = {
  甲: 'wood', 乙: 'wood', 寅: 'wood', 卯: 'wood',
  丙: 'fire', 丁: 'fire', 巳: 'fire', 午: 'fire',
  戊: 'earth', 己: 'earth', 丑: 'earth', 辰: 'earth', 未: 'earth', 戌: 'earth',
  庚: 'metal', 辛: 'metal', 申: 'metal', 酉: 'metal',
  壬: 'water', 癸: 'water', 子: 'water', 亥: 'water',
}
const elementLabelsByTone: Record<'wood' | 'fire' | 'earth' | 'metal' | 'water', '木' | '火' | '土' | '金' | '水'> = {
  wood: '木',
  fire: '火',
  earth: '土',
  metal: '金',
  water: '水',
}
const BRANCH_COMPATIBILITY_COMBINATIONS: Record<string, string> = { 子丑: '子丑六合', 寅亥: '寅亥六合', 卯戌: '卯戌六合', 辰酉: '辰酉六合', 巳申: '巳申六合', 午未: '午未六合' }
const BRANCH_COMPATIBILITY_CLASHES: Record<string, string> = { 子午: '子午相冲', 丑未: '丑未相冲', 寅申: '寅申相冲', 卯酉: '卯酉相冲', 辰戌: '辰戌相冲', 巳亥: '巳亥相冲' }

function professionalMatrixToneClass(value: string): string {
  const char = value.match(/[甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥]/)?.[0]
  const tone = char ? elementToneByChar[char] : undefined
  return tone ? `tone-${tone}` : ''
}

function professionalMatrixCellClass(label: (typeof professionalPillarMatrixRowLabels)[number], value: string): string {
  const major = label === '天干' || label === '地支'
  const stack = label === '藏干' || label === '支神' || label === '神煞'
  return ['matrix-cell', major ? 'matrix-cell-major' : '', stack ? 'matrix-cell-stack' : '', professionalMatrixToneClass(value)].filter(Boolean).join(' ')
}

function renderProfessionalMatrixValue(label: (typeof professionalPillarMatrixRowLabels)[number], value: string) {
  if (value === '待计算' || value === OLD_CHART_RECALCULATION_REQUIRED) return value
  if (label !== '藏干' && label !== '支神' && label !== '神煞') return value
  return value.split('、').filter(Boolean).map((item) => <em key={item} className={professionalMatrixToneClass(item)}>{item}</em>)
}

export function formatRelationsSummary(
  bazi: ProfessionalDisplayBazi | undefined | null,
): string {
  if (!bazi) return '待计算'
  if (!bazi.professional) return OLD_CHART_RECALCULATION_REQUIRED
  if (!Array.isArray(bazi.relations)) return '待计算'
  if (bazi.relations.length === 0) return '未发现已支持的合冲关系'
  return bazi.relations.map(relationLabel).join('、')
}

function legacyCycleLabel(cycle: object): string | undefined {
  return 'label' in cycle && typeof cycle.label === 'string' ? cycle.label : undefined
}

export function formatVoidBranchesSummary(
  bazi: ProfessionalDisplayBazi | undefined | null,
): string {
  if (!bazi) return '待计算'
  if (!bazi.professional) return OLD_CHART_RECALCULATION_REQUIRED
  return bazi.professional.voidBranches?.length ? bazi.professional.voidBranches.join('、') : '待计算'
}

function joinUniqueProfessionalValues(values: readonly (string | undefined)[]): string {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))).join('、')
}

function formatNatalNaYinSummary(
  bazi: Pick<BaziChart, 'professional' | 'pillarDetails'> | undefined | null,
): string {
  if (!bazi) return '待计算'
  const fromPillars = bazi.pillarDetails?.map((pillar) => pillar.naYin)
  const value = joinUniqueProfessionalValues([...(fromPillars ?? []), ...(bazi.professional?.naYin ?? [])])
  if (value) return value
  return bazi.professional ? '待计算' : OLD_CHART_RECALCULATION_REQUIRED
}

function formatNatalShenShaSummary(
  bazi: Pick<BaziChart, 'pillarDetails' | 'assessments'> | undefined | null,
): string {
  if (!bazi) return '待计算'
  const fromPillars = bazi.pillarDetails?.flatMap((pillar) => pillar.shenSha?.names ?? [])
  const fromAssessment = bazi.assessments?.shenSha?.items ?? []
  const value = joinUniqueProfessionalValues([...(fromPillars ?? []), ...fromAssessment])
  return value || '待计算'
}

export function buildNatalProfessionalDigest(
  bazi: ChartCalculationResult | Pick<BaziChart, 'dayMaster' | 'fiveElements' | 'tenGods' | 'relations' | 'professional' | 'luckCycles' | 'pillarDetails' | 'assessments'> | undefined | null,
  manualChart = false,
) {
  const firstLuckCycle = !manualChart && Array.isArray(bazi?.luckCycles) && bazi.luckCycles.length > 0 ? bazi.luckCycles[0] : undefined
  const firstLuckValue = firstLuckCycle
    ? `${firstLuckCycle.pillar || '待计算'} · ${firstLuckCycle.startAge ?? '待计算'}岁起${firstLuckCycle.direction ? ` · ${firstLuckCycle.direction === 'forward' ? '顺行' : '逆行'}` : ''}`
    : manualChart ? '需补出生资料' : '待计算'
  return [
    { label: '日主', value: formatDayMaster(bazi?.dayMaster) },
    { label: '五行', value: bazi?.fiveElements ? formatFiveElements(bazi.fiveElements) : '待计算' },
    { label: '十神', value: Array.isArray(bazi?.tenGods) && bazi.tenGods.length ? bazi.tenGods.join(' · ') : '待计算' },
    { label: '纳音', value: formatNatalNaYinSummary(bazi as Pick<BaziChart, 'professional' | 'pillarDetails'>) },
    { label: '空亡', value: formatVoidBranchesSummary(bazi as ProfessionalDisplayBazi) },
    { label: '神煞', value: formatNatalShenShaSummary(bazi as Pick<BaziChart, 'pillarDetails' | 'assessments'>) },
    { label: '合冲', value: formatRelationsSummary(bazi as ProfessionalDisplayBazi) },
    { label: '首步大运', value: firstLuckValue },
  ]
}

type CompatibilityChartLike = Pick<BaziChart, 'pillars' | 'dayMaster'> | Pick<ManualFourPillarsInput, 'pillars'> | undefined | null
type CompatibilitySummaryCard = { label: '本人日主' | '对方日主' | '五行同频' | '四柱关系'; value: string; detail: string; state: 'ready' | 'pending' }

function elementLabelFromChar(char: string | undefined): string {
  if (!char) return '待计算'
  const tone = elementToneByChar[char]
  return tone ? elementLabelsByTone[tone] : '待计算'
}

function normalizeCompatibilityPillars(chart: CompatibilityChartLike): string[] {
  return Array.from(chart?.pillars ?? []).filter((pillar) => typeof pillar === 'string' && /^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]$/.test(pillar))
}

function dayMasterFromPillars(pillars: readonly string[]): string {
  const stem = pillars[2]?.slice(0, 1)
  const element = elementLabelFromChar(stem)
  return stem ? `${stem} · ${element}` : '待计算'
}

export function countVisiblePillarElements(pillars: readonly string[]) {
  const counts: Record<'木' | '火' | '土' | '金' | '水', number> = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 }
  for (const pillar of pillars) {
    for (const char of pillar) {
      const tone = elementToneByChar[char]
      if (tone) counts[elementLabelsByTone[tone]] += 1
    }
  }
  return counts
}

function formatChineseElementCounts(counts: Record<'木' | '火' | '土' | '金' | '水', number>): string {
  return (['木', '火', '土', '金', '水'] as const).map((element) => `${element}${counts[element]}`).join(' · ')
}

function branchCompatibilityLabel(a: string, b: string): string | undefined {
  const pair = `${a}${b}`
  const reverse = `${b}${a}`
  return BRANCH_COMPATIBILITY_COMBINATIONS[pair] ?? BRANCH_COMPATIBILITY_COMBINATIONS[reverse] ?? BRANCH_COMPATIBILITY_CLASHES[pair] ?? BRANCH_COMPATIBILITY_CLASHES[reverse]
}

export function buildCompatibilitySummaryCards(primary: CompatibilityChartLike, partner: CompatibilityChartLike): CompatibilitySummaryCard[] {
  const primaryPillars = normalizeCompatibilityPillars(primary)
  const partnerPillars = normalizeCompatibilityPillars(partner)
  if (primaryPillars.length !== 4 || partnerPillars.length !== 4) {
    return [
      { label: '本人日主', value: primaryPillars.length === 4 ? dayMasterFromPillars(primaryPillars) : '待生成', detail: '先生成本人生辰盘', state: primaryPillars.length === 4 ? 'ready' : 'pending' },
      { label: '对方日主', value: partnerPillars.length === 4 ? dayMasterFromPillars(partnerPillars) : '待选择', detail: '请选择对方四柱', state: partnerPillars.length === 4 ? 'ready' : 'pending' },
      { label: '五行同频', value: '待计算', detail: '两份四柱完整后显示可见五行重叠', state: 'pending' },
      { label: '四柱关系', value: '待计算', detail: '两份四柱完整后显示同柱、六合或相冲', state: 'pending' },
    ]
  }
  const primaryCounts = countVisiblePillarElements(primaryPillars)
  const partnerCounts = countVisiblePillarElements(partnerPillars)
  const sharedElements = (['木', '火', '土', '金', '水'] as const).filter((element) => primaryCounts[element] > 0 && partnerCounts[element] > 0)
  const samePillars = primaryPillars.map((pillar, index) => pillar === partnerPillars[index] ? `${['年', '月', '日', '时'][index]}柱同为${pillar}` : '').filter(Boolean)
  const branchRelations = primaryPillars.flatMap((pillar, primaryIndex) => partnerPillars.map((partnerPillar, partnerIndex) => {
    const relation = branchCompatibilityLabel(pillar[1], partnerPillar[1])
    return relation ? `${['年', '月', '日', '时'][primaryIndex]}支${pillar[1]} × 对方${['年', '月', '日', '时'][partnerIndex]}支${partnerPillar[1]}：${relation}` : ''
  })).filter(Boolean)
  const relations = [...samePillars, ...branchRelations]
  return [
    { label: '本人日主', value: dayMasterFromPillars(primaryPillars), detail: primaryPillars.join(' · '), state: 'ready' },
    { label: '对方日主', value: dayMasterFromPillars(partnerPillars), detail: partnerPillars.join(' · '), state: 'ready' },
    {
      label: '五行同频',
      value: sharedElements.length ? sharedElements.join('、') : '暂无重叠',
      detail: `本人 ${formatChineseElementCounts(primaryCounts)}；对方 ${formatChineseElementCounts(partnerCounts)}`,
      state: 'ready',
    },
    {
      label: '四柱关系',
      value: relations.length ? `${relations.length} 条` : '未发现',
      detail: relations.length ? relations.slice(0, 3).join('；') : '当前基础规则未发现同柱、六合或相冲',
      state: 'ready',
    },
  ]
}

export function formatProfessionalAssessment(assessment: ProfessionalAssessment | undefined) {
  if (assessment?.status === 'derived' && (assessment.conclusion || assessment.items?.length)) {
    return {
      value: assessment.conclusion || assessment.items!.join('、'),
      state: `已计算 · ${assessment.ruleVersion || '规则版本未记录'}`,
      evidence: `${assessment.provenance?.matchedRuleIds?.length ?? 0} 条命中规则 · ${assessment.provenance?.sourceVersionIds?.length ?? 0} 个来源版本`,
    }
  }
  const reason = {
    'legacy-profile': '旧规则版本未包含可执行决策表',
    disabled: '该类规则未启用',
    'no-match': '已执行，但没有规则命中',
    conflict: '最高优先级规则冲突，已停止给出结论',
  }[assessment?.reason ?? 'legacy-profile']
  return {
    value: assessment?.status === 'unresolved' ? '未决' : '待审核',
    state: `${reason} · ${assessment?.ruleVersion || '规则版本未记录'}`,
    evidence: '不会由模型补写',
  }
}

export function formatBalanceFacts(balance: BaziBalanceFacts | undefined) {
  if (!balance) return null
  const signedNet = `${balance.netScore > 0 ? '+' : ''}${balance.netScore}`
  return {
    season: balance.monthCommandSupports ? '月令主气扶助日主（扶抑基线）' : '月令主气不扶助日主（扶抑基线）',
    roots: `${balance.rootCount} 处根气`,
    resources: `${balance.resourceCount} 处生扶`,
    scores: `支持 ${balance.supportScore} · 克泄耗 ${balance.oppositionScore} · 净值 ${signedNet}`,
    method: balance.method,
  }
}

const YEARS = Array.from({ length: 2100 - 1801 + 1 }, (_, index) => 1801 + index)
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1)
const HOURS = Array.from({ length: 24 }, (_, index) => index)
const MINUTES = Array.from({ length: 60 }, (_, index) => index)

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function pickerDaysInMonth(
  calendarSystem: 'solar' | 'lunar',
  year: number,
  month: number,
  lunarProfile?: LunarYearProfile,
  lunarLeapMonth = false,
): number {
  return calendarSystem === 'lunar'
    ? (lunarProfile?.year === year ? (lunarMonthDays(lunarProfile, month, lunarLeapMonth) ?? 0) : 0)
    : daysInMonth(year, month)
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function formatTimeParts(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}

export function compactBirthYear(value: string): number | undefined {
  const match = /^(\d{4})\d{4}(?:\d{4})?$/.exec(value.trim())
  if (!match) return undefined
  const year = Number(match[1])
  return year >= 1801 && year <= 2100 ? year : undefined
}

export function parseCompactBirth(
  value: string,
  calendarSystem: 'solar' | 'lunar' = 'solar',
  lunarProfile?: LunarYearProfile,
  lunarLeapMonth = false,
) {
  const match = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2}))?$/.exec(value.trim())
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = match[4] === undefined ? 0 : Number(match[4])
  const minute = match[5] === undefined ? 0 : Number(match[5])
  const monthDays = pickerDaysInMonth(calendarSystem, year, month, lunarProfile, lunarLeapMonth)
  if (year < 1801 || year > 2100 || month < 1 || month > 12 || day < 1 || day > monthDays || hour > 23 || minute > 59) return undefined
  return { date: formatDateParts(year, month, day), time: formatTimeParts(hour, minute) }
}

export type BirthDateTimeDraft = {
  date: string
  time: string
  calendarSystem: 'solar' | 'lunar'
  lunarLeapMonth: boolean
}

export function createBirthDateTimeDraft(birth: BirthInput): BirthDateTimeDraft {
  return {
    date: birth.date,
    time: birth.time,
    calendarSystem: birth.calendarSystem ?? 'solar',
    lunarLeapMonth: birth.calendarSystem === 'lunar' && Boolean(birth.lunarLeapMonth),
  }
}

export function updateBirthDateTimeDraft(
  draft: BirthDateTimeDraft,
  part: Partial<{ year: number; month: number; day: number; hour: number; minute: number; lunarLeapMonth: boolean }>,
  lunarProfile?: LunarYearProfile,
): BirthDateTimeDraft {
  const [currentYear = 1990, currentMonth = 1, currentDay = 1] = draft.date.split('-').map(Number)
  const [currentHour = 0, currentMinute = 0] = draft.time.split(':').map(Number)
  const next = {
    year: part.year ?? currentYear,
    month: part.month ?? currentMonth,
    day: part.day ?? currentDay,
    hour: part.hour ?? currentHour,
    minute: part.minute ?? currentMinute,
  }
  const requestedLeap = part.lunarLeapMonth ?? draft.lunarLeapMonth
  let normalizedLeap = draft.calendarSystem === 'lunar' && requestedLeap
  let monthDays = pickerDaysInMonth(draft.calendarSystem, next.year, next.month, lunarProfile, normalizedLeap)
  if (draft.calendarSystem === 'lunar' && lunarProfile?.year === next.year && monthDays === 0) {
    normalizedLeap = false
    monthDays = pickerDaysInMonth('lunar', next.year, next.month, lunarProfile, false)
  }
  if (monthDays > 0) next.day = Math.min(next.day, monthDays)
  return {
    ...draft,
    date: formatDateParts(next.year, next.month, next.day),
    time: formatTimeParts(next.hour, next.minute),
    lunarLeapMonth: normalizedLeap,
  }
}

export function canConfirmBirthDateTime(
  pickerMode: 'solar' | 'lunar' | 'four-pillars',
  draft: BirthDateTimeDraft,
  lunarProfile: LunarYearProfile | undefined,
  lunarProfileLoading: boolean,
  lunarProfileError: string,
): boolean {
  if (pickerMode === 'four-pillars') return false
  if (pickerMode === 'solar') return true
  if (lunarProfileLoading || lunarProfileError) return false
  const [year, month, day] = draft.date.split('-').map(Number)
  return isLunarDateValid(lunarProfile, year!, month!, day!, draft.lunarLeapMonth)
}

export function commitBirthDateTimeDraft(birth: BirthInput, draft: BirthDateTimeDraft): BirthInput {
  return {
    ...birth,
    date: draft.date,
    time: draft.time,
    calendarSystem: draft.calendarSystem,
    lunarLeapMonth: draft.calendarSystem === 'lunar' ? draft.lunarLeapMonth : false,
  }
}

export function BirthDateTimePicker({ birth, setBirth, inputMode = 'birth-data', manualInput = defaultManualFourPillarsInput, setManualInput, setInputMode }: {
  birth: BirthInput
  setBirth: (birth: BirthInput) => void
  inputMode?: 'birth-data' | 'manual-four-pillars'
  manualInput?: ManualFourPillarsInput
  setManualInput?: (input: ManualFourPillarsInput) => void
  setInputMode?: (mode: 'birth-data' | 'manual-four-pillars') => void
}) {
  const [open, setOpen] = useState(false)
  const [quick, setQuick] = useState('')
  const [quickError, setQuickError] = useState('')
  const [quickLoading, setQuickLoading] = useState(false)
  const [draft, setDraft] = useState<BirthDateTimeDraft>(() => createBirthDateTimeDraft(birth))
  const [manualDraft, setManualDraft] = useState<ManualFourPillarsInput>(() => normalizeManualFourPillarsInput(manualInput))
  const [pickerMode, setPickerMode] = useState<'solar' | 'lunar' | 'four-pillars'>(inputMode === 'manual-four-pillars' ? 'four-pillars' : birth.calendarSystem ?? 'solar')
  const [lunarProfile, setLunarProfile] = useState<LunarYearProfile>()
  const [lunarProfileLoading, setLunarProfileLoading] = useState(false)
  const [lunarProfileError, setLunarProfileError] = useState('')
  const lunarProfileCache = useRef(new Map<number, LunarYearProfile>())
  const calendarSystem = birth.calendarSystem ?? 'solar'
  const parsed = draft.date.split('-').map(Number)
  const selected = {
    year: parsed[0] || 1990,
    month: parsed[1] || 1,
    day: parsed[2] || 1,
    hour: Number(draft.time.split(':')[0] ?? 0),
    minute: Number(draft.time.split(':')[1] ?? 0),
  }
  const selectedMonthDays = pickerDaysInMonth(draft.calendarSystem, selected.year, selected.month, lunarProfile, draft.lunarLeapMonth)
  const validDay = selectedMonthDays > 0 ? Math.min(selected.day, selectedMonthDays) : selected.day
  const currentLunarMonthOptions = lunarProfile?.year === selected.year ? lunarMonthOptions(lunarProfile) : []
  const canConfirm = pickerMode === 'four-pillars'
    ? Boolean(setManualInput && setInputMode && isManualFourPillarsInput(manualDraft))
    : canConfirmBirthDateTime(pickerMode, draft, lunarProfile, lunarProfileLoading || quickLoading, lunarProfileError)
  const openPicker = () => {
    const nextDraft = createBirthDateTimeDraft(birth)
    setDraft(nextDraft)
    setManualDraft(normalizeManualFourPillarsInput(manualInput))
    setPickerMode(inputMode === 'manual-four-pillars' ? 'four-pillars' : nextDraft.calendarSystem)
    setQuick('')
    setQuickError('')
    setQuickLoading(false)
    setOpen(true)
  }
  const cancelPicker = () => {
    setOpen(false)
    setQuickError('')
  }
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelPicker()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])
  useEffect(() => {
    if (!open || pickerMode !== 'lunar') return
    const controller = new AbortController()
    const year = selected.year
    const cached = lunarProfileCache.current.get(year)
    setLunarProfileError('')
    if (cached) {
      setLunarProfile(cached)
      setLunarProfileLoading(false)
      setDraft((current) => current.calendarSystem === 'lunar' && Number(current.date.slice(0, 4)) === year
        ? updateBirthDateTimeDraft(current, {}, cached)
        : current)
      return () => controller.abort()
    }
    setLunarProfile(undefined)
    setLunarProfileLoading(true)
    void requestJson<unknown>(`/api/v1/calendar/lunar-years/${year}`, { signal: controller.signal, timeoutMs: 15_000 })
      .then((payload) => normalizeLunarYearProfile(payload, year))
      .then((profile) => {
        if (controller.signal.aborted) return
        lunarProfileCache.current.set(year, profile)
        setLunarProfile(profile)
        setDraft((current) => current.calendarSystem === 'lunar' && Number(current.date.slice(0, 4)) === year
          ? updateBirthDateTimeDraft(current, {}, profile)
          : current)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setLunarProfile(undefined)
        setLunarProfileError(error instanceof Error ? error.message : '农历年份资料加载失败。')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLunarProfileLoading(false)
      })
    return () => controller.abort()
  }, [open, pickerMode, selected.year])
  const setPart = (part: Partial<typeof selected>) => {
    setDraft((current) => updateBirthDateTimeDraft(current, part, lunarProfile))
    setQuickError('')
  }
  const setLunarMonth = (month: LunarMonthOption) => {
    setDraft((current) => updateBirthDateTimeDraft(current, { month: month.month, lunarLeapMonth: month.leap }, lunarProfile))
    setQuickError('')
  }
  const setCalendarSystem = (next: 'solar' | 'lunar' | 'four-pillars') => {
    setPickerMode(next)
    if (next === 'four-pillars') return
    setDraft((current) => {
      const withCalendar = { ...current, calendarSystem: next, lunarLeapMonth: next === 'lunar' && current.lunarLeapMonth }
      return updateBirthDateTimeDraft(withCalendar, {}, lunarProfile)
    })
    setQuickError('')
  }
  const applyQuick = async () => {
    if (pickerMode === 'four-pillars') return
    if (pickerMode === 'lunar') {
      const year = compactBirthYear(quick)
      if (!year) {
        setQuickError('请输入有效的农历日期时间，例如 199303270255。')
        return
      }
      setQuickLoading(true)
      setLunarProfileError('')
      try {
        const cached = lunarProfileCache.current.get(year)
        const profile = cached ?? normalizeLunarYearProfile(
          await requestJson<unknown>(`/api/v1/calendar/lunar-years/${year}`, { timeoutMs: 15_000 }),
          year,
        )
        lunarProfileCache.current.set(year, profile)
        const parsedQuick = parseCompactBirth(quick, 'lunar', profile, false)
        if (!parsedQuick) {
          setQuickError('该日期不在所选农历月内；请检查年份、月份和当月天数。')
          return
        }
        setLunarProfile(profile)
        setDraft((current) => ({ ...current, ...parsedQuick, calendarSystem: 'lunar', lunarLeapMonth: false }))
        setQuickError('')
      } catch (error) {
        const message = error instanceof Error ? error.message : '农历年份资料加载失败。'
        setLunarProfile(undefined)
        setLunarProfileError(message)
        setQuickError('无法校验该农历日期，请稍后重试。')
      } finally {
        setQuickLoading(false)
      }
      return
    }
    const parsedQuick = parseCompactBirth(quick, 'solar')
    if (!parsedQuick) {
      setQuickError('请输入有效的公历日期时间，例如 199303270255。')
      return
    }
    setDraft((current) => ({ ...current, ...parsedQuick, calendarSystem: pickerMode }))
    setQuickError('')
  }
  const setToday = () => {
    const now = new Date()
    setPickerMode('solar')
    setDraft({
      date: formatDateParts(now.getFullYear(), now.getMonth() + 1, now.getDate()),
      time: formatTimeParts(now.getHours(), now.getMinutes()),
      calendarSystem: 'solar',
      lunarLeapMonth: false,
    })
    setQuickError('')
  }
  const confirmPicker = () => {
    if (!canConfirm) return
    if (pickerMode === 'four-pillars') {
      setManualInput?.(normalizeManualFourPillarsInput(manualDraft))
      setInputMode?.('manual-four-pillars')
      setOpen(false)
      return
    }
    setBirth(commitBirthDateTimeDraft(birth, draft))
    setInputMode?.('birth-data')
    setOpen(false)
  }
  const PickerColumn = ({ title, values, value, onSelect, suffix = '' }: {
    title: string
    values: number[]
    value: number
    onSelect: (value: number) => void
    suffix?: string
  }) => <div className="picker-column"><b>{title}</b><div>{values.map((item) => <button type="button" key={`${title}-${item}`} data-selected={item === value} onClick={() => onSelect(item)}>{item.toString().padStart(title === '年' ? 4 : 2, '0')}{suffix}</button>)}</div></div>
  return <div className="datetime-field wide">
    {inputMode === 'manual-four-pillars' && <div className="manual-input-summary" role="status">
      <b>手动四柱，不含出生时间推导</b>
      <span>{manualInput.pillars.join(' · ')}</span>
      <small>真太阳时、节气、起运与流运需补出生资料</small>
    </div>}
    <div className="datetime-trigger-grid">
      <label>{inputMode === 'manual-four-pillars' ? '输入方式' : '出生日期'}<button className="datetime-trigger" type="button" onClick={openPicker}>
        <span>{inputMode === 'manual-four-pillars' ? '四柱直输' : birth.date.replaceAll('-', '/')}</span>
        <small>{inputMode === 'manual-four-pillars' ? '点击编辑四柱' : calendarSystem === 'solar' ? '公历 📅' : `农历${birth.lunarLeapMonth ? ' · 闰月' : ''} 📅`}</small>
      </button></label>
      <label>{inputMode === 'manual-four-pillars' ? '已选命盘' : '出生时间'}<button className="datetime-trigger" type="button" onClick={openPicker}>
        <span>{inputMode === 'manual-four-pillars' ? manualInput.pillars.join(' ') : birth.time}</span>
        <small>{inputMode === 'manual-four-pillars' ? '60 甲子合法组合' : '点击选择 ⏱'}</small>
      </button></label>
    </div>
    {open && <div className="picker-backdrop" role="dialog" aria-modal="true" aria-label="选择出生时间">
      <div className="birth-time-picker">
        <div className="picker-head">
          <button type="button" className="today" onClick={setToday}>今</button>
          <div className="calendar-tabs" role="group" aria-label="历法类型">
            <button type="button" data-selected={pickerMode === 'solar'} onClick={() => setCalendarSystem('solar')}>公历</button>
            <button type="button" data-selected={pickerMode === 'lunar'} onClick={() => setCalendarSystem('lunar')}>农历</button>
            {setManualInput && setInputMode && <button type="button" data-selected={pickerMode === 'four-pillars'} onClick={() => setCalendarSystem('four-pillars')}>四柱</button>}
          </div>
          <button type="button" className="close-picker" aria-label="关闭出生时间选择器" onClick={cancelPicker}>×</button>
        </div>
        {pickerMode !== 'four-pillars' && <div className="quick-birth-input">
          <input inputMode="numeric" value={quick} aria-invalid={Boolean(quickError)} onChange={(event) => { setQuick(event.target.value); setQuickError('') }} placeholder="输入出生年月日时分，如 199303270255" />
          <button type="button" disabled={quickLoading} onClick={() => void applyQuick()}>{quickLoading ? '校验中…' : '应用'}</button>
        </div>}
        {quickError && <p className="picker-error" role="alert">{quickError}</p>}
        {pickerMode !== 'four-pillars' && <p className="picker-hint calendar-meaning">切换历法不会转换当前数字；系统会按所选的{pickerMode === 'solar' ? '公历' : '农历'}含义解释并在服务端排盘。</p>}
        {pickerMode === 'lunar' && <div className="lunar-profile-state" aria-live="polite">
          {lunarProfileLoading || quickLoading ? <p className="picker-hint">正在加载 {selected.year} 年农历月表…</p> : lunarProfileError ? <p className="picker-error" role="alert">{lunarProfileError} 农历日期暂不能确认。</p> : lunarProfile ? <p className="picker-hint">月表规则 {lunarProfile.ruleVersion} · {lunarProfile.leapMonth ? `闰${lunarProfile.leapMonth}月` : '本年无闰月'}。快速输入默认常规月，可在月份列选择闰月。</p> : null}
        </div>}
        {pickerMode === 'four-pillars' && <div className="manual-four-pillars-editor">
          <p className="picker-hint"><b>手动四柱，不含出生时间推导。</b> 每柱只能从 60 甲子合法组合中选择；真太阳时、节气、起运与流运需补出生资料。</p>
          <div className="manual-pillar-grid">
            {(['年柱', '月柱', '日柱', '时柱'] as const).map((label, index) => <label key={label}>{label}
              <select
                className="manual-pillar-select"
                aria-label={label}
                value={manualDraft.pillars[index]}
                onChange={(event) => setManualDraft((current) => {
                  const pillars = [...current.pillars] as [string, string, string, string]
                  pillars[index] = event.target.value
                  return { ...current, pillars }
                })}
              >
                {SEXAGENARY_CYCLE.map((pillar, cycleIndex) => <option key={pillar} value={pillar}>{String(cycleIndex + 1).padStart(2, '0')} · {pillar}</option>)}
              </select>
            </label>)}
          </div>
        </div>}
        {pickerMode !== 'four-pillars' && <div className="picker-columns">
          <PickerColumn title="年" values={YEARS} value={selected.year} onSelect={(year) => setPart({ year })} />
          {pickerMode === 'lunar' ? <div className="picker-column"><b>月</b><div>{currentLunarMonthOptions.map((month) => <button type="button" key={month.key} data-selected={month.month === selected.month && month.leap === draft.lunarLeapMonth} onClick={() => setLunarMonth(month)}>{month.label}</button>)}</div></div> : <PickerColumn title="月" values={MONTHS} value={selected.month} onSelect={(month) => setPart({ month })} />}
          <PickerColumn title="日" values={Array.from({ length: selectedMonthDays }, (_, index) => index + 1)} value={validDay} onSelect={(day) => setPart({ day })} />
          <PickerColumn title="时" values={HOURS} value={selected.hour} onSelect={(hour) => setPart({ hour })} />
          <PickerColumn title="分" values={MINUTES} value={selected.minute} onSelect={(minute) => setPart({ minute })} />
        </div>}
        <div className="picker-actions">
          <button type="button" onClick={cancelPicker}>取消</button>
          <button className="picker-confirm" type="button" disabled={!canConfirm} onClick={confirmPicker}>确定</button>
        </div>
      </div>
    </div>}
  </div>
}

const stages: { key: ReportStatus; label: string; detail: string }[] = [
  { key: 'idle', label: '填写资料', detail: '个人、住宅、照片证据' },
  { key: 'uploading', label: '上传素材', detail: '校验图片并创建文件记录' },
  { key: 'queued', label: '创建报告', detail: '保存报告记录' },
  { key: 'vision-analyzing', label: '视觉识别', detail: '读取住宅照片与标注信息' },
  { key: 'rules-evaluating', label: '规则评估', detail: '匹配命盘、住宅与专家规则' },
  { key: 'professional-reasoning', label: '专业推理', detail: '判断命盘与住宅是否合拍' },
  { key: 'harness-generating', label: 'Harness 生成', detail: '调用 DeepSeek Harness 生成报告' },
  { key: 'completed', label: '完成报告', detail: '可查看摘要和依据链' },
]

export const investorReportSteps = [
  { key: 'uploading', label: '上传照片', detail: '保存住宅照片与标注' },
  { key: 'vision-analyzing', label: '识别空间', detail: '提取房间、朝向与可见要素' },
  { key: 'rules-evaluating', label: '匹配规则', detail: '结合命盘、住宅与专家资料' },
  { key: 'harness-generating', label: '生成报告', detail: '整理为可阅读报告' },
] as const
type InvestorReportStepKey = (typeof investorReportSteps)[number]['key']

export function investorReportStepState(status: ReportStatus, step: InvestorReportStepKey): 'done' | 'active' | 'upcoming' {
  const order: InvestorReportStepKey[] = ['uploading', 'vision-analyzing', 'rules-evaluating', 'harness-generating']
  const investorStatus = status === 'professional-reasoning' ? 'rules-evaluating' : status
  const normalizedStatus: InvestorReportStepKey | 'idle' | 'completed' | 'failed' | 'cancelled' =
    investorStatus === 'queued' ? 'harness-generating' : investorStatus as InvestorReportStepKey | 'idle' | 'completed' | 'failed' | 'cancelled'
  if (normalizedStatus === 'completed') return 'done'
  if (normalizedStatus === step) return 'active'
  const currentIndex = order.indexOf(normalizedStatus as InvestorReportStepKey)
  const stepIndex = order.indexOf(step)
  return currentIndex > stepIndex ? 'done' : 'upcoming'
}

export function shouldShowInvestorReportProgress(status: ReportStatus, taskId: string): boolean {
  return status !== 'idle' || Boolean(taskId.trim())
}

export function investorReportReadinessSummary(status: ReportReadinessState['status']): string {
  if (status === 'ready') return '生成链路已就绪'
  if (status === 'loading') return '正在检查生成链路'
  if (status === 'not-ready') return '生成链路尚未就绪，展开运行详情查看原因。'
  return '暂时无法确认生成链路，展开运行详情或稍后重试。'
}

export function shouldShowReadinessAdminAction(readiness: Pick<ReportReadinessState, 'status' | 'components'>): boolean {
  void readiness
  return false
}

export type ReportFlowStepState = 'done' | 'active' | 'blocked' | 'idle'
export type ReportFlowStep = { index: number; title: string; detail: string; state: ReportFlowStepState }

export function buildReportFlowSteps({
  hasChart,
  photoCount,
  status,
}: {
  hasChart: boolean
  photoCount: number
  status: ReportStatus
}): ReportFlowStep[] {
  const hasPhotos = photoCount > 0
  const busyStatuses: ReportStatus[] = ['uploading', 'queued', 'vision-analyzing', 'rules-evaluating', 'professional-reasoning', 'harness-generating', 'quality-reviewing', 'harness-revising']
  const busy = busyStatuses.includes(status)
  return [
    {
      index: 1,
      title: '绑定命盘',
      detail: hasChart ? '已绑定可复用命盘' : '先到“我的命盘”生成',
      state: hasChart ? 'done' : 'active',
    },
    {
      index: 2,
      title: '住宅证据',
      detail: hasPhotos ? `已添加 ${photoCount} 张照片` : '上传全屋图和局部照片',
      state: hasPhotos ? 'done' : hasChart ? 'active' : 'blocked',
    },
    {
      index: 3,
      title: '生成报告',
      detail: status === 'completed' ? '报告已保存到历史' : busy ? '正在生成报告' : '确认资料后开始生成',
      state: status === 'completed' ? 'done' : busy ? 'active' : hasChart && hasPhotos ? 'idle' : 'blocked',
    },
  ]
}

export function mapReportPhaseToUiStatus(report: Pick<Report, 'status' | 'phase'>): ReportStatus {
  if (report.phase) return report.phase
  return report.status
}

export function reportPhaseStatusDetail(report: Pick<Report, 'status' | 'phase' | 'error'>, attempt?: number): string {
  const prefix = attempt === undefined ? '' : `第 ${attempt} 次查询任务状态：`
  const status = mapReportPhaseToUiStatus(report)
  switch (status) {
    case 'queued':
      return `${prefix}服务端已创建任务，等待进入分析链路`
    case 'vision-analyzing':
      return `${prefix}正在识别住宅照片和用户标注`
    case 'rules-evaluating':
      return `${prefix}正在匹配命盘、住宅信息和专家规则`
    case 'professional-reasoning':
      return `${prefix}正在判断命盘与住宅格局是否合拍`
    case 'harness-generating':
      return `${prefix}正在通过 DeepSeek Harness 生成报告`
    case 'quality-reviewing':
      return `${prefix}正在由独立审核 Agent 检查报告质量`
    case 'harness-revising':
      return `${prefix}正在根据审核结果修订报告`
    case 'completed':
      return '报告已通过校验并可查看'
    case 'failed':
      return report.error || '报告生成失败'
    case 'uploading':
      return '正在上传素材'
    case 'idle':
      return '等待提交'
    case 'cancelled':
      return '当前请求已停止'
  }
}

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function normalizeAppPath(pathname = window.location.pathname): '/' | '/chart' | '/reports' | string {
  return pathname.replace(/\/+$/, '') || '/'
}

function memberLabel(profile?: MemberChartProfile | null): string {
  return profile?.label?.trim() || (profile?.relationship === 'self' ? '我' : '未命名成员')
}

function TopNavigation({ current, onNavigate, user, members = [], selectedMemberId = '', onSelectMember, onLogout }: {
  current: 'analysis' | 'chart' | 'reports'
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: '/' | '/chart' | '/reports') => void
  user?: AuthUser | null
  members?: MemberChartProfile[]
  selectedMemberId?: string
  onSelectMember?: (profileId: string) => void
  onLogout?: () => void
}) {
  return <nav className="top-navigation" aria-label="主导航">
    <a className="brand" href="/" onClick={(event) => onNavigate(event, '/')}>居境 Compass</a>
    {user && <label className="member-switcher"><span>当前成员</span><select aria-label="当前成员" value={selectedMemberId} onChange={(event) => onSelectMember?.(event.target.value)}>
      <option value="">新增成员</option>
      {members.map((profile) => <option key={profile.id} value={profile.id}>{memberLabel(profile)}</option>)}
    </select></label>}
    <a className="nav-link" data-current={current === 'analysis'} href="/" onClick={(event) => onNavigate(event, '/')}>住宅分析</a>
    <a className="nav-link" data-current={current === 'chart'} href="/chart" onClick={(event) => onNavigate(event, '/chart')}>我的命盘</a>
    <a className="nav-link" data-current={current === 'reports'} href="/reports" onClick={(event) => onNavigate(event, '/reports')}>我的报告</a>
    {user ? <div className="account-menu"><span>{user.displayName}</span><button type="button" onClick={onLogout}>退出</button></div> : null}
  </nav>
}

function LoginPage({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <main className="login-page">
    <section className="login-panel">
      <a className="brand" href="/">居境 Compass</a>
      <div><p className="eyebrow">MEMBER ACCESS</p><h1>登录你的居境档案</h1><p>查看家人命盘、住宅档案和历次分析报告。</p></div>
      <form onSubmit={(event) => {
        event.preventDefault()
        setBusy(true)
        setError('')
        void onLogin(username, password).catch((cause) => setError(cause instanceof Error ? cause.message : '登录失败，请重试。')).finally(() => setBusy(false))
      }}>
        <label>账号<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
        <label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={busy}>{busy ? '正在登录…' : '登录'}</button>
      </form>
      <small>账号由管理员创建，请向服务人员获取。</small>
    </section>
  </main>
}

type RuleProfileSelectionProps = {
  activeRuleProfileVersions: PublishedBaziRuleProfileVersion[]
  selectedRuleProfileVersionId: string
  ruleProfilesLoading: boolean
  ruleProfilesError: string
  onSelectRuleProfileVersion: (versionId: string) => void
  onRetryRuleProfiles: () => void
}

function shortHash(contentHash: string): string {
  return contentHash.replace(/^sha256:/, '').slice(0, 8)
}

function ruleProfileReferenceLabel(reference?: BaziRuleProfileVersionReference): string {
  return reference
    ? `${reference.name} · v${reference.version} · ${shortHash(reference.contentHash)}`
    : '内置规则（未绑定专家发布版本）'
}

function RuleProfilePicker({
  activeRuleProfileVersions,
  selectedRuleProfileVersionId,
  ruleProfilesLoading,
  ruleProfilesError,
  onSelectRuleProfileVersion,
  onRetryRuleProfiles,
}: RuleProfileSelectionProps) {
  const selected = activeRuleProfileVersions.find((version) => version.versionId === selectedRuleProfileVersionId)
  const historicalUnavailable = Boolean(selectedRuleProfileVersionId && !selected)
  return <div className="rule-profile-field wide">
    <label htmlFor="rule-profile-version">排盘流派 / 规则版本</label>
    <select
      id="rule-profile-version"
      value={selectedRuleProfileVersionId}
      disabled={ruleProfilesLoading}
      onChange={(event) => onSelectRuleProfileVersion(event.target.value)}
    >
      <option value="">内置规则（未绑定专家发布版本）</option>
      {historicalUnavailable && <option value={selectedRuleProfileVersionId} disabled>历史绑定版本（当前已停用）</option>}
      {activeRuleProfileVersions.map((version) => <option key={version.versionId} value={version.versionId}>
        {version.name} · v{version.version} · {shortHash(version.contentHash)}
      </option>)}
    </select>
    <div className="rule-profile-state" aria-live="polite">
      {ruleProfilesLoading && <span>正在读取已发布规则…</span>}
      {!ruleProfilesLoading && ruleProfilesError && <span className="rule-profile-error" role="alert">{ruleProfilesError}<button type="button" onClick={onRetryRuleProfiles}>重试</button></span>}
      {!ruleProfilesLoading && !ruleProfilesError && selected && <span>
        已选择 {selected.name} v{selected.version}；时间默认值已回填，下方开关仍可单独修改。
      </span>}
      {!ruleProfilesLoading && !ruleProfilesError && historicalUnavailable && <span className="rule-profile-warning">
        该历史版本已不在可用列表中；历史命盘仍保留原绑定，重新排盘前请选择已发布版本或内置规则。
      </span>}
      {!ruleProfilesLoading && !ruleProfilesError && !selectedRuleProfileVersionId && <span>
        {activeRuleProfileVersions.length
          ? '当前使用内置排盘参数；也可切换已发布的专家规则版本。'
          : '尚无专家审核发布的可用版本，新命盘将明确标记为“未绑定”。'}
      </span>}
    </div>
  </div>
}

export function BirthConfigurationFields({ birth, setBirth, includeGender = false, named = false, inputMode = 'birth-data', manualInput, setManualInput, setInputMode, ...ruleProfileProps }: {
  birth: BirthInput
  setBirth: (birth: BirthInput) => void
  includeGender?: boolean
  named?: boolean
  inputMode?: 'birth-data' | 'manual-four-pillars'
  manualInput?: ManualFourPillarsInput
  setManualInput?: (input: ManualFourPillarsInput) => void
  setInputMode?: (mode: 'birth-data' | 'manual-four-pillars') => void
} & RuleProfileSelectionProps) {
  const useTrueSolarTime = birth.useTrueSolarTime ?? true
  const timeCorrectionRuleVersion = birth.timeCorrectionRuleVersion ?? DEFAULT_TRUE_SOLAR_TIME_RULE_VERSION
  return <>
    <BirthDateTimePicker birth={birth} setBirth={setBirth} inputMode={inputMode} manualInput={manualInput} setManualInput={setManualInput} setInputMode={setInputMode} />
    {named && inputMode === 'birth-data' && <>
      <input type="hidden" name="date" value={birth.date} />
      <input type="hidden" name="time" value={birth.time} />
    </>}
    {includeGender && <label>性别<select value={(inputMode === 'manual-four-pillars' ? manualInput?.gender : birth.gender) ?? ''} onChange={(event) => {
      const gender = (event.target.value || undefined) as BirthInput['gender']
      if (inputMode === 'manual-four-pillars' && manualInput && setManualInput) setManualInput({ ...manualInput, gender })
      else setBirth({ ...birth, gender })
    }}><option value="">未提供</option><option value="male">男</option><option value="female">女</option></select></label>}
    {inputMode === 'birth-data' ? <>
      <BirthplacePicker birth={birth} setBirth={setBirth} />
      <label className="true-solar-toggle"><input type="checkbox" checked={useTrueSolarTime} onChange={(event) => setBirth({ ...birth, useTrueSolarTime: event.target.checked, timeCorrectionRuleVersion: birth.timeCorrectionRuleVersion ?? DEFAULT_TRUE_SOLAR_TIME_RULE_VERSION })} /><span><b>使用真太阳时</b><small>民用时 {birth.date} {birth.time}；生成命盘后显示经度与均时差校正后的时间</small></span></label>
      <details className="advanced-chart-params wide">
        <summary>高级排盘参数</summary>
        <div className="advanced-chart-param-grid">
          <RuleProfilePicker {...ruleProfileProps} />
          {useTrueSolarTime && <label className="true-solar-version-field" htmlFor="true-solar-rule-version">真太阳时算法<select id="true-solar-rule-version" value={timeCorrectionRuleVersion} onChange={(event) => setBirth({ ...birth, timeCorrectionRuleVersion: event.target.value as TrueSolarTimeRuleVersion })}>{TRUE_SOLAR_TIME_RULE_VERSION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          <label>夏令时<select value={birth.dstPolicy ?? 'auto'} onChange={(event) => setBirth({ ...birth, dstPolicy: event.target.value as BirthInput['dstPolicy'] })}><option value="auto">自动识别</option><option value="ignore">不启用</option></select></label>
          <label>早晚子时<select value={birth.dayBoundary ?? 'midnight'} onChange={(event) => setBirth({ ...birth, dayBoundary: event.target.value as BirthInput['dayBoundary'] })}><option value="midnight">午夜换日</option><option value="zi-hour-start">子初换日</option></select></label>
          <label>起运算法<select value={birth.luckMethod ?? 'sect1'} onChange={(event) => setBirth({ ...birth, luckMethod: event.target.value as BirthInput['luckMethod'] })}><option value="sect1">流派一</option><option value="sect2">流派二</option></select></label>
        </div>
      </details>
    </> : <p className="manual-source-pending wide" role="status">真太阳时、节气、起运与流运：需补出生资料。系统不会根据四柱反推出生时间或地点。</p>}
  </>
}

function ChartPage({ onNavigate, user, members, selectedMemberId, onSelectMember, onLogout, newMemberLabel, onNewMemberLabelChange, newMemberRelationship, onNewMemberRelationshipChange, birth, setBirth, inputMode, setInputMode, manualInput, setManualInput, chart, chartVersions, chartVersionsLoading, chartVersionsError, deletedChart, onCalculate, onClear, onRestore, onUseVersion, onRestoreVersion, loading, restoringVersionId, error, auditMessage, currentTimeRuntime, ...ruleProfileProps }: {
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: '/' | '/chart' | '/reports') => void
  user?: AuthUser | null
  members?: MemberChartProfile[]
  selectedMemberId?: string
  onSelectMember?: (profileId: string) => void
  onLogout?: () => void
  newMemberLabel: string
  onNewMemberLabelChange: (label: string) => void
  newMemberRelationship: ChartRelationship
  onNewMemberRelationshipChange: (relationship: ChartRelationship) => void
  birth: BirthInput
  setBirth: (birth: BirthInput) => void
  inputMode: 'birth-data' | 'manual-four-pillars'
  setInputMode: (mode: 'birth-data' | 'manual-four-pillars') => void
  manualInput: ManualFourPillarsInput
  setManualInput: (input: ManualFourPillarsInput) => void
  chart: ChartSnapshot | null
  chartVersions: ChartVersion[] | null
  chartVersionsLoading: boolean
  chartVersionsError: string
  deletedChart: ChartSnapshot | null
  onCalculate: () => void
  onClear: () => void | Promise<void>
  onRestore: () => void | Promise<void>
  onUseVersion: (version: ChartVersion) => void
  onRestoreVersion: (version: ChartVersion) => void | Promise<void>
  loading: boolean
  restoringVersionId: string
  error: string
  auditMessage: string
  currentTimeRuntime?: PublicBaziRuntime | null
} & RuleProfileSelectionProps) {
  const [wenzhenDiff, setWenzhenDiff] = useState<WenzhenDiffResponse | null>(null)
  const [wenzhenDiffError, setWenzhenDiffError] = useState('')
  const [flowTargetDate, setFlowTargetDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [flowTargetTime, setFlowTargetTime] = useState(() => new Date().toTimeString().slice(0, 5))
  const [flow, setFlow] = useState<BaziFlowChart | null>(null)
  const [flowLoading, setFlowLoading] = useState(false)
  const [flowError, setFlowError] = useState('')
  const [chartDetailTab, setChartDetailTab] = useState<ChartDetailTab>('natal')
  const [compatibilityPillars, setCompatibilityPillars] = useState<[string, string, string, string]>(['甲子', '丙寅', '戊辰', '庚午'])
  useEffect(() => {
    if (chartDetailTab !== 'settings') return undefined
    let cancelled = false
    void requestJson<WenzhenDiffResponse>('/api/v1/bazi/wenzhen/diff', { timeoutMs: 15_000 })
      .then((result) => {
        if (!cancelled) setWenzhenDiff(result)
      })
      .catch((cause) => {
        if (!cancelled) setWenzhenDiffError(cause instanceof Error ? cause.message : '问真差异报告暂不可用。')
      })
    return () => {
      cancelled = true
    }
  }, [chartDetailTab])
  const pillarLabels = ['年柱', '月柱', '日柱', '时柱']
  const bazi = chart?.bazi
  const chartInput = chart?.calculationInput
  const manualChart = Boolean(chartInput && isManualFourPillarsInput(chartInput))
  const chartBirth = chartInput && !isManualFourPillarsInput(chartInput) ? chartInput : chart?.birth
  const chartGender = manualChart && chartInput && isManualFourPillarsInput(chartInput) ? chartInput.gender : chartBirth?.gender
  const exportableChart: ChartExportSnapshot | null = chart && chartBirth && !isManualFourPillarsChart(chart.bazi)
    ? {
      profileId: chart.profileId,
      revision: chart.revision,
      version: chart.version,
      birth: chartBirth,
      bazi: chart.bazi,
      savedAt: chart.savedAt,
    }
    : null
  const has = (value: unknown) => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null
  const valueOrPending = (value: unknown) => value && typeof value === 'object' && (value as Partial<PendingSourceRequired>).reason === 'pending-source-required'
    ? '需补出生资料'
    : has(value) ? String(value) : '待计算'
  const cyclePendingLabel = manualChart ? '需补出生资料' : '待计算'
  const flowPendingLabel = manualChart ? '需补出生资料后选择目标日期并计算流盘' : '请选择目标日期并计算流盘'
  const timeCorrectionRuleVersion = bazi && !isManualFourPillarsChart(bazi)
    ? bazi.timeCorrectionRuleVersion ?? bazi.timeProfile?.timeCorrectionRuleVersion
    : undefined
  const { luckCycles: flowLuckCycles, annualCycles: flowAnnualCycles, monthlyCycles: flowMonthlyCycles, dailyCycles: flowDailyCycles, hourlyCycles: flowHourlyCycles } = selectFlowCycleDisplaySources(bazi, flow)
  const currentVersionId = chart?.versionId
  const chartHasCompleteBirthplace = chartBirth ? hasCompleteBirthplaceEvidence(chartBirth) : false
  const calculateFlow = async () => {
    if (!chart?.profileId || !chart.versionId) {
      setFlowError('请先生成并保存命盘，再计算流盘。')
      return
    }
    if (manualChart) {
      setFlowError('手动四柱不包含出生时刻，流运需补出生资料后计算。')
      return
    }
    setFlowLoading(true)
    setFlowError('')
    try {
      const result = await requestJson<{ flow: BaziFlowChart }>(`/api/v1/charts/${chart.profileId}/flow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildBaziFlowRequest(chart.versionId, flowTargetDate, flowTargetTime)),
        timeoutMs: 15_000,
      })
      setFlow(result.flow)
    } catch (cause) {
      setFlow(null)
      setFlowError(cause instanceof Error ? cause.message : '流盘计算失败，请检查目标时间。')
    } finally {
      setFlowLoading(false)
    }
  }
  const versionHistory = !chartVersionsLoading && !chartVersionsError && !(chartVersions?.length)
    ? null
    : <div className={`chart-version-history ${chart ? '' : 'empty-history'}`}>
      <div className="section-head"><div><p className="kicker">VERSION HISTORY</p><h3>历史版本</h3></div><span>{chartVersions?.length ?? 0} 版</span></div>
      {chartVersionsLoading && <p className="pending">正在读取历史版本…</p>}
      {chartVersionsError && <p className="chart-error" role="alert">{chartVersionsError}</p>}
      {chartVersions && chartVersions.length > 0 && <div className="version-grid">
        {chartVersions.map((version) => {
          const isCurrent = currentVersionId === version.id
          const canRestore = canRestoreChartVersion(version.id, currentVersionId)
          const versionInput = calculationInputFromVersion(version)
          const manualVersion = isManualFourPillarsInput(versionInput)
          return <article key={version.id} className={`version-card ${isCurrent ? 'active' : ''}`}>
            <strong>v{version.version}</strong>
            <span>{manualVersion ? versionInput.pillars.join(' · ') : `${versionInput.date} ${versionInput.time}`}</span>
            <small>{manualVersion ? '手动四柱 · 不含出生资料推导' : versionInput.locationName}</small>
            <small>{ruleProfileReferenceLabel(version.ruleProfileVersion)}</small>
            <small>{isCurrent ? '当前版本 · 不能恢复当前版本' : '历史版本 · 可回填或恢复为当前版本'}</small>
            <div className="version-actions">
              <button type="button" onClick={() => onUseVersion(version)} disabled={loading}>回填到表单</button>
              {canRestore && <button type="button" className="restore-version" onClick={() => onRestoreVersion(version)} disabled={loading || restoringVersionId === version.id}>
                {restoringVersionId === version.id ? '正在恢复' : '恢复为当前版本'}
              </button>}
            </div>
          </article>
        })}
      </div>}
    </div>
  return <main className="shell chart-page">
    <TopNavigation current="chart" onNavigate={onNavigate} user={user} members={members} selectedMemberId={selectedMemberId} onSelectMember={onSelectMember} onLogout={onLogout} />
    <header className="chart-hero">
      <div><p className="eyebrow">PERSONAL CHART</p><h1>{members?.find((profile) => profile.id === selectedMemberId) ? `${memberLabel(members.find((profile) => profile.id === selectedMemberId))}的命盘` : '新建成员命盘'}</h1><p>命盘由程序独立排算，不依赖住宅照片或模型解读。保存后可从顶部导航随时回来查看。</p></div>
      <span>{inputMode === 'manual-four-pillars' ? '手动四柱 · 不反推出生资料' : birth.useTrueSolarTime ?? true ? '北京时间 + 真太阳时' : '北京时间（不校正真太阳时）'}</span>
    </header>
    {!selectedMemberId && <section className="new-member-fields" aria-label="新成员资料">
      <label>成员称呼<input value={newMemberLabel} onChange={(event) => onNewMemberLabelChange(event.target.value)} placeholder="例如：我、妻子、妈妈" /></label>
      <label>与我的关系<select value={newMemberRelationship} onChange={(event) => onNewMemberRelationshipChange(event.target.value as ChartRelationship)}>
        <option value="self">本人</option><option value="partner">伴侣</option><option value="parent">父母</option><option value="child">子女</option><option value="other">亲友</option>
      </select></label>
    </section>}

    <div className="chart-page-tabs" aria-label="命盘视图">
      <div className="primary-chart-tabs" role="tablist" aria-label="命盘一级视图">
        {chartPageTabs.map((tab) => <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={chartDetailTab === tab.key}
          data-selected={chartDetailTab === tab.key}
          aria-controls={`chart-tab-${tab.key}`}
          onClick={() => setChartDetailTab(tab.key)}
        >{tab.label}</button>)}
      </div>
      {chartUtilityTabs.length > 0 && <div className="utility-chart-tabs" role="tablist" aria-label="命盘参数设置">
        {chartUtilityTabs.map((tab) => <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={chartDetailTab === tab.key}
          data-selected={chartDetailTab === tab.key}
          aria-controls={`chart-tab-${tab.key}`}
          onClick={() => setChartDetailTab(tab.key)}
        >{tab.label}</button>)}
      </div>}
    </div>

    {chartDetailTab === 'compatibility' && <section id="chart-tab-compatibility" className="chart-tab-page compatibility-layout" role="tabpanel" aria-label="合盘">
      <article className="card chart-section compatibility-empty">
        <div className="section-head"><div><p className="kicker">PAIR INPUT</p><h2>合盘</h2></div><span>{chart ? '已绑定本人' : '待本人生辰'}</span></div>
        <p className="section-caption">合盘复用“我的命盘”的当前版本，再录入另一份四柱。当前阶段只展示可见五行、日主和基础合冲，不让模型直接给关系判断。</p>
        <div className="compatibility-preview">
          <div><small>本人命盘</small><strong>{chart?.bazi.pillars.join(' · ') || '尚未生成'}</strong><span>{chart ? `版本 ${chart.version ?? 1}` : '先到“生辰”生成命盘'}</span></div>
          <div><small>对方四柱</small><strong>{compatibilityPillars.join(' · ')}</strong><span>演示版先用四柱选择，后续可接第二命盘档案。</span></div>
        </div>
        <fieldset className="compatibility-pillar-picker">
          <legend>对方四柱</legend>
          {pillarLabels.map((label, index) => <label key={label}>{label}<select value={compatibilityPillars[index]} onChange={(event) => setCompatibilityPillars((current) => {
            const next = [...current] as [string, string, string, string]
            next[index] = event.target.value
            return next
          })}>{SEXAGENARY_CYCLE.map((pillar) => <option key={pillar} value={pillar}>{pillar}</option>)}</select></label>)}
        </fieldset>
        <button type="button" className="primary" onClick={() => setChartDetailTab('natal')}>{chart ? '查看生辰盘' : '先生成生辰盘'}</button>
      </article>

      <article className="card chart-section">
        <div className="section-head"><div><p className="kicker">PAIR SUMMARY</p><h2>合盘摘要</h2></div><span>{chart ? '程序摘要' : '待本人命盘'}</span></div>
        <div className="compatibility-summary-grid">
          {buildCompatibilitySummaryCards(chart?.bazi, { pillars: compatibilityPillars }).map((item) => <div key={item.label} data-state={item.state}>
            <small>{item.label}</small>
            <strong>{item.value}</strong>
            <span>{item.detail}</span>
          </div>)}
        </div>
        <p className="section-caption">这是基础盘面对照，不等同于完整合婚或关系结论。完整版本会使用已发布的合盘规则，并保存规则版本与引用依据。</p>
      </article>
    </section>}

    {chartDetailTab === 'natal' && <section id="chart-tab-natal" className="chart-layout" role="tabpanel" aria-label="生辰">
      <article className="card chart-profile">
        <p className="kicker">BIRTH RECORD</p>
        <h2>出生资料</h2>
        <div className="fields">
          <BirthConfigurationFields birth={birth} setBirth={setBirth} inputMode={inputMode} setInputMode={setInputMode} manualInput={manualInput} setManualInput={setManualInput} includeGender {...ruleProfileProps} />
        </div>
        <div className="chart-actions">
          <button className="primary" type="button" onClick={onCalculate} disabled={loading}>{loading ? '正在排盘' : chart ? '更新命盘' : '生成命盘'}</button>
          {chart && <button type="button" onClick={onClear} disabled={loading}>删除命盘档案</button>}
          {exportableChart && <button type="button" onClick={() => void exportChartAsPng(exportableChart)}>导出图片</button>}
          {exportableChart && chart?.profileId && chart.versionId && <button type="button" onClick={() => downloadChartPdf(chart.profileId!, chart.versionId!)}>导出 PDF</button>}
        </div>
        <small>{inputMode === 'manual-four-pillars' ? '四柱会作为明确的输入快照保存；系统不会伪造出生时间、地点、节气或起运资料。' : '命盘由服务端保存并通过登录账号恢复；地点选择后自动取得时区及经纬度，普通用户无需手填。移除档案不会改写已经生成的报告。'}</small>
        {error && <p className="chart-error" role="alert">{error}</p>}
        {auditMessage && <p className="chart-success" role="status">{auditMessage}</p>}
      </article>

      <article className="card chart-board" aria-live="polite">
        <div className="section-head wenzhen-chart-head">
          <div><p className="kicker">FOUR PILLARS</p><h2>四柱命盘</h2></div>
          {chart && <span>{manualChart ? '手动四柱' : chartBirth?.locationName}</span>}
        </div>
        {chart ? <>
          <div className="wenzhen-chart-meta" aria-label="命盘基本信息">
            <span><small>档案</small><b>{chart.profileId ? `版本 ${chart.version ?? 1}` : '当前命盘'}</b></span>
            <span><small>性别</small><b>{chartGender ? genderLabels[chartGender] : '未提供'}</b></span>
            <span><small>历法</small><b>{manualChart ? '手动四柱' : chartBirth?.calendarSystem === 'lunar' ? '农历' : '公历'}</b></span>
            <span><small>时间规则</small><b>{manualChart ? '需补出生资料' : chartBirth?.useTrueSolarTime ?? true ? '真太阳时' : '北京时间'}</b></span>
          </div>
          <div className="pillar-matrix natal-pillar-matrix" role="table" aria-label="四柱专业排盘信息">
            <div className="matrix-row matrix-head" role="row"><b role="columnheader"></b>{pillarLabels.map((label) => <strong key={label} role="columnheader">{label}</strong>)}</div>
            {professionalPillarMatrixRowLabels.map((label) => <div className="matrix-row" role="row" key={label}>
              <b role="rowheader">{label}</b>
              {pillarLabels.map((_, index) => {
                const value = formatProfessionalPillarMatrixValue(chart.bazi, label, index, chartGender)
                return <span role="cell" className={professionalMatrixCellClass(label, value)} key={`${label}-${index}`}>{renderProfessionalMatrixValue(label, value)}</span>
              })}
            </div>)}
          </div>
          <p className="matrix-note">四柱、藏干、支神、纳音、空亡、地势、自坐与神煞均来自程序排盘；未计算字段显示“待计算”。</p>
          {manualChart && <p className="chart-warning" role="status">手动四柱，不含出生时间推导。真太阳时、节气、起运与流运需补出生资料；系统不会反推或伪造这些字段。</p>}
          {!manualChart && !chartBirth?.gender && <p className="chart-warning" role="status">此命盘是旧版本资料，未记录性别，因此大运方向可能尚未确定。补充性别并点击“更新命盘”即可生成新版本。</p>}
          {!manualChart && !chartHasCompleteBirthplace && <p className="chart-warning" role="status">此命盘缺少省市区、地点编码或纬度证据。请在左侧重新选择出生地点并点击“更新命盘”，后续流盘和报告才有完整复算依据。</p>}
          <dl className="chart-facts">
            <div><dt>原始时间</dt><dd>{manualChart ? '需补出生资料' : `${chartBirth?.date} ${chartBirth?.time}`}</dd></div>
            <div><dt>性别</dt><dd>{chartGender ? genderLabels[chartGender] : '未提供'}</dd></div>
            <div><dt>{manualChart ? '真太阳时' : chartBirth?.useTrueSolarTime ?? true ? '真太阳时' : '采用时间'}</dt><dd>{manualChart ? '需补出生资料' : typeof chart.bazi.correctedLocalTime === 'string' ? chart.bazi.correctedLocalTime.replace('T', ' ') : '需补出生资料'}</dd></div>
            <div><dt>校正量</dt><dd>{manualChart || typeof chart.bazi.correctionMinutes !== 'number' ? '需补出生资料' : `${chart.bazi.correctionMinutes > 0 ? '+' : ''}${chart.bazi.correctionMinutes} 分钟`}</dd></div>
            <div><dt>历法输入</dt><dd>{manualChart ? '手动四柱' : chartBirth?.calendarSystem === 'lunar' ? '农历' : '公历'}</dd></div>
            <div><dt>出生地点</dt><dd>{manualChart ? '需补出生资料' : `${chartBirth?.locationName} · ${chartBirth?.timezone ?? 'Asia/Shanghai'}`}</dd></div>
          </dl>
          <section className="natal-professional-digest" aria-label="生辰专业摘要">
            <div className="digest-head"><b>专业摘要</b><span>程序排盘 · 非模型补写</span></div>
            <div className="digest-grid">
              {buildNatalProfessionalDigest(chart.bazi, manualChart).map((item) => <div key={item.label}>
                <small>{item.label}</small>
                <strong>{item.value}</strong>
              </div>)}
            </div>
            <div className="digest-actions">
              <button type="button" onClick={() => setChartDetailTab('cycles')} disabled={manualChart}>查看流盘</button>
              <button type="button" onClick={() => setChartDetailTab('professional')}>查看专业详情</button>
              <button type="button" onClick={() => setChartDetailTab('settings')}>查看设置</button>
            </div>
          </section>
          <section className="gan-zhi-relation-strip" aria-label="干支关系">
            {buildGanZhiRelationGroups(chart.bazi.relations).map((group) => <div key={group.label}>
              <span>{group.label}</span>
              <strong>{group.value}</strong>
            </div>)}
          </section>
        </> : <div className="chart-empty">
          <b>尚未生成命盘</b>
          <p>{inputMode === 'manual-four-pillars' ? '从 60 甲子合法组合中选择年、月、日、时四柱后即可生成；出生资料相关字段会明确显示为待补。' : '确认左侧出生日期、时间与出生地点后，即可独立排盘。地点选择器会自动带出时区和经纬度，用户不需要手填。'}</p>
          {deletedChart?.profileId && <>
            <button type="button" onClick={onRestore} disabled={loading}>{loading ? '正在恢复' : '恢复最近删除的命盘'}</button>
            <small>版本 {deletedChart.version ?? 1} · {isManualFourPillarsInput(deletedChart.calculationInput) ? '手动四柱' : deletedChart.birth?.locationName}</small>
          </>}
        </div>}
      </article>
    </section>}

    {chartDetailTab === 'professional' && <section id="chart-tab-professional" className="chart-tab-page" role="tabpanel" aria-label="专业详情">
      {chart ? <div className="chart-sections">
      <section className="card chart-section">
        <div className="section-head"><div><p className="kicker">OVERVIEW</p><h2>专业总览</h2></div><span>程序排算</span></div>
        <div className="overview-grid">
          <div><small>日主</small><strong>{formatDayMaster(bazi?.dayMaster)}</strong></div>
          <div><small>五行分布</small><strong>{bazi?.fiveElements ? formatFiveElements(bazi.fiveElements) : '待计算'}</strong></div>
          <div><small>十神</small><strong>{has(bazi?.tenGods) ? bazi?.tenGods?.join(' · ') : '待计算'}</strong></div>
        </div>
        <p className="section-caption">总览只呈现已由排盘引擎计算的结果；尚未落库的推演字段不会由模型补写。</p>
      </section>

      <section className="card chart-section">
        <div className="section-head"><div><p className="kicker">GANZHI RELATIONS</p><h2>干支关系</h2></div><span>确定性字段</span></div>
        <div className="chart-tab-panel relations-tab-panel">
          <div className="relation-panel"><b>天干地支关系</b><span>{formatRelationsSummary(bazi)}</span></div>
          <p className="relation-line">空亡：{formatVoidBranchesSummary(bazi)}</p>
          <div className="available-chart-tools" aria-label="当前命盘能力"><span>当前可用</span><small>保存命盘版本、查看专业表、计算流盘，并可导出 PDF/PNG。</small><span>住宅复用</span><small>住宅分析只绑定当前命盘版本，不需要每次重新排盘。</small></div>
        </div>
      </section>

      <section className="card chart-section assessment-section">
        <div className="section-head"><div><p className="kicker">PROFESSIONAL ASSESSMENTS</p><h2>扶抑中间事实、规则候选与神煞</h2></div><span>规则受控</span></div>
        <p className="section-caption">这些字段依赖具体流派和专家审核；系统只展示后端已计算并通过审核的结果，不由前端或模型补写。</p>
        {(() => {
          const balance = formatBalanceFacts(bazi?.balance)
          return balance ? <div className="balance-facts" aria-label="旺衰程序中间事实">
            <div><small>月令</small><strong>{balance.season}</strong></div>
            <div><small>根气</small><strong>{balance.roots}</strong></div>
            <div><small>生扶</small><strong>{balance.resources}</strong></div>
            <div><small>支持与克泄耗基线</small><strong>{balance.scores}</strong></div>
            <p>程序中间量 · {balance.method}，不等同于任何流派的最终旺衰、格局或喜用结论。</p>
          </div> : <p className="balance-pending">当前命盘尚无旺衰中间事实；旧命盘可重新排算后查看。</p>
        })()}
        {bazi?.monthCommand && <div className="balance-facts" aria-label="月令客观事实">
          <div><small>月令</small><strong>{bazi.monthCommand.branch}</strong></div>
          <div><small>主气</small><strong>{bazi.monthCommand.mainQiStem}</strong></div>
          <div><small>主气十神</small><strong>{bazi.monthCommand.mainQiTenGod}</strong></div>
          <div><small>透干位置</small><strong>{bazi.monthCommand.mainQiVisibleAt.length > 0
            ? bazi.monthCommand.mainQiVisibleAt.map((position) => ({ year: '年干', month: '月干', day: '日干', hour: '时干' })[position]).join('、')
            : '未见主气透干'}</strong></div>
          <p>客观中间事实 · {bazi.monthCommand.method}，供已发布流派规则使用，不直接等同于格局或喜用神。</p>
        </div>}
        {bazi?.supportDimensions && <div className="balance-facts" aria-label="得令得地得助客观依据">
          <div><small>得令依据</small><strong>{bazi.supportDimensions.monthCommandSupports ? '月令主气扶助日主' : '月令主气不扶助日主'}</strong></div>
          <div><small>得地依据</small><strong>{bazi.supportDimensions.rootedAt.length > 0
            ? bazi.supportDimensions.rootedAt.map((position) => ({ year: '年支', month: '月支', day: '日支', hour: '时支' })[position]).join('、')
            : '四支未见同类根'}</strong></div>
          <div><small>同类透干</small><strong>{bazi.supportDimensions.visiblePeerAt.length > 0
            ? bazi.supportDimensions.visiblePeerAt.map((position) => ({ year: '年干', month: '月干', hour: '时干' })[position]).join('、')
            : '未见'}</strong></div>
          <div><small>印星透干</small><strong>{bazi.supportDimensions.visibleResourceAt.length > 0
            ? bazi.supportDimensions.visibleResourceAt.map((position) => ({ year: '年干', month: '月干', hour: '时干' })[position]).join('、')
            : '未见'}</strong></div>
          <p>客观中间事实 · {bazi.supportDimensions.method}，尚未经流派规则综合判定完整旺衰。</p>
        </div>}
        <div className="assessment-grid">
          {([
            [bazi?.assessments?.strength?.ruleVersion === 'baseline-v1' ? '扶抑基线（非完整旺衰）' : '旺衰', bazi?.assessments?.strength],
            ['格局', bazi?.assessments?.pattern],
            ['扶抑方向（基线）', bazi?.assessments?.elementPreference],
            ['神煞', bazi?.assessments?.shenSha],
          ] as const).map(([title, assessment]) => {
            const display = formatProfessionalAssessment(assessment)
            return <div key={title} className="assessment-card"><b>{title}</b><strong>{display.value}</strong><small>{display.state}</small><small>{display.evidence}</small></div>
          })}
        </div>
      </section>
      </div> : <div className="card chart-empty"><b>尚未生成命盘</b><p>先在“生辰”页生成命盘，再查看专业详情。</p></div>}
    </section>}

    {chartDetailTab === 'cycles' && <section id="chart-tab-cycles" className="chart-tab-page" role="tabpanel" aria-label="流盘">
      {chart ? <div className="card chart-section cycles-tab-panel">
          <div className="section-head sub-section-head"><div><p className="kicker">TIME CYCLES</p><h3>大运、流年、流月、流日、流时</h3></div><span>目标时间轴</span></div>
        <div className="flow-query">
          <label>目标日期<input type="date" value={flowTargetDate} onChange={(event) => setFlowTargetDate(event.target.value)} /></label>
          <label>目标时间<input type="time" value={flowTargetTime} onChange={(event) => setFlowTargetTime(event.target.value)} /></label>
          <button type="button" onClick={() => void calculateFlow()} disabled={flowLoading || manualChart}>{flowLoading ? '正在计算流盘' : manualChart ? '需补出生资料' : '计算流盘'}</button>
          {flow && <small>目标：{flow.selection.date} {flow.selection.hourSlotStart}:00 · {flow.target.dayBoundary === 'zi-hour-start' ? '子初换日' : '午夜换日'} · {flow.ruleVersion}</small>}
        </div>
        {flowError && <p className="chart-error" role="alert">{flowError}</p>}
        <div className="flow-timeline-cards" aria-label="当前流盘五层摘要">
          {buildFlowTimelineCards(flow).map((card) => <div key={card.label} data-state={card.state}>
            <small>{card.label}</small>
            <strong>{card.pillar}</strong>
            <span>{card.detail}</span>
          </div>)}
        </div>
        {flow?.targetChart && <div className="flow-target-summary" aria-label="目标时刻流盘摘要">
          <div className="flow-target-pillars">
            {flow.targetChart.pillars.map((pillar, index) => <div key={`${pillar}-${index}`}><small>{pillarLabels[index]}</small><strong>{pillar}</strong><span>{flow.targetChart.tenGods?.[index] ?? '待计算'}</span></div>)}
          </div>
          <dl>
            <div><dt>目标真太阳时</dt><dd>{flow.targetChart.correctedLocalTime.replace('T', ' ')}</dd></div>
            <div><dt>目标五行</dt><dd>{flow.targetChart.fiveElements ? formatFiveElements(flow.targetChart.fiveElements) : '待计算'}</dd></div>
            <div><dt>目标神煞</dt><dd>{flow.targetChart.pillarDetails?.flatMap((pillar) => pillar.shenSha?.names ?? []).filter(Boolean).join('、') || '无基础神煞命中'}</dd></div>
            <div><dt>干支关系</dt><dd>{formatRelationsSummary(flow.targetChart)}</dd></div>
          </dl>
        </div>}
        <div className="cycle-block"><h3>大运</h3>{has(flowLuckCycles) ? <div className="cycle-list">{flowLuckCycles?.map((cycle, index) => <div key={`${cycle.pillar}-${index}`} data-current={flow?.selection.luckCycleIndex === index + 1}><b>{cycle.pillar || '待计算'}</b><span>{legacyCycleLabel(cycle) || `${cycle.startAge ?? '待计算'}岁起`}</span><small>{cycle.startDate || '待计算'} — {cycle.endDate || '待计算'}</small><small>{cycle.direction ? `方向：${cycle.direction === 'forward' ? '顺行' : '逆行'}` : '方向：待计算'}</small><small>状态：{flowCycleStatusLabel(cycle.status)}</small></div>)}</div> : <p className="pending">{cyclePendingLabel}</p>}</div>
        <div className="cycle-block"><h3>流年</h3>{has(flowAnnualCycles) ? <div className="cycle-list">{flowAnnualCycles?.map((cycle, index) => <div key={`${cycle.year}-${index}`} data-current={flow?.selection.year === cycle.year}><b>{cycle.year || '待计算'}</b><span>{cycle.pillar || '待计算'}</span><small>{legacyCycleLabel(cycle) || flowCycleStatusLabel(cycle.status)}</small></div>)}</div> : <p className="pending">{flowPendingLabel}</p>}</div>
        <div className="cycle-block cycle-detail-grid">
          {([
            ['流月', flowMonthlyCycles, (cycle: NonNullable<BaziChart['monthlyCycles']>[number] | BaziFlowChart['monthlyCycles'][number], index: number) => <div key={`${cycle.year}-${cycle.month}-${index}`} data-current={flow?.selection.month === cycle.month}><b>{cycle.year ?? '待计算'}年{cycle.monthName ?? cycle.month ?? '待计算'}月</b><span>{cycle.pillar || '待计算'}</span><small>{cycle.startTerm && cycle.endTerm ? `${cycle.startTerm} ${cycle.startAt ?? ''} → ${cycle.endTerm} ${cycle.endAt ?? ''}` : legacyCycleLabel(cycle) || flowCycleStatusLabel(cycle.status)}</small></div>],
            ['流日', flowDailyCycles, (cycle: NonNullable<BaziChart['dailyCycles']>[number] | BaziFlowChart['dailyCycles'][number], index: number) => <div key={`${cycle.date}-${index}`} data-current={flow?.selection.date === cycle.date}><b>{cycle.date || '待计算'}</b><span>{cycle.pillar || '待计算'}</span><small>{legacyCycleLabel(cycle) || flowCycleStatusLabel(cycle.status)}</small></div>],
            ['流时', flowHourlyCycles, (cycle: NonNullable<BaziChart['hourlyCycles']>[number], index: number) => {
              const [date = cycle.date || '待计算', time = cycle.hour || '待计算'] = (cycle.dateTime || '').split(' ')
              return <div key={`${cycle.dateTime ?? `${cycle.date}-${cycle.hour}`}-${index}`} data-current={flow?.selection.hourSlotStart === cycle.startHour}><b>{date}</b><span>{time.slice(0, 5)} · {cycle.earthlyBranch ? `${cycle.earthlyBranch}时 · ` : ''}{cycle.pillar || '待计算'}</span><small>{legacyCycleLabel(cycle) || flowCycleStatusLabel(cycle.status)}</small></div>
            }],
          ] as const).map(([title, cycles, renderCycle]) => <div key={title}><h3>{title}</h3>{has(cycles) ? <div className="cycle-list">{cycles?.map(renderCycle)}</div> : <p className="pending">{flowPendingLabel}</p>}</div>)}
        </div>
        </div> : <div className="card chart-empty"><b>尚未生成命盘</b><p>先在“生辰”页生成命盘，再计算流盘。</p></div>}
    </section>}

    {chartDetailTab === 'params' && <section id="chart-tab-params" className="chart-tab-page" role="tabpanel" aria-label="参数">
      {chart ? <div className="chart-sections">
      <section className="card chart-section">
        <div className="section-head"><div><p className="kicker">PARAMETERS</p><h2>排盘参数与依据</h2></div><span>可复算</span></div>
        <dl className="chart-facts provenance-facts"><div><dt>时间基准</dt><dd>{manualChart ? '需补出生资料' : `${bazi?.timeProfile?.timezone ?? 'Asia/Shanghai'} · ${chartBirth?.useTrueSolarTime ?? true ? '真太阳时' : '民用时'}`}</dd></div><div><dt>时区数据版本</dt><dd><TimezoneDataVersion provenance={bazi?.timeProfile?.runtimeProvenance} currentProvenance={currentTimeRuntime} /></dd></div><div><dt>校正分钟</dt><dd>{manualChart ? '需补出生资料' : valueOrPending(bazi?.correctionMinutes)}</dd></div><div><dt>标准经线</dt><dd>{manualChart ? '需补出生资料' : bazi?.timeProfile ? `${bazi.timeProfile.standardMeridian}°` : '待计算'}</dd></div><div><dt>时间校正规则</dt><dd>{manualChart ? '需补出生资料' : valueOrPending(timeCorrectionRuleVersion)}</dd></div><div><dt>命盘版本</dt><dd>{`v${chart.version ?? 1}`}</dd></div><div><dt>起运算法</dt><dd>{manualChart ? '需补出生资料' : bazi?.timeProfile?.luckMethod === 'sect2' ? '流派二' : '流派一'}</dd></div><div><dt>引擎规则</dt><dd>{valueOrPending(bazi?.ruleVersion)}</dd></div><div><dt>专家流派版本</dt><dd>{ruleProfileReferenceLabel(chart.ruleProfileVersion)}</dd></div><div><dt>内容指纹</dt><dd>{chart.ruleProfileVersion ? shortHash(chart.ruleProfileVersion.contentHash) : '无（旧版本未绑定）'}</dd></div></dl>
        <p className="section-caption">生辰盘字段会随命盘版本保存；大运、流年、流月、流日、流时按目标时间轴即时计算展示，不会改写出生盘版本。</p>
        <p className="chart-saved">版本 {chart.version ?? 1} · 最近更新：{new Date(chart.savedAt).toLocaleString('zh-CN')}</p>
      </section>
      </div> : <div className="card chart-empty"><b>尚未生成命盘</b><p>先在“生辰”页生成命盘，再查看排盘参数。</p></div>}
    </section>}

    {chartDetailTab === 'settings' && <section id="chart-tab-settings" className="chart-tab-page" role="tabpanel" aria-label="设置">
      {chart ? <div className="chart-sections">
      <section className="card chart-section">
        <div className="section-head"><div><p className="kicker">SETTINGS</p><h2>设置与历史版本</h2></div><span>可恢复</span></div>
        <p className="section-caption">这里放版本历史、删除恢复和问真样例对照；普通看盘时不默认打扰生辰盘阅读。</p>
        {versionHistory}
      </section>
      <section className="card chart-section wenzhen-section">
        <div className="section-head"><div><p className="kicker">WENZHEN PARITY</p><h2>问真对照</h2></div><span>{wenzhenDiff ? `${wenzhenDiff.totals.reportable} 条已入报告` : '读取中'}</span></div>
        {wenzhenDiffError && <p className="chart-error" role="alert">{wenzhenDiffError}</p>}
        {wenzhenDiff && <div className="wenzhen-grid">
          <div><small>待人工采集</small><strong>{wenzhenDiff.totals.pending}</strong></div>
          <div><small>已对照</small><strong>{wenzhenDiff.totals.reportable}</strong></div>
          <div><small>一致</small><strong>{wenzhenDiff.totals.matched}</strong></div>
          <div><small>需复核差异</small><strong>{wenzhenDiff.totals.mismatched}</strong></div>
        </div>}
        {wenzhenDiff && <div className="wenzhen-coverage" aria-label="问真断言覆盖范围">
          <b>断言覆盖</b>
          {formatWenzhenAssertionCoverage(wenzhenDiff.coverage).map((item) => <span key={item.category}><small>{item.label}</small><strong>{item.count}</strong></span>)}
          <em>通过只代表已录入字段一致；未采集字段不会被默认视为通过。</em>
        </div>}
        {wenzhenDiff?.pendingSamples?.length ? <div className="wenzhen-pending">
          {wenzhenDiff.pendingSamples.slice(0, 3).map((sample) => <div key={sample.sampleId}>
            <b>{sample.sampleId}</b>
            <span>出生资料仅在完成人工核验后进入对照</span>
            <small>{sample.notes || '等待问真页面人工核对'}</small>
          </div>)}
        </div> : <p className="pending">暂无待采集样例。</p>}
        <p className="section-caption">这里展示问真样例对照状态。只有人工从问真页面录入并标记为 verified 的样例才会进入一致性统计。</p>
      </section>
      </div> : <div className="card chart-empty"><b>尚未生成命盘</b><p>先在“生辰”页生成命盘，再查看设置和问真验收。</p>{versionHistory}</div>}
    </section>}

    <section className="chart-note">
      <div><p className="kicker">HOW IT WORKS</p><h2>这份命盘会被住宅报告复用</h2></div>
      <p>住宅报告提交时，后端会按同一规则重新计算并保存命盘，模型不会自行推算四柱。命盘内容仅供传统文化研究与娱乐参考。</p>
      <a className="nav-button" href="/">去生成住宅报告</a>
    </section>
  </main>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function stableVersionLabel(version: StableVersion): string {
  return `版本 ${version.version}`
}

export function sourceDependentReportValue(value: unknown, suffix = ''): string {
  if (typeof value === 'string' && value.trim()) return `${value}${suffix}`
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}${suffix}`
  return '需补出生资料'
}

export function reportEvidenceCounts(report: Pick<Report, 'citations' | 'evaluatedRules' | 'vision'>) {
  return {
    citations: report.citations?.length ?? 0,
    rules: report.evaluatedRules?.length ?? 0,
    vision: report.vision?.length ?? 0,
  }
}

type ReportEvidenceCard = { label: '命盘依据' | '住宅照片' | '专家资料' | '规则命中'; value: string; detail: string; state: 'ready' | 'empty' }
type ReportEvidenceInput = Pick<Report, 'citations' | 'evaluatedRules' | 'vision'> & { bazi?: { pillars?: readonly string[] } }

export function buildReportEvidenceCards(report: ReportEvidenceInput): ReportEvidenceCard[] {
  const counts = reportEvidenceCounts(report)
  const pillars = report.bazi?.pillars?.filter(Boolean).join(' · ')
  return [
    {
      label: '命盘依据',
      value: pillars ? '已绑定' : '待确认',
      detail: pillars || '缺少可展示四柱',
      state: pillars ? 'ready' : 'empty',
    },
    {
      label: '住宅照片',
      value: `${counts.vision} 条`,
      detail: counts.vision ? '已完成空间观察' : '未记录视觉观察',
      state: counts.vision ? 'ready' : 'empty',
    },
    {
      label: '专家资料',
      value: `${counts.citations} 条`,
      detail: counts.citations ? '已引用已发布版本' : '未引用专家资料',
      state: counts.citations ? 'ready' : 'empty',
    },
    {
      label: '规则命中',
      value: `${counts.rules} 条`,
      detail: counts.rules ? '已执行确定性规则' : '未记录规则命中',
      state: counts.rules ? 'ready' : 'empty',
    },
  ]
}

function reportEvidencePreview(report: Pick<Report, 'citations' | 'evaluatedRules' | 'vision'>): string[] {
  return [
    ...(report.vision ?? []).slice(0, 2).map((item) => `照片观察：${formatRoomLabel(item.room)} · ${item.summary}`),
    ...(report.citations ?? []).slice(0, 2).map((item) => `专家资料：${item.title}（${stableVersionLabel(item)} · ${item.sourceLabel}）`),
    ...(report.evaluatedRules ?? []).slice(0, 2).map((item) => `规则命中：${item.title}（${stableVersionLabel(item)}）`),
  ]
}

function ReportEvidenceSummary({ report }: { report: ReportEvidenceInput }) {
  const cards = buildReportEvidenceCards(report)
  const previews = reportEvidencePreview(report)
  return <details className="evidence-summary report-support-layer">
    <summary>查看本报告使用的资料与规则</summary>
    <section aria-label="报告依据摘要">
      <div className="evidence-summary-head">
        <b>报告依据摘要</b>
        <span>命盘来自程序排盘，住宅来自照片观察，结论来自专家资料和确定性规则。</span>
      </div>
      <div className="evidence-summary-grid">
        {cards.map((card) => <span key={card.label} data-state={card.state}>
          <small>{card.label}</small>
          <b>{card.value}</b>
          <em>{card.detail}</em>
        </span>)}
      </div>
      {previews.length ? <ul>{previews.map((item) => <li key={item}>{item}</li>)}</ul> : <p>本报告没有可展示的专家资料、规则命中或自动视觉观察；正文只能使用用户提交信息并明确待确认边界。</p>}
    </section>
  </details>
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('请求已取消', 'AbortError'))
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function requestJson<T>(path: string, options: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000)
  const linkedSignal = options.signal
  const abort = () => controller.abort()
  if (linkedSignal?.aborted) controller.abort()
  else linkedSignal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await fetch(path, { credentials: 'same-origin', ...options, signal: controller.signal })
    const text = await response.text()
    const result = text ? JSON.parse(text) as T & { error?: string } : {} as T & { error?: string }
    if (!response.ok) {
      if (response.status === 401 && !path.includes('/auth/session') && !path.includes('/auth/login')) window.dispatchEvent(new Event('fengshui:unauthorized'))
      throw new ApiError(result.error || `请求失败（HTTP ${response.status}）`, response.status, result)
    }
    return result
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw new Error('请求已取消或超时，请稍后重试。')
    throw cause
  } finally {
    window.clearTimeout(timeout)
    linkedSignal?.removeEventListener('abort', abort)
  }
}

export async function waitForReport(id: string, signal: AbortSignal, onStatus: (status: ReportStatus, attempt: number, report: Report) => void): Promise<Report> {
  const startedAt = Date.now()
  let attempt = 0
  while (Date.now() - startedAt < 180_000) {
    attempt += 1
    const report = await requestJson<Report>(`/api/v1/reports/${id}`, { signal, timeoutMs: 15_000 })
    onStatus(mapReportPhaseToUiStatus(report), attempt, report)
    if (report.status === 'completed') return report
    if (report.status === 'failed') throw new Error(report.error || '模型报告生成失败，输入资料已保留。')
    const delay = Math.min(1_500 * attempt, 8_000)
    await sleep(delay, signal)
  }
  throw new Error(`报告仍在生成。报告 ${id.slice(0, 8)} 已保存，可稍后到“我的报告”查看。`)
}

function formatDateTimeLabel(value?: string): string {
  if (!value) return '时间未知'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export const REPORT_HISTORY_REFRESH_MS = 8_000

export function reportHistoryStatusLabel(report: Pick<ReportSummary, 'status' | 'phase'> | Pick<Report, 'status' | 'phase'>): string {
  if (report.status === 'completed') return '已完成'
  if (report.status === 'failed') return '生成失败'
  switch (report.phase ?? report.status) {
    case 'vision-analyzing':
      return '识别空间'
    case 'rules-evaluating':
      return '匹配规则'
    case 'harness-generating':
      return '生成报告'
    default:
      return '排队中'
  }
}

export function reportHistoryMetaLine(report: Pick<ReportSummary, 'photoCount' | 'chartVersionId' | 'phase' | 'status'>): string {
  const phaseLabel = report.status === 'completed' || report.status === 'failed' ? reportHistoryStatusLabel(report) : `进行到：${reportHistoryStatusLabel(report)}`
  return `${report.photoCount} 张照片 · ${report.chartVersionId ? '已绑定命盘' : '未绑定命盘'} · ${phaseLabel}`
}

export function reportHistoryTitle(report: Pick<ReportSummary, 'residenceFacing'>): string {
  return report.residenceFacing ? `住宅朝${directionLabels[report.residenceFacing] ?? report.residenceFacing}分析` : '住宅分析报告'
}

export function reportHistoryPreview(value?: string): string {
  if (!value) return ''
  return value
    .replace(/```(?:[\w-]+)?\s*([\s\S]*?)```/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/(^|\s)[-+]\s+/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function ChartReferenceCard({ chart }: { chart: ChartSnapshot | null }) {
  if (!chart?.profileId || !chart.versionId) {
    return <article className="card chart-reference-card empty-reference">
      <p className="kicker">PERSONAL CHART</p>
      <h2>先建立命盘</h2>
      <p>住宅报告必须绑定一份已保存的命盘版本。命盘只需要建立一次，后续住宅分析都复用它。</p>
      <a className="primary nav-button" href="/chart">去生成命盘</a>
    </article>
  }
  const calculationInput = chart.calculationInput
  const manual = isManualFourPillarsInput(calculationInput)
  const birthRecord = !manual ? calculationInput : chart.birth
  return <article className="card chart-reference-card">
    <p className="kicker">PERSONAL CHART</p>
    <div className="section-head">
      <div><h2>已绑定我的命盘</h2><span className="quiet-meta">版本 {chart.version ?? 1} · {formatDateTimeLabel(chart.savedAt)}</span></div>
      <a href="/chart">查看命盘</a>
    </div>
    <div className="compact-pillars" aria-label="已绑定四柱">
      {chart.bazi.pillars.map((pillar, index) => <span key={`${pillar}-${index}`}><small>{['年', '月', '日', '时'][index]}柱</small><b>{pillar}</b></span>)}
    </div>
    <dl className="compact-facts">
      <div><dt>出生地点</dt><dd>{manual ? '手动四柱' : birthRecord?.locationName ?? '未记录'}</dd></div>
      <div><dt>时间规则</dt><dd>{manual ? '需补出生资料' : birthRecord?.useTrueSolarTime ?? true ? '真太阳时' : '民用时'}</dd></div>
      <div><dt>规则版本</dt><dd>{ruleProfileReferenceLabel(chart.ruleProfileVersion)}</dd></div>
    </dl>
  </article>
}

function ResidenceProfileCard({
  profiles,
  selectedProfileId,
  draft,
  loading,
  error,
  savedMessage,
  onSelect,
  onDraftChange,
  onRefresh,
}: {
  profiles: ResidenceProfile[]
  selectedProfileId: string
  draft: ResidenceSnapshot
  loading: boolean
  error: string
  savedMessage: string
  onSelect: (profileId: string) => void
  onDraftChange: (draft: ResidenceSnapshot) => void
  onRefresh: () => void
}) {
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId)
  const editingExisting = Boolean(selectedProfile)
  const updateDraft = (patch: Partial<ResidenceSnapshot>) => onDraftChange({
    ...draft,
    schemaVersion: 'residence-snapshot-v1',
    ...patch,
  })
  return <article className="card home">
    <p className="kicker">RESIDENCE RECORD</p>
    <div className="section-head">
      <div>
        <h2>选择住宅档案</h2>
        <span className="quiet-meta">{editingExisting ? `版本 ${selectedProfile!.currentVersion.version} · 修订 ${selectedProfile!.revision}` : '生成报告前会先保存为新档案'}</span>
      </div>
      <button type="button" className="secondary" disabled={loading} onClick={onRefresh}>{loading ? '刷新中' : '刷新'}</button>
    </div>
    <div className="fields">
      <label className="wide">住宅档案<select
        aria-label="住宅档案"
        value={selectedProfileId || '__new__'}
        onChange={(event) => onSelect(event.target.value === '__new__' ? '' : event.target.value)}
      >
        <option value="__new__">新建住宅档案</option>
        {profiles.map((profile) => <option key={profile.id} value={profile.id}>
          {profile.currentVersion.snapshot.label} · v{profile.currentVersion.version}
        </option>)}
      </select></label>
      <label>住宅名称<input
        name="residenceLabel"
        value={draft.label}
        readOnly={editingExisting}
        onInput={(event) => updateDraft({ label: event.currentTarget.value })}
        onChange={(event) => updateDraft({ label: event.target.value })}
        placeholder="例如：滨江南向户型"
      /></label>
      <label>住宅整体朝向<select
        name="residenceFacing"
        value={draft.facing}
        disabled={editingExisting}
        onChange={(event) => updateDraft({ facing: event.target.value as Direction })}
      >{Object.entries(directionLabels).map(([value, label]) => <option key={value} value={value}>朝{label}</option>)}</select></label>
      <label className="wide">格局补充<textarea
        name="layoutNote"
        value={draft.layoutNote ?? ''}
        readOnly={editingExisting}
        onInput={(event) => updateDraft({ layoutNote: event.currentTarget.value })}
        onChange={(event) => updateDraft({ layoutNote: event.target.value })}
        placeholder="例如：客厅连接南向阳台，主卧在西侧。"
      /></label>
    </div>
    <div className="plan">{editingExisting
      ? '报告会绑定所选住宅的当前不可变版本；如另一页面更新了住宅，系统会提示刷新。'
      : '新住宅会先保存为档案，再和本次照片、命盘一起生成报告。'}
    </div>
    {savedMessage && <p className="inline-success" role="status">{savedMessage}</p>}
    {error && <p className="inline-warning" role="alert">{error}</p>}
  </article>
}

function ReportsPage({
  onNavigate,
  user,
  members,
  residences,
  selectedMemberId,
  onSelectMember,
  onLogout,
  reportScope,
  onReportScopeChange,
  selectedReportResidenceId,
  onSelectReportResidence,
  reports,
  selectedReport,
  loading,
  detailLoading,
  error,
  onRefresh,
  onOpenReport,
  onArchiveReport,
  onRestoreReport,
  reportActionBusyId,
}: {
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: '/' | '/chart' | '/reports') => void
  user?: AuthUser | null
  members?: MemberChartProfile[]
  residences?: ResidenceProfile[]
  selectedMemberId?: string
  onSelectMember?: (profileId: string) => void
  onLogout?: () => void
  reportScope: 'current' | 'all' | 'archived'
  onReportScopeChange: (scope: 'current' | 'all' | 'archived') => void
  selectedReportResidenceId?: string
  onSelectReportResidence?: (profileId: string) => void
  reports: ReportSummary[]
  selectedReport: Report | null
  loading: boolean
  detailLoading: boolean
  error: string
  onRefresh: () => void
  onOpenReport: (id: string) => void
  onArchiveReport: (id: string) => Promise<void>
  onRestoreReport: (id: string) => Promise<void>
  reportActionBusyId: string
}) {
  const selectedReportUsesCurrentValidator = selectedReport?.generationProvenance?.validatorVersion === CURRENT_REPORT_VALIDATOR_VERSION
  const activeReport = selectedReport?.status === 'completed' && selectedReport.report?.trim() && selectedReportUsesCurrentValidator ? selectedReport : null
  const printableHistoryReport = activeReport && isBirthDataBaziChart(activeReport.bazi)
    ? { ...activeReport, bazi: activeReport.bazi }
    : null
  const selectedReportIsArchived = Boolean(selectedReport?.archivedAt || reportScope === 'archived')
  const selectedReportCanArchive = Boolean(selectedReport && !selectedReportIsArchived && selectedReport.status !== 'queued')
  const selectedReportCanRestore = Boolean(selectedReport && selectedReportIsArchived)
  const selectedReportId = selectedReport?.id ?? ''
  const selectedMember = members?.find((profile) => profile.id === selectedMemberId)
  const selectedResidence = residences?.find((profile) => profile.id === selectedReportResidenceId)
  const scopeTitle = reportScope === 'archived'
    ? '回收站里的报告'
    : reportScope === 'all'
      ? '全部成员的报告'
      : `${selectedMember ? memberLabel(selectedMember) : '当前成员'}的报告`
  const residenceScopeTitle = selectedResidence?.currentVersion.snapshot.label ?? '全部住宅'
  return <main className="shell reports-page">
    <TopNavigation current="reports" onNavigate={onNavigate} user={user} members={members} selectedMemberId={selectedMemberId} onSelectMember={onSelectMember} onLogout={onLogout} />
    <header className="page-title-row">
      <div><p className="eyebrow">REPORT HISTORY</p><h1>我的报告</h1><p>住宅分析报告按生成时间保存。命盘是个人档案，报告是一次住宅案例。</p></div>
      <button type="button" onClick={onRefresh} disabled={loading}>{loading ? '刷新中' : '刷新'}</button>
    </header>
    {error && <p className="chart-error" role="alert">{error}</p>}
    <div className="report-scope-tabs" role="group" aria-label="报告范围">
      <button type="button" data-selected={reportScope === 'current'} onClick={() => onReportScopeChange('current')}>当前成员</button>
      <button type="button" data-selected={reportScope === 'all'} onClick={() => onReportScopeChange('all')}>全部成员</button>
      <button type="button" data-selected={reportScope === 'archived'} onClick={() => onReportScopeChange('archived')}>回收站</button>
    </div>
    {residences?.length ? <label className="report-residence-filter">
      <span>住宅</span>
      <select
        aria-label="报告住宅筛选"
        value={selectedReportResidenceId ?? ''}
        onChange={(event) => onSelectReportResidence?.(event.currentTarget.value)}
      >
        <option value="">全部住宅</option>
        {residences.map((profile) => <option key={profile.id} value={profile.id}>{profile.currentVersion.snapshot.label}</option>)}
      </select>
    </label> : null}
    <p className="report-scope-summary" role="status">{scopeTitle} · {residenceScopeTitle} · {loading ? '正在读取' : `${reports.length} 份`}</p>
    <section className="reports-layout">
      <div className="report-list" aria-live="polite">
        {loading && <p className="pending">正在读取报告历史…</p>}
        {!loading && !reports.length && <article className="empty-state">
          <h2>还没有住宅报告</h2>
          <p>先在“我的命盘”建立命盘，再回到“住宅分析”上传住宅照片生成第一份报告。</p>
          <a className="primary nav-button" href="/">去住宅分析</a>
        </article>}
        {reports.map((item) => <button
          key={item.id}
          type="button"
          className="report-list-item"
          data-current={selectedReport?.id === item.id}
          onClick={() => onOpenReport(item.id)}
        >
          <span><b>{reportHistoryStatusLabel(item)}</b><small>{formatDateTimeLabel(item.createdAt)}</small></span>
          <strong>{reportHistoryTitle(item)}</strong>
          <small className="report-member-name">{memberLabel(members?.find((profile) => profile.id === item.chartProfileId))}</small>
          <small>{reportHistoryMetaLine(item)}</small>
          {item.reportPreview && <em>{reportHistoryPreview(item.reportPreview)}</em>}
        </button>)}
      </div>
      <article className="report-detail-panel">
        <div className="section-head">
          <div><p className="kicker">PREVIEW</p><h2>报告预览</h2></div>
          <div className="report-detail-actions">
            {selectedReport && <span>{reportHistoryStatusLabel(selectedReport)}</span>}
            {printableHistoryReport && <button type="button" onClick={() => downloadReportPdf(printableHistoryReport.id)}>下载 PDF</button>}
            {selectedReportCanArchive && <button type="button" onClick={() => void onArchiveReport(selectedReportId)} disabled={reportActionBusyId === selectedReportId}>
              {reportActionBusyId === selectedReportId ? '移动中…' : '移入回收站'}
            </button>}
            {selectedReportCanRestore && <button type="button" onClick={() => void onRestoreReport(selectedReportId)} disabled={reportActionBusyId === selectedReportId}>
              {reportActionBusyId === selectedReportId ? '恢复中…' : '恢复报告'}
            </button>}
            <button type="button" onClick={onRefresh} disabled={loading || detailLoading}>刷新</button>
            <a className="nav-button" href="/">新建分析</a>
          </div>
        </div>
        {detailLoading && <p className="pending">正在打开报告…</p>}
        {!detailLoading && !selectedReport && <p className="pending">从左侧选择一份报告查看正文。</p>}
        {!detailLoading && selectedReport?.status === 'failed' && <p className="chart-error">{selectedReport.error || '报告生成失败。'}</p>}
        {!detailLoading && selectedReport?.status === 'queued' && <p className="pending">这份报告正在{reportHistoryStatusLabel(selectedReport)}，页面会自动刷新。</p>}
        {!detailLoading && selectedReport?.status === 'completed' && !activeReport && <article className="result result-outdated" role="alert">
          <div className="result-head">
            <div><p className="kicker">REPORT UPDATE REQUIRED</p><h2>这份旧报告需要重新生成</h2></div>
          </div>
          <p>旧报告使用了早期格式，正文可能包含内部字段或调试信息，因此已停止展示。请回到“住宅分析”用当前命盘和住宅资料重新生成。</p>
        </article>}
        {!detailLoading && activeReport && <>
          <ReportMarkdown report={activeReport.report ?? ''} />
          <ReportEvidenceSummary report={activeReport} />
          <details className="provenance report-meta-disclosure">
            <summary>生成与版本信息</summary>
            <dl className="report-detail-facts" aria-label="报告基础信息">
              <div><dt>生成时间</dt><dd>{formatDateTimeLabel(activeReport.createdAt)}</dd></div>
              <div><dt>报告编号</dt><dd>{activeReport.id.slice(0, 8)}</dd></div>
              <div><dt>命盘</dt><dd>{activeReport.chartVersionId ? '已绑定' : '未绑定'}</dd></div>
              <div><dt>模型校验</dt><dd>{activeReport.generationProvenance?.validatorVersion ? '已通过' : '未记录'}</dd></div>
            </dl>
            <div className="summary-grid compact-summary">
              <div><span>状态</span><strong>已生成</strong></div>
              <div><span>四柱</span><strong>{activeReport.bazi.pillars.join(' · ')}</strong></div>
              <div><span>照片</span><strong>{activeReport.vision?.length ?? 0} 条观察</strong></div>
              <div><span>依据</span><strong>{(activeReport.citations?.length ?? 0) + (activeReport.evaluatedRules?.length ?? 0)} 条</strong></div>
            </div>
          </details>
        </>}
      </article>
    </section>
  </main>
}

type SharedReportRoute = { reportId: string; accessToken: string }

function parseSharedReportRoute(pathname = window.location.pathname, hash = window.location.hash): SharedReportRoute | null {
  const match = pathname.match(/^\/shared-report\/([^/]+)\/?$/)
  if (!match?.[1]) return null
  const accessToken = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('access')?.trim() ?? ''
  return { reportId: decodeURIComponent(match[1]), accessToken }
}

function SharedReportPage() {
  const route = parseSharedReportRoute()
  const [sharedReport, setSharedReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(Boolean(route?.accessToken))
  const [error, setError] = useState(route?.accessToken ? '' : '分享链接无效或已过期。')
  const canShowSharedReport = sharedReport?.status === 'completed'
    && Boolean(sharedReport.report?.trim())
    && sharedReport.generationProvenance?.validatorVersion === CURRENT_REPORT_VALIDATOR_VERSION

  useEffect(() => {
    if (!route?.accessToken) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setSharedReport(null)
    void requestJson<Report>(`/api/v1/shared-reports/${encodeURIComponent(route.reportId)}`, {
      headers: { 'x-report-share-token': route.accessToken },
      signal: controller.signal,
      timeoutMs: 15_000,
    })
      .then((report) => {
        if (controller.signal.aborted) return
        if (
          report.status !== 'completed'
          || !report.report?.trim()
          || report.generationProvenance?.validatorVersion !== CURRENT_REPORT_VALIDATOR_VERSION
        ) {
          setError('分享报告暂不可查看，请让分享者重新生成当前版本报告。')
          return
        }
        setSharedReport(report)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '分享链接无效或已过期。')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [route?.reportId, route?.accessToken])

  return <main className="shell shared-report-page">
    <header className="shared-report-header">
      <a className="brand" href="/">居境 Compass</a>
      <div>
        <p className="eyebrow">SHARED REPORT</p>
        <h1>共享住宅报告</h1>
        <p>这是一份只读分享报告，仅展示已通过当前校验的正文和依据摘要。</p>
      </div>
    </header>
    {loading && <article className="shared-report-state" role="status"><h2>正在读取分享报告</h2><p>请稍候，正在验证分享访问权限。</p></article>}
    {!loading && error && <article className="shared-report-state error-state" role="alert"><h2>无法查看这份报告</h2><p>{error}</p></article>}
    {!loading && canShowSharedReport && <article className="report-detail-panel shared-report-detail">
      <div className="section-head">
        <div><p className="kicker">READ ONLY</p><h2>住宅文化分析报告</h2></div>
        <span className="readonly-badge">只读分享</span>
      </div>
      <ReportMarkdown report={sharedReport.report ?? ''} />
      <ReportEvidenceSummary report={sharedReport} />
      <details className="provenance report-meta-disclosure">
        <summary>生成与版本信息</summary>
        <dl className="report-detail-facts" aria-label="报告基础信息">
          <div><dt>生成时间</dt><dd>{formatDateTimeLabel(sharedReport.createdAt)}</dd></div>
          <div><dt>报告编号</dt><dd>{sharedReport.id.slice(0, 8)}</dd></div>
          <div><dt>命盘</dt><dd>{sharedReport.chartVersionId ? '已绑定' : '未绑定'}</dd></div>
          <div><dt>模型校验</dt><dd>已通过</dd></div>
        </dl>
      </details>
    </article>}
  </main>
}

export function App() {
  const fileInput = useRef<HTMLInputElement>(null)
  const activeController = useRef<AbortController | null>(null)
  const resultRef = useRef<HTMLElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const photoPreviews = useRef<string[]>([])
  const keepNewMemberDraftRef = useRef(false)
  const [photos, setPhotos] = useState<PhotoDraft[]>([])
  const [status, setStatus] = useState<ReportStatus>('idle')
  const [statusDetail, setStatusDetail] = useState('等待提交')
  const [error, setError] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [taskId, setTaskId] = useState('')
  const [birth, setBirth] = useState<BirthInput>(() => normalizeStoredBirthInput(readLocalJson<unknown>(BIRTH_STORAGE_KEY, defaultBirth)))
  const [manualFourPillarsInput, setManualFourPillarsInput] = useState<ManualFourPillarsInput>(() => normalizeManualFourPillarsInput(readLocalJson<unknown>(MANUAL_PILLARS_STORAGE_KEY, defaultManualFourPillarsInput)))
  const [chartInputMode, setChartInputMode] = useState<'birth-data' | 'manual-four-pillars'>(() => readLocalJson(CHART_INPUT_MODE_STORAGE_KEY, 'birth-data'))
  const [chart, setChart] = useState<ChartSnapshot | null>(() => readLocalJson<ChartSnapshot | null>(CHART_STORAGE_KEY, null))
  const [deletedChart, setDeletedChart] = useState<ChartSnapshot | null>(() => readLocalJson<ChartSnapshot | null>(DELETED_CHART_STORAGE_KEY, null))
  const [chartVersions, setChartVersions] = useState<ChartVersion[] | null>(null)
  const [chartVersionsLoading, setChartVersionsLoading] = useState(false)
  const [chartVersionsError, setChartVersionsError] = useState('')
  const [chartAuditMessage, setChartAuditMessage] = useState('')
  const [currentTimeRuntime, setCurrentTimeRuntime] = useState<PublicBaziRuntime | null | undefined>(undefined)
  const [restoringVersionId, setRestoringVersionId] = useState('')
  const [activeRuleProfileVersions, setActiveRuleProfileVersions] = useState<PublishedBaziRuleProfileVersion[]>([])
  const [selectedRuleProfileVersionId, setSelectedRuleProfileVersionId] = useState(() => (
    readLocalJson<string>(RULE_PROFILE_STORAGE_KEY, '')
    || readLocalJson<ChartSnapshot | null>(CHART_STORAGE_KEY, null)?.ruleProfileVersion?.versionId
    || ''
  ))
  const [ruleProfilesLoading, setRuleProfilesLoading] = useState(true)
  const [ruleProfilesError, setRuleProfilesError] = useState('')
  const [ruleProfilesRetry, setRuleProfilesRetry] = useState(0)
  const [chartLoading, setChartLoading] = useState(false)
  const [chartError, setChartError] = useState('')
  const [currentPath, setCurrentPath] = useState(() => normalizeAppPath())
  const isChartPage = currentPath === '/chart'
  const isReportsPage = currentPath === '/reports'
  const isSharedReportPage = currentPath.startsWith('/shared-report/')
  const isAnalysisPage = currentPath === '/'
  const [reportReadiness, setReportReadiness] = useState<ReportReadinessState>(reportReadinessLoading)
  const [reportReadinessRetry, setReportReadinessRetry] = useState(0)
  const [reportSummaries, setReportSummaries] = useState<ReportSummary[]>([])
  const [reportsLoading, setReportsLoading] = useState(false)
  const [reportsError, setReportsError] = useState('')
  const [reportsRetry, setReportsRetry] = useState(0)
  const [selectedHistoryReport, setSelectedHistoryReport] = useState<Report | null>(null)
  const [reportDetailLoading, setReportDetailLoading] = useState(false)
  const [reportActionBusyId, setReportActionBusyId] = useState('')
  const [residenceProfiles, setResidenceProfiles] = useState<ResidenceProfile[]>([])
  const [selectedResidenceProfileId, setSelectedResidenceProfileId] = useState('')
  const [residenceDraft, setResidenceDraft] = useState<ResidenceSnapshot>({
    schemaVersion: 'residence-snapshot-v1',
    label: '本次住宅',
    facing: 'south',
    layoutNote: '客厅连接南向阳台，主卧在西侧。',
  })
  const [residencesLoading, setResidencesLoading] = useState(false)
  const [residencesError, setResidencesError] = useState('')
  const [residencesRetry, setResidencesRetry] = useState(0)
  const [residenceSavedMessage, setResidenceSavedMessage] = useState('')
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated' | 'legacy'>('loading')
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [memberProfiles, setMemberProfiles] = useState<MemberChartProfile[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState('')
  const [newMemberLabel, setNewMemberLabel] = useState('我的命盘')
  const [newMemberRelationship, setNewMemberRelationship] = useState<ChartRelationship>('self')
  const [reportScope, setReportScope] = useState<'current' | 'all' | 'archived'>('current')
  const [selectedReportResidenceId, setSelectedReportResidenceId] = useState('')

  const busy = ['uploading', 'queued', 'vision-analyzing', 'rules-evaluating', 'harness-generating'].includes(status)
  const currentReportInputError = reportSubmissionInputError(chart, birth)
  const canSubmitCurrentReport = canSubmitReport({
    busy,
    readiness: reportReadiness,
    photoCount: photos.length,
    inputError: currentReportInputError,
  })
  const photoCountLabel = useMemo(() => photos.length ? `已添加 ${photos.length} 张照片` : '尚未添加照片', [photos.length])
  const evidenceCount = (report?.vision?.length ?? 0) + (report?.citations?.length ?? 0) + (report?.evaluatedRules?.length ?? 0)
  const reportUsesCurrentValidator = report?.generationProvenance?.validatorVersion === CURRENT_REPORT_VALIDATOR_VERSION
  const printableReport = report?.status === 'completed' && Boolean(report.report?.trim()) && reportUsesCurrentValidator ? report : null
  const reportGenerationSummary = buildReportGenerationSummary(printableReport?.generationProvenance)
  const printableBirthReport = printableReport && isBirthDataBaziChart(printableReport.bazi)
    ? { ...printableReport, bazi: printableReport.bazi }
    : null
  const selectedResidenceProfile = useMemo(
    () => residenceProfiles.find((profile) => profile.id === selectedResidenceProfileId) ?? null,
    [residenceProfiles, selectedResidenceProfileId],
  )

  function resetAccountClientState() {
    ACCOUNT_SCOPED_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key))
    setBirth(defaultBirth)
    setManualFourPillarsInput(defaultManualFourPillarsInput)
    setChartInputMode('birth-data')
    setChart(null)
    setDeletedChart(null)
    setSelectedRuleProfileVersionId('')
    setSelectedHistoryReport(null)
    setReportSummaries([])
  }

  useEffect(() => {
    if (isSharedReportPage) {
      setAuthState('legacy')
      return
    }
    const controller = new AbortController()
    void requestJson<AuthSession>('/api/v1/auth/session', { signal: controller.signal, timeoutMs: 10_000 })
      .then((session) => {
        if (controller.signal.aborted) return
        if (!session?.authenticated || !session.user) {
          setAuthState('legacy')
          return
        }
        const previousOwner = window.localStorage.getItem(LOCAL_OWNER_STORAGE_KEY)
        if (previousOwner && previousOwner !== session.user.id) resetAccountClientState()
        window.localStorage.setItem(LOCAL_OWNER_STORAGE_KEY, session.user.id)
        setAuthUser(session.user)
        setAuthState('authenticated')
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setAuthState(cause instanceof ApiError && cause.status === 401 ? 'unauthenticated' : 'legacy')
      })
    return () => controller.abort()
  }, [isSharedReportPage])

  useEffect(() => {
    const unauthorized = () => {
      setAuthUser(null)
      setAuthState('unauthenticated')
    }
    window.addEventListener('fengshui:unauthorized', unauthorized)
    return () => window.removeEventListener('fengshui:unauthorized', unauthorized)
  }, [])

  async function login(username: string, password: string) {
    const session = await requestJson<AuthSession>('/api/v1/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }), timeoutMs: 15_000,
    })
    const previousOwner = window.localStorage.getItem(LOCAL_OWNER_STORAGE_KEY)
    if (previousOwner && previousOwner !== session.user.id) resetAccountClientState()
    window.localStorage.setItem(LOCAL_OWNER_STORAGE_KEY, session.user.id)
    setAuthUser(session.user)
    setAuthState('authenticated')
  }

  async function logout() {
    try { await requestJson('/api/v1/auth/logout', { method: 'POST', timeoutMs: 10_000 }) } catch { /* Session is cleared locally even if the server is unavailable. */ }
    resetAccountClientState()
    window.localStorage.removeItem(LOCAL_OWNER_STORAGE_KEY)
    setAuthUser(null)
    setMemberProfiles([])
    setChart(null)
    setAuthState('unauthenticated')
  }
  const navigateWithinApp = (event: MouseEvent<HTMLAnchorElement>, path: '/' | '/chart' | '/reports') => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    const normalizedPath = normalizeAppPath(path)
    if (normalizedPath !== normalizeAppPath()) window.history.pushState({}, '', path)
    setCurrentPath(normalizedPath)
  }

  useEffect(() => () => {
    activeController.current?.abort()
    photoPreviews.current.forEach((preview) => URL.revokeObjectURL(preview))
  }, [])

  useEffect(() => {
    const onPopState = () => setCurrentPath(normalizeAppPath())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!isChartPage || currentTimeRuntime !== undefined) return undefined
    let cancelled = false
    void requestJson<{ runtime: PublicBaziRuntime }>('/api/v1/bazi/runtime', { timeoutMs: 10_000 })
      .then(({ runtime }) => {
        if (!cancelled) setCurrentTimeRuntime(runtime)
      })
      .catch(() => {
        if (!cancelled) setCurrentTimeRuntime(null)
      })
    return () => {
      cancelled = true
    }
  }, [isChartPage, currentTimeRuntime])

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  useEffect(() => {
    if (printableReport?.report) resultRef.current?.focus()
  }, [printableReport?.report])

  useEffect(() => {
    window.localStorage.setItem(BIRTH_STORAGE_KEY, JSON.stringify(birth))
  }, [birth])

  useEffect(() => {
    window.localStorage.setItem(MANUAL_PILLARS_STORAGE_KEY, JSON.stringify(manualFourPillarsInput))
  }, [manualFourPillarsInput])

  useEffect(() => {
    window.localStorage.setItem(CHART_INPUT_MODE_STORAGE_KEY, JSON.stringify(chartInputMode))
  }, [chartInputMode])

  useEffect(() => {
    window.localStorage.setItem(RULE_PROFILE_STORAGE_KEY, JSON.stringify(selectedRuleProfileVersionId))
  }, [selectedRuleProfileVersionId])

  useEffect(() => {
    if (isSharedReportPage || authState === 'loading' || authState === 'unauthenticated') return
    const controller = new AbortController()
    void requestJson<{ profiles: MemberChartProfile[] }>('/api/v1/charts', { signal: controller.signal, timeoutMs: 15_000 })
      .then(({ profiles }) => {
        if (controller.signal.aborted) return
        const active = profiles.filter((profile) => !profile.deletedAt)
        setMemberProfiles(active)
        if (keepNewMemberDraftRef.current && !selectedMemberId) return
        const selected = active.find((profile) => profile.id === selectedMemberId) ?? active.find((profile) => profile.id === chart?.profileId) ?? active[0]
        if (selected) persistChart(selected)
        else setSelectedMemberId('')
      })
      .catch(() => void restoreCurrentChart())
    return () => controller.abort()
  }, [isSharedReportPage, authState])

  useEffect(() => {
    if (!isAnalysisPage) return
    const controller = new AbortController()
    setReportReadiness(reportReadinessLoading)
    void fetchReportReadiness(controller.signal).then((state) => {
      if (!controller.signal.aborted) setReportReadiness(state)
    })
    return () => controller.abort()
  }, [isAnalysisPage, reportReadinessRetry])

  async function loadResidenceProfiles(signal?: AbortSignal) {
    setResidencesLoading(true)
    setResidencesError('')
    try {
      const result = await requestJson<unknown>('/api/v1/residences', { signal, timeoutMs: 15_000 })
      const profiles = normalizeResidenceProfilesResponse(result)
      setResidenceProfiles(profiles)
      setSelectedResidenceProfileId((current) => {
        if (current && profiles.some((profile) => profile.id === current)) return current
        return profiles[0]?.id ?? ''
      })
      setSelectedReportResidenceId((current) => {
        if (!current || profiles.some((profile) => profile.id === current)) return current
        return ''
      })
      return profiles
    } catch (cause) {
      if (signal?.aborted) return residenceProfiles
      setResidencesError(cause instanceof Error ? cause.message : '住宅档案读取失败。')
      return residenceProfiles
    } finally {
      if (!signal?.aborted) setResidencesLoading(false)
    }
  }

  useEffect(() => {
    if (!isAnalysisPage && !isReportsPage) return
    const controller = new AbortController()
    void loadResidenceProfiles(controller.signal)
    return () => controller.abort()
  }, [isAnalysisPage, isReportsPage, residencesRetry])

  useEffect(() => {
    if (!selectedResidenceProfile) return
    setResidenceDraft(selectedResidenceProfile.currentVersion.snapshot)
  }, [selectedResidenceProfile?.id, selectedResidenceProfile?.currentVersion.id])

  useEffect(() => {
    if (!isReportsPage) return
    const controller = new AbortController()
    setReportsLoading(true)
    setReportsError('')
    const reportQuery = new URLSearchParams()
    if (reportScope === 'archived') reportQuery.set('archived', 'true')
    if (reportScope === 'current' && selectedMemberId) reportQuery.set('chartProfileId', selectedMemberId)
    if (selectedReportResidenceId) reportQuery.set('residenceProfileId', selectedReportResidenceId)
    const reportPath = reportQuery.size ? `/api/v1/reports?${reportQuery}` : '/api/v1/reports'
    void requestJson<{ reports: ReportSummary[] }>(reportPath, { signal: controller.signal, timeoutMs: 15_000 })
      .then((result) => {
        if (controller.signal.aborted) return
        const nextReports = Array.isArray(result.reports) ? result.reports : []
        setReportSummaries(nextReports)
        const selectedSummary = nextReports.find((item) => item.id === selectedHistoryReport?.id)
        if (!selectedSummary) {
          setSelectedHistoryReport(null)
          const latest = nextReports[0]
          if (latest) void openHistoryReport(latest.id)
        } else if (
          selectedHistoryReport
          && (selectedSummary.status !== selectedHistoryReport.status || selectedSummary.phase !== selectedHistoryReport.phase)
        ) {
          void openHistoryReport(selectedSummary.id)
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setReportsError(cause instanceof Error ? cause.message : '报告历史读取失败。')
      })
      .finally(() => {
        if (!controller.signal.aborted) setReportsLoading(false)
      })
    return () => controller.abort()
  }, [isReportsPage, reportsRetry, reportScope, selectedMemberId, selectedReportResidenceId])

  useEffect(() => {
    if (!isReportsPage) return
    const selectedQueuedReportId = selectedHistoryReport?.status === 'queued' ? selectedHistoryReport.id : ''
    const hasQueuedReport = selectedQueuedReportId || reportSummaries.some((item) => item.status === 'queued')
    if (!hasQueuedReport) return

    const timer = window.setTimeout(() => {
      setReportsRetry((attempt) => attempt + 1)
      if (selectedQueuedReportId) void openHistoryReport(selectedQueuedReportId)
    }, REPORT_HISTORY_REFRESH_MS)
    return () => window.clearTimeout(timer)
  }, [isReportsPage, reportSummaries, selectedHistoryReport?.id, selectedHistoryReport?.status, selectedHistoryReport?.phase])

  useEffect(() => {
    if (isSharedReportPage) return
    const controller = new AbortController()
    setRuleProfilesLoading(true)
    setRuleProfilesError('')
    void requestJson<unknown>('/api/v1/bazi-rule-profile-versions/active', {
      signal: controller.signal,
      timeoutMs: 15_000,
    })
      .then((payload) => {
        if (controller.signal.aborted) return
        const versions = normalizeActiveRuleProfileVersions(payload)
        setActiveRuleProfileVersions(versions)
        setSelectedRuleProfileVersionId((current) => chooseRuleProfileSelection(current, chart, versions))
      })
      .catch((cause) => {
        if (controller.signal.aborted) return
        setActiveRuleProfileVersions([])
        setRuleProfilesError(cause instanceof Error ? cause.message : '暂时无法读取已发布的排盘规则。')
      })
      .finally(() => {
        if (!controller.signal.aborted) setRuleProfilesLoading(false)
      })
    return () => controller.abort()
  }, [ruleProfilesRetry, isSharedReportPage])

  useEffect(() => {
    if (ruleProfilesLoading || ruleProfilesError) return
    setSelectedRuleProfileVersionId((current) => (
      chooseRuleProfileSelection(current, chart, activeRuleProfileVersions)
    ))
  }, [
    activeRuleProfileVersions,
    chart?.ruleProfileVersion?.versionId,
    ruleProfilesError,
    ruleProfilesLoading,
  ])

  useEffect(() => {
    if (isSharedReportPage) return
    const profileId = chart?.profileId ?? deletedChart?.profileId
    if (!profileId) {
      setChartVersions(null)
      setChartVersionsError('')
      setChartVersionsLoading(false)
      return
    }
    let cancelled = false
    setChartVersionsLoading(true)
    setChartVersionsError('')
    void requestJson<{ versions: ChartVersion[] }>(`/api/v1/charts/${profileId}/versions`, { timeoutMs: 15_000 })
      .then((result) => {
        if (cancelled) return
        setChartVersions(result.versions)
      })
      .catch((cause) => {
        if (cancelled) return
        setChartVersions(null)
        setChartVersionsError(cause instanceof Error ? cause.message : '无法读取命盘版本历史。')
      })
      .finally(() => {
        if (!cancelled) setChartVersionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [chart?.profileId, chart?.versionId, deletedChart?.profileId, isSharedReportPage])

  function snapshotFromProfile(profile: ChartProfile): ChartSnapshot {
    const calculationInput = calculationInputFromVersion(profile.currentVersion)
    return {
      profileId: profile.id,
      revision: profile.revision,
      versionId: profile.currentVersion.id,
      version: profile.currentVersion.version,
      calculationInput,
      ...(!isManualFourPillarsInput(calculationInput) ? { birth: calculationInput } : {}),
      bazi: profile.currentVersion.bazi,
      ruleProfileVersion: profile.currentVersion.ruleProfileVersion,
      savedAt: profile.updatedAt,
    }
  }

  function persistChart(profile: ChartProfile) {
    keepNewMemberDraftRef.current = false
    const snapshot = snapshotFromProfile(profile)
    setChart(snapshot)
    window.localStorage.setItem(CHART_STORAGE_KEY, JSON.stringify(snapshot))
    setDeletedChart(null)
    window.localStorage.removeItem(DELETED_CHART_STORAGE_KEY)
    if (isManualFourPillarsInput(snapshot.calculationInput)) {
      setManualFourPillarsInput(snapshot.calculationInput)
      setChartInputMode('manual-four-pillars')
    } else {
      setBirth(snapshot.calculationInput)
      setChartInputMode('birth-data')
    }
    setSelectedRuleProfileVersionId((current) => (
      current || snapshot.ruleProfileVersion?.versionId || ''
    ))
    const member = profile as MemberChartProfile
    setMemberProfiles((current) => [member, ...current.filter((item) => item.id !== member.id)])
    setSelectedMemberId(profile.id)
  }

  function selectMember(profileId: string) {
    keepNewMemberDraftRef.current = !profileId
    setSelectedMemberId(profileId)
    setChartError('')
    setSelectedHistoryReport(null)
    if (!profileId) {
      setChart(null)
      setChartVersions(null)
      if (normalizeAppPath() !== '/chart') {
        window.history.pushState({}, '', '/chart')
        setCurrentPath('/chart')
      }
      return
    }
    const profile = memberProfiles.find((item) => item.id === profileId)
    if (profile) persistChart(profile)
    setReportsRetry((attempt) => attempt + 1)
  }

  function selectRuleProfileVersion(versionId: string) {
    setSelectedRuleProfileVersionId(versionId)
    const version = activeRuleProfileVersions.find((item) => item.versionId === versionId)
    if (version) setBirth((current) => applyRuleTimeDefaults(current, version))
  }

  async function restoreCurrentChart() {
    if (isSharedReportPage) return
    try {
      const result = await requestJson<{ profile: ChartProfile | null }>('/api/v1/charts/current', { timeoutMs: 15_000 })
      if (result.profile) persistChart(result.profile)
      else if (chart?.profileId) {
        setChart(null)
        window.localStorage.removeItem(CHART_STORAGE_KEY)
      }
    } catch (cause) {
      if (isChartPage) setChartError(cause instanceof Error ? cause.message : '暂时无法恢复服务端命盘。')
    }
  }

  async function calculateStandaloneChart() {
    const calculationInput: ChartCalculationInput = chartInputMode === 'manual-four-pillars' ? manualFourPillarsInput : birth
    if (!canCalculateChartInput(calculationInput)) {
      setChartError('请先从服务端地点库选择带坐标证据的出生地点，再生成命盘。')
      return
    }
    setChartLoading(true)
    setChartError('')
    setChartAuditMessage('')
    try {
      const result = chart?.profileId && Number.isInteger(chart.revision)
        ? await requestJson<{ profile: ChartProfile }>(`/api/v1/charts/${chart.profileId}/versions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildChartVersionRequest(calculationInput, selectedRuleProfileVersionId, chart.revision)),
        })
        : await requestJson<{ profile: ChartProfile }>('/api/v1/charts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...buildChartVersionRequest(calculationInput, selectedRuleProfileVersionId), label: newMemberLabel.trim() || '未命名成员', relationship: newMemberRelationship }),
      })
      persistChart(result.profile)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        const profile = (cause.payload as { profile?: ChartProfile }).profile
        if (profile) persistChart(profile)
        else await restoreCurrentChart()
        setChartError('命盘已在另一页面更新，现已恢复服务端最新版本；请确认后再保存。')
        return
      }
      setChartError(cause instanceof Error ? cause.message : '命盘生成失败，请检查出生资料。')
    } finally {
      setChartLoading(false)
    }
  }

  async function clearLocalChart() {
    setChartLoading(true)
    setChartError('')
    setChartAuditMessage('')
    const removed = chart
    try {
      if (removed?.profileId) await requestJson(`/api/v1/charts/${removed.profileId}`, { method: 'DELETE' })
      setChart(null)
      window.localStorage.removeItem(CHART_STORAGE_KEY)
      if (removed?.profileId) {
        setMemberProfiles((current) => current.filter((profile) => profile.id !== removed.profileId))
        setSelectedMemberId('')
        const tombstone = { ...removed, savedAt: new Date().toISOString() }
        setDeletedChart(tombstone)
        window.localStorage.setItem(DELETED_CHART_STORAGE_KEY, JSON.stringify(tombstone))
      }
    } catch (cause) {
      setChartError(cause instanceof Error ? cause.message : '命盘档案移除失败。')
    } finally {
      setChartLoading(false)
    }
  }

  async function restoreDeletedChart() {
    if (!deletedChart?.profileId) return
    setChartLoading(true)
    setChartError('')
    setChartAuditMessage('')
    try {
      const result = await requestJson<{ profile: ChartProfile }>(`/api/v1/charts/${deletedChart.profileId}/restore`, { method: 'POST' })
      persistChart(result.profile)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        const profile = (cause.payload as { profile?: ChartProfile }).profile
        if (profile) persistChart(profile)
        setChartError('当前浏览器已经有新的活动命盘，已恢复服务端当前命盘；如需恢复旧档案，请先删除当前命盘。')
        return
      }
      setChartError(cause instanceof Error ? cause.message : '命盘档案恢复失败。')
    } finally {
      setChartLoading(false)
    }
  }

  function useVersionBirth(version: ChartVersion) {
    const calculationInput = calculationInputFromVersion(version)
    if (isManualFourPillarsInput(calculationInput)) {
      setManualFourPillarsInput(calculationInput)
      setChartInputMode('manual-four-pillars')
    } else {
      setBirth(calculationInput)
      setChartInputMode('birth-data')
    }
    setSelectedRuleProfileVersionId(version.ruleProfileVersion?.versionId ?? '')
  }

  async function restoreChartVersion(version: ChartVersion) {
    const profileId = chart?.profileId
    const expectedRevision = chart?.revision
    if (!profileId || typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || !canRestoreChartVersion(version.id, chart.versionId)) return
    const confirmed = window.confirm(`确认将历史 v${version.version} 恢复为当前命盘吗？当前版本不会被删除，服务端会记录恢复来源。`)
    if (!confirmed) return
    setChartLoading(true)
    setRestoringVersionId(version.id)
    setChartError('')
    setChartAuditMessage('')
    try {
      const result = await requestJson<{ profile: ChartProfile }>(`/api/v1/charts/${profileId}/versions/${version.id}/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildChartVersionRestoreRequest(expectedRevision)),
      })
      persistChart(result.profile)
      setChartVersions((current) => mergeRestoredChartVersionHistory(current, result.profile.currentVersion))
      setChartAuditMessage(restoredChartAuditMessage(version))
    } catch (cause) {
      setChartError(restoreChartVersionErrorMessage(cause))
    } finally {
      setRestoringVersionId('')
      setChartLoading(false)
    }
  }

  function addPhotos(files: FileList | null) {
    if (!files) return
    const selected = Array.from(files)
    const violations = selected.flatMap((file) => {
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) return `${file.name} 不是支持的图片格式`
      if (file.size > MAX_PHOTO_BYTES) return `${file.name} 超过 10 MB`
      return []
    })
    if (photos.length + selected.length > MAX_PHOTOS) violations.push(`每份报告最多上传 ${MAX_PHOTOS} 张照片`)
    if (violations.length) {
      setError(violations.join('；'))
      return
    }
    setError('')
    const added = selected.map((file, index) => {
      const preview = URL.createObjectURL(file)
      photoPreviews.current.push(preview)
      return {
        id: `${Date.now()}-${index}-${file.name}`,
        file,
        name: file.name,
        preview,
        room: (index === 0 && photos.length === 0 ? 'overview' : 'other') as Room,
        facing: 'unknown' as Direction,
        note: '',
        sizeLabel: formatBytes(file.size),
      }
    })
    setPhotos((current) => [...current, ...added])
    if (fileInput.current) fileInput.current.value = ''
  }

  function removePhoto(photo: PhotoDraft) {
    URL.revokeObjectURL(photo.preview)
    photoPreviews.current = photoPreviews.current.filter((preview) => preview !== photo.preview)
    setPhotos((items) => items.filter((item) => item.id !== photo.id))
  }

  function cancelWork() {
    activeController.current?.abort()
    activeController.current = null
    setStatus('cancelled')
    setStatusDetail(taskId ? `已停止本页轮询，任务 ${taskId} 可稍后恢复查询。` : '已取消当前请求。')
  }

  async function uploadPhoto(photo: PhotoDraft, signal: AbortSignal) {
    const upload = new FormData()
    upload.append('image', photo.file)
    const result = await requestJson<{ fileId?: string; error?: string }>('/api/v1/media', {
      method: 'POST',
      headers: { 'x-vision-consent': 'accepted' },
      body: upload,
      signal,
      timeoutMs: 45_000,
    })
    if (!result.fileId) throw new Error(`照片 ${photo.name} 上传后未返回文件编号`)
    return { fileId: result.fileId, room: photo.room, facing: photo.facing, note: photo.note }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setReport(null)
    const readinessError = reportReadinessSubmitError(reportReadiness)
    if (readinessError) {
      setError(readinessError)
      return
    }
    const inputError = reportSubmissionInputError(chart, birth)
    if (inputError) {
      setError(inputError)
      return
    }
    if (!photos.length) {
      setError('请至少添加一张住宅照片并完成标注。')
      return
    }
    activeController.current?.abort()
    const controller = new AbortController()
    activeController.current = controller
    const form = new FormData(event.currentTarget)
    try {
      setStatus('uploading')
      setStatusDetail(`正在上传 ${photos.length} 张已标注照片`)
      const uploadedPhotos = await Promise.all(photos.map((photo) => uploadPhoto(photo, controller.signal)))
      const draftSnapshot = selectedResidenceProfile?.currentVersion.snapshot ?? residenceSnapshotFromForm(form)
      let boundResidence: SelectedReportResidence
      if (selectedResidenceProfile) {
        boundResidence = { profile: selectedResidenceProfile, snapshot: draftSnapshot }
      } else {
        setStatusDetail('正在保存住宅档案')
        const created = await requestJson<{ profile: ResidenceProfile }>('/api/v1/residences', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(draftSnapshot),
          signal: controller.signal,
          timeoutMs: 15_000,
        })
        boundResidence = { profile: created.profile, snapshot: created.profile.currentVersion.snapshot }
        setResidenceProfiles((current) => [created.profile, ...current.filter((profile) => profile.id !== created.profile.id)])
        setSelectedResidenceProfileId(created.profile.id)
        setResidenceDraft(created.profile.currentVersion.snapshot)
        setResidenceSavedMessage(`已保存住宅档案：${created.profile.currentVersion.snapshot.label}`)
      }
      setStatus('queued')
      setStatusDetail('正在创建报告任务')
      const result = await requestJson<Report>('/api/v1/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildReportSubmissionPayload({
          visionConsent: form.get('visionConsent') === 'accepted',
          birth,
          chart,
          selectedRuleProfileVersionId,
          residence: { facing: boundResidence.snapshot.facing, layoutNote: boundResidence.snapshot.layoutNote ?? '' },
          selectedResidence: boundResidence,
          photos: uploadedPhotos,
        })),
        signal: controller.signal,
        timeoutMs: 30_000,
      })
      setTaskId(result.id)
      await restoreCurrentChart()
      if (result.status !== 'queued') {
        setReport(result)
        const nextStatus = mapReportPhaseToUiStatus(result)
        setStatus(nextStatus)
        setStatusDetail(reportPhaseStatusDetail(result))
        return
      }
      setStatus(mapReportPhaseToUiStatus(result))
      setStatusDetail(reportPhaseStatusDetail(result))
      const completed = await waitForReport(result.id, controller.signal, (nextStatus, attempt, polledReport) => {
        setStatus(nextStatus)
        setStatusDetail(`${reportPhaseStatusDetail(polledReport, attempt)}，最多等待 180 秒`)
      })
      setReport(completed)
      setStatus('completed')
      setStatusDetail(reportPhaseStatusDetail(completed))
      setReportsRetry((attempt) => attempt + 1)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        await Promise.all([restoreCurrentChart(), loadResidenceProfiles(controller.signal)])
      }
      const message = cause instanceof ApiError && cause.status === 409
        ? '住宅或命盘已在另一页面更新，请刷新确认后重新生成报告。'
        : cause instanceof Error ? cause.message : '报告生成失败'
      setStatus(controller.signal.aborted ? 'cancelled' : 'failed')
      setStatusDetail(controller.signal.aborted ? '当前请求已停止' : '输入内容已保留，可直接重试。')
      setError(message)
    } finally {
      if (activeController.current === controller) activeController.current = null
    }
  }

  async function openHistoryReport(id: string) {
    setReportDetailLoading(true)
    setReportsError('')
    try {
      const restored = await requestJson<Report>(`/api/v1/reports/${id}`, { timeoutMs: 15_000 })
      setSelectedHistoryReport(restored)
    } catch (cause) {
      setReportsError(cause instanceof Error ? cause.message : '报告详情读取失败。')
      setSelectedHistoryReport(null)
    } finally {
      setReportDetailLoading(false)
    }
  }

  async function archiveHistoryReport(id: string) {
    setReportActionBusyId(id)
    setReportsError('')
    try {
      await requestJson<unknown>(`/api/v1/reports/${id}`, { method: 'DELETE', timeoutMs: 15_000 })
      setSelectedHistoryReport(null)
      setReportsRetry((attempt) => attempt + 1)
    } catch (cause) {
      setReportsError(cause instanceof Error ? cause.message : '报告移入回收站失败。')
    } finally {
      setReportActionBusyId('')
    }
  }

  async function restoreHistoryReport(id: string) {
    setReportActionBusyId(id)
    setReportsError('')
    try {
      await requestJson<Report>(`/api/v1/reports/${id}/restore`, { method: 'POST', timeoutMs: 15_000 })
      setSelectedHistoryReport(null)
      setReportScope('current')
      setReportsRetry((attempt) => attempt + 1)
    } catch (cause) {
      setReportsError(cause instanceof Error ? cause.message : '报告恢复失败。')
    } finally {
      setReportActionBusyId('')
    }
  }

  if (!isSharedReportPage && authState === 'loading') return <main className="login-page"><section className="login-panel"><p className="pending">正在读取账号…</p></section></main>
  if (!isSharedReportPage && authState === 'unauthenticated') return <LoginPage onLogin={login} />
  if (isSharedReportPage) return <SharedReportPage />

  if (isChartPage) {
    return <ChartPage
      onNavigate={navigateWithinApp}
      user={authUser}
      members={memberProfiles}
      selectedMemberId={selectedMemberId}
      onSelectMember={selectMember}
      onLogout={() => void logout()}
      newMemberLabel={newMemberLabel}
      onNewMemberLabelChange={setNewMemberLabel}
      newMemberRelationship={newMemberRelationship}
      onNewMemberRelationshipChange={setNewMemberRelationship}
      birth={birth}
      setBirth={setBirth}
      inputMode={chartInputMode}
      setInputMode={setChartInputMode}
      manualInput={manualFourPillarsInput}
      setManualInput={setManualFourPillarsInput}
      chart={chart}
      chartVersions={chartVersions}
      chartVersionsLoading={chartVersionsLoading}
      chartVersionsError={chartVersionsError}
      deletedChart={deletedChart}
      onCalculate={calculateStandaloneChart}
      onClear={clearLocalChart}
      onRestore={restoreDeletedChart}
      onUseVersion={useVersionBirth}
      onRestoreVersion={restoreChartVersion}
      loading={chartLoading}
      restoringVersionId={restoringVersionId}
      error={chartError}
      auditMessage={chartAuditMessage}
      currentTimeRuntime={currentTimeRuntime}
      activeRuleProfileVersions={activeRuleProfileVersions}
      selectedRuleProfileVersionId={selectedRuleProfileVersionId}
      ruleProfilesLoading={ruleProfilesLoading}
      ruleProfilesError={ruleProfilesError}
      onSelectRuleProfileVersion={selectRuleProfileVersion}
      onRetryRuleProfiles={() => setRuleProfilesRetry((attempt) => attempt + 1)}
    />
  }

  if (isReportsPage) {
    return <ReportsPage
      onNavigate={navigateWithinApp}
      user={authUser}
      members={memberProfiles}
      residences={residenceProfiles}
      selectedMemberId={selectedMemberId}
      onSelectMember={selectMember}
      onLogout={() => void logout()}
      reportScope={reportScope}
      onReportScopeChange={setReportScope}
      selectedReportResidenceId={selectedReportResidenceId}
      onSelectReportResidence={setSelectedReportResidenceId}
      reports={reportSummaries}
      selectedReport={selectedHistoryReport}
      loading={reportsLoading}
      detailLoading={reportDetailLoading}
      error={reportsError}
      onRefresh={() => setReportsRetry((attempt) => attempt + 1)}
      onOpenReport={(id) => void openHistoryReport(id)}
      onArchiveReport={archiveHistoryReport}
      onRestoreReport={restoreHistoryReport}
      reportActionBusyId={reportActionBusyId}
    />
  }

  return <main className="shell">
    <TopNavigation current="analysis" onNavigate={navigateWithinApp} user={authUser} members={memberProfiles} selectedMemberId={selectedMemberId} onSelectMember={selectMember} onLogout={() => void logout()} />

    <header className="hero analysis-hero">
      <p className="eyebrow">INVESTOR DEMO / 02</p>
      <h1>住宅分析</h1>
      <p>选择已保存的个人命盘，上传住宅资料和多张照片，生成一次性的风水文化分析报告。</p>
    </header>

    <form className="grid" onSubmit={submit}>
      <ChartReferenceCard chart={chart} />

      <ResidenceProfileCard
        profiles={residenceProfiles}
        selectedProfileId={selectedResidenceProfileId}
        draft={residenceDraft}
        loading={residencesLoading}
        error={residencesError}
        savedMessage={residenceSavedMessage}
        onSelect={(profileId) => {
          setSelectedResidenceProfileId(profileId)
          setResidenceSavedMessage('')
          if (!profileId) setResidenceDraft({
            schemaVersion: 'residence-snapshot-v1',
            label: '本次住宅',
            facing: 'south',
            layoutNote: '客厅连接南向阳台，主卧在西侧。',
          })
        }}
        onDraftChange={(draft) => {
          setResidenceDraft(draft)
          setResidenceSavedMessage('')
        }}
        onRefresh={() => setResidencesRetry((attempt) => attempt + 1)}
      />

      <article className="card upload">
        <div className="section-head">
          <div><p className="kicker">SPACE EVIDENCE</p><h2>上传并标注空间照片</h2></div>
          <span>{photoCountLabel}</span>
        </div>
        <input ref={fileInput} className="file-input" type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple onChange={(event) => addPhotos(event.target.files)} />
        <div className="upload-rules">
          <b>支持 JPG / PNG / WEBP / GIF</b>
          <span>单张不超过 10 MB，最多 12 张。建议包含全屋图、入户、客厅、卧室和明显采光面。</span>
        </div>
        <div className="photos">
          <button type="button" className="photo add" onClick={() => fileInput.current?.click()} aria-label="添加住宅照片">
            <span aria-hidden="true">+</span><b>添加照片</b><small>从本机选择</small>
          </button>
          {photos.map((photo) => <div className="photo photo-preview" key={photo.id} style={{ backgroundImage: `linear-gradient(#17362b2b,#17362bd9),url(${photo.preview})` }}>
            <i>{roomLabels[photo.room]}</i><span>{photo.name}</span><small>{photo.sizeLabel}</small>
          </div>)}
        </div>
        <div className="photo-details">
          {photos.map((photo, index) => <fieldset key={photo.id}>
            <legend>照片 {index + 1} · {photo.name}</legend>
            <label>空间<select value={photo.room} onChange={(e) => setPhotos((items) => items.map((item) => item.id === photo.id ? { ...item, room: e.target.value as Room } : item))}>{Object.entries(roomLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>镜头朝向<select value={photo.facing} onChange={(e) => setPhotos((items) => items.map((item) => item.id === photo.id ? { ...item, facing: e.target.value as Direction } : item))}>{Object.entries(directionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>备注<input value={photo.note} onChange={(e) => setPhotos((items) => items.map((item) => item.id === photo.id ? { ...item, note: e.target.value } : item))} placeholder="例如：站在入户门面向阳台" /></label>
            <button type="button" onClick={() => removePhoto(photo)}>移除</button>
          </fieldset>)}
        </div>
        <label className="consent"><input type="checkbox" name="visionConsent" value="accepted" required />我同意将所选住宅照片发送至 DeepSeek 视觉模型，仅用于生成本次分析报告；处理结束后删除本地原图。</label>
      </article>

      <article className="report-panel">
        <div>
          <p className="kicker">REPORT GENERATION</p>
          <h2>生成证据驱动的空间建议</h2>
          <p>模型只负责把程序排盘、视觉观察、规则命中和专家资料组织成报告；报告会保留文化参考边界。</p>
          <details className="report-readiness" data-state={reportReadiness.status} role="status" aria-live="polite" open={reportReadiness.status === 'not-ready'}>
            <summary>
              <span>
                <b>{investorReportReadinessSummary(reportReadiness.status)}</b>
                <small>{reportReadiness.status === 'ready' ? '已隐藏技术检查，必要时可展开查看。' : '需要处理后才能生成报告。'}</small>
              </span>
            </summary>
            <div className="readiness-detail-body">
              {reportReadiness.status !== 'ready' && reportReadiness.status !== 'loading' && <p>{reportReadiness.message}</p>}
              <button type="button" onClick={() => setReportReadinessRetry((attempt) => attempt + 1)} disabled={busy || reportReadiness.status === 'loading'}>重试检查</button>
              {shouldShowReadinessAdminAction(reportReadiness) && <p className="readiness-operator-note">
                请联系管理员在后台补齐专家资料或规则配置。
              </p>}
              <ul>
                {reportReadiness.components.map((component) => <li key={component.key} data-ready={component.ready === null ? 'unknown' : component.ready ? 'true' : 'false'}>
                  <span aria-hidden="true" />
                  <strong>{component.label}</strong>
                  <em>{component.ready === null ? '待确认' : component.ready ? '已就绪' : '未就绪'}</em>
                </li>)}
              </ul>
            </div>
          </details>
          {shouldShowInvestorReportProgress(status, taskId) && <section className="steps compact-steps" aria-label="报告生成进度">
            {investorReportSteps.map((stage, index) => <span key={stage.key} data-state={investorReportStepState(status, stage.key)} data-active={investorReportStepState(status, stage.key) === 'active'}>
              <i>{String(index + 1).padStart(2, '0')}</i><b>{stage.label}</b><small>{stage.detail}</small>
            </span>)}
          </section>}
          <div className="actions">
            <button className="primary" disabled={!canSubmitCurrentReport}>{busy ? '正在生成报告' : '生成分析报告'}</button>
            {busy && <button type="button" className="secondary" onClick={cancelWork}>停止轮询</button>}
          </div>
          {taskId && <small>报告任务已创建，正在更新生成状态。</small>}
          {error && <p className="error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
        </div>
        <aside className="report-submit-note" aria-label="报告生成条件">
          <span>本次报告需要</span>
          <ul>
            <li>已保存的个人命盘版本</li>
            <li>住宅朝向与格局说明</li>
            <li>至少 1 张已标注照片</li>
            <li>已发布的专家资料与规则</li>
          </ul>
        </aside>
      </article>

      {report?.status === 'completed' && !reportUsesCurrentValidator && <article className="result result-outdated" role="alert">
        <div className="result-head">
          <div><p className="kicker">REPORT UPDATE REQUIRED</p><h2>这份旧报告需要重新生成</h2></div>
        </div>
        <p>旧报告使用了早期格式，正文可能包含内部字段或调试信息，因此已停止展示。请用当前资料重新生成，新报告会使用正常的标题、段落和列表。</p>
      </article>}

      {printableReport && <article className="result" tabIndex={-1} ref={resultRef}>
        <div className="result-head">
          <div><p className="kicker">GENERATED REPORT</p><h2>住宅文化分析报告</h2></div>
          <div className="result-tools">
            <span>{evidenceCount} 条依据</span>
            {printableBirthReport && <button type="button" onClick={() => downloadReportPdf(printableBirthReport.id)}>下载 PDF</button>}
          </div>
        </div>
        <ReportMarkdown report={printableReport.report ?? ''} />
        <ReportEvidenceSummary report={printableReport} />
        <div className="report-history-cta">
          <span>这份报告已保存到报告历史。</span>
          <a className="primary nav-button" href="/reports">查看我的报告</a>
        </div>
        <details className="provenance report-meta-disclosure">
          <summary>命盘与生成信息</summary>
          <div className="summary-grid">
            <div><span>报告状态</span><strong>{printableReport.status === 'completed' ? '已生成' : '生成中'}</strong></div>
            <div><span>四柱</span><strong>{printableReport.bazi.pillars.join(' · ')}</strong></div>
            <div><span>真太阳时</span><strong>{sourceDependentReportValue(printableReport.bazi.correctedLocalTime)}</strong></div>
            <div><span>校正</span><strong>{sourceDependentReportValue(printableReport.bazi.correctionMinutes, ' 分钟')}</strong></div>
          </div>
          <div className="source-group">
            <b>生成环境</b>
            <p><span>模型</span>{reportGenerationSummary.modelLabel}</p>
            <p><span>生成时间</span>{reportGenerationSummary.generatedAtLabel}</p>
            <p><span>报告校验</span>{reportGenerationSummary.validatorLabel}</p>
          </div>
        </details>
        <small>本报告仅供传统文化研究与娱乐参考，不构成医疗、法律、财务或人生决策建议。</small>
      </article>}
    </form>
  </main>
}

const rootElement = typeof document === 'undefined' ? null : document.getElementById('root')
if (rootElement) {
  const root = createRoot(rootElement)
  root.render(<App />)
  if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
}
