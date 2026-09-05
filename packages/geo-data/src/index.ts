import provinceCityChinaLevel from 'province-city-china/dist/level.json' with { type: 'json' }
import geonamesChinaCoordinates from './generated/geonames-cn-2026-08-31.json' with { type: 'json' }

export interface BirthplaceDistrict {
  code: string
  name: string
  longitude: number
  latitude: number
  coordinate?: BirthplaceCoordinateEvidence
}

export interface BirthplaceCity {
  code: string
  name: string
  timezone: string
  districts: readonly BirthplaceDistrict[]
}

export interface BirthplaceProvince {
  code: string
  name: string
  cities: readonly BirthplaceCity[]
}

export interface BirthplaceDatasetMetadata {
  id: string
  version: string
  label: string
  coverage: 'demo-sample' | 'administrative-only' | 'licensed-partial' | 'production'
  source: {
    label: string
    url?: string
    license: string
    notes: string
  }
  generatedAt: string
  coordinateSystem: 'WGS84'
  timezonePolicy: 'city-default-iana'
  sources?: readonly {
    label: string
    url?: string
    license: string
    notes: string
  }[]
  statistics?: {
    administrativeDistrictCount: number
    licensedCoordinateCount: number
    manualFallbackCoordinateCount: number
    selectableDistrictCount: number
    unavailableDistrictCount: number
  }
}

export type BirthplaceCoordinateConfidence = 'verified' | 'derived-centroid' | 'manual-demo' | 'unavailable'

export interface BirthplaceCoordinateEvidence {
  sourceLabel: string
  license: string
  confidence: BirthplaceCoordinateConfidence
  note?: string
}

export interface AdministrativeDistrict {
  code: string
  name: string
  longitude?: number
  latitude?: number
  coordinate?: BirthplaceCoordinateEvidence
}

export interface AdministrativeCity {
  code: string
  name: string
  timezone?: string
  districts: readonly AdministrativeDistrict[]
}

export interface AdministrativeProvince {
  code: string
  name: string
  cities: readonly AdministrativeCity[]
}

export interface BirthplaceDatasetBuildIssue {
  code: string
  name: string
  reason: 'missing-coordinate' | 'invalid-coordinate' | 'missing-timezone' | 'invalid-timezone'
}

export interface BirthplaceDatasetBuildResult {
  tree: readonly BirthplaceProvince[]
  dataset: BirthplaceDatasetMetadata
  selectableDistrictCount: number
  unavailableDistrictCount: number
  issues: readonly BirthplaceDatasetBuildIssue[]
}

export interface AdministrativeSourceCandidate {
  id: string
  label: string
  kind: 'administrative-hierarchy' | 'coordinate' | 'timezone'
  license: string
  url: string
  recommendation: 'candidate' | 'requires-review' | 'not-for-offline-redistribution'
  notes: string
}

export interface BirthplaceSearchOptions {
  query?: string
  provinceCode?: string
  cityCode?: string
  limit?: number
  offset?: number
}

export interface BirthplaceSearchResult {
  total: number
  limit: number
  offset: number
  items: BirthplaceResolved[]
  dataset: BirthplaceDatasetMetadata
}

export interface BirthplaceResolved {
  province: BirthplaceProvince
  city: BirthplaceCity
  district: BirthplaceDistrict
}

export interface BirthplaceIntegrityReport {
  dataset: BirthplaceDatasetMetadata
  provinceCount: number
  cityCount: number
  districtCount: number
  uniqueDistrictCodes: number
  selectableDistrictCount?: number
  unavailableDistrictCount?: number
  complete: boolean
  issues: readonly string[]
}

export interface AdministrativeBirthplaceResolved {
  province: Pick<AdministrativeProvince, 'code' | 'name'>
  city: Pick<AdministrativeCity, 'code' | 'name' | 'timezone'>
  district: AdministrativeDistrict
  selectable: boolean
}

export interface AdministrativeBirthplaceSearchResult {
  total: number
  limit: number
  offset: number
  items: AdministrativeBirthplaceResolved[]
  dataset: BirthplaceDatasetMetadata
  selectableDistrictCount: number
  unavailableDistrictCount: number
}

interface ProvinceCityChinaLevelNode {
  code: string
  name: string
  children?: readonly ProvinceCityChinaLevelNode[]
}

export const DEFAULT_BIRTHPLACE = { province: '浙江省', city: '杭州市', district: '西湖区' } as const

export const BIRTHPLACE_DATASET_METADATA: BirthplaceDatasetMetadata = {
  id: 'fengshui-birthplace-demo-cn',
  version: '2026.08-demo.1',
  label: '演示出生地点库',
  coverage: 'demo-sample',
  source: {
    label: 'Manually curated demo coordinates pending licensed production dataset',
    license: 'Project-internal demo data; not a full redistributable national dataset',
    notes: 'Only the listed districts are selectable. Do not present this dataset as complete county-level China coverage.',
  },
  generatedAt: '2026-08-31T00:00:00.000Z',
  coordinateSystem: 'WGS84',
  timezonePolicy: 'city-default-iana',
}

export const ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA: BirthplaceDatasetMetadata = {
  id: 'cn-administrative-geonames-reviewed-coordinates',
  version: `province-city-china@8.5.8+geonames-cn@${geonamesChinaCoordinates.metadata.version}`,
  label: '中国出生地点行政区划与已审核坐标库',
  coverage: 'licensed-partial',
  source: {
    label: 'province-city-china + GeoNames',
    url: geonamesChinaCoordinates.metadata.sourceUrl,
    license: 'MIT (administrative hierarchy); CC BY 4.0 (GeoNames coordinates)',
    notes: `Partial coordinate coverage only: ${geonamesChinaCoordinates.metadata.importedRecordCount}/${geonamesChinaCoordinates.metadata.administrativeDistrictCount} administrative districts have reviewed GeoNames coordinates. GeoNames dump ${geonamesChinaCoordinates.metadata.dumpDate}; CN.txt SHA-256 ${geonamesChinaCoordinates.metadata.files.places.sha256}. This is not nationwide-complete coordinate coverage.`,
  },
  generatedAt: '2026-08-31T00:00:00.000Z',
  coordinateSystem: 'WGS84',
  timezonePolicy: 'city-default-iana',
  sources: [
    {
      label: 'province-city-china',
      url: 'https://github.com/uiwjs/province-city-china',
      license: 'MIT',
      notes: 'Administrative hierarchy, province/city/district names and codes.',
    },
    {
      label: geonamesChinaCoordinates.metadata.attribution,
      url: geonamesChinaCoordinates.metadata.sourceUrl,
      license: geonamesChinaCoordinates.metadata.license,
      notes: `Reviewed WGS84 coordinates; dump ${geonamesChinaCoordinates.metadata.dumpDate}; CN.txt ${geonamesChinaCoordinates.metadata.files.places.sha256}; admin1CodesASCII.txt ${geonamesChinaCoordinates.metadata.files.admin1CodesAscii.sha256}; admin2Codes.txt ${geonamesChinaCoordinates.metadata.files.admin2Codes.sha256}; attribution required.`,
    },
  ],
  statistics: {
    administrativeDistrictCount: geonamesChinaCoordinates.metadata.administrativeDistrictCount,
    licensedCoordinateCount: geonamesChinaCoordinates.metadata.importedRecordCount,
    manualFallbackCoordinateCount: 2,
    selectableDistrictCount: geonamesChinaCoordinates.metadata.importedRecordCount + 2,
    unavailableDistrictCount: geonamesChinaCoordinates.metadata.administrativeDistrictCount - geonamesChinaCoordinates.metadata.importedRecordCount - 2,
  },
}

export const GEONAMES_COORDINATE_ARTIFACT_METADATA = geonamesChinaCoordinates.metadata
export const GEONAMES_IMPORTED_COORDINATE_COUNT = geonamesChinaCoordinates.records.length

export const ADMINISTRATIVE_SOURCE_CANDIDATES: readonly AdministrativeSourceCandidate[] = [
  {
    id: 'province-city-china',
    label: 'province-city-china',
    kind: 'administrative-hierarchy',
    license: 'MIT',
    url: 'https://github.com/uiwjs/province-city-china',
    recommendation: 'candidate',
    notes: 'Useful for province/city/district hierarchy. It is not a coordinate source.',
  },
  {
    id: 'geonames',
    label: 'GeoNames',
    kind: 'coordinate',
    license: 'CC BY 4.0',
    url: 'https://www.geonames.org/export/',
    recommendation: 'candidate',
    notes: 'Reviewed records are integrated with attribution as partial coordinate coverage; unmatched and conflicted records remain unavailable.',
  },
  {
    id: 'commercial-geocoder',
    label: 'Commercial geocoding provider',
    kind: 'coordinate',
    license: 'Provider-specific terms',
    url: 'https://lbs.amap.com/api/webservice/guide/api/georegeo',
    recommendation: 'not-for-offline-redistribution',
    notes: 'Use for online lookup only after legal review. Do not silently persist provider results as a redistributable offline dataset.',
  },
]

const DEMO_COORDINATE_EVIDENCE: BirthplaceCoordinateEvidence = {
  sourceLabel: 'Project manually curated demo coordinates',
  license: 'Project-internal demo data',
  confidence: 'manual-demo',
  note: 'Demo coordinate retained for investor prototype. Replace with a licensed production source before national coverage claims.',
}

function demoDistrict(code: string, name: string, longitude: number, latitude: number): BirthplaceDistrict {
  return { code, name, longitude, latitude, coordinate: DEMO_COORDINATE_EVIDENCE }
}

export const BIRTHPLACE_TREE: readonly BirthplaceProvince[] = [
  { code: '110000', name: '北京市', cities: [{ code: '110100', name: '北京市', timezone: 'Asia/Shanghai', districts: [
    demoDistrict('110101', '东城区', 116.4164, 39.9286),
    demoDistrict('110105', '朝阳区', 116.4436, 39.9219),
    demoDistrict('110108', '海淀区', 116.2981, 39.9593),
  ] }] },
  { code: '310000', name: '上海市', cities: [{ code: '310100', name: '上海市', timezone: 'Asia/Shanghai', districts: [
    demoDistrict('310101', '黄浦区', 121.4842, 31.2317),
    demoDistrict('310104', '徐汇区', 121.4368, 31.1883),
    demoDistrict('310115', '浦东新区', 121.5447, 31.2215),
  ] }] },
  { code: '330000', name: '浙江省', cities: [
    { code: '330100', name: '杭州市', timezone: 'Asia/Shanghai', districts: [
      demoDistrict('330102', '上城区', 120.1973, 30.2265),
      demoDistrict('330106', '西湖区', 120.1302, 30.2595),
      demoDistrict('330108', '滨江区', 120.2119, 30.2084),
    ] },
    { code: '330200', name: '宁波市', timezone: 'Asia/Shanghai', districts: [
      demoDistrict('330203', '海曙区', 121.5508, 29.8598),
      demoDistrict('330212', '鄞州区', 121.5466, 29.8173),
    ] },
  ] },
  { code: '320000', name: '江苏省', cities: [
    { code: '320100', name: '南京市', timezone: 'Asia/Shanghai', districts: [
      demoDistrict('320102', '玄武区', 118.7977, 32.0486),
      demoDistrict('320106', '鼓楼区', 118.7698, 32.0664),
    ] },
    { code: '320500', name: '苏州市', timezone: 'Asia/Shanghai', districts: [
      demoDistrict('320508', '姑苏区', 120.6174, 31.3356),
      demoDistrict('320506', '吴中区', 120.6323, 31.2623),
    ] },
  ] },
  { code: '440000', name: '广东省', cities: [
    { code: '440100', name: '广州市', timezone: 'Asia/Shanghai', districts: [
      demoDistrict('440104', '越秀区', 113.2668, 23.1289),
      demoDistrict('440106', '天河区', 113.3612, 23.1247),
    ] },
    { code: '440300', name: '深圳市', timezone: 'Asia/Shanghai', districts: [
      demoDistrict('440304', '福田区', 114.0556, 22.5219),
      demoDistrict('440305', '南山区', 113.9305, 22.5333),
    ] },
  ] },
  { code: '510000', name: '四川省', cities: [{ code: '510100', name: '成都市', timezone: 'Asia/Shanghai', districts: [
    demoDistrict('510104', '锦江区', 104.1173, 30.5987),
    demoDistrict('510107', '武侯区', 104.0434, 30.6418),
  ] }] },
  { code: '420000', name: '湖北省', cities: [{ code: '420100', name: '武汉市', timezone: 'Asia/Shanghai', districts: [
    demoDistrict('420106', '武昌区', 114.3167, 30.554),
    demoDistrict('420103', '江汉区', 114.2708, 30.6015),
  ] }] },
  { code: '610000', name: '陕西省', cities: [{ code: '610100', name: '西安市', timezone: 'Asia/Shanghai', districts: [
    demoDistrict('610103', '碑林区', 108.9343, 34.2304),
    demoDistrict('610113', '雁塔区', 108.9486, 34.2225),
  ] }] },
  { code: '650000', name: '新疆维吾尔自治区', cities: [
    { code: '650100', name: '乌鲁木齐市', timezone: 'Asia/Shanghai', districts: [
      demoDistrict('650102', '天山区', 87.6317, 43.7944),
      demoDistrict('650103', '沙依巴克区', 87.5982, 43.8009),
    ] },
    { code: '653000', name: '克孜勒苏柯尔克孜自治州', timezone: 'Asia/Shanghai', districts: [
      demoDistrict('653024', '乌恰县', 75.2597, 39.7191),
      demoDistrict('653001', '阿图什市', 76.1684, 39.7162),
    ] },
  ] },
]

const UNAVAILABLE_COORDINATE_EVIDENCE: BirthplaceCoordinateEvidence = {
  sourceLabel: 'province-city-china administrative hierarchy',
  license: 'MIT',
  confidence: 'unavailable',
  note: 'The administrative source does not include coordinates. This district must be geocoded or matched to a licensed coordinate source before BaZi calculation.',
}

const SELECTABLE_PLACE_BY_CODE = new Map(
  flattenBirthplaceTree(BIRTHPLACE_TREE).map((place) => [place.district.code, place] as const),
)

const GEONAMES_COORDINATE_BY_CODE = new Map(
  geonamesChinaCoordinates.records.map((record) => [record.code, record] as const),
)

export const ADMINISTRATIVE_BIRTHPLACE_TREE: readonly AdministrativeProvince[] = buildAdministrativeBirthplaceTree()

const PRODUCT_BIRTHPLACE_BUILD = buildBirthplaceDatasetFromAdministrativeTree(
  ADMINISTRATIVE_BIRTHPLACE_TREE,
  ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA,
)

export const SELECTABLE_BIRTHPLACE_TREE: readonly BirthplaceProvince[] = PRODUCT_BIRTHPLACE_BUILD.tree

export function buildBirthplaceDatasetFromAdministrativeTree(
  administrativeTree: readonly AdministrativeProvince[],
  dataset: BirthplaceDatasetMetadata,
): BirthplaceDatasetBuildResult {
  const issues: BirthplaceDatasetBuildIssue[] = []
  const tree: BirthplaceProvince[] = []
  let selectableDistrictCount = 0
  let unavailableDistrictCount = 0

  for (const sourceProvince of administrativeTree) {
    const cities: BirthplaceCity[] = []
    for (const sourceCity of sourceProvince.cities) {
      const timezone = sourceCity.timezone ?? 'Asia/Shanghai'
      const districts: BirthplaceDistrict[] = []
      if (!sourceCity.timezone) {
        issues.push({ code: sourceCity.code, name: sourceCity.name, reason: 'missing-timezone' })
      } else if (!isValidTimezone(sourceCity.timezone)) {
        issues.push({ code: sourceCity.code, name: sourceCity.name, reason: 'invalid-timezone' })
        continue
      }
      for (const sourceDistrict of sourceCity.districts) {
        const coordinate = sourceDistrict.coordinate ?? missingCoordinateEvidence()
        const longitude = sourceDistrict.longitude
        const latitude = sourceDistrict.latitude
        if (longitude === undefined || latitude === undefined || coordinate.confidence === 'unavailable') {
          unavailableDistrictCount += 1
          issues.push({ code: sourceDistrict.code, name: sourceDistrict.name, reason: 'missing-coordinate' })
          continue
        }
        if (!isValidLongitude(longitude) || !isValidLatitude(latitude)) {
          unavailableDistrictCount += 1
          issues.push({ code: sourceDistrict.code, name: sourceDistrict.name, reason: 'invalid-coordinate' })
          continue
        }
        selectableDistrictCount += 1
        districts.push({
          code: sourceDistrict.code,
          name: sourceDistrict.name,
          longitude,
          latitude,
          coordinate,
        })
      }
      if (districts.length > 0) cities.push({ code: sourceCity.code, name: sourceCity.name, timezone, districts })
    }
    if (cities.length > 0) tree.push({ code: sourceProvince.code, name: sourceProvince.name, cities })
  }

  return {
    tree,
    dataset,
    selectableDistrictCount,
    unavailableDistrictCount,
    issues,
  }
}

export function flattenAdministrativeBirthplaces(
  tree: readonly AdministrativeProvince[] = ADMINISTRATIVE_BIRTHPLACE_TREE,
): AdministrativeBirthplaceResolved[] {
  return tree.flatMap((province) =>
    province.cities.flatMap((city) =>
      city.districts.map((district) => ({
        province: { code: province.code, name: province.name },
        city: { code: city.code, name: city.name, timezone: city.timezone },
        district,
        selectable: hasUsableBirthplaceCoordinate(district),
      })),
    ),
  )
}

export function findAdministrativeBirthplaceByCode(code: string): AdministrativeBirthplaceResolved | undefined {
  for (const province of ADMINISTRATIVE_BIRTHPLACE_TREE) {
    for (const city of province.cities) {
      const district = city.districts.find((item) => item.code === code)
      if (district) return {
        province: { code: province.code, name: province.name },
        city: { code: city.code, name: city.name, timezone: city.timezone },
        district,
        selectable: hasUsableBirthplaceCoordinate(district),
      }
    }
  }
  return undefined
}

export function searchAdministrativeBirthplaces(options: BirthplaceSearchOptions = {}): AdministrativeBirthplaceSearchResult {
  const limit = clampInteger(options.limit ?? 20, 1, 100)
  const offset = clampInteger(options.offset ?? 0, 0, Number.MAX_SAFE_INTEGER)
  const normalizedQuery = normalizeText(options.query ?? '')
  const filtered = flattenAdministrativeBirthplaces().filter((place) => {
    if (options.provinceCode && place.province.code !== options.provinceCode) return false
    if (options.cityCode && place.city.code !== options.cityCode) return false
    if (!normalizedQuery) return true
    const haystack = searchableBirthplaceText(place.province.name, place.city.name, place.district.name, place.province.code, place.city.code, place.district.code)
    return haystack.includes(normalizedQuery)
  })
  const selectableDistrictCount = filtered.filter((place) => place.selectable).length
  const unavailableDistrictCount = filtered.length - selectableDistrictCount

  return {
    total: filtered.length,
    limit,
    offset,
    items: filtered.slice(offset, offset + limit),
    dataset: ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA,
    selectableDistrictCount,
    unavailableDistrictCount,
  }
}

export function validateAdministrativeBirthplaceDataset(
  tree: readonly AdministrativeProvince[] = ADMINISTRATIVE_BIRTHPLACE_TREE,
): BirthplaceIntegrityReport {
  const issues: string[] = []
  const provinceCodes = new Set<string>()
  const cityCodes = new Set<string>()
  const districtCodes = new Set<string>()
  let cityCount = 0
  let districtCount = 0
  let selectableDistrictCount = 0
  let unavailableDistrictCount = 0

  for (const province of tree) {
    requireCode(province.code, 'province', issues)
    if (provinceCodes.has(province.code)) issues.push(`duplicate province code: ${province.code}`)
    provinceCodes.add(province.code)
    if (province.cities.length === 0) issues.push(`province ${province.code} has no cities`)
    for (const city of province.cities) {
      cityCount += 1
      requireCode(city.code, 'city', issues)
      if (cityCodes.has(city.code)) issues.push(`duplicate city code: ${city.code}`)
      cityCodes.add(city.code)
      if (!city.timezone || !isValidTimezone(city.timezone)) issues.push(`city ${city.code} has invalid timezone: ${city.timezone}`)
      if (city.districts.length === 0) issues.push(`city ${city.code} has no districts`)
      for (const district of city.districts) {
        districtCount += 1
        requireCode(district.code, 'district', issues)
        if (districtCodes.has(district.code)) issues.push(`duplicate district code: ${district.code}`)
        districtCodes.add(district.code)
        if (hasUsableBirthplaceCoordinate(district)) {
          selectableDistrictCount += 1
        } else {
          unavailableDistrictCount += 1
          if (district.longitude !== undefined && !isValidLongitude(district.longitude)) issues.push(`district ${district.code} has invalid longitude`)
          if (district.latitude !== undefined && !isValidLatitude(district.latitude)) issues.push(`district ${district.code} has invalid latitude`)
        }
        if (!district.coordinate) issues.push(`district ${district.code} is missing coordinate evidence`)
      }
    }
  }

  return {
    dataset: ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA,
    provinceCount: provinceCodes.size,
    cityCount,
    districtCount,
    uniqueDistrictCodes: districtCodes.size,
    selectableDistrictCount,
    unavailableDistrictCount,
    complete: issues.length === 0,
    issues,
  }
}

export function findBirthplace(provinceName: string, cityName: string, districtName: string) {
  const province = SELECTABLE_BIRTHPLACE_TREE.find((item) => item.name === provinceName)
  const city = province?.cities.find((item) => item.name === cityName)
  const district = city?.districts.find((item) => item.name === districtName)
  return province && city && district ? { province, city, district } : undefined
}

export function findBirthplaceByCode(code: string): BirthplaceResolved | undefined {
  for (const province of SELECTABLE_BIRTHPLACE_TREE) {
    for (const city of province.cities) {
      const district = city.districts.find((item) => item.code === code)
      if (district) return { province, city, district }
    }
  }
  return undefined
}

export function flattenBirthplaces(): BirthplaceResolved[] {
  return flattenBirthplaceTree(SELECTABLE_BIRTHPLACE_TREE)
}

export function flattenBirthplaceTree(tree: readonly BirthplaceProvince[]): BirthplaceResolved[] {
  return tree.flatMap((province) =>
    province.cities.flatMap((city) =>
      city.districts.map((district) => ({ province, city, district })),
    ),
  )
}

export function searchBirthplaces(options: BirthplaceSearchOptions = {}): BirthplaceSearchResult {
  const limit = clampInteger(options.limit ?? 20, 1, 100)
  const offset = clampInteger(options.offset ?? 0, 0, Number.MAX_SAFE_INTEGER)
  const normalizedQuery = normalizeText(options.query ?? '')
  const filtered = flattenBirthplaces().filter((place) => {
    if (options.provinceCode && place.province.code !== options.provinceCode) return false
    if (options.cityCode && place.city.code !== options.cityCode) return false
    if (!normalizedQuery) return true
    const haystack = searchableBirthplaceText(place.province.name, place.city.name, place.district.name, place.province.code, place.city.code, place.district.code)
    return haystack.includes(normalizedQuery)
  })
  return {
    total: filtered.length,
    limit,
    offset,
    items: filtered.slice(offset, offset + limit),
    dataset: ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA,
  }
}

export function validateBirthplaceDataset(): BirthplaceIntegrityReport {
  const issues: string[] = []
  const provinceCodes = new Set<string>()
  const cityCodes = new Set<string>()
  const districtCodes = new Set<string>()
  let cityCount = 0
  let districtCount = 0

  for (const province of SELECTABLE_BIRTHPLACE_TREE) {
    requireCode(province.code, 'province', issues)
    if (provinceCodes.has(province.code)) issues.push(`duplicate province code: ${province.code}`)
    provinceCodes.add(province.code)
    if (province.cities.length === 0) issues.push(`province ${province.code} has no cities`)
    for (const city of province.cities) {
      cityCount += 1
      requireCode(city.code, 'city', issues)
      if (cityCodes.has(city.code)) issues.push(`duplicate city code: ${city.code}`)
      cityCodes.add(city.code)
      if (!isValidTimezone(city.timezone)) issues.push(`city ${city.code} has invalid timezone: ${city.timezone}`)
      if (city.districts.length === 0) issues.push(`city ${city.code} has no districts`)
      for (const district of city.districts) {
        districtCount += 1
        requireCode(district.code, 'district', issues)
        if (districtCodes.has(district.code)) issues.push(`duplicate district code: ${district.code}`)
        districtCodes.add(district.code)
        if (!isValidLongitude(district.longitude)) issues.push(`district ${district.code} has invalid longitude`)
        if (!isValidLatitude(district.latitude)) issues.push(`district ${district.code} has invalid latitude`)
        if (!district.coordinate) issues.push(`district ${district.code} is missing coordinate evidence`)
        if (district.coordinate?.confidence === 'unavailable') issues.push(`district ${district.code} is selectable but has unavailable coordinate evidence`)
      }
    }
  }

  return {
    dataset: ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA,
    provinceCount: provinceCodes.size,
    cityCount,
    districtCount,
    uniqueDistrictCodes: districtCodes.size,
    complete: issues.length === 0,
    issues,
  }
}

export function resolveBirthplace(locationName: string) {
  for (const province of BIRTHPLACE_TREE) {
    for (const city of province.cities) {
      for (const district of city.districts) {
        if (locationName.includes(district.name) || locationName === city.name) return { province, city, district }
      }
    }
  }
  return findBirthplace(DEFAULT_BIRTHPLACE.province, DEFAULT_BIRTHPLACE.city, DEFAULT_BIRTHPLACE.district)!
}

export function birthInputFromPlace(province: BirthplaceProvince, city: BirthplaceCity, district: BirthplaceDistrict) {
  return {
    province: province.name,
    city: city.name,
    district: district.name,
    placeCode: district.code,
    geoDataVersion: ADMINISTRATIVE_BIRTHPLACE_DATASET_METADATA.version,
    locationName: `${province.name} ${city.name} ${district.name}`,
    longitude: district.longitude,
    latitude: district.latitude,
    timezone: city.timezone,
  }
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, '').toLowerCase()
}

function normalizePlaceAlias(value: string): string {
  return normalizeText(value).replace(/(特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|自治州|地区|盟|省|市|区|县|旗)$/g, '')
}

function searchableBirthplaceText(province: string, city: string, district: string, provinceCode: string, cityCode: string, districtCode: string): string {
  return [
    `${province}${city}${district}`,
    `${normalizePlaceAlias(province)}${normalizePlaceAlias(city)}${normalizePlaceAlias(district)}`,
    province,
    city,
    district,
    provinceCode,
    cityCode,
    districtCode,
  ].map(normalizeText).join('|')
}

export function hasUsableBirthplaceCoordinate(district: AdministrativeDistrict): boolean {
  return (
    district.longitude !== undefined &&
    district.latitude !== undefined &&
    isValidLongitude(district.longitude) &&
    isValidLatitude(district.latitude) &&
    district.coordinate !== undefined &&
    district.coordinate.confidence !== 'unavailable'
  )
}

function buildAdministrativeBirthplaceTree(): readonly AdministrativeProvince[] {
  return getProvinceCityChinaLevel().map((provinceNode) => {
    const childNodes = provinceNode.children ?? []
    const containsCityLayer = childNodes.some((childNode) => (childNode.children?.length ?? 0) > 0)
    const cities: AdministrativeCity[] = containsCityLayer
      ? childNodes.map((cityNode) => ({
          code: cityNode.code,
          name: cityNode.name,
          timezone: 'Asia/Shanghai',
          districts: (cityNode.children ?? []).map((districtNode) => administrativeDistrictFromNode(districtNode)),
        }))
      : [{
          code: directControlledMunicipalityCityCode(provinceNode.code),
          name: provinceNode.name,
          timezone: 'Asia/Shanghai',
          districts: childNodes.map((districtNode) => administrativeDistrictFromNode(districtNode)),
        }]
    return {
      code: provinceNode.code,
      name: provinceNode.name,
      cities: cities.filter((city) => city.districts.length > 0),
    }
  }).filter((province) => province.cities.length > 0)
}

function administrativeDistrictFromNode(node: ProvinceCityChinaLevelNode): AdministrativeDistrict {
  const geonames = GEONAMES_COORDINATE_BY_CODE.get(node.code)
  if (geonames) {
    return {
      code: node.code,
      name: node.name,
      longitude: geonames.longitude,
      latitude: geonames.latitude,
      coordinate: {
        sourceLabel: 'GeoNames',
        license: 'CC BY 4.0',
        confidence: 'verified',
        note: `GeoNames ID ${geonames.externalId}; source name ${geonames.sourceName}; mapping ${geonames.mappingMethod}; dump ${geonamesChinaCoordinates.metadata.dumpDate}.`,
      },
    }
  }
  const selectable = SELECTABLE_PLACE_BY_CODE.get(node.code)
  if (selectable) {
    return {
      code: node.code,
      name: node.name,
      longitude: selectable.district.longitude,
      latitude: selectable.district.latitude,
      coordinate: selectable.district.coordinate,
    }
  }
  return {
    code: node.code,
    name: node.name,
    coordinate: UNAVAILABLE_COORDINATE_EVIDENCE,
  }
}

function directControlledMunicipalityCityCode(provinceCode: string): string {
  return `${provinceCode.slice(0, 2)}0100`
}

function getProvinceCityChinaLevel(): readonly ProvinceCityChinaLevelNode[] {
  if (!Array.isArray(provinceCityChinaLevel)) return []
  return provinceCityChinaLevel.filter(isProvinceCityChinaLevelNode)
}

function isProvinceCityChinaLevelNode(value: unknown): value is ProvinceCityChinaLevelNode {
  if (!value || typeof value !== 'object') return false
  const node = value as Partial<ProvinceCityChinaLevelNode>
  return typeof node.code === 'string' && typeof node.name === 'string'
}

function requireCode(code: string, level: string, issues: string[]): void {
  if (!/^\d{6}$/.test(code)) issues.push(`${level} code must be a 6-digit GB/T 2260 code: ${code}`)
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
    return true
  } catch {
    return false
  }
}

function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180
}

function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90
}

function missingCoordinateEvidence(): BirthplaceCoordinateEvidence {
  return {
    sourceLabel: 'missing',
    license: 'none',
    confidence: 'unavailable',
    note: 'No legally usable coordinate source is attached to this administrative division.',
  }
}
