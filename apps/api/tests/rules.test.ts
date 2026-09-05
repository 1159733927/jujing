import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KnowledgeRepository } from '../src/knowledge.js'
import { buildPersonHouseCompatibilityAssessment, evaluatePublishedRules } from '../src/rules.js'

const facts = {
  bazi: { ruleVersion: 'test', correctedLocalTime: '2020-01-01T10:00:00+08:00', correctionMinutes: 0, pillars: ['甲子', '乙丑', '丙寅', '丁卯'] as const },
  residence: { facing: 'south' as const, layoutNote: '客厅连接阳台' },
  vision: [{ fileId: 'photo', room: 'living-room' as const, summary: '客厅有自然采光', observedElements: ['自然采光', '通道整洁'], uncertainties: [] }],
}

describe('deterministic published rule evaluation', () => {
  it('matches structured facts and retains the immutable rule version reference', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-rules-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const draft = await repository.create({
      kind: 'rule', title: '朝南客厅采光', tags: ['客厅'], body: '当住宅朝南且画面可见自然采光时，给出保持采光的文化型建议。', sourceLabel: '规则专家',
      rule: {
        priority: 80,
        conditions: [
          { fact: 'residence.facing', operator: 'equals', value: 'south' },
          { fact: 'vision.observedElements', operator: 'contains-any', value: ['自然采光'] },
        ],
        conclusions: [{ code: 'preserve-daylight', text: '保持现有自然采光条件。', level: 'info' }],
      },
    })
    await repository.setState(draft.id, 'in-review', 'rule-editor')
    await repository.setState(draft.id, 'published', 'rule-reviewer')
    const [publishedRule] = await repository.publishedRules()
    const [result] = evaluatePublishedRules(await repository.publishedRules(), facts)
    expect(result).toMatchObject({ assetId: draft.id, versionId: publishedRule?.versionId, contentHash: publishedRule?.contentHash, priority: 80 })
    expect(result?.conclusions[0]?.code).toBe('preserve-daylight')
  })

  it('returns no result when any required fact does not match', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-rules-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const draft = await repository.create({
      kind: 'rule', title: '北向规则', tags: [], body: '仅用于北向住宅。', sourceLabel: '规则专家',
      rule: { priority: 10, conditions: [{ fact: 'residence.facing', operator: 'equals', value: 'north' }], conclusions: [{ code: 'north-only', text: '北向住宅建议。', level: 'info' }] },
    })
    await repository.setState(draft.id, 'in-review', 'rule-editor')
    await repository.setState(draft.id, 'published', 'rule-reviewer')
    expect(evaluatePublishedRules(await repository.publishedRules(), facts)).toEqual([])
  })

  it('attaches chart, residence and source evidence to deterministic compatibility points', () => {
    const compatibility = buildPersonHouseCompatibilityAssessment({
      ...facts,
      bazi: {
        ...facts.bazi,
        dayMaster: { stem: '丙', element: 'fire', yinYang: 'yang' },
        fiveElements: { counts: { wood: 2, fire: 2, earth: 1, metal: 1, water: 2 }, method: 'visible-stems-and-branches-v1' },
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
              candidateElements: ['fire', 'wood'],
              cautiousElements: ['earth', 'metal', 'water'],
              limitations: ['仅为扶抑基线候选方向', '不等同于完整喜用神'],
            },
          },
          shenSha: { status: 'pending-school-rule', reason: 'disabled', ruleVersion: 'shensha-v1', items: [] },
        },
      },
      evaluatedRules: [{
        assetId: 'rule-1',
        version: 1,
        versionId: 'rule-1:v1:hash',
        contentHash: 'a'.repeat(64),
        title: '朝南客厅采光',
        priority: 80,
        conclusions: [{ code: 'south', text: '住宅朝南可进入人宅合参。', level: 'info' }],
      }],
    })

    expect(compatibility.positiveMatches[0]).toMatchObject({
      chartEvidence: expect.stringMatching(/日主为丙，属火.*五行计数按显性天干和地支本气归类/u),
      residenceEvidence: expect.stringContaining('住宅整体朝向为南'),
      sourceLabel: '确定性规则',
      origin: 'deterministic-rule',
    })
  })

  it('keeps internal nine-grid algorithm tokens out of deterministic compatibility evidence', () => {
    const compatibility = buildPersonHouseCompatibilityAssessment({
      ...facts,
      bazi: {
        ...facts.bazi,
        dayMaster: { stem: '丙', element: 'fire', yinYang: 'yang' },
        fiveElements: { counts: { wood: 2, fire: 2, earth: 1, metal: 1, water: 2 }, method: 'visible-stems-and-branches-v1' },
      },
      vision: [{
        fileId: 'floorplan-nine-grid',
        room: 'overview',
        summary: '九宫格程序分析形成可复算户型事实。',
        observedElements: [
          '卫生间 is near the center sector by floorplan-nine-grid-v1.',
          '厨房 is placed in the south sector by floorplan-nine-grid-v1.',
        ],
        uncertainties: [],
        facts: [
          { code: 'bathroom.near-center', confidence: 0.9, evidence: '卫生间 is near the center sector by floorplan-nine-grid-v1.', scope: 'floor-plan-topology', source: 'program-nine-grid' },
          { code: 'kitchen.south', confidence: 0.92, evidence: '厨房 is placed in the south sector by floorplan-nine-grid-v1.', scope: 'floor-plan-topology', source: 'program-nine-grid' },
        ],
      }],
      evaluatedRules: [{
        assetId: 'rule-1',
        version: 1,
        versionId: 'rule-1:v1:hash',
        contentHash: 'a'.repeat(64),
        title: '朝南厨房规则',
        priority: 80,
        conclusions: [{ code: 'south-kitchen', text: '南侧厨房可进入人宅合参。', level: 'info' }],
      }],
    })

    const evidence = compatibility.positiveMatches[0]?.residenceEvidence
    expect(evidence).toContain('卫生间靠近住宅中宫')
    expect(evidence).toContain('厨房位于住宅南侧')
    expect(evidence?.match(/卫生间靠近住宅中宫/gu)).toHaveLength(1)
    expect(evidence?.match(/厨房位于住宅南侧/gu)).toHaveLength(1)
    expect(evidence).not.toContain('floorplan-nine-grid-v1')
    expect(evidence).not.toContain('is near the center sector')
  })

  it('matches governed element preference facts without treating them as useful gods', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-rules-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const draft = await repository.create({
      kind: 'rule', title: '候选火木与南向采光合参', tags: ['人宅合参'], body: '命盘候选补益方向与南向采光合参。', sourceLabel: '规则专家',
      rule: {
        priority: 100,
        conditions: [
          { fact: 'bazi.assessments.elementPreference.direction', operator: 'equals', value: 'add-support' },
          { fact: 'bazi.assessments.elementPreference.candidateElements', operator: 'contains-any', value: ['fire', 'wood'] },
          { fact: 'residence.facing', operator: 'equals', value: 'south' },
          { fact: 'vision.factCodes', operator: 'contains-any', value: ['daylight.visible'] },
        ],
        conclusions: [{ code: 'candidate-fire-wood-south-daylight', text: '候选五行与住宅南向采光存在可合参支持点，不等同于确定喜用神。', level: 'info' }],
      },
    })
    await repository.setState(draft.id, 'in-review', 'rule-editor')
    await repository.setState(draft.id, 'published', 'rule-reviewer')

    const [result] = evaluatePublishedRules(await repository.publishedRules(), {
      ...facts,
      bazi: {
        ...facts.bazi,
        dayMaster: { stem: '丙', element: 'fire', yinYang: 'yang' },
        fiveElements: { counts: { wood: 2, fire: 2, earth: 1, metal: 1, water: 2 }, method: 'visible-stems-and-branches-v1' },
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
              candidateElements: ['fire', 'wood'],
              cautiousElements: ['earth', 'metal', 'water'],
              limitations: ['仅为扶抑基线候选方向', '不等同于完整喜用神'],
            },
          },
          shenSha: { status: 'pending-school-rule', reason: 'disabled', ruleVersion: 'shensha-v1', items: [] },
        },
      },
      vision: [{
        ...facts.vision[0]!,
        facts: [{ code: 'daylight.visible', confidence: 0.9, evidence: '客厅窗面可见自然光。', scope: 'visible-detail', source: 'vision-model' }],
      }],
    })

    expect(result?.conclusions[0]?.text).toContain('不等同于确定喜用神')
  })

  it('requires governed vision fact codes instead of matching Chinese observed text for code rules', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-rules-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const draft = await repository.create({
      kind: 'rule', title: '受控采光码规则', tags: ['视觉规则'], body: '只由受控视觉事实码触发。', sourceLabel: '规则专家',
      rule: {
        priority: 100,
        conditions: [{ fact: 'vision.factCodes', operator: 'contains-any', value: ['daylight.visible'] }],
        conclusions: [{ code: 'daylight-code-only', text: '受控视觉事实确认自然采光。', level: 'info' }],
      },
    })
    await repository.setState(draft.id, 'in-review', 'rule-editor')
    await repository.setState(draft.id, 'published', 'rule-reviewer')

    const matches = evaluatePublishedRules(await repository.publishedRules(), {
      ...facts,
      vision: [{
        ...facts.vision[0]!,
        observedElements: ['自然采光', 'daylight.visible'],
      }],
    })

    expect(matches).toEqual([])
  })

  it('does not expose missing or low-confidence vision fact codes to deterministic rules', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-rules-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const draft = await repository.create({
      kind: 'rule', title: '高置信中宫卫生间', tags: ['视觉规则'], body: '只有高置信受控事实才能触发。', sourceLabel: '规则专家',
      rule: {
        priority: 100,
        conditions: [{ fact: 'vision.factCodes', operator: 'contains-any', value: ['bathroom.near-center'] }],
        conclusions: [{ code: 'center-bathroom-code-only', text: '高置信事实确认近中宫卫生间。', level: 'attention' }],
      },
    })
    await repository.setState(draft.id, 'in-review', 'rule-editor')
    await repository.setState(draft.id, 'published', 'rule-reviewer')

    const publishedRules = await repository.publishedRules()
    const withoutFacts = evaluatePublishedRules(publishedRules, facts)
    const lowConfidence = evaluatePublishedRules(publishedRules, {
      ...facts,
      vision: [{
        ...facts.vision[0]!,
        facts: [{ code: 'bathroom.near-center', confidence: 0.69, evidence: '模型低置信标注。', scope: 'floor-plan-topology', source: 'vision-model' }],
      }],
    })
    const eligible = evaluatePublishedRules(publishedRules, {
      ...facts,
      vision: [{
        ...facts.vision[0]!,
        facts: [{ code: 'bathroom.near-center', confidence: 0.7, evidence: '模型达到规则阈值。', scope: 'floor-plan-topology', source: 'vision-model' }],
      }],
    })

    expect(withoutFacts).toEqual([])
    expect(lowConfidence).toEqual([])
    expect(eligible[0]?.conclusions[0]?.code).toBe('center-bathroom-code-only')
  })

  it('supports an explicit conflict when the facing element is in the cautious baseline direction', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-rules-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const draft = await repository.create({
      kind: 'rule', title: '南向火性冲突', tags: ['人宅合参'], body: '南向火性对需谨慎火的命盘形成冲突提示。', sourceLabel: '规则专家',
      rule: {
        priority: 100,
        conditions: [
          { fact: 'bazi.assessments.elementPreference.direction', operator: 'equals', value: 'reduce-support' },
          { fact: 'bazi.assessments.elementPreference.cautiousElements', operator: 'contains-any', value: ['fire'] },
          { fact: 'residence.facing', operator: 'equals', value: 'south' },
        ],
        conclusions: [{ code: 'cautious-fire-facing-south', text: '住宅南向属火，而命盘扶抑基线把火列入需谨慎方向，存在冲突点。', level: 'attention' }],
      },
    })
    await repository.setState(draft.id, 'in-review', 'rule-editor')
    await repository.setState(draft.id, 'published', 'rule-reviewer')

    const [result] = evaluatePublishedRules(await repository.publishedRules(), {
      ...facts,
      bazi: {
        ...facts.bazi,
        dayMaster: { stem: '丙', element: 'fire', yinYang: 'yang' },
        fiveElements: { counts: { wood: 1, fire: 4, earth: 1, metal: 1, water: 1 }, method: 'visible-stems-and-branches-v1' },
        assessments: {
          strength: { status: 'derived', conclusion: '扶助力量偏多', ruleVersion: 'baseline-v1' },
          pattern: { status: 'pending-school-rule', reason: 'disabled', ruleVersion: 'pattern-v1' },
          elementPreference: {
            status: 'derived',
            conclusion: '候选调衡方向为泄耗克制日主的五行',
            ruleVersion: 'baseline-v1',
            elementDirection: {
              scope: 'support-balance-baseline',
              direction: 'reduce-support',
              candidateElements: ['earth', 'metal', 'water'],
              cautiousElements: ['fire', 'wood'],
              limitations: ['仅为扶抑基线候选方向', '不等同于完整喜用神'],
            },
          },
          shenSha: { status: 'pending-school-rule', reason: 'disabled', ruleVersion: 'shensha-v1', items: [] },
        },
      },
    })

    const compatibility = buildPersonHouseCompatibilityAssessment({
      ...facts,
      bazi: {
        ...facts.bazi,
        dayMaster: { stem: '丙', element: 'fire', yinYang: 'yang' },
        fiveElements: { counts: { wood: 1, fire: 4, earth: 1, metal: 1, water: 1 }, method: 'visible-stems-and-branches-v1' },
        assessments: {
          strength: { status: 'derived', conclusion: '扶助力量偏多', ruleVersion: 'baseline-v1' },
          pattern: { status: 'pending-school-rule', reason: 'disabled', ruleVersion: 'pattern-v1' },
          elementPreference: {
            status: 'derived',
            conclusion: '候选调衡方向为泄耗克制日主的五行',
            ruleVersion: 'baseline-v1',
            elementDirection: {
              scope: 'support-balance-baseline',
              direction: 'reduce-support',
              candidateElements: ['earth', 'metal', 'water'],
              cautiousElements: ['fire', 'wood'],
              limitations: ['仅为扶抑基线候选方向', '不等同于完整喜用神'],
            },
          },
          shenSha: { status: 'pending-school-rule', reason: 'disabled', ruleVersion: 'shensha-v1', items: [] },
        },
      },
      evaluatedRules: result ? [result] : [],
    })

    expect(result?.conclusions[0]?.level).toBe('attention')
    expect(compatibility).toMatchObject({
      overallLevel: 'conflict',
      conflicts: [expect.objectContaining({ conclusion: expect.stringContaining('存在冲突点') })],
    })
  })
})
