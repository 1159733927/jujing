import { buildChartExportHtml, type ChartExportSnapshot } from '../src/chart-export.js'

const sample: ChartExportSnapshot = {
  version: 2,
  revision: 2,
  savedAt: '2026-08-31T09:30:00.000Z',
  birth: {
    date: '1992-08-18', time: '09:30', locationName: '浙江省 杭州市 西湖区',
    longitude: 120.1302, latitude: 30.2595, timezone: 'Asia/Shanghai',
    calendarSystem: 'solar', useTrueSolarTime: true, dstPolicy: 'auto',
    dayBoundary: 'midnight', luckMethod: 'sect1', gender: 'male',
  },
  bazi: {
    pillars: ['壬申', '戊申', '丙寅', '癸巳'],
    correctedLocalTime: '1992-08-18T09:27',
    correctionMinutes: -2.67,
    ruleVersion: 'bazi-v5-stem-branch-relations',
    tenGods: ['七杀', '食神', '比肩', '正官'],
    hiddenStems: [['庚', '壬', '戊'], ['庚', '壬', '戊'], ['甲', '丙', '戊'], ['丙', '戊', '庚']],
    professional: {
      naYin: ['剑锋金', '大驿土', '炉中火', '长流水'],
      voidBranches: ['戌亥', '寅卯', '戌亥', '午未'],
      twelveGrowthStages: ['病', '病', '长生', '临官'],
    },
    luckCycles: [{ pillar: '己酉', startAge: 8, startDate: '1999-05-28', direction: 'forward', status: 'derived' }],
    timeProfile: {
      timezone: 'Asia/Shanghai', dstPolicy: 'auto', dayBoundary: 'midnight', luckMethod: 'sect1',
      standardMeridian: 120, trueSolarCorrectionMinutes: -2.67, daylightSavingMinutes: 0,
    },
  },
}

process.stdout.write(buildChartExportHtml(sample))
