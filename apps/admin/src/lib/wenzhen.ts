import type {
  BaziFlowSelection,
  WenzhenAcceptanceValidation,
  WenzhenAssertionCoverage,
  WenzhenAssertionCoverageCategory,
  WenzhenCaptureDraft,
  WenzhenDifferenceClassification,
  WenzhenDifferenceClassificationSelection,
  WenzhenMismatch,
  AcceptedWenzhenDifference,
} from '../types'

export const wenzhenSourceUrl = 'https://pcbz.iwzwh.com/#/paipan/index'

export const wenzhenDifferenceClassificationLabels: Record<WenzhenDifferenceClassification, string> = {
  dependency: '依赖库差异',
  'school-rule': '流派规则差异',
  'timezone-location': '时区或地点差异',
  'display-rounding': '显示或舍入差异',
  bug: '产品缺陷',
}

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

const dynamicWenzhenCycleKeys = ['annualCycles', 'monthlyCycles', 'dailyCycles', 'hourlyCycles'] as const
const incompleteDynamicPillars = new Set(['', '待填', '待填写', '待摘录', 'placeholder', 'TODO', '__PILLAR__'])

function parseWenzhenExpectedJsonObject(expectedJson: string) {
  const trimmed = expectedJson.trim()
  if (!trimmed) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error('扩展 expected JSON 不是合法 JSON。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('扩展 expected JSON 必须是对象。')
  }
  if ('pillars' in parsed) {
    throw new Error('扩展 expected JSON 不要包含 pillars；四柱请使用上方专用输入。')
  }
  return parsed as Record<string, unknown>
}

function assertCompleteDynamicWenzhenPillars(expected: Record<string, unknown>) {
  for (const key of dynamicWenzhenCycleKeys) {
    const cycles = expected[key]
    if (cycles === undefined) continue
    if (!Array.isArray(cycles)) continue
    cycles.forEach((cycle, index) => {
      if (!cycle || typeof cycle !== 'object' || Array.isArray(cycle)) return
      const pillar = 'pillar' in cycle ? String((cycle as { pillar?: unknown }).pillar ?? '').trim() : ''
      if (incompleteDynamicPillars.has(pillar)) {
        throw new Error(`扩展 expected JSON 的 ${key}[${index}].pillar 仍为空或为占位值，请先从问真截图摘录真实干支。`)
      }
    })
  }
}

export function buildWenzhenExpectedFromAdminInput(pillars: string[], expectedJson: string) {
  if (pillars.length !== 4) throw new Error('请按顺序输入年柱、月柱、日柱、时柱四个干支。')
  const parsed = parseWenzhenExpectedJsonObject(expectedJson)
  assertCompleteDynamicWenzhenPillars(parsed)
  return { ...parsed, pillars }
}

export function emptyWenzhenAcceptanceSelections(paths: string[] = []) {
  return {
    reasons: Object.fromEntries(paths.map((path) => [path, ''])) as Record<string, string>,
    classifications: Object.fromEntries(paths.map((path) => [path, ''])) as Record<string, WenzhenDifferenceClassificationSelection>,
  }
}

export function validateWenzhenAcceptance(
  mismatches: WenzhenMismatch[],
  reasons: Record<string, string>,
  classifications: Record<string, WenzhenDifferenceClassificationSelection>,
): WenzhenAcceptanceValidation {
  const acceptedDifferences: AcceptedWenzhenDifference[] = []
  for (const mismatch of mismatches) {
    const reason = reasons[mismatch.path]?.trim() ?? ''
    if (!reason) return { ok: false, code: 'missing-reason', path: mismatch.path, message: `请为差异 ${mismatch.path} 填写非空的差异审核理由。` }
    const classification = classifications[mismatch.path]
    if (!classification) return { ok: false, code: 'missing-classification', path: mismatch.path, message: `请为差异 ${mismatch.path} 选择差异分类。` }
    if (classification === 'bug') return { ok: false, code: 'bug', path: mismatch.path, message: `差异 ${mismatch.path} 属于产品缺陷。缺陷不可接受，请修复。` }
    acceptedDifferences.push({ path: mismatch.path, reason, classification })
  }
  return { ok: true, acceptedDifferences }
}

export function currentLocalDateTime(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 16)
}

export function wenzhenComparisonFingerprint(draft: WenzhenCaptureDraft): string {
  return JSON.stringify({
    sampleId: draft.sampleId.trim(), capturedAt: draft.capturedAt, sourceUrl: draft.sourceUrl.trim(), evidenceRef: draft.evidenceRef.trim(),
    flowTargetDate: draft.flowTargetDate?.trim() || null, flowTargetTime: draft.flowTargetTime?.trim() || null,
    calendarSystem: draft.calendarSystem, lunarLeapMonth: draft.lunarLeapMonth,
    date: draft.date, time: draft.time, placeCode: draft.placeCode, placeCoordinateStatus: draft.placeCoordinateStatus,
    placeCoordinateSource: draft.placeCoordinateSource, placeDataVersion: draft.placeDataVersion,
    gender: draft.gender,
    useTrueSolarTime: draft.useTrueSolarTime, dstPolicy: draft.dstPolicy, dayBoundary: draft.dayBoundary,
    luckMethod: draft.luckMethod, pillars: draft.pillars.trim(), expectedJson: draft.expectedJson.trim(),
  })
}

export function canApplyWenzhenFlowTemplateResponse(currentDraft: WenzhenCaptureDraft, requestedFingerprint: string): boolean {
  return wenzhenComparisonFingerprint(currentDraft) === requestedFingerprint
}

export function buildWenzhenFlowQueryFromAdminInput(flowTargetDate: string | null, flowTargetTime: string | null) {
  const targetDate = flowTargetDate?.trim() ?? ''
  const targetTime = flowTargetTime?.trim() ?? ''
  if (!targetDate) {
    if (targetTime) throw new Error('请先填写流盘目标日期，再填写目标时间。')
    return undefined
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw new Error('流盘目标日期必须使用 YYYY-MM-DD。')
  if (targetTime && !/^\d{2}:\d{2}$/.test(targetTime)) throw new Error('流盘目标时间必须使用 HH:mm。')
  return { targetDate, ...(targetTime ? { targetTime } : {}) }
}

export function buildWenzhenDynamicExpectedTemplateFromFlowSelection(selection: BaziFlowSelection) {
  return {
    annualCycles: [{ year: selection.year, pillar: '' }],
    monthlyCycles: [{ year: selection.monthYear, month: selection.month, pillar: '' }],
    dailyCycles: [{ date: selection.date, pillar: '' }],
    hourlyCycles: [{
      dateTime: `${selection.date} ${String(selection.hourSlotStart).padStart(2, '0')}:00`,
      startHour: selection.hourSlotStart,
      pillar: '',
    }],
  }
}

export function buildWenzhenExpectedJsonWithDynamicTemplate(
  expectedJson: string,
  selection: BaziFlowSelection,
): string {
  return JSON.stringify({
    ...parseWenzhenExpectedJsonObject(expectedJson),
    ...buildWenzhenDynamicExpectedTemplateFromFlowSelection(selection),
  }, null, 2)
}
