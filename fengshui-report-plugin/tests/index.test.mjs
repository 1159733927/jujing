import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../lib/index.js'

const validRequest = (overrides = {}) => ({
  requestId: 'report-001',
  bazi: {
    profileId: 'profile-001',
    ruleVersion: 'bazi-rules-2026-08',
    pillars: ['甲子', '乙丑', '丙寅', '丁卯'],
  },
  residence: { facing: 'south' },
  photos: [
    { id: 'photo-overview', room: 'overview', facing: 'north' },
    { id: 'photo-entrance', room: 'entrance', facing: 'south' },
  ],
  ...overrides,
})

function mountPlugin() {
  let service
  let createdListener
  const ctx = {
    provide(name, value) {
      assert.equal(name, 'fengshuiReport')
      service = value
    },
    on(event, listener) {
      assert.equal(event, 'agent/created')
      createdListener = listener
    },
  }

  apply(ctx)
  assert.ok(service, 'plugin must provide the report service')
  assert.ok(createdListener, 'plugin must register the agent policy listener')
  return { service, createdListener }
}

function makeAgentTools(schemaNames) {
  let restriction
  let guard
  const tools = {
    restrict(filter) {
      restriction = filter
      return () => {}
    },
    guard(check) {
      guard = check
      return () => {}
    },
    schemas() {
      return schemaNames.map(name => ({ name }))
    },
  }

  return {
    agent: { ctx: { tools } },
    getRestriction: () => restriction,
    getGuard: () => guard,
  }
}

test('createDraft accepts a valid request and returns a deterministic queued draft', () => {
  const { service } = mountPlugin()

  const draft = service.createDraft(validRequest())

  assert.deepEqual(draft, {
    requestId: 'report-001',
    status: 'queued',
    evidenceCount: 2,
    ruleVersion: 'bazi-rules-2026-08',
  })
})

test('createDraft rejects a request without residence photos', () => {
  const { service } = mountPlugin()

  assert.throws(
    () => service.createDraft(validRequest({ photos: [] })),
    /at least one residence photo is required/,
  )
})

test('agent/created installs the exact report allowlist and permits allowlisted tools', () => {
  const { createdListener } = mountPlugin()
  const runtime = makeAgentTools(['skill'])

  createdListener({ agent: runtime.agent })

  assert.deepEqual(runtime.getRestriction(), {
    allow: ['skill'],
  })
  assert.equal(runtime.getGuard()({ name: 'skill' }), undefined)
})

test('agent/created guard denies knowledge MCP and other tools outside the report allowlist', () => {
  const { createdListener } = mountPlugin()
  const runtime = makeAgentTools(['skill'])

  createdListener({ agent: runtime.agent })

  assert.equal(
    runtime.getGuard()({ name: 'mcp__fengshui_knowledge__search_published_knowledge' }),
    'fengshui report tool policy denied: mcp__fengshui_knowledge__search_published_knowledge',
  )
  assert.equal(
    runtime.getGuard()({ name: 'shell' }),
    'fengshui report tool policy denied: shell',
  )
})

test('agent/created fails closed when the materialized tool schemas include a non-allowlisted tool', () => {
  const { createdListener } = mountPlugin()
  const runtime = makeAgentTools([
    'skill',
    'mcp__fengshui_knowledge__search_published_knowledge',
    'shell',
  ])

  assert.throws(
    () => createdListener({ agent: runtime.agent }),
    /fengshui report tool policy mismatch: expected skill, got .*mcp__fengshui_knowledge.*shell/,
  )
})
