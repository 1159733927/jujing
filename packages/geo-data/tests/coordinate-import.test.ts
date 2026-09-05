import { describe, expect, it } from 'vitest'
import fixture from './fixtures/coordinate-import.fixture.json' with { type: 'json' }
import { importCoordinateDataset } from '../src/coordinate-import.js'

interface DistrictCodeOnly {
  code: string
}

describe('coordinate import', () => {
  it('matches coordinate records by exact administrative code before names', () => {
    const result = importCoordinateDataset({
      administrativeTree: fixture.administrativeTree,
      coordinateDataset: fixture.coordinateDataset,
      records: fixture.records.exactAdminCode,
    })

    expect(result.issues).toEqual([])
    expect(result.selectableDistrictCount).toBe(1)
    expect(result.tree[0].cities[0].districts[0]).toMatchObject({
      code: '330106',
      name: '西湖区',
      longitude: 120.1302,
      latitude: 30.2595,
      coordinate: {
        sourceLabel: 'Fixture Coordinate Registry',
        license: 'Fixture Data License 1.0',
        confidence: 'verified',
      },
    })
  })

  it('rejects name-only coordinate records when the district name is ambiguous', () => {
    const result = importCoordinateDataset({
      administrativeTree: fixture.administrativeTree,
      coordinateDataset: fixture.coordinateDataset,
      records: fixture.records.ambiguousName,
    })

    expect(result.selectableDistrictCount).toBe(0)
    expect(result.issues).toEqual([
      {
        code: undefined,
        name: '鼓楼区',
        reason: 'ambiguous-name',
        matches: ['320106', '350102'],
      },
    ])
  })

  it('rejects coordinate records outside valid WGS84 longitude and latitude ranges', () => {
    const result = importCoordinateDataset({
      administrativeTree: fixture.administrativeTree,
      coordinateDataset: fixture.coordinateDataset,
      records: fixture.records.invalidCoordinate,
    })

    expect(result.selectableDistrictCount).toBe(0)
    expect(result.issues).toEqual([
      {
        code: '330108',
        name: '滨江区',
        reason: 'invalid-coordinate',
      },
    ])
  })

  it('rejects duplicate coordinate records with conflicting coordinates for the same administrative code', () => {
    const result = importCoordinateDataset({
      administrativeTree: fixture.administrativeTree,
      coordinateDataset: fixture.coordinateDataset,
      records: fixture.records.duplicateConflict,
    })

    expect(result.selectableDistrictCount).toBe(0)
    expect(result.issues).toEqual([
      {
        code: '330106',
        name: '西湖区',
        reason: 'duplicate-coordinate-conflict',
      },
    ])
  })

  it('rejects coordinate records that do not carry source and license attribution', () => {
    const result = importCoordinateDataset({
      administrativeTree: fixture.administrativeTree,
      coordinateDataset: fixture.coordinateDataset,
      records: fixture.records.missingAttribution,
    })

    expect(result.selectableDistrictCount).toBe(0)
    expect(result.issues).toEqual([
      {
        code: '330108',
        name: '滨江区',
        reason: 'missing-attribution',
      },
    ])
  })

  it('returns versioned production dataset metadata for imported coordinate output', () => {
    const result = importCoordinateDataset({
      administrativeTree: fixture.administrativeTree,
      coordinateDataset: fixture.coordinateDataset,
      records: fixture.records.versionedOutput,
    })

    expect(result.dataset).toMatchObject({
      id: 'licensed-coordinate-import-fixture',
      version: 'licensed-coordinates@2026.08.31',
      coverage: 'production',
      source: {
        label: 'Fixture Coordinate Registry',
        license: 'Fixture Data License 1.0',
      },
      generatedAt: '2026-08-31T00:00:00.000Z',
      coordinateSystem: 'WGS84',
      timezonePolicy: 'city-default-iana',
    })
    expect(result.selectableDistrictCount).toBe(2)
    expect(result.tree[0].cities[0].districts.map((district: DistrictCodeOnly) => district.code)).toEqual(['330106', '330108'])
  })
})
