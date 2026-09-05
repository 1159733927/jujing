import { describe, expect, it } from 'vitest'
import { buildChartExportHtml, buildChartExportSvg, createChartExportViewModel, type ChartExportSnapshot } from '../src/index.js'

const snapshot: ChartExportSnapshot = {
  profileId: 'private-profile-id',
  revision: 9,
  version: 7,
  savedAt: '2026-08-31T00:00:00.000Z',
  birth: {
    date: '1992-08-18', time: '09:30', locationName: '浙江省 杭州市 西湖区', longitude: 120.1302,
    latitude: 30.2595, timezone: 'Asia/Shanghai', useTrueSolarTime: true, dayBoundary: 'midnight',
    dstPolicy: 'auto', luckMethod: 'sect1',
  },
  bazi: {
    pillars: ['壬申', '戊申', '丙寅', '癸巳'], correctedLocalTime: '1992-08-18T09:27', correctionMinutes: -2.67,
    ruleVersion: 'bazi-v5-stem-branch-relations', tenGods: ['七杀', '食神', '日主', '正官'],
    hiddenStems: [['庚', '壬', '戊'], ['庚', '壬', '戊'], ['甲', '丙', '戊'], ['丙', '戊', '庚']],
    professional: {
      naYin: ['剑锋金', '大驿土', '炉中火', '白蜡金'], voidBranches: ['戌亥', '寅卯', '戌亥', '午未'],
      twelveGrowthStages: ['病', '病', '长生', '临官'],
    },
    luckCycles: [{ pillar: '己酉', startAge: 8, startDate: '1999-05-28', endDate: '2009-05-28', direction: 'forward', status: 'derived' }],
    timeProfile: {
      timezone: 'Asia/Shanghai', utcOffsetMinutes: 480, standardUtcOffsetMinutes: 480, daylightSavingMinutes: 0,
      dstPolicy: 'auto', dayBoundary: 'midnight', luckMethod: 'sect1', standardMeridian: 120,
      trueSolarCorrectionMinutes: -2.67, timeCorrectionRuleVersion: 'true-solar-v2-zone-meridian-equation-of-time',
    },
  },
}

describe('chart export documents', () => {
  it('creates a Chinese, versioned view model from an explicit allowlist', () => {
    const view = createChartExportViewModel({
      ...snapshot,
      secretToken: 'must-not-leak',
      birth: { ...snapshot.birth, fileId: 'private-media' },
    } as ChartExportSnapshot)
    expect(view.title).toBe('四柱命盘')
    expect(view.versionLabel).toBe('v7')
    expect(view.birthLabel).toContain('浙江省 杭州市 西湖区')
    expect(JSON.stringify(view)).not.toContain('must-not-leak')
    expect(JSON.stringify(view)).not.toContain('private-media')
    expect(JSON.stringify(view)).not.toContain('private-profile-id')
  })

  it('escapes hostile text and emits no executable markup', () => {
    const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)>'
    const input = { ...snapshot, birth: { ...snapshot.birth, locationName: hostile } }
    for (const document of [buildChartExportHtml(input), buildChartExportSvg(input)]) {
      expect(document).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(document).not.toMatch(/<script\b/i)
      expect(document).not.toMatch(/<img\b/i)
      expect(document).not.toMatch(/<[^>]+\son\w+\s*=/i)
      expect(document).not.toContain('private-profile-id')
    }
  })

  it('renders Chinese chart data and the immutable historical version number', () => {
    const html = buildChartExportHtml(snapshot)
    const svg = buildChartExportSvg(snapshot)
    expect(html).toContain('<html lang="zh-CN">')
    expect(html).toContain('四柱命盘')
    expect(html).toContain('壬申')
    expect(html).toContain('己酉')
    expect(html).toContain('版本 v7')
    expect(svg).toContain('四柱命盘 v7')
    expect(svg).toContain('浙江省 杭州市 西湖区')
  })
})
