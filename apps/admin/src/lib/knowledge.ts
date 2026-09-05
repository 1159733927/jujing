import type { Asset, AssetKind, AssetState, KnowledgeRevisionDraft } from '../types'
import { ApiRequestError } from '../api'

export const kindLabels: Record<AssetKind, string> = { article: '专家资料', rule: '结构化规则', skill: 'Skill 流程' }

export const stateLabels: Record<AssetState, string> = { draft: '草稿', 'in-review': '待审核', published: '已发布', archived: '已归档' }

export function parseTags(raw: string): string[] {
  return raw.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean)
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function fileTitle(name: string): string {
  return name.replace(/\.(txt|md|json)$/i, '').trim()
}

export function isKnowledgeAssetRevisable(asset: Pick<Asset, 'state'>): boolean {
  return asset.state === 'draft' || asset.state === 'published'
}

export type KnowledgeOverviewCard = {
  label: '专家资料' | '结构化规则' | 'Skill 流程' | '待处理'
  value: string
  detail: string
  state: 'ready' | 'pending' | 'empty'
}

export function buildKnowledgeOverviewCards(assets: readonly Pick<Asset, 'kind' | 'state'>[]): KnowledgeOverviewCard[] {
  const activeAssets = assets.filter((asset) => asset.state !== 'archived')
  const byKind = (kind: AssetKind) => activeAssets.filter((asset) => asset.kind === kind)
  const typeCard = (kind: AssetKind): KnowledgeOverviewCard => {
    const items = byKind(kind)
    const published = items.filter((asset) => asset.state === 'published').length
    const pending = items.filter((asset) => asset.state === 'draft' || asset.state === 'in-review').length
    return {
      label: kindLabels[kind] as KnowledgeOverviewCard['label'],
      value: `${published}/${items.length}`,
      detail: items.length
        ? `${published} 条已发布可进入报告，${pending} 条待处理`
        : `还没有${kindLabels[kind]}`,
      state: published > 0 ? 'ready' : items.length > 0 ? 'pending' : 'empty',
    }
  }
  const draft = activeAssets.filter((asset) => asset.state === 'draft').length
  const review = activeAssets.filter((asset) => asset.state === 'in-review').length
  return [
    typeCard('article'),
    typeCard('rule'),
    typeCard('skill'),
    {
      label: '待处理',
      value: String(draft + review),
      detail: `${draft} 条草稿，${review} 条待审核`,
      state: draft + review > 0 ? 'pending' : activeAssets.length > 0 ? 'ready' : 'empty',
    },
  ]
}

export function knowledgeRevisionDraftFromAsset(asset: Asset): KnowledgeRevisionDraft {
  return {
    assetId: asset.id,
    expectedRevision: asset.version,
    kind: asset.kind,
    title: asset.title,
    sourceLabel: asset.sourceLabel,
    tagsText: asset.tags.join('，'),
    body: asset.body,
    ...(asset.rule ? { rule: structuredClone(asset.rule) } : {}),
  }
}

export function buildKnowledgeRevisionPayload(draft: KnowledgeRevisionDraft) {
  const title = draft.title.trim()
  const sourceLabel = draft.sourceLabel.trim()
  const body = draft.body.trim()
  const tags = parseTags(draft.tagsText)
  if (!Number.isInteger(draft.expectedRevision) || draft.expectedRevision < 1) throw new Error('资料修订基线无效，请刷新资料库后重试。')
  if (!title) throw new Error('标题不能为空。')
  if (!sourceLabel) throw new Error('来源不能为空。')
  if (!body) throw new Error('正文不能为空。')
  if (title.length > 200) throw new Error('标题不能超过 200 个字符。')
  if (sourceLabel.length > 200) throw new Error('来源不能超过 200 个字符。')
  if (body.length > 200_000) throw new Error('正文不能超过 200000 个字符。')
  if (tags.length > 20 || tags.some((tag) => tag.length > 40)) throw new Error('标签最多 20 个，每个标签不能超过 40 个字符。')
  if (draft.kind === 'rule' && !draft.rule) throw new Error('结构化规则内容缺失，请刷新资料库后重试。')
  return {
    kind: draft.kind,
    title,
    sourceLabel,
    tags,
    body,
    expectedRevision: draft.expectedRevision,
    ...(draft.kind === 'rule' && draft.rule ? { rule: structuredClone(draft.rule) } : {}),
  }
}

export function knowledgeRevisionErrorMessage(cause: unknown): string {
  if (cause instanceof ApiRequestError && cause.status === 409) return '资料已被他人更新，请刷新后重试'
  return cause instanceof Error ? cause.message : '保存新修订失败'
}
