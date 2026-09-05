import type { BaziAssessmentName, ProfessionalAssessmentResult, ReportGenerationProvenance, ReportRecord } from '@fengshui/domain'

export const CULTURAL_USE_NOTICE = '仅供传统文化与娱乐参考，不构成医疗、法律、财务或重大人生决定建议。'
export const REPORT_VALIDATOR_VERSION = 'generated-report-validator-v18-consumer-action-gate'

const ACTIONABLE_HIGH_STAKES_ADVICE = /(?<!不)(?<!无须)(?<!无需)(?:建议|应该|应当|必须|务必|需要|最好)[^。；\n]{0,24}(?:就医|治疗|诊断|用药|停药|手术|诉讼|起诉|签约|投资|理财|买入|卖出|贷款|借款|结婚|离婚|生育|怀孕|辞职|退学|搬家)/u
const CERTAIN_HIGH_STAKES_PREDICTION = /(?<!不)(?<!并非)(?<!未必)(?<!不能)(?:注定|必然|一定(?:会|能|将)|肯定(?:会|能)|保证会|绝对会)[^。；\n]{0,32}(?:发财|破财|患病|生病|离婚|结婚|怀孕|升职|失业|死亡|成功|失败)/u
const CODE_FENCE = /```|~~~/u
const PLAIN_CODE_LINE = /(?:^|\n)\s*(?:import\s+[\w*{]|export\s+(?:const|function|class|default|type|interface)|(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(|class\s+[A-Za-z_$][\w$]*\s*[{<]|interface\s+[A-Za-z_$][\w$]*\s*[{<]|type\s+[A-Za-z_$][\w$]*\s*=|return\s+(?:\{|\(|["']))/u
const HTML_TAG = /<\/?[a-z][\w:-]*(?:\s+[^<>]*)?>/iu
const MARKDOWN_TABLE_LINE = /(?:^|\n)\s*\|[^|\n]+(?:\|[^|\n]+)+\|\s*(?:$|\n)/u
const INTERNAL_FIELD_LEAK = /(?:timeCorrectionRuleVersion|profileVersionId|profileContentHash|ruleSetVersion|contentHash|versionId|ruleProfileVersionId|inputSha256|promptSha256|reportSha256|status|reason)\s*[:=：]/iu
const CONSUMER_PROCESS_LANGUAGE = /(?:程序事实|程序口径|程序给出|程序显示|服务端|视觉分析|结构化(?:判断|数据|基线)|生成过程|测试档案|测试数据|QA|provenance|validator|pipeline|prompt|schema|审核\s*Agent|质检\s*Agent|模型推断|AI\s*传统术数推断|非专家库)/iu
const USER_FACING_INTERNAL_ANALYSIS_LANGUAGE = /(?:扶抑基线|程序合参基线|人宅合参演示基线|候选方向|候选补益方向|候选平衡方向|补益方向)/u
const JSON_OBJECT_LINE = /(?:^|\n)\s*\{\s*"[^"\n]+"\s*:/u
const UUID_TOKEN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu
const INTERNAL_VERSION_TOKEN = /\b(?:[a-z][a-z0-9._-]*:v\d+:[a-f0-9]{8,}|bazi-v\d+|true-solar-v\d+|floorplan-nine-grid-v\d+|pending-school-rule|legacy-profile|headless|deepseek-v[\w.-]*)\b/iu
const FALSE_MISSING_BIRTH_HOUR = /(?:缺少|未提供|没有|未知)[^\n。；]{0,12}(?:出生时辰|出生时间|时辰|时柱)/u
const EMPTY_COMPATIBILITY_TALK = /(?:仅|主要|重点)?(?:建议|保持|注意)?(?:环境|空间|房间|入口|住宅)?(?:整洁|干净|通风|采光|进一步确认|继续确认|补充信息|整体较好|总体较好|中上|还不错)(?:[，,。；;、\s]|$)/u
const HIGH_RISK_ACTION = /(?<!不)(?<!无须)(?<!无需)(?:建议|应该|应当|必须|务必|需要|最好|可以|可考虑)[^。；\n]{0,30}(?:拆墙|拆除墙体|改承重结构|封(?:闭)?门窗|改(?:造)?(?:燃气|水电)|迁居|搬家|改门|封门)/u
const CERTAIN_FORTUNE_ACTION = /(?<!不)(?<!并非)(?<!未必)(?<!不能)(?:必然|一定|保证|确保|从而|即可)(?:[^。；\n]{0,12})?(?:转运|发财|治病|痊愈|怀孕|生育|婚姻|升职)/u
const CERTAIN_ELEMENT_PREFERENCE = /(?:(?:喜神|忌神|用神)[^\n。；]{0,10}(?:确定|明确|就是|为|是|取|定为|应取)[^\n。；]{0,20}[木火土金水]|[木火土金水][^\n。；]{0,10}(?:确定|明确)?(?:为|是|作|作为)(?:喜神|忌神|用神))/u
const CERTAIN_STRENGTH = /(?:日主|命局|此命)[^\n。；]{0,16}(?:为|是|属于|判断为|定为)(?:身强|身弱|从强|从弱)/u
const CERTAIN_PATTERN = /(?:命局|此命|格局)[^\n。；]{0,16}(?:为|是|属于|判断为|定为)(?:正官|七杀|正印|偏印|正财|偏财|食神|伤官|建禄|羊刃|从财|从官杀|从儿|化气)格/u
const INSUFFICIENT_EVIDENCE_CONCLUSION = /证据不足|信息不足|无法判断|不可判断/u
const STRONG_COMPATIBILITY_CONCLUSION = /(?:非常|高度|完全|十分|明显|极其)(?:合拍|相合|适合|不合拍|不适合|相冲|相克)|(?:非常|高度|完全|十分|明显|极其)[^\n。；]{0,8}(?:支持|冲突)/u
const HIGH_CONFIDENCE_CLAIM = /(?:可信度|置信度)(?:为|是|：|:)?\s*(?:较高|很高|高)|(?:高|较高|很高)(?:可信度|置信度)/u
const USER_FACING_PENDING_SECTION = /(?:^|\n)\s*#{1,6}\s*(?:待确认信息|信息不足|证据不足|待补充|还需要确认)\s*(?:\n|$)/u
const BACKOFFICE_SOURCE_SECTION = /(?:^|\n)\s*#{1,6}\s*(?:依据与版本|引用依据|资料来源|资料清单|规则清单|版本清单)\s*(?:\n|$)/u
const USER_ACTION_SECTION_TITLE = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(?:可以先这样做|你可以先这样做|建议先这样做|先做这几件事|接下来可以这样做)(?:\*\*)?\s*[:：]?\s*(?:\n|$)/gu
const PENDING_FILLER_PHRASE = /待确认|信息不足|证据不足|后续(?:再|继续)?(?:看|确认|补充|复核)|需要(?:补充|确认|进一步|再看)|暂时(?:看不清|无法)|不能判断|无法判断/u
const CONCLUSION_FIRST_PREFIX = /^结论先说：/u
const CONSUMER_UNHELPFUL_SECTION = /(?:^|\n)\s*#{1,6}\s*(?:判断前提与可信度|命盘需要|住宅属性|待确认信息|信息不足|证据不足|待补充|还需要确认|依据与版本|引用依据|资料来源|资料清单|规则清单|版本清单)\s*(?:\n|$)/u
const SOUTH_BALCONY_MENTION = /(?:南(?:侧|向|方)[^\n。；;，,]{0,16}阳台|阳台[^\n。；;，,]{0,16}(?:在|位于|处于|朝|向|靠)?南(?:侧|向|方)?)/u
const NEGATED_SPATIAL_FACT = /(?:不|未|无|没有|不能|无法|不得|不可|缺少|看不出|待确认|需要确认|不能推断|不要推断)/u
const GENERIC_REPORT_PREFACE = /^(?:以下是|下面是|这是|本文将|本报告将|为您出具|本次报告将)/u
const READABLE_CHINESE_PROSE = /[\p{Script=Han}]{8,}[，。；！？]/u
const ACTION_VERB = /建议|可以|可先|先补|优先|保留|保持|使用|选择|避开|避免|减少|加强|增加|调整|移开|补充|确认|布置|放置|摆放|遮挡|关闭|收纳|除湿|照明/u
const ACTION_TARGET = /住宅|房屋|户型|客厅|卧室|主卧|次卧|厨房|卫生间|洗手间|入户|玄关|阳台|餐厅|书房|门|窗|采光|家具|床|床头|书桌|灶台|照片|朝向|方位|中宫|中心|中央区域/u
const ACTION_PURPOSE = /放大|增强|加强|延续|利用|减少|减轻|降低|缓解|改善|避免|稳定|平衡|削弱|抵消|目的\s*[:：]|减少.*(?:扣分|冲突|影响)|放大.*(?:优点|加分|呼应)/u
const AMPLIFY_ACTION_PURPOSE = /放大|增强|加强|延续|利用|保持.*(?:优势|优点|加分|呼应)|保留.*(?:优势|优点|加分|呼应)|目的\s*[:：][^。；\n]{0,48}(?:加分|优点|呼应|采光|通透|明亮|生发|立得住|进入|服务)/u
const MITIGATE_ACTION_PURPOSE = /减少|减轻|降低|缓解|改善|避免|稳定|平衡|削弱|抵消|化解|压低|压住|减弱|降到最低|减少.*(?:扣分|冲突|影响)|目的\s*[:：][^。；\n]{0,48}(?:降低|降到最低|减弱|压低|压住|湿气|杂乱|直冲|直泄|燥乱|冲突)/u
const GENERIC_HYGIENE_ONLY_SENTENCE = /^(?:建议|可以|可)?(?:在|把|将)?(?:东侧|西侧|南侧|北侧|中央|中间)?(?:客厅|卧室|主卧|次卧|厨房|卫生间|洗手间|入户门?|玄关|书房|阳台|餐厅|床头|灶台|窗户|门口|中宫|中央区域|该区域)?(?:优先|先)?(?:保持|注意)?(?:清洁|整洁|干爽|干燥|通风|采光|明亮|无异味|清洁通风|通风干燥|干燥整洁|明亮整洁)(?:即可|就好)?$/u

export class ReportValidationError extends Error {
  generationProvenance?: ReportGenerationProvenance
  constructor(readonly reasons: readonly string[]) {
    super(`Generated report failed compliance validation: ${reasons.join('; ')}`)
    this.name = 'ReportValidationError'
  }
}

function hasReadableVersion(normalized: string, version: number): boolean {
  return new RegExp(`(?:第\\s*${version}\\s*版|版本\\s*${version}(?!\\d)|(?<![\\p{L}\\p{N}_:])v${version}(?![\\d:]))`, 'iu').test(normalized)
}

type ReportValidationBazi = {
  pillars?: readonly string[]
  assessments?: ReportRecord['bazi']['assessments']
  timeCorrectionRuleVersion?: string
  timeProfile?: { timeCorrectionRuleVersion?: string }
}

type ReportValidationRecord = Pick<ReportRecord, 'citations' | 'evaluatedRules' | 'compatibility'> & {
  bazi?: ReportValidationBazi
  submission?: Pick<ReportRecord['submission'], 'residence' | 'photos'>
  vision?: ReportRecord['vision']
}

type CompatibilityPoint = NonNullable<ReportValidationRecord['compatibility']>['positiveMatches'][number]
type CompatibilityAction = NonNullable<CompatibilityPoint['actions']>[number]
type CompatibilityActionKind = CompatibilityAction['kind']

function actualTimeCorrectionRuleVersion(record: ReportValidationRecord): string | undefined {
  return record.bazi?.timeCorrectionRuleVersion ?? record.bazi?.timeProfile?.timeCorrectionRuleVersion
}

function validateProfessionalAssessment(
  normalized: string,
  name: BaziAssessmentName,
  assessment: ProfessionalAssessmentResult,
  reasons: string[],
): void {
  if (assessment.status !== 'derived') return

  const provenance = assessment.provenance
  if (!provenance) {
    reasons.push(`derived professional assessment missing provenance: ${name}`)
    return
  }
  if (provenance.assessment !== name) {
    reasons.push(`professional provenance assessment mismatch: ${name}`)
    return
  }

  const conclusions = name === 'shenSha'
    ? assessment.items ?? []
    : assessment.conclusion ? [assessment.conclusion] : []
  if (name !== 'shenSha' && conclusions.length === 0) {
    reasons.push(`derived professional assessment missing conclusion: ${name}`)
  }
}

function overallLevelTerms(level: NonNullable<ReportValidationRecord['compatibility']>['overallLevel']): readonly RegExp[] {
  switch (level) {
    case 'supportive':
      return [/合拍|相合|偏合|适合|支持/u]
    case 'conflict':
      return [/不合拍|冲突|相冲|不适合|相克/u]
    case 'mixed':
      return [/有合有冲|合冲并见|局部合拍|部分合拍|同时存在[^\n。；]{0,16}(?:合拍|冲突)/u]
    case 'neutral':
      return [/中性|平稳|未形成明确(?:合拍|冲突)|合拍与冲突都不明显/u]
    case 'insufficient-evidence':
      return [/证据不足|信息不足|无法判断|不可判断/u]
  }
}

function hasExplicitOverallConclusion(normalized: string, level: NonNullable<ReportValidationRecord['compatibility']>['overallLevel']): boolean {
  const prose = normalized
    .split('\n')
    .filter((line) => !/^\s*#{1,6}\s*\S/u.test(line))
    .join('\n')
  return overallLevelTerms(level).some((pattern) => pattern.test(prose))
}

function pointIsAiOnly(point: CompatibilityPoint): boolean {
  return point.origin === 'professional-agent' && /(?:AI传统术数推断|模型推断|非专家库)/u.test(`${point.ruleTitle}${point.sourceLabel ?? ''}`)
}

function evidenceAppears(normalized: string, evidence: string, domainSignal: RegExp): boolean {
  const localizeElements = (value: string) => value
    .replace(/\bwood\b/giu, '木')
    .replace(/\bfire\b/giu, '火')
    .replace(/\bearth\b/giu, '土')
    .replace(/\bmetal\b/giu, '金')
    .replace(/\bwater\b/giu, '水')
  const localizedReport = localizeElements(normalized)
  const localizedEvidence = localizeElements(evidence)
  if (localizedReport.includes(localizedEvidence)) return true
  if (!domainSignal.test(localizedReport) || !domainSignal.test(localizedEvidence)) return false

  const chars = [...new Set([...localizedEvidence.replace(/[^\p{Script=Han}A-Za-z0-9]/gu, '')])]
    .filter((char) => !/[的了和与及是为已]/u.test(char))
  if (chars.length < 4) return false
  const present = chars.filter((char) => localizedReport.includes(char)).length
  return present / chars.length >= 0.6
}

function pointConclusionAppears(normalized: string, conclusion: string): boolean {
  if (normalized.includes(conclusion)) return true

  const groups: RegExp[] = []
  if (/[南朝]/u.test(conclusion)) groups.push(/南向|朝南|南侧|南方/u)
  if (/厨房|灶/u.test(conclusion)) groups.push(/厨房|灶/u)
  if (/卫生间|厕所|中宫|中心/u.test(conclusion)) groups.push(/卫生间|厕所|中宫|中心/u)
  if (/入户|阳台|动线|直线/u.test(conclusion)) groups.push(/入户|阳台|动线|直线|贯穿|直冲/u)
  if (/采光|窗|阳台/u.test(conclusion)) groups.push(/采光|窗|阳台|通透|明亮/u)
  if (/日主|命盘|四柱|甲|乙|丙|丁|戊|己|庚|辛|壬|癸/u.test(conclusion)) {
    groups.push(/命盘|日主|四柱|甲木|乙木|丙火|丁火|戊土|己土|庚金|辛金|壬水|癸水/u)
  }
  if (/火性|木性|土性|金性|水性|水湿/u.test(conclusion)) groups.push(/火性|木性|土性|金性|水性|水湿|木|火|土|金|水/u)
  if (/合拍|呼应|支持|加分|相生/u.test(conclusion)) groups.push(/合拍|呼应|支持|加分|相宜|同向|相生/u)
  if (/冲突|削弱|不够合拍|过旺|不稳/u.test(conclusion)) groups.push(/冲突|削弱|不够合拍|过旺|不稳|扣分|留心/u)

  if (/冲突|削弱|不够合拍|过旺|不稳|相冲|相克|扣分/u.test(conclusion)) {
    const segments = normalized
      .split(/[。！？；;\n]+/u)
      .map((segment) => segment.trim())
      .filter(Boolean)
    const conflictSegment = segments.some((segment) => {
      if (!/冲突|削弱|不合拍|不够合拍|过旺|不稳|相冲|相克|扣分|留心/u.test(segment)) return false
      if (/卫生间|厕所|中宫|中心/u.test(conclusion) && !/卫生间|厕所|中宫|中心/u.test(segment)) return false
      if (/厨房|灶/u.test(conclusion) && !/厨房|灶/u.test(segment)) return false
      if (/入户|阳台|动线|直线/u.test(conclusion) && !/入户|阳台|动线|直线|贯穿|直冲/u.test(segment)) return false
      const localHits = groups.filter((pattern) => pattern.test(segment)).length
      return localHits >= Math.min(2, groups.length)
    })
    if (!conflictSegment) return false
  }

  if (groups.length === 0) {
    return evidenceAppears(normalized, conclusion, /(?:命盘|日主|四柱|五行|住宅|房|户型|朝|厨房|卫生间|中宫|采光|窗|阳台|动线|合拍|冲突|呼应|稳定)/u)
  }

  const hits = groups.filter((pattern) => pattern.test(normalized)).length
  return hits >= Math.min(3, groups.length)
}

function pointMatchesSource(point: CompatibilityPoint, record: ReportValidationRecord): boolean {
  if (pointIsAiOnly(point)) return false
  if (point.origin === 'deterministic-rule') return true
  if ((record.evaluatedRules ?? []).some((rule) => rule.versionId === point.ruleVersionId)) return true
  if ((record.citations ?? []).some((citation) => citation.versionId === point.ruleVersionId)) return true
  return Boolean(point.sourceLabel && !/(?:AI传统术数推断|模型推断|非专家库)/u.test(point.sourceLabel))
}

function pointIsRenderedWithEvidence(normalized: string, point: CompatibilityPoint): boolean {
  if (!pointConclusionAppears(normalized, point.conclusion)) return false
  if (point.chartEvidence && !evidenceAppears(normalized, point.chartEvidence, /(?:命盘|日主|四柱|五行|天干|地支|时柱|月令|扶抑)/u)) return false
  if (point.residenceEvidence && !evidenceAppears(normalized, point.residenceEvidence, /(?:住宅|房|户型|朝|门|窗|客厅|卧室|厨房|卫生间|照片|镜头|中宫)/u)) return false
  return true
}

function actionMatchesExpectedKind(action: CompatibilityAction, expectedKind?: CompatibilityActionKind): boolean {
  if (!expectedKind) return true
  if (action.kind !== expectedKind) return false
  const purposePattern = expectedKind === 'amplify' ? AMPLIFY_ACTION_PURPOSE : MITIGATE_ACTION_PURPOSE
  return purposePattern.test(action.intendedEffect)
}

function pointHasActionKind(point: CompatibilityPoint, expectedKind: CompatibilityActionKind): boolean {
  return (point.actions ?? []).some((action) => actionMatchesExpectedKind(action, expectedKind))
}

function pointActionIsRendered(normalized: string, point: CompatibilityPoint, expectedKind?: CompatibilityActionKind): boolean {
  const actions = point.actions ?? []
  if (actions.length === 0) return true
  return actions.some((action) => {
    if (!actionMatchesExpectedKind(action, expectedKind)) return false
    const hasLocation = evidenceAppears(normalized, action.location, /(?:住宅|房|户型|客厅|卧室|厨房|卫生间|入户|门|窗|阳台|玄关|中宫|南侧|北侧|东侧|西侧)/u)
    const hasAction = evidenceAppears(normalized, action.action, /(?:建议|可以|保留|避免|减少|调整|保持|优先|移开|形成|不要|先)/u)
      || ACTION_VERB.test(normalized) && normalized.includes(action.action.slice(0, Math.min(8, action.action.length)))
    const hasPurpose = evidenceAppears(normalized, action.intendedEffect, /(?:放大|减少|缓解|稳定|通透|采光|冲突|优点|缺点|影响|火气|动线|湿气)/u)
    return hasLocation && hasAction && hasPurpose
  })
}

function hasUsefulConsumerAction(normalized: string): boolean {
  return normalized
    .split(/[。！？；;\n]+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .some((sentence) =>
      ACTION_TARGET.test(sentence) &&
      ACTION_VERB.test(sentence) &&
      ACTION_PURPOSE.test(sentence) &&
      !GENERIC_HYGIENE_ONLY_SENTENCE.test(sentence),
    )
}

function pendingFillerSentenceCount(normalized: string): number {
  return normalized
    .split(/[。！？；;\n]+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => PENDING_FILLER_PHRASE.test(sentence))
    .length
}

function userActionSectionCount(normalized: string): number {
  return [...normalized.matchAll(USER_ACTION_SECTION_TITLE)].length
}

function hasAffirmativeSouthBalconyMention(text: string): boolean {
  return text
    .split(/[。！？；;\n]+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .some((sentence) => SOUTH_BALCONY_MENTION.test(sentence) && !NEGATED_SPATIAL_FACT.test(sentence))
}

function hasSouthBalconyEvidence(record: ReportValidationRecord): boolean {
  const evidenceText = [
    record.submission?.residence?.layoutNote,
    record.vision?.map((observation) => [
      observation.summary,
      ...(observation.observedElements ?? []),
      ...(observation.facts ?? []).map((fact) => fact.evidence),
    ].join('。')).join('。'),
  ].filter(Boolean).join('。')
  return hasAffirmativeSouthBalconyMention(evidenceText)
}

function validateSpatialAttribution(normalized: string, record: ReportValidationRecord, reasons: string[]): void {
  if (hasAffirmativeSouthBalconyMention(normalized) && !hasSouthBalconyEvidence(record)) {
    reasons.push('report claims a south balcony without supporting residence or vision evidence')
  }
}

function validateSemanticCompatibility(normalized: string, record: ReportValidationRecord, reasons: string[]): void {
  const compatibility = record.compatibility
  if (!compatibility) return

  if (!compatibility.assessable) {
    if (!INSUFFICIENT_EVIDENCE_CONCLUSION.test(normalized)) {
      reasons.push('unassessable report must explicitly state insufficient evidence')
    }
    if (STRONG_COMPATIBILITY_CONCLUSION.test(normalized)) {
      reasons.push('unassessable report contains a strong compatibility conclusion')
    }
    if (HIGH_CONFIDENCE_CLAIM.test(normalized)) {
      reasons.push('unassessable report claims high confidence')
    }
    return
  }

  if (!hasExplicitOverallConclusion(normalized, compatibility.overallLevel)) {
    reasons.push('assessable report missing explicit overall compatibility conclusion')
  }
  if (!CONCLUSION_FIRST_PREFIX.test(normalized)) {
    reasons.push('assessable report must start with 结论先说')
  }
  if (CONSUMER_UNHELPFUL_SECTION.test(normalized)) {
    reasons.push('assessable report contains user-unhelpful template sections')
  }
  if (USER_FACING_PENDING_SECTION.test(normalized)) {
    reasons.push('assessable report contains a user-facing pending-information section')
  }
  if (BACKOFFICE_SOURCE_SECTION.test(normalized)) {
    reasons.push('assessable report contains a back-office source or version section')
  }
  if (userActionSectionCount(normalized) === 0) {
    reasons.push('assessable report missing the 可以先这样做 section')
  }
  if (userActionSectionCount(normalized) > 1) {
    reasons.push('report repeats consumer action section')
  }
  if (pendingFillerSentenceCount(normalized) > 1) {
    reasons.push('assessable report overuses pending-information filler')
  }

  const renderedPositivePoints = compatibility.positiveMatches.filter((point) =>
    point.chartEvidence &&
    point.residenceEvidence &&
    pointIsRenderedWithEvidence(normalized, point),
  )
  const renderedConflictPoints = compatibility.conflicts.filter((point) =>
    point.chartEvidence &&
    point.residenceEvidence &&
    pointIsRenderedWithEvidence(normalized, point),
  )
  const renderedEvidencePoints = [...renderedPositivePoints, ...renderedConflictPoints]
  if (!renderedEvidencePoints.length) {
    reasons.push('assessable report missing a compatibility point with chart evidence, residence evidence and source basis')
  }
  if (compatibility.positiveMatches.length > 0 && renderedPositivePoints.length === 0) {
    reasons.push('assessable report missing a core positive compatibility point')
  }
  if (compatibility.conflicts.length > 0 && renderedConflictPoints.length === 0) {
    reasons.push('assessable report missing a core compatibility conflict')
  }

  const points = [...compatibility.positiveMatches, ...compatibility.conflicts]
  const sourceBackedPoint = points.find((point) => pointIsRenderedWithEvidence(normalized, point) && pointMatchesSource(point, record))
  const hasDirectPublishedCompatibilityEvidence = (record.evaluatedRules ?? []).some((rule) =>
    rule.conclusions.some((conclusion) => {
      const effect = conclusion.effect ?? (conclusion.level === 'info' ? 'supportive' : 'conflict')
      return effect === 'supportive' || effect === 'conflict'
    }),
  )
  if (hasDirectPublishedCompatibilityEvidence && !sourceBackedPoint) {
    reasons.push('assessable report relies only on AI inference despite available published evidence')
  }

  if (points.length > 0 && EMPTY_COMPATIBILITY_TALK.test(normalized) && !renderedEvidencePoints.length) {
    reasons.push('assessable report contains only generic compatibility filler')
  }

  if (!ACTION_VERB.test(normalized) || !ACTION_TARGET.test(normalized)) {
    reasons.push('report missing a concrete user action')
  }
  if (!hasUsefulConsumerAction(normalized)) {
    reasons.push('report missing a useful consumer action with location, action and purpose')
  }
  const renderedPointWithAction = renderedEvidencePoints.find((point) => pointActionIsRendered(normalized, point))
  if (points.some((point) => (point.actions?.length ?? 0) > 0) && !renderedPointWithAction) {
    reasons.push('report missing an action tied to a compatibility point')
  }
  if (compatibility.positiveMatches.some((point) => pointHasActionKind(point, 'amplify'))
    && !renderedPositivePoints.some((point) => pointActionIsRendered(normalized, point, 'amplify'))) {
    reasons.push('report missing an amplify action tied to a core positive compatibility point')
  }
  if (compatibility.conflicts.some((point) => pointHasActionKind(point, 'mitigate'))
    && !renderedConflictPoints.some((point) => pointActionIsRendered(normalized, point, 'mitigate'))) {
    reasons.push('report missing a mitigation action tied to a core compatibility conflict')
  }
}

/**
 * Fail closed before a model-authored report leaves the API boundary.
 * This validator checks semantic grounding, readability and high-stakes safety; it does not attempt
 * to replace editorial review or infer facts that were not in the input.
 */
export function validateGeneratedReport(report: string, record: ReportValidationRecord): string {
  const normalized = report.trim()
  const reasons: string[] = []

  if (normalized.length === 0) reasons.push('report is empty')
  if (normalized.length > 0 && !READABLE_CHINESE_PROSE.test(normalized)) reasons.push('report is not readable Chinese prose')
  if (GENERIC_REPORT_PREFACE.test(normalized)) reasons.push('report starts with a generic AI-style preface')
  if (!normalized.includes(CULTURAL_USE_NOTICE)) reasons.push('missing exact cultural-use notice')
  if (ACTIONABLE_HIGH_STAKES_ADVICE.test(normalized)) reasons.push('contains actionable high-stakes advice')
  if (CERTAIN_HIGH_STAKES_PREDICTION.test(normalized)) reasons.push('contains a certain high-stakes prediction')
  if (HIGH_RISK_ACTION.test(normalized)) reasons.push('contains a high-risk housing alteration')
  if (CERTAIN_FORTUNE_ACTION.test(normalized)) reasons.push('promises a certain outcome from a housing suggestion')
  if (CODE_FENCE.test(normalized)) reasons.push('contains a code fence')
  if (PLAIN_CODE_LINE.test(normalized)) reasons.push('contains plain source code')
  if (JSON_OBJECT_LINE.test(normalized)) reasons.push('contains a JSON object')
  if (HTML_TAG.test(normalized)) reasons.push('contains HTML markup')
  if (MARKDOWN_TABLE_LINE.test(normalized)) reasons.push('contains a Markdown table')
  if (INTERNAL_FIELD_LEAK.test(normalized)) reasons.push('contains internal implementation fields')
  if (CONSUMER_PROCESS_LANGUAGE.test(normalized)) reasons.push('contains consumer-facing process language')
  if (USER_FACING_INTERNAL_ANALYSIS_LANGUAGE.test(normalized)) reasons.push('contains user-facing internal analysis terminology')
  if (UUID_TOKEN.test(normalized) || INTERNAL_VERSION_TOKEN.test(normalized)) reasons.push('contains internal technical identifiers')
  if ((record.bazi?.pillars?.length ?? 0) === 4 && FALSE_MISSING_BIRTH_HOUR.test(normalized)) {
    reasons.push('claims birth hour is missing despite a complete four-pillar chart')
  }
  if (record.bazi?.assessments?.elementPreference?.status === 'derived' && CERTAIN_ELEMENT_PREFERENCE.test(normalized)) {
    reasons.push('turns element-preference candidates into certain favorable or unfavorable gods')
  }
  const strength = record.bazi?.assessments?.strength
  if (strength?.provenance?.ruleSetVersion === 'baseline-v1' && CERTAIN_STRENGTH.test(normalized)) {
    reasons.push('turns support-balance baseline into a certain strength conclusion')
  }
  if (record.bazi?.assessments?.pattern?.status !== 'derived' && CERTAIN_PATTERN.test(normalized)) {
    reasons.push('asserts a certain pattern without a derived pattern assessment')
  }

  const assessments = record.bazi?.assessments
  if (assessments) {
    validateProfessionalAssessment(normalized, 'strength', assessments.strength, reasons)
    validateProfessionalAssessment(normalized, 'pattern', assessments.pattern, reasons)
    if (assessments.elementPreference) {
      validateProfessionalAssessment(normalized, 'elementPreference', assessments.elementPreference, reasons)
    }
    validateProfessionalAssessment(normalized, 'shenSha', assessments.shenSha, reasons)
  }
  validateSemanticCompatibility(normalized, record, reasons)
  validateSpatialAttribution(normalized, record, reasons)

  if (reasons.length > 0) throw new ReportValidationError(reasons)
  return normalized
}
