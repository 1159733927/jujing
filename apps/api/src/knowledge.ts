import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  ExpertAsset,
  ExpertAssetKind,
  PublicationState,
  PublishedKnowledgeVersion,
  StructuredRuleDefinition,
} from '@fengshui/knowledge-contracts'
import { validateStructuredRule } from './rules.js'

export interface CreateAssetInput {
  kind: ExpertAssetKind
  title: string
  tags: readonly string[]
  body: string
  sourceLabel: string
  rule?: StructuredRuleDefinition
}

export interface ReviseAssetRequest {
  input: CreateAssetInput
  expectedRevision: number
}

const knowledgeAssetKinds = new Set<ExpertAssetKind>(['article', 'rule', 'skill'])
const knowledgeRequestKeys = new Set(['kind', 'title', 'tags', 'body', 'sourceLabel', 'rule'])
const knowledgeRevisionRequestKeys = new Set([...knowledgeRequestKeys, 'expectedRevision'])
const MAX_KNOWLEDGE_TITLE_LENGTH = 200
const MAX_KNOWLEDGE_SOURCE_LABEL_LENGTH = 200
const MAX_KNOWLEDGE_BODY_LENGTH = 200_000
const MAX_KNOWLEDGE_TAGS = 20
const MAX_KNOWLEDGE_TAG_LENGTH = 40
const chineseWordSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
const knowledgeSynonyms: Record<string, readonly string[]> = {
  厨房: ['厨', '灶', '灶位', '炉灶'],
  灶位: ['厨房', '厨', '灶', '炉灶'],
  卫生间: ['厕所', '厕', '浴厕', '水厕'],
  厕所: ['卫生间', '厕', '浴厕', '水厕'],
  入户: ['大门', '门向', '门路', '玄关'],
  玄关: ['入户', '大门', '门向', '门路'],
  客厅: ['厅', '明堂', '内明堂'],
  明堂: ['客厅', '厅', '内明堂'],
  卧室: ['房', '寝室', '床位'],
  书房: ['文昌', '读书', '办公'],
  朝向: ['坐向', '山向', '向首'],
  坐向: ['朝向', '山向', '向首'],
  玄空: ['飞星', '元运', '山向'],
  南向: ['离方', '午方', '朝南'],
  北向: ['坎方', '子方', '朝北'],
  东向: ['震方', '卯方', '朝东'],
  西向: ['兑方', '酉方', '朝西'],
  木: ['东方', '震', '巽'],
  火: ['南方', '离'],
  土: ['中宫', '艮', '坤'],
  金: ['西方', '乾', '兑'],
  水: ['北方', '坎'],
}

export function knowledgeSearchTerms(query: string): string[] {
  const normalized = query.toLocaleLowerCase('zh-CN').trim()
  if (!normalized) return []
  if (/^\p{Script=Han}{2,4}$/u.test(normalized)) return [normalized]
  const terms = new Set<string>()
  for (const segment of chineseWordSegmenter.segment(normalized)) {
    const term = segment.segment.trim()
    if (!segment.isWordLike || !term) continue
    const containsHan = /\p{Script=Han}/u.test(term)
    if (containsHan && [...term].length < 2) continue
    terms.add(term)
  }
  for (const match of normalized.matchAll(/\p{Script=Han}+/gu)) {
    const characters = [...match[0]]
    if (characters.length < 2) continue
    terms.add(characters.join(''))
    for (let index = 0; index < characters.length - 1; index += 1) {
      terms.add(`${characters[index]}${characters[index + 1]}`)
    }
    for (let index = 0; index < characters.length - 2; index += 1) {
      terms.add(`${characters[index]}${characters[index + 1]}${characters[index + 2]}`)
    }
  }
  if (terms.size === 0) terms.add(normalized)
  for (const term of [...terms]) {
    for (const synonym of knowledgeSynonyms[term] ?? []) terms.add(synonym)
  }
  return [...terms]
}

const importedMetadataLine = /^(?:importFingerprint|sourceFile|sourceHash|sourceSha256|bookTitle|author|school|sourcePages|sourceChunk|chapter|contentHash)\s*:/i

export function cleanKnowledgeBody(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !importedMetadataLine.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function occurrenceCount(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let offset = 0
  while ((offset = haystack.indexOf(needle, offset)) >= 0) {
    count += 1
    offset += needle.length
  }
  return count
}

export function knowledgeMatchExcerpt(body: string, terms: readonly string[], maxLength = 180): string {
  const cleanBody = cleanKnowledgeBody(body)
  if (cleanBody.length <= maxLength) return cleanBody
  const normalizedBody = cleanBody.toLocaleLowerCase('zh-CN')
  const positions = terms
    .map((term) => normalizedBody.indexOf(term))
    .filter((position) => position >= 0)
  if (!positions.length) return `${cleanBody.slice(0, maxLength - 1).trimEnd()}…`
  const matchAt = Math.min(...positions)
  const start = Math.max(0, matchAt - Math.floor(maxLength * 0.35))
  const end = Math.min(cleanBody.length, start + maxLength - 2)
  return `${start > 0 ? '…' : ''}${cleanBody.slice(start, end).trim()}${end < cleanBody.length ? '…' : ''}`
}

/**
 * Demo lexical retrieval. It deliberately keeps storage immutable and returns a
 * query-specific projection whose excerpt is centred on the matching evidence.
 */
export function grepPublishedKnowledge(
  versions: readonly AuditedPublishedKnowledgeVersion[],
  query: string,
  limit = 5,
): AuditedPublishedKnowledgeVersion[] {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 5
  const terms = knowledgeSearchTerms(query)
  if (!terms.length) {
    return versions.slice(0, safeLimit).map((version) => ({
      ...version,
      exactExcerpt: knowledgeMatchExcerpt(version.body, []),
    }))
  }
  const normalizedQuery = query.toLocaleLowerCase('zh-CN').trim()
  return versions
    .map((version) => {
      const title = version.title.toLocaleLowerCase('zh-CN')
      const tags = version.tags.join(' ').toLocaleLowerCase('zh-CN')
      const body = cleanKnowledgeBody(version.body).toLocaleLowerCase('zh-CN')
      const matchedTerms = terms.filter((term) => title.includes(term) || tags.includes(term) || body.includes(term))
      const phraseBonus = normalizedQuery.length >= 2
        ? (title.includes(normalizedQuery) ? 80 : 0) + (tags.includes(normalizedQuery) ? 50 : 0) + (body.includes(normalizedQuery) ? 25 : 0)
        : 0
      // Articles are report evidence; rules and skills have dedicated execution paths.
      const kindPriority = version.kind === 'article' ? 100 : 0
      const lexicalScore = phraseBonus + matchedTerms.reduce((total, term) => total
        + Math.min(occurrenceCount(title, term), 3) * 20
        + Math.min(occurrenceCount(tags, term), 3) * 12
        + Math.min(occurrenceCount(body, term), 5) * 3, 0)
      const score = matchedTerms.length ? kindPriority + lexicalScore : 0
      return { version, matchedTerms, score }
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.version.versionId.localeCompare(right.version.versionId))
    .slice(0, safeLimit)
    .map(({ version, matchedTerms }) => ({
      ...version,
      exactExcerpt: knowledgeMatchExcerpt(version.body, matchedTerms),
    }))
}

export interface AuditedExpertAsset extends ExpertAsset {
  createdAt: string
  createdBy: string
  updatedBy: string
  submittedForReviewAt?: string
  submittedForReviewBy?: string
  reviewedAt?: string
  reviewedBy?: string
  archivedAt?: string
  archivedBy?: string
}

export interface AuditedPublishedKnowledgeVersion extends PublishedKnowledgeVersion {
  submittedForReviewAt: string
  submittedForReviewBy: string
  reviewedAt: string
  reviewedBy: string
  publishedBy: string
}

interface KnowledgeStoreData {
  schemaVersion: 4
  assets: AuditedExpertAsset[]
  versions: AuditedPublishedKnowledgeVersion[]
}

export class InvalidKnowledgeTransitionError extends Error {
  constructor(from: PublicationState, to: PublicationState) {
    super(`invalid knowledge publication transition: ${from} -> ${to}`)
    this.name = 'InvalidKnowledgeTransitionError'
  }
}

export class KnowledgePublicationValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgePublicationValidationError'
  }
}

export class KnowledgeRevisionConflictError extends Error {
  constructor(message = 'knowledge asset revision conflict') {
    super(message)
    this.name = 'KnowledgeRevisionConflictError'
  }
}

export interface KnowledgeStore {
  list(): Promise<AuditedExpertAsset[]>
  listVersions(assetId?: string): Promise<AuditedPublishedKnowledgeVersion[]>
  getVersion(versionId: string): Promise<AuditedPublishedKnowledgeVersion | undefined>
  create(input: CreateAssetInput, actor?: string): Promise<AuditedExpertAsset>
  revise(id: string, input: CreateAssetInput, actor?: string, expectedRevision?: number): Promise<AuditedExpertAsset | undefined>
  setState(id: string, state: PublicationState, actor: string): Promise<AuditedExpertAsset | undefined>
  search(query: string, limit?: number): Promise<AuditedPublishedKnowledgeVersion[]>
  publishedRules(): Promise<AuditedPublishedKnowledgeVersion[]>
  /** Physically removes an asset and all of its immutable published versions. */
  delete(id: string): Promise<boolean>
  ping(): Promise<void>
  close(): Promise<void>
}

export class KnowledgeRepository implements KnowledgeStore {
  private writeQueue: Promise<void> = Promise.resolve()
  constructor(private readonly path: string) {}

  async list(): Promise<AuditedExpertAsset[]> {
    await this.writeQueue
    return [...(await this.readStore()).assets]
  }

  async listVersions(assetId?: string): Promise<AuditedPublishedKnowledgeVersion[]> {
    await this.writeQueue
    const versions = (await this.readStore()).versions
    return versions.filter((version) => !assetId || version.assetId === assetId)
  }

  async getVersion(versionId: string): Promise<AuditedPublishedKnowledgeVersion | undefined> {
    await this.writeQueue
    return (await this.readStore()).versions.find((version) => version.versionId === versionId)
  }

  async create(input: CreateAssetInput, actor = 'legacy-system-editor'): Promise<AuditedExpertAsset> {
    const normalizedInput = normalizeKnowledgeAssetInput(input)
    const normalizedActor = normalizeKnowledgeActor(actor)
    let asset!: AuditedExpertAsset
    await this.mutate((store) => {
      const now = new Date().toISOString()
      asset = { ...normalizedInput, id: crypto.randomUUID(), version: 1, state: 'draft', createdAt: now, createdBy: normalizedActor, updatedAt: now, updatedBy: normalizedActor }
      return { ...store, assets: [...store.assets, asset] }
    })
    return asset
  }

  async revise(id: string, input: CreateAssetInput, actor = 'legacy-system-editor', expectedRevision?: number): Promise<AuditedExpertAsset | undefined> {
    const normalizedInput = normalizeKnowledgeAssetInput(input)
    const normalizedActor = normalizeKnowledgeActor(actor)
    let revised: AuditedExpertAsset | undefined
    await this.mutate((store) => {
      const current = store.assets.find((asset) => asset.id === id)
      if (!current) return store
      if (expectedRevision !== undefined && current.version !== expectedRevision) throw new KnowledgeRevisionConflictError()
      if (current.state === 'in-review') throw new InvalidKnowledgeTransitionError('in-review', 'draft')
      if (current.state === 'archived') throw new InvalidKnowledgeTransitionError('archived', 'draft')
      revised = {
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
      return { ...store, assets: store.assets.map((asset) => asset.id === id ? revised! : asset) }
    })
    return revised
  }

  async setState(id: string, state: PublicationState, actor: string): Promise<AuditedExpertAsset | undefined> {
    const normalizedActor = normalizeKnowledgeActor(actor)
    let next: AuditedExpertAsset | undefined
    await this.mutate((store) => {
      const current = store.assets.find((asset) => asset.id === id)
      if (!current) return store
      if (!isAllowedKnowledgeTransition(current.state, state)) {
        throw new InvalidKnowledgeTransitionError(current.state, state)
      }
      if (state === 'published' && current.kind === 'rule') {
        const error = validateStructuredRule(current.rule)
        if (error) throw new KnowledgePublicationValidationError(error)
        validateRuleSources(current.rule, store)
      }
      const now = new Date().toISOString()
      if (state === 'in-review') {
        next = { ...current, state, updatedAt: now, updatedBy: normalizedActor, submittedForReviewAt: now, submittedForReviewBy: normalizedActor }
      } else if (state === 'published') {
        const submittedForReviewAt = current.submittedForReviewAt ?? now
        const submittedForReviewBy = current.submittedForReviewBy ?? normalizedActor
        const reviewed: AuditedExpertAsset = {
          ...current,
          state,
          updatedAt: now,
          updatedBy: normalizedActor,
          submittedForReviewAt,
          submittedForReviewBy,
          reviewedAt: now,
          reviewedBy: normalizedActor,
        }
        const existingVersion = store.versions.find((version) => version.assetId === current.id && version.version === current.version)
        const snapshot = existingVersion ?? publishedSnapshot(reviewed, normalizedActor)
        next = { ...reviewed, currentPublishedVersionId: snapshot.versionId }
      } else {
        const { currentPublishedVersionId: _removed, ...withoutPublishedPointer } = current
        next = { ...withoutPublishedPointer, state, updatedAt: now, updatedBy: normalizedActor, archivedAt: now, archivedBy: normalizedActor }
      }
      const versions = state === 'published' && !store.versions.some((version) => version.assetId === current.id && version.version === current.version)
        ? [...store.versions, publishedSnapshot(next, normalizedActor)]
        : store.versions
      return { ...store, assets: store.assets.map((asset) => asset.id === id ? next! : asset), versions }
    })
    return next
  }

  /** Public retrieval follows each asset's explicit immutable published-version pointer. */
  async search(query: string, limit = 5): Promise<AuditedPublishedKnowledgeVersion[]> {
    await this.writeQueue
    const store = await this.readStore()
    const activeVersionIds = new Set(store.assets.flatMap((asset) => asset.currentPublishedVersionId ? [asset.currentPublishedVersionId] : []))
    const published = store.versions.filter((version) => activeVersionIds.has(version.versionId))
    return grepPublishedKnowledge(published, query, limit)
  }

  async publishedRules(): Promise<AuditedPublishedKnowledgeVersion[]> {
    return (await this.search('', Number.MAX_SAFE_INTEGER)).filter((version) => version.kind === 'rule')
  }

  async delete(id: string): Promise<boolean> {
    let deleted = false
    await this.mutate((store) => {
      if (!store.assets.some((asset) => asset.id === id)) return store
      deleted = true
      return {
        ...store,
        assets: store.assets.filter((asset) => asset.id !== id),
        versions: store.versions.filter((version) => version.assetId !== id),
      }
    })
    return deleted
  }

  async ping(): Promise<void> {
    await this.writeQueue
    await this.readStore()
  }

  async close(): Promise<void> {}

  private async readStore(): Promise<KnowledgeStoreData> {
    try {
      return migrateKnowledgeStore(JSON.parse(await readFile(this.path, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyKnowledgeStore()
      throw error
    }
  }

  private async write(store: KnowledgeStoreData): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.${crypto.randomUUID()}.tmp`
    await writeFile(temporaryPath, JSON.stringify(store, null, 2), { mode: 0o600 })
    await rename(temporaryPath, this.path)
  }

  private async mutate(operation: (store: KnowledgeStoreData) => KnowledgeStoreData): Promise<void> {
    const task = this.writeQueue.then(async () => this.write(operation(await this.readStore())))
    // Reset only the queue tail after failure. The current caller still awaits
    // `task` and receives the original rejection, while later writes may retry.
    this.writeQueue = task.catch(() => undefined)
    await task
  }
}

export function parseKnowledgeAssetRequest(value: unknown, mode: 'create'): CreateAssetInput
export function parseKnowledgeAssetRequest(value: unknown, mode: 'revise'): ReviseAssetRequest
export function parseKnowledgeAssetRequest(value: unknown, mode: 'create' | 'revise'): CreateAssetInput | ReviseAssetRequest {
  if (!isPlainObject(value)) throw new KnowledgePublicationValidationError('knowledge request body must be an object')
  const allowedKeys = mode === 'revise' ? knowledgeRevisionRequestKeys : knowledgeRequestKeys
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key))
  if (unknownKey) throw new KnowledgePublicationValidationError(`unsupported knowledge field: ${unknownKey}`)
  const input = normalizeKnowledgeAssetInput(value)
  if (mode === 'create') return input
  if (!Number.isInteger(value.expectedRevision) || (value.expectedRevision as number) < 1) {
    throw new KnowledgePublicationValidationError('expectedRevision must be a positive integer')
  }
  return { input, expectedRevision: value.expectedRevision as number }
}

export function normalizeKnowledgeAssetInput(value: unknown): CreateAssetInput {
  if (!isPlainObject(value)) throw new KnowledgePublicationValidationError('knowledge asset must be an object')
  if (typeof value.kind !== 'string' || !knowledgeAssetKinds.has(value.kind as ExpertAssetKind)) {
    throw new KnowledgePublicationValidationError('kind must be one of article, rule or skill')
  }
  const title = normalizeBoundedText(value.title, 'title', MAX_KNOWLEDGE_TITLE_LENGTH)
  const sourceLabel = normalizeBoundedText(value.sourceLabel, 'sourceLabel', MAX_KNOWLEDGE_SOURCE_LABEL_LENGTH)
  const body = normalizeBoundedText(value.body, 'body', MAX_KNOWLEDGE_BODY_LENGTH)
  if (!Array.isArray(value.tags)) throw new KnowledgePublicationValidationError('tags must be an array of strings')
  if (value.tags.length > MAX_KNOWLEDGE_TAGS) throw new KnowledgePublicationValidationError(`tags must contain at most ${MAX_KNOWLEDGE_TAGS} items`)
  const tags: string[] = []
  const seenTags = new Set<string>()
  for (const rawTag of value.tags) {
    if (typeof rawTag !== 'string') throw new KnowledgePublicationValidationError('every tag must be a string')
    const tag = rawTag.trim()
    if (!tag || tag.length > MAX_KNOWLEDGE_TAG_LENGTH) {
      throw new KnowledgePublicationValidationError(`every tag must contain 1-${MAX_KNOWLEDGE_TAG_LENGTH} characters after trimming`)
    }
    if (!seenTags.has(tag)) {
      seenTags.add(tag)
      tags.push(tag)
    }
  }
  const kind = value.kind as ExpertAssetKind
  if (value.rule !== undefined && kind !== 'rule') {
    throw new KnowledgePublicationValidationError('rule is only allowed for rule assets')
  }
  const rule = value.rule === undefined ? undefined : normalizeStructuredRule(value.rule)
  return { kind, title, tags, body, sourceLabel, ...(rule ? { rule } : {}) }
}

function normalizeBoundedText(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== 'string') throw new KnowledgePublicationValidationError(`${field} must be a string`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maximumLength) {
    throw new KnowledgePublicationValidationError(`${field} must contain 1-${maximumLength} characters after trimming`)
  }
  return normalized
}

function normalizeStructuredRule(value: unknown): StructuredRuleDefinition {
  if (!isPlainObject(value)) throw new KnowledgePublicationValidationError('rule must be an object')
  const allowedKeys = new Set(['priority', 'conditions', 'conclusions', 'sourceVersionIds', 'conflictGroup'])
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key))
  if (unknownKey) throw new KnowledgePublicationValidationError(`unsupported rule field: ${unknownKey}`)
  try {
    const rule = structuredClone(value) as unknown as StructuredRuleDefinition
    const error = validateStructuredRule(rule)
    if (error) throw new KnowledgePublicationValidationError(error)
    return rule
  } catch (error) {
    if (error instanceof KnowledgePublicationValidationError) throw error
    throw new KnowledgePublicationValidationError('rule must be a valid structured rule')
  }
}

function validateRuleSources(rule: StructuredRuleDefinition | undefined, store: KnowledgeStoreData): void {
  if (!rule?.sourceVersionIds?.length) return
  const activeVersionIds = new Set(store.assets.flatMap((asset) =>
    asset.state === 'published' && asset.kind !== 'rule' && asset.currentPublishedVersionId
      ? [asset.currentPublishedVersionId]
      : [],
  ))
  for (const sourceVersionId of rule.sourceVersionIds) {
    if (!activeVersionIds.has(sourceVersionId)) {
      throw new KnowledgePublicationValidationError(`rule source must reference an active published article or skill version: ${sourceVersionId}`)
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function publishedSnapshot(asset: AuditedExpertAsset, publishedBy = asset.reviewedBy): AuditedPublishedKnowledgeVersion {
  if (!asset.submittedForReviewAt || !asset.submittedForReviewBy || !asset.reviewedAt || !asset.reviewedBy || !publishedBy) {
    throw new KnowledgePublicationValidationError('complete review metadata is required for a published version')
  }
  const contentHash = hashContent(asset)
  return {
    assetId: asset.id,
    version: asset.version,
    versionId: `${asset.id}:v${asset.version}:${contentHash.slice(0, 16)}`,
    contentHash,
    kind: asset.kind,
    title: asset.title,
    tags: [...asset.tags],
    body: asset.body,
    sourceLabel: asset.sourceLabel,
    exactExcerpt: asset.body.slice(0, 500),
    submittedForReviewAt: asset.submittedForReviewAt,
    submittedForReviewBy: asset.submittedForReviewBy,
    reviewedAt: asset.reviewedAt,
    reviewedBy: asset.reviewedBy,
    publishedAt: new Date().toISOString(),
    publishedBy,
    ...(asset.rule ? { rule: asset.rule } : {}),
  }
}

export function hashContent(asset: ExpertAsset): string {
  const canonical = JSON.stringify({ kind: asset.kind, title: asset.title, tags: [...asset.tags], body: asset.body, sourceLabel: asset.sourceLabel, rule: asset.rule ?? null })
  return createHash('sha256').update(canonical).digest('hex')
}

export function normalizeKnowledgeActor(actor: string): string {
  const value = actor.trim()
  if (!value || value.length > 160) throw new KnowledgePublicationValidationError('knowledge actor must be between 1 and 160 characters')
  return value
}

export function isAllowedKnowledgeTransition(from: PublicationState, to: PublicationState): boolean {
  return (from === 'draft' && to === 'in-review')
    || (from === 'draft' && to === 'published')
    || (from === 'in-review' && to === 'published')
    || (from === 'published' && to === 'archived')
}

function emptyKnowledgeStore(): KnowledgeStoreData {
  return { schemaVersion: 4, assets: [], versions: [] }
}

function migrateKnowledgeStore(value: unknown): KnowledgeStoreData {
  const rawAssets = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { assets?: unknown }).assets)
      ? (value as { assets: unknown[] }).assets
      : []
  const rawVersions = !Array.isArray(value) && value && typeof value === 'object' && Array.isArray((value as { versions?: unknown }).versions)
    ? (value as { versions: unknown[] }).versions
    : []
  const migratedAssets = rawAssets.map((item) => migrateAsset(item as ExpertAsset & Partial<AuditedExpertAsset>))
  const byId = new Map(migratedAssets.map((asset) => [asset.id, asset]))
  const versions = rawVersions.map((item) => migrateVersion(item as PublishedKnowledgeVersion & Partial<AuditedPublishedKnowledgeVersion>, byId.get((item as PublishedKnowledgeVersion).assetId)))
  if (Array.isArray(value)) {
    for (const asset of migratedAssets.filter((item) => item.state === 'published')) versions.push(publishedSnapshot(asset, asset.reviewedBy))
  }
  for (const asset of migratedAssets.filter((item) => item.state === 'published')) {
    if (!versions.some((version) => version.assetId === asset.id && version.version === asset.version)) {
      versions.push(publishedSnapshot(asset, asset.reviewedBy))
    }
  }
  const assets = migratedAssets.map((asset) => migratePublishedPointer(asset, versions))
  return { schemaVersion: 4, assets, versions }
}

function migratePublishedPointer(asset: AuditedExpertAsset, versions: readonly AuditedPublishedKnowledgeVersion[]): AuditedExpertAsset {
  if (asset.state === 'archived') {
    const { currentPublishedVersionId: _removed, ...withoutPublishedPointer } = asset
    return withoutPublishedPointer
  }
  if (asset.currentPublishedVersionId && versions.some((version) => version.assetId === asset.id && version.versionId === asset.currentPublishedVersionId)) {
    return asset
  }
  const candidates = versions.filter((version) => version.assetId === asset.id)
  const selected = asset.state === 'published'
    ? candidates.find((version) => version.version === asset.version)
    : candidates.sort((left, right) => right.version - left.version)[0]
  if (!selected) return asset
  return { ...asset, currentPublishedVersionId: selected.versionId }
}

function migrateAsset(asset: ExpertAsset & Partial<AuditedExpertAsset>): AuditedExpertAsset {
  const timestamp = asset.updatedAt || new Date(0).toISOString()
  const editor = asset.updatedBy || asset.createdBy || 'legacy-system-editor'
  const published = asset.state === 'published'
  return {
    ...asset,
    createdAt: asset.createdAt || timestamp,
    createdBy: asset.createdBy || editor,
    updatedBy: editor,
    ...(published || asset.submittedForReviewAt ? { submittedForReviewAt: asset.submittedForReviewAt || timestamp } : {}),
    ...(published || asset.submittedForReviewBy ? { submittedForReviewBy: asset.submittedForReviewBy || 'legacy-system-importer' } : {}),
    ...(published || asset.reviewedAt ? { reviewedAt: asset.reviewedAt || timestamp } : {}),
    ...(published || asset.reviewedBy ? { reviewedBy: asset.reviewedBy || 'legacy-system-publisher' } : {}),
  }
}

function migrateVersion(version: PublishedKnowledgeVersion & Partial<AuditedPublishedKnowledgeVersion>, asset?: AuditedExpertAsset): AuditedPublishedKnowledgeVersion {
  const timestamp = version.publishedAt
  return {
    ...version,
    submittedForReviewAt: version.submittedForReviewAt || asset?.submittedForReviewAt || timestamp,
    submittedForReviewBy: version.submittedForReviewBy || asset?.submittedForReviewBy || 'legacy-system-importer',
    reviewedAt: version.reviewedAt || asset?.reviewedAt || timestamp,
    reviewedBy: version.reviewedBy || asset?.reviewedBy || 'legacy-system-publisher',
    publishedBy: version.publishedBy || asset?.reviewedBy || 'legacy-system-publisher',
  }
}
