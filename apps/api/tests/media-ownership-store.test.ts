import { randomUUID } from 'node:crypto'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MediaClaimConflictError, MediaOwnershipError, MediaStore } from '../src/media.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

describe('media ownership store', () => {
  it('binds uploads to an owner and rejects cross-principal claims', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-media-owner-'))
    const store = new MediaStore(directory)
    const ownerId = randomUUID()
    const otherOwnerId = randomUUID()
    const { fileId } = await store.save({ filename: 'plan.png', mimetype: 'image/png', bytes: PNG, ownerId })

    await expect(store.claim(fileId, otherOwnerId, randomUUID())).rejects.toBeInstanceOf(MediaOwnershipError)
    await expect(store.claim(fileId, ownerId, randomUUID())).resolves.toBeUndefined()
  })

  it('allows exactly one concurrent claim for an uploaded image', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-media-claim-'))
    const store = new MediaStore(directory)
    const ownerId = randomUUID()
    const { fileId } = await store.save({ filename: 'plan.png', mimetype: 'image/png', bytes: PNG, ownerId })
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => store.claim(fileId, ownerId, randomUUID())))

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected') as PromiseRejectedResult[]
    expect(rejected).toHaveLength(7)
    expect(rejected.every((attempt) => attempt.reason instanceof MediaClaimConflictError)).toBe(true)
  })

  it('removes a claimed image only for the matching owner and report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-media-remove-'))
    const store = new MediaStore(directory)
    const ownerId = randomUUID()
    const reportId = randomUUID()
    const { fileId } = await store.save({ filename: 'plan.png', mimetype: 'image/png', bytes: PNG, ownerId })
    await store.claim(fileId, ownerId, reportId)

    await expect(store.removeClaimed(fileId, ownerId, randomUUID())).rejects.toBeInstanceOf(MediaOwnershipError)
    await expect(stat(join(directory, fileId))).resolves.toBeDefined()
    await expect(store.removeClaimed(fileId, ownerId, reportId)).resolves.toBeUndefined()
    await expect(stat(join(directory, fileId))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(directory, `${fileId}.owner.json`))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(directory, `${fileId}.claim.json`))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
