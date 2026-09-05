import { describe, expect, it } from 'vitest'
import {
  birthplaceFallbackMessage,
  birthplaceDatasetAttribution,
  birthInputFromResolvedPlace,
  buildBirthplaceSearchUrl,
  defaultBirth,
  hasCompleteBirthplaceEvidence,
  isBirthplaceSelectionActive,
  isPlaceSelectable,
  normalizeBirthplaceDatasetMetadata,
  normalizeBirthplaceSearchResponse,
  normalizeStoredBirthInput,
  coordinateConfidenceLabel,
} from './main'

const dataset = {
  id: 'cn-administrative-geonames-reviewed-coordinates',
  version: 'province-city-china@8.5.8+geonames-cn@2026-08-31.test',
  label: '中国出生地点行政区划与已审核坐标库',
  coverage: 'licensed-partial',
  source: {
    label: 'province-city-china + GeoNames',
    url: 'https://download.geonames.org/export/dump/',
    license: 'MIT; CC BY 4.0',
    notes: 'Partial reviewed coverage.',
  },
  generatedAt: '2026-08-31T00:00:00.000Z',
  coordinateSystem: 'WGS84',
  timezonePolicy: 'city-default-iana',
  sources: [{ label: 'GeoNames', url: 'https://www.geonames.org/', license: 'CC BY 4.0', notes: 'Attribution required.' }],
  statistics: {
    administrativeDistrictCount: 3311,
    licensedCoordinateCount: 2612,
    manualFallbackCoordinateCount: 2,
    selectableDistrictCount: 2614,
    unavailableDistrictCount: 697,
  },
} as const

describe('birthplace API helpers', () => {
  it('ships a reproducible canonical default birthplace', () => {
    expect(hasCompleteBirthplaceEvidence(defaultBirth)).toBe(true)
    expect(defaultBirth).toMatchObject({
      province: '浙江省', city: '杭州市', district: '西湖区', placeCode: '330106',
      timezone: 'Asia/Shanghai', longitude: 120.13333, latitude: 30.26667,
    })
  })

  it('builds the proxied birthplace search URL with Chinese query and pagination', () => {
    const url = buildBirthplaceSearchUrl({ query: ' 杭州 西湖 ', limit: 8, offset: 16 })
    expect(url).toBe('/api/v1/birthplaces/administrative?q=%E6%9D%AD%E5%B7%9E+%E8%A5%BF%E6%B9%96&limit=8&offset=16')
  })

  it('omits blank query while keeping explicit pagination', () => {
    const url = buildBirthplaceSearchUrl({ query: '   ', limit: 12, offset: 0 })
    expect(url).toBe('/api/v1/birthplaces/administrative?limit=12&offset=0')
  })

  it('normalizes valid administrative payloads while retaining unavailable-coordinate places', () => {
    const response = normalizeBirthplaceSearchResponse({
      total: 2,
      limit: 8,
      offset: 0,
      dataset,
      items: [
        {
          province: { name: '浙江省', code: '330000', cities: [] },
          city: { name: '杭州市', code: '330100', timezone: 'Asia/Shanghai', districts: [] },
          selectable: true,
          district: { name: '西湖区', code: '330106', longitude: 120.1302, latitude: 30.2595 },
        },
        {
          province: { name: '西藏自治区', code: '540000', cities: [] },
          city: { name: '拉萨市', code: '540100', timezone: 'Asia/Shanghai', districts: [] },
          selectable: false,
          district: { name: '城关区', code: '540102', coordinate: { confidence: 'unavailable' } },
        },
      ],
    })

    expect(response).toMatchObject({ total: 2, limit: 8, offset: 0, dataset: { version: dataset.version, coverage: 'licensed-partial' } })
    expect(response.items).toHaveLength(2)
    expect(response.items[0].district.name).toBe('西湖区')
    expect(response.items[1]).toMatchObject({ selectable: false, district: { name: '城关区', coordinate: { confidence: 'unavailable' } } })
  })

  it('throws a clear error for unusable API payloads so the component can use local demo fallback', () => {
    expect(() => normalizeBirthplaceSearchResponse({ total: 0 })).toThrow('出生地点接口缺少地点列表。')
  })

  it('requires full birthplace provenance before treating a chart as reproducible', () => {
    expect(hasCompleteBirthplaceEvidence({
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      placeCode: '330106',
      geoDataVersion: dataset.version,
      longitude: 120.1302,
      latitude: 30.2595,
      timezone: 'Asia/Shanghai',
    })).toBe(true)

    expect(hasCompleteBirthplaceEvidence({
      longitude: 120.1551,
      geoDataVersion: dataset.version,
      timezone: 'Asia/Shanghai',
    })).toBe(false)

    expect(hasCompleteBirthplaceEvidence({
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      placeCode: '330106',
      geoDataVersion: dataset.version,
      longitude: 120.1302,
      timezone: 'Asia/Shanghai',
    })).toBe(false)
  })

  it('rejects null-island coordinates as incomplete birthplace evidence', () => {
    const base = {
      province: '测试省', city: '测试市', district: '测试区', placeCode: '000000',
      geoDataVersion: dataset.version, timezone: 'Asia/Shanghai', longitude: 0, latitude: 0,
    }
    expect(hasCompleteBirthplaceEvidence(base)).toBe(false)
  })

  it('requires a dataset version and rejects non-finite coordinate evidence', () => {
    const base = {
      province: '测试省', city: '测试市', district: '测试区', placeCode: '000000',
      geoDataVersion: dataset.version, timezone: 'Asia/Shanghai', longitude: 120.13, latitude: 30.26,
    }
    expect(hasCompleteBirthplaceEvidence(base)).toBe(true)
    expect(hasCompleteBirthplaceEvidence({ ...base, geoDataVersion: '' })).toBe(false)
    expect(hasCompleteBirthplaceEvidence({ ...base, longitude: Number.NaN })).toBe(false)
    expect(hasCompleteBirthplaceEvidence({ ...base, latitude: Number.POSITIVE_INFINITY })).toBe(false)
  })

  it('retains the full dataset attribution contract', () => {
    expect(normalizeBirthplaceDatasetMetadata(dataset)).toEqual(dataset)
    expect(normalizeBirthplaceDatasetMetadata(dataset)).toMatchObject({
      coverage: 'licensed-partial',
      source: { label: 'province-city-china + GeoNames', license: 'MIT; CC BY 4.0' },
      sources: [{ label: 'GeoNames', license: 'CC BY 4.0' }],
      statistics: { selectableDistrictCount: 2614, unavailableDistrictCount: 697 },
    })
    expect(() => normalizeBirthplaceDatasetMetadata({ version: 'missing-source' })).toThrow('出生地点数据版本信息不完整。')
    expect(birthplaceDatasetAttribution(normalizeBirthplaceDatasetMetadata(dataset))).toContain('GeoNames')
    expect(birthplaceDatasetAttribution(normalizeBirthplaceDatasetMetadata(dataset))).toContain('CC BY 4.0')
    expect(coordinateConfidenceLabel('verified')).toBe('已审核')
    expect(coordinateConfidenceLabel('unavailable')).toBe('坐标待补充')
  })

  it('selects a server place by code and binds its canonical dataset version', () => {
    const place = {
      province: { code: '330000', name: '浙江省', cities: [] },
      city: { code: '330100', name: '杭州市', timezone: 'Asia/Shanghai', districts: [] },
      district: { code: '330106', name: '西湖区', longitude: 120.13333, latitude: 30.26667, coordinate: { confidence: 'verified' } },
      selectable: true,
    }
    expect(birthInputFromResolvedPlace(place, dataset.version)).toMatchObject({
      placeCode: '330106', geoDataVersion: dataset.version, longitude: 120.13333, latitude: 30.26667,
    })
    expect(isBirthplaceSelectionActive({ placeCode: '330106' }, place)).toBe(true)
    expect(isBirthplaceSelectionActive({ placeCode: '360103' }, place)).toBe(false)
    expect(() => birthInputFromResolvedPlace(place, '')).toThrow('出生地点缺少数据版本')
  })

  it('refuses to convert an unavailable-coordinate place into birth input', () => {
    const place = {
      province: { code: '110000', name: '北京市', cities: [] },
      city: { code: '110100', name: '北京市', timezone: 'Asia/Shanghai', districts: [] },
      district: { code: '110118', name: '密云区', coordinate: { confidence: 'unavailable' } },
      selectable: false,
    }

    expect(() => birthInputFromResolvedPlace(place, dataset.version)).toThrow('该出生地点缺少经纬度证据，暂不可用于排盘。')
  })

  it('does not treat null-island API coordinates as a selectable birthplace', () => {
    expect(isPlaceSelectable({
      province: { code: '000000', name: '测试省', cities: [] },
      city: { code: '000100', name: '测试市', timezone: 'Asia/Shanghai', districts: [] },
      district: { code: '000101', name: '测试区', longitude: 0, latitude: 0 },
      selectable: true,
    })).toBe(false)
  })

  it('hydrates legacy local storage without crashing or inventing missing evidence', () => {
    const fallback = {
      date: '1992-08-18', time: '09:30', locationName: '浙江省 杭州市 西湖区', longitude: 120.13333,
      latitude: 30.26667, timezone: 'Asia/Shanghai', province: '浙江省', city: '杭州市', district: '西湖区',
      placeCode: '330106', geoDataVersion: dataset.version,
    }
    const legacy = normalizeStoredBirthInput({ date: '1990-01-01', time: '08:00', locationName: '旧地点' }, fallback)
    expect(legacy.date).toBe('1990-01-01')
    expect(Number.isNaN(legacy.longitude)).toBe(true)
    expect(legacy.latitude).toBeUndefined()
    expect(legacy.placeCode).toBeUndefined()
    expect(legacy.timezone).toBeUndefined()
    expect(legacy.geoDataVersion).toBeUndefined()
    expect(hasCompleteBirthplaceEvidence(legacy)).toBe(false)
  })

  it('makes demo fallback limitations explicit', () => {
    expect(birthplaceFallbackMessage('网络不可用')).toContain('少量本地演示地点')
    expect(birthplaceFallbackMessage('网络不可用')).toContain('不代表全国覆盖')
  })
})
