import { describe, expect, it } from 'vitest'
import {
  CALENDAR_RULE_VERSION,
  calculateBazi,
  convertCalendarDate,
  getBaziTimeRuntimeProvenance,
  getLunarYearProfile,
} from '../src/index.js'

describe('calculateBazi', () => {
  it('records the current Node Intl runtime provenance without volatile metadata', () => {
    const provenance = getBaziTimeRuntimeProvenance()
    const chart = calculateBazi({ date: '1992-08-18', time: '09:30', locationName: '杭州', longitude: 120.155 })

    expect(provenance).toEqual({
      provider: 'node-intl',
      ...(process.versions.node ? { nodeVersion: process.versions.node } : {}),
      ...(process.versions.icu ? { icuVersion: process.versions.icu } : {}),
      ...(process.versions.tz ? { tzdbVersion: process.versions.tz } : {}),
      ...(process.versions.unicode ? { unicodeVersion: process.versions.unicode } : {}),
      ...(process.versions.cldr ? { cldrVersion: process.versions.cldr } : {}),
    })
    expect(chart.timeProfile?.runtimeProvenance).toEqual(provenance)
    expect(Object.keys(provenance).sort()).toEqual([
      'cldrVersion', 'icuVersion', 'nodeVersion', 'provider', 'tzdbVersion', 'unicodeVersion',
    ].filter((key) => key === 'provider' || Object.prototype.hasOwnProperty.call(provenance, key)).sort())
  })

  it('keeps runtime provenance stable across repeated calculations in one process', () => {
    const input = { date: '2000-01-01', time: '12:00', locationName: '北京', longitude: 116.4074 }

    expect(calculateBazi(input).timeProfile?.runtimeProvenance)
      .toEqual(calculateBazi(input).timeProfile?.runtimeProvenance)
  })

  it('returns traceable four-pillar output', () => {
    const result = calculateBazi({ date: '1992-08-18', time: '09:30', locationName: '杭州', longitude: 120.155 })
    expect(result.pillars).toHaveLength(4)
    expect(result.ruleVersion).toBe('bazi-v5-stem-branch-relations')
    expect(result.timeCorrectionRuleVersion).toContain('true-solar')
    expect(result.inputSnapshot).toMatchObject({ calendarSystem: 'solar', timezone: 'Asia/Shanghai', useTrueSolarTime: true })
    expect(result.inputSnapshot?.timeCorrectionRuleVersion).toBe('true-solar-v2-zone-meridian-equation-of-time')
    expect(result.timeProfile?.timeCorrectionRuleVersion).toBe('true-solar-v2-zone-meridian-equation-of-time')
    expect(result.dayMaster?.stem).toBe(result.pillars[2][0])
    expect(result.fiveElements?.method).toBe('visible-stems-and-branches-v1')
    expect(Object.values(result.fiveElements?.counts ?? {}).reduce((a, b) => a + b, 0)).toBe(8)
    expect(result.tenGods).toHaveLength(4)
    expect(result.hiddenStems).toHaveLength(4)
    expect(result.hiddenStems?.every((items) => items.length > 0)).toBe(true)
    expect(result.luckCycles).toEqual([])
    expect(result.annualCycles).toBeUndefined()
    expect(result.monthlyCycles).toBeUndefined()
    expect(result.dailyCycles).toBeUndefined()
    expect(result.hourlyCycles).toBeUndefined()
    expect(result.professional?.naYin).toHaveLength(4)
    expect(result.professional?.voidBranches).toHaveLength(4)
    expect(result.professional?.twelveGrowthStages).toHaveLength(4)
    expect(result.professional?.method).toBe('lunar-typescript-eight-char-v1')
    expect(result.professional?.ruleVersion).toBe('professional-v1-lunar-typescript')
    expect(result.pillarDetails).toHaveLength(4)
    expect(result.pillarDetails?.every((detail, index) => detail.pillar === result.pillars[index])).toBe(true)
    expect(result.pillarDetails?.every((detail) => detail.hiddenStems.length > 0)).toBe(true)
    expect(result.pillarDetails?.every((detail) => detail.hiddenStems.every((hidden) => hidden.tenGod.length > 0))).toBe(true)
    expect(result.pillarDetails?.every((detail) => detail.shenSha.status === 'derived')).toBe(true)
    expect(result.pillarDetails?.every((detail) => detail.shenSha.ruleVersion === 'shensha-baseline-v1-transparent-rules')).toBe(true)
  })

  it('derives deterministic earthly-branch relations', () => {
    const result = calculateBazi({
      date: '1992-08-21',
      time: '12:03',
      locationName: '浙江省 杭州市 西湖区',
      longitude: 120.13333,
      latitude: 30.26667,
      timezone: 'Asia/Shanghai',
      useTrueSolarTime: true,
      dstPolicy: 'auto',
      dayBoundary: 'midnight',
      luckMethod: 'sect1',
      gender: 'male',
    })
    expect(result.pillars).toEqual(['壬申', '戊申', '己巳', '庚午'])
    expect(result.relations?.map((relation) => relation.detail)).toEqual(expect.arrayContaining([
      '巳申六合',
    ]))
  })

  it('derives transparent baseline ShenSha names without relying on the model', () => {
    const result = calculateBazi({
      date: '1992-08-21',
      time: '12:03',
      locationName: '浙江省 杭州市 西湖区',
      longitude: 120.13333,
      latitude: 30.26667,
      timezone: 'Asia/Shanghai',
      useTrueSolarTime: true,
      dstPolicy: 'auto',
      dayBoundary: 'midnight',
      luckMethod: 'sect1',
      gender: 'male',
    })

    expect(result.pillars).toEqual(['壬申', '戊申', '己巳', '庚午'])
    expect(result.pillarDetails?.map((pillar) => pillar.shenSha.names)).toEqual([
      expect.arrayContaining(['天乙贵人']),
      expect.arrayContaining(['天乙贵人']),
      expect.arrayContaining(['羊刃']),
      expect.arrayContaining(['桃花', '禄神']),
    ])
  })

  it('keeps derived fields deterministic for the same input', () => {
    const input = { date: '2000-01-01', time: '12:00', locationName: '北京', longitude: 116.4074 }
    expect(calculateBazi(input)).toEqual(calculateBazi(input))
  })

  it('uses true-solar-v3 only when explicitly selected and records the resolved version', () => {
    const birth = {
      date: '2024-11-03', time: '12:00', locationName: '杭州', longitude: 120,
      timezone: 'Asia/Shanghai', useTrueSolarTime: true,
      timeCorrectionRuleVersion: 'true-solar-v3-standard-time-equation-of-time',
    } as const
    const v3 = calculateBazi(birth)
    const legacyDefault = calculateBazi({ ...birth, timeCorrectionRuleVersion: undefined })

    expect(v3.timeCorrectionRuleVersion).toBe('true-solar-v3-standard-time-equation-of-time')
    expect(v3.inputSnapshot?.timeCorrectionRuleVersion).toBe(v3.timeCorrectionRuleVersion)
    expect(v3.timeProfile?.timeCorrectionRuleVersion).toBe(v3.timeCorrectionRuleVersion)
    expect(legacyDefault.timeCorrectionRuleVersion).toBe('true-solar-v2-zone-meridian-equation-of-time')
    expect(v3.correctionMinutes).toBe(16.36)
    expect(legacyDefault.correctionMinutes).toBe(16.29)
  })

  it('fails closed for an ambiguous DST fallback wall time under v3', () => {
    expect(() => calculateBazi({
      date: '2024-11-03', time: '01:30', locationName: '纽约', longitude: -74,
      timezone: 'America/New_York', dstPolicy: 'auto', useTrueSolarTime: true,
      timeCorrectionRuleVersion: 'true-solar-v3-standard-time-equation-of-time',
    })).toThrow('birth time is ambiguous')
  })

  it('keeps dynamic flow cycles out of the immutable birth chart', () => {
    const result = calculateBazi({ date: '1992-08-18', time: '09:30', locationName: '杭州', longitude: 120.155, gender: 'male' })
    expect(result.annualCycles).toBeUndefined()
    expect(result.monthlyCycles).toBeUndefined()
    expect(result.dailyCycles).toBeUndefined()
    expect(result.hourlyCycles).toBeUndefined()
    expect(result.assessments?.strength.status).toBe('pending-school-rule')
    expect(result.assessments?.strength.reason).toBe('legacy-profile')
    expect(result.assessments?.strength.conclusion).toBeUndefined()
    expect(result.assessments?.pattern.status).toBe('pending-school-rule')
    expect(result.assessments?.pattern.ruleVersion).toBe('assessment-standard-v1')
    expect(result.assessments?.shenSha.status).toBe('pending-school-rule')
    expect(result.assessments?.shenSha.ruleVersion).toBe('assessment-standard-v1')
  })

  it('rejects malformed inputs before deriving professional fields', () => {
    expect(() => calculateBazi({ date: 'not-a-date', time: '12:00', locationName: '北京', longitude: 116 })).toThrow()
    expect(() => calculateBazi({ date: '2024-01-01', time: '12:00', locationName: '北京', longitude: 200 })).toThrow('longitude')
  })

  it.each([
    ['2024-02-31', '09:30'],
    ['2023-02-29', '09:30'],
    ['2024-00-10', '09:30'],
    ['2024-13-10', '09:30'],
    ['2024-01-00', '09:30'],
    ['0000-01-01', '09:30'],
    ['2024-01-01', '24:00'],
    ['2024-01-01', '23:60'],
    ['2024-01-01', '24:99'],
  ])('rejects impossible wall time %s %s', (date, time) => {
    expect(() =>
      calculateBazi({ date, time, locationName: '北京', longitude: 116.4074 }),
    ).toThrow()
  })

  it.each([
    ['2024-02-29', '00:00'],
    ['2024-12-31', '23:59'],
    ['0001-01-01', '00:00'],
    ['9999-12-31', '23:59'],
  ])('accepts valid boundary wall time %s %s', (date, time) => {
    expect(() =>
      calculateBazi({ date, time, locationName: '北京', longitude: 116.4074 }),
    ).not.toThrow()
  })

  it('applies true-solar correction across the previous-day boundary', () => {
    const result = calculateBazi({
      date: '2024-01-01',
      time: '00:10',
      locationName: '乌恰',
      longitude: 87.6168,
    })
    expect(result.correctedLocalTime.startsWith('2023-12-31T')).toBe(true)
    expect(result.correctionMinutes).toBeLessThan(0)
  })

  it('keeps the verified WenZhen Urumqi sample stable at minute granularity', () => {
    const result = calculateBazi({
      date: '1990-06-21',
      time: '12:00',
      locationName: '新疆维吾尔自治区 乌鲁木齐市 天山区',
      longitude: 87.6317,
      latitude: 43.7944,
      timezone: 'Asia/Shanghai',
      useTrueSolarTime: true,
      dstPolicy: 'ignore',
      dayBoundary: 'midnight',
      luckMethod: 'sect1',
      gender: 'male',
    })

    expect(result.correctionMinutes).toBe(-130.97)
    expect(result.correctedLocalTime).toBe('1990-06-21T09:49')
    expect(result.pillars).toEqual(['庚午', '壬午', '丁巳', '乙巳'])
  })

  it('rounds fractional true-solar seconds to the nearest displayed minute', () => {
    const result = calculateBazi({
      date: '2000-01-01',
      time: '23:30',
      locationName: '北京市 北京市 海淀区',
      longitude: 116.298,
      latitude: 39.9593,
      timezone: 'Asia/Shanghai',
      useTrueSolarTime: true,
      dstPolicy: 'auto',
      dayBoundary: 'midnight',
      luckMethod: 'sect1',
      gender: 'male',
    })

    expect(result.correctionMinutes).toBe(-18.41)
    expect(result.correctedLocalTime).toBe('2000-01-01T23:12')
    expect(result.pillars).toEqual(['己卯', '丙子', '戊午', '甲子'])
  })

  it('can explicitly keep civil time without true-solar correction', () => {
    const result = calculateBazi({
      date: '2024-01-01', time: '00:10', locationName: '新疆维吾尔自治区克孜勒苏柯尔克孜自治州乌恰县',
      province: '新疆维吾尔自治区', city: '克孜勒苏柯尔克孜自治州', district: '乌恰县',
      placeCode: '653024', geoDataVersion: '2026.08-demo.1',
      longitude: 87.6168, latitude: 39.7162, timezone: 'Asia/Shanghai', useTrueSolarTime: false,
    })
    expect(result.correctedLocalTime).toBe('2024-01-01T00:10')
    expect(result.correctionMinutes).toBe(0)
    expect(result.timeCorrectionRuleVersion).toBe('civil-time-v1-no-solar-correction')
    expect(result.inputSnapshot).toMatchObject({ district: '乌恰县', placeCode: '653024', geoDataVersion: '2026.08-demo.1', latitude: 39.7162, useTrueSolarTime: false })
  })

  it('converts a lunar input to the equivalent solar input before calculation', () => {
    const lunar = calculateBazi({
      calendarSystem: 'lunar', date: '2024-01-01', time: '12:00', locationName: '北京市北京市东城区',
      longitude: 116.4074, latitude: 39.9042, timezone: 'Asia/Shanghai', useTrueSolarTime: false,
    })
    const solar = calculateBazi({
      calendarSystem: 'solar', date: '2024-02-10', time: '12:00', locationName: '北京市北京市东城区',
      longitude: 116.4074, latitude: 39.9042, timezone: 'Asia/Shanghai', useTrueSolarTime: false,
    })
    expect(lunar.pillars).toEqual(solar.pillars)
    expect(lunar.inputSnapshot).toMatchObject({
      calendarSystem: 'lunar', sourceDate: '2024-01-01', normalizedSolarDate: '2024-02-10', lunarLeapMonth: false,
    })
    expect(lunar.calendarRuleVersion).toBe('calendar-v2-round-trip-lunar-typescript')
  })

  it('rejects invalid geographic and time-zone metadata', () => {
    expect(() => calculateBazi({ date: '2024-01-01', time: '12:00', locationName: '未知', longitude: 120, latitude: 91 })).toThrow('latitude')
    expect(() => calculateBazi({ date: '2024-01-01', time: '12:00', locationName: '未知', longitude: 120, timezone: 'Shanghai' })).toThrow('timezone')
  })

  it('rejects a non-finite longitude instead of passing range checks', () => {
    expect(() =>
      calculateBazi({ date: '2024-01-01', time: '12:00', locationName: '未知', longitude: Number.NaN }),
    ).toThrow('longitude')
  })

  it('round-trips a solar date and its lunar representation', () => {
    const solar = convertCalendarDate({ calendarSystem: 'solar', date: '2024-02-10', time: '12:00' })
    const lunar = convertCalendarDate({ calendarSystem: 'lunar', date: solar.lunarDate, time: '12:00', lunarLeapMonth: solar.lunarLeapMonth })
    expect(solar).toMatchObject({ solarDate: '2024-02-10', lunarDate: '2024-01-01', lunarLeapMonth: false })
    expect(lunar).toEqual(solar)
  })

  it('projects the authoritative 2023 leap-second-month sequence and month sizes', () => {
    expect(getLunarYearProfile(2023)).toEqual({
      year: 2023,
      leapMonth: 2,
      months: [
        { month: 1, leap: false, days: 29 },
        { month: 2, leap: false, days: 30 },
        { month: 2, leap: true, days: 29 },
        { month: 3, leap: false, days: 29 },
        { month: 4, leap: false, days: 30 },
        { month: 5, leap: false, days: 30 },
        { month: 6, leap: false, days: 29 },
        { month: 7, leap: false, days: 30 },
        { month: 8, leap: false, days: 30 },
        { month: 9, leap: false, days: 29 },
        { month: 10, leap: false, days: 30 },
        { month: 11, leap: false, days: 29 },
        { month: 12, leap: false, days: 30 },
      ],
      ruleVersion: CALENDAR_RULE_VERSION,
    })
  })

  it('represents a year without a leap month and rejects unsupported years', () => {
    const profile = getLunarYearProfile(2024)
    expect(profile.leapMonth).toBeNull()
    expect(profile.months).toHaveLength(12)
    expect(getLunarYearProfile(1801).year).toBe(1801)
    expect(getLunarYearProfile(2100).year).toBe(2100)
    expect(() => getLunarYearProfile(1800)).toThrow('lunar year must be an integer between 1801 and 2100')
    expect(() => getLunarYearProfile(2101)).toThrow('lunar year must be an integer between 1801 and 2100')
    expect(() => getLunarYearProfile(2023.5)).toThrow('lunar year must be an integer between 1801 and 2100')
  })

  it('returns a fresh lunar-year profile without shared mutable cache state', () => {
    const first = getLunarYearProfile(2023)
    first.months[0]!.days = 30
    const second = getLunarYearProfile(2023)
    expect(second.months[0]).toEqual({ month: 1, leap: false, days: 29 })
  })

  it('strictly validates nonexistent leap months and regular and leap month day boundaries', () => {
    expect(() => convertCalendarDate({ calendarSystem: 'lunar', date: '2024-02-01', time: '12:00', lunarLeapMonth: true })).toThrow('birth date is not a valid lunar calendar date')
    expect(() => convertCalendarDate({ calendarSystem: 'lunar', date: '2023-01-30', time: '12:00', lunarLeapMonth: false })).toThrow('birth date is not a valid lunar calendar date')

    const regularBigMonthBoundary = convertCalendarDate({ calendarSystem: 'lunar', date: '2023-02-30', time: '12:00', lunarLeapMonth: false })
    const leapSmallMonthBoundary = convertCalendarDate({ calendarSystem: 'lunar', date: '2023-02-29', time: '12:00', lunarLeapMonth: true })
    expect(regularBigMonthBoundary).toMatchObject({ lunarDate: '2023-02-30', lunarLeapMonth: false })
    expect(leapSmallMonthBoundary).toMatchObject({ lunarDate: '2023-02-29', lunarLeapMonth: true })
    expect(() => convertCalendarDate({ calendarSystem: 'lunar', date: '2023-02-30', time: '12:00', lunarLeapMonth: true })).toThrow('birth date is not a valid lunar calendar date')
  })

  it('round-trips representative dates for every month from 1900 through 2100', () => {
    for (let year = 1900; year <= 2100; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        for (const day of [1, 15]) {
          const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const solar = convertCalendarDate({ calendarSystem: 'solar', date, time: '12:00' })
          const back = convertCalendarDate({ calendarSystem: 'lunar', date: solar.lunarDate, time: '12:00', lunarLeapMonth: solar.lunarLeapMonth })
          expect(back.solarDate).toBe(date)
        }
      }
    }
  })

  it('changes the day pillar at 23:00 only for the selected Zi-hour boundary rule', () => {
    const input = { date: '2024-01-01', time: '23:30', locationName: '北京', longitude: 116.4, timezone: 'Asia/Shanghai', useTrueSolarTime: false } as const
    const midnight = calculateBazi({ ...input, dayBoundary: 'midnight' })
    const ziHour = calculateBazi({ ...input, dayBoundary: 'zi-hour-start' })
    expect(midnight.pillars[2]).toBe('甲子')
    expect(ziHour.pillars[2]).toBe('乙丑')
    expect(ziHour.inputSnapshot?.dayBoundary).toBe('zi-hour-start')
  })

  it('applies historical IANA daylight saving time when requested', () => {
    const input = { date: '2024-07-01', time: '12:00', locationName: '纽约', longitude: -74, timezone: 'America/New_York', useTrueSolarTime: false } as const
    const automatic = calculateBazi({ ...input, dstPolicy: 'auto' })
    const ignored = calculateBazi({ ...input, dstPolicy: 'ignore' })
    expect(automatic.correctedLocalTime).toBe('2024-07-01T11:00')
    expect(ignored.correctedLocalTime).toBe('2024-07-01T12:00')
    expect(automatic.inputSnapshot).toMatchObject({ utcOffsetMinutes: -240, standardUtcOffsetMinutes: -300, daylightSavingMinutes: 60 })
  })

  it('rejects a civil time that never existed during a DST jump', () => {
    expect(() => calculateBazi({
      date: '2024-03-10', time: '02:30', locationName: '纽约', longitude: -74,
      timezone: 'America/New_York', useTrueSolarTime: false, dstPolicy: 'auto',
    })).toThrow('does not exist')
  })

  it('records an ambiguous repeated civil time for reproducibility', () => {
    const result = calculateBazi({
      date: '2024-11-03', time: '01:30', locationName: '纽约', longitude: -74,
      timezone: 'America/New_York', useTrueSolarTime: false, dstPolicy: 'auto',
    })
    expect(result.inputSnapshot?.timeAmbiguous).toBe(true)
  })

  it('pins the 2024 LiChun year and month pillar boundary at minute precision', () => {
    const input = { date: '2024-02-04', locationName: '北京', longitude: 116.4, timezone: 'Asia/Shanghai', useTrueSolarTime: false, dstPolicy: 'ignore' } as const
    expect(calculateBazi({ ...input, time: '16:27' }).pillars.slice(0, 2)).toEqual(['癸卯', '乙丑'])
    expect(calculateBazi({ ...input, time: '16:28' }).pillars.slice(0, 2)).toEqual(['甲辰', '丙寅'])
  })

  it('records the selected start-of-luck algorithm and its observable date difference', () => {
    const input = { date: '1992-08-18', time: '09:30', locationName: '杭州', longitude: 120.13, timezone: 'Asia/Shanghai', useTrueSolarTime: false, gender: 'male' } as const
    const sect1 = calculateBazi({ ...input, luckMethod: 'sect1' })
    const sect2 = calculateBazi({ ...input, luckMethod: 'sect2' })
    expect(sect1.inputSnapshot?.luckMethod).toBe('sect1')
    expect(sect2.inputSnapshot?.luckMethod).toBe('sect2')
    expect(sect1.luckCycles?.[0]?.startDate).toBe('1999-05-28')
    expect(sect2.luckCycles?.[0]?.startDate).toBe('1999-05-27')
  })
})
