import { describe, expect, it } from 'vitest'
import {
  ApiError,
  applyRuleTimeDefaults,
  buildBaziFlowRequest,
  buildChartVersionRestoreRequest,
  buildChartVersionRequest,
  buildReportChartBinding,
  canRestoreChartVersion,
  chooseRuleProfileSelection,
  formatBalanceFacts,
  formatProfessionalField,
  formatProfessionalAssessment,
  formatRelationsSummary,
  formatVoidBranchesSummary,
  mergeRestoredChartVersionHistory,
  normalizeActiveRuleProfileVersions,
  restoredChartAuditMessage,
  restoreChartVersionErrorMessage,
  selectFlowCycleDisplaySources,
} from './main'

const publishedVersion = {
  profileId: 'profile-1',
  versionId: 'profile-1:v2:hash',
  version: 2,
  key: 'school-a',
  name: '测试流派',
  contentHash: 'sha256:1234567890abcdef',
  publishedAt: '2026-08-31T12:00:00.000Z',
  definition: {
    timeDefaults: {
      timezone: 'Asia/Shanghai',
      dstPolicy: 'ignore' as const,
      useTrueSolarTime: false,
      dayBoundary: 'zi-hour-start' as const,
      luckMethod: 'sect2' as const,
    },
    assessments: {},
  },
}

const birth = {
  date: '1992-08-18',
  time: '09:30',
  locationName: '浙江省 杭州市 西湖区',
  longitude: 120.1302,
  latitude: 30.2595,
  timezone: 'Etc/UTC',
  useTrueSolarTime: true,
  dstPolicy: 'auto' as const,
  dayBoundary: 'midnight' as const,
  luckMethod: 'sect1' as const,
  gender: 'female' as const,
}

const chartVersion = {
  id: 'chart-version-3',
  profileId: 'chart-profile-1',
  version: 3,
  birth,
  bazi: {
    pillars: ['壬申', '戊申', '丙午', '癸巳'],
    correctedLocalTime: '1992-08-18T09:20:00+08:00',
    correctionMinutes: -10,
  },
  ruleProfileVersion: publishedVersion,
  createdAt: '2026-09-01T08:00:00.000Z',
}

describe('published Bazi rule profile helpers', () => {
  it('renders derived provenance and fail-closed unresolved states without inventing a conclusion', () => {
    expect(formatProfessionalAssessment({
      status: 'derived',
      ruleVersion: 'expert-v2',
      conclusion: '机制测试结论',
      provenance: { matchedRuleIds: ['rule-a'], sourceVersionIds: ['source-v1'], factsHash: 'abc' },
    })).toEqual({ value: '机制测试结论', state: '已计算 · expert-v2', evidence: '1 条命中规则 · 1 个来源版本' })
    expect(formatProfessionalAssessment({ status: 'unresolved', reason: 'conflict', ruleVersion: 'expert-v2' })).toEqual({
      value: '未决',
      state: '最高优先级规则冲突，已停止给出结论 · expert-v2',
      evidence: '不会由模型补写',
    })
  })

  it('formats governed balance facts without turning the baseline into a school conclusion', () => {
    expect(formatBalanceFacts({
      method: 'seasonal-support-baseline-v1',
      supportScore: 4.5,
      oppositionScore: 3,
      netScore: 1.5,
      rootCount: 2,
      resourceCount: 1,
      monthCommandSupports: true,
      contributions: [],
    })).toEqual({
      season: '月令主气扶助日主（扶抑基线）',
      roots: '2 处根气',
      resources: '1 处生扶',
      scores: '支持 4.5 · 克泄耗 3 · 净值 +1.5',
      method: 'seasonal-support-baseline-v1',
    })
    expect(formatBalanceFacts(undefined)).toBeNull()
  })

  it('uses a rule timezone only for legacy birth input without a resolved place timezone', () => {
    expect(applyRuleTimeDefaults({ ...birth, timezone: undefined }, publishedVersion).timezone).toBe('Asia/Shanghai')
  })

  it('accepts the direct active-version response and the compatible wrapped form', () => {
    expect(normalizeActiveRuleProfileVersions([publishedVersion])).toEqual([publishedVersion])
    expect(normalizeActiveRuleProfileVersions({ versions: [publishedVersion] })).toEqual([publishedVersion])
  })

  it('rejects an unusable endpoint payload instead of silently treating it as no versions', () => {
    expect(() => normalizeActiveRuleProfileVersions({ items: [] })).toThrow('排盘规则接口返回格式不正确。')
    expect(() => normalizeActiveRuleProfileVersions([{ ...publishedVersion, versionId: '' }])).toThrow('排盘规则接口包含无法使用的版本资料。')
  })

  it('applies profile time defaults while preserving the birth identity and place evidence', () => {
    expect(applyRuleTimeDefaults(birth, publishedVersion)).toEqual({
      ...birth,
      timezone: 'Etc/UTC',
      dstPolicy: 'ignore',
      useTrueSolarTime: false,
      dayBoundary: 'zi-hour-start',
      luckMethod: 'sect2',
    })
  })

  it('sends the selected immutable version id and optimistic chart revision', () => {
    expect(buildChartVersionRequest(birth, publishedVersion.versionId, 4)).toMatchObject({
      ...birth,
      ruleProfileVersionId: publishedVersion.versionId,
      expectedRevision: 4,
    })
  })

  it('builds stored-chart flow requests from the immutable chart version only', () => {
    const request = buildBaziFlowRequest('chart-version-3', '2026-09-01', '15:57')

    expect(request).toEqual({
      chartVersionId: 'chart-version-3',
      targetDate: '2026-09-01',
      targetTime: '15:57',
    })
    expect(request).not.toHaveProperty('birth')
    expect(request).not.toHaveProperty('ruleProfileVersionId')
    expect(request).not.toHaveProperty('query')
  })

  it('keeps birth-chart luck cycles but does not display legacy dynamic cycles before querying flow', () => {
    const display = selectFlowCycleDisplaySources({
      pillars: ['壬申', '戊申', '丙午', '癸巳'],
      correctedLocalTime: '1992-08-18T09:20:00+08:00',
      correctionMinutes: -10,
      luckCycles: [{ index: 1, pillar: '己酉', startAge: 8, startDate: '1999-05-28', endDate: '2009-05-28', direction: 'forward', status: 'derived' }],
      annualCycles: [{ year: 2026, pillar: '丙午', label: '旧出生盘流年' }],
      monthlyCycles: [{ year: 2026, month: 9, pillar: '丁酉', label: '旧出生盘流月' }],
      dailyCycles: [{ date: '2026-09-01', pillar: '戊戌', label: '旧出生盘流日' }],
      hourlyCycles: [{ dateTime: '2026-09-01 15:00', pillar: '庚申', label: '旧出生盘流时' }],
    })

    expect(display.luckCycles?.[0]?.pillar).toBe('己酉')
    expect(display.annualCycles).toBeUndefined()
    expect(display.monthlyCycles).toBeUndefined()
    expect(display.dailyCycles).toBeUndefined()
    expect(display.hourlyCycles).toBeUndefined()
  })

  it('uses flow API results for dynamic cycles after a target date is calculated', () => {
    const display = selectFlowCycleDisplaySources({
      pillars: ['壬申', '戊申', '丙午', '癸巳'],
      correctedLocalTime: '1992-08-18T09:20:00+08:00',
      correctionMinutes: -10,
      luckCycles: [{ index: 1, pillar: '己酉', startAge: 8, status: 'derived' }],
      annualCycles: [{ year: 2025, pillar: '乙巳', label: '旧出生盘流年' }],
    }, {
      ruleVersion: 'flow-v1',
      target: { date: '2026-09-01', time: '15:57', timezone: 'Asia/Shanghai', dayBoundary: 'midnight', boundaryTimeBasis: 'corrected-local-solar-term-wall-v2' },
      selection: { luckCycleIndex: 3, year: 2026, monthYear: 2026, month: 9, date: '2026-09-01', hourSlotStart: 15 },
      targetChart: {
        pillars: ['丙午', '丙申', '戊戌', '庚申'],
        correctedLocalTime: '2026-09-01T15:54:00+08:00',
        correctionMinutes: -3,
      },
      luckCycles: [{ index: 3, pillar: '辛亥', startAge: 28, status: 'derived' }],
      annualCycles: [{ year: 2026, pillar: '丙午', status: 'derived' }],
      monthlyCycles: [{ year: 2026, month: 9, monthName: '酉', startAt: '2026-09-07T00:00:00', endAt: '2026-10-08T00:00:00', startTerm: '白露', endTerm: '寒露', pillar: '丁酉', status: 'derived' }],
      dailyCycles: [{ date: '2026-09-01', pillar: '戊戌', status: 'derived' }],
      hourlyCycles: [{ dateTime: '2026-09-01 15:00', startHour: 15, earthlyBranch: '申', pillar: '庚申', status: 'derived' }],
    })

    expect(display.luckCycles?.[0]?.pillar).toBe('辛亥')
    expect(display.annualCycles?.[0]?.pillar).toBe('丙午')
    expect(display.monthlyCycles?.[0]?.pillar).toBe('丁酉')
    expect(display.dailyCycles?.[0]?.pillar).toBe('戊戌')
    expect(display.hourlyCycles?.[0]?.pillar).toBe('庚申')
  })

  it('builds chart-version restore requests from only the optimistic revision', () => {
    const request = buildChartVersionRestoreRequest(7)

    expect(request).toEqual({ expectedRevision: 7 })
    expect(request).not.toHaveProperty('birth')
    expect(request).not.toHaveProperty('bazi')
    expect(request).not.toHaveProperty('ruleProfileVersionId')
  })

  it('only allows restoring non-current chart versions when a current version exists', () => {
    expect(canRestoreChartVersion('chart-version-2', 'chart-version-3')).toBe(true)
    expect(canRestoreChartVersion('chart-version-3', 'chart-version-3')).toBe(false)
    expect(canRestoreChartVersion('chart-version-2')).toBe(false)
  })

  it('maps restore conflicts to a refresh-and-retry message', () => {
    expect(restoreChartVersionErrorMessage(new ApiError('conflict', 409, {}))).toBe('命盘已在另一页面更新，请刷新后重试恢复历史版本。')
    expect(restoreChartVersionErrorMessage(new Error('network down'))).toBe('network down')
  })

  it('merges a restored profile version into local history without duplicating it', () => {
    const olderVersion = { ...chartVersion, id: 'chart-version-2', version: 2 }
    const restored = { ...chartVersion, id: 'chart-version-1', version: 4 }

    expect(mergeRestoredChartVersionHistory([chartVersion, olderVersion], restored)?.map((version) => version.id)).toEqual([
      'chart-version-1',
      'chart-version-3',
      'chart-version-2',
    ])
    expect(mergeRestoredChartVersionHistory([restored, olderVersion], restored)?.map((version) => version.id)).toEqual([
      'chart-version-1',
      'chart-version-2',
    ])
  })

  it('renders a restore audit message from the selected history source', () => {
    expect(restoredChartAuditMessage(chartVersion)).toContain('已恢复历史 v3 为当前版本')
    expect(restoredChartAuditMessage(chartVersion)).toContain('服务端已记录恢复审计')
  })

  it('keeps the legacy built-in calculation request explicit by omitting an empty binding', () => {
    expect(buildChartVersionRequest(birth, '')).not.toHaveProperty('ruleProfileVersionId')
    expect(buildChartVersionRequest(birth, '')).not.toHaveProperty('expectedRevision')
  })

  it('reuses a saved chart only when its immutable rule binding matches the selection', () => {
    const chart = {
      profileId: 'chart-1',
      versionId: 'chart-version-3',
      ruleProfileVersion: publishedVersion,
    }
    expect(buildReportChartBinding(publishedVersion.versionId, chart)).toEqual({
      ruleProfileVersionId: publishedVersion.versionId,
      chartProfileId: 'chart-1',
      chartVersionId: 'chart-version-3',
    })
    expect(buildReportChartBinding('profile-2:v1:other', chart)).toEqual({
      ruleProfileVersionId: 'profile-2:v1:other',
    })
  })

  it('keeps legacy unbound chart reuse explicit when the user selects built-in rules', () => {
    expect(buildReportChartBinding('', {
      profileId: 'legacy-chart',
      versionId: 'legacy-version',
    })).toEqual({
      chartProfileId: 'legacy-chart',
      chartVersionId: 'legacy-version',
    })
  })

  it('auto-selects the first active rule profile only when no chart or manual selection exists', () => {
    expect(chooseRuleProfileSelection('', null, [publishedVersion])).toBe(publishedVersion.versionId)
    expect(chooseRuleProfileSelection(publishedVersion.versionId, null, [publishedVersion])).toBe(publishedVersion.versionId)
    expect(chooseRuleProfileSelection('inactive-manual-version', null, [publishedVersion])).toBe(publishedVersion.versionId)
    expect(chooseRuleProfileSelection('', {
      ruleProfileVersion: {
        profileId: 'profile-2',
        versionId: 'chart-bound-version',
        version: 1,
        key: 'school-b',
        name: '命盘绑定流派',
        contentHash: 'hash',
      },
    }, [publishedVersion])).toBe(publishedVersion.versionId)
    expect(chooseRuleProfileSelection('', {
      ruleProfileVersion: publishedVersion,
    }, [publishedVersion])).toBe(publishedVersion.versionId)
    expect(chooseRuleProfileSelection('', null, [])).toBe('')
  })

  it('renders professional void branches from the versioned professional payload', () => {
    const bazi = {
      professional: {
        naYin: ['海中金', '炉中火', '大林木', '路旁土'],
        voidBranches: ['戌亥', '寅卯', '子丑', '午未'],
        twelveGrowthStages: ['养', '沐浴', '帝旺', '病'],
      },
      voidBranches: ['旧字段不应展示'],
    }

    expect(formatProfessionalField(bazi, 'voidBranches', 1)).toBe('寅卯')
    expect(formatVoidBranchesSummary(bazi)).toBe('戌亥、寅卯、子丑、午未')
  })

  it('distinguishes a calculated empty relations list from a pending calculation', () => {
    expect(formatRelationsSummary({
      professional: { voidBranches: ['戌亥', '寅卯', '子丑', '午未'] },
      relations: [],
    })).toBe('未发现已支持的合冲关系')

    expect(formatRelationsSummary({
      professional: { voidBranches: ['戌亥', '寅卯', '子丑', '午未'] },
    })).toBe('待计算')
  })

  it('marks legacy charts without professional fields as needing recalculation', () => {
    const legacyBazi = {
      voidBranches: ['旧字段不应展示'],
      relations: [],
    }

    expect(formatProfessionalField(legacyBazi, 'voidBranches', 0)).toBe('旧命盘需重新排算')
    expect(formatVoidBranchesSummary(legacyBazi)).toBe('旧命盘需重新排算')
    expect(formatRelationsSummary(legacyBazi)).toBe('旧命盘需重新排算')
  })
})
