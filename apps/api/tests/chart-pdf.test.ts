import { existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { Browser, Page, Route } from 'playwright-core'
import type { ChartPdfSnapshot } from '../src/chart-pdf.js'
import { ChartPdfUnavailableError, createChartPdfRenderer } from '../src/chart-pdf.js'

const snapshot: ChartPdfSnapshot = {
  profileId: 'profile-1',
  version: 3,
  savedAt: '2026-09-03T12:00:00.000Z',
  birth: {
    date: '1997-02-06',
    time: '08:50',
    locationName: '浙江省 杭州市 西湖区',
    timezone: 'Asia/Shanghai',
  },
  bazi: {
    pillars: ['丁丑', '壬寅', '己卯', '戊辰'],
    correctedLocalTime: '1997-02-06T08:47:00+08:00',
    correctionMinutes: -3,
    ruleVersion: 'bazi-v1',
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

describe('chart PDF renderer', () => {
  it('renders shared Chinese HTML, blocks external requests, and closes page and browser', async () => {
    const fake = fakeBrowser()
    const renderer = createChartPdfRenderer({ executablePath: process.execPath, launcher: fake.launcher })

    const result = await renderer.render(snapshot)

    expect(result.subarray(0, 5).toString()).toBe('%PDF-')
    expect(fake.page.setContent).toHaveBeenCalledWith(expect.stringContaining('四柱命盘'), expect.any(Object))
    expect(fake.page.setContent).toHaveBeenCalledWith(expect.stringContaining('浙江省 杭州市 西湖区'), expect.any(Object))
    expect(fake.page.pdf).toHaveBeenCalledWith(expect.objectContaining({ format: 'A4', printBackground: true }))

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

  it('does not expose an invalid configured executable path', async () => {
    const secretPath = '/private/not-present/browser-with-secret-name'
    const renderer = createChartPdfRenderer({ executablePath: secretPath })

    await expect(renderer.render(snapshot)).rejects.toMatchObject({
      name: 'ChartPdfUnavailableError',
      code: 'CHART_PDF_UNAVAILABLE',
      message: 'PDF export is unavailable',
    })
    await expect(renderer.render(snapshot)).rejects.not.toThrow(secretPath)
  })

  it('closes browser resources and returns a stable error when rendering fails', async () => {
    const fake = fakeBrowser()
    vi.mocked(fake.page.pdf).mockRejectedValueOnce(new Error('/private/browser/internal failure'))
    const renderer = createChartPdfRenderer({ executablePath: process.execPath, launcher: fake.launcher })

    await expect(renderer.render(snapshot)).rejects.toEqual(new ChartPdfUnavailableError())
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
          setDefaultTimeout: vi.fn(), setDefaultNavigationTimeout: vi.fn(),
          route: vi.fn(async () => undefined), setContent: vi.fn(async () => undefined),
          evaluate: vi.fn(async () => undefined),
          pdf: vi.fn(() => new Promise<Buffer>((resolve) => releases.push(() => resolve(Buffer.from('%PDF-1.7'))))),
          close: vi.fn(async () => { active -= 1 }),
        } as unknown as Page
        return { newPage: async () => page, close: vi.fn(async () => undefined) } as unknown as Browser
      }),
    }
    const renderer = createChartPdfRenderer({ executablePath: process.execPath, launcher, maxConcurrency: 2 })

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
})

const realBrowserPath = process.env.PDF_BROWSER_EXECUTABLE_PATH
  ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium')

describe.skipIf(!existsSync(realBrowserPath))('chart PDF renderer with a local browser', () => {
  it('produces a real PDF containing the shared Chinese chart document', async () => {
    const renderer = createChartPdfRenderer({ executablePath: realBrowserPath, timeoutMs: 30_000, maxConcurrency: 1 })
    const result = await renderer.render(snapshot)

    expect(result.subarray(0, 5).toString()).toBe('%PDF-')
    expect(result.length).toBeGreaterThan(10_000)
  }, 40_000)
})
