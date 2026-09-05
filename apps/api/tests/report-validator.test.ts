import { describe, expect, it } from 'vitest'
import {
  CULTURAL_USE_NOTICE,
  ReportValidationError,
  validateGeneratedReport,
} from '../src/report-validator.js'
import type { ProfessionalAssessments } from '@fengshui/domain'

const citation = {
  id: 'source-1',
  version: 3,
  versionId: 'source-1:v3:0123456789abcdef',
  contentHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  title: '住宅明堂资料',
  sourceLabel: '专家审核库',
  excerpt: '保持入口整洁。',
}

const evaluatedRule = {
  assetId: 'rule-1',
  version: 2,
  versionId: 'rule-1:v2:fedcba9876543210',
  contentHash: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
  title: '南向采光规则',
  priority: 80,
  conclusions: [{ code: 'preserve-daylight', text: '保持现有自然采光条件。', level: 'info' as const }],
}

const professionalAssessments: ProfessionalAssessments = {
  strength: {
    status: 'derived',
    ruleVersion: 'strength-neutral-v1',
    conclusion: 'Neutral strength label',
    provenance: {
      profileVersionId: 'profile-neutral-v7',
      profileContentHash: 'a'.repeat(64),
      assessment: 'strength',
      method: 'decision-table-v1',
      ruleSetVersion: 'strength-neutral-v1',
      matchedRuleIds: ['strength-rule-1'],
      sourceVersionIds: ['source-neutral-v2'],
      factsHash: 'b'.repeat(64),
    },
  },
  pattern: { status: 'unresolved', reason: 'no-match', ruleVersion: 'pattern-neutral-v1', conclusion: 'STALE_PATTERN' },
  elementPreference: {
    status: 'derived', ruleVersion: 'baseline-v1', conclusion: '扶抑基线偏向生助日主的五行',
    provenance: {
      profileVersionId: 'profile-neutral-v7', profileContentHash: 'a'.repeat(64), assessment: 'elementPreference',
      method: 'decision-table-v1', ruleSetVersion: 'baseline-v1', matchedRuleIds: ['preference-rule-1'],
      sourceVersionIds: ['source-neutral-v2'], factsHash: 'b'.repeat(64),
    },
  },
  shenSha: { status: 'pending-school-rule', reason: 'disabled', ruleVersion: 'shensha-neutral-v1', items: ['STALE_SHENSHA'] },
}

const baziWithV2TimeRule = {
  timeCorrectionRuleVersion: 'true-solar-v2-zone-meridian-equation-of-time',
  timeProfile: {
    timezone: 'Asia/Shanghai',
    utcOffsetMinutes: 480,
    standardUtcOffsetMinutes: 480,
    daylightSavingMinutes: 0,
    standardMeridian: 120,
    trueSolarCorrectionMinutes: -2.67,
    timeCorrectionRuleVersion: 'true-solar-v2-zone-meridian-equation-of-time',
    dayBoundary: 'midnight' as const,
    dstPolicy: 'auto' as const,
    luckMethod: 'sect1' as const,
  },
}

const baziWithV3TimeRule = {
  ...baziWithV2TimeRule,
  timeCorrectionRuleVersion: 'true-solar-v3-standard-time-equation-of-time',
  timeProfile: {
    ...baziWithV2TimeRule.timeProfile,
    timeCorrectionRuleVersion: 'true-solar-v3-standard-time-equation-of-time',
  },
}

function compliantReport(sourceNote = `${citation.title}，v${citation.version}，来源：${citation.sourceLabel}`): string {
  return `## 人宅合拍结论
本次可判断为局部合拍，但仍有待确认项。

## 判断前提与可信度
入户区域朝向由用户标注。

## 命盘需要
日主与五行情况来自程序排盘。

## 住宅属性
住宅朝向与照片事实来自用户提交和视觉识别。

## 合拍之处
按传统文化资料，可把入口整洁视作一种象征性支持条件。

## 冲突之处
本次没有形成明确冲突。

## 待确认信息
现场尺寸和采光尚待确认。

## 依据与版本
${sourceNote}

${CULTURAL_USE_NOTICE}`
}

function withProfessionalEvidence(report: string): string {
  const evidence = `${professionalAssessments.strength.conclusion}\n从排盘看，日主自身支撑偏少，火和木这类力量更值得作为居住环境里的参考；这还不是定死的喜用神。`
  return report.replace(`\n\n${CULTURAL_USE_NOTICE}`, `\n${evidence}\n\n${CULTURAL_USE_NOTICE}`)
}

describe('validateGeneratedReport', () => {
  it('accepts a complete person-house compatibility report with traceable citations', () => {
    expect(validateGeneratedReport(compliantReport(), { citations: [citation] })).toContain('## 人宅合拍结论')
  })

  it('accepts a complete report when no published citation was available', () => {
    const report = compliantReport('本次没有检索到已审核发布的专家资料。')
    expect(validateGeneratedReport(report, { citations: [] })).toContain('没有检索到')
  })

  it('fails closed when the exact cultural notice is absent without requiring fixed sections', () => {
    const incomplete = compliantReport()
      .replace('## 待确认信息', '## 其他信息')
      .replace(CULTURAL_USE_NOTICE, '')

    expect(() => validateGeneratedReport(incomplete, { citations: [citation] })).toThrowError(ReportValidationError)
    try {
      validateGeneratedReport(incomplete, { citations: [citation] })
    } catch (error) {
      expect(error).toMatchObject({ reasons: expect.arrayContaining([
        'missing exact cultural-use notice',
      ]) })
    }
  })

  it('accepts a natural open-format report without prescribed headings', () => {
    const openReport = `结论先说：这套住宅与该命盘整体偏合拍。命盘日主为丙火，四柱完整；住宅朝南，客厅照片标注镜头朝南，两者在传统分析中形成采光与火性的呼应。

具体来看，南向住宅与丙火日主存在采光和火性呼应。以上判断参考住宅明堂资料，第3版，来源：专家审核库。建议在客厅南侧采光面保留自然光，并避免用高大家具遮挡主要采光面，这样是为了放大南向采光对丙火日主的呼应。

## 可以先这样做

- 在客厅南侧采光面，保留自然光，并避免用高大家具遮挡主要采光面，这样是为了放大南向采光对丙火日主的呼应。

${CULTURAL_USE_NOTICE}`
    const compatibility = {
      assessable: true,
      overallLevel: 'supportive' as const,
      confidence: 'medium' as const,
      positiveMatches: [{
        conclusion: '南向住宅与丙火日主存在采光和火性呼应。',
        chartEvidence: '日主为丙火，四柱完整。',
        residenceEvidence: '住宅朝南，客厅照片标注镜头朝南。',
        ruleTitle: citation.title,
        ruleVersion: citation.version,
        ruleVersionId: citation.versionId,
        sourceLabel: citation.sourceLabel,
        origin: 'professional-agent' as const,
        level: 'info' as const,
      }],
      conflicts: [],
      neutralOrUnknown: [],
      criticalMissingFacts: [],
    }

    expect(validateGeneratedReport(openReport, { citations: [citation], compatibility })).toContain('整体偏合拍')
  })

  it('rejects open-format prose that never gives a person-house conclusion', () => {
    const compatibility = {
      assessable: true,
      overallLevel: 'supportive' as const,
      confidence: 'medium' as const,
      positiveMatches: [],
      conflicts: [],
      neutralOrUnknown: [],
      criticalMissingFacts: [],
    }
    const inconclusive = `命盘资料与住宅资料已经整理完成，下面介绍住宅的采光、通风与空间分布。客厅在南侧，照片中可以看到窗户。

${CULTURAL_USE_NOTICE}`

    expect(() => validateGeneratedReport(inconclusive, { citations: [], compatibility }))
      .toThrow('assessable report missing explicit overall compatibility conclusion')
  })

  it('rejects generic AI-style report prefaces before the actual conclusion', () => {
    const report = `以下是为您出具的人宅合拍静态报告。

这套住宅与该命盘整体偏合拍。命盘日主为丙火，四柱完整；住宅朝南，客厅照片标注镜头朝南，两者在传统分析中形成采光与火性的呼应。建议在客厅南侧采光面保留自然光，并避免用高大家具遮挡主要采光面，这样是为了放大南向采光对丙火日主的呼应。

${CULTURAL_USE_NOTICE}`

    expect(() => validateGeneratedReport(report, { citations: [citation] }))
      .toThrow('report starts with a generic AI-style preface')
  })

  it('rejects assessable reports that foreground pending-information sections for users', () => {
    const compatibility = {
      assessable: true,
      overallLevel: 'supportive' as const,
      confidence: 'medium' as const,
      positiveMatches: [{
        conclusion: '南向住宅与丙火日主存在采光和火性呼应。',
        chartEvidence: '日主为丙火，四柱完整。',
        residenceEvidence: '住宅朝南，客厅照片标注镜头朝南。',
        ruleTitle: citation.title,
        ruleVersion: citation.version,
        ruleVersionId: citation.versionId,
        sourceLabel: citation.sourceLabel,
        origin: 'professional-agent' as const,
        level: 'info' as const,
      }],
      conflicts: [],
      neutralOrUnknown: ['现场尺寸可后续补充。'],
      criticalMissingFacts: [],
    }
    const report = `这套住宅与该命盘整体偏合拍。南向住宅与丙火日主存在采光和火性呼应。命盘日主为丙火，四柱完整；住宅朝南，客厅照片标注镜头朝南。

## 待确认信息
现场尺寸可后续补充。

建议在客厅南侧采光面保留自然光，并避免用高大家具遮挡主要采光面，这样是为了放大南向采光对丙火日主的呼应。

${CULTURAL_USE_NOTICE}`

    expect(() => validateGeneratedReport(report, { citations: [citation], compatibility }))
      .toThrow('assessable report contains a user-facing pending-information section')
  })

  it('rejects dangerous housing advice in an otherwise natural open-format report', () => {
    const unsafe = `这套住宅与该命盘整体偏合拍。为了进一步改善格局，建议拆墙扩大中宫区域。

${CULTURAL_USE_NOTICE}`

    expect(() => validateGeneratedReport(unsafe, { citations: [] }))
      .toThrow('contains a high-risk housing alteration')
  })

  it('keeps citation provenance structured without forcing the source label into consumer prose', () => {
    const missingSource = compliantReport(`${citation.title}，v${citation.version}`)
    expect(() => validateGeneratedReport(missingSource, { citations: [citation] })).not.toThrow()
  })

  it('does not require internal citation version ids or content hashes in report text', () => {
    const report = compliantReport(`${citation.title}，v${citation.version}，来源：${citation.sourceLabel}`)

    expect(report).not.toContain(citation.versionId)
    expect(report).not.toContain(citation.contentHash)
    expect(validateGeneratedReport(report, { citations: [citation] })).toContain(citation.title)
  })

  it('accepts a report that traces every evaluated rule version and conclusion', () => {
    const report = compliantReport(`${citation.title}，v${citation.version}，来源：${citation.sourceLabel}\n${evaluatedRule.title}，v${evaluatedRule.version}，${evaluatedRule.conclusions[0].text}`)
    expect(validateGeneratedReport(report, { citations: [citation], evaluatedRules: [evaluatedRule] })).toContain(evaluatedRule.title)
  })

  it('accepts natural Chinese source version wording', () => {
    const report = compliantReport(`${citation.title}，第${citation.version}版，来源：${citation.sourceLabel}\n${evaluatedRule.title}，第${evaluatedRule.version}版，${evaluatedRule.conclusions[0].text}`)
    expect(validateGeneratedReport(report, { citations: [citation], evaluatedRules: [evaluatedRule] })).toContain('第2版')
  })

  it('does not require internal rule content hashes in report text', () => {
    const report = compliantReport(`${citation.title}，v${citation.version}，来源：${citation.sourceLabel}\n${evaluatedRule.title}，v2，${evaluatedRule.conclusions[0].text}`)
    expect(validateGeneratedReport(report, { citations: [citation], evaluatedRules: [evaluatedRule] })).toContain('v2')
  })

  it('rejects internal rule version ids even though readable versions are optional in prose', () => {
    const report = compliantReport(`${citation.title}，v${citation.version}，来源：${citation.sourceLabel}\n${evaluatedRule.title}，${evaluatedRule.versionId}，${evaluatedRule.conclusions[0].text}`)
    expect(() => validateGeneratedReport(report, { citations: [citation], evaluatedRules: [evaluatedRule] }))
      .toThrow('contains internal technical identifiers')
  })

  it('does not force the full evaluated rule conclusion into consumer prose', () => {
    const report = compliantReport(`${citation.title}，v${citation.version}，来源：${citation.sourceLabel}\n${evaluatedRule.title}，v${evaluatedRule.version}`)
    expect(() => validateGeneratedReport(report, { citations: [citation], evaluatedRules: [evaluatedRule] })).not.toThrow()
  })

  it('accepts each derived professional conclusion with readable provenance labels', () => {
    const report = withProfessionalEvidence(compliantReport())
    expect(validateGeneratedReport(report, { citations: [citation], bazi: { assessments: professionalAssessments } }))
      .toContain('Neutral strength label')
  })

  it('allows a concise report to omit a nonessential derived professional conclusion', () => {
    const report = withProfessionalEvidence(compliantReport()).replace('Neutral strength label', '')
    expect(() => validateGeneratedReport(report, { citations: [citation], bazi: { assessments: professionalAssessments } }))
      .not.toThrow()
  })

  it('does not mistake an explicit warning against moving or demolition for actionable advice', () => {
    const report = `${compliantReport()}\n不建议搬家，也不建议拆墙或改动承重结构。`
    expect(() => validateGeneratedReport(report, { citations: [citation] })).not.toThrow()
  })

  it('does not mistake explicit uncertainty for a guaranteed life or fortune outcome', () => {
    const report = `${compliantReport()}\n这些调整不能保证发财，也不一定会升职，更不能确保转运。`
    expect(() => validateGeneratedReport(report, { citations: [citation] })).not.toThrow()
  })

  it('rejects a certain strength conclusion when only the support-balance baseline exists', () => {
    const baselineAssessments: ProfessionalAssessments = {
      ...professionalAssessments,
      strength: {
        ...professionalAssessments.strength,
        ruleVersion: 'baseline-v1',
        provenance: {
          ...professionalAssessments.strength.provenance!,
          ruleSetVersion: 'baseline-v1',
        },
      },
    }
    const report = withProfessionalEvidence(compliantReport()).replace('现场尺寸和采光尚待确认。', '此命判断为身强。')
    expect(() => validateGeneratedReport(report, { citations: [citation], bazi: { assessments: baselineAssessments } }))
      .toThrow('turns support-balance baseline into a certain strength conclusion')
  })

  it('rejects a certain pattern when no pattern assessment was derived', () => {
    const report = withProfessionalEvidence(compliantReport()).replace('现场尺寸和采光尚待确认。', '此命格局判断为正官格。')
    expect(() => validateGeneratedReport(report, { citations: [citation], bazi: { assessments: professionalAssessments } }))
      .toThrow('asserts a certain pattern without a derived pattern assessment')
  })

  it.each([
    ['v2', baziWithV2TimeRule],
    ['v3', baziWithV3TimeRule],
  ])('keeps the actual %s time-correction version in provenance instead of visible report text', (_name, bazi) => {
    const report = compliantReport(`${citation.title}，v${citation.version}，来源：${citation.sourceLabel}\n命盘采用真太阳时校正。`)
    expect(validateGeneratedReport(report, { citations: [citation], bazi })).toContain('采用真太阳时校正')
    expect(report).not.toContain('timeCorrectionRuleVersion')
  })

  it.each([
    ['code fence', '```json\n{"status":"ok"}\n```', 'contains a code fence'],
    ['plain JavaScript code', 'const report = buildReport(input)', 'contains plain source code'],
    ['plain TypeScript export', 'export type Report = { title: string }', 'contains plain source code'],
    ['JSON object', '{"summary":"ok"}', 'contains a JSON object'],
    ['HTML markup', '<section>报告正文</section>', 'contains HTML markup'],
    ['Markdown table', '| 字段 | 内容 |\n| --- | --- |', 'contains a Markdown table'],
    ['internal field', 'status=pending-school-rule', 'contains internal implementation fields'],
    ['UUID', '资料条目 id 27974e5a-600a-48d7-8106-cdee0a2119c2', 'contains internal technical identifiers'],
    ['internal version token', '专家流派规则版本 demo-school:v1:0123456789abcdef', 'contains internal technical identifiers'],
    ['time-correction implementation token', 'timeCorrectionRuleVersion=true-solar-v2-zone-meridian-equation-of-time', 'contains internal implementation fields'],
    ['engine rule token', '引擎规则版本：bazi-v5-stem-branch-relations', 'contains internal technical identifiers'],
    ['nine-grid algorithm token', '卫生间 is near the center sector by floorplan-nine-grid-v1.', 'contains internal technical identifiers'],
    ['pending assessment token', '本次暂无可靠结论（pending-school-rule）', 'contains internal technical identifiers'],
    ['internal analysis terminology', '扶抑基线显示候选补益方向为火木。', 'contains user-facing internal analysis terminology'],
  ])('fails closed when the report exposes %s', (_name, leaked, reason) => {
    const report = compliantReport().replace('现场尺寸和采光尚待确认。', leaked)
    expect(() => validateGeneratedReport(report, { citations: [citation] })).toThrow(reason)
  })

  it('does not require or fabricate time-correction rule evidence for legacy charts', () => {
    const report = compliantReport()
    expect(validateGeneratedReport(report, { citations: [citation], bazi: {} })).toContain('## 人宅合拍结论')
  })

  it('does not require pending or unresolved professional output in report text', () => {
    const report = withProfessionalEvidence(compliantReport())
    expect(report).not.toContain('STALE_PATTERN')
    expect(report).not.toContain('STALE_SHENSHA')
    expect(validateGeneratedReport(report, { citations: [citation], bazi: { assessments: professionalAssessments } }))
      .toContain('## 人宅合拍结论')
  })

  it.each([
    ['actionable medical advice', '建议你立即停药并改用另一种治疗。'],
    ['actionable legal advice', '你应该马上起诉并签约。'],
    ['actionable financial advice', '你必须马上卖出投资并申请贷款。'],
    ['actionable major life advice', '最好立刻离婚并搬家。'],
    ['certain life prediction', '你一定会失业，所以要提前准备。'],
  ])('rejects %s', (_name, unsafeSentence) => {
    const unsafe = compliantReport().replace('现场尺寸和采光尚待确认。', unsafeSentence)
    expect(() => validateGeneratedReport(unsafe, { citations: [citation] }))
      .toThrowError(ReportValidationError)
  })

  it.each([
    ['structural alteration', '建议拆墙扩大中宫区域。', 'contains a high-risk housing alteration'],
    ['certain fortune promise', '调整书桌后一定能够转运。', 'promises a certain outcome from a housing suggestion'],
  ])('rejects %s in housing suggestions', (_name, unsafeSentence, reason) => {
    const unsafe = compliantReport().replace('现场尺寸和采光尚待确认。', unsafeSentence)
    expect(() => validateGeneratedReport(unsafe, { citations: [citation] })).toThrow(reason)
  })
})
