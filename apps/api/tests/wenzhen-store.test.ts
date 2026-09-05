import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReportableWenzhenFixture } from '@fengshui/bazi-engine/wenzhen-fixtures'
import {
  FileWenzhenFixtureStore,
  WENZHEN_FIXTURE_STORE_SCHEMA_VERSION,
  type WenzhenStoreFileOperations,
} from '../src/wenzhen-store.js'

const temporaryRoots: string[] = []

async function temporaryFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fengshui-wenzhen-store-'))
  temporaryRoots.push(root)
  return join(root, 'canonical-fixtures.json')
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function syntheticFixture(sampleId = 'synthetic-store-001'): ReportableWenzhenFixture {
  return {
    sampleId,
    source: 'synthetic-persistence-contract-test',
    status: 'verified',
    capturedAt: '2026-08-31T10:20:30+08:00',
    sourceUrl: 'https://pcbz.iwzwh.com/#/paipan/index',
    evidenceRef: `evidence/wenzhen/sha256-${'a'.repeat(64)}.png`,
    notes: 'Synthetic storage-contract fixture; not captured WenZhen parity evidence.',
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
    expected: { pillars: ['甲子', '乙丑', '丙寅', '丁卯'] },
  }
}

describe('FileWenzhenFixtureStore', () => {
  it('treats a missing file as empty and appends a schema-versioned validated fixture', async () => {
    const path = await temporaryFile()
    const store = new FileWenzhenFixtureStore(path)

    await expect(store.list()).resolves.toEqual([])
    await expect(store.ping()).resolves.toBeUndefined()
    await expect(store.append(syntheticFixture())).resolves.toMatchObject({ sampleId: 'synthetic-store-001' })
    await expect(store.list()).resolves.toHaveLength(1)

    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      schemaVersion: WENZHEN_FIXTURE_STORE_SCHEMA_VERSION,
      samples: [{ sampleId: 'synthetic-store-001', status: 'verified' }],
    })
    await store.close()
    await expect(store.list()).rejects.toThrow(/closed/)
  })

  it('rejects duplicate sampleIds without changing the append-only file', async () => {
    const path = await temporaryFile()
    const store = new FileWenzhenFixtureStore(path)
    await store.append(syntheticFixture())
    const before = await readFile(path, 'utf8')

    await expect(store.append(syntheticFixture())).rejects.toThrow(/already exists/)
    expect(await readFile(path, 'utf8')).toBe(before)
    await expect(store.list()).resolves.toHaveLength(1)
  })

  it('serializes concurrent appends so two distinct sampleIds are not lost', async () => {
    const path = await temporaryFile()
    const store = new FileWenzhenFixtureStore(path)
    await Promise.all([
      store.append(syntheticFixture('synthetic-concurrent-001')),
      store.append(syntheticFixture('synthetic-concurrent-002')),
    ])

    expect((await store.list()).map((fixture) => fixture.sampleId)).toEqual([
      'synthetic-concurrent-001',
      'synthetic-concurrent-002',
    ])
  })

  it('recovers the write queue after a failed write', async () => {
    const path = await temporaryFile()
    let writes = 0
    const fileOperations: Partial<WenzhenStoreFileOperations> = {
      writeFile: async (temporaryPath, contents) => {
        writes += 1
        if (writes === 1) throw new Error('injected write failure')
        await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      },
    }
    const store = new FileWenzhenFixtureStore(path, { fileOperations })

    await expect(store.append(syntheticFixture('synthetic-failed-001'))).rejects.toThrow(/injected write failure/)
    await expect(store.append(syntheticFixture('synthetic-recovered-002'))).resolves.toMatchObject({ sampleId: 'synthetic-recovered-002' })
    await expect(store.list()).resolves.toEqual([expect.objectContaining({ sampleId: 'synthetic-recovered-002' })])
  })

  it.each([
    ['malformed JSON', '{not-json'],
    ['wrong schema', JSON.stringify({ schemaVersion: 'unknown', samples: [] })],
    ['duplicate sampleId', JSON.stringify({ schemaVersion: WENZHEN_FIXTURE_STORE_SCHEMA_VERSION, samples: [syntheticFixture(), syntheticFixture()] })],
    ['invalid fixture', JSON.stringify({ schemaVersion: WENZHEN_FIXTURE_STORE_SCHEMA_VERSION, samples: [{ sampleId: 'synthetic-invalid-001', source: 'test', status: 'pending-manual-verification' }] })],
  ])('fails closed for %s', async (_description, contents) => {
    const path = await temporaryFile()
    await writeFile(path, contents)
    const store = new FileWenzhenFixtureStore(path)

    await expect(store.list()).rejects.toThrow()
    await expect(store.append(syntheticFixture('synthetic-must-not-overwrite'))).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(contents)
  })

  it('isolates stored state from caller and returned-object mutation', async () => {
    const path = await temporaryFile()
    const store = new FileWenzhenFixtureStore(path)
    const input = syntheticFixture()
    const appended = await store.append(input)

    ;(input as unknown as { expected: { pillars: string[] } }).expected.pillars[0] = '壬子'
    ;(appended as unknown as { expected: { pillars: string[] } }).expected.pillars[1] = '癸丑'
    const firstList = await store.list()
    ;(firstList[0] as unknown as { expected: { pillars: string[] } }).expected.pillars[2] = '戊寅'

    const fresh = await store.list()
    expect(fresh[0].expected.pillars).toEqual(['甲子', '乙丑', '丙寅', '丁卯'])
  })
})
