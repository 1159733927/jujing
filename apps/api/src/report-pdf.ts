import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { buildReportExportHtml, type ReportExportSnapshot } from '@fengshui/export-documents'
import { chromium, type Browser, type Page } from 'playwright-core'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_CONCURRENCY = 2

export interface ReportPdfRenderer { render(snapshot: ReportExportSnapshot): Promise<Buffer> }

export class ReportPdfUnavailableError extends Error {
  readonly code = 'REPORT_PDF_UNAVAILABLE'

  constructor(message = 'Report PDF export is unavailable') {
    super(message)
    this.name = 'ReportPdfUnavailableError'
  }
}

interface BrowserLauncher {
  launch(options: { executablePath: string; headless: true; timeout: number; args: string[] }): Promise<Browser>
}

export interface ReportPdfRendererOptions {
  readonly executablePath?: string
  readonly timeoutMs?: number
  readonly maxConcurrency?: number
  readonly launcher?: BrowserLauncher
}

class ConcurrencyGate {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly limit: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.active += 1
    try {
      return await work()
    } finally {
      this.active -= 1
      this.waiting.shift()?.()
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new TypeError(`${label} must be a positive integer`)
  return resolved
}

function browserCandidates(): string[] {
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ]
  }
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[]
    return roots.flatMap((root) => [
      `${root}\\Google\\Chrome\\Application\\chrome.exe`,
      `${root}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ])
  }
  return ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
}

async function resolveBrowserExecutable(configured?: string): Promise<string> {
  const explicit = configured?.trim() || process.env.PDF_BROWSER_EXECUTABLE_PATH?.trim()
  if (explicit) {
    try {
      await access(explicit, constants.X_OK)
      return explicit
    } catch {
      throw new ReportPdfUnavailableError()
    }
  }
  for (const candidate of browserCandidates()) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {}
  }
  throw new ReportPdfUnavailableError()
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ReportPdfUnavailableError('Report PDF export timed out')), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function createReportPdfRenderer(options: ReportPdfRendererOptions = {}): ReportPdfRenderer {
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs')
  const gate = new ConcurrencyGate(positiveInteger(options.maxConcurrency, DEFAULT_MAX_CONCURRENCY, 'maxConcurrency'))
  const launcher = options.launcher ?? chromium

  return {
    render(snapshot) {
      return gate.run(async () => {
        const executablePath = await resolveBrowserExecutable(options.executablePath)
        let browser: Browser | undefined
        let page: Page | undefined
        let operation: Promise<Buffer> | undefined
        try {
          operation = (async () => {
            browser = await launcher.launch({
              executablePath,
              headless: true,
              timeout: timeoutMs,
              args: ['--disable-background-networking', '--disable-component-update', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
            })
            page = await browser.newPage()
            page.setDefaultTimeout(timeoutMs)
            page.setDefaultNavigationTimeout(timeoutMs)
            await page.route('**/*', async (route) => {
              const protocol = new URL(route.request().url()).protocol
              if (protocol === 'about:' || protocol === 'data:' || protocol === 'blob:') await route.continue()
              else await route.abort('blockedbyclient')
            })
            await page.setContent(buildReportExportHtml(snapshot), { waitUntil: 'domcontentloaded', timeout: timeoutMs })
            await page.evaluate(() => document.fonts.ready)
            return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }))
          })()
          return await withTimeout(operation, timeoutMs)
        } catch (error) {
          if (error instanceof ReportPdfUnavailableError) throw error
          throw new ReportPdfUnavailableError()
        } finally {
          operation?.catch(() => undefined)
          if (page) await page.close().catch(() => undefined)
          if (browser) await browser.close().catch(() => undefined)
        }
      })
    },
  }
}

export const productionReportPdfRenderer: ReportPdfRenderer = createReportPdfRenderer()
