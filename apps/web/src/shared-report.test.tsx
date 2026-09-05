/* @vitest-environment happy-dom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { App, CURRENT_REPORT_VALIDATOR_VERSION } from './main'

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function cleanup(root: Root, container: HTMLElement) {
  act(() => root.unmount())
  container.remove()
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderSharedPath(path: string) {
  window.history.replaceState({}, '', path)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(App)))
  await flushEffects()
  return { root, container }
}

function sharedReportFixture() {
  return {
    id: 'report/001',
    status: 'completed',
    createdAt: '2026-09-03T12:00:00.000Z',
    chartVersionId: 'chart-version-1',
    report: `## 摘要
分享页可见的正式报告。

## 依据说明
资料标题，v1，来源：专家库`,
    bazi: {
      pillars: ['甲子', '乙丑', '丙寅', '丁卯'],
      correctedLocalTime: '1992-03-04 08:00',
      correctionMinutes: 0,
    },
    vision: [{ room: 'living-room', summary: '客厅朝南且采光充足。' }],
    citations: [{ title: '资料标题', sourceLabel: '专家库', version: 1, versionId: 'source:v1:0123456789abcdef', contentHash: 'sha256:0123456789abcdef' }],
    evaluatedRules: [{ title: '规则标题', priority: 80, version: 1, versionId: 'rule:v1:fedcba9876543210', contentHash: 'sha256:fedcba9876543210', conclusions: [{ text: '保持通道整洁。' }] }],
    generationProvenance: { validatorVersion: CURRENT_REPORT_VALIDATOR_VERSION },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
  document.body.replaceChildren()
})

describe('shared report route', () => {
  it('reads the access token only from the fragment and sends it as the share-token header', async () => {
    const setItem = vi.spyOn(window.localStorage.__proto__, 'setItem')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      expect(url).toBe('/api/v1/shared-reports/report%2F001')
      expect(url).not.toContain('frag-token')
      expect(init?.headers).toEqual({ 'x-report-share-token': 'frag-token' })
      return Response.json(sharedReportFixture())
    })

    const { root, container } = await renderSharedPath('/shared-report/report%2F001?access=query-token#access=frag-token')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('共享住宅报告')
    expect(container.textContent).toContain('分享页可见的正式报告')
    expect(container.textContent).toContain('查看本报告使用的资料与规则')
    expect(container.textContent).toContain('报告依据摘要')
    expect(container.textContent).toContain('只读分享')
    const metaLabels = Array.from(container.querySelectorAll('.report-detail-facts dt')).map((node) => node.textContent)
    expect(metaLabels.filter((label) => label === '命盘')).toHaveLength(1)
    expect(container.querySelector('.top-navigation')).toBeNull()
    expect(container.textContent).not.toContain('我的报告')
    expect(container.textContent).not.toContain('下载 PDF')
    expect(setItem.mock.calls.flat().join(' ')).not.toContain('frag-token')
    const reportBody = container.querySelector('.report-copy')
    const evidence = container.querySelector<HTMLDetailsElement>('.evidence-summary')
    expect(evidence?.open).toBe(false)
    expect((reportBody?.compareDocumentPosition(evidence as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    cleanup(root, container)
  })

  it('does not call private report history APIs from the shared route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      expect(url).toBe('/api/v1/shared-reports/report-abc')
      expect(url).not.toBe('/api/v1/reports')
      expect(url).not.toBe('/api/v1/charts/current')
      return Response.json({ ...sharedReportFixture(), id: 'report-abc' })
    })

    const { root, container } = await renderSharedPath('/shared-report/report-abc#access=frag-token')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('分享页可见的正式报告')
    cleanup(root, container)
  })

  it('fails closed without a fragment access token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    const { root, container } = await renderSharedPath('/shared-report/report-abc?access=query-token')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.textContent).toContain('无法查看这份报告')
    expect(container.textContent).toContain('分享链接无效或已过期')
    cleanup(root, container)
  })

  it('hides completed shared reports produced by an old validator version', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      ...sharedReportFixture(),
      generationProvenance: { validatorVersion: 'old-validator' },
    }))

    const { root, container } = await renderSharedPath('/shared-report/report-abc#access=frag-token')

    expect(container.textContent).toContain('无法查看这份报告')
    expect(container.textContent).toContain('重新生成当前版本报告')
    expect(container.textContent).not.toContain('分享页可见的正式报告')
    cleanup(root, container)
  })
})
