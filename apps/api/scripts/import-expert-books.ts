import { resolve } from 'node:path'
import { KnowledgeRepository } from '../src/knowledge.js'
import { importPdfKnowledgeSources } from '../src/pdf-knowledge-ingest.js'

const workspaceRoot = resolve(import.meta.dirname, '../../..')
const knowledgePath = process.env.KNOWLEDGE_FILE_PATH?.trim() || resolve(workspaceRoot, '.data/knowledge.json')
const bookNames = [
  '中州派【玄空风水】第1篇-玄空基础.pdf',
  '中州派【玄空风水】第2篇-玄空理气入门.pdf',
  '中州派【玄空风水】第3篇-水法宅形补遗概要.pdf',
  '中州派【玄空风水】第4篇-玄空古赋.pdf',
  '中州派【玄空风水】第5篇-阳宅运用篇.pdf',
] as const

const repository = new KnowledgeRepository(knowledgePath)
try {
  const publish = process.argv.includes('--publish')
  const publishExistingOnly = process.argv.includes('--publish-existing')
  const publishExistingBookAssets = async () => {
    let published = 0
    let rejected = 0
    const bookNameSet = new Set<string>(bookNames)
    const assets = await repository.list()
    for (const asset of assets) {
      const sourceFile = asset.body.match(/^sourceFile:\s*(.+)$/m)?.[1]?.trim()
      if (!sourceFile || !bookNameSet.has(sourceFile as typeof bookNames[number])) continue
      const passesQualityGate = asset.state === 'in-review'
        && /^bookTitle:\s*.+$/m.test(asset.body)
        && /^sourcePages:\s*\d+(?:-\d+)?$/m.test(asset.body)
        && /^contentHash:\s*[a-f0-9]{64}$/m.test(asset.body)
        && !asset.body.includes('周易天下会馆')
      if (passesQualityGate) {
        const next = await repository.setState(asset.id, 'published', 'expert-book-importer')
        if (next?.state === 'published') published += 1
      } else if (asset.state !== 'published') rejected += 1
    }
    return { published, rejected }
  }
  if (publishExistingOnly) {
    process.stdout.write(`${JSON.stringify({ knowledgePath, publishExistingOnly, ...(await publishExistingBookAssets()) }, null, 2)}\n`)
    process.exit(0)
  }
  const result = await importPdfKnowledgeSources(
    repository,
    bookNames.map((name) => ({
      path: resolve(workspaceRoot, name),
      title: name.replace(/\.pdf$/i, ''),
      author: '陈仲易',
      collection: '中州派玄空风水',
    })),
    {
      actor: 'expert-book-importer',
      submitForReview: !publish,
    },
  )
  const publication = publish ? await publishExistingBookAssets() : { published: 0, rejected: 0 }
  process.stdout.write(`${JSON.stringify({ knowledgePath, publish, publication, ...result }, null, 2)}\n`)
} finally {
  await repository.close()
}
