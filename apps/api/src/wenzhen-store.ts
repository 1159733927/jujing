import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  validateWenzhenFixture,
  type ReportableWenzhenFixture,
} from '@fengshui/bazi-engine/wenzhen-fixtures'

export const WENZHEN_FIXTURE_STORE_SCHEMA_VERSION = 'wenzhen-fixture-store-v1' as const

interface WenzhenFixtureStoreFile {
  schemaVersion: typeof WENZHEN_FIXTURE_STORE_SCHEMA_VERSION
  samples: ReportableWenzhenFixture[]
}

export interface WenzhenFixtureStore {
  list(): Promise<ReportableWenzhenFixture[]>
  append(fixture: ReportableWenzhenFixture): Promise<ReportableWenzhenFixture>
  ping(): Promise<void>
  close(): Promise<void>
}

export interface WenzhenStoreFileOperations {
  readFile(path: string): Promise<string>
  mkdir(path: string): Promise<void>
  writeFile(path: string, contents: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  unlink(path: string): Promise<void>
}

export interface FileWenzhenFixtureStoreOptions {
  fileOperations?: Partial<WenzhenStoreFileOperations>
}

const defaultFileOperations: WenzhenStoreFileOperations = {
  readFile: async (path) => readFile(path, 'utf8'),
  mkdir: async (path) => { await mkdir(path, { recursive: true }) },
  writeFile: async (path, contents) => { await writeFile(path, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' }) },
  rename: async (from, to) => rename(from, to),
  unlink: async (path) => unlink(path),
}

export class FileWenzhenFixtureStore implements WenzhenFixtureStore {
  readonly #filePath: string
  readonly #files: WenzhenStoreFileOperations
  #writeQueue: Promise<void> = Promise.resolve()
  #closed = false

  constructor(filePath: string, options: FileWenzhenFixtureStoreOptions = {}) {
    if (!filePath.trim()) throw new Error('WenZhen fixture store path must be non-empty')
    this.#filePath = filePath
    this.#files = { ...defaultFileOperations, ...options.fileOperations }
  }

  async list(): Promise<ReportableWenzhenFixture[]> {
    this.#assertOpen()
    await this.#writeQueue
    return structuredClone((await this.#read()).samples)
  }

  async append(fixture: ReportableWenzhenFixture): Promise<ReportableWenzhenFixture> {
    this.#assertOpen()
    const checked = checkedReportableFixture(structuredClone(fixture), 'fixture to append')
    const operation = this.#writeQueue.then(async () => {
      const current = await this.#read()
      if (current.samples.some((sample) => sample.sampleId === checked.sampleId)) {
        throw new Error(`WenZhen sampleId already exists: ${checked.sampleId}`)
      }
      await this.#atomicWrite({
        schemaVersion: WENZHEN_FIXTURE_STORE_SCHEMA_VERSION,
        samples: [...current.samples, checked],
      })
      return structuredClone(checked)
    })

    // Always heal the queue tail: one failed append must not poison later work.
    this.#writeQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  async ping(): Promise<void> {
    this.#assertOpen()
    await this.#writeQueue
    await this.#read()
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await this.#writeQueue
  }

  async #read(): Promise<WenzhenFixtureStoreFile> {
    let text: string
    try {
      text = await this.#files.readFile(this.#filePath)
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        return { schemaVersion: WENZHEN_FIXTURE_STORE_SCHEMA_VERSION, samples: [] }
      }
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new Error(`WenZhen fixture store is not valid JSON: ${this.#filePath}`, { cause: error })
    }
    if (!isRecord(parsed)) throw new Error(`WenZhen fixture store must contain an object: ${this.#filePath}`)
    const keys = Object.keys(parsed)
    if (keys.some((key) => key !== 'schemaVersion' && key !== 'samples')) {
      throw new Error(`WenZhen fixture store contains unsupported top-level fields: ${this.#filePath}`)
    }
    if (parsed.schemaVersion !== WENZHEN_FIXTURE_STORE_SCHEMA_VERSION) {
      throw new Error(`WenZhen fixture store schemaVersion must be ${WENZHEN_FIXTURE_STORE_SCHEMA_VERSION}`)
    }
    if (!Array.isArray(parsed.samples)) throw new Error(`WenZhen fixture store samples must be an array: ${this.#filePath}`)

    const ids = new Set<string>()
    const samples = parsed.samples.map((candidate, index) => {
      const sample = checkedReportableFixture(candidate, `${this.#filePath}#samples[${index}]`)
      if (ids.has(sample.sampleId)) throw new Error(`duplicate WenZhen sampleId in fixture store: ${sample.sampleId}`)
      ids.add(sample.sampleId)
      return sample
    })
    return { schemaVersion: WENZHEN_FIXTURE_STORE_SCHEMA_VERSION, samples }
  }

  async #atomicWrite(contents: WenzhenFixtureStoreFile): Promise<void> {
    await this.#files.mkdir(dirname(this.#filePath))
    const temporaryPath = `${this.#filePath}.${randomUUID()}.tmp`
    try {
      await this.#files.writeFile(temporaryPath, `${JSON.stringify(contents, null, 2)}\n`)
      await this.#files.rename(temporaryPath, this.#filePath)
    } catch (error) {
      try { await this.#files.unlink(temporaryPath) } catch { /* best-effort cleanup must not mask the write error */ }
      throw error
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('WenZhen fixture store is closed')
  }
}

function checkedReportableFixture(value: unknown, context: string): ReportableWenzhenFixture {
  const checked = validateWenzhenFixture(value, context)
  if (checked.status === 'pending-manual-verification') {
    throw new Error(`${context} must be verified or accepted-difference`)
  }
  return checked
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrno(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code
}
