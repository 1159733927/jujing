#!/usr/bin/env node

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export class ProdSmokeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProdSmokeError'
  }
}

const DEFAULT_PROD_SMOKE_ORIGIN = 'http://123.207.197.179'

function normalizeOrigin(value) {
  const origin = String(value ?? DEFAULT_PROD_SMOKE_ORIGIN).trim()
  if (!origin) throw new ProdSmokeError('PROD_SMOKE_ORIGIN must not be empty')
  return origin.replace(/\/+$/u, '')
}

function expectJsonStatus(name, expectedStatus) {
  return {
    name,
    kind: 'json-status',
    expectedStatus,
  }
}

function expectHtml(name, path, contains) {
  return {
    name,
    kind: 'html',
    path,
    contains,
  }
}

function expectJsonPath(name, path, assertPayload) {
  return {
    name,
    kind: 'json-path',
    path,
    assertPayload,
  }
}

export function prodSmokeTargets(env = process.env) {
  const origin = normalizeOrigin(env.PROD_SMOKE_ORIGIN)
  return {
    origin,
    checks: [
      { ...expectJsonStatus('API health', 'ok'), path: '/api/health' },
      { ...expectJsonStatus('API readiness', 'ready'), path: '/api/ready' },
      expectHtml('User web shell', '/', ['<div id="root"', '/assets/']),
      expectHtml('Chart route shell', '/chart', ['<div id="root"', '/assets/']),
      expectHtml('Reports route shell', '/reports', ['<div id="root"', '/assets/']),
      expectHtml('Admin shell', '/admin/', ['<div id="root"', '/admin/assets/']),
      expectJsonPath('City-derived birthplace fallback', '/api/v1/birthplaces/administrative/110118', (payload) => {
        const confidence = payload?.birthplace?.district?.coordinate?.confidence
        if (confidence !== 'city-derived') {
          throw new ProdSmokeError(`expected 密云区 coordinate confidence city-derived, got ${confidence ?? 'missing'}`)
        }
        if (payload?.birthplace?.selectable !== true) {
          throw new ProdSmokeError('expected 密云区 to be selectable')
        }
      }),
      expectJsonPath('Unavailable birthplace stays unavailable', '/api/v1/birthplaces/administrative/460321', (payload) => {
        const confidence = payload?.birthplace?.district?.coordinate?.confidence
        if (confidence !== 'unavailable') {
          throw new ProdSmokeError(`expected 西沙群岛 coordinate confidence unavailable, got ${confidence ?? 'missing'}`)
        }
        if (payload?.birthplace?.selectable !== false) {
          throw new ProdSmokeError('expected 西沙群岛 to be non-selectable')
        }
      }),
    ],
  }
}

async function fetchWithTimeout(fetchFn, url, timeoutMs = 8_000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchFn(url, { signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ProdSmokeError(`request timed out: ${url}`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function readJson(name, response) {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new ProdSmokeError(`${name} did not return JSON`)
  }
}

async function assertResponseOk(check, response) {
  if (response.status !== 200) {
    throw new ProdSmokeError(`${check.name} returned HTTP ${response.status}`)
  }
}

export async function runProdSmoke({
  env = process.env,
  fetchFn = fetch,
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  const targets = prodSmokeTargets(env)
  const results = []

  for (const check of targets.checks) {
    const url = `${targets.origin}${check.path}`
    try {
      const response = await fetchWithTimeout(fetchFn, url)
      await assertResponseOk(check, response)

      if (check.kind === 'json-status') {
        const payload = await readJson(check.name, response)
        if (payload.status !== check.expectedStatus) {
          throw new ProdSmokeError(`${check.name} returned unexpected status ${payload.status ?? 'missing'}`)
        }
        results.push({ name: check.name, url, detail: payload.status })
      } else if (check.kind === 'json-path') {
        const payload = await readJson(check.name, response)
        check.assertPayload(payload)
        results.push({ name: check.name, url, detail: 'json ok' })
      } else if (check.kind === 'html') {
        const html = await response.text()
        for (const token of check.contains) {
          if (!html.includes(token)) {
            throw new ProdSmokeError(`${check.name} is missing expected production shell token`)
          }
        }
        results.push({ name: check.name, url, detail: 'html ok' })
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new ProdSmokeError(`${check.name} failed at ${url}: ${reason}`)
    }
  }

  for (const result of results) {
    log(`[prod-smoke] ok ${result.name}: ${result.detail}`)
  }
  return results
}

function main() {
  runProdSmoke().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[prod-smoke] failed: ${message}\n`)
    process.exit(1)
  })
}

export function isMainModule(metaUrl = import.meta.url, argvEntry = process.argv[1]) {
  return typeof argvEntry === 'string' && fileURLToPath(metaUrl) === resolve(argvEntry)
}

if (isMainModule()) {
  main()
}
