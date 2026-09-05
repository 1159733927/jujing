#!/usr/bin/env node
import { parseDemoNetworkConfig } from './dev-demo.mjs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export class ReportE2eSmokeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ReportE2eSmokeError'
  }
}

export const CURRENT_REPORT_VALIDATOR_VERSION = 'generated-report-validator-v18-consumer-action-gate'
const PLAIN_CODE_LINE = /(?:^|\n)\s*(?:import\s+[\w*{]|export\s+(?:const|function|class|default|type|interface)|(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(|class\s+[A-Za-z_$][\w$]*\s*[{<]|interface\s+[A-Za-z_$][\w$]*\s*[{<]|type\s+[A-Za-z_$][\w$]*\s*=|return\s+(?:\{|\(|["']))/u
const CONSUMER_PROCESS_LANGUAGE = /(?:程序事实|程序口径|程序给出|程序显示|服务端|视觉分析|结构化(?:判断|数据|基线)|生成过程|测试档案|测试数据|QA|provenance|validator|pipeline|prompt|schema|审核\s*Agent|质检\s*Agent|模型推断|AI\s*传统术数推断|非专家库)/iu
const USER_FACING_INTERNAL_ANALYSIS_LANGUAGE = /(?:扶抑基线|程序合参基线|人宅合参演示基线|候选方向|候选补益方向|候选平衡方向|补益方向)/u
const HTML_TAG = /<\/?[a-z][\w:-]*(?:\s+[^<>]*)?>/iu
const MARKDOWN_TABLE_LINE = /(?:^|\n)\s*\|[^|\n]+(?:\|[^|\n]+)+\|\s*(?:$|\n)/u
const GENERIC_REPORT_PREFACE = /^(?:以下是|下面是|这是|本文将|本报告将|为您出具|本次报告将)/u
const CONCLUSION_FIRST_OPENING = /^结论先说[:：]/u
const BACKOFFICE_SECTION_TITLE = /(?:^|\n)\s*#{1,6}\s*(?:判断前提与可信度|命盘需要|住宅属性|依据与版本|引用依据|资料来源|资料清单|规则清单|版本清单|待确认信息|证据不足清单)\s*(?:\n|$)/u
const USER_ACTION_SECTION = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(?:可以先这样做|你可以先这样做|建议先这样做|先做这几件事|接下来可以这样做)(?:\*\*)?\s*[:：]?\s*(?:\n|$)/u
const USER_ACTION_SECTION_TITLE = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(?:可以先这样做|你可以先这样做|建议先这样做|先做这几件事|接下来可以这样做)(?:\*\*)?\s*[:：]?\s*(?:\n|$)/gu
const DEFAULT_REPORT_E2E_TIMEOUT_MS = 900_000
const DEFAULT_REPORT_E2E_WEB_ORIGIN = 'http://127.0.0.1:4173'
const DEMO_IMAGE_URL = new URL('../8029.jpg', import.meta.url)
const DANGEROUS_CHANGE = /(?:拆|砸|敲)(?:除|掉)?(?:承重)?墙|拆改(?:墙体|承重|燃气|水电)|封(?:死)?(?:入户)?门|迁(?:移)?灶|改(?:动)?燃气管|破土动工/u
const NEGATED_DANGEROUS_CHANGE = /(?:不|别|勿|无须|无需|禁止|避免|不建议|不要|不可|不涉及|不需要|不会|不能)[^。！？；;\n]{0,16}(?:拆|砸|敲|拆改|封(?:死)?(?:入户)?门|迁(?:移)?灶|改(?:动)?燃气管|破土动工)|不拆不改/u
const GUARANTEED_OUTCOME = /(?<!不)(?<!并不)(?:保证|确保|必然|一定|百分之百).{0,10}(?:转运|改运|招财|旺财|旺运|化煞|消灾|升职|发财)|(?:转运|改运|招财|旺财|旺运|化煞).{0,8}(?:立刻|马上|必定|一定见效)/u
const SPECIFIC_LOCATION = /客厅|卧室|主卧|次卧|厨房|卫生间|洗手间|入户(?:门)?|玄关|书房|阳台|餐厅|床头|灶台|窗户|门口|中宫|中央区域/u
const ACTION_VERB = /调整|保留|保持|使用|选择|避开|减少|加强|增加|补充|移开|布置|放置|摆放|遮挡|关闭|关上|修复|收纳|除湿|照明/u
const ACTION_PURPOSE = /放大|增强|加强|保持|延续|利用|减少|减轻|降低|缓解|改善|避免|稳定|平衡|削弱|化解|目的\s*[:：]/u
const AMPLIFY_ACTION_PURPOSE = /放大|增强|加强|保持|延续|利用|保留.{0,12}(?:优势|优点|加分|呼应)|目的\s*[:：][^。；\n]{0,48}(?:加分|优点|呼应|采光|通透|明亮|生发|立得住|进入|服务)/u
const MITIGATE_ACTION_PURPOSE = /减少|减轻|降低|缓解|改善|避免|稳定|平衡|削弱|化解|压低|压住|减弱|降到最低|目的\s*[:：][^。；\n]{0,48}(?:降低|降到最低|减弱|压低|压住|湿气|杂乱|直冲|直泄|燥乱|冲突)/u
const GENERIC_HYGIENE_ONLY = /^(?:建议|可以|可)?(?:在|把|将)?(?:东侧|西侧|南侧|北侧|中央|中间)?(?:客厅|卧室|主卧|次卧|厨房|卫生间|洗手间|入户门?|玄关|书房|阳台|餐厅|床头|灶台|窗户|门口|中宫|中央区域)?(?:保持)?(?:清洁|整洁|干燥|通风|清洁通风|通风干燥|干燥整洁|明亮整洁)(?:即可|就好|。)?$/u
const SOUTH_BALCONY_MENTION = /(?:南(?:侧|向|方)[^\n。；;，,]{0,16}阳台|阳台[^\n。；;，,]{0,16}(?:在|位于|处于|朝|向|靠)?南(?:侧|向|方)?)/u
const NEGATED_SPATIAL_FACT = /(?:不|未|无|没有|不能|无法|不得|不可|缺少|看不出|待确认|需要确认|不能推断|不要推断)/u

function normalizedText(value) {
  return String(value ?? '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
}

function distinctiveCjkTerms(value) {
  const cleaned = String(value ?? '')
    .replace(/程序|结果|显示|命盘|住宅|依据|资料|事实|当前|传统|方向|候选|结论|需要|相关|已经|确认/gu, ' ')
  const terms = cleaned.match(/[\p{Script=Han}]{2,12}/gu) ?? []
  return terms
    .flatMap((term) => term.length <= 6 ? [term] : Array.from({ length: term.length - 3 }, (_, index) => term.slice(index, index + 4)))
    .filter((term) => term.length >= 2)
}

function reportContainsEvidence(reportText, evidence) {
  const normalizedReport = normalizedText(reportText)
  return distinctiveCjkTerms(evidence).some((term) => normalizedReport.includes(normalizedText(term)))
}

function hasUsefulRenderedAction(text, expectedKind) {
  return usefulRenderedActionCount(text, expectedKind) > 0
}

function usefulRenderedActionCount(text, expectedKind) {
  const purpose = expectedKind === 'amplify'
    ? AMPLIFY_ACTION_PURPOSE
    : expectedKind === 'mitigate'
      ? MITIGATE_ACTION_PURPOSE
      : ACTION_PURPOSE
  const listItemCandidates = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*•]|\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/u.test(line))
  const sentenceCandidates = text.split(/[。！？；;\n]+/u)
  return [...listItemCandidates, ...sentenceCandidates]
    .map((sentence) => sentence.trim().replace(/^(?:[-*•]|\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/u, ''))
    .filter(Boolean)
    .filter((sentence) => SPECIFIC_LOCATION.test(sentence)
      && ACTION_VERB.test(sentence)
      && purpose.test(sentence)
      && !GENERIC_HYGIENE_ONLY.test(sentence))
    .length
}

function userActionSectionCount(text) {
  return [...String(text ?? '').matchAll(USER_ACTION_SECTION_TITLE)].length
}

function hasAffirmativeSouthBalconyMention(text) {
  return String(text ?? '')
    .split(/[。！？；;\n]+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .some((sentence) => SOUTH_BALCONY_MENTION.test(sentence) && !NEGATED_SPATIAL_FACT.test(sentence))
}

function hasSouthBalconyEvidence(report) {
  const evidenceText = [
    report?.submission?.residence?.layoutNote,
    Array.isArray(report?.submission?.photos)
      ? report.submission.photos.map((photo) => photo?.room === 'balcony' ? `${photo.note ?? ''} ${photo.facing ?? ''}` : '').join('。')
      : '',
    Array.isArray(report?.vision)
      ? report.vision.map((observation) => [
        observation?.summary,
        ...(Array.isArray(observation?.observedElements) ? observation.observedElements : []),
        ...(Array.isArray(observation?.facts) ? observation.facts.map((fact) => fact?.evidence) : []),
      ].join('。')).join('。')
      : '',
  ].filter(Boolean).join('。')
  return hasAffirmativeSouthBalconyMention(evidenceText)
}

function hasRenderedStructuredAction(text, point, expectedKind) {
  const actions = Array.isArray(point?.actions)
    ? point.actions.filter((action) => action?.kind === expectedKind)
    : []
  const purposePattern = expectedKind === 'amplify' ? AMPLIFY_ACTION_PURPOSE : MITIGATE_ACTION_PURPOSE
  const pointIsDiscussed = reportContainsEvidence(text, point?.conclusion) || reportContainsEvidence(text, point?.residenceEvidence)
  if (!pointIsDiscussed || !purposePattern.test(text)) return false
  return actions.some((action) =>
    reportContainsEvidence(text, action.location) ||
    reportContainsEvidence(text, action.action),
  )
}

function recommendsDangerousChange(text) {
  return text
    .split(/[。！？；;\n]+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .some((sentence) => DANGEROUS_CHANGE.test(sentence) && !NEGATED_DANGEROUS_CHANGE.test(sentence))
}

function hasExplicitCompatibilityConclusion(text, level) {
  const opening = text.slice(0, 900)
  const mentionsCompatibility = /人宅|命盘.{0,12}(?:住宅|房子|这套房|房屋)|(?:住宅|房子|这套房|房屋).{0,12}命盘/u.test(opening)
  const terms = {
    supportive: /(?:整体|总体|综合)?.{0,8}(?:较为|比较|基本|整体)?合拍|(?:整体|总体|综合)?.{0,8}(?:适合|相合|匹配)/u,
    conflict: /(?:整体|总体|综合)?.{0,8}(?:不合拍|不适合|相冲|冲突明显)/u,
    mixed: /(?:大体|总体|整体|基本|局部)合拍.{0,80}(?:短板|问题|冲突|不利|扣分|拧点|需(?:要)?(?:留意|打理))|有合拍.{0,24}(?:冲突|不利|拧点)|既有.{0,16}(?:呼应|相合|加分).{0,40}(?:也有|但有|同时有|另有).{0,24}(?:冲突|不利|减分|扣分|拧点|需(?:要)?(?:留意|打理))|利弊并存/u,
    neutral: /(?:整体|总体|综合)?.{0,8}(?:中性|无明显冲突|无明显相合)/u,
  }
  return mentionsCompatibility && (terms[level]?.test(opening) ?? false)
}

function apiOriginFromEnv(env = process.env) {
  const network = parseDemoNetworkConfig(env)
  return `http://${network.api.host}:${network.api.port}`
}

function webOriginFromEnv(env = process.env) {
  const origin = env.REPORT_E2E_WEB_ORIGIN == null || env.REPORT_E2E_WEB_ORIGIN === ''
    ? DEFAULT_REPORT_E2E_WEB_ORIGIN
    : String(env.REPORT_E2E_WEB_ORIGIN)
  return origin.replace(/\/+$/u, '')
}

export function buildReportShareUrl({ webOrigin = DEFAULT_REPORT_E2E_WEB_ORIGIN, reportId, token }) {
  if (typeof reportId !== 'string' || reportId === '') throw new ReportE2eSmokeError('share response is missing report id')
  if (typeof token !== 'string' || token === '') throw new ReportE2eSmokeError('share response is missing access token')
  return `${String(webOrigin).replace(/\/+$/u, '')}/shared-report/${reportId}#access=${encodeURIComponent(token)}`
}

function parsePositiveInteger(name, rawValue, defaultValue) {
  const value = rawValue == null || rawValue === '' ? String(defaultValue) : String(rawValue)
  if (!/^\d+$/u.test(value)) throw new ReportE2eSmokeError(`${name} must be a positive integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new ReportE2eSmokeError(`${name} must be a positive integer`)
  return parsed
}

function parseOptionalPositiveInteger(name, rawValue) {
  if (rawValue == null || rawValue === '') return undefined
  return parsePositiveInteger(name, rawValue, rawValue)
}

async function fetchJson(fetchFn, url, options = {}) {
  const response = await fetchFn(url, options)
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = { raw: text }
  }
  return { response, payload }
}

function isReportE2eTerminal(report) {
  if (report?.status === 'failed') return true
  return report?.status === 'completed' && (report.qualityStatus === 'passed' || report.qualityStatus === 'failed')
}

function reportPollLabel(report) {
  return `${report?.status ?? '-'}/${report?.phase ?? '-'} quality=${report?.qualityStatus ?? '-'}`
}

export function assertHumanReadableReport(report, expectedBindings = {}) {
  const text = String(report.report ?? '')
  if (report.status !== 'completed') throw new ReportE2eSmokeError(`report ended with status ${report.status}`)
  if (report.qualityStatus !== 'passed') {
    throw new ReportE2eSmokeError(`completed report quality review did not pass: ${report.qualityStatus ?? 'missing'}`)
  }
  if (text.trim().length < 180) throw new ReportE2eSmokeError('completed report is too short for investor demo smoke')
  if (/```/u.test(text)) throw new ReportE2eSmokeError('completed report contains a code fence')
  if (GENERIC_REPORT_PREFACE.test(text.trim())) throw new ReportE2eSmokeError('completed report starts with a generic AI-style preface')
  if (!CONCLUSION_FIRST_OPENING.test(text.trim())) throw new ReportE2eSmokeError('completed report does not open with a direct consumer conclusion')
  if (BACKOFFICE_SECTION_TITLE.test(text)) throw new ReportE2eSmokeError('completed report exposes a back-office source or pending checklist section')
  if (userActionSectionCount(text) > 1) throw new ReportE2eSmokeError('completed report repeats its consumer action section')
  if (PLAIN_CODE_LINE.test(text)) throw new ReportE2eSmokeError('completed report contains plain source code')
  if (CONSUMER_PROCESS_LANGUAGE.test(text)) throw new ReportE2eSmokeError('completed report contains consumer-facing process language')
  if (USER_FACING_INTERNAL_ANALYSIS_LANGUAGE.test(text)) throw new ReportE2eSmokeError('completed report contains internal analysis terminology')
  if (/^\s*[\[{]/u.test(text)) throw new ReportE2eSmokeError('completed report looks like raw JSON instead of prose')
  if (HTML_TAG.test(text)) throw new ReportE2eSmokeError('completed report contains HTML markup')
  if (MARKDOWN_TABLE_LINE.test(text)) throw new ReportE2eSmokeError('completed report contains a Markdown table')
  if (recommendsDangerousChange(text)) throw new ReportE2eSmokeError('completed report recommends a dangerous structural change')
  if (GUARANTEED_OUTCOME.test(text)) throw new ReportE2eSmokeError('completed report promises a guaranteed fengshui outcome')
  if (hasAffirmativeSouthBalconyMention(text) && !hasSouthBalconyEvidence(report)) {
    throw new ReportE2eSmokeError('completed report claims a south balcony without supporting residence or vision evidence')
  }
  const provenance = report.generationProvenance
  if (!provenance || typeof provenance !== 'object') {
    throw new ReportE2eSmokeError('completed report is missing generation provenance')
  }
  if (provenance.validatorVersion !== CURRENT_REPORT_VALIDATOR_VERSION || provenance.validatorResult !== 'pass') {
    throw new ReportE2eSmokeError('completed report did not use the current human-readable validator')
  }
  if (!Array.isArray(report.vision) || report.vision.length < 1) {
    throw new ReportE2eSmokeError('completed report is missing image observation evidence')
  }
  const compatibility = report.compatibility
  if (!compatibility || typeof compatibility !== 'object') {
    throw new ReportE2eSmokeError('completed report is missing professional compatibility reasoning')
  }
  if (compatibility.assessable !== true) {
    throw new ReportE2eSmokeError('demo report did not reach an assessable person-house conclusion')
  } else {
    const points = [
      ...(Array.isArray(compatibility.positiveMatches) ? compatibility.positiveMatches : []),
      ...(Array.isArray(compatibility.conflicts) ? compatibility.conflicts : []),
    ]
    if (points.length < 1) {
      throw new ReportE2eSmokeError('assessable report has no concrete compatibility points')
    }
    if (!hasExplicitCompatibilityConclusion(text, compatibility.overallLevel)) {
      throw new ReportE2eSmokeError('completed report is missing a clear overall person-house compatibility conclusion')
    }
    for (const [index, point] of points.entries()) {
      if (!point || typeof point !== 'object'
        || typeof point.conclusion !== 'string' || !point.conclusion.trim()
        || typeof point.chartEvidence !== 'string' || !point.chartEvidence.trim()
        || typeof point.residenceEvidence !== 'string' || !point.residenceEvidence.trim()
        || typeof point.ruleTitle !== 'string' || !point.ruleTitle.trim()) {
        throw new ReportE2eSmokeError(`compatibility point ${index} is missing concrete chart, residence or source evidence`)
      }
    }
    if (!points.some((point) => reportContainsEvidence(text, point.chartEvidence))) {
      throw new ReportE2eSmokeError('completed report does not explain a concrete chart fact')
    }
    if (!points.some((point) => reportContainsEvidence(text, point.residenceEvidence))) {
      throw new ReportE2eSmokeError('completed report does not explain a concrete residence fact')
    }
    if (!hasUsefulRenderedAction(text)) {
      throw new ReportE2eSmokeError('completed report has no specific action that amplifies a strength or mitigates a conflict')
    }
    if (!USER_ACTION_SECTION.test(text) || usefulRenderedActionCount(text) < 2) {
      throw new ReportE2eSmokeError('completed report does not give at least two concrete consumer actions')
    }
    const positivesWithAmplifyActions = (Array.isArray(compatibility.positiveMatches) ? compatibility.positiveMatches : [])
      .filter((point) => Array.isArray(point.actions) && point.actions.some((action) => action?.kind === 'amplify'))
    const conflictsWithMitigationActions = (Array.isArray(compatibility.conflicts) ? compatibility.conflicts : [])
      .filter((point) => Array.isArray(point.actions) && point.actions.some((action) => action?.kind === 'mitigate'))
    if (positivesWithAmplifyActions.length > 0 && !positivesWithAmplifyActions.some((point) => hasRenderedStructuredAction(text, point, 'amplify'))) {
      throw new ReportE2eSmokeError('completed report has no specific action that amplifies a core positive match')
    }
    if (conflictsWithMitigationActions.length > 0 && !conflictsWithMitigationActions.some((point) => hasRenderedStructuredAction(text, point, 'mitigate'))) {
      throw new ReportE2eSmokeError('completed report has no specific action that mitigates a core conflict')
    }
  }
  if (!Array.isArray(report.citations) || report.citations.length < 1) throw new ReportE2eSmokeError('completed report has no citations')
  if (!Array.isArray(report.evaluatedRules) || report.evaluatedRules.length < 1) throw new ReportE2eSmokeError('completed report has no evaluated rules')
  if (!Array.isArray(report.qualityReviews) || report.qualityReviews.length < 1) throw new ReportE2eSmokeError('completed report has no quality review')
  if (report.qualityReviews.some((review, index) => review?.schemaVersion !== 'report-quality-review-v1' || review.attempt !== index)) {
    throw new ReportE2eSmokeError('completed report has an invalid quality review chain')
  }
  const finalReview = report.qualityReviews.at(-1)
  if (finalReview?.verdict !== 'pass') throw new ReportE2eSmokeError('completed report did not pass its final quality review')
  if (!Number.isFinite(finalReview?.score) || finalReview.score < 80) {
    throw new ReportE2eSmokeError('completed report final quality score is below 80')
  }
  if (report.qualityReviews.length > 2 || report.revisionCount !== report.qualityReviews.length - 1) {
    throw new ReportE2eSmokeError('completed report exceeded the one-revision quality workflow')
  }
  if (report.chartProfileId !== expectedBindings.chartProfileId || report.chartVersionId !== expectedBindings.chartVersionId) {
    throw new ReportE2eSmokeError('completed report chart identifiers do not match the submitted chart chain')
  }
  if (typeof report.chartProfileId !== 'string' || typeof report.chartVersionId !== 'string') {
    throw new ReportE2eSmokeError('completed report is missing chart version identifiers')
  }
  if (report.residenceProfileId !== expectedBindings.residenceProfileId || report.residenceVersionId !== expectedBindings.residenceVersionId) {
    throw new ReportE2eSmokeError('completed report residence identifiers do not match the submitted residence chain')
  }
  if (typeof report.residenceProfileId !== 'string' || typeof report.residenceVersionId !== 'string') {
    throw new ReportE2eSmokeError('completed report is missing residence version identifiers')
  }
}

export async function runReportE2eSmoke({
  env = process.env,
  fetchFn = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  if (env.RUN_REPORT_E2E !== '1') {
    log('[report-e2e] skipped: set RUN_REPORT_E2E=1 to call the real Harness report pipeline')
    return { skipped: true }
  }

  const apiOrigin = apiOriginFromEnv(env)
  // A real run may include generation, independent review and at most one revision.
  const intervalMs = parsePositiveInteger('REPORT_E2E_POLL_INTERVAL_MS', env.REPORT_E2E_POLL_INTERVAL_MS, 5_000)
  const timeoutMs = parsePositiveInteger('REPORT_E2E_TIMEOUT_MS', env.REPORT_E2E_TIMEOUT_MS, DEFAULT_REPORT_E2E_TIMEOUT_MS)
  const explicitAttemptLimit = parseOptionalPositiveInteger('REPORT_E2E_POLL_ATTEMPTS', env.REPORT_E2E_POLL_ATTEMPTS)

  const ready = await fetchJson(fetchFn, `${apiOrigin}/ready/report`)
  if (ready.response.status !== 200 || ready.payload.status !== 'ready') {
    throw new ReportE2eSmokeError('report readiness is not ready; refusing to spend a model call')
  }

  const activeProfiles = await fetchJson(fetchFn, `${apiOrigin}/v1/bazi-rule-profile-versions/active`)
  const ruleProfileVersionId = Array.isArray(activeProfiles.payload)
    ? activeProfiles.payload.find((profile) => profile?.key === 'demo-traditional-solar-time')?.versionId
    : undefined
  if (activeProfiles.response.status !== 200 || typeof ruleProfileVersionId !== 'string') {
    throw new ReportE2eSmokeError('current demo bazi rule profile is unavailable')
  }

  const demoImage = await readFile(DEMO_IMAGE_URL)
  const upload = new FormData()
  upload.append('image', new Blob([demoImage], { type: 'image/jpeg' }), '8029.jpg')
  const media = await fetchJson(fetchFn, `${apiOrigin}/v1/media`, {
    method: 'POST',
    headers: { 'x-vision-consent': 'accepted' },
    body: upload,
  })
  if (media.response.status !== 201 || typeof media.payload.fileId !== 'string') {
    throw new ReportE2eSmokeError(`media upload failed with HTTP ${media.response.status}`)
  }
  const cookie = media.response.headers.get('set-cookie')?.split(';')[0] ?? ''
  if (!cookie) throw new ReportE2eSmokeError('media upload did not establish an anonymous owner session')
  log('[report-e2e] uploaded demo image')

  const created = await fetchJson(fetchFn, `${apiOrigin}/v1/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      visionConsent: true,
      ruleProfileVersionId,
      birth: { date: '1992-08-18', time: '09:30', placeCode: '330106' },
      residence: {
        facing: 'south',
         layoutNote: '8029 单套户型图：图面上北下南；入户门在东南侧；客厅在东侧；书房在北侧；餐厅在南侧偏东；厨房在南侧凸出；卫生间靠近中宫。已知住宅信息确认整体朝南。',
      },
      floorPlan: {
        boundary: { x: 0, y: 0, width: 1000, height: 800 },
        orientation: { northUp: true, evidenceRef: '8029:plan:north-up' },
        rooms: [
          {
            id: 'kitchen',
            kind: 'kitchen',
            label: '厨房',
            center: { x: 500, y: 720 },
            evidenceRef: '8029:plan:kitchen-center',
          },
          {
            id: 'bathroom',
            kind: 'bathroom',
            label: '卫生间',
            center: { x: 520, y: 420 },
            evidenceRef: '8029:plan:bathroom-center',
          },
        ],
      },
      photos: [{
        fileId: media.payload.fileId,
        room: 'overview',
        facing: 'unknown',
        note: '全屋户型图，图面上北下南；这是 8029 这一套住宅的平面证据，不是客厅实拍，不能推断南侧阳台或自然采光。',
      }],
    }),
  })
  if (created.response.status !== 202 || typeof created.payload.id !== 'string' || typeof created.payload.chartProfileId !== 'string' || typeof created.payload.chartVersionId !== 'string' || typeof created.payload.residenceProfileId !== 'string' || typeof created.payload.residenceVersionId !== 'string') {
    throw new ReportE2eSmokeError(`report creation failed with HTTP ${created.response.status}`)
  }
  log(`[report-e2e] created report ${created.payload.id}`)

  let latest = created.payload
  const startedAt = now()
  for (let attempt = 1; !isReportE2eTerminal(latest); attempt += 1) {
    if (explicitAttemptLimit != null && attempt > explicitAttemptLimit) {
      const elapsedSeconds = Math.ceil((now() - startedAt) / 1000)
      throw new ReportE2eSmokeError(
        `report ${created.payload.id} is still ${reportPollLabel(latest)} after ${elapsedSeconds}s; ` +
        `REPORT_E2E_POLL_ATTEMPTS limited polling to ${explicitAttemptLimit} attempts.`,
      )
    }

    const remainingMs = timeoutMs - (now() - startedAt)
    if (remainingMs <= 0) {
      const elapsedSeconds = Math.ceil((now() - startedAt) / 1000)
      throw new ReportE2eSmokeError(
        `report ${created.payload.id} is still ${reportPollLabel(latest)} after ${elapsedSeconds}s; ` +
        'the Harness call may still finish asynchronously, increase REPORT_E2E_TIMEOUT_MS or query the report later with the same browser cookie.',
      )
    }

    await sleep(Math.min(intervalMs, remainingMs))
    const polled = await fetchJson(fetchFn, `${apiOrigin}/v1/reports/${created.payload.id}`, {
      headers: cookie ? { cookie } : {},
    })
    if (polled.response.status !== 200) throw new ReportE2eSmokeError(`report poll failed with HTTP ${polled.response.status}`)
    latest = polled.payload
    log(`[report-e2e] poll ${attempt}: ${reportPollLabel(latest)}`)
  }

  if (latest.status === 'failed') {
    throw new ReportE2eSmokeError(`report ${created.payload.id} failed: ${latest.error ?? latest.phase ?? 'unknown error'}`)
  }
  if (latest.qualityStatus === 'failed') {
    throw new ReportE2eSmokeError(`report ${created.payload.id} completed but quality review failed: ${latest.qualityError ?? 'qualityStatus=failed'}`)
  }

  assertHumanReadableReport(latest, {
    chartProfileId: created.payload.chartProfileId,
    chartVersionId: created.payload.chartVersionId,
    residenceProfileId: created.payload.residenceProfileId,
    residenceVersionId: created.payload.residenceVersionId,
  })

  const shared = await fetchJson(fetchFn, `${apiOrigin}/v1/reports/${created.payload.id}/share`, {
    method: 'POST',
    headers: { cookie },
  })
  if (shared.response.status !== 200 || typeof shared.payload.token !== 'string' || shared.payload.token === '' || typeof shared.payload.expiresAt !== 'string' || shared.payload.expiresAt === '') {
    throw new ReportE2eSmokeError(`report share failed with HTTP ${shared.response.status}`)
  }
  const shareUrl = buildReportShareUrl({
    webOrigin: webOriginFromEnv(env),
    reportId: created.payload.id,
    token: shared.payload.token,
  })

  const sharedRead = await fetchJson(fetchFn, `${apiOrigin}/v1/shared-reports/${created.payload.id}`, {
    headers: { 'x-report-share-token': shared.payload.token },
  })
  if (sharedRead.response.status !== 200 || sharedRead.payload.id !== created.payload.id || sharedRead.payload.report !== latest.report) {
    throw new ReportE2eSmokeError(`shared report verification failed with HTTP ${sharedRead.response.status}`)
  }

  log(`[report-e2e] completed: length=${String(latest.report ?? '').length}, vision=${latest.vision.length}, citations=${latest.citations?.length ?? 0}, rules=${latest.evaluatedRules?.length ?? 0}, compatibility=${latest.compatibility?.overallLevel ?? 'missing'}`)
  if (env.REPORT_E2E_PRINT_SHARE_URL === '1') log(`[report-e2e] share URL: ${shareUrl}`)
  else log(`[report-e2e] share created for report ${created.payload.id}; access URL withheld from logs`)
  return { skipped: false, report: latest, shareUrl, shareExpiresAt: shared.payload.expiresAt }
}

export function isMainModule(metaUrl = import.meta.url, argvEntry = process.argv[1]) {
  return typeof argvEntry === 'string' && fileURLToPath(metaUrl) === resolve(argvEntry)
}

if (isMainModule()) {
  runReportE2eSmoke().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[report-e2e] failed: ${message}\n`)
    process.exit(1)
  })
}
