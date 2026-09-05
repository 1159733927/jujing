import { describe, expect, it } from 'vitest'
import {
  ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA,
  ADMINISTRATIVE_BIRTHPLACE_TREE,
  ADMINISTRATIVE_SOURCE_CANDIDATES,
  BIRTHPLACE_DATASET_METADATA,
  BIRTHPLACE_TREE,
  GEONAMES_COORDINATE_ARTIFACT_METADATA,
  GEONAMES_IMPORTED_COORDINATE_COUNT,
  SELECTABLE_BIRTHPLACE_TREE,
  birthInputFromPlace,
  buildBirthplaceDatasetFromAdministrativeTree,
  findAdministrativeBirthplaceByCode,
  findBirthplace,
  findBirthplaceByCode,
  hasUsableBirthplaceCoordinate,
  resolveBirthplace,
  searchAdministrativeBirthplaces,
  searchBirthplaces,
  validateAdministrativeBirthplaceDataset,
  validateBirthplaceDataset,
} from '../src/index.js'

describe('birthplace data', () => {
  it('resolves a selected district from the product dataset to reviewed coordinates and timezone', () => {
    const place = findBirthplace('浙江省', '杭州市', '西湖区')
    expect(place).toBeDefined()
    expect(birthInputFromPlace(place!.province, place!.city, place!.district)).toMatchObject({
      locationName: '浙江省 杭州市 西湖区',
      longitude: 120.13333,
      latitude: 30.26667,
      timezone: 'Asia/Shanghai',
      placeCode: '330106',
      geoDataVersion: ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA.version,
    })
    expect(place!.district.coordinate).toMatchObject({ sourceLabel: 'GeoNames', license: 'CC BY 4.0', confidence: 'verified' })
  })

  it('keeps selectable city data unique by district code', () => {
    const codes = BIRTHPLACE_TREE.flatMap((province) => province.cities.flatMap((city) => city.districts.map((district) => district.code)))
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('exposes explicit dataset metadata instead of implying national coverage', () => {
    expect(BIRTHPLACE_DATASET_METADATA).toMatchObject({
      id: 'fengshui-birthplace-demo-cn',
      version: '2026.08-demo.1',
      coverage: 'demo-sample',
      coordinateSystem: 'WGS84',
      timezonePolicy: 'city-default-iana',
    })
    expect(BIRTHPLACE_DATASET_METADATA.source.license).toContain('not a full')
  })

  it('documents candidate source roles so hierarchy and coordinates are not conflated', () => {
    expect(ADMINISTRATIVE_SOURCE_CANDIDATES).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'province-city-china', kind: 'administrative-hierarchy', license: 'MIT', recommendation: 'candidate' }),
      expect.objectContaining({ id: 'geonames', kind: 'coordinate', license: 'CC BY 4.0', recommendation: 'candidate' }),
      expect.objectContaining({ id: 'commercial-geocoder', kind: 'coordinate', recommendation: 'not-for-offline-redistribution' }),
    ]))
  })

  it('loads administrative hierarchy with explicit licensed-partial coordinate metadata', () => {
    const report = validateAdministrativeBirthplaceDataset()
    expect(ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA).toMatchObject({
      id: 'cn-administrative-geonames-reviewed-coordinates',
      version: expect.stringContaining(GEONAMES_COORDINATE_ARTIFACT_METADATA.version),
      coverage: 'licensed-partial',
      source: expect.objectContaining({ license: expect.stringContaining('CC BY 4.0') }),
      statistics: {
        administrativeDistrictCount: 3311,
        licensedCoordinateCount: 2612,
        manualFallbackCoordinateCount: 2,
        selectableDistrictCount: 2614,
        unavailableDistrictCount: 697,
      },
    })
    expect(ADMINISTRATIVE_BIRTHPLACE_TREE.length).toBeGreaterThanOrEqual(30)
    expect(report.provinceCount).toBeGreaterThanOrEqual(30)
    expect(report.complete).toBe(true)
    expect(report.cityCount).toBeGreaterThan(300)
    expect(report.districtCount).toBeGreaterThan(3000)
    expect(report.unavailableDistrictCount).toBe(697)
    expect(report.selectableDistrictCount).toBe(2614)
  })

  it('finds province, city and district selections by administrative code', () => {
    expect(findBirthplaceByCode('330106')).toMatchObject({ province: { name: '浙江省' }, city: { name: '杭州市' }, district: { name: '西湖区' } })
    expect(findBirthplaceByCode('330100')).toBeUndefined()
    expect(findBirthplaceByCode('330000')).toBeUndefined()
    expect(findBirthplaceByCode('999999')).toBeUndefined()
  })

  it('searches birthplace selections with pagination and source metadata', () => {
    const firstPage = searchBirthplaces({ query: '杭州', limit: 2 })
    const secondPage = searchBirthplaces({ query: '杭州', limit: 2, offset: 2 })
    expect(firstPage.dataset.version).toBe(ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA.version)
    expect(firstPage.total).toBeGreaterThanOrEqual(3)
    expect(firstPage.items).toHaveLength(2)
    expect(secondPage.items[0]?.district.code).not.toBe(firstPage.items[0]?.district.code)
  })

  it('matches user-friendly birthplace queries across city and district suffixes', () => {
    expect(searchBirthplaces({ query: '杭州西湖', limit: 3 }).items[0]).toMatchObject({
      province: { name: '浙江省' },
      city: { name: '杭州市' },
      district: { name: '西湖区' },
    })
    expect(searchAdministrativeBirthplaces({ query: '杭州 西湖', limit: 3 }).items[0]).toMatchObject({
      province: { name: '浙江省' },
      city: { name: '杭州市' },
      district: { name: '西湖区' },
      selectable: true,
    })
  })

  it('searches administrative locations without pretending missing coordinates are usable', () => {
    const result = searchAdministrativeBirthplaces({ query: '密云', limit: 10 })
    expect(result.dataset.version).toBe(ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA.version)
    expect(result.total).toBeGreaterThan(0)
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        province: expect.objectContaining({ name: '北京市' }),
        city: expect.objectContaining({ name: '北京市' }),
        district: expect.objectContaining({
          code: '110118',
          name: '密云区',
          coordinate: expect.objectContaining({ confidence: 'unavailable' }),
        }),
        selectable: false,
      }),
    ]))
    expect(result.selectableDistrictCount + result.unavailableDistrictCount).toBe(result.total)
    expect(result.items[0]?.province).not.toHaveProperty('cities')
    expect(result.items[0]?.city).not.toHaveProperty('districts')
  })

  it('prioritizes GeoNames and only uses explicit manual-demo coordinates as fallback', () => {
    const selected = findAdministrativeBirthplaceByCode('330106')
    const fallback = findAdministrativeBirthplaceByCode('320508')
    const unavailable = findAdministrativeBirthplaceByCode('110118')
    expect(selected).toMatchObject({
      province: { name: '浙江省' },
      city: { name: '杭州市' },
      district: { name: '西湖区', longitude: 120.13333, coordinate: expect.objectContaining({ sourceLabel: 'GeoNames', confidence: 'verified' }) },
      selectable: true,
    })
    expect(fallback).toMatchObject({
      district: { code: '320508', name: '姑苏区', coordinate: expect.objectContaining({ confidence: 'manual-demo' }) },
      selectable: true,
    })
    expect(unavailable).toMatchObject({
      district: { code: '110118', coordinate: expect.objectContaining({ confidence: 'unavailable' }) },
      selectable: false,
    })
    expect(hasUsableBirthplaceCoordinate(selected!.district)).toBe(true)
    expect(hasUsableBirthplaceCoordinate(fallback!.district)).toBe(true)
    expect(hasUsableBirthplaceCoordinate(unavailable!.district)).toBe(false)
  })

  it('validates the bundled dataset before it is used by the picker', () => {
    const report = validateBirthplaceDataset()
    expect(report.complete).toBe(true)
    expect(report.issues).toEqual([])
    expect(report.districtCount).toBe(2614)
    expect(report.dataset.version).toBe(ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA.version)
  })

  it('builds a selectable birthplace tree from administrative data without inventing missing coordinates', () => {
    const result = buildBirthplaceDatasetFromAdministrativeTree([
      {
        code: '330000',
        name: '浙江省',
        cities: [{
          code: '330100',
          name: '杭州市',
          timezone: 'Asia/Shanghai',
          districts: [
            {
              code: '330106',
              name: '西湖区',
              longitude: 120.1302,
              latitude: 30.2595,
              coordinate: {
                sourceLabel: 'licensed-test-source',
                license: 'test-license',
                confidence: 'verified',
              },
            },
            { code: '330109', name: '萧山区' },
          ],
        }],
      },
    ], { ...BIRTHPLACE_DATASET_METADATA, id: 'test-national-adapter', coverage: 'administrative-only' })
    expect(result).toMatchObject({
      selectableDistrictCount: 1,
      unavailableDistrictCount: 1,
      issues: [{ code: '330109', name: '萧山区', reason: 'missing-coordinate' }],
    })
    expect(result.tree).toHaveLength(1)
    expect(result.tree[0].cities[0].districts).toEqual([
      expect.objectContaining({ code: '330106', longitude: 120.1302, coordinate: expect.objectContaining({ confidence: 'verified' }) }),
    ])
  })

  it('falls back to the default birthplace for legacy free-text locations', () => {
    expect(resolveBirthplace('不存在')).toMatchObject({ province: { name: '浙江省' }, city: { name: '杭州市' }, district: { name: '西湖区' } })
  })

  it('keeps the compact GeoNames artifact sorted, unique, valid and bound to the administrative tree', async () => {
    const artifact = (await import('../src/generated/geonames-cn-2026-08-31.json', { with: { type: 'json' } })).default
    const codes = artifact.records.map((record) => record.code)
    const administrativeCodes = new Set(ADMINISTRATIVE_BIRTHPLACE_TREE.flatMap((province) => province.cities.flatMap((city) => city.districts.map((district) => district.code))))
    expect(artifact.records).toHaveLength(2612)
    expect(GEONAMES_IMPORTED_COORDINATE_COUNT).toBe(2612)
    expect(codes).toEqual([...codes].sort())
    expect(new Set(codes).size).toBe(codes.length)
    for (const record of artifact.records) {
      expect(administrativeCodes.has(record.code)).toBe(true)
      expect(record.longitude).toBeGreaterThanOrEqual(-180)
      expect(record.longitude).toBeLessThanOrEqual(180)
      expect(record.latitude).toBeGreaterThanOrEqual(-90)
      expect(record.latitude).toBeLessThanOrEqual(90)
      expect([record.longitude, record.latitude]).not.toEqual([0, 0])
    }
    expect(artifact.metadata).toMatchObject({
      dumpDate: '2026-08-31',
      license: 'CC BY 4.0',
      attribution: 'GeoNames',
      importedRecordCount: 2612,
      administrativeDistrictCount: 3311,
      files: {
        places: { sha256: '64057955b60e80e8ae31ea073b41063e6d7a3cd5ef7f3d278be80dacb3c7127d' },
        admin1CodesAscii: { sha256: '590651498043f674accda2b7f46d21286cda0e290b02f8561c5005eee9a5448c' },
        admin2Codes: { sha256: 'e3844a99e8281d612a0125d292755a54d442a829c9f2b0f66422f9a97207b068' },
      },
    })
  })

  it.each([
    ['110101', '东城区', 116.41834, 39.93264], ['120101', '和平区', 117.19168, 39.11707],
    ['310101', '黄浦区', 121.47923, 31.224], ['500103', '渝中区', 106.53814, 29.55208],
    ['330106', '西湖区', 120.13333, 30.26667], ['360103', '西湖区', 115.92188, 28.62998],
    ['430903', '赫山区', 112.41314, 28.47679], ['659001', '石河子市', 86.01961, 44.32011],
    ['429004', '仙桃市', 113.41889, 30.3243], ['419001', '济源市', 112.42611, 35.14056],
    ['469007', '东方市', 108.84083, 18.99361], ['469022', '屯昌县', 110.04667, 19.34194],
  ])('exposes reviewed GeoNames sample %s', (code, name, longitude, latitude) => {
    expect(findAdministrativeBirthplaceByCode(code)).toMatchObject({
      district: { code, name, longitude, latitude, coordinate: { sourceLabel: 'GeoNames', license: 'CC BY 4.0', confidence: 'verified' } },
      selectable: true,
    })
  })

  it('keeps the legacy demo tree explicitly separate from the main selectable product tree', () => {
    expect(BIRTHPLACE_TREE.flatMap((province) => province.cities.flatMap((city) => city.districts))).toHaveLength(29)
    expect(SELECTABLE_BIRTHPLACE_TREE.flatMap((province) => province.cities.flatMap((city) => city.districts))).toHaveLength(2614)
    expect(BIRTHPLACE_DATASET_METADATA.coverage).toBe('demo-sample')
  })
})
