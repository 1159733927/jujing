import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { Pool, type QueryResult, type QueryResultRow } from 'pg'
import type {
  BaziCalculationInput,
  BaziCalculationResult,
  BaziChart,
  BaziRuleProfile,
  BaziRuleProfileDefinition,
  BaziRuleProfileState,
  BaziRuleProfileVersionReference,
  BirthInput,
  ChartProfile,
  ChartProfileMetadata,
  ChartVersion,
  ManualFourPillarsChart,
  ManualFourPillarsInput,
  PrincipalRecord,
  UserAccount,
  UserSession,
  PublishedBaziRuleProfileVersion,
  ReportRecord,
  ResidenceProfile,
  ResidenceSnapshot,
  ResidenceVersion,
} from '@fengshui/domain'
import type {
  ExpertAsset,
  PublishedKnowledgeVersion,
  PublicationState,
} from '@fengshui/knowledge-contracts'
import {
  validateWenzhenFixture,
  type ReportableWenzhenFixture,
} from '@fengshui/bazi-engine/wenzhen-fixtures'
import { ChartProfileAlreadyExistsError, ChartProfileLimitExceededError, ChartRevisionConflictError, ChartVersionRestoreConflictError, type ChartStore } from '../charts.js'
import { validateStructuredRule } from '../rules.js'
import {
  InvalidKnowledgeTransitionError,
  KnowledgePublicationValidationError,
  KnowledgeRevisionConflictError,
  isAllowedKnowledgeTransition,
  grepPublishedKnowledge,
  knowledgeSearchTerms,
  normalizeKnowledgeAssetInput,
  normalizeKnowledgeActor,
  publishedSnapshot,
  type AuditedExpertAsset,
  type AuditedPublishedKnowledgeVersion,
  type CreateAssetInput,
  type KnowledgeStore,
} from '../knowledge.js'
import { LostReportLeaseError, ReportArchiveConflictError, type ReportLeaseFence, type ReportLeaseOptions, type ReportStore } from '../repository.js'
import { ResidenceRevisionConflictError, ResidenceVersionRestoreConflictError, normalizeResidenceSnapshot, type ResidenceStore } from '../residences.js'
import type { WenzhenFixtureStore } from '../wenzhen-store.js'
import {
  BaziRuleProfileReferencedError,
  BaziRuleProfileRevisionConflictError,
  BaziRuleProfileValidationError,
  DuplicateBaziRuleProfileKeyError,
  InvalidBaziRuleProfileTransitionError,
  hashBaziRuleProfileDefinition,
  isAllowedBaziRuleProfileTransition,
  isBaziRuleProfileState,
  normalizeBaziRuleProfileActor,
  normalizeBaziRuleProfileCreateInput,
  normalizeBaziRuleProfileDefinition,
  normalizeBaziRuleProfileRevisionInput,
  type BaziRuleProfileStore,
  type CreateBaziRuleProfileInput,
  type ReviseBaziRuleProfileInput,
} from '../rule-profiles.js'
import { normalizeUsername, type AccountStore, type StoredUserAccount } from '../auth.js'

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>
}

export interface PoolLike extends Queryable {
  connect(): Promise<PoolClientLike>
  end(): Promise<void>
}

export interface PoolClientLike extends Queryable {
  release(): void
}

export function createPostgresPool(connectionString: string): Pool {
  return new Pool({ connectionString })
}

export async function runMigrations(pool: PoolLike, migrationsDirectory: string): Promise<void> {
  const filenames = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort()
  const client = await pool.connect()
  await client.query('begin')
  try {
    await client.query('select pg_advisory_xact_lock(746387195)')
    await client.query('create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now())')
    for (const filename of filenames) {
      const applied = await client.query<{ filename: string }>('select filename from schema_migrations where filename = $1', [filename])
      if (applied.rowCount) continue
      const sql = await readFile(join(migrationsDirectory, filename), 'utf8')
      await client.query(sql)
      await client.query('insert into schema_migrations (filename) values ($1)', [filename])
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export class PostgresAccountRepository implements AccountStore {
  constructor(private readonly pool: PoolLike) {}
  async createUser(input: { username: string; displayName: string; passwordHash: string }): Promise<UserAccount> {
    const now = new Date().toISOString()
    const result = await this.pool.query<UserAccountRow>(`insert into user_accounts (id,username,display_name,password_hash,status,created_at,updated_at) values ($1,$2,$3,$4,'active',$5,$5) returning *`, [crypto.randomUUID(), normalizeUsername(input.username), input.displayName.trim(), input.passwordHash, now])
    return publicUserFromRow(result.rows[0]!)
  }
  async listUsers(): Promise<UserAccount[]> { return (await this.pool.query<UserAccountRow>('select * from user_accounts order by created_at desc')).rows.map(publicUserFromRow) }
  async findUserByUsername(username: string): Promise<StoredUserAccount | undefined> { const row = (await this.pool.query<UserAccountRow>('select * from user_accounts where username=$1', [normalizeUsername(username)])).rows[0]; return row ? storedUserFromRow(row) : undefined }
  async getUser(id: string): Promise<UserAccount | undefined> { const row = (await this.pool.query<UserAccountRow>('select * from user_accounts where id=$1', [id])).rows[0]; return row ? publicUserFromRow(row) : undefined }
  async setUserStatus(id: string, status: UserAccount['status']): Promise<UserAccount | undefined> {
    const client = await this.pool.connect(); await client.query('begin')
    try { const row = (await client.query<UserAccountRow>('update user_accounts set status=$2,updated_at=now() where id=$1 returning *', [id, status])).rows[0]; if (status === 'disabled') await client.query('delete from user_sessions where user_id=$1', [id]); await client.query('commit'); return row ? publicUserFromRow(row) : undefined } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
  }
  async setPassword(id: string, passwordHash: string): Promise<UserAccount | undefined> {
    const client = await this.pool.connect(); await client.query('begin')
    try { const row = (await client.query<UserAccountRow>('update user_accounts set password_hash=$2,updated_at=now() where id=$1 returning *', [id, passwordHash])).rows[0]; await client.query('delete from user_sessions where user_id=$1', [id]); await client.query('commit'); return row ? publicUserFromRow(row) : undefined } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
  }
  async bindPrincipal(userId: string, principalId: string): Promise<UserAccount | undefined> { const row = (await this.pool.query<UserAccountRow>('update user_accounts set principal_id=coalesce(principal_id,$2),updated_at=case when principal_id is null then now() else updated_at end where id=$1 returning *', [userId, principalId])).rows[0]; return row ? publicUserFromRow(row) : undefined }
  async recordLogin(userId: string, loggedInAt: string): Promise<UserAccount | undefined> { const row = (await this.pool.query<UserAccountRow>('update user_accounts set last_login_at=$2 where id=$1 returning *', [userId, loggedInAt])).rows[0]; return row ? publicUserFromRow(row) : undefined }
  async createSession(session: UserSession): Promise<void> { await this.pool.query('insert into user_sessions (id,user_id,token_hash,expires_at,created_at) values ($1,$2,$3,$4,$5)', [session.id, session.userId, session.tokenHash, session.expiresAt, session.createdAt]) }
  async findSessionByTokenHash(tokenHash: string): Promise<{ session: UserSession; user: UserAccount } | undefined> {
    const row = (await this.pool.query<UserSessionUserRow>(`select s.id session_id,s.user_id,s.token_hash,s.expires_at,s.created_at session_created_at,u.* from user_sessions s join user_accounts u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now()`, [tokenHash])).rows[0]
    return row ? { session: { id: row.session_id, userId: row.user_id, tokenHash: row.token_hash, expiresAt: timestamp(row.expires_at), createdAt: timestamp(row.session_created_at) }, user: publicUserFromRow(row) } : undefined
  }
  async revokeSession(tokenHash: string): Promise<void> { await this.pool.query('delete from user_sessions where token_hash=$1', [tokenHash]) }
  async revokeUserSessions(userId: string): Promise<void> { await this.pool.query('delete from user_sessions where user_id=$1', [userId]) }
  async ping(): Promise<void> { await this.pool.query('select 1') }
  async close(): Promise<void> { await this.pool.end() }
}

export class PostgresReportRepository implements ReportStore {
  constructor(private readonly pool: PoolLike) {}

  async get(id: string): Promise<ReportRecord | undefined> {
    const result = await this.pool.query<{ payload: ReportRecord }>('select payload from reports where id = $1', [id])
    return result.rows[0]?.payload
  }

  async getOwned(id: string, principalId: string): Promise<ReportRecord | undefined> {
    const result = await this.pool.query<{ payload: ReportRecord }>(
      `select payload from reports
       where id = $1 and payload->>'principalId' = $2`,
      [id, principalId],
    )
    return result.rows[0]?.payload
  }

  async listQueued(): Promise<ReportRecord[]> {
    const result = await this.pool.query<{ payload: ReportRecord }>("select payload from reports where status = 'queued' and archived_at is null order by created_at asc")
    return result.rows.map((row) => row.payload)
  }

  private claimSql(whereClause: string): string {
    return `
      update reports
      set
        status = 'running',
        updated_at = now(),
        payload = payload || jsonb_build_object(
          'status', 'running',
          'phase', coalesce(payload->>'phase', 'queued'),
          'runLease', jsonb_build_object(
            'workerId', $1::text,
            'leasedAt', $3::text,
            'expiresAt', $2::text,
            'attempt', coalesce(nullif(payload#>>'{runLease,attempt}', '')::int, 0) + 1
          )
        )
      where archived_at is null and ${whereClause}
      returning payload`
  }

  private claimEligibilitySql(nowPlaceholder: string): string {
    return `(status = 'queued' or (status = 'running' and payload#>>'{runLease,expiresAt}' <= ${nowPlaceholder}))`
  }

  async claimReport(id: string, lease: ReportLeaseOptions): Promise<ReportRecord | undefined> {
    const now = lease.now ?? new Date().toISOString()
    const result = await this.pool.query<{ payload: ReportRecord }>(
      this.claimSql(`id = $4 and ${this.claimEligibilitySql('$3')}`),
      [lease.workerId, lease.leaseExpiresAt, now, id],
    )
    return result.rows[0]?.payload
  }

  async claimNextReport(lease: ReportLeaseOptions): Promise<ReportRecord | undefined> {
    const now = lease.now ?? new Date().toISOString()
    const result = await this.pool.query<{ payload: ReportRecord }>(
      `with next_report as (
         select id
         from reports
         where ${this.claimEligibilitySql('$3')}
         order by created_at asc, id asc
         limit 1
         for update skip locked
       )
       ${this.claimSql('id = (select id from next_report)')}`,
      [lease.workerId, lease.leaseExpiresAt, now],
    )
    return result.rows[0]?.payload
  }

  async releaseReportLease(id: string, workerId: string): Promise<void> {
    await this.pool.query(
      `update reports
       set payload = payload - 'runLease', updated_at = now()
       where id = $1 and payload#>>'{runLease,workerId}' = $2`,
      [id, workerId],
    )
  }

  async listByPrincipal(principalId: string, archived = false): Promise<ReportRecord[]> {
    const result = await this.pool.query<{ payload: ReportRecord }>(
      `select payload from reports
       where payload->>'principalId' = $1
         and archived_at is ${archived ? 'not null' : 'null'}
       order by created_at desc, id desc`,
      [principalId],
    )
    return result.rows.map((row) => row.payload)
  }

  async archiveOwned(id: string, principalId: string, archivedAt: string): Promise<ReportRecord | undefined> {
    const result = await this.pool.query<{ payload: ReportRecord }>(
      `update reports
       set
         archived_at = $3::timestamptz,
         updated_at = now(),
         payload = (payload - 'shareAccess' - 'runLease') || jsonb_build_object('archivedAt', $4::text)
       where id = $1
         and payload->>'principalId' = $2
         and archived_at is null
         and status in ('completed', 'failed')
       returning payload`,
      [id, principalId, archivedAt, archivedAt],
    )
    if (result.rows[0]) return result.rows[0].payload
    const owned = await this.pool.query<{ status: ReportRecord['status']; archived_at: string | Date | null }>(
      `select status, archived_at from reports
       where id = $1 and payload->>'principalId' = $2`,
      [id, principalId],
    )
    if (!owned.rows[0]) return undefined
    if (owned.rows[0].archived_at) return undefined
    throw new ReportArchiveConflictError(id, owned.rows[0].status)
  }

  async restoreOwned(id: string, principalId: string): Promise<ReportRecord | undefined> {
    const result = await this.pool.query<{ payload: ReportRecord }>(
      `update reports
       set
         archived_at = null,
         updated_at = now(),
         payload = payload - 'archivedAt' - 'shareAccess' - 'runLease'
       where id = $1
         and payload->>'principalId' = $2
         and archived_at is not null
       returning payload`,
      [id, principalId],
    )
    if (result.rows[0]) return result.rows[0].payload
    const owned = await this.pool.query<{ status: ReportRecord['status']; archived_at: string | Date | null }>(
      `select status, archived_at from reports
       where id = $1 and payload->>'principalId' = $2`,
      [id, principalId],
    )
    if (!owned.rows[0]) return undefined
    return undefined
  }

  async save(record: ReportRecord): Promise<void> {
    await this.pool.query(
      `insert into reports (id, status, created_at, updated_at, payload, chart_version_id, residence_version_id, archived_at, source_report_id)
       values ($1, $2, $3, now(), $4::jsonb, $5, $6, $7, $8)
       on conflict (id) do update set
         status = excluded.status,
         updated_at = now(),
         payload = excluded.payload,
         chart_version_id = excluded.chart_version_id,
         residence_version_id = excluded.residence_version_id,
         archived_at = excluded.archived_at,
         source_report_id = excluded.source_report_id`,
      [record.id, record.status, record.createdAt, JSON.stringify(record), record.chartVersionId ?? null, record.residenceVersionId ?? null, record.archivedAt ?? null, record.sourceReportId ?? null],
    )
  }

  async saveClaimed(record: ReportRecord, fence: ReportLeaseFence): Promise<void> {
    const result = await this.pool.query(
      `update reports
       set
         status = $2,
         updated_at = now(),
         payload = $3::jsonb,
         chart_version_id = $4,
         residence_version_id = $5,
         archived_at = $8,
         source_report_id = $9
       where id = $1
         and payload#>>'{runLease,workerId}' = $6
         and (payload#>>'{runLease,attempt}')::int = $7`,
      [
        record.id,
        record.status,
        JSON.stringify(record),
        record.chartVersionId ?? null,
        record.residenceVersionId ?? null,
        fence.workerId,
        fence.attempt,
        record.archivedAt ?? null,
        record.sourceReportId ?? null,
      ],
    )
    if (result.rowCount !== 1) throw new LostReportLeaseError(record.id)
  }

  async isKnowledgeCited(assetId: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `select exists (
         select 1 from reports
         where payload @> jsonb_build_object('citations', jsonb_build_array(jsonb_build_object('id', $1::text)))
       ) as exists`,
      [assetId],
    )
    return Boolean(result.rows[0]?.exists)
  }

  async reportStats(): Promise<{ total: number; queued: number; completed: number; failed: number; last24h: number }> {
    const result = await this.pool.query<{ total: number; queued: number; completed: number; failed: number; last24h: number }>(
      `select
         count(*)::int as total,
         count(*) filter (where status = 'queued')::int as queued,
         count(*) filter (where status = 'completed')::int as completed,
         count(*) filter (where status = 'failed')::int as failed,
         count(*) filter (where created_at >= now() - interval '24 hours')::int as last24h
       from reports`,
    )
    const row = result.rows[0]
    return { total: row?.total ?? 0, queued: row?.queued ?? 0, completed: row?.completed ?? 0, failed: row?.failed ?? 0, last24h: row?.last24h ?? 0 }
  }

  async ping(): Promise<void> {
    await this.pool.query('select 1')
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

export class PostgresWenzhenFixtureRepository implements WenzhenFixtureStore {
  constructor(private readonly pool: PoolLike) {}

  async list(): Promise<ReportableWenzhenFixture[]> {
    const result = await this.pool.query<{ payload: unknown }>(
      'select payload from wenzhen_fixtures order by created_at asc, sample_id asc',
    )
    return result.rows.map((row, index) => checkedReportableWenzhenFixture(row.payload, `wenzhen_fixtures row ${index}`))
  }

  async append(fixture: ReportableWenzhenFixture): Promise<ReportableWenzhenFixture> {
    const checked = checkedReportableWenzhenFixture(structuredClone(fixture), 'fixture to append')
    try {
      await this.pool.query(
        `insert into wenzhen_fixtures (sample_id, payload)
         values ($1, $2::jsonb)`,
        [checked.sampleId, JSON.stringify(checked)],
      )
    } catch (error) {
      if (postgresErrorCode(error) === '23505') {
        throw new Error(`WenZhen sampleId already exists: ${checked.sampleId}`, { cause: error })
      }
      throw error
    }
    return structuredClone(checked)
  }

  async ping(): Promise<void> {
    await this.pool.query('select 1')
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

export class PostgresChartRepository implements ChartStore {
  constructor(private readonly pool: PoolLike) {}

  async findPrincipalByTokenHash(tokenHash: string): Promise<PrincipalRecord | undefined> {
    const result = await this.pool.query<PrincipalRow>('select id, kind, token_hash, created_at from principals where token_hash = $1', [tokenHash])
    return result.rows[0] ? principalFromRow(result.rows[0]) : undefined
  }

  async createPrincipal(input: string | PrincipalRecord): Promise<PrincipalRecord> {
    const now = new Date().toISOString()
    const principal = typeof input === 'string' ? {
      id: crypto.randomUUID(),
      kind: 'anonymous' as const,
      tokenHash: input,
      createdAt: now,
    } : input
    const result = await this.pool.query<PrincipalRow>(
      `insert into principals (id, kind, token_hash, created_at)
       values ($1, $2, $3, $4)
       on conflict (token_hash) do update set token_hash = excluded.token_hash
       returning id, kind, token_hash, created_at`,
      [principal.id, principal.kind, principal.tokenHash, principal.createdAt],
    )
    return principalFromRow(result.rows[0]!)
  }

  async getCurrentProfile(principalId: string): Promise<ChartProfile | undefined> {
    const result = await this.pool.query<ChartProfileRow>(
      `select p.id, p.principal_id, p.label, p.relationship, p.revision, p.created_at, p.updated_at, p.deleted_at,
              v.id as version_id, v.version, v.calculation_input, v.birth, v.bazi,
              v.rule_profile_version_id, v.rule_profile_version, v.restored_from_version_id,
              v.created_at as version_created_at
       from chart_profiles p
       join chart_versions v on v.id = p.current_version_id
       where p.principal_id = $1 and p.deleted_at is null
       order by p.updated_at desc, p.id asc
       limit 1`,
      [principalId],
    )
    return result.rows[0] ? chartProfileFromRow(result.rows[0]) : undefined
  }

  async listProfiles(principalId: string, includeDeleted = false): Promise<ChartProfile[]> {
    const result = await this.pool.query<ChartProfileRow>(
      `select p.id, p.principal_id, p.label, p.relationship, p.revision, p.created_at, p.updated_at, p.deleted_at,
              v.id as version_id, v.version, v.calculation_input, v.birth, v.bazi,
              v.rule_profile_version_id, v.rule_profile_version, v.restored_from_version_id,
              v.created_at as version_created_at
       from chart_profiles p
       join chart_versions v on v.id = p.current_version_id
       where p.principal_id = $1 and ($2::boolean or p.deleted_at is null)
       order by p.updated_at desc, p.id asc`,
      [principalId, includeDeleted],
    )
    return result.rows.map(chartProfileFromRow)
  }

  async getProfile(profileId: string, principalId: string): Promise<ChartProfile | undefined> {
    const result = await this.pool.query<ChartProfileRow>(
      `select p.id, p.principal_id, p.label, p.relationship, p.revision, p.created_at, p.updated_at, p.deleted_at,
              v.id as version_id, v.version, v.calculation_input, v.birth, v.bazi,
              v.rule_profile_version_id, v.rule_profile_version, v.restored_from_version_id,
              v.created_at as version_created_at
       from chart_profiles p
       join chart_versions v on v.id = p.current_version_id
       where p.id = $1 and p.principal_id = $2 and p.deleted_at is null`,
      [profileId, principalId],
    )
    return result.rows[0] ? chartProfileFromRow(result.rows[0]) : undefined
  }

  async listVersions(profileId: string, principalId: string): Promise<ChartVersion[] | undefined> {
    const owner = await this.pool.query<{ id: string }>(
      'select id from chart_profiles where id = $1 and principal_id = $2',
      [profileId, principalId],
    )
    if (!owner.rowCount) return undefined
    const result = await this.pool.query<ChartVersionRow>(
      `select id, profile_id, version, calculation_input, birth, bazi, rule_profile_version_id, rule_profile_version, restored_from_version_id, created_at
       from chart_versions where profile_id = $1 order by version desc`,
      [profileId],
    )
    return result.rows.map(chartVersionFromRow)
  }

  async getVersion(profileId: string, principalId: string, versionId: string): Promise<ChartVersion | undefined> {
    const result = await this.pool.query<ChartVersionRow>(
      `select v.id, v.profile_id, v.version, v.calculation_input, v.birth, v.bazi,
              v.rule_profile_version_id, v.rule_profile_version, v.restored_from_version_id, v.created_at
       from chart_versions v
       join chart_profiles p on p.id = v.profile_id
       where v.id = $1 and v.profile_id = $2 and p.principal_id = $3`,
      [versionId, profileId, principalId],
    )
    return result.rows[0] ? chartVersionFromRow(result.rows[0]) : undefined
  }

  async createProfile(
    principalId: string,
    calculationInput: BaziCalculationInput,
    bazi: BaziCalculationResult,
    metadata: ChartProfileMetadata,
    ruleProfileVersion?: BaziRuleProfileVersionReference,
  ): Promise<ChartProfile> {
    const client = await this.pool.connect()
    await client.query('begin')
    try {
      const now = new Date().toISOString()
      const profileId = crypto.randomUUID()
      const versionId = crypto.randomUUID()
      const snapshot = postgresCalculationSnapshot(calculationInput, bazi)
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 130013))', [principalId])
      const active = await client.query<{ count: number }>(
        'select count(*)::int as count from chart_profiles where principal_id = $1 and deleted_at is null',
        [principalId],
      )
      if ((active.rows[0]?.count ?? 0) >= 10) {
        throw new ChartProfileLimitExceededError()
      }
      await client.query(
        `insert into chart_profiles (id, principal_id, label, relationship, revision, current_version_id, created_at, updated_at)
         values ($1, $2, $3, $4, 1, null, $5, $5)`,
        [profileId, principalId, metadata.label, metadata.relationship, now],
      )
      await client.query(
        `insert into chart_versions
          (id, profile_id, version, calculation_input, birth, bazi, rule_profile_version_id, rule_profile_version, created_at)
         values ($1, $2, 1, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8)`,
        [
          versionId,
          profileId,
          JSON.stringify(snapshot.calculationInput),
          snapshot.birth ? JSON.stringify(snapshot.birth) : null,
          JSON.stringify(snapshot.bazi),
          ruleProfileVersion?.versionId ?? null,
          ruleProfileVersion ? JSON.stringify(ruleProfileVersion) : null,
          now,
        ],
      )
      const result = await client.query<ChartProfileRow>(
        `update chart_profiles p
         set current_version_id = $2
         from chart_versions v
         where p.id = $1 and v.id = $2
         returning p.id, p.principal_id, p.label, p.relationship, p.revision, p.created_at, p.updated_at, p.deleted_at,
                   v.id as version_id, v.version, v.calculation_input, v.birth, v.bazi,
                   v.rule_profile_version_id, v.rule_profile_version, v.restored_from_version_id,
                   v.created_at as version_created_at`,
        [profileId, versionId],
      )
      await client.query('commit')
      return chartProfileFromRow(result.rows[0]!)
    } catch (error) {
      await client.query('rollback')
      if ((error as { code?: string }).code === '23505') throw new ChartProfileAlreadyExistsError()
      throw error
    } finally {
      client.release()
    }
  }

  async appendVersion(
    profileId: string,
    principalId: string,
    expectedRevision: number,
    calculationInput: BaziCalculationInput,
    bazi: BaziCalculationResult,
    ruleProfileVersion?: BaziRuleProfileVersionReference,
  ): Promise<ChartProfile | undefined> {
    const client = await this.pool.connect()
    await client.query('begin')
    try {
      const current = await client.query<ProfileLockRow>(
        'select id, revision from chart_profiles where id = $1 and principal_id = $2 and deleted_at is null for update',
        [profileId, principalId],
      )
      const locked = current.rows[0]
      if (!locked) {
        await client.query('commit')
        return undefined
      }
      if (locked.revision !== expectedRevision) throw new ChartRevisionConflictError()
      const now = new Date().toISOString()
      const nextRevision = locked.revision + 1
      const versionId = crypto.randomUUID()
      const snapshot = postgresCalculationSnapshot(calculationInput, bazi)
      await client.query(
        `insert into chart_versions
          (id, profile_id, version, calculation_input, birth, bazi, rule_profile_version_id, rule_profile_version, created_at)
         values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9)`,
        [
          versionId,
          profileId,
          nextRevision,
          JSON.stringify(snapshot.calculationInput),
          snapshot.birth ? JSON.stringify(snapshot.birth) : null,
          JSON.stringify(snapshot.bazi),
          ruleProfileVersion?.versionId ?? null,
          ruleProfileVersion ? JSON.stringify(ruleProfileVersion) : null,
          now,
        ],
      )
      const result = await client.query<ChartProfileRow>(
        `update chart_profiles p
         set revision = $3, current_version_id = $2, updated_at = $4
         from chart_versions v
         where p.id = $1 and v.id = $2
         returning p.id, p.principal_id, p.label, p.relationship, p.revision, p.created_at, p.updated_at, p.deleted_at,
                   v.id as version_id, v.version, v.calculation_input, v.birth, v.bazi,
                   v.rule_profile_version_id, v.rule_profile_version, v.restored_from_version_id,
                   v.created_at as version_created_at`,
        [profileId, versionId, nextRevision, now],
      )
      await client.query('commit')
      return chartProfileFromRow(result.rows[0]!)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async restoreVersion(
    profileId: string,
    principalId: string,
    sourceVersionId: string,
    expectedRevision: number,
  ): Promise<ChartProfile | undefined> {
    const client = await this.pool.connect()
    await client.query('begin')
    try {
      const current = await client.query<ProfileLockRow>(
        'select id, revision, current_version_id, deleted_at from chart_profiles where id = $1 and principal_id = $2 for update',
        [profileId, principalId],
      )
      const locked = current.rows[0]
      if (!locked) {
        await client.query('commit')
        return undefined
      }
      if (locked.deleted_at) throw new ChartVersionRestoreConflictError('cannot restore a version from a deleted chart profile')
      if (locked.revision !== expectedRevision) throw new ChartRevisionConflictError()
      if (locked.current_version_id === sourceVersionId) {
        throw new ChartVersionRestoreConflictError('current chart version cannot be restored')
      }
      const source = await client.query<ChartVersionRow>(
        `select id, profile_id, version, calculation_input, birth, bazi, rule_profile_version_id, rule_profile_version, restored_from_version_id, created_at
         from chart_versions where id = $1 and profile_id = $2`,
        [sourceVersionId, profileId],
      )
      const sourceVersion = source.rows[0]
      if (!sourceVersion) {
        await client.query('commit')
        return undefined
      }
      const now = new Date().toISOString()
      const nextRevision = locked.revision + 1
      const versionId = crypto.randomUUID()
      const sourceSnapshot = postgresCalculationSnapshotFromRow(sourceVersion)
      await client.query(
        `insert into chart_versions
          (id, profile_id, version, calculation_input, birth, bazi, rule_profile_version_id, rule_profile_version, restored_from_version_id, created_at)
         values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9, $10)`,
        [
          versionId,
          profileId,
          nextRevision,
          JSON.stringify(sourceSnapshot.calculationInput),
          sourceSnapshot.birth == null ? null : JSON.stringify(sourceSnapshot.birth),
          JSON.stringify(sourceSnapshot.bazi),
          sourceVersion.rule_profile_version_id,
          sourceVersion.rule_profile_version ? JSON.stringify(sourceVersion.rule_profile_version) : null,
          sourceVersion.id,
          now,
        ],
      )
      const result = await client.query<ChartProfileRow>(
        `update chart_profiles p
         set revision = $3, current_version_id = $2, updated_at = $4
         from chart_versions v
         where p.id = $1 and v.id = $2
         returning p.id, p.principal_id, p.label, p.relationship, p.revision, p.created_at, p.updated_at, p.deleted_at,
                   v.id as version_id, v.version, v.calculation_input, v.birth, v.bazi,
                   v.rule_profile_version_id, v.rule_profile_version, v.restored_from_version_id,
                   v.created_at as version_created_at`,
        [profileId, versionId, nextRevision, now],
      )
      await client.query('commit')
      return chartProfileFromRow(result.rows[0]!)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async softDeleteProfile(profileId: string, principalId: string): Promise<boolean> {
    const result = await this.pool.query(
      'update chart_profiles set deleted_at = now() where id = $1 and principal_id = $2 and deleted_at is null',
      [profileId, principalId],
    )
    return Boolean(result.rowCount)
  }

  async restoreProfile(profileId: string, principalId: string): Promise<ChartProfile | undefined> {
    const client = await this.pool.connect()
    await client.query('begin')
    try {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 130013))', [principalId])
      const active = await client.query<{ count: number }>(
        'select count(*)::int as count from chart_profiles where principal_id = $1 and deleted_at is null',
        [principalId],
      )
      if ((active.rows[0]?.count ?? 0) >= 10) {
        throw new ChartProfileLimitExceededError()
      }
      const result = await client.query<ChartProfileRow>(
        `update chart_profiles p
         set deleted_at = null, updated_at = now()
         from chart_versions v
         where p.id = $1 and p.principal_id = $2 and p.deleted_at is not null and v.id = p.current_version_id
         returning p.id, p.principal_id, p.label, p.relationship, p.revision, p.created_at, p.updated_at, p.deleted_at,
                   v.id as version_id, v.version, v.calculation_input, v.birth, v.bazi,
                   v.rule_profile_version_id, v.rule_profile_version, v.restored_from_version_id,
                   v.created_at as version_created_at`,
        [profileId, principalId],
      )
      await client.query('commit')
      return result.rows[0] ? chartProfileFromRow(result.rows[0]) : undefined
    } catch (error) {
      await client.query('rollback')
      if (postgresErrorCode(error) === '23505') throw new ChartProfileAlreadyExistsError()
      throw error
    } finally {
      client.release()
    }
  }

  async referencesRuleProfile(profileId: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `select exists (
         select 1 from chart_versions cv
         join bazi_rule_profile_versions v on v.version_id = cv.rule_profile_version_id
         where v.profile_id = $1
       ) as exists`,
      [profileId],
    )
    return Boolean(result.rows[0]?.exists)
  }

  async chartStats(): Promise<{ total: number; active: number; deleted: number }> {
    const result = await this.pool.query<{ total: number; active: number; deleted: number }>(
      `select
         count(*)::int as total,
         count(*) filter (where deleted_at is null)::int as active,
         count(*) filter (where deleted_at is not null)::int as deleted
       from chart_profiles`,
    )
    const row = result.rows[0]
    return { total: row?.total ?? 0, active: row?.active ?? 0, deleted: row?.deleted ?? 0 }
  }

  async ping(): Promise<void> {
    await this.pool.query('select 1')
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

export class PostgresResidenceRepository implements ResidenceStore {
  constructor(private readonly pool: PoolLike) {}

  async listProfiles(principalId: string): Promise<ResidenceProfile[]> {
    const result = await this.pool.query<ResidenceProfileRow>(
      `select p.id, p.principal_id, p.revision, p.created_at, p.updated_at, p.deleted_at,
              v.id as version_id, v.version, v.snapshot, v.restored_from_version_id,
              v.created_at as version_created_at
       from residence_profiles p
       join residence_versions v on v.id = p.current_version_id
       where p.principal_id = $1 and p.deleted_at is null
       order by p.updated_at desc, p.id asc`,
      [principalId],
    )
    return result.rows.map(residenceProfileFromRow)
  }

  async getProfile(profileId: string, principalId: string): Promise<ResidenceProfile | undefined> {
    const result = await this.pool.query<ResidenceProfileRow>(
      `select p.id, p.principal_id, p.revision, p.created_at, p.updated_at, p.deleted_at,
              v.id as version_id, v.version, v.snapshot, v.restored_from_version_id,
              v.created_at as version_created_at
       from residence_profiles p
       join residence_versions v on v.id = p.current_version_id
       where p.id = $1 and p.principal_id = $2 and p.deleted_at is null`,
      [profileId, principalId],
    )
    return result.rows[0] ? residenceProfileFromRow(result.rows[0]) : undefined
  }

  async listVersions(profileId: string, principalId: string): Promise<ResidenceVersion[] | undefined> {
    const owner = await this.pool.query<{ id: string }>(
      'select id from residence_profiles where id = $1 and principal_id = $2',
      [profileId, principalId],
    )
    if (!owner.rowCount) return undefined
    const result = await this.pool.query<ResidenceVersionRow>(
      `select id, profile_id, version, snapshot, restored_from_version_id, created_at
       from residence_versions where profile_id = $1 order by version desc`,
      [profileId],
    )
    return result.rows.map(residenceVersionFromRow)
  }

  async getVersion(profileId: string, principalId: string, versionId: string): Promise<ResidenceVersion | undefined> {
    const result = await this.pool.query<ResidenceVersionRow>(
      `select v.id, v.profile_id, v.version, v.snapshot, v.restored_from_version_id, v.created_at
       from residence_versions v
       join residence_profiles p on p.id = v.profile_id
       where v.id = $1 and v.profile_id = $2 and p.principal_id = $3`,
      [versionId, profileId, principalId],
    )
    return result.rows[0] ? residenceVersionFromRow(result.rows[0]) : undefined
  }

  async createProfile(principalId: string, snapshot: ResidenceSnapshot): Promise<ResidenceProfile> {
    const client = await this.pool.connect()
    await client.query('begin')
    try {
      const now = new Date().toISOString()
      const profileId = crypto.randomUUID()
      const versionId = crypto.randomUUID()
      await client.query(
        `insert into residence_profiles (id, principal_id, revision, current_version_id, created_at, updated_at)
         values ($1, $2, 1, null, $3, $3)`,
        [profileId, principalId, now],
      )
      await client.query(
        `insert into residence_versions (id, profile_id, version, snapshot, created_at)
         values ($1, $2, 1, $3::jsonb, $4)`,
        [versionId, profileId, JSON.stringify(normalizeResidenceSnapshot(snapshot)), now],
      )
      const result = await client.query<ResidenceProfileRow>(
        `update residence_profiles p
         set current_version_id = $2
         from residence_versions v
         where p.id = $1 and v.id = $2
         returning p.id, p.principal_id, p.revision, p.created_at, p.updated_at, p.deleted_at,
                   v.id as version_id, v.version, v.snapshot, v.restored_from_version_id,
                   v.created_at as version_created_at`,
        [profileId, versionId],
      )
      await client.query('commit')
      return residenceProfileFromRow(result.rows[0]!)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async appendVersion(profileId: string, principalId: string, expectedRevision: number, snapshot: ResidenceSnapshot): Promise<ResidenceProfile | undefined> {
    const client = await this.pool.connect()
    await client.query('begin')
    try {
      const current = await client.query<ProfileLockRow>(
        'select id, revision from residence_profiles where id = $1 and principal_id = $2 and deleted_at is null for update',
        [profileId, principalId],
      )
      const locked = current.rows[0]
      if (!locked) {
        await client.query('commit')
        return undefined
      }
      if (locked.revision !== expectedRevision) throw new ResidenceRevisionConflictError()
      const now = new Date().toISOString()
      const nextRevision = locked.revision + 1
      const versionId = crypto.randomUUID()
      await client.query(
        `insert into residence_versions (id, profile_id, version, snapshot, created_at)
         values ($1, $2, $3, $4::jsonb, $5)`,
        [versionId, profileId, nextRevision, JSON.stringify(normalizeResidenceSnapshot(snapshot)), now],
      )
      const result = await client.query<ResidenceProfileRow>(
        `update residence_profiles p
         set revision = $3, current_version_id = $2, updated_at = $4
         from residence_versions v
         where p.id = $1 and v.id = $2
         returning p.id, p.principal_id, p.revision, p.created_at, p.updated_at, p.deleted_at,
                   v.id as version_id, v.version, v.snapshot, v.restored_from_version_id,
                   v.created_at as version_created_at`,
        [profileId, versionId, nextRevision, now],
      )
      await client.query('commit')
      return residenceProfileFromRow(result.rows[0]!)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async restoreVersion(profileId: string, principalId: string, sourceVersionId: string, expectedRevision: number): Promise<ResidenceProfile | undefined> {
    const client = await this.pool.connect()
    await client.query('begin')
    try {
      const current = await client.query<ProfileLockRow & { current_version_id: string; deleted_at: string | Date | null }>(
        'select id, revision, current_version_id, deleted_at from residence_profiles where id = $1 and principal_id = $2 for update',
        [profileId, principalId],
      )
      const locked = current.rows[0]
      if (!locked) {
        await client.query('commit')
        return undefined
      }
      if (locked.deleted_at) throw new ResidenceVersionRestoreConflictError('cannot restore a version from a deleted residence profile')
      if (locked.revision !== expectedRevision) throw new ResidenceRevisionConflictError()
      if (locked.current_version_id === sourceVersionId) throw new ResidenceVersionRestoreConflictError('current residence version cannot be restored')
      const source = await client.query<ResidenceVersionRow>(
        'select id, profile_id, version, snapshot, restored_from_version_id, created_at from residence_versions where id = $1 and profile_id = $2',
        [sourceVersionId, profileId],
      )
      const sourceVersion = source.rows[0]
      if (!sourceVersion) {
        await client.query('commit')
        return undefined
      }
      const now = new Date().toISOString()
      const nextRevision = locked.revision + 1
      const versionId = crypto.randomUUID()
      await client.query(
        `insert into residence_versions (id, profile_id, version, snapshot, restored_from_version_id, created_at)
         values ($1, $2, $3, $4::jsonb, $5, $6)`,
        [versionId, profileId, nextRevision, JSON.stringify(normalizeResidenceSnapshot(sourceVersion.snapshot as ResidenceSnapshot)), sourceVersion.id, now],
      )
      const result = await client.query<ResidenceProfileRow>(
        `update residence_profiles p
         set revision = $3, current_version_id = $2, updated_at = $4
         from residence_versions v
         where p.id = $1 and v.id = $2
         returning p.id, p.principal_id, p.revision, p.created_at, p.updated_at, p.deleted_at,
                   v.id as version_id, v.version, v.snapshot, v.restored_from_version_id,
                   v.created_at as version_created_at`,
        [profileId, versionId, nextRevision, now],
      )
      await client.query('commit')
      return residenceProfileFromRow(result.rows[0]!)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async softDeleteProfile(profileId: string, principalId: string): Promise<boolean> {
    const result = await this.pool.query(
      'update residence_profiles set deleted_at = now(), updated_at = now() where id = $1 and principal_id = $2 and deleted_at is null',
      [profileId, principalId],
    )
    return Boolean(result.rowCount)
  }

  async restoreProfile(profileId: string, principalId: string): Promise<ResidenceProfile | undefined> {
    const result = await this.pool.query<ResidenceProfileRow>(
      `update residence_profiles p
       set deleted_at = null, updated_at = now()
       from residence_versions v
       where p.id = $1 and p.principal_id = $2 and p.deleted_at is not null and v.id = p.current_version_id
       returning p.id, p.principal_id, p.revision, p.created_at, p.updated_at, p.deleted_at,
                 v.id as version_id, v.version, v.snapshot, v.restored_from_version_id,
                 v.created_at as version_created_at`,
      [profileId, principalId],
    )
    return result.rows[0] ? residenceProfileFromRow(result.rows[0]) : undefined
  }

  async ping(): Promise<void> {
    await this.pool.query('select 1')
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

export class PostgresBaziRuleProfileRepository implements BaziRuleProfileStore {
  constructor(private readonly pool: PoolLike) {}

  async list(): Promise<BaziRuleProfile[]> {
    const result = await this.pool.query<BaziRuleProfileRow>('select * from bazi_rule_profiles order by updated_at desc, id asc')
    return result.rows.map(baziRuleProfileFromRow)
  }

  async listActiveVersions(): Promise<PublishedBaziRuleProfileVersion[]> {
    const result = await this.pool.query<BaziRuleProfileVersionRow>(
      `select v.*
       from bazi_rule_profile_versions v
       join bazi_rule_profiles p
         on p.id = v.profile_id
        and p.state <> 'archived'
        and p.current_published_version_id = v.version_id
       order by v.profile_key asc, v.version_id asc`,
    )
    return result.rows.map(baziRuleProfileVersionFromRow)
  }

  async getActiveVersion(versionId: string): Promise<PublishedBaziRuleProfileVersion | undefined> {
    const result = await this.pool.query<BaziRuleProfileVersionRow>(
      `select v.*
       from bazi_rule_profile_versions v
       join bazi_rule_profiles p
         on p.id = v.profile_id
        and p.state <> 'archived'
        and p.current_published_version_id = v.version_id
       where v.version_id = $1`,
      [versionId],
    )
    return result.rows[0] ? baziRuleProfileVersionFromRow(result.rows[0]) : undefined
  }

  async create(input: CreateBaziRuleProfileInput, actor: string): Promise<BaziRuleProfile> {
    const normalized = normalizeBaziRuleProfileCreateInput(input)
    const normalizedActor = normalizeBaziRuleProfileActor(actor)
    const now = new Date().toISOString()
    try {
      const result = await this.pool.query<BaziRuleProfileRow>(
        `insert into bazi_rule_profiles
          (id, profile_key, name, description, state, revision, working_definition, created_at, created_by, updated_at, updated_by)
         values ($1, $2, $3, $4, 'draft', 1, $5::jsonb, $6, $7, $6, $7)
         returning *`,
        [crypto.randomUUID(), normalized.key, normalized.name, normalized.description ?? null, JSON.stringify(normalized.workingDefinition), now, normalizedActor],
      )
      return baziRuleProfileFromRow(result.rows[0]!)
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new DuplicateBaziRuleProfileKeyError()
      throw error
    }
  }

  async revise(id: string, input: ReviseBaziRuleProfileInput, actor: string, expectedRevision: number): Promise<BaziRuleProfile | undefined> {
    const normalized = normalizeBaziRuleProfileRevisionInput(input)
    const normalizedActor = normalizeBaziRuleProfileActor(actor)
    const client = await this.pool.connect()
    await client.query('begin')
    try {
      const currentResult = await client.query<BaziRuleProfileRow>('select * from bazi_rule_profiles where id = $1 for update', [id])
      if (!currentResult.rows[0]) {
        await client.query('commit')
        return undefined
      }
      const current = baziRuleProfileFromRow(currentResult.rows[0])
      if (current.revision !== expectedRevision) throw new BaziRuleProfileRevisionConflictError()
      if (current.state === 'in-review') throw new InvalidBaziRuleProfileTransitionError('in-review', 'draft')
      if (current.state === 'archived') throw new InvalidBaziRuleProfileTransitionError('archived', 'draft')
      const now = new Date().toISOString()
      const result = await client.query<BaziRuleProfileRow>(
        `update bazi_rule_profiles
         set name = $2, description = $3, state = 'draft', revision = revision + 1,
             working_definition = $4::jsonb, updated_at = $5, updated_by = $6,
             submitted_for_review_at = null, submitted_for_review_by = null,
             reviewed_at = null, reviewed_by = null, archived_at = null, archived_by = null
         where id = $1 and revision = $7
         returning *`,
        [id, normalized.name, normalized.description ?? null, JSON.stringify(normalized.workingDefinition), now, normalizedActor, expectedRevision],
      )
      if (!result.rows[0]) throw new BaziRuleProfileRevisionConflictError()
      await client.query('commit')
      return baziRuleProfileFromRow(result.rows[0]!)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async setState(id: string, state: BaziRuleProfileState, actor: string): Promise<BaziRuleProfile | undefined> {
    if (!isBaziRuleProfileState(state)) throw new BaziRuleProfileValidationError('invalid bazi rule profile state')
    const normalizedActor = normalizeBaziRuleProfileActor(actor)
    const client = await this.pool.connect()
    await client.query('begin')
    try {
      const currentResult = await client.query<BaziRuleProfileRow>('select * from bazi_rule_profiles where id = $1 for update', [id])
      if (!currentResult.rows[0]) {
        await client.query('commit')
        return undefined
      }
      const current = baziRuleProfileFromRow(currentResult.rows[0])
      if (!isAllowedBaziRuleProfileTransition(current.state, state)) {
        throw new InvalidBaziRuleProfileTransitionError(current.state, state)
      }
      const now = new Date().toISOString()
      let result: QueryResult<BaziRuleProfileRow>
      if (state === 'in-review') {
        result = await client.query<BaziRuleProfileRow>(
          `update bazi_rule_profiles
           set state = 'in-review', updated_at = $2, updated_by = $3,
               submitted_for_review_at = $2, submitted_for_review_by = $3
           where id = $1
           returning *`,
          [id, now, normalizedActor],
        )
      } else if (state === 'published') {
        const submittedForReviewAt = current.submittedForReviewAt ?? now
        const submittedForReviewBy = current.submittedForReviewBy ?? normalizedActor
        if (submittedForReviewBy === normalizedActor) {
          throw new BaziRuleProfileValidationError('reviewer must be different from submitter')
        }
        const nextVersionResult = await client.query<{ next_version: number | string }>(
          'select coalesce(max(version), 0) + 1 as next_version from bazi_rule_profile_versions where profile_id = $1',
          [id],
        )
        const version = Number(nextVersionResult.rows[0]?.next_version ?? 1)
        if (!Number.isSafeInteger(version) || version < 1) throw new BaziRuleProfileValidationError('invalid next publication version')
        const definition = normalizeBaziRuleProfileDefinition(current.workingDefinition)
        const contentHash = hashBaziRuleProfileDefinition(definition)
        const versionId = `${current.id}:v${version}:${contentHash.slice(0, 16)}`
        await client.query(
          `insert into bazi_rule_profile_versions
            (version_id, profile_id, version, profile_key, name, description, definition, content_hash,
             submitted_for_review_at, submitted_for_review_by, reviewed_at, reviewed_by, published_at, published_by)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $11, $12)`,
          [
            versionId, current.id, version, current.key, current.name, current.description ?? null,
            JSON.stringify(definition), contentHash, submittedForReviewAt, submittedForReviewBy,
            now, normalizedActor,
          ],
        )
        result = await client.query<BaziRuleProfileRow>(
          `update bazi_rule_profiles
           set state = 'published', current_published_version_id = $2,
               updated_at = $3, updated_by = $4, reviewed_at = $3, reviewed_by = $4,
               submitted_for_review_at = $5, submitted_for_review_by = $6
           where id = $1
           returning *`,
          [id, versionId, now, normalizedActor, submittedForReviewAt, submittedForReviewBy],
        )
      } else {
        result = await client.query<BaziRuleProfileRow>(
          `update bazi_rule_profiles
           set state = 'archived', updated_at = $2, updated_by = $3,
               archived_at = $2, archived_by = $3
           where id = $1
           returning *`,
          [id, now, normalizedActor],
        )
      }
      await client.query('commit')
      return baziRuleProfileFromRow(result.rows[0]!)
    } catch (error) {
      await client.query('rollback')
      if ((error as { code?: string }).code === '23505') throw new DuplicateBaziRuleProfileKeyError()
      throw error
    } finally {
      client.release()
    }
  }

  async listVersions(id: string): Promise<PublishedBaziRuleProfileVersion[] | undefined> {
    const owner = await this.pool.query<{ id: string }>('select id from bazi_rule_profiles where id = $1', [id])
    if (!owner.rowCount) return undefined
    const result = await this.pool.query<BaziRuleProfileVersionRow>(
      'select * from bazi_rule_profile_versions where profile_id = $1 order by version desc',
      [id],
    )
    return result.rows.map(baziRuleProfileVersionFromRow)
  }

  async delete(id: string): Promise<boolean> {
    const client = await this.pool.connect()
    await client.query('begin')
    try {
      await client.query('update bazi_rule_profiles set current_published_version_id = null where id = $1', [id])
      await client.query('delete from bazi_rule_profile_versions where profile_id = $1', [id])
      const result = await client.query('delete from bazi_rule_profiles where id = $1', [id])
      await client.query('commit')
      return Boolean(result.rowCount)
    } catch (error) {
      await client.query('rollback')
      if (postgresErrorCode(error) === '23503') throw new BaziRuleProfileReferencedError()
      throw error
    } finally {
      client.release()
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('select 1')
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

export class PostgresKnowledgeRepository implements KnowledgeStore {
  constructor(private readonly pool: PoolLike) {}

  async list(): Promise<AuditedExpertAsset[]> {
    const result = await this.pool.query<AssetRow>('select * from knowledge_assets order by updated_at desc, id asc')
    return result.rows.map(assetFromRow)
  }

  async listVersions(assetId?: string): Promise<AuditedPublishedKnowledgeVersion[]> {
    const result = assetId
      ? await this.pool.query<VersionRow>('select * from knowledge_versions where asset_id = $1 order by version asc', [assetId])
      : await this.pool.query<VersionRow>('select * from knowledge_versions order by published_at desc, version_id asc')
    return result.rows.map(versionFromRow)
  }

  async getVersion(versionId: string): Promise<AuditedPublishedKnowledgeVersion | undefined> {
    const result = await this.pool.query<VersionRow>('select * from knowledge_versions where version_id = $1', [versionId])
    return result.rows[0] ? versionFromRow(result.rows[0]) : undefined
  }

  async create(input: CreateAssetInput, actor = 'legacy-system-editor'): Promise<AuditedExpertAsset> {
    const normalizedInput = normalizeKnowledgeAssetInput(input)
    const normalizedActor = normalizeKnowledgeActor(actor)
    const now = new Date().toISOString()
    const asset: AuditedExpertAsset = {
      ...normalizedInput,
      id: crypto.randomUUID(),
      version: 1,
      state: 'draft',
      createdAt: now,
      createdBy: normalizedActor,
      updatedAt: now,
      updatedBy: normalizedActor,
    }
    await this.pool.query(
      `insert into knowledge_assets
        (id, version, state, kind, title, tags, body, source_label, created_at, created_by, updated_at, updated_by, rule)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
      assetParams(asset),
    )
    return asset
  }

  async revise(
    id: string,
    input: CreateAssetInput,
    actor = 'legacy-system-editor',
    expectedRevision?: number,
  ): Promise<AuditedExpertAsset | undefined> {
    const normalizedInput = normalizeKnowledgeAssetInput(input)
    const normalizedActor = normalizeKnowledgeActor(actor)
    const client = await this.pool.connect()
    await client.query('begin')
    try {
      const currentResult = await client.query<AssetRow>('select * from knowledge_assets where id = $1 for update', [id])
      const current = currentResult.rows[0] ? assetFromRow(currentResult.rows[0]) : undefined
      if (!current) {
        await client.query('commit')
        return undefined
      }
      if (expectedRevision !== undefined && current.version !== expectedRevision) {
        throw new KnowledgeRevisionConflictError()
      }
      if (current.state === 'in-review') throw new InvalidKnowledgeTransitionError('in-review', 'draft')
      if (current.state === 'archived') throw new InvalidKnowledgeTransitionError('archived', 'draft')
      const revised: AuditedExpertAsset = {
        ...normalizedInput,
        id,
        version: current.version + 1,
        state: 'draft',
        createdAt: current.createdAt,
        createdBy: current.createdBy,
        updatedAt: new Date().toISOString(),
        updatedBy: normalizedActor,
        ...(current.currentPublishedVersionId ? { currentPublishedVersionId: current.currentPublishedVersionId } : {}),
      }
      const result = await client.query<AssetRow>(
        `update knowledge_assets
         set version = $2, state = $3, kind = $4, title = $5, tags = $6::jsonb, body = $7, source_label = $8,
             created_at = $9, created_by = $10, updated_at = $11, updated_by = $12, rule = $13::jsonb,
             submitted_for_review_at = null, submitted_for_review_by = null, reviewed_at = null, reviewed_by = null,
             archived_at = null, archived_by = null
         where id = $1
         returning *`,
        assetParams(revised),
      )
      await client.query('commit')
      return result.rows[0] ? assetFromRow(result.rows[0]) : undefined
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async setState(id: string, state: PublicationState, actor: string): Promise<AuditedExpertAsset | undefined> {
    const normalizedActor = normalizeKnowledgeActor(actor)
    const client = await this.pool.connect()
    await client.query('begin')
    try {
      const currentResult = await client.query<AssetRow>('select * from knowledge_assets where id = $1 for update', [id])
      const current = currentResult.rows[0] ? assetFromRow(currentResult.rows[0]) : undefined
      if (!current) {
        await client.query('commit')
        return undefined
      }
      if (!isAllowedKnowledgeTransition(current.state, state)) {
        throw new InvalidKnowledgeTransitionError(current.state, state)
      }
      if (state === 'published' && current.kind === 'rule') {
        const error = validateStructuredRule(current.rule)
        if (error) throw new Error(error)
      }
      const now = new Date().toISOString()
      let next: AuditedExpertAsset
      if (state === 'in-review') {
        next = { ...current, state, updatedAt: now, updatedBy: normalizedActor, submittedForReviewAt: now, submittedForReviewBy: normalizedActor }
      } else if (state === 'published') {
        // 无审核流：draft 可直接发布；提交元数据缺失时由同一 actor 补齐。
        const submittedForReviewAt = current.submittedForReviewAt ?? now
        const submittedForReviewBy = current.submittedForReviewBy ?? normalizedActor
        const reviewed: AuditedExpertAsset = { ...current, state, updatedAt: now, updatedBy: normalizedActor, submittedForReviewAt, submittedForReviewBy, reviewedAt: now, reviewedBy: normalizedActor }
        const snapshot = publishedSnapshot(reviewed, normalizedActor)
        await insertPublishedVersion(client, snapshot)
        next = { ...reviewed, currentPublishedVersionId: snapshot.versionId }
      } else {
        const { currentPublishedVersionId: _removed, ...withoutPublishedPointer } = current
        next = { ...withoutPublishedPointer, state, updatedAt: now, updatedBy: normalizedActor, archivedAt: now, archivedBy: normalizedActor }
      }
      const saved = await client.query<AssetRow>(
        `update knowledge_assets
         set state = $2, updated_at = $3, updated_by = $4,
             submitted_for_review_at = $5, submitted_for_review_by = $6,
             reviewed_at = $7, reviewed_by = $8,
             archived_at = $9, archived_by = $10, current_published_version_id = $11
         where id = $1 returning *`,
        [next.id, next.state, next.updatedAt, next.updatedBy, next.submittedForReviewAt ?? null, next.submittedForReviewBy ?? null, next.reviewedAt ?? null, next.reviewedBy ?? null, next.archivedAt ?? null, next.archivedBy ?? null, next.currentPublishedVersionId ?? null],
      )
      const asset = assetFromRow(saved.rows[0]!)
      await client.query('commit')
      return asset
    } catch (error) {
      await client.query('rollback')
      if (isPostgresConstraintViolation(error, '23514', 'knowledge_versions_distinct_reviewer')) {
        throw new KnowledgePublicationValidationError('knowledge reviewer must be different from submitter')
      }
      throw error
    } finally {
      client.release()
    }
  }

  async search(query: string, limit = 5): Promise<AuditedPublishedKnowledgeVersion[]> {
    const terms = knowledgeSearchTerms(query)
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 5
    if (!terms.length) {
      const result = await this.pool.query<VersionRow>(
        `select v.* from knowledge_versions v
         join knowledge_assets a on a.id = v.asset_id and a.current_published_version_id = v.version_id
         order by v.published_at desc, v.version_id asc
         limit $1`,
        [safeLimit],
      )
      return result.rows.map(versionFromRow)
    }
    const result = await this.pool.query<VersionRow>(
      `select v.*,
              (select count(*) from unnest($1::text[]) term
               where position(term in lower(v.title || ' ' || v.body || ' ' || v.tags::text)) > 0) as score
       from knowledge_versions v
       join knowledge_assets a on a.id = v.asset_id and a.current_published_version_id = v.version_id
       where exists (
         select 1 from unnest($1::text[]) term
         where position(term in lower(v.title || ' ' || v.body || ' ' || v.tags::text)) > 0
       )
       order by score desc, v.version_id asc
       limit $2`,
      [terms, safeLimit],
    )
    return grepPublishedKnowledge(result.rows.map(versionFromRow), query, safeLimit)
  }

  async publishedRules(): Promise<AuditedPublishedKnowledgeVersion[]> {
    const result = await this.pool.query<VersionRow>(
      `select v.* from knowledge_versions v
       join knowledge_assets a on a.id = v.asset_id and a.current_published_version_id = v.version_id
       where v.kind = 'rule'
       order by v.published_at desc, v.version_id asc`,
    )
    return result.rows.map(versionFromRow)
  }

  async delete(id: string): Promise<boolean> {
    const client = await this.pool.connect()
    await client.query('begin')
    try {
      await client.query('update knowledge_assets set current_published_version_id = null where id = $1', [id])
      await client.query('delete from knowledge_versions where asset_id = $1', [id])
      const result = await client.query('delete from knowledge_assets where id = $1', [id])
      await client.query('commit')
      return Boolean(result.rowCount)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('select 1')
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  private async getAsset(id: string): Promise<AuditedExpertAsset | undefined> {
    const result = await this.pool.query<AssetRow>('select * from knowledge_assets where id = $1', [id])
    return result.rows[0] ? assetFromRow(result.rows[0]) : undefined
  }
}

export class KnowledgeImmutableVersionConflictError extends Error {
  constructor() {
    super('knowledge published version conflicts with an existing immutable snapshot')
    this.name = 'KnowledgeImmutableVersionConflictError'
  }
}

export async function insertPublishedVersion(queryable: Queryable, version: AuditedPublishedKnowledgeVersion): Promise<void> {
  const inserted = await queryable.query<VersionRow>(
    `insert into knowledge_versions
      (version_id, asset_id, version, content_hash, kind, title, tags, body, source_label, exact_excerpt,
       submitted_for_review_at, submitted_for_review_by, reviewed_at, reviewed_by, published_at, published_by, rule)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
     on conflict do nothing
     returning *`,
    [
      version.versionId,
      version.assetId,
      version.version,
      version.contentHash,
      version.kind,
      version.title,
      JSON.stringify(version.tags),
      version.body,
      version.sourceLabel,
      version.exactExcerpt,
      version.submittedForReviewAt,
      version.submittedForReviewBy,
      version.reviewedAt,
      version.reviewedBy,
      version.publishedAt,
      version.publishedBy,
      JSON.stringify(version.rule ?? null),
    ],
  )
  if (inserted.rowCount === 1) return

  const existing = await queryable.query<VersionRow>(
    `select * from knowledge_versions
     where (asset_id = $1 and version = $2) or version_id = $3
     order by version_id`,
    [version.assetId, version.version, version.versionId],
  )
  if (existing.rows.length === 1 && isDeepStrictEqual(versionFromRow(existing.rows[0]!), version)) return
  throw new KnowledgeImmutableVersionConflictError()
}

interface AssetRow extends QueryResultRow {
  id: string
  version: number
  state: PublicationState
  kind: ExpertAsset['kind']
  title: string
  tags: unknown
  body: string
  source_label: string
  created_at: string | Date
  created_by: string
  updated_at: string | Date
  updated_by: string
  submitted_for_review_at: string | Date | null
  submitted_for_review_by: string | null
  reviewed_at: string | Date | null
  reviewed_by: string | null
  archived_at: string | Date | null
  archived_by: string | null
  current_published_version_id: string | null
  rule: unknown
}

interface VersionRow extends QueryResultRow {
  version_id: string
  asset_id: string
  version: number
  content_hash: string
  kind: ExpertAsset['kind']
  title: string
  tags: unknown
  body: string
  source_label: string
  exact_excerpt: string
  submitted_for_review_at: string | Date
  submitted_for_review_by: string
  reviewed_at: string | Date
  reviewed_by: string
  published_at: string | Date
  published_by: string
  rule: unknown
}

interface PrincipalRow extends QueryResultRow {
  id: string
  kind: PrincipalRecord['kind']
  token_hash: string
  created_at: string | Date
}

interface UserAccountRow extends QueryResultRow {
  id: string
  username: string
  display_name: string
  password_hash: string
  status: UserAccount['status']
  principal_id: string | null
  last_login_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

interface UserSessionUserRow extends UserAccountRow {
  session_id: string
  user_id: string
  token_hash: string
  expires_at: string | Date
  session_created_at: string | Date
}

interface ProfileLockRow extends QueryResultRow {
  id: string
  revision: number
  current_version_id?: string
  deleted_at?: string | Date | null
}

interface ChartProfileRow extends QueryResultRow {
  id: string
  principal_id: string
  label: string
  relationship: ChartProfile['relationship']
  revision: number
  created_at: string | Date
  updated_at: string | Date
  deleted_at: string | Date | null
  version_id: string
  version: number
  calculation_input: unknown
  birth: unknown | null
  bazi: unknown
  rule_profile_version_id: string | null
  rule_profile_version: unknown | null
  restored_from_version_id: string | null
  version_created_at: string | Date
}

interface ChartVersionRow extends QueryResultRow {
  id: string
  profile_id: string
  version: number
  calculation_input: unknown
  birth: unknown | null
  bazi: unknown
  rule_profile_version_id: string | null
  rule_profile_version: unknown | null
  restored_from_version_id: string | null
  created_at: string | Date
}

interface ResidenceProfileRow extends QueryResultRow {
  id: string
  principal_id: string
  revision: number
  created_at: string | Date
  updated_at: string | Date
  deleted_at: string | Date | null
  version_id: string
  version: number
  snapshot: unknown
  restored_from_version_id: string | null
  version_created_at: string | Date
}

interface ResidenceVersionRow extends QueryResultRow {
  id: string
  profile_id: string
  version: number
  snapshot: unknown
  restored_from_version_id: string | null
  created_at: string | Date
}

interface BaziRuleProfileRow extends QueryResultRow {
  id: string
  profile_key: string
  name: string
  description: string | null
  state: BaziRuleProfileState
  revision: number
  working_definition: unknown
  current_published_version_id: string | null
  created_at: string | Date
  created_by: string
  updated_at: string | Date
  updated_by: string
  submitted_for_review_at: string | Date | null
  submitted_for_review_by: string | null
  reviewed_at: string | Date | null
  reviewed_by: string | null
  archived_at: string | Date | null
  archived_by: string | null
}

interface BaziRuleProfileVersionRow extends QueryResultRow {
  version_id: string
  profile_id: string
  version: number
  profile_key: string
  name: string
  description: string | null
  definition: unknown
  content_hash: string
  submitted_for_review_at: string | Date
  submitted_for_review_by: string
  reviewed_at: string | Date
  reviewed_by: string
  published_at: string | Date
  published_by: string
}

function assetParams(asset: AuditedExpertAsset): readonly unknown[] {
  return [
    asset.id,
    asset.version,
    asset.state,
    asset.kind,
    asset.title,
    JSON.stringify(asset.tags),
    asset.body,
    asset.sourceLabel,
    asset.createdAt,
    asset.createdBy,
    asset.updatedAt,
    asset.updatedBy,
    JSON.stringify(asset.rule ?? null),
  ]
}

function assetFromRow(row: AssetRow): AuditedExpertAsset {
  const asset: AuditedExpertAsset = {
    id: row.id,
    version: row.version,
    state: row.state,
    kind: row.kind,
    title: row.title,
    tags: stringArray(row.tags),
    body: row.body,
    sourceLabel: row.source_label,
    createdAt: timestamp(row.created_at),
    createdBy: normalizeKnowledgeActor(row.created_by),
    updatedAt: timestamp(row.updated_at),
    updatedBy: normalizeKnowledgeActor(row.updated_by),
    ...(row.rule ? { rule: row.rule as ExpertAsset['rule'] } : {}),
    ...(row.current_published_version_id ? { currentPublishedVersionId: row.current_published_version_id } : {}),
  }
  assignKnowledgeAudit(asset, 'submittedForReviewAt', 'submittedForReviewBy', row.submitted_for_review_at, row.submitted_for_review_by)
  assignKnowledgeAudit(asset, 'reviewedAt', 'reviewedBy', row.reviewed_at, row.reviewed_by)
  assignKnowledgeAudit(asset, 'archivedAt', 'archivedBy', row.archived_at, row.archived_by)
  return asset
}

function versionFromRow(row: VersionRow): AuditedPublishedKnowledgeVersion {
  return {
    versionId: row.version_id,
    assetId: row.asset_id,
    version: row.version,
    contentHash: row.content_hash,
    kind: row.kind,
    title: row.title,
    tags: stringArray(row.tags),
    body: row.body,
    sourceLabel: row.source_label,
    exactExcerpt: row.exact_excerpt,
    submittedForReviewAt: timestamp(row.submitted_for_review_at),
    submittedForReviewBy: normalizeKnowledgeActor(row.submitted_for_review_by),
    reviewedAt: timestamp(row.reviewed_at),
    reviewedBy: normalizeKnowledgeActor(row.reviewed_by),
    publishedAt: timestamp(row.published_at),
    publishedBy: normalizeKnowledgeActor(row.published_by),
    ...(row.rule ? { rule: row.rule as PublishedKnowledgeVersion['rule'] } : {}),
  }
}

function assignKnowledgeAudit<
  TTime extends 'submittedForReviewAt' | 'reviewedAt' | 'archivedAt',
  TActor extends 'submittedForReviewBy' | 'reviewedBy' | 'archivedBy',
>(asset: AuditedExpertAsset, timeKey: TTime, actorKey: TActor, rawTime: string | Date | null, rawActor: string | null): void {
  if (rawTime == null && rawActor == null) return
  if (rawTime == null || rawActor == null) throw new KnowledgePublicationValidationError(`knowledge audit fields ${timeKey}/${actorKey} must be paired`)
  Object.assign(asset, { [timeKey]: timestamp(rawTime), [actorKey]: normalizeKnowledgeActor(rawActor) })
}

function principalFromRow(row: PrincipalRow): PrincipalRecord {
  return {
    id: row.id,
    kind: row.kind,
    tokenHash: row.token_hash,
    createdAt: timestamp(row.created_at),
  }
}

function storedUserFromRow(row: UserAccountRow): StoredUserAccount {
  return { id: row.id, username: row.username, displayName: row.display_name, passwordHash: row.password_hash, status: row.status, ...(row.principal_id ? { principalId: row.principal_id } : {}), ...(row.last_login_at ? { lastLoginAt: timestamp(row.last_login_at) } : {}), createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at) }
}

function publicUserFromRow(row: UserAccountRow): UserAccount {
  const { passwordHash: _passwordHash, ...user } = storedUserFromRow(row)
  return user
}

function chartProfileFromRow(row: ChartProfileRow): ChartProfile {
  const ruleProfileVersion = chartRuleProfileReferenceFromRow(row)
  const snapshot = postgresCalculationSnapshotFromRow(row)
  const currentVersion = {
    id: row.version_id,
    profileId: row.id,
    version: row.version,
    ...snapshot,
    ...(ruleProfileVersion ? { ruleProfileVersion } : {}),
    ...(row.restored_from_version_id ? { restoredFromVersionId: row.restored_from_version_id } : {}),
    createdAt: timestamp(row.version_created_at),
  } as ChartVersion
  return {
    id: row.id,
    principalId: row.principal_id,
    label: row.label,
    relationship: row.relationship,
    revision: row.revision,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    currentVersion,
    ...(row.deleted_at ? { deletedAt: timestamp(row.deleted_at) } : {}),
  }
}

function chartVersionFromRow(row: ChartVersionRow): ChartVersion {
  const ruleProfileVersion = chartRuleProfileReferenceFromRow(row)
  const snapshot = postgresCalculationSnapshotFromRow(row)
  return {
    id: row.id,
    profileId: row.profile_id,
    version: row.version,
    ...snapshot,
    ...(ruleProfileVersion ? { ruleProfileVersion } : {}),
    ...(row.restored_from_version_id ? { restoredFromVersionId: row.restored_from_version_id } : {}),
    createdAt: timestamp(row.created_at),
  } as ChartVersion
}

function residenceProfileFromRow(row: ResidenceProfileRow): ResidenceProfile {
  return {
    id: databaseString(row.id, 'id'),
    principalId: databaseString(row.principal_id, 'principalId'),
    revision: row.revision,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    currentVersion: {
      id: databaseString(row.version_id, 'versionId'),
      profileId: databaseString(row.id, 'profileId'),
      version: row.version,
      snapshot: normalizeResidenceSnapshot(row.snapshot as ResidenceSnapshot),
      ...(row.restored_from_version_id ? { restoredFromVersionId: databaseString(row.restored_from_version_id, 'restoredFromVersionId') } : {}),
      createdAt: timestamp(row.version_created_at),
    },
    ...(row.deleted_at ? { deletedAt: timestamp(row.deleted_at) } : {}),
  }
}

function residenceVersionFromRow(row: ResidenceVersionRow): ResidenceVersion {
  return {
    id: databaseString(row.id, 'id'),
    profileId: databaseString(row.profile_id, 'profileId'),
    version: row.version,
    snapshot: normalizeResidenceSnapshot(row.snapshot as ResidenceSnapshot),
    ...(row.restored_from_version_id ? { restoredFromVersionId: databaseString(row.restored_from_version_id, 'restoredFromVersionId') } : {}),
    createdAt: timestamp(row.created_at),
  }
}

function isManualCalculationInput(input: BaziCalculationInput): input is ManualFourPillarsInput {
  return input.inputMode === 'manual-four-pillars'
}

function isManualCalculationResult(result: BaziCalculationResult): result is ManualFourPillarsChart {
  return 'inputMode' in result && result.inputMode === 'manual-four-pillars'
}

function postgresCalculationSnapshot(
  calculationInput: BaziCalculationInput,
  bazi: BaziCalculationResult,
):
  | { calculationInput: ManualFourPillarsInput; birth?: never; bazi: ManualFourPillarsChart }
  | { calculationInput: Exclude<BaziCalculationInput, ManualFourPillarsInput>; birth: BirthInput; bazi: BaziChart } {
  if (isManualCalculationInput(calculationInput)) {
    if (!isManualCalculationResult(bazi)) throw new Error('manual four-pillar input requires a manual four-pillar result')
    return {
      calculationInput: structuredClone(calculationInput),
      bazi: structuredClone(bazi),
    }
  }
  if (isManualCalculationResult(bazi)) throw new Error('birth-data input requires a birth-data result')
  const birth = structuredClone(calculationInput) as BirthInput
  return {
    calculationInput: birth,
    birth: structuredClone(birth),
    bazi: structuredClone(bazi) as BaziChart,
  }
}

function postgresCalculationSnapshotFromRow(
  row: Pick<ChartProfileRow | ChartVersionRow, 'calculation_input' | 'birth' | 'bazi'>,
):
  | { calculationInput: ManualFourPillarsInput; birth?: never; bazi: ManualFourPillarsChart }
  | { calculationInput: Exclude<BaziCalculationInput, ManualFourPillarsInput>; birth: BirthInput; bazi: BaziChart } {
  // Migration 008 backfills calculation_input. The birth fallback keeps rolling
  // upgrades readable while an old application instance and migration overlap.
  const calculationInput = (row.calculation_input ?? row.birth) as BaziCalculationInput | null
  if (!calculationInput || typeof calculationInput !== 'object') throw new Error('chart version calculation input is missing')
  return postgresCalculationSnapshot(calculationInput, row.bazi as BaziCalculationResult)
}

function chartRuleProfileReferenceFromRow(
  row: Pick<ChartProfileRow | ChartVersionRow, 'rule_profile_version_id' | 'rule_profile_version'>,
): BaziRuleProfileVersionReference | undefined {
  if (row.rule_profile_version_id == null && row.rule_profile_version == null) return undefined
  if (!row.rule_profile_version_id || !row.rule_profile_version || typeof row.rule_profile_version !== 'object') {
    throw new BaziRuleProfileValidationError('chart rule profile reference columns must be paired')
  }
  const value = row.rule_profile_version as Partial<BaziRuleProfileVersionReference>
  const version = value.version
  if (
    value.versionId !== row.rule_profile_version_id
    || typeof value.profileId !== 'string'
    || typeof value.versionId !== 'string'
    || !Number.isSafeInteger(version)
    || Number(version) < 1
    || typeof value.key !== 'string'
    || typeof value.name !== 'string'
    || typeof value.contentHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.contentHash)
  ) {
    throw new BaziRuleProfileValidationError('invalid chart rule profile version reference')
  }
  return {
    profileId: value.profileId,
    versionId: value.versionId,
    version: version as number,
    key: value.key,
    name: value.name,
    contentHash: value.contentHash,
  }
}

function baziRuleProfileFromRow(row: BaziRuleProfileRow): BaziRuleProfile {
  const normalized = normalizeBaziRuleProfileCreateInput({
    key: row.profile_key,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    workingDefinition: row.working_definition,
  })
  if (!isBaziRuleProfileState(row.state)) throw new BaziRuleProfileValidationError('invalid database profile state')
  if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new BaziRuleProfileValidationError('invalid database profile revision')
  const profile: BaziRuleProfile = {
    id: databaseString(row.id, 'id'),
    ...normalized,
    state: row.state,
    revision: row.revision,
    ...(row.current_published_version_id ? { currentPublishedVersionId: databaseString(row.current_published_version_id, 'currentPublishedVersionId') } : {}),
    createdAt: timestamp(row.created_at),
    createdBy: normalizeBaziRuleProfileActor(row.created_by),
    updatedAt: timestamp(row.updated_at),
    updatedBy: normalizeBaziRuleProfileActor(row.updated_by),
  }
  assignDatabaseAudit(profile, 'submittedForReviewAt', 'submittedForReviewBy', row.submitted_for_review_at, row.submitted_for_review_by)
  assignDatabaseAudit(profile, 'reviewedAt', 'reviewedBy', row.reviewed_at, row.reviewed_by)
  assignDatabaseAudit(profile, 'archivedAt', 'archivedBy', row.archived_at, row.archived_by)
  return profile
}

function baziRuleProfileVersionFromRow(row: BaziRuleProfileVersionRow): PublishedBaziRuleProfileVersion {
  const definition = normalizeBaziRuleProfileDefinition(row.definition)
  const contentHash = databaseString(row.content_hash, 'contentHash')
  if (!/^[a-f0-9]{64}$/.test(contentHash) || contentHash !== hashBaziRuleProfileDefinition(definition)) {
    throw new BaziRuleProfileValidationError('published database version content hash mismatch')
  }
  if (!Number.isSafeInteger(row.version) || row.version < 1) throw new BaziRuleProfileValidationError('invalid database publication version')
  const normalized = normalizeBaziRuleProfileCreateInput({
    key: row.profile_key,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    workingDefinition: definition,
  })
  return {
    profileId: databaseString(row.profile_id, 'profileId'),
    versionId: databaseString(row.version_id, 'versionId'),
    version: row.version,
    key: normalized.key,
    name: normalized.name,
    ...(normalized.description ? { description: normalized.description } : {}),
    definition,
    contentHash,
    submittedForReviewAt: timestamp(row.submitted_for_review_at),
    submittedForReviewBy: normalizeBaziRuleProfileActor(row.submitted_for_review_by),
    reviewedAt: timestamp(row.reviewed_at),
    reviewedBy: normalizeBaziRuleProfileActor(row.reviewed_by),
    publishedAt: timestamp(row.published_at),
    publishedBy: normalizeBaziRuleProfileActor(row.published_by),
  }
}

function assignDatabaseAudit(
  profile: BaziRuleProfile,
  atKey: 'submittedForReviewAt' | 'reviewedAt' | 'archivedAt',
  byKey: 'submittedForReviewBy' | 'reviewedBy' | 'archivedBy',
  at: string | Date | null,
  by: string | null,
) {
  if (!at && !by) return
  if (!at || !by) throw new BaziRuleProfileValidationError(`${atKey} and ${byKey} must be paired`)
  Object.assign(profile, { [atKey]: timestamp(at), [byKey]: normalizeBaziRuleProfileActor(by) })
}

function databaseString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BaziRuleProfileValidationError(`invalid database ${field}`)
  return value
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value === 'string') return JSON.parse(value) as string[]
  return []
}

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value
}

function checkedReportableWenzhenFixture(value: unknown, context: string): ReportableWenzhenFixture {
  const checked = validateWenzhenFixture(value, context)
  if (checked.status === 'pending-manual-verification') {
    throw new Error(`${context} must be verified or accepted-difference`)
  }
  return checked
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

function isPostgresConstraintViolation(error: unknown, code: string, constraint: string): boolean {
  if (postgresErrorCode(error) !== code || typeof error !== 'object' || error === null || !('constraint' in error)) return false
  return error.constraint === constraint
}
