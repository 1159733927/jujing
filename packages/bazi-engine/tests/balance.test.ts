import { describe, expect, it } from 'vitest'
import { calculateBazi, calculateBaziFromPillars, deriveBalanceFacts, deriveMonthCommandFacts, deriveSupportDimensionFacts } from '../src/index.js'

describe('seasonal support balance baseline', () => {
  const pillars = ['壬申', '戊申', '己巳', '庚午'] as const

  it('records every weighted contribution and stable aggregate', () => {
    const balance = deriveBalanceFacts(pillars)

    expect(balance).toMatchObject({
      method: 'seasonal-support-baseline-v1',
      supportScore: 5.1,
      oppositionScore: 7.1,
      netScore: -2,
      rootCount: 4,
      resourceCount: 2,
      monthCommandSupports: false,
    })
    expect(balance.contributions).toHaveLength(14)
    expect(balance.contributions).toContainEqual({
      source: 'month.hiddenStem.1', element: 'metal', weight: 2, side: 'opposition',
    })
    expect(balance.contributions.some(({ source }) => source === 'day.stem')).toBe(false)
    expect(balance.contributions.reduce((total, item) => total + item.weight, 0)).toBe(12.2)
  })

  it('handles a month command whose main and secondary qi do not support the day master', () => {
    const balance = deriveBalanceFacts(['甲子', '丁卯', '庚申', '丙子'])

    expect(balance.monthCommandSupports).toBe(false)
    expect(balance.rootCount).toBe(1)
    expect(balance.resourceCount).toBe(1)
    expect(Number.isFinite(balance.netScore)).toBe(true)
  })

  it('writes the same pillar-derived balance for dated and manual calculations', () => {
    const dated = calculateBazi({
      date: '1992-08-21', time: '12:03', locationName: '杭州', longitude: 120.13333,
      latitude: 30.26667, timezone: 'Asia/Shanghai', useTrueSolarTime: true, gender: 'male',
    })
    const manual = calculateBaziFromPillars({ inputMode: 'manual-four-pillars', pillars, gender: 'male' })

    expect(dated.pillars).toEqual(pillars)
    expect(dated.balance).toEqual(manual.balance)
  })
})

describe('objective month-command facts', () => {
  it.each([
    ['子', '癸'], ['丑', '己'], ['寅', '甲'], ['卯', '乙'], ['辰', '戊'], ['巳', '丙'],
    ['午', '丁'], ['未', '己'], ['申', '庚'], ['酉', '辛'], ['戌', '戊'], ['亥', '壬'],
  ] as const)('projects %s month main qi as %s', (branch, mainQiStem) => {
    const facts = deriveMonthCommandFacts(['甲子', `丙${branch}`, '庚申', '辛酉'])

    expect(facts.branch).toBe(branch)
    expect(facts.mainQiStem).toBe(mainQiStem)
    expect(facts.method).toBe('month-command-facts-v1')
  })

  it('records the main-qi ten god and every visible position without deciding a pattern', () => {
    const facts = deriveMonthCommandFacts(['庚子', '庚申', '丙寅', '庚午'])

    expect(facts).toEqual({
      method: 'month-command-facts-v1',
      branch: '申',
      mainQiStem: '庚',
      mainQiElement: 'metal',
      mainQiTenGod: '偏财',
      mainQiVisibleAt: ['year', 'month', 'hour'],
      supportsDayMasterBaseline: false,
    })
    expect(facts).not.toHaveProperty('pattern')
    expect(facts).not.toHaveProperty('usefulGod')
  })

  it('writes identical month-command facts for dated and manual calculations', () => {
    const dated = calculateBazi({
      date: '1992-08-21', time: '12:03', locationName: '杭州', longitude: 120.13333,
      latitude: 30.26667, timezone: 'Asia/Shanghai', useTrueSolarTime: true, gender: 'male',
    })
    const manual = calculateBaziFromPillars({
      inputMode: 'manual-four-pillars', pillars: ['壬申', '戊申', '己巳', '庚午'], gender: 'male',
    })

    expect(dated.monthCommand).toEqual(manual.monthCommand)
  })
})

describe('objective support-dimension facts', () => {
  it.each([
    ['甲', '丙寅'], ['乙', '丙寅'],
    ['丙', '戊巳'], ['丁', '戊巳'],
    ['戊', '庚辰'], ['己', '庚辰'],
    ['庚', '壬申'], ['辛', '壬申'],
    ['壬', '甲亥'], ['癸', '甲亥'],
  ] as const)('marks %s day master supported when the month command is the same element', (dayStem, monthPillar) => {
    const facts = deriveSupportDimensionFacts(['壬子', monthPillar, `${dayStem}子`, '癸亥'])

    expect(facts.monthCommandSupports).toBe(true)
  })

  it.each([
    ['甲', '丙子'], ['乙', '丙子'],
    ['丙', '戊寅'], ['丁', '戊寅'],
    ['戊', '庚巳'], ['己', '庚巳'],
    ['庚', '壬辰'], ['辛', '壬辰'],
    ['壬', '甲申'], ['癸', '甲申'],
  ] as const)('marks %s day master supported when the month command is its resource element', (dayStem, monthPillar) => {
    const facts = deriveSupportDimensionFacts(['壬子', monthPillar, `${dayStem}子`, '癸亥'])

    expect(facts.monthCommandSupports).toBe(true)
  })

  it('records month support, rooted branches and visible support without counting the day stem itself', () => {
    const facts = deriveSupportDimensionFacts(['丙寅', '甲午', '丙戌', '乙巳'])

    expect(facts).toEqual({
      method: 'support-dimensions-facts-v1',
      monthCommandSupports: true,
      rootedAt: ['year', 'month', 'day', 'hour'],
      visiblePeerAt: ['year'],
      visibleResourceAt: ['month', 'hour'],
    })
  })

  it('keeps an unsupported and rootless chart factual instead of converting it into a strength verdict', () => {
    const facts = deriveSupportDimensionFacts(['庚申', '庚申', '丙子', '戊辰'])

    expect(facts).toEqual({
      method: 'support-dimensions-facts-v1',
      monthCommandSupports: false,
      rootedAt: [],
      visiblePeerAt: [],
      visibleResourceAt: [],
    })
    expect(facts).not.toHaveProperty('strength')
    expect(facts).not.toHaveProperty('strong')
  })

  it('records multiple roots even when the day element is only in secondary hidden stems', () => {
    const facts = deriveSupportDimensionFacts(['甲寅', '乙亥', '戊辰', '丙戌'])

    expect(facts.rootedAt).toEqual(['year', 'day', 'hour'])
  })

  it('excludes the day stem from visible peer and resource positions', () => {
    const facts = deriveSupportDimensionFacts(['丁子', '甲申', '丙寅', '乙亥'])

    expect(facts.visiblePeerAt).toEqual(['year'])
    expect(facts.visibleResourceAt).toEqual(['month', 'hour'])
    expect(facts.visiblePeerAt).not.toContain('day')
    expect(facts.visibleResourceAt).not.toContain('day')
  })

  it('changes month support and roots when only the month branch changes', () => {
    const spring = deriveSupportDimensionFacts(['甲子', '丁卯', '庚申', '丙子'])
    const autumn = deriveSupportDimensionFacts(['甲子', '丁酉', '庚申', '丙子'])

    expect(spring.monthCommandSupports).toBe(false)
    expect(spring.rootedAt).toEqual(['day'])
    expect(autumn.monthCommandSupports).toBe(true)
    expect(autumn.rootedAt).toEqual(['month', 'day'])
  })

  it('writes identical support dimensions for dated and manual calculations', () => {
    const dated = calculateBazi({
      date: '1992-08-21', time: '12:03', locationName: '杭州', longitude: 120.13333,
      latitude: 30.26667, timezone: 'Asia/Shanghai', useTrueSolarTime: true, gender: 'male',
    })
    const manual = calculateBaziFromPillars({
      inputMode: 'manual-four-pillars', pillars: ['壬申', '戊申', '己巳', '庚午'], gender: 'male',
    })

    expect(dated.supportDimensions).toEqual(manual.supportDimensions)
  })
})
