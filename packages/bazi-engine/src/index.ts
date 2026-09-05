import { JieQi, Lunar, LunarUtil, LunarYear, Solar } from 'lunar-typescript'
import type { EightChar } from 'lunar-typescript'
import type { AnnualCycle, BaziBalanceFacts, BaziChart, BaziComparisonReport, BaziFlowChart, BaziMonthCommandFacts, BaziRelation, BaziSupportDimensionFacts, BaziTimeRuntimeProvenance, BirthInput, CalendarConversion, CycleQuery, DailyCycle, FiveElement, FiveElementSummary, HourlyCycle, LuckCycle, ManualFourPillarsChart, ManualFourPillarsInput, MonthlyCycle, PendingSourceRequired, PillarDetail, ProfessionalChartFields, PublishedBaziRuleProfileVersion, TimeCorrectionRuleVersion } from '@fengshui/domain'
import { evaluateProfessionalAssessments } from './assessment-rules.js'
import { resourceElementForBaseline } from './element-directions.js'

export { evaluateProfessionalAssessments } from './assessment-rules.js'
export {
  buildElementBalanceDirection,
  DAY_STEM_ELEMENTS,
  FIVE_ELEMENT_CYCLE,
  officerElementForBaseline,
  outputElementForBaseline,
  resourceElementForBaseline,
  wealthElementForBaseline,
} from './element-directions.js'

export const BAZI_RULE_VERSION = 'bazi-v5-stem-branch-relations'
export const MANUAL_FOUR_PILLARS_RULE_VERSION = 'manual-four-pillars-v1-deterministic-derivation'
export const CALENDAR_RULE_VERSION = 'calendar-v2-round-trip-lunar-typescript'
export const TRUE_SOLAR_TIME_RULE_VERSION = 'true-solar-v2-zone-meridian-equation-of-time'
export const TRUE_SOLAR_TIME_V3_RULE_VERSION = 'true-solar-v3-standard-time-equation-of-time'
export const CIVIL_TIME_RULE_VERSION = 'civil-time-v1-no-solar-correction'
export const LUCK_RULE_VERSION = 'yun-v2-configurable-lunar-typescript'
export const PROFESSIONAL_RULE_VERSION = 'professional-v1-lunar-typescript'
export const ASSESSMENT_RULE_VERSION = 'assessment-pending-school-v1'
export const STANDARD_ASSESSMENT_RULE_VERSION = 'assessment-standard-v1'
export const SHENSHA_RULE_VERSION = 'shensha-baseline-v1-transparent-rules'
export const FLOW_RULE_VERSION = 'flow-v4-timezone-projected-jie-boundaries'
export const LUNAR_YEAR_PROFILE_MIN_YEAR = 1801
export const LUNAR_YEAR_PROFILE_MAX_YEAR = 2100
export const LUNAR_YEAR_PROFILE_ERROR = 'lunar year must be an integer between 1801 and 2100'

/** Returns only stable Node Intl version identifiers used by timezone calculations. */
export function getBaziTimeRuntimeProvenance(): BaziTimeRuntimeProvenance {
  const versions = process.versions
  return {
    provider: 'node-intl',
    ...(versions.node ? { nodeVersion: versions.node } : {}),
    ...(versions.icu ? { icuVersion: versions.icu } : {}),
    ...(versions.tz ? { tzdbVersion: versions.tz } : {}),
    ...(versions.unicode ? { unicodeVersion: versions.unicode } : {}),
    ...(versions.cldr ? { cldrVersion: versions.cldr } : {}),
  }
}

export type LunarYearMonthProfile = {
  month: number
  leap: boolean
  days: 29 | 30
}

export type LunarYearProfile = {
  year: number
  leapMonth: number | null
  months: LunarYearMonthProfile[]
  ruleVersion: string
}

const STEM_ELEMENTS: Record<string, FiveElement> = { 甲: 'wood', 乙: 'wood', 丙: 'fire', 丁: 'fire', 戊: 'earth', 己: 'earth', 庚: 'metal', 辛: 'metal', 壬: 'water', 癸: 'water' }
const BRANCH_ELEMENTS: Record<string, FiveElement> = { 子: 'water', 丑: 'earth', 寅: 'wood', 卯: 'wood', 辰: 'earth', 巳: 'fire', 午: 'fire', 未: 'earth', 申: 'metal', 酉: 'metal', 戌: 'earth', 亥: 'water' }
const YANG_STEMS = new Set(['甲', '丙', '戊', '庚', '壬'])
const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
const HIDDEN_STEMS: Record<string, readonly string[]> = {
  子: ['癸'], 丑: ['己', '癸', '辛'], 寅: ['甲', '丙', '戊'], 卯: ['乙'],
  辰: ['戊', '乙', '癸'], 巳: ['丙', '戊', '庚'], 午: ['丁', '己'], 未: ['己', '丁', '乙'],
  申: ['庚', '壬', '戊'], 酉: ['辛'], 戌: ['戊', '辛', '丁'], 亥: ['壬', '甲'],
}
const ELEMENT_ORDER: FiveElement[] = ['wood', 'fire', 'earth', 'metal', 'water']
const BRANCH_COMBINATIONS: Record<string, string> = { 子丑: '子丑六合', 寅亥: '寅亥六合', 卯戌: '卯戌六合', 辰酉: '辰酉六合', 巳申: '巳申六合', 午未: '午未六合' }
const BRANCH_CLASHES: Record<string, string> = { 子午: '子午相冲', 丑未: '丑未相冲', 寅申: '寅申相冲', 卯酉: '卯酉相冲', 辰戌: '辰戌相冲', 巳亥: '巳亥相冲' }
const STEM_COMBINATIONS: Record<string, string> = { 甲己: '甲己合化土', 乙庚: '乙庚合化金', 丙辛: '丙辛合化水', 丁壬: '丁壬合化木', 戊癸: '戊癸合化火' }
const STEM_CLASHES: Record<string, string> = { 甲庚: '甲庚相冲', 乙辛: '乙辛相冲', 丙壬: '丙壬相冲', 丁癸: '丁癸相冲' }
const GROWTH_STAGES = ['长生', '沐浴', '冠带', '临官', '帝旺', '衰', '病', '死', '墓', '绝', '胎', '养']
const SELF_SITTING_BRANCH_ORDER: Record<string, readonly string[]> = {
  甲: ['亥', '子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌'],
  乙: ['午', '巳', '辰', '卯', '寅', '丑', '子', '亥', '戌', '酉', '申', '未'],
  丙: ['寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑'],
  丁: ['酉', '申', '未', '午', '巳', '辰', '卯', '寅', '丑', '子', '亥', '戌'],
  戊: ['寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑'],
  己: ['酉', '申', '未', '午', '巳', '辰', '卯', '寅', '丑', '子', '亥', '戌'],
  庚: ['巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑', '寅', '卯', '辰'],
  辛: ['子', '亥', '戌', '酉', '申', '未', '午', '巳', '辰', '卯', '寅', '丑'],
  壬: ['申', '酉', '戌', '亥', '子', '丑', '寅', '卯', '辰', '巳', '午', '未'],
  癸: ['卯', '寅', '丑', '子', '亥', '戌', '酉', '申', '未', '午', '巳', '辰'],
}
const TIAN_YI_BRANCHES: Record<string, readonly string[]> = {
  甲: ['丑', '未'], 戊: ['丑', '未'], 庚: ['丑', '未'],
  乙: ['子', '申'], 己: ['子', '申'],
  丙: ['亥', '酉'], 丁: ['亥', '酉'],
  辛: ['寅', '午'],
  壬: ['卯', '巳'], 癸: ['卯', '巳'],
}
const WEN_CHANG_BRANCH: Record<string, string> = { 甲: '巳', 乙: '午', 丙: '申', 丁: '酉', 戊: '申', 己: '酉', 庚: '亥', 辛: '子', 壬: '寅', 癸: '卯' }
const YANG_REN_BRANCH: Record<string, string> = { 甲: '卯', 乙: '寅', 丙: '午', 丁: '巳', 戊: '午', 己: '巳', 庚: '酉', 辛: '申', 壬: '子', 癸: '亥' }
const LU_SHEN_BRANCH: Record<string, string> = { 甲: '寅', 乙: '卯', 丙: '巳', 丁: '午', 戊: '巳', 己: '午', 庚: '申', 辛: '酉', 壬: '亥', 癸: '子' }
const SAN_HE_SHENSHA = [
  { references: ['申', '子', '辰'], taoHua: '酉', yiMa: '寅', huaGai: '辰', jiangXing: '子' },
  { references: ['寅', '午', '戌'], taoHua: '卯', yiMa: '申', huaGai: '戌', jiangXing: '午' },
  { references: ['巳', '酉', '丑'], taoHua: '午', yiMa: '亥', huaGai: '丑', jiangXing: '酉' },
  { references: ['亥', '卯', '未'], taoHua: '子', yiMa: '巳', huaGai: '未', jiangXing: '卯' },
] as const

function deriveRelations(pillars: readonly string[]): BaziRelation[] {
  const relations: BaziRelation[] = []
  for (let left = 0; left < pillars.length; left += 1) {
    for (let right = left + 1; right < pillars.length; right += 1) {
      const pair = `${pillars[left][1]}${pillars[right][1]}`
      const reverse = `${pillars[right][1]}${pillars[left][1]}`
      const combination = BRANCH_COMBINATIONS[pair] ?? BRANCH_COMBINATIONS[reverse]
      const clash = BRANCH_CLASHES[pair] ?? BRANCH_CLASHES[reverse]
      const stemPair = `${pillars[left][0]}${pillars[right][0]}`
      const stemReverse = `${pillars[right][0]}${pillars[left][0]}`
      const stemCombination = STEM_COMBINATIONS[stemPair] ?? STEM_COMBINATIONS[stemReverse]
      const stemClash = STEM_CLASHES[stemPair] ?? STEM_CLASHES[stemReverse]
      if (stemCombination) relations.push({ kind: 'combination', members: [left, right], detail: stemCombination })
      if (stemClash) relations.push({ kind: 'clash', members: [left, right], detail: stemClash })
      if (combination) relations.push({ kind: 'combination', members: [left, right], detail: combination })
      if (clash) relations.push({ kind: 'clash', members: [left, right], detail: clash })
    }
  }
  return relations
}

function deriveTenGod(dayStem: string, targetStem: string): string {
  const dayElement = STEM_ELEMENTS[dayStem]
  const targetElement = STEM_ELEMENTS[targetStem]
  if (!dayElement || !targetElement) return '待计算'
  const dayIndex = ELEMENT_ORDER.indexOf(dayElement)
  const targetIndex = ELEMENT_ORDER.indexOf(targetElement)
  const samePolarity = YANG_STEMS.has(dayStem) === YANG_STEMS.has(targetStem)
  if (dayElement === targetElement) return samePolarity ? '比肩' : '劫财'
  if ((dayIndex + 1) % 5 === targetIndex) return samePolarity ? '食神' : '伤官'
  if ((dayIndex + 2) % 5 === targetIndex) return samePolarity ? '偏财' : '正财'
  if ((targetIndex + 2) % 5 === dayIndex) return samePolarity ? '七杀' : '正官'
  return samePolarity ? '偏印' : '正印'
}

function deriveSelfSitting(stem: string, branch: string): string {
  const order = SELF_SITTING_BRANCH_ORDER[stem]
  const index = order?.indexOf(branch) ?? -1
  return index >= 0 ? GROWTH_STAGES[index]! : '待计算'
}

function appendBranchMatch(names: Set<string>, branch: string, target: string | undefined, label: string): void {
  if (target && branch === target) names.add(label)
}

function deriveBasicShenShaNames(branch: string, pillars: readonly string[], dayStem: string): string[] {
  const names = new Set<string>()
  if (TIAN_YI_BRANCHES[dayStem]?.includes(branch)) names.add('天乙贵人')
  appendBranchMatch(names, branch, WEN_CHANG_BRANCH[dayStem], '文昌贵人')
  appendBranchMatch(names, branch, YANG_REN_BRANCH[dayStem], '羊刃')
  appendBranchMatch(names, branch, LU_SHEN_BRANCH[dayStem], '禄神')

  const references = new Set([pillars[0][1], pillars[2][1]])
  for (const reference of references) {
    const rule = SAN_HE_SHENSHA.find((item) => item.references.includes(reference as never))
    if (!rule) continue
    appendBranchMatch(names, branch, rule.taoHua, '桃花')
    appendBranchMatch(names, branch, rule.yiMa, '驿马')
    appendBranchMatch(names, branch, rule.huaGai, '华盖')
    appendBranchMatch(names, branch, rule.jiangXing, '将星')
  }
  return [...names]
}

function deriveFiveElements(pillars: readonly string[]): FiveElementSummary {
  const counts: Record<FiveElement, number> = { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 }
  for (const pillar of pillars) {
    const stem = STEM_ELEMENTS[pillar[0]]
    const branch = BRANCH_ELEMENTS[pillar[1]]
    if (stem) counts[stem] += 1
    if (branch) counts[branch] += 1
  }
  return { counts, method: 'visible-stems-and-branches-v1' }
}

const HIDDEN_STEM_WEIGHTS = [1, 0.6, 0.3] as const

/**
 * Produces an auditable seasonal-support baseline, not a school-specific verdict
 * about strength or useful gods. The day stem itself is the subject and is not
 * scored. Other visible stems weigh 1; branch hidden stems weigh 1/0.6/0.3,
 * with the month command doubled. Same-element and resource-element entries
 * support the day master; all other entries oppose it.
 */
export function deriveBalanceFacts(pillars: readonly [string, string, string, string]): BaziBalanceFacts {
  const dayElement = STEM_ELEMENTS[pillars[2][0]]
  if (!dayElement) throw new Error('day stem must map to a five element')
  const resourceElement = resourceElementForBaseline(dayElement)
  const contributions: BaziBalanceFacts['contributions'][number][] = []
  const add = (source: string, element: FiveElement, weight: number): void => {
    contributions.push({
      source,
      element,
      weight,
      side: element === dayElement || element === resourceElement ? 'support' : 'opposition',
    })
  }

  const pillarNames = ['year', 'month', 'day', 'hour'] as const
  pillars.forEach((pillar, pillarIndex) => {
    if (pillarIndex !== 2) add(`${pillarNames[pillarIndex]}.stem`, STEM_ELEMENTS[pillar[0]]!, 1)
    const monthMultiplier = pillarIndex === 1 ? 2 : 1
    ;(HIDDEN_STEMS[pillar[1]] ?? []).forEach((stem, hiddenIndex) => {
      add(
        `${pillarNames[pillarIndex]}.hiddenStem.${hiddenIndex + 1}`,
        STEM_ELEMENTS[stem]!,
        HIDDEN_STEM_WEIGHTS[hiddenIndex]! * monthMultiplier,
      )
    })
  })

  const sum = (side: 'support' | 'opposition'): number =>
    Math.round(contributions.filter((item) => item.side === side).reduce((total, item) => total + item.weight, 0) * 100) / 100
  const supportScore = sum('support')
  const oppositionScore = sum('opposition')
  const branches = pillars.map((pillar) => HIDDEN_STEMS[pillar[1]] ?? [])
  return {
    method: 'seasonal-support-baseline-v1',
    supportScore,
    oppositionScore,
    netScore: Math.round((supportScore - oppositionScore) * 100) / 100,
    rootCount: branches.filter((stems) => stems.some((stem) => STEM_ELEMENTS[stem] === dayElement)).length,
    resourceCount: branches.reduce((count, stems) => count + stems.filter((stem) => STEM_ELEMENTS[stem] === resourceElement).length, 0),
    monthCommandSupports: (() => {
      const monthMainQiElement = STEM_ELEMENTS[(HIDDEN_STEMS[pillars[1][1]] ?? [])[0] ?? '']
      return monthMainQiElement === dayElement || monthMainQiElement === resourceElement
    })(),
    contributions,
  }
}

/**
 * Projects objective month-command facts without deciding chart strength,
 * pattern, or useful gods. Any school conclusion must be made by a published
 * rule profile against this evidence.
 */
export function deriveMonthCommandFacts(
  pillars: readonly [string, string, string, string],
): BaziMonthCommandFacts {
  const dayStem = pillars[2][0]
  const dayElement = STEM_ELEMENTS[dayStem]
  const monthBranch = pillars[1][1]
  const mainQiStem = (HIDDEN_STEMS[monthBranch] ?? [])[0]
  const mainQiElement = STEM_ELEMENTS[mainQiStem]
  if (!dayElement || !mainQiStem || !mainQiElement) {
    throw new Error('pillars must contain supported day stem and month branch')
  }
  const resourceElement = resourceElementForBaseline(dayElement)
  const pillarNames = ['year', 'month', 'day', 'hour'] as const
  return {
    method: 'month-command-facts-v1',
    branch: monthBranch,
    mainQiStem,
    mainQiElement,
    mainQiTenGod: deriveTenGod(dayStem, mainQiStem),
    mainQiVisibleAt: pillarNames.filter((_, index) => pillars[index][0] === mainQiStem),
    supportsDayMasterBaseline: mainQiElement === dayElement || mainQiElement === resourceElement,
  }
}

/** Projects the locations behind 得令、得地、得助 without issuing a strength verdict. */
export function deriveSupportDimensionFacts(
  pillars: readonly [string, string, string, string],
): BaziSupportDimensionFacts {
  const dayElement = STEM_ELEMENTS[pillars[2][0]]
  if (!dayElement) throw new Error('day stem must map to a five element')
  const resourceElement = resourceElementForBaseline(dayElement)
  const pillarNames = ['year', 'month', 'day', 'hour'] as const
  const visiblePositions = ['year', 'month', 'hour'] as const
  const visibleIndexes = [0, 1, 3] as const
  const monthCommand = deriveMonthCommandFacts(pillars)

  return {
    method: 'support-dimensions-facts-v1',
    monthCommandSupports: monthCommand.supportsDayMasterBaseline,
    rootedAt: pillarNames.filter((_, index) =>
      (HIDDEN_STEMS[pillars[index][1]] ?? []).some((stem) => STEM_ELEMENTS[stem] === dayElement)),
    visiblePeerAt: visiblePositions.filter((_, positionIndex) =>
      STEM_ELEMENTS[pillars[visibleIndexes[positionIndex]][0]] === dayElement),
    visibleResourceAt: visiblePositions.filter((_, positionIndex) =>
      STEM_ELEMENTS[pillars[visibleIndexes[positionIndex]][0]] === resourceElement),
  }
}

function deriveAnnualCycles(year: number, eightChar?: EightChar, gender?: BirthInput['gender'], method: BirthInput['luckMethod'] = 'sect1'): AnnualCycle[] {
  return Array.from({ length: 10 }, (_, index) => {
    const targetYear = year - 2 + index
    const pillar = Solar.fromYmd(targetYear, 2, 4).getLunar().getYearInGanZhiByLiChun()
    let months: readonly MonthlyCycle[] | undefined
    if (eightChar) {
      const liuNian = gender
        ? eightChar.getYun(gender === 'male' ? 1 : 0, method === 'sect2' ? 2 : 1).getDaYun(9).flatMap((cycle) => cycle.getLiuNian()).find((item) => item.getYear() === targetYear)
        : undefined
      if (liuNian) {
        const boundaries = deriveSolarTermMonthlyCycles(targetYear)
        months = liuNian.getLiuYue().map((item, month) => ({
          ...boundaries[month]!,
          monthName: item.getMonthInChinese(),
          pillar: item.getGanZhi(),
          status: 'derived' as const,
        }))
      }
    }
    return { year: targetYear, pillar, status: 'derived' as const, ...(months ? { months } : {}) }
  })
}

function deriveLuckCycles(eightChar: EightChar, gender: BirthInput['gender'], method: 'sect1' | 'sect2'): LuckCycle[] {
  if (!gender) return []
  const yun = eightChar.getYun(gender === 'male' ? 1 : 0, method === 'sect1' ? 1 : 2)
  const startSolar = yun.getStartSolar()
  const month = String(startSolar.getMonth()).padStart(2, '0')
  const day = String(startSolar.getDay()).padStart(2, '0')
  return yun.getDaYun(9).slice(1, 9).map((cycle, index) => ({
    index: index + 1,
    pillar: cycle.getGanZhi(),
    startAge: cycle.getStartAge(),
    endAge: cycle.getEndAge(),
    startDate: `${cycle.getStartYear()}-${month}-${day}`,
    endDate: `${cycle.getEndYear()}-${month}-${day}`,
    direction: yun.isForward() ? 'forward' as const : 'backward' as const,
    status: 'derived' as const,
  }))
}

function deriveProfessionalFields(eightChar: EightChar): ProfessionalChartFields {
  return {
    naYin: [eightChar.getYearNaYin(), eightChar.getMonthNaYin(), eightChar.getDayNaYin(), eightChar.getTimeNaYin()],
    voidBranches: [eightChar.getYearXunKong(), eightChar.getMonthXunKong(), eightChar.getDayXunKong(), eightChar.getTimeXunKong()],
    twelveGrowthStages: [eightChar.getYearDiShi(), eightChar.getMonthDiShi(), eightChar.getDayDiShi(), eightChar.getTimeDiShi()],
    method: 'lunar-typescript-eight-char-v1',
    ruleVersion: PROFESSIONAL_RULE_VERSION,
  }
}

function deriveGrowthStage(dayStem: string, branch: string): string {
  const offset = LunarUtil.CHANG_SHENG_OFFSET[dayStem]
  const dayStemIndex = STEMS.indexOf(dayStem)
  const branchIndex = LunarUtil.ZHI.indexOf(branch) - 1
  if (offset === undefined || dayStemIndex < 0 || branchIndex < 0) return '待计算'
  let index = offset + (dayStemIndex % 2 === 0 ? branchIndex : -branchIndex)
  index = ((index % 12) + 12) % 12
  return LunarUtil.CHANG_SHENG[index] ?? '待计算'
}

function deriveProfessionalFieldsFromPillars(pillars: readonly [string, string, string, string]): ProfessionalChartFields {
  const dayStem = pillars[2][0]
  return {
    naYin: pillars.map((pillar) => LunarUtil.NAYIN[pillar] ?? '') as [string, string, string, string],
    voidBranches: pillars.map((pillar) => LunarUtil.getXunKong(pillar)) as [string, string, string, string],
    twelveGrowthStages: pillars.map((pillar) => deriveGrowthStage(dayStem, pillar[1])) as [string, string, string, string],
    method: 'lunar-typescript-eight-char-v1',
    ruleVersion: PROFESSIONAL_RULE_VERSION,
  }
}

function derivePillarDetails(pillars: readonly string[], hiddenStems: readonly (readonly string[])[], eightChar: EightChar, dayStem: string, professional: ProfessionalChartFields = deriveProfessionalFields(eightChar)): PillarDetail[] {
  return pillars.map((pillar, index) => ({
    pillar,
    heavenlyStem: pillar[0],
    earthlyBranch: pillar[1],
    stemTenGod: deriveTenGod(dayStem, pillar[0]),
    hiddenStems: (hiddenStems[index] ?? []).map((stem) => ({ stem, tenGod: deriveTenGod(dayStem, stem) })),
    naYin: professional.naYin[index],
    voidBranches: professional.voidBranches[index],
    twelveGrowthStage: professional.twelveGrowthStages[index],
    selfSitting: deriveSelfSitting(pillar[0], pillar[1]),
    shenSha: { status: 'derived' as const, ruleVersion: SHENSHA_RULE_VERSION, names: deriveBasicShenShaNames(pillar[1], pillars, dayStem) },
  }))
}

function deriveManualPillarDetails(
  pillars: readonly [string, string, string, string],
  hiddenStems: readonly [readonly string[], readonly string[], readonly string[], readonly string[]],
  professional: ProfessionalChartFields,
  dayStem: string,
): [PillarDetail, PillarDetail, PillarDetail, PillarDetail] {
  const detailAt = (index: 0 | 1 | 2 | 3): PillarDetail => {
    const pillar = pillars[index]
    return {
      pillar,
      heavenlyStem: pillar[0],
      earthlyBranch: pillar[1],
      stemTenGod: deriveTenGod(dayStem, pillar[0]),
      hiddenStems: hiddenStems[index].map((stem) => ({ stem, tenGod: deriveTenGod(dayStem, stem) })),
      naYin: professional.naYin[index] ?? '',
      voidBranches: professional.voidBranches[index] ?? '',
      twelveGrowthStage: professional.twelveGrowthStages[index] ?? '',
      selfSitting: deriveSelfSitting(pillar[0], pillar[1]),
      shenSha: { status: 'pending-school-rule', ruleVersion: ASSESSMENT_RULE_VERSION },
    }
  }
  return [detailAt(0), detailAt(1), detailAt(2), detailAt(3)]
}

function unavailableWithoutBirthSource(): PendingSourceRequired {
  return { status: 'unavailable', reason: 'pending-source-required' }
}

/**
 * Derives only facts encoded by four supplied pillars. Calendar, solar-time,
 * solar-term, and luck-cycle outputs remain explicitly unavailable.
 */
export function calculateBaziFromPillars(input: ManualFourPillarsInput): ManualFourPillarsChart {
  if (!input || input.inputMode !== 'manual-four-pillars') {
    throw new Error('inputMode must be manual-four-pillars')
  }
  if (!Array.isArray(input.pillars) || input.pillars.length !== 4) {
    throw new Error('manual four pillars must contain exactly four values')
  }
  const pillars = input.pillars.map((pillar, index) => {
    if (typeof pillar !== 'string' || !LunarUtil.JIA_ZI.includes(pillar)) {
      throw new Error(`pillar ${index + 1} must be a real sexagenary cycle combination`)
    }
    return pillar
  }) as [string, string, string, string]
  if (input.gender !== undefined && input.gender !== 'male' && input.gender !== 'female') {
    throw new Error('gender must be male or female')
  }

  const dayStem = pillars[2][0]
  const hiddenStems = pillars.map((pillar) => HIDDEN_STEMS[pillar[1]] ?? []) as [readonly string[], readonly string[], readonly string[], readonly string[]]
  const professional = deriveProfessionalFieldsFromPillars(pillars)
  const unavailable = unavailableWithoutBirthSource

  return {
    inputMode: 'manual-four-pillars',
    ruleVersion: MANUAL_FOUR_PILLARS_RULE_VERSION,
    inputSnapshot: {
      inputMode: 'manual-four-pillars',
      pillars: [...pillars] as [string, string, string, string],
      ...(input.gender ? { gender: input.gender } : {}),
    },
    pillars,
    dayMaster: { stem: dayStem, element: STEM_ELEMENTS[dayStem], yinYang: YANG_STEMS.has(dayStem) ? 'yang' : 'yin' },
    fiveElements: deriveFiveElements(pillars),
    balance: deriveBalanceFacts(pillars),
    monthCommand: deriveMonthCommandFacts(pillars),
    supportDimensions: deriveSupportDimensionFacts(pillars),
    tenGods: pillars.map((pillar) => deriveTenGod(dayStem, pillar[0])) as [string, string, string, string],
    hiddenStems,
    relations: deriveRelations(pillars),
    professional,
    pillarDetails: deriveManualPillarDetails(pillars, hiddenStems, professional, dayStem),
    assessments: {
      strength: { status: 'pending-school-rule', reason: 'legacy-profile', ruleVersion: 'strength-v1-visible-element-baseline' },
      pattern: { status: 'pending-school-rule', reason: 'legacy-profile', ruleVersion: STANDARD_ASSESSMENT_RULE_VERSION },
      shenSha: { status: 'pending-school-rule', reason: 'legacy-profile', ruleVersion: STANDARD_ASSESSMENT_RULE_VERSION },
    },
    birthDateTime: unavailable(),
    correctedLocalTime: unavailable(),
    correctionMinutes: unavailable(),
    solarTermBoundary: unavailable(),
    luckStartDate: unavailable(),
    luckStartAge: unavailable(),
    luckCycles: unavailable(),
    annualCycles: unavailable(),
    monthlyCycles: unavailable(),
    dailyCycles: unavailable(),
    hourlyCycles: unavailable(),
  }
}

function equationOfTimeMinutesV2(date: Date): number {
  const day = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000)
  const b = (2 * Math.PI * (day - 81)) / 364
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b)
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function dayOfYear(date: Date): number {
  return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000)
}

function equationOfTimeMinutesV3(date: Date): number {
  const yearLength = isLeapYear(date.getUTCFullYear()) ? 366 : 365
  const fractionalDay = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
  const gamma = (2 * Math.PI / yearLength) * (dayOfYear(date) - 1 + (fractionalDay - 12) / 24)
  return 229.18 * (
    0.000075 +
    0.001868 * Math.cos(gamma) -
    0.032077 * Math.sin(gamma) -
    0.014615 * Math.cos(2 * gamma) -
    0.040849 * Math.sin(2 * gamma)
  )
}

export interface TrueSolarTimeV3Input {
  date: string
  time: string
  longitude: number
  timezone?: string
  dstPolicy?: 'auto' | 'ignore'
  /** Repeated wall times occur when DST falls back. V3 rejects them unless the caller chooses an occurrence. */
  ambiguousTimePolicy?: 'earlier' | 'later' | 'reject'
}

export interface TrueSolarTimeV3Result {
  ruleVersion: string
  standardMeridian: number
  longitudeCorrectionMinutes: number
  equationOfTimeMinutes: number
  trueSolarCorrectionMinutes: number
  daylightSavingMinutes: number
  timeAmbiguous: boolean
  ambiguousTimePolicy: 'earlier' | 'later' | 'reject'
  standardLocalTime: string
  correctedLocalTime: string
}

function formatWallTime(value: Date): string {
  return `${value.toISOString().slice(0, 10)}T${value.toISOString().slice(11, 16)}`
}

function calculateTrueSolarTimeProfile(input: TrueSolarTimeV3Input, ruleVersion: string): TrueSolarTimeV3Result {
  const wallTime = parseWallTime(input.date, input.time)
  const timezone = input.timezone?.trim() || 'Asia/Shanghai'
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
    throw new Error('longitude must be between -180 and 180')
  }
  const dstPolicy = input.dstPolicy ?? 'auto'
  if (!['auto', 'ignore'].includes(dstPolicy)) throw new Error('dstPolicy must be auto or ignore')
  const ambiguousTimePolicy = input.ambiguousTimePolicy ?? 'reject'
  if (!['earlier', 'later', 'reject'].includes(ambiguousTimePolicy)) {
    throw new Error('ambiguousTimePolicy must be earlier, later or reject')
  }

  const zoneProfile = dstPolicy === 'ignore'
    ? resolveIgnoredDstProfile(wallTime, timezone)
    : resolveTimeZoneProfile(wallTime, timezone, ambiguousTimePolicy)
  const daylightSavingMinutes = dstPolicy === 'auto' ? zoneProfile.daylightSavingMinutes : 0
  const standardLocalTime = new Date(wallTime.getTime() - daylightSavingMinutes * 60_000)
  const standardMeridian = zoneProfile.standardOffsetMinutes / 4
  const longitudeCorrectionMinutes = (input.longitude - standardMeridian) * 4
  const equationOfTime = equationOfTimeMinutesV3(standardLocalTime)
  const trueSolarCorrectionMinutes = longitudeCorrectionMinutes + equationOfTime
  const correctedLocalTime = roundToNearestMinute(new Date(standardLocalTime.getTime() + trueSolarCorrectionMinutes * 60_000))

  return {
    ruleVersion,
    standardMeridian,
    longitudeCorrectionMinutes,
    equationOfTimeMinutes: equationOfTime,
    trueSolarCorrectionMinutes,
    daylightSavingMinutes,
    timeAmbiguous: zoneProfile.ambiguous,
    ambiguousTimePolicy,
    standardLocalTime: formatWallTime(standardLocalTime),
    correctedLocalTime: formatWallTime(correctedLocalTime),
  }
}

export function calculateTrueSolarTimeV3(input: TrueSolarTimeV3Input): TrueSolarTimeV3Result {
  return calculateTrueSolarTimeProfile(input, TRUE_SOLAR_TIME_V3_RULE_VERSION)
}

function dateParts(value: Date) {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
    hour: value.getUTCHours(),
    minute: value.getUTCMinutes(),
  }
}

function roundToNearestMinute(value: Date): Date {
  return new Date(Math.round(value.getTime() / 60_000) * 60_000)
}

function parseWallTime(dateText: string, timeText: string): Date {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText)
  const time = /^(\d{2}):(\d{2})$/.exec(timeText)
  if (!date || !time) throw new Error('birth date/time must use YYYY-MM-DD and HH:mm')

  const year = Number(date[1])
  const month = Number(date[2])
  const day = Number(date[3])
  const hour = Number(time[1])
  const minute = Number(time[2])
  if (year < 1 || year > 9999) throw new Error('birth year must be between 0001 and 9999')
  if (month < 1 || month > 12) throw new Error('birth month must be between 01 and 12')
  if (day < 1 || day > 31) throw new Error('birth day must be between 01 and 31')
  if (hour < 0 || hour > 23) throw new Error('birth hour must be between 00 and 23')
  if (minute < 0 || minute > 59) throw new Error('birth minute must be between 00 and 59')

  // setUTCFullYear avoids Date.UTC's special handling of years 00-99. The
  // round-trip rejects rollover values such as 2024-02-31 and 2023-02-29.
  const wallTime = new Date(0)
  wallTime.setUTCFullYear(year, month - 1, day)
  wallTime.setUTCHours(hour, minute, 0, 0)
  if (
    wallTime.getUTCFullYear() !== year ||
    wallTime.getUTCMonth() !== month - 1 ||
    wallTime.getUTCDate() !== day ||
    wallTime.getUTCHours() !== hour ||
    wallTime.getUTCMinutes() !== minute
  ) {
    throw new Error('birth date/time is not a valid calendar wall time')
  }
  return wallTime
}

function parseTargetTime(query: CycleQuery): { date: string; time: string; wallTime: Date } {
  const time = query.targetTime ?? '12:00'
  try {
    return { date: query.targetDate, time, wallTime: parseWallTime(query.targetDate, time) }
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^birth /, 'target ') : 'target date/time is invalid'
    throw new Error(message)
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function parseLunarFields(dateText: string, timeText: string) {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText)
  const time = /^(\d{2}):(\d{2})$/.exec(timeText)
  if (!date || !time) throw new Error('birth date/time must use YYYY-MM-DD and HH:mm')
  const fields = { year: Number(date[1]), month: Number(date[2]), day: Number(date[3]), hour: Number(time[1]), minute: Number(time[2]) }
  if (fields.year < 1 || fields.year > 9999 || fields.month < 1 || fields.month > 12 || fields.day < 1 || fields.day > 30 || fields.hour > 23 || fields.minute > 59) {
    throw new Error('birth date is not a valid lunar calendar date')
  }
  return fields
}

function calendarConversionFromSolar(solar: Solar): CalendarConversion {
  const lunar = solar.getLunar()
  const lunarMonth = lunar.getMonth()
  return {
    solarDate: `${String(solar.getYear()).padStart(4, '0')}-${pad(solar.getMonth())}-${pad(solar.getDay())}`,
    lunarDate: `${String(lunar.getYear()).padStart(4, '0')}-${pad(Math.abs(lunarMonth))}-${pad(lunar.getDay())}`,
    lunarLeapMonth: lunarMonth < 0,
    lunarYear: lunar.getYear(),
    lunarMonth: Math.abs(lunarMonth),
    lunarDay: lunar.getDay(),
    ruleVersion: CALENDAR_RULE_VERSION,
  }
}

/**
 * Returns the authoritative lunar-month sequence for a supported civil year.
 * The upstream library owns the calendar table; this projection adds only the
 * stable API shape and range contract used by clients.
 */
export function getLunarYearProfile(year: number): LunarYearProfile {
  if (!Number.isInteger(year) || year < LUNAR_YEAR_PROFILE_MIN_YEAR || year > LUNAR_YEAR_PROFILE_MAX_YEAR) {
    throw new Error(LUNAR_YEAR_PROFILE_ERROR)
  }
  const lunarYear = LunarYear.fromYear(year)
  const months = lunarYear.getMonthsInYear().map((month): LunarYearMonthProfile => {
    const days = month.getDayCount()
    if (days !== 29 && days !== 30) throw new Error('lunar month day count must be 29 or 30')
    return {
      month: Math.abs(month.getMonth()),
      leap: month.isLeap(),
      days,
    }
  })
  const leapMonth = lunarYear.getLeapMonth()
  return {
    year,
    leapMonth: leapMonth === 0 ? null : leapMonth,
    months,
    ruleVersion: CALENDAR_RULE_VERSION,
  }
}

/** Deterministic public conversion used by the UI, API and golden tests. */
export function convertCalendarDate(input: Pick<BirthInput, 'calendarSystem' | 'date' | 'time' | 'lunarLeapMonth'>): CalendarConversion {
  const calendarSystem = input.calendarSystem ?? 'solar'
  if (calendarSystem === 'solar') {
    const parsed = parseWallTime(input.date, input.time)
    return calendarConversionFromSolar(Solar.fromYmd(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate()))
  }
  if (calendarSystem !== 'lunar') throw new Error('calendarSystem must be solar or lunar')
  const parsed = parseLunarFields(input.date, input.time)
  const expectedMonth = parsed.month
  const encodedMonth = input.lunarLeapMonth ? -expectedMonth : expectedMonth
  let lunar: Lunar
  try {
    lunar = Lunar.fromYmdHms(parsed.year, encodedMonth, parsed.day, parsed.hour, parsed.minute, 0)
  } catch {
    throw new Error('birth date is not a valid lunar calendar date')
  }
  if (lunar.getYear() !== parsed.year || lunar.getMonth() !== encodedMonth || lunar.getDay() !== parsed.day) {
    throw new Error('birth date is not a valid lunar calendar date')
  }
  return calendarConversionFromSolar(lunar.getSolar())
}

type WallParts = { year: number; month: number; day: number; hour: number; minute: number; second: number }

function wallPartsAt(instant: Date, timezone: string): WallParts {
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23', numberingSystem: 'latn',
    })
  } catch {
    throw new Error('timezone must be an IANA time-zone identifier')
  }
  const values = Object.fromEntries(formatter.formatToParts(instant).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second }
}

function wallEpoch(parts: WallParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
}

function offsetAt(instant: Date, timezone: string): number {
  return Math.round((wallEpoch(wallPartsAt(instant, timezone)) - instant.getTime()) / 60_000)
}

function standardOffsetForYear(timezone: string, year: number): number {
  const yearlyOffsets = Array.from({ length: 12 }, (_, month) => offsetAt(new Date(Date.UTC(year, month, 15, 12)), timezone))
  return Math.min(...yearlyOffsets)
}

function sameWall(left: WallParts, right: WallParts): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day && left.hour === right.hour && left.minute === right.minute && left.second === right.second
}

function resolveTimeZoneProfile(
  wallTime: Date,
  timezone: string,
  ambiguousTimePolicy: 'earlier' | 'later' | 'reject' = 'earlier',
) {
  const desired: WallParts = {
    year: wallTime.getUTCFullYear(), month: wallTime.getUTCMonth() + 1, day: wallTime.getUTCDate(),
    hour: wallTime.getUTCHours(), minute: wallTime.getUTCMinutes(), second: wallTime.getUTCSeconds(),
  }
  wallPartsAt(wallTime, timezone)
  let guess = new Date(wallTime.getTime())
  for (let iteration = 0; iteration < 4; iteration += 1) {
    guess = new Date(guess.getTime() + wallEpoch(desired) - wallEpoch(wallPartsAt(guess, timezone)))
  }
  const candidates = Array.from({ length: 25 }, (_, index) => new Date(guess.getTime() + (index - 12) * 15 * 60_000))
    .filter((candidate) => sameWall(wallPartsAt(candidate, timezone), desired))
    .sort((left, right) => left.getTime() - right.getTime())
  if (candidates.length === 0) throw new Error('birth time does not exist in the selected timezone because of a clock transition')
  if (candidates.length > 1 && ambiguousTimePolicy === 'reject') {
    throw new Error('birth time is ambiguous in the selected timezone; choose earlier or later occurrence')
  }
  const instant = ambiguousTimePolicy === 'later' ? candidates[candidates.length - 1] : candidates[0]
  const utcOffsetMinutes = offsetAt(instant, timezone)
  const standardOffsetMinutes = standardOffsetForYear(timezone, desired.year)
  return {
    instant,
    utcOffsetMinutes,
    standardOffsetMinutes,
    daylightSavingMinutes: utcOffsetMinutes - standardOffsetMinutes,
    ambiguous: candidates.length > 1,
  }
}

function resolveIgnoredDstProfile(wallTime: Date, timezone: string) {
  // Ignoring DST means interpreting the supplied civil fields against the
  // zone's fixed standard clock, without IANA gap or repeated-hour semantics.
  wallPartsAt(wallTime, timezone)
  const standardOffsetMinutes = standardOffsetForYear(timezone, wallTime.getUTCFullYear())
  return {
    instant: new Date(wallTime.getTime() - standardOffsetMinutes * 60_000),
    utcOffsetMinutes: standardOffsetMinutes,
    standardOffsetMinutes,
    daylightSavingMinutes: 0,
    ambiguous: false,
  }
}

function resolveSolarWallTime(input: BirthInput): { wallTime: Date; solarDate: string; solarTime: string; calendarSystem: 'solar' | 'lunar' } {
  const calendarSystem = input.calendarSystem ?? 'solar'
  if (calendarSystem === 'solar') {
    const wallTime = parseWallTime(input.date, input.time)
    return { wallTime, solarDate: input.date, solarTime: input.time, calendarSystem }
  }
  if (calendarSystem !== 'lunar') throw new Error('calendarSystem must be solar or lunar')

  const parsed = parseLunarFields(input.date, input.time)
  const conversion = convertCalendarDate(input)
  const solarDate = conversion.solarDate
  const solarTime = `${pad(parsed.hour)}:${pad(parsed.minute)}`
  return { wallTime: parseWallTime(solarDate, solarTime), solarDate, solarTime, calendarSystem }
}

export function calculateBazi(input: BirthInput, ruleProfileVersion?: PublishedBaziRuleProfileVersion): BaziChart {
  const resolved = resolveSolarWallTime(input)
  const timezone = input.timezone?.trim() || 'Asia/Shanghai'
  const base = resolved.wallTime
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
    throw new Error('longitude must be between -180 and 180')
  }
  if (input.latitude !== undefined && (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90)) {
    throw new Error('latitude must be between -90 and 90')
  }
  const useTrueSolarTime = input.useTrueSolarTime ?? true
  const requestedTimeCorrectionRuleVersion = input.timeCorrectionRuleVersion ?? TRUE_SOLAR_TIME_RULE_VERSION
  const dstPolicy = input.dstPolicy ?? 'auto'
  const dayBoundary = input.dayBoundary ?? 'midnight'
  const luckMethod = input.luckMethod ?? 'sect1'
  if (!['auto', 'ignore'].includes(dstPolicy)) throw new Error('dstPolicy must be auto or ignore')
  if (![TRUE_SOLAR_TIME_RULE_VERSION, TRUE_SOLAR_TIME_V3_RULE_VERSION].includes(requestedTimeCorrectionRuleVersion)) {
    throw new Error('timeCorrectionRuleVersion must be a supported true-solar-time rule')
  }
  if (!['midnight', 'zi-hour-start'].includes(dayBoundary)) throw new Error('dayBoundary must be midnight or zi-hour-start')
  if (!['sect1', 'sect2'].includes(luckMethod)) throw new Error('luckMethod must be sect1 or sect2')
  const zoneProfile = dstPolicy === 'ignore'
    ? resolveIgnoredDstProfile(base, timezone)
    : resolveTimeZoneProfile(
      base,
      timezone,
      requestedTimeCorrectionRuleVersion === TRUE_SOLAR_TIME_V3_RULE_VERSION ? 'reject' : 'earlier',
    )
  const daylightSavingMinutesValue = dstPolicy === 'auto' ? zoneProfile.daylightSavingMinutes : 0
  const standardWallTime = new Date(base.getTime() - daylightSavingMinutesValue * 60_000)
  const standardMeridian = zoneProfile.standardOffsetMinutes / 4
  const resolvedTimeCorrectionRuleVersion = useTrueSolarTime ? requestedTimeCorrectionRuleVersion : CIVIL_TIME_RULE_VERSION
  const equationOfTime = requestedTimeCorrectionRuleVersion === TRUE_SOLAR_TIME_V3_RULE_VERSION
    ? equationOfTimeMinutesV3
    : equationOfTimeMinutesV2
  const trueSolarCorrectionMinutes = useTrueSolarTime
    ? (input.longitude - standardMeridian) * 4 + equationOfTime(standardWallTime)
    : 0
  const correctionMinutes = trueSolarCorrectionMinutes - daylightSavingMinutesValue
  const corrected = roundToNearestMinute(new Date(standardWallTime.getTime() + trueSolarCorrectionMinutes * 60_000))
  const correctedParts = dateParts(corrected)
  const eightChar = Solar.fromYmdHms(correctedParts.year, correctedParts.month, correctedParts.day, correctedParts.hour, correctedParts.minute, 0).getLunar().getEightChar()
  eightChar.setSect(dayBoundary === 'zi-hour-start' ? 1 : 2)
  let pillars = [eightChar.getYear(), eightChar.getMonth(), eightChar.getDay(), eightChar.getTime()] as [string, string, string, string]
  const needsProjectedSolarTermPillars = timezone !== 'Asia/Shanghai' || useTrueSolarTime
  if (needsProjectedSolarTermPillars && correctedParts.year >= LUNAR_YEAR_PROFILE_MIN_YEAR && correctedParts.year < LUNAR_YEAR_PROFILE_MAX_YEAR) {
    const boundaryContext: FlowBoundaryContext = {
      timezone,
      longitude: input.longitude,
      dstPolicy,
      useTrueSolarTime,
      timeCorrectionRuleVersion: resolvedTimeCorrectionRuleVersion,
    }
    const correctedLocalSecond = localMinuteToSecond(formatWallTime(corrected))
    const solarTermYear = solarTermYearForCorrectedLocalTime(correctedLocalSecond, correctedParts.year, boundaryContext)
    const solarTermMonth = findSelectedSolarTermMonth(deriveSolarTermMonthlyCycles(solarTermYear, boundaryContext), correctedLocalSecond)
    pillars = [cycleYearPillar(solarTermYear), solarTermMonth.pillar ?? eightChar.getMonth(), eightChar.getDay(), eightChar.getTime()] as [string, string, string, string]
  }
  const dayStem = pillars[2][0]
  const hiddenStems = pillars.map((pillar) => HIDDEN_STEMS[pillar[1]] ?? [])
  const conversion = convertCalendarDate({ calendarSystem: 'solar', date: resolved.solarDate, time: resolved.solarTime })
  const professional = deriveProfessionalFieldsFromPillars(pillars)
  const chart: BaziChart = {
    ruleVersion: BAZI_RULE_VERSION,
    calendarRuleVersion: CALENDAR_RULE_VERSION,
    timeCorrectionRuleVersion: resolvedTimeCorrectionRuleVersion,
    inputSnapshot: {
      calendarSystem: resolved.calendarSystem,
      sourceDate: input.date,
      sourceTime: input.time,
      normalizedSolarDate: resolved.solarDate,
      normalizedSolarTime: resolved.solarTime,
      locationName: input.locationName,
      ...(input.province ? { province: input.province } : {}),
      ...(input.city ? { city: input.city } : {}),
      ...(input.district ? { district: input.district } : {}),
      ...(input.placeCode ? { placeCode: input.placeCode } : {}),
      ...(input.geoDataVersion ? { geoDataVersion: input.geoDataVersion } : {}),
      longitude: input.longitude,
      ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
      timezone,
      utcOffsetMinutes: zoneProfile.utcOffsetMinutes,
      standardUtcOffsetMinutes: zoneProfile.standardOffsetMinutes,
      daylightSavingMinutes: daylightSavingMinutesValue,
      ...(zoneProfile.ambiguous ? { timeAmbiguous: true } : {}),
      dstPolicy,
      dayBoundary,
      luckMethod,
      useTrueSolarTime,
      timeCorrectionRuleVersion: resolvedTimeCorrectionRuleVersion,
      ...(resolved.calendarSystem === 'lunar' ? { lunarLeapMonth: input.lunarLeapMonth ?? false } : {}),
      normalizedLunarDate: conversion.lunarDate,
      normalizedLunarLeapMonth: conversion.lunarLeapMonth,
    },
    luckRuleVersion: LUCK_RULE_VERSION,
    timeProfile: {
      timezone,
      utcOffsetMinutes: zoneProfile.utcOffsetMinutes,
      standardUtcOffsetMinutes: zoneProfile.standardOffsetMinutes,
      daylightSavingMinutes: daylightSavingMinutesValue,
      dstPolicy,
      dayBoundary,
      luckMethod,
      standardMeridian,
      trueSolarCorrectionMinutes: Math.round(trueSolarCorrectionMinutes * 100) / 100,
      timeCorrectionRuleVersion: resolvedTimeCorrectionRuleVersion,
      runtimeProvenance: getBaziTimeRuntimeProvenance(),
    },
    correctedLocalTime: corrected.toISOString().slice(0, 16),
    correctionMinutes: Math.round(correctionMinutes * 100) / 100,
    pillars,
    dayMaster: { stem: dayStem, element: STEM_ELEMENTS[dayStem], yinYang: YANG_STEMS.has(dayStem) ? 'yang' : 'yin' },
    fiveElements: deriveFiveElements(pillars),
    balance: deriveBalanceFacts(pillars),
    monthCommand: deriveMonthCommandFacts(pillars),
    supportDimensions: deriveSupportDimensionFacts(pillars),
    tenGods: pillars.map((pillar) => deriveTenGod(dayStem, pillar[0])),
    hiddenStems,
    relations: deriveRelations(pillars),
    luckCycles: deriveLuckCycles(eightChar, input.gender, luckMethod),
    ...(input.gender ? {} : { luckPendingReason: 'gender-required' as const }),
    assessments: {
      strength: { status: 'pending-school-rule', reason: 'legacy-profile', ruleVersion: 'strength-v1-visible-element-baseline' },
      pattern: { status: 'pending-school-rule', reason: 'legacy-profile', ruleVersion: STANDARD_ASSESSMENT_RULE_VERSION },
      shenSha: { status: 'pending-school-rule', reason: 'legacy-profile', ruleVersion: STANDARD_ASSESSMENT_RULE_VERSION },
    },
    professional,
    pillarDetails: derivePillarDetails(pillars, hiddenStems, eightChar, dayStem, professional),
  }
  return ruleProfileVersion
    ? { ...chart, assessments: evaluateProfessionalAssessments(chart, ruleProfileVersion) }
    : chart
}

function cycleYearPillar(year: number): string {
  return Solar.fromYmd(year, 2, 4).getLunar().getYearInGanZhiByLiChun()
}

function cycleDayPillar(year: number, month: number, day: number, dayBoundary: 'midnight' | 'zi-hour-start'): string {
  const eightChar = Solar.fromYmdHms(year, month, day, 12, 0, 0).getLunar().getEightChar()
  eightChar.setSect(dayBoundary === 'zi-hour-start' ? 1 : 2)
  return eightChar.getDay()
}

function cycleHourPillar(year: number, month: number, day: number, hour: number, dayBoundary: 'midnight' | 'zi-hour-start'): string {
  const eightChar = Solar.fromYmdHms(year, month, day, hour, 0, 0).getLunar().getEightChar()
  eightChar.setSect(dayBoundary === 'zi-hour-start' ? 1 : 2)
  return eightChar.getTime()
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function findSelectedLuckCycle(luckCycles: readonly LuckCycle[], targetDate: string): LuckCycle | undefined {
  return luckCycles.find((cycle) => {
    if (!cycle.startDate || !cycle.endDate) return false
    return cycle.startDate <= targetDate && targetDate <= cycle.endDate
  })
}

function annualRangeForTarget(targetYear: number, selectedLuckCycle?: LuckCycle): readonly number[] {
  const startYear = selectedLuckCycle?.startDate ? Number(selectedLuckCycle.startDate.slice(0, 4)) : targetYear - 4
  const endYear = selectedLuckCycle?.endDate ? Number(selectedLuckCycle.endDate.slice(0, 4)) : targetYear + 5
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear > endYear) {
    return Array.from({ length: 10 }, (_, index) => targetYear - 4 + index)
  }
  const boundedStart = Math.max(startYear, targetYear - 10)
  const boundedEnd = Math.min(endYear, targetYear + 10)
  return Array.from({ length: boundedEnd - boundedStart + 1 }, (_, index) => boundedStart + index)
}

const SOLAR_TERM_MONTH_START_TERMS = ['立春', '惊蛰', '清明', '立夏', '芒种', '小暑', '立秋', '白露', '寒露', '立冬', '大雪', '小寒', '立春'] as const

function solarToLocalSecond(solar: Solar): string {
  const date = solar.toYmdHms()
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) {
    throw new Error(`invalid solar term timestamp: ${date}`)
  }
  return date.replace(' ', 'T')
}

function parseWallDateTimeSecond(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error(`invalid wall-clock timestamp: ${value}`)
  const wallTime = new Date(0)
  wallTime.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  wallTime.setUTCHours(Number(match[4]), Number(match[5]), Number(match[6]), 0)
  return wallTime
}

function formatWallSecond(parts: WallParts): string {
  return `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
}

function formatRoundedBoundary(value: Date): string {
  return `${value.toISOString().slice(0, 16)}:00`
}

function ceilToMinute(value: Date): Date {
  return new Date(Math.ceil(value.getTime() / 60_000) * 60_000)
}

function resolveWallInstant(wallTime: Date, timezone: string): Date {
  return resolveTimeZoneProfile(wallTime, timezone, 'earlier').instant
}

type FlowBoundaryContext = {
  timezone: string
  longitude: number
  dstPolicy: 'auto' | 'ignore'
  useTrueSolarTime: boolean
  timeCorrectionRuleVersion: TimeCorrectionRuleVersion
}

const DEFAULT_FLOW_BOUNDARY_CONTEXT: FlowBoundaryContext = {
  timezone: 'Asia/Shanghai',
  longitude: 120,
  dstPolicy: 'auto',
  useTrueSolarTime: false,
  timeCorrectionRuleVersion: CIVIL_TIME_RULE_VERSION,
}

function yearlyStandardOffsetAt(parts: WallParts, timezone: string): number {
  const offsets = Array.from({ length: 12 }, (_, month) => offsetAt(new Date(Date.UTC(parts.year, month, 15, 12)), timezone))
  return Math.min(...offsets)
}

function correctBoundaryInstant(instant: Date, context: FlowBoundaryContext): string {
  const wallParts = wallPartsAt(instant, context.timezone)
  const wallTime = parseWallDateTimeSecond(formatWallSecond(wallParts))
  const utcOffsetMinutes = offsetAt(instant, context.timezone)
  const standardOffsetMinutes = yearlyStandardOffsetAt(wallParts, context.timezone)
  const daylightSavingMinutes = context.dstPolicy === 'auto' ? utcOffsetMinutes - standardOffsetMinutes : 0
  const standardLocalTime = new Date(wallTime.getTime() - daylightSavingMinutes * 60_000)
  const standardMeridian = standardOffsetMinutes / 4
  const equationOfTime = context.timeCorrectionRuleVersion === TRUE_SOLAR_TIME_V3_RULE_VERSION
    ? equationOfTimeMinutesV3
    : equationOfTimeMinutesV2
  const trueSolarCorrectionMinutes = context.useTrueSolarTime
    ? (context.longitude - standardMeridian) * 4 + equationOfTime(standardLocalTime)
    : 0
  return formatRoundedBoundary(ceilToMinute(new Date(standardLocalTime.getTime() + trueSolarCorrectionMinutes * 60_000)))
}

function getExactJieBoundary(year: number, term: string, index: number, context: FlowBoundaryContext = DEFAULT_FLOW_BOUNDARY_CONTEXT): { term: string; at: string; pillar: string } {
  const boundaryYear = index >= 11 ? year + 1 : year
  const table = Lunar.fromYmd(boundaryYear, 1, 1).getJieQiTable()
  const solar = table[term]
  if (!solar) throw new Error(`missing jie boundary ${term} for ${boundaryYear}`)
  const jieQi = new JieQi(term, solar)
  if (!jieQi.isJie()) throw new Error(`${term} is not a jie boundary`)
  const instant = resolveWallInstant(parseWallDateTimeSecond(solarToLocalSecond(solar)), 'Asia/Shanghai')
  const at = correctBoundaryInstant(instant, context)
  const eightChar = solar.getLunar().getEightChar()
  eightChar.setSect(2)
  return { term, at, pillar: eightChar.getMonth() }
}

function localMinuteToSecond(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return `${value}:00`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return value
  throw new Error(`invalid corrected local time: ${value}`)
}

function solarTermYearForCorrectedLocalTime(targetLocalSecond: string, civilYear: number, context: FlowBoundaryContext): number {
  const currentLiChun = getExactJieBoundary(civilYear, '立春', 0, context).at
  return targetLocalSecond >= currentLiChun ? civilYear : civilYear - 1
}

function deriveSolarTermMonthlyCycles(year: number, context: FlowBoundaryContext = DEFAULT_FLOW_BOUNDARY_CONTEXT): MonthlyCycle[] {
  const monthNames = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']
  const boundaries = SOLAR_TERM_MONTH_START_TERMS.map((term, index) => getExactJieBoundary(year, term, index, context))
  if (boundaries.length !== 13 || boundaries[0]?.term !== '立春' || boundaries.at(-1)?.term !== '立春') {
    throw new Error(`invalid jie boundary sequence for ${year}`)
  }
  for (let index = 1; index < boundaries.length; index += 1) {
    if (boundaries[index]!.at <= boundaries[index - 1]!.at) {
      throw new Error(`jie boundaries must be strictly increasing for ${year}`)
    }
  }
  return monthNames.map((monthName, index) => {
    const start = boundaries[index]!
    const end = boundaries[index + 1]!
    return {
      year,
      month: index + 1,
      monthName,
      startAt: start.at,
      endAt: end.at,
      startTerm: start.term,
      endTerm: end.term,
      pillar: start.pillar,
      status: 'derived' as const,
    }
  })
}

function findSelectedSolarTermMonth(monthlyCycles: readonly MonthlyCycle[], targetLocalSecond: string): MonthlyCycle {
  const selected = monthlyCycles.filter((cycle) => cycle.startAt <= targetLocalSecond && targetLocalSecond < cycle.endAt)
  if (selected.length !== 1) {
    throw new Error(`target corrected local time must fall in exactly one solar-term month: ${targetLocalSecond}`)
  }
  return selected[0]!
}

/** Deterministic dynamic cycles for one immutable birth input and one target moment. */
export function calculateBaziFlow(birth: BirthInput, query: CycleQuery): BaziFlowChart {
  const target = parseTargetTime(query)
  const birthChart = calculateBazi(birth)
  const targetChart = calculateBazi({
    ...birth,
    calendarSystem: 'solar',
    date: target.date,
    time: target.time,
    lunarLeapMonth: undefined,
  })
  const [targetYear, targetMonth, targetDay] = targetChart.correctedLocalTime.slice(0, 10).split('-').map(Number) as [number, number, number]
  const targetDate = `${String(targetYear).padStart(4, '0')}-${pad(targetMonth)}-${pad(targetDay)}`
  const correctedHour = Number(targetChart.correctedLocalTime.slice(11, 13))
  const hourSlotStart = correctedHour === 23 || correctedHour === 0 ? 23 : correctedHour % 2 === 0 ? correctedHour - 1 : correctedHour
  const selectedLuckCycle = findSelectedLuckCycle(birthChart.luckCycles ?? [], targetDate)
  const dayBoundary = birthChart.inputSnapshot?.dayBoundary ?? 'midnight'
  const selectedMonthPillar = targetChart.pillars[1]
  const selectedDayPillar = targetChart.pillars[2]
  const annualCycles: AnnualCycle[] = annualRangeForTarget(targetYear, selectedLuckCycle).map((year) => ({
    year,
    pillar: cycleYearPillar(year),
    status: 'derived' as const,
  }))
  const targetLocalSecond = localMinuteToSecond(targetChart.correctedLocalTime)
  const flowBoundaryContext: FlowBoundaryContext = {
    timezone: birthChart.inputSnapshot?.timezone ?? 'Asia/Shanghai',
    longitude: birthChart.inputSnapshot?.longitude ?? birth.longitude,
    dstPolicy: birthChart.inputSnapshot?.dstPolicy ?? 'auto',
    useTrueSolarTime: birthChart.inputSnapshot?.useTrueSolarTime ?? true,
    timeCorrectionRuleVersion: birthChart.inputSnapshot?.timeCorrectionRuleVersion ?? TRUE_SOLAR_TIME_RULE_VERSION,
  }
  const solarTermYear = solarTermYearForCorrectedLocalTime(targetLocalSecond, targetYear, flowBoundaryContext)
  const monthlyCycles = deriveSolarTermMonthlyCycles(solarTermYear, flowBoundaryContext)
  const selectedMonthlyCycle = findSelectedSolarTermMonth(monthlyCycles, targetLocalSecond)
  if (selectedMonthlyCycle.pillar !== selectedMonthPillar) {
    throw new Error(`selected solar-term month pillar ${selectedMonthlyCycle.pillar} does not match target chart month pillar ${selectedMonthPillar}`)
  }
  const dailyCycles: DailyCycle[] = Array.from({ length: daysInMonth(targetYear, targetMonth) }, (_, index) => {
    const day = index + 1
    const date = `${String(targetYear).padStart(4, '0')}-${pad(targetMonth)}-${pad(day)}`
    return {
      date,
      pillar: date === targetDate ? selectedDayPillar : cycleDayPillar(targetYear, targetMonth, day, dayBoundary),
      status: 'derived' as const,
    }
  })
  const slots: readonly [number, string][] = [[23, '子'], [1, '丑'], [3, '寅'], [5, '卯'], [7, '辰'], [9, '巳'], [11, '午'], [13, '未'], [15, '申'], [17, '酉'], [19, '戌'], [21, '亥']]
  const hourlyCycles: HourlyCycle[] = slots.map(([startHour, earthlyBranch]) => ({
    dateTime: `${targetDate} ${pad(startHour)}:00`,
    startHour,
    earthlyBranch,
    pillar: cycleHourPillar(targetYear, targetMonth, targetDay, startHour, dayBoundary),
    status: 'derived' as const,
  }))

  return {
    ruleVersion: FLOW_RULE_VERSION,
    target: {
      date: target.date,
      time: target.time,
      timezone: birthChart.inputSnapshot?.timezone ?? 'Asia/Shanghai',
      dayBoundary,
      boundaryTimeBasis: 'corrected-local-solar-term-wall-v2',
    },
    selection: {
      ...(selectedLuckCycle ? { luckCycleIndex: selectedLuckCycle.index } : {}),
      year: targetYear,
      monthYear: selectedMonthlyCycle.year,
      month: selectedMonthlyCycle.month,
      date: targetDate,
      hourSlotStart,
    },
    targetChart: {
      correctedLocalTime: targetChart.correctedLocalTime,
      correctionMinutes: targetChart.correctionMinutes,
      pillars: targetChart.pillars,
      dayMaster: targetChart.dayMaster,
      fiveElements: targetChart.fiveElements,
      tenGods: targetChart.tenGods,
      pillarDetails: targetChart.pillarDetails,
      relations: targetChart.relations,
    },
    luckCycles: birthChart.luckCycles ?? [],
    annualCycles,
    monthlyCycles,
    dailyCycles,
    hourlyCycles,
  }
}

export function compareBaziWithExpected(
  sampleId: string,
  source: string,
  input: BirthInput,
  expected: Partial<Pick<
    BaziChart,
    | 'pillars'
    | 'correctedLocalTime'
    | 'correctionMinutes'
    | 'tenGods'
    | 'hiddenStems'
    | 'professional'
    | 'luckCycles'
    | 'annualCycles'
    | 'monthlyCycles'
    | 'dailyCycles'
    | 'hourlyCycles'
    | 'assessments'
    | 'inputSnapshot'
  >>,
): BaziComparisonReport {
  const dynamicExpected = expected as Partial<Pick<BaziChart, 'annualCycles' | 'monthlyCycles' | 'dailyCycles' | 'hourlyCycles'>>
  if (
    dynamicExpected.annualCycles !== undefined ||
    dynamicExpected.monthlyCycles !== undefined ||
    dynamicExpected.dailyCycles !== undefined ||
    dynamicExpected.hourlyCycles !== undefined
  ) {
    throw new Error('dynamic cycles must be compared through calculateBaziFlow with an explicit flowQuery')
  }
  const actual = calculateBazi(input)
  const checks: readonly [string, unknown, unknown][] = [
    ['pillars', expected.pillars, actual.pillars],
    ['correctedLocalTime', expected.correctedLocalTime, actual.correctedLocalTime],
    ['correctionMinutes', expected.correctionMinutes, actual.correctionMinutes],
    ['inputSnapshot.normalizedSolarDate', expected.inputSnapshot?.normalizedSolarDate, actual.inputSnapshot?.normalizedSolarDate],
    ['inputSnapshot.normalizedSolarTime', expected.inputSnapshot?.normalizedSolarTime, actual.inputSnapshot?.normalizedSolarTime],
    ['inputSnapshot.normalizedLunarDate', expected.inputSnapshot?.normalizedLunarDate, actual.inputSnapshot?.normalizedLunarDate],
    ['inputSnapshot.normalizedLunarLeapMonth', expected.inputSnapshot?.normalizedLunarLeapMonth, actual.inputSnapshot?.normalizedLunarLeapMonth],
    ['tenGods', expected.tenGods, actual.tenGods],
    ['hiddenStems', expected.hiddenStems, actual.hiddenStems],
    ['professional.naYin', expected.professional?.naYin, actual.professional?.naYin],
    ['professional.voidBranches', expected.professional?.voidBranches, actual.professional?.voidBranches],
    ['professional.twelveGrowthStages', expected.professional?.twelveGrowthStages, actual.professional?.twelveGrowthStages],
    ['luckCycles', expected.luckCycles, actual.luckCycles],
    ['assessments.strength.conclusion', expected.assessments?.strength?.conclusion, actual.assessments?.strength?.conclusion],
    ['assessments.pattern.conclusion', expected.assessments?.pattern?.conclusion, actual.assessments?.pattern?.conclusion],
    ['assessments.shenSha.items', expected.assessments?.shenSha?.items, actual.assessments?.shenSha?.items],
  ]
  const comparedPaths = checks.filter(([, wanted]) => wanted !== undefined).map(([path]) => path)
  const mismatches = checks
    .filter(([, wanted]) => wanted !== undefined)
    .filter(([, wanted, got]) => JSON.stringify(wanted) !== JSON.stringify(got))
    .map(([path, wanted, got]) => ({
      path,
      category: comparisonCategory(path),
      expected: wanted,
      actual: got,
    }))
  return { sampleId, source, matched: mismatches.length === 0, comparedPaths, mismatches }
}

function comparisonCategory(path: string): BaziComparisonReport['mismatches'][number]['category'] {
  if (path === 'pillars') return 'pillar'
  if (path === 'correctedLocalTime' || path === 'correctionMinutes') return 'time-correction'
  if (path.startsWith('inputSnapshot.normalized')) return 'calendar'
  if (path.startsWith('professional.') || path === 'tenGods' || path === 'hiddenStems') return 'professional-field'
  if (path === 'luckCycles') return 'luck-cycle'
  if (path.endsWith('Cycles')) return 'fine-cycle'
  if (path.startsWith('assessments.')) return 'assessment'
  return 'unexplained'
}
