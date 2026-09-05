import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { demoSmokeTargets, runDemoSmoke } from './demo-smoke.mjs'

function response(body, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

function appHtml() {
  return '<!doctype html><div id="root"><main>住宅分析 我的命盘 我的报告</main></div><script type="module" src="/src/main.tsx"></script>'
}

function adminHtml() {
  return '<!doctype html><div id="root"><main>专家知识与规则后台</main></div><script type="module" src="/admin/src/main.tsx"></script>'
}

function createSmokeFetch({ reportReadyStatus = 200 } = {}) {
  const calls = []
  const fetchFn = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    const value = String(url)
    if (value.endsWith('/health')) return response({ status: 'ok', service: 'fengshui-api' })
    if (value.endsWith('/ready')) return response({ status: 'ready', service: 'fengshui-api' })
    if (value.endsWith('/ready/report')) return response({ status: reportReadyStatus === 200 ? 'ready' : 'not-ready' }, reportReadyStatus)
    if (value.endsWith('/v1/knowledge')) return response([{}, {}, {}])
    if (value.endsWith('/admin/')) return response(adminHtml())
    if (value.endsWith('/admin/src/main.tsx')) return response('import { createHotContext } from "/admin/@vite/client"')
    if (value.endsWith('/src/main.tsx')) return response('import { createHotContext } from "/@vite/client"')
    return response(appHtml())
  }
  return { fetchFn, calls }
}

describe('demo smoke verifier', () => {
  it('builds local demo targets from the shared port parser', () => {
    const targets = demoSmokeTargets({
      HOST: '127.0.0.2',
      PORT: '3301',
      WEB_HOST: 'localhost',
      WEB_PORT: '5173',
      ADMIN_HOST: '127.0.0.3',
      ADMIN_PORT: '5174',
    })

    assert.equal(targets.apiOrigin, 'http://127.0.0.2:3301')
    assert.equal(targets.webOrigin, 'http://localhost:5173')
    assert.equal(targets.adminOrigin, 'http://127.0.0.3:5174')
    assert.equal(targets.checks.some((check) => check.url === 'http://localhost:5173/chart'), true)
  })

  it('requires report readiness by default for investor-demo smoke', async () => {
    const { fetchFn, calls } = createSmokeFetch({ reportReadyStatus: 503 })

    await assert.rejects(
      () => runDemoSmoke({
        env: { PATH: '/bin' },
        fetchFn,
        log: () => {},
      }),
      /Report readiness returned HTTP 503/,
    )
    assert.equal(calls.some((call) => call.url.endsWith('/v1/knowledge')), false)
  })

  it('can explicitly allow report not-ready while checking app shells during development', async () => {
    const { fetchFn, calls } = createSmokeFetch({ reportReadyStatus: 503 })
    const logs = []

    const results = await runDemoSmoke({
      env: { PATH: '/bin', ALLOW_REPORT_NOT_READY: '1' },
      fetchFn,
      log: (message) => logs.push(message),
    })

    assert.equal(calls.some((call) => call.url.endsWith('/v1/knowledge')), false)
    assert.equal(results.at(-1).detail, 'skipped: ADMIN_API_TOKEN not set')
    assert.equal(logs.some((line) => line.includes('Report readiness')), true)
  })

  it('runs the admin knowledge list check when an admin token is explicit', async () => {
    const { fetchFn, calls } = createSmokeFetch()

    const results = await runDemoSmoke({
      env: { PATH: '/bin', ADMIN_API_TOKEN: 'editor-token' },
      fetchFn,
      log: () => {},
    })

    const list = calls.find((call) => call.url.endsWith('/v1/knowledge'))
    assert.equal(new Headers(list.options.headers).get('authorization'), 'Bearer editor-token')
    assert.equal(results.some((result) => result.name === 'Knowledge admin list' && result.detail === '3 assets'), true)
  })

  it('fails when a required UI shell lacks visible fallback content', async () => {
    const fetchFn = async (url) => {
      const value = String(url)
      if (value.endsWith('/health')) return response({ status: 'ok' })
      if (value.endsWith('/ready')) return response({ status: 'ready' })
      if (value.endsWith('/ready/report')) return response({ status: 'ready' })
      if (value.endsWith('/src/main.tsx')) return response('import { createHotContext } from "/@vite/client"')
      return response('<html></html>')
    }

    await assert.rejects(
      () => runDemoSmoke({ env: { PATH: '/bin' }, fetchFn, log: () => {} }),
      /HTML is missing expected app shell/,
    )
  })

  it('fails when a Vite React entry cannot be loaded', async () => {
    const fetchFn = async (url) => {
      const value = String(url)
      if (value.endsWith('/health')) return response({ status: 'ok' })
      if (value.endsWith('/ready')) return response({ status: 'ready' })
      if (value.endsWith('/ready/report')) return response({ status: 'ready' })
      if (value.endsWith('/admin/')) return response(adminHtml())
      if (value.endsWith('/src/main.tsx')) return response('not the vite module')
      return response(appHtml())
    }

    await assert.rejects(
      () => runDemoSmoke({ env: { PATH: '/bin' }, fetchFn, log: () => {} }),
      /React entry module is missing expected app shell/,
    )
  })
})
