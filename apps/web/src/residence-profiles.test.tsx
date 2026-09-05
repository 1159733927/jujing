/* @vitest-environment happy-dom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  App,
  CURRENT_REPORT_VALIDATOR_VERSION,
  buildReportSubmissionPayload,
  defaultBirth,
  normalizeResidenceProfilesResponse,
} from './main'

beforeAll(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function cleanup(root: Root, container: HTMLElement) {
  act(() => root.unmount())
  container.remove()
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function readyPayload() {
  return {
    status: 'ready',
    service: 'fengshui-api',
    checks: { deepseekApiKey: true, knowledgeMcpToken: true, publishedExpertKnowledge: true, publishedRules: true, harnessArtifacts: true },
    reasons: [],
  }
}

function chartProfile() {
  return {
    id: 'chart-profile-1',
    revision: 1,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
    currentVersion: {
      id: 'chart-version-1',
      profileId: 'chart-profile-1',
      version: 1,
      calculationInput: defaultBirth,
      bazi: {
        pillars: ['壬申', '戊申', '己巳', '庚午'],
        correctedLocalTime: '1992-08-18T09:27',
        correctionMinutes: -2.67,
      },
      createdAt: '2026-09-01T08:00:00.000Z',
    },
  }
}

function residenceProfile(id: string, versionId: string, label: string, facing: 'north' | 'south') {
  return {
    id,
    principalId: 'principal-one',
    revision: 1,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
    currentVersion: {
      id: versionId,
      profileId: id,
      version: 1,
      snapshot: {
        schemaVersion: 'residence-snapshot-v1' as const,
        label,
        facing,
        layoutNote: `${label} 格局说明`,
      },
      createdAt: '2026-09-01T08:00:00.000Z',
    },
  }
}

async function renderAnalysisPage() {
  window.history.replaceState({}, '', '/')
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:photo-preview'),
    revokeObjectURL: vi.fn(),
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(App)))
  await flushEffects()
  await flushEffects()
  return { root, container }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
  document.body.replaceChildren()
})

describe('web residence profile binding', () => {
  it('normalizes residence list payloads and ignores malformed profiles', () => {
    const valid = residenceProfile('residence-a', 'residence-a-v1', '南向住宅', 'south')

    expect(normalizeResidenceProfilesResponse({ profiles: [valid, { id: 'broken' }] })).toEqual([valid])
    expect(() => normalizeResidenceProfilesResponse({ items: [valid] })).toThrow('住宅档案接口返回格式不正确')
  })

  it('adds immutable residence ids to the report submission payload', () => {
    const residence = residenceProfile('residence-b', 'residence-b-v1', '北向住宅', 'north')

    expect(buildReportSubmissionPayload({
      visionConsent: true,
      birth: defaultBirth,
      chart: {
        profileId: 'chart-profile-1',
        versionId: 'chart-version-1',
        calculationInput: defaultBirth,
        birth: defaultBirth,
      },
      selectedRuleProfileVersionId: '',
      residence: { facing: 'north', layoutNote: '北向住宅 格局说明' },
      selectedResidence: { profile: residence, snapshot: residence.currentVersion.snapshot },
      photos: [{ fileId: 'photo-1', room: 'overview', facing: 'south', note: '' }],
    })).toMatchObject({
      chartProfileId: 'chart-profile-1',
      chartVersionId: 'chart-version-1',
      residenceProfileId: 'residence-b',
      residenceVersionId: 'residence-b-v1',
      residence: { facing: 'north', layoutNote: '北向住宅 格局说明' },
      residenceLabel: '北向住宅',
    })
  })

  it('loads multiple residences, switches selection, and submits the selected current version', async () => {
    const submittedBodies: unknown[] = []
    const residences = [
      residenceProfile('residence-south', 'residence-south-v1', '滨江南向住宅', 'south'),
      residenceProfile('residence-north', 'residence-north-v1', '城北书房住宅', 'north'),
    ]
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/api/ready/report')) return Response.json(readyPayload())
      if (url.includes('/api/v1/charts/current')) return Response.json({ profile: chartProfile() })
      if (url.includes('/api/v1/bazi-rule-profile-versions/active')) return Response.json({ versions: [] })
      if (url.includes('/api/v1/residences')) return Response.json({ profiles: residences })
      if (url.includes('/api/v1/media')) return Response.json({ fileId: 'photo-uploaded-1' })
      if (url.endsWith('/api/v1/reports') && init?.method === 'POST') {
        submittedBodies.push(JSON.parse(String(init.body)))
        return Response.json({
          id: 'report-residence-bound',
          status: 'completed',
          phase: 'completed',
          createdAt: '2026-09-01T09:00:00.000Z',
          bazi: chartProfile().currentVersion.bazi,
          citations: [],
          evaluatedRules: [],
          vision: [],
          generationProvenance: { validatorVersion: CURRENT_REPORT_VALIDATOR_VERSION },
          report: '## 结论\n\n住宅与命盘匹配度中上。',
        })
      }
      return Response.json({})
    })
    const { root, container } = await renderAnalysisPage()

    expect(container.textContent).toContain('滨江南向住宅')
    expect(container.textContent).toContain('城北书房住宅')

    const selector = container.querySelector<HTMLSelectElement>('select[aria-label="住宅档案"]')!
    await act(async () => {
      selector.value = 'residence-north'
      selector.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flushEffects()
    expect(container.querySelector<HTMLInputElement>('input[name="residenceLabel"]')?.value).toBe('城北书房住宅')

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File(['demo'], 'floorplan.png', { type: 'image/png' })] })
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const consent = container.querySelector<HTMLInputElement>('input[name="visionConsent"]')!
    act(() => {
      consent.checked = true
      consent.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flushEffects()

    expect(submittedBodies).toHaveLength(1)
    expect(submittedBodies[0]).toMatchObject({
      residenceProfileId: 'residence-north',
      residenceVersionId: 'residence-north-v1',
      residence: { facing: 'north', layoutNote: '城北书房住宅 格局说明' },
      photos: [{ fileId: 'photo-uploaded-1', room: 'overview', facing: 'unknown', note: '' }],
    })
    cleanup(root, container)
  })

  it('creates a new residence profile before submitting a new-home report', async () => {
    const createdResidence = residenceProfile('residence-created', 'residence-created-v1', '新家户型', 'south')
    const createdPayloads: unknown[] = []
    const reportPayloads: unknown[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/api/ready/report')) return Response.json(readyPayload())
      if (url.includes('/api/v1/charts/current')) return Response.json({ profile: chartProfile() })
      if (url.includes('/api/v1/bazi-rule-profile-versions/active')) return Response.json({ versions: [] })
      if (url.endsWith('/api/v1/residences') && init?.method === 'POST') {
        createdPayloads.push(JSON.parse(String(init.body)))
        return Response.json({ profile: createdResidence }, { status: 201 })
      }
      if (url.endsWith('/api/v1/residences')) return Response.json({ profiles: [] })
      if (url.includes('/api/v1/media')) return Response.json({ fileId: 'photo-uploaded-2' })
      if (url.endsWith('/api/v1/reports') && init?.method === 'POST') {
        reportPayloads.push(JSON.parse(String(init.body)))
        return Response.json({
          id: 'report-created-residence',
          status: 'completed',
          phase: 'completed',
          createdAt: '2026-09-01T09:00:00.000Z',
          bazi: chartProfile().currentVersion.bazi,
          generationProvenance: { validatorVersion: CURRENT_REPORT_VALIDATOR_VERSION },
          report: '## 结论\n\n新建住宅已绑定。',
        })
      }
      return Response.json({})
    })
    const { root, container } = await renderAnalysisPage()

    await act(async () => {
      const label = container.querySelector<HTMLInputElement>('input[name="residenceLabel"]')!
      label.value = '新家户型'
      label.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File(['demo'], 'floorplan.png', { type: 'image/png' })] })
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    act(() => {
      const consent = container.querySelector<HTMLInputElement>('input[name="visionConsent"]')!
      consent.checked = true
      consent.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flushEffects()

    expect(createdPayloads).toEqual([expect.objectContaining({ label: '新家户型', facing: 'south' })])
    expect(reportPayloads[0]).toMatchObject({
      residenceProfileId: 'residence-created',
      residenceVersionId: 'residence-created-v1',
      residenceLabel: '新家户型',
    })
    expect(container.textContent).toContain('已保存住宅档案：新家户型')
    cleanup(root, container)
  })

  it('shows a refreshable stale-version message when the selected residence is updated elsewhere', async () => {
    let residenceListCalls = 0
    const staleResidence = residenceProfile('residence-stale', 'residence-stale-v1', '旧住宅', 'south')
    const freshResidence = residenceProfile('residence-stale', 'residence-stale-v2', '旧住宅', 'south')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/api/ready/report')) return Response.json(readyPayload())
      if (url.includes('/api/v1/charts/current')) return Response.json({ profile: chartProfile() })
      if (url.includes('/api/v1/bazi-rule-profile-versions/active')) return Response.json({ versions: [] })
      if (url.endsWith('/api/v1/residences')) {
        residenceListCalls += 1
        return Response.json({ profiles: [residenceListCalls > 1 ? freshResidence : staleResidence] })
      }
      if (url.includes('/api/v1/media')) return Response.json({ fileId: 'photo-uploaded-3' })
      if (url.endsWith('/api/v1/reports') && init?.method === 'POST') {
        return Response.json({ error: 'residence was updated elsewhere; reload before creating the report' }, { status: 409 })
      }
      return Response.json({})
    })
    const { root, container } = await renderAnalysisPage()

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File(['demo'], 'floorplan.png', { type: 'image/png' })] })
    await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true })))
    act(() => {
      const consent = container.querySelector<HTMLInputElement>('input[name="visionConsent"]')!
      consent.checked = true
      consent.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flushEffects()

    expect(container.textContent).toContain('住宅或命盘已在另一页面更新，请刷新确认后重新生成报告。')
    expect(container.textContent).toContain('版本 1 · 修订 1')
    expect(residenceListCalls).toBeGreaterThanOrEqual(2)
    cleanup(root, container)
  })
})
