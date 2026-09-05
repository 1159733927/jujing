import { describe, expect, it, vi } from 'vitest'
import type { ReportQualityReview, ReportRecord } from '@fengshui/domain'
import {
  runReportQualityWorkflow,
  type ReportDraft,
  type ReportQualityWorkflowProgress,
  type ReportQualityWorkflowState,
} from '../src/report-quality.js'

const baseRecord: ReportRecord = {
  id: 'report-quality-resume-workflow',
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

function stateFrom(progress: ReportQualityWorkflowProgress): ReportQualityWorkflowState {
  return {
    report: progress.report,
    generationProvenance: progress.generationProvenance,
    qualityReviews: progress.qualityReviews,
    revisionCount: progress.revisionCount,
    draftHash: progress.draftHash,
    reviewHashes: progress.reviewHashes,
  }
}

describe('runReportQualityWorkflow durable resume', () => {
  it('emits durable progress from the initial review', async () => {
    const progress: ReportQualityWorkflowProgress[] = []

    const result = await runReportQualityWorkflow(
      baseRecord,
      initialDraft,
      vi.fn(async () => review(0)),
      vi.fn(),
      undefined,
      {
        onProgress: async snapshot => {
          progress.push(snapshot)
        },
      },
    )

    expect(result).toMatchObject({
      report: 'initial report',
      revisionCount: 0,
      qualityReviews: [expect.objectContaining({ attempt: 0, verdict: 'pass' })],
    })
    expect(progress).toHaveLength(1)
    expect(progress[0]).toMatchObject({
      event: 'review-completed',
      report: 'initial report',
      revisionCount: 0,
      qualityReviews: [expect.objectContaining({ attempt: 0, verdict: 'pass' })],
      reviewHashes: [expect.any(String)],
      draftHash: expect.any(String),
    })
  })

  it('resumes from a persisted revision draft without re-running the completed revision', async () => {
    let resumeState: ReportQualityWorkflowState | undefined
    const crashAfterRevisionDraft = new Error('simulated durable boundary crash')

    await expect(runReportQualityWorkflow(
      baseRecord,
      initialDraft,
      vi.fn(async () => review(0, 'revise')),
      vi.fn(async () => ({ report: 'revised report' })),
      undefined,
      {
        onProgress: async snapshot => {
          if (snapshot.event === 'revision-drafted') {
            resumeState = stateFrom(snapshot)
            throw crashAfterRevisionDraft
          }
        },
      },
    )).rejects.toThrow(crashAfterRevisionDraft)

    const reviewer = vi.fn(async (_record: ReportRecord, _draft: ReportDraft, _attempt: number) => review(1, 'pass'))
    const reviser = vi.fn()

    const result = await runReportQualityWorkflow(
      baseRecord,
      initialDraft,
      reviewer,
      reviser,
      undefined,
      { resumeState },
    )

    expect(result).toMatchObject({
      report: 'revised report',
      revisionCount: 1,
      qualityReviews: [
        expect.objectContaining({ attempt: 0, verdict: 'revise' }),
        expect.objectContaining({ attempt: 1, verdict: 'pass' }),
      ],
    })
    expect(reviewer).toHaveBeenCalledTimes(1)
    expect(reviewer.mock.calls[0]?.[1]).toMatchObject({ report: 'revised report' })
    expect(reviewer.mock.calls[0]?.[2]).toBe(1)
    expect(reviser).not.toHaveBeenCalled()
  })

  it('resumes from a persisted revise review by running only the pending reviser', async () => {
    let resumeState: ReportQualityWorkflowState | undefined
    const crashAfterReview = new Error('simulated review boundary crash')

    await expect(runReportQualityWorkflow(
      baseRecord,
      initialDraft,
      vi.fn(async () => review(0, 'revise')),
      vi.fn(),
      undefined,
      {
        onProgress: async snapshot => {
          if (snapshot.event === 'review-completed') {
            resumeState = stateFrom(snapshot)
            throw crashAfterReview
          }
        },
      },
    )).rejects.toThrow(crashAfterReview)

    const reviewer = vi.fn(async (_record: ReportRecord, _draft: ReportDraft, _attempt: number) => review(1, 'pass'))
    const reviser = vi.fn(async (
      _record: ReportRecord,
      _draft: ReportDraft,
      _review: ReportQualityReview,
      _nextAttempt: number,
    ) => ({ report: 'revised after resume' }))

    const result = await runReportQualityWorkflow(
      baseRecord,
      initialDraft,
      reviewer,
      reviser,
      undefined,
      { resumeState },
    )

    expect(result).toMatchObject({
      report: 'revised after resume',
      revisionCount: 1,
      qualityReviews: [
        expect.objectContaining({ attempt: 0, verdict: 'revise' }),
        expect.objectContaining({ attempt: 1, verdict: 'pass' }),
      ],
    })
    expect(reviser).toHaveBeenCalledTimes(1)
    expect(reviser.mock.calls[0]?.[1]).toMatchObject({ report: 'initial report' })
    expect(reviewer).toHaveBeenCalledTimes(1)
    expect(reviewer.mock.calls[0]?.[1]).toMatchObject({ report: 'revised after resume' })
    expect(reviewer.mock.calls[0]?.[2]).toBe(1)
  })

  it('returns a persisted passing state without calling the reviewer again', async () => {
    let resumeState: ReportQualityWorkflowState | undefined

    await runReportQualityWorkflow(
      baseRecord,
      initialDraft,
      vi.fn(async () => review(0, 'pass')),
      vi.fn(),
      undefined,
      {
        onProgress: async snapshot => {
          resumeState = stateFrom(snapshot)
        },
      },
    )

    const reviewer = vi.fn()
    const reviser = vi.fn()
    const result = await runReportQualityWorkflow(
      baseRecord,
      { report: 'stale caller draft' },
      reviewer,
      reviser,
      undefined,
      { resumeState },
    )

    expect(result).toMatchObject({
      report: 'initial report',
      revisionCount: 0,
      qualityReviews: [expect.objectContaining({ attempt: 0, verdict: 'pass' })],
    })
    expect(reviewer).not.toHaveBeenCalled()
    expect(reviser).not.toHaveBeenCalled()
  })

  it('fails closed when a persisted resume draft does not match its identity hash', async () => {
    let resumeState: ReportQualityWorkflowState | undefined

    await runReportQualityWorkflow(
      baseRecord,
      initialDraft,
      vi.fn(async () => review(0, 'pass')),
      vi.fn(),
      undefined,
      {
        onProgress: async snapshot => {
          resumeState = stateFrom(snapshot)
        },
      },
    )

    const reviewer = vi.fn()
    const tamperedState = {
      ...resumeState,
      report: 'tampered report',
    } as ReportQualityWorkflowState

    await expect(runReportQualityWorkflow(
      baseRecord,
      initialDraft,
      reviewer,
      vi.fn(),
      undefined,
      { resumeState: tamperedState },
    )).rejects.toThrow('report quality resume state draft hash mismatch')
    expect(reviewer).not.toHaveBeenCalled()
  })
})
