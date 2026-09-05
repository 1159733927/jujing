// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from 'antd'
import UserAccountsPage, { userStatusLabel } from './UserAccountsPage'
import * as accountApi from '../api'

vi.mock('../api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api')>()
  return {
    ...original,
    listUserAccounts: vi.fn(),
    createUserAccount: vi.fn(),
    setUserAccountStatus: vi.fn(),
    resetUserAccountPassword: vi.fn(),
    getUserAccountOverview: vi.fn(),
  }
})

describe('UserAccountsPage', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
    vi.clearAllMocks()
  })

  it('renders issued accounts and never renders credential fields', async () => {
    vi.mocked(accountApi.listUserAccounts).mockResolvedValue([
      {
        id: 'user-1',
        username: 'customer01',
        displayName: '张先生',
        status: 'active',
        createdAt: '2026-09-04T08:00:00.000Z',
        updatedAt: '2026-09-04T08:00:00.000Z',
      },
    ])

    const root = createRoot(container)
    await act(async () => {
      root.render(<App><UserAccountsPage /></App>)
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.textContent).toContain('用户账号')
    expect(container.textContent).toContain('customer01')
    expect(container.textContent).toContain('张先生')
    expect(container.textContent).toContain('正常')
    expect(container.textContent).toContain('尚未登录')
    expect(container.textContent).toContain('查看详情')
    expect(container.textContent).not.toContain('passwordHash')

    await act(async () => root.unmount())
  })

  it('opens a safe user overview drawer with members and report counts', async () => {
    vi.mocked(accountApi.listUserAccounts).mockResolvedValue([
      {
        id: 'user-1',
        username: 'customer01',
        displayName: '张先生',
        status: 'active',
        createdAt: '2026-09-04T08:00:00.000Z',
        updatedAt: '2026-09-04T08:00:00.000Z',
      },
    ])
    vi.mocked(accountApi.getUserAccountOverview).mockResolvedValue({
      user: {
        id: 'user-1',
        username: 'customer01',
        displayName: '张先生',
        status: 'active',
        createdAt: '2026-09-04T08:00:00.000Z',
        updatedAt: '2026-09-04T08:00:00.000Z',
        hasBoundWorkspace: true,
      },
      charts: [{
        id: 'chart-1',
        label: '本人',
        relationship: 'self',
        revision: 1,
        createdAt: '2026-09-04T08:00:00.000Z',
        updatedAt: '2026-09-04T08:00:00.000Z',
        currentVersion: {
          id: 'version-1',
          version: 1,
          createdAt: '2026-09-04T08:00:00.000Z',
          pillars: ['壬申', '戊申', '丙寅', '癸巳'],
          birth: { date: '1992-08-18', time: '09:30', locationName: '杭州市' },
        },
      }],
      residences: [{
        id: 'residence-1',
        label: '滨江南向住宅',
        facing: 'south',
        revision: 1,
        createdAt: '2026-09-04T08:00:00.000Z',
        updatedAt: '2026-09-04T08:00:00.000Z',
        currentVersion: { id: 'residence-version-1', version: 1, createdAt: '2026-09-04T08:00:00.000Z' },
      }],
      reports: {
        active: [{ id: 'report-1', status: 'completed', createdAt: '2026-09-04T09:00:00.000Z', chartProfileId: 'chart-1', residenceProfileId: 'residence-1', residenceFacing: 'south', photoCount: 2, hasReport: true, reportPreview: '整体局部合拍。' }],
        archived: [],
        countsByChartProfileId: { 'chart-1': { active: 1, archived: 0 } },
        countsByResidenceProfileId: { 'residence-1': { active: 1, archived: 0 } },
      },
    })

    const root = createRoot(container)
    await act(async () => {
      root.render(<App><UserAccountsPage /></App>)
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const detailButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('查看详情'))
    expect(detailButton).toBeDefined()
    await act(async () => {
      detailButton!.click()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(accountApi.getUserAccountOverview).toHaveBeenCalledWith('user-1')
    expect(document.body.textContent).toContain('用户详情 · 张先生')
    expect(document.body.textContent).toContain('成员命盘')
    expect(document.body.textContent).toContain('住宅档案')
    expect(document.body.textContent).toContain('滨江南向住宅')
    expect(document.body.textContent).toContain('四柱：壬申 / 戊申 / 丙寅 / 癸巳')
    expect(document.body.textContent).toContain('报告：1 份，回收站：0 份')
    expect(document.body.textContent).toContain('住宅：滨江南向住宅')
    expect(document.body.textContent).toContain('整体局部合拍')
    expect(document.body.textContent).not.toContain('passwordHash')

    await act(async () => root.unmount())
  })

  it('uses clear labels for both account states', () => {
    expect(userStatusLabel('active')).toBe('正常')
    expect(userStatusLabel('disabled')).toBe('已停用')
  })
})
