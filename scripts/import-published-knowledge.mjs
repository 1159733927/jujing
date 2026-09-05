import { readFile } from 'node:fs/promises'

const [sourcePath] = process.argv.slice(2)
const baseUrl = process.env.KNOWLEDGE_IMPORT_BASE_URL?.replace(/\/$/u, '')
const token = process.env.ADMIN_API_TOKEN

if (!sourcePath || !baseUrl || !token) {
  throw new Error('usage: KNOWLEDGE_IMPORT_BASE_URL=... ADMIN_API_TOKEN=... node scripts/import-published-knowledge.mjs <knowledge.json>')
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  })
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}): ${await response.text()}`)
  if (response.status === 204) return undefined
  return response.json()
}

const store = JSON.parse(await readFile(sourcePath, 'utf8'))
const sources = store.assets.filter((asset) => asset.state === 'published' && asset.kind !== 'rule')
const existing = await request('/v1/knowledge')
const existingByTitle = new Map(existing.map((asset) => [asset.title, asset]))
let created = 0
let skipped = 0
let resumed = 0

for (const source of sources) {
  const prior = existingByTitle.get(source.title)
  if (prior?.state === 'published') {
    skipped += 1
    continue
  }
  if (prior?.state === 'archived') throw new Error(`cannot resume archived knowledge asset: ${source.title}`)
  const asset = prior ?? await request('/v1/knowledge', {
      method: 'POST',
      body: JSON.stringify({
        kind: source.kind,
        title: source.title,
        tags: source.tags,
        body: source.body,
        sourceLabel: source.sourceLabel,
      }),
    })
  if (asset.state === 'draft') {
    await request(`/v1/knowledge/${asset.id}/state`, { method: 'POST', body: JSON.stringify({ state: 'in-review' }) })
  }
  await request(`/v1/knowledge/${asset.id}/state`, { method: 'POST', body: JSON.stringify({ state: 'published' }) })
  if (prior) resumed += 1
  else created += 1
}

console.log(JSON.stringify({ sourceCount: sources.length, created, resumed, skipped }))
