#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDemoServiceSpecs } from './dev-demo.mjs'

const DEFAULT_CHROME_EXECUTABLE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PLAYWRIGHT_CORE = '../apps/api/node_modules/playwright-core/index.js'
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

export class AccountChromeE2eError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AccountChromeE2eError'
  }
}

function timestampSuffix() {
  return String(Date.now())
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options)
  let payload
  try {
    payload = await response.json()
  } catch {
    payload = undefined
  }
  return { response, payload }
}

async function waitForHttpOk(url, { name, timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
  }
  throw new AccountChromeE2eError(`${name ?? url} did not become ready: ${lastError}`)
}

async function waitForTerminalReport(page, reportId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const report = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/reports/${id}`, { credentials: 'same-origin' })
      return response.ok ? response.json() : { status: `http-${response.status}` }
    }, reportId)
    if (report.status === 'completed' || report.status === 'failed') return report
    await page.waitForTimeout(500)
  }
  throw new AccountChromeE2eError(`report ${reportId} did not reach a terminal status`)
}

function origin({ host, port }) {
  return `http://${host}:${port}`
}

function buildE2eEnv(baseEnv = process.env) {
  const suffix = timestampSuffix()
  const apiPort = baseEnv.ACCOUNT_E2E_API_PORT ?? '4311'
  const webPort = baseEnv.ACCOUNT_E2E_WEB_PORT ?? '4383'
  const adminPort = baseEnv.ACCOUNT_E2E_ADMIN_PORT ?? '4384'
  return {
    HOST: '127.0.0.1',
    PORT: apiPort,
    WEB_HOST: '127.0.0.1',
    WEB_PORT: webPort,
    ADMIN_HOST: '127.0.0.1',
    ADMIN_PORT: adminPort,
    STORAGE_DRIVER: 'file',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: `admin-password-${suffix}`,
    ADMIN_API_TOKEN: `local-account-e2e-admin-${suffix}`,
    KNOWLEDGE_MCP_TOKEN: `local-account-e2e-knowledge-${suffix}`,
    DEEPSEEK_API_KEY: baseEnv.ACCOUNT_E2E_DEEPSEEK_API_KEY ?? 'dummy',
    SEED_PROFESSIONAL_KNOWLEDGE: 'true',
  }
}

async function startServices({ dataDir, env, log }) {
  const serviceSpecs = createDemoServiceSpecs({
    ...process.env,
    ...env,
    REPORTS_FILE_PATH: join(dataDir, 'reports.json'),
    CHARTS_FILE_PATH: join(dataDir, 'charts.json'),
    RESIDENCES_FILE_PATH: join(dataDir, 'residences.json'),
    KNOWLEDGE_FILE_PATH: join(dataDir, 'knowledge.json'),
    BAZI_RULE_PROFILES_FILE_PATH: join(dataDir, 'bazi-rule-profiles.json'),
    ACCOUNTS_FILE_PATH: join(dataDir, 'accounts.json'),
    WENZHEN_FIXTURES_FILE_PATH: join(dataDir, 'wenzhen-fixtures.json'),
    WENZHEN_EVIDENCE_PATH: join(dataDir, 'evidence/wenzhen'),
  }).services
  const children = []
  const logLines = []
  let earlyExit

  for (const spec of serviceSpecs) {
    log(`[account-e2e] starting ${spec.name}`)
    const child = spawn(spec.command, spec.args, {
      cwd: process.cwd(),
      env: spec.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => logLines.push(`[${spec.name}] ${chunk.toString()}`))
    child.stderr.on('data', (chunk) => logLines.push(`[${spec.name}:err] ${chunk.toString()}`))
    child.once('exit', (code, signal) => {
      if (code !== 0 && code !== null && !earlyExit) earlyExit = `${spec.name} exited early with ${code}`
      if (signal && signal !== 'SIGTERM' && signal !== 'SIGINT' && !earlyExit) earlyExit = `${spec.name} exited early from ${signal}`
    })
    children.push(child)
  }

  return {
    children,
    logs: logLines,
    assertAlive() {
      if (earlyExit) throw new AccountChromeE2eError(`${earlyExit}\n${logLines.slice(-40).join('')}`)
    },
    async stop() {
      for (const child of children) {
        if (!child.killed && child.exitCode == null && child.signalCode == null) child.kill('SIGTERM')
      }
      await new Promise((resolveStop) => setTimeout(resolveStop, 500))
    },
  }
}

async function createReportThroughLoggedInPage(page) {
  return page.evaluate(async (pngBase64) => {
    const chartsResponse = await fetch('/api/v1/charts', { credentials: 'same-origin' })
    const charts = await chartsResponse.json()
    const profile = charts.profiles?.[0]
    if (!profile) throw new Error('no chart profile available after browser chart creation')
    const primaryResidenceResponse = await fetch('/api/v1/residences', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'E2E南向住宅', facing: 'south', layoutNote: 'Chrome E2E 测试住宅，客厅朝南，卫生间靠近中部。' }),
    })
    const primaryResidence = await primaryResidenceResponse.json()
    if (primaryResidenceResponse.status !== 201) throw new Error(`primary residence creation failed ${primaryResidenceResponse.status}: ${JSON.stringify(primaryResidence)}`)
    const secondaryResidenceResponse = await fetch('/api/v1/residences', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'E2E北向住宅', facing: 'north', layoutNote: 'Chrome E2E 备用住宅，无报告。' }),
    })
    const secondaryResidence = await secondaryResidenceResponse.json()
    if (secondaryResidenceResponse.status !== 201) throw new Error(`secondary residence creation failed ${secondaryResidenceResponse.status}: ${JSON.stringify(secondaryResidence)}`)

    const bytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0))
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: 'image/png' }), 'account-e2e-floorplan.png')
    const uploadResponse = await fetch('/api/v1/media', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-vision-consent': 'accepted' },
      body: form,
    })
    const upload = await uploadResponse.json()
    if (!uploadResponse.ok) throw new Error(`upload failed ${uploadResponse.status}: ${JSON.stringify(upload)}`)

    const reportResponse = await fetch('/api/v1/reports', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        visionConsent: true,
        chartProfileId: profile.id,
        chartVersionId: profile.currentVersion.id,
        residenceProfileId: primaryResidence.profile.id,
        residenceVersionId: primaryResidence.profile.currentVersion.id,
        residence: primaryResidence.profile.currentVersion.snapshot,
        photos: [{ fileId: upload.fileId, room: 'living-room', facing: 'south', note: 'Chrome E2E 测试图' }],
      }),
    })
    const report = await reportResponse.json()
    if (reportResponse.status !== 202) throw new Error(`report creation failed ${reportResponse.status}: ${JSON.stringify(report)}`)
    return {
      id: report.id,
      chartProfileId: profile.id,
      chartLabel: profile.label,
      residenceProfileId: primaryResidence.profile.id,
      residenceLabel: primaryResidence.profile.currentVersion.snapshot.label,
      emptyResidenceProfileId: secondaryResidence.profile.id,
      emptyResidenceLabel: secondaryResidence.profile.currentVersion.snapshot.label,
    }
  }, TINY_PNG_BASE64)
}

async function runBrowserFlow({ webOrigin, adminOrigin, username, password, adminUsername, adminPassword, chromeExecutable, log }) {
  const playwright = await import(PLAYWRIGHT_CORE)
  const browser = await playwright.default.chromium.launch({ executablePath: chromeExecutable, headless: true })
  const page = await browser.newPage()
  try {
    log('[account-e2e] admin login and issue account')
    await page.goto(`${adminOrigin}/admin/`, { waitUntil: 'domcontentloaded' })
    await page.locator('input[autocomplete="username"]').fill(adminUsername)
    await page.locator('input[autocomplete="current-password"]').fill(adminPassword)
    await page.getByRole('button', { name: /登\s*录|登录/u }).click()
    await page.getByText('用户账号').click()
    await page.getByRole('button', { name: '创建账号' }).click()
    const createAccountModal = page.locator('.ant-modal').filter({ hasText: '创建用户账号' })
    await createAccountModal.getByPlaceholder('用户登录时使用').fill(username)
    await createAccountModal.getByPlaceholder('例如：张先生').fill('E2E用户')
    await createAccountModal.getByPlaceholder('仅用于本次创建，不会回显').fill(password)
    await createAccountModal.locator('.ant-modal-footer button.ant-btn-primary').click({ force: true })
    await page.getByText(username, { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })

    log('[account-e2e] consumer login')
    await page.goto(`${webOrigin}/`, { waitUntil: 'domcontentloaded' })
    await page.locator('input[autocomplete="username"]').fill(username)
    await page.locator('input[autocomplete="current-password"]').fill(password)
    await page.getByRole('button', { name: '登录' }).click()
    await page.getByText('E2E用户').waitFor({ state: 'visible', timeout: 10_000 })

    log('[account-e2e] chart picker and birthplace picker')
    await page.goto(`${webOrigin}/chart`, { waitUntil: 'domcontentloaded' })
    await page.getByText('1992/08/18', { exact: true }).click()
    await page.getByRole('dialog', { name: '选择出生时间' }).getByRole('button', { name: '确定' }).click()
    await page.getByText('浙江省 杭州市 西湖区', { exact: true }).click()
    await page.getByText('省 / 市 / 区县选择器').waitFor({ state: 'visible', timeout: 5_000 })
    await page.getByRole('button', { name: '关闭出生地点选择器' }).click()

    log('[account-e2e] create two member charts')
    await page.getByRole('button', { name: /生成命盘|更新命盘/u }).click()
    await page.getByRole('button', { name: '更新命盘' }).waitFor({ state: 'visible', timeout: 10_000 })
    await page.locator('select[aria-label="当前成员"]').selectOption('')
    await page.getByRole('heading', { name: '新建成员命盘' }).waitFor({ state: 'visible', timeout: 10_000 })
    await page.locator('input[placeholder="例如：我、妻子、妈妈"]').fill('妻子命盘')
    await page.locator('select').nth(1).selectOption('partner')
    await page.getByRole('button', { name: /生成命盘|更新命盘/u }).click()
    await page.waitForFunction(() => {
      const select = document.querySelector('select[aria-label="当前成员"]')
      const options = select ? [...select.querySelectorAll('option')].map((option) => option.textContent?.trim()) : []
      return options.length >= 3 && options.includes('妻子命盘')
    }, null, { timeout: 10_000 })

    log('[account-e2e] create terminal report, archive and restore')
    const createdReport = await createReportThroughLoggedInPage(page)
    await waitForTerminalReport(page, createdReport.id)
    await page.goto(`${webOrigin}/reports`, { waitUntil: 'domcontentloaded' })
    await page.getByText(/已完成|生成失败/u).first().waitFor({ state: 'visible', timeout: 10_000 })
    await page.locator('.report-member-name').getByText(createdReport.chartLabel, { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })

    log('[account-e2e] member-scoped report history')
    const otherChartProfileId = await page.evaluate(async (currentReportChartProfileId) => {
      const response = await fetch('/api/v1/charts', { credentials: 'same-origin' })
      const payload = await response.json()
      const other = payload.profiles?.find((profile) => profile.id !== currentReportChartProfileId)
      return other?.id ?? ''
    }, createdReport.chartProfileId)
    if (!otherChartProfileId) throw new AccountChromeE2eError('no alternate chart profile available for report history scope check')
    await page.getByRole('button', { name: '当前成员' }).click()
    await page.locator('select[aria-label="当前成员"]').selectOption(otherChartProfileId)
    await page.getByText('还没有住宅报告').waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('button', { name: '全部成员' }).click()
    await page.locator('.report-member-name').getByText(createdReport.chartLabel, { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
    const residenceFilter = page.locator('select[aria-label="报告住宅筛选"]')
    await residenceFilter.waitFor({ state: 'visible', timeout: 10_000 })
    await residenceFilter.selectOption(createdReport.emptyResidenceProfileId)
    await page.getByText('还没有住宅报告').waitFor({ state: 'visible', timeout: 10_000 })
    await residenceFilter.selectOption(createdReport.residenceProfileId)
    await page.locator('.report-member-name').getByText(createdReport.chartLabel, { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })

    await page.getByRole('button', { name: '移入回收站' }).click()
    await page.getByText('还没有住宅报告').waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('button', { name: '回收站' }).click()
    await page.getByText(/已完成|生成失败/u).first().waitFor({ state: 'visible', timeout: 10_000 })

    await page.getByRole('button', { name: '恢复报告' }).click()
    await page.getByText(/已完成|生成失败/u).first().waitFor({ state: 'visible', timeout: 10_000 })

    return {
      username,
      reportId: createdReport.id,
      chartLabel: createdReport.chartLabel,
      webOrigin,
      adminOrigin,
    }
  } finally {
    await browser.close()
  }
}

export async function runAccountChromeE2e({
  env = process.env,
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  const chromeExecutable = env.CHROME_EXECUTABLE_PATH?.trim() || DEFAULT_CHROME_EXECUTABLE
  const dataDir = await mkdtemp(join(tmpdir(), 'fengshui-account-e2e-'))
  const e2eEnv = buildE2eEnv(env)
  const services = await startServices({ dataDir, env: e2eEnv, log })
  const serviceLogPath = join(dataDir, 'service.log')
  try {
    const network = createDemoServiceSpecs({ ...process.env, ...e2eEnv }).services
    const apiSpec = network.find((service) => service.name === 'api')
    if (!apiSpec) throw new AccountChromeE2eError('api service spec missing')
    const webOrigin = origin({ host: e2eEnv.WEB_HOST, port: e2eEnv.WEB_PORT })
    const adminOrigin = origin({ host: e2eEnv.ADMIN_HOST, port: e2eEnv.ADMIN_PORT })
    await waitForHttpOk(`http://${e2eEnv.HOST}:${e2eEnv.PORT}/health`, { name: 'API health' })
    services.assertAlive()
    await waitForHttpOk(webOrigin, { name: 'web app' })
    services.assertAlive()
    await waitForHttpOk(`${adminOrigin}/admin/`, { name: 'admin app' })
    services.assertAlive()

    const suffix = timestampSuffix()
    const result = await runBrowserFlow({
      webOrigin,
      adminOrigin,
      username: `acct${suffix}`,
      password: `account-e2e-${suffix}`,
      adminUsername: e2eEnv.ADMIN_USERNAME,
      adminPassword: e2eEnv.ADMIN_PASSWORD,
      chromeExecutable,
      log,
    })
    log(`[account-e2e] ok ${JSON.stringify(result)}`)
    return { ...result, dataDir }
  } catch (error) {
    await writeFile(serviceLogPath, services.logs.join(''), 'utf8')
    const reason = error instanceof Error ? error.message : String(error)
    throw new AccountChromeE2eError(`${reason}\nservice logs: ${serviceLogPath}`)
  } finally {
    await services.stop()
  }
}

function main() {
  runAccountChromeE2e().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[account-e2e] failed: ${message}\n`)
    process.exit(1)
  })
}

export function isMainModule(metaUrl = import.meta.url, argvEntry = process.argv[1]) {
  return typeof argvEntry === 'string' && fileURLToPath(metaUrl) === resolve(argvEntry)
}

if (isMainModule()) {
  main()
}
