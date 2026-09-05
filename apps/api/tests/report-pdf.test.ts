import { existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { Browser, Page, Route } from 'playwright-core'
import { createReportPdfRenderer, ReportPdfUnavailableError } from '../src/report-pdf.js'
import type { ReportExportSnapshot } from '@fengshui/export-documents'

const snapshot: ReportExportSnapshot = {
  id: 'report-pdf-test',
  status: 'completed',
  createdAt: '2026-09-03T12:00:00.000Z',
  report: '# 人宅合拍结论\n\n- **整体判断：** 合拍。',
  bazi: {
    pillars: ['壬申', '戊申', '丙寅', '癸巳'],
    correctedLocalTime: '1992-08-18T09:27',
    correctionMinutes: -3,
  },
}

function fakeBrowser() {
  let routeHandler: ((route: Route) => Promise<void>) | undefined
  const page = {
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    route: vi.fn(async (_pattern: string, handler: (route: Route) => Promise<void>) => { routeHandler = handler }),
    setContent: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => undefined),
    pdf: vi.fn(async () => Buffer.from('%PDF-1.7\nfixture')),
    close: vi.fn(async () => undefined),
  } as unknown as Page
  const browser = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  } as unknown as Browser
  const launcher = { launch: vi.fn(async () => browser) }
  return { browser, launcher, page, routeHandler: () => routeHandler }
}

function fakeRoute(url: string) {
  const route = {
    request: () => ({ url: () => url }),
    continue: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
  }
  return route as unknown as Route & { continue: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> }
}

describe('report PDF renderer', () => {
  it('validates renderer limits before starting a browser', () => {
    expect(() => createReportPdfRenderer({ maxConcurrency: 0 })).toThrow('maxConcurrency')
    expect(() => createReportPdfRenderer({ timeoutMs: -1 })).toThrow('timeoutMs')
  })

  it('fails closed when the configured browser is unavailable', async () => {
    const renderer = createReportPdfRenderer({ executablePath: '/definitely/missing/chromium' })
    await expect(renderer.render(snapshot)).rejects.toBeInstanceOf(ReportPdfUnavailableError)
  })

  it('renders the shared report HTML, blocks external requests, and closes browser resources', async () => {
    const fake = fakeBrowser()
    const renderer = createReportPdfRenderer({ executablePath: process.execPath, launcher: fake.launcher })

    const pdf = await renderer.render(snapshot)

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(fake.page.setContent).toHaveBeenCalledWith(expect.stringContaining('住宅文化分析报告'), expect.any(Object))
    expect(fake.page.setContent).toHaveBeenCalledWith(expect.stringContaining('<h2>人宅合拍结论</h2>'), expect.any(Object))
    expect(fake.page.setContent).not.toHaveBeenCalledWith(expect.stringContaining('# 人宅合拍结论'), expect.any(Object))
    expect(fake.page.pdf).toHaveBeenCalledWith(expect.objectContaining({ format: 'A4', printBackground: true, preferCSSPageSize: true }))

    const external = fakeRoute('https://tracking.invalid/pixel')
    await fake.routeHandler()!(external)
    expect(external.abort).toHaveBeenCalledWith('blockedbyclient')
    expect(external.continue).not.toHaveBeenCalled()

    const inline = fakeRoute('data:text/plain,ok')
    await fake.routeHandler()!(inline)
    expect(inline.continue).toHaveBeenCalledOnce()
    expect(fake.page.close).toHaveBeenCalledOnce()
    expect(fake.browser.close).toHaveBeenCalledOnce()
  })

  it('closes browser resources and sanitizes unexpected render failures', async () => {
    const fake = fakeBrowser()
    vi.mocked(fake.page.pdf).mockRejectedValueOnce(new Error('/private/browser/internal failure'))
    const renderer = createReportPdfRenderer({ executablePath: process.execPath, launcher: fake.launcher })

    await expect(renderer.render(snapshot)).rejects.toEqual(new ReportPdfUnavailableError())
    expect(fake.page.close).toHaveBeenCalledOnce()
    expect(fake.browser.close).toHaveBeenCalledOnce()
  })

  it('caps simultaneous browser launches', async () => {
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    const launcher = {
      launch: vi.fn(async () => {
        active += 1
        peak = Math.max(peak, active)
        const page = {
          setDefaultTimeout: vi.fn(),
          setDefaultNavigationTimeout: vi.fn(),
          route: vi.fn(async () => undefined),
          setContent: vi.fn(async () => undefined),
          evaluate: vi.fn(async () => undefined),
          pdf: vi.fn(() => new Promise<Buffer>((resolve) => releases.push(() => resolve(Buffer.from('%PDF-1.7'))))),
          close: vi.fn(async () => { active -= 1 }),
        } as unknown as Page
        return { newPage: async () => page, close: vi.fn(async () => undefined) } as unknown as Browser
      }),
    }
    const renderer = createReportPdfRenderer({ executablePath: process.execPath, launcher, maxConcurrency: 2 })

    const renders = [renderer.render(snapshot), renderer.render(snapshot), renderer.render(snapshot)]
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    expect(launcher.launch).toHaveBeenCalledTimes(2)
    releases.splice(0).forEach((release) => release())
    await vi.waitFor(() => expect(launcher.launch).toHaveBeenCalledTimes(3))
    releases.splice(0).forEach((release) => release())
    await Promise.all(renders)

    expect(peak).toBe(2)
    expect(active).toBe(0)
  })

  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  it.skipIf(!existsSync(chrome))('renders a real PDF with the local browser', async () => {
    const pdf = await createReportPdfRenderer({ executablePath: chrome }).render(snapshot)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.byteLength).toBeGreaterThan(10_000)
  }, 30_000)
})
