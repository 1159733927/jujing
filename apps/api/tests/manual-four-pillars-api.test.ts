import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { QueryResult, QueryResultRow } from 'pg'
import type { ReportRecord } from '@fengshui/domain'
import { calculateBaziFromPillars } from '@fengshui/bazi-engine'
import { buildApp } from '../src/app.js'
import { ChartRepository } from '../src/charts.js'
import { KnowledgeRepository } from '../src/knowledge.js'
import { MediaStore } from '../src/media.js'
import { ReportRepository } from '../src/repository.js'
import { BaziRuleProfileRepository } from '../src/rule-profiles.js'
import { PostgresChartRepository, type PoolLike } from '../src/storage/postgres.js'

class AvailableMediaStore extends MediaStore {
  override async exists(): Promise<boolean> { return true }
  override async claim(): Promise<void> {}
  override async releaseClaim(): Promise<void> {}
  override async removeClaimed(): Promise<void> {}
}

const firstManualInput = {
  inputMode: 'manual-four-pillars' as const,
  pillars: ['丁丑', '癸卯', '戊午', '庚申'] as const,
  gender: 'female' as const,
}

const secondManualInput = {
  inputMode: 'manual-four-pillars' as const,
  pillars: ['壬申', '戊申', '己巳', '庚午'] as const,
  gender: 'male' as const,
}

async function manualTestApp(reportGenerator: (record: ReportRecord) => Promise<string> = async () => '测试报告') {
  const directory = await mkdtemp(join(tmpdir(), 'fengshui-manual-pillars-api-'))
  return buildApp(
    new ReportRepository(join(directory, 'reports.json')),
    new AvailableMediaStore(join(directory, 'uploads')),
    new KnowledgeRepository(join(directory, 'knowledge.json')),
    reportGenerator,
    { analyze: async () => [] },
    new ChartRepository(join(directory, 'charts.json')),
    new BaziRuleProfileRepository(join(directory, 'rule-profiles.json')),
    join(directory, 'wenzhen.json'),
  )
}

describe('manual four-pillar API and persistence', () => {
  it('calculates a deterministic chart without fabricating civil birth data', async () => {
    const app = await manualTestApp()
    const response = await app.inject({ method: 'POST', url: '/v1/bazi', payload: firstManualInput })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      calculationInput: firstManualInput,
      bazi: {
        inputMode: 'manual-four-pillars',
        pillars: firstManualInput.pillars,
        correctedLocalTime: { status: 'unavailable', reason: 'pending-source-required' },
        luckCycles: { status: 'unavailable', reason: 'pending-source-required' },
      },
    })
    expect(response.json()).not.toHaveProperty('birth')
    await app.close()
  })

  it('rejects malformed or impossible stem-branch combinations', async () => {
    const app = await manualTestApp()
    const wrongCount = await app.inject({
      method: 'POST', url: '/v1/bazi',
      payload: { inputMode: 'manual-four-pillars', pillars: ['丁丑', '癸卯', '戊午'] },
    })
    const impossible = await app.inject({
      method: 'POST', url: '/v1/bazi',
      payload: { inputMode: 'manual-four-pillars', pillars: ['甲丑', '癸卯', '戊午', '庚申'] },
    })

    expect(wrongCount.statusCode).toBe(400)
    expect(wrongCount.json().error).toContain('exactly four')
    expect(impossible.statusCode).toBe(400)
    expect(impossible.json().error).toContain('real sexagenary cycle')
    await app.close()
  })

  it('versions and restores manual inputs while keeping birth absent', async () => {
    const app = await manualTestApp()
    const created = await app.inject({ method: 'POST', url: '/v1/charts', payload: firstManualInput })
    expect(created.statusCode).toBe(201)
    expect(created.json().profile.currentVersion).toMatchObject({ calculationInput: firstManualInput })
    expect(created.json().profile.currentVersion).not.toHaveProperty('birth')

    const cookie = String(created.headers['set-cookie']).split(';')[0]
    const profileId = created.json().profile.id as string
    const firstVersionId = created.json().profile.currentVersion.id as string
    const appended = await app.inject({
      method: 'POST',
      url: `/v1/charts/${profileId}/versions`,
      headers: { cookie },
      payload: { ...secondManualInput, expectedRevision: 1 },
    })
    expect(appended.statusCode).toBe(200)
    expect(appended.json().profile.currentVersion).toMatchObject({ calculationInput: secondManualInput })
    expect(appended.json().profile.currentVersion).not.toHaveProperty('birth')

    const restored = await app.inject({
      method: 'POST',
      url: `/v1/charts/${profileId}/versions/${firstVersionId}/restore`,
      headers: { cookie },
      payload: { expectedRevision: 2 },
    })
    expect(restored.statusCode).toBe(200)
    expect(restored.json().profile.currentVersion).toMatchObject({
      calculationInput: firstManualInput,
      restoredFromVersionId: firstVersionId,
    })
    expect(restored.json().profile.currentVersion).not.toHaveProperty('birth')

    const history = await app.inject({ method: 'GET', url: `/v1/charts/${profileId}/versions`, headers: { cookie } })
    expect(history.json().versions).toHaveLength(3)
    expect(history.json().versions.every((version: object) => !('birth' in version))).toBe(true)
    await app.close()
  })

  it('stores PostgreSQL calculation_input with a SQL-null birth projection', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const result = <T extends QueryResultRow>(rows: T[]): QueryResult<T> => ({
      rows, rowCount: rows.length, command: '', oid: 0, fields: [],
    })
    const manualBazi = calculateBaziFromPillars(firstManualInput)
    const client = {
      query: async <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> => {
        calls.push({ text, values })
        if (text.includes('for update')) return result([{ id: 'profile-one', revision: 1 } as unknown as T])
        if (text.includes('returning p.id')) return result([{
          id: 'profile-one', principal_id: 'principal-one', revision: 2,
          created_at: '2026-08-31T00:00:00.000Z', updated_at: '2026-08-31T00:01:00.000Z', deleted_at: null,
          version_id: 'version-two', version: 2,
          calculation_input: firstManualInput, birth: null, bazi: manualBazi,
          rule_profile_version_id: null, rule_profile_version: null, restored_from_version_id: null,
          version_created_at: '2026-08-31T00:01:00.000Z',
        } as unknown as T])
        return result<T>([])
      },
      release: vi.fn(),
    }
    const pool: PoolLike = { query: client.query, connect: async () => client, end: async () => undefined }
    const profile = await new PostgresChartRepository(pool).appendVersion(
      'profile-one', 'principal-one', 1, firstManualInput, manualBazi,
    )

    expect(profile?.currentVersion).toMatchObject({ calculationInput: firstManualInput, bazi: { inputMode: 'manual-four-pillars' } })
    expect(profile?.currentVersion).not.toHaveProperty('birth')
    const insert = calls.find((call) => call.text.includes('insert into chart_versions'))
    expect(insert?.text).toContain('calculation_input, birth, bazi')
    expect(insert?.values).toEqual(expect.arrayContaining([JSON.stringify(firstManualInput), null, JSON.stringify(manualBazi)]))
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('returns pending-source-required instead of inventing flow cycles', async () => {
    const app = await manualTestApp()
    const created = await app.inject({ method: 'POST', url: '/v1/charts', payload: firstManualInput })
    const cookie = String(created.headers['set-cookie']).split(';')[0]
    const profile = created.json().profile
    const response = await app.inject({
      method: 'POST',
      url: `/v1/charts/${profile.id}/flow`,
      headers: { cookie },
      payload: { chartVersionId: profile.currentVersion.id, targetDate: '2026-08-31' },
    })

    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({
      error: 'flow calculation is unavailable for manual four-pillar input without a birth-time source',
      reason: 'pending-source-required',
    })
    await app.close()
  })

  it('feeds only deterministic manual facts into a saved-chart report', async () => {
    let generated: ReportRecord | undefined
    const reportGenerator = vi.fn(async (record: ReportRecord) => {
      generated = structuredClone(record)
      return '手工四柱报告'
    })
    const app = await manualTestApp(reportGenerator)
    const created = await app.inject({ method: 'POST', url: '/v1/charts', payload: firstManualInput })
    const cookie = String(created.headers['set-cookie']).split(';')[0]
    const profile = created.json().profile
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: { cookie },
      payload: {
        visionConsent: true,
        chartProfileId: profile.id,
        chartVersionId: profile.currentVersion.id,
        // A client-provided legacy birth projection must not leak into a manual report.
        birth: { date: '2000-01-01', time: '00:00', locationName: '伪造', longitude: 0 },
        residence: { facing: 'south' },
        photos: [{ fileId: 'manual-room.jpg', room: 'living-room', facing: 'south' }],
      },
    })

    expect(response.statusCode).toBe(202)
    expect(response.json().submission).toMatchObject({ calculationInput: firstManualInput })
    expect(response.json().submission).not.toHaveProperty('birth')
    expect(response.json().bazi).toMatchObject({ inputMode: 'manual-four-pillars', pillars: firstManualInput.pillars })
    await vi.waitFor(() => expect(generated).toBeDefined())
    expect(generated!.submission).not.toHaveProperty('birth')
    expect(generated!.bazi.luckCycles).toEqual({ status: 'unavailable', reason: 'pending-source-required' })
    await app.close()
  })
})
