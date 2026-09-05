import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BaziRuleProfileDefinition } from '@fengshui/domain'
import { buildApp } from '../src/app.js'
import { ChartRepository } from '../src/charts.js'
import { DEMO_BAZI_RULE_PROFILE } from '../src/demo-rule-profile.js'
import { KnowledgeRepository } from '../src/knowledge.js'
import { MediaStore } from '../src/media.js'
import { ReportRepository } from '../src/repository.js'
import { BaziRuleProfileRepository, BaziRuleProfileValidationError, normalizeBaziRuleProfileDefinition } from '../src/rule-profiles.js'
import { FileWenzhenEvidenceStore } from '../src/wenzhen-evidence-store.js'

const v2 = 'true-solar-v2-zone-meridian-equation-of-time'
const v3 = 'true-solar-v3-standard-time-equation-of-time'

class TestMediaStore extends MediaStore {
  override async exists(): Promise<boolean> { return true }
  override async claim(): Promise<void> {}
  override async releaseClaim(): Promise<void> {}
  override async removeClaimed(): Promise<void> {}
}

class TestWenzhenEvidenceStore extends FileWenzhenEvidenceStore {
  override async verify(evidenceRef: string) {
    if (!evidenceRef) throw new Error('WenZhen evidence does not exist')
    return { evidenceRef, sha256: '0'.repeat(64), mimeType: 'image/png' as const, size: 1 }
  }
}

async function testApp() {
  const directory = await mkdtemp(join(tmpdir(), 'fengshui-api-true-solar-'))
  const ruleProfiles = new BaziRuleProfileRepository(join(directory, 'bazi-rule-profiles.json'))
  const app = buildApp(
    new ReportRepository(join(directory, 'reports.json')),
    new TestMediaStore(join(directory, 'uploads')),
    new KnowledgeRepository(join(directory, 'knowledge.json')),
    async () => 'test report',
    { analyze: async () => [] },
    new ChartRepository(join(directory, 'charts.json')),
    ruleProfiles,
    join(directory, 'wenzhen-fixtures.json'),
    new TestWenzhenEvidenceStore(join(directory, 'wenzhen-evidence')),
  )
  return { app, ruleProfiles }
}

const birth = { date: '1992-08-18', time: '09:30', placeCode: '330106' } as const

const definition: BaziRuleProfileDefinition = {
  timeDefaults: {
    timezone: 'Asia/Shanghai',
    dstPolicy: 'auto',
    useTrueSolarTime: true,
    timeCorrectionRuleVersion: v3,
    dayBoundary: 'zi-hour-start',
    luckMethod: 'sect1',
  },
  assessments: {
    strength: { enabled: true, method: 'weighted-seasonal-v1', ruleSetVersion: '1.0.0' },
    pattern: { enabled: true, method: 'school-pattern-v1', ruleSetVersion: '1.0.0' },
    shenSha: { enabled: false, method: 'disabled', ruleSetVersion: '1.0.0' },
  },
}

async function publishProfile(ruleProfiles: BaziRuleProfileRepository, workingDefinition = definition) {
  const created = await ruleProfiles.create({
    key: 'true-solar-school',
    name: '真太阳时测试流派',
    workingDefinition,
  }, 'author')
  await ruleProfiles.setState(created.id, 'in-review', 'author')
  const published = await ruleProfiles.setState(created.id, 'published', 'reviewer')
  return ruleProfiles.getActiveVersion(published!.currentPublishedVersionId!)
}

afterEach(() => vi.unstubAllEnvs())

describe('API true solar rule version selection', () => {
  it('accepts an explicit v3 request and persists calculation input and BaZi snapshot on a chart', async () => {
    const { app } = await testApp()
    const response = await app.inject({ method: 'POST', url: '/v1/charts', payload: {
      ...birth,
      timeCorrectionRuleVersion: v3,
    } })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      profile: {
        currentVersion: {
          calculationInput: { timeCorrectionRuleVersion: v3 },
          bazi: {
            timeCorrectionRuleVersion: v3,
            inputSnapshot: { timeCorrectionRuleVersion: v3 },
            timeProfile: { timeCorrectionRuleVersion: v3 },
          },
        },
      },
    })
    await app.close()
  })

  it('rejects unsupported true solar algorithm versions through the calculation API', async () => {
    const { app } = await testApp()
    const response = await app.inject({ method: 'POST', url: '/v1/bazi', payload: {
      ...birth,
      timeCorrectionRuleVersion: 'true-solar-v4-experimental',
    } })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('timeCorrectionRuleVersion')
    await app.close()
  })

  it('rejects an ambiguous DST fallback wall time for v3', async () => {
    const { app } = await testApp()
    const response = await app.inject({ method: 'POST', url: '/v1/bazi', payload: {
      ...birth,
      date: '2024-11-03', time: '01:30', locationName: '纽约', longitude: -74,
      timezone: 'America/New_York', placeCode: undefined,
      timeCorrectionRuleVersion: v3,
    } })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('birth time is ambiguous')
    await app.close()
  })

  it('preserves legacy rule profile content while new demo defaults write explicit v2', () => {
    const legacy = {
      ...definition,
      timeDefaults: {
        timezone: 'Asia/Shanghai',
        dstPolicy: 'auto',
        useTrueSolarTime: true,
        dayBoundary: 'zi-hour-start',
        luckMethod: 'sect1',
      },
    }

    expect(normalizeBaziRuleProfileDefinition(legacy).timeDefaults.timeCorrectionRuleVersion).toBeUndefined()
    expect(DEMO_BAZI_RULE_PROFILE.workingDefinition.timeDefaults.timeCorrectionRuleVersion).toBe(v2)
  })

  it('rejects invalid rule profile default versions', () => {
    expect(() => normalizeBaziRuleProfileDefinition({
      ...definition,
      timeDefaults: { ...definition.timeDefaults, timeCorrectionRuleVersion: 'civil-time-v1-no-solar-correction' },
    })).toThrow(BaziRuleProfileValidationError)
  })

  it('uses request override over rule defaults and rule defaults over the legacy v2 fallback', async () => {
    const { app, ruleProfiles } = await testApp()
    const active = await publishProfile(ruleProfiles)
    const ruleProfileVersionId = active!.versionId

    const defaulted = await app.inject({ method: 'POST', url: '/v1/bazi', payload: {
      ...birth,
      ruleProfileVersionId,
    } })
    const overridden = await app.inject({ method: 'POST', url: '/v1/bazi', payload: {
      ...birth,
      ruleProfileVersionId,
      timeCorrectionRuleVersion: v2,
    } })
    const legacy = await app.inject({ method: 'POST', url: '/v1/bazi', payload: birth })

    expect(defaulted.statusCode).toBe(200)
    expect(defaulted.json().birth.timeCorrectionRuleVersion).toBe(v3)
    expect(defaulted.json().bazi.inputSnapshot.timeCorrectionRuleVersion).toBe(v3)
    expect(overridden.statusCode).toBe(200)
    expect(overridden.json().birth.timeCorrectionRuleVersion).toBe(v2)
    expect(overridden.json().bazi.inputSnapshot.timeCorrectionRuleVersion).toBe(v2)
    expect(legacy.statusCode).toBe(200)
    expect(legacy.json().birth.timeCorrectionRuleVersion).toBe(v2)
    expect(legacy.json().bazi.inputSnapshot.timeCorrectionRuleVersion).toBe(v2)
    await app.close()
  })
})
