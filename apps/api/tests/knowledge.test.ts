import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KnowledgeRepository, KnowledgeRevisionConflictError, knowledgeSearchTerms, parseKnowledgeAssetRequest } from '../src/knowledge.js'

describe('expert knowledge lifecycle', () => {
  it('segments Chinese report context into useful retrieval terms', () => {
    expect(knowledgeSearchTerms('客厅连接南向阳台，主卧在西侧。 overview')).toEqual(
      expect.arrayContaining(['客厅', '连接', '南向', '阳台', '主卧', '西侧', 'overview']),
    )
    expect(knowledgeSearchTerms('玄空坐向看厨房灶位和卫生间')).toEqual(
      expect.arrayContaining(['玄空', '坐向', '飞星', '山向', '朝向', '厨房', '灶位', '炉灶', '卫生间', '厕所']),
    )
    expect(knowledgeSearchTerms('客厅连接南向阳台，主卧在西侧。 overview')).not.toContain('在')
    expect(knowledgeSearchTerms('修订者')).toEqual(['修订者'])
  })

  it('keeps drafts out of search and returns an immutable published snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-knowledge-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const draft = await repository.create({ kind: 'article', title: '客厅采光原则', tags: ['客厅', '采光'], body: '保持自然采光与通道整洁。', sourceLabel: '专家资料' }, 'editor-one')
    expect(await repository.search('客厅')).toEqual([])
    await repository.setState(draft.id, 'in-review', 'editor-one')
    const published = await repository.setState(draft.id, 'published', 'reviewer-one')
    expect(published?.version).toBe(1)
    expect(published).toMatchObject({ createdBy: 'editor-one', submittedForReviewBy: 'editor-one', reviewedBy: 'reviewer-one' })
    const [firstVersion] = await repository.search('客厅')
    expect(firstVersion).toMatchObject({ assetId: draft.id, version: 1, exactExcerpt: '保持自然采光与通道整洁。', submittedForReviewBy: 'editor-one', reviewedBy: 'reviewer-one', publishedBy: 'reviewer-one' })
    expect(firstVersion?.versionId).toContain(`${draft.id}:v1:`)
    expect(firstVersion?.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(await repository.search('客厅连接南向阳台，主卧在西侧。 overview')).toEqual([firstVersion])

    const revised = await repository.revise(draft.id, { kind: 'article', title: '客厅采光原则', tags: ['客厅', '采光'], body: '第二版：同时记录窗外遮挡。', sourceLabel: '专家资料' }, 'editor-two', 1)
    expect(revised?.currentPublishedVersionId).toBe(firstVersion?.versionId)
    expect(await repository.search('客厅')).toEqual([firstVersion])
    expect(await repository.getVersion(firstVersion!.versionId)).toEqual(firstVersion)
    await repository.setState(draft.id, 'in-review', 'editor-two')
    await repository.setState(draft.id, 'published', 'reviewer-two')
    const [secondVersion] = await repository.search('客厅')
    expect(secondVersion).toMatchObject({ version: 2, body: '第二版：同时记录窗外遮挡。' })
    expect(secondVersion?.versionId).not.toBe(firstVersion?.versionId)
    expect(await repository.listVersions(draft.id)).toHaveLength(2)
  })

  it('removes an archived asset from retrieval while preserving immutable history', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-knowledge-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const draft = await repository.create({ kind: 'article', title: '归档资料', tags: ['归档'], body: '仍须保留的历史正文。', sourceLabel: '专家资料' }, 'editor')
    await repository.setState(draft.id, 'in-review', 'editor')
    const published = await repository.setState(draft.id, 'published', 'reviewer')
    const [version] = await repository.listVersions(draft.id)
    expect(published?.currentPublishedVersionId).toBe(version?.versionId)

    const archived = await repository.setState(draft.id, 'archived', 'archiver')
    expect(archived?.currentPublishedVersionId).toBeUndefined()
    expect(await repository.search('归档')).toEqual([])
    expect(await repository.getVersion(version!.versionId)).toEqual(version)
  })

  it('migrates schema v3 pointers for published and working revisions but not archived assets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-knowledge-'))
    const path = join(directory, 'knowledge.json')
    const timestamp = '2026-01-01T00:00:00.000Z'
    const baseAsset = { kind: 'article', tags: [], sourceLabel: '旧资料', createdAt: timestamp, createdBy: 'editor', updatedAt: timestamp, updatedBy: 'editor' }
    const version = (assetId: string, revision: number, body: string) => ({
      assetId, version: revision, versionId: `${assetId}:v${revision}:hash`, contentHash: 'a'.repeat(64), kind: 'article', title: assetId,
      tags: [], body, sourceLabel: '旧资料', exactExcerpt: body, submittedForReviewAt: timestamp, submittedForReviewBy: 'editor',
      reviewedAt: timestamp, reviewedBy: 'reviewer', publishedAt: timestamp, publishedBy: 'reviewer',
    })
    await writeFile(path, JSON.stringify({
      schemaVersion: 3,
      assets: [
        { ...baseAsset, id: 'published', title: 'published', body: '线上第二版', version: 2, state: 'published', submittedForReviewAt: timestamp, submittedForReviewBy: 'editor', reviewedAt: timestamp, reviewedBy: 'reviewer' },
        { ...baseAsset, id: 'published-without-snapshot', title: 'published-without-snapshot', body: '遗留线上正文', version: 1, state: 'published', submittedForReviewAt: timestamp, submittedForReviewBy: 'editor', reviewedAt: timestamp, reviewedBy: 'reviewer' },
        { ...baseAsset, id: 'working', title: 'working', body: '工作第三版', version: 3, state: 'draft' },
        { ...baseAsset, id: 'archived', title: 'archived', body: '归档正文', version: 1, state: 'archived', currentPublishedVersionId: 'archived:v1:hash' },
      ],
      versions: [version('published', 1, '旧一版'), version('published', 2, '线上第二版'), version('working', 1, '工作旧一版'), version('working', 2, '工作旧二版'), version('archived', 1, '归档正文')],
    }))

    const repository = new KnowledgeRepository(path)
    const assets = await repository.list()
    expect(assets.find((asset) => asset.id === 'published')?.currentPublishedVersionId).toBe('published:v2:hash')
    expect(assets.find((asset) => asset.id === 'published-without-snapshot')?.currentPublishedVersionId).toContain('published-without-snapshot:v1:')
    expect(assets.find((asset) => asset.id === 'working')?.currentPublishedVersionId).toBe('working:v2:hash')
    expect(assets.find((asset) => asset.id === 'archived')?.currentPublishedVersionId).toBeUndefined()
    expect((await repository.search('旧二版'))[0]?.versionId).toBe('working:v2:hash')

    await repository.create({ kind: 'article', title: '触发写回', tags: [], body: '正文', sourceLabel: '测试' })
    expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(4)
  })

  it('refuses to publish a free-text rule without a validated structure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-knowledge-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const draft = await repository.create({ kind: 'rule', title: '自由文本规则', tags: [], body: '朝南就很好', sourceLabel: '测试' }, 'editor')
    await repository.setState(draft.id, 'in-review', 'editor')
    await expect(repository.setState(draft.id, 'published', 'reviewer')).rejects.toThrow('priority')
    expect(await repository.search('朝南')).toEqual([])
  })

  it('publishes a rule only when every declared source is an active immutable expert version', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-knowledge-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const article = await repository.create({ kind: 'article', title: '阳宅门气依据', tags: ['阳宅'], body: '门为引气之所，应根据实际宅向复核。', sourceLabel: '《阳宅运用篇》p.10-12' }, 'book-importer')
    await repository.setState(article.id, 'in-review', 'book-importer')
    const publishedArticle = await repository.setState(article.id, 'published', 'book-reviewer')
    const sourceVersionId = publishedArticle!.currentPublishedVersionId!
    const rule = await repository.create({
      kind: 'rule', title: '门气待现场复核', tags: ['门气'], body: '宅向未确认时不得下门气结论。', sourceLabel: '专家结构化规则',
      rule: {
        priority: 90,
        sourceVersionIds: [sourceVersionId],
        conflictGroup: 'entrance-qi',
        conditions: [{ fact: 'residence.facing', operator: 'equals', value: 'unknown' }],
        conclusions: [{ code: 'entrance-needs-facing', text: '宅向未确认，门气判断待复核。', level: 'attention', effect: 'needs-confirmation', severity: 'medium' }],
      },
    }, 'rule-editor')
    await repository.setState(rule.id, 'in-review', 'rule-editor')
    const publishedRule = await repository.setState(rule.id, 'published', 'rule-reviewer')

    expect(publishedRule?.rule).toMatchObject({ sourceVersionIds: [sourceVersionId], conflictGroup: 'entrance-qi' })
    expect((await repository.publishedRules())[0]?.rule?.conclusions[0]).toMatchObject({ effect: 'needs-confirmation', severity: 'medium' })
  })

  it('rejects a rule whose declared source is missing, draft or archived', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-knowledge-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const rule = await repository.create({
      kind: 'rule', title: '悬空来源规则', tags: [], body: '不应发布。', sourceLabel: '测试',
      rule: {
        priority: 10,
        sourceVersionIds: ['missing:v1:hash'],
        conditions: [{ fact: 'residence.facing', operator: 'equals', value: 'south' }],
        conclusions: [{ code: 'missing-source', text: '缺少来源。', level: 'attention', effect: 'needs-confirmation' }],
      },
    })
    await repository.setState(rule.id, 'in-review', 'editor')
    await expect(repository.setState(rule.id, 'published', 'reviewer')).rejects.toThrow('active published article or skill version')
    expect(await repository.publishedRules()).toEqual([])
  })

  it('allows single-actor direct publication from draft and records an immutable version', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-knowledge-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const draft = await repository.create({ kind: 'article', title: '一键发布', tags: [], body: '发布资料', sourceLabel: '测试' }, 'same-actor')
    const published = await repository.setState(draft.id, 'published', 'same-actor')

    expect(published).toMatchObject({ state: 'published', submittedForReviewBy: 'same-actor', reviewedBy: 'same-actor' })
    const versions = await repository.listVersions(draft.id)
    expect(versions).toHaveLength(1)
    expect(versions?.[0]).toMatchObject({ version: 1, submittedForReviewBy: 'same-actor', reviewedBy: 'same-actor', publishedBy: 'same-actor' })
  })

  it('serializes concurrent expert writes without losing entries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-knowledge-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    await Promise.all(Array.from({ length: 8 }, (_, index) => repository.create({ kind: 'article', title: `资料 ${index}`, tags: [], body: `正文 ${index}`, sourceLabel: '并发测试' })))
    expect(await repository.list()).toHaveLength(8)
  })

  it('rejects stale direct repository revisions and preserves the winning draft', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-knowledge-'))
    const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const created = await repository.create({ kind: 'article', title: '第一版', tags: [], body: '原文。', sourceLabel: '测试' })
    const revised = await repository.revise(created.id, { kind: 'article', title: '第二版', tags: [], body: '获胜修订。', sourceLabel: '测试' }, 'editor', 1)
    expect(revised).toMatchObject({ version: 2, body: '获胜修订。' })
    await expect(repository.revise(created.id, { kind: 'article', title: '过期版', tags: [], body: '不应写入。', sourceLabel: '测试' }, 'editor', 1))
      .rejects.toBeInstanceOf(KnowledgeRevisionConflictError)
    expect((await repository.list())[0]).toMatchObject({ version: 2, body: '获胜修订。' })
  })

  it('parses strict request fields and deduplicates normalized tags', () => {
    expect(parseKnowledgeAssetRequest({ kind: 'skill', title: ' 流程 ', tags: [' 报告 ', '报告'], body: ' 步骤 ', sourceLabel: ' 专家 ' }, 'create'))
      .toEqual({ kind: 'skill', title: '流程', tags: ['报告'], body: '步骤', sourceLabel: '专家' })
    expect(() => parseKnowledgeAssetRequest({ kind: 'skill', title: '流程', tags: [], body: '步骤', sourceLabel: '专家', extra: true }, 'create'))
      .toThrow('unsupported knowledge field')
  })
})
