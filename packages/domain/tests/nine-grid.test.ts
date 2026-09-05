import { describe, expect, it } from 'vitest'
import { analyzeFloorPlanNineGrid, stableNineGridHash } from '../src/nine-grid.js'

const baseInput = {
  boundary: { x: 0, y: 0, width: 1000, height: 800 },
  orientation: { northUp: true, evidenceRef: 'plan:8029:north-arrow' },
  rooms: [
    {
      id: 'kitchen',
      kind: 'kitchen',
      label: 'Kitchen',
      polygon: [
        { x: 430, y: 690 },
        { x: 570, y: 690 },
        { x: 570, y: 790 },
        { x: 430, y: 790 },
      ],
      evidenceRef: 'plan:8029:kitchen-polygon',
    },
    {
      id: 'bathroom',
      kind: 'bathroom',
      label: 'Bathroom',
      center: { x: 520, y: 420 },
      evidenceRef: 'plan:8029:bathroom-center',
    },
  ],
} as const

describe('floor-plan nine-grid analysis', () => {
  it('derives south kitchen and near-center bathroom facts from normalized geometry', () => {
    const result = analyzeFloorPlanNineGrid(baseInput)

    expect(result.status).toBe('derived')
    if (result.status !== 'derived') return
    expect(result.algorithmVersion).toBe('floorplan-nine-grid-v1')
    expect(result.evidenceRefs).toEqual([
      'plan:8029:bathroom-center',
      'plan:8029:kitchen-polygon',
      'plan:8029:north-arrow',
    ])
    expect(result.rooms.map((room) => [room.roomId, room.sector])).toEqual([
      ['kitchen', 'south'],
      ['bathroom', 'center'],
    ])
    expect(result.facts.map((fact) => fact.code)).toEqual(['bathroom.near-center', 'kitchen.south'])
    expect(result.facts.map((fact) => fact.source)).toEqual(['floorplan-nine-grid-v1', 'floorplan-nine-grid-v1'])
    expect(result.facts.map((fact) => fact.code)).not.toContain('circulation.entry-balcony-aligned')
  })

  it('keeps a stable input hash independent of object key ordering', () => {
    const left = stableNineGridHash({ b: 2, a: { d: 4, c: 3 } })
    const right = stableNineGridHash({ a: { c: 3, d: 4 }, b: 2 })

    expect(left).toBe(right)
  })

  it('marks rooms near grid lines as fuzzy and withholds a south-kitchen fact', () => {
    const result = analyzeFloorPlanNineGrid({
      ...baseInput,
      rooms: [{
        id: 'kitchen',
        kind: 'kitchen',
        center: { x: 500, y: 535 },
        evidenceRef: 'plan:kitchen-near-line',
      }],
    })

    expect(result.status).toBe('derived')
    if (result.status !== 'derived') return
    expect(result.rooms[0]).toMatchObject({ sector: 'south', boundaryFuzzy: true })
    expect(result.facts).toEqual([])
  })

  it('marks cross-sector area ties as fuzzy and withholds deterministic topology facts', () => {
    const result = analyzeFloorPlanNineGrid({
      ...baseInput,
      rooms: [{
        id: 'kitchen',
        kind: 'kitchen',
        polygon: [
          { x: 0, y: 560 },
          { x: 1000, y: 560 },
          { x: 1000, y: 780 },
          { x: 0, y: 780 },
        ],
        evidenceRef: 'plan:kitchen-wide-south',
      }],
    })

    expect(result.status).toBe('derived')
    if (result.status !== 'derived') return
    expect(result.rooms[0]?.crossSectorFuzzy).toBe(true)
    expect(result.facts).toEqual([])
  })

  it('allows auditable manual overrides to assert or suppress a geometry fact', () => {
    const asserted = analyzeFloorPlanNineGrid({
      ...baseInput,
      rooms: [{
        id: 'bathroom',
        kind: 'bathroom',
        center: { x: 850, y: 410 },
        evidenceRef: 'plan:bathroom-east',
      }],
      overrides: [{
        code: 'bathroom.near-center',
        decision: 'assert',
        confidence: 0.74,
        actor: 'expert-1',
        reason: 'manual measurement places the wet area on the center boundary',
        evidenceRef: 'review:manual-grid-1',
      }],
    })
    const suppressed = analyzeFloorPlanNineGrid({
      ...baseInput,
      overrides: [{
        code: 'kitchen.south',
        decision: 'suppress',
        confidence: 1,
        actor: 'expert-1',
        reason: 'kitchen label belongs to a balcony cabinet, not the actual kitchen',
        evidenceRef: 'review:manual-grid-2',
      }],
    })

    expect(asserted.status).toBe('derived')
    expect(suppressed.status).toBe('derived')
    if (asserted.status !== 'derived' || suppressed.status !== 'derived') return
    expect(asserted.facts).toEqual([expect.objectContaining({
      code: 'bathroom.near-center',
      source: 'human-override',
      override: expect.objectContaining({ actor: 'expert-1', evidenceRef: 'review:manual-grid-1' }),
    })])
    expect(suppressed.facts.map((fact) => fact.code)).toEqual(['bathroom.near-center'])
  })

  it('fails closed when north-up orientation is missing', () => {
    const result = analyzeFloorPlanNineGrid({
      ...baseInput,
      orientation: { northUp: false, evidenceRef: 'plan:no-compass' },
    })

    expect(result).toMatchObject({
      status: 'unavailable',
      reason: 'floor-plan orientation must explicitly confirm north-up',
    })
  })

  it('withholds facts when room geometry falls outside the normalized boundary', () => {
    const outsideBoundary = analyzeFloorPlanNineGrid({
      ...baseInput,
      rooms: [{ id: 'bathroom', kind: 'bathroom', center: { x: 1200, y: 400 }, evidenceRef: 'plan:outside' }],
    })

    expect(outsideBoundary.status).toBe('derived')
    if (outsideBoundary.status !== 'derived') return
    expect(outsideBoundary.rooms).toEqual([])
    expect(outsideBoundary.facts).toEqual([])
  })

  it('fails closed when room geometry is missing', () => {
    const result = analyzeFloorPlanNineGrid({
      ...baseInput,
      rooms: [{ id: 'bathroom', kind: 'bathroom', evidenceRef: 'plan:no-geometry' }],
    })

    expect(result).toMatchObject({
      status: 'unavailable',
      reason: 'each room requires either a center point or a polygon with at least three points',
    })
  })
})
