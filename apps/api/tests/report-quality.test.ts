import { describe, expect, it, vi } from 'vitest'
import type { ReportQualityReview, ReportRecord } from '@fengshui/domain'
import {
  MIN_PASSING_REPORT_QUALITY_SCORE,
  runReportQualityWorkflow,
  type ReportDraft,
  type ReportQualityStage,
} from '../src/report-quality.js'

const baseRecord: ReportRecord = {
  id: 'report-quality-workflow',
  status: 'queued',
  createdAt: '2026-09-02T00:00:00.000Z',
  submission: {
    visionConsent: true,
    calculationInput: {
      date: '1992-08-21',
      time: '12:03',
      locationName: '杭州',
      longitude: 120.1551,
    },
    birth: {
      date: '1992-08-21',
      time: '12:03',
      locationName: '杭州',
      longitude: 120.1551,
    },
    residence: { facing: 'south' },
    photos: [],
  },
  bazi: {
    ruleVersion: 'test-bazi-v1',
    correctedLocalTime: '1992-08-21T12:03:00+08:00',
    correctionMinutes: 0,
    pillars: ['丁丑', '癸卯', '戊午', '庚申'],
  },
}

const initialDraft: ReportDraft = {
  report: 'initial report',
}

function review(
  attempt: number,
  verdict: ReportQualityReview['verdict'] = 'pass',
  overrides: Partial<ReportQualityReview> = {},
): ReportQualityReview {
  return {
    schemaVersion: 'report-quality-review-v1',
    verdict,
    score: verdict === 'pass' ? 92 : 68,
    issues: [],
    reviewedAt: `2026-09-02T00:0${attempt}:00.000Z`,
    attempt,
    ...overrides,
  }
}

describe('runReportQualityWorkflow', () => {
  it('returns the initial draft when the first review passes', async () => {
    const reviewer = vi.fn(async () => review(0))
    const reviser = vi.fn()

    const result = await runReportQualityWorkflow(baseRecord, initialDraft, reviewer, reviser)
    expect(result).toMatchObject({
      report: 'initial report',
      qualityReviews: [expect.objectContaining({ attempt: 0, verdict: 'pass' })],
      revisionCount: 0,
    })
    expect(result.qualityReviews[0]?.reviewedAt).not.toBe(review(0).reviewedAt)
    expect(reviser).not.toHaveBeenCalled()
  })

  it('returns the revised draft when the second review passes', async () => {
    const revisedDraft: ReportDraft = { report: 'revised report' }
    const reviewer = vi.fn()
      .mockResolvedValueOnce(review(0, 'revise'))
      .mockResolvedValueOnce(review(1, 'pass'))
    const reviser = vi.fn(async () => revisedDraft)

    await expect(runReportQualityWorkflow(baseRecord, initialDraft, reviewer, reviser)).resolves.toMatchObject({
      report: 'revised report',
      qualityReviews: [
        expect.objectContaining({ attempt: 0, verdict: 'revise' }),
        expect.objectContaining({ attempt: 1, verdict: 'pass' }),
      ],
      revisionCount: 1,
    })
    expect(reviser).toHaveBeenCalledOnce()
  })

  it('throws manual-review with the review trail when expert review is required', async () => {
    const manualReview = review(0, 'manual-review', {
      score: 41,
      issues: [{ code: 'missing-evidence', severity: 'high', message: 'source evidence is insufficient' }],
    })
    const reviewer = vi.fn(async () => manualReview)
    const reviser = vi.fn()

    await expect(runReportQualityWorkflow(baseRecord, initialDraft, reviewer, reviser))
      .rejects.toMatchObject({
        name: 'ReportQualityReviewError',
        message: 'report requires expert review',
        qualityReviews: [expect.objectContaining({ attempt: 0, verdict: 'manual-review' })],
        revisionCount: 0,
      })
    expect(reviser).not.toHaveBeenCalled()
  })

  it('stops after one automatic revision when the report still needs revision', async () => {
    const reviewer = vi.fn()
      .mockResolvedValueOnce(review(0, 'revise'))
      .mockResolvedValueOnce(review(1, 'revise'))
    const reviser = vi.fn()
      .mockResolvedValueOnce({ report: 'first revision' })

    await expect(runReportQualityWorkflow(baseRecord, initialDraft, reviewer, reviser))
      .rejects.toMatchObject({
        name: 'ReportQualityReviewError',
        message: 'report did not pass quality review after one revision',
        qualityReviews: [
          expect.objectContaining({ attempt: 0, verdict: 'revise' }),
          expect.objectContaining({ attempt: 1, verdict: 'revise' }),
        ],
        revisionCount: 1,
      })
    expect(reviser).toHaveBeenCalledTimes(1)
  })

  it('rejects a review score outside the 0 to 100 range', async () => {
    const reviewer = vi.fn(async () => review(0, 'pass', { score: 101 }))
    const reviser = vi.fn()

    await expect(runReportQualityWorkflow(baseRecord, initialDraft, reviewer, reviser))
      .rejects.toThrow('report quality review score is outside 0..100')
  })

  it('rejects a passing review whose score is below the minimum', async () => {
    const reviewer = vi.fn(async () => review(0, 'pass', {
      score: MIN_PASSING_REPORT_QUALITY_SCORE - 1,
    }))
    const reviser = vi.fn()

    await expect(runReportQualityWorkflow(baseRecord, initialDraft, reviewer, reviser))
      .rejects.toThrow(`passing report quality review score must be at least ${MIN_PASSING_REPORT_QUALITY_SCORE}`)
    expect(reviser).not.toHaveBeenCalled()
  })

  it('accepts a passing review at the minimum score', async () => {
    const reviewer = vi.fn(async () => review(0, 'pass', {
      score: MIN_PASSING_REPORT_QUALITY_SCORE,
    }))
    const reviser = vi.fn()

    await expect(runReportQualityWorkflow(baseRecord, initialDraft, reviewer, reviser))
      .resolves.toMatchObject({
        qualityReviews: [expect.objectContaining({
          score: MIN_PASSING_REPORT_QUALITY_SCORE,
          verdict: 'pass',
        })],
        revisionCount: 0,
      })
    expect(reviser).not.toHaveBeenCalled()
  })

  it('rejects a review whose attempt does not match the revision count', async () => {
    const reviewer = vi.fn(async () => review(1, 'pass'))
    const reviser = vi.fn()

    await expect(runReportQualityWorkflow(baseRecord, initialDraft, reviewer, reviser))
      .rejects.toThrow('report quality review attempt mismatch')
  })

  it('rejects a passing review that still contains a high-severity issue', async () => {
    const reviewer = vi.fn(async () => review(0, 'pass', {
      issues: [{ code: 'unsafe-claim', severity: 'high', message: 'report still contains a certain prediction' }],
    }))
    const reviser = vi.fn()

    await expect(runReportQualityWorkflow(baseRecord, initialDraft, reviewer, reviser))
      .rejects.toThrow('passing report quality review contains a high-severity issue')
  })

  it('emits quality-reviewing and harness-revising stages in workflow order', async () => {
    const stages: ReportQualityStage[] = []
    const reviewer = vi.fn()
      .mockResolvedValueOnce(review(0, 'revise'))
      .mockResolvedValueOnce(review(1, 'pass'))
    const reviser = vi.fn(async () => ({ report: 'revised report' }))

    await runReportQualityWorkflow(
      baseRecord,
      initialDraft,
      reviewer,
      reviser,
      async stage => {
        stages.push(stage)
      },
    )

    expect(stages).toEqual(['quality-reviewing', 'harness-revising', 'quality-reviewing'])
    const reviewerCalls = reviewer.mock.calls as unknown as [ReportRecord, ReportDraft, number][]
    const reviserCalls = reviser.mock.calls as unknown as [ReportRecord, ReportDraft, ReportQualityReview, number][]

    expect(reviewerCalls.map(([, draft, attempt]) => [draft.report, attempt])).toEqual([
      ['initial report', 0],
      ['revised report', 1],
    ])
    expect(reviserCalls.map(([, draft, qualityReview, nextAttempt]) => [
      draft.report,
      qualityReview.attempt,
      nextAttempt,
    ])).toEqual([
      ['initial report', 0, 1],
    ])
  })

  it('uses server time for the immutable review trail even when the model invents a timestamp', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-04-05T06:07:08.000Z'))
    try {
      const result = await runReportQualityWorkflow(
        baseRecord,
        initialDraft,
        async () => review(0, 'pass', { reviewedAt: '1999-01-01T00:00:00.000Z' }),
        vi.fn(),
      )
      expect(result.qualityReviews[0]?.reviewedAt).toBe('2030-04-05T06:07:08.000Z')
    } finally {
      vi.useRealTimers()
    }
  })
})
