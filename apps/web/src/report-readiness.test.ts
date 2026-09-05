/* @vitest-environment happy-dom */
import { act, createElement } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { App } from './main'
import {
  canSubmitReport,
  fetchReportReadiness,
  parseReportReadinessPayload,
  reportReadinessSubmitError,
} from './report-readiness'
import {
  CURRENT_REPORT_VALIDATOR_VERSION,
  investorReportReadinessSummary,
  investorReportStepState,
  investorReportSteps,
  mapReportPhaseToUiStatus,
  reportEvidenceCounts,
  reportHistoryMetaLine,
  reportHistoryStatusLabel,
  reportHistoryTitle,
  REPORT_HISTORY_REFRESH_MS,
  reportPhaseStatusDetail,
  shouldShowInvestorReportProgress,
  shouldShowReadinessAdminAction,
  waitForReport,
  buildReportEvidenceCards,
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
  })
}

function baseReadyPayload() {
  return {
    status: 'ready',
    service: 'fengshui-api',
    checks: { deepseekApiKey: true, knowledgeMcpToken: true, publishedExpertKnowledge: true, publishedRules: true, harnessArtifacts: true },
    reasons: [],
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
  document.body.replaceChildren()
})

describe('report readiness parser', () => {
  it('uses the same current validator generation as the report e2e contract', () => {
    const smokeScript = readFileSync(resolve(process.cwd(), '../../scripts/report-e2e-smoke.mjs'), 'utf8')
    expect(smokeScript).toContain(`CURRENT_REPORT_VALIDATOR_VERSION = '${CURRENT_REPORT_VALIDATOR_VERSION}'`)
  })

  it('accepts the strict 200 ready contract and exposes only the five user-facing components', () => {
    const state = parseReportReadinessPayload(200, {
      ...baseReadyPayload(),
      deepseekApiKey: 'sk-hidden',
      localPath: '/Users/person/plugin',
      reasons: ['missing_harness_artifact'],
    })

    expect(state.status).toBe('ready')
    expect(state.components).toEqual([
      { key: 'deepseek-model', label: 'DeepSeek模型', ready: true },
      { key: 'expert-knowledge-base', label: '知识库连接', ready: true },
      { key: 'expert-published-sources', label: '已发布专家资料', ready: true },
      { key: 'structured-rules', label: '结构化规则（增强项）', ready: true },
      { key: 'harness-runtime', label: 'Harness运行组件', ready: true },
    ])
    const exposed = JSON.stringify(state)
    expect(exposed).not.toContain('missing_harness_artifact')
    expect(exposed).not.toContain('/Users')
    expect(exposed).not.toContain('sk-hidden')
  })

  it('treats 503 as a valid not-ready state without exposing backend reasons', () => {
    const state = parseReportReadinessPayload(503, {
      status: 'not-ready',
      service: 'fengshui-api',
      checks: { deepseekApiKey: false, knowledgeMcpToken: true, publishedExpertKnowledge: false, publishedRules: true, harnessArtifacts: false },
      reasons: ['missing_deepseek_api_key', 'missing_published_expert_knowledge', 'missing_harness_artifact'],
      harnessArtifactPath: '/Users/person/project/fengshui-report-plugin',
    })

    expect(state.status).toBe('not-ready')
    expect(state.components.map((component) => [component.label, component.ready])).toEqual([
      ['DeepSeek模型', false],
      ['知识库连接', true],
      ['已发布专家资料', false],
      ['结构化规则（增强项）', true],
      ['Harness运行组件', false],
    ])
    expect(JSON.stringify(state)).not.toContain('missing_deepseek_api_key')
    expect(JSON.stringify(state)).not.toContain('harnessArtifactPath')
    expect(JSON.stringify(state)).not.toContain('/Users/person')
  })

  it('fails closed on status mismatches and malformed check contracts', () => {
    expect(() => parseReportReadinessPayload(200, { ...baseReadyPayload(), status: 'not-ready' })).toThrow('状态与 HTTP 状态不一致')
    expect(() => parseReportReadinessPayload(200, { ...baseReadyPayload(), checks: { deepseekApiKey: true } })).toThrow('组件状态格式错误')
    expect(() => parseReportReadinessPayload(500, { status: 'error' })).toThrow('不支持的 HTTP 500')
  })
})

describe('report readiness fetch and submit gate', () => {
  it('maps request 200, request 503, invalid JSON and abort to ready/not-ready/unknown', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValueOnce(Response.json(baseReadyPayload(), { status: 200 }))
    await expect(fetchReportReadiness()).resolves.toMatchObject({ status: 'ready' })

    fetchMock.mockResolvedValueOnce(Response.json({
      status: 'not-ready',
      service: 'fengshui-api',
      checks: { deepseekApiKey: true, knowledgeMcpToken: false, publishedExpertKnowledge: true, publishedRules: true, harnessArtifacts: true },
      reasons: ['missing_knowledge_mcp_token'],
    }, { status: 503 }))
    await expect(fetchReportReadiness()).resolves.toMatchObject({ status: 'not-ready' })

    fetchMock.mockResolvedValueOnce(new Response('{not-json', { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(fetchReportReadiness()).resolves.toMatchObject({ status: 'unknown' })

    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
    await expect(fetchReportReadiness()).resolves.toMatchObject({ status: 'unknown' })
  })

  it('requires readiness plus the existing report conditions before submit is enabled', () => {
    expect(canSubmitReport({ busy: false, readiness: { status: 'ready' }, photoCount: 1, inputError: '' })).toBe(true)
    expect(canSubmitReport({ busy: true, readiness: { status: 'ready' }, photoCount: 1, inputError: '' })).toBe(false)
    expect(canSubmitReport({ busy: false, readiness: { status: 'not-ready' }, photoCount: 1, inputError: '' })).toBe(false)
    expect(canSubmitReport({ busy: false, readiness: { status: 'unknown' }, photoCount: 1, inputError: '' })).toBe(false)
    expect(canSubmitReport({ busy: false, readiness: { status: 'ready' }, photoCount: 0, inputError: '' })).toBe(false)
    expect(canSubmitReport({ busy: false, readiness: { status: 'ready' }, photoCount: 1, inputError: '缺少出生地点' })).toBe(false)
    expect(reportReadinessSubmitError({ status: 'ready' })).toBe('')
    expect(reportReadinessSubmitError({ status: 'not-ready' })).toContain('已发布专家资料')
    expect(reportReadinessSubmitError({ status: 'not-ready' })).not.toContain('结构化规则')
    expect(reportReadinessSubmitError({ status: 'unknown' })).toContain('无法确认')
  })
})

describe('report phase progress mapping', () => {
  it('counts the evidence buckets shown in report previews', () => {
    const report = {
      bazi: { pillars: ['壬申', '戊申', '丙寅', '癸巳'] },
      citations: [
        { title: '玄关资料', sourceLabel: '专家 A', versionId: 'kv-1', version: 1, contentHash: 'hash-1' },
        { title: '客厅资料', sourceLabel: '专家 B', versionId: 'kv-2', version: 2, contentHash: 'hash-2' },
      ],
      evaluatedRules: [
        { title: '明堂开阔', priority: 1, conclusions: [], versionId: 'rule-1', version: 1, contentHash: 'hash-rule-1' },
      ],
      vision: [
        { room: 'living-room', summary: '客厅朝南，采光较好。' },
      ],
    }
    expect(reportEvidenceCounts(report)).toEqual({ citations: 2, rules: 1, vision: 1 })
    expect(buildReportEvidenceCards(report)).toEqual([
      { label: '命盘依据', value: '已绑定', detail: '壬申 · 戊申 · 丙寅 · 癸巳', state: 'ready' },
      { label: '住宅照片', value: '1 条', detail: '已完成空间观察', state: 'ready' },
      { label: '专家资料', value: '2 条', detail: '已引用已发布版本', state: 'ready' },
      { label: '规则命中', value: '1 条', detail: '已执行确定性规则', state: 'ready' },
    ])
  })

  it('uses the four investor-facing report steps instead of exposing internal pipeline stages', () => {
    expect(investorReportSteps.map((step) => step.label)).toEqual(['上传照片', '识别空间', '匹配规则', '生成报告'])
    expect(investorReportStepState('uploading', 'uploading')).toBe('active')
    expect(investorReportStepState('vision-analyzing', 'uploading')).toBe('done')
    expect(investorReportStepState('rules-evaluating', 'harness-generating')).toBe('upcoming')
    expect(investorReportStepState('completed', 'harness-generating')).toBe('done')
    expect(shouldShowInvestorReportProgress('idle', '')).toBe(false)
    expect(shouldShowInvestorReportProgress('idle', 'report-one')).toBe(true)
    expect(shouldShowInvestorReportProgress('harness-generating', '')).toBe(true)
  })

  it('maps every server phase to the investor-facing UI status and keeps legacy queued reports queued', () => {
    expect(mapReportPhaseToUiStatus({ status: 'queued' })).toBe('queued')
    expect(mapReportPhaseToUiStatus({ status: 'queued', phase: 'queued' })).toBe('queued')
    expect(mapReportPhaseToUiStatus({ status: 'queued', phase: 'vision-analyzing' })).toBe('vision-analyzing')
    expect(mapReportPhaseToUiStatus({ status: 'queued', phase: 'rules-evaluating' })).toBe('rules-evaluating')
    expect(mapReportPhaseToUiStatus({ status: 'queued', phase: 'harness-generating' })).toBe('harness-generating')
    expect(mapReportPhaseToUiStatus({ status: 'completed', phase: 'completed' })).toBe('completed')
    expect(mapReportPhaseToUiStatus({ status: 'failed', phase: 'failed' })).toBe('failed')
  })

  it('uses phase-specific detail copy instead of generic polling text', () => {
    expect(reportPhaseStatusDetail({ status: 'queued', phase: 'vision-analyzing' }, 2)).toContain('正在识别住宅照片')
    expect(reportPhaseStatusDetail({ status: 'queued', phase: 'rules-evaluating' }, 3)).toContain('专家规则')
    expect(reportPhaseStatusDetail({ status: 'queued', phase: 'harness-generating' }, 4)).toContain('DeepSeek Harness')
    expect(reportPhaseStatusDetail({ status: 'failed', phase: 'failed', error: 'vision failed' })).toBe('vision failed')
  })

  it('reports progress from each fetched phase and never advances by attempt number alone', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockResolvedValueOnce(Response.json({ id: 'report-one', status: 'queued' }))
      .mockResolvedValueOnce(Response.json({ id: 'report-one', status: 'queued' }))
      .mockResolvedValueOnce(Response.json({ id: 'report-one', status: 'queued', phase: 'vision-analyzing' }))
      .mockResolvedValueOnce(Response.json({ id: 'report-one', status: 'queued', phase: 'rules-evaluating' }))
      .mockResolvedValueOnce(Response.json({ id: 'report-one', status: 'queued', phase: 'harness-generating' }))
      .mockResolvedValueOnce(Response.json({ id: 'report-one', status: 'completed', phase: 'completed', report: 'done' }))
    const controller = new AbortController()
    const statuses: string[] = []
    const polling = waitForReport('report-one', controller.signal, (status) => statuses.push(status))

    for (const delay of [1_500, 3_000, 4_500, 6_000, 7_500]) {
      await vi.advanceTimersByTimeAsync(delay)
    }
    await expect(polling).resolves.toMatchObject({ status: 'completed', phase: 'completed' })
    expect(statuses).toEqual([
      'queued',
      'queued',
      'vision-analyzing',
      'rules-evaluating',
      'harness-generating',
      'completed',
    ])
    vi.useRealTimers()
  })

  it('formats report history entries as product language instead of technical ids', () => {
    expect(reportHistoryStatusLabel({ status: 'queued', phase: 'vision-analyzing' })).toBe('识别空间')
    expect(reportHistoryStatusLabel({ status: 'queued', phase: 'harness-generating' })).toBe('生成报告')
    expect(reportHistoryStatusLabel({ status: 'completed', phase: 'completed' })).toBe('已完成')
    expect(reportHistoryStatusLabel({ status: 'failed', phase: 'failed' })).toBe('生成失败')
    expect(reportHistoryTitle({ residenceFacing: 'south' })).toBe('住宅朝南分析')
    expect(reportHistoryTitle({ residenceFacing: undefined })).toBe('住宅分析报告')
    expect(reportHistoryMetaLine({ status: 'queued', phase: 'rules-evaluating', photoCount: 3, chartVersionId: 'chart-version-id' })).toBe('3 张照片 · 已绑定命盘 · 进行到：匹配规则')
    expect(reportHistoryMetaLine({ status: 'completed', phase: 'completed', photoCount: 1 })).toBe('1 张照片 · 未绑定命盘 · 已完成')
  })
})

describe('report readiness UI', () => {
  it('does not request report readiness on the standalone chart page', async () => {
    window.history.replaceState({}, '', '/chart')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ profile: null }))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => root.render(createElement(App)))
    await flushEffects()

    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/ready/report'))).toBe(false)
    cleanup(root, container)
  })

  it('keeps recovery search hidden and generation diagnostics collapsed on the analysis page', async () => {
    window.history.replaceState({}, '', '/')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/ready/report')) return Response.json(baseReadyPayload(), { status: 200 })
      if (url.includes('/api/v1/charts/current')) return Response.json({ profile: null })
      if (url.includes('/api/v1/bazi-rule-profile-versions/active')) return Response.json({ versions: [] })
      return Response.json({})
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => root.render(createElement(App)))
    await flushEffects()

    expect(container.querySelector('.report-lookup-details')).toBeNull()
    expect(container.textContent).not.toContain('找回已有报告')
    expect((container.querySelector('.report-readiness') as HTMLDetailsElement | null)?.open).toBe(false)
    expect(container.querySelector('.report-flow-overview')).toBeNull()
    expect(container.querySelector('.steps')).toBeNull()
    expect(container.querySelector('[aria-label="信息规则"]')).toBeNull()
    expect(container.querySelectorAll('.report-readiness li')).toHaveLength(5)
    expect(investorReportReadinessSummary('ready')).toBe('生成链路已就绪')
    cleanup(root, container)
  })

  it('renders only the whitelisted component labels inside collapsed runtime details and hides malicious extra fields', async () => {
    window.history.replaceState({}, '', '/')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/ready/report')) return Response.json({
        status: 'not-ready',
        service: 'fengshui-api',
        checks: { deepseekApiKey: false, knowledgeMcpToken: true, publishedExpertKnowledge: true, publishedRules: true, harnessArtifacts: true },
        reasons: ['missing_deepseek_api_key'],
        localPath: '/Users/person/secret',
        token: 'sk-hidden',
      }, { status: 503 })
      if (url.includes('/api/v1/charts/current')) return Response.json({ profile: null })
      if (url.includes('/api/v1/bazi-rule-profile-versions/active')) return Response.json({ versions: [] })
      return Response.json({})
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => root.render(createElement(App)))
    await flushEffects()

    expect(container.textContent).toContain('DeepSeek模型')
    expect(container.textContent).toContain('知识库连接')
    expect(container.textContent).toContain('已发布专家资料')
    expect(container.textContent).toContain('结构化规则（增强项）')
    expect(container.textContent).toContain('Harness运行组件')
    expect(container.textContent).toContain('未就绪')
    expect(container.textContent).not.toContain('missing_deepseek_api_key')
    expect(container.textContent).not.toContain('/Users/person')
    expect(container.textContent).not.toContain('sk-hidden')
    cleanup(root, container)
  })

  it('does not expose an expert admin jump from the consumer report readiness panel', async () => {
    window.history.replaceState({}, '', '/')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/ready/report')) return Response.json({
        status: 'not-ready',
        service: 'fengshui-api',
        checks: {
          deepseekApiKey: true,
          knowledgeMcpToken: true,
          publishedExpertKnowledge: false,
          publishedRules: false,
          harnessArtifacts: true,
        },
        reasons: ['missing_published_expert_knowledge', 'missing_published_rules'],
      }, { status: 503 })
      if (url.includes('/api/v1/charts/current')) return Response.json({ profile: null })
      if (url.includes('/api/v1/bazi-rule-profile-versions/active')) return Response.json({ versions: [] })
      return Response.json({})
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => root.render(createElement(App)))
    await flushEffects()

    expect(shouldShowReadinessAdminAction({
      status: 'not-ready',
      components: [
        { key: 'expert-published-sources', label: '已发布专家资料', ready: false },
        { key: 'structured-rules', label: '已发布结构化规则', ready: false },
      ],
    })).toBe(false)
    expect(container.querySelector('.readiness-admin-link')).toBeNull()
    cleanup(root, container)
  })

  it('opens the latest report automatically on the report history page', async () => {
    window.history.replaceState({}, '', '/reports')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/v1/reports/report-latest')) return Response.json({
        id: 'report-latest',
        status: 'completed',
        phase: 'completed',
        createdAt: '2026-09-01T12:00:00.000Z',
        submission: { visionConsent: true, residence: { facing: 'south' }, photos: [] },
        bazi: {
          pillars: ['壬申', '戊申', '丙寅', '癸巳'],
          correctedLocalTime: '1992-08-18T09:27',
          correctionMinutes: -2.67,
        },
        citations: [
          { title: '客厅采光资料', sourceLabel: '专家资料库', versionId: 'kv-1', version: 3, contentHash: 'hash-1' },
        ],
        evaluatedRules: [
          { title: '明堂开阔', priority: 1, conclusions: [], versionId: 'rule-1', version: 2, contentHash: 'hash-rule-1' },
        ],
        vision: [
          { room: 'living-room', summary: '客厅朝南，采光较好。' },
        ],
        generationProvenance: { validatorVersion: CURRENT_REPORT_VALIDATOR_VERSION },
        report: '## 摘要\n\n最新报告正文',
      })
      if (url.includes('/api/v1/reports')) return Response.json({
        reports: [
          { id: 'report-latest', status: 'completed', phase: 'completed', createdAt: '2026-09-01T12:00:00.000Z', residenceFacing: 'south', photoCount: 1, hasReport: true, reportPreview: '最新报告摘要预览' },
          { id: 'report-old', status: 'queued', phase: 'harness-generating', createdAt: '2026-08-31T12:00:00.000Z', residenceFacing: 'north', photoCount: 2, hasReport: false },
        ],
      })
      if (url.includes('/api/v1/charts/current')) return Response.json({ profile: null })
      if (url.includes('/api/v1/bazi-rule-profile-versions/active')) return Response.json({ versions: [] })
      return Response.json({})
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => root.render(createElement(App)))
    await flushEffects()
    await flushEffects()

    expect(container.textContent).toContain('住宅朝南分析')
    expect(container.textContent).toContain('最新报告摘要预览')
    expect(container.textContent).toContain('生成报告')
    expect(container.textContent).toContain('2 张照片 · 未绑定命盘 · 进行到：生成报告')
    expect(container.textContent).toContain('报告编号')
    expect(container.textContent).toContain('模型校验')
    expect(container.textContent).toContain('下载 PDF')
    expect(container.textContent).toContain('新建分析')
    expect(container.textContent).toContain('查看本报告使用的资料与规则')
    expect(container.textContent).toContain('报告依据摘要')
    expect(container.textContent).toContain('命盘依据')
    expect(container.textContent).toContain('住宅照片')
    expect(container.textContent).toContain('专家资料')
    expect(container.textContent).toContain('规则命中')
    expect(container.textContent).toContain('客厅采光资料')
    expect(container.textContent).toContain('明堂开阔')
    expect(container.textContent).toContain('照片观察：客厅 · 客厅朝南，采光较好。')
    expect(container.textContent).toContain('最新报告正文')
    const reportBody = container.querySelector('.report-copy')
    const evidence = container.querySelector<HTMLDetailsElement>('.evidence-summary')
    const metadata = container.querySelector<HTMLDetailsElement>('.report-meta-disclosure')
    expect(evidence?.open).toBe(false)
    expect(metadata?.open).toBe(false)
    expect((reportBody?.compareDocumentPosition(evidence as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((evidence?.compareDocumentPosition(metadata as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.textContent?.indexOf('最新报告正文')).toBeLessThan(container.textContent?.indexOf('生成与版本信息'))
    expect(container.textContent).not.toContain('从左侧选择一份报告查看正文')
    cleanup(root, container)
  })

  it('auto refreshes queued report history and the selected report detail', async () => {
    vi.useFakeTimers()
    window.history.replaceState({}, '', '/reports')
    let listCalls = 0
    let detailCalls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/v1/reports/report-live')) {
        detailCalls += 1
        if (detailCalls === 1) {
          return Response.json({
            id: 'report-live',
            status: 'queued',
            phase: 'harness-generating',
            createdAt: '2026-09-01T12:00:00.000Z',
            submission: { visionConsent: true, residence: { facing: 'east' }, photos: [] },
            bazi: { pillars: ['壬申', '戊申', '丙寅', '癸巳'] },
          })
        }
        return Response.json({
          id: 'report-live',
          status: 'completed',
          phase: 'completed',
          createdAt: '2026-09-01T12:00:00.000Z',
          submission: { visionConsent: true, residence: { facing: 'east' }, photos: [] },
          bazi: { pillars: ['壬申', '戊申', '丙寅', '癸巳'] },
          citations: [],
          evaluatedRules: [],
          vision: [],
          generationProvenance: { validatorVersion: CURRENT_REPORT_VALIDATOR_VERSION },
          report: '## 摘要\n\n生成后的报告正文',
        })
      }
      if (url.endsWith('/api/v1/reports')) {
        listCalls += 1
        return Response.json({
          reports: [
            {
              id: 'report-live',
              status: listCalls === 1 ? 'queued' : 'completed',
              phase: listCalls === 1 ? 'harness-generating' : 'completed',
              createdAt: '2026-09-01T12:00:00.000Z',
              residenceFacing: 'east',
              photoCount: 1,
              hasReport: listCalls > 1,
              reportPreview: listCalls > 1 ? '生成后的报告摘要' : undefined,
            },
          ],
        })
      }
      if (url.includes('/api/v1/charts/current')) return Response.json({ profile: null })
      if (url.includes('/api/v1/bazi-rule-profile-versions/active')) return Response.json({ versions: [] })
      return Response.json({})
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => root.render(createElement(App)))
    await flushEffects()
    await flushEffects()

    expect(container.textContent).toContain('这份报告正在生成报告，页面会自动刷新。')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REPORT_HISTORY_REFRESH_MS)
    })
    await flushEffects()
    await flushEffects()

    expect(listCalls).toBeGreaterThanOrEqual(2)
    expect(detailCalls).toBeGreaterThanOrEqual(2)
    expect(container.textContent).toContain('生成后的报告摘要')
    expect(container.textContent).toContain('生成后的报告正文')
    expect(container.textContent).not.toContain('这份报告正在生成报告')
    cleanup(root, container)
  })

  it('updates the selected report detail when refreshed history marks the same report completed', async () => {
    window.history.replaceState({}, '', '/reports')
    let listCalls = 0
    let detailCalls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/v1/reports/report-refresh')) {
        detailCalls += 1
        return Response.json({
          id: 'report-refresh',
          status: detailCalls === 1 ? 'queued' : 'completed',
          phase: detailCalls === 1 ? 'harness-generating' : 'completed',
          createdAt: '2026-09-01T12:00:00.000Z',
          submission: { visionConsent: true, residence: { facing: 'west' }, photos: [] },
          bazi: { pillars: ['壬申', '戊申', '丙寅', '癸巳'] },
          citations: [],
          evaluatedRules: [],
          vision: [],
          generationProvenance: { validatorVersion: CURRENT_REPORT_VALIDATOR_VERSION },
          report: detailCalls === 1 ? undefined : '## 摘要\n\n刷新后完成的报告正文',
        })
      }
      if (url.endsWith('/api/v1/reports')) {
        listCalls += 1
        return Response.json({
          reports: [
            {
              id: 'report-refresh',
              status: listCalls === 1 ? 'queued' : 'completed',
              phase: listCalls === 1 ? 'harness-generating' : 'completed',
              createdAt: '2026-09-01T12:00:00.000Z',
              residenceFacing: 'west',
              photoCount: 2,
              hasReport: listCalls > 1,
              reportPreview: listCalls > 1 ? '刷新后完成的报告摘要' : undefined,
            },
          ],
        })
      }
      if (url.includes('/api/v1/charts/current')) return Response.json({ profile: null })
      if (url.includes('/api/v1/bazi-rule-profile-versions/active')) return Response.json({ versions: [] })
      return Response.json({})
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => root.render(createElement(App)))
    await flushEffects()
    await flushEffects()

    expect(container.textContent).toContain('这份报告正在生成报告，页面会自动刷新。')
    container.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      if (button.textContent === '刷新') act(() => button.click())
    })
    await flushEffects()
    await flushEffects()

    expect(listCalls).toBe(2)
    expect(detailCalls).toBe(2)
    expect(container.textContent).toContain('刷新后完成的报告摘要')
    expect(container.textContent).toContain('刷新后完成的报告正文')
    expect(container.textContent).not.toContain('这份报告正在生成报告')
    cleanup(root, container)
  })

  it('renders report history summaries without markdown control markers', async () => {
    window.history.replaceState({}, '', '/reports')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/v1/reports/report-markdown-preview')) return Response.json({
        id: 'report-markdown-preview',
        status: 'completed',
        phase: 'completed',
        createdAt: '2026-09-01T12:00:00.000Z',
        submission: { visionConsent: true, residence: { facing: 'south' }, photos: [] },
        bazi: { pillars: ['壬申', '戊申', '丙寅', '癸巳'] },
        citations: [],
        evaluatedRules: [],
        vision: [],
        generationProvenance: { validatorVersion: CURRENT_REPORT_VALIDATOR_VERSION },
        report: '## 摘要\n\n正文',
      })
      if (url.includes('/api/v1/reports')) return Response.json({
        reports: [
          {
            id: 'report-markdown-preview',
            status: 'completed',
            phase: 'completed',
            createdAt: '2026-09-01T12:00:00.000Z',
            residenceFacing: 'south',
            photoCount: 1,
            hasReport: true,
            reportPreview: '## 摘要 **旺气** ```json {"debug":true} ```',
          },
        ],
      })
      if (url.includes('/api/v1/charts/current')) return Response.json({ profile: null })
      if (url.includes('/api/v1/bazi-rule-profile-versions/active')) return Response.json({ versions: [] })
      return Response.json({})
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => root.render(createElement(App)))
    await flushEffects()
    await flushEffects()

    const preview = container.querySelector('.report-list-item em')
    expect(preview?.textContent).toBe('摘要 旺气 {"debug":true}')
    expect(preview?.textContent).not.toContain('##')
    expect(preview?.textContent).not.toContain('**')
    expect(preview?.textContent).not.toContain('```')
    cleanup(root, container)
  })

  it('does not render stale report history bodies that predate the current validator', async () => {
    window.history.replaceState({}, '', '/reports')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/v1/reports/report-stale')) return Response.json({
        id: 'report-stale',
        status: 'completed',
        phase: 'completed',
        createdAt: '2026-09-01T12:00:00.000Z',
        submission: { visionConsent: true, residence: { facing: 'south' }, photos: [] },
        bazi: { pillars: ['壬申', '戊申', '丙寅', '癸巳'] },
        generationProvenance: { validatorVersion: 'generated-report-validator-v2-human-readable' },
        report: '```js\nconsole.log("internal")\n```',
      })
      if (url.includes('/api/v1/reports')) return Response.json({
        reports: [
          { id: 'report-stale', status: 'completed', phase: 'completed', createdAt: '2026-09-01T12:00:00.000Z', residenceFacing: 'south', photoCount: 1, hasReport: true, reportPreview: '旧报告预览' },
        ],
      })
      if (url.includes('/api/v1/charts/current')) return Response.json({ profile: null })
      if (url.includes('/api/v1/bazi-rule-profile-versions/active')) return Response.json({ versions: [] })
      return Response.json({})
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => root.render(createElement(App)))
    await flushEffects()
    await flushEffects()

    expect(container.textContent).toContain('这份旧报告需要重新生成')
    expect(container.textContent).not.toContain('console.log')
    cleanup(root, container)
  })
})
