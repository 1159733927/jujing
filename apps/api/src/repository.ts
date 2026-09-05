import { mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ReportRecord } from '@fengshui/domain'

export interface ReportLeaseOptions {
  readonly workerId: string
  readonly leaseExpiresAt: string
  readonly now?: string
}

export interface ReportLeaseFence {
  readonly workerId: string
  readonly attempt: number
}

export class LostReportLeaseError extends Error {
  constructor(readonly reportId: string, options?: ErrorOptions) {
    super(`lost report lease: ${reportId}`, options)
    this.name = 'LostReportLeaseError'
  }
}

export class ReportArchiveConflictError extends Error {
  constructor(readonly reportId: string, readonly status: ReportRecord['status']) {
    super(`report can only be archived after completion or failure: ${reportId} is ${status}`)
    this.name = 'ReportArchiveConflictError'
  }
}

export interface ReportStore {
  get(id: string): Promise<ReportRecord | undefined>
  getOwned(id: string, principalId: string): Promise<ReportRecord | undefined>
  save(record: ReportRecord): Promise<void>
  saveClaimed(record: ReportRecord, fence: ReportLeaseFence): Promise<void>
  listQueued(): Promise<ReportRecord[]>
  claimReport(id: string, lease: ReportLeaseOptions): Promise<ReportRecord | undefined>
  claimNextReport(lease: ReportLeaseOptions): Promise<ReportRecord | undefined>
  releaseReportLease(id: string, workerId: string): Promise<void>
  listByPrincipal(principalId: string, archived?: boolean): Promise<ReportRecord[]>
  archiveOwned(id: string, principalId: string, archivedAt: string): Promise<ReportRecord | undefined>
  restoreOwned(id: string, principalId: string): Promise<ReportRecord | undefined>
  /** True when any stored report cites this knowledge asset id. */
  isKnowledgeCited(assetId: string): Promise<boolean>
  /** Aggregate report counts for the admin monitoring dashboard. */
  reportStats(): Promise<{ total: number; queued: number; completed: number; failed: number; last24h: number }>
  ping(): Promise<void>
  close(): Promise<void>
}

export class ReportRepository implements ReportStore {
  private writeQueue: Promise<void> = Promise.resolve()
  constructor(private readonly path: string) {}
  private lockDirectory(): string {
    return `${this.path}.locks`
  }
  private lockPath(id: string): string {
    return join(this.lockDirectory(), `${id}.lock`)
  }
  private async tryAcquireReportLock(id: string, lease: ReportLeaseOptions): Promise<boolean> {
    await mkdir(this.lockDirectory(), { recursive: true })
    const path = this.lockPath(id)
    const nowMs = Date.parse(lease.now ?? new Date().toISOString())
    const requestedLeaseDurationMs = Date.parse(lease.leaseExpiresAt) - nowMs
    try {
      const handle = await open(path, 'wx', 0o600)
      await handle.writeFile(JSON.stringify({ workerId: lease.workerId, expiresAt: lease.leaseExpiresAt }))
      await handle.close()
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const [metadata, stats] = await Promise.all([
          readFile(path, 'utf8').catch(() => ''),
          stat(path),
        ])
        let parsed: { expiresAt?: unknown; workerId?: unknown } = {}
        try {
          parsed = metadata ? JSON.parse(metadata) as { expiresAt?: unknown; workerId?: unknown } : {}
        } catch {
          parsed = {}
        }
        const parsedExpiresAtMs = typeof parsed.expiresAt === 'string' ? Date.parse(parsed.expiresAt) : Number.NaN
        const expiresAtMs = Number.isFinite(parsedExpiresAtMs) ? parsedExpiresAtMs : stats.mtimeMs + requestedLeaseDurationMs
        const lockWorkerId = typeof parsed.workerId === 'string' ? parsed.workerId : undefined
        if (Number.isFinite(nowMs) && Number.isFinite(expiresAtMs) && expiresAtMs > nowMs && !this.isDeadLocalApiWorker(lockWorkerId)) return false
      } catch {
        return false
      }
      await unlink(path).catch((unlinkError) => {
        if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError
      })
      try {
        const handle = await open(path, 'wx', 0o600)
        await handle.writeFile(JSON.stringify({ workerId: lease.workerId, expiresAt: lease.leaseExpiresAt }))
        await handle.close()
        return true
      } catch (retryError) {
        if ((retryError as NodeJS.ErrnoException).code === 'EEXIST') return false
        throw retryError
      }
    }
  }
  private isClaimEligible(record: ReportRecord, now: string): boolean {
    if (record.archivedAt) return false
    if (record.status === 'queued') return true
    const recoverableQualityWork = record.status === 'completed'
      && (record.qualityStatus === 'pending' || record.qualityStatus === 'running')
    if (record.status !== 'running' && !recoverableQualityWork) return false
    const expiresAt = record.runLease?.expiresAt
    return typeof expiresAt === 'string' && Date.parse(expiresAt) <= Date.parse(now)
      || this.isDeadLocalApiWorker(record.runLease?.workerId)
  }
  private leaseFenceMatches(record: ReportRecord | undefined, fence: ReportLeaseFence): boolean {
    return record?.runLease?.workerId === fence.workerId && record.runLease.attempt === fence.attempt
  }
  private isDeadLocalApiWorker(workerId: string | undefined): boolean {
    const pid = /^api-(\d+)-/u.exec(workerId ?? '')?.[1]
    if (!pid) return false
    const parsed = Number(pid)
    if (!Number.isSafeInteger(parsed) || parsed === process.pid) return false
    try {
      process.kill(parsed, 0)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH'
    }
  }
  private async persistClaimedReport(id: string, lease: ReportLeaseOptions): Promise<ReportRecord | undefined> {
    const now = lease.now ?? new Date().toISOString()
    const task = this.writeQueue.then(async () => {
      const records = await this.all()
      const index = records.findIndex((item) => item.id === id)
      const current = index >= 0 ? records[index] : undefined
      if (!current || !this.isClaimEligible(current, now)) return undefined
      const claimed: ReportRecord = {
        ...current,
        status: current.status === 'completed' ? 'completed' : 'running',
        phase: current.phase && current.phase !== 'failed' && current.phase !== 'completed' ? current.phase : 'queued',
        runLease: {
          workerId: lease.workerId,
          leasedAt: now,
          expiresAt: lease.leaseExpiresAt,
          attempt: (current.runLease?.attempt ?? 0) + 1,
        },
      }
      records[index] = claimed
      await this.writeRecords(records)
      return structuredClone(claimed)
    })
    this.writeQueue = task.then(() => undefined, () => undefined)
    return task
  }
  private async writeRecords(records: readonly ReportRecord[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.${crypto.randomUUID()}.tmp`
    await writeFile(temporaryPath, JSON.stringify(records, null, 2), { mode: 0o600 })
    await rename(temporaryPath, this.path)
  }
  private async all(): Promise<ReportRecord[]> {
    try { return JSON.parse(await readFile(this.path, 'utf8')) as ReportRecord[] }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }
  async get(id: string): Promise<ReportRecord | undefined> {
    await this.writeQueue
    return (await this.all()).find((item) => item.id === id)
  }
  async getOwned(id: string, principalId: string): Promise<ReportRecord | undefined> {
    await this.writeQueue
    const record = (await this.all()).find((item) => item.id === id && item.principalId === principalId)
    return record ? structuredClone(record) : undefined
  }
  async listQueued(): Promise<ReportRecord[]> {
    await this.writeQueue
    return (await this.all()).filter((item) => item.status === 'queued' && !item.archivedAt)
  }
  async listByPrincipal(principalId: string, archived = false): Promise<ReportRecord[]> {
    await this.writeQueue
    return (await this.all())
      .filter((item) => item.principalId === principalId && (archived ? Boolean(item.archivedAt) : !item.archivedAt))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }
  async archiveOwned(id: string, principalId: string, archivedAt: string): Promise<ReportRecord | undefined> {
    const task = this.writeQueue.then(async () => {
      const records = await this.all()
      const index = records.findIndex((item) => item.id === id && item.principalId === principalId)
      const current = index >= 0 ? records[index] : undefined
      if (!current || current.archivedAt) return undefined
      if (current.status !== 'completed' && current.status !== 'failed') {
        throw new ReportArchiveConflictError(current.id, current.status)
      }
      const archived: ReportRecord = {
        ...current,
        archivedAt,
        shareAccess: undefined,
        runLease: undefined,
      }
      records[index] = archived
      await this.writeRecords(records)
      await rm(this.lockPath(id), { force: true })
      return structuredClone(archived)
    })
    this.writeQueue = task.then(() => undefined, () => undefined)
    return task
  }
  async restoreOwned(id: string, principalId: string): Promise<ReportRecord | undefined> {
    const task = this.writeQueue.then(async () => {
      const records = await this.all()
      const index = records.findIndex((item) => item.id === id && item.principalId === principalId)
      const current = index >= 0 ? records[index] : undefined
      if (!current?.archivedAt) return undefined
      const restored: ReportRecord = { ...current, archivedAt: undefined }
      records[index] = restored
      await this.writeRecords(records)
      return structuredClone(restored)
    })
    this.writeQueue = task.then(() => undefined, () => undefined)
    return task
  }
  async save(record: ReportRecord): Promise<void> {
    const task = this.writeQueue.then(async () => {
      const records = (await this.all()).filter((item) => item.id !== record.id)
      records.push(record)
      await this.writeRecords(records)
    })
    // Keep later writes usable after a failure; `await task` below still exposes
    // the original error to this save caller instead of silently masking it.
    this.writeQueue = task.catch(() => undefined)
    await task
  }
  async saveClaimed(record: ReportRecord, fence: ReportLeaseFence): Promise<void> {
    const task = this.writeQueue.then(async () => {
      let lockMetadata: { workerId?: unknown }
      try {
        lockMetadata = JSON.parse(await readFile(this.lockPath(record.id), 'utf8')) as { workerId?: unknown }
      } catch (error) {
        throw new LostReportLeaseError(record.id, { cause: error })
      }
      if (lockMetadata.workerId !== fence.workerId) throw new LostReportLeaseError(record.id)
      const records = await this.all()
      const index = records.findIndex((item) => item.id === record.id)
      if (!this.leaseFenceMatches(index >= 0 ? records[index] : undefined, fence)) throw new LostReportLeaseError(record.id)
      if (
        record.runLease?.workerId === fence.workerId
        && record.runLease.attempt === fence.attempt
        && typeof record.runLease.expiresAt === 'string'
      ) {
        await writeFile(this.lockPath(record.id), JSON.stringify({
          workerId: fence.workerId,
          expiresAt: record.runLease.expiresAt,
        }), { mode: 0o600 })
      }
      records[index] = record
      await this.writeRecords(records)
    })
    this.writeQueue = task.catch(() => undefined)
    await task
  }
  async claimReport(id: string, lease: ReportLeaseOptions): Promise<ReportRecord | undefined> {
    if (!await this.tryAcquireReportLock(id, lease)) return undefined
    try {
      const claimed = await this.persistClaimedReport(id, lease)
      if (!claimed) await this.releaseReportLease(id, lease.workerId)
      return claimed
    } catch (error) {
      await this.releaseReportLease(id, lease.workerId).catch(() => undefined)
      throw error
    }
  }
  async claimNextReport(lease: ReportLeaseOptions): Promise<ReportRecord | undefined> {
    await this.writeQueue
    const now = lease.now ?? new Date().toISOString()
    const candidates = (await this.all())
      .filter((item) => this.isClaimEligible(item, now))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    for (const candidate of candidates) {
      const claimed = await this.claimReport(candidate.id, lease)
      if (claimed) return claimed
    }
    return undefined
  }
  async releaseReportLease(id: string, workerId: string): Promise<void> {
    const lockPath = this.lockPath(id)
    try {
      const metadata = JSON.parse(await readFile(lockPath, 'utf8')) as { workerId?: unknown }
      if (metadata.workerId !== workerId) return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      return
    }
    await rm(lockPath, { force: true })
  }
  async isKnowledgeCited(assetId: string): Promise<boolean> {
    await this.writeQueue
    return (await this.all()).some((record) => record.citations?.some((citation) => citation.id === assetId))
  }
  async reportStats(): Promise<{ total: number; queued: number; completed: number; failed: number; last24h: number }> {
    await this.writeQueue
    const records = await this.all()
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    let queued = 0
    let completed = 0
    let failed = 0
    let last24h = 0
    for (const record of records) {
      if (record.status === 'queued') queued += 1
      else if (record.status === 'completed') completed += 1
      else if (record.status === 'failed') failed += 1
      const createdAt = Date.parse(record.createdAt)
      if (Number.isFinite(createdAt) && createdAt >= cutoff) last24h += 1
    }
    return { total: records.length, queued, completed, failed, last24h }
  }
  async ping(): Promise<void> {
    await this.writeQueue
    await this.all()
  }
  async close(): Promise<void> {}
}
