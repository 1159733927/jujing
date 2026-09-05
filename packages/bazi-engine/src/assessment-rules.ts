import { createHash } from 'node:crypto'
import type {
  BaziAssessmentCondition,
  BaziAssessmentFactPath,
  BaziAssessmentMethodConfig,
  BaziAssessmentName,
  BaziAssessmentRule,
  BaziChart,
  ProfessionalAssessmentProvenance,
  ProfessionalAssessmentResult,
  ProfessionalAssessments,
  PublishedBaziRuleProfileVersion,
} from '@fengshui/domain'

type FactValue = string | number | boolean | readonly string[] | undefined
type Facts = Readonly<Record<BaziAssessmentFactPath, FactValue>>

const PILLAR_INDEX = { year: 0, month: 1, day: 2, hour: 3 } as const

function projectFacts(chart: BaziChart): Facts {
  const pillarPart = (pillar: keyof typeof PILLAR_INDEX, index: 0 | 1): string | undefined =>
    chart.pillars[PILLAR_INDEX[pillar]]?.[index]
  const indexed = <T>(values: readonly T[] | undefined, pillar: keyof typeof PILLAR_INDEX): T | undefined =>
    values?.[PILLAR_INDEX[pillar]]

  return {
    'dayMaster.stem': chart.dayMaster?.stem,
    'dayMaster.element': chart.dayMaster?.element,
    'dayMaster.yinYang': chart.dayMaster?.yinYang,
    'pillars.year.stem': pillarPart('year', 0),
    'pillars.year.branch': pillarPart('year', 1),
    'pillars.month.stem': pillarPart('month', 0),
    'pillars.month.branch': pillarPart('month', 1),
    'pillars.day.stem': pillarPart('day', 0),
    'pillars.day.branch': pillarPart('day', 1),
    'pillars.hour.stem': pillarPart('hour', 0),
    'pillars.hour.branch': pillarPart('hour', 1),
    'tenGods.year': indexed(chart.tenGods, 'year'),
    'tenGods.month': indexed(chart.tenGods, 'month'),
    'tenGods.day': indexed(chart.tenGods, 'day'),
    'tenGods.hour': indexed(chart.tenGods, 'hour'),
    'fiveElements.counts.wood': chart.fiveElements?.counts.wood,
    'fiveElements.counts.fire': chart.fiveElements?.counts.fire,
    'fiveElements.counts.earth': chart.fiveElements?.counts.earth,
    'fiveElements.counts.metal': chart.fiveElements?.counts.metal,
    'fiveElements.counts.water': chart.fiveElements?.counts.water,
    'balance.supportScore': chart.balance?.supportScore,
    'balance.oppositionScore': chart.balance?.oppositionScore,
    'balance.netScore': chart.balance?.netScore,
    'balance.rootCount': chart.balance?.rootCount,
    'balance.resourceCount': chart.balance?.resourceCount,
    'balance.monthCommandSupports': chart.balance?.monthCommandSupports,
    'monthCommand.branch': chart.monthCommand?.branch,
    'monthCommand.mainQiStem': chart.monthCommand?.mainQiStem,
    'monthCommand.mainQiElement': chart.monthCommand?.mainQiElement,
    'monthCommand.mainQiTenGod': chart.monthCommand?.mainQiTenGod,
    'monthCommand.mainQiVisibleAt': chart.monthCommand?.mainQiVisibleAt,
    'monthCommand.supportsDayMasterBaseline': chart.monthCommand?.supportsDayMasterBaseline,
    'supportDimensions.monthCommandSupports': chart.supportDimensions?.monthCommandSupports,
    'supportDimensions.rootedAt': chart.supportDimensions?.rootedAt,
    'supportDimensions.visiblePeerAt': chart.supportDimensions?.visiblePeerAt,
    'supportDimensions.visibleResourceAt': chart.supportDimensions?.visibleResourceAt,
    'hiddenStems.year': indexed(chart.hiddenStems, 'year'),
    'hiddenStems.month': indexed(chart.hiddenStems, 'month'),
    'hiddenStems.day': indexed(chart.hiddenStems, 'day'),
    'hiddenStems.hour': indexed(chart.hiddenStems, 'hour'),
    'pillarDetails.shenSha.names': [...new Set(chart.pillarDetails?.flatMap((detail) => detail.shenSha.names ?? []) ?? [])].sort(),
    'relations.kinds': [...new Set(chart.relations?.map(({ kind }) => kind) ?? [])].sort(),
  }
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Readonly<Record<string, unknown>>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function hashFacts(facts: Facts): string {
  return createHash('sha256').update(canonicalJson(facts)).digest('hex')
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function conditionMatches(actual: FactValue, condition: BaziAssessmentCondition): boolean {
  const expected = condition.value
  switch (condition.operator) {
    case 'exists':
      return expected === false ? actual === undefined : actual !== undefined
    case 'equals':
      return actual !== undefined && expected !== undefined && valuesEqual(actual, expected)
    case 'in':
      return actual !== undefined && Array.isArray(expected) && expected.some((candidate) => valuesEqual(candidate, actual))
    case 'contains': {
      if (actual === undefined || expected === undefined) return false
      if (typeof actual === 'string') return typeof expected === 'string' && actual.includes(expected)
      if (!Array.isArray(actual)) return false
      const expectedItems = Array.isArray(expected) ? expected : [expected]
      return expectedItems.every((item) => actual.some((candidate) => valuesEqual(candidate, item)))
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (typeof actual !== 'number' || !Number.isFinite(actual) || typeof expected !== 'number' || !Number.isFinite(expected)) return false
      if (condition.operator === 'gt') return actual > expected
      if (condition.operator === 'gte') return actual >= expected
      if (condition.operator === 'lt') return actual < expected
      return actual <= expected
    }
  }
}

function ruleMatches(rule: BaziAssessmentRule, facts: Facts): boolean {
  return rule.all.every((condition) => conditionMatches(facts[condition.fact], condition))
}

function compareRules(left: BaziAssessmentRule, right: BaziAssessmentRule): number {
  const idOrder = left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  const leftCanonical = canonicalJson(left)
  const rightCanonical = canonicalJson(right)
  const canonicalOrder = leftCanonical < rightCanonical ? -1 : leftCanonical > rightCanonical ? 1 : 0
  return right.priority - left.priority || idOrder || canonicalOrder
}

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function provenance(
  profile: PublishedBaziRuleProfileVersion,
  assessment: BaziAssessmentName,
  config: BaziAssessmentMethodConfig,
  matchedRules: readonly BaziAssessmentRule[],
  factsHash: string,
): ProfessionalAssessmentProvenance {
  return {
    profileVersionId: profile.versionId,
    profileContentHash: profile.contentHash,
    assessment,
    method: 'decision-table-v1',
    ruleSetVersion: config.ruleSetVersion,
    matchedRuleIds: stableUnique(matchedRules.map(({ id }) => id)),
    sourceVersionIds: stableUnique(matchedRules.flatMap(({ sourceVersionIds }) => sourceVersionIds)).sort(),
    factsHash,
  }
}

function pendingLegacy(ruleVersion: string): ProfessionalAssessmentResult {
  return { status: 'pending-school-rule', reason: 'legacy-profile', ruleVersion }
}

function evaluateOne(
  assessment: BaziAssessmentName,
  config: BaziAssessmentMethodConfig,
  facts: Facts,
  factsHash: string,
  profile: PublishedBaziRuleProfileVersion,
): ProfessionalAssessmentResult {
  if (config.method !== 'decision-table-v1') return pendingLegacy(config.ruleSetVersion)

  if (!config.enabled) {
    return {
      status: 'pending-school-rule',
      reason: 'disabled',
      ruleVersion: config.ruleSetVersion,
      provenance: provenance(profile, assessment, config, [], factsHash),
    }
  }

  const matches = [...(config.rules ?? [])].filter((rule) => ruleMatches(rule, facts)).sort(compareRules)
  if (matches.length === 0) {
    return {
      status: 'unresolved',
      reason: 'no-match',
      ruleVersion: config.ruleSetVersion,
      provenance: provenance(profile, assessment, config, [], factsHash),
    }
  }

  if (assessment === 'shenSha') {
    const outputs = new Map<string, string>()
    for (const match of matches) {
      if (!outputs.has(match.output.code)) outputs.set(match.output.code, match.output.label)
    }
    return {
      status: 'derived',
      ruleVersion: config.ruleSetVersion,
      items: [...outputs.values()],
      provenance: provenance(profile, assessment, config, matches, factsHash),
    }
  }

  const topPriority = matches[0]!.priority
  const winners = matches.filter(({ priority }) => priority === topPriority)
  const distinctOutputs = stableUnique(winners.map(({ output }) => canonicalJson(output)))
  if (distinctOutputs.length !== 1) {
    return {
      status: 'unresolved',
      reason: 'conflict',
      ruleVersion: config.ruleSetVersion,
      provenance: provenance(profile, assessment, config, winners, factsHash),
    }
  }

  return {
    status: 'derived',
    ruleVersion: config.ruleSetVersion,
    conclusion: winners[0]!.output.label,
    ...(winners[0]!.output.elementDirection ? { elementDirection: winners[0]!.output.elementDirection } : {}),
    provenance: provenance(profile, assessment, config, winners, factsHash),
  }
}

/**
 * Executes a published, data-only decision table against a closed set of chart facts.
 * It never reads arbitrary paths and never supplies domain conclusions of its own.
 */
export function evaluateProfessionalAssessments(
  chart: BaziChart,
  profile: PublishedBaziRuleProfileVersion,
): ProfessionalAssessments {
  if (profile.definition.schemaVersion !== 2) {
    return {
      strength: pendingLegacy(profile.definition.assessments.strength.ruleSetVersion),
      pattern: pendingLegacy(profile.definition.assessments.pattern.ruleSetVersion),
      ...(profile.definition.assessments.elementPreference
        ? { elementPreference: pendingLegacy(profile.definition.assessments.elementPreference.ruleSetVersion) }
        : {}),
      shenSha: pendingLegacy(profile.definition.assessments.shenSha.ruleSetVersion),
    }
  }

  const facts = projectFacts(chart)
  const factsHash = hashFacts(facts)
  return {
    strength: evaluateOne('strength', profile.definition.assessments.strength, facts, factsHash, profile),
    pattern: evaluateOne('pattern', profile.definition.assessments.pattern, facts, factsHash, profile),
    ...(profile.definition.assessments.elementPreference
      ? { elementPreference: evaluateOne('elementPreference', profile.definition.assessments.elementPreference, facts, factsHash, profile) }
      : {}),
    shenSha: evaluateOne('shenSha', profile.definition.assessments.shenSha, facts, factsHash, profile),
  }
}
