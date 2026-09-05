export type ReportReadinessStatus = 'loading' | 'ready' | 'not-ready' | 'unknown'

export type ReportReadinessComponent = {
  key: 'deepseek-model' | 'expert-knowledge-base' | 'expert-published-sources' | 'structured-rules' | 'harness-runtime'
  label: string
  ready: boolean | null
}

export type ReportReadinessState = {
  status: ReportReadinessStatus
  components: readonly ReportReadinessComponent[]
  message: string
}

type ReportReadinessChecks = {
  deepseekApiKey: boolean
  knowledgeMcpToken: boolean
  publishedExpertKnowledge: boolean
  publishedRules: boolean
  harnessArtifacts: boolean
}

const componentLabels: Record<ReportReadinessComponent['key'], string> = {
  'deepseek-model': 'DeepSeek模型',
  'expert-knowledge-base': '知识库连接',
  'expert-published-sources': '已发布专家资料',
  'structured-rules': '结构化规则（增强项）',
  'harness-runtime': 'Harness运行组件',
}

export const reportReadinessLoading: ReportReadinessState = {
  status: 'loading',
  message: '正在检查报告生成组件',
  components: [
    { key: 'deepseek-model', label: componentLabels['deepseek-model'], ready: null },
    { key: 'expert-knowledge-base', label: componentLabels['expert-knowledge-base'], ready: null },
    { key: 'expert-published-sources', label: componentLabels['expert-published-sources'], ready: null },
    { key: 'structured-rules', label: componentLabels['structured-rules'], ready: null },
    { key: 'harness-runtime', label: componentLabels['harness-runtime'], ready: null },
  ],
}

export const reportReadinessUnknown: ReportReadinessState = {
  status: 'unknown',
  message: '暂时无法确认报告生成组件状态',
  components: reportReadinessLoading.components,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseChecks(value: unknown): ReportReadinessChecks {
  if (!isRecord(value)) throw new Error('报告就绪检查缺少组件状态。')
  const { deepseekApiKey, knowledgeMcpToken, publishedExpertKnowledge, publishedRules, harnessArtifacts } = value
  if (
    typeof deepseekApiKey !== 'boolean' ||
    typeof knowledgeMcpToken !== 'boolean' ||
    typeof publishedExpertKnowledge !== 'boolean' ||
    typeof publishedRules !== 'boolean' ||
    typeof harnessArtifacts !== 'boolean'
  ) {
    throw new Error('报告就绪检查组件状态格式错误。')
  }
  return { deepseekApiKey, knowledgeMcpToken, publishedExpertKnowledge, publishedRules, harnessArtifacts }
}

export function parseReportReadinessPayload(httpStatus: number, payload: unknown): ReportReadinessState {
  if (!isRecord(payload)) throw new Error('报告就绪检查响应格式错误。')
  const expectedStatus = httpStatus === 200 ? 'ready' : httpStatus === 503 ? 'not-ready' : ''
  if (!expectedStatus) throw new Error(`报告就绪检查返回了不支持的 HTTP ${httpStatus}。`)
  if (payload.status !== expectedStatus) throw new Error('报告就绪检查状态与 HTTP 状态不一致。')
  const checks = parseChecks(payload.checks)
  const components = [
    { key: 'deepseek-model' as const, label: componentLabels['deepseek-model'], ready: checks.deepseekApiKey },
    { key: 'expert-knowledge-base' as const, label: componentLabels['expert-knowledge-base'], ready: checks.knowledgeMcpToken },
    { key: 'expert-published-sources' as const, label: componentLabels['expert-published-sources'], ready: checks.publishedExpertKnowledge },
    { key: 'structured-rules' as const, label: componentLabels['structured-rules'], ready: checks.publishedRules },
    { key: 'harness-runtime' as const, label: componentLabels['harness-runtime'], ready: checks.harnessArtifacts },
  ]
  if (expectedStatus === 'ready' && components.some((component) => component.key !== 'structured-rules' && !component.ready)) {
    throw new Error('报告就绪检查 ready 响应包含未就绪组件。')
  }

  return {
    status: expectedStatus,
    components,
    message: expectedStatus === 'ready' ? '报告生成链路已就绪' : '报告生成链路尚未就绪',
  }
}

export async function fetchReportReadiness(signal?: AbortSignal): Promise<ReportReadinessState> {
  try {
    const response = await fetch('/api/ready/report', { signal })
    const payload = await response.json() as unknown
    return parseReportReadinessPayload(response.status, payload)
  } catch {
    return reportReadinessUnknown
  }
}

export function canSubmitReport(params: {
  busy: boolean
  readiness: Pick<ReportReadinessState, 'status'>
  photoCount: number
  inputError: string
}): boolean {
  return !params.busy && params.readiness.status === 'ready' && params.photoCount > 0 && !params.inputError
}

export function reportReadinessSubmitError(readiness: Pick<ReportReadinessState, 'status'>): string {
  if (readiness.status === 'ready') return ''
  if (readiness.status === 'not-ready') return '报告生成链路尚未就绪，请检查 DeepSeek模型、知识库连接、已发布专家资料和 Harness运行组件后重试。'
  return '暂时无法确认报告生成链路状态，请重试。'
}
