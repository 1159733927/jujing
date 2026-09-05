import { describe, expect, it } from 'vitest'

import { crosswalkGeoNamesChina, parseGeoNamesTsv } from '../src/geonames-crosswalk.js'
import type { AdministrativeCoordinateImportTree } from '../src/coordinate-import.js'

const ADMIN1_CODES = [
  'CN.02\tZhejiang\tZhejiang\t1784764',
  'CN.04\tJiangsu\tJiangsu\t1806260',
  'CN.07\tFujian\tFujian\t1811017',
  'CN.09\tHenan\tHenan\t1808520',
  'CN.11\tHunan\tHunan\t1806691',
  'CN.12\tHubei\tHubei\t1806949',
  'CN.13\tXinjiang\tXinjiang\t1529047',
  'CN.22\tBeijing\tBeijing\t2038349',
  'CN.23\tShanghai\tShanghai\t1796231',
  'CN.28\tTianjin\tTianjin\t1792943',
  'CN.31\tHainan\tHainan\t1809054',
  'CN.33\tChongqing\tChongqing\t1814905',
].join('\n')

const ADMIN2_CODES = [
  'CN.02.3301\tHangzhou Shi\tHangzhou Shi\t1808926',
  'CN.02.3302\tNingbo Shi\tNingbo Shi\t1799397',
  'CN.04.3201\tNanjing Shi\tNanjing Shi\t1799962',
  'CN.07.3501\tFuzhou Shi\tFuzhou Shi\t1810820',
  'CN.11.4309\tYiyang Shi\tYiyang Shi\t1792130',
  'CN.12.1790413\tXiantao Shi\tXiantao Shi\t1790413',
  'CN.22.11876380\tBeijing Municipality\tBeijing Municipality\t11876380',
  'CN.23.12324204\tShanghai Municipality\tShanghai Municipality\t12324204',
  'CN.28.12324202\tTianjin Municipality\tTianjin Municipality\t12324202',
  'CN.33.8739734\tChongqing Municipality\tChongqing Municipality\t8739734',
].join('\n')

const SOURCE = {
  dumpDate: '2026-08-30',
  sourceUrl: 'https://download.geonames.org/export/dump/',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: 'GeoNames',
  files: {
    places: { fileName: 'CN.txt', sha256: 'a'.repeat(64) },
    admin1CodesAscii: { fileName: 'admin1CodesASCII.txt', sha256: 'b'.repeat(64) },
    admin2Codes: { fileName: 'admin2Codes.txt', sha256: 'c'.repeat(64) },
  },
}

function geoNamesRow(overrides: Partial<Record<
  | 'geonameId' | 'name' | 'asciiName' | 'alternateNames' | 'latitude' | 'longitude'
  | 'featureClass' | 'featureCode' | 'countryCode' | 'admin1Code' | 'admin2Code'
  | 'admin3Code' | 'admin4Code',
  string
>> = {}): string {
  const value = {
    geonameId: '1010101',
    name: '西湖区',
    asciiName: 'Xihu Qu',
    alternateNames: 'Xihu District,西湖区',
    latitude: '30.2595',
    longitude: '120.1302',
    featureClass: 'A',
    featureCode: 'ADM3',
    countryCode: 'CN',
    admin1Code: '02',
    admin2Code: '3301',
    admin3Code: '330106',
    admin4Code: '',
    ...overrides,
  }
  return [
    value.geonameId,
    value.name,
    value.asciiName,
    value.alternateNames,
    value.latitude,
    value.longitude,
    value.featureClass,
    value.featureCode,
    value.countryCode,
    '',
    value.admin1Code,
    value.admin2Code,
    value.admin3Code,
    value.admin4Code,
    '0',
    '',
    '17',
    'Asia/Shanghai',
    '2026-08-30',
  ].join('\t')
}

function admin1ParentRow(admin1Code: string, geonameId: string, localName: string): string {
  return geoNamesRow({
    geonameId,
    name: localName,
    asciiName: localName,
    alternateNames: localName,
    featureCode: 'ADM1',
    admin1Code,
    admin2Code: '',
    admin3Code: '',
  })
}

function admin2ParentRow(admin1Code: string, geonameId: string, localName: string): string {
  return geoNamesRow({
    geonameId,
    name: localName,
    asciiName: localName,
    alternateNames: localName,
    featureCode: 'ADM2',
    admin1Code,
    admin2Code: geonameId,
    admin3Code: '',
  })
}

function crosswalk(rows: readonly string[], options: {
  admin1Codes?: string
  admin2Codes?: string
  administrativeTree?: readonly AdministrativeCoordinateImportTree[]
} = {}) {
  return crosswalkGeoNamesChina({
    geoNamesText: rows.join('\n'),
    admin1CodesAsciiText: options.admin1Codes ?? ADMIN1_CODES,
    admin2CodesText: options.admin2Codes ?? ADMIN2_CODES,
    source: SOURCE,
    administrativeTree: options.administrativeTree,
  })
}

describe('GeoNames China crosswalk', () => {
  it('emits an importer-compatible candidate only after code, name, and parent verification', () => {
    const result = crosswalk([geoNamesRow()])

    expect(result.summary).toEqual({
      inputCount: 1,
      outputCount: 1,
      filteredCount: 0,
      rejectedCount: 0,
      conflictCount: 0,
      duplicateCount: 0,
    })
    expect(result.records[0]).toMatchObject({
      sourceRow: 1,
      externalId: '1010101',
      administrativeCode: '330106',
      name: '西湖区',
      provinceName: '浙江省',
      cityName: '杭州市',
      longitude: 120.1302,
      latitude: 30.2595,
      audit: {
        geonameId: '1010101',
        sourceRow: 1,
        mappingMethod: 'verified-admin3-six-digit',
        featureCode: 'ADM3',
        geoNamesAdminCodes: { admin1: '02', admin2: '3301', admin3: '330106', admin4: '' },
      },
    })
  })

  it('maps a real-format Hangzhou West Lake ADM3 row through its verified admin2 parent and name', () => {
    const result = crosswalk([geoNamesRow({
      name: 'Xihu Qu',
      asciiName: 'Xihu Qu',
      alternateNames: 'Xihu District,西湖区',
      admin3Code: '6607381',
    })])

    expect(result.conflicts).toEqual([])
    expect(result.records).toEqual([expect.objectContaining({
      administrativeCode: '330106',
      name: '西湖区',
      provinceName: '浙江省',
      cityName: '杭州市',
      audit: expect.objectContaining({
        sourceName: 'Xihu Qu',
        mappingMethod: 'verified-admin2-parent-and-name',
        geoNamesAdminCodes: expect.objectContaining({ admin1: '02', admin2: '3301', admin3: '6607381' }),
      }),
    })])
  })

  it('maps all four direct-controlled municipalities through their real non-four-digit admin2 IDs', () => {
    const fixtures = [
      { admin1Code: '22', admin1Id: '2038349', admin2Id: '11876380', province: '北京市', city: '北京市', district: '海淀区', code: '110108' },
      { admin1Code: '23', admin1Id: '1796231', admin2Id: '12324204', province: '上海市', city: '上海市', district: '黄浦区', code: '310101' },
      { admin1Code: '28', admin1Id: '1792943', admin2Id: '12324202', province: '天津市', city: '天津市', district: '和平区', code: '120101' },
      { admin1Code: '33', admin1Id: '1814905', admin2Id: '8739734', province: '重庆市', city: '重庆市', district: '万州区', code: '500101' },
    ]

    for (const fixture of fixtures) {
      const result = crosswalk([
        geoNamesRow({
          geonameId: `${fixture.admin2Id}1`,
          name: fixture.district,
          asciiName: fixture.district,
          alternateNames: fixture.district,
          admin1Code: fixture.admin1Code,
          admin2Code: fixture.admin2Id,
          admin3Code: `${fixture.admin2Id}1`,
        }),
        geoNamesRow({
          geonameId: fixture.admin1Id,
          name: fixture.province,
          asciiName: fixture.province,
          alternateNames: fixture.province,
          featureCode: 'ADM1',
          admin1Code: fixture.admin1Code,
          admin2Code: '',
          admin3Code: '',
        }),
        geoNamesRow({
          geonameId: fixture.admin2Id,
          name: fixture.city,
          asciiName: fixture.city,
          alternateNames: fixture.city,
          featureCode: 'ADM2',
          admin1Code: fixture.admin1Code,
          admin2Code: fixture.admin2Id,
          admin3Code: '',
        }),
      ])

      expect(result.conflicts).toEqual([])
      expect(result.records).toEqual([expect.objectContaining({
        administrativeCode: fixture.code,
        provinceName: fixture.province,
        cityName: fixture.city,
        audit: expect.objectContaining({ mappingMethod: 'verified-admin2-parent-and-name' }),
      })])
    }
  })

  it('maps five real province-direct county-level ADM3 formats only inside a verified province', () => {
    const fixtures = [
      { admin1Code: '13', admin1Id: '1529047', province: '新疆维吾尔自治区', district: '石河子市', code: '659001', admin2Code: '' },
      { admin1Code: '12', admin1Id: '1806949', province: '湖北省', district: '仙桃市', code: '429004', admin2Code: '1790413', withParent: true },
      { admin1Code: '09', admin1Id: '1808520', province: '河南省', district: '济源市', code: '419001', admin2Code: '1809532' },
      { admin1Code: '31', admin1Id: '1809054', province: '海南省', district: '东方市', code: '469007', admin2Code: '4690' },
      { admin1Code: '31', admin1Id: '1809054', province: '海南省', district: '屯昌县', code: '469022', admin2Code: '1796134' },
    ]

    for (const [index, fixture] of fixtures.entries()) {
      const rows = [
        geoNamesRow({
          geonameId: `800000${index}`,
          name: `${fixture.district} GeoNames display`,
          asciiName: fixture.district,
          alternateNames: fixture.district,
          admin1Code: fixture.admin1Code,
          admin2Code: fixture.admin2Code,
          admin3Code: `700000${index}`,
        }),
        admin1ParentRow(fixture.admin1Code, fixture.admin1Id, fixture.province),
      ]
      if (fixture.withParent) rows.push(admin2ParentRow(fixture.admin1Code, fixture.admin2Code, fixture.district))
      const result = crosswalk(rows)

      expect(result.conflicts).toEqual([])
      expect(result.records).toEqual([expect.objectContaining({
        administrativeCode: fixture.code,
        provinceName: fixture.province,
        name: fixture.district,
        audit: expect.objectContaining({ mappingMethod: 'verified-province-direct-and-name' }),
      })])
    }
  })

  it('does not cross province boundaries when a province-direct district name is duplicated', () => {
    const administrativeTree = [
      {
        code: '420000',
        name: '湖北省',
        cities: [{ code: '429000', name: '湖北省-自治区直辖县级行政区划', districts: [{ code: '429004', name: '仙桃市' }] }],
      },
      {
        code: '410000',
        name: '河南省',
        cities: [{ code: '419000', name: '河南省-省直辖县级行政区划', districts: [{ code: '419099', name: '仙桃市' }] }],
      },
    ]
    const result = crosswalk([
      geoNamesRow({ name: 'Xiantao', alternateNames: '仙桃市', admin1Code: '12', admin2Code: '', admin3Code: '7000001' }),
      admin1ParentRow('12', '1806949', '湖北省'),
    ], { administrativeTree })

    expect(result.conflicts).toEqual([])
    expect(result.records).toEqual([expect.objectContaining({ administrativeCode: '429004' })])
  })

  it('does not fall back from province-direct matching into an ordinary prefecture city', () => {
    const administrativeTree = [{
      code: '420000',
      name: '湖北省',
      cities: [
        { code: '429000', name: '湖北省-自治区直辖县级行政区划', districts: [{ code: '429004', name: '仙桃市' }] },
        { code: '420100', name: '武汉市', districts: [{ code: '420199', name: '测试同名区' }] },
      ],
    }]
    const result = crosswalk([
      geoNamesRow({ name: 'Test', alternateNames: '测试同名区', admin1Code: '12', admin2Code: '', admin3Code: '7000002' }),
      admin1ParentRow('12', '1806949', '湖北省'),
    ], { administrativeTree })

    expect(result.records).toEqual([])
    expect(result.conflicts).toEqual([expect.objectContaining({ reason: 'admin2-context-missing' })])
  })

  it('rejects a province-direct name when the ADM1 province cannot be verified', () => {
    const result = crosswalk([geoNamesRow({
      name: 'Shihezi',
      alternateNames: '石河子市',
      admin1Code: '13',
      admin2Code: '',
      admin3Code: '7000003',
    })])

    expect(result.records).toEqual([])
    expect(result.conflicts).toEqual([expect.objectContaining({ reason: 'parent-context-mismatch' })])
  })

  it('filters records from the wrong country', () => {
    const result = crosswalk([geoNamesRow({ countryCode: 'US' })])

    expect(result.records).toEqual([])
    expect(result.filtered).toMatchObject([{ sourceRow: 1, reason: 'country-not-cn' }])
  })

  it('filters non-administrative features and unsupported administrative levels', () => {
    const result = crosswalk([
      geoNamesRow({ geonameId: '2', featureClass: 'P', featureCode: 'PPL' }),
      geoNamesRow({ geonameId: '3', featureCode: 'ADM1' }),
    ])

    expect(result.records).toEqual([])
    expect(result.filtered.map(({ reason }) => reason)).toEqual([
      'feature-class-not-administrative',
      'unsupported-feature-code',
    ])
  })

  it('filters ADM4 before matching so a Heshan child row cannot suppress the valid ADM3 candidate', () => {
    const result = crosswalk([
      geoNamesRow({
        geonameId: '1792129',
        name: 'Heshan Qu',
        asciiName: 'Heshan Qu',
        alternateNames: '赫山区',
        admin1Code: '11',
        admin2Code: '4309',
        admin3Code: '1792129',
      }),
      geoNamesRow({
        geonameId: '9000001',
        name: '赫山区',
        asciiName: 'Heshan',
        alternateNames: '赫山区',
        featureCode: 'ADM4',
        admin1Code: '11',
        admin2Code: '4309',
        admin3Code: '1792129',
        admin4Code: '9000001',
        longitude: '112.35',
      }),
    ])

    expect(result.records).toEqual([expect.objectContaining({ administrativeCode: '430903' })])
    expect(result.conflicts).toEqual([])
    expect(result.filtered).toEqual([expect.objectContaining({ geonameId: '9000001', reason: 'adm4-not-imported' })])
  })

  it('rejects invalid WGS84 coordinates without supplying a fallback', () => {
    const result = crosswalk([
      geoNamesRow({ geonameId: '4', longitude: '181' }),
      geoNamesRow({ geonameId: '5', latitude: '' }),
      geoNamesRow({ geonameId: '5b', longitude: '0', latitude: '0' }),
    ])

    expect(result.records).toEqual([])
    expect(result.rejected.map(({ reason }) => reason)).toEqual(['invalid-longitude', 'invalid-latitude', 'zero-coordinate'])
  })

  it('scopes duplicate names to the verified city and never guesses across cities', () => {
    const result = crosswalk([geoNamesRow({
      geonameId: '6',
      name: '鼓楼区',
      asciiName: 'Gulou Qu',
      alternateNames: '鼓楼区',
      admin1Code: '04',
      admin2Code: '3201',
      admin3Code: '1799963',
    })])

    expect(result.conflicts).toEqual([])
    expect(result.records).toEqual([expect.objectContaining({
      administrativeCode: '320106',
      cityName: '南京市',
    })])
  })

  it('does not fall back to a matching district name outside the verified city', () => {
    const result = crosswalk([geoNamesRow({
      name: '鼓楼区',
      asciiName: 'Gulou Qu',
      alternateNames: '鼓楼区',
      admin3Code: '1799963',
    })])

    expect(result.records).toEqual([])
    expect(result.conflicts).toEqual([expect.objectContaining({
      reason: 'district-name-not-found-in-parent',
      candidateCodes: [],
    })])
  })

  it('reports ambiguity when the verified city itself contains duplicate exact names', () => {
    const administrativeTree = [{
      code: '330000',
      name: '浙江省',
      cities: [{
        code: '330100',
        name: '杭州市',
        districts: [
          { code: '330106', name: '中心区' },
          { code: '330107', name: '中心区' },
        ],
      }],
    }]
    const result = crosswalk([geoNamesRow({
      name: '中心区',
      asciiName: 'Central District',
      alternateNames: '中心区',
      admin3Code: '6607381',
    })], { administrativeTree })

    expect(result.records).toEqual([])
    expect(result.conflicts).toEqual([expect.objectContaining({
      reason: 'ambiguous-name',
      candidateCodes: ['330106', '330107'],
    })])
  })

  it('reports a parent hierarchy conflict even when the six-digit code and name match', () => {
    const result = crosswalk([geoNamesRow({ admin2Code: '3302' })])

    expect(result.records).toEqual([])
    expect(result.conflicts).toEqual([expect.objectContaining({
      reason: 'parent-context-mismatch',
      candidateCodes: ['330106'],
    })])
  })

  it('rejects an admin1 mapping whose province prefix disagrees with the verified city', () => {
    const result = crosswalk([geoNamesRow({ admin1Code: '04', admin3Code: '6607381' })], {
      admin2Codes: `${ADMIN2_CODES}\nCN.04.3301\tHangzhou Shi\tHangzhou Shi\t1808926`,
    })

    expect(result.records).toEqual([])
    expect(result.conflicts).toEqual([expect.objectContaining({ reason: 'parent-context-mismatch' })])
  })

  it('rejects an admin2 code absent from the GeoNames mapping and local city hierarchy', () => {
    const result = crosswalk([geoNamesRow({ admin2Code: '9999', admin3Code: '6607381' })])

    expect(result.records).toEqual([])
    expect(result.conflicts).toEqual([expect.objectContaining({ reason: 'admin2-context-missing' })])
  })

  it('withholds every row when one local code has conflicting coordinates', () => {
    const result = crosswalk([
      geoNamesRow({ geonameId: '7', name: 'Xihu Qu', alternateNames: '西湖区', admin3Code: '6607381' }),
      geoNamesRow({ geonameId: '8', name: 'West Lake District', alternateNames: '西湖区', admin3Code: '6607382', longitude: '120.1400' }),
    ])

    expect(result.records).toEqual([])
    expect(result.conflicts).toHaveLength(2)
    expect(result.conflicts.every(({ reason }) => reason === 'duplicate-coordinate-disagreement')).toBe(true)
    expect(result.conflicts.map(({ inputName }) => inputName)).toEqual(['Xihu Qu', 'West Lake District'])
  })

  it('audits every ignored row when duplicate coordinates agree', () => {
    const result = crosswalk([
      geoNamesRow({ geonameId: '7', name: 'Xihu Qu', alternateNames: '西湖区', admin3Code: '6607381' }),
      geoNamesRow({ geonameId: '8', name: 'West Lake District', alternateNames: '西湖区', admin3Code: '6607382' }),
    ])

    expect(result.records).toHaveLength(1)
    expect(result.summary.duplicateCount).toBe(1)
    expect(result.duplicates).toEqual([{
      sourceRow: 2,
      geonameId: '8',
      inputName: 'West Lake District',
      administrativeCode: '330106',
      longitude: 120.1302,
      latitude: 30.2595,
      keptSourceRow: 1,
      keptGeonameId: '7',
      reason: 'duplicate-coordinate-agreement',
    }])
  })

  it('reports malformed source rows instead of shifting GeoNames columns', () => {
    const parsed = parseGeoNamesTsv('9\ttoo\tfew')

    expect(parsed.records).toEqual([])
    expect(parsed.rejected).toEqual([expect.objectContaining({
      sourceRow: 1,
      geonameId: '9',
      reason: 'invalid-column-count',
    })])
  })
})
