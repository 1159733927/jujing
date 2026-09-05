import { describe, expect, it } from 'vitest'
import {
  buildReportExportHtml,
  buildReportPrintTitle,
  canPrintReport,
  type ReportExportSnapshot,
} from '../src/index.js'

const completedReport: ReportExportSnapshot = {
  id: 'report-001',
  status: 'completed',
  createdAt: '2026-08-31T12:00:00.000Z',
  report: [
    '## 人宅合拍结论',
    '',
    '本次判断为**局部合拍**。',
    '',
    '1. 命盘候选方向与南向采光可合参。',
    '2. 卫生间位置仍需复核。',
    '',
    '- 信息不足处不编造。',
  ].join('\n'),
  chartProfileId: 'chart-profile-1',
  chartVersionId: 'chart-version-3',
  residenceProfileId: 'residence-profile-2',
  residenceVersionId: 'residence-version-4',
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

describe('shared report export builders', () => {
  it('builds printable HTML from a completed report and keeps public provenance readable', () => {
    const html = buildReportExportHtml(completedReport)

    expect(html).toContain('住宅文化分析报告')
    expect(html).toContain('创建时间：2026-08-31T12:00:00.000Z')
    expect(html).toContain('四柱：壬申 · 戊申 · 丙寅 · 癸巳')
    expect(html).not.toContain('报告 ID：report-001')
    expect(html).toContain('命盘档案 ID</th><td>chart-profile-1')
    expect(html).toContain('命盘版本 ID</th><td>chart-version-3')
    expect(html).toContain('住宅档案 ID</th><td>residence-profile-2')
    expect(html).toContain('住宅版本 ID</th><td>residence-version-4')
    expect(html).toContain('八字规则版本</th><td>bazi-v5-stem-branch-relations')
    expect(html).toContain('真太阳时规则版本</th><td>true-solar-v3-standard-time-equation-of-time')
    expect(html).toContain('<th>时间参数</th><td>Asia/Shanghai')
    expect(html).toContain('专业规则版本</th><td>professional-v1')
    expect(html).toContain('南向采光充足')
    expect(html).toContain('明堂规则')
    expect(html).toContain('版本 2')
    expect(html).not.toContain('abcdef123456')
    expect(html).toContain('专家资料引用')
    expect(html).toContain('传统文化研究与娱乐参考')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('fileId')
  })

  it('renders basic Markdown instead of showing source markers', () => {
    const html = buildReportExportHtml(completedReport)

    expect(html).toContain('<h3>人宅合拍结论</h3>')
    expect(html).toContain('本次判断为<strong>局部合拍</strong>。')
    expect(html).toContain('<ol><li>命盘候选方向与南向采光可合参。</li><li>卫生间位置仍需复核。</li></ol>')
    expect(html).toContain('<ul><li>信息不足处不编造。</li></ul>')
    expect(html).not.toContain('## 人宅合拍结论')
    expect(html).not.toContain('**局部合拍**')
  })

  it('escapes raw HTML in Markdown and evidence fields', () => {
    const html = buildReportExportHtml({
      ...completedReport,
      report: '正文 <img src=x onerror=alert(1)> **加粗**',
      citations: [{ ...completedReport.citations![0]!, title: '<script>alert(1)</script>' }],
    })

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert')
  })

  it('shows legacy missing time-correction provenance as not recorded without inventing a value', () => {
    const { timeCorrectionRuleVersion: _topLevel, timeProfile: _timeProfile, ...legacyBazi } = completedReport.bazi
    const html = buildReportExportHtml({ ...completedReport, bazi: legacyBazi })

    expect(html).not.toContain('true-solar-v2-zone-meridian-equation-of-time')
    expect(html).toContain('真太阳时规则版本</th><td>未记录')
  })

  it('rejects non-completed or empty reports instead of exporting loading and failed states', () => {
    expect(canPrintReport(completedReport)).toBe(true)
    expect(canPrintReport({ ...completedReport, status: 'queued' })).toBe(false)
    expect(canPrintReport({ ...completedReport, report: '   ' })).toBe(false)
    expect(() => buildReportExportHtml({ ...completedReport, status: 'failed' })).toThrow('已完成')
  })

  it('keeps the public print title stable', () => {
    expect(buildReportPrintTitle({ id: 'report/<bad>:001' })).toBe('住宅文化分析报告')
  })
})
