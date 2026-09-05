import { describe, expect, it, vi } from 'vitest'
import type { ReportRecord } from '@fengshui/domain'
import { generateReportWithRunner, type HarnessCommandRunner } from '../src/harness.js'
import { CULTURAL_USE_NOTICE, ReportValidationError } from '../src/report-validator.js'

const birth = {
  date: '1992-08-18',
  time: '09:30',
  locationName: '杭州',
  longitude: 120.1551,
}

const baseRecord: ReportRecord = {
  id: 'report-harness-eval',
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

function compliantReport(extraBasis = '本次没有检索到已审核发布的专家资料，也没有确定性规则命中。'): string {
  return `## 人宅合拍结论
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
${extraBasis}
命盘采用真太阳时校正，具体技术版本保存在生成依据中。

${CULTURAL_USE_NOTICE}`
}

describe('Harness behavior eval', () => {
  it('delivers a report with a warning when it claims the birth hour is missing despite complete birth input', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    const runner: HarnessCommandRunner = async () => ({
      stdout: compliantReport('本次命盘缺少出生时辰，无法判断日主和住宅是否合拍。'),
    })

    await expect(generateReportWithRunner(baseRecord, runner)).resolves.toMatchObject({
      generationProvenance: {
        validatorResult: 'pass',
        validationWarnings: expect.arrayContaining(['claims birth hour is missing despite a complete four-pillar chart']),
      },
    })
  })

  it('passes when an assessable person-house report gives a direct layered conclusion without code or JSON', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    const record: ReportRecord = {
      ...baseRecord,
      compatibility: {
        assessable: true,
        overallLevel: 'supportive',
        confidence: 'medium',
        positiveMatches: [{
          conclusion: '南向住宅与丙火日主存在采光和火性呼应。',
          chartEvidence: '日主为丙火，程序已生成完整四柱。',
          residenceEvidence: '住宅朝南，照片标注镜头朝南。',
          ruleTitle: '南向采光规则',
          ruleVersion: 1,
          ruleVersionId: 'rule-1:v1:fedcba9876543210',
          sourceLabel: '确定性规则',
          origin: 'professional-agent',
          level: 'info',
        }],
        conflicts: [],
        neutralOrUnknown: ['厨房、卫生间和卧室相对中宫的位置仍需户型标注确认。'],
        criticalMissingFacts: [],
      },
      evaluatedRules: [{
        assetId: 'rule-1',
        version: 1,
        versionId: 'rule-1:v1:fedcba9876543210',
        contentHash: 'f'.repeat(64),
        title: '南向采光规则',
        priority: 80,
        conclusions: [{ code: 'south-light', text: '南向住宅与火性命盘形成呼应条件。', level: 'info' }],
      }],
    }
    const report = `## 人宅合拍结论
总体判断：中等偏合。
最主要原因：命盘日主为丙火，程序已生成完整四柱；住宅朝南，照片标注镜头也朝南，所以传统分析里形成采光和火性呼应。
需要注意：厨房、卫生间和卧室相对中宫的位置仍需户型标注确认。

## 判断前提与可信度
可信度为中等，依据来自程序命盘、用户住宅标注和确定性规则。

## 命盘需要
命盘采用程序排盘结果，日主为丙火，已包含出生时辰。

## 住宅属性
住宅事实为朝南，照片标注镜头朝南。

## 合拍之处
南向住宅与丙火日主存在采光和火性呼应。命盘依据：日主为丙火，程序已生成完整四柱。住宅依据：住宅朝南，照片标注镜头朝南。来源依据：南向采光规则，v1，确定性规则。

## 冲突之处
本次没有形成明确冲突点。

## 可以先做的调整
建议在客厅南侧采光面保留窗边通透，先避免高大家具挡住主要光线，这样是为了放大南向采光对丙火日主的呼应。厨房、卫生间和卧室相对中宫的位置可等户型标注更清楚后再细看。

## 依据与版本
南向采光规则，v1，南向住宅与火性命盘形成呼应条件。

${CULTURAL_USE_NOTICE}`
    const runner: HarnessCommandRunner = async () => ({ stdout: report })

    const result = await generateReportWithRunner(record, runner)
    expect(result.generationProvenance).toMatchObject({ validatorResult: 'pass' })
    expect(result.report).toContain('总体判断：中等偏合')
    expect(result.report).toContain('南向住宅与丙火日主存在采光和火性呼应')
    expect(result.report).toContain('建议在客厅南侧采光面保留窗边通透')
  })

  it('adds governed compatibility actions before delivery when the model omits useful suggestions', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    const record: ReportRecord = {
      ...baseRecord,
      compatibility: {
        assessable: true,
        overallLevel: 'supportive',
        confidence: 'medium',
        positiveMatches: [{
          conclusion: '南向住宅与丙火日主存在采光和火性呼应。',
          chartEvidence: '日主为丙火，程序已生成完整四柱。',
          residenceEvidence: '住宅朝南，照片标注镜头朝南。',
          ruleTitle: '南向采光规则',
          ruleVersion: 1,
          ruleVersionId: 'rule-1:v1:fedcba9876543210',
          sourceLabel: '确定性规则',
          origin: 'deterministic-rule',
          level: 'info',
          actions: [{
            kind: 'amplify',
            location: '客厅南侧采光面',
            action: '保留窗边通透，避免高大家具挡住主要光线。',
            intendedEffect: '放大南向采光对丙火日主的呼应。',
            verification: '白天观察客厅主活动区是否明亮。',
            safety: 'reversible-low-risk',
          }],
        }],
        conflicts: [],
        neutralOrUnknown: [],
        criticalMissingFacts: [],
      },
    }
    const modelReportWithoutAction = `这套住宅与这个命盘整体偏合拍，最大加分项是南向采光和丙火日主能够形成呼应，目前没有看到直接拉低匹配度的核心冲突。

南向住宅与丙火日主存在采光和火性呼应。命盘依据：日主为丙火，程序已生成完整四柱。住宅依据：住宅朝南，照片标注镜头朝南。

${CULTURAL_USE_NOTICE}`
    const runner: HarnessCommandRunner = async () => ({ stdout: modelReportWithoutAction })

    const result = await generateReportWithRunner(record, runner)

    expect(result.generationProvenance).toMatchObject({ validatorResult: 'pass' })
    expect(result.report).toContain('## 可以先这样做')
    expect(result.report).toContain('在客厅南侧采光面，保留窗边通透，避免高大家具挡住主要光线。 这样做是为了放大南向采光对丙火日主的呼应。')
  })

  it('rewrites internal analysis terms into consumer language before delivery', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    const record: ReportRecord = {
      ...baseRecord,
      compatibility: {
        assessable: true,
        overallLevel: 'mixed',
        confidence: 'medium',
        positiveMatches: [{
          conclusion: '南向客厅与命盘里的火木需要形成局部呼应。',
          chartEvidence: '日主为丙火，四柱完整。',
          residenceEvidence: '客厅在东南侧并有南向采光。',
          ruleTitle: '客厅采光呼应规则',
          ruleVersion: 1,
          ruleVersionId: 'rule-light:v1:fedcba9876543210',
          sourceLabel: '确定性规则',
          origin: 'deterministic-rule',
          level: 'info',
          actions: [{
            kind: 'amplify',
            location: '东南侧客厅',
            action: '保留窗边通透，避免高大家具挡住采光。',
            intendedEffect: '放大客厅采光与命盘火木需要的呼应。',
            verification: '白天观察客厅主活动区是否明亮。',
            safety: 'reversible-low-risk',
          }],
        }],
        conflicts: [{
          conclusion: '近中宫卫生间与居住稳定感存在冲突。',
          chartEvidence: '命盘需要更稳定的居住承托。',
          residenceEvidence: '卫生间靠近户型中心区域。',
          ruleTitle: '中宫卫生间规则',
          ruleVersion: 1,
          ruleVersionId: 'rule-bath:v1:abcdef0123456789',
          sourceLabel: '确定性规则',
          origin: 'deterministic-rule',
          level: 'attention',
          actions: [{
            kind: 'mitigate',
            location: '靠近中宫的卫生间',
            action: '保持门常关、地面干爽、排风顺畅。',
            intendedEffect: '减少湿气和杂乱对住宅中心区域的影响。',
            verification: '检查卫生间通风、异味和潮湿情况。',
            safety: 'reversible-low-risk',
          }],
        }],
        neutralOrUnknown: [],
        criticalMissingFacts: [],
      },
    }
    const reportWithInternalTerms = `结论先说：这套房子和你的命盘属于局部合拍，同时存在冲突，不是完全不合，但需要优先处理卫生间靠近中心的问题。

南向客厅与命盘里的火木需要形成局部呼应。命盘依据：日主为丙火，四柱完整。住宅依据：客厅在东南侧并有南向采光。从扶抑基线看，你的候选补益方向更偏火木；客厅采光和这个补益方向有呼应，是这套房子的优点。近中宫卫生间与居住稳定感存在冲突，这是主要扣分项。

参考已发布的中州派玄空以内六事格局配合朝向的思路，朝南格局对您而言是顺的。

## 可以先这样做
1. 在东南侧客厅，保留窗边通透，避免高大家具挡住采光。这样做是为了放大客厅采光与命盘火木需要的呼应，也是在放大南向客厅与命盘里的火木需要形成局部呼应这处优点。
2. 在靠近中宫的卫生间，保持门常关、地面干爽、排风顺畅。这样做是为了减少湿气和杂乱对住宅中心区域的影响。

整套判断没有让你拆墙、改结构或搬家，先做低风险调整即可。

${CULTURAL_USE_NOTICE}`
    const runner: HarnessCommandRunner = async () => ({ stdout: reportWithInternalTerms })

    const result = await generateReportWithRunner(record, runner)

    expect(result.generationProvenance).toMatchObject({ validatorResult: 'pass' })
    expect(result.report).toContain('排盘里的五行轻重')
    expect(result.report).toContain('有利方向')
    expect(result.report).not.toMatch(/扶抑基线|候选补益方向|候选方向|补益方向/u)
    expect(result.report).toContain('以上建议都只涉及低成本、可撤销的日常布置调整')
    expect(result.report).not.toMatch(/拆墙|改结构|搬家/u)
    expect(result.report).toContain('按已知命盘、户型事实和本次人宅合参判断')
    expect(result.report).not.toMatch(/参考已发布的中州派/u)
  })

  it('does not append a duplicate adjustment checklist when natural prose already covers amplify and mitigate actions', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    const record: ReportRecord = {
      ...baseRecord,
      compatibility: {
        assessable: true,
        overallLevel: 'mixed',
        confidence: 'medium',
        positiveMatches: [{
          conclusion: '住宅的南向或南侧厨房，与命盘扶抑基线里可参考的火性方向形成局部呼应。',
          chartEvidence: '日主为丙火，四柱完整。',
          residenceEvidence: '住宅整体朝南，厨房在南侧。',
          ruleTitle: '南向采光规则',
          ruleVersion: 1,
          ruleVersionId: 'rule-1:v1:fedcba9876543210',
          sourceLabel: '确定性规则',
          origin: 'deterministic-rule',
          level: 'info',
          actions: [{
            kind: 'amplify',
            location: '朝南格局与南侧厨房',
            action: '保留南侧厨房的明亮、干净和通风，不用杂物压住厨房台面或南侧动线。',
            intendedEffect: '放大朝南与南侧厨房形成的火性呼应，同时避免火性空间变得燥乱。',
            verification: '复看户型图和照片，确认南侧窗面或厨房周围没有明显遮挡。',
            safety: 'reversible-low-risk',
          }],
        }],
        conflicts: [{
          conclusion: '卫生间靠近住宅中心，会削弱整屋中部的稳定感；与需要稳定承载的个人居住场不够合拍。',
          chartEvidence: '命盘这一侧更需要稳定感。',
          residenceEvidence: '卫生间靠近户型中心区域。',
          ruleTitle: '中宫卫生间规则',
          ruleVersion: 1,
          ruleVersionId: 'rule-2:v1:abcdef0123456789',
          sourceLabel: '确定性规则',
          origin: 'deterministic-rule',
          level: 'attention',
          actions: [{
            kind: 'mitigate',
            location: '靠近中宫的卫生间',
            action: '保持门常关、地面干爽、排风顺畅，门口和过道不要堆放杂物。',
            intendedEffect: '减少湿气和杂乱对住宅中心区域的影响。',
            verification: '检查卫生间通风、异味、潮湿和门外动线是否长期干净顺畅。',
            safety: 'reversible-low-risk',
          }],
        }],
        neutralOrUnknown: [],
        criticalMissingFacts: [],
      },
    }
    const naturalReport = `先说结论：这套朝南住宅和你的命盘整体属于局部合拍，南侧厨房是主要加分项，靠近中心的卫生间是主要扣分项。

南侧是加分项。住宅的南向或南侧厨房，与命盘里可参考的火性需要形成局部呼应。日主为丙火，四柱完整；住宅整体朝南，厨房在南侧。放大这处优点的方法很简单：在朝南格局与南侧厨房，保留南侧厨房的明亮、干净和通风，不用杂物压住厨房台面或南侧动线，这样是为了放大朝南与南侧厨房形成的火性呼应，同时避免火性空间变得燥乱。

卫生间靠近住宅中心，会削弱整屋中部的稳定感；与需要稳定承载的个人居住场不够合拍。命盘这一侧更需要稳定感，卫生间又靠近户型中心区域，所以这一处要认真处理。缓解办法是：在靠近中宫的卫生间，保持门常关、地面干爽、排风顺畅，门口和过道不要堆放杂物，这样是为了减少湿气和杂乱对住宅中心区域的影响。

仅供传统文化与娱乐参考，不构成医疗、法律、财务或重大人生决定建议。`
    const runner: HarnessCommandRunner = async () => ({ stdout: naturalReport })

    const result = await generateReportWithRunner(record, runner)

    expect(result.generationProvenance).toMatchObject({ validatorResult: 'pass' })
    expect(result.report).toContain('先说结论')
    expect(result.report).not.toContain('## 可以先这样做')
  })

  it('repairs an open-format report that omits the core structured conflict point', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    const record: ReportRecord = {
      ...baseRecord,
      bazi: {
        ...baseRecord.bazi,
        dayMaster: { stem: '戊', element: 'earth', yinYang: 'yang' },
        fiveElements: {
          method: 'visible-stems-and-branches-v1',
          counts: { wood: 1, fire: 2, earth: 2, metal: 2, water: 1 },
        },
      },
      submission: {
        ...baseRecord.submission,
        residence: {
          facing: 'south',
          layoutNote: '上北下南，入户门在东南侧，客厅在东侧，厨房在南侧，卫生间靠近户型中心偏西南。',
        },
        photos: [{ fileId: 'case-plan-8029', room: 'overview', facing: 'south', note: '单套住宅户型图，上北下南' }],
      },
      vision: [{
        fileId: 'case-plan-8029',
        room: 'overview',
        summary: '户型图显示南向厨房、东侧客厅和近中宫卫生间。',
        observedElements: ['南向厨房', '东侧客厅', '近中宫卫生间'],
        uncertainties: ['卧室床头方向未提供'],
      }],
      citations: [{
        id: 'expert-xuankong-zhonggong',
        version: 1,
        versionId: 'expert-xuankong-zhonggong:v1:0123456789abcdef',
        contentHash: '1'.repeat(64),
        title: '玄空阳宅中宫资料',
        sourceLabel: '专家审核库',
        excerpt: '住宅中宫宜保持稳定清爽，水污空间靠近中宫时应列为重点复核。',
      }],
      evaluatedRules: [
        {
          assetId: 'rule-south-kitchen-fire-earth',
          version: 1,
          versionId: 'rule-south-kitchen-fire-earth:v1:fedcba9876543210',
          contentHash: '2'.repeat(64),
          title: '南向厨房火土相生规则',
          priority: 90,
          conclusions: [{ code: 'south-kitchen-support', text: '南侧厨房与戊土日主存在火土相生的合拍条件。', level: 'info' }],
        },
        {
          assetId: 'rule-center-bathroom-earth',
          version: 1,
          versionId: 'rule-center-bathroom-earth:v1:0011223344556677',
          contentHash: '3'.repeat(64),
          title: '中宫卫生间稳定性冲突规则',
          priority: 95,
          conclusions: [{ code: 'center-bathroom-conflict', text: '近中宫卫生间与戊土日主的稳定需求存在冲突。', level: 'attention' }],
        },
      ],
      compatibility: {
        assessable: true,
        overallLevel: 'mixed',
        confidence: 'medium',
        positiveMatches: [{
          conclusion: '南侧厨房与戊土日主存在火土相生的合拍条件。',
          chartEvidence: '命盘四柱为壬申、戊申、丙寅、癸巳；日主为戊，属土。',
          residenceEvidence: '单套住宅户型图标注厨房在南侧。',
          ruleTitle: '南向厨房火土相生规则',
          ruleVersion: 1,
          ruleVersionId: 'rule-south-kitchen-fire-earth:v1:fedcba9876543210',
          sourceLabel: '确定性规则',
          origin: 'deterministic-rule',
          level: 'info',
        }],
        conflicts: [{
          conclusion: '近中宫卫生间与戊土日主的稳定需求存在冲突。',
          chartEvidence: '命盘日主为戊土，结构化基线把稳定性列为需要复核的住宅侧条件。',
          residenceEvidence: '户型图显示卫生间靠近户型中心偏西南。',
          ruleTitle: '中宫卫生间稳定性冲突规则',
          ruleVersion: 1,
          ruleVersionId: 'rule-center-bathroom-earth:v1:0011223344556677',
          sourceLabel: '确定性规则',
          origin: 'deterministic-rule',
          level: 'attention',
        }],
        neutralOrUnknown: ['卧室床头方向未提供。'],
        criticalMissingFacts: [],
      },
    }
    const incompleteDraft = `## 人宅合拍结论
总体判断：本套住宅与该命盘局部合拍但有冲突。
最主要原因：命盘日主为戊土，南侧厨房能形成火土相生的合拍条件；但卫生间靠近中宫，会和土性稳定需求形成冲突。
需要注意：卧室床头方向未提供，所以卧室细节暂不展开判断。

## 判断前提与可信度
可信度为中等，依据来自程序命盘、单套住宅户型图和确定性规则。

## 命盘需要
命盘采用程序排盘结果，日主为戊土。

## 住宅属性
住宅上北下南，厨房在南侧，卫生间靠近户型中心偏西南。

## 合拍之处
南侧厨房与戊土日主存在火土相生的合拍条件。命盘依据：命盘四柱为壬申、戊申、丙寅、癸巳；日主为戊，属土。住宅依据：单套住宅户型图标注厨房在南侧。来源依据：南向厨房火土相生规则，v1，确定性规则。

## 冲突之处
本次需要关注卫生间位置，后续继续复核。

## 可以先做的调整
建议在卫生间门口减少杂物并保持门口干爽，平时少让门长期敞开，这样是为了缓解近中宫卫生间对戊土稳定需求的冲突。卧室床头方向未提供，所以卧室细节先不展开。

## 依据与版本
南向厨房火土相生规则，v1，南侧厨房与戊土日主存在火土相生的合拍条件。
中宫卫生间稳定性冲突规则，v1，卫生间靠近中宫时应重点复核居住稳定性。
玄空阳宅中宫资料，v1，来源：专家审核库。

${CULTURAL_USE_NOTICE}`
    const prompts: string[] = []
    const runner: HarnessCommandRunner = async (prompt) => {
      prompts.push(prompt)
      return { stdout: incompleteDraft }
    }

    const result = await generateReportWithRunner(record, runner)
    expect(result.generationProvenance).toMatchObject({ validatorResult: 'pass' })
    expect(result.report).toMatch(/卫生间(?:靠近|贴近).*中宫/u)
    expect(result.report).toMatch(/土性稳定需求|稳定需求/u)
    expect(result.report).toMatch(/冲突/u)
    expect(result.report).not.toMatch(/程序事实|视觉事实|结构化判断|生成过程|程序给出|视觉分析|UUID|contentHash/u)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('请帮我看看这个房子的风水')
    expect(prompts[0]).toContain('南侧厨房与戊土日主存在火土相生的合拍条件')
    expect(prompts[0]).toContain('近中宫卫生间与戊土日主的稳定需求存在冲突')
  })

  it('passes when the report cites only the selected prompt-budget evidence', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    const record: ReportRecord = {
      ...baseRecord,
      citations: Array.from({ length: 9 }, (_, index) => ({
        id: `article-${index + 1}`,
        version: index + 1,
        versionId: `article-${index + 1}:v${index + 1}:0123456789abcdef`,
        contentHash: `${index}`.repeat(64),
        title: `专家资料${index + 1}`,
        sourceLabel: '专家库',
        excerpt: `资料摘录${index + 1}`,
      })),
      evaluatedRules: Array.from({ length: 11 }, (_, index) => ({
        assetId: `rule-${index + 1}`,
        version: index + 1,
        versionId: `rule-${index + 1}:v${index + 1}:fedcba9876543210`,
        contentHash: `${index}`.repeat(64),
        title: `规则${index + 1}`,
        priority: 100 - index,
        conclusions: [{ code: `code-${index + 1}`, text: `规则结论${index + 1}`, level: 'info' }],
      })),
    }
    const basis = [
      ...record.citations!.slice(0, 8).map((citation) => `${citation.title} v${citation.version} ${citation.sourceLabel}`),
      ...record.evaluatedRules!.slice(0, 10).map((rule) => `${rule.title} v${rule.version} ${rule.conclusions[0]!.text}`),
    ].join('；')
    const runner: HarnessCommandRunner = async () => ({ stdout: compliantReport(basis) })

    await expect(generateReportWithRunner(record, runner)).resolves.toMatchObject({
      generationProvenance: { validatorResult: 'pass' },
    })
  })

  it('passes only publishable structured vision facts into the generation prompt', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    const prompts: string[] = []
    const runner: HarnessCommandRunner = async (prompt) => {
      prompts.push(prompt)
      return { stdout: compliantReport() }
    }
    const record: ReportRecord = {
      ...baseRecord,
      vision: [
        {
          fileId: 'floor-plan-1',
          room: 'overview',
          summary: '户型总图识别到厨房和卫生间线索。',
          observedElements: ['旧字段南侧厨房'],
          uncertainties: ['入户阳台是否完全成线仍需复核'],
          schemaVersion: 'vision-observation-v2',
          modelVersion: 'deepseek-v4-flash-vision-exp',
          promptVersion: 'residence-facts-v2',
          facts: [
            { code: 'kitchen.south', confidence: 0.9, evidence: '厨房标注位于南侧', scope: 'floor-plan-topology', source: 'vision-model' },
            { code: 'bathroom.near-center', confidence: 0.62, evidence: '卫生间接近户型中心', scope: 'floor-plan-topology', source: 'vision-model' },
            { code: 'circulation.entry-balcony-aligned', confidence: 0.22, evidence: '疑似入户到阳台直线', scope: 'floor-plan-topology', source: 'vision-model' },
          ],
        },
      ],
    }

    await expect(generateReportWithRunner(record, runner)).resolves.toMatchObject({
      generationProvenance: { validatorResult: 'pass' },
    })

    expect(prompts[0]).toContain('可作为依据的图像事实：厨房位于南侧（置信度0.9；依据：厨房标注位于南侧）')
    expect(prompts[0]).toContain('仅可列入待确认的图像线索：卫生间靠近中宫（置信度0.62；依据：卫生间接近户型中心）')
    expect(prompts[0]).toContain('置信度低于0.4的图像线索已从推理上下文移除，不得引用或暗示')
    expect(prompts[0]).not.toContain('疑似入户到阳台直线')
  })

  it.each([
    ['code fence', `${compliantReport()}\n\`\`\`json\n{"unsafe":true}\n\`\`\``],
    ['plain source code', `${compliantReport()}\nconst payload = { unsafe: true }`],
    ['json object', `${compliantReport()}\n{"status":"completed"}`],
    ['internal field', compliantReport('依据说明包含 timeCorrectionRuleVersion: true-solar-v2-zone-meridian-equation-of-time。')],
  ])('fails closed when model output contains %s', async (_name, stdout) => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-deepseek-key')
    const runner: HarnessCommandRunner = async () => ({ stdout })

    await expect(generateReportWithRunner(baseRecord, runner)).rejects.toBeInstanceOf(ReportValidationError)
  })
})
