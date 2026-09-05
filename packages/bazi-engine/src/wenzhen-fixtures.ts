import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import type { BaziChart, BaziFlowChart, BirthInput, CycleQuery, TrueSolarTimeRuleVersion } from '@fengshui/domain'
import { calculateBazi, calculateBaziFlow } from './index.js'

export const WENZHEN_FIXTURE_SCHEMA_VERSION = 'wenzhen-fixture-v1'
export const WENZHEN_REPORT_SCHEMA_VERSION = 'wenzhen-difference-report-v2'
export const WENZHEN_SCENARIO_REQUIREMENT_SCHEMA_VERSION = 'wenzhen-scenario-requirement-v1'
export type WenzhenFixtureStatus = 'pending-manual-verification' | 'verified' | 'accepted-difference'
export type AcceptedDifferenceClassification = 'dependency' | 'school-rule' | 'timezone-location' | 'display-rounding' | 'bug'
export type WenzhenAssertionCoverageCategory = 'pillars' | 'time-correction' | 'professional-table' | 'luck-cycles' | 'dynamic-cycles'

type ComparedFields = Pick<BaziChart,
  'pillars' | 'timeCorrectionRuleVersion' | 'correctedLocalTime' | 'correctionMinutes' | 'timeProfile' |
  'pillarDetails' | 'luckCycles' | 'annualCycles' | 'monthlyCycles' | 'dailyCycles' | 'hourlyCycles'>

type DeepPartial<T> = T extends readonly (infer Item)[]
  ? readonly DeepPartial<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]?: DeepPartial<T[Key]> }
    : T

/** Nested objects and arrays are partial/prefix expectations; pillars are always complete. */
export type WenzhenExpected = DeepPartial<Omit<ComparedFields, 'pillars'>> & { pillars: readonly [string, string, string, string] }
export interface AcceptedDifference { path: string; reason: string; classification?: AcceptedDifferenceClassification }
export interface WenzhenAssertionCoverage {
  categories: readonly WenzhenAssertionCoverageCategory[]
  assertedTopLevelFields: readonly string[]
  assertedLeafPaths: readonly string[]
  /** Current fixture expectations are recursive partial/prefix assertions, never a full external schema claim. */
  partial: true
}
export interface WenzhenAssertionFieldCoverage {
  timeCorrection: { ruleVersion: number; correctedLocalTime: number; correctionMinutes: number; timeProfile: number }
  professional: { pillarDetails: number }
  luck: { luckCycles: number }
  dynamic: { annualCycles: number; monthlyCycles: number; dailyCycles: number; hourlyCycles: number }
}
export interface WenzhenAcceptanceCoverage {
  totalPlanned: number
  verifiedPlanned: number
  pendingCapture: number
  reportableFixtures: number
  passedFixtures: number
  acceptedDifferenceFixtures: number
  failedFixtures: number
  unplannedFixtureIds: readonly string[]
  plannedVerifiedMissingFixtureIds: readonly string[]
  pendingCaptureIds: readonly string[]
  gateFailures: readonly WenzhenStage1GateFailure[]
  scenarioRequirements: readonly WenzhenScenarioRequirement[]
  coverageByRisk: Record<string, { planned: number; verified: number; pending: number }>
  coverageByCapture: Record<string, { planned: number; verified: number; pending: number }>
  readiness: {
    allPlannedCaptured: boolean
    everyVerifiedPlanHasPassingFixture: boolean
    noUnplannedFixtures: boolean
    noFailedFixtures: boolean
    noGovernanceFailures: boolean
    stage1ParityClaimReady: boolean
  }
}

export type WenzhenStage1GateFailureKind =
  | 'pending-capture'
  | 'missing-fixture'
  | 'unplanned-fixture'
  | 'failed-fixture'
  | 'evidence-mismatch'
  | 'birth-input-drift'
  | 'flow-query-drift'
  | 'missing-required-assertion'
  | 'unmapped-capture-label'

export interface WenzhenStage1GateFailure {
  kind: WenzhenStage1GateFailureKind
  sampleId: string
  detail: string
}

export interface WenzhenScenarioRequirement {
  schemaVersion: typeof WENZHEN_SCENARIO_REQUIREMENT_SCHEMA_VERSION
  sampleId: string
  requiredAssertionPaths: readonly string[]
  captureLabelCoverage: {
    machineAssertionLabels: readonly string[]
    inputBoundLabels: readonly string[]
    manualReviewLabels: readonly string[]
    unmappedLabels: readonly string[]
  }
}

interface FixtureBase { sampleId: string; source: string; status: WenzhenFixtureStatus; notes?: string }
export interface PendingWenzhenFixture extends FixtureBase { status: 'pending-manual-verification' }
export interface VerifiedWenzhenFixture extends FixtureBase {
  status: 'verified'; capturedAt: string; sourceUrl: string; evidenceRef: string
  birth: BirthInput; flowQuery?: CycleQuery; expected: WenzhenExpected
}
export interface AcceptedDifferenceWenzhenFixture extends FixtureBase {
  status: 'accepted-difference'; capturedAt: string; sourceUrl: string; evidenceRef: string
  birth: BirthInput; flowQuery?: CycleQuery; expected: WenzhenExpected; acceptedAt: string; acceptedBy: string
  acceptedDifferences: readonly AcceptedDifference[]
}
export type WenzhenFixture = PendingWenzhenFixture | VerifiedWenzhenFixture | AcceptedDifferenceWenzhenFixture
export type ReportableWenzhenFixture = VerifiedWenzhenFixture | AcceptedDifferenceWenzhenFixture

export interface WenzhenDifference {
  path: string
  category: 'pillar' | 'time-correction' | 'time-profile' | 'pillar-detail' | 'luck-cycle' | 'annual-cycle' | 'monthly-cycle' | 'daily-cycle' | 'hourly-cycle'
  kind: 'missing' | 'type' | 'value'
  expected: unknown
  actual: unknown
  accepted: boolean
}
export interface WenzhenFixtureReport {
  schemaVersion: typeof WENZHEN_REPORT_SCHEMA_VERSION
  sampleId: string; fixtureStatus: ReportableWenzhenFixture['status']; source: string; sourceUrl: string
  capturedAt: string; evidenceRef: string; matched: boolean
  outcome: 'passed' | 'failed' | 'accepted-difference'
  assertionCoverage: WenzhenAssertionCoverage
  differences: readonly WenzhenDifference[]; staleAcceptedPaths: readonly string[]
}
export interface WenzhenExpectedPreviewReport {
  sampleId: string
  source: string
  matched: boolean
  comparedPaths: readonly string[]
  pathSemantics: 'wenzhen-leaf-v1'
  mismatches: readonly Pick<WenzhenDifference, 'path' | 'category' | 'expected' | 'actual'>[]
}
export interface WenzhenManifest {
  schemaVersion: typeof WENZHEN_REPORT_SCHEMA_VERSION
  generatedAt: string; inputDirectory: string; outputDirectory: string
  evidenceVerification: { directory: string | null; manifestEntries: number; bodiesVerified: number }
  totals: {
    jsonFiles: number; ignoredJsonFiles: number; fixtures: number; pending: number; verified: number; acceptedDifference: number; passed: number; accepted: number; failed: number
    coverage: Record<WenzhenAssertionCoverageCategory, number>
    /** Per-field fixture counts. `coverage` remains the backward-compatible category summary. */
    fieldCoverage: WenzhenAssertionFieldCoverage
  }
  captureMatrix?: WenzhenAcceptanceCoverage
  reports: readonly {
    sampleId: string; fixtureStatus: ReportableWenzhenFixture['status']; outcome: WenzhenFixtureReport['outcome']; differenceCount: number
    assertionCoverage: WenzhenAssertionCoverage
    reportFile: string
  }[]
}
export const WENZHEN_EVIDENCE_MANIFEST_SCHEMA_VERSION = 'wenzhen-evidence-manifest-v1'
export type WenzhenEvidenceMimeType = 'image/png' | 'image/jpeg' | 'image/webp'
export interface WenzhenEvidenceManifestEntry {
  evidenceRef: string
  sha256: string
  mimeType: WenzhenEvidenceMimeType
  size: number
  capturedAt: string
  captureMethod: string
  width?: number
  height?: number
}
export interface WenzhenEvidenceManifest {
  schemaVersion: typeof WENZHEN_EVIDENCE_MANIFEST_SCHEMA_VERSION
  evidence: readonly WenzhenEvidenceManifestEntry[]
}

const TOP_KEYS = new Set(['schemaVersion', 'sampleId', 'source', 'capturedAt', 'sourceUrl', 'evidenceRef', 'status', 'birth', 'flowQuery', 'expected', 'notes', 'acceptedAt', 'acceptedBy', 'acceptedDifferences'])
const BIRTH_KEYS = new Set(['date', 'time', 'locationName', 'longitude', 'calendarSystem', 'lunarLeapMonth', 'province', 'city', 'district', 'placeCode', 'geoDataVersion', 'latitude', 'timezone', 'dstPolicy', 'dayBoundary', 'luckMethod', 'useTrueSolarTime', 'timeCorrectionRuleVersion', 'gender'])
const EXPECTED_KEYS = new Set(['pillars', 'timeCorrectionRuleVersion', 'correctedLocalTime', 'correctionMinutes', 'timeProfile', 'pillarDetails', 'luckCycles', 'annualCycles', 'monthlyCycles', 'dailyCycles', 'hourlyCycles'])
const PLACEHOLDER = /(?:todo|tbd|placeholder|example)|YYYY|HH:mm|local-screenshot|待填写|待核对|^待$/iu
const GAN_ZHI = /^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]$/u
const SAMPLE_ID = /^[a-z0-9][a-z0-9._-]{2,79}$/i
const DIFFERENCE_PATH = /^(?:pillars|timeCorrectionRuleVersion|correctedLocalTime|correctionMinutes|timeProfile|pillarDetails|luckCycles|annualCycles|monthlyCycles|dailyCycles|hourlyCycles)(?:(?:\.[A-Za-z][A-Za-z0-9]*)|(?:\[\d+\])|(?:\{[A-Za-z0-9_=,: -]+\}))*$/
const EVIDENCE_REF = /^evidence\/wenzhen\/sha256-([a-f0-9]{64})\.(png|jpg|webp)$/
const EVIDENCE_MANIFEST_KEYS = new Set(['schemaVersion', 'evidence'])
const EVIDENCE_ENTRY_KEYS = new Set(['evidenceRef', 'sha256', 'mimeType', 'size', 'capturedAt', 'captureMethod', 'width', 'height'])
const CAPTURE_MATRIX_KEYS = new Set(['id', 'status', 'scenario', 'birth', 'flowQuery', 'capture', 'risk', 'batch', 'evidenceRef'])
const FLOW_QUERY_KEYS = new Set(['targetDate', 'targetTime'])
const ACCEPTED_DIFFERENCE_KEYS = new Set(['path', 'reason', 'classification'])
const ACCEPTED_DIFFERENCE_CLASSIFICATIONS = new Set<AcceptedDifferenceClassification>(['dependency', 'school-rule', 'timezone-location', 'display-rounding', 'bug'])
export const WENZHEN_ASSERTION_COVERAGE_CATEGORIES: readonly WenzhenAssertionCoverageCategory[] = ['pillars', 'time-correction', 'professional-table', 'luck-cycles', 'dynamic-cycles']
const DYNAMIC_CYCLE_KEYS = ['annualCycles', 'monthlyCycles', 'dailyCycles', 'hourlyCycles'] as const
const HOUR_SLOT_STARTS = new Set([23, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21])
const TRUE_SOLAR_TIME_RULE_VERSION = 'true-solar-v2-zone-meridian-equation-of-time'
const TRUE_SOLAR_TIME_V3_RULE_VERSION = 'true-solar-v3-standard-time-equation-of-time'
const CIVIL_TIME_RULE_VERSION = 'civil-time-v1-no-solar-correction'
const BIRTH_TIME_CORRECTION_RULE_VERSIONS = new Set([TRUE_SOLAR_TIME_RULE_VERSION, TRUE_SOLAR_TIME_V3_RULE_VERSION])
const EXPECTED_TIME_CORRECTION_RULE_VERSIONS = new Set([...BIRTH_TIME_CORRECTION_RULE_VERSIONS, CIVIL_TIME_RULE_VERSION])
const MIME_BY_EXTENSION: Record<string, WenzhenEvidenceMimeType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function enforceKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  const extras = Object.keys(value).filter((key) => !allowed.has(key))
  if (extras.length) throw new Error(`${path} contains unknown field(s): ${extras.join(', ')}`)
}
function stringValue(value: unknown, path: string, placeholders = false): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} must be a non-empty string`)
  if (!placeholders && PLACEHOLDER.test(value)) throw new Error(`${path} contains a template placeholder`)
  return value
}
function instant(value: unknown, path: string): string {
  const text = stringValue(value, path)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error(`${path} must be a real RFC 3339 timestamp with a timezone`)
  }
  return text
}
function sourceUrl(value: unknown, path: string): string {
  const text = stringValue(value, path)
  let parsed: URL
  try { parsed = new URL(text) } catch { throw new Error(`${path} must be a valid URL`) }
  if (parsed.protocol !== 'https:' || !(parsed.hostname === 'iwzwh.com' || parsed.hostname.endsWith('.iwzwh.com'))) {
    throw new Error(`${path} must be an HTTPS iwzwh.com page`)
  }
  return text
}
function evidenceRef(value: unknown, path: string): string {
  const text = stringValue(value, path)
  if (!EVIDENCE_REF.test(text)) throw new Error(`${path} must be a server-issued WenZhen evidence reference`)
  return text
}
function jsonEvidence(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (!value.trim()) throw new Error(`${path} must be a non-empty captured value`)
    if (PLACEHOLDER.test(value)) throw new Error(`${path} contains a template placeholder`)
    return
  }
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error(`${path} must contain finite JSON values`); return }
  if (Array.isArray(value)) { value.forEach((item, index) => jsonEvidence(item, `${path}[${index}]`)); return }
  if (isRecord(value)) { for (const [key, item] of Object.entries(value)) jsonEvidence(item, `${path}.${key}`); return }
  throw new Error(`${path} must contain JSON values`)
}
function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new Error(`${path} must be a positive integer`)
  return value
}
function validDate(value: unknown, path: string): string {
  const text = stringValue(value, path)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${path} must use YYYY-MM-DD`)
  const parsed = new Date(`${text}T00:00:00Z`)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== text) throw new Error(`${path} must be a real date`)
  return text
}
function ganZhiPillar(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} must be a non-empty captured value`)
  if (PLACEHOLDER.test(value)) throw new Error(`${path} contains a template placeholder`)
  if (!GAN_ZHI.test(value)) throw new Error(`${path} must be a real Gan-Zhi pillar`)
  return value
}
function optionalPositiveInteger(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined
  return positiveInteger(value, path)
}
function validateWenzhenEvidenceManifestEntry(value: unknown, context: string): WenzhenEvidenceManifestEntry {
  if (!isRecord(value)) throw new Error(`${context} must be an object`)
  enforceKeys(value, EVIDENCE_ENTRY_KEYS, context)
  const ref = evidenceRef(value.evidenceRef, `${context}.evidenceRef`)
  const hash = stringValue(value.sha256, `${context}.sha256`)
  const match = EVIDENCE_REF.exec(ref)!
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`${context}.sha256 must be a lowercase SHA-256 hex digest`)
  if (hash !== match[1]) throw new Error(`${context}.sha256 must match the digest embedded in evidenceRef`)
  const expectedMime = MIME_BY_EXTENSION[extname(ref)]
  if (value.mimeType !== expectedMime) throw new Error(`${context}.mimeType must match evidenceRef extension`)
  const mimeType = expectedMime
  const size = positiveInteger(value.size, `${context}.size`)
  const capturedAt = instant(value.capturedAt, `${context}.capturedAt`)
  const captureMethod = stringValue(value.captureMethod, `${context}.captureMethod`)
  return {
    evidenceRef: ref,
    sha256: hash,
    mimeType,
    size,
    capturedAt,
    captureMethod,
    width: optionalPositiveInteger(value.width, `${context}.width`),
    height: optionalPositiveInteger(value.height, `${context}.height`),
  }
}
export function validateWenzhenEvidenceManifest(value: unknown, context = 'evidence-manifest'): WenzhenEvidenceManifest {
  if (!isRecord(value)) throw new Error(`${context} must be an object`)
  enforceKeys(value, EVIDENCE_MANIFEST_KEYS, context)
  if (value.schemaVersion !== WENZHEN_EVIDENCE_MANIFEST_SCHEMA_VERSION) throw new Error(`${context}.schemaVersion must be ${WENZHEN_EVIDENCE_MANIFEST_SCHEMA_VERSION}`)
  if (!Array.isArray(value.evidence)) throw new Error(`${context}.evidence must be an array`)
  const refs = new Set<string>()
  const hashes = new Set<string>()
  const evidence = value.evidence.map((entry, index) => {
    const checked = validateWenzhenEvidenceManifestEntry(entry, `${context}.evidence[${index}]`)
    if (refs.has(checked.evidenceRef)) throw new Error(`${context}.evidence contains duplicate evidenceRef ${checked.evidenceRef}`)
    if (hashes.has(checked.sha256)) throw new Error(`${context}.evidence contains duplicate sha256 ${checked.sha256}`)
    refs.add(checked.evidenceRef)
    hashes.add(checked.sha256)
    return checked
  })
  return { schemaVersion: WENZHEN_EVIDENCE_MANIFEST_SCHEMA_VERSION, evidence }
}
async function readWenzhenEvidenceManifest(inputDirectory: string): Promise<WenzhenEvidenceManifest | null> {
  const manifestPath = join(inputDirectory, 'evidence-manifest.json')
  let value: unknown
  try { value = JSON.parse(await readFile(manifestPath, 'utf8')) }
  catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined
    if (code === 'ENOENT') return null
    throw new Error(`cannot read WenZhen evidence manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return validateWenzhenEvidenceManifest(value, manifestPath)
}
async function readWenzhenCaptureMatrix(inputDirectory: string): Promise<readonly WenzhenCaptureMatrixEntry[] | null> {
  const matrixPath = join(inputDirectory, 'capture-matrix.json')
  let value: unknown
  try { value = JSON.parse(await readFile(matrixPath, 'utf8')) }
  catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined
    if (code === 'ENOENT') return null
    throw new Error(`cannot read WenZhen capture matrix ${matrixPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return validateWenzhenCaptureMatrix(value, matrixPath)
}
function validateFixtureEvidenceBindings(fixtures: readonly ReportableWenzhenFixture[], manifest: WenzhenEvidenceManifest): void {
  const entries = new Map(manifest.evidence.map((entry) => [entry.evidenceRef, entry]))
  const used = new Set<string>()
  for (const fixture of fixtures) {
    const entry = entries.get(fixture.evidenceRef)
    if (!entry) throw new Error(`${fixture.sampleId}.evidenceRef is missing from evidence-manifest.json`)
    if (entry.capturedAt !== fixture.capturedAt) throw new Error(`${fixture.sampleId}.capturedAt must match evidence-manifest.json`)
    used.add(fixture.evidenceRef)
  }
  const orphans = manifest.evidence.map((entry) => entry.evidenceRef).filter((ref) => !used.has(ref))
  if (orphans.length) throw new Error(`evidence-manifest.json contains orphan evidenceRef(s): ${orphans.join(', ')}`)
}
function hasMimeSignature(bytes: Uint8Array, mimeType: WenzhenEvidenceMimeType): boolean {
  if (mimeType === 'image/png') {
    return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)
  }
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  return bytes.length >= 12
    && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
}
async function validateEvidenceBodies(manifest: WenzhenEvidenceManifest, evidenceDirectory: string): Promise<number> {
  const directory = resolve(evidenceDirectory)
  let verified = 0
  for (const entry of manifest.evidence) {
    const filePath = join(directory, basename(entry.evidenceRef))
    let bytes: Buffer
    try { bytes = await readFile(filePath) }
    catch (error) {
      throw new Error(`cannot read WenZhen evidence body ${entry.evidenceRef}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (bytes.byteLength !== entry.size) throw new Error(`${entry.evidenceRef} size does not match evidence-manifest.json`)
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== entry.sha256) throw new Error(`${entry.evidenceRef} SHA-256 does not match evidence-manifest.json`)
    if (!hasMimeSignature(bytes, entry.mimeType)) throw new Error(`${entry.evidenceRef} body signature does not match ${entry.mimeType}`)
    verified += 1
  }
  return verified
}
function validateBirth(value: unknown, path: string): BirthInput {
  if (!isRecord(value)) throw new Error(`${path} must be an object`)
  enforceKeys(value, BIRTH_KEYS, path)
  for (const key of ['calendarSystem', 'date', 'time', 'locationName', 'longitude', 'latitude', 'timezone', 'useTrueSolarTime', 'dstPolicy', 'dayBoundary', 'luckMethod', 'gender']) {
    if (!(key in value)) throw new Error(`${path}.${key} is required for a reproducible fixture`)
  }
  if (value.calendarSystem !== 'solar' && value.calendarSystem !== 'lunar') throw new Error(`${path}.calendarSystem must be solar or lunar`)
  if (value.calendarSystem === 'lunar' && typeof value.lunarLeapMonth !== 'boolean') throw new Error(`${path}.lunarLeapMonth is required for a lunar fixture`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stringValue(value.date, `${path}.date`))) throw new Error(`${path}.date must use YYYY-MM-DD`)
  if (!/^\d{2}:\d{2}$/.test(stringValue(value.time, `${path}.time`))) throw new Error(`${path}.time must use HH:mm`)
  stringValue(value.locationName, `${path}.locationName`)
  if (typeof value.longitude !== 'number' || !Number.isFinite(value.longitude)) throw new Error(`${path}.longitude must be finite`)
  if (typeof value.latitude !== 'number' || !Number.isFinite(value.latitude)) throw new Error(`${path}.latitude must be finite`)
  stringValue(value.timezone, `${path}.timezone`)
  if (typeof value.useTrueSolarTime !== 'boolean') throw new Error(`${path}.useTrueSolarTime must be boolean`)
  if (value.dstPolicy !== 'auto' && value.dstPolicy !== 'ignore') throw new Error(`${path}.dstPolicy must be auto or ignore`)
  if (value.dayBoundary !== 'midnight' && value.dayBoundary !== 'zi-hour-start') throw new Error(`${path}.dayBoundary must be midnight or zi-hour-start`)
  if (value.luckMethod !== 'sect1' && value.luckMethod !== 'sect2') throw new Error(`${path}.luckMethod must be sect1 or sect2`)
  if (value.gender !== 'male' && value.gender !== 'female') throw new Error(`${path}.gender must be male or female`)
  const requestedTimeCorrectionRuleVersion = (value.timeCorrectionRuleVersion ?? TRUE_SOLAR_TIME_RULE_VERSION) as TrueSolarTimeRuleVersion
  if (typeof requestedTimeCorrectionRuleVersion !== 'string' || !BIRTH_TIME_CORRECTION_RULE_VERSIONS.has(requestedTimeCorrectionRuleVersion)) {
    throw new Error(`${path}.timeCorrectionRuleVersion must be a supported true-solar-time rule`)
  }
  // Validate legacy fixtures against their effective v2 default without
  // rewriting the captured payload; evidence storage must remain byte-stable.
  const birth = value as unknown as BirthInput
  try { calculateBazi({ ...birth, timeCorrectionRuleVersion: requestedTimeCorrectionRuleVersion }) } catch (error) { throw new Error(`${path} is not calculable: ${error instanceof Error ? error.message : String(error)}`) }
  return birth
}
function validateFlowQuery(value: unknown, path: string, birth: BirthInput): CycleQuery {
  if (!isRecord(value)) throw new Error(`${path} must be an object`)
  enforceKeys(value, FLOW_QUERY_KEYS, path)
  const targetDate = stringValue(value.targetDate, `${path}.targetDate`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw new Error(`${path}.targetDate must use YYYY-MM-DD`)
  const targetTime = value.targetTime === undefined ? undefined : stringValue(value.targetTime, `${path}.targetTime`)
  if (targetTime !== undefined && !/^\d{2}:\d{2}$/.test(targetTime)) throw new Error(`${path}.targetTime must use HH:mm`)
  const query = { targetDate, ...(targetTime === undefined ? {} : { targetTime }) }
  try { calculateBaziFlow(birth, query) } catch (error) { throw new Error(`${path} is not calculable: ${error instanceof Error ? error.message : String(error)}`) }
  return query
}
export interface WenzhenCaptureMatrixEntry {
  id: string
  status: 'verified' | 'pending-capture'
  scenario: string
  birth: BirthInput
  flowQuery?: CycleQuery
  capture: readonly string[]
  risk: string
  batch: string
  evidenceRef?: string
}

const CAPTURE_ASSERTION_REQUIREMENTS: readonly { pattern: RegExp; paths: readonly string[] }[] = [
  { pattern: /(?:四柱|年柱|月柱|日柱|时柱)/u, paths: ['pillars'] },
  { pattern: /^(?:真太阳时|真太阳时显示|校正后真太阳时|校正后时间)$/u, paths: ['correctedLocalTime'] },
  { pattern: /(?:经纬度|夏令时参数|真太阳时参数口径|时区参数|UTC 偏移|^时区$)/u, paths: ['timeProfile'] },
  { pattern: /日期回拨/u, paths: ['correctedLocalTime'] },
  { pattern: /校正分钟/u, paths: ['correctionMinutes'] },
  { pattern: /(?:专业表格|十神|藏干|纳音|空亡|地势|自坐|神煞)/u, paths: ['pillarDetails'] },
  { pattern: /(?:大运|起运|顺逆|前八步大运)/u, paths: ['luckCycles'] },
  { pattern: /流年/u, paths: ['annualCycles'] },
  { pattern: /流月/u, paths: ['monthlyCycles'] },
  { pattern: /流日/u, paths: ['dailyCycles'] },
  { pattern: /流时/u, paths: ['hourlyCycles'] },
]

const INPUT_BOUND_CAPTURE_LABELS = new Set([
  '早晚子时参数',
  '农历输入',
  '闰月选择',
  '农历月末',
  '地点选择',
  '性别',
  '年干阴阳',
])

const MANUAL_REVIEW_CAPTURE_LABELS = new Set([
  '交节时刻',
  '节气时刻',
  '公历转换结果',
  '会员权限边界',
  '切换时刻',
  '交节与换日换时边界',
])

/** Converts the capture plan into versioned, machine-checkable minimum assertions. */
export function deriveWenzhenScenarioRequirement(entry: WenzhenCaptureMatrixEntry): WenzhenScenarioRequirement {
  const paths = new Set<string>()
  const machineAssertionLabels: string[] = []
  const inputBoundLabels: string[] = []
  const manualReviewLabels: string[] = []
  const unmappedLabels: string[] = []
  for (const label of entry.capture) {
    let machineMapped = false
    for (const requirement of CAPTURE_ASSERTION_REQUIREMENTS) {
      if (requirement.pattern.test(label)) {
        machineMapped = true
        requirement.paths.forEach((path) => paths.add(path))
      }
    }
    if (machineMapped) machineAssertionLabels.push(label)
    else if (INPUT_BOUND_CAPTURE_LABELS.has(label)) inputBoundLabels.push(label)
    else if (MANUAL_REVIEW_CAPTURE_LABELS.has(label)) manualReviewLabels.push(label)
    else unmappedLabels.push(label)
  }
  return {
    schemaVersion: WENZHEN_SCENARIO_REQUIREMENT_SCHEMA_VERSION,
    sampleId: entry.id,
    requiredAssertionPaths: [...paths].sort(),
    captureLabelCoverage: { machineAssertionLabels, inputBoundLabels, manualReviewLabels, unmappedLabels },
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function stage1GateFailures(
  matrix: readonly WenzhenCaptureMatrixEntry[],
  fixtures: readonly ReportableWenzhenFixture[],
  reports: readonly WenzhenFixtureReport[],
): { failures: WenzhenStage1GateFailure[]; requirements: WenzhenScenarioRequirement[] } {
  const fixturesById = new Map(fixtures.map((fixture) => [fixture.sampleId, fixture]))
  const reportsById = new Map(reports.map((report) => [report.sampleId, report]))
  const plannedIds = new Set(matrix.map((entry) => entry.id))
  const failures: WenzhenStage1GateFailure[] = []
  const requirements = matrix.map(deriveWenzhenScenarioRequirement)

  for (const entry of matrix) {
    const requirement = requirements.find((item) => item.sampleId === entry.id)!
    for (const label of requirement.captureLabelCoverage.unmappedLabels) {
      failures.push({ kind: 'unmapped-capture-label', sampleId: entry.id, detail: `capture label is not governed: ${label}` })
    }
    if (entry.status === 'pending-capture') {
      failures.push({ kind: 'pending-capture', sampleId: entry.id, detail: 'external WenZhen capture is still pending' })
      continue
    }
    const fixture = fixturesById.get(entry.id)
    const report = reportsById.get(entry.id)
    if (!fixture || !report) {
      failures.push({ kind: 'missing-fixture', sampleId: entry.id, detail: 'verified capture plan has no reportable fixture' })
      continue
    }
    if (entry.evidenceRef !== fixture.evidenceRef) failures.push({ kind: 'evidence-mismatch', sampleId: entry.id, detail: 'capture matrix and fixture evidenceRef differ' })
    if (stableJson(entry.birth) !== stableJson(fixture.birth)) failures.push({ kind: 'birth-input-drift', sampleId: entry.id, detail: 'capture matrix and fixture birth input differ' })
    if (stableJson(entry.flowQuery ?? null) !== stableJson(fixture.flowQuery ?? null)) failures.push({ kind: 'flow-query-drift', sampleId: entry.id, detail: 'capture matrix and fixture flowQuery differ' })
    if (report.outcome === 'failed') failures.push({ kind: 'failed-fixture', sampleId: entry.id, detail: 'fixture differs from the current engine' })
    if (requirement.requiredAssertionPaths.length === 0) {
      failures.push({ kind: 'missing-required-assertion', sampleId: entry.id, detail: 'capture plan has no machine-mapped assertion requirement' })
    }
    for (const path of requirement.requiredAssertionPaths) {
      if (!report.assertionCoverage.assertedTopLevelFields.includes(path)) {
        failures.push({ kind: 'missing-required-assertion', sampleId: entry.id, detail: `capture plan requires expected.${path}` })
      }
    }
  }
  for (const fixture of fixtures) {
    if (!plannedIds.has(fixture.sampleId)) failures.push({ kind: 'unplanned-fixture', sampleId: fixture.sampleId, detail: 'fixture is absent from capture-matrix.json' })
  }
  return { failures, requirements }
}

function incrementCoverage(
  target: Record<string, { planned: number; verified: number; pending: number }>,
  key: string,
  status: WenzhenCaptureMatrixEntry['status'],
): void {
  const current = target[key] ?? { planned: 0, verified: 0, pending: 0 }
  current.planned += 1
  if (status === 'verified') current.verified += 1
  else current.pending += 1
  target[key] = current
}

export function summarizeWenzhenAcceptance(
  matrix: readonly WenzhenCaptureMatrixEntry[],
  reports: readonly WenzhenFixtureReport[],
  fixtures: readonly ReportableWenzhenFixture[],
): WenzhenAcceptanceCoverage {
  const plannedById = new Map(matrix.map((entry) => [entry.id, entry]))
  const passedOrAccepted = new Set(
    reports
      .filter((report) => report.outcome === 'passed' || report.outcome === 'accepted-difference')
      .map((report) => report.sampleId),
  )
  const reportIds = new Set(reports.map((report) => report.sampleId))
  const unplannedFixtureIds = reports.map((report) => report.sampleId).filter((sampleId) => !plannedById.has(sampleId)).sort()
  const plannedVerifiedMissingFixtureIds = matrix
    .filter((entry) => entry.status === 'verified' && !passedOrAccepted.has(entry.id))
    .map((entry) => entry.id)
    .sort()
  const pendingCaptureIds = matrix.filter((entry) => entry.status === 'pending-capture').map((entry) => entry.id).sort()
  const coverageByRisk: WenzhenAcceptanceCoverage['coverageByRisk'] = {}
  const coverageByCapture: WenzhenAcceptanceCoverage['coverageByCapture'] = {}
  matrix.forEach((entry) => {
    incrementCoverage(coverageByRisk, entry.risk, entry.status)
    entry.capture.forEach((capture) => incrementCoverage(coverageByCapture, capture, entry.status))
  })
  const failedFixtures = reports.filter((report) => report.outcome === 'failed').length
  const everyVerifiedPlanHasPassingFixture = plannedVerifiedMissingFixtureIds.length === 0
    && matrix.filter((entry) => entry.status === 'verified').every((entry) => reportIds.has(entry.id))
  const allPlannedCaptured = pendingCaptureIds.length === 0
  const noUnplannedFixtures = unplannedFixtureIds.length === 0
  const noFailedFixtures = failedFixtures === 0
  const governance = stage1GateFailures(matrix, fixtures, reports)
  const noGovernanceFailures = governance.failures.length === 0
  return {
    totalPlanned: matrix.length,
    verifiedPlanned: matrix.filter((entry) => entry.status === 'verified').length,
    pendingCapture: pendingCaptureIds.length,
    reportableFixtures: reports.length,
    passedFixtures: reports.filter((report) => report.outcome === 'passed').length,
    acceptedDifferenceFixtures: reports.filter((report) => report.outcome === 'accepted-difference').length,
    failedFixtures,
    unplannedFixtureIds,
    plannedVerifiedMissingFixtureIds,
    pendingCaptureIds,
    gateFailures: governance.failures,
    scenarioRequirements: governance.requirements,
    coverageByRisk,
    coverageByCapture,
    readiness: {
      allPlannedCaptured,
      everyVerifiedPlanHasPassingFixture,
      noUnplannedFixtures,
      noFailedFixtures,
      noGovernanceFailures,
      stage1ParityClaimReady: allPlannedCaptured && everyVerifiedPlanHasPassingFixture && noUnplannedFixtures && noFailedFixtures && noGovernanceFailures,
    },
  }
}

/** Ensures every planned capture can be promoted without rewriting its deterministic input. */
export function validateWenzhenCaptureMatrix(value: unknown, context = 'capture-matrix'): readonly WenzhenCaptureMatrixEntry[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`)
  const ids = new Set<string>()
  return value.map((item, index) => {
    const path = `${context}[${index}]`
    if (!isRecord(item)) throw new Error(`${path} must be an object`)
    enforceKeys(item, CAPTURE_MATRIX_KEYS, path)
    const id = stringValue(item.id, `${path}.id`, true)
    if (!SAMPLE_ID.test(id)) throw new Error(`${path}.id has an invalid format`)
    if (ids.has(id)) throw new Error(`${context} contains duplicate id ${id}`)
    ids.add(id)
    if (item.status !== 'verified' && item.status !== 'pending-capture') throw new Error(`${path}.status must be verified or pending-capture`)
    const scenario = stringValue(item.scenario, `${path}.scenario`)
    if (!isRecord(item.birth) || item.birth.timeCorrectionRuleVersion === undefined) {
      throw new Error(`${path}.birth.timeCorrectionRuleVersion is required for a promotable capture`)
    }
    const birth = validateBirth(item.birth, `${path}.birth`)
    if (!Array.isArray(item.capture) || !item.capture.length) throw new Error(`${path}.capture must be a non-empty array`)
    const capture = item.capture.map((field, fieldIndex) => stringValue(field, `${path}.capture[${fieldIndex}]`))
    const risk = stringValue(item.risk, `${path}.risk`)
    const batch = stringValue(item.batch, `${path}.batch`)
    let flowQuery: CycleQuery | undefined
    if (item.flowQuery !== undefined) {
      flowQuery = validateFlowQuery(item.flowQuery, `${path}.flowQuery`, birth)
    }
    const ref = item.status === 'verified'
      ? evidenceRef(item.evidenceRef, `${path}.evidenceRef`)
      : undefined
    if (item.status === 'pending-capture' && item.evidenceRef !== undefined) throw new Error(`${path} pending captures cannot declare evidenceRef`)
    return {
      id,
      status: item.status,
      scenario,
      birth,
      ...(flowQuery ? { flowQuery } : {}),
      capture,
      risk,
      batch,
      ...(ref ? { evidenceRef: ref } : {}),
    }
  })
}
function validateExpected(value: unknown, path: string): WenzhenExpected {
  if (!isRecord(value)) throw new Error(`${path} must be an object`)
  enforceKeys(value, EXPECTED_KEYS, path)
  if (!Array.isArray(value.pillars) || value.pillars.length !== 4 || !value.pillars.every((item) => typeof item === 'string' && GAN_ZHI.test(item))) throw new Error(`${path}.pillars must contain four real Gan-Zhi pillars`)
  if (value.timeCorrectionRuleVersion !== undefined && (typeof value.timeCorrectionRuleVersion !== 'string' || !EXPECTED_TIME_CORRECTION_RULE_VERSIONS.has(value.timeCorrectionRuleVersion))) throw new Error(`${path}.timeCorrectionRuleVersion must be a supported time-correction rule`)
  if (value.correctedLocalTime !== undefined && (typeof value.correctedLocalTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.correctedLocalTime))) throw new Error(`${path}.correctedLocalTime must use YYYY-MM-DDTHH:mm`)
  if (value.correctionMinutes !== undefined && (typeof value.correctionMinutes !== 'number' || !Number.isFinite(value.correctionMinutes))) throw new Error(`${path}.correctionMinutes must be finite`)
  if (value.timeProfile !== undefined && !isRecord(value.timeProfile)) throw new Error(`${path}.timeProfile must be an object`)
  for (const key of ['pillarDetails', 'luckCycles', 'annualCycles', 'monthlyCycles', 'dailyCycles', 'hourlyCycles']) if (value[key] !== undefined && !Array.isArray(value[key])) throw new Error(`${path}.${key} must be an array`)
  DYNAMIC_CYCLE_KEYS.forEach((key) => validateDynamicCycleExpected(key, value[key], `${path}.${key}`))
  jsonEvidence(value, path)
  return value as unknown as WenzhenExpected
}
function hasDynamicExpectation(expected: WenzhenExpected): boolean {
  return DYNAMIC_CYCLE_KEYS.some((key) => expected[key] !== undefined)
}

type DynamicCycleKey = typeof DYNAMIC_CYCLE_KEYS[number]
function validateDynamicCycleExpected(field: DynamicCycleKey, value: unknown, path: string): void {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  if (!value.length) throw new Error(`${path} must contain at least one captured cycle`)
  value.forEach((item, index) => validateDynamicCycleExpectedItem(field, item, `${path}[${index}]`))
}
function validateDynamicCycleExpectedItem(field: DynamicCycleKey, item: unknown, path: string): void {
  if (!isRecord(item)) throw new Error(`${path} must be an object`)
  ganZhiPillar(item.pillar, `${path}.pillar`)
  if (field === 'annualCycles') {
    positiveInteger(item.year, `${path}.year`)
    return
  }
  if (field === 'monthlyCycles') {
    positiveInteger(item.year, `${path}.year`)
    const month = positiveInteger(item.month, `${path}.month`)
    if (month > 12) throw new Error(`${path}.month must be between 1 and 12`)
    return
  }
  if (field === 'dailyCycles') {
    validDate(item.date, `${path}.date`)
    return
  }
  const hasDateTime = item.dateTime !== undefined
  const hasStartHour = item.startHour !== undefined
  if (!hasDateTime && !hasStartHour) throw new Error(`${path} must include dateTime or startHour`)
  if (hasDateTime) {
    const dateTime = stringValue(item.dateTime, `${path}.dateTime`)
    if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(dateTime)) throw new Error(`${path}.dateTime must use YYYY-MM-DD HH:mm`)
  }
  if (hasStartHour) {
    const startHour = positiveInteger(item.startHour, `${path}.startHour`)
    if (!HOUR_SLOT_STARTS.has(startHour)) throw new Error(`${path}.startHour must be a supported two-hour slot start`)
  }
}

function collectAssertionLeafPaths(value: unknown, path: string, result: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectAssertionLeafPaths(item, `${path}[${index}]`, result))
    return
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) => collectAssertionLeafPaths(item, path ? `${path}.${key}` : key, result))
    return
  }
  if (value !== undefined) result.push(path)
}

/** Derives claim scope from the actual partial expectation; fixture authors cannot self-declare broader coverage. */
export function deriveWenzhenAssertionCoverage(expected: WenzhenExpected): WenzhenAssertionCoverage {
  const assertedTopLevelFields = Object.keys(expected)
  const assertedLeafPaths: string[] = []
  collectAssertionLeafPaths(expected, '', assertedLeafPaths)
  const hasLeaf = (field: string): boolean => assertedLeafPaths.some((path) => path === field || path.startsWith(`${field}.`) || path.startsWith(`${field}[`))
  const categories: WenzhenAssertionCoverageCategory[] = []
  if (hasLeaf('pillars')) categories.push('pillars')
  if (['timeCorrectionRuleVersion', 'correctedLocalTime', 'correctionMinutes', 'timeProfile'].some(hasLeaf)) categories.push('time-correction')
  if (hasLeaf('pillarDetails')) categories.push('professional-table')
  if (hasLeaf('luckCycles')) categories.push('luck-cycles')
  if (['annualCycles', 'monthlyCycles', 'dailyCycles', 'hourlyCycles'].some(hasLeaf)) categories.push('dynamic-cycles')
  return { categories, assertedTopLevelFields, assertedLeafPaths, partial: true }
}

function countReportsWithField(reports: readonly WenzhenFixtureReport[], field: string): number {
  return reports.filter((report) => report.assertionCoverage.assertedLeafPaths.some((path) => (
    path === field || path.startsWith(`${field}.`) || path.startsWith(`${field}[`)
  ))).length
}

function deriveWenzhenAssertionFieldCoverage(reports: readonly WenzhenFixtureReport[]): WenzhenAssertionFieldCoverage {
  return {
    timeCorrection: {
      ruleVersion: countReportsWithField(reports, 'timeCorrectionRuleVersion'),
      correctedLocalTime: countReportsWithField(reports, 'correctedLocalTime'),
      correctionMinutes: countReportsWithField(reports, 'correctionMinutes'),
      timeProfile: countReportsWithField(reports, 'timeProfile'),
    },
    professional: { pillarDetails: countReportsWithField(reports, 'pillarDetails') },
    luck: { luckCycles: countReportsWithField(reports, 'luckCycles') },
    dynamic: {
      annualCycles: countReportsWithField(reports, 'annualCycles'),
      monthlyCycles: countReportsWithField(reports, 'monthlyCycles'),
      dailyCycles: countReportsWithField(reports, 'dailyCycles'),
      hourlyCycles: countReportsWithField(reports, 'hourlyCycles'),
    },
  }
}

/** Strict runtime validation. Only pending fixtures may retain template placeholders. */
export function validateWenzhenFixture(value: unknown, context = 'fixture'): WenzhenFixture {
  if (!isRecord(value)) throw new Error(`${context} must be an object`)
  enforceKeys(value, TOP_KEYS, context)
  if (value.schemaVersion !== undefined && value.schemaVersion !== WENZHEN_FIXTURE_SCHEMA_VERSION) throw new Error(`${context}.schemaVersion must be ${WENZHEN_FIXTURE_SCHEMA_VERSION}`)
  const id = stringValue(value.sampleId, `${context}.sampleId`, true)
  if (!SAMPLE_ID.test(id)) throw new Error(`${context}.sampleId has an invalid format`)
  stringValue(value.source, `${context}.source`, true)
  if (value.notes !== undefined) stringValue(value.notes, `${context}.notes`, true)
  if (value.status === 'pending-manual-verification') return value as unknown as PendingWenzhenFixture
  if (value.status !== 'verified' && value.status !== 'accepted-difference') throw new Error(`${context}.status is invalid`)
  instant(value.capturedAt, `${context}.capturedAt`)
  sourceUrl(value.sourceUrl, `${context}.sourceUrl`)
  evidenceRef(value.evidenceRef, `${context}.evidenceRef`)
  const birth = validateBirth(value.birth, `${context}.birth`)
  const flowQuery = value.flowQuery === undefined ? undefined : validateFlowQuery(value.flowQuery, `${context}.flowQuery`, birth)
  const expected = validateExpected(value.expected, `${context}.expected`)
  if (hasDynamicExpectation(expected) && flowQuery === undefined) throw new Error(`${context}.flowQuery is required when expected contains dynamic cycles`)
  if (value.status === 'verified') {
    if (value.acceptedDifferences !== undefined || value.acceptedAt !== undefined || value.acceptedBy !== undefined) throw new Error(`${context} verified fixtures cannot declare accepted differences`)
    return { ...value, birth, ...(flowQuery ? { flowQuery } : {}), expected } as unknown as VerifiedWenzhenFixture
  }
  instant(value.acceptedAt, `${context}.acceptedAt`)
  stringValue(value.acceptedBy, `${context}.acceptedBy`)
  if (!Array.isArray(value.acceptedDifferences) || !value.acceptedDifferences.length) throw new Error(`${context}.acceptedDifferences must be a non-empty array`)
  const seen = new Set<string>()
  value.acceptedDifferences.forEach((item, index) => {
    const itemPath = `${context}.acceptedDifferences[${index}]`
    if (!isRecord(item)) throw new Error(`${itemPath} must be an object`)
    enforceKeys(item, ACCEPTED_DIFFERENCE_KEYS, itemPath)
    const differencePath = stringValue(item.path, `${itemPath}.path`)
    if (!DIFFERENCE_PATH.test(differencePath)) throw new Error(`${itemPath}.path is unsupported`)
    if (seen.has(differencePath)) throw new Error(`${context}.acceptedDifferences contains duplicate path ${differencePath}`)
    seen.add(differencePath)
    stringValue(item.reason, `${itemPath}.reason`)
    if (item.classification !== undefined) {
      if (typeof item.classification !== 'string' || !ACCEPTED_DIFFERENCE_CLASSIFICATIONS.has(item.classification as AcceptedDifferenceClassification)) {
        throw new Error(`${itemPath}.classification is unsupported`)
      }
      if (item.classification === 'bug') throw new Error(`${itemPath}.classification bug cannot be accepted as a compatible difference`)
    }
  })
  return { ...value, birth, ...(flowQuery ? { flowQuery } : {}), expected } as unknown as AcceptedDifferenceWenzhenFixture
}

function category(path: string): WenzhenDifference['category'] {
  if (path.startsWith('pillars')) return 'pillar'
  if (path.startsWith('timeCorrectionRuleVersion') || path.startsWith('correctedLocalTime') || path.startsWith('correctionMinutes')) return 'time-correction'
  if (path.startsWith('timeProfile')) return 'time-profile'
  if (path.startsWith('pillarDetails')) return 'pillar-detail'
  if (path.startsWith('luckCycles')) return 'luck-cycle'
  if (path.startsWith('annualCycles')) return 'annual-cycle'
  if (path.startsWith('monthlyCycles')) return 'monthly-cycle'
  if (path.startsWith('dailyCycles')) return 'daily-cycle'
  return 'hourly-cycle'
}
function compare(expected: unknown, actual: unknown, path: string, accepted: ReadonlySet<string>, output: WenzhenDifference[]): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) { output.push({ path, category: category(path), kind: actual === undefined ? 'missing' : 'type', expected, actual: actual ?? null, accepted: accepted.has(path) }); return }
    expected.forEach((item, index) => compare(item, actual[index], `${path}[${index}]`, accepted, output)); return
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) { output.push({ path, category: category(path), kind: actual === undefined ? 'missing' : 'type', expected, actual: actual ?? null, accepted: accepted.has(path) }); return }
    Object.entries(expected).forEach(([key, item]) => compare(item, actual[key], `${path}.${key}`, accepted, output)); return
  }
  if (!Object.is(expected, actual)) output.push({ path, category: category(path), kind: actual === undefined ? 'missing' : typeof expected === typeof actual ? 'value' : 'type', expected, actual: actual ?? null, accepted: accepted.has(path) })
}
function selectDynamicCycleActual(field: DynamicCycleKey, expected: unknown, flow: BaziFlowChart): { actual: unknown; path: string } {
  if (field === 'annualCycles') {
    const year = isRecord(expected) && typeof expected.year === 'number' ? expected.year : flow.selection.year
    return { actual: flow.annualCycles.find((item) => item.year === year), path: `annualCycles{year=${year}}` }
  }
  if (field === 'monthlyCycles') {
    const month = isRecord(expected) && typeof expected.month === 'number' ? expected.month : flow.selection.month
    const year = isRecord(expected) && typeof expected.year === 'number' ? expected.year : flow.selection.year
    return { actual: flow.monthlyCycles.find((item) => item.month === month && (item.year === undefined || item.year === year)), path: `monthlyCycles{year=${year},month=${month}}` }
  }
  if (field === 'dailyCycles') {
    const date = isRecord(expected) && typeof expected.date === 'string' ? expected.date : flow.selection.date
    return { actual: flow.dailyCycles.find((item) => item.date === date), path: `dailyCycles{date=${date}}` }
  }
  if (isRecord(expected) && typeof expected.dateTime === 'string') {
    return { actual: flow.hourlyCycles.find((item) => item.dateTime === expected.dateTime), path: `hourlyCycles{dateTime=${expected.dateTime}}` }
  }
  const startHour = isRecord(expected) && typeof expected.startHour === 'number' ? expected.startHour : flow.selection.hourSlotStart
  return { actual: flow.hourlyCycles.find((item) => item.startHour === startHour), path: `hourlyCycles{startHour=${startHour}}` }
}
function compareDynamicCycles(field: DynamicCycleKey, expected: unknown, flow: BaziFlowChart, accepted: ReadonlySet<string>, output: WenzhenDifference[]): void {
  if (!Array.isArray(expected)) {
    compare(expected, flow[field], field, accepted, output)
    return
  }
  expected.forEach((item) => {
    const { actual, path } = selectDynamicCycleActual(field, item, flow)
    compare(item, actual, path, accepted, output)
  })
}

function compareWenzhenExpectedValues(
  expected: WenzhenExpected,
  actual: BaziChart,
  flow: BaziFlowChart | undefined,
  accepted: ReadonlySet<string> = new Set(),
): WenzhenDifference[] {
  const differences: WenzhenDifference[] = []
  Object.entries(expected).forEach(([key, value]) => {
    if (flow !== undefined && ['annualCycles', 'monthlyCycles', 'dailyCycles', 'hourlyCycles'].includes(key)) {
      compareDynamicCycles(key as DynamicCycleKey, value, flow, accepted, differences)
      return
    }
    compare(value, actual[key as keyof BaziChart], key, accepted, differences)
  })
  return differences
}

/**
 * Preview a fixture-compatible expectation with the exact recursive leaf-path
 * semantics used by persisted WenZhen reports. This deliberately has no
 * evidence/reviewer inputs because it cannot persist or accept a difference.
 */
export function compareWenzhenExpected(
  sampleId: string,
  source: string,
  birth: BirthInput,
  expected: WenzhenExpected,
  flowQuery?: CycleQuery,
): WenzhenExpectedPreviewReport {
  const checkedExpected = validateExpected(expected, 'wenzhenPreview.expected')
  if (hasDynamicExpectation(checkedExpected) && flowQuery === undefined) throw new Error('wenzhenPreview.flowQuery is required when expected contains dynamic cycles')
  const flow = flowQuery === undefined ? undefined : validateFlowQuery(flowQuery, 'wenzhenPreview.flowQuery', birth)
  const differences = compareWenzhenExpectedValues(checkedExpected, calculateBazi(birth), flow === undefined ? undefined : calculateBaziFlow(birth, flow))
  return {
    sampleId,
    source,
    matched: differences.length === 0,
    comparedPaths: Object.keys(checkedExpected),
    pathSemantics: 'wenzhen-leaf-v1',
    mismatches: differences.map(({ path, category: differenceCategory, expected: wanted, actual: got }) => ({
      path,
      category: differenceCategory,
      expected: wanted,
      actual: got,
    })),
  }
}

export function createWenzhenFixtureReport(fixture: ReportableWenzhenFixture): WenzhenFixtureReport {
  const checked = validateWenzhenFixture(fixture) as ReportableWenzhenFixture
  const actual = calculateBazi(checked.birth)
  const flow = checked.flowQuery === undefined ? undefined : calculateBaziFlow(checked.birth, checked.flowQuery)
  const accepted = new Set(checked.status === 'accepted-difference' ? checked.acceptedDifferences.map((item) => item.path) : [])
  const differences = compareWenzhenExpectedValues(checked.expected, actual, flow, accepted)
  const observed = new Set(differences.map((item) => item.path))
  const staleAcceptedPaths = [...accepted].filter((path) => !observed.has(path)).sort()
  const matched = !differences.length
  const outcome = matched ? 'passed' : checked.status === 'accepted-difference' && differences.every((item) => item.accepted) && !staleAcceptedPaths.length ? 'accepted-difference' : 'failed'
  return {
    schemaVersion: WENZHEN_REPORT_SCHEMA_VERSION,
    sampleId: checked.sampleId,
    fixtureStatus: checked.status,
    source: checked.source,
    sourceUrl: checked.sourceUrl,
    capturedAt: checked.capturedAt,
    evidenceRef: checked.evidenceRef,
    matched,
    outcome,
    assertionCoverage: deriveWenzhenAssertionCoverage(checked.expected),
    differences,
    staleAcceptedPaths,
  }
}

async function jsonFiles(directory: string): Promise<string[]> {
  const entries: Dirent[] = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await jsonFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(path)
  }
  return files
}
function candidates(value: unknown): unknown[] {
  if (isRecord(value) && ('sampleId' in value || 'status' in value)) return [value]
  if (isRecord(value) && Array.isArray(value.samples)) return value.samples
  return []
}
export interface GenerateWenzhenReportsOptions {
  inputDirectory: string
  outputDirectory: string
  /** When supplied, every manifest entry must have a matching immutable screenshot body in this directory. */
  evidenceDirectory?: string
  now?: () => Date
}

/** Validates all candidates before writing and never overwrites an existing output directory. */
export async function generateWenzhenFixtureReports(options: GenerateWenzhenReportsOptions): Promise<WenzhenManifest> {
  if (!options.inputDirectory?.trim()) throw new Error('inputDirectory is required')
  if (!options.outputDirectory?.trim()) throw new Error('outputDirectory is required')
  const inputDirectory = resolve(options.inputDirectory)
  const outputDirectory = resolve(options.outputDirectory)
  if (inputDirectory === outputDirectory || outputDirectory.startsWith(`${inputDirectory}/`)) throw new Error('outputDirectory must be outside inputDirectory')
  try { await readdir(outputDirectory); throw new Error(`refusing to overwrite existing output directory: ${outputDirectory}`) }
  catch (error) { const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined; if (code !== 'ENOENT') throw error }

  const files = await jsonFiles(inputDirectory)
  const fixtures: WenzhenFixture[] = []
  const ids = new Set<string>()
  let ignoredJsonFiles = 0
  for (const file of files) {
    if (basename(file).toLowerCase() === 'template.json') {
      ignoredJsonFiles += 1
      continue
    }
    let value: unknown
    try { value = JSON.parse(await readFile(file, 'utf8')) }
    catch (error) { throw new Error(`cannot read JSON fixture file ${file}: ${error instanceof Error ? error.message : String(error)}`) }
    const found = candidates(value)
    if (!found.length) { ignoredJsonFiles += 1; continue }
    found.forEach((candidate, index) => {
      const fixture = validateWenzhenFixture(candidate, `${file}#${index}`)
      if (ids.has(fixture.sampleId)) throw new Error(`duplicate sampleId: ${fixture.sampleId}`)
      ids.add(fixture.sampleId); fixtures.push(fixture)
    })
  }
  const reportable = fixtures.filter((item): item is ReportableWenzhenFixture => item.status !== 'pending-manual-verification')
  const evidenceManifest = await readWenzhenEvidenceManifest(inputDirectory)
  let bodiesVerified = 0
  if (reportable.length || evidenceManifest) {
    if (!evidenceManifest) throw new Error('evidence-manifest.json is required when verified or accepted WenZhen fixtures exist')
    validateFixtureEvidenceBindings(reportable, evidenceManifest)
    if (!options.evidenceDirectory) throw new Error('evidenceDirectory is required when verified or accepted WenZhen fixtures exist')
    bodiesVerified = await validateEvidenceBodies(evidenceManifest, options.evidenceDirectory)
  }
  const reports = reportable.map(createWenzhenFixtureReport)
  const captureMatrix = await readWenzhenCaptureMatrix(inputDirectory)
  const coverage = Object.fromEntries(WENZHEN_ASSERTION_COVERAGE_CATEGORIES.map((category) => [
    category,
    reports.filter((report) => report.assertionCoverage.categories.includes(category)).length,
  ])) as Record<WenzhenAssertionCoverageCategory, number>
  const manifest: WenzhenManifest = {
    schemaVersion: WENZHEN_REPORT_SCHEMA_VERSION,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(), inputDirectory, outputDirectory,
    evidenceVerification: {
      directory: options.evidenceDirectory ? resolve(options.evidenceDirectory) : null,
      manifestEntries: evidenceManifest?.evidence.length ?? 0,
      bodiesVerified,
    },
    totals: {
      jsonFiles: files.length, ignoredJsonFiles, fixtures: fixtures.length,
      pending: fixtures.filter((item) => item.status === 'pending-manual-verification').length,
      verified: fixtures.filter((item) => item.status === 'verified').length,
      acceptedDifference: fixtures.filter((item) => item.status === 'accepted-difference').length,
      passed: reports.filter((item) => item.outcome === 'passed').length,
      accepted: reports.filter((item) => item.outcome === 'accepted-difference').length,
      failed: reports.filter((item) => item.outcome === 'failed').length,
      coverage,
      fieldCoverage: deriveWenzhenAssertionFieldCoverage(reports),
    },
    ...(captureMatrix ? { captureMatrix: summarizeWenzhenAcceptance(captureMatrix, reports, reportable) } : {}),
    reports: reports.map((item) => ({
      sampleId: item.sampleId,
      fixtureStatus: item.fixtureStatus,
      outcome: item.outcome,
      differenceCount: item.differences.length,
      assertionCoverage: item.assertionCoverage,
      reportFile: `reports/${item.sampleId}.json`,
    })),
  }
  await mkdir(join(outputDirectory, 'reports'), { recursive: true, mode: 0o700 })
  for (const report of reports) await writeFile(join(outputDirectory, 'reports', `${report.sampleId}.json`), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  await writeFile(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  return manifest
}

export function formatWenzhenManifestSummary(manifest: WenzhenManifest): string {
  const coverage = WENZHEN_ASSERTION_COVERAGE_CATEGORIES.map((category) => `${category}:${manifest.totals.coverage[category]}`).join(',')
  return `fixtures=${manifest.totals.fixtures} pending=${manifest.totals.pending} passed=${manifest.totals.passed} accepted=${manifest.totals.accepted} failed=${manifest.totals.failed} coverage=${coverage} output=${basename(manifest.outputDirectory)}`
}

export function assertWenzhenStage1Ready(manifest: WenzhenManifest): void {
  if (!manifest.captureMatrix) throw new Error('Stage 1 gate requires capture-matrix.json')
  if (manifest.totals.pending > 0) throw new Error(`Stage 1 gate failed: ${manifest.totals.pending} pending fixture(s) remain`)
  if (!manifest.captureMatrix.readiness.stage1ParityClaimReady) {
    const failures = manifest.captureMatrix.gateFailures
      .map((failure) => `${failure.sampleId}:${failure.kind}`)
      .join(', ')
    throw new Error(`Stage 1 gate failed: ${failures || 'capture matrix is not ready'}`)
  }
}
