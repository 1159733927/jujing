import { fileURLToPath } from 'node:url'
import type { ChartStore } from '../charts.js'
import { ChartRepository } from '../charts.js'
import type { KnowledgeStore } from '../knowledge.js'
import { KnowledgeRepository } from '../knowledge.js'
import type { ReportStore } from '../repository.js'
import { ReportRepository } from '../repository.js'
import type { ResidenceStore } from '../residences.js'
import { ResidenceRepository } from '../residences.js'
import type { BaziRuleProfileStore } from '../rule-profiles.js'
import { BaziRuleProfileRepository } from '../rule-profiles.js'
import { ensureDemoBaziRuleProfile, shouldSeedDemoBaziRuleProfile } from '../demo-rule-profile.js'
import { seedDemoKnowledge, shouldSeedDemoKnowledge } from '../demo-knowledge.js'
import { seedProfessionalKnowledge } from '../professional-knowledge.js'
import { FileWenzhenFixtureStore, type WenzhenFixtureStore } from '../wenzhen-store.js'
import { FileWenzhenEvidenceStore } from '../wenzhen-evidence-store.js'
import { FileAccountStore, type AccountStore } from '../auth.js'
import {
  PostgresAccountRepository,
  PostgresBaziRuleProfileRepository,
  createPostgresPool,
  PostgresChartRepository,
  PostgresKnowledgeRepository,
  PostgresReportRepository,
  PostgresResidenceRepository,
  PostgresWenzhenFixtureRepository,
  runMigrations,
} from './postgres.js'

export type StorageDriver = 'file' | 'postgres'

export interface StorageConfig {
  driver: StorageDriver
  databaseUrl?: string
  reportsPath: string
  chartsPath: string
  residencesPath: string
  knowledgePath: string
  ruleProfilesPath: string
  wenzhenFixturesPath: string
  wenzhenEvidencePath: string
  migrationsPath: string
  accountsPath: string
}

export interface AppStores {
  reports: ReportStore
  charts: ChartStore
  residences: ResidenceStore
  knowledge: KnowledgeStore
  ruleProfiles: BaziRuleProfileStore
  wenzhenFixtures: WenzhenFixtureStore
  wenzhenEvidence: FileWenzhenEvidenceStore
  accounts: AccountStore
}

function isMissingProfessionalSourceError(error: unknown): boolean {
  return error instanceof Error
    && /^expected exactly one active published expert source for .+, found 0$/u.test(error.message)
}

const defaultReportsPath = fileURLToPath(new URL('../../../../.data/reports.json', import.meta.url))
const defaultChartsPath = fileURLToPath(new URL('../../../../.data/charts.json', import.meta.url))
const defaultResidencesPath = fileURLToPath(new URL('../../../../.data/residences.json', import.meta.url))
const defaultKnowledgePath = fileURLToPath(new URL('../../../../.data/knowledge.json', import.meta.url))
const defaultRuleProfilesPath = fileURLToPath(new URL('../../../../.data/bazi-rule-profiles.json', import.meta.url))
const defaultWenzhenFixturesPath = fileURLToPath(new URL('../../../../.data/wenzhen-fixture-store.json', import.meta.url))
const defaultWenzhenEvidencePath = fileURLToPath(new URL('../../../../.data/evidence/wenzhen/', import.meta.url))
const defaultMigrationsPath = fileURLToPath(new URL('../../migrations/', import.meta.url))
const defaultAccountsPath = fileURLToPath(new URL('../../../../.data/accounts.json', import.meta.url))

export function resolveStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const rawDriver = env.STORAGE_DRIVER as StorageDriver | undefined
  if (rawDriver && rawDriver !== 'file' && rawDriver !== 'postgres') throw new Error('STORAGE_DRIVER must be file or postgres')
  const driver: StorageDriver = rawDriver ?? (env.NODE_ENV === 'production' ? 'postgres' : 'file')
  if (env.NODE_ENV === 'production' && driver !== 'postgres') throw new Error('production requires STORAGE_DRIVER=postgres')
  if (driver === 'postgres' && !env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required when STORAGE_DRIVER=postgres')
  return {
    driver,
    databaseUrl: env.DATABASE_URL,
    reportsPath: env.REPORTS_FILE_PATH ?? defaultReportsPath,
    chartsPath: env.CHARTS_FILE_PATH ?? defaultChartsPath,
    residencesPath: env.RESIDENCES_FILE_PATH ?? defaultResidencesPath,
    knowledgePath: env.KNOWLEDGE_FILE_PATH ?? defaultKnowledgePath,
    ruleProfilesPath: env.BAZI_RULE_PROFILES_FILE_PATH ?? defaultRuleProfilesPath,
    wenzhenFixturesPath: env.WENZHEN_FIXTURES_FILE_PATH ?? defaultWenzhenFixturesPath,
    wenzhenEvidencePath: env.WENZHEN_EVIDENCE_PATH ?? defaultWenzhenEvidencePath,
    migrationsPath: env.MIGRATIONS_PATH ?? defaultMigrationsPath,
    accountsPath: env.ACCOUNTS_FILE_PATH ?? defaultAccountsPath,
  }
}

export async function createDefaultStores(env: NodeJS.ProcessEnv = process.env): Promise<AppStores> {
  const config = resolveStorageConfig(env)
  if (config.driver === 'file') {
    const stores = {
      reports: new ReportRepository(config.reportsPath),
      charts: new ChartRepository(config.chartsPath),
      residences: new ResidenceRepository(config.residencesPath),
      knowledge: new KnowledgeRepository(config.knowledgePath),
      ruleProfiles: new BaziRuleProfileRepository(config.ruleProfilesPath),
      wenzhenFixtures: new FileWenzhenFixtureStore(config.wenzhenFixturesPath),
      wenzhenEvidence: new FileWenzhenEvidenceStore(config.wenzhenEvidencePath),
      accounts: new FileAccountStore(config.accountsPath),
    }
    if (shouldSeedDemoKnowledge(env)) {
      const demoActor = env.ADMIN_ACTOR_ID?.trim() || 'local-demo-editor'
      await seedDemoKnowledge(stores.knowledge, demoActor, demoActor)
    }
    if (env.SEED_PROFESSIONAL_KNOWLEDGE === 'true') {
      try {
        await seedProfessionalKnowledge(stores.knowledge, 'local-professional-rule-editor', 'local-professional-rule-reviewer')
      } catch (error) {
        // Automatic local startup must remain usable before the expert PDFs have
        // been imported. The explicit seedProfessionalKnowledge() API still
        // fails closed, so missing book evidence cannot silently publish rules.
        if (!isMissingProfessionalSourceError(error)) throw error
      }
    }
    if (shouldSeedDemoBaziRuleProfile(env)) {
      const baselineSource = (await stores.knowledge.search('扶抑 baseline-v1', 10))
        .find((version) => version.title === '程序方法档案 B1')
      await ensureDemoBaziRuleProfile(stores.ruleProfiles, 'local-demo-seed-author', 'local-demo-seed-reviewer', baselineSource?.versionId)
    }
    return stores
  }
  const pool = createPostgresPool(config.databaseUrl!)
  let closed = false
  const sharedPool = {
    query: pool.query.bind(pool),
    connect: pool.connect.bind(pool),
    end: async () => {
      if (closed) return
      closed = true
      await pool.end()
    },
  }
  await runMigrations(pool, config.migrationsPath)
  return {
    reports: new PostgresReportRepository(sharedPool),
    charts: new PostgresChartRepository(sharedPool),
    residences: new PostgresResidenceRepository(sharedPool),
    knowledge: new PostgresKnowledgeRepository(sharedPool),
    ruleProfiles: new PostgresBaziRuleProfileRepository(sharedPool),
    wenzhenFixtures: new PostgresWenzhenFixtureRepository(sharedPool),
    wenzhenEvidence: new FileWenzhenEvidenceStore(config.wenzhenEvidencePath),
    accounts: new PostgresAccountRepository(sharedPool),
  }
}
