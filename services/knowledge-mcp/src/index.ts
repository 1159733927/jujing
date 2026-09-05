import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { ExpertAsset, KnowledgeStoreSnapshot, PublishedKnowledgeVersion } from '@fengshui/knowledge-contracts'
import { z } from 'zod'

const DEFAULT_TIMEOUT_MS = 8_000
const publishedVersionSchema = z.object({
  assetId: z.string(),
  version: z.number().int(),
  versionId: z.string(),
  contentHash: z.string(),
  kind: z.enum(['article', 'rule', 'skill']),
  title: z.string(),
  tags: z.array(z.string()).readonly(),
  body: z.string(),
  sourceLabel: z.string(),
  exactExcerpt: z.string(),
  publishedAt: z.string(),
  rule: z.unknown().optional(),
}).passthrough()
const publishedVersionsSchema = z.array(publishedVersionSchema) as z.ZodType<PublishedKnowledgeVersion[]>

export class KnowledgeRetrievalError extends Error {
  constructor(message = 'published knowledge retrieval failed') {
    super(message)
    this.name = 'KnowledgeRetrievalError'
  }
}

export interface KnowledgeMcpEnvironment {
  FENGSHUI_KNOWLEDGE_API_URL?: string
  FENGSHUI_KNOWLEDGE_API_TOKEN?: string
  FENGSHUI_STORAGE_DRIVER?: string
  FENGSHUI_KNOWLEDGE_PATH?: string
}

export interface SearchKnowledgeOptions {
  env?: KnowledgeMcpEnvironment
  fetchImpl?: typeof fetch
  timeoutMs?: number
  readTextFile?: (path: string) => Promise<string>
}

async function publishedVersionsFromFile(dataPath: string, readTextFile = (path: string) => readFile(path, 'utf8')): Promise<PublishedKnowledgeVersion[]> {
  try {
    const parsed = JSON.parse(await readTextFile(dataPath)) as KnowledgeStoreSnapshot | ExpertAsset[]
    if (Array.isArray(parsed)) return parsed.filter((asset) => asset.state === 'published').map(legacyPublishedVersion)
    const active = new Map(parsed.assets.filter((asset) => asset.state === 'published').map((asset) => [asset.id, asset.version]))
    return parsed.versions.filter((version) => active.get(version.assetId) === version.version)
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}

function localDemoDataPath(env: KnowledgeMcpEnvironment): string {
  return env.FENGSHUI_KNOWLEDGE_PATH || fileURLToPath(new URL('../../../.data/knowledge.json', import.meta.url))
}

function buildSearchUrl(baseUrl: string, query: string, limit: number): string {
  const url = new URL('/v1/knowledge/search', baseUrl)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(limit))
  return url.toString()
}

async function publishedVersionsFromApi(query: string, limit: number, options: Required<Pick<SearchKnowledgeOptions, 'fetchImpl' | 'timeoutMs'>> & Pick<SearchKnowledgeOptions, 'env'>): Promise<PublishedKnowledgeVersion[]> {
  const baseUrl = options.env?.FENGSHUI_KNOWLEDGE_API_URL?.trim()
  if (!baseUrl) throw new KnowledgeRetrievalError('published knowledge API is not configured')
  const token = options.env?.FENGSHUI_KNOWLEDGE_API_TOKEN?.trim()
  if (!token) throw new KnowledgeRetrievalError('published knowledge API token is not configured')
  let response: Response
  try {
    response = await options.fetchImpl(buildSearchUrl(baseUrl, query, limit), {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(options.timeoutMs),
    })
  } catch {
    throw new KnowledgeRetrievalError()
  }
  if (!response.ok) throw new KnowledgeRetrievalError()
  try {
    return publishedVersionsSchema.parse(await response.json())
  } catch {
    throw new KnowledgeRetrievalError()
  }
}

export async function searchPublishedKnowledge(query: string, limit = 5, options: SearchKnowledgeOptions = {}): Promise<PublishedKnowledgeVersion[]> {
  const env = options.env ?? process.env
  const trimmedQuery = query.trim()
  const safeLimit = Number.isInteger(limit) ? Math.min(10, Math.max(1, limit)) : 5
  if (env.FENGSHUI_KNOWLEDGE_API_URL?.trim()) {
    return (await publishedVersionsFromApi(trimmedQuery, safeLimit, {
      env,
      fetchImpl: options.fetchImpl ?? fetch,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })).slice(0, safeLimit)
  }
  if (env.FENGSHUI_STORAGE_DRIVER === 'file') {
    return searchLocalVersions(await publishedVersionsFromFile(localDemoDataPath(env), options.readTextFile), trimmedQuery, safeLimit)
  }
  throw new KnowledgeRetrievalError('set FENGSHUI_KNOWLEDGE_API_URL or explicit FENGSHUI_STORAGE_DRIVER=file for local demo')
}

export function searchLocalVersions(versions: readonly PublishedKnowledgeVersion[], query: string, limit = 5): PublishedKnowledgeVersion[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return versions
    .map((version) => ({ version, score: terms.filter((term) => `${version.title} ${version.tags.join(' ')} ${version.body}`.toLowerCase().includes(term)).length }))
    .filter(({ score }) => score > 0 || terms.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ version }) => version)
}

function legacyPublishedVersion(asset: ExpertAsset): PublishedKnowledgeVersion {
  const canonical = JSON.stringify({ kind: asset.kind, title: asset.title, tags: [...asset.tags], body: asset.body, sourceLabel: asset.sourceLabel, rule: asset.rule ?? null })
  const contentHash = createHash('sha256').update(canonical).digest('hex')
  return { assetId: asset.id, version: asset.version, versionId: `${asset.id}:v${asset.version}:${contentHash.slice(0, 16)}`, contentHash, kind: asset.kind, title: asset.title, tags: asset.tags, body: asset.body, sourceLabel: asset.sourceLabel, exactExcerpt: asset.body.slice(0, 500), publishedAt: asset.updatedAt, ...(asset.rule ? { rule: asset.rule } : {}) }
}

const server = new McpServer({ name: 'fengshui-knowledge', version: '0.0.1' })

server.tool(
  'search_published_knowledge',
  'Search only expert-reviewed and published feng shui materials. Returns stable source, version and excerpt citations; drafts are never returned.',
  { query: z.string().min(1), limit: z.number().int().min(1).max(10).default(5) },
  async ({ query, limit }) => {
    const matches = (await searchPublishedKnowledge(query, limit))
      .map((version) => ({ id: version.assetId, versionId: version.versionId, contentHash: version.contentHash, title: version.title, version: version.version, kind: version.kind, sourceLabel: version.sourceLabel, excerpt: version.exactExcerpt }))
    return { content: [{ type: 'text', text: JSON.stringify(matches) }], structuredContent: { matches } }
  },
)

export function isMainModule(metaUrl = import.meta.url, argvEntry = process.argv[1]): boolean {
  return typeof argvEntry === 'string' && fileURLToPath(metaUrl) === resolve(argvEntry)
}

if (isMainModule()) {
  await server.connect(new StdioServerTransport())
}
