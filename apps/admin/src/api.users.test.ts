// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createUserAccount,
  getUserAccountOverview,
  listUserAccounts,
  resetUserAccountPassword,
  setUserAccountStatus,
} from './api'

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

afterEach(() => vi.restoreAllMocks())

describe('user account API', () => {
  it('lists and creates accounts through the admin endpoints', async () => {
    const fetchMock = vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ id: 'u1' }))

    await listUserAccounts()
    await createUserAccount({ username: 'customer', displayName: '客户', password: 'initial-pass' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/users')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/admin/users')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' })
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ username: 'customer', displayName: '客户', password: 'initial-pass' }))
  })

  it('encodes account ids for status and password mutations', async () => {
    const fetchMock = vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(response({ id: 'u/1', status: 'disabled' }))
      .mockResolvedValueOnce(response({ ok: true }))

    await setUserAccountStatus('u/1', 'disabled')
    await resetUserAccountPassword('u/1', 'replacement-pass')

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/users/u%2F1/status')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ status: 'disabled' }) })
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/admin/users/u%2F1/reset-password')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ password: 'replacement-pass' }) })
  })

  it('fetches account workspace overview through an encoded admin endpoint', async () => {
    const fetchMock = vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(response({
        user: { id: 'u/1', username: 'customer', displayName: '客户', status: 'active', hasBoundWorkspace: true, createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z' },
        charts: [],
        residences: [],
        reports: { active: [], archived: [], countsByChartProfileId: {}, countsByResidenceProfileId: {} },
      }))

    await getUserAccountOverview('u/1')

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/users/u%2F1/overview')
  })
})
