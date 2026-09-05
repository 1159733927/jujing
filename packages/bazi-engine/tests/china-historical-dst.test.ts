import { describe, expect, it } from 'vitest'
import { calculateBazi } from '../src/index.js'

const HISTORICAL_DST_SEASONS = [
  { year: 1986, startsOn: '05-04', endsOn: '09-14' },
  { year: 1987, startsOn: '04-12', endsOn: '09-13' },
  { year: 1988, startsOn: '04-17', endsOn: '09-11' },
  { year: 1989, startsOn: '04-16', endsOn: '09-17' },
  { year: 1990, startsOn: '04-15', endsOn: '09-16' },
  { year: 1991, startsOn: '04-14', endsOn: '09-15' },
] as const

const baseInput = {
  locationName: '北京市 北京市 东城区',
  longitude: 116.4164,
  latitude: 39.9286,
  timezone: 'Asia/Shanghai',
  useTrueSolarTime: false,
  dayBoundary: 'midnight',
  gender: 'male',
  timeCorrectionRuleVersion: 'true-solar-v3-standard-time-equation-of-time',
} as const

function calculateAt(date: string, time: string, dstPolicy: 'auto' | 'ignore' = 'auto') {
  return calculateBazi({ ...baseInput, date, time, dstPolicy })
}

describe('China historical daylight-saving time (1986-1991)', () => {
  describe.each(HISTORICAL_DST_SEASONS)('$year season', ({ year, startsOn, endsOn }) => {
    const startDate = `${year}-${startsOn}`
    const endDate = `${year}-${endsOn}`

    it('uses UTC+8 immediately before the spring gap', () => {
      const chart = calculateAt(startDate, '01:59')

      expect(chart.timeProfile).toMatchObject({
        utcOffsetMinutes: 480,
        standardUtcOffsetMinutes: 480,
        daylightSavingMinutes: 0,
      })
      expect(chart.correctedLocalTime).toBe(`${startDate}T01:59`)
    })

    it.each(['02:00', '02:30', '02:59'])('rejects nonexistent spring wall time %s', (time) => {
      expect(() => calculateAt(startDate, time)).toThrow(
        'birth time does not exist in the selected timezone because of a clock transition',
      )
    })

    it('uses UTC+9 immediately after the spring gap and normalizes to standard time', () => {
      const chart = calculateAt(startDate, '03:00')

      expect(chart.timeProfile).toMatchObject({
        utcOffsetMinutes: 540,
        standardUtcOffsetMinutes: 480,
        daylightSavingMinutes: 60,
      })
      expect(chart.correctedLocalTime).toBe(`${startDate}T02:00`)
    })

    it('uses UTC+9 immediately before the autumn repeated interval', () => {
      const chart = calculateAt(endDate, '00:59')

      expect(chart.timeProfile).toMatchObject({
        utcOffsetMinutes: 540,
        standardUtcOffsetMinutes: 480,
        daylightSavingMinutes: 60,
      })
    })

    it.each(['01:00', '01:30', '01:59'])('rejects ambiguous autumn wall time %s', (time) => {
      expect(() => calculateAt(endDate, time)).toThrow(
        'birth time is ambiguous in the selected timezone; choose earlier or later occurrence',
      )
    })

    it('returns to UTC+8 immediately after the autumn repeated interval', () => {
      const chart = calculateAt(endDate, '02:00')

      expect(chart.timeProfile).toMatchObject({
        utcOffsetMinutes: 480,
        standardUtcOffsetMinutes: 480,
        daylightSavingMinutes: 0,
      })
      expect(chart.correctedLocalTime).toBe(`${endDate}T02:00`)
    })

    it('normalizes an ordinary summer wall time when DST is automatic', () => {
      const chart = calculateAt(`${year}-07-01`, '12:00')

      expect(chart.timeProfile).toMatchObject({
        utcOffsetMinutes: 540,
        standardUtcOffsetMinutes: 480,
        daylightSavingMinutes: 60,
      })
      expect(chart.correctedLocalTime).toBe(`${year}-07-01T11:00`)
    })

    it('keeps an ordinary summer wall time unchanged when DST is ignored', () => {
      const chart = calculateAt(`${year}-07-01`, '12:00', 'ignore')

      expect(chart.timeProfile).toMatchObject({
        standardUtcOffsetMinutes: 480,
        daylightSavingMinutes: 0,
        dstPolicy: 'ignore',
      })
      expect(chart.correctedLocalTime).toBe(`${year}-07-01T12:00`)
    })
  })

  it('interprets a spring-gap time as a valid fixed-UTC+8 wall time when DST is ignored', () => {
    const chart = calculateAt('1986-05-04', '02:30', 'ignore')
    expect(chart.correctedLocalTime).toBe('1986-05-04T02:30')
    expect(chart.timeProfile).toMatchObject({ utcOffsetMinutes: 480, daylightSavingMinutes: 0 })
    expect(chart.inputSnapshot?.timeAmbiguous).toBeUndefined()
  })

  it('interprets an autumn repeated time as an unambiguous fixed-UTC+8 wall time when DST is ignored', () => {
    const chart = calculateAt('1991-09-15', '01:30', 'ignore')
    expect(chart.correctedLocalTime).toBe('1991-09-15T01:30')
    expect(chart.timeProfile).toMatchObject({ utcOffsetMinutes: 480, daylightSavingMinutes: 0 })
    expect(chart.inputSnapshot?.timeAmbiguous).toBeUndefined()
  })

  it('records the fixed standard offset for an ignored-DST summer wall time', () => {
    const chart = calculateAt('1988-07-01', '12:00', 'ignore')
    expect(chart.inputSnapshot).toMatchObject({
      utcOffsetMinutes: 480,
      standardUtcOffsetMinutes: 480,
      daylightSavingMinutes: 0,
      dstPolicy: 'ignore',
    })
    expect(chart.timeProfile).toMatchObject({ utcOffsetMinutes: 480, standardUtcOffsetMinutes: 480 })
  })
})
