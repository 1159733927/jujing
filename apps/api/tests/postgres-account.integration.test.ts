import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { PostgresAccountRepository, PostgresChartRepository, runMigrations } from '../src/storage/postgres.js'

const connectionString = process.env.TEST_DATABASE_URL
const describeWithDatabase = connectionString ? describe : describe.skip
const ownedSchemas: string[] = []

function quoteIdentifier(value: string) { return `"${value.replaceAll('"', '""')}"` }

async function createStores() {
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required')
  const schema = `account_it_${randomUUID().replaceAll('-', '_')}`
  ownedSchemas.push(schema)
  const admin = new Pool({ connectionString })
  await admin.query(`create schema ${quoteIdentifier(schema)}`)
  await admin.end()
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` })
  await runMigrations(pool, fileURLToPath(new URL('../migrations/', import.meta.url)))
  return { accounts: new PostgresAccountRepository(pool), charts: new PostgresChartRepository(pool) }
}

afterEach(async () => {
  if (!connectionString) return
  while (ownedSchemas.length) {
    const schema = ownedSchemas.pop()!
    const admin = new Pool({ connectionString })
    try { await admin.query(`drop schema if exists ${quoteIdentifier(schema)} cascade`) }
    finally { await admin.end() }
  }
})

describeWithDatabase('PostgresAccountRepository integration', () => {
  it('persists a public account and binds its principal only once', async () => {
    const { accounts, charts } = await createStores()
    try {
      const user = await accounts.createUser({ username: ' Demo.User ', displayName: 'Demo User', passwordHash: 'hash-one' })
      const first = await charts.createPrincipal(`first-${randomUUID()}`)
      const second = await charts.createPrincipal(`second-${randomUUID()}`)
      expect(user).not.toHaveProperty('passwordHash')
      expect((await accounts.findUserByUsername('demo.user'))?.passwordHash).toBe('hash-one')
      expect((await accounts.bindPrincipal(user.id, first.id))?.principalId).toBe(first.id)
      expect((await accounts.bindPrincipal(user.id, second.id))?.principalId).toBe(first.id)
      await expect(accounts.createUser({ username: 'DEMO.USER', displayName: 'Duplicate', passwordHash: 'hash-two' })).rejects.toMatchObject({ code: '23505' })
    } finally { await accounts.close() }
  })

  it('revokes sessions when an account is disabled or its password is reset', async () => {
    const { accounts } = await createStores()
    try {
      const user = await accounts.createUser({ username: `user-${randomUUID()}`, displayName: 'Session User', passwordHash: 'old-hash' })
      const session = (tokenHash: string) => ({ id: randomUUID(), userId: user.id, tokenHash, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() })
      await accounts.createSession(session('token-one'))
      expect(await accounts.findSessionByTokenHash('token-one')).toBeDefined()
      await accounts.setUserStatus(user.id, 'disabled')
      expect(await accounts.findSessionByTokenHash('token-one')).toBeUndefined()
      await accounts.setUserStatus(user.id, 'active')
      await accounts.createSession(session('token-two'))
      await accounts.setPassword(user.id, 'new-hash')
      expect(await accounts.findSessionByTokenHash('token-two')).toBeUndefined()
      expect((await accounts.findUserByUsername(user.username))?.passwordHash).toBe('new-hash')
    } finally { await accounts.close() }
  })
})
