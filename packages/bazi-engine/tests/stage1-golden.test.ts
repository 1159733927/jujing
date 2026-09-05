import { describe, expect, it } from 'vitest'
import type { BirthInput } from '@fengshui/domain'
import { birthInputFromPlace, findBirthplace } from '@fengshui/geo-data'
import { calculateBazi, calculateBaziFlow, compareBaziWithExpected } from '../src/index.js'

interface GoldenSample {
  id: string
  description: string
  sourceType: 'local-lunar-typescript-baseline' | 'manual-external-verification-pending'
  input: BirthInput
  expected: {
    pillars: readonly [string, string, string, string]
    correctedLocalTime: string
    correctionMinutes: number
    normalizedSolarDate: string
    normalizedSolarTime: string
    normalizedLunarDate?: string
    normalizedLunarLeapMonth?: boolean
    timeProfile?: {
      timezone: string
      utcOffsetMinutes: number
      standardUtcOffsetMinutes: number
      daylightSavingMinutes: number
      dstPolicy: 'auto' | 'ignore'
      dayBoundary: 'midnight' | 'zi-hour-start'
      luckMethod: 'sect1' | 'sect2'
    }
    firstLuckCycle: { pillar: string; startAge: number; startDate: string; direction: 'forward' | 'backward' }
    firstAnnualCycle: { year: number; pillar: string }
    firstDailyCycle: { date: string; pillar: string }
    firstHourlyCycle: { dateTime: string; pillar: string }
  }
}

interface GoldenFixture {
  metadata: {
    purpose: string
    source: string
    ruleVersion: string
  }
  samples: GoldenSample[]
}

const fixture: GoldenFixture = {
  metadata: {
    purpose: 'Stage 1 BaZi engine golden fixtures for deterministic regression checks.',
    source: 'local lunar-typescript baseline captured on 2026-08-31; verified WenZhen evidence fixtures are maintained separately for external parity checks.',
    ruleVersion: 'bazi-v5-stem-branch-relations',
  },
  samples: [
    {
      id: 'hangzhou-1992-08-18-0930-true-solar',
      description: 'Solar calendar Hangzhou baseline with true solar time enabled.',
      sourceType: 'local-lunar-typescript-baseline',
      input: {
        date: '1992-08-18',
        time: '09:30',
        locationName: '浙江省 杭州市 西湖区',
        longitude: 120.1302,
        latitude: 30.2595,
        timezone: 'Asia/Shanghai',
        useTrueSolarTime: true,
        gender: 'male',
      },
      expected: {
        pillars: ['壬申', '戊申', '丙寅', '癸巳'],
        correctedLocalTime: '1992-08-18T09:27',
        correctionMinutes: -2.67,
        normalizedSolarDate: '1992-08-18',
        normalizedSolarTime: '09:30',
        normalizedLunarDate: '1992-07-20',
        normalizedLunarLeapMonth: false,
        timeProfile: {
          timezone: 'Asia/Shanghai',
          utcOffsetMinutes: 480,
          standardUtcOffsetMinutes: 480,
          daylightSavingMinutes: 0,
          dstPolicy: 'auto',
          dayBoundary: 'midnight',
          luckMethod: 'sect1',
        },
        firstLuckCycle: { pillar: '己酉', startAge: 8, startDate: '1999-05-28', direction: 'forward' },
        firstAnnualCycle: { year: 1990, pillar: '庚午' },
        firstDailyCycle: { date: '1992-08-18', pillar: '丙寅' },
        firstHourlyCycle: { dateTime: '1992-08-18 00:00:00', pillar: '戊子' },
      },
    },
    {
      id: 'beijing-2024-lunar-new-year-civil',
      description: 'Lunar new year converts to the equivalent solar date when civil time is selected.',
      sourceType: 'local-lunar-typescript-baseline',
      input: {
        calendarSystem: 'lunar',
        date: '2024-01-01',
        time: '12:00',
        locationName: '北京市 北京市 东城区',
        longitude: 116.4164,
        latitude: 39.9288,
        timezone: 'Asia/Shanghai',
        useTrueSolarTime: false,
        gender: 'female',
      },
      expected: {
        pillars: ['甲辰', '丙寅', '甲辰', '庚午'],
        correctedLocalTime: '2024-02-10T12:00',
        correctionMinutes: 0,
        normalizedSolarDate: '2024-02-10',
        normalizedSolarTime: '12:00',
        normalizedLunarDate: '2024-01-01',
        normalizedLunarLeapMonth: false,
        timeProfile: {
          timezone: 'Asia/Shanghai',
          utcOffsetMinutes: 480,
          standardUtcOffsetMinutes: 480,
          daylightSavingMinutes: 0,
          dstPolicy: 'auto',
          dayBoundary: 'midnight',
          luckMethod: 'sect1',
        },
        firstLuckCycle: { pillar: '乙丑', startAge: 3, startDate: '2026-01-20', direction: 'backward' },
        firstAnnualCycle: { year: 2022, pillar: '壬寅' },
        firstDailyCycle: { date: '2024-02-10', pillar: '甲辰' },
        firstHourlyCycle: { dateTime: '2024-02-10 00:00:00', pillar: '甲子' },
      },
    },
    {
      id: 'wucha-2024-boundary-true-solar',
      description: 'Far-west mainland China true solar correction crosses into the previous civil day.',
      sourceType: 'local-lunar-typescript-baseline',
      input: {
        date: '2024-01-01',
        time: '00:10',
        locationName: '新疆维吾尔自治区 克孜勒苏柯尔克孜自治州 乌恰县',
        longitude: 75.2597,
        latitude: 39.7191,
        timezone: 'Asia/Shanghai',
        useTrueSolarTime: true,
        gender: 'male',
      },
      expected: {
        pillars: ['癸卯', '甲子', '癸亥', '癸亥'],
        correctedLocalTime: '2023-12-31T21:07',
        correctionMinutes: -182.57,
        normalizedSolarDate: '2024-01-01',
        normalizedSolarTime: '00:10',
        normalizedLunarDate: '2023-11-20',
        normalizedLunarLeapMonth: false,
        timeProfile: {
          timezone: 'Asia/Shanghai',
          utcOffsetMinutes: 480,
          standardUtcOffsetMinutes: 480,
          daylightSavingMinutes: 0,
          dstPolicy: 'auto',
          dayBoundary: 'midnight',
          luckMethod: 'sect1',
        },
        firstLuckCycle: { pillar: '癸亥', startAge: 10, startDate: '2032-01-20', direction: 'backward' },
        firstAnnualCycle: { year: 2021, pillar: '辛丑' },
        firstDailyCycle: { date: '2023-12-31', pillar: '癸亥' },
        firstHourlyCycle: { dateTime: '2023-12-31 00:00:00', pillar: '壬子' },
      },
    },
    {
      id: 'beijing-lichun-before-civil',
      description: 'Civil-time sample before the 2024 Li Chun boundary.',
      sourceType: 'local-lunar-typescript-baseline',
      input: {
        date: '2024-02-04',
        time: '15:00',
        locationName: '北京市 北京市 东城区',
        longitude: 116.4164,
        latitude: 39.9286,
        timezone: 'Asia/Shanghai',
        useTrueSolarTime: false,
        gender: 'male',
      },
      expected: {
        pillars: ['癸卯', '乙丑', '戊戌', '庚申'],
        correctedLocalTime: '2024-02-04T15:00',
        correctionMinutes: 0,
        normalizedSolarDate: '2024-02-04',
        normalizedSolarTime: '15:00',
        normalizedLunarDate: '2023-12-25',
        normalizedLunarLeapMonth: false,
        timeProfile: {
          timezone: 'Asia/Shanghai',
          utcOffsetMinutes: 480,
          standardUtcOffsetMinutes: 480,
          daylightSavingMinutes: 0,
          dstPolicy: 'auto',
          dayBoundary: 'midnight',
          luckMethod: 'sect1',
        },
        firstLuckCycle: { pillar: '甲子', startAge: 10, startDate: '2033-12-04', direction: 'backward' },
        firstAnnualCycle: { year: 2022, pillar: '壬寅' },
        firstDailyCycle: { date: '2024-02-04', pillar: '戊戌' },
        firstHourlyCycle: { dateTime: '2024-02-04 00:00:00', pillar: '壬子' },
      },
    },
    {
      id: 'beijing-lichun-after-civil',
      description: 'Civil-time sample after the 2024 Li Chun boundary.',
      sourceType: 'local-lunar-typescript-baseline',
      input: {
        date: '2024-02-04',
        time: '17:00',
        locationName: '北京市 北京市 东城区',
        longitude: 116.4164,
        latitude: 39.9286,
        timezone: 'Asia/Shanghai',
        useTrueSolarTime: false,
        gender: 'male',
      },
      expected: {
        pillars: ['甲辰', '丙寅', '戊戌', '辛酉'],
        correctedLocalTime: '2024-02-04T17:00',
        correctionMinutes: 0,
        normalizedSolarDate: '2024-02-04',
        normalizedSolarTime: '17:00',
        normalizedLunarDate: '2023-12-25',
        normalizedLunarLeapMonth: false,
        timeProfile: {
          timezone: 'Asia/Shanghai',
          utcOffsetMinutes: 480,
          standardUtcOffsetMinutes: 480,
          daylightSavingMinutes: 0,
          dstPolicy: 'auto',
          dayBoundary: 'midnight',
          luckMethod: 'sect1',
        },
        firstLuckCycle: { pillar: '丁卯', startAge: 10, startDate: '2033-12-24', direction: 'forward' },
        firstAnnualCycle: { year: 2022, pillar: '壬寅' },
        firstDailyCycle: { date: '2024-02-04', pillar: '戊戌' },
        firstHourlyCycle: { dateTime: '2024-02-04 00:00:00', pillar: '壬子' },
      },
    },
    {
      id: 'beijing-2023-leap-lunar-second-month',
      description: 'Leap lunar second-month input keeps leap-month provenance after conversion.',
      sourceType: 'local-lunar-typescript-baseline',
      input: {
        calendarSystem: 'lunar',
        lunarLeapMonth: true,
        date: '2023-02-01',
        time: '08:15',
        locationName: '北京市 北京市 东城区',
        longitude: 116.4164,
        latitude: 39.9286,
        timezone: 'Asia/Shanghai',
        useTrueSolarTime: false,
        gender: 'female',
      },
      expected: {
        pillars: ['癸卯', '乙卯', '己卯', '戊辰'],
        correctedLocalTime: '2023-03-22T08:15',
        correctionMinutes: 0,
        normalizedSolarDate: '2023-03-22',
        normalizedSolarTime: '08:15',
        normalizedLunarDate: '2023-02-01',
        normalizedLunarLeapMonth: true,
        timeProfile: {
          timezone: 'Asia/Shanghai',
          utcOffsetMinutes: 480,
          standardUtcOffsetMinutes: 480,
          daylightSavingMinutes: 0,
          dstPolicy: 'auto',
          dayBoundary: 'midnight',
          luckMethod: 'sect1',
        },
        firstLuckCycle: { pillar: '丙辰', startAge: 5, startDate: '2027-12-02', direction: 'forward' },
        firstAnnualCycle: { year: 2021, pillar: '辛丑' },
        firstDailyCycle: { date: '2023-03-22', pillar: '己卯' },
        firstHourlyCycle: { dateTime: '2023-03-22 00:00:00', pillar: '甲子' },
      },
    },
    {
      id: 'new-york-2024-dst-summer-civil',
      description: 'Overseas summer sample applies America/New_York DST normalization.',
      sourceType: 'local-lunar-typescript-baseline',
      input: {
        date: '2024-07-01',
        time: '08:30',
        locationName: 'United States New York County New York',
        longitude: -74.006,
        latitude: 40.7128,
        timezone: 'America/New_York',
        useTrueSolarTime: false,
        gender: 'male',
      },
      expected: {
        pillars: ['甲辰', '庚午', '丙寅', '壬辰'],
        correctedLocalTime: '2024-07-01T07:30',
        correctionMinutes: -60,
        normalizedSolarDate: '2024-07-01',
        normalizedSolarTime: '08:30',
        normalizedLunarDate: '2024-05-26',
        normalizedLunarLeapMonth: false,
        timeProfile: {
          timezone: 'America/New_York',
          utcOffsetMinutes: -240,
          standardUtcOffsetMinutes: -300,
          daylightSavingMinutes: 60,
          dstPolicy: 'auto',
          dayBoundary: 'midnight',
          luckMethod: 'sect1',
        },
        firstLuckCycle: { pillar: '辛未', startAge: 3, startDate: '2026-05-11', direction: 'forward' },
        firstAnnualCycle: { year: 2022, pillar: '壬寅' },
        firstDailyCycle: { date: '2024-07-01', pillar: '丙寅' },
        firstHourlyCycle: { dateTime: '2024-07-01 00:00:00', pillar: '戊子' },
      },
    },
    {
      id: 'new-york-2024-dst-fall-ambiguous-civil',
      description: 'Overseas fall-back sample records the earliest ambiguous America/New_York wall time.',
      sourceType: 'local-lunar-typescript-baseline',
      input: {
        date: '2024-11-03',
        time: '01:30',
        locationName: 'United States New York County New York',
        longitude: -74.006,
        latitude: 40.7128,
        timezone: 'America/New_York',
        useTrueSolarTime: false,
        gender: 'female',
      },
      expected: {
        pillars: ['甲辰', '甲戌', '辛未', '戊子'],
        correctedLocalTime: '2024-11-03T00:30',
        correctionMinutes: -60,
        normalizedSolarDate: '2024-11-03',
        normalizedSolarTime: '01:30',
        normalizedLunarDate: '2024-10-03',
        normalizedLunarLeapMonth: false,
        timeProfile: {
          timezone: 'America/New_York',
          utcOffsetMinutes: -240,
          standardUtcOffsetMinutes: -300,
          daylightSavingMinutes: 60,
          dstPolicy: 'auto',
          dayBoundary: 'midnight',
          luckMethod: 'sect1',
        },
        firstLuckCycle: { pillar: '癸酉', startAge: 10, startDate: '2033-06-23', direction: 'backward' },
        firstAnnualCycle: { year: 2022, pillar: '壬寅' },
        firstDailyCycle: { date: '2024-11-03', pillar: '辛未' },
        firstHourlyCycle: { dateTime: '2024-11-03 00:00:00', pillar: '戊子' },
      },
    },
    {
      id: 'tokyo-2024-no-dst-civil',
      description: 'Overseas non-DST sample keeps Asia/Tokyo civil time unchanged.',
      sourceType: 'local-lunar-typescript-baseline',
      input: {
        date: '2024-07-01',
        time: '08:30',
        locationName: 'Japan Tokyo Metropolis Chiyoda',
        longitude: 139.753,
        latitude: 35.684,
        timezone: 'Asia/Tokyo',
        useTrueSolarTime: false,
        gender: 'male',
      },
      expected: {
        pillars: ['甲辰', '庚午', '丙寅', '壬辰'],
        correctedLocalTime: '2024-07-01T08:30',
        correctionMinutes: 0,
        normalizedSolarDate: '2024-07-01',
        normalizedSolarTime: '08:30',
        normalizedLunarDate: '2024-05-26',
        normalizedLunarLeapMonth: false,
        timeProfile: {
          timezone: 'Asia/Tokyo',
          utcOffsetMinutes: 540,
          standardUtcOffsetMinutes: 540,
          daylightSavingMinutes: 0,
          dstPolicy: 'auto',
          dayBoundary: 'midnight',
          luckMethod: 'sect1',
        },
        firstLuckCycle: { pillar: '辛未', startAge: 3, startDate: '2026-05-11', direction: 'forward' },
        firstAnnualCycle: { year: 2022, pillar: '壬寅' },
        firstDailyCycle: { date: '2024-07-01', pillar: '丙寅' },
        firstHourlyCycle: { dateTime: '2024-07-01 00:00:00', pillar: '戊子' },
      },
    },
  ],
}

describe('stage 1 golden fixture governance', () => {
  it('keeps local regression fixtures separate from external parity evidence', () => {
    expect(fixture.metadata.source).toContain('verified WenZhen evidence fixtures are maintained separately')
  })

  it('keeps every golden sample uniquely identifiable', () => {
    expect(new Set(fixture.samples.map((sample) => sample.id)).size).toBe(fixture.samples.length)
  })

  it('declares a source type for every golden sample', () => {
    expect(fixture.samples.every((sample) => sample.sourceType === 'local-lunar-typescript-baseline')).toBe(true)
  })
})

describe('stage 1 four-pillar golden baselines', () => {
  it.each(fixture.samples)('matches the expected four pillars for $id', (sample) => {
    expect(calculateBazi(sample.input).pillars).toEqual(sample.expected.pillars)
  })

  it.each(fixture.samples)('records the expected corrected local time for $id', (sample) => {
    expect(calculateBazi(sample.input).correctedLocalTime).toBe(sample.expected.correctedLocalTime)
  })

  it.each(fixture.samples)('records the expected solar-time correction minutes for $id', (sample) => {
    expect(calculateBazi(sample.input).correctionMinutes).toBe(sample.expected.correctionMinutes)
  })

  it.each(fixture.samples)('stores normalized solar input for $id', (sample) => {
    expect(calculateBazi(sample.input).inputSnapshot).toMatchObject({
      normalizedSolarDate: sample.expected.normalizedSolarDate,
      normalizedSolarTime: sample.expected.normalizedSolarTime,
    })
  })

  it.each(fixture.samples)('stores normalized lunar input for $id', (sample) => {
    expect(calculateBazi(sample.input).inputSnapshot).toMatchObject({
      normalizedLunarDate: sample.expected.normalizedLunarDate,
      normalizedLunarLeapMonth: sample.expected.normalizedLunarLeapMonth,
    })
  })

  it.each(fixture.samples)('records the expected time profile for $id', (sample) => {
    expect(calculateBazi(sample.input).timeProfile).toMatchObject(sample.expected.timeProfile!)
  })
})

describe('stage 1 cycle baselines', () => {
  it.each(fixture.samples)('derives the expected first luck cycle for $id', (sample) => {
    expect(calculateBazi(sample.input).luckCycles?.[0]).toMatchObject(sample.expected.firstLuckCycle)
  })

  it.each(fixture.samples)('keeps query-state cycles out of the immutable natal chart for $id', (sample) => {
    const chart = calculateBazi(sample.input)
    expect(chart.annualCycles).toBeUndefined()
    expect(chart.monthlyCycles).toBeUndefined()
    expect(chart.dailyCycles).toBeUndefined()
    expect(chart.hourlyCycles).toBeUndefined()
  })

  it.each(fixture.samples)('derives dynamic cycles only through an explicit flow query for $id', (sample) => {
    const flow = calculateBaziFlow(sample.input, { targetDate: sample.expected.normalizedSolarDate, targetTime: sample.expected.normalizedSolarTime })
    expect(flow.targetChart.pillars).toEqual(sample.expected.pillars)
    expect(flow.annualCycles.find((cycle) => cycle.year === flow.selection.year)).toBeDefined()
    expect(flow.monthlyCycles.find((cycle) => cycle.month === flow.selection.month)).toBeDefined()
    expect(flow.dailyCycles.find((cycle) => cycle.date === flow.selection.date)).toBeDefined()
    expect(flow.hourlyCycles.find((cycle) => cycle.startHour === flow.selection.hourSlotStart)).toBeDefined()
  })
})

describe('stage 1 BaZi product contracts', () => {
  it('matches expected WenZhen-compatible samples when expectations are aligned', () => {
    const sample = fixture.samples[0]!
    const report = compareBaziWithExpected(sample.id, 'wenzhen-manual-verification-pending', sample.input, {
      pillars: sample.expected.pillars,
      correctedLocalTime: sample.expected.correctedLocalTime,
      correctionMinutes: sample.expected.correctionMinutes,
    })
    expect(report).toEqual({
      sampleId: sample.id,
      source: 'wenzhen-manual-verification-pending',
      matched: true,
      comparedPaths: ['pillars', 'correctedLocalTime', 'correctionMinutes'],
      mismatches: [],
    })
  })

  it('emits a machine-readable difference report on four-pillar mismatch', () => {
    const sample = fixture.samples[0]!
    const report = compareBaziWithExpected(sample.id, 'wenzhen-web-sample', sample.input, {
      pillars: ['甲子', '乙丑', '丙寅', '丁卯'],
    })
    expect(report.matched).toBe(false)
    expect(report.comparedPaths).toEqual(['pillars'])
    expect(report.mismatches).toEqual([{
      path: 'pillars',
      category: 'pillar',
      expected: ['甲子', '乙丑', '丙寅', '丁卯'],
      actual: sample.expected.pillars,
    }])
  })

  it('compares professional WenZhen fields without collapsing them into a single display mismatch', () => {
    const sample = fixture.samples[0]!
    const chart = calculateBazi(sample.input)
    const report = compareBaziWithExpected(sample.id, 'wenzhen-professional-capture', sample.input, {
      tenGods: chart.tenGods,
      hiddenStems: chart.hiddenStems,
      professional: {
        naYin: chart.professional!.naYin,
        voidBranches: ['子丑', '寅卯', '辰巳', '午未'],
        twelveGrowthStages: chart.professional!.twelveGrowthStages,
        method: 'lunar-typescript-eight-char-v1',
        ruleVersion: chart.professional!.ruleVersion,
      },
      luckCycles: chart.luckCycles,
    })
    expect(report.comparedPaths).toEqual([
      'tenGods',
      'hiddenStems',
      'professional.naYin',
      'professional.voidBranches',
      'professional.twelveGrowthStages',
      'luckCycles',
    ])
    expect(report.mismatches).toEqual([{
      path: 'professional.voidBranches',
      category: 'professional-field',
      expected: ['子丑', '寅卯', '辰巳', '午未'],
      actual: chart.professional!.voidBranches,
    }])
  })

  it('rejects dynamic-cycle expectations on natal-chart comparisons', () => {
    const sample = fixture.samples[0]!
    expect(() => compareBaziWithExpected(sample.id, 'wenzhen-flow-capture', sample.input, {
      annualCycles: [{ year: 2026, pillar: '丙午', status: 'derived' }],
    })).toThrow('dynamic cycles must be compared through calculateBaziFlow')
  })

  it('derives per-pillar branch ten-gods and self-sitting growth stages for the professional matrix', () => {
    const chart = calculateBazi({
      date: '1992-08-21',
      time: '12:03',
      locationName: '浙江省 杭州市 西湖区',
      longitude: 120.1302,
      latitude: 30.2595,
      timezone: 'Asia/Shanghai',
      useTrueSolarTime: true,
      gender: 'male',
    })
    expect(chart.pillars).toEqual(['壬申', '戊申', '己巳', '庚午'])
    expect(chart.pillarDetails?.map((pillar) => pillar.hiddenStems.map((stem) => stem.tenGod))).toEqual([
      ['伤官', '正财', '劫财'],
      ['伤官', '正财', '劫财'],
      ['正印', '劫财', '伤官'],
      ['偏印', '比肩'],
    ])
    expect(chart.pillarDetails?.map((pillar) => pillar.selfSitting)).toEqual(['长生', '病', '帝旺', '沐浴'])
  })

  it('pins solar-term boundary behavior with before-term and after-term samples', () => {
    const base: BirthInput = {
      date: '2024-02-04',
      time: '16:00',
      locationName: '北京市 北京市 东城区',
      longitude: 116.4164,
      latitude: 39.9286,
      timezone: 'Asia/Shanghai',
      useTrueSolarTime: false,
      gender: 'male',
    }
    expect(calculateBazi({ ...base, time: '15:00' }).pillars).toEqual(['癸卯', '乙丑', '戊戌', '庚申'])
    expect(calculateBazi({ ...base, time: '17:00' }).pillars).toEqual(['甲辰', '丙寅', '戊戌', '辛酉'])
  })

  it('pins the complete 22:59-00:00 matrix for midnight and Zi-initial day-change policies', () => {
    const input: Omit<BirthInput, 'date' | 'time'> = {
      locationName: '北京市 北京市 东城区',
      longitude: 116.4164,
      latitude: 39.9286,
      timezone: 'Asia/Shanghai',
      useTrueSolarTime: false,
      gender: 'male',
    }

    const cases = [
      {
        date: '2024-01-01',
        time: '22:59',
        midnight: ['癸卯', '甲子', '甲子', '乙亥'],
        ziHourStart: ['癸卯', '甲子', '甲子', '乙亥'],
      },
      {
        date: '2024-01-01',
        time: '23:00',
        midnight: ['癸卯', '甲子', '甲子', '丙子'],
        ziHourStart: ['癸卯', '甲子', '乙丑', '丙子'],
      },
      {
        date: '2024-01-01',
        time: '23:59',
        midnight: ['癸卯', '甲子', '甲子', '丙子'],
        ziHourStart: ['癸卯', '甲子', '乙丑', '丙子'],
      },
      {
        date: '2024-01-02',
        time: '00:00',
        midnight: ['癸卯', '甲子', '乙丑', '丙子'],
        ziHourStart: ['癸卯', '甲子', '乙丑', '丙子'],
      },
    ] as const

    for (const sample of cases) {
      const midnight = calculateBazi({ ...input, date: sample.date, time: sample.time, dayBoundary: 'midnight' })
      const ziHourStart = calculateBazi({ ...input, date: sample.date, time: sample.time, dayBoundary: 'zi-hour-start' })
      expect(midnight.pillars, `${sample.date} ${sample.time} midnight`).toEqual(sample.midnight)
      expect(ziHourStart.pillars, `${sample.date} ${sample.time} zi-hour-start`).toEqual(sample.ziHourStart)
      expect(midnight.timeProfile?.dayBoundary).toBe('midnight')
      expect(ziHourStart.timeProfile?.dayBoundary).toBe('zi-hour-start')
    }
  })

  it('resolves birthplace selection to coordinates and timezone from the shared city database', () => {
    const place = findBirthplace('浙江省', '杭州市', '西湖区')
    expect(place).toBeDefined()
    const birth = birthInputFromPlace(place!.province, place!.city, place!.district)
    expect(birth).toEqual({
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      placeCode: '330106',
      geoDataVersion: 'province-city-china@8.5.8+geonames-cn@2026-08-31.64057955b60e',
      locationName: '浙江省 杭州市 西湖区',
      longitude: 120.13333,
      latitude: 30.26667,
      timezone: 'Asia/Shanghai',
    })
  })

  it('applies historical timezone and daylight-saving rules before deriving pillars', () => {
    const input: BirthInput = {
      date: '1990-08-01',
      time: '12:00',
      locationName: '北京市 北京市 东城区',
      longitude: 116.4164,
      latitude: 39.9286,
      timezone: 'Asia/Shanghai',
      useTrueSolarTime: false,
      gender: 'male',
    }
    const auto = calculateBazi({ ...input, dstPolicy: 'auto' })
    const ignored = calculateBazi({ ...input, dstPolicy: 'ignore' })
    expect(auto.correctedLocalTime).toBe('1990-08-01T11:00')
    expect(auto.timeProfile).toMatchObject({ utcOffsetMinutes: 540, standardUtcOffsetMinutes: 480, daylightSavingMinutes: 60 })
    expect(ignored.correctedLocalTime).toBe('1990-08-01T12:00')
    expect(ignored.timeProfile).toMatchObject({ utcOffsetMinutes: 480, standardUtcOffsetMinutes: 480, daylightSavingMinutes: 0 })
  })

  it('derives luck cycles from the selected start-age algorithm profile', () => {
    const input: BirthInput = {
      date: '1992-08-18',
      time: '09:30',
      locationName: '杭州市',
      longitude: 120.1302,
      latitude: 30.2595,
      timezone: 'Asia/Shanghai',
      useTrueSolarTime: true,
      gender: 'male',
    }
    expect(calculateBazi({ ...input, luckMethod: 'sect1' }).luckCycles?.[0]).toMatchObject({ pillar: '己酉', startDate: '1999-05-28' })
    expect(calculateBazi({ ...input, luckMethod: 'sect2' }).luckCycles?.[0]).toMatchObject({ pillar: '己酉', startDate: '1999-05-27' })
  })
})
