import { describe, expect, it } from 'vitest'
import {
  CULTURAL_USE_NOTICE,
  ReportValidationError,
  validateGeneratedReport,
} from '../src/report-validator.js'
import type { ProfessionalAssessments, ReportRecord } from '@fengshui/domain'

const citation = {
  id: 'source-compatibility',
  version: 1,
  versionId: 'source-compatibility:v1:0123456789abcdef',
  contentHash: '0'.repeat(64),
  title: '阳宅人宅合参资料',
  sourceLabel: '专家审核库',
  excerpt: '住宅朝向与命盘五行需要合参。',
}

const deterministicRule = {
  assetId: 'rule-south-fire',
  version: 2,
  versionId: 'rule-south-fire:v2:fedcba9876543210',
  contentHash: 'f'.repeat(64),
  title: '南向火性呼应规则',
  priority: 90,
  conclusions: [{ code: 'south-fire-support', text: '南向明亮空间与火性命盘形成呼应条件。', level: 'info' as const }],
}

const compatibility: NonNullable<ReportRecord['compatibility']> = {
  assessable: true,
  overallLevel: 'supportive',
  confidence: 'medium',
  positiveMatches: [{
    conclusion: '南向住宅与丙火日主存在采光和火性呼应。',
    chartEvidence: '日主为丙火，四柱完整。',
    residenceEvidence: '住宅朝南，客厅照片标注镜头朝南。',
    ruleTitle: citation.title,
    ruleVersion: citation.version,
    ruleVersionId: citation.versionId,
    sourceLabel: citation.sourceLabel,
    origin: 'professional-agent',
    level: 'info',
  }],
  conflicts: [],
  neutralOrUnknown: ['卫生间是否接近中宫仍需户型标注确认。'],
  criticalMissingFacts: [],
}

const baziAssessments: ProfessionalAssessments = {
  strength: { status: 'pending-school-rule', reason: 'disabled', ruleVersion: 'strength-v1' },
  pattern: { status: 'pending-school-rule', reason: 'disabled', ruleVersion: 'pattern-v1' },
  elementPreference: {
    status: 'derived',
    ruleVersion: 'baseline-v1',
    conclusion: '扶抑基线显示日主扶助偏少，候选补益方向为同类与印星五行；具体喜用仍待流派规则复核',
    provenance: {
      profileVersionId: 'profile-v1',
      profileContentHash: 'a'.repeat(64),
      assessment: 'elementPreference',
      method: 'decision-table-v1',
      ruleSetVersion: 'baseline-v1',
      matchedRuleIds: ['preference-1'],
      sourceVersionIds: ['source-1'],
      factsHash: 'b'.repeat(64),
    },
  },
  shenSha: { status: 'pending-school-rule', reason: 'disabled', ruleVersion: 'shensha-v1', items: [] },
}

function report(overrides: Partial<Record<'conclusion' | 'basis' | 'match' | 'conflict' | 'unknown' | 'advice', string>> = {}): string {
  const rawConclusion = overrides.conclusion ?? [
    '本套住宅与该命盘偏合拍。',
    '最主要原因：命盘日主为丙火，四柱完整；住宅朝南，客厅照片也标注为朝南，所以传统分析里形成采光和火性呼应。',
    '需要注意：卫生间是否接近中宫只影响这一处局部判断，不影响南向采光这条加分结论。',
  ].join('\n')
  const conclusion = rawConclusion.startsWith('结论先说：') ? rawConclusion : `结论先说：${rawConclusion}`
  const match = overrides.match ?? '南向住宅与丙火日主存在采光和火性呼应。命盘依据：日主为丙火，四柱完整。住宅依据：住宅朝南，客厅照片标注镜头朝南。来源依据：阳宅人宅合参资料，v1，专家审核库。'
  const basis = overrides.basis ? `\n\n${overrides.basis}` : ''
  const unknownSection = overrides.unknown === undefined
    ? ''
    : `\n## 还要补看的地方\n${overrides.unknown}\n`
  return `${conclusion}

## 合拍之处
${match}

## 冲突之处
${overrides.conflict ?? '本次没有形成明确冲突点。'}
${unknownSection}

## 可以先这样做
${overrides.advice ?? '建议在客厅南侧采光面保留窗边通透，并避免高大家具挡住主要光线，这样是为了放大南向采光对丙火日主的呼应。'}
${basis}

${CULTURAL_USE_NOTICE}`
}

function expectFailure(text: string, record: Parameters<typeof validateGeneratedReport>[1], reason: string): void {
  expect(() => validateGeneratedReport(text, record)).toThrowError(ReportValidationError)
  try {
    validateGeneratedReport(text, record)
  } catch (error) {
    expect(error).toMatchObject({ reasons: expect.arrayContaining([reason]) })
  }
}

describe('semantic report validation', () => {
  it('passes an assessable report with a direct conclusion and a source-backed chart-house point', () => {
    expect(validateGeneratedReport(report(), { citations: [citation], compatibility })).toContain('偏合拍')
  })

  it('accepts a clear consumer conclusion without requiring a fixed 总体判断 label', () => {
    expect(validateGeneratedReport(report({
      conclusion: [
        '这套房子整体偏合拍，南向采光对这个命盘是加分项。',
        '日主为丙火，住宅朝南，客厅镜头也朝南，所以两者在采光和火性上能够呼应。',
        '卫生间是否靠近房屋中心暂时看不清，这只影响卫生间这一处的判断，不影响上面的南向采光结论。',
      ].join('\n'),
    }), { citations: [citation], compatibility })).toContain('整体偏合拍')
  })

  it('allows a consumer report to select the core positive point instead of repeating every structured point', () => {
    const secondPoint = {
      ...compatibility.positiveMatches[0]!,
      conclusion: '东侧客厅与命盘里火木一侧的需要形成活动区支持。',
      chartEvidence: '命盘里火和木这类力量更值得作为居住环境里的参考。',
      residenceEvidence: '客厅位于住宅东侧并保持开阔。',
    }
    const multiPointCompatibility = {
      ...compatibility,
      positiveMatches: [compatibility.positiveMatches[0]!, secondPoint],
    }

    expect(validateGeneratedReport(report(), { citations: [citation], compatibility: multiPointCompatibility }))
      .toContain('南向住宅与丙火日主存在采光和火性呼应')

    expect(validateGeneratedReport(report({
      match: [
        '南向住宅与丙火日主存在采光和火性呼应。命盘依据：日主为丙火，四柱完整。住宅依据：住宅朝南，客厅照片标注镜头朝南。来源依据：阳宅人宅合参资料，v1，专家审核库。',
        '东侧客厅与命盘里火木一侧的需要形成活动区支持。命盘依据：命盘里火和木这类力量更值得作为居住环境里的参考。住宅依据：客厅位于住宅东侧并保持开阔。来源依据：阳宅人宅合参资料，v1，专家审核库。',
      ].join('\n'),
    }), { citations: [citation], compatibility: multiPointCompatibility })).toContain(secondPoint.conclusion)
  })

  it('requires structured conflicts to appear instead of letting positive points hide them', () => {
    const conflictPoint = {
      ...compatibility.positiveMatches[0]!,
      conclusion: '中宫近卫生间与命盘稳定需求存在冲突。',
      chartEvidence: '命盘候选需求强调土性稳定。',
      residenceEvidence: '卫生间标注靠近户型中心区域。',
      level: 'attention' as const,
    }
    const mixedCompatibility = {
      ...compatibility,
      overallLevel: 'mixed' as const,
      conflicts: [conflictPoint],
    }

    expectFailure(
      report({
        conclusion: [
          '总体判断：本套住宅与该命盘局部合拍但有冲突。',
          '最主要原因：命盘日主为丙火，住宅朝南，所以南向采光这一点偏合拍；但卫生间位置还没有形成可靠结论。',
          '需要注意：卫生间是否接近中宫仍需户型标注确认。',
        ].join('\n'),
        conflict: '本次需要注意卫生间位置，但还要进一步确认。',
      }),
      { citations: [citation], compatibility: mixedCompatibility },
      'assessable report missing a core compatibility conflict',
    )

    expect(validateGeneratedReport(report({
      conclusion: [
        '总体判断：本套住宅与该命盘局部合拍但有冲突。',
        '最主要原因：命盘日主为丙火，住宅朝南，所以南向采光这一点偏合拍；但卫生间位置还没有形成可靠结论。',
        '需要注意：卫生间是否接近中宫仍需户型标注确认。',
      ].join('\n'),
      conflict: '中宫近卫生间与命盘稳定需求存在冲突。命盘依据：命盘候选需求强调土性稳定。住宅依据：卫生间标注靠近户型中心区域。来源依据：阳宅人宅合参资料，v1，专家审核库。',
    }), { citations: [citation], compatibility: mixedCompatibility })).toContain(conflictPoint.conclusion)
  })

  it('passes a conflict-first consumer report with a concrete mitigation action', () => {
    const conflictPoint = {
      ...compatibility.positiveMatches[0]!,
      conclusion: '中宫近卫生间与命盘稳定需求存在冲突。',
      chartEvidence: '命盘候选需求强调土性稳定。',
      residenceEvidence: '卫生间标注靠近户型中心区域。',
      level: 'attention' as const,
    }
    const conflictCompatibility = {
      ...compatibility,
      overallLevel: 'conflict' as const,
      positiveMatches: [],
      conflicts: [conflictPoint],
    }
    const conflictReport = report({
      conclusion: '这套住宅与该命盘目前偏不合拍，主要冲突在房屋中心附近的卫生间。',
      match: '本次没有形成明确合拍点。',
      conflict: '中宫近卫生间与命盘稳定需求存在冲突。命盘候选需求强调土性稳定。卫生间标注靠近户型中心区域。建议在卫生间门口减少杂物并加强除湿照明，这样是为了缓解中心区域湿气对稳定需求的冲突。',
      basis: '详细规则来源与版本保存在报告生成依据中。',
    })

    expect(validateGeneratedReport(conflictReport, { citations: [citation], compatibility: conflictCompatibility }))
      .toContain('偏不合拍')
  })

  it('requires generated action wording to stay tied to a rendered compatibility point', () => {
    const actionableCompatibility: NonNullable<ReportRecord['compatibility']> = {
      ...compatibility,
      positiveMatches: [{
        ...compatibility.positiveMatches[0]!,
        actions: [{
          kind: 'amplify',
          location: '南侧采光面',
          action: '保留南侧窗面的通透，避免高大家具挡住主要光线。',
          intendedEffect: '放大南向采光对命盘火性呼应的优点。',
          verification: '白天站在客厅确认南侧窗面没有明显遮挡。',
          safety: 'reversible-low-risk',
        }],
      }],
    }

    expectFailure(
      report({
        match: '南向住宅与丙火日主存在采光和火性呼应。命盘依据：日主为丙火，四柱完整。住宅依据：住宅朝南，客厅照片标注镜头朝南。来源依据：阳宅人宅合参资料，v1，专家审核库。',
        conflict: '建议保持环境整洁，注意通风采光。',
        advice: '建议保持环境整洁，注意通风采光。',
      }),
      { citations: [citation], compatibility: actionableCompatibility },
      'report missing an action tied to a compatibility point',
    )

    expect(validateGeneratedReport(report({
      match: '南向住宅与丙火日主存在采光和火性呼应。命盘依据：日主为丙火，四柱完整。住宅依据：住宅朝南，客厅照片标注镜头朝南。建议在南侧采光面保留南侧窗面的通透，避免高大家具挡住主要光线，这样做是为了放大南向采光对命盘火性呼应的优点。',
    }), { citations: [citation], compatibility: actionableCompatibility })).toContain('避免高大家具')
  })

  it('requires a mitigation action when the rendered core conflict has one in structured reasoning', () => {
    const conflictPoint = {
      ...compatibility.positiveMatches[0]!,
      conclusion: '中宫近卫生间与命盘稳定需求存在冲突。',
      chartEvidence: '命盘候选需求强调土性稳定。',
      residenceEvidence: '卫生间标注靠近户型中心区域。',
      level: 'attention' as const,
      actions: [{
        kind: 'mitigate' as const,
        location: '靠近中宫的卫生间',
        action: '减少门口杂物并保持门口干爽，平时不要让门长期敞开。',
        intendedEffect: '缓解中心区域湿气对命盘稳定需求的冲突。',
        verification: '连续两周确认卫生间门口无堆物、地面不潮。',
        safety: 'reversible-low-risk' as const,
      }],
    }
    const positivePoint = {
      ...compatibility.positiveMatches[0]!,
      actions: [{
        kind: 'amplify' as const,
        location: '客厅南侧采光面',
        action: '保留窗边通透，避免高大家具挡住主要光线。',
        intendedEffect: '放大南向采光对丙火日主的呼应。',
        verification: '白天站在客厅确认南侧窗面没有明显遮挡。',
        safety: 'reversible-low-risk' as const,
      }],
    }
    const mixedCompatibility: NonNullable<ReportRecord['compatibility']> = {
      ...compatibility,
      overallLevel: 'mixed',
      positiveMatches: [positivePoint],
      conflicts: [conflictPoint],
    }

    expectFailure(
      report({
        conclusion: '这套住宅和这个命盘局部合拍，但中宫近卫生间这一点存在冲突。',
        match: '南向住宅与丙火日主存在采光和火性呼应。日主为丙火，四柱完整；住宅朝南，客厅照片标注镜头朝南。建议在客厅南侧采光面保留窗边通透，避免高大家具挡住主要光线，这样是为了放大南向采光对丙火日主的呼应。',
        conflict: '中宫近卫生间与命盘稳定需求存在冲突。命盘依据：命盘候选需求强调土性稳定。住宅依据：卫生间标注靠近户型中心区域。',
        advice: '客厅南侧采光面继续保留通透，避免高大家具遮挡，这样是为了放大南向采光优势。',
      }),
      { citations: [citation], compatibility: mixedCompatibility },
      'report missing a mitigation action tied to a core compatibility conflict',
    )

    expect(validateGeneratedReport(report({
      conclusion: '这套住宅和这个命盘局部合拍，但中宫近卫生间这一点存在冲突。',
      match: '南向住宅与丙火日主存在采光和火性呼应。日主为丙火，四柱完整；住宅朝南，客厅照片标注镜头朝南。建议在客厅南侧采光面保留窗边通透，避免高大家具挡住主要光线，这样是为了放大南向采光对丙火日主的呼应。',
      conflict: '中宫近卫生间与命盘稳定需求存在冲突。命盘依据：命盘候选需求强调土性稳定。住宅依据：卫生间标注靠近户型中心区域。建议在靠近中宫的卫生间减少门口杂物并保持门口干爽，平时不要让门长期敞开，这样是为了缓解中心区域湿气对命盘稳定需求的冲突。',
    }), { citations: [citation], compatibility: mixedCompatibility })).toContain('不要让门长期敞开')
  })

  it('accepts natural consumer prose without a visible source-version checklist when provenance is complete', () => {
    const consumerReport = report({
      match: '南向住宅与丙火日主存在采光和火性呼应。日主为丙火，四柱完整；住宅朝南，客厅照片标注镜头朝南。建议在客厅南侧采光面保留现有采光，并避免高大家具挡住窗面，这样是为了放大南向采光对丙火日主的呼应。',
      basis: '详细依据已随报告留存。',
    })

    expect(consumerReport).not.toContain(citation.sourceLabel)
    expect(consumerReport).not.toContain(`v${citation.version}`)
    expect(validateGeneratedReport(consumerReport, { citations: [citation], compatibility })).toContain('偏合拍')
  })

  it('rejects repeated consumer action sections so the report does not look padded', () => {
    expectFailure(
      `${report()}

## 可以先这样做

- 南侧厨房继续作为主要烹饪区使用，这样能延续当前方位优势。

## 可以先这样做

- 客厅南侧采光面继续保持通透，这样是为了放大朝南采光的加分。`,
      { citations: [citation], compatibility },
      'report repeats consumer action section',
    )
  })

  it('rejects reports that invent a south balcony when only the south kitchen is evidenced', () => {
    expectFailure(
      report({
        match: '南向住宅与丙火日主存在火性呼应。命盘依据：日主为丙火，四柱完整。住宅依据：厨房在南侧。南侧厨房和阳台都是加分项，建议保持南侧阳台通透，这样是为了放大朝南格局的加分。',
      }),
      {
        citations: [citation],
        compatibility,
        submission: {
          residence: { facing: 'south', layoutNote: '户型图上北下南；厨房在南侧；阳台方位未确认。' },
          photos: [{ room: 'overview', facing: 'unknown', note: '全屋户型图，不能推断南侧阳台。' }],
        },
        vision: [{
          room: 'overview',
          summary: '户型图显示厨房在南侧',
          observedElements: ['厨房位于户型南侧'],
          facts: [{ code: 'kitchen.south', confidence: 0.9, evidence: '厨房位于户型南侧', scope: 'floor-plan-topology', source: 'vision-model' }],
          uncertainties: [],
        }],
      } as any,
      'report claims a south balcony without supporting residence or vision evidence',
    )
  })

  it('rejects assessable reports that expose back-office source or version sections', () => {
    expectFailure(
      report({
        basis: [
          '## 依据与版本',
          '阳宅人宅合参资料，v1，来源：专家审核库。',
        ].join('\n'),
      }),
      { citations: [citation], compatibility },
      'assessable report contains a back-office source or version section',
    )
  })

  it('fails when an assessable report has no explicit overall compatibility conclusion', () => {
    expectFailure(
      report({ conclusion: '本次信息已整理完成，整体较好，但还需要进一步确认。' }),
      { citations: [citation], compatibility },
      'assessable report missing explicit overall compatibility conclusion',
    )
  })

  it('fails when an assessable report only gives generic filler instead of the structured compatibility point', () => {
    expectFailure(
      report({
        conclusion: '总体判断：本套住宅与该命盘整体偏合拍，但这里只给了泛泛建议。',
        match: '建议保持入口整洁，并进一步确认采光。',
        advice: '建议保持环境整洁，注意通风采光。',
      }),
      { citations: [citation], compatibility },
      'assessable report missing a compatibility point with chart evidence, residence evidence and source basis',
    )
  })

  it('passes a deterministic-rule report when no published expert source was available', () => {
    const deterministicCompatibility: NonNullable<ReportRecord['compatibility']> = {
      ...compatibility,
      positiveMatches: [{
        ...compatibility.positiveMatches[0]!,
        ruleTitle: deterministicRule.title,
        ruleVersion: deterministicRule.version,
        ruleVersionId: deterministicRule.versionId,
        sourceLabel: '确定性规则',
        origin: 'deterministic-rule',
      }],
    }
    const deterministicReport = report({
      match: '南向住宅与丙火日主存在采光和火性呼应。命盘依据：日主为丙火，四柱完整。住宅依据：住宅朝南，客厅照片标注镜头朝南。来源依据：南向火性呼应规则，v2，确定性规则。',
      basis: '本次没有检索到已审核发布的专家资料。\n南向火性呼应规则，v2，南向明亮空间与火性命盘形成呼应条件。',
    })

    expect(validateGeneratedReport(deterministicReport, {
      citations: [],
      evaluatedRules: [deterministicRule],
      compatibility: deterministicCompatibility,
    })).toContain('确定性规则')
  })

  it('does not force a conclusion for ambiguous mixed-residence input marked unassessable', () => {
    const mixedResidenceCompatibility: NonNullable<ReportRecord['compatibility']> = {
      assessable: false,
      overallLevel: 'insufficient-evidence',
      confidence: 'low',
      positiveMatches: [],
      conflicts: [],
      neutralOrUnknown: ['两张户型图疑似来自不同住宅。'],
      criticalMissingFacts: ['确认本次只分析一个住宅'],
    }
    const mixedResidenceReport = report({
        conclusion: [
          '总体判断：当前不可判断。',
          '最主要原因：两张户型图疑似来自不同住宅，无法把命盘与单一住宅稳定对应。',
          '需要注意：需要确认本次只分析一个住宅。',
        ].join('\n'),
      match: '本次没有形成明确合拍点。',
      unknown: '两张户型图疑似来自不同住宅，需要确认本次只分析一个住宅。',
      basis: '本次没有检索到已审核发布的专家资料。',
    })

    expect(validateGeneratedReport(mixedResidenceReport, {
      citations: [],
      compatibility: mixedResidenceCompatibility,
    })).toContain('不可判断')
  })

  it('rejects a strong compatibility conclusion and high confidence when the input is unassessable', () => {
    const unassessableCompatibility: NonNullable<ReportRecord['compatibility']> = {
      assessable: false,
      overallLevel: 'insufficient-evidence',
      confidence: 'low',
      positiveMatches: [],
      conflicts: [],
      neutralOrUnknown: ['户型图未标注方向。'],
      criticalMissingFacts: ['确认住宅坐向'],
    }

    expectFailure(
      report({
        conclusion: [
          '总体判断：这套住宅与该命盘非常合拍。',
          '最主要原因：命盘和住宅都显示支持条件。',
          '需要注意：还需要复核户型图。',
        ].join('\n'),
        match: '住宅整体条件对命盘形成明显支持。',
        unknown: '户型图未标注方向，需要确认住宅坐向。',
      }),
      { citations: [], compatibility: unassessableCompatibility },
      'unassessable report contains a strong compatibility conclusion',
    )

    expectFailure(
      report({
        conclusion: [
          '总体判断：当前信息不足，无法判断住宅与命盘是否合拍。',
          '最主要原因：户型图未标注方向，住宅事实不能与命盘稳定对应。',
          '需要注意：需要确认住宅坐向。',
        ].join('\n'),
        match: '证据不足，暂不形成明确合拍点。',
        unknown: '户型图未标注方向，需要确认住宅坐向。',
        advice: '建议先确认住宅坐向和户型中心点；可信度为高。',
      }),
      { citations: [], compatibility: unassessableCompatibility },
      'unassessable report claims high confidence',
    )
  })

  it('requires an unassessable report to explain why it cannot judge without exposing every internal missing-fact item', () => {
    const unassessableCompatibility: NonNullable<ReportRecord['compatibility']> = {
      assessable: false,
      overallLevel: 'insufficient-evidence',
      confidence: 'low',
      positiveMatches: [],
      conflicts: [],
      neutralOrUnknown: ['户型图未标注方向。'],
      criticalMissingFacts: ['确认住宅坐向', '确认户型中心点'],
    }

    expectFailure(
      report({
        conclusion: [
          '总体判断：暂不作结论。',
          '最主要原因：户型图未标注方向，住宅事实不能与命盘稳定对应。',
          '需要注意：需要确认住宅坐向。',
        ].join('\n'),
        match: '本次没有形成明确合拍点。',
        unknown: '户型图未标注方向，需要确认住宅坐向。',
      }),
      { citations: [], compatibility: unassessableCompatibility },
      'unassessable report must explicitly state insufficient evidence',
    )

    expect(validateGeneratedReport(report({
      conclusion: [
        '这套房子现在还不能判断是否与命盘合拍。',
        '户型图没有标明方向，房屋方位无法和命盘稳定对应；先补一张标有朝向的户型图即可。',
        '这个限制只针对住宅方位分析，已经排出的四柱不会因此改变。',
      ].join('\n'),
      match: '证据不足，暂不形成明确合拍点。',
      unknown: '户型方向还不清楚，补充朝向后再判断住宅方位是否合拍。',
      basis: '本次没有检索到已审核发布的专家资料。',
    }), { citations: [], compatibility: unassessableCompatibility })).toContain('不能判断')
  })

  it('allows AI-only compatibility points without leaking model-source labels to consumers', () => {
    const aiOnlyCompatibility: NonNullable<ReportRecord['compatibility']> = {
      ...compatibility,
      positiveMatches: [{
        ...compatibility.positiveMatches[0]!,
        ruleTitle: 'AI传统术数推断',
        ruleVersion: 1,
        ruleVersionId: 'ai-inference:v1:0123456789abcdef',
        sourceLabel: '模型推断（非专家库）',
      }],
    }
    expect(validateGeneratedReport(
      report({
        match: '南向住宅与丙火日主存在采光和火性呼应。命盘依据：日主为丙火，四柱完整。住宅依据：住宅朝南，客厅照片标注镜头朝南。这里属于传统五行合参的谨慎判断，不把它说成确定吉凶。',
        basis: '传统五行合参：南向采光与丙火日主有呼应，但仍需结合现场长期感受复核。',
      }),
      { citations: [citation], compatibility: aiOnlyCompatibility },
    )).toContain('传统五行合参')
  })

  it('fails when the user-facing report leaks process language', () => {
    expectFailure(
      report({
        match: '南向住宅与丙火日主存在采光和火性呼应。命盘依据：程序给出的日主为丙火，四柱完整。住宅依据：视觉分析确认住宅朝南，客厅照片标注镜头朝南。',
      }),
      { citations: [citation], compatibility },
      'contains consumer-facing process language',
    )
  })

  it('fails when the user-facing report leaks internal analysis terminology', () => {
    expectFailure(
      report({
        match: '南向住宅与丙火日主存在采光和火性呼应。命盘依据：扶抑基线显示候选补益方向包含火。住宅依据：住宅朝南，客厅照片标注镜头朝南。',
      }),
      { citations: [citation], compatibility },
      'contains user-facing internal analysis terminology',
    )
  })

  it('fails when an element-preference candidate is rewritten as a certain favorable god', () => {
    expectFailure(
      report({ conclusion: '总体判断：本套住宅与该命盘偏合拍。\n最主要原因：用神确定为火，住宅朝南。\n需要注意：该说法需要专业规则复核。' }),
      { citations: [citation], compatibility, bazi: { assessments: baziAssessments } },
      'turns element-preference candidates into certain favorable or unfavorable gods',
    )
  })
})
