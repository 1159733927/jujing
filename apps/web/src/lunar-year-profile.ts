export type LunarMonthProfile = {
  month: number
  leap: boolean
  days: 29 | 30
}

export type LunarYearProfile = {
  year: number
  leapMonth: number | null
  months: LunarMonthProfile[]
  ruleVersion: string
}

export type LunarMonthOption = LunarMonthProfile & {
  key: string
  label: string
}

const LUNAR_MONTH_LABELS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Treat the calendar profile as rule data, not presentation data. Invalid or
 * internally inconsistent payloads are rejected instead of falling back to a
 * fictitious 30-day lunar month.
 */
export function normalizeLunarYearProfile(value: unknown, expectedYear?: number): LunarYearProfile {
  if (!isRecord(value)) throw new Error('农历年份资料格式无效。')
  const year = value.year
  const leapMonth = value.leapMonth
  const ruleVersion = value.ruleVersion
  if (!Number.isInteger(year) || Number(year) < 1801 || Number(year) > 2100 || (expectedYear !== undefined && year !== expectedYear)) {
    throw new Error('农历年份资料与所选年份不一致。')
  }
  if (leapMonth !== null && (!Number.isInteger(leapMonth) || Number(leapMonth) < 1 || Number(leapMonth) > 12)) {
    throw new Error('农历闰月资料无效。')
  }
  if (typeof ruleVersion !== 'string' || ruleVersion.trim() === '') throw new Error('农历年份资料缺少规则版本。')
  if (!Array.isArray(value.months)) throw new Error('农历月份资料无效。')

  const months = value.months.map((entry): LunarMonthProfile => {
    if (!isRecord(entry) || !Number.isInteger(entry.month) || Number(entry.month) < 1 || Number(entry.month) > 12 || typeof entry.leap !== 'boolean' || (entry.days !== 29 && entry.days !== 30)) {
      throw new Error('农历月份资料包含无效记录。')
    }
    return { month: Number(entry.month), leap: entry.leap, days: entry.days }
  })
  const keys = months.map((month) => `${month.month}:${month.leap ? 'leap' : 'normal'}`)
  if (new Set(keys).size !== keys.length) throw new Error('农历月份资料包含重复月份。')
  for (let month = 1; month <= 12; month += 1) {
    if (!months.some((entry) => entry.month === month && !entry.leap)) throw new Error('农历年份资料缺少常规月份。')
  }
  const leapEntries = months.filter((month) => month.leap)
  if (leapMonth === null) {
    if (leapEntries.length !== 0 || months.length !== 12) throw new Error('农历闰月资料前后不一致。')
  } else if (leapEntries.length !== 1 || leapEntries[0]?.month !== leapMonth || months.length !== 13) {
    throw new Error('农历闰月资料前后不一致。')
  }

  return {
    year: Number(year),
    leapMonth: leapMonth === null ? null : Number(leapMonth),
    months: [...months].sort((left, right) => left.month - right.month || Number(left.leap) - Number(right.leap)),
    ruleVersion: ruleVersion.trim(),
  }
}

export function lunarMonthOptions(profile: LunarYearProfile): LunarMonthOption[] {
  return profile.months.map((month) => ({
    ...month,
    key: `${month.month}:${month.leap ? 'leap' : 'normal'}`,
    label: `${month.leap ? '闰' : ''}${LUNAR_MONTH_LABELS[month.month - 1]}`,
  }))
}

export function lunarMonthDays(profile: LunarYearProfile | undefined, month: number, leap: boolean): 29 | 30 | undefined {
  return profile?.months.find((entry) => entry.month === month && entry.leap === leap)?.days
}

export function isLunarDateValid(profile: LunarYearProfile | undefined, year: number, month: number, day: number, leap: boolean): boolean {
  if (!profile || profile.year !== year) return false
  const days = lunarMonthDays(profile, month, leap)
  return days !== undefined && Number.isInteger(day) && day >= 1 && day <= days
}
