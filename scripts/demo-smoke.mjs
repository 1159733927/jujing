#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDemoNetworkConfig } from './dev-demo.mjs'

export class DemoSmokeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DemoSmokeError'
  }
}

function origin({ host, port }) {
  return `http://${host}:${port}`
}

export function demoSmokeTargets(env = process.env) {
  const network = parseDemoNetworkConfig(env)
  const apiOrigin = origin(network.api)
  const webOrigin = origin(network.web)
  const adminOrigin = origin(network.admin)
  const allowReportNotReady = env.ALLOW_REPORT_NOT_READY === '1' || env.ALLOW_REPORT_NOT_READY === 'true'
  return {
    apiOrigin,
    webOrigin,
    adminOrigin,
    allowReportNotReady,
    checks: [
      { kind: 'json', name: 'API health', url: `${apiOrigin}/health`, okStatuses: [200], expectedStatus: 'ok' },
      { kind: 'json', name: 'API readiness', url: `${apiOrigin}/ready`, okStatuses: [200], expectedStatus: 'ready' },
      { kind: 'json', name: 'Report readiness', url: `${apiOrigin}/ready/report`, okStatuses: allowReportNotReady ? [200, 503] : [200], expectedStatus: allowReportNotReady ? undefined : 'ready' },
      { kind: 'html', name: 'User home', url: `${webOrigin}/`, contains: ['/src/main.tsx', 'root', '住宅分析', '我的命盘', '我的报告'] },
      { kind: 'html', name: 'Chart page', url: `${webOrigin}/chart`, contains: ['/src/main.tsx', 'root', '住宅分析', '我的命盘', '我的报告'] },
      { kind: 'html', name: 'Reports page', url: `${webOrigin}/reports`, contains: ['/src/main.tsx', 'root', '住宅分析', '我的命盘', '我的报告'] },
      { kind: 'html', name: 'Expert console', url: `${adminOrigin}/admin/`, contains: ['/admin/src/main.tsx', 'root', '专家知识与规则后台'] },
      { kind: 'module', name: 'User React entry', url: `${webOrigin}/src/main.tsx`, contains: ['/@vite/client'] },
      { kind: 'module', name: 'Admin React entry', url: `${adminOrigin}/admin/src/main.tsx`, contains: ['/admin/@vite/client'] },
    ],
  }
}

async function fetchWithTimeout(url, options = {}, fetchFn = fetch) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000)
  try {
    return await fetchFn(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new DemoSmokeError('request timed out')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function readText(response) {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function assertStatus(check, response) {
  const okStatuses = check.okStatuses ?? [200]
  if (!okStatuses.includes(response.status)) {
    throw new DemoSmokeError(`${check.name} returned HTTP ${response.status}`)
  }
}

export async function runDemoSmoke({
  env = process.env,
  fetchFn = fetch,
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  const targets = demoSmokeTargets(env)
  const results = []

  for (const check of targets.checks) {
    try {
      const response = await fetchWithTimeout(check.url, {}, fetchFn)
      assertStatus(check, response)
      const body = await readText(response)
      if (check.kind === 'json') {
        let payload
        try {
          payload = JSON.parse(body)
        } catch {
          throw new DemoSmokeError(`${check.name} did not return JSON`)
        }
        if (check.expectedStatus && payload.status !== check.expectedStatus) {
          throw new DemoSmokeError(`${check.name} returned unexpected status`)
        }
        results.push({ name: check.name, status: response.status, detail: payload.status ?? 'json' })
      } else if (check.kind === 'html' || check.kind === 'module') {
        for (const token of check.contains) {
          if (!body.includes(token)) throw new DemoSmokeError(`${check.name} ${check.kind === 'html' ? 'HTML' : 'module'} is missing expected app shell`)
        }
        results.push({ name: check.name, status: response.status, detail: check.kind })
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new DemoSmokeError(`${check.name} failed at ${check.url}: ${reason}`)
    }
  }

  const adminToken = env.ADMIN_API_TOKEN?.trim()
  if (adminToken) {
    const listResponse = await fetchWithTimeout(`${targets.apiOrigin}/v1/knowledge`, {
      headers: { authorization: `Bearer ${adminToken}` },
    }, fetchFn)
    assertStatus({ name: 'Knowledge admin list', okStatuses: [200] }, listResponse)
    const assets = JSON.parse(await readText(listResponse))
    if (!Array.isArray(assets)) throw new DemoSmokeError('Knowledge admin list did not return an array')
    results.push({ name: 'Knowledge admin list', status: listResponse.status, detail: `${assets.length} assets` })
  } else {
    results.push({ name: 'Knowledge admin list', status: 0, detail: 'skipped: ADMIN_API_TOKEN not set' })
  }

  for (const result of results) {
    log(`[demo-smoke] ok ${result.name}: ${result.detail}${result.status ? ` (${result.status})` : ''}`)
  }
  return results
}

function main() {
  runDemoSmoke().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[demo-smoke] failed: ${message}\n`)
    process.exit(1)
  })
}

export function isMainModule(metaUrl = import.meta.url, argvEntry = process.argv[1]) {
  return typeof argvEntry === 'string' && fileURLToPath(metaUrl) === resolve(argvEntry)
}

if (isMainModule()) {
  main()
}
