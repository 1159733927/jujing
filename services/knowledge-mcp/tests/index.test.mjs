import assert from 'node:assert/strict'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { isMainModule, KnowledgeRetrievalError, searchPublishedKnowledge } from '../lib/index.js'

const serverEntry = fileURLToPath(new URL('../lib/index.js', import.meta.url))
const fixturePath = fileURLToPath(new URL('./fixtures/knowledge.json', import.meta.url))
const configuredApiEnv = {
  FENGSHUI_KNOWLEDGE_API_URL: 'http://127.0.0.1:3001',
  FENGSHUI_KNOWLEDGE_API_TOKEN: 'test-reader-token',
}

test('recognizes relative and absolute CLI entry paths', () => {
  const moduleUrl = new URL('../lib/index.js', import.meta.url).href
  assert.equal(isMainModule(moduleUrl, serverEntry), true)
  assert.equal(isMainModule(moduleUrl, relative(process.cwd(), serverEntry)), true)
  assert.equal(isMainModule(moduleUrl, 'lib/not-index.js'), false)
})

async function withMcpClient(env, callback) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { ...getDefaultEnvironment(), ...env },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'knowledge-mcp-tests', version: '1.0.0' })
  try {
    await client.connect(transport)
    return await callback(client)
  }
  finally {
    await client.close()
  }
}

const publishedVersion = {
  assetId: 'asset-1',
  version: 2,
  versionId: 'asset-1:v2:abcdef0123456789',
  contentHash: 'abcdef0123456789',
  kind: 'article',
  title: '玄关明堂资料',
  tags: ['玄关', '明堂'],
  body: '玄关宜整洁明亮，避免杂物堆积。',
  sourceLabel: '专家资料 A',
  exactExcerpt: '玄关宜整洁明亮，避免杂物堆积。',
  publishedAt: '2026-08-30T00:00:00.000Z',
}

test('fetches published knowledge from the configured read-only API', async () => {
  let requestedUrl = ''
  const result = await searchPublishedKnowledge('玄关 明堂', 5, {
    env: { ...configuredApiEnv, FENGSHUI_KNOWLEDGE_API_TOKEN: 'internal-reader-token' },
    fetchImpl: async (url, init) => {
      requestedUrl = String(url)
      assert.equal(init.method, 'GET')
      assert.equal(init.headers.accept, 'application/json')
      assert.equal(init.headers.authorization, 'Bearer internal-reader-token')
      assert.ok(init.signal instanceof AbortSignal)
      return Response.json([publishedVersion])
    },
  })
  assert.equal(new URL(requestedUrl).pathname, '/v1/knowledge/search')
  assert.equal(new URL(requestedUrl).searchParams.get('q'), '玄关 明堂')
  assert.equal(new URL(requestedUrl).searchParams.get('limit'), '5')
  assert.deepEqual(result, [publishedVersion])
})

test('fails closed before fetching when the read-only API token is missing', async () => {
  let fetchCalled = false

  await assert.rejects(
    searchPublishedKnowledge('玄关', 5, {
      env: { FENGSHUI_KNOWLEDGE_API_URL: 'http://127.0.0.1:3001' },
      fetchImpl: async () => {
        fetchCalled = true
        return Response.json([publishedVersion])
      },
    }),
    (error) => error instanceof KnowledgeRetrievalError,
  )
  assert.equal(fetchCalled, false)
})

test('fails closed with a sanitized error when the upstream rejects the reader token', async () => {
  const upstreamBody = 'unauthorized: internal authentication detail'

  await assert.rejects(
    searchPublishedKnowledge('玄关', 5, {
      env: {
        FENGSHUI_KNOWLEDGE_API_URL: 'http://127.0.0.1:3001',
        FENGSHUI_KNOWLEDGE_API_TOKEN: 'rejected-reader-token',
      },
      fetchImpl: async () => new Response(upstreamBody, { status: 401 }),
    }),
    (error) => error instanceof KnowledgeRetrievalError
      && error.message === 'published knowledge retrieval failed'
      && !error.message.includes(upstreamBody),
  )
})

test('propagates the requested result limit through the API bridge', async () => {
  let requestedUrl = ''
  await searchPublishedKnowledge('玄关', 10, {
    env: configuredApiEnv,
    fetchImpl: async (url) => {
      requestedUrl = String(url)
      return Response.json([])
    },
  })
  assert.equal(new URL(requestedUrl).searchParams.get('limit'), '10')
})

test('returns a sanitized error for API HTTP failures', async () => {
  await assert.rejects(
    searchPublishedKnowledge('玄关', 5, {
      env: configuredApiEnv,
      fetchImpl: async () => new Response('upstream token or stack trace', { status: 500 }),
    }),
    (error) => error instanceof KnowledgeRetrievalError && error.message === 'published knowledge retrieval failed',
  )
})

test('returns a sanitized error when the API returns malformed JSON', async () => {
  const upstreamPayload = 'not-json containing internal-token-and-stack-trace'

  await assert.rejects(
    searchPublishedKnowledge('玄关', 5, {
      env: configuredApiEnv,
      fetchImpl: async () => new Response(upstreamPayload, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    }),
    (error) => error instanceof KnowledgeRetrievalError
      && error.message === 'published knowledge retrieval failed'
      && !error.message.includes(upstreamPayload),
  )
})

test('returns a sanitized error when the API response violates the published knowledge schema', async () => {
  const upstreamSecret = 'internal-reader-token-must-not-leak'

  await assert.rejects(
    searchPublishedKnowledge('玄关', 5, {
      env: configuredApiEnv,
      fetchImpl: async () => Response.json([{
        ...publishedVersion,
        version: 'not-an-integer',
        body: upstreamSecret,
      }]),
    }),
    (error) => error instanceof KnowledgeRetrievalError
      && error.message === 'published knowledge retrieval failed'
      && !error.message.includes(upstreamSecret),
  )
})

test('returns a sanitized error for API timeouts or transport failures', async () => {
  await assert.rejects(
    searchPublishedKnowledge('玄关', 5, {
      env: configuredApiEnv,
      fetchImpl: async () => { throw new Error('ECONNREFUSED with internal host') },
      timeoutMs: 1,
    }),
    (error) => error instanceof KnowledgeRetrievalError && !error.message.includes('internal host'),
  )
})

test('fails closed in production when no knowledge source is configured', async () => {
  await assert.rejects(
    searchPublishedKnowledge('玄关', 5, { env: {} }),
    (error) => error instanceof KnowledgeRetrievalError
      && error.message.includes('FENGSHUI_KNOWLEDGE_API_URL')
      && error.message.includes('FENGSHUI_STORAGE_DRIVER=file'),
  )
})

test('allows JSON file reads only for the explicit local demo storage driver', async () => {
  const snapshot = {
    schemaVersion: 2,
    assets: [{ id: 'asset-1', version: 2, state: 'published' }],
    versions: [publishedVersion],
  }
  const result = await searchPublishedKnowledge('明堂', 5, {
    env: { FENGSHUI_STORAGE_DRIVER: 'file', FENGSHUI_KNOWLEDGE_PATH: '/demo/knowledge.json' },
    readTextFile: async (path) => {
      assert.equal(path, '/demo/knowledge.json')
      return JSON.stringify(snapshot)
    },
  })
  assert.deepEqual(result, [publishedVersion])
})

test('publishes exactly one read-only search tool and preserves citation fields', { timeout: 5_000 }, async () => {
  await withMcpClient({
    FENGSHUI_STORAGE_DRIVER: 'file',
    FENGSHUI_KNOWLEDGE_PATH: fixturePath,
  }, async (client) => {
    const catalog = await client.listTools()
    assert.deepEqual(catalog.tools.map((tool) => tool.name), ['search_published_knowledge'])
    assert.match(catalog.tools[0].description, /only expert-reviewed and published/i)
    assert.match(catalog.tools[0].description, /drafts are never returned/i)

    const result = await client.callTool({
      name: 'search_published_knowledge',
      arguments: { query: '玄关', limit: 5 },
    })
    assert.equal(result.isError, undefined)
    assert.deepEqual(result.structuredContent, {
      matches: [{
        id: 'asset-fixture-1',
        versionId: 'asset-fixture-1:v3:0123456789abcdef',
        contentHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        title: '玄关明堂资料',
        version: 3,
        kind: 'article',
        sourceLabel: '测试专家资料',
        excerpt: '玄关宜保持整洁明亮。',
      }],
    })
  })
})
