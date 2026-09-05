import { randomUUID } from 'node:crypto'
import { mkdtemp, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MediaStore } from '../src/media.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

describe('media retention', () => {
  it('removes expired uploads while retaining recent uploads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-media-'))
    const store = new MediaStore(directory)
    const ownerId = randomUUID()
    const expired = await store.save({ filename: 'old.png', mimetype: 'image/png', bytes: PNG, ownerId })
    const recent = await store.save({ filename: 'new.png', mimetype: 'image/png', bytes: PNG, ownerId })
    const now = Date.now()
    const oldTime = new Date(now - 25 * 60 * 60 * 1000)
    await utimes(join(directory, expired.fileId), oldTime, oldTime)

    expect(await store.pruneExpired(24 * 60 * 60 * 1000, now)).toBe(1)
    await expect(stat(join(directory, expired.fileId))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(directory, recent.fileId))).resolves.toBeDefined()
  })

  it('keeps expired uploads that are already claimed by a report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fengshui-media-'))
    const store = new MediaStore(directory)
    const ownerId = randomUUID()
    const reportId = randomUUID()
    const claimed = await store.save({ filename: 'claimed.png', mimetype: 'image/png', bytes: PNG, ownerId })
    const now = Date.now()
    const oldTime = new Date(now - 25 * 60 * 60 * 1000)
    await utimes(join(directory, claimed.fileId), oldTime, oldTime)
    await store.claim(claimed.fileId, ownerId, reportId)

    expect(await store.pruneExpired(24 * 60 * 60 * 1000, now)).toBe(0)
    await expect(stat(join(directory, claimed.fileId))).resolves.toBeDefined()
  })

  it('treats a missing upload directory as an empty store', async () => {
    const directory = join(await mkdtemp(join(tmpdir(), 'fengshui-media-')), 'missing')
    await expect(new MediaStore(directory).pruneExpired(1)).resolves.toBe(0)
  })
})
