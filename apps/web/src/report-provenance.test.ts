import { describe, expect, it } from 'vitest'
import {
  buildReportGenerationSummary,
  formatReportGeneratedAt,
  reportValidatorResultLabel,
  type ReportGenerationProvenance,
} from './report-provenance'

describe('report generation provenance summary', () => {
  it('formats a complete generation summary from whitelisted fields', () => {
    expect(buildReportGenerationSummary({
      model: 'deepseek-chat',
      generatedAt: '2026-09-01T18:30:05.000Z',
      validatorResult: 'pass',
    })).toEqual({
      recorded: true,
      modelLabel: 'deepseek-chat',
      generatedAtLabel: '2026-09-01 18:30:05 UTC',
      validatorLabel: '校验通过',
    })
  })

  it('uses the exact legacy message when a report has no generation provenance', () => {
    expect(buildReportGenerationSummary(undefined)).toEqual({
      recorded: false,
      modelLabel: '历史报告未记录生成环境',
      generatedAtLabel: '历史报告未记录生成环境',
      validatorLabel: '历史报告未记录生成环境',
    })
  })

  it('maps every validator result to Chinese UI copy', () => {
    expect(reportValidatorResultLabel('pass')).toBe('校验通过')
    expect(reportValidatorResultLabel('fail')).toBe('校验失败')
    expect(reportValidatorResultLabel('not-run')).toBe('未运行校验')
  })

  it('does not traverse or display internal extra fields', () => {
    const malicious = {
      model: 'deepseek-chat',
      generatedAt: '2026-09-01T18:30:05Z',
      validatorResult: 'fail',
      baseUrlLabel: 'api.deepseek.com',
      contentHash: 'sha256:secret',
      promptSha256: 'abc123',
      pluginManifestPath: '/Users/person/project/plugin.json',
      nested: { localPath: '/tmp/internal', internalPluginField: 'hidden' },
    } satisfies ReportGenerationProvenance & Record<string, unknown>

    const summaryText = JSON.stringify(buildReportGenerationSummary(malicious))

    expect(summaryText).toContain('deepseek-chat')
    expect(summaryText).toContain('校验失败')
    expect(summaryText).not.toContain('api.deepseek.com')
    expect(summaryText).not.toContain('sha256')
    expect(summaryText).not.toContain('/Users')
    expect(summaryText).not.toContain('plugin')
    expect(summaryText).not.toContain('/tmp/internal')
  })

  it('keeps missing and non-standard timestamps explicit without inventing values', () => {
    expect(formatReportGeneratedAt(undefined)).toBe('未记录')
    expect(formatReportGeneratedAt('manual-demo-time')).toBe('manual-demo-time')
  })
})
