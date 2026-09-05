/* @vitest-environment happy-dom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BirthDateTimePicker,
  buildCompatibilitySummaryCards,
  buildFlowTimelineCards,
  buildGanZhiRelationGroups,
  buildNatalProfessionalDigest,
  buildChartVersionRequest,
  buildReportFlowSteps,
  buildReportSubmissionPayload,
  calculationInputFromVersion,
  canCalculateChartInput,
  chartPageTabs,
  chartUtilityTabs,
  countVisiblePillarElements,
  defaultBirth,
  defaultManualFourPillarsInput,
  formatDayMaster,
  formatProfessionalPillarMatrixValue,
  formatWenzhenAssertionCoverage,
  isManualFourPillarsInput,
  professionalPillarMatrixRowLabels,
  reportSubmissionInputError,
  sourceDependentReportValue,
  wenzhenAssertionCoverageLabels,
  type ManualFourPillarsInput,
} from './main'

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => root.unmount())
  container.remove()
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('manual four-pillar chart input', () => {
  it('offers four accessible sexagenary-cycle selectors and cannot emit an invalid pillar', () => {
    const setBirth = vi.fn()
    const setManualInput = vi.fn()
    const setInputMode = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => root.render(<BirthDateTimePicker
      birth={defaultBirth}
      setBirth={setBirth}
      inputMode="birth-data"
      manualInput={defaultManualFourPillarsInput}
      setManualInput={setManualInput}
      setInputMode={setInputMode}
    />))

    click(container.querySelector('button.datetime-trigger')!)
    click(Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '四柱')!)

    const selectors = Array.from(document.querySelectorAll<HTMLSelectElement>('.manual-pillar-select'))
    expect(selectors.map((select) => select.getAttribute('aria-label'))).toEqual(['年柱', '月柱', '日柱', '时柱'])
    expect(selectors.every((select) => select.options.length === 60)).toBe(true)
    expect(Array.from(selectors[0]!.options).some((option) => option.value === '乙子')).toBe(false)

    act(() => {
      selectors[0]!.value = '壬申'
      selectors[0]!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    click(document.querySelector('button.picker-confirm')!)

    expect(setManualInput).toHaveBeenCalledWith({
      inputMode: 'manual-four-pillars',
      pillars: ['壬申', '丙寅', '戊辰', '庚午'],
    })
    expect(setInputMode).toHaveBeenCalledWith('manual-four-pillars')
    expect(setBirth).not.toHaveBeenCalled()
    cleanup(root, container)
  })

  it('builds the exact manual chart payload without birthplace or civil-time fields', () => {
    const input: ManualFourPillarsInput = {
      inputMode: 'manual-four-pillars',
      pillars: ['壬申', '戊申', '己巳', '庚午'],
      gender: 'female',
    }

    expect(buildChartVersionRequest(input, 'school:v1:hash', 7)).toEqual({
      inputMode: 'manual-four-pillars',
      pillars: ['壬申', '戊申', '己巳', '庚午'],
      gender: 'female',
      ruleProfileVersionId: 'school:v1:hash',
      expectedRevision: 7,
    })
    expect(buildChartVersionRequest(input, '', undefined)).not.toHaveProperty('locationName')
    expect(canCalculateChartInput(input)).toBe(true)
  })

  it('restores manual input from a version and keeps legacy birth versions compatible', () => {
    const manual = {
      inputMode: 'manual-four-pillars' as const,
      pillars: ['甲子', '乙丑', '丙寅', '丁卯'] as const,
      gender: 'male' as const,
    }
    expect(calculationInputFromVersion({ calculationInput: manual })).toEqual(manual)
    expect(calculationInputFromVersion({ birth: defaultBirth })).toEqual(defaultBirth)
    expect(isManualFourPillarsInput(calculationInputFromVersion({ birth: defaultBirth }))).toBe(false)
  })

  it('rejects a manual input smuggled through the legacy birth field', () => {
    expect(() => calculationInputFromVersion({
      birth: {
        inputMode: 'manual-four-pillars',
        pillars: ['甲子', '乙丑', '丙寅', '丁卯'],
      },
    })).toThrow('版本数据合同错误')
  })

  it('submits an already-saved manual chart by immutable chart binding without birth or place data', () => {
    const manual = {
      inputMode: 'manual-four-pillars' as const,
      pillars: ['壬申', '戊申', '己巳', '庚午'] as const,
      gender: 'female' as const,
    }
    const payload = buildReportSubmissionPayload({
      visionConsent: true,
      birth: { ...defaultBirth, placeCode: undefined, geoDataVersion: undefined, latitude: undefined },
      chart: {
        profileId: 'chart-manual-1',
        versionId: 'chart-manual-v3',
        calculationInput: manual,
        ruleProfileVersion: {
          profileId: 'school-a',
          versionId: 'school-a:v2:hash',
          version: 2,
          key: 'school-a',
          name: '测试流派',
          contentHash: 'sha256:abc',
        },
      },
      selectedRuleProfileVersionId: 'different-ui-selection',
      residence: { facing: 'south', layoutNote: '客厅朝南' },
      photos: [{ fileId: 'file-1', room: 'overview', facing: 'south', note: '' }],
    })

    expect(payload).toEqual({
      visionConsent: true,
      ruleProfileVersionId: 'school-a:v2:hash',
      chartProfileId: 'chart-manual-1',
      chartVersionId: 'chart-manual-v3',
      residence: { facing: 'south', layoutNote: '客厅朝南' },
      photos: [{ fileId: 'file-1', room: 'overview', facing: 'south', note: '' }],
    })
    expect(payload).not.toHaveProperty('birth')
    expect(payload).not.toHaveProperty('calculationInput')
    expect(reportSubmissionInputError({
      profileId: 'chart-manual-1',
      versionId: 'chart-manual-v3',
      calculationInput: manual,
    }, { ...defaultBirth, placeCode: undefined, latitude: undefined })).toBe('')
  })

  it('submits an already-saved birth chart by immutable chart binding instead of transient birth form data', () => {
    const payload = buildReportSubmissionPayload({
      visionConsent: true,
      birth: { ...defaultBirth, time: '23:59' },
      chart: {
        profileId: 'chart-birth-1',
        versionId: 'chart-birth-v2',
        calculationInput: defaultBirth,
        birth: defaultBirth,
        ruleProfileVersion: {
          profileId: 'school-a',
          versionId: 'school-a:v1:hash',
          version: 1,
          key: 'school-a',
          name: '测试流派',
          contentHash: 'sha256:def',
        },
      },
      selectedRuleProfileVersionId: 'different-ui-selection',
      residence: { facing: 'east', layoutNote: '玄关朝东' },
      photos: [{ fileId: 'file-2', room: 'entrance', facing: 'east', note: '' }],
    })

    expect(payload).toEqual({
      visionConsent: true,
      ruleProfileVersionId: 'school-a:v1:hash',
      chartProfileId: 'chart-birth-1',
      chartVersionId: 'chart-birth-v2',
      residence: { facing: 'east', layoutNote: '玄关朝东' },
      photos: [{ fileId: 'file-2', room: 'entrance', facing: 'east', note: '' }],
    })
    expect(payload).not.toHaveProperty('birth')
  })

  it('requires a saved chart before the residence report can be generated from the web flow', () => {
    expect(reportSubmissionInputError(null, defaultBirth)).toBe('请先到“我的命盘”生成并保存命盘，再生成住宅报告。')
  })

  it('renders pending source-dependent report values without stringifying sentinel objects', () => {
    expect(sourceDependentReportValue({ status: 'unavailable', reason: 'pending-source-required' })).toBe('需补出生资料')
    expect(sourceDependentReportValue(undefined, ' 分钟')).toBe('需补出生资料')
    expect(sourceDependentReportValue(-8.5, ' 分钟')).toBe('-8.5 分钟')
  })

  it('formats WenZhen assertion coverage for the chart parity section', () => {
    expect(Object.keys(wenzhenAssertionCoverageLabels)).toEqual([
      'pillars',
      'time-correction',
      'professional-table',
      'luck-cycles',
      'dynamic-cycles',
    ])
    expect(formatWenzhenAssertionCoverage({ pillars: 5, 'professional-table': 5, 'luck-cycles': 1 })).toEqual([
      { category: 'pillars', label: '四柱', count: 5 },
      { category: 'time-correction', label: '时间校正', count: 0 },
      { category: 'professional-table', label: '专业表', count: 5 },
      { category: 'luck-cycles', label: '大运', count: 1 },
      { category: 'dynamic-cycles', label: '流盘', count: 0 },
    ])
  })

  it('defines the chart page as WenZhen-style product tabs and keeps the natal matrix close to professional apps', () => {
    expect(chartPageTabs.map((tab) => tab.label)).toEqual(['合盘', '生辰', '流盘'])
    expect(chartPageTabs.map((tab) => tab.key)).toEqual(['compatibility', 'natal', 'cycles'])
    expect(chartUtilityTabs.map((tab) => tab.label)).toEqual(['专业详情', '参数', '设置'])
    expect(chartUtilityTabs.map((tab) => tab.key)).toEqual(['professional', 'params', 'settings'])
    expect([...chartPageTabs, ...chartUtilityTabs].map((tab) => tab.label)).not.toEqual(expect.arrayContaining(['本命盘', '动态运势', '档案版本']))
    expect(new Set([...chartPageTabs, ...chartUtilityTabs].map((tab) => tab.key)).size).toBe(6)
    expect(professionalPillarMatrixRowLabels).toEqual(['干神', '天干', '地支', '藏干', '支神', '纳音', '空亡', '地势', '自坐', '神煞'])
    expect(formatProfessionalPillarMatrixValue({
      pillars: ['丁丑', '癸卯', '戊午', '庚申'],
      correctedLocalTime: '1997-03-12T08:00:00',
      correctionMinutes: 0,
      tenGods: ['正印', '正财', '日主', '食神'],
      hiddenStems: [['己', '癸', '辛'], ['乙'], ['丁', '己'], ['庚', '壬', '戊']],
      pillarDetails: [{
        hiddenStems: [{ stem: '己', tenGod: '劫财' }, { stem: '癸', tenGod: '正财' }],
        naYin: '洞下水',
        voidBranches: '申酉',
        twelveGrowthStage: '养',
        selfSitting: '墓',
        shenSha: { names: ['天乙贵人'] },
      }],
      professional: {
        naYin: ['洞下水', '金箔金', '天上火', '石榴木'],
        voidBranches: ['申酉', '辰巳', '子丑', '子丑'],
        twelveGrowthStages: ['养', '沐浴', '帝旺', '病'],
      },
    }, '藏干', 0)).toBe('己、癸')
    expect(formatProfessionalPillarMatrixValue({
      pillars: ['丁丑', '癸卯', '戊午', '庚申'],
      correctedLocalTime: '1997-03-12T08:00:00',
      correctionMinutes: 0,
      professional: {
        naYin: ['洞下水'],
        voidBranches: ['申酉'],
        twelveGrowthStages: ['养'],
      },
    }, '纳音', 0)).toBe('洞下水')
  })

  it('builds a deterministic natal digest from calculated chart fields without model prose', () => {
    const digest = buildNatalProfessionalDigest({
      pillars: ['丁丑', '癸卯', '戊午', '庚申'],
      correctedLocalTime: '1997-03-12T08:00:00',
      correctionMinutes: 0,
      dayMaster: { stem: '戊', element: '土', yinYang: '阳' },
      fiveElements: { counts: { wood: 2, fire: 1, earth: 2, metal: 1, water: 1 } },
      tenGods: ['正印', '正财', '日主', '食神'],
      relations: [{ kind: 'combination', detail: '卯戌六合' }],
      pillarDetails: [
        { naYin: '洞下水', shenSha: { names: ['天乙贵人'] } },
        { naYin: '金箔金', shenSha: { names: ['太极贵人'] } },
      ],
      professional: { naYin: ['洞下水', '金箔金', '天上火', '石榴木'], voidBranches: ['申酉', '辰巳', '子丑', '子丑'] },
      luckCycles: [{ pillar: '甲辰', startAge: 6, direction: 'forward', status: 'derived' }],
    })
    expect(digest.map((item) => item.label)).toEqual(['日主', '五行', '十神', '纳音', '空亡', '神煞', '合冲', '首步大运'])
    expect(digest.find((item) => item.label === '日主')?.value).toBe('戊 · 土 · 阳')
    expect(digest.find((item) => item.label === '纳音')?.value).toBe('洞下水、金箔金、天上火、石榴木')
    expect(digest.find((item) => item.label === '神煞')?.value).toBe('天乙贵人、太极贵人')
    expect(digest.find((item) => item.label === '合冲')?.value).toBe('卯戌六合')
    expect(digest.find((item) => item.label === '首步大运')?.value).toBe('甲辰 · 6岁起 · 顺行')
  })

  it('builds a deterministic compatibility summary from two four-pillar charts without model interpretation', () => {
    expect(countVisiblePillarElements(['丁丑', '癸卯', '戊午', '庚申'])).toEqual({ 木: 1, 火: 2, 土: 2, 金: 2, 水: 1 })

    expect(buildCompatibilitySummaryCards(undefined, defaultManualFourPillarsInput)).toEqual([
      { label: '本人日主', value: '待生成', detail: '先生成本人生辰盘', state: 'pending' },
      { label: '对方日主', value: '戊 · 土', detail: '请选择对方四柱', state: 'ready' },
      { label: '五行同频', value: '待计算', detail: '两份四柱完整后显示可见五行重叠', state: 'pending' },
      { label: '四柱关系', value: '待计算', detail: '两份四柱完整后显示同柱、六合或相冲', state: 'pending' },
    ])

    expect(buildCompatibilitySummaryCards(
      { pillars: ['丁丑', '癸卯', '戊午', '庚申'], dayMaster: { stem: '戊', element: 'earth', yinYang: 'yang' } },
      { pillars: ['甲子', '丙寅', '戊辰', '庚午'] },
    )).toEqual([
      { label: '本人日主', value: '戊 · 土', detail: '丁丑 · 癸卯 · 戊午 · 庚申', state: 'ready' },
      { label: '对方日主', value: '戊 · 土', detail: '甲子 · 丙寅 · 戊辰 · 庚午', state: 'ready' },
      { label: '五行同频', value: '木、火、土、金、水', detail: '本人 木1 · 火2 · 土2 · 金2 · 水1；对方 木2 · 火2 · 土2 · 金1 · 水1', state: 'ready' },
      { label: '四柱关系', value: '3 条', detail: '年支丑 × 对方年支子：子丑六合；日支午 × 对方年支子：子午相冲；时支申 × 对方月支寅：寅申相冲', state: 'ready' },
    ])
  })

  it('groups deterministic stem and branch relations for the natal chart strip', () => {
    expect(buildGanZhiRelationGroups([
      { kind: 'combination', detail: '戊癸合化火' },
      { kind: 'clash', detail: '丁癸相冲' },
      { kind: 'combination', detail: '卯戌六合' },
    ])).toEqual([
      { label: '天干', value: '戊癸合化火、丁癸相冲' },
      { label: '地支', value: '卯戌六合' },
    ])
    expect(buildGanZhiRelationGroups(undefined)).toEqual([
      { label: '天干', value: '未发现已支持的合冲关系' },
      { label: '地支', value: '未发现已支持的合冲关系' },
    ])
  })

  it('builds a five-layer current flow summary from calculated cycle results', () => {
    const flow = {
      ruleVersion: 'bazi-flow-v1',
      target: {
        date: '2026-09-01',
        time: '15:57',
        timezone: 'Asia/Shanghai',
        dayBoundary: 'midnight',
        boundaryTimeBasis: 'corrected-local-solar-term-wall-v2',
      },
      selection: { luckCycleIndex: 3, year: 2026, monthYear: 2026, month: 9, date: '2026-09-01', hourSlotStart: 15 },
      targetChart: {
        correctedLocalTime: '2026-09-01T15:57:00',
        correctionMinutes: 0,
        pillars: ['丙午', '丙申', '戊子', '庚申'],
        dayMaster: { stem: '戊', element: 'earth', yinYang: 'yang' },
        fiveElements: { counts: { wood: 0, fire: 2, earth: 1, metal: 2, water: 1 }, method: 'visible-stems-and-branches-v1' },
        tenGods: ['偏印', '偏印', '日主', '食神'],
        pillarDetails: [],
        relations: [],
      },
      luckCycles: [{ index: 3, pillar: '癸卯', startAge: 26, startDate: '2018-02-04', endDate: '2028-02-03', direction: 'forward', status: 'derived' }],
      annualCycles: [{ year: 2026, pillar: '丙午', status: 'derived' }],
      monthlyCycles: [{ year: 2026, month: 9, monthName: '酉', startAt: '2026-09-07T00:00:00', endAt: '2026-10-08T00:00:00', startTerm: '白露', endTerm: '寒露', pillar: '丁酉', status: 'derived' }],
      dailyCycles: [{ date: '2026-09-01', pillar: '戊子', status: 'derived' }],
      hourlyCycles: [{ dateTime: '2026-09-01 15:00:00', startHour: 15, earthlyBranch: '申', pillar: '庚申', status: 'derived' }],
    } satisfies NonNullable<Parameters<typeof buildFlowTimelineCards>[0]>

    expect(buildFlowTimelineCards(undefined).map((card) => card.state)).toEqual(['pending', 'pending', 'pending', 'pending', 'pending'])
    expect(buildFlowTimelineCards(flow)).toEqual([
      { label: '大运', pillar: '癸卯', detail: '26岁起 · 2018-02-04 — 2028-02-03 · 已计算', state: 'active' },
      { label: '流年', pillar: '丙午', detail: '2026年 · 已计算', state: 'active' },
      { label: '流月', pillar: '丁酉', detail: '2026年酉月 · 白露', state: 'active' },
      { label: '流日', pillar: '戊子', detail: '2026-09-01 · 已计算', state: 'active' },
      { label: '流时', pillar: '庚申', detail: '15:00 · 申时 · 已计算', state: 'active' },
    ])
  })

  it('formats internal day-master element values as Chinese labels for investor-facing chart screens', () => {
    expect(formatDayMaster({ stem: '己', element: 'earth', yinYang: 'yin' })).toBe('己 · 土 · 阴')
    expect(formatDayMaster({ stem: '戊', element: '土', yinYang: '阳' })).toBe('戊 · 土 · 阳')
  })

  it('does not invent source-dependent natal digest fields for manual four-pillar charts', () => {
    expect(buildNatalProfessionalDigest(undefined, true).find((item) => item.label === '首步大运')?.value).toBe('需补出生资料')
  })

  it('keeps the residence report page as a simple chart-photo-report flow', () => {
    expect(buildReportFlowSteps({ hasChart: false, photoCount: 0, status: 'idle' })).toEqual([
      { index: 1, title: '绑定命盘', detail: '先到“我的命盘”生成', state: 'active' },
      { index: 2, title: '住宅证据', detail: '上传全屋图和局部照片', state: 'blocked' },
      { index: 3, title: '生成报告', detail: '确认资料后开始生成', state: 'blocked' },
    ])
    expect(buildReportFlowSteps({ hasChart: true, photoCount: 3, status: 'harness-generating' })[2]).toEqual({
      index: 3,
      title: '生成报告',
      detail: '正在生成报告',
      state: 'active',
    })
    expect(buildReportFlowSteps({ hasChart: true, photoCount: 2, status: 'completed' })[2]).toEqual({
      index: 3,
      title: '生成报告',
      detail: '报告已保存到历史',
      state: 'done',
    })
  })

  it('shows that source-dependent values need birth data instead of fabricating them', () => {
    const setBirth = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => root.render(<BirthDateTimePicker
      birth={defaultBirth}
      setBirth={setBirth}
      inputMode="manual-four-pillars"
      manualInput={defaultManualFourPillarsInput}
      setManualInput={vi.fn()}
      setInputMode={vi.fn()}
    />))

    expect(container.textContent).toContain('手动四柱，不含出生时间推导')
    expect(container.textContent).toContain('真太阳时、节气、起运与流运需补出生资料')
    cleanup(root, container)
  })
})
