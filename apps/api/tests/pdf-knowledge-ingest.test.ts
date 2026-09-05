import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KnowledgeRepository } from '../src/knowledge.js'
import { chunkPdfPages, importPdfKnowledgeSources, pdfChunkFingerprint } from '../src/pdf-knowledge-ingest.js'

describe('PDF expert knowledge import', () => {
  it('chunks page text and records stable provenance in draft assets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-pdf-knowledge-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const sourcePath = join(directory, '中州派【玄空风水】样本.pdf')
    await writeSamplePdfPlaceholder(sourcePath, 'sample-pdf-v1')
    const chunks = chunkPdfPages([
      { pageNumber: 1, text: '玄空风水以元运、山向、形势共同判断。\n'.repeat(12) },
      { pageNumber: 2, text: '太短' },
    ], 140)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toMatchObject({ pageStart: 1, pageEnd: 1, chapter: '未识别章节' })
    expect(pdfChunkFingerprint('a'.repeat(64), chunks[0]!.pageStart, chunks[0]!.pageEnd, chunks[0]!.chunkIndex, chunks[0]!.chunkHash))
      .toMatch(/^pdf:[a-f0-9]{64}:p1-1:c1:[a-f0-9]{64}$/)

    await expect(importPdfKnowledgeSources(
      repository,
      [{ path: sourcePath, title: '中州派玄空风水样本', collection: '中州派玄空风水' }],
      { actor: 'fixture-importer', extractPages: async () => [] },
    )).rejects.toThrow('no importable text chunks')
  })

  it('keeps chapters, page ranges, and removes repeated running headers', () => {
    const chunks = chunkPdfPages([
      { pageNumber: 1, text: '中州派玄空风水\n第一章 阳宅总论\n\n玄空风水以元运、山向、形势共同判断。阳宅须先分清坐向与宅形，并记录明堂、门路、水路与外局环境。\n页脚' },
      { pageNumber: 2, text: '中州派玄空风水\n玄空风水资料继续说明客厅、门向、窗向和空间明暗，要求报告保留可见事实和不可见待确认项。\n页脚' },
      { pageNumber: 3, text: '中州派玄空风水\n第二章 门向观察\n\n入户门需要结合宅向、动线和明暗变化，不能脱离户型图、照片方向和用户标注直接判断。\n页脚' },
    ], 500)

    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({ pageStart: 1, pageEnd: 2, chapter: '第一章阳宅总论' })
    expect(chunks[1]).toMatchObject({ pageStart: 3, pageEnd: 3, chapter: '第二章门向观察' })
    expect(chunks[0]?.text).not.toContain('中州派玄空风水')
    expect(chunks[0]?.text).not.toContain('页脚')
  })

  it('removes separator rules and known promotional running footers', () => {
    const chunks = chunkPdfPages([
      { pageNumber: 1, text: '第一章 阳宅总论\n\n住宅判断必须结合坐向、元运和外部形势，不能脱离资料直接得出结论；还要保留住宅照片、户型和用户标注的证据边界。\n------------------------------\n周易天下会馆：姓名五行、排盘解惑等服务！' },
    ])

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).not.toContain('-----')
    expect(chunks[0]?.text).not.toContain('周易天下会馆')
  })

  it('is idempotent and keeps imported book chunks out of public search until publication', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-pdf-knowledge-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const sourcePath = join(directory, 'book.pdf')
    await writeSamplePdfPlaceholder(sourcePath, 'same-book-content')

    const first = await importPdfKnowledgeSourcesWithStubbedPages(repository, sourcePath)
    const second = await importPdfKnowledgeSourcesWithStubbedPages(repository, sourcePath)

    expect(first).toMatchObject({ created: 2, skipped: 0, submittedForReview: 0 })
    expect(second).toMatchObject({ created: 0, skipped: 2, submittedForReview: 0 })
    const assets = await repository.list()
    expect(assets).toHaveLength(2)
    expect(assets.every((asset) => asset.state === 'draft')).toBe(true)
    expect(assets[0]?.body).toContain('importFingerprint: pdf:')
    expect(assets[0]?.body).toContain('sourcePages:')
    expect(assets[0]?.body).toContain('chapter:')
    expect(assets[0]?.body).toContain('contentHash:')
    expect(assets[0]?.sourceLabel).toContain('sha256:')
    expect(await repository.search('玄空')).toEqual([])
  })

  it('can submit imported chunks for review without creating published versions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-pdf-knowledge-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const sourcePath = join(directory, 'review-book.pdf')
    await writeSamplePdfPlaceholder(sourcePath, 'review-book-content')

    const result = await importPdfKnowledgeSourcesWithStubbedPages(repository, sourcePath, true)

    expect(result).toMatchObject({ created: 2, skipped: 0, submittedForReview: 2 })
    expect((await repository.list()).every((asset) => asset.state === 'in-review')).toBe(true)
    expect(await repository.listVersions()).toEqual([])
    expect(await repository.search('玄空')).toEqual([])
  })
})

async function importPdfKnowledgeSourcesWithStubbedPages(
  repository: KnowledgeRepository,
  sourcePath: string,
  submitForReview = false,
) {
  return await importPdfKnowledgeSources(
    repository,
    [{ path: sourcePath, title: '导入样本' }],
    {
      submitForReview,
      maxChunkChars: 90,
      extractPages: async () => [
        { pageNumber: 1, text: '玄空风水以元运、山向、形势共同判断。阳宅须先分清坐向与宅形，并记录照片所示空间的实际方位。' },
        { pageNumber: 2, text: '住宅资料进入报告前，应保留页码、来源、版本与专家审核状态，避免模型把未审核资料当成已经发布的依据。' },
      ],
    },
  )
}

async function writeSamplePdfPlaceholder(path: string, content: string) {
  await writeFile(path, content)
}
