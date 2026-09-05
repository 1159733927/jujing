import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import type { BaziRuleProfileDefinition } from '@fengshui/domain'
import {
  BaziRuleProfileRevisionConflictError,
  BaziRuleProfileValidationError,
  DuplicateBaziRuleProfileKeyError,
  InvalidBaziRuleProfileTransitionError,
} from '../src/rule-profiles.js'
import { PostgresBaziRuleProfileRepository, runMigrations } from '../src/storage/postgres.js'

const connectionString = process.env.TEST_DATABASE_URL
const describeWithDatabase = connectionString ? describe : describe.skip
const ownedSchemas: string[] = []

const definition: BaziRuleProfileDefinition = {
  timeDefaults: {
    timezone: 'Asia/Shanghai',
    dstPolicy: 'auto',
    useTrueSolarTime: true,
    timeCorrectionRuleVersion: 'true-solar-v3-standard-time-equation-of-time',
    dayBoundary: 'zi-hour-start',
    luckMethod: 'sect1',
  },
  assessments: {
    strength: { enabled: true, method: 'weighted-seasonal-v1', ruleSetVersion: '1.0.0' },
    pattern: { enabled: true, method: 'school-pattern-v1', ruleSetVersion: '1.0.0' },
    shenSha: { enabled: false, method: 'disabled', ruleSetVersion: '1.0.0' },
  },
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

async function createMigratedPool(): Promise<Pool> {
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required')
  const schema = `rule_profile_it_${randomUUID().replaceAll('-', '_')}`
  ownedSchemas.push(schema)
  const admin = new Pool({ connectionString })
  await admin.query(`create schema ${quoteIdentifier(schema)}`)
  await admin.end()
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` })
  await runMigrations(pool, fileURLToPath(new URL('../migrations/', import.meta.url)))
  return pool
}

async function createRepository(): Promise<PostgresBaziRuleProfileRepository> {
  return new PostgresBaziRuleProfileRepository(await createMigratedPool())
}

async function publish(
  repository: PostgresBaziRuleProfileRepository,
  id: string,
  submitter = 'rule-editor',
  reviewer = 'rule-reviewer',
) {
  await repository.setState(id, 'in-review', submitter)
  return repository.setState(id, 'published', reviewer)
}

afterEach(async () => {
  if (!connectionString) return
  while (ownedSchemas.length) {
    const schema = ownedSchemas.pop()
    if (!schema?.startsWith('rule_profile_it_')) continue
    const admin = new Pool({ connectionString })
    try {
      await admin.query(`drop schema if exists ${quoteIdentifier(schema)} cascade`)
    } finally {
      await admin.end()
    }
  }
})

describeWithDatabase('PostgresBaziRuleProfileRepository integration', () => {
  it('creates a draft rule profile with normalized definition metadata', async () => {
    const repository = await createRepository()
    try {
      const created = await repository.create({
        key: 'zi-ping-school',
        name: '子平流派',
        description: '用于集成测试的规则档案',
        workingDefinition: definition,
      }, 'rule-creator')

      expect(created).toMatchObject({
        key: 'zi-ping-school',
        name: '子平流派',
        state: 'draft',
        revision: 1,
        workingDefinition: definition,
        createdBy: 'rule-creator',
        updatedBy: 'rule-creator',
      })
    } finally {
      await repository.close()
    }
  })

  it('rejects duplicate rule profile keys in the database', async () => {
    const repository = await createRepository()
    try {
      const input = { key: 'duplicate-school', name: '重复流派', workingDefinition: definition }
      await repository.create(input, 'rule-creator')

      await expect(repository.create(input, 'rule-creator')).rejects.toBeInstanceOf(DuplicateBaziRuleProfileKeyError)
    } finally {
      await repository.close()
    }
  })

  it('publishes only after editor submission and independent reviewer approval', async () => {
    const repository = await createRepository()
    try {
      const draft = await repository.create({ key: 'reviewed-school', name: '双人审核流派', workingDefinition: definition }, 'creator')
      await repository.setState(draft.id, 'in-review', 'rule-editor')

      const published = await repository.setState(draft.id, 'published', 'rule-reviewer')

      expect(published).toMatchObject({
        state: 'published',
        submittedForReviewBy: 'rule-editor',
        reviewedBy: 'rule-reviewer',
      })
      expect((await repository.listVersions(draft.id))?.[0]).toMatchObject({
        version: 1,
        submittedForReviewBy: 'rule-editor',
        reviewedBy: 'rule-reviewer',
        publishedBy: 'rule-reviewer',
      })
    } finally {
      await repository.close()
    }
  })

  it('rejects publication by the same actor that submitted the rule profile', async () => {
    const repository = await createRepository()
    try {
      const draft = await repository.create({ key: 'self-review-school', name: '自审流派', workingDefinition: definition }, 'creator')
      await repository.setState(draft.id, 'in-review', 'same-actor')

      await expect(repository.setState(draft.id, 'published', 'same-actor'))
        .rejects.toBeInstanceOf(BaziRuleProfileValidationError)
      expect(await repository.listVersions(draft.id)).toEqual([])
      expect((await repository.list())[0]).toMatchObject({ state: 'in-review', submittedForReviewBy: 'same-actor' })
    } finally {
      await repository.close()
    }
  })

  it('preserves the active immutable published version while a later draft is being edited', async () => {
    const repository = await createRepository()
    try {
      const draft = await repository.create({ key: 'immutable-school', name: '不可变快照流派', workingDefinition: definition }, 'creator')
      await publish(repository, draft.id)
      const firstVersion = (await repository.listVersions(draft.id))![0]!

      await repository.revise(draft.id, {
        name: '不可变快照流派第二版',
        workingDefinition: { ...definition, timeDefaults: { ...definition.timeDefaults, luckMethod: 'sect2' } },
      }, 'rule-editor', 1)

      expect(await repository.listVersions(draft.id)).toEqual([firstVersion])
      expect(await repository.listActiveVersions()).toEqual([firstVersion])
      expect(await repository.getActiveVersion(firstVersion.versionId)).toEqual(firstVersion)
    } finally {
      await repository.close()
    }
  })

  it('rejects stale concurrent revisions without overwriting the winner', async () => {
    const repository = await createRepository()
    try {
      const draft = await repository.create({ key: 'concurrent-revise-school', name: '并发修订流派', workingDefinition: definition }, 'creator')

      const outcomes = await Promise.allSettled([
        repository.revise(draft.id, {
          name: '先提交修订',
          workingDefinition: { ...definition, assessments: { ...definition.assessments, shenSha: { enabled: true, method: 'school-shensha-v1', ruleSetVersion: '1.0.0' } } },
        }, 'editor-a', 1),
        repository.revise(draft.id, {
          name: '旧版本不应覆盖',
          workingDefinition: { ...definition, timeDefaults: { ...definition.timeDefaults, luckMethod: 'sect2' } },
        }, 'editor-b', 1),
      ])

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
        reason: expect.any(BaziRuleProfileRevisionConflictError),
      })
      const stored = (await repository.list())[0]!
      expect(stored).toMatchObject({ revision: 2 })
      expect(stored.name).not.toBe('旧版本不应覆盖')
      expect(stored.updatedBy).not.toBe('editor-b')
    } finally {
      await repository.close()
    }
  })

  it('allows only one concurrent publication attempt from the same in-review profile', async () => {
    const repository = await createRepository()
    try {
      const draft = await repository.create({ key: 'concurrent-publish-school', name: '并发发布流派', workingDefinition: definition }, 'creator')
      await repository.setState(draft.id, 'in-review', 'rule-editor')

      const outcomes = await Promise.allSettled([
        repository.setState(draft.id, 'published', 'rule-reviewer-a'),
        repository.setState(draft.id, 'published', 'rule-reviewer-b'),
      ])

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
        reason: expect.any(InvalidBaziRuleProfileTransitionError),
      })
      expect(await repository.listVersions(draft.id)).toHaveLength(1)
      expect((await repository.list())[0]).toMatchObject({ state: 'published' })
    } finally {
      await repository.close()
    }
  })

  it('archives a published profile without deleting its immutable version history', async () => {
    const repository = await createRepository()
    try {
      const draft = await repository.create({ key: 'archived-school', name: '归档流派', workingDefinition: definition }, 'creator')
      await publish(repository, draft.id)
      const publishedVersion = (await repository.listVersions(draft.id))![0]!

      const archived = await repository.setState(draft.id, 'archived', 'archiver')

      expect(archived).toMatchObject({ state: 'archived', archivedBy: 'archiver', currentPublishedVersionId: publishedVersion.versionId })
      expect(await repository.listActiveVersions()).toEqual([])
      expect(await repository.getActiveVersion(publishedVersion.versionId)).toBeUndefined()
      expect(await repository.listVersions(draft.id)).toEqual([publishedVersion])
    } finally {
      await repository.close()
    }
  })
})
