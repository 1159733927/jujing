import { describe, expect, it } from 'vitest'
import type { BaziChart } from '@fengshui/domain'
import type { PublishedKnowledgeVersion } from '@fengshui/knowledge-contracts'
import { buildPersonHouseCompatibilityAssessment, evaluatePublishedRules } from '../src/rules.js'

const baseBazi: BaziChart = {
  ruleVersion: 'bazi-test-v1',
  correctedLocalTime: '1992-08-21T12:03:00+08:00',
  correctionMinutes: 0,
  pillars: ['丁丑', '癸卯', '戊午', '庚申'],
  dayMaster: { stem: '戊', element: 'earth', yinYang: 'yang' },
  fiveElements: {
    method: 'visible-stems-and-branches-v1',
    counts: { wood: 1, fire: 2, earth: 2, metal: 2, water: 1 },
  },
  assessments: {
    strength: { status: 'derived', conclusion: '扶助力量偏少', ruleVersion: 'baseline-v1' },
    pattern: { status: 'pending-school-rule', reason: 'disabled', ruleVersion: 'pattern-v1' },
    elementPreference: {
      status: 'derived',
      conclusion: '候选补益方向为同类与印星五行',
      ruleVersion: 'baseline-v1',
      elementDirection: {
        scope: 'support-balance-baseline',
        direction: 'add-support',
        candidateElements: ['earth', 'fire'],
        cautiousElements: ['metal', 'water', 'wood'],
        limitations: ['仅为扶抑基线候选方向', '不等同于完整喜用神'],
      },
    },
    shenSha: { status: 'pending-school-rule', reason: 'disabled', ruleVersion: 'shensha-v1', items: [] },
  },
}

function publishedRule(overrides: Partial<PublishedKnowledgeVersion>): PublishedKnowledgeVersion {
  return {
    assetId: 'rule-person-house',
    version: 1,
    versionId: 'rule-person-house:v1:0123456789abcdef',
    contentHash: '0'.repeat(64),
    kind: 'rule',
    title: '土日主南向客厅合拍规则',
    tags: ['人宅合拍'],
    body: '测试规则',
    sourceLabel: '专家规则库',
    exactExcerpt: '测试规则',
    publishedAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('person-house compatibility rules', () => {
  it('uses effect instead of presentation level and carries source provenance', () => {
    const source = publishedRule({
      assetId: 'book-source',
      versionId: 'book-source:v1:0123456789abcdef',
      kind: 'article',
      title: '专家原典',
      sourceLabel: '《专家原典》第三章',
      exactExcerpt: '南方属火，可与命盘调衡方向合参。',
    })
    const [match] = evaluatePublishedRules([source, publishedRule({
      rule: {
        priority: 90,
        sourceVersionIds: [source.versionId],
        conflictGroup: 'overall-facing',
        conditions: [{ fact: 'residence.facing', operator: 'equals', value: 'south' }],
        conclusions: [{ code: 'support-by-effect', text: '该条件形成支持点。', level: 'attention', effect: 'supportive' }],
      },
    })], { bazi: baseBazi, residence: { facing: 'south' }, vision: [] })

    expect(match).toMatchObject({
      sourceVersionIds: [source.versionId],
      sourceLabels: ['《专家原典》第三章'],
      sourceExcerpts: ['南方属火，可与命盘调衡方向合参。'],
      conflictGroup: 'overall-facing',
    })
    const assessment = buildPersonHouseCompatibilityAssessment({
      bazi: baseBazi, residence: { facing: 'south' }, vision: [], evaluatedRules: match ? [match] : [],
    })
    expect(assessment).toMatchObject({
      overallLevel: 'supportive',
      positiveMatches: [expect.objectContaining({ effect: 'supportive', level: 'attention', sourceLabel: '《专家原典》第三章' })],
      conflicts: [],
    })
  })

  it('keeps v1 level classification when effect is absent', () => {
    const assessment = buildPersonHouseCompatibilityAssessment({
      bazi: baseBazi,
      residence: { facing: 'south' },
      vision: [],
      evaluatedRules: [
        { assetId: 'legacy-info', version: 1, versionId: 'legacy-info:v1', contentHash: 'a'.repeat(64), title: '旧支持规则', priority: 20, conclusions: [{ code: 'old-info', text: '旧规则支持点。', level: 'info' }] },
        { assetId: 'legacy-attention', version: 1, versionId: 'legacy-attention:v1', contentHash: 'b'.repeat(64), title: '旧冲突规则', priority: 20, conclusions: [{ code: 'old-attention', text: '旧规则冲突点。', level: 'attention' }] },
      ],
    })
    expect(assessment.overallLevel).toBe('mixed')
    expect(assessment.positiveMatches[0]?.conclusion).toBe('旧规则支持点。')
    expect(assessment.conflicts[0]?.conclusion).toBe('旧规则冲突点。')
  })

  it('routes neutral and needs-confirmation effects to neutralOrUnknown', () => {
    const assessment = buildPersonHouseCompatibilityAssessment({
      bazi: baseBazi,
      residence: { facing: 'south' },
      vision: [],
      evaluatedRules: [{
        assetId: 'uncertain-rule', version: 1, versionId: 'uncertain-rule:v1', contentHash: 'c'.repeat(64), title: '待核验规则', priority: 80,
        conclusions: [
          { code: 'neutral', text: '该事实本身不构成合拍或冲突。', level: 'info', effect: 'neutral' },
          { code: 'confirm', text: '需要确认入户门精确方位。', level: 'attention', effect: 'needs-confirmation' },
        ],
      }],
    })
    expect(assessment).toMatchObject({
      assessable: false,
      overallLevel: 'insufficient-evidence',
      positiveMatches: [],
      conflicts: [],
      neutralOrUnknown: expect.arrayContaining(['该事实本身不构成合拍或冲突。', '待确认：需要确认入户门精确方位。']),
    })
  })

  it('keeps only the highest priority in a conflict group and withholds tied opposite effects', () => {
    const versions = [
      publishedRule({ assetId: 'low', versionId: 'low:v1', title: '低优先级', rule: { priority: 50, conflictGroup: 'facing', conditions: [{ fact: 'residence.facing', operator: 'equals', value: 'south' }], conclusions: [{ code: 'low', text: '低优先级冲突。', level: 'attention', effect: 'conflict' }] } }),
      publishedRule({ assetId: 'top-support', versionId: 'top-support:v1', title: '高优先级支持', rule: { priority: 90, conflictGroup: 'facing', conditions: [{ fact: 'residence.facing', operator: 'equals', value: 'south' }], conclusions: [{ code: 'top-support', text: '高优先级支持。', level: 'info', effect: 'supportive' }] } }),
      publishedRule({ assetId: 'top-conflict', versionId: 'top-conflict:v1', title: '高优先级冲突', rule: { priority: 90, conflictGroup: 'facing', conditions: [{ fact: 'residence.facing', operator: 'equals', value: 'south' }], conclusions: [{ code: 'top-conflict', text: '高优先级冲突。', level: 'attention', effect: 'conflict' }] } }),
    ]
    const evaluatedRules = evaluatePublishedRules(versions, { bazi: baseBazi, residence: { facing: 'south' }, vision: [] })
    expect(evaluatedRules.map((rule) => rule.assetId)).toEqual(['top-conflict', 'top-support'])

    const assessment = buildPersonHouseCompatibilityAssessment({ bazi: baseBazi, residence: { facing: 'south' }, vision: [], evaluatedRules })
    expect(assessment).toMatchObject({ assessable: false, overallLevel: 'insufficient-evidence', positiveMatches: [], conflicts: [] })
    expect(assessment.neutralOrUnknown).toEqual(expect.arrayContaining([expect.stringContaining('规则组“facing”存在同优先级的相反结论')]))
  })

  it('matches a rule that requires both day-master element and residence facing', () => {
    const [match] = evaluatePublishedRules([publishedRule({
      rule: {
        priority: 90,
        conditions: [
          { fact: 'bazi.dayMaster.element', operator: 'equals', value: 'earth' },
          { fact: 'residence.facing', operator: 'equals', value: 'south' },
        ],
        conclusions: [{ code: 'earth-south-support', text: '土日主与南向火气形成相生条件。', level: 'info' }],
      },
    })], {
      bazi: baseBazi,
      residence: { facing: 'south' },
      vision: [],
    })

    expect(match).toMatchObject({
      title: '土日主南向客厅合拍规则',
      conclusions: [{ code: 'earth-south-support', level: 'info' }],
    })
  })

  it('matches a rule that compares numeric five-element counts', () => {
    const [match] = evaluatePublishedRules([publishedRule({
      rule: {
        priority: 70,
        conditions: [{ fact: 'bazi.fiveElements.counts.fire', operator: 'gte', value: 2 }],
        conclusions: [{ code: 'fire-enough', text: '命盘火元素达到本规则阈值。', level: 'info' }],
      },
    })], {
      bazi: baseBazi,
      residence: { facing: 'east' },
      vision: [],
    })

    expect(match?.conclusions[0]?.code).toBe('fire-enough')
  })

  it('matches compatibility rules against governed element-preference candidates', () => {
    const [match] = evaluatePublishedRules([publishedRule({
      title: '候选火土与南向采光合参规则',
      rule: {
        priority: 95,
        conditions: [
          { fact: 'bazi.assessments.elementPreference.direction', operator: 'equals', value: 'add-support' },
          { fact: 'bazi.assessments.elementPreference.candidateElements', operator: 'contains-any', value: ['fire'] },
          { fact: 'residence.facing', operator: 'equals', value: 'south' },
          { fact: 'vision.observedElements', operator: 'contains-any', value: ['自然采光'] },
        ],
        conclusions: [{ code: 'candidate-support-south-daylight', text: '命盘候选补益方向与南向采光存在可合参支持点。', level: 'info' }],
      },
    })], {
      bazi: baseBazi,
      residence: { facing: 'south' },
      vision: [{ fileId: 'photo', room: 'living-room', summary: '客厅自然采光', observedElements: ['自然采光'], uncertainties: [] }],
    })

    expect(match).toMatchObject({
      title: '候选火土与南向采光合参规则',
      conclusions: [{ code: 'candidate-support-south-daylight', level: 'info' }],
    })
  })

  it('keeps unknown residence orientation local to orientation-dependent conclusions', () => {
    const assessment = buildPersonHouseCompatibilityAssessment({
      bazi: baseBazi,
      residence: { facing: 'unknown' },
      vision: [{
        fileId: 'plan',
        room: 'overview',
        summary: '户型图显示南侧厨房。',
        observedElements: ['南侧厨房'],
        uncertainties: [],
        facts: [{ code: 'kitchen.south', confidence: 0.9, evidence: '厨房在南侧。', scope: 'floor-plan-topology', source: 'program-nine-grid' }],
      }],
      evaluatedRules: [{
        assetId: 'rule-kitchen',
        version: 1,
        versionId: 'rule-kitchen:v1:abc',
        contentHash: 'c'.repeat(64),
        title: '南侧厨房规则',
        priority: 80,
        conclusions: [{ code: 'kitchen', text: '南侧厨房与命盘存在局部合参条件。', level: 'info' }],
      }],
    })

    expect(assessment).toMatchObject({
      assessable: true,
      overallLevel: 'supportive',
      neutralOrUnknown: ['住宅整体朝向未确认；本次只评估不依赖整体朝向的局部格局事实。'],
      positiveMatches: [expect.objectContaining({ conclusion: '南侧厨房与命盘存在局部合参条件。' })],
    })
  })

  it('falls back to an assessable baseline with concrete actions when governed facts exist but no expert rule matches', () => {
    const assessment = buildPersonHouseCompatibilityAssessment({
      bazi: baseBazi,
      residence: { facing: 'south', layoutNote: '上北下南，厨房在南侧，卫生间靠近中心。' },
      vision: [{
        fileId: 'plan',
        room: 'overview',
        summary: '户型图显示南侧厨房、卫生间接近中宫，入户到阳台动线偏直。',
        observedElements: ['南侧厨房', '卫生间接近中宫', '入户与阳台近直线'],
        uncertainties: [],
        facts: [
          { code: 'kitchen.south', confidence: 0.9, evidence: '厨房在南侧。', scope: 'floor-plan-topology', source: 'program-nine-grid' },
          { code: 'bathroom.near-center', confidence: 0.86, evidence: '卫生间接近中心。', scope: 'floor-plan-topology', source: 'program-nine-grid' },
          { code: 'circulation.entry-balcony-aligned', confidence: 0.82, evidence: '入户与阳台动线偏直。', scope: 'floor-plan-topology', source: 'program-nine-grid' },
        ],
      }],
      evaluatedRules: [],
    })

    expect(assessment).toMatchObject({
      assessable: true,
      overallLevel: 'mixed',
      confidence: 'low',
      positiveMatches: [
        expect.objectContaining({
          conclusion: expect.stringContaining('火性方向形成局部呼应'),
          sourceLabel: '程序合参基线',
          actions: [expect.objectContaining({ kind: 'amplify', location: '朝南格局与南侧厨房' })],
        }),
      ],
      conflicts: expect.arrayContaining([
        expect.objectContaining({
          conclusion: expect.stringContaining('卫生间靠近住宅中心'),
          actions: [expect.objectContaining({ kind: 'mitigate', location: '靠近中宫的卫生间' })],
        }),
        expect.objectContaining({
          conclusion: expect.stringContaining('入户到阳台的动线接近直线'),
          actions: [expect.objectContaining({ kind: 'mitigate', location: '入户门到阳台之间的直线动线' })],
        }),
      ]),
      criticalMissingFacts: [],
    })
    expect(assessment.neutralOrUnknown).toEqual(expect.arrayContaining(['没有已发布专家规则直接命中；本次采用程序合参基线给出低风险初判。']))
  })

  it('classifies attention-level rules as conflicts and info-level rules as positive matches', () => {
    const assessment = buildPersonHouseCompatibilityAssessment({
      bazi: baseBazi,
      residence: { facing: 'south' },
      vision: [],
      evaluatedRules: [
        {
          assetId: 'support-rule',
          version: 1,
          versionId: 'support-rule:v1:abc',
          contentHash: 'a'.repeat(64),
          title: '支持规则',
          priority: 80,
          conclusions: [{ code: 'support', text: '命盘与住宅存在相生条件。', level: 'info' }],
        },
        {
          assetId: 'conflict-rule',
          version: 1,
          versionId: 'conflict-rule:v1:def',
          contentHash: 'b'.repeat(64),
          title: '冲突规则',
          priority: 90,
          conclusions: [{ code: 'conflict', text: '卧室方位与命盘偏好存在冲突。', level: 'attention' }],
        },
      ],
    })

    expect(assessment).toMatchObject({
      assessable: true,
      overallLevel: 'mixed',
      positiveMatches: [{ conclusion: '命盘与住宅存在相生条件。' }],
      conflicts: [{ conclusion: '卧室方位与命盘偏好存在冲突。' }],
    })
  })
})
