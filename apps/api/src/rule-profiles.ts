import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  BaziAssessmentCondition,
  BaziAssessmentFactPath,
  BaziAssessmentMethodConfig,
  BaziAssessmentRule,
  BaziRuleProfile,
  BaziRuleProfileDefinition,
  BaziRuleProfileState,
  ElementBalanceDirection,
  TrueSolarTimeRuleVersion,
  PublishedBaziRuleProfileVersion,
} from '@fengshui/domain'

interface RuleProfileStoreData {
  schemaVersion: 1
  profiles: BaziRuleProfile[]
  versions: PublishedBaziRuleProfileVersion[]
}

export interface CreateBaziRuleProfileInput {
  key: string
  name: string
  description?: string
  workingDefinition: BaziRuleProfileDefinition
}

export interface ReviseBaziRuleProfileInput {
  name: string
  description?: string
  workingDefinition: BaziRuleProfileDefinition
}

export interface ReviseBaziRuleProfileRequest {
  input: ReviseBaziRuleProfileInput
  expectedRevision: number
}

export interface BaziRuleProfileStore {
  list(): Promise<BaziRuleProfile[]>
  /** Only immutable versions that are the current publication of an active profile. */
  listActiveVersions(): Promise<PublishedBaziRuleProfileVersion[]>
  /** Resolves only the current immutable publication of an active profile. */
  getActiveVersion(versionId: string): Promise<PublishedBaziRuleProfileVersion | undefined>
  create(input: CreateBaziRuleProfileInput, actor: string): Promise<BaziRuleProfile>
  revise(id: string, input: ReviseBaziRuleProfileInput, actor: string, expectedRevision: number): Promise<BaziRuleProfile | undefined>
  setState(id: string, state: BaziRuleProfileState, actor: string): Promise<BaziRuleProfile | undefined>
  listVersions(id: string): Promise<PublishedBaziRuleProfileVersion[] | undefined>
  /** Physically removes a profile and all of its immutable published versions. */
  delete(id: string): Promise<boolean>
  ping(): Promise<void>
  close(): Promise<void>
}

export class DuplicateBaziRuleProfileKeyError extends Error {
  constructor() {
    super('a bazi rule profile with this key already exists')
    this.name = 'DuplicateBaziRuleProfileKeyError'
  }
}

export class InvalidBaziRuleProfileTransitionError extends Error {
  constructor(from: BaziRuleProfileState, to: BaziRuleProfileState) {
    super(`invalid bazi rule profile transition: ${from} -> ${to}`)
    this.name = 'InvalidBaziRuleProfileTransitionError'
  }
}

export class BaziRuleProfileRevisionConflictError extends Error {
  constructor() {
    super('bazi rule profile revision conflict')
    this.name = 'BaziRuleProfileRevisionConflictError'
  }
}

export class BaziRuleProfileValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BaziRuleProfileValidationError'
  }
}

export class BaziRuleProfileReferencedError extends Error {
  constructor() {
    super('bazi rule profile has a published version referenced by a saved chart')
    this.name = 'BaziRuleProfileReferencedError'
  }
}

type AtomicStoreWriter = (path: string, store: RuleProfileStoreData) => Promise<void>

export class BaziRuleProfileRepository implements BaziRuleProfileStore {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly writeStore: AtomicStoreWriter = atomicWriteStore,
  ) {}

  async list(): Promise<BaziRuleProfile[]> {
    await this.writeQueue
    return structuredClone((await this.readStore()).profiles)
  }

  async listActiveVersions(): Promise<PublishedBaziRuleProfileVersion[]> {
    await this.writeQueue
    const store = await this.readStore()
    const activeIds = new Set(store.profiles
      // A published snapshot remains usable while its next revision is being
      // authored or reviewed. Archiving is the explicit operation that closes
      // the profile for new calculations.
      .filter((profile) => profile.state !== 'archived' && profile.currentPublishedVersionId)
      .map((profile) => profile.currentPublishedVersionId!))
    return structuredClone(store.versions
      .filter((version) => activeIds.has(version.versionId))
      .sort((left, right) => left.key.localeCompare(right.key) || left.versionId.localeCompare(right.versionId)))
  }

  async getActiveVersion(versionId: string): Promise<PublishedBaziRuleProfileVersion | undefined> {
    await this.writeQueue
    const store = await this.readStore()
    const profile = store.profiles.find((item) => item.state !== 'archived' && item.currentPublishedVersionId === versionId)
    if (!profile) return undefined
    const version = store.versions.find((item) => item.profileId === profile.id && item.versionId === versionId)
    return version ? structuredClone(version) : undefined
  }

  async create(input: CreateBaziRuleProfileInput, actor: string): Promise<BaziRuleProfile> {
    const normalizedInput = normalizeBaziRuleProfileCreateInput(input)
    const normalizedActor = normalizeBaziRuleProfileActor(actor)
    return this.mutate((store) => {
      if (store.profiles.some((profile) => profile.key === normalizedInput.key)) {
        throw new DuplicateBaziRuleProfileKeyError()
      }
      const now = new Date().toISOString()
      const profile: BaziRuleProfile = {
        id: randomUUID(),
        ...normalizedInput,
        state: 'draft',
        revision: 1,
        createdAt: now,
        createdBy: normalizedActor,
        updatedAt: now,
        updatedBy: normalizedActor,
      }
      store.profiles.push(profile)
      return structuredClone(profile)
    })
  }

  async revise(id: string, input: ReviseBaziRuleProfileInput, actor: string, expectedRevision: number): Promise<BaziRuleProfile | undefined> {
    const normalizedInput = normalizeBaziRuleProfileRevisionInput(input)
    const normalizedActor = normalizeBaziRuleProfileActor(actor)
    return this.mutate((store) => {
      const index = store.profiles.findIndex((profile) => profile.id === id)
      if (index < 0) return undefined
      const current = store.profiles[index]!
      if (current.revision !== expectedRevision) throw new BaziRuleProfileRevisionConflictError()
      if (current.state === 'in-review') {
        throw new InvalidBaziRuleProfileTransitionError('in-review', 'draft')
      }
      if (current.state === 'archived') {
        throw new InvalidBaziRuleProfileTransitionError('archived', 'draft')
      }
      const next: BaziRuleProfile = {
        id: current.id,
        key: current.key,
        ...normalizedInput,
        state: 'draft',
        revision: current.revision + 1,
        ...(current.currentPublishedVersionId ? { currentPublishedVersionId: current.currentPublishedVersionId } : {}),
        createdAt: current.createdAt,
        createdBy: current.createdBy,
        updatedAt: new Date().toISOString(),
        updatedBy: normalizedActor,
      }
      store.profiles[index] = next
      return structuredClone(next)
    })
  }

  async setState(id: string, state: BaziRuleProfileState, actor: string): Promise<BaziRuleProfile | undefined> {
    const normalizedActor = normalizeBaziRuleProfileActor(actor)
    if (!isBaziRuleProfileState(state)) throw new BaziRuleProfileValidationError('invalid bazi rule profile state')
    return this.mutate((store) => {
      const index = store.profiles.findIndex((profile) => profile.id === id)
      if (index < 0) return undefined
      const current = store.profiles[index]!
      if (!isAllowedBaziRuleProfileTransition(current.state, state)) {
        throw new InvalidBaziRuleProfileTransitionError(current.state, state)
      }
      const now = new Date().toISOString()
      let next: BaziRuleProfile
      if (state === 'in-review') {
        next = {
          ...current,
          state,
          updatedAt: now,
          updatedBy: normalizedActor,
          submittedForReviewAt: now,
          submittedForReviewBy: normalizedActor,
        }
      } else if (state === 'published') {
        const submittedForReviewAt = current.submittedForReviewAt ?? now
        const submittedForReviewBy = current.submittedForReviewBy ?? normalizedActor
        const submitted = { ...current, submittedForReviewAt, submittedForReviewBy }
        const version = createPublishedVersion(
          submitted,
          store.versions,
          normalizedActor,
          now,
        )
        store.versions.push(version)
        next = {
          ...submitted,
          state,
          currentPublishedVersionId: version.versionId,
          updatedAt: now,
          updatedBy: normalizedActor,
          reviewedAt: now,
          reviewedBy: normalizedActor,
        }
      } else {
        next = {
          ...current,
          state,
          updatedAt: now,
          updatedBy: normalizedActor,
          archivedAt: now,
          archivedBy: normalizedActor,
        }
      }
      store.profiles[index] = next
      return structuredClone(next)
    })
  }

  async listVersions(id: string): Promise<PublishedBaziRuleProfileVersion[] | undefined> {
    await this.writeQueue
    const store = await this.readStore()
    if (!store.profiles.some((profile) => profile.id === id)) return undefined
    return structuredClone(store.versions
      .filter((version) => version.profileId === id)
      .sort((left, right) => right.version - left.version))
  }

  async delete(id: string): Promise<boolean> {
    return this.mutate((store) => {
      const index = store.profiles.findIndex((profile) => profile.id === id)
      if (index < 0) return false
      store.profiles.splice(index, 1)
      store.versions = store.versions.filter((version) => version.profileId !== id)
      return true
    })
  }

  async ping(): Promise<void> {
    await this.writeQueue
    await this.readStore()
  }

  async close(): Promise<void> {
    await this.writeQueue
  }

  private async readStore(): Promise<RuleProfileStoreData> {
    try {
      return validateStore(JSON.parse(await readFile(this.path, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore()
      throw error
    }
  }

  private async mutate<T>(operation: (store: RuleProfileStoreData) => T): Promise<T> {
    let result!: T
    const task = this.writeQueue.then(async () => {
      const store = await this.readStore()
      result = operation(store)
      validateStore(store)
      await this.writeStore(this.path, store)
    })
    // A rejected write is delivered to its caller, but must not poison later writes.
    this.writeQueue = task.catch(() => undefined)
    await task
    return result
  }
}

export function hashBaziRuleProfileDefinition(definition: BaziRuleProfileDefinition): string {
  const normalized = normalizeBaziRuleProfileDefinition(definition)
  return createHash('sha256').update(canonicalJson(normalized)).digest('hex')
}

function createPublishedVersion(
  profile: BaziRuleProfile,
  versions: readonly PublishedBaziRuleProfileVersion[],
  actor: string,
  now: string,
): PublishedBaziRuleProfileVersion {
  const version = versions
    .filter((item) => item.profileId === profile.id)
    .reduce((highest, item) => Math.max(highest, item.version), 0) + 1
  const definition = normalizeBaziRuleProfileDefinition(profile.workingDefinition)
  const contentHash = hashBaziRuleProfileDefinition(definition)
  return {
    profileId: profile.id,
    versionId: `${profile.id}:v${version}:${contentHash.slice(0, 16)}`,
    version,
    key: profile.key,
    name: profile.name,
    ...(profile.description ? { description: profile.description } : {}),
    definition,
    contentHash,
    submittedForReviewAt: profile.submittedForReviewAt!,
    submittedForReviewBy: profile.submittedForReviewBy!,
    reviewedAt: now,
    reviewedBy: actor,
    publishedAt: now,
    publishedBy: actor,
  }
}

export function normalizeBaziRuleProfileCreateInput(input: unknown): CreateBaziRuleProfileInput {
  if (!isPlainObject(input) || hasUnexpectedKeys(input, ['key', 'name', 'description', 'workingDefinition'])) {
    throw new BaziRuleProfileValidationError('invalid bazi rule profile payload')
  }
  const key = requiredString(input.key, 'key', 64).toLowerCase()
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(key)) {
    throw new BaziRuleProfileValidationError('key must be lowercase kebab-case')
  }
  return {
    key,
    name: requiredString(input.name, 'name', 120),
    ...(optionalString(input.description, 'description', 2000) ? { description: optionalString(input.description, 'description', 2000) } : {}),
    workingDefinition: normalizeBaziRuleProfileDefinition(input.workingDefinition),
  }
}

export function normalizeBaziRuleProfileRevisionInput(input: unknown): ReviseBaziRuleProfileInput {
  if (!isPlainObject(input) || hasUnexpectedKeys(input, ['name', 'description', 'workingDefinition'])) {
    throw new BaziRuleProfileValidationError('invalid bazi rule profile revision payload')
  }
  const description = optionalString(input.description, 'description', 2000)
  return {
    name: requiredString(input.name, 'name', 120),
    ...(description ? { description } : {}),
    workingDefinition: normalizeBaziRuleProfileDefinition(input.workingDefinition),
  }
}

export function parseBaziRuleProfileRevisionRequest(input: unknown): ReviseBaziRuleProfileRequest {
  if (!isPlainObject(input) || hasUnexpectedKeys(input, ['name', 'description', 'workingDefinition', 'expectedRevision'])) {
    throw new BaziRuleProfileValidationError('invalid bazi rule profile revision payload')
  }
  if (!Number.isInteger(input.expectedRevision) || (input.expectedRevision as number) < 1) {
    throw new BaziRuleProfileValidationError('expectedRevision must be a positive integer')
  }
  return {
    input: normalizeBaziRuleProfileRevisionInput({
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      workingDefinition: input.workingDefinition,
    }),
    expectedRevision: input.expectedRevision as number,
  }
}

export function normalizeBaziRuleProfileDefinition(value: unknown): BaziRuleProfileDefinition {
  if (!isPlainObject(value) || hasUnexpectedKeys(value, ['schemaVersion', 'timeDefaults', 'assessments'])) {
    throw new BaziRuleProfileValidationError('definition contains unsupported fields')
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== 2) {
    throw new BaziRuleProfileValidationError('unsupported definition schemaVersion')
  }
  const timeDefaults = value.timeDefaults
  const assessments = value.assessments
  if (!isPlainObject(timeDefaults) || hasUnexpectedKeys(timeDefaults, ['timezone', 'dstPolicy', 'useTrueSolarTime', 'timeCorrectionRuleVersion', 'dayBoundary', 'luckMethod'])) {
    throw new BaziRuleProfileValidationError('invalid timeDefaults')
  }
  if (!isPlainObject(assessments) || hasUnexpectedKeys(assessments, ['strength', 'pattern', 'elementPreference', 'shenSha'])) {
    throw new BaziRuleProfileValidationError('invalid assessments')
  }
  if (timeDefaults.dstPolicy !== 'auto' && timeDefaults.dstPolicy !== 'ignore') throw new BaziRuleProfileValidationError('invalid dstPolicy')
  if (typeof timeDefaults.useTrueSolarTime !== 'boolean') throw new BaziRuleProfileValidationError('useTrueSolarTime must be boolean')
  const timeCorrectionRuleVersion = normalizeTimeCorrectionRuleVersion(timeDefaults.timeCorrectionRuleVersion)
  if (timeDefaults.dayBoundary !== 'midnight' && timeDefaults.dayBoundary !== 'zi-hour-start') throw new BaziRuleProfileValidationError('invalid dayBoundary')
  if (timeDefaults.luckMethod !== 'sect1' && timeDefaults.luckMethod !== 'sect2') throw new BaziRuleProfileValidationError('invalid luckMethod')
  const schemaVersion = value.schemaVersion
  const normalized: BaziRuleProfileDefinition = {
    ...(schemaVersion === 2 ? { schemaVersion: 2 as const } : {}),
    timeDefaults: {
      timezone: requiredString(timeDefaults.timezone, 'timezone', 100),
      dstPolicy: timeDefaults.dstPolicy,
      useTrueSolarTime: timeDefaults.useTrueSolarTime,
      ...(timeCorrectionRuleVersion ? { timeCorrectionRuleVersion } : {}),
      dayBoundary: timeDefaults.dayBoundary,
      luckMethod: timeDefaults.luckMethod,
    },
    assessments: {
      strength: normalizeMethod(assessments.strength, 'strength', schemaVersion),
      pattern: normalizeMethod(assessments.pattern, 'pattern', schemaVersion),
      ...(assessments.elementPreference !== undefined
        ? { elementPreference: normalizeMethod(assessments.elementPreference, 'elementPreference', schemaVersion) }
        : {}),
      shenSha: normalizeMethod(assessments.shenSha, 'shenSha', schemaVersion),
    },
  }
  if (schemaVersion === 2 && Buffer.byteLength(canonicalJson(normalized), 'utf8') > MAX_DEFINITION_CANONICAL_BYTES) {
    throw new BaziRuleProfileValidationError(`definition exceeds ${MAX_DEFINITION_CANONICAL_BYTES} canonical bytes`)
  }
  if (schemaVersion === 2) {
    const rules = Object.values(normalized.assessments).flatMap((method) => method.rules ?? [])
    if (rules.length > MAX_TOTAL_RULES) throw new BaziRuleProfileValidationError(`definition exceeds ${MAX_TOTAL_RULES} rules`)
    if (new Set(rules.map((rule) => rule.id)).size !== rules.length) {
      throw new BaziRuleProfileValidationError('definition contains duplicate rule id across assessment packs')
    }
  }
  return normalized
}

function normalizeTimeCorrectionRuleVersion(value: unknown): TrueSolarTimeRuleVersion | undefined {
  // Preserve legacy canonical JSON and content hashes. Effective calculation
  // defaults are resolved to v2 at the request boundary instead.
  if (value === undefined) return undefined
  if (value === 'true-solar-v2-zone-meridian-equation-of-time' || value === 'true-solar-v3-standard-time-equation-of-time') return value
  throw new BaziRuleProfileValidationError('timeCorrectionRuleVersion must be v2 or v3')
}

const MAX_RULES_PER_ASSESSMENT = 200
const MAX_TOTAL_RULES = 500
const MAX_CONDITIONS_PER_RULE = 20
const MAX_SOURCE_VERSIONS_PER_RULE = 20
const MAX_DEFINITION_CANONICAL_BYTES = 1_000_000
const PILLAR_TARGETS = ['year', 'month', 'day', 'hour'] as const
const FIXED_FACT_PATHS: ReadonlySet<BaziAssessmentFactPath> = new Set([
  'dayMaster.stem', 'dayMaster.element', 'dayMaster.yinYang',
  'pillars.year.stem', 'pillars.year.branch', 'pillars.month.stem', 'pillars.month.branch',
  'pillars.day.stem', 'pillars.day.branch', 'pillars.hour.stem', 'pillars.hour.branch',
  'tenGods.year', 'tenGods.month', 'tenGods.day', 'tenGods.hour',
  'fiveElements.counts.wood', 'fiveElements.counts.fire', 'fiveElements.counts.earth',
  'fiveElements.counts.metal', 'fiveElements.counts.water',
  'balance.supportScore', 'balance.oppositionScore', 'balance.netScore',
  'balance.rootCount', 'balance.resourceCount', 'balance.monthCommandSupports',
  'monthCommand.branch', 'monthCommand.mainQiStem', 'monthCommand.mainQiElement',
  'monthCommand.mainQiTenGod', 'monthCommand.mainQiVisibleAt', 'monthCommand.supportsDayMasterBaseline',
  'supportDimensions.monthCommandSupports', 'supportDimensions.rootedAt',
  'supportDimensions.visiblePeerAt', 'supportDimensions.visibleResourceAt',
  'hiddenStems.year', 'hiddenStems.month', 'hiddenStems.day', 'hiddenStems.hour',
  'pillarDetails.shenSha.names', 'relations.kinds',
])

function normalizeMethod(value: unknown, field: string, schemaVersion: unknown): BaziAssessmentMethodConfig {
  if (!isPlainObject(value) || hasUnexpectedKeys(value, ['enabled', 'method', 'ruleSetVersion', 'rules'])) {
    throw new BaziRuleProfileValidationError(`invalid ${field} assessment method`)
  }
  if (typeof value.enabled !== 'boolean') throw new BaziRuleProfileValidationError(`${field}.enabled must be boolean`)
  const method = requiredString(value.method, `${field}.method`, 120)
  const ruleSetVersion = requiredString(value.ruleSetVersion, `${field}.ruleSetVersion`, 120)
  if (schemaVersion !== 2) {
    if (value.rules !== undefined) throw new BaziRuleProfileValidationError(`${field}.rules requires schemaVersion 2`)
    return { enabled: value.enabled, method, ruleSetVersion }
  }
  if (method !== 'decision-table-v1') {
    throw new BaziRuleProfileValidationError(`${field}.method must be decision-table-v1 for schemaVersion 2`)
  }
  if (value.rules !== undefined && !Array.isArray(value.rules)) {
    throw new BaziRuleProfileValidationError(`${field}.rules must be an array`)
  }
  const rules = (value.rules ?? []).map((rule, index) => normalizeAssessmentRule(rule, `${field}.rules[${index}]`))
  if (rules.length > MAX_RULES_PER_ASSESSMENT) {
    throw new BaziRuleProfileValidationError(`${field}.rules exceeds ${MAX_RULES_PER_ASSESSMENT} entries`)
  }
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length) {
    throw new BaziRuleProfileValidationError(`${field}.rules contains duplicate rule id`)
  }
  if (value.enabled && rules.length === 0) {
    throw new BaziRuleProfileValidationError(`${field}.rules must contain at least one rule when enabled`)
  }
  return {
    enabled: value.enabled,
    method,
    ruleSetVersion,
    rules,
  }
}

function normalizeAssessmentRule(value: unknown, field: string): BaziAssessmentRule {
  if (!isPlainObject(value) || hasUnexpectedKeys(value, ['id', 'priority', 'all', 'output', 'sourceVersionIds'])) {
    throw new BaziRuleProfileValidationError(`invalid ${field}`)
  }
  const id = requiredString(value.id, `${field}.id`, 120)
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(id)) {
    throw new BaziRuleProfileValidationError(`${field}.id must be a stable lowercase identifier`)
  }
  if (!Number.isSafeInteger(value.priority) || Number(value.priority) < 0 || Number(value.priority) > 10_000) {
    throw new BaziRuleProfileValidationError(`${field}.priority must be an integer from 0 to 10000`)
  }
  if (!Array.isArray(value.all) || value.all.length > MAX_CONDITIONS_PER_RULE) {
    throw new BaziRuleProfileValidationError(`${field}.all must contain at most ${MAX_CONDITIONS_PER_RULE} conditions`)
  }
  if (!isPlainObject(value.output) || hasUnexpectedKeys(value.output, ['code', 'label', 'targets', 'elementDirection'])) {
    throw new BaziRuleProfileValidationError(`invalid ${field}.output`)
  }
  const code = requiredString(value.output.code, `${field}.output.code`, 120)
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(code)) {
    throw new BaziRuleProfileValidationError(`${field}.output.code must be a stable lowercase identifier`)
  }
  const label = requiredString(value.output.label, `${field}.output.label`, 120)
  const elementDirection = value.output.elementDirection === undefined
    ? undefined
    : normalizeElementDirection(value.output.elementDirection, `${field}.output.elementDirection`)
  let targets: typeof PILLAR_TARGETS[number][] | undefined
  if (value.output.targets !== undefined) {
    if (!Array.isArray(value.output.targets) || value.output.targets.length === 0) {
      throw new BaziRuleProfileValidationError(`${field}.output.targets must be a non-empty array`)
    }
    targets = value.output.targets.map((target, index) => {
      if (!PILLAR_TARGETS.includes(target as typeof PILLAR_TARGETS[number])) {
        throw new BaziRuleProfileValidationError(`invalid ${field}.output.targets[${index}]`)
      }
      return target as typeof PILLAR_TARGETS[number]
    })
    if (new Set(targets).size !== targets.length) throw new BaziRuleProfileValidationError(`${field}.output.targets contains duplicates`)
  }
  if (!Array.isArray(value.sourceVersionIds) || value.sourceVersionIds.length === 0 || value.sourceVersionIds.length > MAX_SOURCE_VERSIONS_PER_RULE) {
    throw new BaziRuleProfileValidationError(`${field}.sourceVersionIds must contain 1 to ${MAX_SOURCE_VERSIONS_PER_RULE} entries`)
  }
  const sourceVersionIds = value.sourceVersionIds.map((source, index) => requiredString(source, `${field}.sourceVersionIds[${index}]`, 200))
  if (new Set(sourceVersionIds).size !== sourceVersionIds.length) throw new BaziRuleProfileValidationError(`${field}.sourceVersionIds contains duplicates`)
  return {
    id,
    priority: Number(value.priority),
    all: value.all.map((condition, index) => normalizeAssessmentCondition(condition, `${field}.all[${index}]`)),
    output: { code, label, ...(targets ? { targets } : {}), ...(elementDirection ? { elementDirection } : {}) },
    sourceVersionIds,
  }
}

const FIVE_ELEMENTS = ['wood', 'fire', 'earth', 'metal', 'water'] as const

function normalizeElementDirection(value: unknown, field: string): ElementBalanceDirection {
  if (!isPlainObject(value) || hasUnexpectedKeys(value, ['scope', 'direction', 'candidateElements', 'cautiousElements', 'limitations'])) {
    throw new BaziRuleProfileValidationError(`invalid ${field}`)
  }
  if (value.scope !== 'support-balance-baseline') throw new BaziRuleProfileValidationError(`${field}.scope is invalid`)
  if (!['add-support', 'reduce-support', 'balanced-undetermined'].includes(String(value.direction))) {
    throw new BaziRuleProfileValidationError(`${field}.direction is invalid`)
  }
  const elements = (entry: unknown, name: string) => {
    if (!Array.isArray(entry) || entry.some((item) => !FIVE_ELEMENTS.includes(item as typeof FIVE_ELEMENTS[number]))) {
      throw new BaziRuleProfileValidationError(`${field}.${name} is invalid`)
    }
    if (new Set(entry).size !== entry.length) throw new BaziRuleProfileValidationError(`${field}.${name} contains duplicates`)
    return entry as (typeof FIVE_ELEMENTS[number])[]
  }
  if (!Array.isArray(value.limitations) || value.limitations.length === 0 || value.limitations.length > 8) {
    throw new BaziRuleProfileValidationError(`${field}.limitations must contain 1 to 8 entries`)
  }
  return {
    scope: 'support-balance-baseline',
    direction: value.direction as 'add-support' | 'reduce-support' | 'balanced-undetermined',
    candidateElements: elements(value.candidateElements, 'candidateElements'),
    cautiousElements: elements(value.cautiousElements, 'cautiousElements'),
    limitations: value.limitations.map((item, index) => requiredString(item, `${field}.limitations[${index}]`, 240)),
  }
}

function normalizeAssessmentCondition(value: unknown, field: string): BaziAssessmentCondition {
  if (!isPlainObject(value) || hasUnexpectedKeys(value, ['fact', 'operator', 'value'])) {
    throw new BaziRuleProfileValidationError(`invalid ${field}`)
  }
  const factValue = requiredString(value.fact, `${field}.fact`, 120)
  if (!FIXED_FACT_PATHS.has(factValue as BaziAssessmentFactPath)) throw new BaziRuleProfileValidationError(`${field}.fact is not allowed`)
  const fact = factValue as BaziAssessmentFactPath
  const operator = requiredString(value.operator, `${field}.operator`, 20)
  const hasValue = Object.prototype.hasOwnProperty.call(value, 'value') && value.value !== undefined
  switch (operator) {
    case 'exists':
      if (hasValue && typeof value.value !== 'boolean') throw new BaziRuleProfileValidationError(`${field}.value must be boolean for exists`)
      return hasValue ? { fact, operator, value: value.value as boolean } : { fact, operator }
    case 'equals':
      if (!hasValue || !isConditionValue(value.value)) throw new BaziRuleProfileValidationError(`${field}.value has an invalid type for equals`)
      return { fact, operator, value: normalizeConditionValue(value.value) }
    case 'in':
      if (!Array.isArray(value.value) || value.value.length === 0 || value.value.length > 50 || value.value.some((item) => typeof item !== 'string' || !item.trim())) {
        throw new BaziRuleProfileValidationError(`${field}.value must be 1 to 50 non-empty strings for in`)
      }
      const choices = value.value.map((item) => item.trim().normalize('NFC'))
      if (new Set(choices).size !== choices.length) throw new BaziRuleProfileValidationError(`${field}.value contains duplicates`)
      return { fact, operator, value: choices }
    case 'contains':
      if (typeof value.value === 'string' && value.value.trim()) {
        return { fact, operator, value: value.value.trim().normalize('NFC') }
      }
      if (Array.isArray(value.value) && value.value.length > 0 && value.value.length <= 50 && value.value.every((item) => typeof item === 'string' && item.trim())) {
        const items = value.value.map((item) => item.trim().normalize('NFC'))
        if (new Set(items).size !== items.length) throw new BaziRuleProfileValidationError(`${field}.value contains duplicates`)
        return { fact, operator, value: items }
      }
      throw new BaziRuleProfileValidationError(`${field}.value must be a non-empty string or string array for contains`)
    case 'gt': case 'gte': case 'lt': case 'lte':
      if (typeof value.value !== 'number' || !Number.isFinite(value.value)) throw new BaziRuleProfileValidationError(`${field}.value must be a finite number for ${operator}`)
      return { fact, operator, value: value.value }
    default:
      throw new BaziRuleProfileValidationError(`${field}.operator is not allowed`)
  }
}

function isConditionValue(value: unknown): value is string | number | boolean | string[] {
  return typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && Boolean(value.trim()))
    || (Array.isArray(value) && value.length <= 50 && value.every((item) => typeof item === 'string' && Boolean(item.trim())))
}

function normalizeConditionValue(value: string | number | boolean | string[]): string | number | boolean | string[] {
  if (typeof value === 'string') return value.trim().normalize('NFC')
  if (Array.isArray(value)) return value.map((item) => item.trim().normalize('NFC'))
  return value
}

function validateStore(value: unknown): RuleProfileStoreData {
  if (!isPlainObject(value) || hasUnexpectedKeys(value, ['schemaVersion', 'profiles', 'versions']) || value.schemaVersion !== 1 || !Array.isArray(value.profiles) || !Array.isArray(value.versions)) {
    throw new BaziRuleProfileValidationError('invalid bazi rule profile store')
  }
  const profiles = value.profiles.map(validateStoredProfile)
  const versions = value.versions.map(validateStoredVersion)
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new BaziRuleProfileValidationError('duplicate profile id')
  if (new Set(profiles.map((profile) => profile.key)).size !== profiles.length) throw new BaziRuleProfileValidationError('duplicate profile key')
  if (new Set(versions.map((version) => version.versionId)).size !== versions.length) throw new BaziRuleProfileValidationError('duplicate version id')
  for (const profile of profiles) {
    if (profile.currentPublishedVersionId && !versions.some((version) => version.versionId === profile.currentPublishedVersionId && version.profileId === profile.id)) {
      throw new BaziRuleProfileValidationError('profile references an unknown published version')
    }
  }
  for (const version of versions) {
    if (!profiles.some((profile) => profile.id === version.profileId)) throw new BaziRuleProfileValidationError('version references an unknown profile')
    if (version.contentHash !== hashBaziRuleProfileDefinition(version.definition)) throw new BaziRuleProfileValidationError('published version content hash mismatch')
  }
  const versionKeys = versions.map((version) => `${version.profileId}:${version.version}`)
  if (new Set(versionKeys).size !== versionKeys.length) throw new BaziRuleProfileValidationError('duplicate profile version')
  return { schemaVersion: 1, profiles, versions }
}

function validateStoredProfile(value: unknown): BaziRuleProfile {
  if (!isPlainObject(value) || hasUnexpectedKeys(value, [
    'id', 'key', 'name', 'description', 'state', 'revision', 'workingDefinition', 'currentPublishedVersionId',
    'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'submittedForReviewAt', 'submittedForReviewBy',
    'reviewedAt', 'reviewedBy', 'archivedAt', 'archivedBy',
  ])) throw new BaziRuleProfileValidationError('invalid stored profile')
  const normalized = normalizeBaziRuleProfileCreateInput({ key: value.key, name: value.name, description: value.description, workingDefinition: value.workingDefinition })
  if (!isBaziRuleProfileState(value.state)) throw new BaziRuleProfileValidationError('invalid stored profile state')
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1) throw new BaziRuleProfileValidationError('invalid profile revision')
  const profile: BaziRuleProfile = {
    id: requiredString(value.id, 'id', 200),
    ...normalized,
    state: value.state,
    revision: Number(value.revision),
    ...(value.currentPublishedVersionId !== undefined ? { currentPublishedVersionId: requiredString(value.currentPublishedVersionId, 'currentPublishedVersionId', 200) } : {}),
    createdAt: isoString(value.createdAt, 'createdAt'),
    createdBy: requiredString(value.createdBy, 'createdBy', 200),
    updatedAt: isoString(value.updatedAt, 'updatedAt'),
    updatedBy: requiredString(value.updatedBy, 'updatedBy', 200),
  }
  copyOptionalAudit(value, profile, 'submittedForReviewAt', 'submittedForReviewBy')
  copyOptionalAudit(value, profile, 'reviewedAt', 'reviewedBy')
  copyOptionalAudit(value, profile, 'archivedAt', 'archivedBy')
  return profile
}

function validateStoredVersion(value: unknown): PublishedBaziRuleProfileVersion {
  if (!isPlainObject(value) || hasUnexpectedKeys(value, [
    'profileId', 'versionId', 'version', 'key', 'name', 'description', 'definition', 'contentHash',
    'submittedForReviewAt', 'submittedForReviewBy', 'reviewedAt', 'reviewedBy', 'publishedAt', 'publishedBy',
  ])) throw new BaziRuleProfileValidationError('invalid stored published version')
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 1) throw new BaziRuleProfileValidationError('invalid published version number')
  const contentHash = requiredString(value.contentHash, 'contentHash', 64)
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new BaziRuleProfileValidationError('invalid contentHash')
  const description = optionalString(value.description, 'description', 2000)
  return {
    profileId: requiredString(value.profileId, 'profileId', 200),
    versionId: requiredString(value.versionId, 'versionId', 240),
    version: Number(value.version),
    key: requiredString(value.key, 'key', 64),
    name: requiredString(value.name, 'name', 120),
    ...(description ? { description } : {}),
    definition: normalizeBaziRuleProfileDefinition(value.definition),
    contentHash,
    submittedForReviewAt: isoString(value.submittedForReviewAt, 'submittedForReviewAt'),
    submittedForReviewBy: requiredString(value.submittedForReviewBy, 'submittedForReviewBy', 200),
    reviewedAt: isoString(value.reviewedAt, 'reviewedAt'),
    reviewedBy: requiredString(value.reviewedBy, 'reviewedBy', 200),
    publishedAt: isoString(value.publishedAt, 'publishedAt'),
    publishedBy: requiredString(value.publishedBy, 'publishedBy', 200),
  }
}

function copyOptionalAudit(source: Record<string, unknown>, target: BaziRuleProfile, at: keyof BaziRuleProfile, by: keyof BaziRuleProfile) {
  if (source[at] === undefined && source[by] === undefined) return
  if (source[at] === undefined || source[by] === undefined) throw new BaziRuleProfileValidationError(`${String(at)} and ${String(by)} must be paired`)
  Object.assign(target, { [at]: isoString(source[at], String(at)), [by]: requiredString(source[by], String(by), 200) })
}

async function atomicWriteStore(path: string, store: RuleProfileStoreData): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await rename(temporaryPath, path)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

function emptyStore(): RuleProfileStoreData {
  return { schemaVersion: 1, profiles: [], versions: [] }
}

export function isAllowedBaziRuleProfileTransition(from: BaziRuleProfileState, to: BaziRuleProfileState): boolean {
  return (from === 'draft' && to === 'in-review')
    || (from === 'draft' && to === 'published')
    || (from === 'in-review' && to === 'published')
    || (from === 'published' && to === 'archived')
}

export function isBaziRuleProfileState(value: unknown): value is BaziRuleProfileState {
  return value === 'draft' || value === 'in-review' || value === 'published' || value === 'archived'
}

export function normalizeBaziRuleProfileActor(value: unknown): string {
  return requiredString(value, 'actor', 200)
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new BaziRuleProfileValidationError(`${field} must be a non-empty string of at most ${maxLength} characters`)
  }
  return value.trim().normalize('NFC')
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requiredString(value, field, maxLength)
}

function isoString(value: unknown, field: string): string {
  const normalized = requiredString(value, field, 40)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    throw new BaziRuleProfileValidationError(`${field} must be an ISO UTC timestamp`)
  }
  return normalized
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function hasUnexpectedKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).some((key) => !allowedKeys.has(key))
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
