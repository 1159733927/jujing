import type { ResidencePhotoInput, VisionFact, VisionFactCode, VisionObservation } from '@fengshui/domain'
import { MediaStore } from './media.js'

export interface VisionAnalyzer {
  analyze(photos: readonly ResidencePhotoInput[]): Promise<readonly VisionObservation[]>
}

const DEFAULT_DEEPSEEK_VISION_MODEL = 'deepseek-v4-flash-vision-exp'
const VISION_OBSERVATION_SCHEMA_VERSION = 'vision-observation-v2'
const VISION_PROMPT_VERSION = 'residence-facts-v2'
const VISIBLE_DETAIL_CODES = new Set<VisionFactCode>(['daylight.visible', 'window.visible', 'balcony.visible'])
const FLOOR_PLAN_TOPOLOGY_CODES = new Set<VisionFactCode>(['kitchen.south', 'bathroom.near-center', 'circulation.entry-balcony-aligned'])
const ALLOWED_FACT_CODES = new Set<VisionFactCode>([...VISIBLE_DETAIL_CODES, ...FLOOR_PLAN_TOPOLOGY_CODES])

export async function deepSeekApiKey(): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY?.trim()
  if (!key) throw new Error('DEEPSEEK_API_KEY is not configured')
  return key
}

export function deepSeekVisionModel(): string {
  return process.env.DEEPSEEK_VISION_MODEL?.trim() || DEFAULT_DEEPSEEK_VISION_MODEL
}

function isVisionFactCode(value: unknown): value is VisionFactCode {
  return typeof value === 'string' && ALLOWED_FACT_CODES.has(value as VisionFactCode)
}

function normalizeShortText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (!normalized || normalized.length > 80) throw new Error(`${field} must be 1-80 characters`)
  return normalized
}

function normalizeStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`${field} must be a string array`)
  return value.map((item) => item.replace(/\s+/gu, ' ').trim()).filter(Boolean)
}

function normalizeVisionFact(value: unknown, photo: ResidencePhotoInput): VisionFact {
  if (!value || typeof value !== 'object') throw new Error('vision fact must be an object')
  const fact = value as { code?: unknown; confidence?: unknown; evidence?: unknown; scope?: unknown; source?: unknown }
  if (!isVisionFactCode(fact.code)) throw new Error('vision fact code is not allowed')
  if (typeof fact.confidence !== 'number' || !Number.isFinite(fact.confidence) || fact.confidence < 0 || fact.confidence > 1) throw new Error('vision fact confidence must be between 0 and 1')
  if (fact.source !== 'vision-model') throw new Error('vision fact source must be vision-model')
  const requiredScope = FLOOR_PLAN_TOPOLOGY_CODES.has(fact.code) ? 'floor-plan-topology' : 'visible-detail'
  if (fact.scope !== requiredScope) throw new Error(`vision fact ${fact.code} must use ${requiredScope}`)
  if (requiredScope === 'floor-plan-topology' && photo.room !== 'overview') throw new Error(`vision fact ${fact.code} requires an overview floor plan`)
  return {
    code: fact.code,
    confidence: fact.confidence,
    evidence: normalizeShortText(fact.evidence, 'vision fact evidence'),
    scope: requiredScope,
    source: 'vision-model',
  }
}

function parseObservation(content: string, photo: ResidencePhotoInput): VisionObservation {
  const value = JSON.parse(content) as { schemaVersion?: unknown; summary?: unknown; observedElements?: unknown; uncertainties?: unknown; facts?: unknown; modelVersion?: unknown; promptVersion?: unknown }
  if (value.schemaVersion !== VISION_OBSERVATION_SCHEMA_VERSION) throw new Error('vision response schemaVersion is invalid')
  const summary = normalizeShortText(value.summary, 'vision summary')
  if (!Array.isArray(value.facts)) throw new Error('vision facts must be an array')
  const facts = value.facts.map((fact) => normalizeVisionFact(fact, photo))
  const observedElements = value.observedElements === undefined
    ? facts.map((fact) => fact.evidence)
    : normalizeStringArray(value.observedElements, 'observedElements')
  const uncertainties = normalizeStringArray(value.uncertainties, 'uncertainties')
  const modelVersion = typeof value.modelVersion === 'string' && value.modelVersion.trim() ? value.modelVersion.trim().slice(0, 80) : deepSeekVisionModel()
  if (value.promptVersion !== VISION_PROMPT_VERSION) throw new Error('vision promptVersion is invalid')
  return {
    fileId: photo.fileId,
    room: photo.room,
    summary,
    observedElements,
    uncertainties,
    schemaVersion: VISION_OBSERVATION_SCHEMA_VERSION,
    modelVersion,
    promptVersion: VISION_PROMPT_VERSION,
    facts,
  }
}

function chatCompletionsUrl(baseUrl = process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com'): string {
  return new URL('chat/completions', `${baseUrl.replace(/\/+$/, '')}/`).toString()
}

function providerErrorMessage(text: string): string {
  const trimmed = text.replace(/\s+/gu, ' ').trim()
  if (!trimmed) return ''
  try {
    const value = JSON.parse(trimmed) as { error?: { message?: unknown }; message?: unknown }
    const message = typeof value.error?.message === 'string'
      ? value.error.message
      : typeof value.message === 'string'
        ? value.message
        : ''
    return message.replace(/\s+/gu, ' ').trim().slice(0, 180)
  } catch {
    return trimmed.slice(0, 180)
  }
}

function unavailableObservation(photo: ResidencePhotoInput, reason: string): VisionObservation {
  const normalizedReason = reason.replace(/\s+/gu, ' ').trim().slice(0, 180) || '自动视觉分析暂不可用'
  return {
    fileId: photo.fileId,
    room: photo.room,
    summary: '本图未产生可发布的自动视觉事实；报告仅可引用用户标注与文字说明。',
    observedElements: [],
    uncertainties: [`未形成自动视觉事实：${normalizedReason}`],
    schemaVersion: VISION_OBSERVATION_SCHEMA_VERSION,
    modelVersion: deepSeekVisionModel(),
    promptVersion: VISION_PROMPT_VERSION,
    facts: [],
  }
}

function visionPrompt(photo: ResidencePhotoInput): string {
  const topologyAllowance = photo.room === 'overview'
    ? '若这是户型总图且能直接从图中确认，才可输出 kitchen.south、bathroom.near-center、circulation.entry-balcony-aligned。'
    : '这不是户型总图，禁止输出 kitchen.south、bathroom.near-center、circulation.entry-balcony-aligned。'
  return [
    '分析这张住宅图片中可直接看见或从户型总图明确读出的空间事实。',
    `用户标注：空间=${photo.room}，镜头朝向=${photo.facing}，备注=${photo.note ?? '无'}。`,
    '不要做风水判断，不要猜测画面外信息，不要输出白名单外的事实代码。',
    topologyAllowance,
    '只允许 facts[].code 使用：daylight.visible、window.visible、balcony.visible、kitchen.south、bathroom.near-center、circulation.entry-balcony-aligned。',
    'daylight.visible/window.visible/balcony.visible 的 scope 必须是 visible-detail。',
    'kitchen.south/bathroom.near-center/circulation.entry-balcony-aligned 的 scope 必须是 floor-plan-topology，且只能在空间=overview 时输出。',
    '每个 fact 必须有 confidence(0到1数字)、1到80字 evidence、source="vision-model"。',
    `只返回 JSON：{"schemaVersion":"${VISION_OBSERVATION_SCHEMA_VERSION}","modelVersion":"${deepSeekVisionModel()}","promptVersion":"${VISION_PROMPT_VERSION}","summary":"1到80字简述","facts":[{"code":"daylight.visible","confidence":0.8,"evidence":"可见窗户采光","scope":"visible-detail","source":"vision-model"}],"observedElements":["兼容展示用事实短语"],"uncertainties":["无法确认项"]}`,
  ].join('\n')
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const run = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await worker(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  return results
}

export class DeepSeekVisionAnalyzer implements VisionAnalyzer {
  constructor(
    private readonly media: MediaStore,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly apiKeyProvider: () => Promise<string> = deepSeekApiKey,
  ) {}

  async analyze(photos: readonly ResidencePhotoInput[]): Promise<readonly VisionObservation[]> {
    const apiKey = await this.apiKeyProvider()
    return mapWithConcurrency(photos, 3, async (photo) => {
      const image = await this.media.read(photo.fileId)
      try {
        const response = await this.fetchImpl(chatCompletionsUrl(), {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: deepSeekVisionModel(),
            response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: [
              { type: 'text', text: visionPrompt(photo) },
              { type: 'image_url', image_url: { url: `data:${image.mimetype};base64,${image.bytes.toString('base64')}`, detail: 'low' } },
            ] }],
          }),
          signal: AbortSignal.timeout(60_000),
        })
        if (!response.ok) {
          const providerMessage = providerErrorMessage(await response.text())
          return unavailableObservation(photo, `DeepSeek vision request failed with status ${response.status}${providerMessage ? `: ${providerMessage}` : ''}`)
        }
        const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
        const content = body.choices?.[0]?.message?.content
        if (!content) return unavailableObservation(photo, 'DeepSeek vision returned an empty result')
        try {
          return parseObservation(content, photo)
        } catch {
          return unavailableObservation(photo, 'DeepSeek vision returned data outside the required schema')
        }
      } catch (error) {
        return unavailableObservation(photo, error instanceof Error ? error.message : String(error))
      }
    })
  }
}
