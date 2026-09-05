import type { BaziCalculationResult, EvaluatedRule, PersonHouseCompatibilityAssessment, PersonHouseCompatibilityPoint, ReportSubmission, VisionObservation } from '@fengshui/domain'
import type {
  PublishedKnowledgeVersion,
  RuleCondition,
  StructuredRuleDefinition,
} from '@fengshui/knowledge-contracts'

export interface RuleFacts {
  bazi: BaziCalculationResult
  residence: ReportSubmission['residence']
  vision: readonly VisionObservation[]
}

const facts = new Set([
  'bazi.pillars',
  'bazi.dayMaster.stem',
  'bazi.dayMaster.element',
  'bazi.dayMaster.yinYang',
  'bazi.fiveElements.counts.wood',
  'bazi.fiveElements.counts.fire',
  'bazi.fiveElements.counts.earth',
  'bazi.fiveElements.counts.metal',
  'bazi.fiveElements.counts.water',
  'bazi.assessments.elementPreference.direction',
  'bazi.assessments.elementPreference.candidateElements',
  'bazi.assessments.elementPreference.cautiousElements',
  'residence.facing',
  'residence.layoutNote',
  'vision.rooms',
  'vision.factCodes',
  'vision.observedElements',
  'vision.summaries',
])
const operators = new Set(['equals', 'contains', 'contains-any', 'exists', 'gt', 'gte', 'lt', 'lte'])
const numericOperators = new Set(['gt', 'gte', 'lt', 'lte'])
const RULE_ELIGIBLE_VISION_FACT_CONFIDENCE = 0.7

export function validateStructuredRule(rule: StructuredRuleDefinition | undefined): string | undefined {
  if (!rule || !Number.isInteger(rule.priority) || rule.priority < 0 || rule.priority > 1000) return 'rule priority must be an integer from 0 to 1000'
  if (!rule.conditions.length) return 'rule must contain at least one condition'
  if (!rule.conclusions.length) return 'rule must contain at least one conclusion'
  if (rule.conditions.some((condition) => !facts.has(condition.fact) || !operators.has(condition.operator))) return 'rule contains an unsupported fact or operator'
  if (rule.conditions.some((condition) => {
    if (condition.operator === 'exists') return typeof condition.value !== 'boolean'
    if (numericOperators.has(condition.operator)) return typeof condition.value !== 'number' || !Number.isFinite(condition.value)
    return typeof condition.value !== 'string' && !Array.isArray(condition.value)
  })) return 'rule condition value does not match its operator'
  if (rule.conclusions.some((conclusion) => !conclusion.code?.trim() || !conclusion.text?.trim() || !['info', 'attention'].includes(conclusion.level))) return 'rule conclusions require code, text and level'
  if (rule.conclusions.some((conclusion) => conclusion.effect !== undefined && !['supportive', 'conflict', 'neutral', 'needs-confirmation'].includes(conclusion.effect))) return 'rule conclusion contains an unsupported effect'
  if (rule.conclusions.some((conclusion) => conclusion.severity !== undefined && !['low', 'medium', 'high'].includes(conclusion.severity))) return 'rule conclusion contains an unsupported severity'
  if (rule.sourceVersionIds !== undefined && (!Array.isArray(rule.sourceVersionIds) || rule.sourceVersionIds.length === 0 || rule.sourceVersionIds.some((id) => typeof id !== 'string' || !id.trim()))) return 'rule sourceVersionIds must contain non-empty version identifiers'
  if (rule.conflictGroup !== undefined && (typeof rule.conflictGroup !== 'string' || !rule.conflictGroup.trim() || rule.conflictGroup.length > 120)) return 'rule conflictGroup must contain 1-120 characters'
  return undefined
}

export function evaluatePublishedRules(versions: readonly PublishedKnowledgeVersion[], input: RuleFacts): EvaluatedRule[] {
  const matched = versions
    .filter((version) => version.kind === 'rule' && version.rule && version.rule.conditions.every((condition) => matches(condition, input)))
  const versionsById = new Map(versions.map((version) => [version.versionId, version]))
  const evaluated = matched.map((version): EvaluatedRule => {
    const sourceVersionIds = uniqueNonEmpty(version.rule!.sourceVersionIds ?? [version.versionId])
    const resolvedSources = sourceVersionIds
      .map((versionId) => versionsById.get(versionId))
      .filter((source): source is PublishedKnowledgeVersion => source !== undefined)
    return {
      assetId: version.assetId,
      version: version.version,
      versionId: version.versionId,
      contentHash: version.contentHash,
      title: version.title,
      priority: version.rule!.priority,
      conclusions: version.rule!.conclusions,
      sourceVersionIds,
      sourceLabels: uniqueNonEmpty(resolvedSources.length > 0 ? resolvedSources.map((source) => source.sourceLabel) : [version.sourceLabel]),
      sourceExcerpts: uniqueNonEmpty(resolvedSources.length > 0
        ? resolvedSources.map((source) => source.exactExcerpt ?? source.body.slice(0, 500))
        : [version.exactExcerpt ?? version.body.slice(0, 500)]),
      ...(version.rule!.conflictGroup ? { conflictGroup: version.rule!.conflictGroup } : {}),
    }
  })

  const highestPriorityByGroup = new Map<string, number>()
  for (const rule of evaluated) {
    if (!rule.conflictGroup) continue
    highestPriorityByGroup.set(rule.conflictGroup, Math.max(highestPriorityByGroup.get(rule.conflictGroup) ?? -1, rule.priority))
  }

  return evaluated
    .filter((rule) => !rule.conflictGroup || rule.priority === highestPriorityByGroup.get(rule.conflictGroup))
    .sort((left, right) => right.priority - left.priority || left.versionId.localeCompare(right.versionId))
}

function matches(condition: RuleCondition, input: RuleFacts): boolean {
  const actual = readFact(condition.fact, input)
  if (condition.operator === 'exists') return hasValue(actual) === condition.value
  if (numericOperators.has(condition.operator)) {
    if (typeof actual !== 'number' || typeof condition.value !== 'number') return false
    if (condition.operator === 'gt') return actual > condition.value
    if (condition.operator === 'gte') return actual >= condition.value
    if (condition.operator === 'lt') return actual < condition.value
    return actual <= condition.value
  }
  const actualValues = (Array.isArray(actual) ? actual : [actual]).filter((value): value is string => typeof value === 'string').map(normalize)
  const expectedValues = (Array.isArray(condition.value) ? condition.value : [condition.value]).filter((value): value is string => typeof value === 'string').map(normalize)
  if (condition.operator === 'equals') return actualValues.some((actualValue) => expectedValues.includes(actualValue))
  if (condition.operator === 'contains') return actualValues.some((actualValue) => expectedValues.some((expectedValue) => actualValue.includes(expectedValue)))
  return expectedValues.some((expectedValue) => actualValues.includes(expectedValue))
}

function readFact(fact: RuleCondition['fact'], input: RuleFacts): string | readonly string[] | number | undefined {
  switch (fact) {
    case 'bazi.pillars': return input.bazi.pillars
    case 'bazi.dayMaster.stem': return input.bazi.dayMaster?.stem
    case 'bazi.dayMaster.element': return input.bazi.dayMaster?.element
    case 'bazi.dayMaster.yinYang': return input.bazi.dayMaster?.yinYang
    case 'bazi.fiveElements.counts.wood': return input.bazi.fiveElements?.counts.wood
    case 'bazi.fiveElements.counts.fire': return input.bazi.fiveElements?.counts.fire
    case 'bazi.fiveElements.counts.earth': return input.bazi.fiveElements?.counts.earth
    case 'bazi.fiveElements.counts.metal': return input.bazi.fiveElements?.counts.metal
    case 'bazi.fiveElements.counts.water': return input.bazi.fiveElements?.counts.water
    case 'bazi.assessments.elementPreference.direction': return input.bazi.assessments?.elementPreference?.elementDirection?.direction
    case 'bazi.assessments.elementPreference.candidateElements': return input.bazi.assessments?.elementPreference?.elementDirection?.candidateElements
    case 'bazi.assessments.elementPreference.cautiousElements': return input.bazi.assessments?.elementPreference?.elementDirection?.cautiousElements
    case 'residence.facing': return input.residence.facing
    case 'residence.layoutNote': return input.residence.layoutNote
    case 'vision.rooms': return input.vision.map((observation) => observation.room)
    case 'vision.factCodes': return input.vision.flatMap((observation) =>
      observation.facts
        ?.filter((fact) => Number.isFinite(fact.confidence) && fact.confidence >= RULE_ELIGIBLE_VISION_FACT_CONFIDENCE)
        .map((fact) => fact.code) ?? [],
    )
    case 'vision.observedElements': return input.vision.flatMap((observation) => observation.observedElements)
    case 'vision.summaries': return input.vision.map((observation) => observation.summary)
  }
}

function hasValue(value: string | readonly string[] | number | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'string' && value.trim().length > 0
}

function normalize(value: string): string { return value.trim().toLocaleLowerCase('zh-CN') }

const ELEMENT_LABELS = { wood: '木', fire: '火', earth: '土', metal: '金', water: '水' } as const
const FACING_LABELS = { north: '北', east: '东', south: '南', west: '西', unknown: '未确认' } as const
const VISION_FACT_LABELS: Readonly<Record<string, string>> = {
  'daylight.visible': '可见自然采光',
  'window.visible': '可见窗户',
  'balcony.visible': '可见阳台',
  'kitchen.south': '厨房位于住宅南侧',
  'bathroom.near-center': '卫生间靠近住宅中宫',
  'circulation.entry-balcony-aligned': '入户与阳台动线近直线',
}

const BASELINE_RULE_TITLE = '人宅合参演示基线'
const BASELINE_RULE_VERSION = 1
const BASELINE_RULE_VERSION_ID = 'person-house-baseline-v1'
const BASELINE_SOURCE_LABEL = '程序合参基线'

function chartEvidence(input: RuleFacts): string {
  const dayMaster = input.bazi.dayMaster
  const counts = input.bazi.fiveElements?.counts
  const elementCounts = counts
    ? `五行计数按显性天干和地支本气归类为木${counts.wood}、火${counts.fire}、土${counts.earth}、金${counts.metal}、水${counts.water}`
    : '五行计数未记录'
  const dayMasterElement = dayMaster ? ELEMENT_LABELS[dayMaster.element] : '五行未记录'
  return `命盘四柱为${input.bazi.pillars.join('、')}；日主为${dayMaster?.stem ?? '未记录'}，属${dayMasterElement}；${elementCounts}。`
}

function sanitizeEvidenceText(value: string): string {
  return value
    .replace(/卫生间\s+is near the center sector by floorplan-nine-grid-v1\.?/giu, '卫生间靠近住宅中宫')
    .replace(/厨房\s+is placed in the south sector by floorplan-nine-grid-v1\.?/giu, '厨房位于住宅南侧')
    .replace(/\bfloorplan-nine-grid-v1\b/giu, '九宫程序分析')
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    unique.push(value)
  }
  return unique
}

function readableVisionEvidence(observation: VisionObservation): readonly string[] {
  const structuredFacts = observation.facts
    ?.filter((fact) => Number.isFinite(fact.confidence) && fact.confidence >= RULE_ELIGIBLE_VISION_FACT_CONFIDENCE)
    .map((fact) => VISION_FACT_LABELS[fact.code] ?? sanitizeEvidenceText(fact.evidence)) ?? []
  return uniqueNonEmpty(structuredFacts.length > 0
    ? structuredFacts
    : observation.observedElements.map(sanitizeEvidenceText))
}

function residenceEvidence(input: RuleFacts): string {
  const observations = uniqueNonEmpty(input.vision.flatMap(readableVisionEvidence)).slice(0, 6)
  return [
    `住宅整体朝向为${FACING_LABELS[input.residence.facing]}`,
    input.residence.layoutNote?.trim() ? `格局备注：${input.residence.layoutNote.trim()}` : '',
    observations.length > 0 ? `户型和照片可见：${observations.join('、')}` : '',
  ].filter(Boolean).join('；') + '。'
}

function eligibleVisionFactCodes(input: RuleFacts): Set<string> {
  return new Set(input.vision.flatMap((observation) =>
    observation.facts
      ?.filter((fact) => Number.isFinite(fact.confidence) && fact.confidence >= RULE_ELIGIBLE_VISION_FACT_CONFIDENCE)
      .map((fact) => fact.code) ?? [],
  ))
}

function baselinePoint(input: RuleFacts, point: {
  conclusion: string
  effect: 'supportive' | 'conflict'
  level: PersonHouseCompatibilityPoint['level']
  severity?: PersonHouseCompatibilityPoint['severity']
  actionKind: 'amplify' | 'mitigate'
  location: string
  action: string
  intendedEffect: string
  verification: string
}): PersonHouseCompatibilityPoint {
  return {
    conclusion: point.conclusion,
    chartEvidence: chartEvidence(input),
    residenceEvidence: residenceEvidence(input),
    ruleTitle: BASELINE_RULE_TITLE,
    ruleVersion: BASELINE_RULE_VERSION,
    ruleVersionId: BASELINE_RULE_VERSION_ID,
    sourceLabel: BASELINE_SOURCE_LABEL,
    origin: 'deterministic-rule',
    level: point.level,
    effect: point.effect,
    ...(point.severity ? { severity: point.severity } : {}),
    actions: [{
      kind: point.actionKind,
      location: point.location,
      action: point.action,
      intendedEffect: point.intendedEffect,
      verification: point.verification,
      safety: 'reversible-low-risk',
    }],
  }
}

function buildBaselineCompatibilityPoints(input: RuleFacts): {
  positiveMatches: PersonHouseCompatibilityPoint[]
  conflicts: PersonHouseCompatibilityPoint[]
} {
  const positiveMatches: PersonHouseCompatibilityPoint[] = []
  const conflicts: PersonHouseCompatibilityPoint[] = []
  if (!input.bazi.dayMaster || !input.bazi.fiveElements) return { positiveMatches, conflicts }

  const factCodes = eligibleVisionFactCodes(input)
  const elementDirection = input.bazi.assessments?.elementPreference?.elementDirection
  const candidateElements = new Set(elementDirection?.candidateElements ?? [])
  const cautiousElements = new Set(elementDirection?.cautiousElements ?? [])
  const hasSouthFireCondition = input.residence.facing === 'south' || factCodes.has('kitchen.south')
  const hasVisibleDaylight = factCodes.has('daylight.visible') || factCodes.has('window.visible')

  if (hasSouthFireCondition && candidateElements.has('fire')) {
    positiveMatches.push(baselinePoint(input, {
      conclusion: '住宅的南向或南侧厨房，与命盘扶抑基线里可参考的火性方向形成局部呼应。',
      effect: 'supportive',
      level: 'info',
      actionKind: 'amplify',
      location: '朝南格局与南侧厨房',
      action: '保留南侧厨房的明亮、干净和通风，不用杂物压住厨房台面或南侧动线。',
      intendedEffect: '放大朝南与南侧厨房形成的火性呼应，同时避免火性空间变得燥乱。',
      verification: '复看户型图和现场，确认南侧厨房仍作为主要烹饪区且周边动线顺畅。',
    }))
  }

  if (hasSouthFireCondition && cautiousElements.has('fire')) {
    conflicts.push(baselinePoint(input, {
      conclusion: '住宅的南向或南侧厨房会继续加强火性，对当前命盘扶抑基线里需谨慎的火性来说偏容易过旺。',
      effect: 'conflict',
      level: 'attention',
      severity: 'medium',
      actionKind: 'mitigate',
      location: '朝南格局与南侧厨房',
      action: '先减少红橙等强烈暖色和杂物堆积，保持台面清爽，优先用浅色、木色或中性色稳定空间。',
      intendedEffect: '把南侧火气从“燥、乱、压迫”调回“明、净、有序”。',
      verification: '现场看厨房是否明亮但不过热、是否长期堆满电器或杂物。',
    }))
  }

  if (hasVisibleDaylight && candidateElements.has('wood')) {
    positiveMatches.push(baselinePoint(input, {
      conclusion: '住宅有可见采光和窗面，对命盘扶抑基线里可参考的木性生发方向有加分。',
      effect: 'supportive',
      level: 'info',
      actionKind: 'amplify',
      location: '主要窗面和客厅活动区',
      action: '保留窗面通透，优先把日常活动区放在采光稳定的位置。',
      intendedEffect: '让空间的生发感服务于居住者的日常行动和精神状态。',
      verification: '白天观察客厅与常用房间是否能获得连续自然光。',
    }))
  }

  if (factCodes.has('bathroom.near-center')) {
    conflicts.push(baselinePoint(input, {
      conclusion: '卫生间靠近住宅中心，会削弱整屋中部的稳定感；与需要稳定承载的个人居住场不够合拍。',
      effect: 'conflict',
      level: 'attention',
      severity: 'high',
      actionKind: 'mitigate',
      location: '靠近中宫的卫生间',
      action: '保持门常关、地面干爽、排风顺畅，门口和过道不要堆放杂物。',
      intendedEffect: '减少湿气和杂乱对住宅中心区域的影响。',
      verification: '检查卫生间通风、异味、潮湿和门外动线是否长期干净顺畅。',
    }))
  }

  if (factCodes.has('circulation.entry-balcony-aligned')) {
    conflicts.push(baselinePoint(input, {
      conclusion: '入户到阳台的动线接近直线，容易让空间气口收束不稳；对人宅合参来说属于需要缓一缓的点。',
      effect: 'conflict',
      level: 'attention',
      severity: 'medium',
      actionKind: 'mitigate',
      location: '入户门到阳台之间的直线动线',
      action: '在不改结构的前提下，用玄关柜、屏风、矮柜或绿植形成柔和转折，避免一眼贯穿到底。',
      intendedEffect: '让入户气流先停留再进入客厅，减少直冲直泄。',
      verification: '站在入户门处看是否能直接看到阳台外；调整后应有轻微遮挡但不堵路。',
    }))
  }

  return { positiveMatches, conflicts }
}

export function buildPersonHouseCompatibilityAssessment(input: RuleFacts & { evaluatedRules: readonly EvaluatedRule[] }): PersonHouseCompatibilityAssessment {
  const criticalMissingFacts: string[] = []
  if (!input.bazi.dayMaster) criticalMissingFacts.push('命盘日主')
  if (!input.bazi.fiveElements) criticalMissingFacts.push('命盘五行分布')

  const disputedGroups = new Set<string>()
  const rulesByConflictGroup = new Map<string, EvaluatedRule[]>()
  for (const rule of input.evaluatedRules) {
    if (!rule.conflictGroup) continue
    const group = rulesByConflictGroup.get(rule.conflictGroup) ?? []
    group.push(rule)
    rulesByConflictGroup.set(rule.conflictGroup, group)
  }
  for (const [groupName, rules] of rulesByConflictGroup) {
    const effects = new Set(rules.flatMap((rule) => rule.conclusions.map(conclusionEffect)))
    if (effects.has('supportive') && effects.has('conflict')) disputedGroups.add(groupName)
  }

  const activeRules = input.evaluatedRules.filter((rule) => !rule.conflictGroup || !disputedGroups.has(rule.conflictGroup))
  let positiveMatches: PersonHouseCompatibilityPoint[] = activeRules.flatMap((rule) =>
    rule.conclusions
      .filter((conclusion) => conclusionEffect(conclusion) === 'supportive')
      .map((conclusion) => ({
        conclusion: conclusion.text,
        chartEvidence: chartEvidence(input),
        residenceEvidence: residenceEvidence(input),
        ruleTitle: rule.title,
        ruleVersion: rule.version,
        ruleVersionId: rule.versionId,
        sourceLabel: sourceLabel(rule),
        origin: 'deterministic-rule' as const,
        level: conclusion.level,
        effect: conclusionEffect(conclusion),
        ...(conclusion.severity ? { severity: conclusion.severity } : {}),
      })),
  )
  let conflicts: PersonHouseCompatibilityPoint[] = activeRules.flatMap((rule) =>
    rule.conclusions
      .filter((conclusion) => conclusionEffect(conclusion) === 'conflict')
      .map((conclusion) => ({
        conclusion: conclusion.text,
        chartEvidence: chartEvidence(input),
        residenceEvidence: residenceEvidence(input),
        ruleTitle: rule.title,
        ruleVersion: rule.version,
        ruleVersionId: rule.versionId,
        sourceLabel: sourceLabel(rule),
        origin: 'deterministic-rule' as const,
        level: conclusion.level,
        effect: conclusionEffect(conclusion),
        ...(conclusion.severity ? { severity: conclusion.severity } : {}),
      })),
  )

  const neutralRuleConclusions = activeRules.flatMap((rule) => rule.conclusions
    .filter((conclusion) => ['neutral', 'needs-confirmation'].includes(conclusionEffect(conclusion)))
    .map((conclusion) => conclusion.effect === 'needs-confirmation'
      ? `待确认：${conclusion.text}`
      : conclusion.text))
  const disputedRuleConclusions = [...disputedGroups]
    .sort()
    .map((groupName) => `规则组“${groupName}”存在同优先级的相反结论，需专家复核，本次不计入合拍或冲突。`)

  const canUseBaselineFacts = eligibleVisionFactCodes(input).size > 0
  if (positiveMatches.length === 0 && conflicts.length === 0 && (activeRules.length === 0 || canUseBaselineFacts) && disputedGroups.size === 0) {
    const baseline = buildBaselineCompatibilityPoints(input)
    positiveMatches = baseline.positiveMatches
    conflicts = baseline.conflicts
  }

  if (input.residence.facing === 'unknown' && positiveMatches.length === 0 && conflicts.length === 0) {
    criticalMissingFacts.push('住宅整体朝向')
  }

  if (positiveMatches.length === 0 && conflicts.length === 0) {
    if (!criticalMissingFacts.includes('可用于人宅合参的已发布专业依据')) {
      criticalMissingFacts.push('可用于人宅合参的已发布专业依据')
    }
  }

  if (criticalMissingFacts.length > 0) {
    return {
      assessable: false,
      overallLevel: 'insufficient-evidence',
      confidence: 'low',
      positiveMatches: [],
      conflicts: [],
      neutralOrUnknown: [
        '关键信息不足，不能给出合拍结论。',
        ...neutralRuleConclusions,
        ...disputedRuleConclusions,
      ],
      criticalMissingFacts,
    }
  }

  const overallLevel = conflicts.length > 0 && positiveMatches.length > 0
    ? 'mixed'
    : conflicts.length > 0
      ? 'conflict'
      : positiveMatches.length > 0
        ? 'supportive'
        : 'neutral'

  return {
    assessable: true,
    overallLevel,
    confidence: input.evaluatedRules.length > 0 ? 'medium' : 'low',
    positiveMatches,
    conflicts,
    neutralOrUnknown: [
      ...(input.evaluatedRules.length > 0 ? [] : ['没有已发布专家规则直接命中；本次采用程序合参基线给出低风险初判。']),
      ...neutralRuleConclusions,
      ...disputedRuleConclusions,
      ...(input.residence.facing === 'unknown' ? ['住宅整体朝向未确认；本次只评估不依赖整体朝向的局部格局事实。'] : []),
    ],
    criticalMissingFacts: [],
  }
}

function conclusionEffect(conclusion: EvaluatedRule['conclusions'][number]): NonNullable<EvaluatedRule['conclusions'][number]['effect']> {
  return conclusion.effect ?? (conclusion.level === 'info' ? 'supportive' : 'conflict')
}

function sourceLabel(rule: EvaluatedRule): string {
  return rule.sourceLabels && rule.sourceLabels.length > 0 ? rule.sourceLabels.join('、') : '确定性规则'
}
