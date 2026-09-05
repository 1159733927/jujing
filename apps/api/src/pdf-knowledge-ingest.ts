import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CreateAssetInput, KnowledgeStore } from './knowledge.js'

const execFileAsync = promisify(execFile)
const MAX_CHUNK_CHARS = 6_000
const MIN_CHUNK_CHARS = 40
const DEFAULT_COLLECTION = '中州派玄空风水'
const DEFAULT_ACTOR = 'pdf-knowledge-importer'

export interface ExtractedPdfPage {
  pageNumber: number
  text: string
}

export interface PdfKnowledgeSource {
  path: string
  title?: string
  author?: string
  collection?: string
}

export interface PdfKnowledgeImportOptions {
  actor?: string
  submitForReview?: boolean
  extractPages?: (path: string) => Promise<ExtractedPdfPage[]>
  maxChunkChars?: number
}

export interface PdfKnowledgeImportSourceResult {
  path: string
  title: string
  sourceHash: string
  pages: number
  chunks: number
  created: number
  skipped: number
  submittedForReview: number
}

export interface PdfKnowledgeImportResult {
  sources: PdfKnowledgeImportSourceResult[]
  created: number
  skipped: number
  submittedForReview: number
}

interface PdfExtractionPayload {
  pages?: Array<{ page?: unknown; text?: unknown }>
}

export interface ChunkedPdfText {
  pageStart: number
  pageEnd: number
  chunkIndex: number
  text: string
  chapter: string
  chunkHash: string
}

export async function importPdfKnowledgeSources(
  store: KnowledgeStore,
  sources: readonly PdfKnowledgeSource[],
  options: PdfKnowledgeImportOptions = {},
): Promise<PdfKnowledgeImportResult> {
  const actor = options.actor?.trim() || DEFAULT_ACTOR
  const extractPages = options.extractPages ?? extractPdfPages
  const existingAssets = await store.list()
  const existingFingerprints = new Set(existingAssets.flatMap((asset) => extractImportFingerprints(asset.body)))
  const results: PdfKnowledgeImportSourceResult[] = []

  for (const source of sources) {
    const sourceBuffer = await readFile(source.path)
    const sourceHash = sha256(sourceBuffer)
    const title = source.title?.trim() || inferPdfTitle(source.path)
    const collection = source.collection?.trim() || DEFAULT_COLLECTION
    const pages = await extractPages(source.path)
    const chunks = chunkPdfPages(pages, options.maxChunkChars)
    if (!chunks.length) throw new Error(`PDF source has no importable text chunks: ${source.path}`)
    let created = 0
    let skipped = 0
    let submittedForReview = 0

    for (const chunk of chunks) {
      const fingerprint = pdfChunkFingerprint(sourceHash, chunk.pageStart, chunk.pageEnd, chunk.chunkIndex, chunk.chunkHash)
      if (existingFingerprints.has(fingerprint)) {
        skipped += 1
        continue
      }
      const asset = await store.create(
        buildPdfChunkAsset({ source, title, collection, sourceHash, fingerprint, chunk }),
        actor,
      )
      existingFingerprints.add(fingerprint)
      created += 1
      if (options.submitForReview) {
        const submitted = await store.setState(asset.id, 'in-review', actor)
        if (submitted?.state === 'in-review') submittedForReview += 1
      }
    }

    results.push({
      path: source.path,
      title,
      sourceHash,
      pages: pages.length,
      chunks: chunks.length,
      created,
      skipped,
      submittedForReview,
    })
  }

  return {
    sources: results,
    created: results.reduce((sum, item) => sum + item.created, 0),
    skipped: results.reduce((sum, item) => sum + item.skipped, 0),
    submittedForReview: results.reduce((sum, item) => sum + item.submittedForReview, 0),
  }
}

export async function extractPdfPages(path: string): Promise<ExtractedPdfPage[]> {
  const python = resolvePdfPython()
  const script = [
    'import json, sys',
    'import pdfplumber',
    'pages = []',
    'with pdfplumber.open(sys.argv[1]) as pdf:',
    '  for index, page in enumerate(pdf.pages, start=1):',
    '    text = page.extract_text(x_tolerance=1, y_tolerance=3) or ""',
    '    pages.append({"page": index, "text": text})',
    'print(json.dumps({"pages": pages}, ensure_ascii=False))',
  ].join('\n')
  const { stdout } = await execFileAsync(python, ['-c', script, path], { maxBuffer: 80 * 1024 * 1024 })
  const payload = JSON.parse(stdout) as PdfExtractionPayload
  if (!Array.isArray(payload.pages)) throw new Error('pdf extractor returned an invalid payload')
  return payload.pages.map((page) => ({
    pageNumber: Number(page.page),
    text: typeof page.text === 'string' ? normalizePageText(page.text) : '',
  })).filter((page) => Number.isInteger(page.pageNumber) && page.pageNumber > 0)
}

export function chunkPdfPages(pages: readonly ExtractedPdfPage[], maxChars = MAX_CHUNK_CHARS): ChunkedPdfText[] {
  const normalizedPages = stripRepeatedHeadersAndFooters(pages)
  const chunks: ChunkedPdfText[] = []
  let active: { pageStart: number; pageEnd: number; chapter: string; parts: string[]; length: number } | undefined

  const flush = () => {
    if (!active) return
    const text = active.parts.join('\n\n').trim()
    if (text.length >= MIN_CHUNK_CHARS) {
      chunks.push({
        pageStart: active.pageStart,
        pageEnd: active.pageEnd,
        chunkIndex: chunks.length + 1,
        text,
        chapter: active.chapter,
        chunkHash: sha256(text),
      })
    }
    active = undefined
  }

  for (const page of normalizedPages) {
    for (const block of pageBlocks(page, maxChars)) {
      const heading = inferChapter(block.text)
      const chapter = heading ?? active?.chapter ?? '未识别章节'
      const shouldStartNewChapter = Boolean(heading && active && active.parts.length > 0 && chapter !== active.chapter)
      const shouldSplitByLength = Boolean(active && active.length + block.text.length > maxChars)
      if (shouldStartNewChapter || shouldSplitByLength) flush()
      active ??= { pageStart: page.pageNumber, pageEnd: page.pageNumber, chapter, parts: [], length: 0 }
      active.pageEnd = page.pageNumber
      active.parts.push(`【第 ${page.pageNumber} 页】\n${block.text}`)
      active.length += block.text.length
    }
  }
  flush()
  return chunks
}

export function inferPdfTitle(path: string): string {
  return basename(path).replace(/\.pdf$/i, '')
}

export function pdfChunkFingerprint(sourceHash: string, pageStart: number, pageEnd: number, chunkIndex: number, chunkHash: string): string {
  return `pdf:${sourceHash}:p${pageStart}-${pageEnd}:c${chunkIndex}:${chunkHash}`
}

function buildPdfChunkAsset(input: {
  source: PdfKnowledgeSource
  title: string
  collection: string
  sourceHash: string
  fingerprint: string
  chunk: ChunkedPdfText
}): CreateAssetInput {
  const { source, title, collection, sourceHash, fingerprint, chunk } = input
  const pageLabel = chunk.pageStart === chunk.pageEnd ? `p.${chunk.pageStart}` : `p.${chunk.pageStart}-${chunk.pageEnd}`
  const sourceLabel = `${collection} ${pageLabel} sha256:${sourceHash.slice(0, 12)}`
  return {
    kind: 'article',
    title: `${title} ${pageLabel} ${chunk.chapter}`,
    tags: [
      '玄空风水',
      '专家书籍',
      collection,
      `页码:${chunk.pageStart}-${chunk.pageEnd}`,
      `来源:${inferPdfTitle(source.path)}`,
    ],
    sourceLabel,
    body: [
      `importFingerprint: ${fingerprint}`,
      `sourceFile: ${basename(source.path)}`,
      `sourceSha256: ${sourceHash}`,
      `bookTitle: ${title}`,
      source.author?.trim() ? `author: ${source.author.trim()}` : undefined,
      `school: ${collection}`,
      `sourcePages: ${chunk.pageStart}-${chunk.pageEnd}`,
      `sourceChunk: ${chunk.chunkIndex}`,
      `chapter: ${chunk.chapter}`,
      `contentHash: ${chunk.chunkHash}`,
      '',
      chunk.text,
    ].filter((line): line is string => line !== undefined).join('\n'),
  }
}

function extractImportFingerprints(body: string): string[] {
  return [...body.matchAll(/^importFingerprint:\s*(pdf:[^\n]+)$/gm)].map((match) => match[1])
}

function normalizePageText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n')
    .split('\n')
    .filter((line) => !isPdfNoiseLine(line))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isPdfNoiseLine(line: string): boolean {
  const normalized = line.trim()
  if (!normalized) return false
  if (/^[-—_－]{20,}$/u.test(normalized)) return true
  if (/^周易天下会馆/u.test(normalized)) return true
  return false
}

function pageBlocks(page: ExtractedPdfPage, maxChars: number): Array<{ text: string }> {
  return normalizePageText(page.text)
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter((text) => text.length >= MIN_CHUNK_CHARS || Boolean(inferChapter(text)))
    .flatMap((text) => splitLongBlock(text, maxChars))
    .map((text) => ({ text }))
}

function splitLongBlock(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > maxChars) {
    const slice = remaining.slice(0, maxChars)
    const splitAt = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('。'), slice.lastIndexOf('；'))
    const end = splitAt > maxChars * 0.55 ? splitAt + 1 : maxChars
    chunks.push(remaining.slice(0, end).trim())
    remaining = remaining.slice(end).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

function inferChapter(text: string): string | undefined {
  for (const line of text.split('\n').slice(0, 6)) {
    const compact = line.replace(/\s+/g, '')
    if (!compact || compact.length > 40) continue
    if (/^第[一二三四五六七八九十百千万\d]+[章节篇回]/u.test(compact)) return compact
    if (/^[一二三四五六七八九十\d]+[、.．][\p{Script=Han}]{2,32}$/u.test(compact)) return compact
  }
  return undefined
}

function stripRepeatedHeadersAndFooters(pages: readonly ExtractedPdfPage[]): ExtractedPdfPage[] {
  const normalized = pages.map((page) => ({ ...page, text: normalizePageText(page.text) }))
  if (normalized.length < 3) return normalized
  const repeated = new Set<string>()
  for (const selector of [firstLine, lastLine]) {
    const counts = new Map<string, number>()
    for (const page of normalized) {
      const line = selector(page.text)
      if (!line || line.length > 60) continue
      counts.set(line, (counts.get(line) ?? 0) + 1)
    }
    for (const [line, count] of counts) if (count >= Math.ceil(normalized.length * 0.6)) repeated.add(line)
  }
  if (!repeated.size) return normalized
  return normalized.map((page) => ({
    ...page,
    text: normalizePageText(page.text.split('\n').filter((line) => !repeated.has(line.trim())).join('\n')),
  }))
}

function firstLine(text: string): string | undefined {
  return text.split('\n').map((line) => line.trim()).find(Boolean)
}

function lastLine(text: string): string | undefined {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).at(-1)
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function resolvePdfPython(): string {
  const candidates = [
    process.env.PDF_IMPORT_PYTHON,
    'python3',
  ].filter((candidate): candidate is string => Boolean(candidate))
  const selected = candidates.find((candidate) => candidate === 'python3' || existsSync(candidate))
  if (!selected) throw new Error('No Python runtime available for PDF extraction')
  return selected
}
