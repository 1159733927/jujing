import { describe, expect, it } from 'vitest'
import { lunarMonthDays, lunarMonthOptions, normalizeLunarYearProfile } from './lunar-year-profile'

function rawProfile(leapMonth: number | null = null) {
  const months = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, leap: false, days: index % 2 === 0 ? 30 : 29 }))
  if (leapMonth !== null) months.splice(leapMonth, 0, { month: leapMonth, leap: true, days: 29 })
  return { year: 2023, leapMonth, months, ruleVersion: 'calendar-v1' }
}

describe('lunar year profile', () => {
  it('exposes 2023 leap second month as a distinct option', () => {
    const profile = normalizeLunarYearProfile(rawProfile(2), 2023)
    expect(lunarMonthOptions(profile).filter((month) => month.month === 2)).toEqual([
      expect.objectContaining({ key: '2:normal', label: '二月', leap: false }),
      expect.objectContaining({ key: '2:leap', label: '闰二月', leap: true, days: 29 }),
    ])
    expect(lunarMonthDays(profile, 2, true)).toBe(29)
  })

  it('does not invent a leap option in a no-leap year', () => {
    const profile = normalizeLunarYearProfile(rawProfile(), 2023)
    expect(lunarMonthOptions(profile)).toHaveLength(12)
    expect(lunarMonthOptions(profile).some((month) => month.leap)).toBe(false)
  })

  it('rejects a leap-month flag that has no matching month record', () => {
    expect(() => normalizeLunarYearProfile({ ...rawProfile(), leapMonth: 2 }, 2023)).toThrow(/闰月资料/)
  })

  it('rejects a response for a different requested year', () => {
    expect(() => normalizeLunarYearProfile(rawProfile(), 2024)).toThrow(/年份/)
  })
})
