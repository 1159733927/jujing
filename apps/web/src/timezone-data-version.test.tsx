/* @vitest-environment happy-dom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { TimezoneDataVersion } from './main'

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  document.body.replaceChildren()
})

function renderVersion(
  provenance?: Parameters<typeof TimezoneDataVersion>[0]['provenance'],
  currentProvenance?: Parameters<typeof TimezoneDataVersion>[0]['currentProvenance'],
) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(<TimezoneDataVersion provenance={provenance} currentProvenance={currentProvenance} />))
  return { container, root }
}

describe('timezone data version', () => {
  it('shows the timezone and ICU data versions without exposing the Node version', () => {
    const provenance = {
      provider: 'node-intl',
      nodeVersion: '24.6.0',
      tzdbVersion: '2026a',
      icuVersion: '78.2',
    } as const
    const { container, root } = renderVersion(provenance, provenance)

    expect(container.textContent).toBe('时区数据 2026a · ICU 78.2 · 与当前排盘环境一致')
    expect(container.textContent).not.toContain('24.6.0')
    act(() => root.unmount())
  })

  it('marks charts saved before runtime provenance was recorded', () => {
    const { container, root } = renderVersion()

    expect(container.textContent).toBe('旧版本未记录')
    act(() => root.unmount())
  })

  it('recommends recalculation when the saved timezone runtime differs', () => {
    const { container, root } = renderVersion(
      { provider: 'node-intl', tzdbVersion: '2025b', icuVersion: '77.1' },
      { provider: 'node-intl', tzdbVersion: '2026a', icuVersion: '78.2' },
    )

    expect(container.textContent).toContain('与当前排盘环境不同，建议重新排盘生成新版本')
    act(() => root.unmount())
  })

  it('keeps the saved version visible when the current runtime cannot be checked', () => {
    const { container, root } = renderVersion(
      { provider: 'node-intl', tzdbVersion: '2026a', icuVersion: '78.2' },
      null,
    )

    expect(container.textContent).toBe('时区数据 2026a · ICU 78.2 · 当前环境版本暂不可核对')
    act(() => root.unmount())
  })

  it('does not call an incomplete legacy provenance compatible', () => {
    const { container, root } = renderVersion(
      { provider: 'node-intl' },
      { provider: 'node-intl', tzdbVersion: '2026a', icuVersion: '78.2' },
    )

    expect(container.textContent).toBe('版本未记录 · 当前环境版本暂不可核对')
    act(() => root.unmount())
  })
})
