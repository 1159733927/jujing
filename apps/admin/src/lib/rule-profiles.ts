import type {
  AssessmentName,
  DecisionCondition,
  DecisionRule,
  RuleProfile,
  RuleProfileDefinition,
  RuleProfileDraft,
  TrueSolarTimeRuleVersion,
} from '../types'
import { ApiRequestError } from '../api'
import { stateLabels } from './knowledge'

export const defaultTrueSolarTimeRuleVersion: TrueSolarTimeRuleVersion = 'true-solar-v2-zone-meridian-equation-of-time'

export const trueSolarTimeRuleVersionLabels: Record<TrueSolarTimeRuleVersion, string> = {
  'true-solar-v2-zone-meridian-equation-of-time': 'v2 · 经度与均时差（默认）',
  'true-solar-v3-standard-time-equation-of-time': 'v3 · 标准时与均时差',
}

const decisionMethod = 'decision-table-v1'

const assessmentLabels: Record<AssessmentName, string> = { strength: '日主强弱', pattern: '格局', shenSha: '神煞' }

const assessmentNames: AssessmentName[] = ['strength', 'pattern', 'shenSha']

export const profileStateLabels: Record<string, string> = stateLabels

const fixedAssessmentFacts = new Set([
  'dayMaster.stem', 'dayMaster.element', 'dayMaster.yinYang',
  'pillars.year.stem', 'pillars.year.branch', 'pillars.month.stem', 'pillars.month.branch',
  'pillars.day.stem', 'pillars.day.branch', 'pillars.hour.stem', 'pillars.hour.branch',
  'tenGods.year', 'tenGods.month', 'tenGods.day', 'tenGods.hour',
  'fiveElements.counts.wood', 'fiveElements.counts.fire', 'fiveElements.counts.earth',
  'fiveElements.counts.metal', 'fiveElements.counts.water',
  'hiddenStems.year', 'hiddenStems.month', 'hiddenStems.day', 'hiddenStems.hour', 'relations.kinds',
])

const assessmentOperators = new Set(['equals', 'in', 'contains', 'gt', 'gte', 'lt', 'lte', 'exists'])

const outputTargets = new Set(['year', 'month', 'day', 'hour'])

const stableIdentifier = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function requireOnlyKeys(value: Record<string, unknown>, allowed: string[], path: string) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key))
  if (extras.length) throw new Error(`${path} 包含不支持的字段：${extras.join('、')}`)
}

function requireNonEmptyString(value: unknown, path: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} 必须是非空字符串`)
  return value.trim()
}

function validateConditionValue(condition: Record<string, unknown>, path: string) {
  const operator = condition.operator
  const hasValue = Object.prototype.hasOwnProperty.call(condition, 'value') && condition.value !== undefined
  if (operator === 'exists') {
    if (hasValue && typeof condition.value !== 'boolean') throw new Error(`${path}.value 在 exists 运算符下必须是布尔值或省略`)
    return
  }
  if (!hasValue) throw new Error(`${path}.value 在 ${String(operator)} 运算符下不能为空`)
  if (operator === 'equals') {
    const valid = typeof condition.value === 'boolean'
      || (typeof condition.value === 'number' && Number.isFinite(condition.value))
      || (typeof condition.value === 'string' && Boolean(condition.value.trim()))
      || (Array.isArray(condition.value) && condition.value.length <= 50 && condition.value.every((item) => typeof item === 'string' && item.trim()))
    if (!valid) throw new Error(`${path}.value 与 equals 运算符不匹配`)
  } else if (operator === 'in') {
    if (!Array.isArray(condition.value) || !condition.value.length || condition.value.length > 50 || !condition.value.every((item) => typeof item === 'string' && item.trim())) throw new Error(`${path}.value 在 in 运算符下必须是 1–50 个非空字符串`)
  } else if (operator === 'contains') {
    const valid = (typeof condition.value === 'string' && Boolean(condition.value.trim()))
      || (Array.isArray(condition.value) && condition.value.length > 0 && condition.value.length <= 50 && condition.value.every((item) => typeof item === 'string' && item.trim()))
    if (!valid) throw new Error(`${path}.value 在 contains 运算符下必须是非空字符串或字符串数组`)
  } else if (!['gt', 'gte', 'lt', 'lte'].includes(String(operator)) || typeof condition.value !== 'number' || !Number.isFinite(condition.value)) {
    throw new Error(`${path}.value 在 ${String(operator)} 运算符下必须是有限数字`)
  }
  if (Array.isArray(condition.value) && new Set(condition.value).size !== condition.value.length) throw new Error(`${path}.value 不能包含重复值`)
}

export function parseDecisionRules(label: string, raw: string, enabled: boolean, publishedVersionIds: ReadonlySet<string>): DecisionRule[] {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch (cause) {
    throw new Error(`${label}规则 JSON 无法解析：${cause instanceof Error ? cause.message : '格式错误'}`)
  }
  if (!Array.isArray(parsed)) throw new Error(`${label}规则必须是 JSON 数组`)
  if (parsed.length > 200) throw new Error(`${label}规则不能超过 200 条`)
  if (enabled && parsed.length === 0) throw new Error(`${label}已启用，至少需要一条规则`)
  const ids = new Set<string>()
  return parsed.map((item, index) => {
    const path = `${label}规则[${index}]`
    if (!isPlainRecord(item)) throw new Error(`${path} 必须是对象`)
    requireOnlyKeys(item, ['id', 'priority', 'all', 'output', 'sourceVersionIds'], path)
    const id = requireNonEmptyString(item.id, `${path}.id`)
    if (!stableIdentifier.test(id)) throw new Error(`${path}.id 必须是稳定的小写标识`)
    if (ids.has(id)) throw new Error(`${label}存在重复规则 id：${id}`)
    ids.add(id)
    if (!Number.isSafeInteger(item.priority) || Number(item.priority) < 0 || Number(item.priority) > 10_000) throw new Error(`${path}.priority 必须是 0–10000 的整数`)
    if (!Array.isArray(item.all) || item.all.length > 20) throw new Error(`${path}.all 必须是最多 20 项的数组`)
    const all = item.all.map((condition, conditionIndex) => {
      const conditionPath = `${path}.all[${conditionIndex}]`
      if (!isPlainRecord(condition)) throw new Error(`${conditionPath} 必须是对象`)
      requireOnlyKeys(condition, ['fact', 'operator', 'value'], conditionPath)
      const fact = requireNonEmptyString(condition.fact, `${conditionPath}.fact`)
      const operator = requireNonEmptyString(condition.operator, `${conditionPath}.operator`)
      if (!fixedAssessmentFacts.has(fact)) throw new Error(`${conditionPath}.fact 不是允许的固定事实路径`)
      if (!assessmentOperators.has(operator)) throw new Error(`${conditionPath}.operator 不受支持`)
      validateConditionValue(condition, conditionPath)
      return condition as DecisionCondition
    })
    if (!isPlainRecord(item.output)) throw new Error(`${path}.output 必须是对象`)
    requireOnlyKeys(item.output, ['code', 'label', 'targets'], `${path}.output`)
    const code = requireNonEmptyString(item.output.code, `${path}.output.code`)
    if (!stableIdentifier.test(code)) throw new Error(`${path}.output.code 必须是稳定的小写标识`)
    const outputLabel = requireNonEmptyString(item.output.label, `${path}.output.label`)
    let targets: ('year' | 'month' | 'day' | 'hour')[] | undefined
    if (item.output.targets !== undefined) {
      if (!Array.isArray(item.output.targets) || !item.output.targets.length || !item.output.targets.every((target) => typeof target === 'string' && outputTargets.has(target))) throw new Error(`${path}.output.targets 只能包含 year/month/day/hour`)
      if (new Set(item.output.targets).size !== item.output.targets.length) throw new Error(`${path}.output.targets 不能重复`)
      targets = item.output.targets as ('year' | 'month' | 'day' | 'hour')[]
    }
    if (!Array.isArray(item.sourceVersionIds) || !item.sourceVersionIds.length || item.sourceVersionIds.length > 20) throw new Error(`${path}.sourceVersionIds 必须包含 1–20 个已发布知识版本`)
    const sourceVersionIds = item.sourceVersionIds.map((source, sourceIndex) => requireNonEmptyString(source, `${path}.sourceVersionIds[${sourceIndex}]`))
    if (new Set(sourceVersionIds).size !== sourceVersionIds.length) throw new Error(`${path}.sourceVersionIds 不能重复`)
    const unknownSource = sourceVersionIds.find((source) => !publishedVersionIds.has(source))
    if (unknownSource) throw new Error(`${path}.sourceVersionIds 引用了未收录的已发布知识版本：${unknownSource}`)
    return { id, priority: Number(item.priority), all, output: { code, label: outputLabel, ...(targets ? { targets } : {}) }, sourceVersionIds }
  })
}

export function emptyRuleJson(): Record<AssessmentName, string> {
  return { strength: '[]', pattern: '[]', shenSha: '[]' }
}

export function ruleJsonFromDefinition(definition: RuleProfileDefinition): Record<AssessmentName, string> {
  if (definition.schemaVersion !== 2) return emptyRuleJson()
  return Object.fromEntries(assessmentNames.map((name) => [name, JSON.stringify(definition.assessments[name].rules ?? [], null, 2)])) as Record<AssessmentName, string>
}

export function emptyRuleProfileDraft(): RuleProfileDraft {
  return {
    key: '',
    name: '',
    description: '',
    definition: {
      schemaVersion: 2,
      timeDefaults: {
        timezone: 'Asia/Shanghai',
        dstPolicy: 'auto',
        useTrueSolarTime: true,
        timeCorrectionRuleVersion: defaultTrueSolarTimeRuleVersion,
        dayBoundary: 'midnight',
        luckMethod: 'sect1',
      },
      assessments: {
        strength: { enabled: false, method: decisionMethod, ruleSetVersion: '2.0.0', rules: [] },
        pattern: { enabled: false, method: decisionMethod, ruleSetVersion: '2.0.0', rules: [] },
        shenSha: { enabled: false, method: decisionMethod, ruleSetVersion: '2.0.0', rules: [] },
      },
    },
  }
}

export function normalizeRuleProfileDefinition(definition: RuleProfileDefinition): RuleProfileDefinition {
  return {
    ...definition,
    timeDefaults: {
      ...definition.timeDefaults,
      timeCorrectionRuleVersion: definition.timeDefaults.timeCorrectionRuleVersion ?? defaultTrueSolarTimeRuleVersion,
    },
  }
}

export function buildRuleProfileWorkingDefinition(
  definition: RuleProfileDefinition,
  parsedRules: Record<AssessmentName, DecisionRule[]>,
): RuleProfileDefinition {
  const normalized = normalizeRuleProfileDefinition(definition)
  return {
    ...normalized,
    schemaVersion: 2,
    timeDefaults: normalized.timeDefaults,
    assessments: Object.fromEntries(assessmentNames.map((name) => [name, {
      ...normalized.assessments[name],
      method: decisionMethod,
      rules: parsedRules[name],
    }])) as RuleProfileDefinition['assessments'],
  }
}

export function ruleProfileDraftFromProfile(profile: RuleProfile): RuleProfileDraft {
  return {
    key: profile.key,
    name: profile.name,
    description: profile.description ?? '',
    definition: normalizeRuleProfileDefinition(structuredClone(profile.workingDefinition)),
    expectedRevision: profile.revision,
  }
}

export function buildRuleProfileRevisionPayload(draft: RuleProfileDraft, workingDefinition: RuleProfileDefinition) {
  const expectedRevision = draft.expectedRevision
  if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error('流派规则修订基线无效，请刷新后重试。')
  }
  return {
    name: draft.name.trim(),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    workingDefinition,
    expectedRevision,
  }
}

export function ruleProfileSaveErrorMessage(cause: unknown): string {
  if (cause instanceof ApiRequestError && cause.status === 409) return '流派规则已被他人更新，请刷新后重试'
  return cause instanceof Error ? cause.message : '保存流派规则失败'
}
