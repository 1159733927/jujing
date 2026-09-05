import { describe, expect, it } from 'vitest'
import {
  assertSingleResidenceFloorPlan,
  getResidenceFloorPlanFixture,
  residenceFloorPlanFixtures,
} from '../src/floorplan-fixtures.js'

describe('residence floor-plan fixtures', () => {
  it('keeps 8029 and 8031 as separate overview residences with unknown facing', () => {
    const plan8029 = getResidenceFloorPlanFixture('8029')
    const plan8031 = getResidenceFloorPlanFixture('8031')

    expect(residenceFloorPlanFixtures).toHaveLength(2)
    expect(plan8029.residenceId).not.toBe(plan8031.residenceId)
    expect(plan8029.photo).toMatchObject({ room: 'overview', facing: 'unknown' })
    expect(plan8031.photo).toMatchObject({ room: 'overview', facing: 'unknown' })
    expect(plan8029.orientation).toMatchObject({ northUp: true, residenceFacing: 'unknown' })
    expect(plan8031.orientation).toMatchObject({ northUp: true, residenceFacing: 'unknown' })
  })

  it('records reliable facts and explicit uncertainty for each floor plan', () => {
    const plan8029 = getResidenceFloorPlanFixture('8029')
    const plan8031 = getResidenceFloorPlanFixture('8031')

    expect(plan8029.reliableFacts.map((fact) => fact.visionFactCode)).toContain('kitchen.south')
    expect(plan8029.reliableFacts.map((fact) => fact.visionFactCode)).not.toContain('bathroom.near-center')
    expect(plan8029.uncertainties.join('\n')).toContain('不能仅凭户型图确认住宅整体坐向')
    expect(plan8029.uncertainties.join('\n')).toContain('未确认是否存在入户门到阳台的直线穿堂动线')
    expect(plan8029.uncertainties.join('\n')).toContain('卫生间是否属于近中宫需按统一九宫格算法或人工标注复核')
    expect(plan8031.reliableFacts.map((fact) => fact.label)).toEqual(expect.arrayContaining([
      '厨房在西北侧',
      '主卧在东南侧',
    ]))
    expect(plan8031.uncertainties.join('\n')).toContain('未确认入户门位置')
  })

  it('rejects mixing different floor-plan residences in one report case', () => {
    const plan8029 = getResidenceFloorPlanFixture('8029')
    const plan8031 = getResidenceFloorPlanFixture('8031')

    expect(() => assertSingleResidenceFloorPlan([plan8029, plan8029], 'demo report')).not.toThrow()
    expect(() => assertSingleResidenceFloorPlan([plan8029, plan8031], 'demo report')).toThrow(
      /demo report cannot mix different residences/u,
    )
  })
})
