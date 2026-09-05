import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ReportRecord } from '@fengshui/domain'
import {
  buildProfessionalReasoningPrompt,
  HarnessExecutionError,
  reasonAboutCompatibilityWithRunner,
  type HarnessArtifactPaths,
  type HarnessCommandRunner,
} from '../src/harness.js'

const birth: NonNullable<ReportRecord['submission']['birth']> = {
  date: '1992-08-18',
  time: '09:30',
  locationName: '浙江省 杭州市 西湖区',
  longitude: 120.13333,
  latitude: 30.26667,
  placeCode: '330106',
  timezone: 'Asia/Shanghai',
  useTrueSolarTime: true,
  gender: 'male',
}

const expertCitation = {
  id: '玄空阳宅-客厅明堂',
  version: 2,
  versionId: '玄空阳宅-客厅明堂:v2:0123456789abcdef',
  contentHash: 'a'.repeat(64),
  title: '玄空阳宅客厅明堂判断',
  sourceLabel: '专家库',
  excerpt: '住宅客厅与明堂宜开阔明净，判断时需结合居住者命盘扶抑方向与住宅动静、门窗位置合参。',
}

const record: ReportRecord = {
  id: 'professional-reasoning-eval',
  status: 'queued',
  createdAt: '2026-09-03T00:00:00.000Z',
  submission: {
    visionConsent: true,
    calculationInput: birth,
    birth,
    ruleProfileVersionId: 'demo-school:v1:0123456789abcdef',
    residence: {
      facing: 'south',
      layoutNote: '上北下南，入户门在东南侧，客厅在东侧，厨房在南侧，卫生间靠近中心偏西南。',
    },
    photos: [
      { fileId: 'floor-plan-1', room: 'overview', facing: 'north', note: '整户户型图，上北下南。' },
      { fileId: 'living-room-1', room: 'living-room', facing: 'south', note: '客厅看向南侧采光面。' },
    ],
  },
  bazi: {
    ruleVersion: 'bazi-v1',
    timeCorrectionRuleVersion: 'true-solar-v2-zone-meridian-equation-of-time',
    correctedLocalTime: '1992-08-18T09:24:00+08:00',
    correctionMinutes: -6,
    pillars: ['壬申', '戊申', '丙寅', '癸巳'],
    assessments: {
      strength: {
        status: 'derived',
        ruleVersion: 'strength-baseline-v1',
        conclusion: '日主强弱为中和偏弱，需结合月令和透干继续校验。',
        provenance: {
          profileVersionId: 'profile-v1',
          profileContentHash: 'b'.repeat(64),
          assessment: 'strength',
          method: 'decision-table-v1',
          ruleSetVersion: 'strength-baseline-v1',
          matchedRuleIds: ['strength-rule-1'],
          sourceVersionIds: ['book-source-1'],
          factsHash: 'c'.repeat(64),
        },
      },
      pattern: {
        status: 'derived',
        ruleVersion: 'pattern-baseline-v1',
        conclusion: '格局暂按月令财星透出作保守参考。',
        provenance: {
          profileVersionId: 'profile-v1',
          profileContentHash: 'b'.repeat(64),
          assessment: 'pattern',
          method: 'decision-table-v1',
          ruleSetVersion: 'pattern-baseline-v1',
          matchedRuleIds: ['pattern-rule-1'],
          sourceVersionIds: ['book-source-2'],
          factsHash: 'c'.repeat(64),
        },
      },
      elementPreference: {
        status: 'derived',
        ruleVersion: 'support-balance-baseline-v1',
        conclusion: '扶抑基线偏向生助日主的五行，但不是完整喜用神结论。',
        elementDirection: {
          scope: 'support-balance-baseline',
          direction: 'add-support',
          candidateElements: ['wood', 'fire'],
          cautiousElements: ['metal', 'water'],
          limitations: ['仅为五行扶抑候选方向', '未完成调候、格局、通关和病药综合判断'],
        },
        provenance: {
          profileVersionId: 'profile-v1',
          profileContentHash: 'b'.repeat(64),
          assessment: 'elementPreference',
          method: 'decision-table-v1',
          ruleSetVersion: 'support-balance-baseline-v1',
          matchedRuleIds: ['element-rule-1'],
          sourceVersionIds: ['book-source-3'],
          factsHash: 'c'.repeat(64),
        },
      },
      shenSha: {
        status: 'derived',
        ruleVersion: 'shensha-baseline-v1',
        items: ['天乙贵人', '驿马'],
        provenance: {
          profileVersionId: 'profile-v1',
          profileContentHash: 'b'.repeat(64),
          assessment: 'shenSha',
          method: 'decision-table-v1',
          ruleSetVersion: 'shensha-baseline-v1',
          matchedRuleIds: ['shensha-rule-1'],
          sourceVersionIds: ['book-source-4'],
          factsHash: 'c'.repeat(64),
        },
      },
    },
  },
  vision: [
    {
      fileId: 'floor-plan-1',
      room: 'overview',
      summary: '户型图显示客厅在东侧，厨房在南侧，卫生间靠近中心偏西南。',
      observedElements: ['东侧客厅', '南侧厨房', '近中宫卫生间'],
      uncertainties: [],
    },
  ],
  citations: [expertCitation],
  evaluatedRules: [{
    assetId: 'rule-east-living-room',
    version: 3,
    versionId: 'rule-east-living-room:v3:internal-only',
    contentHash: 'd'.repeat(64),
    title: '东侧客厅明堂规则',
    priority: 90,
    conclusions: [{
      code: 'east-living-room-support',
      text: '东侧客厅的明堂条件可与命盘扶抑候选方向合参。',
      level: 'info',
      effect: 'supportive',
    }],
    sourceVersionIds: ['book-source:v4:internal-only'],
    sourceLabels: ['《玄空阳宅》客厅章'],
    sourceExcerpts: ['客厅明堂以开阔明净为判断条件，并须结合居住者命盘合参。'],
  }],
}

async function artifactFixture(): Promise<HarnessArtifactPaths> {
  const directory = await mkdtemp(join(tmpdir(), 'professional-reasoning-eval-'))
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
    writeFile(skillPath, '---\nname: fengshui-reasoning\n---\n'),
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

describe('professional reasoning eval contract', () => {
  it('keeps element preference as support-balance candidates instead of a definitive useful-god verdict', () => {
    const prompt = buildProfessionalReasoningPrompt(record)

    expect(prompt).toContain('扶抑方向（基线）：可用')
    expect(prompt).toContain('候选五行：wood、fire')
    expect(prompt).toContain('基线需谨慎五行：metal、water')
    expect(prompt).toContain('仅为五行扶抑候选方向')
    expect(prompt).toContain('未完成调候、格局、通关和病药综合判断')
    expect(prompt).toContain('扶抑候选不得改写为确定喜神、忌神或用神')
  })

  it('shows expert rule sources and bounded excerpts without exposing internal source identifiers', () => {
    const prompt = buildProfessionalReasoningPrompt({
      ...record,
      evaluatedRules: [{
        ...record.evaluatedRules![0]!,
        sourceLabels: ['《玄空阳宅》客厅章', '专家复核稿', '流派注释', '不得进入提示词的第四来源'],
        sourceExcerpts: [`${'明'.repeat(181)}末尾不可见`, '第二条依据', '第三条依据', '第四条依据不可见'],
      }],
    })

    expect(prompt).toContain('专家来源：《玄空阳宅》客厅章、专家复核稿、流派注释')
    expect(prompt).not.toContain('不得进入提示词的第四来源')
    expect(prompt).toMatch(/来源摘录：明{180}…；第二条依据；第三条依据/u)
    expect(prompt).not.toContain('末尾不可见')
    expect(prompt).not.toContain('第四条依据不可见')
    expect(prompt).not.toContain('rule-east-living-room:v3:internal-only')
    expect(prompt).not.toContain('book-source:v4:internal-only')
    expect(prompt).not.toContain('dddddddddddddddd')
  })

  it('accepts complete person-house reasoning only when at least one compatibility point uses published expert evidence', async () => {
    const runner: HarnessCommandRunner = async () => ({
      stdout: JSON.stringify({
        schemaVersion: 'professional-reasoning-v1',
        assessable: true,
        overallLevel: 'supportive',
        confidence: 'medium',
        positiveMatches: [{
          conclusion: '东侧客厅与明堂开阔的住宅事实，可作为命盘扶抑候选五行进入人宅合参。',
          chartEvidence: '程序命盘给出扶抑候选五行为 wood、fire，且明确不是完整喜用神结论。',
          residenceEvidence: '户型图显示客厅在东侧，用户照片标注为整户户型图。',
          sourceTitle: expertCitation.title,
          sourceVersion: expertCitation.version,
          sourceLabel: expertCitation.sourceLabel,
        }],
        conflicts: [],
        unknowns: ['卧室床位和门窗精确落宫仍需现场补充。'],
        criticalMissingFacts: [],
      }),
    })

    await expect(reasonAboutCompatibilityWithRunner(record, runner, await artifactFixture())).resolves.toMatchObject({
      assessable: true,
      overallLevel: 'supportive',
      positiveMatches: [expect.objectContaining({
        ruleTitle: expertCitation.title,
        ruleVersionId: expertCitation.versionId,
        chartEvidence: expect.stringContaining('不是完整喜用神结论'),
        residenceEvidence: expect.stringContaining('客厅在东侧'),
      })],
    })
  })

  it('rejects complete person-house reasoning that turns support-balance candidates into definitive useful gods', async () => {
    const runner: HarnessCommandRunner = async () => ({
      stdout: JSON.stringify({
        schemaVersion: 'professional-reasoning-v1',
        assessable: true,
        overallLevel: 'supportive',
        confidence: 'medium',
        positiveMatches: [{
          conclusion: '此命局确定喜火木为用神，所以南向厨房一定加分。',
          chartEvidence: '扶抑候选五行为 wood、fire，因此可直接定为喜神和用神。',
          residenceEvidence: '住宅厨房在南侧。',
          sourceTitle: expertCitation.title,
          sourceVersion: expertCitation.version,
          sourceLabel: expertCitation.sourceLabel,
        }],
        conflicts: [],
        unknowns: [],
        criticalMissingFacts: [],
      }),
    })

    await expect(reasonAboutCompatibilityWithRunner(record, runner, await artifactFixture()))
      .rejects.toThrow(HarnessExecutionError)
  })

  it('accepts a bounded AI traditional inference when governed inputs exist without a direct compatibility rule', async () => {
    const neutralRecord = {
      ...record,
      evaluatedRules: record.evaluatedRules?.map((rule) => ({
        ...rule,
        conclusions: rule.conclusions.map((conclusion) => ({ ...conclusion, effect: 'neutral' as const })),
      })),
    }
    const runner: HarnessCommandRunner = async () => ({
      stdout: JSON.stringify({
        schemaVersion: 'professional-reasoning-v1',
        assessable: true,
        overallLevel: 'supportive',
        confidence: 'low',
        positiveMatches: [{
          conclusion: '南侧厨房与命盘扶抑候选中的火形成有限度的传统相应，但不能据此确定喜用神。',
          chartEvidence: '程序命盘仅给出 fire 为扶抑候选五行之一，不是确定喜神或用神。',
          residenceEvidence: '住宅事实与视觉结果均显示厨房位于南侧。',
          sourceTitle: 'AI传统术数推断',
          sourceVersion: 1,
          sourceLabel: '模型推断（非专家库）',
        }],
        conflicts: [],
        unknowns: ['完整喜用神与厨房精确落宫仍未确定。'],
        criticalMissingFacts: [],
      }),
    })

    await expect(reasonAboutCompatibilityWithRunner(neutralRecord, runner, await artifactFixture())).resolves.toMatchObject({
      assessable: true,
      overallLevel: 'supportive',
      confidence: 'low',
      positiveMatches: [expect.objectContaining({
        ruleTitle: 'AI传统术数推断',
        sourceLabel: '模型推断（非专家库）',
      })],
    })
  })

  it('rejects empty unassessable reasoning when complete chart, residence facts, vision facts, and citations are present', async () => {
    const runner: HarnessCommandRunner = async () => ({
      stdout: JSON.stringify({
        schemaVersion: 'professional-reasoning-v1',
        assessable: false,
        overallLevel: 'insufficient-evidence',
        confidence: 'low',
        positiveMatches: [],
        conflicts: [],
        unknowns: ['信息不足。'],
        criticalMissingFacts: ['无法判断。'],
      }),
    })

    await expect(reasonAboutCompatibilityWithRunner(record, runner, await artifactFixture()))
      .rejects.toThrow(HarnessExecutionError)
  })
})
