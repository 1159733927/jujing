import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BaziRuleProfileDefinition } from '@fengshui/domain'
import { buildApp } from '../src/app.js'
import { ChartRepository } from '../src/charts.js'
import { KnowledgeRepository } from '../src/knowledge.js'
import { MediaStore } from '../src/media.js'
import { ReportRepository } from '../src/repository.js'
import { BaziRuleProfileRepository } from '../src/rule-profiles.js'

class TestMediaStore extends MediaStore {
  override async exists(): Promise<boolean> { return true }
  override async claim(): Promise<void> {}
  override async releaseClaim(): Promise<void> {}
  override async removeClaimed(): Promise<void> {}
}

const baseBirth = {
  date: '1992-08-18',
  time: '09:30',
  placeCode: '330106',
  useTrueSolarTime: false,
  gender: 'male' as const,
}

const spoofedBirth = {
  date: '2000-01-01',
  time: '00:00',
  locationName: '不应采用',
  longitude: 116.4074,
  timezone: 'Asia/Shanghai',
  useTrueSolarTime: true,
  gender: 'female' as const,
}

const definition: BaziRuleProfileDefinition = {
  timeDefaults: {
    timezone: 'Asia/Shanghai',
    dstPolicy: 'auto',
    useTrueSolarTime: true,
    dayBoundary: 'zi-hour-start',
    luckMethod: 'sect1',
  },
  assessments: {
    strength: { enabled: true, method: 'weighted-seasonal-v1', ruleSetVersion: '1.0.0' },
    pattern: { enabled: true, method: 'school-pattern-v1', ruleSetVersion: '1.0.0' },
    shenSha: { enabled: false, method: 'disabled', ruleSetVersion: '1.0.0' },
  },
}

async function testApp() {
  const directory = await mkdtemp(join(tmpdir(), 'fengshui-chart-flow-'))
  const ruleProfiles = new BaziRuleProfileRepository(join(directory, 'rule-profiles.json'))
  const app = buildApp(
    new ReportRepository(join(directory, 'reports.json')),
    new TestMediaStore(join(directory, 'uploads')),
    new KnowledgeRepository(join(directory, 'knowledge.json')),
    async () => '测试报告',
    { analyze: async () => [] },
    new ChartRepository(join(directory, 'charts.json')),
    ruleProfiles,
  )
  return { app, ruleProfiles }
}

async function createStoredChart() {
  const { app, ruleProfiles } = await testApp()
  const createdRule = await ruleProfiles.create({
    key: 'chart-flow-school',
    name: '流盘测试流派',
    description: '用于验证已存命盘流盘接口',
    workingDefinition: definition,
  }, 'test-admin')
  await ruleProfiles.setState(createdRule.id, 'in-review', 'reviewer')
  await ruleProfiles.setState(createdRule.id, 'published', 'publisher')
  const [activeVersion] = await ruleProfiles.listActiveVersions()
  const chart = await app.inject({
    method: 'POST',
    url: '/v1/charts',
    payload: { ...baseBirth, ruleProfileVersionId: activeVersion!.versionId },
  })
  const cookie = String(chart.headers['set-cookie']).split(';')[0]
  return { app, cookie, profile: chart.json().profile, ruleProfileVersionId: activeVersion!.versionId }
}

describe('stored chart flow API', () => {
  it('calculates flow from the exact stored current chart version and returns provenance', async () => {
    const { app, cookie, profile, ruleProfileVersionId } = await createStoredChart()
    const response = await app.inject({
      method: 'POST',
      url: `/v1/charts/${profile.id}/flow`,
      headers: { cookie },
      payload: {
        chartVersionId: profile.currentVersion.id,
        targetDate: '2026-09-01',
        targetTime: '15:57',
      },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      chartProfileId: profile.id,
      chartVersionId: profile.currentVersion.id,
      ruleProfileVersion: { versionId: ruleProfileVersionId, key: 'chart-flow-school' },
      flow: {
        ruleVersion: 'flow-v4-timezone-projected-jie-boundaries',
        selection: { year: 2026, month: 7, date: '2026-09-01', hourSlotStart: 15 },
        target: { boundaryTimeBasis: 'corrected-local-solar-term-wall-v2' },
        targetChart: {
          correctedLocalTime: '2026-09-01T15:57',
          pillars: ['丙午', '丙申', '戊寅', '庚申'],
          tenGods: ['偏印', '偏印', '比肩', '食神'],
          fiveElements: { counts: { wood: 1, fire: 3, earth: 1, metal: 3, water: 0 } },
        },
        annualCycles: expect.arrayContaining([expect.objectContaining({ year: 2026, pillar: '丙午' })]),
      },
    })
    await app.close()
  })

  it('requires an existing anonymous principal cookie', async () => {
    const { app, profile } = await createStoredChart()
    const response = await app.inject({
      method: 'POST',
      url: `/v1/charts/${profile.id}/flow`,
      payload: { chartVersionId: profile.currentVersion.id, targetDate: '2026-09-01' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'chart access required' })
    await app.close()
  })

  it('hides missing and other-principal chart profiles behind not found', async () => {
    const owner = await createStoredChart()
    const other = await createStoredChart()
    const otherChart = await other.app.inject({
      method: 'POST',
      url: `/v1/charts/${owner.profile.id}/flow`,
      headers: { cookie: other.cookie },
      payload: { chartVersionId: owner.profile.currentVersion.id, targetDate: '2026-09-01' },
    })
    expect(otherChart.statusCode).toBe(404)

    const missing = await owner.app.inject({
      method: 'POST',
      url: '/v1/charts/not-a-chart/flow',
      headers: { cookie: owner.cookie },
      payload: { chartVersionId: owner.profile.currentVersion.id, targetDate: '2026-09-01' },
    })
    expect(missing.statusCode).toBe(404)
    await owner.app.close()
    await other.app.close()
  })

  it('rejects stale chart versions after the profile has been updated', async () => {
    const { app, cookie, profile, ruleProfileVersionId } = await createStoredChart()
    const updated = await app.inject({
      method: 'POST',
      url: `/v1/charts/${profile.id}/versions`,
      headers: { cookie },
      payload: { ...baseBirth, time: '10:30', expectedRevision: 1, ruleProfileVersionId },
    })
    expect(updated.statusCode).toBe(200)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/charts/${profile.id}/flow`,
      headers: { cookie },
      payload: { chartVersionId: profile.currentVersion.id, targetDate: '2026-09-01' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ profile: { revision: 2, currentVersion: { id: updated.json().profile.currentVersion.id } } })
    await app.close()
  })

  it('rejects invalid stored flow targets before returning a flow chart', async () => {
    const { app, cookie, profile } = await createStoredChart()
    const missingTarget = await app.inject({
      method: 'POST',
      url: `/v1/charts/${profile.id}/flow`,
      headers: { cookie },
      payload: { chartVersionId: profile.currentVersion.id },
    })
    expect(missingTarget.statusCode).toBe(400)
    expect(missingTarget.json().error).toContain('targetDate')

    const impossibleDate = await app.inject({
      method: 'POST',
      url: `/v1/charts/${profile.id}/flow`,
      headers: { cookie },
      payload: { chartVersionId: profile.currentVersion.id, targetDate: '2026-02-29' },
    })
    expect(impossibleDate.statusCode).toBe(400)
    expect(impossibleDate.json().error).toContain('target date/time')
    await app.close()
  })

  it('ignores spoofed birth and rule payload fields when calculating from a stored chart', async () => {
    const { app, cookie, profile } = await createStoredChart()
    const stored = await app.inject({
      method: 'POST',
      url: `/v1/charts/${profile.id}/flow`,
      headers: { cookie },
      payload: { chartVersionId: profile.currentVersion.id, targetDate: '2026-09-01', targetTime: '15:57' },
    })
    const spoofed = await app.inject({
      method: 'POST',
      url: `/v1/charts/${profile.id}/flow`,
      headers: { cookie },
      payload: {
        chartVersionId: profile.currentVersion.id,
        targetDate: '2026-09-01',
        targetTime: '15:57',
        birth: spoofedBirth,
        ruleProfileVersionId: 'spoofed:v9:ffffffffffffffff',
      },
    })
    expect(spoofed.statusCode).toBe(200)
    expect(spoofed.json().flow).toEqual(stored.json().flow)
    expect(spoofed.json().ruleProfileVersion).toEqual(stored.json().ruleProfileVersion)
    await app.close()
  })
})
