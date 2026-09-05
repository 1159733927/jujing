import type { VisionFactCode } from './index.js'

export const NINE_GRID_ALGORITHM_VERSION = 'floorplan-nine-grid-v1' as const

export type NineGridSector =
  | 'northwest'
  | 'north'
  | 'northeast'
  | 'west'
  | 'center'
  | 'east'
  | 'southwest'
  | 'south'
  | 'southeast'

export type FloorPlanRoomKind =
  | 'entrance'
  | 'living-room'
  | 'bedroom'
  | 'kitchen'
  | 'bathroom'
  | 'balcony'
  | 'study'
  | 'other'

export interface NormalizedPoint {
  readonly x: number
  readonly y: number
}

export interface FloorPlanBoundary {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface FloorPlanRoomGeometry {
  readonly id: string
  readonly kind: FloorPlanRoomKind
  readonly label?: string
  readonly center?: NormalizedPoint
  readonly polygon?: readonly NormalizedPoint[]
  readonly evidenceRef: string
}

export interface NineGridOverride {
  readonly code: Extract<VisionFactCode, 'kitchen.south' | 'bathroom.near-center'>
  readonly decision: 'assert' | 'suppress'
  readonly confidence: number
  readonly actor: string
  readonly reason: string
  readonly evidenceRef: string
}

export interface NineGridInput {
  readonly boundary: FloorPlanBoundary
  readonly orientation: {
    readonly northUp: boolean
    readonly evidenceRef: string
  }
  readonly rooms: readonly FloorPlanRoomGeometry[]
  readonly overrides?: readonly NineGridOverride[]
}

export interface NineGridRoomPlacement {
  readonly roomId: string
  readonly kind: FloorPlanRoomKind
  readonly label?: string
  readonly sector: NineGridSector
  readonly center: NormalizedPoint
  readonly boundaryFuzzy: boolean
  readonly crossSectorFuzzy: boolean
  readonly evidenceRef: string
}

export interface NineGridDerivedFact {
  readonly code: Extract<VisionFactCode, 'kitchen.south' | 'bathroom.near-center'>
  readonly confidence: number
  readonly evidence: string
  readonly source: typeof NINE_GRID_ALGORITHM_VERSION | 'human-override'
  readonly roomId?: string
  readonly override?: NineGridOverride
}

export interface NineGridAnalysis {
  readonly status: 'derived'
  readonly algorithmVersion: typeof NINE_GRID_ALGORITHM_VERSION
  readonly inputHash: string
  readonly evidenceRefs: readonly string[]
  readonly rooms: readonly NineGridRoomPlacement[]
  readonly facts: readonly NineGridDerivedFact[]
  readonly limitations: readonly string[]
}

export interface NineGridUnavailable {
  readonly status: 'unavailable'
  readonly algorithmVersion: typeof NINE_GRID_ALGORITHM_VERSION
  readonly inputHash: string
  readonly evidenceRefs: readonly string[]
  readonly reason: string
  readonly limitations: readonly string[]
}

export type NineGridResult = NineGridAnalysis | NineGridUnavailable

const GRID_LINE_THRESHOLD = 0.03
const AREA_SHARE_FUZZY_DELTA = 0.08
const CENTER_SECTOR_MIN_SHARE = 0.42
const CENTER_DISTANCE_FOR_NEAR_CENTER = 0.24

const sectorOrder: readonly NineGridSector[] = [
  'northwest',
  'north',
  'northeast',
  'west',
  'center',
  'east',
  'southwest',
  'south',
  'southeast',
]

export function analyzeFloorPlanNineGrid(input: NineGridInput): NineGridResult {
  const normalized = normalizeInput(input)
  const evidenceRefs = collectEvidenceRefs(input)
  const inputHash = stableHash(normalized)
  const failReason = validateInput(normalized)
  if (failReason) {
    return {
      status: 'unavailable',
      algorithmVersion: NINE_GRID_ALGORITHM_VERSION,
      inputHash,
      evidenceRefs,
      reason: failReason,
      limitations: ['Nine-grid facts are fail-closed when orientation, boundary, evidence, or room geometry is incomplete.'],
    }
  }

  const rooms = normalized.rooms
    .map((room) => placeRoom(room))
    .filter((placement): placement is NineGridRoomPlacement => placement !== undefined)

  const geometryFacts = rooms.flatMap((room) => roomFacts(room))
  const facts = applyOverrides(geometryFacts, normalized.overrides ?? [])

  return {
    status: 'derived',
    algorithmVersion: NINE_GRID_ALGORITHM_VERSION,
    inputHash,
    evidenceRefs,
    rooms,
    facts,
    limitations: ['This algorithm derives kitchen.south and bathroom.near-center only; through-line circulation requires door/window line geometry and is intentionally not inferred.'],
  }
}

export function stableNineGridHash(value: unknown): string {
  return stableHash(value)
}

function validateInput(input: NineGridInput): string | undefined {
  if (!input.orientation.northUp) return 'floor-plan orientation must explicitly confirm north-up'
  if (!input.orientation.evidenceRef.trim()) return 'floor-plan orientation requires an evidenceRef'
  if (!Number.isFinite(input.boundary.x) || !Number.isFinite(input.boundary.y) || !Number.isFinite(input.boundary.width) || !Number.isFinite(input.boundary.height)) return 'floor-plan boundary must be finite'
  if (input.boundary.width <= 0 || input.boundary.height <= 0) return 'floor-plan boundary must have positive width and height'
  if (!input.rooms.length) return 'floor-plan requires at least one room geometry'
  if (input.rooms.some((room) => !room.id.trim() || !room.evidenceRef.trim())) return 'each room geometry requires id and evidenceRef'
  if (input.rooms.some((room) => !room.center && (!room.polygon || room.polygon.length < 3))) return 'each room requires either a center point or a polygon with at least three points'
  if (input.overrides?.some((override) =>
    !override.actor.trim()
    || !override.reason.trim()
    || !override.evidenceRef.trim()
    || !Number.isFinite(override.confidence)
    || override.confidence < 0
    || override.confidence > 1
  )) return 'manual overrides require actor, reason, evidenceRef and confidence from 0 to 1'
  return undefined
}

function normalizeInput(input: NineGridInput): NineGridInput {
  return {
    boundary: { ...input.boundary },
    orientation: { ...input.orientation },
    rooms: input.rooms.map((room) => ({
      ...room,
      center: room.center ? normalizePoint(room.center, input.boundary) : undefined,
      polygon: room.polygon?.map((point) => normalizePoint(point, input.boundary)),
    })),
    overrides: input.overrides?.map((override) => ({ ...override })),
  }
}

function normalizePoint(point: NormalizedPoint, boundary: FloorPlanBoundary): NormalizedPoint {
  return {
    x: (point.x - boundary.x) / boundary.width,
    y: (point.y - boundary.y) / boundary.height,
  }
}

function collectEvidenceRefs(input: NineGridInput): readonly string[] {
  return uniqueSorted([
    input.orientation.evidenceRef,
    ...input.rooms.map((room) => room.evidenceRef),
    ...(input.overrides ?? []).map((override) => override.evidenceRef),
  ].filter((value) => value.trim().length > 0))
}

function placeRoom(room: FloorPlanRoomGeometry): NineGridRoomPlacement | undefined {
  const center = room.center ?? polygonCentroid(room.polygon)
  if (!center || !isInsideUnitSquare(center)) return undefined
  const shares = room.polygon ? sectorShares(room.polygon) : undefined
  const sector = shares ? dominantSector(shares) : sectorForPoint(center)
  return {
    roomId: room.id,
    kind: room.kind,
    label: room.label,
    sector,
    center,
    boundaryFuzzy: isNearGridLine(center),
    crossSectorFuzzy: shares ? isCrossSectorFuzzy(shares) : false,
    evidenceRef: room.evidenceRef,
  }
}

function roomFacts(room: NineGridRoomPlacement): readonly NineGridDerivedFact[] {
  if (room.kind === 'kitchen' && room.sector === 'south' && !room.boundaryFuzzy && !room.crossSectorFuzzy) {
    return [{
      code: 'kitchen.south',
      confidence: 0.92,
      evidence: `${room.label ?? room.roomId}的几何中心经九宫划分位于南方宫位。`,
      source: NINE_GRID_ALGORITHM_VERSION,
      roomId: room.roomId,
    }]
  }
  if (room.kind === 'bathroom' && isNearCenter(room) && !room.crossSectorFuzzy) {
    return [{
      code: 'bathroom.near-center',
      confidence: room.sector === 'center' ? 0.9 : 0.76,
      evidence: `${room.label ?? room.roomId}的几何中心经九宫划分靠近住宅中宫。`,
      source: NINE_GRID_ALGORITHM_VERSION,
      roomId: room.roomId,
    }]
  }
  return []
}

function applyOverrides(facts: readonly NineGridDerivedFact[], overrides: readonly NineGridOverride[]): readonly NineGridDerivedFact[] {
  const suppressed = new Set(overrides.filter((override) => override.decision === 'suppress').map((override) => override.code))
  const asserted = overrides
    .filter((override) => override.decision === 'assert')
    .map((override): NineGridDerivedFact => ({
      code: override.code,
      confidence: override.confidence,
      evidence: `Manual override by ${override.actor}: ${override.reason}`,
      source: 'human-override',
      override,
    }))
  const baseFacts = facts.filter((fact) => !suppressed.has(fact.code) && !asserted.some((override) => override.code === fact.code))
  return [...baseFacts, ...asserted].sort((left, right) => left.code.localeCompare(right.code))
}

function sectorForPoint(point: NormalizedPoint): NineGridSector {
  const column = Math.min(2, Math.max(0, Math.floor(point.x * 3)))
  const row = Math.min(2, Math.max(0, Math.floor(point.y * 3)))
  return sectorOrder[row * 3 + column]!
}

function isNearGridLine(point: NormalizedPoint): boolean {
  return [1 / 3, 2 / 3].some((line) => Math.abs(point.x - line) <= GRID_LINE_THRESHOLD || Math.abs(point.y - line) <= GRID_LINE_THRESHOLD)
}

function isNearCenter(room: NineGridRoomPlacement): boolean {
  return room.sector === 'center' || distance(room.center, { x: 0.5, y: 0.5 }) <= CENTER_DISTANCE_FOR_NEAR_CENTER
}

function sectorShares(polygon: readonly NormalizedPoint[]): Partial<Record<NineGridSector, number>> {
  const bounds = boundingBox(polygon)
  if (!bounds) return {}
  const samples = 28
  const counts = new Map<NineGridSector, number>()
  let total = 0
  for (let yIndex = 0; yIndex < samples; yIndex += 1) {
    for (let xIndex = 0; xIndex < samples; xIndex += 1) {
      const point = {
        x: bounds.minX + ((xIndex + 0.5) / samples) * (bounds.maxX - bounds.minX),
        y: bounds.minY + ((yIndex + 0.5) / samples) * (bounds.maxY - bounds.minY),
      }
      if (!pointInPolygon(point, polygon)) continue
      total += 1
      const sector = sectorForPoint(point)
      counts.set(sector, (counts.get(sector) ?? 0) + 1)
    }
  }
  if (total === 0) return {}
  return Object.fromEntries([...counts.entries()].map(([sector, count]) => [sector, count / total])) as Partial<Record<NineGridSector, number>>
}

function dominantSector(shares: Partial<Record<NineGridSector, number>>): NineGridSector {
  const ranked = Object.entries(shares).sort((left, right) => right[1] - left[1])
  return ranked[0]?.[0] as NineGridSector | undefined ?? 'center'
}

function isCrossSectorFuzzy(shares: Partial<Record<NineGridSector, number>>): boolean {
  const ranked = Object.values(shares).sort((left, right) => right - left)
  const top = ranked[0] ?? 0
  const second = ranked[1] ?? 0
  return top < CENTER_SECTOR_MIN_SHARE || Math.abs(top - second) <= AREA_SHARE_FUZZY_DELTA
}

function polygonCentroid(polygon: readonly NormalizedPoint[] | undefined): NormalizedPoint | undefined {
  if (!polygon?.length) return undefined
  const sum = polygon.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 })
  return { x: sum.x / polygon.length, y: sum.y / polygon.length }
}

function boundingBox(points: readonly NormalizedPoint[]): { minX: number; maxX: number; minY: number; maxY: number } | undefined {
  if (!points.every(isInsideUnitSquare)) return undefined
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  }
}

function pointInPolygon(point: NormalizedPoint, polygon: readonly NormalizedPoint[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index]!
    const previousPoint = polygon[previous]!
    const intersects = currentPoint.y > point.y !== previousPoint.y > point.y
      && point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / (previousPoint.y - currentPoint.y) + currentPoint.x
    if (intersects) inside = !inside
  }
  return inside
}

function isInsideUnitSquare(point: NormalizedPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
}

function distance(left: NormalizedPoint, right: NormalizedPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function stableHash(value: unknown): string {
  const text = stableStringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}
