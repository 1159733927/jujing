export type PublicationState = 'draft' | 'in-review' | 'published' | 'archived'

export type RuleFactPath =
  | 'bazi.pillars'
  | 'bazi.dayMaster.stem'
  | 'bazi.dayMaster.element'
  | 'bazi.dayMaster.yinYang'
  | 'bazi.fiveElements.counts.wood'
  | 'bazi.fiveElements.counts.fire'
  | 'bazi.fiveElements.counts.earth'
  | 'bazi.fiveElements.counts.metal'
  | 'bazi.fiveElements.counts.water'
  | 'bazi.assessments.elementPreference.direction'
  | 'bazi.assessments.elementPreference.candidateElements'
  | 'bazi.assessments.elementPreference.cautiousElements'
  | 'residence.facing'
  | 'residence.layoutNote'
  | 'vision.rooms'
  | 'vision.factCodes'
  | 'vision.observedElements'
  | 'vision.summaries'

export type RuleOperator = 'equals' | 'contains' | 'contains-any' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte'

export interface RuleCondition {
  fact: RuleFactPath
  operator: RuleOperator
  value: string | readonly string[] | number | boolean
}

export interface RuleConclusion {
  code: string
  text: string
  level: 'info' | 'attention'
  /** Business meaning; unlike level, this decides compatibility classification. */
  effect?: 'supportive' | 'conflict' | 'neutral' | 'needs-confirmation'
  severity?: 'low' | 'medium' | 'high'
}

export interface StructuredRuleDefinition {
  conditions: readonly RuleCondition[]
  conclusions: readonly RuleConclusion[]
  priority: number
  /** Immutable published expert-material versions supporting this rule. */
  sourceVersionIds?: readonly string[]
  /** Only the highest-priority matched rule in a conflict group is applied. */
  conflictGroup?: string
}

export interface KnowledgeArticle {
  id: string
  version: number
  state: PublicationState
  title: string
  tags: readonly string[]
  body: string
  sourceLabel: string
}

export interface RuleDefinition {
  id: string
  version: number
  state: PublicationState
  name: string
  conditions: readonly RuleCondition[]
  conclusions: readonly RuleConclusion[]
  priority: number
}

export interface KnowledgeCitation {
  articleId: string
  version: number
  excerpt: string
}

export type ExpertAssetKind = 'article' | 'rule' | 'skill'

export interface ExpertAsset {
  id: string
  version: number
  /** Immutable version currently visible to report retrieval; draft edits do not change it. */
  currentPublishedVersionId?: string
  state: PublicationState
  kind: ExpertAssetKind
  title: string
  tags: readonly string[]
  body: string
  sourceLabel: string
  updatedAt: string
  rule?: StructuredRuleDefinition
}

/** An immutable snapshot created only when an expert asset is published. */
export interface PublishedKnowledgeVersion {
  assetId: string
  version: number
  versionId: string
  contentHash: string
  kind: ExpertAssetKind
  title: string
  tags: readonly string[]
  body: string
  sourceLabel: string
  exactExcerpt: string
  publishedAt: string
  rule?: StructuredRuleDefinition
}

export interface KnowledgeStoreSnapshot {
  schemaVersion: 3 | 4
  assets: readonly ExpertAsset[]
  versions: readonly PublishedKnowledgeVersion[]
}

export interface EvaluatedRule {
  assetId: string
  version: number
  versionId: string
  contentHash: string
  title: string
  priority: number
  conclusions: readonly RuleConclusion[]
  sourceVersionIds?: readonly string[]
  sourceLabels?: readonly string[]
  sourceExcerpts?: readonly string[]
  conflictGroup?: string
}
