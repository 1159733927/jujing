import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BaziRuleProfileDefinition } from '@fengshui/domain'
import { buildApp } from '../src/app.js'
import { ChartRepository } from '../src/charts.js'
import { demoKnowledgeAssets, shouldSeedDemoKnowledge } from '../src/demo-knowledge.js'
import { DEMO_BAZI_RULE_PROFILE, DEMO_BAZI_RULE_PROFILE_KEY, ensureDemoBaziRuleProfile, shouldSeedDemoBaziRuleProfile } from '../src/demo-rule-profile.js'
import { KnowledgeRepository } from '../src/knowledge.js'
import { MediaStore } from '../src/media.js'
import { ReportRepository } from '../src/repository.js'
import {
  BaziRuleProfileRepository,
  BaziRuleProfileValidationError,
  DuplicateBaziRuleProfileKeyError,
  hashBaziRuleProfileDefinition,
  InvalidBaziRuleProfileTransitionError,
  normalizeBaziRuleProfileDefinition,
} from '../src/rule-profiles.js'
import { createDefaultStores } from '../src/storage/factory.js'

const definition: BaziRuleProfileDefinition = {
  timeDefaults: {
    timezone: 'Asia/Shanghai',
    dstPolicy: 'auto',
    useTrueSolarTime: true,
    dayBoundary: 'zi-hour-start',
    luckMethod: 'sect1',
  },
  assessments: {
    strength: { enabled: true, method: 'weighted-seasonal-v1', ruleSetVersion: '1.0.0' },
    pattern: { enabled: true, method: 'school-pattern-v1', ruleSetVersion: '1.0.0' },
    shenSha: { enabled: false, method: 'disabled', ruleSetVersion: '1.0.0' },
  },
}

const createInput = {
  key: 'demo-school',
  name: '演示流派',
  description: '用于测试的规则档案',
  workingDefinition: definition,
}

const canonicalBirthplace = { placeCode: '330106' } as const

const decisionRule = {
  id: 'day-master-wood',
  priority: 100,
  all: [{ fact: 'dayMaster.element', operator: 'equals', value: 'wood' }],
  output: { code: 'wood-day-master', label: '木日主', targets: ['day'] },
  sourceVersionIds: ['knowledge:expert-note:v1'],
} as const

const decisionTableDefinition: BaziRuleProfileDefinition = {
  schemaVersion: 2,
  timeDefaults: definition.timeDefaults,
  assessments: {
    strength: { enabled: true, method: 'decision-table-v1', ruleSetVersion: '2.0.0', rules: [decisionRule] },
    pattern: { enabled: false, method: 'decision-table-v1', ruleSetVersion: '2.0.0', rules: [] },
    elementPreference: {
      enabled: true,
      method: 'decision-table-v1',
      ruleSetVersion: 'baseline-v1',
      rules: [{ ...decisionRule, id: 'preference-net-positive', all: [{ fact: 'balance.netScore', operator: 'gte', value: 1 }], output: { code: 'reduce-support', label: '扶助偏多，扶抑基线宜泄耗制' } }],
    },
    shenSha: { enabled: false, method: 'decision-table-v1', ruleSetVersion: '2.0.0', rules: [] },
  },
}

afterEach(() => vi.unstubAllEnvs())

async function createRepository(prefix = 'fengshui-rule-profile-') {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  return {
    path: join(directory, 'profiles.json'),
    repository: new BaziRuleProfileRepository(join(directory, 'profiles.json')),
  }
}

async function publish(repository: BaziRuleProfileRepository, id: string, submitter = 'review-author', reviewer = 'publisher') {
  await repository.setState(id, 'in-review', submitter)
  return repository.setState(id, 'published', reviewer)
}

describe('BaziRuleProfileRepository', () => {
  it('publishes immutable normalized snapshots and increments publication versions monotonically', async () => {
    const { repository } = await createRepository()
    const created = await repository.create(createInput, 'creator')
    expect(created).toMatchObject({ key: 'demo-school', state: 'draft', revision: 1, createdBy: 'creator' })

    const firstPublished = await publish(repository, created.id)
    expect(firstPublished).toMatchObject({ state: 'published', reviewedBy: 'publisher' })
    const firstVersions = await repository.listVersions(created.id)
    expect(firstVersions).toHaveLength(1)
    expect(firstVersions![0]).toMatchObject({ version: 1, publishedBy: 'publisher', submittedForReviewBy: 'review-author' })
    expect(firstVersions![0]!.contentHash).toMatch(/^[a-f0-9]{64}$/)
    const immutableFirst = structuredClone(firstVersions![0])
    expect(await repository.listActiveVersions()).toEqual([immutableFirst])
    expect(await repository.getActiveVersion(immutableFirst.versionId)).toEqual(immutableFirst)

    const revised = await repository.revise(created.id, {
      name: '演示流派第二版',
      workingDefinition: {
        ...definition,
        timeDefaults: { ...definition.timeDefaults, luckMethod: 'sect2' },
      },
    }, 'editor', 1)
    expect(revised).toMatchObject({ state: 'draft', revision: 2, updatedBy: 'editor' })
    expect((await repository.listVersions(created.id))![0]).toEqual(immutableFirst)
    expect(await repository.listActiveVersions()).toEqual([immutableFirst])
    expect(await repository.getActiveVersion(immutableFirst.versionId)).toEqual(immutableFirst)

    await repository.setState(created.id, 'in-review', 'second-submitter')
    expect(await repository.listActiveVersions()).toEqual([immutableFirst])
    expect(await repository.getActiveVersion(immutableFirst.versionId)).toEqual(immutableFirst)

    await repository.setState(created.id, 'published', 'second-publisher')
    const versions = await repository.listVersions(created.id)
    expect(versions!.map((version) => version.version)).toEqual([2, 1])
    expect(versions![1]).toEqual(immutableFirst)
    expect(versions![0]!.contentHash).not.toBe(immutableFirst.contentHash)
    expect(await repository.listActiveVersions()).toEqual([versions![0]])

    await repository.setState(created.id, 'archived', 'archiver')
    expect(await repository.listActiveVersions()).toEqual([])
    expect(await repository.getActiveVersion(versions![0]!.versionId)).toBeUndefined()
    await expect(repository.revise(created.id, { name: '第三版草稿', workingDefinition: definition }, 'editor', 2))
      .rejects.toBeInstanceOf(InvalidBaziRuleProfileTransitionError)
  })

  it('rejects illegal transitions and locks an in-review working copy', async () => {
    const { repository } = await createRepository()
    const created = await repository.create(createInput, 'creator')
    await repository.setState(created.id, 'in-review', 'review-author')
    await expect(repository.revise(created.id, { name: '越权修改', workingDefinition: definition }, 'editor', 1)).rejects.toBeInstanceOf(InvalidBaziRuleProfileTransitionError)
    await expect(repository.setState(created.id, 'archived', 'archiver')).rejects.toBeInstanceOf(InvalidBaziRuleProfileTransitionError)
  })

  it('enforces a unique normalized key under serialized writes', async () => {
    const { repository } = await createRepository()
    await repository.create(createInput, 'creator')
    await expect(repository.create({ ...createInput, key: ' demo-school ' }, 'creator')).rejects.toBeInstanceOf(DuplicateBaziRuleProfileKeyError)
  })

  it('serializes concurrent writes without losing profiles', async () => {
    const { repository } = await createRepository()
    await Promise.all(Array.from({ length: 20 }, (_, index) => repository.create({
      ...createInput,
      key: `school-${index}`,
      name: `流派 ${index}`,
    }, 'concurrent-admin')))
    const profiles = await repository.list()
    expect(profiles).toHaveLength(20)
    expect(new Set(profiles.map((profile) => profile.key)).size).toBe(20)
  })

  it('recovers the write queue after a persistence failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-rule-profile-recovery-'))
    const path = join(directory, 'profiles.json')
    let shouldFail = true
    const repository = new BaziRuleProfileRepository(path, async (target, store) => {
      if (shouldFail) {
        shouldFail = false
        throw new Error('simulated disk failure')
      }
      await writeFile(target, JSON.stringify(store), { mode: 0o600 })
    })
    await expect(repository.create(createInput, 'creator')).rejects.toThrow('simulated disk failure')
    const recovered = await repository.create({ ...createInput, key: 'recovered-school' }, 'creator')
    expect(recovered.key).toBe('recovered-school')
    expect(JSON.parse(await readFile(path, 'utf8')).profiles).toHaveLength(1)
  })

  it('rejects malformed definitions and corrupt persisted stores at runtime', async () => {
    const { path, repository } = await createRepository()
    await expect(repository.create({
      ...createInput,
      workingDefinition: { ...definition, unexpected: true } as unknown as BaziRuleProfileDefinition,
    }, 'creator')).rejects.toBeInstanceOf(BaziRuleProfileValidationError)
    await writeFile(path, JSON.stringify({ schemaVersion: 1, profiles: [{ id: 'invalid' }], versions: [] }))
    await expect(repository.list()).rejects.toBeInstanceOf(BaziRuleProfileValidationError)
  })

  it('keeps legacy definitions normalized without schemaVersion and preserves their historical hash', () => {
    expect(normalizeBaziRuleProfileDefinition(definition)).toEqual(definition)
    expect(hashBaziRuleProfileDefinition(definition)).toBe('77ec72ce23e81a7f8019fa2296036007a8c7eff9ced5e84881bfc005123c5f0c')
  })

  it('normalizes a bounded schemaVersion 2 decision table', () => {
    expect(normalizeBaziRuleProfileDefinition(decisionTableDefinition)).toEqual(decisionTableDefinition)
  })

  it('allows published rules to consume objective month-command facts', () => {
    const monthCommandRule = {
      ...decisionRule,
      id: 'month-command-main-qi-visible',
      all: [
        { fact: 'monthCommand.mainQiTenGod', operator: 'equals', value: '正官' },
        { fact: 'monthCommand.mainQiVisibleAt', operator: 'contains', value: ['year', 'hour'] },
        { fact: 'monthCommand.supportsDayMasterBaseline', operator: 'equals', value: false },
      ],
    } as const
    const candidate = {
      ...decisionTableDefinition,
      assessments: {
        ...decisionTableDefinition.assessments,
        pattern: {
          ...decisionTableDefinition.assessments.pattern,
          enabled: true,
          rules: [monthCommandRule],
        },
      },
    }

    expect(normalizeBaziRuleProfileDefinition(candidate).assessments.pattern.rules?.[0]?.all)
      .toEqual(monthCommandRule.all)
  })

  it('keeps historical profiles without element preference readable', () => {
    const legacy = normalizeBaziRuleProfileDefinition(definition)
    expect(legacy.assessments.elementPreference).toBeUndefined()
  })

  it.each([
    ['unknown method', { assessments: { strength: { ...decisionTableDefinition.assessments.strength, method: 'scripts-v1' } } }],
    ['unknown fact path', { assessments: { strength: { ...decisionTableDefinition.assessments.strength, rules: [{ ...decisionRule, all: [{ fact: 'constructor.prototype', operator: 'exists' }] }] } } }],
    ['wrong operator value type', { assessments: { strength: { ...decisionTableDefinition.assessments.strength, rules: [{ ...decisionRule, all: [{ fact: 'fiveElements.counts.wood', operator: 'gt', value: '3' }] }] } } }],
    ['duplicate rule id', { assessments: { strength: { ...decisionTableDefinition.assessments.strength, rules: [decisionRule, decisionRule] } } }],
    ['duplicate rule id across packs', { assessments: { pattern: { ...decisionTableDefinition.assessments.pattern, enabled: true, rules: [decisionRule] } } }],
    ['out-of-range priority', { assessments: { strength: { ...decisionTableDefinition.assessments.strength, rules: [{ ...decisionRule, priority: 10_001 }] } } }],
    ['invalid output target', { assessments: { strength: { ...decisionTableDefinition.assessments.strength, rules: [{ ...decisionRule, output: { ...decisionRule.output, targets: ['luck'] } }] } } }],
    ['missing source version', { assessments: { strength: { ...decisionTableDefinition.assessments.strength, rules: [{ ...decisionRule, sourceVersionIds: [] }] } } }],
    ['enabled empty pack', { assessments: { strength: { ...decisionTableDefinition.assessments.strength, rules: [] } } }],
  ])('rejects invalid schemaVersion 2 definitions: %s', (_label, patch) => {
    const assessmentsPatch = patch.assessments as Record<string, unknown>
    const candidate = {
      ...decisionTableDefinition,
      assessments: { ...decisionTableDefinition.assessments, ...assessmentsPatch },
    }
    expect(() => normalizeBaziRuleProfileDefinition(candidate)).toThrow(BaziRuleProfileValidationError)
  })

  it('rejects oversized schemaVersion 2 rule packs', () => {
    const rules = Array.from({ length: 201 }, (_, index) => ({ ...decisionRule, id: `rule-${index}` }))
    expect(() => normalizeBaziRuleProfileDefinition({
      ...decisionTableDefinition,
      assessments: {
        ...decisionTableDefinition.assessments,
        strength: { ...decisionTableDefinition.assessments.strength, rules },
      },
    })).toThrow(/exceeds 200 entries/)
  })

  it('seeds one idempotent local demo rule profile without enabling automatic test or production writes', async () => {
    const { repository } = await createRepository('fengshui-rule-profile-demo-seed-')
    expect(shouldSeedDemoBaziRuleProfile({ NODE_ENV: 'test' })).toBe(false)
    expect(shouldSeedDemoBaziRuleProfile({ NODE_ENV: 'production' })).toBe(false)
    expect(shouldSeedDemoBaziRuleProfile({ NODE_ENV: 'development' })).toBe(true)
    expect(shouldSeedDemoBaziRuleProfile({ NODE_ENV: 'development', DEMO_SEED_BAZI_RULE_PROFILE: 'false' })).toBe(false)

    const first = await ensureDemoBaziRuleProfile(repository)
    const second = await ensureDemoBaziRuleProfile(repository)
    expect(first).toBeDefined()
    expect(second).toEqual(first)
    expect(first).toMatchObject({
      key: DEMO_BAZI_RULE_PROFILE_KEY,
      name: '演示流派 · 真太阳时',
      version: 1,
      definition: {
        schemaVersion: 2,
        timeDefaults: { timezone: 'Asia/Shanghai', useTrueSolarTime: true, dayBoundary: 'zi-hour-start' },
        assessments: {
          strength: { enabled: false, ruleSetVersion: 'baseline-v1' },
          pattern: { enabled: false },
          elementPreference: { enabled: false, ruleSetVersion: 'baseline-v1' },
          shenSha: { enabled: false },
        },
      },
    })
    expect(await repository.list()).toHaveLength(1)
    expect(await repository.listActiveVersions()).toHaveLength(1)
  })

  it('enables the demo balance baseline only with a traceable published source id', async () => {
    const { repository } = await createRepository('fengshui-rule-profile-demo-sourced-')
    const version = await ensureDemoBaziRuleProfile(repository, 'author', 'reviewer', 'knowledge-real:v1:0123456789abcdef')
    expect(version?.definition.assessments.strength).toMatchObject({ enabled: true, method: 'decision-table-v1', ruleSetVersion: 'baseline-v1' })
    expect(version?.definition.assessments.elementPreference).toMatchObject({ enabled: true, method: 'decision-table-v1', ruleSetVersion: 'baseline-v1' })
    expect(version?.definition.assessments.pattern).toMatchObject({ enabled: true, method: 'decision-table-v1', ruleSetVersion: 'month-command-pattern-baseline-v1' })
    expect(version?.definition.assessments.shenSha).toMatchObject({ enabled: true, method: 'decision-table-v1', ruleSetVersion: 'program-fields-shensha-baseline-v1' })
    const rules = [
      ...(version?.definition.assessments.strength.rules ?? []),
      ...(version?.definition.assessments.pattern.rules ?? []),
      ...(version?.definition.assessments.elementPreference?.rules ?? []),
      ...(version?.definition.assessments.shenSha.rules ?? []),
    ]
    expect(rules).not.toHaveLength(0)
    expect(version?.definition.assessments.pattern.rules).toHaveLength(10)
    expect(version?.definition.assessments.shenSha.rules).toHaveLength(8)
    expect(rules.every((rule) => rule.sourceVersionIds.includes('knowledge-real:v1:0123456789abcdef'))).toBe(true)
  })

  it('publishes a new immutable demo version when a previously seeded profile gains a traceable source', async () => {
    const { repository } = await createRepository('fengshui-rule-profile-demo-upgrade-')
    const initial = await ensureDemoBaziRuleProfile(repository, 'author', 'reviewer')
    const upgraded = await ensureDemoBaziRuleProfile(repository, 'author', 'reviewer', 'knowledge-real:v1:upgrade-source')

    expect(initial?.version).toBe(1)
    expect(initial?.definition.assessments.strength.enabled).toBe(false)
    expect(upgraded?.version).toBe(2)
    expect(upgraded?.definition.assessments.strength.enabled).toBe(true)
    expect(upgraded?.definition.assessments.pattern.enabled).toBe(true)
    expect(upgraded?.definition.assessments.elementPreference?.enabled).toBe(true)
    expect(upgraded?.definition.assessments.shenSha.enabled).toBe(true)
    expect(await repository.listVersions(initial!.profileId)).toHaveLength(2)
  })

  it('upgrades an older sourced demo profile that lacks structured element directions', async () => {
    const { repository } = await createRepository('fengshui-rule-profile-demo-direction-upgrade-')
    const sourceVersionId = 'knowledge-real:v1:direction-source'
    const old = await repository.create({
      ...DEMO_BAZI_RULE_PROFILE,
      workingDefinition: {
        ...DEMO_BAZI_RULE_PROFILE.workingDefinition,
        assessments: {
          strength: {
            enabled: true, method: 'decision-table-v1', ruleSetVersion: 'baseline-v1',
            rules: [{ id: 'baseline.strength.support-heavy', priority: 100, all: [{ fact: 'balance.netScore', operator: 'gte', value: 1 }], output: { code: 'support-heavy', label: '扶助力量偏多' }, sourceVersionIds: [sourceVersionId] }],
          },
          pattern: { enabled: false, method: 'decision-table-v1', ruleSetVersion: 'pending-expert-school-v1', rules: [] },
          elementPreference: {
            enabled: true, method: 'decision-table-v1', ruleSetVersion: 'baseline-v1',
            rules: [{ id: 'baseline.preference.reduce-support', priority: 100, all: [{ fact: 'balance.netScore', operator: 'gte', value: 1 }], output: { code: 'reduce-support', label: '旧版只有文字结论' }, sourceVersionIds: [sourceVersionId] }],
          },
          shenSha: { enabled: false, method: 'decision-table-v1', ruleSetVersion: 'program-fields-only-v1', rules: [] },
        },
      },
    }, 'author')
    await publish(repository, old.id, 'author', 'reviewer')

    const upgraded = await ensureDemoBaziRuleProfile(repository, 'author', 'reviewer', sourceVersionId)
    const preferenceRules = upgraded?.definition.assessments.elementPreference?.rules ?? []

    expect(upgraded?.version).toBe(2)
    expect(upgraded?.definition.assessments.pattern.rules).toHaveLength(10)
    expect(preferenceRules).toHaveLength(30)
    expect(upgraded?.definition.assessments.shenSha.rules).toHaveLength(8)
    expect(preferenceRules.every((rule) => rule.output.elementDirection?.scope === 'support-balance-baseline')).toBe(true)
  })
})

describe('default API store setup', () => {
  it('publishes the local demo rule profile and knowledge only for file-backed development stores', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-default-store-demo-seed-'))
    const stores = await createDefaultStores({
      NODE_ENV: 'development',
      DEMO_SEED_KNOWLEDGE: 'true',
      STORAGE_DRIVER: 'file',
      REPORTS_FILE_PATH: join(directory, 'reports.json'),
      CHARTS_FILE_PATH: join(directory, 'charts.json'),
      KNOWLEDGE_FILE_PATH: join(directory, 'knowledge.json'),
      BAZI_RULE_PROFILES_FILE_PATH: join(directory, 'rule-profiles.json'),
    })
    try {
      const activeVersions = await stores.ruleProfiles.listActiveVersions()
      const publishedKnowledge = await stores.knowledge.search('', Number.MAX_SAFE_INTEGER)
      expect(activeVersions).toEqual([expect.objectContaining({ key: DEMO_BAZI_RULE_PROFILE_KEY })])
      expect(publishedKnowledge).toHaveLength(demoKnowledgeAssets.length)
      expect(publishedKnowledge.filter((version) => version.kind !== 'rule')).toHaveLength(demoKnowledgeAssets.filter((asset) => asset.kind !== 'rule').length)
      expect(publishedKnowledge.filter((version) => version.kind === 'rule')).toHaveLength(demoKnowledgeAssets.filter((asset) => asset.kind === 'rule').length)
    } finally {
      await Promise.all([stores.reports.close(), stores.charts.close(), stores.knowledge.close(), stores.ruleProfiles.close()])
    }
  })

  it('does not automatically seed demo knowledge outside local development or when disabled', () => {
    expect(shouldSeedDemoKnowledge({ NODE_ENV: 'test' })).toBe(false)
    expect(shouldSeedDemoKnowledge({ NODE_ENV: 'production' })).toBe(false)
    expect(shouldSeedDemoKnowledge({ NODE_ENV: 'development' })).toBe(false)
    expect(shouldSeedDemoKnowledge({ NODE_ENV: 'development', DEMO_SEED_KNOWLEDGE: 'true' })).toBe(true)
    expect(shouldSeedDemoKnowledge({ NODE_ENV: 'development', DEMO_SEED_KNOWLEDGE: 'false' })).toBe(false)
  })

  it('keeps fresh local demo stores bootable when professional book sources have not been imported yet', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-default-store-professional-seed-'))
    const stores = await createDefaultStores({
      NODE_ENV: 'development',
      STORAGE_DRIVER: 'file',
      SEED_PROFESSIONAL_KNOWLEDGE: 'true',
      REPORTS_FILE_PATH: join(directory, 'reports.json'),
      CHARTS_FILE_PATH: join(directory, 'charts.json'),
      RESIDENCES_FILE_PATH: join(directory, 'residences.json'),
      KNOWLEDGE_FILE_PATH: join(directory, 'knowledge.json'),
      BAZI_RULE_PROFILES_FILE_PATH: join(directory, 'rule-profiles.json'),
      ACCOUNTS_FILE_PATH: join(directory, 'accounts.json'),
      WENZHEN_FIXTURES_FILE_PATH: join(directory, 'wenzhen-fixtures.json'),
      WENZHEN_EVIDENCE_PATH: join(directory, 'evidence/wenzhen'),
    })
    try {
      expect(await stores.knowledge.publishedRules()).toEqual([])
    } finally {
      await Promise.all([
        stores.reports.close(),
        stores.charts.close(),
        stores.residences.close(),
        stores.knowledge.close(),
        stores.ruleProfiles.close(),
        stores.accounts.close(),
      ])
    }
  })
})

class TestMediaStore extends MediaStore {
  override async exists(): Promise<boolean> { return true }
  override async claim(): Promise<void> {}
  override async releaseClaim(): Promise<void> {}
  override async removeClaimed(): Promise<void> {}
}

describe('bazi rule profile management API', () => {
  it('requires current expectedRevision for rule profile revisions and preserves the winning draft', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'rule-admin-token')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-rule-profile-api-revision-'))
    const ruleProfiles = new BaziRuleProfileRepository(join(directory, 'rule-profiles.json'))
    const app = buildApp(
      new ReportRepository(join(directory, 'reports.json')),
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => 'test report',
      { analyze: async () => [] },
      new ChartRepository(join(directory, 'charts.json')),
      ruleProfiles,
    )
    const authorization = { authorization: 'Bearer rule-admin-token' }
    const created = await app.inject({ method: 'POST', url: '/v1/bazi-rule-profiles', headers: authorization, payload: createInput })
    const profileId = created.json().id as string

    const winner = await app.inject({
      method: 'POST',
      url: `/v1/bazi-rule-profiles/${profileId}/revisions`,
      headers: authorization,
      payload: {
        name: '演示流派第二版',
        workingDefinition: { ...definition, timeDefaults: { ...definition.timeDefaults, luckMethod: 'sect2' } },
        expectedRevision: 1,
      },
    })
    expect(winner.statusCode).toBe(201)
    expect(winner.json()).toMatchObject({ revision: 2, name: '演示流派第二版' })

    const stale = await app.inject({
      method: 'POST',
      url: `/v1/bazi-rule-profiles/${profileId}/revisions`,
      headers: authorization,
      payload: {
        name: '旧修订不应覆盖',
        workingDefinition: definition,
        expectedRevision: 1,
      },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error).toContain('revision conflict')
    expect((await ruleProfiles.list())[0]).toMatchObject({ revision: 2, name: '演示流派第二版' })
    await app.close()
  })

  it('fails closed when a v2 rule references an unknown knowledge version and publishes after the source exists', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'rule-admin-token')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-rule-profile-source-validation-'))
    const ruleProfiles = new BaziRuleProfileRepository(join(directory, 'rule-profiles.json'))
    const knowledge = new KnowledgeRepository(join(directory, 'knowledge.json'))
    const source = await knowledge.create({
      kind: 'article', title: '机制测试来源', tags: ['测试'], body: '仅用于验证不可变来源引用。', sourceLabel: '测试资料',
    })
    await knowledge.setState(source.id, 'in-review', 'knowledge-editor')
    await knowledge.setState(source.id, 'published', 'knowledge-reviewer')
    const sourceVersion = (await knowledge.listVersions(source.id))[0]!
    const sourcedDefinition: BaziRuleProfileDefinition = {
      ...decisionTableDefinition,
      assessments: {
        ...decisionTableDefinition.assessments,
        strength: {
          ...decisionTableDefinition.assessments.strength,
          rules: [{ ...decisionRule, sourceVersionIds: [sourceVersion.versionId] }],
        },
        elementPreference: {
          ...decisionTableDefinition.assessments.elementPreference!,
          rules: decisionTableDefinition.assessments.elementPreference!.rules!.map((rule) => ({
            ...rule,
            sourceVersionIds: [sourceVersion.versionId],
          })),
        },
      },
    }
    const app = buildApp(
      new ReportRepository(join(directory, 'reports.json')),
      new TestMediaStore(join(directory, 'uploads')),
      knowledge,
      async () => 'test report',
      { analyze: async () => [] },
      new ChartRepository(join(directory, 'charts.json')),
      ruleProfiles,
    )
    const authorization = { authorization: 'Bearer rule-admin-token' }

    const invalid = await app.inject({ method: 'POST', url: '/v1/bazi-rule-profiles', headers: authorization, payload: {
      key: 'missing-source', name: '缺失来源', workingDefinition: decisionTableDefinition,
    } })
    const rejected = await app.inject({ method: 'POST', url: `/v1/bazi-rule-profiles/${invalid.json().id}/state`, headers: authorization, payload: { state: 'published' } })
    expect(rejected.statusCode).toBe(400)
    expect(rejected.json().error).toContain('referenced knowledge version not found')

    const valid = await app.inject({ method: 'POST', url: '/v1/bazi-rule-profiles', headers: authorization, payload: {
      key: 'known-source', name: '已发布来源', workingDefinition: sourcedDefinition,
    } })
    expect((await app.inject({ method: 'POST', url: `/v1/bazi-rule-profiles/${valid.json().id}/state`, headers: authorization, payload: { state: 'published' } })).statusCode).toBe(200)
    await app.close()
  })

  it('executes an active schemaVersion 2 decision table and returns traceable assessments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-rule-profile-v2-calculation-'))
    const ruleProfiles = new BaziRuleProfileRepository(join(directory, 'rule-profiles.json'))
    const workingDefinition: BaziRuleProfileDefinition = {
      ...decisionTableDefinition,
      assessments: {
        ...decisionTableDefinition.assessments,
        strength: {
          enabled: true,
          method: 'decision-table-v1',
          ruleSetVersion: 'mechanism-test-v1',
          rules: [{
            id: 'mechanism-always-covered',
            priority: 100,
            all: [{ fact: 'fiveElements.counts.wood', operator: 'gte', value: 0 }],
            output: { code: 'mechanism-result-a', label: '机制测试结果 A' },
            sourceVersionIds: ['knowledge:test:v1'],
          }],
        },
      },
    }
    const profile = await ruleProfiles.create({ key: 'v2-mechanism', name: 'V2 机制测试', workingDefinition }, 'author')
    await publish(ruleProfiles, profile.id)
    const version = (await ruleProfiles.listActiveVersions())[0]!
    const app = buildApp(
      new ReportRepository(join(directory, 'reports.json')),
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => 'test report',
      { analyze: async () => [] },
      new ChartRepository(join(directory, 'charts.json')),
      ruleProfiles,
    )

    const publicVersions = await app.inject({ method: 'GET', url: '/v1/bazi-rule-profile-versions/active' })
    expect(publicVersions.statusCode).toBe(200)
    expect(publicVersions.json()[0].definition.assessments.strength).toEqual({
      enabled: true,
      method: 'decision-table-v1',
      ruleSetVersion: 'mechanism-test-v1',
    })
    expect(publicVersions.json()[0].definition.assessments.strength.rules).toBeUndefined()

    const calculated = await app.inject({ method: 'POST', url: '/v1/bazi', payload: {
      date: '1992-08-18', time: '09:30', ...canonicalBirthplace,
      ruleProfileVersionId: version.versionId,
    } })

    expect(calculated.statusCode).toBe(200)
    expect(calculated.json().bazi.assessments).toMatchObject({
      strength: {
        status: 'derived',
        conclusion: '机制测试结果 A',
        provenance: {
          profileVersionId: version.versionId,
          profileContentHash: version.contentHash,
          assessment: 'strength',
          matchedRuleIds: ['mechanism-always-covered'],
          sourceVersionIds: ['knowledge:test:v1'],
          factsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
      pattern: { status: 'pending-school-rule', reason: 'disabled' },
      shenSha: { status: 'pending-school-rule', reason: 'disabled' },
    })
    await app.close()
  })

  it('requires administrator authorization and records only the configured server actor', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'rule-admin-token')
    vi.stubEnv('ADMIN_ACTOR_ID', 'trusted-admin')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-rule-profile-api-'))
    const ruleProfiles = new BaziRuleProfileRepository(join(directory, 'rule-profiles.json'))
    const app = buildApp(
      new ReportRepository(join(directory, 'reports.json')),
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => 'test report',
      { analyze: async () => [] },
      new ChartRepository(join(directory, 'charts.json')),
      ruleProfiles,
    )
    const authorization = { authorization: 'Bearer rule-admin-token' }

    expect((await app.inject({ method: 'GET', url: '/v1/bazi-rule-profiles' })).statusCode).toBe(401)
    const untrustedActor = await app.inject({
      method: 'POST',
      url: '/v1/bazi-rule-profiles',
      headers: authorization,
      payload: { ...createInput, actor: 'request-supplied-actor' },
    })
    expect(untrustedActor.statusCode).toBe(400)

    const created = await app.inject({ method: 'POST', url: '/v1/bazi-rule-profiles', headers: authorization, payload: createInput })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ createdBy: 'trusted-admin', updatedBy: 'trusted-admin' })
    const id = created.json().id as string

    expect((await app.inject({ method: 'POST', url: `/v1/bazi-rule-profiles/${id}/state`, headers: authorization, payload: { state: 'published' } })).statusCode).toBe(200)

    const versions = await app.inject({ method: 'GET', url: `/v1/bazi-rule-profiles/${id}/versions`, headers: authorization })
    expect(versions.statusCode).toBe(200)
    expect(versions.json()).toEqual([expect.objectContaining({ version: 1, publishedBy: 'trusted-admin', submittedForReviewBy: 'trusted-admin' })])
    const list = await app.inject({ method: 'GET', url: '/v1/bazi-rule-profiles', headers: authorization })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toHaveLength(1)
    await app.close()
  })

  it('uses only an active publication, applies omitted defaults, and pins each chart history version', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'rule-admin-token')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-rule-profile-calculation-'))
    const ruleProfiles = new BaziRuleProfileRepository(join(directory, 'rule-profiles.json'))
    const app = buildApp(
      new ReportRepository(join(directory, 'reports.json')),
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => 'test report',
      { analyze: async () => [] },
      new ChartRepository(join(directory, 'charts.json')),
      ruleProfiles,
    )
    const authorization = { authorization: 'Bearer rule-admin-token' }
    const created = await app.inject({ method: 'POST', url: '/v1/bazi-rule-profiles', headers: authorization, payload: createInput })
    const profileId = created.json().id as string
    await app.inject({ method: 'POST', url: `/v1/bazi-rule-profiles/${profileId}/state`, headers: authorization, payload: { state: 'published' } })
    const active = await app.inject({ method: 'GET', url: '/v1/bazi-rule-profile-versions/active' })
    expect(active.statusCode).toBe(200)
    expect(active.json()).toHaveLength(1)
    const firstVersionId = active.json()[0].versionId as string

    const calculated = await app.inject({ method: 'POST', url: '/v1/bazi', payload: {
      date: '1992-08-18', time: '09:30', ...canonicalBirthplace,
      ruleProfileVersionId: firstVersionId,
    } })
    expect(calculated.statusCode).toBe(200)
    expect(calculated.json()).toMatchObject({
      birth: { timezone: 'Asia/Shanghai', dstPolicy: 'auto', useTrueSolarTime: true, dayBoundary: 'zi-hour-start', luckMethod: 'sect1' },
      ruleProfileVersion: { profileId, versionId: firstVersionId, version: 1, key: 'demo-school' },
    })

    const explicitOverride = await app.inject({ method: 'POST', url: '/v1/bazi', payload: {
      date: '1992-08-18', time: '09:30', ...canonicalBirthplace,
      ruleProfileVersionId: firstVersionId, useTrueSolarTime: false, dayBoundary: 'midnight', luckMethod: 'sect2', dstPolicy: 'ignore',
    } })
    expect(explicitOverride.statusCode).toBe(200)
    expect(explicitOverride.json().birth).toMatchObject({ useTrueSolarTime: false, dayBoundary: 'midnight', luckMethod: 'sect2', dstPolicy: 'ignore' })

    const firstChart = await app.inject({ method: 'POST', url: '/v1/charts', payload: {
      date: '1992-08-18', time: '09:30', ...canonicalBirthplace,
      ruleProfileVersionId: firstVersionId,
    } })
    expect(firstChart.statusCode).toBe(201)
    const cookie = String(firstChart.headers['set-cookie']).split(';')[0]
    const chartProfileId = firstChart.json().profile.id as string

    await app.inject({
      method: 'POST', url: `/v1/bazi-rule-profiles/${profileId}/revisions`, headers: authorization,
      payload: { name: '演示流派第二版', workingDefinition: { ...definition, timeDefaults: { ...definition.timeDefaults, luckMethod: 'sect2' } }, expectedRevision: 1 },
    })
    expect((await app.inject({ method: 'POST', url: '/v1/bazi', payload: {
      date: '1992-08-18', time: '09:30', ...canonicalBirthplace,
      ruleProfileVersionId: firstVersionId,
    } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/v1/bazi-rule-profile-versions/active' })).json()[0].versionId).toBe(firstVersionId)
    await app.inject({ method: 'POST', url: `/v1/bazi-rule-profiles/${profileId}/state`, headers: authorization, payload: { state: 'published' } })
    const activeSecond = await app.inject({ method: 'GET', url: '/v1/bazi-rule-profile-versions/active' })
    const secondVersionId = activeSecond.json()[0].versionId as string
    expect(secondVersionId).not.toBe(firstVersionId)

    const secondChart = await app.inject({ method: 'POST', url: `/v1/charts/${chartProfileId}/versions`, headers: { cookie }, payload: {
      date: '1992-08-18', time: '10:30', ...canonicalBirthplace,
      expectedRevision: 1, ruleProfileVersionId: secondVersionId,
    } })
    expect(secondChart.statusCode).toBe(200)
    const history = await app.inject({ method: 'GET', url: `/v1/charts/${chartProfileId}/versions`, headers: { cookie } })
    expect(history.json().versions.map((version: { ruleProfileVersion?: { versionId: string } }) => version.ruleProfileVersion?.versionId)).toEqual([secondVersionId, firstVersionId])
    await app.close()
  })

  it('binds report-created chart versions to the selected active rule and rejects chart rule mismatches', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'rule-admin-token')
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-rule-profile-report-'))
    const ruleProfiles = new BaziRuleProfileRepository(join(directory, 'rule-profiles.json'))
    const app = buildApp(
      new ReportRepository(join(directory, 'reports.json')),
      new TestMediaStore(join(directory, 'uploads')),
      new KnowledgeRepository(join(directory, 'knowledge.json')),
      async () => 'test report',
      { analyze: async () => [] },
      new ChartRepository(join(directory, 'charts.json')),
      ruleProfiles,
    )
    const authorization = { authorization: 'Bearer rule-admin-token' }
    const created = await app.inject({ method: 'POST', url: '/v1/bazi-rule-profiles', headers: authorization, payload: createInput })
    const profileId = created.json().id as string
    await app.inject({ method: 'POST', url: `/v1/bazi-rule-profiles/${profileId}/state`, headers: authorization, payload: { state: 'published' } })
    const firstVersionId = (await app.inject({ method: 'GET', url: '/v1/bazi-rule-profile-versions/active' })).json()[0].versionId as string
    const reportPayload = {
      visionConsent: true,
      birth: { date: '1992-08-18', time: '09:30', ...canonicalBirthplace },
      residence: { facing: 'south' },
      photos: [{ fileId: 'rule-report-photo.jpg', room: 'living-room', facing: 'south' }],
    }
    const firstReport = await app.inject({ method: 'POST', url: '/v1/reports', payload: { ...reportPayload, ruleProfileVersionId: firstVersionId } })
    expect(firstReport.statusCode).toBe(202)
    expect(firstReport.json().submission).toMatchObject({ ruleProfileVersionId: firstVersionId, birth: { luckMethod: 'sect1' } })
    const cookie = String(firstReport.headers['set-cookie']).split(';')[0]
    const firstChart = await app.inject({ method: 'GET', url: '/v1/charts/current', headers: { cookie } })
    expect(firstChart.json().profile).toMatchObject({ revision: 1, currentVersion: { ruleProfileVersion: { versionId: firstVersionId } } })

    await app.inject({
      method: 'POST', url: `/v1/bazi-rule-profiles/${profileId}/revisions`, headers: authorization,
      payload: { name: '演示流派第二版', workingDefinition: { ...definition, timeDefaults: { ...definition.timeDefaults, luckMethod: 'sect2' } }, expectedRevision: 1 },
    })
    await app.inject({ method: 'POST', url: `/v1/bazi-rule-profiles/${profileId}/state`, headers: authorization, payload: { state: 'published' } })
    const secondVersionId = (await app.inject({ method: 'GET', url: '/v1/bazi-rule-profile-versions/active' })).json()[0].versionId as string
    const secondReport = await app.inject({
      method: 'POST', url: '/v1/reports', headers: { cookie }, payload: { ...reportPayload, ruleProfileVersionId: secondVersionId },
    })
    expect(secondReport.statusCode).toBe(202)
    expect(secondReport.json().submission).toMatchObject({ ruleProfileVersionId: secondVersionId, birth: { luckMethod: 'sect2' } })
    const secondChart = await app.inject({ method: 'GET', url: '/v1/charts/current', headers: { cookie } })
    expect(secondChart.json().profile).toMatchObject({ revision: 2, currentVersion: { ruleProfileVersion: { versionId: secondVersionId } } })
    const chartProfileId = secondChart.json().profile.id as string
    const chartVersionId = secondChart.json().profile.currentVersion.id as string
    const history = await app.inject({ method: 'GET', url: `/v1/charts/${chartProfileId}/versions`, headers: { cookie } })
    expect(history.json().versions.map((version: { ruleProfileVersion?: { versionId: string } }) => version.ruleProfileVersion?.versionId)).toEqual([secondVersionId, firstVersionId])

    const mismatch = await app.inject({
      method: 'POST', url: '/v1/reports', headers: { cookie }, payload: {
        ...reportPayload, chartProfileId, chartVersionId, ruleProfileVersionId: firstVersionId,
      },
    })
    expect(mismatch.statusCode).toBe(409)
    const matching = await app.inject({
      method: 'POST', url: '/v1/reports', headers: { cookie }, payload: {
        ...reportPayload, chartProfileId, chartVersionId, ruleProfileVersionId: secondVersionId,
      },
    })
    expect(matching.statusCode).toBe(202)
    expect(matching.json().submission.ruleProfileVersionId).toBe(secondVersionId)
    await app.close()
  })
})
