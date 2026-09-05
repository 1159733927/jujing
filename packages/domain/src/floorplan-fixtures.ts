import type { Direction, ResidencePhotoInput, VisionFactCode } from './index.js'

export type FloorPlanFixtureId = '8029' | '8031'
export type FloorPlanResidenceId = `floorplan-residence-${FloorPlanFixtureId}`

export interface FloorPlanReliableFact {
  readonly label: string
  readonly evidence: string
  readonly confidence: number
  readonly visionFactCode?: VisionFactCode
}

export interface ResidenceFloorPlanFixture {
  readonly id: FloorPlanFixtureId
  readonly residenceId: FloorPlanResidenceId
  readonly imageFileName: `${FloorPlanFixtureId}.jpg`
  readonly sha256: string
  readonly pixelWidth: number
  readonly pixelHeight: number
  readonly photo: ResidencePhotoInput
  readonly residence: {
    readonly facing: Direction
    readonly layoutNote: string
  }
  readonly orientation: {
    readonly northUp: true
    readonly residenceFacing: 'unknown'
    readonly evidence: string
  }
  readonly reliableFacts: readonly FloorPlanReliableFact[]
  readonly uncertainties: readonly string[]
}

export const residenceFloorPlanFixtures = [
  {
    id: '8029',
    residenceId: 'floorplan-residence-8029',
    imageFileName: '8029.jpg',
    sha256: '0c75a71d268b2ba1e8cf8e5c07e6f7b772ea144272336e1d84dc15fcbd15fb35',
    pixelWidth: 612,
    pixelHeight: 416,
    photo: {
      fileId: 'case-plan-8029',
      room: 'overview',
      facing: 'unknown',
      note: '全屋户型图，图面上北下南；这是 8029 这一套住宅的平面证据，不是客厅实拍。',
    },
    residence: {
      facing: 'unknown',
      layoutNote: '8029 单套户型图：图面上北下南；入户门在东南侧；客厅在东侧；书房在北侧；餐厅在南侧偏东；厨房在南侧凸出；住宅整体坐向未知。',
    },
    orientation: {
      northUp: true,
      residenceFacing: 'unknown',
      evidence: '户型图按上北下南阅读，但未提供罗盘坐向或楼栋朝向。',
    },
    reliableFacts: [
      { label: '客厅在住宅东侧', evidence: '户型图中文字标注客厅位于东侧大开间。', confidence: 0.92 },
      { label: '厨房在南侧凸出区域', evidence: '户型图南侧凸出区域标注炉灶/厨房功能。', confidence: 0.9, visionFactCode: 'kitchen.south' },
      { label: '入户门在东南侧', evidence: '户型图东南侧可见入户门开启符号。', confidence: 0.82 },
      { label: '书房在北侧中部', evidence: '户型图北侧中部标注书房。', confidence: 0.84 },
    ],
    uncertainties: [
      '不能仅凭户型图确认住宅整体坐向。',
      '不能仅凭户型图确认自然采光、楼层遮挡或窗外形势。',
      '卫生间是否属于近中宫需按统一九宫格算法或人工标注复核。',
      '不能把 8029 与 8031 当作同一套住宅的多张照片混合分析。',
      '未确认是否存在入户门到阳台的直线穿堂动线。',
    ],
  },
  {
    id: '8031',
    residenceId: 'floorplan-residence-8031',
    imageFileName: '8031.jpg',
    sha256: '0dd5468c65b175619a9f2a4556dbb416fc5c99190e96aea0e8c79e25ee39a183',
    pixelWidth: 476,
    pixelHeight: 391,
    photo: {
      fileId: 'case-plan-8031',
      room: 'overview',
      facing: 'unknown',
      note: '全屋户型图，图面上北下南；这是 8031 这一套住宅的平面证据，不是 8029 的补充照片。',
    },
    residence: {
      facing: 'unknown',
      layoutNote: '8031 单套户型图：图面上北下南；厨房在西北侧；客厅在西侧偏西南；卫生间在东侧偏中部；主卧在东南侧；北侧存在两个未标注功能空间；住宅整体坐向未知。',
    },
    orientation: {
      northUp: true,
      residenceFacing: 'unknown',
      evidence: '户型图按上北下南阅读，但未提供罗盘坐向或楼栋朝向。',
    },
    reliableFacts: [
      { label: '厨房在西北侧', evidence: '户型图西北区域标注厨房与炉灶。', confidence: 0.88 },
      { label: '客厅在西侧偏西南', evidence: '户型图西侧偏南区域标注客厅。', confidence: 0.86 },
      { label: '卫生间在东侧偏中部', evidence: '户型图东侧中部标注卫生间。', confidence: 0.84 },
      { label: '主卧在东南侧', evidence: '户型图东南区域标注主卧。', confidence: 0.85 },
    ],
    uncertainties: [
      '不能仅凭户型图确认住宅整体坐向。',
      '北侧两个空间功能标注不完整，不能推断卧室或阳台用途。',
      '未确认入户门位置、阳台位置和主要采光面。',
      '不能把 8031 与 8029 当作同一套住宅的多张照片混合分析。',
    ],
  },
] as const satisfies readonly ResidenceFloorPlanFixture[]

export function getResidenceFloorPlanFixture(id: FloorPlanFixtureId): ResidenceFloorPlanFixture {
  const fixture = residenceFloorPlanFixtures.find((item) => item.id === id)
  if (!fixture) throw new Error(`Unknown floor-plan fixture: ${id}`)
  return fixture
}

export function assertSingleResidenceFloorPlan(fixtures: readonly Pick<ResidenceFloorPlanFixture, 'id' | 'residenceId'>[], context = 'floor-plan fixtures'): void {
  const residenceIds = new Set(fixtures.map((fixture) => fixture.residenceId))
  if (residenceIds.size <= 1) return
  const labels = fixtures.map((fixture) => `${fixture.id}:${fixture.residenceId}`).join(', ')
  throw new Error(`${context} cannot mix different residences in one report: ${labels}`)
}
