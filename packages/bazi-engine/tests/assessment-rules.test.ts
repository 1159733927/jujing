import { describe, expect, it } from 'vitest'
import type { BaziAssessmentRule, BaziChart, ElementBalanceDirection, PublishedBaziRuleProfileVersion } from '@fengshui/domain'
import { evaluateProfessionalAssessments } from '../src/assessment-rules.js'
import { buildElementBalanceDirection } from '../src/index.js'

const chart: BaziChart = {
  ruleVersion: 'neutral-chart-v1',
  correctedLocalTime: '2000-01-01T12:00',
  correctionMinutes: 0,
  pillars: ['AB', 'CD', 'EF', 'GH'],
  dayMaster: { stem: 'E', element: 'wood', yinYang: 'yang' },
  fiveElements: {
    counts: { wood: 3, fire: 2, earth: 1, metal: 1, water: 1 },
    method: 'visible-stems-and-branches-v1',
  },
  tenGods: ['T0', 'T1', 'T2', 'T3'],
  hiddenStems: [['H0', 'H1'], ['H2'], [], ['H3']],
  pillarDetails: [
    { pillar: 'AB', heavenlyStem: 'A', earthlyBranch: 'B', stemTenGod: 'T0', hiddenStems: [], naYin: '', voidBranches: '', twelveGrowthStage: '', selfSitting: '', shenSha: { status: 'derived', ruleVersion: 'test', names: ['天乙贵人'] } },
    { pillar: 'CD', heavenlyStem: 'C', earthlyBranch: 'D', stemTenGod: 'T1', hiddenStems: [], naYin: '', voidBranches: '', twelveGrowthStage: '', selfSitting: '', shenSha: { status: 'derived', ruleVersion: 'test', names: ['文昌贵人'] } },
    { pillar: 'EF', heavenlyStem: 'E', earthlyBranch: 'F', stemTenGod: 'T2', hiddenStems: [], naYin: '', voidBranches: '', twelveGrowthStage: '', selfSitting: '', shenSha: { status: 'derived', ruleVersion: 'test', names: ['天乙贵人'] } },
    { pillar: 'GH', heavenlyStem: 'G', earthlyBranch: 'H', stemTenGod: 'T3', hiddenStems: [], naYin: '', voidBranches: '', twelveGrowthStage: '', selfSitting: '', shenSha: { status: 'pending-school-rule', ruleVersion: 'test' } },
  ],
  balance: {
    method: 'seasonal-support-baseline-v1',
    supportScore: 6.2,
    oppositionScore: 4.1,
    netScore: 2.1,
    rootCount: 2,
    resourceCount: 1,
    monthCommandSupports: true,
    contributions: [],
  },
  monthCommand: {
    method: 'month-command-facts-v1',
    branch: 'D',
    mainQiStem: 'H2',
    mainQiElement: 'water',
    mainQiTenGod: 'T-main',
    mainQiVisibleAt: ['month', 'hour'],
    supportsDayMasterBaseline: true,
  },
  supportDimensions: {
    method: 'support-dimensions-facts-v1',
    monthCommandSupports: true,
    rootedAt: ['month', 'day'],
    visiblePeerAt: ['year'],
    visibleResourceAt: ['hour'],
  },
  relations: [
    { kind: 'clash', members: [0, 1], detail: 'neutral-r1' },
    { kind: 'combination', members: [2, 3], detail: 'neutral-r2' },
  ],
}

function rule(
  id: string,
  priority: number,
  code: string,
  label: string,
  all: BaziAssessmentRule['all'],
  sourceVersionIds: readonly string[] = [`source-${id}`],
): BaziAssessmentRule {
  return { id, priority, all, output: { code, label }, sourceVersionIds }
}

function elementDirectionRule(
  id: string,
  priority: number,
  code: string,
  label: string,
  elementDirection: ElementBalanceDirection,
  all: BaziAssessmentRule['all'] = [],
): BaziAssessmentRule {
  return { id, priority, all, output: { code, label, elementDirection }, sourceVersionIds: [`source-${id}`] }
}

function profile(overrides: Partial<PublishedBaziRuleProfileVersion['definition']['assessments']> = {}): PublishedBaziRuleProfileVersion {
  const emptyMethod = {
    enabled: true,
    method: 'decision-table-v1',
    ruleSetVersion: 'neutral-rules-v1',
    rules: [],
  } as const
  return {
    profileId: 'profile-neutral',
    versionId: 'profile-neutral-v7',
    version: 7,
    key: 'neutral',
    name: 'Neutral profile',
    definition: {
      schemaVersion: 2,
      timeDefaults: {
        timezone: 'Asia/Shanghai',
        dstPolicy: 'ignore',
        useTrueSolarTime: true,
        dayBoundary: 'midnight',
        luckMethod: 'sect1',
      },
      assessments: {
        strength: emptyMethod,
        pattern: emptyMethod,
        shenSha: emptyMethod,
        ...overrides,
      },
    },
    contentHash: 'sha256:profile-neutral',
    submittedForReviewAt: '2026-01-01T00:00:00.000Z',
    submittedForReviewBy: 'author',
    reviewedAt: '2026-01-02T00:00:00.000Z',
    reviewedBy: 'reviewer',
    publishedAt: '2026-01-03T00:00:00.000Z',
    publishedBy: 'publisher',
  }
}

describe('evaluateProfessionalAssessments', () => {
  it('projects only supported facts and evaluates every decision-table operator', () => {
    const operatorRule = rule('operators', 10, 'neutral-code', 'Neutral label', [
      { fact: 'dayMaster.stem', operator: 'equals', value: 'E' },
      { fact: 'dayMaster.element', operator: 'in', value: ['wood', 'fire'] },
      { fact: 'dayMaster.yinYang', operator: 'exists', value: true },
      { fact: 'pillars.year.stem', operator: 'equals', value: 'A' },
      { fact: 'pillars.hour.branch', operator: 'equals', value: 'H' },
      { fact: 'tenGods.month', operator: 'equals', value: 'T1' },
      { fact: 'hiddenStems.year', operator: 'contains', value: 'H1' },
      { fact: 'pillarDetails.shenSha.names', operator: 'contains', value: ['天乙贵人', '文昌贵人'] },
      { fact: 'relations.kinds', operator: 'contains', value: 'clash' },
      { fact: 'fiveElements.counts.wood', operator: 'gt', value: 2 },
      { fact: 'fiveElements.counts.wood', operator: 'gte', value: 3 },
      { fact: 'fiveElements.counts.fire', operator: 'lt', value: 3 },
      { fact: 'fiveElements.counts.fire', operator: 'lte', value: 2 },
      { fact: 'balance.supportScore', operator: 'gt', value: 6 },
      { fact: 'balance.oppositionScore', operator: 'lt', value: 5 },
      { fact: 'balance.netScore', operator: 'equals', value: 2.1 },
      { fact: 'balance.rootCount', operator: 'equals', value: 2 },
      { fact: 'balance.resourceCount', operator: 'equals', value: 1 },
      { fact: 'balance.monthCommandSupports', operator: 'equals', value: true },
      { fact: 'monthCommand.branch', operator: 'equals', value: 'D' },
      { fact: 'monthCommand.mainQiStem', operator: 'equals', value: 'H2' },
      { fact: 'monthCommand.mainQiElement', operator: 'equals', value: 'water' },
      { fact: 'monthCommand.mainQiTenGod', operator: 'equals', value: 'T-main' },
      { fact: 'monthCommand.mainQiVisibleAt', operator: 'contains', value: ['month', 'hour'] },
      { fact: 'monthCommand.supportsDayMasterBaseline', operator: 'equals', value: true },
      { fact: 'supportDimensions.monthCommandSupports', operator: 'equals', value: true },
      { fact: 'supportDimensions.rootedAt', operator: 'contains', value: ['month', 'day'] },
      { fact: 'supportDimensions.visiblePeerAt', operator: 'contains', value: 'year' },
      { fact: 'supportDimensions.visibleResourceAt', operator: 'contains', value: 'hour' },
    ])
    const result = evaluateProfessionalAssessments(chart, profile({
      strength: { enabled: true, method: 'decision-table-v1', ruleSetVersion: 'strength-neutral-v1', rules: [operatorRule] },
    }))

    expect(result.strength).toMatchObject({
      status: 'derived',
      ruleVersion: 'strength-neutral-v1',
      conclusion: 'Neutral label',
      provenance: {
        profileVersionId: 'profile-neutral-v7',
        profileContentHash: 'sha256:profile-neutral',
        assessment: 'strength',
        method: 'decision-table-v1',
        ruleSetVersion: 'strength-neutral-v1',
        matchedRuleIds: ['operators'],
        sourceVersionIds: ['source-operators'],
      },
    })
    expect(result.strength.provenance?.factsHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('uses priority descending and id ascending, independent of rule input order', () => {
    const fallback = rule('z-fallback', 1, 'fallback', 'Fallback', [])
    const winnerB = rule('b-winner', 20, 'winner', 'Winner', [], ['source-2', 'source-1'])
    const winnerA = rule('a-winner', 20, 'winner', 'Winner', [], ['source-1'])
    const config = (rules: readonly BaziAssessmentRule[]) => ({
      enabled: true,
      method: 'decision-table-v1',
      ruleSetVersion: 'ordered-v1',
      rules,
    })

    const forward = evaluateProfessionalAssessments(chart, profile({ pattern: config([fallback, winnerB, winnerA]) }))
    const reverse = evaluateProfessionalAssessments(chart, profile({ pattern: config([winnerA, winnerB, fallback]) }))

    expect(forward).toEqual(reverse)
    expect(forward.pattern).toMatchObject({
      status: 'derived',
      conclusion: 'Winner',
      provenance: {
        matchedRuleIds: ['a-winner', 'b-winner'],
        sourceVersionIds: ['source-1', 'source-2'],
      },
    })
  })

  it('fails closed when top-priority single-result rules disagree', () => {
    const result = evaluateProfessionalAssessments(chart, profile({
      strength: {
        enabled: true,
        method: 'decision-table-v1',
        ruleSetVersion: 'conflict-v1',
        rules: [
          rule('b', 10, 'code-b', 'Label B', []),
          rule('a', 10, 'code-a', 'Label A', []),
          rule('lower', 1, 'code-lower', 'Lower', []),
        ],
      },
    }))

    expect(result.strength).toMatchObject({
      status: 'unresolved',
      reason: 'conflict',
      ruleVersion: 'conflict-v1',
      provenance: { matchedRuleIds: ['a', 'b'] },
    })
    expect(result.strength.conclusion).toBeUndefined()
  })

  it('evaluates optional element preference and preserves profiles that omit it', () => {
    const direction = buildElementBalanceDirection('wood', 'add-support')
    const elementPreference = {
      enabled: true,
      method: 'decision-table-v1',
      ruleSetVersion: 'preference-v1',
      rules: [elementDirectionRule('prefer-fire', 10, 'fire', '喜火', direction, [
        { fact: 'balance.netScore', operator: 'gt', value: 0 },
        { fact: 'balance.monthCommandSupports', operator: 'equals', value: true },
      ])],
    } as const
    const current = evaluateProfessionalAssessments(chart, profile({ elementPreference }))
    const omitted = evaluateProfessionalAssessments(chart, profile())

    expect(current.elementPreference).toMatchObject({
      status: 'derived', conclusion: '喜火',
      elementDirection: direction,
      provenance: { assessment: 'elementPreference', matchedRuleIds: ['prefer-fire'] },
    })
    expect(omitted.elementPreference).toBeUndefined()
  })

  it('fails optional element preference closed for no-match and conflict', () => {
    const noMatch = evaluateProfessionalAssessments(chart, profile({
      elementPreference: {
        enabled: true, method: 'decision-table-v1', ruleSetVersion: 'preference-no-match-v1',
        rules: [rule('miss-preference', 1, 'water', '喜水', [{ fact: 'balance.netScore', operator: 'lt', value: 0 }])],
      },
    }))
    const conflict = evaluateProfessionalAssessments(chart, profile({
      elementPreference: {
        enabled: true, method: 'decision-table-v1', ruleSetVersion: 'preference-conflict-v1',
        rules: [rule('fire', 10, 'fire', '喜火', []), rule('water', 10, 'water', '喜水', [])],
      },
    }))

    expect(noMatch.elementPreference).toMatchObject({ status: 'unresolved', reason: 'no-match' })
    expect(conflict.elementPreference).toMatchObject({ status: 'unresolved', reason: 'conflict' })
  })

  it('treats same-label top rules with different element directions as conflicting', () => {
    const addSupport = buildElementBalanceDirection('wood', 'add-support')
    const reduceSupport = buildElementBalanceDirection('wood', 'reduce-support')
    const conflict = evaluateProfessionalAssessments(chart, profile({
      elementPreference: {
        enabled: true,
        method: 'decision-table-v1',
        ruleSetVersion: 'preference-direction-conflict-v1',
        rules: [
          elementDirectionRule('add', 10, 'same-code', '同一文字结论', addSupport),
          elementDirectionRule('reduce', 10, 'same-code', '同一文字结论', reduceSupport),
        ],
      },
    }))

    expect(conflict.elementPreference).toMatchObject({
      status: 'unresolved',
      reason: 'conflict',
      provenance: { matchedRuleIds: ['add', 'reduce'] },
    })
    expect(conflict.elementPreference?.elementDirection).toBeUndefined()
  })

  it('keeps optional element preference pending for a legacy profile', () => {
    const current = profile({
      elementPreference: { enabled: true, method: 'decision-table-v1', ruleSetVersion: 'legacy-preference-v1', rules: [] },
    })
    const legacy = { ...current, definition: { ...current.definition, schemaVersion: undefined } }

    expect(evaluateProfessionalAssessments(chart, legacy).elementPreference).toMatchObject({
      status: 'pending-school-rule', reason: 'legacy-profile', ruleVersion: 'legacy-preference-v1',
    })
  })

  it('returns all shen-sha matches and de-duplicates them by stable output code', () => {
    const result = evaluateProfessionalAssessments(chart, profile({
      shenSha: {
        enabled: true,
        method: 'decision-table-v1',
        ruleSetVersion: 'multi-v1',
        rules: [
          rule('z-low', 1, 'code-one', 'Ignored duplicate label', []),
          rule('b-second', 10, 'code-two', 'Neutral two', []),
          rule('a-first', 10, 'code-one', 'Neutral one', []),
        ],
      },
    }))

    expect(result.shenSha).toMatchObject({
      status: 'derived',
      items: ['Neutral one', 'Neutral two'],
      provenance: {
        matchedRuleIds: ['a-first', 'b-second', 'z-low'],
        sourceVersionIds: ['source-a-first', 'source-b-second', 'source-z-low'],
      },
    })
  })

  it('distinguishes disabled, no-match and unsupported legacy profile states', () => {
    const current = profile({
      strength: { enabled: false, method: 'decision-table-v1', ruleSetVersion: 'disabled-v1', rules: [] },
      pattern: {
        enabled: true,
        method: 'decision-table-v1',
        ruleSetVersion: 'no-match-v1',
        rules: [rule('miss', 1, 'miss', 'Miss', [{ fact: 'dayMaster.stem', operator: 'equals', value: 'not-E' }])],
      },
    })
    const currentResult = evaluateProfessionalAssessments(chart, current)

    expect(currentResult.strength).toMatchObject({ status: 'pending-school-rule', reason: 'disabled', ruleVersion: 'disabled-v1' })
    expect(currentResult.pattern).toMatchObject({ status: 'unresolved', reason: 'no-match', ruleVersion: 'no-match-v1' })
    expect(currentResult.pattern.provenance?.matchedRuleIds).toEqual([])

    const legacy = profile()
    const legacyDefinition = { ...legacy.definition, schemaVersion: undefined }
    const legacyResult = evaluateProfessionalAssessments(chart, { ...legacy, definition: legacyDefinition })
    expect(legacyResult.strength).toMatchObject({ status: 'pending-school-rule', reason: 'legacy-profile' })
  })

  it('treats exists false as an explicit absence check and fails numeric comparisons on non-numbers', () => {
    const sparseChart: BaziChart = { ...chart, dayMaster: undefined, fiveElements: undefined }
    const result = evaluateProfessionalAssessments(sparseChart, profile({
      strength: {
        enabled: true,
        method: 'decision-table-v1',
        ruleSetVersion: 'absence-v1',
        rules: [rule('absence', 1, 'absence', 'Absent', [
          { fact: 'dayMaster.stem', operator: 'exists', value: false },
          { fact: 'fiveElements.counts.wood', operator: 'gt', value: 0 },
        ])],
      },
      pattern: {
        enabled: true,
        method: 'decision-table-v1',
        ruleSetVersion: 'absence-only-v1',
        rules: [rule('absence-only', 1, 'absence-only', 'Absent only', [
          { fact: 'dayMaster.stem', operator: 'exists', value: false },
        ])],
      },
    }))

    expect(result.strength.reason).toBe('no-match')
    expect(result.pattern.conclusion).toBe('Absent only')
  })
})
