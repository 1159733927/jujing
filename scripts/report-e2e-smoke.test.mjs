import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertHumanReadableReport, buildReportShareUrl, CURRENT_REPORT_VALIDATOR_VERSION, isMainModule, ReportE2eSmokeError, runReportE2eSmoke } from './report-e2e-smoke.mjs'

function response(body, status = 200, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })
}

const CONCLUSION = '结论先说：这套房和你的命盘局部合拍，但卫生间的位置带来一处需要处理的冲突。'
const REPORT_BODY = `${CONCLUSION} 你的命盘当前更需要稳定的土性支持；户型整体朝南，南侧厨房能提供一定助力，但卫生间靠近房屋中心，会削弱中央区域的稳定感。

## 值得保留的地方

住宅整体朝南，厨房也位于南侧，这与命盘需要稳定土性支持的方向有呼应。保留南侧厨房作为主要烹饪区，避免把高频用火区改到北侧，以延续当前方位优势。

## 可以先这样做

1. 南侧厨房继续作为主要烹饪区使用，避免把高频用火区改到北侧，这样能延续当前方位优势。
2. 中央卫生间门口使用封闭收纳，并减少长期敞门，以缓解中心区域的杂乱与潮气。
3. 客厅靠南侧的位置尽量保持通透，不用高柜挡住主要活动面，用来放大朝南格局的加分。

以上是传统文化角度的居住参考，不代表确定吉凶，也不替代建筑、消防或健康方面的专业意见。`

const OPEN_FORMAT_MIXED_REPORT_BODY = REPORT_BODY.replace(
  CONCLUSION,
  '结论先说：这套房和你的命盘大体合拍、带一处明显短板。',
)

function completedReport(id = 'report-1', chartProfileId = 'chart-profile-1', chartVersionId = 'chart-version-1', residenceProfileId = 'residence-profile-1', residenceVersionId = 'residence-version-1') {
  return {
    id,
    status: 'completed',
    phase: 'completed',
    qualityStatus: 'passed',
    report: REPORT_BODY,
    chartProfileId,
    chartVersionId,
    residenceProfileId,
    residenceVersionId,
    vision: [{ room: 'living-room', summary: '客厅有自然采光' }],
    citations: [{ title: '测试资料' }],
    evaluatedRules: [{ title: '南向住宅基础观察提示' }],
    compatibility: {
      assessable: true,
      overallLevel: 'supportive',
      positiveMatches: [{
        conclusion: CONCLUSION,
        chartEvidence: '程序结果显示需要稳定土性',
        residenceEvidence: '住宅整体朝南',
        ruleTitle: '测试资料',
        ruleVersion: 1,
        sourceLabel: '专家资料',
        actions: [{
          kind: 'amplify',
          location: '南侧厨房',
          action: '保留南侧厨房作为主要烹饪区，避免把高频用火区改到北侧。',
          intendedEffect: '延续当前方位优势。',
          verification: '确认厨房仍作为主要烹饪区使用。',
          safety: 'reversible-low-risk',
        }],
      }],
      conflicts: [],
    },
    qualityReviews: [{ schemaVersion: 'report-quality-review-v1', verdict: 'pass', score: 90, issues: [], reviewedAt: '2026-09-03T00:00:00.000Z', attempt: 0 }],
    revisionCount: 0,
    generationProvenance: { validatorVersion: CURRENT_REPORT_VALIDATOR_VERSION, validatorResult: 'pass' },
  }
}

describe('report e2e smoke verifier', () => {
  it('recognizes its CLI entrypoint', () => {
    assert.equal(isMainModule(new URL('./report-e2e-smoke.mjs', import.meta.url).href, 'scripts/report-e2e-smoke.mjs'), true)
    assert.equal(isMainModule(new URL('./report-e2e-smoke.mjs', import.meta.url).href, 'scripts/not-report-e2e-smoke.mjs'), false)
  })

  it('skips unless the expensive model smoke is explicitly enabled', async () => {
    const logs = []
    const result = await runReportE2eSmoke({
      env: { PATH: '/bin' },
      fetchFn: async () => { throw new Error('fetch should not run') },
      log: (message) => logs.push(message),
    })

    assert.deepEqual(result, { skipped: true })
    assert.equal(logs.some((line) => line.includes('RUN_REPORT_E2E=1')), true)
  })

  it('uploads, creates, polls and validates a completed human-readable report', async () => {
    const calls = []
    const fetchFn = async (url, options = {}) => {
      calls.push({ url: String(url), options })
      const value = String(url)
      if (value.endsWith('/ready/report')) return response({ status: 'ready' })
      if (value.endsWith('/v1/bazi-rule-profile-versions/active')) return response([{ key: 'demo-traditional-solar-time', versionId: 'demo-profile-v2' }])
      if (value.endsWith('/v1/media')) return response({ fileId: 'demo-image.png' }, 201, { 'set-cookie': 'fengshui_principal=test; Path=/' })
      if (value.endsWith('/v1/reports')) return response({ id: 'report-1', status: 'queued', phase: 'queued', chartProfileId: 'chart-profile-1', chartVersionId: 'chart-version-1', residenceProfileId: 'residence-profile-1', residenceVersionId: 'residence-version-1' }, 202, { 'set-cookie': 'fengshui_principal=test; Path=/' })
      if (value.endsWith('/v1/reports/report-1')) return response(completedReport())
      if (value.endsWith('/v1/reports/report-1/share')) return response({ token: 'share token/with symbols?', expiresAt: '2026-09-04T00:00:00.000Z' })
      if (value.endsWith('/v1/shared-reports/report-1')) return response(completedReport())
      return response({ error: 'unexpected' }, 500)
    }

    const result = await runReportE2eSmoke({
      env: { PATH: '/bin', RUN_REPORT_E2E: '1', REPORT_E2E_POLL_ATTEMPTS: '1', REPORT_E2E_POLL_INTERVAL_MS: '1', REPORT_E2E_WEB_ORIGIN: 'http://127.0.0.1:4173/' },
      fetchFn,
      sleep: async () => {},
      log: () => {},
    })

    assert.equal(result.skipped, false)
    assert.equal(result.shareExpiresAt, '2026-09-04T00:00:00.000Z')
    assert.equal(result.shareUrl, 'http://127.0.0.1:4173/shared-report/report-1#access=share%20token%2Fwith%20symbols%3F')
    const uploaded = calls.find((call) => call.url.endsWith('/v1/media')).options.body.get('image')
    assert.equal(uploaded.name, '8029.jpg')
    assert.equal(uploaded.type, 'image/jpeg')
    assert.equal(uploaded.size, 67_435)
    const created = calls.find((call) => call.url.endsWith('/v1/reports'))
    const createdBody = JSON.parse(created.options.body)
    assert.equal(createdBody.birth.placeCode, '330106')
    assert.equal(createdBody.ruleProfileVersionId, 'demo-profile-v2')
    assert.deepEqual(createdBody.residence, {
      facing: 'south',
      layoutNote: '8029 单套户型图：图面上北下南；入户门在东南侧；客厅在东侧；书房在北侧；餐厅在南侧偏东；厨房在南侧凸出；卫生间靠近中宫。已知住宅信息确认整体朝南。',
    })
    assert.deepEqual(createdBody.floorPlan, {
      boundary: { x: 0, y: 0, width: 1000, height: 800 },
      orientation: { northUp: true, evidenceRef: '8029:plan:north-up' },
      rooms: [
        { id: 'kitchen', kind: 'kitchen', label: '厨房', center: { x: 500, y: 720 }, evidenceRef: '8029:plan:kitchen-center' },
        { id: 'bathroom', kind: 'bathroom', label: '卫生间', center: { x: 520, y: 420 }, evidenceRef: '8029:plan:bathroom-center' },
      ],
    })
    assert.deepEqual(createdBody.photos, [{
      fileId: 'demo-image.png',
      room: 'overview',
      facing: 'unknown',
      note: '全屋户型图，图面上北下南；这是 8029 这一套住宅的平面证据，不是客厅实拍，不能推断南侧阳台或自然采光。',
    }])
    assert.equal(createdBody.photos[0].room === 'living-room', false)
    const polled = calls.find((call) => call.url.endsWith('/v1/reports/report-1'))
    assert.equal(new Headers(polled.options.headers).get('cookie'), 'fengshui_principal=test')
    const shared = calls.find((call) => call.url.endsWith('/v1/reports/report-1/share'))
    assert.equal(shared.options.method, 'POST')
    assert.equal(new Headers(shared.options.headers).get('cookie'), 'fengshui_principal=test')
    const sharedRead = calls.find((call) => call.url.endsWith('/v1/shared-reports/report-1'))
    assert.equal(new Headers(sharedRead.options.headers).get('x-report-share-token'), 'share token/with symbols?')
  })

  it('accepts a natural mixed conclusion expressed as a generally compatible home with a shortcoming', () => {
    const report = completedReport()
    report.report = OPEN_FORMAT_MIXED_REPORT_BODY
    report.compatibility.overallLevel = 'mixed'
    report.compatibility.conflicts = [{
      conclusion: '卫生间靠近房屋中心，是需要处理的短板。',
      chartEvidence: '程序结果显示需要稳定土性',
      residenceEvidence: '卫生间靠近房屋中心',
      ruleTitle: '测试资料',
      ruleVersion: 1,
      sourceLabel: '专家资料',
      actions: [{
        kind: 'mitigate',
        location: '中央卫生间门口',
        action: '使用封闭收纳，并减少长期敞门。',
        intendedEffect: '缓解中心区域的杂乱与潮气。',
        verification: '连续观察两周确认门口无堆物、地面不潮。',
        safety: 'reversible-low-risk',
      }],
    }]

    assert.doesNotThrow(() => assertHumanReadableReport(report, {
      chartProfileId: report.chartProfileId,
      chartVersionId: report.chartVersionId,
      residenceProfileId: report.residenceProfileId,
      residenceVersionId: report.residenceVersionId,
    }))
  })

  it('rejects reports that do not start with a direct consumer conclusion', () => {
    const report = completedReport()
    report.report = `# 这套房适不适合你\n\n${report.report}`

    assert.throws(
      () => assertHumanReadableReport(report),
      /completed report does not open with a direct consumer conclusion/u,
    )
  })

  it('rejects reports that expose back-office source or pending checklist sections', () => {
    const report = completedReport()
    report.report = `${report.report}\n\n## 依据与版本\n测试资料 v1。`

    assert.throws(
      () => assertHumanReadableReport(report),
      /completed report exposes a back-office source or pending checklist section/u,
    )
  })

  it('rejects reports without at least two concrete consumer actions', () => {
    const report = completedReport()
    report.report = `${CONCLUSION} 你的命盘当前更需要稳定的土性支持；户型整体朝南，南侧厨房能提供一定助力，但卫生间靠近房屋中心，会削弱中央区域的稳定感。\n\n## 值得保留的地方\n\n住宅整体朝南，厨房也位于南侧，这与命盘需要稳定土性支持的方向有呼应。\n\n## 可以先这样做\n\n南侧厨房继续作为主要烹饪区使用，避免把高频用火区改到北侧，这样能延续当前方位优势。\n\n以上是传统文化角度的居住参考，不代表确定吉凶，也不替代建筑、消防或健康方面的专业意见。`

    assert.throws(
      () => assertHumanReadableReport(report),
      /completed report does not give at least two concrete consumer actions/u,
    )
  })

  it('accepts natural purpose wording in consumer actions without requiring rigid keywords', () => {
    const report = completedReport()
    report.compatibility.positiveMatches[0].chartEvidence = '命盘当前更需要稳定的土性支持'
    report.report = `${CONCLUSION} 你的命盘当前更需要稳定的土性支持；户型整体朝南，南侧厨房能提供一定助力，但卫生间靠近房屋中心，会削弱中央区域的稳定感。

## 可以先这样做

- 南侧厨房与南面窗区：保持明亮、干净、通风顺畅，不用高大家具或杂物压住主要采光面；目的：让南向明亮动能立得住，又不致燥乱。
- 靠中宫的卫生间：门常关、地面保持干爽、排风顺畅，门口和过道不堆杂物；目的：把中心区域的湿气与杂乱感降到最低。

以上是传统文化角度的居住参考，不代表确定吉凶，也不替代建筑、消防或健康方面的专业意见。`

    assert.doesNotThrow(() => assertHumanReadableReport(report, {
      chartProfileId: report.chartProfileId,
      chartVersionId: report.chartVersionId,
      residenceProfileId: report.residenceProfileId,
      residenceVersionId: report.residenceVersionId,
    }))
  })

  it('accepts a bold consumer action title emitted by a model', () => {
    const report = completedReport()
    report.compatibility.positiveMatches[0].chartEvidence = '命盘当前更需要稳定的土性支持'
    report.report = `${CONCLUSION} 你的命盘当前更需要稳定的土性支持；户型整体朝南，南侧厨房能提供一定助力，但卫生间靠近房屋中心，会削弱中央区域的稳定感。

**可以先这样做**

- 南侧厨房与南面窗区：保持明亮、干净、通风顺畅，不用高大家具或杂物压住主要采光面；目的：让南向明亮动能立得住，又不致燥乱。
- 靠中宫的卫生间：门常关、地面保持干爽、排风顺畅，门口和过道不堆杂物；目的：把中心区域的湿气与杂乱感降到最低。

以上是传统文化角度的居住参考，不代表确定吉凶，也不替代建筑、消防或健康方面的专业意见。`

    assert.doesNotThrow(() => assertHumanReadableReport(report, {
      chartProfileId: report.chartProfileId,
      chartVersionId: report.chartVersionId,
      residenceProfileId: report.residenceProfileId,
      residenceVersionId: report.residenceVersionId,
    }))
  })

  it('rejects reports that leak internal analysis terminology', () => {
    const report = completedReport()
    report.report = REPORT_BODY.replace('南侧厨房能提供一定助力', '命盘扶抑基线的候选补益方向与南侧厨房能提供一定助力')

    assert.throws(
      () => assertHumanReadableReport(report),
      /completed report contains internal analysis terminology/u,
    )
  })

  it('rejects reports that repeat the consumer action section', () => {
    const report = completedReport()
    report.report = `${REPORT_BODY}

## 可以先这样做

- 南侧采光面继续保持通透，这样是为了放大朝南格局的加分。`

    assert.throws(
      () => assertHumanReadableReport(report),
      /completed report repeats its consumer action section/u,
    )
  })

  it('rejects reports that invent a south balcony from a south-kitchen floor plan', () => {
    const report = completedReport()
    report.report = REPORT_BODY.replace('南侧厨房能提供一定助力', '南侧厨房和阳台能提供一定助力')
    report.submission = {
      residence: { facing: 'south', layoutNote: '户型图上北下南；厨房在南侧；阳台方位未确认。' },
      photos: [{ room: 'overview', facing: 'unknown', note: '全屋户型图，不能推断南侧阳台。' }],
    }
    report.vision = [{
      room: 'overview',
      summary: '户型图显示厨房在南侧',
      observedElements: ['厨房位于户型南侧'],
      facts: [{ code: 'kitchen.south', confidence: 0.9, evidence: '厨房位于户型南侧' }],
    }]

    assert.throws(
      () => assertHumanReadableReport(report),
      /completed report claims a south balcony without supporting residence or vision evidence/u,
    )
  })

  it('does not mistake an explicit warning against structural work for a recommendation', () => {
    const report = completedReport()
    report.report = `${report.report}\n以上调整不拆墙、不改门窗、不动水电气，也不涉及拆墙、改水电气或搬家。`

    assert.doesNotThrow(() => assertHumanReadableReport(report, {
      chartProfileId: report.chartProfileId,
      chartVersionId: report.chartVersionId,
      residenceProfileId: report.residenceProfileId,
      residenceVersionId: report.residenceVersionId,
    }))
  })

  it('builds the local shared report URL without exposing a bare token separately', () => {
    assert.equal(
      buildReportShareUrl({ webOrigin: 'http://127.0.0.1:4173/', reportId: 'report-1', token: 'token/value?' }),
      'http://127.0.0.1:4173/shared-report/report-1#access=token%2Fvalue%3F',
    )
  })

  it('fails when a completed report cannot be shared', async () => {
    const fetchFn = async (url) => {
      const value = String(url)
      if (value.endsWith('/ready/report')) return response({ status: 'ready' })
      if (value.endsWith('/v1/bazi-rule-profile-versions/active')) return response([{ key: 'demo-traditional-solar-time', versionId: 'demo-profile-v2' }])
      if (value.endsWith('/v1/media')) return response({ fileId: 'demo-image.png' }, 201, { 'set-cookie': 'fengshui_principal=test; Path=/' })
      if (value.endsWith('/v1/reports')) return response({ id: 'unshareable-report', status: 'queued', phase: 'queued', chartProfileId: 'chart-profile-1', chartVersionId: 'chart-version-1', residenceProfileId: 'residence-profile-1', residenceVersionId: 'residence-version-1' }, 202)
      if (value.endsWith('/v1/reports/unshareable-report')) return response(completedReport('unshareable-report'))
      if (value.endsWith('/v1/reports/unshareable-report/share')) return response({ error: 'share failed' }, 500)
      return response({ error: 'unexpected' }, 500)
    }

    await assert.rejects(
      () => runReportE2eSmoke({
        env: { PATH: '/bin', RUN_REPORT_E2E: '1', REPORT_E2E_POLL_ATTEMPTS: '1', REPORT_E2E_POLL_INTERVAL_MS: '1' },
        fetchFn,
        sleep: async () => {},
        log: () => {},
      }),
      /report share failed with HTTP 500/u,
    )
  })

  it('keeps polling while a completed report quality review is still pending or running', async () => {
    let polls = 0
    const fetchFn = async (url) => {
      const value = String(url)
      if (value.endsWith('/ready/report')) return response({ status: 'ready' })
      if (value.endsWith('/v1/bazi-rule-profile-versions/active')) return response([{ key: 'demo-traditional-solar-time', versionId: 'demo-profile-v2' }])
      if (value.endsWith('/v1/media')) return response({ fileId: 'demo-image.png' }, 201, { 'set-cookie': 'fengshui_principal=test; Path=/' })
      if (value.endsWith('/v1/reports')) return response({ id: 'async-quality-report', status: 'queued', phase: 'queued', chartProfileId: 'chart-profile-1', chartVersionId: 'chart-version-1', residenceProfileId: 'residence-profile-1', residenceVersionId: 'residence-version-1' }, 202, { 'set-cookie': 'fengshui_principal=test; Path=/' })
      if (value.endsWith('/v1/reports/async-quality-report')) {
        polls += 1
        if (polls === 1) return response({ ...completedReport('async-quality-report'), qualityStatus: 'pending' })
        if (polls === 2) return response({ ...completedReport('async-quality-report'), phase: 'quality-reviewing', qualityStatus: 'running' })
        return response(completedReport('async-quality-report'))
      }
      if (value.endsWith('/v1/reports/async-quality-report/share')) return response({ token: 'async-quality-share-token', expiresAt: '2026-09-04T00:00:00.000Z' })
      if (value.endsWith('/v1/shared-reports/async-quality-report')) return response(completedReport('async-quality-report'))
      return response({ error: 'unexpected' }, 500)
    }

    const result = await runReportE2eSmoke({
      env: { PATH: '/bin', RUN_REPORT_E2E: '1', REPORT_E2E_POLL_ATTEMPTS: '3', REPORT_E2E_POLL_INTERVAL_MS: '1' },
      fetchFn,
      sleep: async () => {},
      log: () => {},
    })

    assert.equal(result.skipped, false)
    assert.equal(polls, 3)
  })

  it('fails clearly when a completed report quality review fails', async () => {
    const fetchFn = async (url) => {
      const value = String(url)
      if (value.endsWith('/ready/report')) return response({ status: 'ready' })
      if (value.endsWith('/v1/bazi-rule-profile-versions/active')) return response([{ key: 'demo-traditional-solar-time', versionId: 'demo-profile-v2' }])
      if (value.endsWith('/v1/media')) return response({ fileId: 'demo-image.png' }, 201, { 'set-cookie': 'fengshui_principal=test; Path=/' })
      if (value.endsWith('/v1/reports')) return response({ id: 'quality-failed-report', status: 'queued', phase: 'queued', chartProfileId: 'chart-profile-1', chartVersionId: 'chart-version-1', residenceProfileId: 'residence-profile-1', residenceVersionId: 'residence-version-1' }, 202, { 'set-cookie': 'fengshui_principal=test; Path=/' })
      if (value.endsWith('/v1/reports/quality-failed-report')) {
        return response({ ...completedReport('quality-failed-report'), qualityStatus: 'failed', qualityError: '报告后台质检未完成' })
      }
      if (value.endsWith('/v1/reports/quality-failed-report/share')) return response({ token: 'should-not-share', expiresAt: '2026-09-04T00:00:00.000Z' })
      return response({ error: 'unexpected' }, 500)
    }

    await assert.rejects(
      () => runReportE2eSmoke({
        env: { PATH: '/bin', RUN_REPORT_E2E: '1', REPORT_E2E_POLL_ATTEMPTS: '1', REPORT_E2E_POLL_INTERVAL_MS: '1' },
        fetchFn,
        sleep: async () => {},
        log: () => {},
      }),
      /completed but quality review failed: 报告后台质检未完成/u,
    )
  })

  it('fails clearly when the report itself fails', async () => {
    const fetchFn = async (url) => {
      const value = String(url)
      if (value.endsWith('/ready/report')) return response({ status: 'ready' })
      if (value.endsWith('/v1/bazi-rule-profile-versions/active')) return response([{ key: 'demo-traditional-solar-time', versionId: 'demo-profile-v2' }])
      if (value.endsWith('/v1/media')) return response({ fileId: 'demo-image.png' }, 201, { 'set-cookie': 'fengshui_principal=test; Path=/' })
      if (value.endsWith('/v1/reports')) return response({ id: 'failed-report', status: 'queued', phase: 'queued', chartProfileId: 'chart-profile-1', chartVersionId: 'chart-version-1', residenceProfileId: 'residence-profile-1', residenceVersionId: 'residence-version-1' }, 202, { 'set-cookie': 'fengshui_principal=test; Path=/' })
      if (value.endsWith('/v1/reports/failed-report')) return response({ id: 'failed-report', status: 'failed', phase: 'failed', error: 'Harness generation failed' })
      return response({ error: 'unexpected' }, 500)
    }

    await assert.rejects(
      () => runReportE2eSmoke({
        env: { PATH: '/bin', RUN_REPORT_E2E: '1', REPORT_E2E_POLL_ATTEMPTS: '1', REPORT_E2E_POLL_INTERVAL_MS: '1' },
        fetchFn,
        sleep: async () => {},
        log: () => {},
      }),
      /report failed-report failed: Harness generation failed/u,
    )
  })

  it('fails closed before model spend when report readiness is unavailable', async () => {
    await assert.rejects(
      () => runReportE2eSmoke({
        env: { PATH: '/bin', RUN_REPORT_E2E: '1' },
        fetchFn: async () => response({ status: 'not-ready' }, 503),
        sleep: async () => {},
        log: () => {},
      }),
      /readiness is not ready/,
    )
  })

  it('explains that a queued Harness report may still finish after the smoke wait window', async () => {
    const fetchFn = async (url) => {
      const value = String(url)
      if (value.endsWith('/ready/report')) return response({ status: 'ready' })
      if (value.endsWith('/v1/bazi-rule-profile-versions/active')) return response([{ key: 'demo-traditional-solar-time', versionId: 'demo-profile-v2' }])
      if (value.endsWith('/v1/media')) return response({ fileId: 'demo-image.png' }, 201, { 'set-cookie': 'fengshui_principal=test; Path=/' })
      if (value.endsWith('/v1/reports')) return response({ id: 'slow-report', status: 'queued', phase: 'queued', chartProfileId: 'chart-profile-1', chartVersionId: 'chart-version-1', residenceProfileId: 'residence-profile-1', residenceVersionId: 'residence-version-1' }, 202, { 'set-cookie': 'fengshui_principal=test; Path=/' })
      if (value.endsWith('/v1/reports/slow-report')) return response({ id: 'slow-report', status: 'queued', phase: 'harness-generating' })
      return response({ error: 'unexpected' }, 500)
    }

    await assert.rejects(
      () => runReportE2eSmoke({
        env: { PATH: '/bin', RUN_REPORT_E2E: '1', REPORT_E2E_POLL_ATTEMPTS: '2', REPORT_E2E_POLL_INTERVAL_MS: '1000' },
        fetchFn,
        sleep: async () => {},
        log: () => {},
      }),
      /REPORT_E2E_POLL_ATTEMPTS limited polling to 2 attempts/u,
    )
  })

  it('uses a 900s deadline by default so a report can exceed the old 360s attempts window', async () => {
    let time = 0
    let polls = 0
    const fetchFn = async (url) => {
      const value = String(url)
      if (value.endsWith('/ready/report')) return response({ status: 'ready' })
      if (value.endsWith('/v1/bazi-rule-profile-versions/active')) return response([{ key: 'demo-traditional-solar-time', versionId: 'demo-profile-v2' }])
      if (value.endsWith('/v1/media')) return response({ fileId: 'demo-image.png' }, 201, { 'set-cookie': 'fengshui_principal=test; Path=/' })
      if (value.endsWith('/v1/reports')) return response({ id: 'slow-but-valid-report', status: 'queued', phase: 'queued', chartProfileId: 'chart-profile-1', chartVersionId: 'chart-version-1', residenceProfileId: 'residence-profile-1', residenceVersionId: 'residence-version-1' }, 202, { 'set-cookie': 'fengshui_principal=test; Path=/' })
      if (value.endsWith('/v1/reports/slow-but-valid-report')) {
        polls += 1
        if (polls <= 72) return response({ id: 'slow-but-valid-report', status: 'queued', phase: 'harness-generating' })
        return response(completedReport('slow-but-valid-report'))
      }
      if (value.endsWith('/v1/reports/slow-but-valid-report/share')) return response({ token: 'slow-share-token', expiresAt: '2026-09-04T00:00:00.000Z' })
      if (value.endsWith('/v1/shared-reports/slow-but-valid-report')) return response(completedReport('slow-but-valid-report'))
      return response({ error: 'unexpected' }, 500)
    }

    const result = await runReportE2eSmoke({
      env: { PATH: '/bin', RUN_REPORT_E2E: '1' },
      fetchFn,
      sleep: async (ms) => { time += ms },
      now: () => time,
      log: () => {},
    })

    assert.equal(result.skipped, false)
    assert.equal(polls, 73)
    assert.equal(time, 365_000)
  })

  it('fails with the last phase and elapsed seconds when the deadline expires', async () => {
    let time = 0
    const fetchFn = async (url) => {
      const value = String(url)
      if (value.endsWith('/ready/report')) return response({ status: 'ready' })
      if (value.endsWith('/v1/bazi-rule-profile-versions/active')) return response([{ key: 'demo-traditional-solar-time', versionId: 'demo-profile-v2' }])
      if (value.endsWith('/v1/media')) return response({ fileId: 'demo-image.png' }, 201, { 'set-cookie': 'fengshui_principal=test; Path=/' })
      if (value.endsWith('/v1/reports')) return response({ id: 'deadline-report', status: 'queued', phase: 'queued', chartProfileId: 'chart-profile-1', chartVersionId: 'chart-version-1', residenceProfileId: 'residence-profile-1', residenceVersionId: 'residence-version-1' }, 202, { 'set-cookie': 'fengshui_principal=test; Path=/' })
      if (value.endsWith('/v1/reports/deadline-report')) return response({ id: 'deadline-report', status: 'queued', phase: 'independent-review' })
      return response({ error: 'unexpected' }, 500)
    }

    await assert.rejects(
      () => runReportE2eSmoke({
        env: { PATH: '/bin', RUN_REPORT_E2E: '1', REPORT_E2E_TIMEOUT_MS: '2500', REPORT_E2E_POLL_INTERVAL_MS: '1000' },
        fetchFn,
        sleep: async (ms) => { time += ms },
        now: () => time,
        log: () => {},
      }),
      /still queued\/independent-review quality=- after 3s.*increase REPORT_E2E_TIMEOUT_MS/u,
    )
  })

  it('rejects code-like or non-prose completed reports', () => {
    const base = completedReport()
    const expectedBindings = {
      chartProfileId: base.chartProfileId,
      chartVersionId: base.chartVersionId,
      residenceProfileId: base.residenceProfileId,
      residenceVersionId: base.residenceVersionId,
    }

    assert.doesNotThrow(() => assertHumanReadableReport(base, expectedBindings))
    assert.throws(() => assertHumanReadableReport({ ...base, report: '```json\n{}\n```' }, expectedBindings), ReportE2eSmokeError)
    assert.throws(() => assertHumanReadableReport({ ...base, report: `以下是为您出具的人宅合拍静态报告。\n\n${base.report}` }, expectedBindings), /generic AI-style preface/u)
    assert.throws(() => assertHumanReadableReport({ ...base, report: `${base.report}\nconst payload = { unsafe: true }` }, expectedBindings), ReportE2eSmokeError)
    assert.throws(() => assertHumanReadableReport({ ...base, report: `${base.report}\n程序给出的结构化判断来自视觉分析。` }, expectedBindings), /consumer-facing process language/u)
    assert.throws(() => assertHumanReadableReport({ ...base, report: '{"report":"raw"}' }, expectedBindings), ReportE2eSmokeError)
    assert.throws(() => assertHumanReadableReport({ ...base, report: `${base.report}\n<section>debug</section>` }, expectedBindings), ReportE2eSmokeError)
    assert.throws(() => assertHumanReadableReport({ ...base, report: `${base.report}\n| 字段 | 内容 |` }, expectedBindings), ReportE2eSmokeError)
    assert.throws(() => assertHumanReadableReport({ ...base, generationProvenance: { validatorVersion: 'old' } }, expectedBindings), ReportE2eSmokeError)
    assert.throws(() => assertHumanReadableReport({ ...base, qualityStatus: 'failed' }, expectedBindings), /quality review did not pass/u)
    assert.throws(() => assertHumanReadableReport({ ...base, qualityStatus: 'running' }, expectedBindings), /quality review did not pass/u)
    assert.throws(() => assertHumanReadableReport({ ...base, compatibility: undefined }, expectedBindings), ReportE2eSmokeError)
    assert.throws(() => assertHumanReadableReport({ ...base, compatibility: { assessable: true, positiveMatches: [], conflicts: [] } }, expectedBindings), /no concrete compatibility points/u)
    assert.throws(() => assertHumanReadableReport({ ...base, citations: [] }, expectedBindings), ReportE2eSmokeError)
    assert.throws(() => assertHumanReadableReport({ ...base, evaluatedRules: [] }, expectedBindings), ReportE2eSmokeError)
    assert.throws(() => assertHumanReadableReport({ ...base, qualityReviews: [] }, expectedBindings), ReportE2eSmokeError)
    assert.throws(() => assertHumanReadableReport({ ...base, qualityReviews: [{ verdict: 'revise' }] }, expectedBindings), ReportE2eSmokeError)
    assert.throws(() => assertHumanReadableReport({ ...base, qualityReviews: [{ ...base.qualityReviews[0], score: 79 }] }, expectedBindings), /below 80/u)
    assert.throws(() => assertHumanReadableReport({ ...base, qualityReviews: [{ ...base.qualityReviews[0], attempt: 1 }] }, expectedBindings), ReportE2eSmokeError)
    assert.throws(() => assertHumanReadableReport({ ...base, chartVersionId: 'stale-version' }, expectedBindings), ReportE2eSmokeError)
    assert.throws(() => assertHumanReadableReport({ ...base, residenceVersionId: 'stale-version' }, expectedBindings), ReportE2eSmokeError)
  })

  it('rejects reports without a useful conclusion, evidence and a rendered action', () => {
    const base = completedReport()
    const expectedBindings = {
      chartProfileId: base.chartProfileId,
      chartVersionId: base.chartVersionId,
      residenceProfileId: base.residenceProfileId,
      residenceVersionId: base.residenceVersionId,
    }
    assert.throws(
      () => assertHumanReadableReport({ ...base, report: base.report.replace(CONCLUSION, '结论先说：这里汇总了本次分析结果，请结合实际情况理解。') }, expectedBindings),
      /clear overall/u,
    )
    assert.throws(
      () => assertHumanReadableReport({ ...base, report: base.report.replaceAll('稳定的土性', '相关力量').replaceAll('稳定土性', '相关力量') }, expectedBindings),
      /concrete chart fact/u,
    )
    assert.throws(
      () => assertHumanReadableReport({ ...base, report: base.report.replaceAll('住宅整体朝南', '住宅情况已记录').replaceAll('户型整体朝南', '户型情况已记录').replaceAll('南侧厨房', '对应区域') }, expectedBindings),
      /concrete residence fact/u,
    )
    assert.throws(
      () => assertHumanReadableReport({
        ...base,
        report: `${CONCLUSION} 你的命盘当前更需要稳定的土性支持；户型整体朝南，南侧厨房能提供一定助力，但卫生间靠近房屋中心，会削弱中央区域的稳定感。\n\n## 值得保留的地方\n\n住宅整体朝南，厨房也位于南侧，这与命盘需要稳定土性支持的方向有呼应。\n\n## 可以先这样做\n\n1. 南侧厨房情况还可以，继续观察即可。\n2. 中央卫生间情况要留意，后续结合现场判断。\n\n以上是传统文化角度的居住参考，不代表确定吉凶，也不替代建筑、消防或健康方面的专业意见。`,
      }, expectedBindings),
      /specific action/u,
    )
    assert.throws(
      () => assertHumanReadableReport({ ...base, report: `${base.report}\n建议砸掉承重墙改善格局。` }, expectedBindings),
      /dangerous structural change/u,
    )
    assert.throws(
      () => assertHumanReadableReport({ ...base, report: `${base.report}\n这样一定能够马上转运。` }, expectedBindings),
      /guaranteed fengshui outcome/u,
    )
    assert.throws(
      () => assertHumanReadableReport({ ...base, compatibility: { ...base.compatibility, assessable: false, overallLevel: 'insufficient-evidence' } }, expectedBindings),
      /did not reach an assessable/u,
    )
  })

  it('rejects reports that render a conflict but omit its mitigation action', () => {
    const base = completedReport()
    const expectedBindings = {
      chartProfileId: base.chartProfileId,
      chartVersionId: base.chartVersionId,
      residenceProfileId: base.residenceProfileId,
      residenceVersionId: base.residenceVersionId,
    }
    base.compatibility.overallLevel = 'mixed'
    base.compatibility.conflicts = [{
      conclusion: '卫生间靠近房屋中心，是需要处理的短板。',
      chartEvidence: '程序结果显示需要稳定土性',
      residenceEvidence: '卫生间靠近房屋中心',
      ruleTitle: '测试资料',
      ruleVersion: 1,
      sourceLabel: '专家资料',
      actions: [{
        kind: 'mitigate',
        location: '中央卫生间门口',
        action: '使用封闭收纳，并减少长期敞门。',
        intendedEffect: '缓解中心区域的杂乱与潮气。',
        verification: '连续观察两周确认门口无堆物、地面不潮。',
        safety: 'reversible-low-risk',
      }],
    }]
    base.report = `结论先说：这套房和你的命盘大体合拍、带一处明显短板。你的命盘当前更需要稳定的土性支持；户型整体朝南，南侧厨房能提供一定助力，但卫生间靠近房屋中心，会削弱中央区域的稳定感。

住宅整体朝南，厨房也位于南侧，这与命盘需要稳定土性支持的方向有呼应。保留南侧厨房作为主要烹饪区，避免把高频用火区改到北侧，以延续当前方位优势。

卫生间靠近房屋中心，是需要处理的短板。这一点和命盘当前需要稳定土性的方向不太合拍。

## 可以先这样做

1. 南侧厨房继续作为主要烹饪区使用，避免把高频用火区改到北侧，这样能延续当前方位优势。
2. 客厅靠南侧的位置尽量保持通透，不用高柜挡住主要活动面，用来放大朝南格局的加分。

以上是传统文化角度的居住参考，不代表确定吉凶，也不替代建筑、消防或健康方面的专业意见。`

    assert.throws(
      () => assertHumanReadableReport(base, expectedBindings),
      /mitigates a core conflict/u,
    )
  })
})
