import { describe, expect, it } from 'vitest'
import { buildChartExportHtml, buildChartExportSvg, createChartExportViewModel, type ChartExportSnapshot } from './chart-export'

const snapshot: ChartExportSnapshot = {
  profileId: 'profile-one',
  revision: 2,
  version: 2,
  savedAt: '2026-08-31T00:00:00.000Z',
  birth: {
    date: '1992-08-18',
    time: '09:30',
    locationName: '浙江省 杭州市 西湖区',
    longitude: 120.1302,
    latitude: 30.2595,
    timezone: 'Asia/Shanghai',
    useTrueSolarTime: true,
    dayBoundary: 'midnight',
    dstPolicy: 'auto',
    luckMethod: 'sect1',
  },
  bazi: {
    pillars: ['壬申', '戊申', '丙寅', '癸巳'],
    correctedLocalTime: '1992-08-18T09:27',
    correctionMinutes: -2.67,
    ruleVersion: 'bazi-v5-stem-branch-relations',
    tenGods: ['七杀', '食神', '日主', '正官'],
    hiddenStems: [['庚', '壬', '戊'], ['庚', '壬', '戊'], ['甲', '丙', '戊'], ['丙', '戊', '庚']],
    professional: {
      naYin: ['剑锋金', '大驿土', '炉中火', '白蜡金'],
      voidBranches: ['戌亥', '寅卯', '戌亥', '午未'],
      twelveGrowthStages: ['病', '病', '长生', '临官'],
    },
    luckCycles: [{ pillar: '己酉', startAge: 8, startDate: '1999-05-28', endDate: '2009-05-28', direction: 'forward', status: 'derived' }],
    timeProfile: {
      timezone: 'Asia/Shanghai',
      dstPolicy: 'auto',
      dayBoundary: 'midnight',
      luckMethod: 'sect1',
      standardMeridian: 120,
      trueSolarCorrectionMinutes: -2.67,
      daylightSavingMinutes: 0,
    },
  },
}

describe('chart export builders', () => {
  it('builds printable HTML from a saved chart snapshot without embedding private media', () => {
    const html = buildChartExportHtml(snapshot)
    expect(html).toContain('四柱命盘')
    expect(html).toContain('浙江省 杭州市 西湖区')
    expect(html).toContain('壬申')
    expect(html).toContain('己酉')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('fileId')
  })

  it('reuses the shared allowlisted document view model', () => {
    const view = createChartExportViewModel({ ...snapshot, profileId: 'do-not-render' })
    expect(view.versionLabel).toBe('v2')
    expect(JSON.stringify(view)).not.toContain('do-not-render')
  })

  it('escapes user-controlled fields before rendering export markup', () => {
    const html = buildChartExportHtml({
      ...snapshot,
      birth: { ...snapshot.birth, locationName: '<img src=x onerror=alert(1)>' },
    })
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img src=x')
  })

  it('builds a stable SVG image payload for client-side PNG export', () => {
    const svg = buildChartExportSvg(snapshot)
    expect(svg).toContain('<svg')
    expect(svg).toContain('width="1200"')
    expect(svg).toContain('壬申')
    expect(svg).toContain('本图片由本地已保存命盘生成')
  })
})
