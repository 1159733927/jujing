import { describe, expect, it } from 'vitest'
import {
  TRUE_SOLAR_TIME_V3_RULE_VERSION,
  calculateTrueSolarTimeV3,
} from '../src/index.js'

const expectCloseMinutes = (actual: number, expected: number, tolerance = 0.35) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

describe('calculateTrueSolarTimeV3', () => {
  it('records the v3 true-solar-time rule version', () => {
    const result = calculateTrueSolarTimeV3({
      date: '2024-11-03',
      time: '12:00',
      longitude: 120,
      timezone: 'Asia/Shanghai',
      dstPolicy: 'ignore',
    })

    expect(result.ruleVersion).toBe(TRUE_SOLAR_TIME_V3_RULE_VERSION)
  })

  it('uses only equation-of-time correction at the standard meridian', () => {
    const result = calculateTrueSolarTimeV3({
      date: '2024-11-03',
      time: '12:00',
      longitude: 120,
      timezone: 'Asia/Shanghai',
      dstPolicy: 'ignore',
    })

    expect(result.standardMeridian).toBe(120)
    expectCloseMinutes(result.longitudeCorrectionMinutes, 0, 0.01)
    expectCloseMinutes(result.equationOfTimeMinutes, 16.36)
    expectCloseMinutes(result.trueSolarCorrectionMinutes, 16.36)
    expect(result.correctedLocalTime).toBe('2024-11-03T12:16')
  })

  it.each([
    ['2024-02-11', -14.2],
    ['2024-05-14', 3.93],
    ['2024-07-26', -6.58],
    ['2024-11-03', 16.36],
  ])('matches public equation-of-time seasonal reference for %s', (date, expectedMinutes) => {
    const result = calculateTrueSolarTimeV3({
      date,
      time: '12:00',
      longitude: 120,
      timezone: 'Asia/Shanghai',
      dstPolicy: 'ignore',
    })

    expectCloseMinutes(result.equationOfTimeMinutes, expectedMinutes)
  })

  it('returns positive longitude correction east of the standard meridian', () => {
    const result = calculateTrueSolarTimeV3({
      date: '2024-06-21',
      time: '12:00',
      longitude: 121,
      timezone: 'Asia/Shanghai',
      dstPolicy: 'ignore',
    })

    expectCloseMinutes(result.longitudeCorrectionMinutes, 4, 0.01)
  })

  it('returns negative longitude correction west of the standard meridian', () => {
    const result = calculateTrueSolarTimeV3({
      date: '2024-06-21',
      time: '12:00',
      longitude: 119,
      timezone: 'Asia/Shanghai',
      dstPolicy: 'ignore',
    })

    expectCloseMinutes(result.longitudeCorrectionMinutes, -4, 0.01)
  })

  it('carries corrected true solar time across the previous-day boundary', () => {
    const result = calculateTrueSolarTimeV3({
      date: '2024-01-01',
      time: '00:30',
      longitude: 87,
      timezone: 'Asia/Shanghai',
      dstPolicy: 'ignore',
    })

    expect(result.correctedLocalTime).toBe('2023-12-31T22:15')
  })

  it('separates automatic DST normalization from true-solar correction', () => {
    const result = calculateTrueSolarTimeV3({
      date: '2024-07-01',
      time: '12:00',
      longitude: -74,
      timezone: 'America/New_York',
      dstPolicy: 'auto',
    })

    expect(result.standardMeridian).toBe(-75)
    expect(result.daylightSavingMinutes).toBe(60)
    expect(result.standardLocalTime).toBe('2024-07-01T11:00')
    expectCloseMinutes(result.longitudeCorrectionMinutes, 4, 0.01)
  })

  it('does not subtract DST when policy is ignore', () => {
    const result = calculateTrueSolarTimeV3({
      date: '2024-07-01',
      time: '12:00',
      longitude: -74,
      timezone: 'America/New_York',
      dstPolicy: 'ignore',
    })

    expect(result.daylightSavingMinutes).toBe(0)
    expect(result.standardLocalTime).toBe('2024-07-01T12:00')
  })

  it('rejects an ambiguous DST fallback wall time unless an occurrence is selected', () => {
    expect(() => calculateTrueSolarTimeV3({
      date: '2024-11-03',
      time: '01:30',
      longitude: -74,
      timezone: 'America/New_York',
      dstPolicy: 'auto',
    })).toThrow('birth time is ambiguous')
  })

  it('makes the selected occurrence of an ambiguous DST wall time explicit', () => {
    const earlier = calculateTrueSolarTimeV3({
      date: '2024-11-03', time: '01:30', longitude: -74,
      timezone: 'America/New_York', dstPolicy: 'auto', ambiguousTimePolicy: 'earlier',
    })
    const later = calculateTrueSolarTimeV3({
      date: '2024-11-03', time: '01:30', longitude: -74,
      timezone: 'America/New_York', dstPolicy: 'auto', ambiguousTimePolicy: 'later',
    })

    expect(earlier.timeAmbiguous).toBe(true)
    expect(later.timeAmbiguous).toBe(true)
    expect(earlier.daylightSavingMinutes).toBe(60)
    expect(later.daylightSavingMinutes).toBe(0)
    expect(earlier.standardLocalTime).toBe('2024-11-03T00:30')
    expect(later.standardLocalTime).toBe('2024-11-03T01:30')
  })

  it('accepts UTC as a valid Intl time-zone identifier', () => {
    const result = calculateTrueSolarTimeV3({
      date: '2024-06-21', time: '12:00', longitude: 0,
      timezone: 'UTC', dstPolicy: 'ignore',
    })

    expect(result.standardMeridian).toBe(0)
    expect(result.daylightSavingMinutes).toBe(0)
  })

  it('rounds sub-thirty-second corrections down to the current minute', () => {
    const result = calculateTrueSolarTimeV3({
      date: '2024-06-21',
      time: '12:00',
      longitude: 120.4819,
      timezone: 'Asia/Shanghai',
      dstPolicy: 'ignore',
    })

    expect(result.correctedLocalTime).toBe('2024-06-21T12:00')
  })

  it('rounds thirty-second-or-greater corrections up to the next minute', () => {
    const result = calculateTrueSolarTimeV3({
      date: '2024-06-21',
      time: '12:00',
      longitude: 120.4903,
      timezone: 'Asia/Shanghai',
      dstPolicy: 'ignore',
    })

    expect(result.correctedLocalTime).toBe('2024-06-21T12:01')
  })
})
