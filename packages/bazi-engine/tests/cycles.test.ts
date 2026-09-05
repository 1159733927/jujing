import { describe, expect, it } from 'vitest'
import { calculateBazi, calculateBaziFlow } from '../src/index.js'
import type { BirthInput } from '@fengshui/domain'

const maleBirth: BirthInput = {
  date: '1992-08-18',
  time: '09:30',
  locationName: '杭州',
  longitude: 120.155,
  timezone: 'Asia/Shanghai',
  useTrueSolarTime: false,
  gender: 'male',
}

describe('calculateBaziFlow', () => {
  it('keeps the legacy-compatible flow path independent of optional chart provenance', () => {
    const flow = calculateBaziFlow(maleBirth, { targetDate: '2026-09-01', targetTime: '15:57' })

    expect(flow.targetChart.pillars).toEqual(['丙午', '丙申', '戊寅', '庚申'])
    expect('timeProfile' in flow.targetChart).toBe(false)
  })

  it('leaves the natal chart as natal-only while flow queries carry dynamic cycles', () => {
    const birthChart = calculateBazi(maleBirth)
    const flow = calculateBaziFlow(maleBirth, { targetDate: '2026-09-01', targetTime: '15:57' })

    expect(birthChart.annualCycles).toBeUndefined()
    expect(birthChart.monthlyCycles).toBeUndefined()
    expect(birthChart.dailyCycles).toBeUndefined()
    expect(birthChart.hourlyCycles).toBeUndefined()
    expect(flow.annualCycles).toHaveLength(10)
    expect(flow.monthlyCycles).toHaveLength(12)
    expect(flow.dailyCycles).toHaveLength(30)
    expect(flow.hourlyCycles).toHaveLength(12)
  })

  it('returns deterministic target-query cycles without changing the birth chart contract', () => {
    const query = { targetDate: '2026-09-01', targetTime: '15:57' }
    const first = calculateBaziFlow(maleBirth, query)
    const second = calculateBaziFlow(maleBirth, query)

    expect(first).toEqual(second)
    expect(first.ruleVersion).toBe('flow-v4-timezone-projected-jie-boundaries')
    expect(first.target).toMatchObject({
      date: '2026-09-01',
      time: '15:57',
      timezone: 'Asia/Shanghai',
      dayBoundary: 'midnight',
      boundaryTimeBasis: 'corrected-local-solar-term-wall-v2',
    })
    expect(first.selection).toMatchObject({ luckCycleIndex: 3, year: 2026, monthYear: 2026, month: 7, date: '2026-09-01', hourSlotStart: 15 })
    expect(first.targetChart).toMatchObject({
      correctedLocalTime: '2026-09-01T15:57',
      pillars: ['丙午', '丙申', '戊寅', '庚申'],
      tenGods: ['偏印', '偏印', '比肩', '食神'],
    })
    expect(first.targetChart.fiveElements?.counts).toMatchObject({ wood: 1, fire: 3, earth: 1, metal: 3, water: 0 })
    expect(first.targetChart.pillarDetails?.some((pillar) => (pillar.shenSha.names ?? []).length > 0)).toBe(true)
    expect(first.luckCycles[2]).toMatchObject({ index: 3, pillar: '辛亥', startDate: '2019-05-28', endDate: '2028-05-28' })
    expect(first.annualCycles.map((cycle) => cycle.year)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028])
    expect(first.annualCycles.find((cycle) => cycle.year === 2026)).toMatchObject({ pillar: '丙午', status: 'derived' })
    expect(first.monthlyCycles).toHaveLength(12)
    expect(first.monthlyCycles[6]).toMatchObject({
      year: 2026,
      month: 7,
      monthName: '七',
      startAt: '2026-08-07T19:43:00',
      endAt: '2026-09-07T22:42:00',
      startTerm: '立秋',
      endTerm: '白露',
      pillar: '丙申',
    })
    expect(first.dailyCycles).toHaveLength(30)
    expect(first.dailyCycles[0]).toMatchObject({ date: '2026-09-01', pillar: '戊寅' })
    expect(first.hourlyCycles).toHaveLength(12)
    expect(first.hourlyCycles[8]).toMatchObject({ startHour: 15, earthlyBranch: '申', pillar: '庚申' })
  })

  it('selects flow months by solar-term month pillars rather than civil month numbers', () => {
    const beforeWhiteDew = calculateBaziFlow(maleBirth, { targetDate: '2026-09-01', targetTime: '12:00' })
    const boundaryMinuteWhiteDew = calculateBaziFlow(maleBirth, { targetDate: '2026-09-07', targetTime: '22:41' })
    const afterWhiteDew = calculateBaziFlow(maleBirth, { targetDate: '2026-09-07', targetTime: '22:42' })

    expect(beforeWhiteDew.selection.month).toBe(7)
    expect(beforeWhiteDew.monthlyCycles[6]).toMatchObject({ monthName: '七', pillar: '丙申' })
    expect(boundaryMinuteWhiteDew.selection.month).toBe(7)
    expect(afterWhiteDew.selection.month).toBe(8)
    expect(afterWhiteDew.monthlyCycles[7]).toMatchObject({ monthName: '八', pillar: '丁酉' })
  })

  it('selects flow months from corrected local time when true solar time crosses a jie minute', () => {
    const trueSolarBirth = { ...maleBirth, useTrueSolarTime: true }
    const beforeByCorrectedTime = calculateBaziFlow(trueSolarBirth, { targetDate: '2026-09-07', targetTime: '22:38' })
    const afterByCorrectedTime = calculateBaziFlow(trueSolarBirth, { targetDate: '2026-09-07', targetTime: '22:39' })

    expect(beforeByCorrectedTime.targetChart.correctedLocalTime).toBe('2026-09-07T22:41')
    expect(beforeByCorrectedTime.selection.month).toBe(7)
    expect(beforeByCorrectedTime.targetChart.pillars[1]).toBe('丙申')
    expect(afterByCorrectedTime.targetChart.correctedLocalTime).toBe('2026-09-07T22:42')
    expect(afterByCorrectedTime.selection.month).toBe(7)
    expect(afterByCorrectedTime.targetChart.pillars[1]).toBe('丙申')
    const firstMinuteAfterBoundary = calculateBaziFlow(trueSolarBirth, { targetDate: '2026-09-07', targetTime: '22:42' })
    expect(firstMinuteAfterBoundary.targetChart.correctedLocalTime).toBe('2026-09-07T22:45')
    expect(firstMinuteAfterBoundary.selection.month).toBe(8)
    expect(firstMinuteAfterBoundary.targetChart.pillars[1]).toBe('丁酉')
  })

  it('uses target year rather than birth year for annual and monthly cycles', () => {
    const result = calculateBaziFlow(maleBirth, { targetDate: '2040-02-29' })
    expect(result.target.time).toBe('12:00')
    expect(result.selection).toMatchObject({ year: 2040, month: 1, date: '2040-02-29', hourSlotStart: 11 })
    expect(result.monthlyCycles.every((cycle) => cycle.year === 2040)).toBe(true)
    expect(result.dailyCycles).toHaveLength(29)
    expect(result.annualCycles.some((cycle) => cycle.year === 2040)).toBe(true)
  })

  it('derives the 2024 flow months from thirteen exact jie boundaries', () => {
    const result = calculateBaziFlow(maleBirth, { targetDate: '2024-06-15', targetTime: '12:00' })
    const boundaries = [
      '2024-02-04T16:28:00',
      '2024-03-05T10:23:00',
      '2024-04-04T15:03:00',
      '2024-05-05T08:11:00',
      '2024-06-05T12:10:00',
      '2024-07-06T22:21:00',
      '2024-08-07T08:10:00',
      '2024-09-07T11:12:00',
      '2024-10-08T03:00:00',
      '2024-11-07T06:21:00',
      '2024-12-06T23:18:00',
      '2025-01-05T10:33:00',
      '2025-02-03T22:11:00',
    ]

    expect(result.monthlyCycles).toHaveLength(12)
    expect(result.monthlyCycles.map((cycle) => cycle.startAt)).toEqual(boundaries.slice(0, 12))
    expect(result.monthlyCycles.at(-1)?.endAt).toBe(boundaries.at(-1))
    expect(result.monthlyCycles.map((cycle) => cycle.startTerm)).toEqual(['立春', '惊蛰', '清明', '立夏', '芒种', '小暑', '立秋', '白露', '寒露', '立冬', '大雪', '小寒'])
    expect(result.monthlyCycles.map((cycle) => cycle.endTerm)).toEqual(['惊蛰', '清明', '立夏', '芒种', '小暑', '立秋', '白露', '寒露', '立冬', '大雪', '小寒', '立春'])
    for (let index = 1; index < result.monthlyCycles.length; index += 1) {
      expect(result.monthlyCycles[index - 1]!.endAt).toBe(result.monthlyCycles[index]!.startAt)
      expect(result.monthlyCycles[index]!.startAt > result.monthlyCycles[index - 1]!.startAt).toBe(true)
    }
  })

  it('uses the previous solar-term year for January targets before Li Chun', () => {
    const result = calculateBaziFlow(maleBirth, { targetDate: '2024-01-15', targetTime: '12:00' })
    const selectedMonth = result.monthlyCycles.find((cycle) => cycle.month === result.selection.month)!

    expect(result.selection).toMatchObject({ year: 2024, monthYear: 2023, month: 12, date: '2024-01-15' })
    expect(selectedMonth).toMatchObject({
      year: 2023,
      month: 12,
      monthName: '腊',
      startTerm: '小寒',
      endTerm: '立春',
      pillar: result.targetChart.pillars[1],
    })
    expect(selectedMonth.startAt <= `${result.targetChart.correctedLocalTime}:00`).toBe(true)
    expect(`${result.targetChart.correctedLocalTime}:00` < selectedMonth.endAt).toBe(true)
  })

  it('preserves male and female luck-cycle direction from the birth chart', () => {
    const male = calculateBaziFlow(maleBirth, { targetDate: '2026-09-01' })
    const female = calculateBaziFlow({ ...maleBirth, gender: 'female' }, { targetDate: '2026-09-01' })

    expect(male.luckCycles[0]).toMatchObject({ pillar: '己酉', direction: 'forward' })
    expect(female.luckCycles[0]).toMatchObject({ pillar: '丁未', direction: 'backward' })
  })

  it('derives exact month/day boundaries and the twelve traditional two-hour slots', () => {
    const result = calculateBaziFlow(maleBirth, { targetDate: '2024-12-31', targetTime: '23:59' })

    expect(result.selection).toMatchObject({ year: 2024, month: 11, date: '2024-12-31', hourSlotStart: 23 })
    expect(result.dailyCycles).toHaveLength(31)
    expect(result.dailyCycles.at(-1)).toMatchObject({ date: '2024-12-31' })
    expect(result.hourlyCycles.map((cycle) => cycle.startHour)).toEqual([23, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21])
    expect(result.hourlyCycles.map((cycle) => cycle.earthlyBranch)).toEqual(['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'])
  })

  it('records the selected Zi-hour day-boundary rule in query output', () => {
    const result = calculateBaziFlow({ ...maleBirth, dayBoundary: 'zi-hour-start' }, { targetDate: '2024-01-01', targetTime: '23:30' })

    expect(result.target.dayBoundary).toBe('zi-hour-start')
    expect(result.selection.hourSlotStart).toBe(23)
    expect(result.dailyCycles.find((cycle) => cycle.date === '2024-01-01')).toMatchObject({ pillar: '乙丑' })
  })

  it('keeps timezone and DST profile handling separate from flow month boundary selection', () => {
    const result = calculateBaziFlow({
      ...maleBirth,
      locationName: 'New York',
      longitude: -74.006,
      timezone: 'America/New_York',
      dstPolicy: 'auto',
      useTrueSolarTime: false,
    }, { targetDate: '2026-07-01', targetTime: '12:00' })
    const selectedMonth = result.monthlyCycles.find((cycle) => cycle.month === result.selection.month)!

    expect(result.target.timezone).toBe('America/New_York')
    expect(result.targetChart.correctedLocalTime).toBe('2026-07-01T11:00')
    expect(result.targetChart.correctionMinutes).toBe(-60)
    expect(selectedMonth.pillar).toBe(result.targetChart.pillars[1])
  })

  it('projects exact Jie boundaries into America/New_York before selecting the flow month', () => {
    const newYorkBirth: BirthInput = {
      ...maleBirth,
      locationName: 'New York',
      longitude: -74.006,
      timezone: 'America/New_York',
      dstPolicy: 'auto',
      useTrueSolarTime: false,
    }
    const beforeLiChun = calculateBaziFlow(newYorkBirth, { targetDate: '2024-02-04', targetTime: '03:27' })
    const afterLiChun = calculateBaziFlow(newYorkBirth, { targetDate: '2024-02-04', targetTime: '03:28' })

    expect(beforeLiChun.selection.month).toBe(12)
    expect(beforeLiChun.targetChart.pillars.slice(0, 2)).toEqual(['癸卯', '乙丑'])
    expect(afterLiChun.selection.month).toBe(1)
    expect(afterLiChun.targetChart.pillars.slice(0, 2)).toEqual(['甲辰', '丙寅'])
    expect(afterLiChun.monthlyCycles[0]).toMatchObject({ startTerm: '立春', startAt: '2024-02-04T03:28:00', pillar: '丙寅' })
  })

  it('applies target-time DST and boundary-time DST independently in America/New_York', () => {
    const newYorkBirth: BirthInput = {
      ...maleBirth,
      locationName: 'New York',
      longitude: -74.006,
      timezone: 'America/New_York',
      dstPolicy: 'auto',
      useTrueSolarTime: false,
    }
    const beforeXiaoShu = calculateBaziFlow(newYorkBirth, { targetDate: '2024-07-06', targetTime: '10:20' })
    const afterXiaoShu = calculateBaziFlow(newYorkBirth, { targetDate: '2024-07-06', targetTime: '10:21' })

    expect(beforeXiaoShu.targetChart.correctedLocalTime).toBe('2024-07-06T09:20')
    expect(beforeXiaoShu.selection.month).toBe(5)
    expect(afterXiaoShu.targetChart.correctedLocalTime).toBe('2024-07-06T09:21')
    expect(afterXiaoShu.selection.month).toBe(6)
    expect(afterXiaoShu.monthlyCycles[5]).toMatchObject({ startTerm: '小暑', startAt: '2024-07-06T09:21:00', pillar: '辛未' })
    expect(afterXiaoShu.targetChart.pillars[1]).toBe('辛未')
  })

  it('uses the boundary instant correction instead of reusing target correction minutes for true solar flow months', () => {
    const urumqiBirth: BirthInput = {
      ...maleBirth,
      locationName: '乌鲁木齐',
      longitude: 87.6168,
      timezone: 'Asia/Shanghai',
      useTrueSolarTime: true,
    }
    const beforeLiChun = calculateBaziFlow(urumqiBirth, { targetDate: '2024-02-04', targetTime: '16:00' })
    const afterLiChun = calculateBaziFlow(urumqiBirth, { targetDate: '2024-02-04', targetTime: '17:00' })

    expect(beforeLiChun.targetChart.correctedLocalTime).toBe('2024-02-04T13:36')
    expect(beforeLiChun.selection.month).toBe(12)
    expect(afterLiChun.targetChart.correctedLocalTime).toBe('2024-02-04T14:36')
    expect(afterLiChun.selection.month).toBe(1)
    expect(afterLiChun.monthlyCycles[0]).toMatchObject({ startTerm: '立春', startAt: '2024-02-04T14:04:00', pillar: '丙寅' })
    expect(afterLiChun.targetChart.pillars[1]).toBe('丙寅')
  })

  it('selects the Zi hour slot for both 23:xx and 00:xx target times', () => {
    expect(calculateBaziFlow(maleBirth, { targetDate: '2024-01-01', targetTime: '23:30' }).selection.hourSlotStart).toBe(23)
    expect(calculateBaziFlow(maleBirth, { targetDate: '2024-01-02', targetTime: '00:30' }).selection.hourSlotStart).toBe(23)
  })

  it('rejects invalid target date/time before deriving cycles', () => {
    expect(() => calculateBaziFlow(maleBirth, { targetDate: '2023-02-29' })).toThrow('target date/time')
    expect(() => calculateBaziFlow(maleBirth, { targetDate: '2024-01-01', targetTime: '24:00' })).toThrow('target hour')
  })
})
