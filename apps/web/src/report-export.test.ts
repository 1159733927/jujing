import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildReportExportHtml,
  buildReportPrintTitle,
  canPrintReport,
  downloadReportPdf,
  printReportAsPdf,
  type ReportExportSnapshot,
} from './report-export'

const completedReport: ReportExportSnapshot = {
  id: 'report-001',
  status: 'completed',
  createdAt: '2026-08-31T12:00:00.000Z',
  report: '入户见明堂，宜保持动线清爽。\n\n文化边界已声明。',
  chartProfileId: 'chart-profile-1',
  chartVersionId: 'chart-version-3',
  bazi: {
    pillars: ['壬申', '戊申', '丙寅', '癸巳'],
    correctedLocalTime: '1992-08-18T09:27',
    correctionMinutes: -2.67,
    ruleVersion: 'bazi-v5-stem-branch-relations',
    timeCorrectionRuleVersion: 'true-solar-v3-standard-time-equation-of-time',
    professional: { ruleVersion: 'professional-v1' },
    timeProfile: {
      timezone: 'Asia/Shanghai',
      standardMeridian: 120,
      trueSolarCorrectionMinutes: -2.67,
      daylightSavingMinutes: 0,
      timeCorrectionRuleVersion: 'true-solar-v3-standard-time-equation-of-time',
      dayBoundary: 'midnight',
      dstPolicy: 'auto',
      luckMethod: 'sect1',
    },
  },
  vision: [{ room: '客厅', summary: '南向采光充足' }],
  evaluatedRules: [{
    title: '明堂规则',
    version: 2,
    versionId: 'rule:v2:abcdef123456',
    contentHash: 'sha256:abcdef1234567890',
    priority: 10,
    conclusions: [{ text: '保持入口整洁' }],
  }],
  citations: [{
    title: '专家资料',
    sourceLabel: '手册 A',
    excerpt: '入口宜明亮',
    version: 1,
    versionId: 'citation:v1:12345678abcd',
    contentHash: 'sha256:12345678abcd',
  }],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('report export builders', () => {
  it('builds printable HTML only from a completed report and keeps public provenance readable', () => {
    const html = buildReportExportHtml(completedReport)

    expect(html).toContain('住宅文化分析报告')
    expect(html).toContain('创建时间：2026-08-31T12:00:00.000Z')
    expect(html).toContain('四柱：壬申 · 戊申 · 丙寅 · 癸巳')
    expect(html).not.toContain('报告 ID：report-001')
    expect(html).toContain('<th>命盘版本 ID</th><td>chart-version-3</td>')
    expect(html).toContain('<th>八字规则版本</th><td>bazi-v5-stem-branch-relations</td>')
    expect(html).toContain('<th>真太阳时规则版本</th><td>true-solar-v3-standard-time-equation-of-time</td>')
    expect(html).toContain('<th>时间参数</th><td>Asia/Shanghai')
    expect(html).toContain('<th>专业规则版本</th><td>professional-v1</td>')
    expect(html).toContain('南向采光充足')
    expect(html).toContain('明堂规则')
    expect(html).toContain('版本 2')
    expect(html).not.toContain('abcdef123456')
    expect(html).toContain('专家资料引用')
    expect(html).toContain('传统文化研究与娱乐参考')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('fileId')
  })

  it('shows legacy missing time-correction provenance as not recorded without inventing a value', () => {
    const { timeCorrectionRuleVersion: _topLevel, timeProfile: _timeProfile, ...legacyBazi } = completedReport.bazi
    const html = buildReportExportHtml({ ...completedReport, bazi: legacyBazi })

    expect(html).not.toContain('true-solar-v2-zone-meridian-equation-of-time')
    expect(html).not.toContain('true-solar-v3-standard-time-equation-of-time')
  })

  it('rejects non-completed or empty reports instead of exporting loading and failed states', () => {
    expect(canPrintReport(completedReport)).toBe(true)
    expect(canPrintReport({ ...completedReport, status: 'queued' })).toBe(false)
    expect(canPrintReport({ ...completedReport, report: '   ' })).toBe(false)
    expect(() => buildReportExportHtml({ ...completedReport, status: 'failed' })).toThrow('已完成')
  })

  it('escapes report content and cleans the print title before opening the print dialog', () => {
    const report = {
      ...completedReport,
      id: 'report/<bad>:001',
      report: '正文 <img src=x onerror=alert(1)>',
    }
    const written: string[] = []
    const print = vi.fn()
    const target = {
      opener: {},
      document: {
        title: '',
        write: vi.fn((html: string) => written.push(html)),
        close: vi.fn(),
      },
      focus: vi.fn(),
      print,
    }
    const open = vi.fn(() => target)
    vi.stubGlobal('window', { open })

    expect(buildReportPrintTitle(report)).toBe('住宅文化分析报告')
    printReportAsPdf(report)

    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(target.opener).toBeNull()
    expect(target.document.title).toBe('住宅文化分析报告')
    expect(written[0]).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(written[0]).not.toContain('<img src=x')
    expect(print).toHaveBeenCalledOnce()
  })

  it('downloads the owned report PDF from the same-origin API', () => {
    const click = vi.fn()
    const remove = vi.fn()
    const anchor = { href: '', download: 'sentinel', rel: '', click, remove }
    const appendChild = vi.fn()
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { appendChild },
    })

    downloadReportPdf('report/001')

    expect(anchor.href).toBe('/api/v1/reports/report%2F001/pdf')
    expect(anchor.download).toBe('')
    expect(anchor.rel).toBe('noopener')
    expect(appendChild).toHaveBeenCalledWith(anchor)
    expect(click).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
    expect(() => downloadReportPdf('   ')).toThrow('报告 ID')
  })
})
