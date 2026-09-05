import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KnowledgeRepository } from '../src/knowledge.js'
import { PROFESSIONAL_RULE_TITLES, seedProfessionalKnowledge } from '../src/professional-knowledge.js'

const sourceTitles = [
  '中州派【玄空风水】第5篇-阳宅运用篇 p.1-3 第五篇阳宅运用篇',
  '中州派【玄空风水】第5篇-阳宅运用篇 p.4-9 第一章阳宅选择',
  '中州派【玄空风水】第5篇-阳宅运用篇 p.10-12 第二章内六事布局',
  '中州派【玄空风水】第5篇-阳宅运用篇 p.13-14 第二节家具',
  '中州派【玄空风水】第5篇-阳宅运用篇 p.15-20 第一节外局推断',
  '中州派【玄空风水】第5篇-阳宅运用篇 p.21-25 第一节外局推断',
  '中州派【玄空风水】第5篇-阳宅运用篇 p.26 第一节外局推断',
  '中州派【玄空风水】第5篇-阳宅运用篇 p.27-29 第一节化煞方位',
] as const

async function repositoryWithPublishedSources() {
  const directory = await mkdtemp(join(tmpdir(), 'fengshui-professional-rules-'))
  const repository = new KnowledgeRepository(join(directory, 'knowledge.json'))
  for (const title of sourceTitles) {
    const source = await repository.create({
      kind: 'article',
      title,
      tags: ['中州派', '阳宅运用篇'],
      body: `${title} 的测试原文。`,
      sourceLabel: `${title.match(/p\.[^ ]+/)?.[0] ?? '页码'} 专家原书`,
    }, 'book-importer')
    await repository.setState(source.id, 'in-review', 'book-importer')
    await repository.setState(source.id, 'published', 'book-reviewer')
  }
  return repository
}

describe('professional knowledge seed', () => {
  it('publishes at least ten repeatable, source-bound rules without claiming person-house compatibility', async () => {
    const repository = await repositoryWithPublishedSources()

    const first = await seedProfessionalKnowledge(repository, 'professional-rule-editor', 'professional-rule-reviewer')
    const second = await seedProfessionalKnowledge(repository, 'professional-rule-editor', 'professional-rule-reviewer')
    const rules = await repository.publishedRules()
    const activeSources = new Set((await repository.list())
      .filter((asset) => asset.kind !== 'rule' && asset.state === 'published')
      .flatMap((asset) => asset.currentPublishedVersionId ? [asset.currentPublishedVersionId] : []))

    expect(PROFESSIONAL_RULE_TITLES.length).toBeGreaterThanOrEqual(10)
    expect(first).toMatchObject({ created: PROFESSIONAL_RULE_TITLES.length, published: PROFESSIONAL_RULE_TITLES.length, reused: 0 })
    expect(second).toMatchObject({ created: 0, published: 0, reused: PROFESSIONAL_RULE_TITLES.length })
    expect(rules).toHaveLength(PROFESSIONAL_RULE_TITLES.length)
    expect(new Set(rules.map((rule) => rule.title)).size).toBe(PROFESSIONAL_RULE_TITLES.length)

    for (const version of rules) {
      expect(version.sourceLabel).toBe('中州派玄空风水·专家结构化规则')
      expect(version.tags.join(' ')).not.toMatch(/demo|演示/i)
      expect(version.submittedForReviewBy).toBe('professional-rule-editor')
      expect(version.reviewedBy).toBe('professional-rule-reviewer')
      expect(version.rule?.sourceVersionIds?.length).toBeGreaterThan(0)
      expect(version.rule?.sourceVersionIds?.every((id) => activeSources.has(id))).toBe(true)
      expect(version.rule?.conclusions.every((conclusion) => ['neutral', 'needs-confirmation'].includes(conclusion.effect ?? 'neutral'))).toBe(true)
      expect(version.rule?.conclusions.every((conclusion) => !['supportive', 'conflict'].includes(conclusion.effect ?? 'neutral'))).toBe(true)
      for (const sourceVersionId of version.rule?.sourceVersionIds ?? []) {
        expect(await repository.getVersion(sourceVersionId)).toBeDefined()
      }
    }
  })

  it('fails closed when one required book section is not an active published version', async () => {
    const repository = await repositoryWithPublishedSources()
    const source = (await repository.list()).find((asset) => asset.title.includes('p.26 第一节外局推断'))!
    await repository.setState(source.id, 'archived', 'book-archiver')

    await expect(seedProfessionalKnowledge(repository, 'professional-rule-editor', 'professional-rule-reviewer'))
      .rejects.toThrow('expected exactly one active published expert source for p.26 第一节外局推断, found 0')
    expect(await repository.publishedRules()).toEqual([])
  })

  it('requires separate editor and reviewer actors', async () => {
    const repository = await repositoryWithPublishedSources()
    await expect(seedProfessionalKnowledge(repository, 'same-actor', 'same-actor'))
      .rejects.toThrow('professional rule editor and reviewer must be different actors')
  })
})
