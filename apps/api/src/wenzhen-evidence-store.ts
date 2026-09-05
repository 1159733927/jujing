import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export const WENZHEN_EVIDENCE_MAX_BYTES = 8 * 1024 * 1024

export type WenzhenEvidenceMimeType = 'image/png' | 'image/jpeg' | 'image/webp'

export type WenzhenEvidenceRecord = {
  evidenceRef: string
  sha256: string
  mimeType: WenzhenEvidenceMimeType
  size: number
}

const formats: Record<WenzhenEvidenceMimeType, { extension: string; matches(bytes: Buffer): boolean }> = {
  'image/png': {
    extension: 'png',
    matches: (bytes) => bytes.length >= 20
      && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      && bytes.subarray(-12).equals(Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])),
  },
  'image/jpeg': {
    extension: 'jpg',
    matches: (bytes) => bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9,
  },
  'image/webp': {
    extension: 'webp',
    matches: (bytes) => bytes.length >= 20
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.readUInt32LE(4) === bytes.length - 8
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
      && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.subarray(12, 16).toString('ascii')),
  },
}

const evidenceRefPattern = /^evidence\/wenzhen\/sha256-([a-f0-9]{64})\.(png|jpg|webp)$/

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex')
}

function formatForMimeType(mimeType: string) {
  return formats[mimeType as WenzhenEvidenceMimeType]
}

function detectMimeType(bytes: Buffer): WenzhenEvidenceMimeType | undefined {
  return (Object.entries(formats) as [WenzhenEvidenceMimeType, (typeof formats)[WenzhenEvidenceMimeType]][])
    .find(([, format]) => format.matches(bytes))?.[0]
}

export class FileWenzhenEvidenceStore {
  constructor(private readonly directory: string) {}

  async save(input: { mimeType: string; bytes: Buffer }): Promise<WenzhenEvidenceRecord> {
    const declaredFormat = formatForMimeType(input.mimeType)
    if (!declaredFormat) throw new Error('WenZhen evidence must be PNG, JPEG, or WebP')
    if (!input.bytes.length) throw new Error('WenZhen evidence image is empty')
    if (input.bytes.length > WENZHEN_EVIDENCE_MAX_BYTES) throw new Error(`WenZhen evidence exceeds ${WENZHEN_EVIDENCE_MAX_BYTES} bytes`)
    const detectedMimeType = detectMimeType(input.bytes)
    if (!detectedMimeType || detectedMimeType !== input.mimeType) throw new Error('WenZhen evidence MIME type does not match image signature')

    const digest = sha256(input.bytes)
    const filename = `sha256-${digest}.${declaredFormat.extension}`
    const evidenceRef = `evidence/wenzhen/${filename}`
    const destination = join(this.directory, filename)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    try {
      await writeFile(destination, input.bytes, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await readFile(destination)
      if (!existing.equals(input.bytes)) throw new Error('WenZhen evidence hash collision detected')
    }
    return { evidenceRef, sha256: digest, mimeType: detectedMimeType, size: input.bytes.length }
  }

  async verify(evidenceRef: string): Promise<WenzhenEvidenceRecord> {
    const match = evidenceRefPattern.exec(evidenceRef)
    if (!match) throw new Error('evidenceRef must be a server-issued WenZhen evidence reference')
    const expectedHash = match[1]!
    const extension = match[2]!
    const filename = basename(evidenceRef)
    const bytes = await readFile(join(this.directory, filename)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') throw new Error('WenZhen evidence does not exist')
      throw error
    })
    if (!bytes.length || bytes.length > WENZHEN_EVIDENCE_MAX_BYTES) throw new Error('WenZhen evidence has an invalid size')
    const detectedMimeType = detectMimeType(bytes)
    if (!detectedMimeType || formats[detectedMimeType].extension !== extension) throw new Error('WenZhen evidence file signature is invalid')
    const actualHash = sha256(bytes)
    if (actualHash !== expectedHash) throw new Error('WenZhen evidence hash does not match evidenceRef')
    return { evidenceRef, sha256: actualHash, mimeType: detectedMimeType, size: bytes.length }
  }
}
