export type ReportValidatorResult = 'pass' | 'fail' | 'not-run'

export type ReportGenerationProvenance = {
  model?: string
  generatedAt?: string
  validatorResult?: ReportValidatorResult
}

export type ReportGenerationSummary = {
  recorded: boolean
  modelLabel: string
  generatedAtLabel: string
  validatorLabel: string
}

const validatorResultLabels: Record<ReportValidatorResult, string> = {
  pass: '校验通过',
  fail: '校验失败',
  'not-run': '未运行校验',
}

export function reportValidatorResultLabel(result: ReportGenerationProvenance['validatorResult']): string {
  return result && result in validatorResultLabels ? validatorResultLabels[result] : '未记录'
}

export function formatReportGeneratedAt(value: string | undefined): string {
  if (!value?.trim()) return '未记录'
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d{3})?Z$/u.exec(value.trim())
  return match ? `${match[1]} ${match[2]} UTC` : value.trim()
}

export function buildReportGenerationSummary(provenance: ReportGenerationProvenance | null | undefined): ReportGenerationSummary {
  if (!provenance) {
    return {
      recorded: false,
      modelLabel: '历史报告未记录生成环境',
      generatedAtLabel: '历史报告未记录生成环境',
      validatorLabel: '历史报告未记录生成环境',
    }
  }

  return {
    recorded: true,
    modelLabel: provenance.model?.trim() || '未记录',
    generatedAtLabel: formatReportGeneratedAt(provenance.generatedAt),
    validatorLabel: reportValidatorResultLabel(provenance.validatorResult),
  }
}
