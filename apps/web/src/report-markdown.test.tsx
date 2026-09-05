/* @vitest-environment happy-dom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ReportMarkdown, parseReportMarkdown, reportOutlineItems } from './report-markdown'

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function renderReport(report: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(<ReportMarkdown report={report} />))
  return { container, root }
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => root.unmount())
  container.remove()
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('ReportMarkdown', () => {
  it('parses the six report sections as structured headings', () => {
    const report = `## 摘要
正文

## 已知空间事实
正文

## 文化型解读
正文

## 按优先级排列的建议
正文

## 待确认信息
正文

## 依据说明
正文`
    const blocks = parseReportMarkdown(report)

    expect(blocks.filter((block) => block.type === 'heading').map((block) => block.text)).toEqual([
      '摘要',
      '已知空间事实',
      '文化型解读',
      '按优先级排列的建议',
      '待确认信息',
      '依据说明',
    ])
    expect(reportOutlineItems(report).map((item) => item.text)).toEqual([
      '摘要',
      '已知空间事实',
      '文化型解读',
      '按优先级排列的建议',
      '待确认信息',
      '依据说明',
    ])
    expect(reportOutlineItems(report).every((item) => item.deliverySection)).toBe(true)
  })

  it('renders headings, bold text, paragraphs and both list types without raw markdown marks', () => {
    const { container, root } = renderReport(`# 住宅报告

## 摘要
本报告包含 **传统文化参考**。

## 已知空间事实
- 客厅朝南
- 主卧在西侧

## 文化型解读
自然采光宜保持。

## 按优先级排列的建议
1. 保持通道整洁
2. 复核入户朝向

## 待确认信息
需要补充户型图。

## 依据说明
资料标题，v1，来源：专家库`)

    expect(container.querySelectorAll('h2,h3,h4')).toHaveLength(7)
    expect(container.querySelector('.report-outline')?.textContent).toContain('报告目录')
    expect(Array.from(container.querySelectorAll('.report-outline a')).map((item) => item.textContent)).toEqual([
      '住宅报告',
      '摘要',
      '已知空间事实',
      '文化型解读',
      '按优先级排列的建议',
      '待确认信息',
      '依据说明',
    ])
    expect(container.querySelector('h3#report-section-1-摘要')).not.toBeNull()
    expect(container.querySelector('strong')?.textContent).toBe('传统文化参考')
    expect(Array.from(container.querySelectorAll('ul li')).map((item) => item.textContent)).toEqual(['客厅朝南', '主卧在西侧'])
    expect(Array.from(container.querySelectorAll('.report-copy > ol li')).map((item) => item.textContent)).toEqual(['保持通道整洁', '复核入户朝向'])
    expect(container.querySelectorAll('p')).toHaveLength(4)
    expect(container.innerHTML).not.toContain('##')
    expect(container.innerHTML).not.toContain('**')
    expect(container.innerHTML).not.toContain('dangerouslySetInnerHTML')
    cleanup(root, container)
  })

  it('drops fence marker lines instead of rendering code blocks', () => {
    const { container, root } = renderReport(`## 摘要
\`\`\`json
{"summary":"bad envelope"}
\`\`\`
正文`)

    expect(container.querySelector('code')).toBeNull()
    expect(container.querySelector('pre')).toBeNull()
    expect(container.textContent).not.toContain('```')
    expect(container.textContent).not.toContain('summary')
    expect(container.textContent).not.toContain('bad envelope')
    expect(container.textContent).toContain('正文')
    cleanup(root, container)
  })

  it('hides unsafe technical markup lines from report display as a final frontend safeguard', () => {
    const { container, root } = renderReport(`## 摘要
正文
const payload = { unsafe: true }
{"status":"completed"}
<section>调试内容</section>
| 字段 | 内容 |
| --- | --- |

## 依据说明
资料标题，v1，来源：专家库`)

    expect(container.querySelector('code')).toBeNull()
    expect(container.querySelector('pre')).toBeNull()
    expect(container.innerHTML).not.toContain('<section>调试内容</section>')
    expect(container.textContent).not.toContain('payload')
    expect(container.textContent).not.toContain('unsafe')
    expect(container.textContent).not.toContain('status')
    expect(container.textContent).not.toContain('调试内容')
    expect(container.textContent).not.toContain('字段')
    expect(container.textContent).not.toContain('---')
    expect(container.textContent).toContain('正文')
    expect(container.textContent).toContain('资料标题')
    cleanup(root, container)
  })

  it('renders the fixed eight-section report as a closed two-layer reading view', () => {
    const { container, root } = renderReport(`# 人宅合拍报告

## 判断前提与可信度
专业前提说明

## 人宅合拍结论
核心结论文本

## 命盘需要
命盘说明

## 合拍之处
- 合拍优势

## 住宅属性
住宅属性说明

## 冲突之处
1. 冲突提醒

## 待确认信息
待确认事项

## 依据与版本
依据版本说明
\`\`\`json
{"debug":"hidden"}
\`\`\``)

    const coreLayer = container.querySelector('[data-report-layer="core"]')
    const supportLayer = container.querySelector('details[data-report-layer="support"]')

    expect(container.querySelector('h2')?.textContent).toBe('人宅合拍报告')
    expect(Array.from(container.querySelectorAll('.report-outline a')).map((item) => item.textContent)).toEqual([
      '人宅合拍结论',
      '合拍之处',
      '冲突之处',
    ])
    expect(coreLayer?.textContent).toContain('人宅合拍结论')
    expect(coreLayer?.textContent).toContain('合拍之处')
    expect(coreLayer?.textContent).toContain('冲突之处')
    expect(coreLayer?.textContent).toContain('核心结论文本')
    expect(coreLayer?.textContent).not.toContain('判断前提与可信度')
    expect(coreLayer?.textContent).not.toContain('依据与版本')
    expect(supportLayer).not.toBeNull()
    expect(supportLayer?.hasAttribute('open')).toBe(false)
    expect(supportLayer?.querySelector('summary')?.textContent).toBe('查看专业依据与待确认信息')
    expect(supportLayer?.textContent).toContain('判断前提与可信度')
    expect(supportLayer?.textContent).toContain('命盘需要')
    expect(supportLayer?.textContent).toContain('住宅属性')
    expect(supportLayer?.textContent).toContain('待确认信息')
    expect(supportLayer?.textContent).toContain('依据与版本')
    expect(supportLayer?.textContent).not.toContain('人宅合拍结论')
    expect(container.textContent).not.toContain('debug')
    cleanup(root, container)
  })

  it('extracts a complete verdict summary and removes its source paragraphs from the core body', () => {
    const { container, root } = renderReport(`# 人宅合拍报告

## 判断前提与可信度
专业前提说明

## 人宅合拍结论
总体判断：整体较为合拍。

最主要原因：采光与命盘需要相符。

需要注意：入户区域仍需保持整洁。

补充结论仍保留在正文。

## 命盘需要
命盘说明

## 合拍之处
- 合拍优势

## 住宅属性
住宅属性说明

## 冲突之处
1. 冲突提醒

## 待确认信息
待确认事项

## 依据与版本
依据版本说明`)

    const summary = container.querySelector('[data-report-verdict-summary]')
    const coreLayer = container.querySelector('[data-report-layer="core"]')

    expect(summary?.getAttribute('aria-label')).toBe('人宅合拍结果摘要')
    expect(summary?.classList.contains('report-verdict-summary')).toBe(true)
    expect(summary?.querySelector('[data-verdict-item="overall"]')?.textContent).toBe('总体判断整体较为合拍。')
    expect(summary?.querySelector('[data-verdict-item="reason"]')?.textContent).toBe('最主要原因采光与命盘需要相符。')
    expect(summary?.querySelector('[data-verdict-item="caution"]')?.textContent).toBe('需要注意入户区域仍需保持整洁。')
    expect((summary?.compareDocumentPosition(container.querySelector('.report-outline')!) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(coreLayer?.textContent).not.toContain('总体判断：')
    expect(coreLayer?.textContent).not.toContain('最主要原因：')
    expect(coreLayer?.textContent).not.toContain('需要注意：')
    expect(coreLayer?.textContent).toContain('补充结论仍保留在正文。')
    cleanup(root, container)
  })

  it('uses a complete verdict summary as the section target without leaving an empty heading', () => {
    const { container, root } = renderReport(`# 人宅合拍报告

## 判断前提与可信度
专业前提说明

## 人宅合拍结论
总体判断：整体较为合拍。

最主要原因：采光与命盘需要相符。

需要注意：入户区域仍需保持整洁。

## 命盘需要
命盘说明

## 合拍之处
- 合拍优势

## 住宅属性
住宅属性说明

## 冲突之处
1. 冲突提醒

## 待确认信息
待确认事项

## 依据与版本
依据版本说明`)

    const summary = container.querySelector('[data-report-verdict-summary]')
    const outline = container.querySelector('.report-outline')
    const verdictLink = outline?.querySelector('a[href*="人宅合拍结论"]') as HTMLAnchorElement | null

    expect(summary).not.toBeNull()
    expect((summary?.compareDocumentPosition(outline!) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(Array.from(container.querySelectorAll('h2,h3,h4')).map((heading) => heading.textContent)).not.toContain('人宅合拍结论')
    expect(verdictLink).not.toBeNull()
    expect(summary?.id).toBe(verdictLink?.hash.slice(1))
    expect(container.querySelector('[data-report-layer="core"]')?.textContent).not.toContain('人宅合拍结论')
    cleanup(root, container)
  })

  it('keeps the verdict body unchanged when the three summary items are incomplete', () => {
    const report = `# 人宅合拍报告

## 判断前提与可信度
专业前提说明

## 人宅合拍结论
总体判断：整体较为合拍。

最主要原因：采光良好。

## 命盘需要
命盘说明

## 合拍之处
合拍优势

## 住宅属性
住宅属性说明

## 冲突之处
冲突提醒

## 待确认信息
待确认事项

## 依据与版本
依据版本说明`
    const { container, root } = renderReport(report)

    expect(container.querySelector('[data-report-verdict-summary]')).toBeNull()
    expect(container.querySelector('[data-report-layer="core"]')?.textContent).toContain('总体判断：整体较为合拍。')
    expect(container.querySelector('[data-report-layer="core"]')?.textContent).toContain('最主要原因：采光良好。')
    cleanup(root, container)
  })

  it('keeps legacy reports on the existing rendering path even when verdict labels appear', () => {
    const { container, root } = renderReport(`## 摘要
总体判断：这是旧格式摘要。
最主要原因：旧格式原因。
需要注意：旧格式提醒。

## 已知空间事实
正文

## 文化型解读
正文`)

    expect(container.querySelector('[data-report-verdict-summary]')).toBeNull()
    expect(container.textContent).toContain('总体判断：这是旧格式摘要。')
    expect(container.textContent).toContain('最主要原因：旧格式原因。')
    expect(container.textContent).toContain('需要注意：旧格式提醒。')
    cleanup(root, container)
  })

  it('promotes a natural lead conclusion into a consumer summary card', () => {
    const { container, root } = renderReport(`结论先说：这套住宅和您的命盘属于局部合拍，南侧厨房是加分项，靠近中宫的卫生间是扣分项。

先说加分的一面。南侧厨房能承接火性。

可以先这样做：

1. 位置：南侧厨房。做法：保持台面清爽；目的：放大火性呼应。
2. 位置：中宫卫生间。做法：保持门常关并除湿；目的：减少中心湿气影响。`)

    const lead = container.querySelector('[data-report-lead-conclusion]')
    expect(lead?.textContent).toContain('这套住宅和您的命盘属于局部合拍')
    expect(lead?.textContent).not.toContain('结论先说')
    expect(container.querySelector('.report-copy > p')?.textContent).not.toContain('结论先说')
    expect(container.textContent).toContain('先说加分的一面')
    cleanup(root, container)
  })

  it('renders natural action suggestions as card-like action items', () => {
    const { container, root } = renderReport(`结论先说：整体局部合拍。

可以先这样做：

1. 位置：南侧厨房。做法：保持台面清爽；目的：放大火性呼应。
2. 位置：中宫卫生间。做法：保持门常关并除湿；目的：减少中心湿气影响。`)

    expect(container.querySelector('.report-action-title')?.textContent).toBe('可以先这样做：')
    const actions = Array.from(container.querySelectorAll('.report-action-list li')).map((item) => item.textContent)
    expect(actions).toEqual([
      '位置：南侧厨房。做法：保持台面清爽；目的：放大火性呼应。',
      '位置：中宫卫生间。做法：保持门常关并除湿；目的：减少中心湿气影响。',
    ])
    cleanup(root, container)
  })

  it('renders bold model action headings as the same card-like action section', () => {
    const { container, root } = renderReport(`结论先说：整体局部合拍。

**可以先这样做**

- 位置：南侧厨房。做法：保持台面清爽；目的：放大火性呼应。
- 位置：中宫卫生间。做法：保持门常关并除湿；目的：减少中心湿气影响。`)

    expect(container.querySelector('.report-action-title')?.textContent).toBe('可以先这样做')
    const actions = Array.from(container.querySelectorAll('.report-action-list li')).map((item) => item.textContent)
    expect(actions).toEqual([
      '位置：南侧厨房。做法：保持台面清爽；目的：放大火性呼应。',
      '位置：中宫卫生间。做法：保持门常关并除湿；目的：减少中心湿气影响。',
    ])
    cleanup(root, container)
  })
})
