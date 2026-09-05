import type {
  AdminBirthplaceSearchResponse,
  AdminSession,
  Asset,
  AssetKind,
  AssetState,
  AssetRule,
  BaziFlowResponse,
  DashboardSnapshot,
  PublishedKnowledgeVersionOption,
  PublishedRuleProfileVersion,
  RuleProfile,
  RuleProfileDefinition,
  RuleProfileState,
  WenzhenCompareResponse,
  WenzhenDiffResponse,
  WenzhenEvidenceUploadResponse,
  WenzhenFixtureSaveResponse,
  UserAccount,
  UserAccountStatus,
  UserAccountOverview,
} from './types'

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

const API_BASE = '/api'
const DEFAULT_TIMEOUT_MS = 20_000

type ApiOptions = RequestInit & { timeoutMs?: number }

// Session auth: the browser sends the HttpOnly fengshui_admin_session cookie
// automatically on same-origin /api requests, so no bearer token is attached here.
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const response = await fetch(`${API_BASE}${path}`, { credentials: 'same-origin', ...options, signal: controller.signal })
    const text = await response.text()
    const result = (text ? JSON.parse(text) : {}) as T & { error?: string }
    if (!response.ok) throw new ApiRequestError(result.error || `请求失败（HTTP ${response.status}）`, response.status)
    return result
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw new Error('请求超时，请检查 API 服务。')
    throw cause
  } finally {
    window.clearTimeout(timeout)
  }
}

function jsonBody(body: unknown): { headers: { 'content-type': string }; body: string } {
  return { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}

// ---------------- session / auth ----------------
export function login(username: string, password: string) {
  return api<AdminSession>('/v1/admin/sessions', { method: 'POST', ...jsonBody({ username, password }) })
}

export function logout() {
  return api<{ ok: true }>('/v1/admin/sessions', { method: 'DELETE' })
}

export function getSession() {
  return api<AdminSession>('/v1/admin/sessions')
}

// ---------------- dashboard ----------------
export function getDashboard() {
  return api<DashboardSnapshot>('/v1/admin/dashboard')
}

// ---------------- C-end user accounts ----------------
export async function listUserAccounts() {
  return (await api<{ users: UserAccount[] }>('/v1/admin/users')).users
}

export async function createUserAccount(payload: { username: string; displayName: string; password: string }) {
  return (await api<{ user: UserAccount }>('/v1/admin/users', { method: 'POST', ...jsonBody(payload) })).user
}

export async function setUserAccountStatus(id: string, status: UserAccountStatus) {
  return (await api<{ user: UserAccount }>(`/v1/admin/users/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    ...jsonBody({ status }),
  })).user
}

export async function resetUserAccountPassword(id: string, password: string) {
  return (await api<{ user: UserAccount }>(`/v1/admin/users/${encodeURIComponent(id)}/reset-password`, {
    method: 'POST',
    ...jsonBody({ password }),
  })).user
}

export async function getUserAccountOverview(id: string) {
  return api<UserAccountOverview>(`/v1/admin/users/${encodeURIComponent(id)}/overview`)
}

// ---------------- knowledge ----------------
export type KnowledgeListParams = { q?: string; kind?: AssetKind | 'all'; state?: AssetState | 'all' }

export function listKnowledge(params: KnowledgeListParams = {}) {
  const suffix = toQuery({
    q: params.q,
    kind: params.kind === 'all' ? undefined : params.kind,
    state: params.state === 'all' ? undefined : params.state,
  })
  return api<Asset[]>(`/v1/knowledge${suffix}`)
}

export function listKnowledgeVersions(id: string) {
  return api<PublishedKnowledgeVersionOption[]>(`/v1/knowledge/${id}/versions`)
}

export type CreateKnowledgeInput = {
  kind: AssetKind
  title: string
  sourceLabel: string
  tags: string[]
  body: string
  rule?: AssetRule
}

export function createKnowledge(payload: CreateKnowledgeInput) {
  return api<Asset>('/v1/knowledge', { method: 'POST', ...jsonBody(payload) })
}

export type KnowledgeRevisionInput = {
  kind: AssetKind
  title: string
  sourceLabel: string
  tags: string[]
  body: string
  expectedRevision: number
  rule?: AssetRule
}

export function submitKnowledgeRevision(id: string, payload: KnowledgeRevisionInput) {
  return api<Asset>(`/v1/knowledge/${id}/revisions`, { method: 'POST', ...jsonBody(payload) })
}

export function setKnowledgeState(id: string, state: AssetState) {
  return api<Asset>(`/v1/knowledge/${id}/state`, { method: 'POST', ...jsonBody({ state }) })
}

export async function deleteKnowledge(id: string): Promise<void> {
  await api<unknown>(`/v1/knowledge/${id}`, { method: 'DELETE' })
}

// ---------------- bazi rule profiles ----------------
export type RuleProfileListParams = { q?: string; state?: RuleProfileState | 'all' }

export function listRuleProfiles(params: RuleProfileListParams = {}) {
  const suffix = toQuery({ q: params.q, state: params.state === 'all' ? undefined : params.state })
  return api<RuleProfile[]>(`/v1/bazi-rule-profiles${suffix}`)
}

export function listActiveRuleProfileVersions() {
  return api<PublishedRuleProfileVersion[]>('/v1/bazi-rule-profile-versions/active')
}

export type CreateRuleProfileInput = {
  key: string
  name: string
  description?: string
  workingDefinition: RuleProfileDefinition
}

export function createRuleProfile(payload: CreateRuleProfileInput) {
  return api<RuleProfile>('/v1/bazi-rule-profiles', { method: 'POST', ...jsonBody(payload) })
}

export type RuleProfileRevisionInput = {
  name: string
  description?: string
  workingDefinition: RuleProfileDefinition
  expectedRevision: number
}

export function submitRuleProfileRevision(id: string, payload: RuleProfileRevisionInput) {
  return api<RuleProfile>(`/v1/bazi-rule-profiles/${id}/revisions`, { method: 'POST', ...jsonBody(payload) })
}

export function setRuleProfileState(id: string, state: RuleProfileState) {
  return api<RuleProfile>(`/v1/bazi-rule-profiles/${id}/state`, { method: 'POST', ...jsonBody({ state }) })
}

export function listRuleProfileVersions(id: string) {
  return api<PublishedRuleProfileVersion[]>(`/v1/bazi-rule-profiles/${id}/versions`)
}

export async function deleteRuleProfile(id: string): Promise<void> {
  await api<unknown>(`/v1/bazi-rule-profiles/${id}`, { method: 'DELETE' })
}

// ---------------- wenzhen comparison ----------------
export function getWenzhenDiff() {
  return api<WenzhenDiffResponse>('/v1/bazi/wenzhen/diff')
}

export type WenzhenCompareInput = {
  sampleId: string
  source: string
  birth: unknown
  flowQuery?: unknown
  expected: unknown
}

export function compareWenzhen(payload: WenzhenCompareInput) {
  return api<WenzhenCompareResponse>('/v1/bazi/compare', { method: 'POST', ...jsonBody(payload) })
}

export function uploadWenzhenEvidence(file: File) {
  const form = new FormData()
  form.append('file', file)
  return api<WenzhenEvidenceUploadResponse>('/v1/bazi/wenzhen/evidence', { method: 'POST', body: form, timeoutMs: 30_000 })
}

export type WenzhenFixtureInput = {
  sampleId: string
  source: string
  status: 'verified' | 'accepted-difference'
  capturedAt: string
  sourceUrl: string
  evidenceRef: string
  flowQuery?: unknown
  birth: unknown
  expected: unknown
  acceptedDifferences?: readonly { path: string; reason: string; classification: string }[]
}

export function saveWenzhenFixture(payload: WenzhenFixtureInput) {
  return api<WenzhenFixtureSaveResponse>('/v1/bazi/wenzhen/fixtures', { method: 'POST', ...jsonBody(payload) })
}

export function getBaziFlow(payload: { birth: unknown; query: unknown }) {
  return api<BaziFlowResponse>('/v1/bazi/flow', { method: 'POST', ...jsonBody(payload) })
}

// ---------------- birthplaces ----------------
export function searchBirthplaces(q: string, limit = 12) {
  return api<AdminBirthplaceSearchResponse>(`/v1/birthplaces/administrative${toQuery({ q, limit })}`)
}
