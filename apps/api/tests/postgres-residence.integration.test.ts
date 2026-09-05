import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import type { ResidenceSnapshot } from '@fengshui/domain'
import { ResidenceRevisionConflictError, ResidenceVersionRestoreConflictError } from '../src/residences.js'
import { PostgresChartRepository, PostgresResidenceRepository, runMigrations } from '../src/storage/postgres.js'

const connectionString = process.env.TEST_DATABASE_URL
const describeWithDatabase = connectionString ? describe : describe.skip
const ownedSchemas: string[] = []

const southHome: ResidenceSnapshot = {
  schemaVersion: 'residence-snapshot-v1',
  label: '南向住宅',
  facing: 'south',
  layoutNote: '客厅连接阳台',
}

const northHome: ResidenceSnapshot = {
  schemaVersion: 'residence-snapshot-v1',
  label: '北向住宅',
  facing: 'north',
  layoutNote: '书房靠北',
}

function schemaName(): string {
  return `residence_it_${randomUUID().replaceAll('-', '_')}`
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function isolatedPool(schema: string): Pool {
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required')
  return new Pool({
    connectionString,
    options: `-c search_path=${schema}`,
  })
}

async function createMigratedPool(): Promise<Pool> {
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required')
  const schema = schemaName()
  ownedSchemas.push(schema)
  const admin = new Pool({ connectionString })
  await admin.query(`create schema ${quoteIdentifier(schema)}`)
  await admin.end()

  const pool = isolatedPool(schema)
  await runMigrations(pool, fileURLToPath(new URL('../migrations/', import.meta.url)))
  return pool
}

async function createRepository(): Promise<{ pool: Pool; repository: PostgresResidenceRepository; principalId: string }> {
  const pool = await createMigratedPool()
  const principal = await new PostgresChartRepository(pool).createPrincipal(`residence-${randomUUID()}`)
  return { pool, repository: new PostgresResidenceRepository(pool), principalId: principal.id }
}

afterEach(async () => {
  if (!connectionString) return
  while (ownedSchemas.length) {
    const schema = ownedSchemas.pop()
    if (!schema?.startsWith('residence_it_')) continue
    const admin = new Pool({ connectionString })
    try {
      await admin.query(`drop schema if exists ${quoteIdentifier(schema)} cascade`)
    } finally {
      await admin.end()
    }
  }
})

describeWithDatabase('PostgresResidenceRepository integration', () => {
  it('stores multiple active residences and isolates ownership', async () => {
    const { pool, repository, principalId } = await createRepository()
    try {
      const other = await new PostgresChartRepository(pool).createPrincipal(`residence-other-${randomUUID()}`)
      const first = await repository.createProfile(principalId, southHome)
      const second = await repository.createProfile(principalId, northHome)
      await repository.createProfile(other.id, { ...southHome, label: '他人住宅' })

      expect(await repository.listProfiles(principalId)).toMatchObject([
        { id: second.id, principalId, currentVersion: { snapshot: northHome } },
        { id: first.id, principalId, currentVersion: { snapshot: southHome } },
      ])
      await expect(repository.getProfile(first.id, other.id)).resolves.toBeUndefined()
      await expect(repository.listProfiles(other.id)).resolves.toHaveLength(1)
    } finally {
      await repository.close()
    }
  })

  it('enforces expectedRevision and restores old versions by appending', async () => {
    const { repository, principalId } = await createRepository()
    try {
      const created = await repository.createProfile(principalId, southHome)
      const originalVersionId = created.currentVersion.id
      await repository.appendVersion(created.id, principalId, 1, northHome)

      await expect(repository.appendVersion(created.id, principalId, 1, { ...southHome, label: '陈旧写入' }))
        .rejects.toBeInstanceOf(ResidenceRevisionConflictError)

      const restored = await repository.restoreVersion(created.id, principalId, originalVersionId, 2)
      expect(restored).toMatchObject({
        revision: 3,
        currentVersion: {
          version: 3,
          restoredFromVersionId: originalVersionId,
          snapshot: southHome,
        },
      })
      expect((await repository.listVersions(created.id, principalId))?.map((version) => version.version)).toEqual([3, 2, 1])
    } finally {
      await repository.close()
    }
  })

  it('soft deletes profiles while keeping immutable versions readable to the owner', async () => {
    const { repository, principalId } = await createRepository()
    try {
      const created = await repository.createProfile(principalId, southHome)
      await expect(repository.softDeleteProfile(created.id, randomUUID())).resolves.toBe(false)
      await expect(repository.softDeleteProfile(created.id, principalId)).resolves.toBe(true)
      await expect(repository.getProfile(created.id, principalId)).resolves.toBeUndefined()
      await expect(repository.listVersions(created.id, principalId)).resolves.toHaveLength(1)
      await expect(repository.restoreVersion(created.id, principalId, created.currentVersion.id, 1))
        .rejects.toBeInstanceOf(ResidenceVersionRestoreConflictError)
      await expect(repository.restoreProfile(created.id, principalId)).resolves.toMatchObject({ id: created.id })
    } finally {
      await repository.close()
    }
  })
})
