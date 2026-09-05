import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Direction, ResidenceProfile, ResidenceSnapshot, ResidenceVersion } from '@fengshui/domain'

interface ResidenceData {
  profiles: StoredResidenceProfile[]
  versions: ResidenceVersion[]
}

interface StoredResidenceProfile {
  id: string
  principalId: string
  revision: number
  currentVersionId: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export class ResidenceRevisionConflictError extends Error {
  constructor(message = 'residence profile revision conflict') {
    super(message)
    this.name = 'ResidenceRevisionConflictError'
  }
}

export class ResidenceVersionRestoreConflictError extends Error {
  constructor(message = 'residence version restore conflict') {
    super(message)
    this.name = 'ResidenceVersionRestoreConflictError'
  }
}

export interface ResidenceStore {
  listProfiles(principalId: string): Promise<ResidenceProfile[]>
  getProfile(profileId: string, principalId: string): Promise<ResidenceProfile | undefined>
  listVersions(profileId: string, principalId: string): Promise<ResidenceVersion[] | undefined>
  getVersion(profileId: string, principalId: string, versionId: string): Promise<ResidenceVersion | undefined>
  createProfile(principalId: string, snapshot: ResidenceSnapshot): Promise<ResidenceProfile>
  appendVersion(profileId: string, principalId: string, expectedRevision: number, snapshot: ResidenceSnapshot): Promise<ResidenceProfile | undefined>
  restoreVersion(profileId: string, principalId: string, sourceVersionId: string, expectedRevision: number): Promise<ResidenceProfile | undefined>
  softDeleteProfile(profileId: string, principalId: string): Promise<boolean>
  restoreProfile(profileId: string, principalId: string): Promise<ResidenceProfile | undefined>
  ping(): Promise<void>
  close(): Promise<void>
}

export class ResidenceRepository implements ResidenceStore {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async list(principalId: string): Promise<ResidenceProfile[]> {
    return this.listProfiles(principalId)
  }

  async get(profileId: string, principalId: string): Promise<ResidenceProfile | undefined> {
    return this.getProfile(profileId, principalId)
  }

  async create(principalId: string, snapshot: ResidenceSnapshot): Promise<ResidenceProfile> {
    return this.createProfile(principalId, snapshot)
  }

  async softDelete(profileId: string, principalId: string): Promise<boolean> {
    return this.softDeleteProfile(profileId, principalId)
  }

  async restore(profileId: string, principalId: string): Promise<ResidenceProfile | undefined> {
    return this.restoreProfile(profileId, principalId)
  }

  async listProfiles(principalId: string): Promise<ResidenceProfile[]> {
    await this.writeQueue
    const data = await this.all()
    return data.profiles
      .filter((profile) => profile.principalId === principalId && !profile.deletedAt)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((profile) => profileFromStored(profile, data.versions))
  }

  async getProfile(profileId: string, principalId: string): Promise<ResidenceProfile | undefined> {
    await this.writeQueue
    const data = await this.all()
    const profile = data.profiles.find((item) => item.id === profileId && item.principalId === principalId && !item.deletedAt)
    return profile ? profileFromStored(profile, data.versions) : undefined
  }

  async listVersions(profileId: string, principalId: string): Promise<ResidenceVersion[] | undefined> {
    await this.writeQueue
    const data = await this.all()
    if (!data.profiles.some((item) => item.id === profileId && item.principalId === principalId)) return undefined
    return data.versions
      .filter((version) => version.profileId === profileId)
      .sort((left, right) => right.version - left.version)
      .map((version) => structuredClone(version))
  }

  async getVersion(profileId: string, principalId: string, versionId: string): Promise<ResidenceVersion | undefined> {
    await this.writeQueue
    const data = await this.all()
    if (!data.profiles.some((item) => item.id === profileId && item.principalId === principalId)) return undefined
    const version = data.versions.find((item) => item.id === versionId && item.profileId === profileId)
    return version ? structuredClone(version) : undefined
  }

  async createProfile(principalId: string, snapshot: ResidenceSnapshot): Promise<ResidenceProfile> {
    return this.mutate((data) => {
      const now = new Date().toISOString()
      const profileId = crypto.randomUUID()
      const version: ResidenceVersion = {
        id: crypto.randomUUID(),
        profileId,
        version: 1,
        snapshot: normalizeResidenceSnapshot(snapshot),
        createdAt: now,
      }
      const profile: StoredResidenceProfile = {
        id: profileId,
        principalId,
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

  async appendVersion(profileId: string, principalId: string, expectedRevision: number, snapshot: ResidenceSnapshot): Promise<ResidenceProfile | undefined> {
    return this.mutate((data) => {
      const profile = data.profiles.find((item) => item.id === profileId && item.principalId === principalId && !item.deletedAt)
      if (!profile) return undefined
      if (profile.revision !== expectedRevision) throw new ResidenceRevisionConflictError()
      const now = new Date().toISOString()
      const version: ResidenceVersion = {
        id: crypto.randomUUID(),
        profileId,
        version: profile.revision + 1,
        snapshot: normalizeResidenceSnapshot(snapshot),
        createdAt: now,
      }
      profile.revision += 1
      profile.currentVersionId = version.id
      profile.updatedAt = now
      data.versions.push(version)
      return profileFromStored(profile, data.versions)
    })
  }

  async restoreVersion(profileId: string, principalId: string, sourceVersionId: string, expectedRevision: number): Promise<ResidenceProfile | undefined> {
    return this.mutate((data) => {
      const profile = data.profiles.find((item) => item.id === profileId && item.principalId === principalId)
      if (!profile) return undefined
      if (profile.deletedAt) throw new ResidenceVersionRestoreConflictError('cannot restore a version from a deleted residence profile')
      if (profile.revision !== expectedRevision) throw new ResidenceRevisionConflictError()
      if (profile.currentVersionId === sourceVersionId) throw new ResidenceVersionRestoreConflictError('current residence version cannot be restored')
      const source = data.versions.find((version) => version.id === sourceVersionId && version.profileId === profileId)
      if (!source) return undefined
      const now = new Date().toISOString()
      const version: ResidenceVersion = {
        id: crypto.randomUUID(),
        profileId,
        version: profile.revision + 1,
        snapshot: structuredClone(source.snapshot),
        restoredFromVersionId: source.id,
        createdAt: now,
      }
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
      profile.updatedAt = profile.deletedAt
      return true
    })
  }

  async restoreProfile(profileId: string, principalId: string): Promise<ResidenceProfile | undefined> {
    return this.mutate((data) => {
      const profile = data.profiles.find((item) => item.id === profileId && item.principalId === principalId && item.deletedAt)
      if (!profile) return undefined
      profile.deletedAt = undefined
      profile.updatedAt = new Date().toISOString()
      return profileFromStored(profile, data.versions)
    })
  }

  async ping(): Promise<void> {
    await this.writeQueue
    await this.all()
  }

  async close(): Promise<void> {}

  private async all(): Promise<ResidenceData> {
    try {
      return normalizeResidenceData(JSON.parse(await readFile(this.path, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { profiles: [], versions: [] }
      throw error
    }
  }

  private async mutate<T>(update: (data: ResidenceData) => T): Promise<T> {
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

export function normalizeResidenceSnapshot(input: ResidenceSnapshot): ResidenceSnapshot {
  return {
    schemaVersion: 'residence-snapshot-v1',
    label: normalizeResidenceLabel(input.label),
    facing: normalizeDirection(input.facing),
    ...(input.layoutNote?.trim() ? { layoutNote: input.layoutNote.trim() } : {}),
  }
}

export function residenceSnapshotFromSubmission(input: { facing: Direction; layoutNote?: string }, label = '未命名住宅'): ResidenceSnapshot {
  return normalizeResidenceSnapshot({
    schemaVersion: 'residence-snapshot-v1',
    label,
    facing: input.facing,
    ...(input.layoutNote?.trim() ? { layoutNote: input.layoutNote.trim() } : {}),
  })
}

export function sameResidenceSnapshot(left: ResidenceSnapshot, right: ResidenceSnapshot): boolean {
  return JSON.stringify(normalizeResidenceSnapshot(left)) === JSON.stringify(normalizeResidenceSnapshot(right))
}

function normalizeResidenceLabel(label: string): string {
  const normalized = label.trim().replace(/\s+/gu, ' ')
  if (!normalized) throw new Error('residence label is required')
  return normalized.slice(0, 80)
}

function normalizeDirection(value: Direction): Direction {
  if (value === 'north' || value === 'east' || value === 'south' || value === 'west' || value === 'unknown') return value
  throw new Error('invalid residence direction')
}

function normalizeResidenceData(value: unknown): ResidenceData {
  const data = value as Partial<ResidenceData>
  return {
    profiles: Array.isArray(data.profiles) ? data.profiles.map((profile) => ({ ...profile })) as StoredResidenceProfile[] : [],
    versions: Array.isArray(data.versions) ? data.versions.map(normalizeResidenceVersion) : [],
  }
}

function normalizeResidenceVersion(value: unknown): ResidenceVersion {
  const version = value as ResidenceVersion
  return {
    id: version.id,
    profileId: version.profileId,
    version: version.version,
    snapshot: normalizeResidenceSnapshot(version.snapshot),
    createdAt: version.createdAt,
    ...(version.restoredFromVersionId ? { restoredFromVersionId: version.restoredFromVersionId } : {}),
  }
}

function profileFromStored(profile: StoredResidenceProfile, versions: readonly ResidenceVersion[]): ResidenceProfile {
  const currentVersion = versions.find((version) => version.id === profile.currentVersionId)
  if (!currentVersion) throw new Error(`residence profile ${profile.id} has no current version`)
  return {
    id: profile.id,
    principalId: profile.principalId,
    revision: profile.revision,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    currentVersion: structuredClone(currentVersion),
    ...(profile.deletedAt ? { deletedAt: profile.deletedAt } : {}),
  }
}
