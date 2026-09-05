import { buildChartExportSvg, type ChartExportSnapshot } from '@fengshui/export-documents'

export {
  buildChartExportHtml,
  buildChartExportSvg,
  createChartExportViewModel,
  type ChartExportSnapshot,
  type ChartExportViewModel,
} from '@fengshui/export-documents'

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function exportChartAsPng(snapshot: ChartExportSnapshot): Promise<void> {
  const svg = buildChartExportSvg(snapshot)
  const image = new Image()
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('命盘图片渲染失败'))
    image.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 1600
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器不支持 Canvas 导出')
  context.drawImage(image, 0, 0)
  URL.revokeObjectURL(url)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('命盘 PNG 生成失败')), 'image/png'))
  downloadBlob(blob, `bazi-chart-v${snapshot.version ?? 1}.png`)
}

export function downloadChartPdf(profileId: string, versionId: string): void {
  const link = document.createElement('a')
  link.href = `/api/v1/charts/${encodeURIComponent(profileId)}/versions/${encodeURIComponent(versionId)}/pdf`
  link.download = ''
  document.body.append(link)
  link.click()
  link.remove()
}
