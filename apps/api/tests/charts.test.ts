import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BaziCalculationResult, BirthInput } from '@fengshui/domain'
import { ChartProfileLimitExceededError, ChartRepository } from '../src/charts.js'

const birth: BirthInput = {
  date: '1992-08-18',
  time: '09:30',
  locationName: '杭州市',
  longitude: 120.1551,
}

const bazi = {
  ruleVersion: 'bazi-v1-beijing-true-solar',
  correctedLocalTime: '1992-08-18T09:30:00.000+08:00',
  correctionMinutes: 0,
  pillars: ['壬申', '戊申', '丙寅', '癸巳'],
} as BaziCalculationResult

async function repository() {
  const directory = await mkdtemp(join(tmpdir(), 'fengshui-chart-store-'))
  return { charts: new ChartRepository(join(directory, 'charts.json')), path: join(directory, 'charts.json') }
}

describe('file-backed multi-chart profiles', () => {
  it('stores and lists multiple profiles for one principal by most recent update', async () => {
    const { charts } = await repository()
    const first = await charts.createProfile('owner', birth, bazi, { label: '我的命盘', relationship: 'self' })
    const second = await charts.createProfile('owner', birth, bazi, { label: '妈妈', relationship: 'parent' })

    await expect(charts.listProfiles('owner')).resolves.toMatchObject([
      { id: second.id, label: '妈妈', relationship: 'parent' },
      { id: first.id, label: '我的命盘', relationship: 'self' },
    ])
    await expect(charts.getCurrentProfile('owner')).resolves.toMatchObject({ id: second.id })
  })

  it('enforces the ten-active-profile limit and releases capacity after soft deletion', async () => {
    const { charts } = await repository()
    const profiles = []
    for (let index = 0; index < 10; index += 1) {
      profiles.push(await charts.createProfile('owner', birth, bazi, { label: `家人 ${index + 1}`, relationship: 'other' }))
    }

    await expect(charts.createProfile('owner', birth, bazi, { label: '超额', relationship: 'other' }))
      .rejects.toBeInstanceOf(ChartProfileLimitExceededError)

    await charts.softDeleteProfile(profiles[0]!.id, 'owner')
    await expect(charts.createProfile('owner', birth, bazi, { label: '新档案', relationship: 'other' }))
      .resolves.toMatchObject({ label: '新档案' })
    await expect(charts.listProfiles('owner', true)).resolves.toHaveLength(11)
    await expect(charts.listProfiles('owner')).resolves.toHaveLength(10)
  })

  it('restores a deleted profile only when active capacity is available', async () => {
    const { charts } = await repository()
    const deleted = await charts.createProfile('owner', birth, bazi, { label: '待恢复', relationship: 'partner' })
    await charts.softDeleteProfile(deleted.id, 'owner')
    for (let index = 0; index < 10; index += 1) {
      await charts.createProfile('owner', birth, bazi, { label: `档案 ${index + 1}`, relationship: 'other' })
    }

    await expect(charts.restoreProfile(deleted.id, 'owner')).rejects.toBeInstanceOf(ChartProfileLimitExceededError)
    const [active] = await charts.listProfiles('owner')
    await charts.softDeleteProfile(active!.id, 'owner')
    await expect(charts.restoreProfile(deleted.id, 'owner')).resolves.toMatchObject({
      id: deleted.id,
      label: '待恢复',
      relationship: 'partner',
    })
  })

  it('normalizes legacy JSON profiles without metadata', async () => {
    const { charts, path } = await repository()
    await writeFile(path, JSON.stringify({
      principals: [],
      profiles: [{
        id: 'legacy-profile',
        principalId: 'owner',
        revision: 1,
        currentVersionId: 'legacy-version',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
      versions: [{
        id: 'legacy-version',
        profileId: 'legacy-profile',
        version: 1,
        birth,
        bazi,
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
    }))

    await expect(charts.listProfiles('owner')).resolves.toMatchObject([
      { id: 'legacy-profile', label: '我的命盘', relationship: 'self' },
    ])
  })
})
