import { describe, expect, it } from 'vitest'
import type { BirthInput } from '@fengshui/domain'
import { JieQi, Lunar, LunarUtil, Solar } from 'lunar-typescript'
import { calculateBazi, calculateBaziFlow } from '../src/index.js'

const SOLAR_TERM_YEAR = 2024
const SOLAR_TERM_NAMES = LunarUtil.JIE_QI_IN_USE.filter((name) => !/^[A-Z_]+$/.test(name)).slice(0, 24)
const BASE_INPUT: BirthInput = {
  date: '2024-01-01',
  time: '00:00',
  locationName: '北京市 北京市 东城区',
  longitude: 116.4164,
  latitude: 39.9286,
  timezone: 'Asia/Shanghai',
  useTrueSolarTime: false,
}

function solarTermCases() {
  const lunar = Lunar.fromYmd(SOLAR_TERM_YEAR, 1, 1)
  const table = lunar.getJieQiTable()
  return SOLAR_TERM_NAMES.map((name) => {
    const solar = table[name]
    if (!solar) throw new Error(`missing solar term ${name}`)
    const jieQi = new JieQi(name, solar)
    return {
      name,
      solar,
      isJie: jieQi.isJie(),
      isLiChun: name === '立春',
    }
  })
}

function toEpochMillis(solar: Solar) {
  return Date.UTC(
    solar.getYear(),
    solar.getMonth() - 1,
    solar.getDay(),
    solar.getHour(),
    solar.getMinute(),
    solar.getSecond(),
  )
}

function toSolar(date: Date) {
  return Solar.fromYmdHms(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  )
}

function toBirthInput(date: Date): BirthInput {
  return {
    ...BASE_INPUT,
    date: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`,
    time: `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`,
  }
}

function firstRepresentableMinuteOnOrAfter(solar: Solar) {
  const epoch = toEpochMillis(solar)
  return new Date(solar.getSecond() === 0 ? epoch : epoch + (60 - solar.getSecond()) * 1000)
}

function oneMinuteBefore(solar: Solar) {
  return new Date(toEpochMillis(solar) - 60_000)
}

function oneMinuteAfter(solar: Solar) {
  return new Date(toEpochMillis(solar) + 60_000)
}

function offsetFromTerm(solar: Solar, milliseconds: number) {
  return new Date(toEpochMillis(solar) + milliseconds)
}

function expectedPillars(date: Date): readonly [string, string, string, string] {
  const eightChar = toSolar(date).getLunar().getEightChar()
  eightChar.setSect(2)
  return [eightChar.getYear(), eightChar.getMonth(), eightChar.getDay(), eightChar.getTime()]
}

function chartAt(date: Date) {
  return calculateBazi(toBirthInput(date))
}

const TERMS = solarTermCases()
const MINUTE_CASES = TERMS.flatMap((term) => [
  { label: 'before', term, date: oneMinuteBefore(term.solar) },
  { label: 'exact-minute', term, date: firstRepresentableMinuteOnOrAfter(term.solar) },
  { label: 'after', term, date: oneMinuteAfter(term.solar) },
])
const JIE_TERMS = TERMS.filter((term) => term.isJie)
const QI_TERMS = TERMS.filter((term) => !term.isJie)
const SECOND_OFFSETS = [
  { label: 'one-hour-before', milliseconds: -3_600_000 },
  { label: 'one-second-before', milliseconds: -1_000 },
  { label: 'exact-second', milliseconds: 0 },
  { label: 'one-second-after', milliseconds: 1_000 },
  { label: 'one-hour-after', milliseconds: 3_600_000 },
] as const
const KEY_SECOND_GOLDENS = [
  {
    name: '立春',
    pillars: [
      ['癸卯', '乙丑', '戊戌', '庚申'],
      ['癸卯', '乙丑', '戊戌', '庚申'],
      ['甲辰', '丙寅', '戊戌', '庚申'],
      ['甲辰', '丙寅', '戊戌', '庚申'],
      ['甲辰', '丙寅', '戊戌', '辛酉'],
    ],
  },
  {
    name: '惊蛰',
    pillars: [
      ['甲辰', '丙寅', '戊辰', '丁巳'],
      ['甲辰', '丙寅', '戊辰', '丁巳'],
      ['甲辰', '丁卯', '戊辰', '丁巳'],
      ['甲辰', '丁卯', '戊辰', '丁巳'],
      ['甲辰', '丁卯', '戊辰', '戊午'],
    ],
  },
  {
    name: '冬至',
    pillars: [
      ['癸卯', '甲子', '甲寅', '己巳'],
      ['癸卯', '甲子', '甲寅', '庚午'],
      ['癸卯', '甲子', '甲寅', '庚午'],
      ['癸卯', '甲子', '甲寅', '庚午'],
      ['癸卯', '甲子', '甲寅', '庚午'],
    ],
  },
] as const

describe('solar term boundary matrix', () => {
  it('covers the 24 traditional solar terms once', () => {
    expect(SOLAR_TERM_NAMES).toHaveLength(24)
    expect(new Set(SOLAR_TERM_NAMES).size).toBe(24)
  })

  it.each(TERMS)('exposes an exact public solar-term instant for $name', ({ name, solar }) => {
    expect(solar.toYmdHms()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(solar.getLunar().getCurrentJieQi()?.getName()).toBe(name)
  })

  it.each(MINUTE_CASES)('matches public EightChar pillars at $label minute around $term.name', ({ date }) => {
    expect(chartAt(date).pillars).toEqual(expectedPillars(date))
  })

  it.each(KEY_SECOND_GOLDENS)('pins the five-point second matrix around $name', ({ name, pillars }) => {
    const term = TERMS.find((candidate) => candidate.name === name)
    expect(term).toBeDefined()
    const actual = SECOND_OFFSETS.map(({ milliseconds }) => expectedPillars(offsetFromTerm(term!.solar, milliseconds)))
    expect(actual).toEqual(pillars)
  })

  it.each(TERMS)('matches product pillars one hour before and after $name', ({ solar }) => {
    const before = offsetFromTerm(solar, -3_600_000)
    const after = offsetFromTerm(solar, 3_600_000)
    expect(chartAt(before).pillars).toEqual(expectedPillars(before))
    expect(chartAt(after).pillars).toEqual(expectedPillars(after))
  })

  it.each(JIE_TERMS)('changes the month pillar at the $name jie boundary', ({ solar }) => {
    const before = chartAt(oneMinuteBefore(solar))
    const exactMinute = chartAt(firstRepresentableMinuteOnOrAfter(solar))
    expect(exactMinute.pillars[1]).not.toBe(before.pillars[1])
  })

  it.each(QI_TERMS)('keeps the month pillar stable at the $name qi boundary', ({ solar }) => {
    const before = chartAt(oneMinuteBefore(solar))
    const exactMinute = chartAt(firstRepresentableMinuteOnOrAfter(solar))
    expect(exactMinute.pillars[1]).toBe(before.pillars[1])
  })

  it.each(JIE_TERMS)('changes the public month pillar at the exact $name second', ({ solar }) => {
    const before = expectedPillars(offsetFromTerm(solar, -1_000))
    const exact = expectedPillars(offsetFromTerm(solar, 0))
    const after = expectedPillars(offsetFromTerm(solar, 1_000))
    expect(exact[1]).not.toBe(before[1])
    expect(after[1]).toBe(exact[1])
  })

  it.each(QI_TERMS)('keeps the public month pillar stable through the exact $name second', ({ solar }) => {
    const before = expectedPillars(offsetFromTerm(solar, -1_000))
    const exact = expectedPillars(offsetFromTerm(solar, 0))
    const after = expectedPillars(offsetFromTerm(solar, 1_000))
    expect(exact[1]).toBe(before[1])
    expect(after[1]).toBe(exact[1])
  })

  it('changes the year pillar at Li Chun', () => {
    const liChun = TERMS.find((term) => term.isLiChun)
    expect(liChun).toBeDefined()
    const before = chartAt(oneMinuteBefore(liChun!.solar))
    const exactMinute = chartAt(firstRepresentableMinuteOnOrAfter(liChun!.solar))
    expect(exactMinute.pillars[0]).not.toBe(before.pillars[0])
  })

  it('changes the public year pillar at the exact Li Chun second', () => {
    const liChun = TERMS.find((term) => term.isLiChun)
    expect(liChun).toBeDefined()
    const before = expectedPillars(offsetFromTerm(liChun!.solar, -1_000))
    const exact = expectedPillars(offsetFromTerm(liChun!.solar, 0))
    const after = expectedPillars(offsetFromTerm(liChun!.solar, 1_000))
    expect(exact[0]).not.toBe(before[0])
    expect(after[0]).toBe(exact[0])
  })

  it.each(TERMS.filter((term) => !term.isLiChun))('keeps the year pillar stable at $name', ({ solar }) => {
    const before = chartAt(oneMinuteBefore(solar))
    const exactMinute = chartAt(firstRepresentableMinuteOnOrAfter(solar))
    expect(exactMinute.pillars[0]).toBe(before.pillars[0])
  })

  it('keeps flow month boundaries as corrected-local wall-clock minute strings, not UTC instants', () => {
    const flow = calculateBaziFlow(BASE_INPUT, { targetDate: '2024-09-07', targetTime: '12:00' })

    expect(flow.target.boundaryTimeBasis).toBe('corrected-local-solar-term-wall-v2')
    expect(flow.monthlyCycles[0]).toMatchObject({
      startTerm: '立春',
      startAt: '2024-02-04T16:28:00',
      endTerm: '惊蛰',
      endAt: '2024-03-05T10:23:00',
    })
    expect(flow.monthlyCycles.every((cycle) => cycle.startAt.endsWith(':00') && cycle.endAt.endsWith(':00'))).toBe(true)
    expect(flow.monthlyCycles.every((cycle) => !cycle.startAt.endsWith('Z') && !cycle.endAt.endsWith('Z'))).toBe(true)
    expect(flow.monthlyCycles.every((cycle) => !/[+-]\d{2}:\d{2}$/.test(cycle.startAt) && !/[+-]\d{2}:\d{2}$/.test(cycle.endAt))).toBe(true)
  })
})
