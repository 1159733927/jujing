import type { BaziChart, BirthInput, LuckCycle, ProfessionalChartFields } from '@fengshui/domain'

type ChartExportBirth = Pick<BirthInput, 'date' | 'time' | 'locationName' | 'timezone'> & Partial<BirthInput>
type ChartExportBazi = {
  readonly pillars: readonly string[]
  readonly correctedLocalTime: string
  readonly correctionMinutes: number
  readonly ruleVersion?: string
  readonly tenGods?: BaziChart['tenGods']
  readonly hiddenStems?: BaziChart['hiddenStems']
  readonly luckCycles?: readonly Partial<LuckCycle>[]
  readonly professional?: Partial<ProfessionalChartFields>
  readonly timeProfile?: {
    readonly timezone?: string
    readonly utcOffsetMinutes?: number
    readonly standardUtcOffsetMinutes?: number
    readonly daylightSavingMinutes?: number
    readonly standardMeridian?: number
    readonly trueSolarCorrectionMinutes?: number
    readonly timeCorrectionRuleVersion?: string
    readonly dayBoundary?: 'midnight' | 'zi-hour-start'
    readonly dstPolicy?: 'auto' | 'ignore'
    readonly luckMethod?: 'sect1' | 'sect2'
  }
}

export interface ChartExportSnapshot {
  readonly profileId?: string
  readonly revision?: number
  readonly version?: number
  readonly birth: ChartExportBirth
  readonly bazi: ChartExportBazi
  readonly savedAt: string
}

export interface ChartExportRow {
  readonly label: string
  readonly values: readonly [string, string, string, string]
}

export interface ChartExportLuckCycle {
  readonly pillar: string
  readonly startAge: string
  readonly startDate: string
  readonly endDate: string
  readonly direction: string
}

export interface ChartExportViewModel {
  readonly title: string
  readonly versionLabel: string
  readonly birthLabel: string
  readonly correctedTimeLabel: string
  readonly parameterLabel: string
  readonly ruleLabel: string
  readonly pillars: readonly [string, string, string, string]
  readonly rows: readonly ChartExportRow[]
  readonly luckCycles: readonly ChartExportLuckCycle[]
  readonly provenanceLabel: string
}

type ReportStableVersion = { version: number; versionId: string; contentHash: string }
type ReportVisionObservation = { room: string; summary: string; observedElements?: readonly string[]; uncertainties?: readonly string[] }
type ReportExportBazi = {
  readonly pillars: readonly string[]
  readonly correctedLocalTime?: unknown
  readonly correctionMinutes?: unknown
  readonly ruleVersion?: string
  readonly timeCorrectionRuleVersion?: string
  readonly professional?: { readonly ruleVersion?: string }
  readonly timeProfile?: {
    readonly timezone: string
    readonly standardMeridian: number
    readonly trueSolarCorrectionMinutes: number
    readonly daylightSavingMinutes: number
    readonly timeCorrectionRuleVersion?: string
    readonly dayBoundary: 'midnight' | 'zi-hour-start'
    readonly dstPolicy: 'auto' | 'ignore'
    readonly luckMethod: 'sect1' | 'sect2'
  }
}

export type ReportExportSnapshot = {
  readonly id: string
  readonly status: 'queued' | 'completed' | 'failed'
  readonly createdAt?: string
  readonly report?: string
  readonly chartProfileId?: string
  readonly chartVersionId?: string
  readonly residenceProfileId?: string
  readonly residenceVersionId?: string
  readonly bazi: ReportExportBazi
  readonly vision?: readonly ReportVisionObservation[]
  readonly citations?: readonly ({ readonly title: string; readonly sourceLabel: string; readonly excerpt?: string } & ReportStableVersion)[]
  readonly evaluatedRules?: readonly ({ readonly title: string; readonly priority: number; readonly conclusions: readonly { readonly code?: string; readonly level?: string; readonly text: string }[] } & ReportStableVersion)[]
}

const pillarLabels = ['年柱', '月柱', '日柱', '时柱'] as const

function displayValue(input: unknown, fallback = '待计算'): string {
  if (input === undefined || input === null || input === '') return fallback
  return String(input)
}

function fourValues(factory: (index: number) => unknown): [string, string, string, string] {
  return [0, 1, 2, 3].map((index) => displayValue(factory(index))) as [string, string, string, string]
}

function safeVersion(input: number | undefined): number {
  return Number.isSafeInteger(input) && (input ?? 0) > 0 ? input! : 1
}

/** Builds an explicit export allowlist. Never render a persisted snapshot directly. */
export function createChartExportViewModel(snapshot: ChartExportSnapshot): ChartExportViewModel {
  const version = safeVersion(snapshot.version)
  const timezone = snapshot.bazi.timeProfile?.timezone ?? snapshot.birth.timezone ?? 'Asia/Shanghai'
  const dayBoundary = snapshot.bazi.timeProfile?.dayBoundary === 'zi-hour-start' ? '子初换日' : '午夜换日'
  const dstPolicy = snapshot.bazi.timeProfile?.dstPolicy === 'ignore' ? '不启用夏令时' : '自动夏令时'

  return {
    title: '四柱命盘',
    versionLabel: `v${version}`,
    birthLabel: `${displayValue(snapshot.birth.date)} ${displayValue(snapshot.birth.time)} · ${displayValue(snapshot.birth.locationName)}`,
    correctedTimeLabel: `${displayValue(snapshot.bazi.correctedLocalTime)} · 校正 ${displayValue(snapshot.bazi.correctionMinutes)} 分钟`,
    parameterLabel: `${timezone} · ${dayBoundary} · ${dstPolicy}`,
    ruleLabel: displayValue(snapshot.bazi.ruleVersion, 'unknown'),
    pillars: fourValues((index) => snapshot.bazi.pillars[index]),
    rows: [
      { label: '十神', values: fourValues((index) => snapshot.bazi.tenGods?.[index]) },
      { label: '天干', values: fourValues((index) => snapshot.bazi.pillars[index]?.slice(0, 1)) },
      { label: '地支', values: fourValues((index) => snapshot.bazi.pillars[index]?.slice(1, 2)) },
      { label: '藏干', values: fourValues((index) => snapshot.bazi.hiddenStems?.[index]?.join('、')) },
      { label: '纳音', values: fourValues((index) => snapshot.bazi.professional?.naYin?.[index]) },
      { label: '空亡', values: fourValues((index) => snapshot.bazi.professional?.voidBranches?.[index]) },
      { label: '地势', values: fourValues((index) => snapshot.bazi.professional?.twelveGrowthStages?.[index]) },
    ],
    luckCycles: (snapshot.bazi.luckCycles ?? []).slice(0, 8).map((cycle) => ({
      pillar: displayValue(cycle.pillar),
      startAge: displayValue(cycle.startAge, '—'),
      startDate: displayValue(cycle.startDate, '—'),
      endDate: displayValue(cycle.endDate, '—'),
      direction: cycle.direction === 'backward' ? '逆行' : cycle.direction === 'forward' ? '顺行' : '待定',
    })),
    provenanceLabel: `版本 v${version} · 保存时间 ${displayValue(snapshot.savedAt)} · 规则版本 ${displayValue(snapshot.bazi.ruleVersion, 'unknown')}`,
  }
}

function escapeMarkup(input: unknown): string {
  return String(input ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function printableValue(value: unknown, fallback = '未记录'): string {
  if (value === undefined || value === null || value === '') return fallback
  return String(value)
}

function publicVersionLabel(version: ReportStableVersion): string {
  return `版本 ${version.version}`
}

export function canPrintReport(report: ReportExportSnapshot | null | undefined): report is ReportExportSnapshot & { report: string } {
  return report?.status === 'completed' && Boolean(report.report?.trim())
}

export function buildReportPrintTitle(_report: Pick<ReportExportSnapshot, 'id'>): string {
  return '住宅文化分析报告'
}

function renderInlineMarkdown(input: string): string {
  const escaped = escapeMarkup(input)
  return escaped.replace(/\*\*([^*\n][^*\n]*(?:\*[^*\n]+)*?)\*\*/gu, '<strong>$1</strong>')
}

function renderReportMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n')
  const blocks: string[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | undefined

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    const tag = list.ordered ? 'ol' : 'ul'
    blocks.push(`<${tag}>${list.items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${tag}>`)
    list = undefined
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/u.exec(trimmed)
    if (heading) {
      flushParagraph()
      flushList()
      const level = Math.min(heading[1]!.length + 1, 4)
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2]!)}</h${level}>`)
      continue
    }
    const ordered = /^\d+[.)]\s+(.+)$/u.exec(trimmed)
    const unordered = /^[-*]\s+(.+)$/u.exec(trimmed)
    if (ordered || unordered) {
      flushParagraph()
      const nextOrdered = Boolean(ordered)
      if (list && list.ordered !== nextOrdered) flushList()
      list ??= { ordered: nextOrdered, items: [] }
      list.items.push((ordered?.[1] ?? unordered?.[1] ?? '').trim())
      continue
    }
    flushList()
    paragraph.push(trimmed)
  }
  flushParagraph()
  flushList()
  return blocks.join('\n')
}

export function buildReportExportHtml(report: ReportExportSnapshot): string {
  if (!canPrintReport(report)) throw new Error('只有已完成且包含正文的报告可以打印或保存 PDF。')

  const title = buildReportPrintTitle(report)
  const timeProfile = report.bazi.timeProfile
  const ruleFacts = [
    ['创建时间', printableValue(report.createdAt)],
    ['命盘档案 ID', printableValue(report.chartProfileId)],
    ['命盘版本 ID', printableValue(report.chartVersionId)],
    ['住宅档案 ID', printableValue(report.residenceProfileId)],
    ['住宅版本 ID', printableValue(report.residenceVersionId)],
    ['四柱', report.bazi.pillars.join(' · ')],
    ['真太阳时', printableValue(report.bazi.correctedLocalTime)],
    ['校正分钟', report.bazi.correctionMinutes === undefined ? '未记录' : `${printableValue(report.bazi.correctionMinutes)} 分钟`],
    ['八字规则版本', printableValue(report.bazi.ruleVersion)],
    ['真太阳时规则版本', printableValue(report.bazi.timeCorrectionRuleVersion ?? timeProfile?.timeCorrectionRuleVersion)],
    ['专业规则版本', printableValue(report.bazi.professional?.ruleVersion)],
    ['时间参数', timeProfile
      ? `${timeProfile.timezone} · ${timeProfile.dayBoundary === 'zi-hour-start' ? '子初换日' : '午夜换日'} · ${timeProfile.dstPolicy === 'ignore' ? '忽略夏令时' : '自动夏令时'} · ${timeProfile.luckMethod === 'sect2' ? '流派二' : '流派一'}`
      : '未记录'],
    ['标准经线', timeProfile ? `${timeProfile.standardMeridian}°` : '未记录'],
  ]
  const factRows = ruleFacts.map(([label, value]) => `<tr><th>${escapeMarkup(label)}</th><td>${escapeMarkup(value)}</td></tr>`).join('')
  const visionRows = (report.vision ?? []).map((item, index) => `<li><b>${escapeMarkup(item.room || `照片观察 ${index + 1}`)}</b><span>${escapeMarkup(item.summary)}</span></li>`).join('')
  const ruleRows = (report.evaluatedRules ?? []).map((rule) => `<li><b>${escapeMarkup(rule.title)}</b><span>${escapeMarkup(publicVersionLabel(rule))} · 优先级 ${escapeMarkup(rule.priority)} · ${escapeMarkup(rule.conclusions.map((item) => item.text).join('；'))}</span></li>`).join('')
  const citationRows = (report.citations ?? []).map((citation) => `<li><b>${escapeMarkup(citation.title)}</b><span>${escapeMarkup(publicVersionLabel(citation))} · ${escapeMarkup(citation.sourceLabel)}${citation.excerpt ? ` · ${escapeMarkup(citation.excerpt)}` : ''}</span></li>`).join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeMarkup(title)}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Songti SC", "Noto Serif CJK SC", serif; color: #17271f; background: #f7f2e8; }
    main { background: #fffdfa; border: 1px solid #ded6c8; border-radius: 18px; padding: 28px; }
    h1 { margin: 0 0 8px; font-size: 31px; }
    h2 { margin: 24px 0 10px; color: #22372e; font-size: 19px; }
    h3, h4 { margin: 18px 0 8px; color: #22372e; }
    .meta { color: #65736b; line-height: 1.7; font-size: 13px; }
    .notice { margin: 20px 0; padding: 12px 14px; border: 1px solid #dbc9ad; border-radius: 10px; background: #fff8ed; color: #6f552f; line-height: 1.7; font-size: 12px; }
    .copy { line-height: 1.85; font-size: 14px; }
    .copy p { margin: 0 0 10px; }
    .copy ul, .copy ol { margin: 8px 0 14px 20px; padding: 0; }
    .copy li { margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
    th, td { border: 1px solid #e2dbcf; padding: 9px 10px; vertical-align: top; text-align: left; }
    th { width: 110px; background: #f1eadf; color: #29483b; }
    .evidence-list { list-style: none; padding: 0; margin: 10px 0 0; display: grid; gap: 8px; }
    .evidence-list li { border-left: 3px solid #8aa493; background: #edf2ec; padding: 9px 11px; line-height: 1.6; break-inside: avoid; }
    .evidence-list li b { display: block; color: #284d3e; font-size: 12px; }
    .evidence-list li span { display: block; color: #40564b; font-size: 12px; }
    .empty { color: #65736b; font-size: 12px; }
  </style>
</head>
<body>
  <main>
    <h1>住宅文化分析报告</h1>
    <div class="meta">
      <div>创建时间：${escapeMarkup(printableValue(report.createdAt))}</div>
      <div>四柱：${escapeMarkup(report.bazi.pillars.join(' · '))}</div>
    </div>
    <p class="notice">本报告仅供传统文化研究与娱乐参考，不构成医疗、法律、财务或人生决策建议。打印/PDF 内容来自已完成报告，保留可读规则依据与引用证据，便于后续复核。</p>
    <section class="copy">${renderReportMarkdown(report.report)}</section>
    <h2>命盘与规则依据</h2>
    <table><tbody>${factRows}</tbody></table>
    <h2>照片观察</h2>
    ${visionRows ? `<ul class="evidence-list">${visionRows}</ul>` : '<p class="empty">未记录照片观察。</p>'}
    <h2>确定性规则</h2>
    ${ruleRows ? `<ul class="evidence-list">${ruleRows}</ul>` : '<p class="empty">未记录确定性规则命中。</p>'}
    <h2>专家资料引用</h2>
    ${citationRows ? `<ul class="evidence-list">${citationRows}</ul>` : '<p class="empty">未记录专家资料引用。</p>'}
  </main>
</body>
</html>`
}

export function buildChartExportHtml(snapshot: ChartExportSnapshot): string {
  const view = createChartExportViewModel(snapshot)
  const matrixRows = view.rows.map((row) => `<tr><th>${escapeMarkup(row.label)}</th>${row.values.map((cell) => `<td>${escapeMarkup(cell)}</td>`).join('')}</tr>`).join('')
  const luckRows = view.luckCycles.map((cycle) => `<tr><td>${escapeMarkup(cycle.pillar)}</td><td>${escapeMarkup(cycle.startAge)}</td><td>${escapeMarkup(cycle.startDate)}</td><td>${escapeMarkup(cycle.endDate)}</td><td>${escapeMarkup(cycle.direction)}</td></tr>`).join('')
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeMarkup(view.title)} ${escapeMarkup(view.versionLabel)}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    body { font-family: "Songti SC", "Noto Serif CJK SC", serif; color: #17271f; background: #f7f2e8; }
    main { background: #fffdfa; border: 1px solid #ded6c8; border-radius: 18px; padding: 28px; }
    h1 { margin: 0 0 8px; font-size: 34px; }
    .meta { color: #65736b; line-height: 1.7; }
    .pillars { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 24px 0; }
    .pillar { background: #194735; color: white; border-radius: 14px; padding: 16px; text-align: center; }
    .pillar span { display: block; color: #c5d6cc; font-size: 12px; margin-bottom: 8px; }
    .pillar b { font-size: 30px; letter-spacing: .16em; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px; }
    th, td { border: 1px solid #e2dbcf; padding: 10px; text-align: center; }
    th { background: #f1eadf; color: #29483b; }
    .note { margin-top: 24px; color: #65736b; font-size: 12px; line-height: 1.7; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeMarkup(view.title)}</h1>
    <div class="meta">
      <div>出生：${escapeMarkup(view.birthLabel)}</div>
      <div>真太阳时：${escapeMarkup(view.correctedTimeLabel)}</div>
      <div>参数：${escapeMarkup(view.parameterLabel)}</div>
    </div>
    <section class="pillars">${pillarLabels.map((label, index) => `<div class="pillar"><span>${label}</span><b>${escapeMarkup(view.pillars[index])}</b></div>`).join('')}</section>
    <table><thead><tr><th></th>${pillarLabels.map((label) => `<th>${label}</th>`).join('')}</tr></thead><tbody>${matrixRows}</tbody></table>
    <h2>大运</h2>
    <table><thead><tr><th>大运</th><th>起运年龄</th><th>开始</th><th>结束</th><th>方向</th></tr></thead><tbody>${luckRows || '<tr><td colspan="5">待计算</td></tr>'}</tbody></table>
    <p class="note">${escapeMarkup(view.provenanceLabel)}。本导出仅包含已保存的程序排盘结果，不调用远程服务，不包含住宅照片。</p>
  </main>
</body>
</html>`
}

export function buildChartExportSvg(snapshot: ChartExportSnapshot): string {
  const view = createChartExportViewModel(snapshot)
  const facts = [view.birthLabel, `真太阳时 ${view.correctedTimeLabel}`, `规则 ${view.ruleLabel}`]
  const table = view.rows.map((row, rowIndex) => [row.label, ...row.values].map((cell, colIndex) => {
    const x = 70 + colIndex * 205
    const y = 430 + rowIndex * 70
    return `<text x="${x}" y="${y}" font-size="${colIndex === 0 ? 24 : 28}" fill="${colIndex === 0 ? '#5e6b64' : '#243c32'}">${escapeMarkup(cell)}</text>`
  }).join('')).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <rect width="1200" height="1600" fill="#f7f2e8"/>
  <rect x="52" y="52" width="1096" height="1496" rx="30" fill="#fffdfa" stroke="#ded6c8"/>
  <text x="90" y="130" font-size="48" font-family="Songti SC, serif" fill="#17271f">${escapeMarkup(`${view.title} ${view.versionLabel}`)}</text>
  ${facts.map((fact, index) => `<text x="90" y="${178 + index * 34}" font-size="22" fill="#65736b">${escapeMarkup(fact)}</text>`).join('')}
  ${pillarLabels.map((label, index) => `<g><rect x="${90 + index * 260}" y="300" width="220" height="110" rx="18" fill="#194735"/><text x="${200 + index * 260}" y="340" font-size="21" text-anchor="middle" fill="#c5d6cc">${label}</text><text x="${200 + index * 260}" y="386" font-size="44" text-anchor="middle" fill="#fff">${escapeMarkup(view.pillars[index])}</text></g>`).join('')}
  ${Array.from({ length: view.rows.length + 1 }, (_, index) => `<line x1="60" x2="1140" y1="${395 + index * 70}" y2="${395 + index * 70}" stroke="#e2dbcf"/>`).join('')}
  ${Array.from({ length: 6 }, (_, index) => `<line y1="395" y2="${395 + view.rows.length * 70}" x1="${50 + index * 205}" x2="${50 + index * 205}" stroke="#e2dbcf"/>`).join('')}
  ${table}
  <text x="90" y="1485" font-size="20" fill="#65736b">本图片由本地已保存命盘生成，不包含住宅照片，不调用远程服务。</text>
</svg>`
}
