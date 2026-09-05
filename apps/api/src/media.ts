import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const formats = [
  { mime: 'image/jpeg', extension: '.jpg', matches: (bytes: Buffer) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { mime: 'image/png', extension: '.png', matches: (bytes: Buffer) => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/gif', extension: '.gif', matches: (bytes: Buffer) => bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a' },
  { mime: 'image/webp', extension: '.webp', matches: (bytes: Buffer) => bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' },
] as const

type MediaOwnerMetadata = {
  schemaVersion: 'media-owner-v1'
  fileId: string
  ownerId: string
  createdAt: string
}

type MediaClaimMetadata = {
  schemaVersion: 'media-claim-v1'
  fileId: string
  ownerId: string
  reportId: string
  claimedAt: string
}

export class MediaOwnershipError extends Error {}
export class MediaClaimConflictError extends Error {}

export class MediaStore {
  constructor(private readonly directory: string) {}

  async save(input: { filename: string; mimetype: string; bytes: Buffer; ownerId: string }): Promise<{ fileId: string }> {
    this.assertEntityId(input.ownerId, 'owner id')
    if (input.bytes.length === 0) throw new Error('empty image')
    const format = formats.find((candidate) => candidate.matches(input.bytes))
    if (!format || format.mime !== input.mimetype) throw new Error('unsupported or mismatched image type')
    const fileId = `${crypto.randomUUID()}${format.extension}`
    await mkdir(this.directory, { recursive: true })
    await writeFile(join(this.directory, fileId), input.bytes, { mode: 0o600, flag: 'wx' })
    await writeFile(this.ownerPath(fileId), JSON.stringify({
      schemaVersion: 'media-owner-v1',
      fileId,
      ownerId: input.ownerId,
      createdAt: new Date().toISOString(),
    } satisfies MediaOwnerMetadata), { mode: 0o600, flag: 'wx' })
    return { fileId }
  }

  async read(fileId: string): Promise<{ bytes: Buffer; mimetype: string }> {
    const format = this.formatForId(fileId)
    const bytes = await readFile(join(this.directory, fileId))
    if (!format.matches(bytes)) throw new Error('stored image content mismatch')
    return { bytes, mimetype: format.mime }
  }

  async exists(fileId: string): Promise<boolean> {
    this.formatForId(fileId)
    try {
      return (await stat(join(this.directory, fileId))).isFile()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  async claim(fileId: string, ownerId: string, reportId: string): Promise<void> {
    this.assertEntityId(ownerId, 'owner id')
    this.assertEntityId(reportId, 'report id')
    if (!(await this.exists(fileId))) throw new MediaOwnershipError('uploaded image is missing')
    const owner = await this.readOwner(fileId)
    if (owner.ownerId !== ownerId) throw new MediaOwnershipError('uploaded image belongs to a different principal')
    const claim: MediaClaimMetadata = {
      schemaVersion: 'media-claim-v1',
      fileId,
      ownerId,
      reportId,
      claimedAt: new Date().toISOString(),
    }
    try {
      await writeFile(this.claimPath(fileId), JSON.stringify(claim), { mode: 0o600, flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new MediaClaimConflictError('uploaded image is already attached to a report')
      throw error
    }
  }

  async releaseClaim(fileId: string, ownerId: string, reportId: string): Promise<void> {
    this.assertEntityId(ownerId, 'owner id')
    this.assertEntityId(reportId, 'report id')
    const claim = await this.readClaim(fileId)
    if (claim.ownerId !== ownerId || claim.reportId !== reportId) throw new MediaOwnershipError('uploaded image claim does not match this report')
    await this.unlinkIfExists(this.claimPath(fileId))
  }

  async removeClaimed(fileId: string, ownerId: string, reportId: string): Promise<void> {
    this.assertEntityId(ownerId, 'owner id')
    this.assertEntityId(reportId, 'report id')
    const owner = await this.readOwner(fileId)
    const claim = await this.readClaim(fileId)
    if (owner.ownerId !== ownerId || claim.ownerId !== ownerId || claim.reportId !== reportId) {
      throw new MediaOwnershipError('uploaded image claim does not match this report')
    }
    await Promise.all([
      this.unlinkIfExists(join(this.directory, fileId)),
      this.unlinkIfExists(this.ownerPath(fileId)),
      this.unlinkIfExists(this.claimPath(fileId)),
    ])
  }

  async remove(fileId: string): Promise<void> {
    this.formatForId(fileId)
    await unlink(join(this.directory, fileId))
  }

  async pruneExpired(maxAgeMs: number, now = Date.now()): Promise<number> {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) throw new Error('invalid media retention period')
    let entries: string[]
    try {
      entries = await readdir(this.directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
    let removed = 0
    await Promise.all(entries.map(async (fileId) => {
      try {
        this.formatForId(fileId)
        if (await this.hasClaim(fileId)) return
        const metadata = await stat(join(this.directory, fileId))
        if (metadata.isFile() && now - metadata.mtimeMs >= maxAgeMs) {
          await Promise.all([
            this.unlinkIfExists(join(this.directory, fileId)),
            this.unlinkIfExists(this.ownerPath(fileId)),
          ])
          removed += 1
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'invalid file id') return
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }))
    return removed
  }

  private formatForId(fileId: string) {
    if (basename(fileId) !== fileId) throw new Error('invalid file id')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|gif|webp)$/u.test(fileId)) throw new Error('invalid file id')
    const format = formats.find((candidate) => fileId.endsWith(candidate.extension))
    if (!format) throw new Error('invalid file id')
    return format
  }

  private assertEntityId(id: string, label: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)) throw new Error(`invalid ${label}`)
  }

  private ownerPath(fileId: string) {
    this.formatForId(fileId)
    return join(this.directory, `${fileId}.owner.json`)
  }

  private claimPath(fileId: string) {
    this.formatForId(fileId)
    return join(this.directory, `${fileId}.claim.json`)
  }

  private async readOwner(fileId: string): Promise<MediaOwnerMetadata> {
    const owner = JSON.parse(await readFile(this.ownerPath(fileId), 'utf8')) as MediaOwnerMetadata
    if (owner.schemaVersion !== 'media-owner-v1' || owner.fileId !== fileId) throw new MediaOwnershipError('uploaded image owner metadata is invalid')
    this.assertEntityId(owner.ownerId, 'owner id')
    return owner
  }

  private async readClaim(fileId: string): Promise<MediaClaimMetadata> {
    const claim = JSON.parse(await readFile(this.claimPath(fileId), 'utf8')) as MediaClaimMetadata
    if (claim.schemaVersion !== 'media-claim-v1' || claim.fileId !== fileId) throw new MediaOwnershipError('uploaded image claim metadata is invalid')
    this.assertEntityId(claim.ownerId, 'owner id')
    this.assertEntityId(claim.reportId, 'report id')
    return claim
  }

  private async hasClaim(fileId: string): Promise<boolean> {
    try {
      return (await stat(this.claimPath(fileId))).isFile()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private async unlinkIfExists(path: string): Promise<void> {
    try {
      await unlink(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
