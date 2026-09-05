import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { buildChartExportHtml, type ChartExportSnapshot } from '@fengshui/export-documents'
import type { BaziChart } from '@fengshui/domain'
import { chromium, type Browser, type Page } from 'playwright-core'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_CONCURRENCY = 2

export type ChartPdfSnapshot = Omit<ChartExportSnapshot, 'bazi'> & { readonly bazi: BaziChart }

export interface ChartPdfRenderer { render(snapshot: ChartPdfSnapshot): Promise<Buffer> }

export class ChartPdfUnavailableError extends Error {
  readonly code = 'CHART_PDF_UNAVAILABLE'

  constructor(message = 'PDF export is unavailable') {
    super(message)
    this.name = 'ChartPdfUnavailableError'
  }
}

interface BrowserLauncher {
  launch(options: { executablePath: string; headless: true; timeout: number; args: string[] }): Promise<Browser>
}

export interface ChartPdfRendererOptions {
  readonly executablePath?: string
  readonly timeoutMs?: number
  readonly maxConcurrency?: number
  /** Test seam for verifying browser isolation without starting a real process. */
  readonly launcher?: BrowserLauncher
}

class ConcurrencyGate {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly limit: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    }
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
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${label} must be a positive integer`)
  }
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

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveBrowserExecutable(configured?: string): Promise<string> {
  const explicit = configured?.trim() || process.env.PDF_BROWSER_EXECUTABLE_PATH?.trim()
  if (explicit) {
    if (await isExecutable(explicit)) return explicit
    throw new ChartPdfUnavailableError()
  }
  for (const candidate of browserCandidates()) {
    if (await isExecutable(candidate)) return candidate
  }
  throw new ChartPdfUnavailableError()
}

function timeoutError(): ChartPdfUnavailableError {
  return new ChartPdfUnavailableError('PDF export timed out')
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError()), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Projects the domain result onto the export package's explicit field allowlist. */
function toExportSnapshot(snapshot: ChartPdfSnapshot): ChartExportSnapshot {
  const { bazi } = snapshot
  return {
    ...snapshot,
    bazi: {
      pillars: bazi.pillars,
      correctedLocalTime: bazi.correctedLocalTime,
      correctionMinutes: bazi.correctionMinutes,
      ruleVersion: bazi.ruleVersion,
      tenGods: bazi.tenGods,
      hiddenStems: bazi.hiddenStems,
      luckCycles: bazi.luckCycles?.map((cycle) => ({
        pillar: cycle.pillar,
        startAge: cycle.startAge,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        direction: cycle.direction,
      })),
      professional: bazi.professional && {
        naYin: bazi.professional.naYin,
        voidBranches: bazi.professional.voidBranches,
        twelveGrowthStages: bazi.professional.twelveGrowthStages,
      },
      timeProfile: bazi.timeProfile && {
        timezone: bazi.timeProfile.timezone,
        dstPolicy: bazi.timeProfile.dstPolicy,
        dayBoundary: bazi.timeProfile.dayBoundary,
      },
    },
  }
}

export function createChartPdfRenderer(options: ChartPdfRendererOptions = {}): ChartPdfRenderer {
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs')
  const maxConcurrency = positiveInteger(options.maxConcurrency, DEFAULT_MAX_CONCURRENCY, 'maxConcurrency')
  const gate = new ConcurrencyGate(maxConcurrency)
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
              args: [
                '--disable-background-networking',
                '--disable-component-update',
                '--disable-dev-shm-usage',
                '--no-first-run',
                '--no-default-browser-check',
              ],
            })
            page = await browser.newPage()
            page.setDefaultTimeout(timeoutMs)
            page.setDefaultNavigationTimeout(timeoutMs)
            await page.route('**/*', async (route) => {
              const protocol = new URL(route.request().url()).protocol
              if (protocol === 'about:' || protocol === 'data:' || protocol === 'blob:') {
                await route.continue()
                return
              }
              await route.abort('blockedbyclient')
            })
            await page.setContent(buildChartExportHtml(toExportSnapshot(snapshot)), { waitUntil: 'domcontentloaded', timeout: timeoutMs })
            await page.evaluate(() => document.fonts.ready)
            const pdf = await page.pdf({
              format: 'A4',
              printBackground: true,
              preferCSSPageSize: true,
            })
            return Buffer.from(pdf)
          })()
          return await withTimeout(operation, timeoutMs)
        } catch (error) {
          if (error instanceof ChartPdfUnavailableError) throw error
          throw new ChartPdfUnavailableError()
        } finally {
          operation?.catch(() => undefined)
          if (page) await page.close().catch(() => undefined)
          if (browser) await browser.close().catch(() => undefined)
        }
      })
    },
  }
}

export const productionChartPdfRenderer: ChartPdfRenderer = createChartPdfRenderer()
