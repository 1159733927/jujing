import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KnowledgeRepository } from '../src/knowledge.js'

async function repositoryFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'fengshui-knowledge-grep-'))
  return new KnowledgeRepository(join(directory, 'knowledge.json'))
}

describe('Grep knowledge retrieval', () => {
  it('returns only currently published knowledge versions', async () => {
    const repository = await repositoryFixture()
    const draft = await repository.create({ kind: 'article', title: '草稿玄关', tags: ['玄关'], body: '草稿玄关内容不应进入报告。', sourceLabel: '测试' })
    const inReview = await repository.create({ kind: 'article', title: '审核玄关', tags: ['玄关'], body: '审核玄关内容不应进入报告。', sourceLabel: '测试' })
    await repository.setState(inReview.id, 'in-review', 'editor')
    const published = await repository.create({ kind: 'article', title: '发布玄关', tags: ['玄关'], body: '发布玄关内容可以进入报告。', sourceLabel: '测试' })
    await repository.setState(published.id, 'published', 'reviewer')

    expect((await repository.search('玄关')).map((hit) => hit.title)).toEqual(['发布玄关'])
    expect((await repository.search('玄关')).some((hit) => hit.assetId === draft.id)).toBe(false)
  })

  it('prioritizes an exact Chinese phrase match over separated term matches', async () => {
    const repository = await repositoryFixture()
    const separated = await repository.create({ kind: 'article', title: '分散词', tags: ['客厅', '阳台'], body: '客厅宜保持整洁。阳台另看采光。', sourceLabel: '测试' })
    await repository.setState(separated.id, 'published', 'reviewer')
    const exact = await repository.create({ kind: 'article', title: '精确短语', tags: ['客厅'], body: '客厅连接南向阳台时，先看明堂是否开阔，再看外部遮挡。', sourceLabel: '测试' })
    await repository.setState(exact.id, 'published', 'reviewer')

    const [first] = await repository.search('客厅连接南向阳台')

    expect(first?.title).toBe('精确短语')
    expect(first?.exactExcerpt).toContain('客厅连接南向阳台')
  })

  it('sorts multi-term results by the number of matched query terms', async () => {
    const repository = await repositoryFixture()
    const narrow = await repository.create({ kind: 'article', title: '只讲客厅', tags: ['客厅'], body: '客厅动线要顺。', sourceLabel: '测试' })
    await repository.setState(narrow.id, 'published', 'reviewer')
    const broad = await repository.create({ kind: 'article', title: '客厅采光阳台', tags: ['客厅', '采光', '阳台'], body: '客厅采光与阳台连通要一起判断。', sourceLabel: '测试' })
    await repository.setState(broad.id, 'published', 'reviewer')

    expect((await repository.search('客厅 采光 阳台')).map((hit) => hit.title)).toEqual(['客厅采光阳台', '只讲客厅'])
  })

  it('returns a contextual excerpt that contains the matched query term', async () => {
    const repository = await repositoryFixture()
    const body = `${'前置背景。'.repeat(70)}入户动线需要看第一视觉面和通道压迫。${'后续背景。'.repeat(70)}`
    const asset = await repository.create({ kind: 'article', title: '入户动线', tags: ['入户'], body, sourceLabel: '测试' })
    await repository.setState(asset.id, 'published', 'reviewer')

    const [hit] = await repository.search('入户动线')

    expect(hit?.exactExcerpt).toContain('入户动线')
    expect(hit?.exactExcerpt.length).toBeLessThan(body.length)
  })

  it('returns an empty list when no published knowledge matches', async () => {
    const repository = await repositoryFixture()
    const asset = await repository.create({ kind: 'article', title: '客厅资料', tags: ['客厅'], body: '客厅采光资料。', sourceLabel: '测试' })
    await repository.setState(asset.id, 'published', 'reviewer')

    expect(await repository.search('厨房灶位')).toEqual([])
  })

  it('omits ingestion metadata from user-facing excerpts', async () => {
    const repository = await repositoryFixture()
    const asset = await repository.create({
      kind: 'article',
      title: '户型证据',
      tags: ['户型'],
      body: 'importFingerprint: abc123\nsourceHash: def456\n户型图判断要先区分全屋平面和局部照片。',
      sourceLabel: '测试',
    })
    await repository.setState(asset.id, 'published', 'reviewer')

    const [hit] = await repository.search('户型图')

    expect(hit?.exactExcerpt).toContain('户型图')
    expect(hit?.exactExcerpt).not.toContain('importFingerprint')
    expect(hit?.exactExcerpt).not.toContain('sourceHash')
  })
})
