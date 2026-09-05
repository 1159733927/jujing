import type { StructuredRuleDefinition } from '@fengshui/knowledge-contracts'
import type { AuditedExpertAsset, AuditedPublishedKnowledgeVersion, CreateAssetInput, KnowledgeStore } from './knowledge.js'

const SOURCE_TITLE_PREFIX = '中州派【玄空风水】第5篇-阳宅运用篇'
const RULE_SOURCE_LABEL = '中州派玄空风水·专家结构化规则'

type SourceKey = 'overview' | 'selection' | 'rooms' | 'furniture' | 'external' | 'internal' | 'remedy' | 'remedy-direction'

const sourceTitleFragments: Readonly<Record<SourceKey, string>> = {
  overview: 'p.1-3 第五篇阳宅运用篇',
  selection: 'p.4-9 第一章阳宅选择',
  rooms: 'p.10-12 第二章内六事布局',
  furniture: 'p.13-14 第二节家具',
  external: 'p.15-20 第一节外局推断',
  internal: 'p.21-25 第一节外局推断',
  remedy: 'p.26 第一节外局推断',
  'remedy-direction': 'p.27-29 第一节化煞方位',
}

interface ProfessionalRuleSpec {
  title: string
  sourceKeys: readonly SourceKey[]
  body: string
  rule: Omit<StructuredRuleDefinition, 'sourceVersionIds'>
}

const professionalRuleSpecs: readonly ProfessionalRuleSpec[] = [
  {
    title: '玄空阳宅判断须先完成水法、排龙、立向与内外六事核验',
    sourceKeys: ['overview'],
    body: '书中把水法、排龙与立向、外六事、内六事列为依次核验的四项。现有住宅基本资料只能启动核验，不能代替完整玄空宅局判断。',
    rule: {
      priority: 220,
      conditions: [{ fact: 'residence.layoutNote', operator: 'exists', value: true }],
      conclusions: [{ code: 'xuankong-four-stage-evidence-required', text: '住宅已有基础格局资料，但玄空宅局仍需依次核验周边水路、排龙与精确立向、外六事和内六事；当前不得直接判定宅局吉凶。', level: 'attention', effect: 'needs-confirmation', severity: 'high' }],
    },
  },
  {
    title: '住宅朝向记录不等于玄空立向度数',
    sourceKeys: ['selection', 'external'],
    body: '方位类别只能作为输入线索。书中要求先量度立向，并排查兼线过度、空亡、骑线等边界，再据此飞布星盘。',
    rule: {
      priority: 218,
      conditions: [{ fact: 'residence.facing', operator: 'exists', value: true }],
      conclusions: [{ code: 'facing-needs-bearing-and-line-check', text: '住宅朝向类别已经记录，但仍缺罗盘立向度数及兼线、空亡、骑线等校验，不能仅凭东南西北生成玄空飞星结论。', level: 'attention', effect: 'needs-confirmation', severity: 'high' }],
    },
  },
  {
    title: '户型图分析须区分整栋建筑与私宅立极',
    sourceKeys: ['overview', 'rooms', 'external'],
    body: '书中分别使用整栋建筑中心与私宅中心立极；二者用途不同，不能混用同一九宫结果。',
    rule: {
      priority: 216,
      conditions: [{ fact: 'residence.layoutNote', operator: 'exists', value: true }],
      conclusions: [{ code: 'building-unit-center-must-be-distinguished', text: '户型资料可用于私宅内六事分宫，但外局与楼层选宅还需整栋建筑中心；两套立极边界必须分别确认。', level: 'attention', effect: 'needs-confirmation', severity: 'high' }],
    },
  },
  {
    title: '入户门判断须核验门位宫星与实际来路',
    sourceKeys: ['overview', 'internal'],
    body: '书中以宅中心量门位，并要求同时考察向星旺衰、山向运星组合、大宫位性质及楼梯走道来路。',
    rule: {
      priority: 210,
      conditions: [{ fact: 'vision.rooms', operator: 'contains-any', value: ['entry', 'entrance'] }],
      conclusions: [{ code: 'entrance-palace-route-evidence-required', text: '已取得入户区域证据；门位结论仍需宅中心分宫、门位山向运星及楼梯走道实际来路共同核验。', level: 'attention', effect: 'needs-confirmation', severity: 'medium' }],
    },
  },
  {
    title: '卧室判断须核验大宫位山星与外形',
    sourceKeys: ['rooms', 'internal'],
    body: '书中以卧室所在大宫位的山星旺衰、山向双星配合及外部冲射破损等为前提。仅识别出卧室不足以下结论。',
    rule: {
      priority: 208,
      conditions: [{ fact: 'vision.rooms', operator: 'contains-any', value: ['bedroom'] }],
      conclusions: [{ code: 'bedroom-palace-star-form-required', text: '已识别卧室区域；仍需确认其在私宅八宫中的占比、山星旺衰、双星关系及外部形峦，方可判断卧室承气。', level: 'attention', effect: 'needs-confirmation', severity: 'medium' }],
    },
  },
  {
    title: '卧室跨宫时须按面积主次或两宫并重',
    sourceKeys: ['internal'],
    body: '书中规定房间跨两个宫位时以占比大者为主；面积接近时两宫并重。普通房间标签不能替代宫位几何占比。',
    rule: {
      priority: 206,
      conditions: [{ fact: 'residence.layoutNote', operator: 'contains', value: '卧室' }],
      conclusions: [{ code: 'bedroom-multi-palace-area-required', text: '户型资料提到卧室，但若卧室跨越两个宫位，必须计算宫位面积占比；占比接近时两宫并重，不能任选一宫判断。', level: 'attention', effect: 'needs-confirmation', severity: 'medium' }],
    },
  },
  {
    title: '床位判断须在卧室小太极内复核',
    sourceKeys: ['furniture', 'internal'],
    body: '书中先判卧室大宫位性质，再以房间中心立小太极考察床位承气或泄气。照片中出现卧室不等于床位已可判断。',
    rule: {
      priority: 204,
      conditions: [{ fact: 'vision.rooms', operator: 'contains-any', value: ['bedroom'] }],
      conclusions: [{ code: 'bed-position-small-center-required', text: '卧室证据尚不足以判断床位；需补充完整房间边界、床位位置，并在卧室小太极内核验床位所临宫星。', level: 'attention', effect: 'needs-confirmation', severity: 'medium' }],
    },
  },
  {
    title: '客厅判断须核验向星及全宅气路',
    sourceKeys: ['rooms'],
    body: '书中把客厅视为全宅联系点，以向星及其对门星和各房通路的影响为核心。可见采光只是一项视觉事实。',
    rule: {
      priority: 202,
      conditions: [{ fact: 'vision.rooms', operator: 'contains-any', value: ['living-room', 'living_room', '客厅'] }],
      conclusions: [{ code: 'living-room-facing-star-route-required', text: '已识别客厅区域；客厅玄空判断仍需其所占宫位向星、与大门的引气关系及通往各房的实际气路。', level: 'attention', effect: 'needs-confirmation', severity: 'medium' }],
    },
  },
  {
    title: '厨房判断须核验全宅宫位与灶位小宫',
    sourceKeys: ['rooms'],
    body: '书中先判断厨房在全宅所占宫位，再在厨房内部考察灶位；两层信息不能由“厨房可见”替代。',
    rule: {
      priority: 200,
      conditions: [{ fact: 'vision.rooms', operator: 'contains-any', value: ['kitchen', '厨房'] }],
      conclusions: [{ code: 'kitchen-and-stove-palaces-required', text: '已识别厨房区域；仍需分别核验厨房所占全宅宫位、该宫山向星性质及灶位在厨房小宫中的位置。', level: 'attention', effect: 'needs-confirmation', severity: 'medium' }],
    },
  },
  {
    title: '书房书桌判断须先确认房间与家具两级宫位',
    sourceKeys: ['furniture'],
    body: '书中以书房大宫位星曜性质为前提，再以书房中心分宫判断书桌位置。仅有书房名称不能推出文昌效果。',
    rule: {
      priority: 198,
      conditions: [{ fact: 'vision.rooms', operator: 'contains-any', value: ['study', 'office', '书房'] }],
      conclusions: [{ code: 'study-desk-two-level-palaces-required', text: '已识别书房区域；书桌判断需同时确认书房在全宅的大宫位和书桌在房间小太极中的宫位，不得仅凭房间名称推断。', level: 'attention', effect: 'needs-confirmation', severity: 'medium' }],
    },
  },
  {
    title: '照片可见采光门窗不等于玄空山水定性',
    sourceKeys: ['external'],
    body: '书中根据道路繁忙程度、宽度、对面建筑和空间使用判断形峦中的山水；普通照片中的窗、阳台或日光不能单独完成定性。',
    rule: {
      priority: 196,
      conditions: [{ fact: 'vision.factCodes', operator: 'contains-any', value: ['daylight.visible', 'window.visible', 'balcony.visible'] }],
      conclusions: [{ code: 'visible-opening-not-xuankong-water', text: '照片中的采光、窗户或阳台属于可用视觉事实，但不等于玄空所称的“水”；外局仍需道路、人流、开阔空间与对面建筑证据。', level: 'info', effect: 'neutral', severity: 'low' }],
    },
  },
  {
    title: '外局照片须同时记录形态与五行依据',
    sourceKeys: ['external'],
    body: '书中把外局影响分为五行与形态两类，并强调形态优先。模糊的视觉摘要不能直接成为吉凶判断。',
    rule: {
      priority: 194,
      conditions: [{ fact: 'vision.summaries', operator: 'exists', value: true }],
      conclusions: [{ code: 'external-form-and-element-evidence-required', text: '已有视觉摘要；外局专业判断仍须分别记录建筑或道路的可见形态、方位、距离及五行归类依据，并以形态证据优先。', level: 'attention', effect: 'needs-confirmation', severity: 'medium' }],
    },
  },
  {
    title: '化煞建议须在明确原局病因后提出',
    sourceKeys: ['remedy', 'remedy-direction'],
    body: '书中明确把找出不吉宫位与五行病因作为调整前提，并指出错误布置可能产生相反作用。',
    rule: {
      priority: 192,
      conditions: [{ fact: 'residence.layoutNote', operator: 'exists', value: true }],
      conclusions: [{ code: 'remedy-requires-diagnosed-palace-cause', text: '在立向、运盘、宫位和形峦尚未形成可复核病因前，不应给出摆件或五行化煞方案。', level: 'info', effect: 'neutral', severity: 'medium' }],
    },
  },
]

export const PROFESSIONAL_RULE_TITLES = professionalRuleSpecs.map((spec) => spec.title)

export interface ProfessionalKnowledgeSeedResult {
  seeded: AuditedExpertAsset[]
  created: number
  published: number
  reused: number
  sourceVersionIds: readonly string[]
}

export async function seedProfessionalKnowledge(
  store: KnowledgeStore,
  editorActor: string,
  reviewerActor: string,
): Promise<ProfessionalKnowledgeSeedResult> {
  if (editorActor.trim() === reviewerActor.trim()) throw new Error('professional rule editor and reviewer must be different actors')

  const sources = await resolveActiveSources(store)
  const seeded: AuditedExpertAsset[] = []
  let created = 0
  let published = 0
  let reused = 0

  for (const spec of professionalRuleSpecs) {
    const input: CreateAssetInput = {
      kind: 'rule',
      title: spec.title,
      sourceLabel: RULE_SOURCE_LABEL,
      tags: ['玄空', '阳宅', '专家规则', '证据边界'],
      body: spec.body,
      rule: {
        ...spec.rule,
        sourceVersionIds: spec.sourceKeys.map((key) => sources[key].versionId),
      },
    }
    const assets = await store.list()
    let asset = assets.find((candidate) => candidate.kind === 'rule' && candidate.title === spec.title && candidate.state !== 'archived')
    if (!asset) {
      asset = await store.create(input, editorActor)
      created += 1
    } else {
      reused += 1
    }
    if (asset.state === 'draft') {
      asset = await store.setState(asset.id, 'in-review', editorActor)
      if (!asset) throw new Error(`professional rule disappeared before review: ${spec.title}`)
    }
    if (asset.state === 'in-review') {
      asset = await store.setState(asset.id, 'published', reviewerActor)
      if (!asset) throw new Error(`professional rule disappeared before publication: ${spec.title}`)
      published += 1
    }
    seeded.push(asset)
  }

  return {
    seeded,
    created,
    published,
    reused,
    sourceVersionIds: [...new Set(Object.values(sources).map((source) => source.versionId))],
  }
}

async function resolveActiveSources(store: KnowledgeStore): Promise<Record<SourceKey, AuditedPublishedKnowledgeVersion>> {
  const [assets, versions] = await Promise.all([store.list(), store.listVersions()])
  const activeIds = new Set(assets.flatMap((asset) =>
    asset.state === 'published' && asset.kind !== 'rule' && asset.currentPublishedVersionId
      ? [asset.currentPublishedVersionId]
      : [],
  ))
  const activeSources = versions.filter((version) => activeIds.has(version.versionId) && version.kind !== 'rule')

  return Object.fromEntries(Object.entries(sourceTitleFragments).map(([key, fragment]) => {
    const matches = activeSources.filter((version) => version.title.startsWith(SOURCE_TITLE_PREFIX) && version.title.includes(fragment))
    if (matches.length !== 1) {
      throw new Error(`expected exactly one active published expert source for ${fragment}, found ${matches.length}`)
    }
    return [key, matches[0]]
  })) as Record<SourceKey, AuditedPublishedKnowledgeVersion>
}
