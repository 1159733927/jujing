import { describe, expect, it } from 'vitest'
import { KnowledgeRepository } from '../src/knowledge.js'
import { demoKnowledgeAssets, seedDemoKnowledge, shouldSeedDemoKnowledge } from '../src/demo-knowledge.js'
import { evaluatePublishedRules } from '../src/rules.js'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('shouldSeedDemoKnowledge', () => {
  it('returns false when DEMO_SEED_KNOWLEDGE is not set', () => {
    expect(shouldSeedDemoKnowledge({ NODE_ENV: 'development' })).toBe(false)
  })

  it('returns false when DEMO_SEED_KNOWLEDGE is not true', () => {
    expect(shouldSeedDemoKnowledge({ NODE_ENV: 'development', DEMO_SEED_KNOWLEDGE: 'false' })).toBe(false)
  })

  it('returns true when DEMO_SEED_KNOWLEDGE is true outside production and test', () => {
    expect(shouldSeedDemoKnowledge({ NODE_ENV: 'development', DEMO_SEED_KNOWLEDGE: 'true' })).toBe(true)
  })

  it('returns false in production even when DEMO_SEED_KNOWLEDGE is true', () => {
    expect(shouldSeedDemoKnowledge({ NODE_ENV: 'production', DEMO_SEED_KNOWLEDGE: 'true' })).toBe(false)
  })

  it('returns false in test even when DEMO_SEED_KNOWLEDGE is true', () => {
    expect(shouldSeedDemoKnowledge({ NODE_ENV: 'test', DEMO_SEED_KNOWLEDGE: 'true' })).toBe(false)
  })
})

describe('demo knowledge seed content', () => {
  it('includes a published-source article and structured rule for near-center bathroom compatibility conflicts', () => {
    expect(demoKnowledgeAssets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'article',
        title: '中宫与卫生间位置复核资料',
        tags: expect.arrayContaining(['中宫', '卫生间', '人宅合参']),
        body: expect.stringContaining('靠近中宫'),
      }),
      expect.objectContaining({
        kind: 'rule',
        title: '近中宫卫生间与土性稳定需求冲突提示',
        rule: expect.objectContaining({
          priority: 140,
          conditions: expect.arrayContaining([
            { fact: 'bazi.dayMaster.element', operator: 'equals', value: 'earth' },
            { fact: 'vision.factCodes', operator: 'contains-any', value: ['bathroom.near-center'] },
          ]),
          conclusions: [expect.objectContaining({
            code: 'earth-daymaster-center-bathroom-conflict',
            level: 'attention',
            text: expect.stringContaining('冲突点'),
          })],
        }),
      }),
    ]))
  })

  it('includes executable demo rules for south-kitchen support and through-line conflicts', () => {
    expect(demoKnowledgeAssets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'article',
        title: '南侧厨房与火土关系复核资料',
        tags: expect.arrayContaining(['厨房', '火土', '人宅合参']),
      }),
      expect.objectContaining({
        kind: 'rule',
        title: '南侧厨房与土日主火土合参提示',
        rule: expect.objectContaining({
          conditions: expect.arrayContaining([
            { fact: 'bazi.dayMaster.element', operator: 'equals', value: 'earth' },
            { fact: 'vision.factCodes', operator: 'contains-any', value: ['kitchen.south'] },
          ]),
          conclusions: [expect.objectContaining({ code: 'earth-daymaster-south-kitchen-support', level: 'info' })],
        }),
      }),
      expect.objectContaining({
        kind: 'article',
        title: '入户穿堂动线复核资料',
        tags: expect.arrayContaining(['入户', '穿堂', '阳台']),
      }),
      expect.objectContaining({
        kind: 'rule',
        title: '入户阳台穿堂动线冲突提示',
        rule: expect.objectContaining({
          conditions: expect.arrayContaining([
            { fact: 'bazi.dayMaster.element', operator: 'exists', value: true },
            { fact: 'vision.factCodes', operator: 'contains-any', value: ['circulation.entry-balcony-aligned'] },
          ]),
          conclusions: [expect.objectContaining({ code: 'entry-balcony-through-line-conflict', level: 'attention' })],
        }),
      }),
    ]))
  })

  it('publishes the center-bathroom demo rule and makes it executable by the report pipeline', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-demo-knowledge-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))

    const seed = await seedDemoKnowledge(repository, 'demo-editor', 'demo-reviewer')
    const searchHits = await repository.search('中宫卫生间')
    const [match] = evaluatePublishedRules(await repository.publishedRules(), {
      bazi: {
        ruleVersion: 'test',
        correctedLocalTime: '1992-08-21T12:03:00+08:00',
        correctionMinutes: 0,
        pillars: ['丁丑', '癸卯', '戊午', '庚申'],
        dayMaster: { stem: '戊', element: 'earth', yinYang: 'yang' },
        fiveElements: { method: 'visible-stems-and-branches-v1', counts: { wood: 1, fire: 2, earth: 2, metal: 2, water: 1 } },
      },
      residence: { facing: 'south', layoutNote: '上北下南，卫生间靠近户型中心偏西南。' },
      vision: [{
        fileId: 'plan-1',
        room: 'overview',
        summary: '户型图显示卫生间靠近中心区域。',
        observedElements: ['近中宫卫生间'],
        uncertainties: [],
        facts: [{ code: 'bathroom.near-center', confidence: 0.88, evidence: '户型图显示卫生间靠近中心区域。', scope: 'floor-plan-topology', source: 'vision-model' }],
      }],
    })

    expect(seed.created).toBeGreaterThan(0)
    expect(searchHits.map((hit) => hit.title)).toContain('中宫与卫生间位置复核资料')
    expect(match).toMatchObject({
      title: '近中宫卫生间与土性稳定需求冲突提示',
      conclusions: [expect.objectContaining({ level: 'attention', text: expect.stringContaining('近中宫水厕位置') })],
    })
  })

  it('revises stale published demo assets so local knowledge follows current executable facts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-demo-knowledge-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const current = demoKnowledgeAssets.find((asset) => asset.title === '近中宫卫生间与土性稳定需求冲突提示')!
    const stale = {
      ...current,
      body: `${current.body}\n旧版规则：仅按文字观察匹配。`,
      rule: {
        ...current.rule!,
        conditions: [
          { fact: 'bazi.dayMaster.element' as const, operator: 'equals' as const, value: 'earth' },
          { fact: 'vision.observedElements' as const, operator: 'contains-any' as const, value: ['近中宫卫生间'] },
        ],
      },
    }
    let asset = await repository.create(stale, 'demo-editor')
    asset = (await repository.setState(asset.id, 'in-review', 'demo-editor'))!
    asset = (await repository.setState(asset.id, 'published', 'demo-reviewer'))!

    const seed = await seedDemoKnowledge(repository, 'demo-editor', 'demo-reviewer')
    const [active] = (await repository.publishedRules()).filter((rule) => rule.title === current.title)

    expect(asset.version).toBe(1)
    expect(seed.revised).toBeGreaterThan(0)
    expect(active.version).toBe(2)
    expect(active.rule?.conditions).toEqual(expect.arrayContaining([
      { fact: 'vision.factCodes', operator: 'contains-any', value: ['bathroom.near-center'] },
    ]))
  })

  it('publishes and executes kitchen support plus through-line conflict demo rules', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-demo-knowledge-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))

    await seedDemoKnowledge(repository, 'demo-editor', 'demo-reviewer')
    const kitchenHits = await repository.search('南侧厨房 火土')
    const throughLineHits = await repository.search('入户 穿堂 阳台')
    const matches = evaluatePublishedRules(await repository.publishedRules(), {
      bazi: {
        ruleVersion: 'test',
        correctedLocalTime: '1992-08-21T12:03:00+08:00',
        correctionMinutes: 0,
        pillars: ['丁丑', '癸卯', '戊午', '庚申'],
        dayMaster: { stem: '戊', element: 'earth', yinYang: 'yang' },
        fiveElements: { method: 'visible-stems-and-branches-v1', counts: { wood: 1, fire: 2, earth: 2, metal: 2, water: 1 } },
      },
      residence: { facing: 'south', layoutNote: '上北下南，厨房在南侧，入户到阳台形成穿堂动线。' },
      vision: [{
        fileId: 'plan-1',
        room: 'overview',
        summary: '户型图显示南侧厨房，并可见入户阳台穿堂动线。',
        observedElements: ['南侧厨房', '穿堂动线'],
        uncertainties: [],
        facts: [
          { code: 'kitchen.south', confidence: 0.91, evidence: '户型图显示厨房在南侧。', scope: 'floor-plan-topology', source: 'vision-model' },
          { code: 'circulation.entry-balcony-aligned', confidence: 0.84, evidence: '户型图显示入户到阳台存在直线贯通。', scope: 'floor-plan-topology', source: 'vision-model' },
        ],
      }],
    })

    expect(kitchenHits.map((hit) => hit.title)).toContain('南侧厨房与火土关系复核资料')
    expect(throughLineHits.map((hit) => hit.title)).toContain('入户穿堂动线复核资料')
    expect(matches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: '南侧厨房与土日主火土合参提示',
        conclusions: [expect.objectContaining({ level: 'info', text: expect.stringContaining('火土关系') })],
      }),
      expect.objectContaining({
        title: '入户阳台穿堂动线冲突提示',
        conclusions: [expect.objectContaining({ level: 'attention', text: expect.stringContaining('穿堂动线') })],
      }),
    ]))
  })

  it('does not execute key demo rules from legacy observed text alone', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-demo-knowledge-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))

    await seedDemoKnowledge(repository, 'demo-editor', 'demo-reviewer')
    const matches = evaluatePublishedRules(await repository.publishedRules(), {
      bazi: {
        ruleVersion: 'test',
        correctedLocalTime: '1992-08-21T12:03:00+08:00',
        correctionMinutes: 0,
        pillars: ['丁丑', '癸卯', '戊午', '庚申'],
        dayMaster: { stem: '戊', element: 'earth', yinYang: 'yang' },
        fiveElements: { method: 'visible-stems-and-branches-v1', counts: { wood: 1, fire: 2, earth: 2, metal: 2, water: 1 } },
      },
      residence: { facing: 'south', layoutNote: '上北下南，厨房在南侧，卫生间靠近户型中心偏西南，入户到阳台形成穿堂动线。' },
      vision: [{
        fileId: 'plan-1',
        room: 'overview',
        summary: '户型图显示南侧厨房、近中宫卫生间和穿堂动线。',
        observedElements: ['南侧厨房', '近中宫卫生间', '穿堂动线'],
        uncertainties: [],
      }],
    })

    expect(matches.map((match) => match.title)).not.toEqual(expect.arrayContaining([
      '近中宫卫生间与土性稳定需求冲突提示',
      '南侧厨房与土日主火土合参提示',
      '入户阳台穿堂动线冲突提示',
    ]))
  })
})
