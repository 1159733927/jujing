import { Fragment, type ReactNode } from 'react'

type ReportBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'list'; ordered: boolean; items: string[] }

const HEADING = /^(#{1,6})\s+(.+)$/u
const UNORDERED_ITEM = /^\s*[-*]\s+(.+)$/u
const ORDERED_ITEM = /^\s*\d+[.、)]\s+(.+)$/u
const FENCE = /^\s*(?:```|~~~)/u
const JSON_OBJECT_LINE = /^\s*\{\s*"[^"\n]+"\s*:/u
const PLAIN_CODE_LINE = /^\s*(?:import\s+[\w*{]|export\s+(?:const|function|class|default|type|interface)|(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(|class\s+[A-Za-z_$][\w$]*\s*[{<]|interface\s+[A-Za-z_$][\w$]*\s*[{<]|type\s+[A-Za-z_$][\w$]*\s*=|return\s+(?:\{|\(|["']))/u
const HTML_TAG = /<\/?[a-z][\w:-]*(?:\s+[^<>]*)?>/iu
const MARKDOWN_TABLE_LINE = /^\s*\|[^|\n]+(?:\|[^|\n]+)+\|\s*$/u
const MARKDOWN_BOLD = /\*\*([^*]+)\*\*/gu
const DELIVERY_SECTIONS = new Set(['摘要', '已知空间事实', '文化型解读', '按优先级排列的建议', '待确认信息', '依据说明'])
const TWO_LAYER_CORE_SECTIONS = ['人宅合拍结论', '合拍之处', '冲突之处']
const TWO_LAYER_SUPPORT_SECTIONS = ['判断前提与可信度', '命盘需要', '住宅属性', '待确认信息', '依据与版本']
const TWO_LAYER_SECTIONS = new Set([...TWO_LAYER_CORE_SECTIONS, ...TWO_LAYER_SUPPORT_SECTIONS])
const TWO_LAYER_SUPPORT_SUMMARY = '查看专业依据与待确认信息'
const LEAD_CONCLUSION = /^结论先说[:：]\s*(.+)$/u
const ACTION_HEADING = /^(?:\*\*)?(?:可以先这样做|你可以先这样做|建议先这样做|先做这几件事|接下来可以这样做)(?:\*\*)?\s*[:：]?$/u
const VERDICT_LABELS = {
  overall: '总体判断',
  reason: '最主要原因',
  caution: '需要注意',
} as const
type VerdictKey = keyof typeof VERDICT_LABELS
const VERDICT_LINE = /^(?:\*\*)?(总体判断|最主要原因|需要注意)：(?:\*\*)?\s*(.*)$/u

function inlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(MARKDOWN_BOLD)) {
    const index = match.index ?? 0
    if (index > cursor) nodes.push(text.slice(cursor, index))
    nodes.push(<strong key={`${index}-${match[1]}`}>{match[1]}</strong>)
    cursor = index + match[0].length
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

export function parseReportMarkdown(report: string): ReportBlock[] {
  const blocks: ReportBlock[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | undefined
  let insideFence = false

  function flushParagraph() {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', lines: paragraph })
    paragraph = []
  }

  function flushList() {
    if (list) blocks.push({ type: 'list', ordered: list.ordered, items: list.items })
    list = undefined
  }

  for (const rawLine of report.replace(/\r\n?/gu, '\n').split('\n')) {
    const line = rawLine.trimEnd()
    if (FENCE.test(line)) {
      insideFence = !insideFence
      flushParagraph()
      flushList()
      continue
    }
    if (insideFence || JSON_OBJECT_LINE.test(line) || PLAIN_CODE_LINE.test(line) || HTML_TAG.test(line) || MARKDOWN_TABLE_LINE.test(line)) {
      flushParagraph()
      flushList()
      continue
    }
    if (line.trim() === '') {
      flushParagraph()
      flushList()
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', level: Math.min(6, heading[1].length), text: heading[2].trim() })
      continue
    }

    const ordered = ORDERED_ITEM.exec(line)
    const unordered = UNORDERED_ITEM.exec(line)
    const item = ordered?.[1] ?? unordered?.[1]
    if (item !== undefined) {
      flushParagraph()
      const isOrdered = Boolean(ordered)
      if (!list || list.ordered !== isOrdered) {
        flushList()
        list = { ordered: isOrdered, items: [] }
      }
      list.items.push(item.trim())
      continue
    }

    flushList()
    paragraph.push(line.trim())
  }
  flushParagraph()
  flushList()
  return blocks
}

function reportHeadingId(text: string, index: number): string {
  return `report-section-${index}-${Array.from(text).map((char) => /[\p{L}\p{N}]/u.test(char) ? char : '-').join('').replace(/-+/gu, '-').replace(/^-|-$/gu, '').slice(0, 48) || 'section'}`
}

export function reportOutlineItems(report: string) {
  return parseReportMarkdown(report)
    .map((block, index) => block.type === 'heading' && block.level <= 2 ? { text: block.text, id: reportHeadingId(block.text, index), deliverySection: DELIVERY_SECTIONS.has(block.text) } : null)
    .filter((item): item is { text: string; id: string; deliverySection: boolean } => Boolean(item))
}

function supportsTwoLayerReading(blocks: ReportBlock[]) {
  const sectionHeadings = new Set(blocks
    .filter((block): block is Extract<ReportBlock, { type: 'heading' }> => block.type === 'heading' && block.level <= 2)
    .map((block) => block.text))

  return [...TWO_LAYER_SECTIONS].every((section) => sectionHeadings.has(section))
}

function renderReportBlock(block: ReportBlock, index: number, variant?: 'action-list' | 'action-heading') {
  if (block.type === 'heading') {
    const Heading = block.level <= 1 ? 'h2' : block.level === 2 ? 'h3' : 'h4'
    return <Heading id={reportHeadingId(block.text, index)} key={`heading-${index}`}>{inlineMarkdown(block.text)}</Heading>
  }
  if (block.type === 'list') {
    const List = block.ordered ? 'ol' : 'ul'
    return <List key={`list-${index}`} className={variant === 'action-list' ? 'report-action-list' : undefined}>
      {block.items.map((item, itemIndex) => <li key={`${index}-${itemIndex}`}>{inlineMarkdown(item)}</li>)}
    </List>
  }
  if (variant === 'action-heading') {
    return <h3 className="report-action-title" key={`action-heading-${index}`}>{inlineMarkdown(block.lines.join(' '))}</h3>
  }
  return <p key={`paragraph-${index}`}>
    {block.lines.map((line, lineIndex) => <Fragment key={`${index}-${lineIndex}`}>
      {lineIndex > 0 ? <br /> : null}
      {inlineMarkdown(line)}
    </Fragment>)}
  </p>
}

function sectionNameForBlock(blocks: ReportBlock[], index: number) {
  for (let current = index; current >= 0; current -= 1) {
    const block = blocks[current]
    if (block.type === 'heading' && block.level <= 2) return block.text
  }
  return undefined
}

function extractVerdictSummary(blocks: ReportBlock[]) {
  const values = new Map<VerdictKey, string>()
  const extractedLines = new Map<number, Set<number>>()
  const keyByLabel = new Map<string, VerdictKey>(Object.entries(VERDICT_LABELS).map(([key, label]) => [label, key as VerdictKey]))

  blocks.forEach((block, blockIndex) => {
    if (block.type !== 'paragraph' || sectionNameForBlock(blocks, blockIndex) !== '人宅合拍结论') return
    block.lines.forEach((line, lineIndex) => {
      const match = VERDICT_LINE.exec(line)
      if (!match) return
      const key = keyByLabel.get(match[1])
      if (!key || values.has(key)) return
      values.set(key, match[2].trim())
      const lines = extractedLines.get(blockIndex) ?? new Set<number>()
      lines.add(lineIndex)
      extractedLines.set(blockIndex, lines)
    })
  })

  if (values.size !== Object.keys(VERDICT_LABELS).length) return undefined
  return { values, extractedLines }
}

function renderVerdictSummary(values: Map<VerdictKey, string>, id?: string) {
  return <section id={id} className="report-verdict-summary" aria-label="人宅合拍结果摘要" data-report-verdict-summary>
    <dl>
      {(Object.entries(VERDICT_LABELS) as Array<[VerdictKey, string]>).map(([key, label]) => <div key={key} data-verdict-item={key}>
        <dt>{label}</dt>
        <dd>{inlineMarkdown(values.get(key) ?? '')}</dd>
      </div>)}
    </dl>
  </section>
}

function extractLeadConclusion(blocks: ReportBlock[]) {
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex]
    if (block.type !== 'paragraph') continue
    for (let lineIndex = 0; lineIndex < block.lines.length; lineIndex += 1) {
      const line = block.lines[lineIndex]?.trim() ?? ''
      const match = LEAD_CONCLUSION.exec(line)
      if (match) return { blockIndex, lineIndex, text: match[1].trim() }
    }
  }
  return undefined
}

function removeExtractedLead(blocks: ReportBlock[], lead: ReturnType<typeof extractLeadConclusion>): ReportBlock[] {
  if (!lead) return blocks
  return blocks.flatMap((block, blockIndex): ReportBlock[] => {
    if (blockIndex !== lead.blockIndex || block.type !== 'paragraph') return [block]
    const lines = block.lines.filter((_, lineIndex) => lineIndex !== lead.lineIndex)
    return lines.length > 0 ? [{ ...block, lines }] : []
  })
}

function renderLeadConclusion(text: string) {
  return <section className="report-lead-conclusion" aria-label="报告核心结论" data-report-lead-conclusion>
    <span>结论</span>
    <p>{inlineMarkdown(text)}</p>
  </section>
}

function blockIsActionHeading(block: ReportBlock): boolean {
  return block.type === 'paragraph' && block.lines.length === 1 && ACTION_HEADING.test(block.lines[0]?.trim() ?? '')
}

function renderReportBlocks(blocks: Array<{ block: ReportBlock; index: number }>) {
  return blocks.map(({ block, index }, position) => {
    if (blockIsActionHeading(block)) return renderReportBlock(block, index, 'action-heading')
    const previous = blocks[position - 1]?.block
    return renderReportBlock(block, index, previous && blockIsActionHeading(previous) && block.type === 'list' ? 'action-list' : undefined)
  })
}

export function ReportMarkdown({ report }: { report: string }) {
  const blocks = parseReportMarkdown(report)
  const outline = reportOutlineItems(report)
  const useTwoLayerReading = supportsTwoLayerReading(blocks)
  const verdictSummary = useTwoLayerReading ? extractVerdictSummary(blocks) : undefined
  const leadConclusion = !verdictSummary ? extractLeadConclusion(blocks) : undefined
  const visibleOutline = useTwoLayerReading
    ? outline.filter((item) => TWO_LAYER_CORE_SECTIONS.includes(item.text))
    : outline
  const titleBlocks: Array<{ block: ReportBlock; index: number }> = []
  const coreBlocks: Array<{ block: ReportBlock; index: number }> = []
  const supportBlocks: Array<{ block: ReportBlock; index: number }> = []
  const fallbackBlocks: Array<{ block: ReportBlock; index: number }> = []
  const verdictHeadingIndex = blocks.findIndex((block) => block.type === 'heading' && block.level <= 2 && block.text === '人宅合拍结论')
  const verdictHasRemainingBody = verdictSummary && blocks.some((block, index) => {
    if (sectionNameForBlock(blocks, index) !== '人宅合拍结论' || block.type === 'heading') return false
    if (block.type !== 'paragraph' || !verdictSummary.extractedLines.has(index)) return true
    const extractedLines = verdictSummary.extractedLines.get(index)!
    return block.lines.some((_, lineIndex) => !extractedLines.has(lineIndex))
  })

  if (useTwoLayerReading) {
    blocks.forEach((block, index) => {
      const sectionName = sectionNameForBlock(blocks, index)
      if (block.type === 'heading' && block.level <= 1 && !TWO_LAYER_SECTIONS.has(block.text)) {
        titleBlocks.push({ block, index })
      } else if (sectionName && TWO_LAYER_CORE_SECTIONS.includes(sectionName)) {
        if (block.type === 'heading' && block.text === '人宅合拍结论' && verdictSummary && !verdictHasRemainingBody) return
        if (block.type === 'paragraph' && verdictSummary?.extractedLines.has(index)) {
          const extractedLines = verdictSummary.extractedLines.get(index)!
          const lines = block.lines.filter((_, lineIndex) => !extractedLines.has(lineIndex))
          if (lines.length > 0) coreBlocks.push({ block: { ...block, lines }, index })
        } else {
          coreBlocks.push({ block, index })
        }
      } else if (sectionName && TWO_LAYER_SUPPORT_SECTIONS.includes(sectionName)) {
        supportBlocks.push({ block, index })
      } else {
        fallbackBlocks.push({ block, index })
      }
    })
  }

  return <section className="report-copy">
    {useTwoLayerReading ? titleBlocks.map(({ block, index }) => renderReportBlock(block, index)) : null}
    {verdictSummary ? renderVerdictSummary(
      verdictSummary.values,
      !verdictHasRemainingBody && verdictHeadingIndex >= 0
        ? reportHeadingId('人宅合拍结论', verdictHeadingIndex)
        : undefined,
    ) : null}
    {leadConclusion ? renderLeadConclusion(leadConclusion.text) : null}
    {visibleOutline.length >= 3 && <nav className="report-outline" aria-label="报告目录">
      <b>报告目录</b>
      <ol>
        {visibleOutline.map((item) => <li key={item.id} data-core-section={item.deliverySection}>
          <a href={`#${item.id}`}>{item.text}</a>
        </li>)}
      </ol>
    </nav>}
    {useTwoLayerReading ? <>
      <div data-report-layer="core">
        {renderReportBlocks(coreBlocks)}
      </div>
      <details className="report-support-layer" data-report-layer="support">
        <summary>{TWO_LAYER_SUPPORT_SUMMARY}</summary>
        {renderReportBlocks(supportBlocks)}
      </details>
      {renderReportBlocks(fallbackBlocks)}
    </> : renderReportBlocks(removeExtractedLead(blocks, leadConclusion).map((block, index) => ({ block, index })))}
  </section>
}
