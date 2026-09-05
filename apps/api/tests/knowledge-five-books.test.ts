import { readFile } from 'node:fs/promises'
import type { ReportRecord } from '@fengshui/domain'
import { describe, expect, it } from 'vitest'
import { KnowledgeRepository } from '../src/knowledge.js'
import { ReportRepository } from '../src/repository.js'
import { resolveStorageConfig } from '../src/storage/factory.js'

const books = [
  '中州派【玄空风水】第1篇-玄空基础',
  '中州派【玄空风水】第2篇-玄空理气入门',
  '中州派【玄空风水】第3篇-水法宅形补遗概要',
  '中州派【玄空风水】第4篇-玄空古赋',
  '中州派【玄空风水】第5篇-阳宅运用篇',
] as const

const config = resolveStorageConfig({ NODE_ENV: 'test', STORAGE_DRIVER: 'file' })

function citedBook(title: string): string {
  return title.replace(/\s+p\.\d+(?:-\d+)?\s+.*$/u, '')
}

describe('five-book file-store regression', () => {
  it('keeps a current published version available for every expert book', async () => {
    const repository = new KnowledgeRepository(config.knowledgePath)
    const assets = await repository.list()

    for (const book of books) {
      const matches = assets.filter((asset) =>
        asset.title.startsWith(`${book} p.`)
        && asset.state === 'published'
        && asset.currentPublishedVersionId,
      )
      expect(matches.length, `expected published knowledge for ${book}`).toBeGreaterThan(0)

      const activeVersions = await Promise.all(matches.map(async (asset) => {
        return repository.getVersion(asset.currentPublishedVersionId!)
      }))
      expect(activeVersions.some((version) => version?.title.startsWith(`${book} p.`))).toBe(true)
    }
  })

  it('keeps the latest completed report citations traceable and representative of all five books', async () => {
    const storedRecords = JSON.parse(await readFile(config.reportsPath, 'utf8')) as ReportRecord[]
    const latestCompleted = storedRecords
      .filter((record) => record.status === 'completed')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    if (!latestCompleted) return

    const reports = new ReportRepository(config.reportsPath)
    const knowledge = new KnowledgeRepository(config.knowledgePath)
    const report = await reports.get(latestCompleted.id)
    expect(report).toBeDefined()
    expect(report?.citations?.length).toBeGreaterThan(0)

    for (const citation of report?.citations ?? []) {
      const version = await knowledge.getVersion(citation.versionId)
      expect(version, `missing knowledge version ${citation.versionId}`).toBeDefined()
      expect(version).toMatchObject({
        assetId: citation.id,
        versionId: citation.versionId,
        version: citation.version,
        contentHash: citation.contentHash,
        title: citation.title,
      })
    }

    const citedBooks = new Set((report?.citations ?? []).map((citation) => citedBook(citation.title)))
    for (const book of books) {
      expect(citedBooks.has(book), `expected latest completed report to cite ${book}`).toBe(true)
    }
  })
})
