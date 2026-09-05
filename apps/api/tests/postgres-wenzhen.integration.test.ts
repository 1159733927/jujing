import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReportableWenzhenFixture } from '@fengshui/bazi-engine/wenzhen-fixtures'
import { PostgresWenzhenFixtureRepository, runMigrations } from '../src/storage/postgres.js'

const connectionString = process.env.TEST_DATABASE_URL
const describeWithDatabase = connectionString ? describe : describe.skip
const ownedSchemas: string[] = []

function schemaName(): string {
  return `wenzhen_it_${randomUUID().replaceAll('-', '_')}`
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

async function createMigratedPool(): Promise<{ pool: Pool; schema: string }> {
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required')
  const schema = schemaName()
  ownedSchemas.push(schema)
  const admin = new Pool({ connectionString })
  await admin.query(`create schema ${quoteIdentifier(schema)}`)
  await admin.end()

  const pool = isolatedPool(schema)
  await runMigrations(pool, fileURLToPath(new URL('../migrations/', import.meta.url)))
  return { pool, schema }
}

function fixture(sampleId: string): ReportableWenzhenFixture {
  return {
    sampleId,
    source: 'wenzhen-postgres-integration',
    capturedAt: '2026-09-01T05:00:00Z',
    sourceUrl: 'https://pcbz.iwzwh.com/#/paipan/index',
    evidenceRef: `evidence/wenzhen/sha256-${'c'.repeat(64)}.png`,
    status: 'verified',
    birth: {
      calendarSystem: 'solar',
      date: '1992-08-21',
      time: '12:03',
      locationName: '浙江省 杭州市 西湖区',
      longitude: 120.1302,
      latitude: 30.2595,
      timezone: 'Asia/Shanghai',
      useTrueSolarTime: true,
      dstPolicy: 'auto',
      dayBoundary: 'midnight',
      luckMethod: 'sect1',
      gender: 'male',
    },
    expected: { pillars: ['壬申', '戊申', '己巳', '庚午'] },
  }
}

afterEach(async () => {
  if (!connectionString) return
  while (ownedSchemas.length) {
    const schema = ownedSchemas.pop()
    if (!schema?.startsWith('wenzhen_it_')) continue
    const admin = new Pool({ connectionString })
    try {
      await admin.query(`drop schema if exists ${quoteIdentifier(schema)} cascade`)
    } finally {
      await admin.end()
    }
  }
})

describeWithDatabase('PostgresWenzhenFixtureRepository integration', () => {
  it('serializes concurrent appends without dropping either fixture', async () => {
    const { pool } = await createMigratedPool()
    const repository = new PostgresWenzhenFixtureRepository(pool)

    try {
      await Promise.all([
        repository.append(fixture('wz-pg-concurrent-001')),
        repository.append(fixture('wz-pg-concurrent-002')),
      ])

      const sampleIds = (await repository.list()).map((sample) => sample.sampleId).sort()
      expect(sampleIds).toEqual(['wz-pg-concurrent-001', 'wz-pg-concurrent-002'])
    } finally {
      await repository.close()
    }
  })

  it('rejects duplicate sampleIds', async () => {
    const { pool } = await createMigratedPool()
    const repository = new PostgresWenzhenFixtureRepository(pool)

    try {
      await repository.append(fixture('wz-pg-duplicate-001'))

      await expect(repository.append(fixture('wz-pg-duplicate-001'))).rejects.toThrow('WenZhen sampleId already exists')
    } finally {
      await repository.close()
    }
  })

  it('lists fixtures in append order', async () => {
    const { pool } = await createMigratedPool()
    const repository = new PostgresWenzhenFixtureRepository(pool)

    try {
      await repository.append(fixture('wz-pg-list-001'))
      await repository.append(fixture('wz-pg-list-002'))

      expect((await repository.list()).map((sample) => sample.sampleId)).toEqual(['wz-pg-list-001', 'wz-pg-list-002'])
    } finally {
      await repository.close()
    }
  })

  it('rejects update and delete mutations through the append-only trigger', async () => {
    const { pool } = await createMigratedPool()
    const repository = new PostgresWenzhenFixtureRepository(pool)
    try {
      await repository.append(fixture('wz-pg-trigger-001'))

      await expect(pool.query(
        'update wenzhen_fixtures set payload = payload || $1::jsonb where sample_id = $2',
        [JSON.stringify({ evidenceRef: 'changed.png' }), 'wz-pg-trigger-001'],
      )).rejects.toThrow('wenzhen_fixtures is append-only')
      await expect(pool.query('delete from wenzhen_fixtures where sample_id = $1', ['wz-pg-trigger-001']))
        .rejects.toThrow('wenzhen_fixtures is append-only')
    } finally {
      await repository.close()
    }
  })
})
