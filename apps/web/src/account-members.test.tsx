/* @vitest-environment happy-dom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { App, CURRENT_REPORT_VALIDATOR_VERSION } from './main'

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function profile(id: string, label: string, relationship: 'self' | 'partner') {
  const birth = { date: '1992-08-18', time: '09:30', locationName: '杭州市', longitude: 120.13 }
  return {
    id, label, relationship, revision: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    currentVersion: { id: `${id}-v1`, profileId: id, version: 1, calculationInput: birth, birth, bazi: { pillars: ['壬申', '戊申', '丙寅', '癸巳'], correctedLocalTime: '1992-08-18T09:20:00', correctionMinutes: -10 }, createdAt: '2026-09-01T00:00:00.000Z' },
  }
}

function residenceProfile(id: string, label: string, facing: 'north' | 'south') {
  return {
    id,
    principalId: 'principal-one',
    revision: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    currentVersion: {
      id: `${id}-v1`,
      profileId: id,
      version: 1,
      snapshot: {
        schemaVersion: 'residence-snapshot-v1',
        label,
        facing,
        layoutNote: `${label} 格局说明`,
      },
      createdAt: '2026-09-01T00:00:00.000Z',
    },
  }
}

function mount(): { root: Root; container: HTMLElement } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(App)))
  return { root, container }
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
  document.body.replaceChildren()
})

describe('consumer account and member navigation', () => {
  it('shows login on 401 and sends credentials through the same-origin session flow', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/session')) return Response.json({ error: 'authentication required' }, { status: 401 })
      if (url.endsWith('/api/v1/auth/login')) return Response.json({ authenticated: true, user: { id: 'user-1', username: 'demo', displayName: '演示用户', status: 'active' } })
      if (url.endsWith('/api/v1/charts')) return Response.json({ profiles: [] })
      return Response.json({})
    })
    const { root, container } = mount()
    await flush()
    expect(container.textContent).toContain('登录你的居境档案')
    const inputs = container.querySelectorAll('input')
    await act(async () => {
      ;(inputs[0] as HTMLInputElement).value = 'demo'
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      ;(inputs[1] as HTMLInputElement).value = 'secret'
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()
    const loginCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/api/v1/auth/login'))
    expect(loginCall?.[1]).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    expect(container.textContent).toContain('演示用户')
    act(() => root.unmount())
  })

  it('switches chart people and scopes report history to the selected chart', async () => {
    window.history.replaceState({}, '', '/reports')
    const reportUrls: string[] = []
    const residences = [
      residenceProfile('residence-south', '滨江南向住宅', 'south'),
      residenceProfile('residence-north', '城北书房住宅', 'north'),
    ]
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/session')) return Response.json({ authenticated: true, user: { id: 'user-1', username: 'demo', displayName: '演示用户', status: 'active' } })
      if (url.endsWith('/api/v1/charts')) return Response.json({ profiles: [profile('self-1', '我', 'self'), profile('partner-1', '妻子', 'partner')] })
      if (url.endsWith('/api/v1/residences')) return Response.json({ profiles: residences })
      if (url.includes('/api/v1/reports')) { reportUrls.push(url); return Response.json({ reports: [] }) }
      if (url.includes('/api/v1/bazi-rule-profile-versions/active')) return Response.json({ versions: [] })
      return Response.json({})
    })
    const { root, container } = mount()
    await flush()
    const selector = container.querySelector('select[aria-label="当前成员"]') as HTMLSelectElement
    expect(selector).not.toBeNull()
    expect(selector.value).toBe('self-1')
    expect(reportUrls.some((url) => url.includes('chartProfileId=self-1'))).toBe(true)
    await act(async () => {
      selector.value = 'partner-1'
      selector.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(reportUrls.some((url) => url.includes('chartProfileId=partner-1'))).toBe(true)
    const residenceSelector = container.querySelector('select[aria-label="报告住宅筛选"]') as HTMLSelectElement
    expect(residenceSelector).not.toBeNull()
    expect(container.textContent).toContain('全部住宅')
    await act(async () => {
      residenceSelector.value = 'residence-north'
      residenceSelector.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(reportUrls.some((url) => url.includes('chartProfileId=partner-1') && url.includes('residenceProfileId=residence-north'))).toBe(true)
    const allButton = Array.from(container.querySelectorAll('.report-scope-tabs button')).find((button) => button.textContent === '全部成员')!
    await act(async () => allButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await flush()
    expect(reportUrls.at(-1)).toBe('/api/v1/reports?residenceProfileId=residence-north')
    act(() => root.unmount())
  })

  it('archives and restores a selected report from the consumer report history page', async () => {
    window.history.replaceState({}, '', '/reports')
    let archived = false
    const calls: string[] = []
    const reportSummary = () => ({
      id: 'report-1',
      status: 'completed',
      createdAt: '2026-09-04T09:00:00.000Z',
      chartProfileId: 'self-1',
      chartVersionId: 'self-1-v1',
      residenceFacing: 'south',
      photoCount: 1,
      hasReport: true,
      ...(archived ? { archivedAt: '2026-09-04T10:00:00.000Z' } : {}),
      reportPreview: '整体合拍，客厅南向是加分项。',
    })
    const reportDetail = () => ({
      ...reportSummary(),
      bazi: { pillars: ['壬申', '戊申', '丙寅', '癸巳'], correctedLocalTime: '1992-08-18T09:20:00', correctionMinutes: -10 },
      generationProvenance: { validatorVersion: CURRENT_REPORT_VALIDATOR_VERSION },
      report: '## 结论\n\n这套房整体合拍。客厅南向能放大命盘里需要的火气，卫生间靠中宫需要保持干燥。',
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/api/v1/auth/session')) return Response.json({ authenticated: true, user: { id: 'user-1', username: 'demo', displayName: '演示用户', status: 'active' } })
      if (url.endsWith('/api/v1/charts')) return Response.json({ profiles: [profile('self-1', '我', 'self'), profile('partner-1', '妻子', 'partner')] })
      if (url.endsWith('/api/v1/reports/report-1') && init?.method === 'DELETE') {
        archived = true
        return new Response(null, { status: 204 })
      }
      if (url.endsWith('/api/v1/reports/report-1/restore') && init?.method === 'POST') {
        archived = false
        return Response.json(reportDetail())
      }
      if (url.endsWith('/api/v1/reports/report-1')) return Response.json(reportDetail())
      if (url.includes('/api/v1/reports')) {
        const wantsArchived = url.includes('archived=true')
        return Response.json({ reports: wantsArchived === archived ? [reportSummary()] : [] })
      }
      if (url.includes('/api/v1/bazi-rule-profile-versions/active')) return Response.json({ versions: [] })
      return Response.json({})
    })
    const { root, container } = mount()
    await flush()
    expect(container.textContent).toContain('我的报告')
    expect(container.textContent).toContain('移入回收站')

    await act(async () => {
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '移入回收站')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(calls).toContain('DELETE /api/v1/reports/report-1')

    await act(async () => {
      Array.from(container.querySelectorAll('.report-scope-tabs button')).find((button) => button.textContent === '回收站')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(container.textContent).toContain('恢复报告')

    await act(async () => {
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '恢复报告')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(calls).toContain('POST /api/v1/reports/report-1/restore')
    expect(container.textContent).toContain('我的报告')
    expect(container.textContent).toContain('我的报告 · 全部住宅 · 1 份')
    act(() => root.unmount())
  })
})
