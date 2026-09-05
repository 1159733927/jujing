import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ReportRecord } from '@fengshui/domain'
import { LostReportLeaseError, ReportRepository } from '../src/repository.js'

function sampleReport(overrides: Partial<ReportRecord> = {}): ReportRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    principalId: 'owner-a',
    status: 'queued',
    phase: 'queued',
    createdAt: '2026-09-01T00:00:00.000Z',
    submission: {
      visionConsent: true,
      calculationInput: { date: '1992-08-18', time: '09:30', locationName: '杭州市', longitude: 120.1551 },
      birth: { date: '1992-08-18', time: '09:30', locationName: '杭州市', longitude: 120.1551 },
      residence: { facing: 'south' },
      photos: [{ fileId: 'lease-photo.jpg', room: 'living-room', facing: 'south' }],
    },
    bazi: {
      ruleVersion: 'bazi-v1-beijing-true-solar',
      correctedLocalTime: '1992-08-18T09:30:00.000+08:00',
      correctionMinutes: 0,
      pillars: ['壬申', '戊申', '丙寅', '癸巳'],
    },
    ...overrides,
  }
}

function lease(workerId: string, overrides: { now?: string; leaseExpiresAt?: string } = {}) {
  return {
    workerId,
    now: overrides.now ?? '2026-09-01T00:00:00.000Z',
    leaseExpiresAt: overrides.leaseExpiresAt ?? '2026-09-01T00:15:00.000Z',
  }
}

describe('file-backed report leases', () => {
  it('allows only one of two store instances to claim the same queued report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-lease-'))
    const path = join(directory, 'reports.json')
    await new ReportRepository(path).save(sampleReport())
    const first = new ReportRepository(path)
    const second = new ReportRepository(path)

    const claimed = await Promise.all([
      first.claimReport('11111111-1111-4111-8111-111111111111', lease('worker-a')),
      second.claimReport('11111111-1111-4111-8111-111111111111', lease('worker-b')),
    ])

    expect(claimed.filter(Boolean)).toHaveLength(1)
    expect((await first.get('11111111-1111-4111-8111-111111111111'))).toMatchObject({
      status: 'running',
      runLease: { attempt: 1 },
    })
  })

  it('reclaims an expired running report and increments the lease attempt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-lease-expired-'))
    const reports = new ReportRepository(join(directory, 'reports.json'))
    await reports.save(sampleReport({
      status: 'running',
      phase: 'harness-generating',
      runLease: {
        workerId: 'dead-worker',
        leasedAt: '2026-09-01T00:00:00.000Z',
        expiresAt: '2026-09-01T00:05:00.000Z',
        attempt: 1,
      },
    }))

    const claimed = await reports.claimNextReport(lease('worker-b', {
      now: '2026-09-01T00:06:00.000Z',
      leaseExpiresAt: '2026-09-01T00:21:00.000Z',
    }))

    expect(claimed).toMatchObject({
      status: 'running',
      phase: 'harness-generating',
      runLease: { workerId: 'worker-b', attempt: 2 },
    })
  })

  it('does not reclaim a running report whose lease has not expired', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-lease-active-'))
    const reports = new ReportRepository(join(directory, 'reports.json'))
    await reports.save(sampleReport({
      status: 'running',
      runLease: {
        workerId: 'worker-a',
        leasedAt: '2026-09-01T00:00:00.000Z',
        expiresAt: '2026-09-01T00:15:00.000Z',
        attempt: 1,
      },
    }))

    await expect(reports.claimNextReport(lease('worker-b', { now: '2026-09-01T00:05:00.000Z' }))).resolves.toBeUndefined()
  })

  it('reclaims an unexpired running report left by a dead local API worker', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-lease-dead-local-worker-'))
    const reports = new ReportRepository(join(directory, 'reports.json'))
    await reports.save(sampleReport())
    const deadClaim = await reports.claimReport(sampleReport().id, lease('api-999999-deadbeef'))
    expect(deadClaim).toMatchObject({
      status: 'running',
      runLease: { workerId: 'api-999999-deadbeef', attempt: 1 },
    })
    await reports.save({ ...deadClaim!, phase: 'harness-generating' })

    await expect(reports.claimNextReport(lease('worker-b', { now: '2026-09-01T00:05:00.000Z' }))).resolves.toMatchObject({
      status: 'running',
      phase: 'harness-generating',
      runLease: { workerId: 'worker-b', attempt: 2 },
    })
  })

  it('keeps terminal reports unleased and outside future claims', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-lease-terminal-'))
    const reports = new ReportRepository(join(directory, 'reports.json'))
    const claimed = await reports.claimReport(sampleReport().id, lease('worker-a'))
    expect(claimed).toBeUndefined()

    await reports.save(sampleReport())
    const running = await reports.claimReport(sampleReport().id, lease('worker-a'))
    expect(running?.runLease).toBeDefined()
    await reports.save({ ...running!, status: 'completed', phase: 'completed', report: '完成报告', runLease: undefined })
    await reports.releaseReportLease(running!.id, 'worker-a')

    expect(await reports.get(running!.id)).toMatchObject({ status: 'completed' })
    expect((await reports.get(running!.id))?.runLease).toBeUndefined()
    await expect(reports.claimNextReport(lease('worker-b', { now: '2026-09-01T00:30:00.000Z' }))).resolves.toBeUndefined()
  })

  it('rejects stale claimed saves after another worker reclaims the report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-lease-fencing-'))
    const path = join(directory, 'reports.json')
    const first = new ReportRepository(path)
    const second = new ReportRepository(path)
    await first.save(sampleReport())

    const workerA = await first.claimReport(sampleReport().id, lease('worker-a', {
      now: '2026-09-01T00:00:00.000Z',
      leaseExpiresAt: '2026-09-01T00:05:00.000Z',
    }))
    expect(workerA).toMatchObject({ runLease: { workerId: 'worker-a', attempt: 1 } })

    const workerB = await second.claimReport(sampleReport().id, lease('worker-b', {
      now: '2026-09-01T00:06:00.000Z',
      leaseExpiresAt: '2026-09-01T00:21:00.000Z',
    }))
    expect(workerB).toMatchObject({ runLease: { workerId: 'worker-b', attempt: 2 } })

    await expect(first.saveClaimed(
      { ...workerA!, status: 'completed', phase: 'completed', report: 'worker-a stale result', runLease: undefined },
      { workerId: 'worker-a', attempt: 1 },
    )).rejects.toBeInstanceOf(LostReportLeaseError)
    expect(await first.get(sampleReport().id)).toMatchObject({
      status: 'running',
      runLease: { workerId: 'worker-b', attempt: 2 },
    })

    await second.saveClaimed(
      { ...workerB!, status: 'completed', phase: 'completed', report: 'worker-b final result', runLease: undefined },
      { workerId: 'worker-b', attempt: 2 },
    )
    await second.releaseReportLease(sampleReport().id, 'worker-b')

    expect(await first.get(sampleReport().id)).toMatchObject({
      status: 'completed',
      report: 'worker-b final result',
    })
    expect((await first.get(sampleReport().id))?.runLease).toBeUndefined()
  })

  it('keeps refreshed lock metadata from being reclaimed at the original expiry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-lease-refresh-'))
    const path = join(directory, 'reports.json')
    const first = new ReportRepository(path)
    const second = new ReportRepository(path)
    await first.save(sampleReport())

    const workerA = await first.claimReport(sampleReport().id, lease('worker-a', {
      now: '2026-09-01T00:00:00.000Z',
      leaseExpiresAt: '2026-09-01T00:05:00.000Z',
    }))
    expect(workerA).toMatchObject({ runLease: { workerId: 'worker-a', attempt: 1 } })

    await first.saveClaimed(
      {
        ...workerA!,
        phase: 'harness-generating',
        runLease: {
          workerId: 'worker-a',
          leasedAt: workerA!.runLease!.leasedAt,
          expiresAt: '2026-09-01T00:20:00.000Z',
          attempt: 1,
        },
      },
      { workerId: 'worker-a', attempt: 1 },
    )

    await expect(second.claimReport(sampleReport().id, lease('worker-b', {
      now: '2026-09-01T00:06:00.000Z',
      leaseExpiresAt: '2026-09-01T00:21:00.000Z',
    }))).resolves.toBeUndefined()

    await expect(first.saveClaimed(
      {
        ...(await first.get(sampleReport().id))!,
        phase: 'harness-generating',
        runLease: {
          workerId: 'worker-a',
          leasedAt: workerA!.runLease!.leasedAt,
          expiresAt: '2026-09-01T00:25:00.000Z',
          attempt: 1,
        },
      },
      { workerId: 'worker-a', attempt: 1 },
    )).resolves.toBeUndefined()
  })

  it('recovers a stale corrupt lock without taking an active unknown lock', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-report-lease-corrupt-'))
    const path = join(directory, 'reports.json')
    const reportId = sampleReport().id
    const lockDirectory = `${path}.locks`
    const lockPath = join(lockDirectory, `${reportId}.lock`)
    const reports = new ReportRepository(path)
    await reports.save(sampleReport({
      status: 'running',
      phase: 'harness-generating',
      runLease: {
        workerId: 'unknown-worker',
        leasedAt: '2026-09-01T00:00:00.000Z',
        expiresAt: '2026-09-01T00:05:00.000Z',
        attempt: 1,
      },
    }))
    await mkdir(lockDirectory, { recursive: true })
    await writeFile(lockPath, '{not-json', { mode: 0o600 })
    const recentLockTime = new Date('2026-09-01T00:04:00.000Z')
    await utimes(lockPath, recentLockTime, recentLockTime)

    await expect(reports.claimNextReport(lease('worker-b', {
      now: '2026-09-01T00:06:00.000Z',
      leaseExpiresAt: '2026-09-01T00:16:00.000Z',
    }))).resolves.toBeUndefined()

    const staleLockTime = new Date('2026-09-01T00:00:00.000Z')
    await utimes(lockPath, staleLockTime, staleLockTime)
    await expect(reports.claimNextReport(lease('worker-b', {
      now: '2026-09-01T00:11:00.000Z',
      leaseExpiresAt: '2026-09-01T00:21:00.000Z',
    }))).resolves.toMatchObject({
      status: 'running',
      phase: 'harness-generating',
      runLease: { workerId: 'worker-b', attempt: 2 },
    })
  })
})
