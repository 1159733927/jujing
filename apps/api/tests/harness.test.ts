import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReportRecord } from '@fengshui/domain'
import {
  generateReportWithRunner,
  HarnessExecutionError,
  reasonAboutCompatibilityWithRunner,
  reviewReportWithRunner,
  reportGenerationInputSha256,
  reportGenerationTimeoutMs,
  safeBaseUrlLabel,
  type HarnessCommandOptions,
  type HarnessCommandRunner,
} from '../src/harness.js'
import { runHarnessSdkWithFactory, type DeepSeekHarnessFactory } from '../src/harness-sdk-runner.js'
import { CULTURAL_USE_NOTICE, ReportValidationError } from '../src/report-validator.js'

const birth = {
  date: '1992-08-18',
  time: '09:30',
  locationName: '杭州',
  longitude: 120.1551,
}

const record: ReportRecord = {
  id: 'report-command-boundary',
  status: 'queued',
  createdAt: '2026-08-30T00:00:00.000Z',
  submission: {
    visionConsent: true,
    calculationInput: birth,
    birth,
    residence: { facing: 'south' },
    photos: [],
  },
  bazi: {
    ruleVersion: 'bazi-v1',
    timeCorrectionRuleVersion: 'true-solar-v2-zone-meridian-equation-of-time',
    correctedLocalTime: '1992-08-18T09:24:00+08:00',
    correctionMinutes: -6,
    pillars: ['壬申', '戊申', '丙寅', '癸巳'],
  },
  citations: [],
  evaluatedRules: [],
}

const validReport = `## 人宅合拍结论
本次没有足够已发布规则支撑强结论。

## 判断前提与可信度
住宅朝向来自用户标注。

## 命盘需要
命盘采用程序排盘结果。

## 住宅属性
本次住宅事实来自用户标注和照片分析。

## 合拍之处
本次没有明确合拍点。

## 冲突之处
本次没有明确冲突点。

## 待确认信息
现场尺寸尚待确认。

## 依据与版本
本次没有检索到已审核发布的专家资料，也没有确定性规则命中。
命盘采用真太阳时校正，具体技术版本保存在生成依据中。

${CULTURAL_USE_NOTICE}`

async function artifactFixture(options: { productPatch?: string; profilePatch?: string } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'harness-composition-'))
  const sdkDirectory = join(directory, 'packages', 'bundle', 'sdk-app')
  await mkdir(sdkDirectory, { recursive: true })
  const patchPath = join(directory, 'product.patch.yml')
  const pluginPath = join(directory, 'plugin.js')
  const packagePath = join(directory, 'package.json')
  const skillPath = join(directory, 'SKILL.md')
  const modelConfigPath = join(directory, 'base.patch.yml')
  const profilePatchPath = options.profilePatch === undefined ? undefined : join(directory, 'profile.patch.yml')
  await Promise.all([
    writeFile(patchPath, options.productPatch ?? '# agent-default-model in a comment is not a row\n[]\n'),
    writeFile(pluginPath, 'export default {}\n'),
    writeFile(packagePath, JSON.stringify({ name: 'test-plugin', version: '1.0.0' })),
    writeFile(skillPath, '---\nname: fengshui-report\n---\n'),
    writeFile(modelConfigPath, '- insert:\n    - id: agent-default-model\n      config:\n        provider: deepseek-official\n        model: deepseek-v4-flash\n'),
    writeFile(join(sdkDirectory, 'cordis.patch.yml'), '# no model override\n[]\n'),
    ...(profilePatchPath ? [writeFile(profilePatchPath, options.profilePatch as string)] : []),
  ])
  return {
    harnessDirectory: directory,
    projectDirectory: directory,
    patchPath,
    pluginPath,
    pluginPackagePath: packagePath,
    skillPath,
    modelConfigPath,
    profilePatchPath,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Harness command boundary', () => {
  it('accepts an evidence-bound structured professional reasoning result', async () => {
    const reasoningRecord: ReportRecord = {
      ...record,
      citations: [{
        id: 'source-1',
        version: 1,
        versionId: 'source-1:v1:0123456789abcdef',
        contentHash: 'a'.repeat(64),
        title: '阳宅人宅配合资料',
        sourceLabel: '专家库',
        excerpt: '住宅属性需结合居住者命盘需要判断。',
      }],
    }
    const runner: HarnessCommandRunner = async () => ({
      stdout: JSON.stringify({
        schemaVersion: 'professional-reasoning-v1',
        assessable: true,
        overallLevel: 'supportive',
        confidence: 'medium',
        positiveMatches: [{
          conclusion: '住宅已知属性与命盘需要存在一项明确配合。',
          chartEvidence: '日主与五行分布由程序命盘提供。',
          residenceEvidence: '住宅朝向由用户填写为南向。',
          sourceTitle: '阳宅人宅配合资料',
          sourceVersion: 1,
          sourceLabel: '专家库',
        }],
        conflicts: [],
        unknowns: ['门窗细节尚未确认。'],
        criticalMissingFacts: [],
      }),
    })

    await expect(reasonAboutCompatibilityWithRunner(reasoningRecord, runner, await artifactFixture())).resolves.toMatchObject({
      assessable: true,
      overallLevel: 'supportive',
      positiveMatches: [expect.objectContaining({
        origin: 'professional-agent',
        ruleTitle: '阳宅人宅配合资料',
        sourceLabel: '专家库',
      })],
    })
  })

  it('rejects a professional reasoning conclusion that cites unavailable evidence', async () => {
    const runner: HarnessCommandRunner = async () => ({
      stdout: JSON.stringify({
        schemaVersion: 'professional-reasoning-v1', assessable: true, overallLevel: 'supportive', confidence: 'high',
        positiveMatches: [{ conclusion: '无依据结论', chartEvidence: '命盘', residenceEvidence: '住宅', sourceTitle: '不存在的资料', sourceVersion: 1, sourceLabel: '网络' }],
        conflicts: [], unknowns: [], criticalMissingFacts: [],
      }),
    })
    await expect(reasonAboutCompatibilityWithRunner(record, runner, await artifactFixture())).rejects.toThrow('cites unavailable evidence')
  })

  it('repairs one internally inconsistent professional reasoning JSON result', async () => {
    let calls = 0
    const runner: HarnessCommandRunner = async () => {
      calls += 1
      return {
        stdout: JSON.stringify({
          schemaVersion: 'professional-reasoning-v1',
          assessable: calls === 1,
          overallLevel: 'insufficient-evidence',
          confidence: 'low',
          positiveMatches: [],
          conflicts: [],
          unknowns: ['现有资料不足以形成完整人宅合拍证据链。'],
          criticalMissingFacts: calls === 1 ? [] : ['住宅关键空间事实'],
        }),
      }
    }

    await expect(reasonAboutCompatibilityWithRunner(record, runner, await artifactFixture())).resolves.toMatchObject({
      assessable: false,
      overallLevel: 'insufficient-evidence',
    })
    expect(calls).toBe(2)
  })

  it('accepts bounded AI inference when citations exist without a direct supportive or conflict rule', async () => {
    const reasoningRecord: ReportRecord = {
      ...record,
      citations: [{
        id: 'source-1',
        version: 1,
        versionId: 'source-1:v1:0123456789abcdef',
        contentHash: 'a'.repeat(64),
        title: '阳宅人宅合参资料',
        sourceLabel: '专家库',
        excerpt: '住宅朝向与居住者命盘五行需要合参。',
      }],
    }
    const prompts: string[] = []
    const runner: HarnessCommandRunner = async (prompt) => {
      prompts.push(prompt)
      return {
        stdout: JSON.stringify({
          schemaVersion: 'professional-reasoning-v1',
          assessable: true,
          overallLevel: 'supportive',
          confidence: 'medium',
          positiveMatches: [{
            conclusion: '南向住宅与命盘需要存在一项可讨论的配合。',
            chartEvidence: '程序命盘已生成完整四柱。',
            residenceEvidence: '住宅朝向由用户填写为南向。',
            sourceTitle: prompts.length === 1 ? 'AI传统术数推断' : '阳宅人宅合参资料',
            sourceVersion: 1,
            sourceLabel: prompts.length === 1 ? '模型推断（非专家库）' : '专家库',
          }],
          conflicts: [],
          unknowns: ['室内门窗与房间落宫仍需确认。'],
          criticalMissingFacts: [],
        }),
      }
    }

    await expect(reasonAboutCompatibilityWithRunner(reasoningRecord, runner, await artifactFixture())).resolves.toMatchObject({
      assessable: true,
      positiveMatches: [expect.objectContaining({
        ruleTitle: 'AI传统术数推断',
        sourceLabel: '模型推断（非专家库）',
      })],
    })
    expect(prompts).toHaveLength(1)
  })

  it('sends the report prompt through the SDK run channel, not launch argv/config', async () => {
    const secretPrompt = '完整报告 prompt 只能进入 SDK run，不允许进入 argv'
    const captured = {
      options: undefined as Parameters<DeepSeekHarnessFactory>[0] | undefined,
      runInput: '',
      closeCalls: 0,
    }
    const factory: DeepSeekHarnessFactory = (options) => {
      captured.options = options
      return {
        async run(input) {
          captured.runInput = input
          return { finalResponse: validReport }
        },
        async close() {
          captured.closeCalls += 1
        },
      }
    }

    await expect(runHarnessSdkWithFactory(secretPrompt, {
      cwd: '/project',
      timeout: 30_000,
      maxBuffer: 2_000_000,
      env: { DEEPSEEK_API_KEY: 'test-deepseek-key' },
      profile: 'sdk',
      patchPath: '/project/harness.fengshui.patch.yml',
      harnessDirectory: '/project/deepseek-harness',
      harnessHome: '/project/.data/report-harness-home',
      projectDirectory: '/project',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    }, factory)).resolves.toEqual({ stdout: validReport })

    expect(captured.runInput).toBe(secretPrompt)
    expect(captured.closeCalls).toBe(1)
    expect(JSON.stringify(captured.options)).not.toContain(secretPrompt)
    expect(captured.options).toMatchObject({
      profile: 'sdk',
      patches: ['/project/harness.fengshui.patch.yml'],
      dshHome: '/project/.data/report-harness-home',
      processCwd: '/project/deepseek-harness',
      cwd: '/project',
    })
  })

  it('does not let a stalled Harness close block a completed SDK run', async () => {
    const factory: DeepSeekHarnessFactory = () => ({
      async run() {
        return { finalResponse: validReport }
      },
      async close() {
        await new Promise(() => undefined)
      },
    })

    const completed = await Promise.race([
      runHarnessSdkWithFactory('bounded prompt', {
        cwd: '/project',
        timeout: 1,
        maxBuffer: 2_000_000,
        env: { DEEPSEEK_API_KEY: 'test-deepseek-key' },
        profile: 'sdk',
        patchPath: '/project/harness.fengshui.patch.yml',
        harnessDirectory: '/project/deepseek-harness',
        harnessHome: '/project/.data/report-harness-home',
        projectDirectory: '/project',
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
      }, factory),
      new Promise((_, reject) => setTimeout(() => reject(new Error('test timed out waiting for Harness close deadline')), 250)),
    ])

    expect(completed).toEqual({ stdout: validReport })
  })

  it('passes only approved environment variables and validates stdout', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    vi.stubEnv('UNAPPROVED_TEST_SECRET', 'must-not-cross-boundary')

    let captured: { prompt: string; options: HarnessCommandOptions } | undefined
    const runner: HarnessCommandRunner = async (prompt, options) => {
      captured = { prompt, options }
      return { stdout: `\n${validReport}\n` }
    }

    const generated = await generateReportWithRunner(record, runner)
    expect(generated.report).toBe(validReport)
    expect(generated.generationProvenance).toMatchObject({
      schemaVersion: 'report-generation-provenance-v1',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      baseUrlLabel: 'api.deepseek.com',
      harnessProfile: 'sdk',
      validatorResult: 'pass',
      plugin: { id: '@fengshui-report/dsh-fengshui-report', version: '0.0.1' },
      skill: { name: 'fengshui-report' },
    })
    expect(generated.generationProvenance?.promptSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(generated.generationProvenance?.inputSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(generated.generationProvenance?.reportSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(generated.generationProvenance?.promptSha256).toBe(createHash('sha256').update(String(captured?.prompt)).digest('hex'))
    expect(captured).toBeDefined()
    expect(captured?.options.profile).toBe('sdk')
    expect(captured?.options.patchPath).toEqual(expect.any(String))
    expect(captured?.options.harnessHome).toContain('report-harness-home')
    expect([captured?.options.profile, captured?.options.patchPath, captured?.options.harnessDirectory, captured?.options.harnessHome, captured?.options.projectDirectory].join(' ')).not.toContain(String(captured?.prompt))
    expect(captured?.options.timeout).toBe(480_000)
    expect(captured?.options.maxBuffer).toBe(2_000_000)
    expect(captured?.options.env.DEEPSEEK_API_KEY).toBe('test-deepseek-key')
    expect(captured?.options.env).not.toHaveProperty('FENGSHUI_KNOWLEDGE_API_URL')
    expect(captured?.options.env).not.toHaveProperty('FENGSHUI_KNOWLEDGE_API_TOKEN')
    expect(captured?.options.env.FENGSHUI_STORAGE_DRIVER).toBe('file')
    expect(captured?.options.env).not.toHaveProperty('UNAPPROVED_TEST_SECRET')
    expect(captured?.prompt).toContain('命盘已按程序采用真太阳时校正')
    expect(captured?.prompt).not.toContain('true-solar-v2-zone-meridian-equation-of-time')
    expect(captured?.prompt).toContain('不得重新排盘、重新计算时间修正')
    expect(captured?.prompt).toContain('自由选择最适合该案例的结构、标题和篇幅')
    expect(captured?.prompt).toContain('不需套用固定章节或固定条数')
    expect(captured?.prompt).toContain('具体、可执行、可撤销的建议')
    expect(captured?.prompt).not.toContain('1800–2600')

    const approvedNames = new Set([
      'PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
      'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'FENGSHUI_KNOWLEDGE_API_URL',
      'FENGSHUI_KNOWLEDGE_API_TOKEN', 'FENGSHUI_STORAGE_DRIVER', 'DSH_HOME',
      'DSH_TELEMETRY_DISABLED', 'DSH_TELEMETRY_MODE', 'FENGSHUI_PROJECT_ROOT',
    ])
    expect(Object.keys(captured?.options.env ?? {}).every((name) => approvedNames.has(name))).toBe(true)
  })

  it('lets professional reasoning choose the useful findings before report writing', async () => {
    let prompt = ''
    const runner: HarnessCommandRunner = async (input) => {
      prompt = input
      return {
        stdout: JSON.stringify({
          schemaVersion: 'professional-reasoning-v1',
          assessable: false,
          overallLevel: 'insufficient-evidence',
          confidence: 'low',
          positiveMatches: [],
          conflicts: [],
          unknowns: ['住宅关键空间事实不足。'],
          criticalMissingFacts: ['住宅关键空间事实'],
        }),
      }
    }

    await reasonAboutCompatibilityWithRunner(record, runner, await artifactFixture())

    expect(prompt).toContain('自行判断需要保留多少合拍点、冲突点和未知项')
    expect(prompt).not.toContain('合拍点最多 3 条')
  })

  it('reviews conclusions, natural prose and suggestion safety without enforcing a fixed template', async () => {
    let prompt = ''
    const runner: HarnessCommandRunner = async (input) => {
      prompt = input
      return {
        stdout: JSON.stringify({
          schemaVersion: 'report-quality-review-v1',
          verdict: 'pass',
          score: 90,
          issues: [],
          reviewedAt: '2026-08-30T00:00:00.000Z',
          attempt: 1,
        }),
      }
    }

    await reviewReportWithRunner(record, { report: validReport }, 1, runner, await artifactFixture())

    expect(prompt).toContain('不得因没有固定标题、固定篇幅或固定条数而扣分')
    expect(prompt).toContain('不得伪造、夸大或混淆资料、规则和模型推断的来源')
    expect(prompt).toContain('若堆叠术语、反复同一意思')
    expect(prompt).toContain('如何放大已识别的优点、减少已识别的缺点')
    expect(prompt).toContain('拆墙、改承重结构')
    expect(prompt).toContain('应标 high')
  })

  it('passes the internal knowledge API bridge only when a reader token is configured', async () => {
    vi.stubEnv('KNOWLEDGE_MCP_TOKEN', 'test-reader-token')
    vi.stubEnv('FENGSHUI_KNOWLEDGE_API_URL', 'http://127.0.0.1:3999')

    let captured: HarnessCommandOptions | undefined
    const runner: HarnessCommandRunner = async (_prompt, options) => {
      captured = options
      return { stdout: validReport }
    }

    await generateReportWithRunner(record, runner)

    expect(captured?.env.FENGSHUI_KNOWLEDGE_API_URL).toBe('http://127.0.0.1:3999')
    expect(captured?.env.FENGSHUI_KNOWLEDGE_API_TOKEN).toBe('test-reader-token')
  })

  it('uses the default bounded report generation timeout when no override is configured', () => {
    vi.stubEnv('REPORT_GENERATION_TIMEOUT_MS', '')

    expect(reportGenerationTimeoutMs()).toBe(480_000)
  })

  it('allocates a fresh isolated DSH_HOME for each report generation request', async () => {
    const homes: string[] = []
    const runner: HarnessCommandRunner = async (_prompt, options) => {
      homes.push(options.harnessHome)
      return { stdout: validReport }
    }

    await generateReportWithRunner(record, runner)
    await generateReportWithRunner(record, runner)

    expect(homes).toHaveLength(2)
    expect(homes[0]).toContain('/.data/report-harness-home/runs/report-command-boundary-')
    expect(homes[1]).toContain('/.data/report-harness-home/runs/report-command-boundary-')
    expect(homes[0]).not.toBe(homes[1])
  })

  it('passes a valid report generation timeout override to the Harness runner', async () => {
    vi.stubEnv('REPORT_GENERATION_TIMEOUT_MS', '300000')

    let captured: HarnessCommandOptions | undefined
    const runner: HarnessCommandRunner = async (_prompt, options) => {
      captured = options
      return { stdout: validReport }
    }

    await generateReportWithRunner(record, runner)

    expect(captured?.timeout).toBe(300_000)
  })

  it.each(['abc', '90.5', '-1', '29999', '600001'])(
    'fails closed before the Harness runner for invalid report timeout %s',
    async (timeout) => {
      vi.stubEnv('REPORT_GENERATION_TIMEOUT_MS', timeout)
      const runner = vi.fn<HarnessCommandRunner>()

      await expect(generateReportWithRunner(record, runner)).rejects.toThrow('REPORT_GENERATION_TIMEOUT_MS must be an integer between 30000 and 600000')
      expect(runner).not.toHaveBeenCalled()
    },
  )

  it('keeps the actual v3 time-correction rule version in provenance, not visible prompt text', async () => {
    let prompt = ''
    const runner: HarnessCommandRunner = async (input) => {
      prompt = input
      return {
        stdout: validReport.replace(
          '命盘采用真太阳时校正，具体技术版本保存在生成依据中。',
          '命盘采用真太阳时校正，具体技术版本保存在生成依据中。',
        ),
      }
    }

    await expect(generateReportWithRunner({
      ...record,
      bazi: {
        ...record.bazi,
        timeCorrectionRuleVersion: 'true-solar-v3-standard-time-equation-of-time',
        timeProfile: {
          timezone: 'Asia/Shanghai',
          utcOffsetMinutes: 480,
          standardUtcOffsetMinutes: 480,
          daylightSavingMinutes: 0,
          standardMeridian: 120,
          trueSolarCorrectionMinutes: -2.67,
          timeCorrectionRuleVersion: 'true-solar-v3-standard-time-equation-of-time',
          dayBoundary: 'midnight',
          dstPolicy: 'auto',
          luckMethod: 'sect1',
        },
      },
    }, runner)).resolves.toMatchObject({ report: expect.stringContaining('命盘采用真太阳时校正') })
    expect(prompt).toContain('命盘已按程序采用真太阳时校正')
    expect(prompt).not.toContain('true-solar-v3-standard-time-equation-of-time')
    expect(prompt).not.toContain('true-solar-v2-zone-meridian-equation-of-time')
  })

  it('does not invent a time-correction rule version for legacy charts', async () => {
    let prompt = ''
    const runner: HarnessCommandRunner = async (input) => {
      prompt = input
      return { stdout: validReport }
    }

    const legacyBazi: ReportRecord['bazi'] = {
      ruleVersion: 'bazi-v1',
      correctedLocalTime: '1992-08-18T09:24:00+08:00',
      correctionMinutes: -6,
      pillars: ['壬申', '戊申', '丙寅', '癸巳'],
    }
    await expect(generateReportWithRunner({ ...record, bazi: legacyBazi }, runner)).resolves.toMatchObject({ report: expect.stringContaining('## 人宅合拍结论') })
    expect(prompt).toContain('旧命盘缺少该审计信息')
    expect(prompt).not.toContain('timeCorrectionRuleVersion')
  })

  it('fails closed when stdout does not pass the report validator', async () => {
    const runner: HarnessCommandRunner = async () => ({ stdout: 'unvalidated model output' })

    try {
      await generateReportWithRunner(record, runner)
      throw new Error('expected validation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ReportValidationError)
      expect((error as ReportValidationError).generationProvenance).toMatchObject({ validatorResult: 'fail' })
    }
  })

  it('fails closed when a certain fortune promise remains after one repair attempt', async () => {
    const prompts: string[] = []
    const warnedReport = validReport.replace('现场尺寸尚待确认。', '调整书桌后一定能够转运。')
    const runner: HarnessCommandRunner = async (prompt) => {
      prompts.push(prompt)
      return { stdout: warnedReport }
    }

    await expect(generateReportWithRunner(record, runner)).rejects.toMatchObject({
      name: 'ReportValidationError',
      generationProvenance: expect.objectContaining({
        validatorResult: 'fail',
      }),
    })
    expect(prompts).toHaveLength(2)
  })

  it('retries once with a repair prompt when the first model report contains code or internal output', async () => {
    const prompts: string[] = []
    const runner: HarnessCommandRunner = async (prompt) => {
      prompts.push(prompt)
      return prompts.length === 1
        ? { stdout: `${validReport}\n\`\`\`json\n{"status":"debug"}\n\`\`\`` }
        : { stdout: validReport }
    }

    const generated = await generateReportWithRunner(record, runner)

    expect(generated.report).toBe(validReport)
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('上一版报告未通过服务端发布校验')
    expect(prompts[1]).toContain('contains a code fence')
    expect(prompts[1]).toContain('只输出修正后的最终中文报告')
    expect(generated.generationProvenance?.validatorResult).toBe('pass')
    expect(generated.generationProvenance?.promptSha256).toBe(createHash('sha256').update(prompts[1]!).digest('hex'))
  })

  it('uses canonical input hashing independent of object key insertion order', () => {
    const reordered = JSON.parse(JSON.stringify(record)) as ReportRecord
    reordered.submission = {
      photos: reordered.submission.photos,
      residence: reordered.submission.residence,
      calculationInput: reordered.submission.calculationInput,
      birth: reordered.submission.birth,
      visionConsent: true,
    } as ReportRecord['submission']
    expect(reportGenerationInputSha256(reordered)).toBe(reportGenerationInputSha256(record))
  })

  it('keeps null distinct by rejecting undefined array values and sparse slots', () => {
    const withUndefined = { ...record, citations: [undefined] } as unknown as ReportRecord
    const withNull = { ...record, citations: [null] } as unknown as ReportRecord
    expect(() => reportGenerationInputSha256(withUndefined)).toThrow('outside the canonical JSON domain')
    expect(() => reportGenerationInputSha256(withNull)).not.toThrow()

    const sparse = new Array(2)
    sparse[1] = null
    expect(() => reportGenerationInputSha256({ ...record, citations: sparse } as unknown as ReportRecord)).toThrow('outside the canonical JSON domain')
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite numbers nested in report input: %s',
    (number) => {
      const malformed = {
        ...record,
        submission: { ...record.submission, residence: { ...record.submission.residence, unsafe: { nested: [number] } } },
      } as unknown as ReportRecord
      expect(() => reportGenerationInputSha256(malformed)).toThrow('outside the canonical JSON domain')
    },
  )

  it('rejects cycles and unsupported JSON values without echoing business input', () => {
    const cyclic: Record<string, unknown> = { marker: 'private-business-value' }
    cyclic.self = cyclic
    for (const unsafe of [cyclic, 1n, () => undefined, Symbol('private-business-value')]) {
      const malformed = {
        ...record,
        submission: { ...record.submission, residence: { ...record.submission.residence, unsafe } },
      } as unknown as ReportRecord
      expect(() => reportGenerationInputSha256(malformed)).toThrowError(expect.objectContaining({
        message: 'Report generation input is outside the canonical JSON domain',
      }))
    }
  })

  it('normalizes negative zero to JSON zero while preserving deterministic nested key order', () => {
    const first = { ...record, citations: [{ z: -0, nested: { b: true, a: 'x' } }] } as unknown as ReportRecord
    const second = { ...record, citations: [{ nested: { a: 'x', b: true }, z: 0 }] } as unknown as ReportRecord
    expect(reportGenerationInputSha256(first)).toBe(reportGenerationInputSha256(second))
  })

  it('fails before the runner when the product patch overrides the default model', async () => {
    const paths = await artifactFixture({
      productPatch: '- id: agent-default-model\n  config:\n    provider: other-provider\n    model: other-model\n',
    })
    const runner = vi.fn<HarnessCommandRunner>()
    await expect(generateReportWithRunner(record, runner, paths)).rejects.toThrow('product patch overrides the provenance model selection')
    expect(runner).not.toHaveBeenCalled()
  })

  it('fails before the runner when the profile patch overrides the default model', async () => {
    const paths = await artifactFixture({
      profilePatch: '- id: "agent-default-model" # exact structured row\n  config:\n    provider: profile-provider\n    model: profile-model\n',
    })
    const runner = vi.fn<HarnessCommandRunner>()
    await expect(generateReportWithRunner(record, runner, paths)).rejects.toThrow('profile patch overrides the provenance model selection')
    expect(runner).not.toHaveBeenCalled()
  })

  it('accepts override-like words in comments and records the resolved base selection', async () => {
    const paths = await artifactFixture({
      productPatch: '# - id: agent-default-model\n- id: system-prompt\n  config:\n    persona: "provider: fake model: fake # still scalar text"\n',
      profilePatch: '# agent-default-model provider model\n[]\n',
    })
    const generated = await generateReportWithRunner(record, async () => ({ stdout: validReport }), paths)
    expect(generated.generationProvenance).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })

  it('stores only a sanitized host label for a base URL with credentials and query data', () => {
    expect(safeBaseUrlLabel('https://user:secret@example.test:8443/v1?api_key=private#fragment')).toBe('example.test:8443')
    expect(() => safeBaseUrlLabel('not a url')).toThrow(HarnessExecutionError)
  })

  it('fails closed before invoking the runner when a required artifact is missing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-provenance-'))
    const patchPath = join(directory, 'patch.yml')
    const packagePath = join(directory, 'package.json')
    const skillPath = join(directory, 'SKILL.md')
    const modelConfigPath = join(directory, 'model.patch.yml')
    await Promise.all([
      writeFile(patchPath, '[]\n'),
      writeFile(packagePath, JSON.stringify({ name: 'test-plugin', version: '1.0.0' })),
      writeFile(skillPath, '---\nname: fengshui-report\n---\n'),
      writeFile(modelConfigPath, '- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: deepseek-v4-flash\n'),
    ])
    const runner = vi.fn<HarnessCommandRunner>()
    await expect(generateReportWithRunner(record, runner, {
      harnessDirectory: directory,
      projectDirectory: directory,
      patchPath,
      pluginPath: join(directory, 'missing-plugin.js'),
      pluginPackagePath: packagePath,
      skillPath,
      modelConfigPath,
    })).rejects.toThrow('Required Harness plugin artifact is unavailable')
    expect(runner).not.toHaveBeenCalled()
  })

  it.each([
    ['subprocess failure', Object.assign(new Error('command exited non-zero'), { code: 1, stdout: 'unvalidated partial output' })],
    ['subprocess timeout', Object.assign(new Error('command timed out'), { killed: true, signal: 'SIGTERM', stdout: 'unvalidated partial output' })],
  ])('fails closed on %s without returning partial stdout', async (_name, failure) => {
    const runner: HarnessCommandRunner = async () => {
      throw failure
    }

    try {
      await generateReportWithRunner(record, runner)
      throw new Error('expected Harness command to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessExecutionError)
      expect(error).toMatchObject({
        name: HarnessExecutionError.name,
        message: 'Harness report generation failed',
      })
      expect((error as HarnessExecutionError).generationProvenance).toMatchObject({ validatorResult: 'not-run' })
      expect(error).not.toHaveProperty('cause')
      expect(String(error)).not.toContain(failure.stdout)
    }
  })
})
