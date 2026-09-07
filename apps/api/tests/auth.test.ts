import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../src/app.js'
import { FileAccountStore } from '../src/auth.js'
import { ReportRepository } from '../src/repository.js'
import { MediaStore } from '../src/media.js'
import { KnowledgeRepository } from '../src/knowledge.js'
import { ChartRepository } from '../src/charts.js'
import { BaziRuleProfileRepository } from '../src/rule-profiles.js'
import { ResidenceRepository } from '../src/residences.js'

const previousAdminToken = process.env.ADMIN_API_TOKEN
afterEach(() => {
  if (previousAdminToken === undefined) delete process.env.ADMIN_API_TOKEN; else process.env.ADMIN_API_TOKEN = previousAdminToken
})

async function authApp(requireUserAuth = false) {
  const directory = await mkdtemp(join(tmpdir(), 'fengshui-auth-'))
  process.env.ADMIN_API_TOKEN = 'test-admin-token'
  return buildApp(
    new ReportRepository(join(directory, 'reports.json')),
    new MediaStore(join(directory, 'uploads')),
    new KnowledgeRepository(join(directory, 'knowledge.json')),
    async () => 'test',
    { analyze: async () => [] },
    new ChartRepository(join(directory, 'charts.json')),
    new BaziRuleProfileRepository(join(directory, 'rules.json')),
    join(directory, 'fixtures.json'),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    new ResidenceRepository(join(directory, 'residences.json')),
    new FileAccountStore(join(directory, 'accounts.json')),
    { requireUserAuthentication: requireUserAuth },
  )
}

const persistableBirth = () => ({ date: '1992-08-18', time: '09:30', placeCode: '330106' })
const reportPayload = () => ({
  visionConsent: true,
  birth: persistableBirth(),
  residence: { facing: 'south' as const, layoutNote: '客厅连接阳台' },
  photos: [{ fileId: `${randomUUID()}.png`, room: 'living-room' as const, facing: 'south' as const }],
})
const pngUploadPayload = (boundary: string) => Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="room.png"\r\nContent-Type: image/png\r\n\r\n`),
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  Buffer.from(`\r\n--${boundary}--\r\n`),
])

describe('admin-issued user accounts', () => {
  it('has no public registration endpoint and supports create, login, session and logout', async () => {
    const app = await authApp()
    const registration = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: {} })
    expect(registration.statusCode).toBe(404)
    const created = await app.inject({ method: 'POST', url: '/v1/admin/users', headers: { authorization: 'Bearer test-admin-token' }, payload: { username: 'alice', displayName: 'Alice', password: 'long-password' } })
    expect(created.statusCode).toBe(201)
    expect(created.json().user).not.toHaveProperty('passwordHash')
    expect((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'alice', password: 'wrong-password' } })).statusCode).toBe(401)
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'ALICE', password: 'long-password' } })
    expect(login.statusCode).toBe(200)
    const cookie = login.headers['set-cookie']!
    expect((await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie } })).json()).toMatchObject({ authenticated: true, user: { username: 'alice' } })
    const listed = await app.inject({ method: 'GET', url: '/v1/admin/users', headers: { authorization: 'Bearer test-admin-token' } })
    expect(listed.json().users[0]).toMatchObject({ username: 'alice', lastLoginAt: expect.any(String) })
    expect(listed.json().users[0]).not.toHaveProperty('passwordHash')
    expect((await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { cookie } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie } })).statusCode).toBe(401)
    await app.close()
  })

  it('revokes sessions when admin disables an account', async () => {
    const app = await authApp()
    const created = await app.inject({ method: 'POST', url: '/v1/admin/users', headers: { authorization: 'Bearer test-admin-token' }, payload: { username: 'bob', displayName: 'Bob', password: 'long-password' } })
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'bob', password: 'long-password' } })
    const disabled = await app.inject({ method: 'PATCH', url: `/v1/admin/users/${created.json().user.id}/status`, headers: { authorization: 'Bearer test-admin-token' }, payload: { status: 'disabled' } })
    expect(disabled.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie: login.headers['set-cookie']! } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'bob', password: 'long-password' } })).statusCode).toBe(401)
    await app.close()
  })

  it('revokes existing sessions and accepts only the new password after an admin reset', async () => {
    const app = await authApp()
    const created = await app.inject({ method: 'POST', url: '/v1/admin/users', headers: { authorization: 'Bearer test-admin-token' }, payload: { username: 'carol', displayName: 'Carol', password: 'old-password' } })
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'carol', password: 'old-password' } })
    const cookie = login.headers['set-cookie']!

    const reset = await app.inject({ method: 'POST', url: `/v1/admin/users/${created.json().user.id}/reset-password`, headers: { authorization: 'Bearer test-admin-token' }, payload: { password: 'new-password' } })

    expect(reset.statusCode).toBe(200)
    expect(reset.json().user).toMatchObject({ username: 'carol', status: 'active' })
    expect(reset.json().user).not.toHaveProperty('passwordHash')
    expect((await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'carol', password: 'old-password' } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'carol', password: 'new-password' } })).statusCode).toBe(200)
    await app.close()
  })
})

describe('private account authorization', () => {
  it('rejects chart creation when no user session is present', async () => {
    const app = await authApp(true)
    const response = await app.inject({ method: 'POST', url: '/v1/charts', payload: persistableBirth() })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('rejects residence creation when no user session is present', async () => {
    const app = await authApp(true)
    const response = await app.inject({ method: 'POST', url: '/v1/residences', payload: { label: '自住房', facing: 'south' } })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('rejects media upload when no user session is present', async () => {
    const app = await authApp(true)
    const boundary = 'fengshui-auth-boundary'
    const response = await app.inject({
      method: 'POST',
      url: '/v1/media',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-vision-consent': 'accepted' },
      payload: pngUploadPayload(boundary),
    })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('rejects report creation when no user session is present', async () => {
    const app = await authApp(true)
    const response = await app.inject({ method: 'POST', url: '/v1/reports', payload: reportPayload() })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('rejects private chart list reads when no user session is present', async () => {
    const app = await authApp(true)
    const response = await app.inject({ method: 'GET', url: '/v1/charts' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('rejects private residence list reads when no user session is present', async () => {
    const app = await authApp(true)
    const response = await app.inject({ method: 'GET', url: '/v1/residences' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('rejects private report list reads when no user session is present', async () => {
    const app = await authApp(true)
    const response = await app.inject({ method: 'GET', url: '/v1/reports' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('rejects private chart detail reads when no user session is present', async () => {
    const app = await authApp(true)
    const response = await app.inject({ method: 'GET', url: `/v1/charts/${randomUUID()}/versions` })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('rejects private residence detail reads when no user session is present', async () => {
    const app = await authApp(true)
    const response = await app.inject({ method: 'GET', url: `/v1/residences/${randomUUID()}/versions` })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('rejects private report detail reads when no user session is present', async () => {
    const app = await authApp(true)
    const response = await app.inject({ method: 'GET', url: `/v1/reports/${randomUUID()}` })
    expect(response.statusCode).toBe(401)
    await app.close()
  })
})
