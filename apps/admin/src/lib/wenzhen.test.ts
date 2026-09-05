/* @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import {
  buildWenzhenDynamicExpectedTemplateFromFlowSelection,
  buildWenzhenExpectedJsonWithDynamicTemplate,
  buildWenzhenFlowQueryFromAdminInput,
  buildWenzhenExpectedFromAdminInput,
  canApplyWenzhenFlowTemplateResponse,
  emptyWenzhenAcceptanceSelections,
  formatWenzhenAssertionCoverage,
  validateWenzhenAcceptance,
  wenzhenComparisonFingerprint,
  wenzhenAssertionCoverageLabels,
  wenzhenDifferenceClassificationLabels,
} from './wenzhen'

const mismatches = [
  { path: 'expected.pillars.hour', category: 'pillars', expected: '庚申', actual: '辛酉' },
]

describe('Wenzhen accepted-difference classification', () => {
  it('builds the accepted-difference payload with an explicit legal classification', () => {
    const result = validateWenzhenAcceptance(
      mismatches,
      { 'expected.pillars.hour': ' 采用不同的起时规则 ' },
      { 'expected.pillars.hour': 'school-rule' },
    )

    expect(result).toEqual({
      ok: true,
      acceptedDifferences: [{
        path: 'expected.pillars.hour',
        reason: '采用不同的起时规则',
        classification: 'school-rule',
      }],
    })
    expect(Object.keys(wenzhenDifferenceClassificationLabels)).toEqual([
      'dependency',
      'school-rule',
      'timezone-location',
      'display-rounding',
      'bug',
    ])
  })

  it('does not allow an unclassified difference to be submitted', () => {
    const result = validateWenzhenAcceptance(
      mismatches,
      { 'expected.pillars.hour': '有审核依据' },
      { 'expected.pillars.hour': '' },
    )

    expect(result).toMatchObject({ ok: false, code: 'missing-classification', path: 'expected.pillars.hour' })
  })

  it('treats a bug as non-acceptable even when it has a reason', () => {
    const result = validateWenzhenAcceptance(
      mismatches,
      { 'expected.pillars.hour': '已确认是当前实现缺陷' },
      { 'expected.pillars.hour': 'bug' },
    )

    expect(result).toMatchObject({ ok: false, code: 'bug', path: 'expected.pillars.hour' })
    if (!result.ok) expect(result.message).toContain('缺陷不可接受，请修复')
  })

  it('creates blank selections for a new comparison and clears them when stale', () => {
    expect(emptyWenzhenAcceptanceSelections(['expected.pillars.hour'])).toEqual({
      reasons: { 'expected.pillars.hour': '' },
      classifications: { 'expected.pillars.hour': '' },
    })

    expect(emptyWenzhenAcceptanceSelections()).toEqual({ reasons: {}, classifications: {} })
  })

  it('formats WenZhen assertion coverage in the shared product order', () => {
    expect(Object.keys(wenzhenAssertionCoverageLabels)).toEqual([
      'pillars',
      'time-correction',
      'professional-table',
      'luck-cycles',
      'dynamic-cycles',
    ])
    expect(formatWenzhenAssertionCoverage({ pillars: 5, 'luck-cycles': 1 })).toEqual([
      { category: 'pillars', label: '四柱', count: 5 },
      { category: 'time-correction', label: '时间校正', count: 0 },
      { category: 'professional-table', label: '专业表', count: 0 },
      { category: 'luck-cycles', label: '大运', count: 1 },
      { category: 'dynamic-cycles', label: '流盘', count: 0 },
    ])
  })

  it('builds extended WenZhen expected payloads without allowing duplicate pillar sources', () => {
    const pillars = ['壬申', '戊申', '己巳', '庚午']

    expect(buildWenzhenExpectedFromAdminInput(pillars, '')).toEqual({ pillars })
    expect(buildWenzhenExpectedFromAdminInput(pillars, JSON.stringify({
      correctedLocalTime: '1992-08-21T11:59',
      pillarDetails: [{ pillar: '壬申' }],
      luckCycles: [{ pillar: '己酉' }],
    }))).toEqual({
      pillars,
      correctedLocalTime: '1992-08-21T11:59',
      pillarDetails: [{ pillar: '壬申' }],
      luckCycles: [{ pillar: '己酉' }],
    })
    expect(() => buildWenzhenExpectedFromAdminInput(pillars, '{ bad json')).toThrow('不是合法 JSON')
    expect(() => buildWenzhenExpectedFromAdminInput(pillars, JSON.stringify(['not-an-object']))).toThrow('必须是对象')
    expect(() => buildWenzhenExpectedFromAdminInput(pillars, JSON.stringify({ pillars: ['甲子', '乙丑', '丙寅', '丁卯'] }))).toThrow('不要包含 pillars')
  })

  it('builds an optional flow query only from explicit target date and optional time', () => {
    expect(buildWenzhenFlowQueryFromAdminInput(null, null)).toBeUndefined()
    expect(buildWenzhenFlowQueryFromAdminInput('', '')).toBeUndefined()
    expect(buildWenzhenFlowQueryFromAdminInput('2026-09-01', null)).toEqual({ targetDate: '2026-09-01' })
    expect(buildWenzhenFlowQueryFromAdminInput(' 2026-09-01 ', ' 15:57 ')).toEqual({ targetDate: '2026-09-01', targetTime: '15:57' })
    expect(() => buildWenzhenFlowQueryFromAdminInput(null, '15:57')).toThrow('先填写流盘目标日期')
    expect(() => buildWenzhenFlowQueryFromAdminInput('20260901', null)).toThrow('YYYY-MM-DD')
    expect(() => buildWenzhenFlowQueryFromAdminInput('2026-09-01', '1557')).toThrow('HH:mm')
  })

  it('builds dynamic template keys only from the server flow selection', () => {
    const selection = { year: 2026, monthYear: 2023, month: 12, date: '2026-08-31', hourSlotStart: 21 }

    expect(buildWenzhenDynamicExpectedTemplateFromFlowSelection(selection)).toEqual({
      annualCycles: [{ year: 2026, pillar: '' }],
      monthlyCycles: [{ year: 2023, month: 12, pillar: '' }],
      dailyCycles: [{ date: '2026-08-31', pillar: '' }],
      hourlyCycles: [{ dateTime: '2026-08-31 21:00', startHour: 21, pillar: '' }],
    })
    expect(JSON.parse(buildWenzhenExpectedJsonWithDynamicTemplate('', selection))).toEqual({
      annualCycles: [{ year: 2026, pillar: '' }],
      monthlyCycles: [{ year: 2023, month: 12, pillar: '' }],
      dailyCycles: [{ date: '2026-08-31', pillar: '' }],
      hourlyCycles: [{ dateTime: '2026-08-31 21:00', startHour: 21, pillar: '' }],
    })
  })

  it('merges the dynamic template into the admin expected JSON without duplicating pillars', () => {
    const result = JSON.parse(buildWenzhenExpectedJsonWithDynamicTemplate(
      JSON.stringify({ correctedLocalTime: '1992-08-21T11:59' }),
      { year: 2026, monthYear: 2026, month: 9, date: '2026-09-01', hourSlotStart: 15 },
    ))

    expect(result).toMatchObject({
      correctedLocalTime: '1992-08-21T11:59',
      annualCycles: [{ year: 2026, pillar: '' }],
      monthlyCycles: [{ year: 2026, month: 9, pillar: '' }],
      dailyCycles: [{ date: '2026-09-01', pillar: '' }],
      hourlyCycles: [{ dateTime: '2026-09-01 15:00', startHour: 15, pillar: '' }],
    })
    expect(() => buildWenzhenExpectedJsonWithDynamicTemplate(
      JSON.stringify({ pillars: ['甲子'] }),
      { year: 2026, monthYear: 2026, month: 9, date: '2026-09-01', hourSlotStart: 15 },
    ))
      .toThrow('不要包含 pillars')
  })

  it('does not allow an incomplete dynamic capture template to be saved as real WenZhen evidence', () => {
    const pillars = ['壬申', '戊申', '己巳', '庚午']

    expect(() => buildWenzhenExpectedFromAdminInput(
      pillars,
      JSON.stringify(buildWenzhenDynamicExpectedTemplateFromFlowSelection({
        year: 2026, monthYear: 2026, month: 9, date: '2026-09-01', hourSlotStart: 15,
      })),
    )).toThrow('annualCycles[0].pillar 仍为空')
    expect(() => buildWenzhenExpectedFromAdminInput(pillars, JSON.stringify({
      dailyCycles: [{ date: '2026-09-01', pillar: '待填写' }],
    }))).toThrow('dailyCycles[0].pillar 仍为空')
    expect(buildWenzhenExpectedFromAdminInput(pillars, JSON.stringify({
      annualCycles: [{ year: 2026, pillar: '丙午' }],
      monthlyCycles: [{ year: 2026, month: 9, pillar: '丁酉' }],
      dailyCycles: [{ date: '2026-09-01', pillar: '戊寅' }],
      hourlyCycles: [{ dateTime: '2026-09-01 15:00', startHour: 15, pillar: '庚申' }],
    }))).toMatchObject({
      pillars,
      annualCycles: [{ year: 2026, pillar: '丙午' }],
      hourlyCycles: [{ dateTime: '2026-09-01 15:00', startHour: 15, pillar: '庚申' }],
    })
  })

  it('marks an old comparison stale when the flow target changes', () => {
    const draft = {
      sampleId: 'wz-flow-001',
      capturedAt: '2026-09-01T10:00',
      sourceUrl: 'https://pcbz.iwzwh.com/#/paipan/index',
      evidenceRef: 'evidence/wenzhen/sha256-test.png',
      flowTargetDate: null,
      flowTargetTime: null,
      calendarSystem: 'solar',
      lunarLeapMonth: false,
      date: '1992-08-21',
      time: '12:03',
      placeCode: '330106',
      placeLabel: '浙江省 杭州市 西湖区',
      placeTimezone: 'Asia/Shanghai',
      placeCoordinateStatus: 'reviewed',
      placeCoordinateSource: 'admin-test',
      placeCoordinateLicense: 'test',
      placeDataVersion: 'test-v1',
      gender: 'male',
      useTrueSolarTime: true,
      dstPolicy: 'auto',
      dayBoundary: 'midnight',
      luckMethod: 'sect1',
      pillars: '壬申 戊申 己巳 庚午',
      expectedJson: '',
    } satisfies Parameters<typeof wenzhenComparisonFingerprint>[0]

    const checked = wenzhenComparisonFingerprint(draft)
    expect(wenzhenComparisonFingerprint({ ...draft, flowTargetDate: '2026-09-01' })).not.toBe(checked)
    expect(wenzhenComparisonFingerprint({ ...draft, flowTargetDate: '2026-09-01', flowTargetTime: '15:57' }))
      .not.toBe(wenzhenComparisonFingerprint({ ...draft, flowTargetDate: '2026-09-01' }))
  })

  it('only applies an async flow template response when the admin input is unchanged', () => {
    const draft = {
      sampleId: 'wz-flow-001',
      capturedAt: '2026-09-01T10:00',
      sourceUrl: 'https://pcbz.iwzwh.com/#/paipan/index',
      evidenceRef: 'evidence/wenzhen/sha256-test.png',
      flowTargetDate: '2026-09-01',
      flowTargetTime: '15:57',
      calendarSystem: 'solar',
      lunarLeapMonth: false,
      date: '1992-08-21',
      time: '12:03',
      placeCode: '330106',
      placeLabel: '浙江省 杭州市 西湖区',
      placeTimezone: 'Asia/Shanghai',
      placeCoordinateStatus: 'reviewed',
      placeCoordinateSource: 'admin-test',
      placeCoordinateLicense: 'test',
      placeDataVersion: 'test-v1',
      gender: 'male',
      useTrueSolarTime: true,
      dstPolicy: 'auto',
      dayBoundary: 'midnight',
      luckMethod: 'sect1',
      pillars: '壬申 戊申 己巳 庚午',
      expectedJson: '',
    } satisfies Parameters<typeof wenzhenComparisonFingerprint>[0]
    const requestedFingerprint = wenzhenComparisonFingerprint(draft)

    expect(canApplyWenzhenFlowTemplateResponse(draft, requestedFingerprint)).toBe(true)
    expect(canApplyWenzhenFlowTemplateResponse({ ...draft, flowTargetTime: '16:01' }, requestedFingerprint)).toBe(false)
  })
})
