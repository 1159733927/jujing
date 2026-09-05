import type { AuditedExpertAsset, CreateAssetInput, KnowledgeStore } from './knowledge.js'

export const demoKnowledgeAssets: readonly CreateAssetInput[] = [
  {
    kind: 'article',
    title: '程序方法档案 B1',
    sourceLabel: 'Demo 程序基线（非专家定论）',
    tags: ['扶抑', 'baseline-v1', '程序方法'],
    body: '这是可追溯的程序基线说明，不冒充专家流派定论。baseline-v1 仅把月令是否扶助、同类根气数、生助数与明显元素计数投影为透明的支持分、对抗分和净分。净分为正时只输出“扶助偏多”，为负时只输出“扶助偏少”，接近零时输出“相对均衡”。方向性结果只能作为扶抑基线，不直接宣称已定专业格局或唯一取用；这两项必须由后续有来源的流派规则单独判定。',
  },
  {
    kind: 'article',
    title: '客厅采光与明堂感的基础观察',
    sourceLabel: 'Demo 专家资料库',
    tags: ['客厅', '采光', '明堂', '住宅照片'],
    body: '用于演示的专家资料：传统住宅观察中，客厅采光、开阔感、主要动线和入户后的第一视觉面常被作为空间气口与明堂感的参考。报告应先说明照片可见范围，再把采光、遮挡、杂物和动线作为待核验事实处理，不应把单张照片解读为整套住宅的确定结论。',
  },
  {
    kind: 'rule',
    title: '南向住宅基础观察提示',
    sourceLabel: 'Demo 结构化规则库',
    tags: ['朝向', '规则', '南向', '演示规则'],
    body: '用于演示的结构化规则：当住宅整体朝向为 south 时，报告可以提示“南向是本次空间分析中的基础观察条件”，但必须继续结合照片、季节、楼层、遮挡和户型动线复核，不得直接推出确定吉凶。',
    rule: {
      priority: 120,
      conditions: [
        { fact: 'residence.facing', operator: 'equals', value: 'south' },
      ],
      conclusions: [
        { code: 'south-facing-baseline', level: 'info', effect: 'neutral', severity: 'low', text: '住宅朝南是本次空间分析中的基础观察条件；仍需结合全屋平面、拍摄时间、季节光照、楼层与外部遮挡情况复核。' },
      ],
    },
  },
  {
    kind: 'article',
    title: '入户动线与第一视觉面观察',
    sourceLabel: 'Demo 专家资料库',
    tags: ['入户', '动线', '玄关', '住宅照片'],
    body: '用于演示的专家资料：入户后的第一视觉面通常用于观察空间是否清爽、动线是否被阻断、鞋柜杂物是否形成视觉压迫。报告只能基于用户照片和标注说明可见范围，不应根据单张入户照片断定整屋吉凶。',
  },
  {
    kind: 'article',
    title: '卧室安静度与床位周边观察',
    sourceLabel: 'Demo 专家资料库',
    tags: ['卧室', '床位', '安静度', '住宅照片'],
    body: '用于演示的专家资料：卧室部分优先观察床位周边是否拥挤、通道是否顺畅、强光或镜面是否直接影响休息感。若照片没有覆盖床头、门窗和周边动线，报告应列为待确认信息。',
  },
  {
    kind: 'rule',
    title: '客厅自然采光复核提示',
    sourceLabel: 'Demo 结构化规则库',
    tags: ['客厅', '采光', '视觉规则', '演示规则'],
    body: '用于演示的结构化规则：只有受控视觉事实明确确认自然采光时，报告才可以把采光作为可用空间观察；户型图中的阳台标注或阳台可见不能替代自然采光事实。',
    rule: {
      priority: 115,
      conditions: [
        { fact: 'vision.factCodes', operator: 'contains-any', value: ['daylight.visible'] },
      ],
      conclusions: [
        { code: 'living-room-daylight-review', level: 'info', effect: 'neutral', severity: 'low', text: '客厅自然采光是本次照片中的可用观察；仍需结合拍摄时间、季节、楼层和窗外遮挡复核。' },
      ],
    },
  },
  {
    kind: 'rule',
    title: '命盘候选火木与南向采光合参',
    sourceLabel: 'Demo 人宅合参规则库',
    tags: ['人宅合参', '候选五行', '南向', '采光', '演示规则'],
    body: '用于演示的结构化规则：当程序命盘仅在扶抑基线层面给出火或木为候选补益方向，且住宅为南向并有客厅采光事实时，可判断为“存在可合参支持点”。该规则不得把候选五行升级成确定喜用神，也不得省略待核验条件。',
    rule: {
      priority: 135,
      conditions: [
        { fact: 'bazi.assessments.elementPreference.direction', operator: 'equals', value: 'add-support' },
        { fact: 'bazi.assessments.elementPreference.candidateElements', operator: 'contains-any', value: ['fire', 'wood'] },
        { fact: 'residence.facing', operator: 'equals', value: 'south' },
        { fact: 'vision.factCodes', operator: 'contains-any', value: ['daylight.visible'] },
      ],
      conclusions: [
        { code: 'candidate-fire-wood-south-daylight', level: 'info', effect: 'supportive', severity: 'medium', text: '命盘扶抑基线的候选补益方向包含火或木，住宅南向且有明确自然采光事实，二者存在可合参的支持点；但这仍不是完整喜用神或最终宅运结论。' },
      ],
    },
  },
  {
    kind: 'rule',
    title: '住宅朝向五行与命盘候选方向合参',
    sourceLabel: 'Demo 人宅合参规则库',
    tags: ['人宅合参', '候选五行', '朝向', '五行方位', '演示规则'],
    body: '用于演示的结构化规则：当住宅朝向所属五行落入命盘扶抑基线的候选补益方向时，可形成一条人宅合参支持点。东方属木、南方属火、西方属金、北方属水。该规则只说明候选方向与坐向五行有呼应，不等同于完整喜用神、宅运或吉凶定论。',
    rule: {
      priority: 132,
      conditions: [
        { fact: 'bazi.assessments.elementPreference.direction', operator: 'equals', value: 'add-support' },
        { fact: 'bazi.assessments.elementPreference.candidateElements', operator: 'contains-any', value: ['fire'] },
        { fact: 'residence.facing', operator: 'equals', value: 'south' },
      ],
      conclusions: [
        { code: 'candidate-support-facing-south-fire', level: 'info', effect: 'supportive', severity: 'medium', text: '住宅南向属火，命盘扶抑基线的候选补益方向包含火，住宅朝向与命盘候选方向存在一条可合参支持点；该判断不等同于完整喜用神或宅运定论。' },
      ],
    },
  },
  {
    kind: 'rule',
    title: '南向火性对谨慎方向命盘的冲突提示',
    sourceLabel: 'Demo 人宅合参规则库',
    tags: ['人宅合参', '谨慎五行', '南向', '冲突', '演示规则'],
    body: '用于演示的结构化规则：当住宅南向属火，而命盘扶抑基线把火列入谨慎方向时，应输出人宅合参冲突提示。该规则不得断定凶事，只要求把“朝向火性可能加重需谨慎的方向”作为低到中可信度冲突点。',
    rule: {
      priority: 131,
      conditions: [
        { fact: 'bazi.assessments.elementPreference.direction', operator: 'equals', value: 'reduce-support' },
        { fact: 'bazi.assessments.elementPreference.cautiousElements', operator: 'contains-any', value: ['fire'] },
        { fact: 'residence.facing', operator: 'equals', value: 'south' },
      ],
      conclusions: [
        { code: 'cautious-fire-facing-south', level: 'attention', effect: 'conflict', severity: 'medium', text: '住宅南向属火，而命盘扶抑基线把火列入需谨慎方向，朝向五行与命盘候选调衡方向存在冲突点；该判断不等同于确定吉凶。' },
      ],
    },
  },
  {
    kind: 'article',
    title: '中宫与卫生间位置复核资料',
    sourceLabel: 'Demo 专家资料库',
    tags: ['中宫', '卫生间', '户型', '稳定性', '人宅合参'],
    body: '用于演示的专家资料：住宅中心区域通常被作为全屋稳定性的观察重点。若户型图或照片标注显示卫生间、水厕、浴厕靠近中宫，应把它列为重点复核项，而不是直接断定吉凶。报告需要同时说明命盘侧依据、住宅侧依据和仍需现场确认的通风、湿气、门向与实际中心点。',
  },
  {
    kind: 'rule',
    title: '近中宫卫生间与土性稳定需求冲突提示',
    sourceLabel: 'Demo 人宅合参规则库',
    tags: ['中宫', '卫生间', '户型', '土', '冲突', '人宅合参'],
    body: '用于演示的结构化规则：当程序命盘日主属土，且住宅资料显示卫生间靠近中宫时，报告应输出一条低到中可信度的冲突提示。该规则只说明“稳定需求与近中宫水厕形成复核冲突点”，不等同于确定吉凶，也不能替代现场复核。',
    rule: {
      priority: 140,
      conditions: [
        { fact: 'bazi.dayMaster.element', operator: 'equals', value: 'earth' },
        { fact: 'vision.factCodes', operator: 'contains-any', value: ['bathroom.near-center'] },
      ],
      conclusions: [
        { code: 'earth-daymaster-center-bathroom-conflict', level: 'attention', effect: 'conflict', severity: 'medium', text: '日主属土且住宅资料显示卫生间靠近中宫，命盘侧稳定需求与近中宫水厕位置存在一条需复核的冲突点；该判断不等同于确定吉凶。' },
      ],
    },
  },
  {
    kind: 'article',
    title: '南侧厨房与火土关系复核资料',
    sourceLabel: 'Demo 专家资料库',
    tags: ['厨房', '南向', '火土', '灶位', '人宅合参'],
    body: '用于演示的专家资料：厨房、灶位通常按火性空间观察；南方亦常被归入火性方位。若命盘日主属土，且户型图或照片标注显示厨房位于南侧，可作为火土关系的一条合参线索。但报告只能说存在支持条件，仍需复核灶位、门窗、通风、实际坐向和完整命盘喜忌，不能直接断定吉凶。',
  },
  {
    kind: 'rule',
    title: '南侧厨房与土日主火土合参提示',
    sourceLabel: 'Demo 人宅合参规则库',
    tags: ['厨房', '南向', '火土', '土', '人宅合参'],
    body: '用于演示的结构化规则：当程序命盘日主属土，且住宅资料显示厨房在南侧时，输出一条火土关系的合参支持点。该规则只说明传统五行关系中的支持条件，不等同于完整喜用神、宅运或吉凶定论。',
    rule: {
      priority: 138,
      conditions: [
        { fact: 'bazi.dayMaster.element', operator: 'equals', value: 'earth' },
        { fact: 'vision.factCodes', operator: 'contains-any', value: ['kitchen.south'] },
      ],
      conclusions: [
        { code: 'earth-daymaster-south-kitchen-support', level: 'info', effect: 'supportive', severity: 'medium', text: '日主属土且住宅资料显示厨房在南侧，厨房火性与南方火性可形成火土关系的一条合参支持点；该判断不等同于完整喜用神或宅运定论。' },
      ],
    },
  },
  {
    kind: 'article',
    title: '入户穿堂动线复核资料',
    sourceLabel: 'Demo 专家资料库',
    tags: ['入户', '穿堂', '阳台', '动线', '户型'],
    body: '用于演示的专家资料：传统住宅观察会关注入户门、客厅、阳台或大窗是否形成过强的直线贯通。若户型图或照片标注显示大门与阳台、窗面形成明显穿堂动线，应列入冲突或待复核项；若角度不明确，只能要求补充入户向内、客厅回拍和全屋平面证据。',
  },
  {
    kind: 'rule',
    title: '入户阳台穿堂动线冲突提示',
    sourceLabel: 'Demo 人宅合参规则库',
    tags: ['入户', '穿堂', '阳台', '冲突', '户型'],
    body: '用于演示的结构化规则：当命盘已具备日主事实，且住宅资料显示入户到阳台或大窗存在穿堂动线时，输出一条住宅格局侧冲突点。该规则属于户型结构复核，不推出确定吉凶。',
    rule: {
      priority: 136,
      conditions: [
        { fact: 'bazi.dayMaster.element', operator: 'exists', value: true },
        { fact: 'vision.factCodes', operator: 'contains-any', value: ['circulation.entry-balcony-aligned'] },
      ],
      conclusions: [
        { code: 'entry-balcony-through-line-conflict', level: 'attention', effect: 'conflict', severity: 'medium', text: '住宅资料显示入户与阳台或大窗形成穿堂动线，属于户型格局侧需要复核的冲突点；该判断不等同于确定吉凶。' },
      ],
    },
  },
  {
    kind: 'rule',
    title: '候选补益方向与南向缺少照片复核',
    sourceLabel: 'Demo 人宅合参规则库',
    tags: ['人宅合参', '候选五行', '南向', '待复核', '演示规则'],
    body: '用于演示的结构化规则：当命盘候选补益方向包含火或木且住宅为南向，但缺少可见采光、门窗或明堂事实时，只能列为“方向上可合参，证据不足”。',
    rule: {
      priority: 125,
      conditions: [
        { fact: 'bazi.assessments.elementPreference.direction', operator: 'equals', value: 'add-support' },
        { fact: 'bazi.assessments.elementPreference.candidateElements', operator: 'contains-any', value: ['fire', 'wood'] },
        { fact: 'residence.facing', operator: 'equals', value: 'south' },
      ],
      conclusions: [
        { code: 'candidate-fire-wood-south-needs-visual-proof', level: 'info', effect: 'needs-confirmation', severity: 'low', text: '命盘扶抑基线的候选补益方向与住宅南向在方向上可合参，但现有证据仍需照片或户型信息确认采光、门窗和明堂条件。' },
      ],
    },
  },
  {
    kind: 'rule',
    title: '入户照片补拍提示',
    sourceLabel: 'Demo 结构化规则库',
    tags: ['入户', '照片', '补拍', '演示规则'],
    body: '用于演示的结构化规则：当已上传入户照片时，报告应优先说明入户区域的可见事实；若缺少入户照片，应在待确认信息中建议补充入户门向内拍摄和从客厅回拍入户方向。',
    rule: {
      priority: 90,
      conditions: [
        { fact: 'vision.rooms', operator: 'contains-any', value: ['entry', 'entrance'] },
      ],
      conclusions: [
        { code: 'entry-evidence-present', level: 'attention', effect: 'needs-confirmation', severity: 'low', text: '已包含入户区域照片，可先核对入户动线、鞋柜杂物和第一视觉面；如角度不足，应补拍入户门向内与客厅回拍两张。' },
      ],
    },
  },
  {
    kind: 'skill',
    title: '住宅报告生成 Skill：先证据后建议',
    sourceLabel: 'Demo Skill 资料库',
    tags: ['Skill', '报告结构', '证据边界'],
    body: '用于演示的 Skill 资料：生成住宅风水文化报告时，先列出用户提交事实、程序排盘、照片观察和已发布专家资料，再给出传统文化解释。建议必须分优先级，并说明哪些信息需要补拍或现场确认。禁止输出确定命运、医疗、法律、财务判断。',
  },
  {
    kind: 'skill',
    title: '住宅报告生成 Skill：引用与待确认规范',
    sourceLabel: 'Demo Skill 资料库',
    tags: ['Skill', '引用依据', '待确认信息'],
    body: '用于演示的 Skill 资料：报告必须把“照片可见事实”“用户填写信息”“程序命盘”“专家资料/规则”分开表达。看不见的户型、方位、尺寸、外部遮挡和入住者感受不得补写为事实，只能进入待确认信息。',
  },
]

export interface DemoKnowledgeSeedResult {
  seeded: AuditedExpertAsset[]
  created: number
  revised: number
  published: number
  reused: number
}

export function shouldSeedDemoKnowledge(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false
  if (env.NODE_ENV === 'test') return false
  return env.DEMO_SEED_KNOWLEDGE === 'true'
}

export async function seedDemoKnowledge(
  store: KnowledgeStore,
  editorActor: string,
  reviewerActor: string,
): Promise<DemoKnowledgeSeedResult> {
  const seeded: AuditedExpertAsset[] = []
  let created = 0
  let revised = 0
  let published = 0
  let reused = 0

  for (const input of demoKnowledgeAssets) {
    const assets = await store.list()
    let asset = assets.find((candidate) =>
      candidate.kind === input.kind &&
      candidate.title === input.title &&
      candidate.sourceLabel === input.sourceLabel &&
      candidate.state !== 'archived',
    )
    if (!asset) {
      asset = await store.create(input, editorActor)
      created += 1
    } else {
      reused += 1
      if (asset.state === 'in-review') {
        const reviewed = await store.setState(asset.id, 'published', reviewerActor)
        if (!reviewed) throw new Error(`demo knowledge asset disappeared before stale review: ${asset.id}`)
        asset = reviewed
        published += 1
      }
      if (!demoKnowledgeAssetMatchesInput(asset, input)) {
        const draft = await store.revise(asset.id, input, editorActor, asset.version)
        if (!draft) throw new Error(`demo knowledge asset disappeared before revision: ${asset.id}`)
        asset = draft
        revised += 1
      }
    }

    if (asset.state === 'draft') {
      const submitted = await store.setState(asset.id, 'in-review', editorActor)
      if (!submitted) throw new Error(`demo knowledge asset disappeared before review: ${asset.id}`)
      asset = submitted
    }
    if (asset.state === 'in-review') {
      const reviewed = await store.setState(asset.id, 'published', reviewerActor)
      if (!reviewed) throw new Error(`demo knowledge asset disappeared before publication: ${asset.id}`)
      asset = reviewed
      published += 1
    }
    seeded.push(asset)
  }

  return { seeded, created, revised, published, reused }
}

function demoKnowledgeAssetMatchesInput(asset: AuditedExpertAsset, input: CreateAssetInput): boolean {
  return asset.kind === input.kind
    && asset.title === input.title
    && asset.sourceLabel === input.sourceLabel
    && asset.body === input.body
    && JSON.stringify(asset.tags) === JSON.stringify(input.tags)
    && JSON.stringify(asset.rule ?? null) === JSON.stringify(input.rule ?? null)
}
