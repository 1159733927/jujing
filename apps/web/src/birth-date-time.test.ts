import { describe, expect, it } from 'vitest'
import {
  canConfirmBirthDateTime,
  commitBirthDateTimeDraft,
  compactBirthYear,
  createBirthDateTimeDraft,
  daysInMonth,
  parseCompactBirth,
  pickerDaysInMonth,
  updateBirthDateTimeDraft,
} from './main'
import type { LunarYearProfile } from './lunar-year-profile'

const lunar2023: LunarYearProfile = {
  year: 2023,
  leapMonth: 2,
  ruleVersion: 'calendar-test-v1',
  months: [
    { month: 1, leap: false, days: 30 },
    { month: 2, leap: false, days: 30 },
    { month: 2, leap: true, days: 29 },
    ...Array.from({ length: 10 }, (_, index) => ({
      month: index + 3,
      leap: false,
      days: (index % 2 === 0 ? 29 : 30) as 29 | 30,
    })),
  ],
}

const birth = {
  date: '1992-08-18',
  time: '09:30',
  calendarSystem: 'solar' as const,
  locationName: '浙江省 杭州市 西湖区',
  longitude: 120.13333,
  latitude: 30.26667,
  timezone: 'Asia/Shanghai',
  province: '浙江省',
  city: '杭州市',
  district: '西湖区',
  placeCode: '330106',
  geoDataVersion: 'geo-v1',
}

describe('birth date/time picker draft', () => {
  it('handles Gregorian leap-year and month boundaries', () => {
    expect(daysInMonth(2000, 2)).toBe(29)
    expect(daysInMonth(1900, 2)).toBe(28)
    expect(pickerDaysInMonth('solar', 2026, 4)).toBe(30)
    expect(parseCompactBirth('200002291230', 'solar')).toEqual({ date: '2000-02-29', time: '12:30' })
    expect(parseCompactBirth('190002290800', 'solar')).toBeUndefined()
  })

  it('requires the year profile and enforces a lunar month actual day count', () => {
    expect(pickerDaysInMonth('lunar', 2023, 2)).toBe(0)
    expect(pickerDaysInMonth('lunar', 2023, 2, lunar2023, true)).toBe(29)
    expect(parseCompactBirth('202302291200', 'lunar', lunar2023, true)).toEqual({ date: '2023-02-29', time: '12:00' })
    expect(parseCompactBirth('202302301200', 'lunar', lunar2023, true)).toBeUndefined()
    expect(parseCompactBirth('202302291200', 'lunar')).toBeUndefined()
  })

  it('rejects malformed dates, times, and out-of-range years', () => {
    expect(parseCompactBirth('not-a-date')).toBeUndefined()
    expect(parseCompactBirth('180012311200')).toBeUndefined()
    expect(parseCompactBirth('199201012460')).toBeUndefined()
    expect(compactBirthYear('202302291200')).toBe(2023)
    expect(compactBirthYear('210102291200')).toBeUndefined()
  })

  it('keeps edits in a draft until explicit confirmation', () => {
    const original = { ...birth }
    const draft = updateBirthDateTimeDraft(createBirthDateTimeDraft(original), { year: 2024, month: 2, day: 29, hour: 23 })

    expect(original).toEqual(birth)
    expect(draft).toMatchObject({ date: '2024-02-29', time: '23:30' })
    expect(commitBirthDateTimeDraft(original, draft)).toMatchObject({ date: '2024-02-29', time: '23:30' })
  })

  it('clamps a draft day when changing to a shorter month or lunar interpretation', () => {
    const january31 = { ...createBirthDateTimeDraft(birth), date: '2024-01-31' }
    expect(updateBirthDateTimeDraft(january31, { month: 2 }).date).toBe('2024-02-29')
    const lunarDay30 = { ...january31, calendarSystem: 'lunar' as const, date: '2023-03-30' }
    expect(updateBirthDateTimeDraft(lunarDay30, {}, lunar2023).date).toBe('2023-03-29')
  })

  it('commits leap-month state only for lunar input', () => {
    const lunarDraft = { ...createBirthDateTimeDraft(birth), calendarSystem: 'lunar' as const, lunarLeapMonth: true }
    expect(commitBirthDateTimeDraft(birth, lunarDraft)).toMatchObject({ calendarSystem: 'lunar', lunarLeapMonth: true })
    expect(commitBirthDateTimeDraft(birth, { ...lunarDraft, calendarSystem: 'solar' })).toMatchObject({ calendarSystem: 'solar', lunarLeapMonth: false })
  })

  it('clamps and clears an unavailable leap selection when the profile changes', () => {
    const draft = { ...createBirthDateTimeDraft(birth), date: '2023-02-30', calendarSystem: 'lunar' as const, lunarLeapMonth: true }
    const leap = updateBirthDateTimeDraft(draft, {}, lunar2023)
    expect(leap).toMatchObject({ date: '2023-02-29', lunarLeapMonth: true })

    const noLeap = { ...lunar2023, leapMonth: null, months: lunar2023.months.filter((month) => !month.leap) }
    expect(updateBirthDateTimeDraft(leap, {}, noLeap)).toMatchObject({ date: '2023-02-29', lunarLeapMonth: false })
  })

  it('blocks lunar confirmation while its profile is loading or failed', () => {
    const draft = { ...createBirthDateTimeDraft(birth), date: '2023-02-29', calendarSystem: 'lunar' as const, lunarLeapMonth: true }
    expect(canConfirmBirthDateTime('lunar', draft, lunar2023, false, '')).toBe(true)
    expect(canConfirmBirthDateTime('lunar', draft, lunar2023, true, '')).toBe(false)
    expect(canConfirmBirthDateTime('lunar', draft, undefined, false, 'network failed')).toBe(false)
    expect(canConfirmBirthDateTime('solar', { ...draft, calendarSystem: 'solar' }, undefined, false, 'network failed')).toBe(true)
  })
})
