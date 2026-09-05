import type { PublishedBaziRuleProfileVersion } from '@fengshui/domain'
import { DAY_STEM_ELEMENTS, buildElementBalanceDirection } from '@fengshui/bazi-engine'
import type { BaziRuleProfileStore, CreateBaziRuleProfileInput } from './rule-profiles.js'

export const DEMO_BAZI_RULE_PROFILE_KEY = 'demo-traditional-solar-time'

export const DEMO_BAZI_RULE_PROFILE: CreateBaziRuleProfileInput = {
  key: DEMO_BAZI_RULE_PROFILE_KEY,
  name: '演示流派 · 真太阳时',
  description: '本地投资人 Demo 内置规则档案，用于证明“专家规则发布 → 命盘版本绑定 → 报告依据追溯”的闭环；正式版应由专家后台审核发布。',
  workingDefinition: {
    schemaVersion: 2,
    timeDefaults: {
      timezone: 'Asia/Shanghai',
      dstPolicy: 'auto',
      useTrueSolarTime: true,
      timeCorrectionRuleVersion: 'true-solar-v2-zone-meridian-equation-of-time',
      dayBoundary: 'zi-hour-start',
      luckMethod: 'sect1',
    },
    assessments: {
      strength: { enabled: false, method: 'decision-table-v1', ruleSetVersion: 'baseline-v1', rules: [] },
      pattern: { enabled: false, method: 'decision-table-v1', ruleSetVersion: 'pending-expert-school-v1', rules: [] },
      elementPreference: { enabled: false, method: 'decision-table-v1', ruleSetVersion: 'baseline-v1', rules: [] },
      shenSha: { enabled: false, method: 'decision-table-v1', ruleSetVersion: 'program-fields-only-v1', rules: [] },
    },
  },
}

const DAY_STEM_ENTRIES = Object.entries(DAY_STEM_ELEMENTS).sort(([left], [right]) => left.localeCompare(right, 'zh-Hans-CN'))
const DAY_STEM_IDS: Readonly<Record<string, string>> = {
  甲: 'jia',
  乙: 'yi',
  丙: 'bing',
  丁: 'ding',
  戊: 'wu',
  己: 'ji',
  庚: 'geng',
  辛: 'xin',
  壬: 'ren',
  癸: 'gui',
}

function elementPreferenceRules(sourceVersionIds: readonly string[]): NonNullable<CreateBaziRuleProfileInput['workingDefinition']['assessments']['elementPreference']>['rules'] {
  return DAY_STEM_ENTRIES.flatMap(([stem, element]) => [
    {
      id: `baseline.preference.${DAY_STEM_IDS[stem]}.add-support`,
      priority: 100,
      all: [
        { fact: 'dayMaster.stem', operator: 'equals', value: stem },
        { fact: 'balance.netScore', operator: 'lte', value: -1 },
      ],
      output: {
        code: `${element}-add-support`,
        label: `扶抑基线显示日主扶助偏少，候选补益方向为同类与印星五行；具体喜用仍待流派规则复核`,
        elementDirection: buildElementBalanceDirection(element, 'add-support'),
      },
      sourceVersionIds,
    },
    {
      id: `baseline.preference.${DAY_STEM_IDS[stem]}.reduce-support`,
      priority: 100,
      all: [
        { fact: 'dayMaster.stem', operator: 'equals', value: stem },
        { fact: 'balance.netScore', operator: 'gte', value: 1 },
      ],
      output: {
        code: `${element}-reduce-support`,
        label: `扶抑基线显示日主扶助偏多，候选平衡方向为泄、耗、制日主的五行；具体喜用仍待流派规则复核`,
        elementDirection: buildElementBalanceDirection(element, 'reduce-support'),
      },
      sourceVersionIds,
    },
    {
      id: `baseline.preference.${DAY_STEM_IDS[stem]}.near-balanced`,
      priority: 90,
      all: [
        { fact: 'dayMaster.stem', operator: 'equals', value: stem },
        { fact: 'balance.netScore', operator: 'gt', value: -1 },
        { fact: 'balance.netScore', operator: 'lt', value: 1 },
      ],
      output: {
        code: `${element}-balanced-undetermined`,
        label: `扶抑基线显示扶助与对抗接近均衡，暂不指定候选五行；具体喜用仍待流派规则复核`,
        elementDirection: buildElementBalanceDirection(element, 'balanced-undetermined'),
      },
      sourceVersionIds,
    },
  ])
}

const MONTH_COMMAND_PATTERN_ENTRIES: readonly { tenGod: string; id: string; label: string }[] = [
  { tenGod: '比肩', id: 'friend', label: '月令主气为比肩，可作为建禄、比劫类格局候选；是否成格仍需透干、根气与全局救应复核' },
  { tenGod: '劫财', id: 'robwealth', label: '月令主气为劫财，可作为比劫类格局候选；是否成格仍需透干、根气与全局救应复核' },
  { tenGod: '食神', id: 'eatinggod', label: '月令主气为食神，可作为食神格局候选；是否成格仍需透干、根气与全局救应复核' },
  { tenGod: '伤官', id: 'hurtingofficer', label: '月令主气为伤官，可作为伤官格局候选；是否成格仍需透干、根气与全局救应复核' },
  { tenGod: '偏财', id: 'indirectwealth', label: '月令主气为偏财，可作为偏财格局候选；是否成格仍需透干、根气与全局救应复核' },
  { tenGod: '正财', id: 'directwealth', label: '月令主气为正财，可作为正财格局候选；是否成格仍需透干、根气与全局救应复核' },
  { tenGod: '七杀', id: 'sevenkillings', label: '月令主气为七杀，可作为七杀格局候选；是否成格仍需制化、透干与全局救应复核' },
  { tenGod: '正官', id: 'directofficer', label: '月令主气为正官，可作为正官格局候选；是否成格仍需透干、根气与全局救应复核' },
  { tenGod: '偏印', id: 'indirectresource', label: '月令主气为偏印，可作为偏印格局候选；是否成格仍需透干、根气与全局救应复核' },
  { tenGod: '正印', id: 'directresource', label: '月令主气为正印，可作为正印格局候选；是否成格仍需透干、根气与全局救应复核' },
]

function patternRules(sourceVersionIds: readonly string[]): NonNullable<CreateBaziRuleProfileInput['workingDefinition']['assessments']['pattern']>['rules'] {
  return MONTH_COMMAND_PATTERN_ENTRIES.map((entry) => ({
    id: `baseline.pattern.month-command.${entry.id}`,
    priority: 80,
    all: [{ fact: 'monthCommand.mainQiTenGod', operator: 'equals', value: entry.tenGod }],
    output: { code: `month-command-${entry.id}`, label: entry.label },
    sourceVersionIds,
  }))
}

const BASELINE_SHENSHA_ENTRIES: readonly { name: string; id: string }[] = [
  { name: '天乙贵人', id: 'tianyi' },
  { name: '文昌贵人', id: 'wenchang' },
  { name: '桃花', id: 'taohua' },
  { name: '驿马', id: 'yima' },
  { name: '华盖', id: 'huagai' },
  { name: '将星', id: 'jiangxing' },
  { name: '羊刃', id: 'yangren' },
  { name: '禄神', id: 'lushen' },
]

function shenShaRules(sourceVersionIds: readonly string[]): NonNullable<CreateBaziRuleProfileInput['workingDefinition']['assessments']['shenSha']>['rules'] {
  return BASELINE_SHENSHA_ENTRIES.map((entry) => ({
    id: `baseline.shensha.${entry.id}`,
    priority: 60,
    all: [{ fact: 'pillarDetails.shenSha.names', operator: 'contains', value: entry.name }],
    output: { code: entry.id, label: `${entry.name}（程序表格汇总，仅作传统符号参考）` },
    sourceVersionIds,
  }))
}

function executableDemoProfile(sourceVersionId: string): CreateBaziRuleProfileInput {
  const sourceVersionIds = [sourceVersionId]
  return {
    ...DEMO_BAZI_RULE_PROFILE,
    description: `${DEMO_BAZI_RULE_PROFILE.description} 旺衰与喜忌执行透明的 baseline-v1 扶抑基线；格局输出月令主气十神候选；神煞输出程序表格汇总。`,
    workingDefinition: {
      ...DEMO_BAZI_RULE_PROFILE.workingDefinition,
      assessments: {
        strength: {
          enabled: true, method: 'decision-table-v1', ruleSetVersion: 'baseline-v1', rules: [
            { id: 'baseline.strength.support-heavy', priority: 100, all: [{ fact: 'balance.netScore', operator: 'gte', value: 1 }], output: { code: 'support-heavy', label: '扶助力量偏多' }, sourceVersionIds },
            { id: 'baseline.strength.support-light', priority: 100, all: [{ fact: 'balance.netScore', operator: 'lte', value: -1 }], output: { code: 'support-light', label: '扶助力量偏少' }, sourceVersionIds },
            { id: 'baseline.strength.near-balanced', priority: 90, all: [{ fact: 'balance.netScore', operator: 'gt', value: -1 }, { fact: 'balance.netScore', operator: 'lt', value: 1 }], output: { code: 'near-balanced', label: '扶助与对抗力量相对均衡' }, sourceVersionIds },
          ],
        },
        pattern: { enabled: true, method: 'decision-table-v1', ruleSetVersion: 'month-command-pattern-baseline-v1', rules: patternRules(sourceVersionIds) },
        elementPreference: {
          enabled: true, method: 'decision-table-v1', ruleSetVersion: 'baseline-v1', rules: elementPreferenceRules(sourceVersionIds),
        },
        shenSha: { enabled: true, method: 'decision-table-v1', ruleSetVersion: 'program-fields-shensha-baseline-v1', rules: shenShaRules(sourceVersionIds) },
      },
    },
  }
}

export function shouldSeedDemoBaziRuleProfile(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false
  if (env.DEMO_SEED_BAZI_RULE_PROFILE === 'false') return false
  return env.NODE_ENV !== 'test'
}

export async function ensureDemoBaziRuleProfile(
  ruleProfiles: BaziRuleProfileStore,
  authorActor = 'local-demo-seed-author',
  reviewerActor = 'local-demo-seed-reviewer',
  sourceVersionId?: string,
): Promise<PublishedBaziRuleProfileVersion | undefined> {
  const desired = sourceVersionId ? executableDemoProfile(sourceVersionId) : DEMO_BAZI_RULE_PROFILE
  const active = await ruleProfiles.listActiveVersions()
  const activeDemo = active.find((version) => version.key === DEMO_BAZI_RULE_PROFILE_KEY)
  const activeStrengthLabels = activeDemo?.definition.assessments.strength.rules?.map((rule) => rule.output.label) ?? []
  const activePatternRules = activeDemo?.definition.assessments.pattern.rules ?? []
  const activePreferenceRules = activeDemo?.definition.assessments.elementPreference?.rules ?? []
  const activeShenShaRules = activeDemo?.definition.assessments.shenSha.rules ?? []
  const activeIsCurrent = activeDemo?.definition.schemaVersion === 2 && !activeStrengthLabels.some((label) => label.includes('baseline-v1')) && (
    !sourceVersionId || (
      activeDemo.definition.assessments.strength.enabled &&
      activeDemo.definition.assessments.pattern.enabled &&
      activeDemo.definition.assessments.elementPreference?.enabled === true &&
      activeDemo.definition.assessments.shenSha.enabled &&
      activePatternRules.length === MONTH_COMMAND_PATTERN_ENTRIES.length &&
      activePreferenceRules.length === DAY_STEM_ENTRIES.length * 3 &&
      activePreferenceRules.every((rule) => rule.output.elementDirection?.scope === 'support-balance-baseline') &&
      activeShenShaRules.length === BASELINE_SHENSHA_ENTRIES.length
    )
  )
  if (activeDemo && activeIsCurrent) return activeDemo

  let existing = (await ruleProfiles.list()).find((profile) => profile.key === DEMO_BAZI_RULE_PROFILE_KEY)
  if (existing?.state === 'archived') return undefined

  // Upgrade only this code-owned local demo profile. Published snapshots stay
  // immutable; revising creates a new draft and publishing creates a new version.
  // Never overwrite an in-review profile because it may contain human edits.
  if (existing?.state === 'published' && activeDemo && !activeIsCurrent) {
    existing = await ruleProfiles.revise(existing.id, {
      name: desired.name,
      ...(desired.description ? { description: desired.description } : {}),
      workingDefinition: desired.workingDefinition,
    }, authorActor, existing.revision)
  }

  if (existing?.state === 'published' && existing.currentPublishedVersionId) {
    return ruleProfiles.getActiveVersion(existing.currentPublishedVersionId)
  }

  const profile = existing ?? await ruleProfiles.create(desired, authorActor)
  const inReview = profile.state === 'draft'
    ? await ruleProfiles.setState(profile.id, 'in-review', authorActor)
    : profile
  if (!inReview) return undefined
  if (inReview.state === 'in-review') {
    const published = await ruleProfiles.setState(inReview.id, 'published', reviewerActor)
    return published?.currentPublishedVersionId
      ? ruleProfiles.getActiveVersion(published.currentPublishedVersionId)
      : undefined
  }
  return undefined
}
