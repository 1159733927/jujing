import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { calculateBaziFromPillars } from '@fengshui/bazi-engine'
import type { BaziChart, BirthInput, ManualFourPillarsInput } from '@fengshui/domain'
import { ChartProfileLimitExceededError, ChartRevisionConflictError } from '../src/charts.js'
import { PostgresChartRepository, runMigrations } from '../src/storage/postgres.js'

const connectionString = process.env.TEST_DATABASE_URL
const describeWithDatabase = connectionString ? describe : describe.skip
const ownedSchemas: string[] = []

function schemaName(): string {
  return `chart_it_${randomUUID().replaceAll('-', '_')}`
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

function birthInput(time = '09:30'): BirthInput {
  return {
    calendarSystem: 'solar',
    date: '1992-08-18',
    time,
    locationName: '浙江省 杭州市 西湖区',
    province: '浙江省',
    city: '杭州市',
    district: '西湖区',
    placeCode: '330106',
    geoDataVersion: 'test-fixture-v1',
    longitude: 120.1551,
    latitude: 30.2741,
    timezone: 'Asia/Shanghai',
    useTrueSolarTime: true,
    dstPolicy: 'auto',
    dayBoundary: 'midnight',
    luckMethod: 'sect1',
    gender: 'male',
  }
}

function baziFor(input: BirthInput): BaziChart {
  return {
    ruleVersion: 'bazi-v1-beijing-true-solar',
    correctedLocalTime: `1992-08-18T${input.time}:00.000+08:00`,
    correctionMinutes: 0,
    pillars: ['壬申', '戊申', '丙寅', input.time === '10:30' ? '癸巳' : '甲午'],
  }
}

const selfMetadata = { label: '我的命盘', relationship: 'self' as const }

async function createRepository(): Promise<PostgresChartRepository> {
  return new PostgresChartRepository(await createMigratedPool())
}

afterEach(async () => {
  if (!connectionString) return
  while (ownedSchemas.length) {
    const schema = ownedSchemas.pop()
    if (!schema?.startsWith('chart_it_')) continue
    const admin = new Pool({ connectionString })
    try {
      await admin.query(`drop schema if exists ${quoteIdentifier(schema)} cascade`)
    } finally {
      await admin.end()
    }
  }
})

describeWithDatabase('PostgresChartRepository integration', () => {
  it('creates a profile and appends a new current version', async () => {
    const repository = await createRepository()
    try {
      const principal = await repository.createPrincipal(`chart-create-append-${randomUUID()}`)
      const initialInput = birthInput('09:30')
      const appendedInput = birthInput('10:30')

      const created = await repository.createProfile(principal.id, initialInput, baziFor(initialInput), selfMetadata)
      const appended = await repository.appendVersion(created.id, principal.id, 1, appendedInput, baziFor(appendedInput))

      expect(created).toMatchObject({ principalId: principal.id, revision: 1, currentVersion: { version: 1, calculationInput: initialInput, birth: initialInput } })
      expect(appended).toMatchObject({ id: created.id, principalId: principal.id, revision: 2, currentVersion: { version: 2, calculationInput: appendedInput, birth: appendedInput } })
      expect((await repository.listVersions(created.id, principal.id))?.map((version) => version.version)).toEqual([2, 1])
    } finally {
      await repository.close()
    }
  })

  it('rejects a stale expectedRevision after another append wins', async () => {
    const repository = await createRepository()
    try {
      const principal = await repository.createPrincipal(`chart-stale-revision-${randomUUID()}`)
      const initialInput = birthInput('09:30')
      const created = await repository.createProfile(principal.id, initialInput, baziFor(initialInput), selfMetadata)
      const winningInput = birthInput('10:30')

      await repository.appendVersion(created.id, principal.id, 1, winningInput, baziFor(winningInput))

      await expect(repository.appendVersion(created.id, principal.id, 1, birthInput('11:30'), baziFor(birthInput('11:30'))))
        .rejects.toBeInstanceOf(ChartRevisionConflictError)
      expect((await repository.getCurrentProfile(principal.id))?.revision).toBe(2)
      expect(await repository.listVersions(created.id, principal.id)).toHaveLength(2)
    } finally {
      await repository.close()
    }
  })

  it('restores a historical version by appending an audited current version', async () => {
    const repository = await createRepository()
    try {
      const principal = await repository.createPrincipal(`chart-restore-version-${randomUUID()}`)
      const firstInput = birthInput('09:30')
      const secondInput = birthInput('10:30')
      const created = await repository.createProfile(principal.id, firstInput, baziFor(firstInput), selfMetadata)
      await repository.appendVersion(created.id, principal.id, 1, secondInput, baziFor(secondInput))
      const firstVersion = (await repository.listVersions(created.id, principal.id))?.find((version) => version.version === 1)

      const restored = await repository.restoreVersion(created.id, principal.id, firstVersion!.id, 2)

      expect(restored).toMatchObject({ revision: 3, currentVersion: { version: 3, restoredFromVersionId: firstVersion!.id, calculationInput: firstInput, birth: firstInput } })
      expect(restored?.currentVersion.id).not.toBe(firstVersion!.id)
      expect((await repository.listVersions(created.id, principal.id))?.map((version) => version.version)).toEqual([3, 2, 1])
    } finally {
      await repository.close()
    }
  })

  it('restores a soft-deleted profile without losing historical versions', async () => {
    const repository = await createRepository()
    try {
      const principal = await repository.createPrincipal(`chart-soft-delete-restore-${randomUUID()}`)
      const initialInput = birthInput('09:30')
      const appendedInput = birthInput('10:30')
      const created = await repository.createProfile(principal.id, initialInput, baziFor(initialInput), selfMetadata)
      await repository.appendVersion(created.id, principal.id, 1, appendedInput, baziFor(appendedInput))

      await expect(repository.softDeleteProfile(created.id, principal.id)).resolves.toBe(true)
      await expect(repository.getCurrentProfile(principal.id)).resolves.toBeUndefined()
      const restored = await repository.restoreProfile(created.id, principal.id)

      expect(restored).toMatchObject({ id: created.id, principalId: principal.id, revision: 2, currentVersion: { version: 2, calculationInput: appendedInput } })
      expect((await repository.listVersions(created.id, principal.id))?.map((version) => version.version)).toEqual([2, 1])
    } finally {
      await repository.close()
    }
  })

  it('reads an exact historical version only for its owner, including after soft deletion', async () => {
    const repository = await createRepository()
    try {
      const owner = await repository.createPrincipal(`chart-exact-version-owner-${randomUUID()}`)
      const stranger = await repository.createPrincipal(`chart-exact-version-stranger-${randomUUID()}`)
      const firstInput = birthInput('09:30')
      const secondInput = birthInput('10:30')
      const created = await repository.createProfile(owner.id, firstInput, baziFor(firstInput), selfMetadata)
      await repository.appendVersion(created.id, owner.id, 1, secondInput, baziFor(secondInput))

      await expect(repository.getVersion(created.id, owner.id, created.currentVersion.id))
        .resolves.toMatchObject({ id: created.currentVersion.id, version: 1, calculationInput: firstInput })
      await expect(repository.getVersion(created.id, owner.id, randomUUID())).resolves.toBeUndefined()
      await expect(repository.getVersion(created.id, stranger.id, created.currentVersion.id)).resolves.toBeUndefined()

      await repository.softDeleteProfile(created.id, owner.id)
      await expect(repository.getVersion(created.id, owner.id, created.currentVersion.id))
        .resolves.toMatchObject({ id: created.currentVersion.id, version: 1, calculationInput: firstInput })
    } finally {
      await repository.close()
    }
  })

  it('stores and lists multiple labeled active profiles for one principal', async () => {
    const repository = await createRepository()
    try {
      const principal = await repository.createPrincipal(`chart-multiple-${randomUUID()}`)
      const first = await repository.createProfile(principal.id, birthInput('09:30'), baziFor(birthInput('09:30')), selfMetadata)
      const second = await repository.createProfile(principal.id, birthInput('10:30'), baziFor(birthInput('10:30')), { label: '伴侣', relationship: 'partner' })

      expect(await repository.listProfiles(principal.id)).toEqual([
        expect.objectContaining({ id: second.id, label: '伴侣', relationship: 'partner' }),
        expect.objectContaining({ id: first.id, label: '我的命盘', relationship: 'self' }),
      ])
      await expect(repository.getCurrentProfile(principal.id)).resolves.toMatchObject({ id: second.id })
    } finally {
      await repository.close()
    }
  })

  it('enforces the ten-active-profile limit under concurrent creates and permits a new one after deletion', async () => {
    const repository = await createRepository()
    try {
      const principal = await repository.createPrincipal(`chart-concurrent-create-limit-${randomUUID()}`)
      const outcomes = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => {
        const input = birthInput(index % 2 ? '09:30' : '10:30')
        return repository.createProfile(principal.id, input, baziFor(input), { label: `档案 ${index + 1}`, relationship: 'other' })
      }))

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(10)
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(2)
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')[0]).toMatchObject({ reason: expect.any(ChartProfileLimitExceededError) })
      const active = await repository.listProfiles(principal.id)
      expect(active).toHaveLength(10)
      await repository.softDeleteProfile(active[0]!.id, principal.id)
      await expect(repository.createProfile(principal.id, birthInput(), baziFor(birthInput()), { label: '补位档案', relationship: 'other' })).resolves.toMatchObject({ label: '补位档案' })
    } finally {
      await repository.close()
    }
  })

  it('enforces the ten-active-profile limit when restoring a deleted profile', async () => {
    const repository = await createRepository()
    try {
      const principal = await repository.createPrincipal(`chart-restore-limit-${randomUUID()}`)
      const deleted = await repository.createProfile(principal.id, birthInput(), baziFor(birthInput()), selfMetadata)
      await repository.softDeleteProfile(deleted.id, principal.id)
      for (let index = 0; index < 10; index += 1) {
        await repository.createProfile(principal.id, birthInput(), baziFor(birthInput()), { label: `家人 ${index + 1}`, relationship: 'other' })
      }

      await expect(repository.restoreProfile(deleted.id, principal.id)).rejects.toBeInstanceOf(ChartProfileLimitExceededError)
      const active = await repository.listProfiles(principal.id)
      await repository.softDeleteProfile(active[0]!.id, principal.id)
      await expect(repository.restoreProfile(deleted.id, principal.id)).resolves.toMatchObject({ id: deleted.id, label: '我的命盘' })
    } finally {
      await repository.close()
    }
  })

  it('serializes concurrent restores so the active-profile limit cannot be exceeded', async () => {
    const repository = await createRepository()
    try {
      const principal = await repository.createPrincipal(`chart-concurrent-restore-limit-${randomUUID()}`)
      const firstDeleted = await repository.createProfile(principal.id, birthInput(), baziFor(birthInput()), { label: '待恢复一', relationship: 'other' })
      const secondDeleted = await repository.createProfile(principal.id, birthInput(), baziFor(birthInput()), { label: '待恢复二', relationship: 'other' })
      await repository.softDeleteProfile(firstDeleted.id, principal.id)
      await repository.softDeleteProfile(secondDeleted.id, principal.id)
      for (let index = 0; index < 9; index += 1) {
        await repository.createProfile(principal.id, birthInput(), baziFor(birthInput()), { label: `活跃 ${index + 1}`, relationship: 'other' })
      }

      const outcomes = await Promise.allSettled([
        repository.restoreProfile(firstDeleted.id, principal.id),
        repository.restoreProfile(secondDeleted.id, principal.id),
      ])

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')[0]).toMatchObject({ reason: expect.any(ChartProfileLimitExceededError) })
      await expect(repository.listProfiles(principal.id)).resolves.toHaveLength(10)
      await expect(repository.listProfiles(principal.id, true)).resolves.toHaveLength(11)
    } finally {
      await repository.close()
    }
  })

  it('round-trips manual four-pillars calculation_input without a birth projection', async () => {
    const repository = await createRepository()
    try {
      const principal = await repository.createPrincipal(`chart-manual-four-pillars-${randomUUID()}`)
      const manualInput: ManualFourPillarsInput = {
        inputMode: 'manual-four-pillars',
        pillars: ['甲子', '丁丑', '戊寅', '庚申'],
        gender: 'female',
      }
      const manualChart = calculateBaziFromPillars(manualInput)

      const created = await repository.createProfile(principal.id, manualInput, manualChart, selfMetadata)
      const versions = await repository.listVersions(created.id, principal.id)

      expect(created.currentVersion).toMatchObject({ calculationInput: manualInput, bazi: { inputMode: 'manual-four-pillars', inputSnapshot: manualInput } })
      expect(created.currentVersion).not.toHaveProperty('birth')
      expect(versions?.[0]).toMatchObject({ calculationInput: manualInput, bazi: { inputMode: 'manual-four-pillars', inputSnapshot: manualInput } })
      expect(versions?.[0]).not.toHaveProperty('birth')
    } finally {
      await repository.close()
    }
  })
})
