import { createHash } from 'node:crypto'
import type {
  ReportGenerationProvenance,
  ReportQualityReview,
  ReportRecord,
} from '@fengshui/domain'

export const MAX_AUTOMATIC_REPORT_REVISIONS = 1
export const MIN_PASSING_REPORT_QUALITY_SCORE = 80

export interface ReportDraft {
  readonly report: string
  readonly generationProvenance?: ReportGenerationProvenance
}

export type ReportQualityReviewer = (
  record: ReportRecord,
  draft: ReportDraft,
  attempt: number,
) => Promise<ReportQualityReview>

export type ReportReviser = (
  record: ReportRecord,
  draft: ReportDraft,
  review: ReportQualityReview,
  nextAttempt: number,
) => Promise<ReportDraft>

export interface ReviewedReportResult extends ReportDraft {
  readonly qualityReviews: readonly ReportQualityReview[]
  readonly revisionCount: number
}

export type ReportQualityStage = 'quality-reviewing' | 'harness-revising'
export type ReportQualityProgressEvent = 'review-completed' | 'revision-drafted'

export interface ReportQualityWorkflowState extends ReviewedReportResult {
  readonly draftHash: string
  readonly reviewHashes: readonly string[]
}

export interface ReportQualityWorkflowProgress extends ReportQualityWorkflowState {
  readonly event: ReportQualityProgressEvent
}

export interface ReportQualityWorkflowOptions {
  readonly resumeState?: ReportQualityWorkflowState
  readonly onProgress?: (progress: ReportQualityWorkflowProgress) => Promise<void>
}

export class ReportQualityReviewError extends Error {
  constructor(
    message: string,
    readonly qualityReviews: readonly ReportQualityReview[],
    readonly revisionCount: number,
  ) {
    super(message)
    this.name = 'ReportQualityReviewError'
  }
}

function assertReview(review: ReportQualityReview, expectedAttempt: number): void {
  if (review.schemaVersion !== 'report-quality-review-v1') throw new Error('unsupported report quality review schema')
  if (review.attempt !== expectedAttempt) throw new Error('report quality review attempt mismatch')
  if (!Number.isFinite(review.score) || review.score < 0 || review.score > 100) throw new Error('report quality review score is outside 0..100')
  if (review.verdict === 'pass' && review.score < MIN_PASSING_REPORT_QUALITY_SCORE) {
    throw new Error(`passing report quality review score must be at least ${MIN_PASSING_REPORT_QUALITY_SCORE}`)
  }
  if (review.verdict === 'pass' && review.issues.some(issue => issue.severity === 'high')) {
    throw new Error('passing report quality review contains a high-severity issue')
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`

  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .sort()
    .filter(key => record[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)

  return `{${entries.join(',')}}`
}

function contentHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function draftHash(draft: ReportDraft): string {
  return contentHash({
    generationProvenance: draft.generationProvenance,
    report: draft.report,
  })
}

function reviewHash(review: ReportQualityReview): string {
  return contentHash(review)
}

function createWorkflowState(
  draft: ReportDraft,
  qualityReviews: readonly ReportQualityReview[],
  revisionCount: number,
): ReportQualityWorkflowState {
  return {
    ...draft,
    qualityReviews: [...qualityReviews],
    revisionCount,
    draftHash: draftHash(draft),
    reviewHashes: qualityReviews.map(review => reviewHash(review)),
  }
}

function assertResumeState(state: ReportQualityWorkflowState): void {
  if (typeof state.report !== 'string') throw new Error('report quality resume state draft is invalid')
  if (!Array.isArray(state.qualityReviews)) throw new Error('report quality resume state reviews are invalid')
  if (!Number.isInteger(state.revisionCount) || state.revisionCount < 0) {
    throw new Error('report quality resume state revision count is invalid')
  }
  if (state.revisionCount > MAX_AUTOMATIC_REPORT_REVISIONS) {
    throw new Error('report quality resume state revision count exceeds the automatic revision limit')
  }
  if (state.qualityReviews.length === 0 && state.revisionCount !== 0) {
    throw new Error('report quality resume state revision count does not match review trail')
  }
  if (state.qualityReviews.length > state.revisionCount + 1) {
    throw new Error('report quality resume state contains too many reviews for the revision count')
  }
  if (state.qualityReviews.length < state.revisionCount) {
    throw new Error('report quality resume state is missing reviews for completed revisions')
  }
  if (!Array.isArray(state.reviewHashes) || state.reviewHashes.length !== state.qualityReviews.length) {
    throw new Error('report quality resume state review hashes are invalid')
  }
  if (state.draftHash !== draftHash(state)) throw new Error('report quality resume state draft hash mismatch')

  state.qualityReviews.forEach((review, index) => {
    assertReview(review, index)
    if (reviewHash(review) !== state.reviewHashes[index]) {
      throw new Error('report quality resume state review hash mismatch')
    }
  })

  const lastReview = state.qualityReviews.at(-1)
  if (
    lastReview?.verdict === 'revise'
    && state.revisionCount !== state.qualityReviews.length - 1
    && state.revisionCount !== state.qualityReviews.length
  ) {
    throw new Error('report quality resume state revision count does not match revision review trail')
  }
  if (lastReview?.verdict !== 'revise' && state.revisionCount !== Math.max(0, state.qualityReviews.length - 1)) {
    throw new Error('report quality resume state revision count does not match terminal review trail')
  }
}

export async function runReportQualityWorkflow(
  record: ReportRecord,
  initialDraft: ReportDraft,
  reviewer: ReportQualityReviewer,
  reviser: ReportReviser,
  onStage: (stage: ReportQualityStage) => Promise<void> = async () => undefined,
  options: ReportQualityWorkflowOptions = {},
): Promise<ReviewedReportResult> {
  let draft: ReportDraft = initialDraft
  let revisionCount = 0
  const qualityReviews: ReportQualityReview[] = []

  if (options.resumeState) {
    assertResumeState(options.resumeState)
    draft = {
      report: options.resumeState.report,
      generationProvenance: options.resumeState.generationProvenance,
    }
    revisionCount = options.resumeState.revisionCount
    qualityReviews.push(...options.resumeState.qualityReviews)

    const lastReview = qualityReviews.at(-1)
    if (lastReview?.verdict === 'pass') return { ...draft, qualityReviews, revisionCount }
    if (lastReview?.verdict === 'manual-review') {
      throw new ReportQualityReviewError('report requires expert review', qualityReviews, revisionCount)
    }
  }

  async function persistProgress(event: ReportQualityProgressEvent): Promise<void> {
    if (!options.onProgress) return
    await options.onProgress({
      ...createWorkflowState(draft, qualityReviews, revisionCount),
      event,
    })
  }

  while (true) {
    let review = qualityReviews[revisionCount]
    if (!review) {
      await onStage('quality-reviewing')
      const modelReview = await reviewer(record, draft, revisionCount)
      assertReview(modelReview, revisionCount)
      // The model supplies the assessment, but only the server may timestamp the
      // immutable audit trail. This prevents stale or invented model time from
      // making a review appear to predate or postdate the actual workflow.
      review = { ...modelReview, reviewedAt: new Date().toISOString() }
      qualityReviews.push(review)
      await persistProgress('review-completed')
    }

    if (review.verdict === 'pass') return { ...draft, qualityReviews, revisionCount }
    if (review.verdict === 'manual-review') {
      throw new ReportQualityReviewError('report requires expert review', qualityReviews, revisionCount)
    }
    if (revisionCount >= MAX_AUTOMATIC_REPORT_REVISIONS) {
      throw new ReportQualityReviewError('report did not pass quality review after one revision', qualityReviews, revisionCount)
    }

    await onStage('harness-revising')
    revisionCount += 1
    draft = await reviser(record, draft, review, revisionCount)
    await persistProgress('revision-drafted')
  }
}
