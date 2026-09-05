import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BaziChart, BirthInput } from '@fengshui/domain'
import { buildApp } from '../src/app.js'
import { ChartRepository } from '../src/charts.js'
import { KnowledgeRepository } from '../src/knowledge.js'
import { MediaStore } from '../src/media.js'
import { ReportRepository } from '../src/repository.js'

class TestMediaStore extends MediaStore {
  override async exists(): Promise<boolean> { return true }
  override async claim(): Promise<void> {}
  override async releaseClaim(): Promise<void> {}
  override async removeClaimed(): Promise<void> {}
}

async function testApp() {
  const directory = await mkdtemp(join(tmpdir(), 'fengshui-professional-fields-'))
  return buildApp(
    new ReportRepository(join(directory, 'reports.json')),
    new TestMediaStore(join(directory, 'uploads')),
    new KnowledgeRepository(join(directory, 'knowledge.json')),
    async () => '测试报告',
    { analyze: async () => [] },
    new ChartRepository(join(directory, 'charts.json')),
  )
}

const syntheticBirth: BirthInput = {
  date: '1992-08-18',
  time: '09:30',
  locationName: '浙江省 杭州市 西湖区',
  longitude: 120.13333,
  latitude: 30.26667,
  placeCode: '330106',
  timezone: 'Asia/Shanghai',
  useTrueSolarTime: true,
  gender: 'male',
}

describe('professional chart field contract', () => {
  it('returns professional machine fields for every pillar from standalone calculation', async () => {
    const app = await testApp()
    const response = await app.inject({ method: 'POST', url: '/v1/bazi', payload: syntheticBirth })
    const chart = response.json().bazi as BaziChart

    expect(response.statusCode).toBe(200)
    expect(chart.professional).toMatchObject({
      method: 'lunar-typescript-eight-char-v1',
      ruleVersion: expect.stringMatching(/^professional-/),
    })
    expect(chart.professional?.naYin).toHaveLength(4)
    expect(chart.professional?.voidBranches).toHaveLength(4)
    expect(chart.professional?.twelveGrowthStages).toHaveLength(4)
    expect(chart.tenGods).toHaveLength(4)
    expect(chart.hiddenStems).toHaveLength(4)
    expect(chart.fiveElements).toMatchObject({
      method: 'visible-stems-and-branches-v1',
      counts: {
        wood: expect.any(Number),
        fire: expect.any(Number),
        earth: expect.any(Number),
        metal: expect.any(Number),
        water: expect.any(Number),
      },
    })
    await app.close()
  })

  it('returns per-pillar table details with hidden-stem ten gods and display fields', async () => {
    const app = await testApp()
    const response = await app.inject({ method: 'POST', url: '/v1/bazi', payload: syntheticBirth })
    const chart = response.json().bazi as BaziChart

    expect(response.statusCode).toBe(200)
    expect(chart.pillarDetails).toHaveLength(4)
    chart.pillarDetails?.forEach((pillar, index) => {
      expect(pillar).toMatchObject({
        pillar: chart.pillars[index],
        heavenlyStem: chart.pillars[index][0],
        earthlyBranch: chart.pillars[index][1],
        stemTenGod: chart.tenGods?.[index],
        naYin: chart.professional?.naYin[index],
        voidBranches: chart.professional?.voidBranches[index],
        twelveGrowthStage: chart.professional?.twelveGrowthStages[index],
        selfSitting: expect.any(String),
        shenSha: { status: 'derived', ruleVersion: 'shensha-baseline-v1-transparent-rules', names: expect.any(Array) },
      })
      expect(pillar.hiddenStems).toEqual(
        chart.hiddenStems?.[index].map((stem) => ({ stem, tenGod: expect.any(String) })),
      )
    })
    await app.close()
  })

  it('round-trips professional chart fields through chart creation and current-profile read', async () => {
    const app = await testApp()
    const created = await app.inject({ method: 'POST', url: '/v1/charts', payload: syntheticBirth })
    const cookie = String(created.headers['set-cookie']).split(';')[0]
    const restored = await app.inject({ method: 'GET', url: '/v1/charts/current', headers: { cookie } })

    expect(created.statusCode).toBe(201)
    expect(restored.statusCode).toBe(200)
    expect(restored.json().profile.currentVersion.bazi.professional).toEqual(
      created.json().profile.currentVersion.bazi.professional,
    )
    expect(restored.json().profile.currentVersion.bazi.pillarDetails).toEqual(
      created.json().profile.currentVersion.bazi.pillarDetails,
    )
    expect(restored.json().profile.currentVersion.bazi.fiveElements).toEqual(
      created.json().profile.currentVersion.bazi.fiveElements,
    )
    await app.close()
  })
})
