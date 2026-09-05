/* @vitest-environment happy-dom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { App } from './main'

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

function mockRouteFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/api/ready/report')) {
      return Response.json({
        status: 'ready',
        service: 'fengshui-api',
        checks: { deepseekApiKey: true, knowledgeMcpToken: true, publishedExpertKnowledge: true, publishedRules: true, harnessArtifacts: true },
        reasons: [],
      })
    }
    if (url.includes('/api/v1/charts/current')) return Response.json({ profile: null })
    if (url.includes('/api/v1/reports')) return Response.json({ reports: [] })
    if (url.includes('/api/v1/bazi-rule-profile-versions/active')) return Response.json({ versions: [] })
    if (url.includes('/api/v1/calendar/lunar-years/')) {
      return Response.json({
        year: 1992,
        leapMonth: null,
        ruleVersion: 'test-lunar-rule',
        months: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, leap: false, days: index % 2 ? 29 : 30 })),
      })
    }
    return Response.json({})
  })
}

async function renderPath(path: string) {
  window.history.replaceState({}, '', path)
  mockRouteFetch()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(App)))
  await flushEffects()
  return { root, container }
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
  document.body.replaceChildren()
})

describe('app route rendering smoke', () => {
  it.each([
    ['/', ['住宅分析', '我的命盘', '我的报告', '选择已保存的个人命盘', '先建立命盘']],
    ['/chart', ['住宅分析', '我的命盘', '我的报告', '出生资料', '合盘', '生辰', '流盘', '专业详情', '参数', '设置']],
    ['/reports', ['住宅分析', '我的命盘', '我的报告', 'REPORT HISTORY', '还没有住宅报告', '去住宅分析']],
  ])('renders real React content for %s instead of a blank shell', async (path, expectedText) => {
    const { root, container } = await renderPath(path)

    for (const text of expectedText) {
      expect(container.textContent).toContain(text)
    }
    expect(container.querySelector('.top-navigation')).not.toBeNull()
    expect(container.textContent?.trim().length).toBeGreaterThan(100)
    cleanup(root, container)
  })

  it('navigates between the three product pages from the top bar without leaving a blank shell', async () => {
    const { root, container } = await renderPath('/')
    expect(container.querySelector('.top-navigation')).not.toBeNull()

    const clickNav = async (label: string) => {
      const nav = container.querySelector('.top-navigation')
      expect(nav).not.toBeNull()
      const link = Array.from(nav!.querySelectorAll('a')).find((item) => item.textContent === label)
      expect(link).toBeDefined()
      await act(async () => {
        link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
      })
      await flushEffects()
    }

    await clickNav('我的命盘')
    expect(window.location.pathname).toBe('/chart')
    expect(container.querySelector('.top-navigation .nav-link[href="/chart"]')?.getAttribute('data-current')).toBe('true')
    expect(container.textContent).toContain('生辰')
    expect(container.textContent).toContain('专业详情')

    await clickNav('我的报告')
    expect(window.location.pathname).toBe('/reports')
    expect(container.querySelector('.top-navigation .nav-link[href="/reports"]')?.getAttribute('data-current')).toBe('true')
    expect(container.textContent).toContain('REPORT HISTORY')
    expect(container.textContent).toContain('还没有住宅报告')

    await clickNav('住宅分析')
    expect(window.location.pathname).toBe('/')
    expect(container.querySelector('.top-navigation .nav-link[href="/"]')?.getAttribute('data-current')).toBe('true')
    expect(container.textContent).toContain('选择已保存的个人命盘')
    cleanup(root, container)
  })

  it('keeps the analysis landing page focused on user inputs instead of always-visible engineering status', async () => {
    const { root, container } = await renderPath('/')

    expect(container.querySelector('.report-flow-overview')).toBeNull()
    expect(container.querySelector('.report-lookup-details')).toBeNull()
    expect(container.textContent).not.toContain('找回已有报告')
    expect(container.textContent).not.toContain('任务编号')
    const readiness = container.querySelector('.report-readiness') as HTMLDetailsElement | null
    expect(readiness).not.toBeNull()
    expect(readiness?.open).toBe(false)
    expect(container.textContent).toContain('生成分析报告')
    cleanup(root, container)
  })

  it('does not expose planned feature promises on the investor chart page', async () => {
    const { root, container } = await renderPath('/chart')

    expect(container.textContent).not.toContain('规划中')
    expect(container.textContent).not.toContain('将支持')
    expect(container.textContent).toContain('合盘')
    expect(container.textContent).toContain('生辰')
    expect(container.textContent).toContain('流盘')
    expect(container.textContent).toContain('专业详情')
    expect(container.textContent).toContain('参数')
    expect(container.textContent).toContain('设置')
    expect(container.textContent).not.toContain('档案版本')
    cleanup(root, container)
  })
})
