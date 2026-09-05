import { describe, expect, it } from 'vitest'
import type { BaziCalculationInput, ManualFourPillarsInput } from '@fengshui/domain'
import { calculateBazi, calculateBaziFromPillars } from '../src/index.js'

const manualInput: ManualFourPillarsInput = {
  inputMode: 'manual-four-pillars',
  pillars: ['壬申', '戊申', '己巳', '庚午'],
  gender: 'male',
}

describe('calculateBaziFromPillars', () => {
  it('accepts a complete tuple of real sexagenary-cycle pillars', () => {
    const input: BaziCalculationInput = manualInput
    const result = calculateBaziFromPillars(input)

    expect(result.inputMode).toBe('manual-four-pillars')
    expect(result.pillars).toEqual(['壬申', '戊申', '己巳', '庚午'])
    expect(result.inputSnapshot).toEqual({ inputMode: 'manual-four-pillars', pillars: manualInput.pillars, gender: 'male' })
  })

  it.each([
    [['甲子', '乙丑', '丙寅'] as unknown as ManualFourPillarsInput['pillars'], 'exactly four'],
    [['甲子', '乙丑', '丙寅', '丁卯', '戊辰'] as unknown as ManualFourPillarsInput['pillars'], 'exactly four'],
    [['甲子', '乙丑', '丙寅', '丁'] as unknown as ManualFourPillarsInput['pillars'], 'sexagenary cycle'],
    [['甲子', '乙丑', '丙寅', '甲甲'] as ManualFourPillarsInput['pillars'], 'sexagenary cycle'],
    [['甲子', '乙丑', '丙寅', '乙子'] as ManualFourPillarsInput['pillars'], 'sexagenary cycle'],
  ])('rejects incomplete, malformed, or non-sexagenary pillars', (pillars, message) => {
    expect(() => calculateBaziFromPillars({ inputMode: 'manual-four-pillars', pillars })).toThrow(message)
  })

  it('derives only fields that are determined by the supplied pillars', () => {
    const manual = calculateBaziFromPillars(manualInput)
    const dated = calculateBazi({
      date: '1992-08-21',
      time: '12:03',
      locationName: '浙江省 杭州市 西湖区',
      longitude: 120.13333,
      latitude: 30.26667,
      timezone: 'Asia/Shanghai',
      useTrueSolarTime: true,
      gender: 'male',
    })

    expect(manual.dayMaster).toEqual(dated.dayMaster)
    expect(manual.fiveElements).toEqual(dated.fiveElements)
    expect(manual.tenGods).toEqual(dated.tenGods)
    expect(manual.hiddenStems).toEqual(dated.hiddenStems)
    expect(manual.relations).toEqual(dated.relations)
    expect(manual.professional).toEqual(dated.professional)
    expect(manual.pillarDetails).toEqual(
      dated.pillarDetails?.map((detail) => ({
        ...detail,
        shenSha: { status: 'pending-school-rule', ruleVersion: 'assessment-pending-school-v1' },
      })),
    )
  })

  it('derives deterministic heavenly-stem combinations and clashes from supplied pillars', () => {
    const result = calculateBaziFromPillars({
      inputMode: 'manual-four-pillars',
      pillars: ['戊子', '癸丑', '丁卯', '壬辰'],
    })

    expect(result.relations.map((relation) => relation.detail)).toEqual(expect.arrayContaining([
      '戊癸合化火',
      '丁壬合化木',
      '子丑六合',
    ]))
  })

  it('marks every birth-time-dependent output unavailable instead of inventing values', () => {
    const result = calculateBaziFromPillars(manualInput)
    const unavailable = { status: 'unavailable', reason: 'pending-source-required' }

    expect(result.birthDateTime).toEqual(unavailable)
    expect(result.correctedLocalTime).toEqual(unavailable)
    expect(result.correctionMinutes).toEqual(unavailable)
    expect(result.solarTermBoundary).toEqual(unavailable)
    expect(result.luckStartDate).toEqual(unavailable)
    expect(result.luckStartAge).toEqual(unavailable)
    expect(result.luckCycles).toEqual(unavailable)
    expect(result.annualCycles).toEqual(unavailable)
    expect(result.monthlyCycles).toEqual(unavailable)
    expect(result.dailyCycles).toEqual(unavailable)
    expect(result.hourlyCycles).toEqual(unavailable)
  })
})
