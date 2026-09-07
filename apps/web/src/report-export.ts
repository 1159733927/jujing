import {
  buildReportExportHtml,
  buildReportPrintTitle,
  canPrintReport,
  type ReportExportSnapshot,
} from '@fengshui/export-documents'

export {
  buildReportExportHtml,
  buildReportPrintTitle,
  canPrintReport,
  type ReportExportSnapshot,
}

export function printReportAsPdf(report: ReportExportSnapshot): void {
  const target = window.open('', '_blank')
  if (!target) throw new Error('浏览器阻止了 PDF 打印窗口，请允许弹窗后重试。')
  target.opener = null
  target.document.write(buildReportExportHtml(report))
  target.document.close()
  target.document.title = buildReportPrintTitle(report)
  target.focus()
  target.print()
}

export function downloadReportPdf(reportId: string): void {
  const normalized = reportId.trim()
  if (!normalized) throw new Error('缺少报告 ID，无法导出 PDF。')
  const anchor = document.createElement('a')
  anchor.href = `/api/v1/reports/${encodeURIComponent(normalized)}/pdf`
  anchor.download = ''
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export async function downloadSharedReportPdf(reportId: string, accessToken: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const normalized = reportId.trim()
  const token = accessToken.trim()
  if (!normalized) throw new Error('缺少报告 ID，无法导出 PDF。')
  if (!token) throw new Error('缺少分享访问令牌，无法导出 PDF。')
  const response = await fetchFn(`/api/v1/shared-reports/${encodeURIComponent(normalized)}/pdf`, {
    headers: { 'x-report-share-token': token },
  })
  if (!response.ok) throw new Error('分享报告 PDF 暂时无法下载，请让分享者重新生成或重新分享。')
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = ''
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
