import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createDefaultStores } from '../src/storage/factory.js'
import { importPdfKnowledgeSources, type PdfKnowledgeSource } from '../src/pdf-knowledge-ingest.js'

const args = new Set(process.argv.slice(2))
const submitForReview = args.has('--submit-review')
const root = resolve(process.env.PDF_KNOWLEDGE_DIR ?? process.cwd())
const actor = process.env.PDF_KNOWLEDGE_ACTOR ?? process.env.ADMIN_ACTOR_ID ?? 'pdf-knowledge-importer'

const entries = await readdir(root)
const pdfs = entries
  .filter((entry) => entry.toLocaleLowerCase('zh-CN').endsWith('.pdf'))
  .sort((left, right) => left.localeCompare(right, 'zh-CN'))
  .map((entry): PdfKnowledgeSource => ({ path: resolve(root, entry), collection: '中州派玄空风水' }))

if (!pdfs.length) {
  console.log(JSON.stringify({ scannedDirectory: root, sources: 0, created: 0, skipped: 0, submittedForReview: 0 }, null, 2))
  process.exit(0)
}

const stores = await createDefaultStores({ ...process.env, DEMO_SEED_KNOWLEDGE: 'false' })
try {
  const result = await importPdfKnowledgeSources(stores.knowledge, pdfs, { actor, submitForReview })
  console.log(JSON.stringify({ scannedDirectory: root, submitForReview, ...result }, null, 2))
} finally {
  await Promise.all([
    stores.reports.close(),
    stores.charts.close(),
    stores.knowledge.close(),
    stores.ruleProfiles.close(),
    stores.wenzhenFixtures.close(),
  ])
}
