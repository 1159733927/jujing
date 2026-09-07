import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { prodSmokeTargets, runProdSmoke } from './prod-smoke.mjs'

function response(body, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

function productionHtml(prefix = '') {
  return `<!doctype html><div id="root"></div><script type="module" src="${prefix}/assets/index.js"></script>`
}

function createFetch(overrides = {}) {
  const calls = []
  const fetchFn = async (url) => {
    calls.push(String(url))
    const value = String(url)
    if (overrides[value]) return overrides[value]
    if (value.endsWith('/api/health')) return response({ status: 'ok', service: 'fengshui-api' })
    if (value.endsWith('/api/ready')) return response({ status: 'ready', service: 'fengshui-api' })
    if (value.endsWith('/admin/')) return response(productionHtml('/admin'))
    if (value.endsWith('/api/v1/birthplaces/administrative/110118')) {
      return response({
        birthplace: {
          selectable: true,
          district: { coordinate: { confidence: 'city-derived' } },
        },
      })
    }
    if (value.endsWith('/api/v1/birthplaces/administrative/460321')) {
      return response({
        birthplace: {
          selectable: false,
          district: { coordinate: { confidence: 'unavailable' } },
        },
      })
    }
    return response(productionHtml())
  }
  return { fetchFn, calls }
}

describe('production smoke verifier', () => {
  it('builds production checks from a single origin', () => {
    const targets = prodSmokeTargets({ PROD_SMOKE_ORIGIN: 'http://example.test/' })

    assert.equal(targets.origin, 'http://example.test')
    assert.equal(targets.checks.some((check) => check.path === '/admin/'), true)
    assert.equal(targets.checks.some((check) => check.path.includes('110118')), true)
  })

  it('passes when public app, admin, API and birthplace data are healthy', async () => {
    const { fetchFn, calls } = createFetch()
    const logs = []

    const results = await runProdSmoke({
      env: { PROD_SMOKE_ORIGIN: 'http://prod.test' },
      fetchFn,
      log: (message) => logs.push(message),
    })

    assert.equal(results.length, 8)
    assert.equal(calls.includes('http://prod.test/admin/'), true)
    assert.equal(logs.some((line) => line.includes('City-derived birthplace fallback')), true)
  })

  it('fails closed when production HTML is not the built shell', async () => {
    const { fetchFn } = createFetch({
      'http://prod.test/admin/': response('<html></html>'),
    })

    await assert.rejects(
      () => runProdSmoke({
        env: { PROD_SMOKE_ORIGIN: 'http://prod.test' },
        fetchFn,
        log: () => {},
      }),
      /Admin shell is missing expected production shell token/,
    )
  })

  it('fails when the city-derived coordinate fallback is not deployed', async () => {
    const { fetchFn } = createFetch({
      'http://prod.test/api/v1/birthplaces/administrative/110118': response({
        birthplace: {
          selectable: false,
          district: { coordinate: { confidence: 'unavailable' } },
        },
      }),
    })

    await assert.rejects(
      () => runProdSmoke({
        env: { PROD_SMOKE_ORIGIN: 'http://prod.test' },
        fetchFn,
        log: () => {},
      }),
      /expected 密云区 coordinate confidence city-derived/,
    )
  })
})
