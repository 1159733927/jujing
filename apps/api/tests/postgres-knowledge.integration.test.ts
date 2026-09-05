import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { KnowledgePublicationValidationError, KnowledgeRevisionConflictError } from '../src/knowledge.js'
import { PostgresKnowledgeRepository, runMigrations } from '../src/storage/postgres.js'

const connectionString = process.env.TEST_DATABASE_URL
const describeWithDatabase = connectionString ? describe : describe.skip
const ownedSchemas: string[] = []

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

async function createMigratedPool(): Promise<Pool> {
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required')
  const schema = `knowledge_it_${randomUUID().replaceAll('-', '_')}`
  ownedSchemas.push(schema)
  const admin = new Pool({ connectionString })
  await admin.query(`create schema ${quoteIdentifier(schema)}`)
  await admin.end()
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` })
  await runMigrations(pool, fileURLToPath(new URL('../migrations/', import.meta.url)))
  return pool
}

afterEach(async () => {
  if (!connectionString) return
  while (ownedSchemas.length) {
    const schema = ownedSchemas.pop()
    if (!schema?.startsWith('knowledge_it_')) continue
    const admin = new Pool({ connectionString })
    try {
      await admin.query(`drop schema if exists ${quoteIdentifier(schema)} cascade`)
    } finally {
      await admin.end()
    }
  }
})

describeWithDatabase('PostgresKnowledgeRepository two-person review integration', () => {
  it('persists the same submission, review and publication audit as the file repository', async () => {
    const repository = new PostgresKnowledgeRepository(await createMigratedPool())
    try {
      const draft = await repository.create({ kind: 'article', title: '入户动线', tags: ['玄关'], body: '记录可见事实。', sourceLabel: '集成测试' }, 'pg-editor')
      await repository.setState(draft.id, 'in-review', 'pg-editor')
      const published = await repository.setState(draft.id, 'published', 'pg-reviewer')
      expect(published).toMatchObject({ state: 'published', submittedForReviewBy: 'pg-editor', reviewedBy: 'pg-reviewer' })
      expect((await repository.listVersions(draft.id))[0]).toMatchObject({ submittedForReviewBy: 'pg-editor', reviewedBy: 'pg-reviewer', publishedBy: 'pg-reviewer' })
      expect(await repository.search('入户')).toHaveLength(1)
    } finally {
      await repository.close()
    }
  })

  it('rejects self-review transactionally and creates no version', async () => {
    const repository = new PostgresKnowledgeRepository(await createMigratedPool())
    try {
      const draft = await repository.create({ kind: 'article', title: '审核隔离', tags: [], body: '需要双人。', sourceLabel: '集成测试' }, 'same-actor')
      await repository.setState(draft.id, 'in-review', 'same-actor')
      const error = await repository.setState(draft.id, 'published', 'same-actor').catch((reason: unknown) => reason)
      expect(error).toBeInstanceOf(KnowledgePublicationValidationError)
      expect((error as Error).message).toBe('knowledge reviewer must be different from submitter')
      expect((error as Error).message).not.toContain('knowledge_versions_distinct_reviewer')
      expect(await repository.listVersions(draft.id)).toEqual([])
      expect((await repository.list())[0]).toMatchObject({ state: 'in-review', submittedForReviewBy: 'same-actor' })
    } finally {
      await repository.close()
    }
  })

  it('allows only one concurrent revision from the same expected version and preserves the published snapshot', async () => {
    const repository = new PostgresKnowledgeRepository(await createMigratedPool())
    try {
      const draft = await repository.create({
        kind: 'article',
        title: '并发修订基线',
        tags: ['并发'],
        body: '已发布基线正文。',
        sourceLabel: '集成测试',
      }, 'pg-editor')
      await repository.setState(draft.id, 'in-review', 'pg-editor')
      await repository.setState(draft.id, 'published', 'pg-reviewer')
      const immutableVersion = (await repository.listVersions(draft.id))[0]!

      const outcomes = await Promise.allSettled([
        repository.revise(draft.id, {
          kind: 'article',
          title: '并发修订 A',
          tags: ['并发', 'A'],
          body: '修订者 A 的正文。',
          sourceLabel: '集成测试',
        }, 'pg-editor-a', 1),
        repository.revise(draft.id, {
          kind: 'article',
          title: '并发修订 B',
          tags: ['并发', 'B'],
          body: '修订者 B 的正文。',
          sourceLabel: '集成测试',
        }, 'pg-editor-b', 1),
      ])

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
      expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
        reason: expect.any(KnowledgeRevisionConflictError),
      })
      expect((await repository.list())[0]).toMatchObject({ version: 2, state: 'draft' })
      expect(await repository.listVersions(draft.id)).toEqual([immutableVersion])
      expect(await repository.search('已发布基线')).toEqual([immutableVersion])
      expect(await repository.search('修订者')).toEqual([])
    } finally {
      await repository.close()
    }
  })

  it('atomically switches the public pointer on republish and clears it on archive', async () => {
    const repository = new PostgresKnowledgeRepository(await createMigratedPool())
    try {
      const draft = await repository.create({
        kind: 'article', title: '发布指针', tags: ['版本'], body: '线上第一版。', sourceLabel: '集成测试',
      }, 'editor-one')
      await repository.setState(draft.id, 'in-review', 'editor-one')
      const first = await repository.setState(draft.id, 'published', 'reviewer-one')
      const firstVersionId = first?.currentPublishedVersionId
      expect(firstVersionId).toBeTruthy()

      await repository.revise(draft.id, {
        kind: 'article', title: '发布指针', tags: ['版本'], body: '线上第二版。', sourceLabel: '集成测试',
      }, 'editor-two', 1)
      expect((await repository.list())[0]?.currentPublishedVersionId).toBe(firstVersionId)
      expect((await repository.search('第一版'))[0]?.versionId).toBe(firstVersionId)

      await repository.setState(draft.id, 'in-review', 'editor-two')
      const second = await repository.setState(draft.id, 'published', 'reviewer-two')
      expect(second?.currentPublishedVersionId).not.toBe(firstVersionId)
      expect((await repository.search('第二版'))[0]?.versionId).toBe(second?.currentPublishedVersionId)
      expect(await repository.search('第一版')).toEqual([])

      const archived = await repository.setState(draft.id, 'archived', 'archiver')
      expect(archived?.currentPublishedVersionId).toBeUndefined()
      expect(await repository.search('发布指针')).toEqual([])
      expect(await repository.listVersions(draft.id)).toHaveLength(2)
    } finally {
      await repository.close()
    }
  })

  it('treats SQL wildcard characters and backslashes as literal search text', async () => {
    const repository = new PostgresKnowledgeRepository(await createMigratedPool())
    try {
      const publish = async (title: string, body: string) => {
        const draft = await repository.create({
          kind: 'article',
          title,
          tags: [],
          body,
          sourceLabel: '字面检索集成测试',
        }, 'literal-editor')
        await repository.setState(draft.id, 'in-review', 'literal-editor')
        await repository.setState(draft.id, 'published', 'literal-reviewer')
        return draft.id
      }
      const percentId = await publish('百分号 % 样例', '仅应命中字面百分号。')
      const underscoreId = await publish('下划线 _ 样例', '仅应命中字面下划线。')
      const backslashId = await publish('反斜线 \\ 样例', '仅应命中字面反斜线。')
      await publish('普通资产', '这条记录不包含任何特殊符号。')

      expect((await repository.search('%')).map((version) => version.assetId)).toEqual([percentId])
      expect((await repository.search('_')).map((version) => version.assetId)).toEqual([underscoreId])
      expect((await repository.search('\\')).map((version) => version.assetId)).toEqual([backslashId])
      expect(await repository.search('不存在的 Unicode 词')).toEqual([])
    } finally {
      await repository.close()
    }
  })

  it('finds published knowledge from a natural Chinese question without spaces', async () => {
    const repository = new PostgresKnowledgeRepository(await createMigratedPool())
    try {
      const draft = await repository.create({
        kind: 'article',
        title: '住宅入户动线',
        tags: ['玄关', '动线'],
        body: '入户区域应保持通行顺畅，并依据现场证据给出调整建议。',
        sourceLabel: '中文检索集成测试',
      }, 'chinese-editor')
      await repository.setState(draft.id, 'in-review', 'chinese-editor')
      await repository.setState(draft.id, 'published', 'chinese-reviewer')

      const matches = await repository.search('我想改善家中入户区域的动线问题，应该注意什么？')

      expect(matches.map((version) => version.assetId)).toContain(draft.id)
    } finally {
      await repository.close()
    }
  })
})
