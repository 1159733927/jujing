import { describe, expect, it } from 'vitest'
import type { ReportRecord } from '@fengshui/domain'
import {
  CULTURAL_USE_NOTICE,
  ReportValidationError,
  validateGeneratedReport,
} from '../src/report-validator.js'

const citation = {
  id: 'consumer-baseline-source',
  version: 1,
  versionId: 'consumer-baseline-source:v1:0123456789abcdef',
  contentHash: '0'.repeat(64),
  title: '人宅合参消费者表达基线',
  sourceLabel: '专家审核库',
  excerpt: '住宅格局需要结合命盘需求判断，并给出可执行、可复核的低风险处理。',
}

const basePoint = {
  conclusion: '南向客厅与丙火日主形成采光和火性呼应。',
  chartEvidence: '日主为丙火，四柱完整。',
  residenceEvidence: '客厅在住宅南侧，照片标注镜头朝南。',
  ruleTitle: citation.title,
  ruleVersion: citation.version,
  ruleVersionId: citation.versionId,
  sourceLabel: citation.sourceLabel,
  origin: 'professional-agent' as const,
  level: 'info' as const,
}

function compatibility(
  overallLevel: NonNullable<ReportRecord['compatibility']>['overallLevel'],
  overrides: Partial<NonNullable<ReportRecord['compatibility']>> = {},
): NonNullable<ReportRecord['compatibility']> {
  return {
    assessable: overallLevel !== 'insufficient-evidence',
    overallLevel,
    confidence: overallLevel === 'insufficient-evidence' ? 'low' : 'medium',
    positiveMatches: overallLevel === 'conflict' || overallLevel === 'insufficient-evidence' ? [] : [basePoint],
    conflicts: [],
    neutralOrUnknown: [],
    criticalMissingFacts: [],
    ...overrides,
  }
}

function consumerReport(parts: Partial<Record<'opening' | 'positive' | 'conflict' | 'action' | 'unknown', string>> = {}): string {
  return [
    parts.opening ?? '结论先说：这套房子和这个命盘整体偏合拍，可以作为候选房继续看。',
    parts.positive ?? '最加分的是南向客厅。南向客厅与丙火日主形成采光和火性呼应。命盘依据：日主为丙火，四柱完整。住宅依据：客厅在住宅南侧，照片标注镜头朝南。',
    parts.conflict ?? '目前没有看到会直接拉低匹配度的核心冲突点。',
    `## 可以先这样做\n${parts.action ?? '建议在客厅南侧采光面保留窗边通透，先把高大家具移开一点，这样是为了放大南向采光对丙火日主的呼应。'}`,
    parts.unknown ?? '如果后续发现卫生间靠近房屋中心，再单独复核这一区域。',
    CULTURAL_USE_NOTICE,
  ].join('\n\n')
}

function expectValidationReason(report: string, record: Parameters<typeof validateGeneratedReport>[1], reason: string): void {
  expect(() => validateGeneratedReport(report, record)).toThrowError(ReportValidationError)
  try {
    validateGeneratedReport(report, record)
  } catch (error) {
    expect(error).toMatchObject({ reasons: expect.arrayContaining([reason]) })
  }
}

describe('consumer report quality baseline', () => {
  it('accepts a supportive report with a clear conclusion, a core fit point, and a low-risk action', () => {
    const report = consumerReport()

    expect(validateGeneratedReport(report, {
      citations: [citation],
      compatibility: compatibility('supportive'),
    })).toContain('整体偏合拍')
  })

  it('accepts a mixed report only when it names both the fit and the conflict in consumer language', () => {
    const conflictPoint = {
      ...basePoint,
      conclusion: '中宫附近卫生间与命盘稳定需求存在冲突。',
      chartEvidence: '命盘候选需求强调空间稳定和少扰动。',
      residenceEvidence: '户型图显示卫生间靠近住宅中心区域。',
      level: 'attention' as const,
    }
    const report = consumerReport({
      opening: '结论先说：这套房子和这个命盘有合有冲，不是不能看，但要盯住卫生间这个扣分点。',
      conflict: '主要冲突是中宫附近卫生间与命盘稳定需求存在冲突。命盘依据：命盘候选需求强调空间稳定和少扰动。住宅依据：户型图显示卫生间靠近住宅中心区域。',
      action: '建议在卫生间门口减少杂物并保持门口干爽，这样是为了缓解中宫湿气对稳定感的扣分；客厅南侧采光继续保留，用这个优点抵消中心湿气带来的扣分。',
    })

    expect(validateGeneratedReport(report, {
      citations: [citation],
      compatibility: compatibility('mixed', { conflicts: [conflictPoint] }),
    })).toContain('有合有冲')
  })

  it('accepts a conflict report only when it gives the conflict and a reversible mitigation action', () => {
    const conflictPoint = {
      ...basePoint,
      conclusion: '中宫附近卫生间与命盘稳定需求存在冲突。',
      chartEvidence: '命盘候选需求强调空间稳定和少扰动。',
      residenceEvidence: '户型图显示卫生间靠近住宅中心区域。',
      level: 'attention' as const,
    }
    const report = consumerReport({
      opening: '结论先说：这套房子和这个命盘目前偏不合拍，最大问题在房屋中心附近的卫生间。',
      positive: '本次没有形成能够抵消该问题的核心合拍点。',
      conflict: '中宫附近卫生间与命盘稳定需求存在冲突。命盘候选需求强调空间稳定和少扰动；户型图显示卫生间靠近住宅中心区域。',
      action: '建议在卫生间门口不要堆放清洁杂物，并加强日常除湿照明，这样是为了减少近中宫卫生间对稳定需求的冲突。',
    })

    expect(validateGeneratedReport(report, {
      citations: [citation],
      compatibility: compatibility('conflict', { conflicts: [conflictPoint] }),
    })).toContain('偏不合拍')
  })

  it('accepts an insufficient-evidence report that refuses a strong conclusion and asks for the one missing input', () => {
    const report = consumerReport({
      opening: '结论先说：现在证据不足，不能判断这套房子和命盘是否合拍。',
      positive: '不是说这套房子不好，而是户型图没有标清朝向，住宅方位无法和命盘稳定对应。',
      conflict: '因此本次不做强结论，也不把普通采光、通风当成命盘匹配依据。',
      action: '建议先补一张带上北下南标记的户型图，或在照片备注里确认入户门和客厅窗的实际朝向。',
      unknown: '补齐朝向后，再判断客厅、厨房、卫生间与命盘需求是否合拍。',
    })

    expect(validateGeneratedReport(report, {
      citations: [],
      compatibility: compatibility('insufficient-evidence', {
        neutralOrUnknown: ['户型图缺少朝向。'],
        criticalMissingFacts: ['确认住宅坐向'],
      }),
    })).toContain('证据不足')
  })

  it('rejects a report that sounds useful but never states the overall person-house fit', () => {
    const report = consumerReport({
      opening: '这套房子采光还可以，空间也比较完整。',
    })

    expectValidationReason(
      report,
      { citations: [citation], compatibility: compatibility('supportive') },
      'assessable report missing explicit overall compatibility conclusion',
    )
  })

  it('rejects a report that hides a structured conflict behind generic suggestions', () => {
    const conflictPoint = {
      ...basePoint,
      conclusion: '中宫附近卫生间与命盘稳定需求存在冲突。',
      chartEvidence: '命盘候选需求强调空间稳定和少扰动。',
      residenceEvidence: '户型图显示卫生间靠近住宅中心区域。',
      level: 'attention' as const,
    }
    const report = consumerReport({
      opening: '结论先说：这套房子和这个命盘有合有冲，需要局部处理。',
      conflict: '卫生间这块建议保持整洁通风，后面可以继续确认。',
    })

    expectValidationReason(
      report,
      { citations: [citation], compatibility: compatibility('mixed', { conflicts: [conflictPoint] }) },
      'assessable report missing a core compatibility conflict',
    )
  })

  it('rejects generic housekeeping advice when it is not tied to a location, action and purpose', () => {
    const report = consumerReport({
      action: '建议保持卫生间整洁通风，客厅注意采光。',
    })

    expectValidationReason(
      report,
      { citations: [citation], compatibility: compatibility('supportive') },
      'report missing a useful consumer action with location, action and purpose',
    )
  })

  it('rejects an assessable report that buries the answer under repeated pending-information filler', () => {
    const report = consumerReport({
      opening: '结论先说：这套房子和这个命盘整体偏合拍，最大加分项是南向客厅。',
      unknown: '卧室床头方向待确认。卫生间门窗待确认。厨房细节需要补充。后续还要确认阳台外形。',
    })

    expectValidationReason(
      report,
      { citations: [citation], compatibility: compatibility('supportive') },
      'assessable report overuses pending-information filler',
    )
  })

  it('allows one local boundary sentence when the main assessable report is still conclusion-led', () => {
    const report = consumerReport({
      unknown: '卧室床头方向后续可现场复核，但不影响本次对南向客厅的主要合拍判断。',
    })

    expect(validateGeneratedReport(report, {
      citations: [citation],
      compatibility: compatibility('supportive'),
    })).toContain('整体偏合拍')
  })

  it('rejects internal audit language and implementation identifiers in consumer text', () => {
    const report = consumerReport({
      unknown: '后台 evidence/provenance 显示 profileVersionId=demo-profile，需要人工质检后再看。',
    })

    expectValidationReason(
      report,
      { citations: [citation], compatibility: compatibility('supportive') },
      'contains internal implementation fields',
    )
  })

  it('rejects high-risk housing actions even when the compatibility conclusion is clear', () => {
    const report = consumerReport({
      action: '建议拆墙扩大客厅采光面，这样可以放大南向客厅的优势。',
    })

    expectValidationReason(
      report,
      { citations: [citation], compatibility: compatibility('supportive') },
      'contains a high-risk housing alteration',
    )
  })

  it('rejects a strong fit claim when the evidence is explicitly insufficient', () => {
    const report = consumerReport({
      opening: '结论先说：这套房子和这个命盘非常合拍。',
      positive: '虽然户型图没有标清朝向，但整体一定适合这个人。',
    })

    expectValidationReason(
      report,
      { citations: [], compatibility: compatibility('insufficient-evidence', { criticalMissingFacts: ['确认住宅坐向'] }) },
      'unassessable report contains a strong compatibility conclusion',
    )
  })
})
