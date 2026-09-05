import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReportQualityReview, ReportRecord } from '@fengshui/domain'
import {
  HarnessExecutionError,
  reviseReportWithRunner,
  reviewReportWithRunner,
  type HarnessArtifactPaths,
  type HarnessCommandOptions,
  type HarnessCommandRunner,
} from '../src/harness.js'
import { CULTURAL_USE_NOTICE, ReportValidationError } from '../src/report-validator.js'

const birth = {
  date: '1992-08-18',
  time: '09:30',
  locationName: '杭州',
  longitude: 120.1551,
}

const record: ReportRecord = {
  id: 'report-quality-harness',
  status: 'queued',
  createdAt: '2026-08-30T00:00:00.000Z',
  submission: {
    visionConsent: true,
    calculationInput: birth,
    birth,
    residence: { facing: 'south', layoutNote: '一套南向住宅，客厅连接南向阳台' },
    photos: [{ fileId: 'living-room-1', room: 'living-room', facing: 'south', note: '客厅看向阳台' }],
  },
  bazi: {
    ruleVersion: 'bazi-v1',
    timeCorrectionRuleVersion: 'true-solar-v2-zone-meridian-equation-of-time',
    correctedLocalTime: '1992-08-18T09:24:00+08:00',
    correctionMinutes: -6,
    pillars: ['壬申', '戊申', '丙寅', '癸巳'],
  },
  vision: [{
    fileId: 'living-room-1',
    room: 'living-room',
    summary: '客厅有自然光入口，连接南向阳台',
    observedElements: ['南向阳台', '自然采光'],
    uncertainties: [],
  }],
  citations: [],
  evaluatedRules: [],
}

const passingReview: ReportQualityReview = {
  schemaVersion: 'report-quality-review-v1',
  verdict: 'pass',
  score: 92,
  issues: [],
  reviewedAt: '2026-08-30T00:00:00.000Z',
  attempt: 0,
}

const reviseReview: ReportQualityReview = {
  schemaVersion: 'report-quality-review-v1',
  verdict: 'revise',
  score: 62,
  issues: [{
    code: 'missing-person-house-basis',
    severity: 'high',
    section: '人宅合拍结论',
    message: '合拍判断没有成对说明命盘事实、住宅事实和规则依据。',
  }],
  reviewedAt: '2026-08-30T00:01:00.000Z',
  attempt: 0,
}

const validReport = `## 人宅合拍结论
本次只能形成低可信度的局部合拍判断：命盘与住宅之间已有部分可对照事实，但资料不足以给出强结论。

## 判断前提与可信度
命盘来自程序排盘，住宅朝向和客厅照片来自用户提交；本次没有检索到已审核发布的专家资料。

## 命盘需要
四柱信息用于判断个人侧的传统文化需求，本轮不重新排盘。

## 住宅属性
住宅为南向，客厅照片标注为面向南侧阳台。

## 合拍之处
已知住宅事实与命盘事实可以进入后续规则匹配，但本轮没有确定性规则命中，所以只记录为待进一步核验。

## 冲突之处
本次没有形成明确冲突。

## 可以先做的调整
建议在客厅南侧阳台保留自然光入口，并避免高大家具挡住主要采光面，这样是为了放大南向客厅对命盘火性需求的呼应。入户门、卧室、厨房和卫生间方位可以后续再细看。

## 依据与版本
本次没有检索到已审核发布的专家资料，也没有确定性规则命中。
命盘采用真太阳时校正，具体技术版本保存在生成依据中。

${CULTURAL_USE_NOTICE}`

async function artifactFixture(): Promise<HarnessArtifactPaths> {
  const directory = await mkdtemp(join(tmpdir(), 'harness-quality-'))
  const sdkDirectory = join(directory, 'packages', 'bundle', 'sdk-app')
  await mkdir(sdkDirectory, { recursive: true })
  const patchPath = join(directory, 'product.patch.yml')
  const pluginPath = join(directory, 'plugin.js')
  const packagePath = join(directory, 'package.json')
  const skillPath = join(directory, 'SKILL.md')
  const modelConfigPath = join(directory, 'base.patch.yml')
  await Promise.all([
    writeFile(patchPath, '[]\n'),
    writeFile(pluginPath, 'export default {}\n'),
    writeFile(packagePath, JSON.stringify({ name: 'test-plugin', version: '1.0.0' })),
    writeFile(skillPath, '---\nname: fengshui-report\n---\n'),
    writeFile(modelConfigPath, '- insert:\n    - id: agent-default-model\n      config:\n        provider: deepseek-official\n        model: deepseek-v4-flash\n'),
    writeFile(join(sdkDirectory, 'cordis.patch.yml'), '[]\n'),
  ])
  return {
    harnessDirectory: directory,
    projectDirectory: directory,
    patchPath,
    pluginPath,
    pluginPackagePath: packagePath,
    skillPath,
    modelConfigPath,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Harness report quality agents', () => {
  it('reviews a report through the Harness SDK runner and accepts strict JSON', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    const artifactPaths = await artifactFixture()
    let captured: { prompt: string; options: HarnessCommandOptions } | undefined
    const runner: HarnessCommandRunner = async (prompt, options) => {
      captured = { prompt, options }
      return { stdout: JSON.stringify(passingReview) }
    }

    await expect(reviewReportWithRunner(record, { report: validReport }, 0, runner, artifactPaths)).resolves.toEqual(passingReview)

    expect(captured?.prompt).toContain('独立质量审核 Agent')
    expect(captured?.prompt).toContain('命盘与住宅是否合拍')
    expect(captured?.prompt).toContain('关键合拍或冲突判断应能对应到命盘事实和住宅事实')
    expect(captured?.prompt).toContain('不要要求正文出现 AI、模型推断、非专家库等内部生产说明')
    expect(captured?.options.profile).toBe('sdk')
    expect(captured?.options.env.DEEPSEEK_API_KEY).toBe('test-deepseek-key')
  })

  it('overrides a reviewer pass when server semantic validation finds the conclusion or action incomplete', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    const artifactPaths = await artifactFixture()
    const compatibleRecord: ReportRecord = {
      ...record,
      compatibility: {
        assessable: true,
        overallLevel: 'supportive',
        confidence: 'medium',
        positiveMatches: [{
          conclusion: '南向住宅与丙火日主存在采光和火性呼应。',
          chartEvidence: '日主为丙火，四柱完整。',
          residenceEvidence: '住宅朝南。',
          ruleTitle: '南向采光规则',
          ruleVersion: 1,
          ruleVersionId: 'rule-1:v1:fedcba9876543210',
          sourceLabel: '确定性规则',
          origin: 'deterministic-rule',
          level: 'info',
        }],
        conflicts: [],
        neutralOrUnknown: [],
        criticalMissingFacts: [],
      },
    }
    const runner: HarnessCommandRunner = async () => ({ stdout: JSON.stringify(passingReview) })
    const incompleteDraft = { report: `命盘和住宅资料已经整理完成，但这里暂不下结论。\n\n${CULTURAL_USE_NOTICE}` }

    await expect(reviewReportWithRunner(compatibleRecord, incompleteDraft, 0, runner, artifactPaths)).resolves.toMatchObject({
      verdict: 'revise',
      score: 69,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'server-semantic-validation', severity: 'high' }),
      ]),
    })
  })

  it.each([
    ['code fence', `\`\`\`json\n${JSON.stringify(passingReview)}\n\`\`\``],
    ['surrounding text', `审核结果：${JSON.stringify(passingReview)}`],
    ['illegal field', JSON.stringify({ ...passingReview, debug: true })],
    ['illegal issue field', JSON.stringify({ ...reviseReview, issues: [{ ...reviseReview.issues[0], rawEvidence: 'x' }] })],
    ['attempt mismatch', JSON.stringify({ ...passingReview, attempt: 1 })],
  ])('rejects non-strict review output containing %s', async (_name, stdout) => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    const artifactPaths = await artifactFixture()
    const runner: HarnessCommandRunner = async () => ({ stdout })

    await expect(reviewReportWithRunner(record, { report: validReport }, 0, runner, artifactPaths)).rejects.toBeInstanceOf(HarnessExecutionError)
  })

  it('fails closed when the Harness reviewer fails', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    const artifactPaths = await artifactFixture()
    const runner: HarnessCommandRunner = async () => {
      throw new Error('model unavailable')
    }

    await expect(reviewReportWithRunner(record, { report: validReport }, 0, runner, artifactPaths))
      .rejects.toThrow('Harness report quality review failed')
  })

  it('revises through Harness and validates the revised report before returning it', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    const artifactPaths = await artifactFixture()
    let capturedPrompt = ''
    const runner: HarnessCommandRunner = async (prompt) => {
      capturedPrompt = prompt
      return { stdout: validReport }
    }

    const draft = await reviseReportWithRunner(record, { report: '旧报告没有回答合拍问题。' }, reviseReview, 1, runner, artifactPaths)

    expect(draft.report).toBe(validReport)
    expect(draft.generationProvenance).toMatchObject({ validatorResult: 'pass' })
    expect(draft.generationProvenance?.reportSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(capturedPrompt).toContain('报告修订 Agent')
    expect(capturedPrompt).toContain('围绕“用户命盘与该住宅风水是否合拍”重写')
    expect(capturedPrompt).toContain(JSON.stringify(reviseReview))
  })

  it('restores verified compatibility evidence when a revision drops the structured points', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    const artifactPaths = await artifactFixture()
    const compatibleRecord: ReportRecord = {
      ...record,
      compatibility: {
        assessable: true,
        overallLevel: 'supportive',
        confidence: 'medium',
        positiveMatches: [{
          conclusion: '南向住宅与命盘的火性需求形成局部呼应。',
          chartEvidence: '命盘需要 fire 和 wood。',
          residenceEvidence: '住宅朝南。',
          ruleTitle: 'AI传统术数推断',
          ruleVersion: 1,
          ruleVersionId: 'ai-traditional-inference:v1:test',
          sourceLabel: '模型推断（非专家库）',
          origin: 'professional-agent',
          level: 'info',
        }],
        conflicts: [],
        neutralOrUnknown: [],
        criticalMissingFacts: [],
      },
    }
    const runner: HarnessCommandRunner = async () => ({
      stdout: validReport.replace(
        '本次只能形成低可信度的局部合拍判断：命盘与住宅之间已有部分可对照事实，但资料不足以给出强结论。',
        '总体判断：整体合拍。命盘与住宅之间已有可以相互印证的事实。',
      ),
    })

    const draft = await reviseReportWithRunner(compatibleRecord, { report: '旧报告' }, reviseReview, 1, runner, artifactPaths)

    expect(draft.report).toContain('南向住宅与命盘的火性需求形成局部呼应。')
    expect(draft.report).toContain('命盘依据：命盘需要 火 和 木。')
    expect(draft.report).not.toContain('模型推断（非专家库）')
    expect(draft.report).not.toContain('来源依据：')
  })

  it('rejects a revised report that fails the server validator', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    const artifactPaths = await artifactFixture()
    const runner: HarnessCommandRunner = async () => ({ stdout: `${validReport}\n\`\`\`ts\nconst leak = true\n\`\`\`` })

    await expect(reviseReportWithRunner(record, { report: '旧报告' }, reviseReview, 1, runner, artifactPaths))
      .rejects.toBeInstanceOf(ReportValidationError)
  })
})
