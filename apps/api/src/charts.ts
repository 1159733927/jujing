import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  BaziCalculationInput,
  BaziCalculationResult,
  BaziChart,
  ChartProfileMetadata,
  BaziRuleProfileVersionReference,
  BirthInput,
  ChartProfile,
  ChartVersion,
  ManualFourPillarsChart,
  ManualFourPillarsInput,
  PrincipalRecord,
  StoredChartVersion,
} from '@fengshui/domain'

interface ChartData {
  principals: PrincipalRecord[]
  profiles: StoredChartProfile[]
  versions: ChartVersion[]
}

interface StoredChartProfile {
  id: string
  principalId: string
  label: string
  relationship: ChartProfileMetadata['relationship']
  revision: number
  currentVersionId: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export class ChartRevisionConflictError extends Error {
  constructor(message = 'chart profile revision conflict') {
    super(message)
    this.name = 'ChartRevisionConflictError'
  }
}

export class ChartVersionRestoreConflictError extends Error {
  constructor(message = 'chart version restore conflict') {
    super(message)
    this.name = 'ChartVersionRestoreConflictError'
  }
}

export class ChartProfileAlreadyExistsError extends Error {
  constructor(message = 'an active chart profile already exists') {
    super(message)
    this.name = 'ChartProfileAlreadyExistsError'
  }
}

export class ChartProfileLimitExceededError extends Error {
  constructor(message = 'chart profile limit exceeded: at most 10 active profiles are allowed') {
    super(message)
    this.name = 'ChartProfileLimitExceededError'
  }
}

export interface ChartStore {
  findPrincipalByTokenHash(tokenHash: string): Promise<PrincipalRecord | undefined>
  createPrincipal(input: string | PrincipalRecord): Promise<PrincipalRecord>
  getCurrentProfile(principalId: string): Promise<ChartProfile | undefined>
  listProfiles(principalId: string, includeDeleted?: boolean): Promise<ChartProfile[]>
  getProfile(profileId: string, principalId: string): Promise<ChartProfile | undefined>
  listVersions(profileId: string, principalId: string): Promise<ChartVersion[] | undefined>
  getVersion(profileId: string, principalId: string, versionId: string): Promise<ChartVersion | undefined>
  createProfile(
    principalId: string,
    calculationInput: BaziCalculationInput,
    bazi: BaziCalculationResult,
    metadata: ChartProfileMetadata,
    ruleProfileVersion?: BaziRuleProfileVersionReference,
  ): Promise<ChartProfile>
  appendVersion(
    profileId: string,
    principalId: string,
    expectedRevision: number,
    calculationInput: BaziCalculationInput,
    bazi: BaziCalculationResult,
    ruleProfileVersion?: BaziRuleProfileVersionReference,
  ): Promise<ChartProfile | undefined>
  restoreVersion(
    profileId: string,
    principalId: string,
    sourceVersionId: string,
    expectedRevision: number,
  ): Promise<ChartProfile | undefined>
  softDeleteProfile(profileId: string, principalId: string): Promise<boolean>
  restoreProfile(profileId: string, principalId: string): Promise<ChartProfile | undefined>
  /** True when any stored chart version references a published version of this rule profile. */
  referencesRuleProfile(profileId: string): Promise<boolean>
  /** Aggregate chart profile counts for the admin monitoring dashboard. */
  chartStats(): Promise<{ total: number; active: number; deleted: number }>
  ping(): Promise<void>
  close(): Promise<void>
}

export class ChartRepository implements ChartStore {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async findPrincipalByTokenHash(tokenHash: string): Promise<PrincipalRecord | undefined> {
    await this.writeQueue
    return (await this.all()).principals.find((principal) => principal.tokenHash === tokenHash)
  }

  async createPrincipal(input: string | PrincipalRecord): Promise<PrincipalRecord> {
    return this.mutate((data) => {
      const tokenHash = typeof input === 'string' ? input : input.tokenHash
      const existing = data.principals.find((principal) => principal.tokenHash === tokenHash)
      if (existing) return existing
      const principal: PrincipalRecord = typeof input === 'string' ? {
        id: crypto.randomUUID(),
        kind: 'anonymous',
        tokenHash,
        createdAt: new Date().toISOString(),
      } : input
      data.principals.push(principal)
      return principal
    })
  }

  async getCurrentProfile(principalId: string): Promise<ChartProfile | undefined> {
    await this.writeQueue
    const data = await this.all()
    const profile = data.profiles
      .filter((item) => item.principalId === principalId && !item.deletedAt)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
    return profile ? profileFromStored(profile, data.versions) : undefined
  }

  async listProfiles(principalId: string, includeDeleted = false): Promise<ChartProfile[]> {
    await this.writeQueue
    const data = await this.all()
    return data.profiles
      .filter((profile) => profile.principalId === principalId && (includeDeleted || !profile.deletedAt))
      .sort(compareProfilesByMostRecent)
      .map((profile) => profileFromStored(profile, data.versions))
  }

  async getProfile(profileId: string, principalId: string): Promise<ChartProfile | undefined> {
    await this.writeQueue
    const data = await this.all()
    const profile = data.profiles.find((item) => item.id === profileId && item.principalId === principalId && !item.deletedAt)
    return profile ? profileFromStored(profile, data.versions) : undefined
  }

  async listVersions(profileId: string, principalId: string): Promise<ChartVersion[] | undefined> {
    await this.writeQueue
    const data = await this.all()
    const profile = data.profiles.find((item) => item.id === profileId && item.principalId === principalId)
    if (!profile) return undefined
    return data.versions
      .filter((version) => version.profileId === profileId)
      .sort((left, right) => right.version - left.version)
  }

  async getVersion(profileId: string, principalId: string, versionId: string): Promise<ChartVersion | undefined> {
    await this.writeQueue
    const data = await this.all()
    const profile = data.profiles.find((item) => item.id === profileId && item.principalId === principalId)
    if (!profile) return undefined
    const version = data.versions.find((item) => item.id === versionId && item.profileId === profileId)
    return version ? structuredClone(version) : undefined
  }

  async createProfile(
    principalId: string,
    calculationInput: BaziCalculationInput,
    bazi: BaziCalculationResult,
    metadata: ChartProfileMetadata,
    ruleProfileVersion?: BaziRuleProfileVersionReference,
  ): Promise<ChartProfile> {
    return this.mutate((data) => {
      assertProfileCapacity(data.profiles, principalId)
      const now = new Date().toISOString()
      const profileId = crypto.randomUUID()
      const version = {
        id: crypto.randomUUID(),
        profileId,
        version: 1,
        ...calculationSnapshot(calculationInput, bazi),
        ...(ruleProfileVersion ? { ruleProfileVersion: structuredClone(ruleProfileVersion) } : {}),
        createdAt: now,
      } as ChartVersion
      const profile: StoredChartProfile = {
        id: profileId,
        principalId,
        label: metadata.label,
        relationship: metadata.relationship,
        revision: 1,
        currentVersionId: version.id,
        createdAt: now,
        updatedAt: now,
      }
      data.profiles.push(profile)
      data.versions.push(version)
      return profileFromStored(profile, data.versions)
    })
  }

  async appendVersion(
    profileId: string,
    principalId: string,
    expectedRevision: number,
    calculationInput: BaziCalculationInput,
    bazi: BaziCalculationResult,
    ruleProfileVersion?: BaziRuleProfileVersionReference,
  ): Promise<ChartProfile | undefined> {
    return this.mutate((data) => {
      const profile = data.profiles.find((item) => item.id === profileId && item.principalId === principalId && !item.deletedAt)
      if (!profile) return undefined
      if (profile.revision !== expectedRevision) throw new ChartRevisionConflictError()
      const now = new Date().toISOString()
      const version = {
        id: crypto.randomUUID(),
        profileId,
        version: profile.revision + 1,
        ...calculationSnapshot(calculationInput, bazi),
        ...(ruleProfileVersion ? { ruleProfileVersion: structuredClone(ruleProfileVersion) } : {}),
        createdAt: now,
      } as ChartVersion
      profile.revision += 1
      profile.currentVersionId = version.id
      profile.updatedAt = now
      data.versions.push(version)
      return profileFromStored(profile, data.versions)
    })
  }

  async restoreVersion(
    profileId: string,
    principalId: string,
    sourceVersionId: string,
    expectedRevision: number,
  ): Promise<ChartProfile | undefined> {
    return this.mutate((data) => {
      const profile = data.profiles.find((item) => item.id === profileId && item.principalId === principalId)
      if (!profile) return undefined
      if (profile.deletedAt) throw new ChartVersionRestoreConflictError('cannot restore a version from a deleted chart profile')
      if (profile.revision !== expectedRevision) throw new ChartRevisionConflictError()
      if (profile.currentVersionId === sourceVersionId) {
        throw new ChartVersionRestoreConflictError('current chart version cannot be restored')
      }
      const sourceVersion = data.versions.find((version) => version.profileId === profileId && version.id === sourceVersionId)
      if (!sourceVersion) return undefined
      const now = new Date().toISOString()
      const version = {
        id: crypto.randomUUID(),
        profileId,
        version: profile.revision + 1,
        ...calculationSnapshot(sourceVersion.calculationInput, sourceVersion.bazi),
        ...(sourceVersion.ruleProfileVersion ? { ruleProfileVersion: structuredClone(sourceVersion.ruleProfileVersion) } : {}),
        restoredFromVersionId: sourceVersion.id,
        createdAt: now,
      } as ChartVersion
      profile.revision += 1
      profile.currentVersionId = version.id
      profile.updatedAt = now
      data.versions.push(version)
      return profileFromStored(profile, data.versions)
    })
  }

  async softDeleteProfile(profileId: string, principalId: string): Promise<boolean> {
    return this.mutate((data) => {
      const profile = data.profiles.find((item) => item.id === profileId && item.principalId === principalId && !item.deletedAt)
      if (!profile) return false
      profile.deletedAt = new Date().toISOString()
      return true
    })
  }

  async restoreProfile(profileId: string, principalId: string): Promise<ChartProfile | undefined> {
    return this.mutate((data) => {
      const profile = data.profiles.find((item) => item.id === profileId && item.principalId === principalId && item.deletedAt)
      if (!profile) return undefined
      assertProfileCapacity(data.profiles, principalId)
      profile.deletedAt = undefined
      profile.updatedAt = new Date().toISOString()
      return profileFromStored(profile, data.versions)
    })
  }

  async referencesRuleProfile(profileId: string): Promise<boolean> {
    await this.writeQueue
    return (await this.all()).versions.some((version) => version.ruleProfileVersion?.profileId === profileId)
  }

  async chartStats(): Promise<{ total: number; active: number; deleted: number }> {
    await this.writeQueue
    const profiles = (await this.all()).profiles
    const deleted = profiles.filter((profile) => profile.deletedAt).length
    return { total: profiles.length, active: profiles.length - deleted, deleted }
  }

  async ping(): Promise<void> {
    await this.writeQueue
    await this.all()
  }

  async close(): Promise<void> {}

  private async all(): Promise<ChartData> {
    try {
      return normalizeData(JSON.parse(await readFile(this.path, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyData()
      throw error
    }
  }

  private async mutate<T>(update: (data: ChartData) => T): Promise<T> {
    let result!: T
    const task = this.writeQueue.then(async () => {
      const data = await this.all()
      result = update(data)
      await mkdir(dirname(this.path), { recursive: true })
      const temporaryPath = `${this.path}.${crypto.randomUUID()}.tmp`
      await writeFile(temporaryPath, JSON.stringify(data, null, 2), { mode: 0o600 })
      await rename(temporaryPath, this.path)
    })
    this.writeQueue = task.catch(() => undefined)
    await task
    return result
  }
}

function emptyData(): ChartData {
  return { principals: [], profiles: [], versions: [] }
}

function normalizeData(value: unknown): ChartData {
  const data = value as Partial<ChartData>
  return {
    principals: Array.isArray(data.principals) ? data.principals : [],
    profiles: Array.isArray(data.profiles) ? data.profiles.map(normalizeStoredProfile) : [],
    versions: Array.isArray(data.versions) ? data.versions.map((version) => normalizeStoredVersion(version as StoredChartVersion)) : [],
  }
}

function normalizeStoredProfile(profile: StoredChartProfile): StoredChartProfile {
  return {
    ...profile,
    label: typeof profile.label === 'string' && profile.label.trim() ? profile.label : '我的命盘',
    relationship: profile.relationship ?? 'self',
  }
}

function assertProfileCapacity(profiles: readonly StoredChartProfile[], principalId: string): void {
  const activeCount = profiles.filter((profile) => profile.principalId === principalId && !profile.deletedAt).length
  if (activeCount >= 10) throw new ChartProfileLimitExceededError()
}

function compareProfilesByMostRecent(left: StoredChartProfile, right: StoredChartProfile): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
}

function isManualCalculationInput(input: BaziCalculationInput): input is ManualFourPillarsInput {
  return input.inputMode === 'manual-four-pillars'
}

function isManualCalculationResult(result: BaziCalculationResult): result is ManualFourPillarsChart {
  return 'inputMode' in result && result.inputMode === 'manual-four-pillars'
}

function calculationSnapshot(
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

function normalizeStoredVersion(version: StoredChartVersion): ChartVersion {
  const calculationInput = 'calculationInput' in version && version.calculationInput
    ? version.calculationInput
    : version.birth
  return {
    id: version.id,
    profileId: version.profileId,
    version: version.version,
    ...calculationSnapshot(calculationInput, version.bazi),
    ...(version.ruleProfileVersion ? { ruleProfileVersion: structuredClone(version.ruleProfileVersion) } : {}),
    ...(version.restoredFromVersionId ? { restoredFromVersionId: version.restoredFromVersionId } : {}),
    createdAt: version.createdAt,
  } as ChartVersion
}

function profileFromStored(profile: StoredChartProfile, versions: readonly ChartVersion[]): ChartProfile {
  const currentVersion = versions.find((version) => version.id === profile.currentVersionId)
  if (!currentVersion) throw new Error(`chart profile ${profile.id} has no current version`)
  return {
    id: profile.id,
    principalId: profile.principalId,
    label: profile.label,
    relationship: profile.relationship,
    revision: profile.revision,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    currentVersion,
    ...(profile.deletedAt ? { deletedAt: profile.deletedAt } : {}),
  }
}
