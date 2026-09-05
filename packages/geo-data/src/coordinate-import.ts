export const COORDINATE_IMPORT_SCHEMA_VERSION = '1.0.0' as const

export interface AdministrativeDivisionReference {
  code: string
  name: string
  provinceName: string
  cityName: string
}

export interface CoordinateSourceManifest {
  id: string
  label: string
  version: string
  license: string
  sourceUrl?: string
  licenseUrl?: string
  attribution?: string
  inputFile: string
  inputSha256: string
}

export interface CoordinateInputRecord {
  sourceRow: number
  externalId?: string
  administrativeCode?: string
  name: string
  alternateNames?: readonly string[]
  provinceName?: string
  cityName?: string
  longitude: number
  latitude: number
}

export interface VersionedCoordinateRecord {
  schemaVersion: typeof COORDINATE_IMPORT_SCHEMA_VERSION
  datasetVersion: string
  administrativeCode: string
  administrativeName: string
  provinceName: string
  cityName: string
  longitude: number
  latitude: number
  coordinateSystem: 'WGS84'
  matchMethod: 'administrative-code' | 'name'
  source: CoordinateSourceManifest & {
    sourceRow: number
    externalId?: string
  }
}

export type CoordinateImportConflictReason =
  | 'administrative-code-not-found'
  | 'administrative-code-name-mismatch'
  | 'ambiguous-name'
  | 'duplicate-coordinate-disagreement'

export interface CoordinateImportMatch {
  sourceRow: number
  externalId?: string
  administrativeCode: string
  administrativeName: string
  matchMethod: 'administrative-code' | 'name'
}

export interface CoordinateImportConflict {
  sourceRow: number
  externalId?: string
  reason: CoordinateImportConflictReason
  inputAdministrativeCode?: string
  inputName: string
  candidateCodes: readonly string[]
  detail: string
}

export interface CoordinateImportUnmatched {
  sourceRow: number
  externalId?: string
  inputName: string
  provinceName?: string
  cityName?: string
  detail: string
}

export interface CoordinateImportRejected {
  sourceRow: number
  externalId?: string
  reason: 'missing-name' | 'invalid-longitude' | 'invalid-latitude'
  detail: string
}

export interface CoordinateImportReport {
  schemaVersion: typeof COORDINATE_IMPORT_SCHEMA_VERSION
  datasetVersion: string
  source: CoordinateSourceManifest
  summary: {
    inputCount: number
    outputCount: number
    matchCount: number
    conflictCount: number
    unmatchedCount: number
    rejectedCount: number
  }
  records: readonly VersionedCoordinateRecord[]
  matches: readonly CoordinateImportMatch[]
  conflicts: readonly CoordinateImportConflict[]
  unmatched: readonly CoordinateImportUnmatched[]
  rejected: readonly CoordinateImportRejected[]
}

// Compatibility API used by the in-package administrative tree builder. The
// file-oriented importer above emits richer reports; this adapter materializes
// the accepted coordinates back into the existing birthplace tree shape.
export interface AdministrativeCoordinateImportRecord {
  adminCode?: string
  provinceName?: string
  cityName?: string
  districtName: string
  longitude: number
  latitude: number
  sourceLabel: string
  license: string
}

export interface AdministrativeCoordinateDatasetMetadata {
  id: string
  version: string
  label: string
  source: {
    label: string
    url?: string
    license: string
    notes: string
  }
  generatedAt: string
  coordinateSystem: string
  timezonePolicy: string
}

export interface AdministrativeCoordinateImportTree {
  code: string
  name: string
  cities: readonly {
    code: string
    name: string
    timezone?: string
    districts: readonly { code: string; name: string }[]
  }[]
}

export interface AdministrativeCoordinateImportIssue {
  code: string | undefined
  name: string
  reason:
    | 'ambiguous-name'
    | 'invalid-coordinate'
    | 'duplicate-coordinate-conflict'
    | 'missing-attribution'
    | 'unmatched'
  matches?: readonly string[]
}

export interface AdministrativeCoordinateImportResult {
  tree: readonly {
    code: string
    name: string
    cities: readonly {
      code: string
      name: string
      timezone: string
      districts: readonly {
        code: string
        name: string
        longitude: number
        latitude: number
        coordinate: {
          sourceLabel: string
          license: string
          confidence: 'verified'
        }
      }[]
    }[]
  }[]
  dataset: AdministrativeCoordinateDatasetMetadata & { coverage: 'production' }
  selectableDistrictCount: number
  unavailableDistrictCount: number
  issues: readonly AdministrativeCoordinateImportIssue[]
}

export function importCoordinateDataset(options: {
  administrativeTree: readonly AdministrativeCoordinateImportTree[]
  coordinateDataset: AdministrativeCoordinateDatasetMetadata
  records: readonly AdministrativeCoordinateImportRecord[]
}): AdministrativeCoordinateImportResult {
  const references = options.administrativeTree.flatMap((province) => province.cities.flatMap((city) =>
    city.districts.map((district) => ({ province, city, district })),
  ))
  const byCode = new Map(references.map((reference) => [reference.district.code, reference] as const))
  const byName = new Map<string, typeof references>()
  for (const reference of references) {
    const key = normalizeName(reference.district.name)
    const candidates = byName.get(key) ?? []
    candidates.push(reference)
    byName.set(key, candidates)
  }

  const issues: AdministrativeCoordinateImportIssue[] = []
  const resolved = new Map<string, Array<{ record: AdministrativeCoordinateImportRecord; reference: typeof references[number] }>>()
  for (const record of options.records) {
    if (!record.sourceLabel.trim() || !record.license.trim()) {
      issues.push({ code: record.adminCode, name: record.districtName, reason: 'missing-attribution' })
      continue
    }
    if (!isValidWgs84(record.longitude, record.latitude)) {
      issues.push({ code: record.adminCode, name: record.districtName, reason: 'invalid-coordinate' })
      continue
    }

    let reference: typeof references[number] | undefined
    if (record.adminCode) reference = byCode.get(record.adminCode)
    else {
      const candidates = (byName.get(normalizeName(record.districtName)) ?? []).filter((candidate) => {
        if (record.provinceName && normalizeName(record.provinceName) !== normalizeName(candidate.province.name)) return false
        if (record.cityName && normalizeName(record.cityName) !== normalizeName(candidate.city.name)) return false
        return true
      })
      if (candidates.length > 1) {
        issues.push({ code: undefined, name: record.districtName, reason: 'ambiguous-name', matches: candidates.map((candidate) => candidate.district.code).sort() })
        continue
      }
      reference = candidates[0]
    }
    if (!reference) {
      issues.push({ code: record.adminCode, name: record.districtName, reason: 'unmatched' })
      continue
    }
    const group = resolved.get(reference.district.code) ?? []
    group.push({ record, reference })
    resolved.set(reference.district.code, group)
  }

  const accepted = new Map<string, { record: AdministrativeCoordinateImportRecord; reference: typeof references[number] }>()
  for (const [code, group] of resolved) {
    const coordinateKeys = new Set(group.map(({ record }) => `${record.longitude},${record.latitude}`))
    if (coordinateKeys.size > 1) {
      issues.push({ code, name: group[0].reference.district.name, reason: 'duplicate-coordinate-conflict' })
      continue
    }
    accepted.set(code, group[0])
  }

  const tree = options.administrativeTree.flatMap((province) => {
    const cities = province.cities.flatMap((city) => {
      const districts = city.districts.flatMap((district) => {
        const match = accepted.get(district.code)
        return match ? [{
          code: district.code,
          name: district.name,
          longitude: match.record.longitude,
          latitude: match.record.latitude,
          coordinate: {
            sourceLabel: match.record.sourceLabel,
            license: match.record.license,
            confidence: 'verified' as const,
          },
        }] : []
      })
      return districts.length > 0 ? [{ code: city.code, name: city.name, timezone: city.timezone ?? 'Asia/Shanghai', districts }] : []
    })
    return cities.length > 0 ? [{ code: province.code, name: province.name, cities }] : []
  })

  return {
    tree,
    dataset: { ...options.coordinateDataset, coverage: 'production' },
    selectableDistrictCount: accepted.size,
    unavailableDistrictCount: references.length - accepted.size,
    issues,
  }
}

export type CoordinateInputFormat = 'csv' | 'tsv' | 'json'

type UnknownRecord = Record<string, unknown>

const ADMINISTRATIVE_CODE_KEYS = [
  'administrativecode',
  'admincode',
  'admin_code',
  'gb2260',
  'adcode',
  'districtcode',
  'countycode',
] as const
const NAME_KEYS = ['name', 'district', 'districtname', 'county', 'countyname', 'toponymname'] as const
const LONGITUDE_KEYS = ['longitude', 'lng', 'lon', 'long'] as const
const LATITUDE_KEYS = ['latitude', 'lat'] as const
const PROVINCE_KEYS = ['provincename', 'province', 'admin1name', 'adminname1'] as const
const CITY_KEYS = ['cityname', 'city', 'admin2name', 'adminname2', 'prefecturename'] as const
const EXTERNAL_ID_KEYS = ['externalid', 'geonameid', 'id'] as const
const ALTERNATE_NAME_KEYS = ['alternatenames', 'alternate_names', 'aliases'] as const

/**
 * Parse an already-read coordinate source. This function performs no I/O and
 * never supplies missing coordinates.
 */
export function parseCoordinateInput(text: string, format: CoordinateInputFormat): CoordinateInputRecord[] {
  const rows = format === 'json' ? parseJsonRows(text) : parseDelimitedRows(text, format === 'csv' ? ',' : '\t')
  return rows.map(({ row, sourceRow }) => inputRecordFromUnknown(row, sourceRow))
}

/** Match licensed source records to an authoritative administrative reference. */
export function importCoordinateRecords(
  input: readonly CoordinateInputRecord[],
  administrativeDivisions: readonly AdministrativeDivisionReference[],
  options: { datasetVersion: string; source: CoordinateSourceManifest },
): CoordinateImportReport {
  requireNonEmpty(options.datasetVersion, 'datasetVersion')
  validateSourceManifest(options.source)

  const byCode = new Map(administrativeDivisions.map((division) => [division.code, division] as const))
  const byName = new Map<string, AdministrativeDivisionReference[]>()
  for (const division of administrativeDivisions) {
    const key = normalizeName(division.name)
    const existing = byName.get(key) ?? []
    existing.push(division)
    byName.set(key, existing)
  }

  const matches: CoordinateImportMatch[] = []
  const conflicts: CoordinateImportConflict[] = []
  const unmatched: CoordinateImportUnmatched[] = []
  const rejected: CoordinateImportRejected[] = []
  const candidates: VersionedCoordinateRecord[] = []

  for (const record of input) {
    const rejection = validateInputRecord(record)
    if (rejection) {
      rejected.push(rejection)
      continue
    }

    let division: AdministrativeDivisionReference | undefined
    let matchMethod: 'administrative-code' | 'name'
    const suppliedCode = normalizeAdministrativeCode(record.administrativeCode)
    if (record.administrativeCode) {
      if (!suppliedCode) {
        conflicts.push({
          sourceRow: record.sourceRow,
          externalId: record.externalId,
          reason: 'administrative-code-not-found',
          inputAdministrativeCode: record.administrativeCode,
          inputName: record.name,
          candidateCodes: [],
          detail: `Supplied administrative code ${record.administrativeCode} is not a six-digit code; name fallback was not used.`,
        })
        continue
      }
      division = byCode.get(suppliedCode)
      if (!division) {
        conflicts.push({
          sourceRow: record.sourceRow,
          externalId: record.externalId,
          reason: 'administrative-code-not-found',
          inputAdministrativeCode: record.administrativeCode,
          inputName: record.name,
          candidateCodes: [],
          detail: `Supplied administrative code ${record.administrativeCode} is not present in the reference hierarchy; name fallback was not used.`,
        })
        continue
      }
      matchMethod = 'administrative-code'
    } else {
      const possible = uniqueCandidatesForNames(record, byName).filter((candidate) => matchesParentContext(record, candidate))
      if (possible.length === 0) {
        unmatched.push({
          sourceRow: record.sourceRow,
          externalId: record.externalId,
          inputName: record.name,
          provinceName: record.provinceName,
          cityName: record.cityName,
          detail: 'No administrative division matched the supplied name and parent context.',
        })
        continue
      }
      if (possible.length > 1) {
        conflicts.push({
          sourceRow: record.sourceRow,
          externalId: record.externalId,
          reason: 'ambiguous-name',
          inputName: record.name,
          candidateCodes: possible.map((candidate) => candidate.code).sort(),
          detail: 'Name matching produced multiple administrative divisions; provide a six-digit administrative code or more parent context.',
        })
        continue
      }
      division = possible[0]
      matchMethod = 'name'
    }

    const matched: CoordinateImportMatch = {
      sourceRow: record.sourceRow,
      externalId: record.externalId,
      administrativeCode: division.code,
      administrativeName: division.name,
      matchMethod,
    }
    matches.push(matched)
    candidates.push({
      schemaVersion: COORDINATE_IMPORT_SCHEMA_VERSION,
      datasetVersion: options.datasetVersion,
      administrativeCode: division.code,
      administrativeName: division.name,
      provinceName: division.provinceName,
      cityName: division.cityName,
      longitude: record.longitude,
      latitude: record.latitude,
      coordinateSystem: 'WGS84',
      matchMethod,
      source: {
        ...options.source,
        sourceRow: record.sourceRow,
        externalId: record.externalId,
      },
    })
  }

  const records: VersionedCoordinateRecord[] = []
  const grouped = new Map<string, VersionedCoordinateRecord[]>()
  for (const candidate of candidates) {
    const group = grouped.get(candidate.administrativeCode) ?? []
    group.push(candidate)
    grouped.set(candidate.administrativeCode, group)
  }
  for (const [code, group] of grouped) {
    const coordinates = new Set(group.map((candidate) => `${candidate.longitude},${candidate.latitude}`))
    if (coordinates.size > 1) {
      for (const candidate of group) {
        conflicts.push({
          sourceRow: candidate.source.sourceRow,
          externalId: candidate.source.externalId,
          reason: 'duplicate-coordinate-disagreement',
          inputAdministrativeCode: code,
          inputName: candidate.administrativeName,
          candidateCodes: [code],
          detail: `Multiple source records matched ${code} but supplied different coordinates: ${[...coordinates].join('; ')}. No coordinate was emitted for this division.`,
        })
      }
      continue
    }
    records.push([...group].sort(compareSourceRows)[0])
  }
  records.sort((left, right) => left.administrativeCode.localeCompare(right.administrativeCode))
  conflicts.sort((left, right) => left.sourceRow - right.sourceRow)

  return {
    schemaVersion: COORDINATE_IMPORT_SCHEMA_VERSION,
    datasetVersion: options.datasetVersion,
    source: options.source,
    summary: {
      inputCount: input.length,
      outputCount: records.length,
      matchCount: matches.length,
      conflictCount: conflicts.length,
      unmatchedCount: unmatched.length,
      rejectedCount: rejected.length,
    },
    records,
    matches,
    conflicts,
    unmatched,
    rejected,
  }
}

function parseJsonRows(text: string): Array<{ row: UnknownRecord; sourceRow: number }> {
  const decoded: unknown = JSON.parse(text)
  const values = Array.isArray(decoded)
    ? decoded
    : isUnknownRecord(decoded) && Array.isArray(decoded.records)
      ? decoded.records
      : isUnknownRecord(decoded) && Array.isArray(decoded.geonames)
        ? decoded.geonames
        : undefined
  if (!values) throw new Error('JSON input must be an array or an object containing a records/geonames array')
  return values.map((value, index) => {
    if (!isUnknownRecord(value)) throw new Error(`JSON record ${index + 1} must be an object`)
    return { row: normalizedKeys(value), sourceRow: index + 1 }
  })
}

function parseDelimitedRows(text: string, delimiter: ',' | '\t'): Array<{ row: UnknownRecord; sourceRow: number }> {
  const rows = parseDelimited(text, delimiter).filter((row) => row.some((cell) => cell.trim() !== ''))
  if (rows.length === 0) return []
  const first = rows[0].map((cell) => normalizeKey(cell))
  const hasHeader = first.some((cell) => [...NAME_KEYS, ...LONGITUDE_KEYS, ...LATITUDE_KEYS].includes(cell as never))
  const headers = hasHeader ? first : geonamesTsvHeaders()
  const dataRows = hasHeader ? rows.slice(1) : rows
  return dataRows.map((cells, index) => ({
    sourceRow: index + (hasHeader ? 2 : 1),
    row: Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? ''])),
  }))
}

function parseDelimited(text: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') quoted = false
      else field += character
      continue
    }
    if (character === '"') quoted = true
    else if (character === delimiter) {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else field += character
  }
  if (quoted) throw new Error('Delimited input contains an unclosed quoted field')
  if (field !== '' || row.length > 0) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows
}

function inputRecordFromUnknown(row: UnknownRecord, sourceRow: number): CoordinateInputRecord {
  const alternateNamesValue = valueFor(row, ALTERNATE_NAME_KEYS)
  const alternateNames = Array.isArray(alternateNamesValue)
    ? alternateNamesValue.map(String).filter(Boolean)
    : stringValue(alternateNamesValue)?.split(',').map((name) => name.trim()).filter(Boolean)
  return {
    sourceRow,
    externalId: stringValue(valueFor(row, EXTERNAL_ID_KEYS)),
    administrativeCode: stringValue(valueFor(row, ADMINISTRATIVE_CODE_KEYS)),
    name: stringValue(valueFor(row, NAME_KEYS)) ?? '',
    alternateNames,
    provinceName: stringValue(valueFor(row, PROVINCE_KEYS)),
    cityName: stringValue(valueFor(row, CITY_KEYS)),
    longitude: numberValue(valueFor(row, LONGITUDE_KEYS)),
    latitude: numberValue(valueFor(row, LATITUDE_KEYS)),
  }
}

function uniqueCandidatesForNames(
  record: CoordinateInputRecord,
  byName: ReadonlyMap<string, AdministrativeDivisionReference[]>,
): AdministrativeDivisionReference[] {
  const candidates = new Map<string, AdministrativeDivisionReference>()
  for (const name of [record.name, ...(record.alternateNames ?? [])]) {
    for (const candidate of byName.get(normalizeName(name)) ?? []) candidates.set(candidate.code, candidate)
  }
  return [...candidates.values()]
}

function matchesParentContext(record: CoordinateInputRecord, division: AdministrativeDivisionReference): boolean {
  if (record.provinceName && normalizeName(record.provinceName) !== normalizeName(division.provinceName)) return false
  if (record.cityName && normalizeName(record.cityName) !== normalizeName(division.cityName)) return false
  return true
}

function validateInputRecord(record: CoordinateInputRecord): CoordinateImportRejected | undefined {
  if (!record.name.trim()) return rejection(record, 'missing-name', 'A place name is required; it is never inferred from coordinates.')
  if (!Number.isFinite(record.longitude) || record.longitude < -180 || record.longitude > 180) {
    return rejection(record, 'invalid-longitude', `Longitude must be a finite WGS84 value between -180 and 180; received ${String(record.longitude)}.`)
  }
  if (!Number.isFinite(record.latitude) || record.latitude < -90 || record.latitude > 90) {
    return rejection(record, 'invalid-latitude', `Latitude must be a finite WGS84 value between -90 and 90; received ${String(record.latitude)}.`)
  }
  return undefined
}

function isValidWgs84(longitude: number, latitude: number): boolean {
  return Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 &&
    Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
}

function rejection(
  record: CoordinateInputRecord,
  reason: CoordinateImportRejected['reason'],
  detail: string,
): CoordinateImportRejected {
  return { sourceRow: record.sourceRow, externalId: record.externalId, reason, detail }
}

function validateSourceManifest(source: CoordinateSourceManifest): void {
  for (const [key, value] of Object.entries({
    'source.id': source.id,
    'source.label': source.label,
    'source.version': source.version,
    'source.license': source.license,
    'source.inputFile': source.inputFile,
    'source.inputSha256': source.inputSha256,
  })) requireNonEmpty(value, key)
  if (!/^[a-f\d]{64}$/i.test(source.inputSha256)) throw new Error('source.inputSha256 must be a 64-character SHA-256 digest')
}

function requireNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required`)
}

function normalizedKeys(record: UnknownRecord): UnknownRecord {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [normalizeKey(key), value]))
}

function normalizeKey(value: string): string {
  return value.trim().replace(/^\uFEFF/, '').replace(/[\s-]+/g, '').toLowerCase()
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, '').toLocaleLowerCase('zh-CN')
}

function normalizeAdministrativeCode(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.trim()
  return /^\d{6}$/.test(normalized) ? normalized : undefined
}

function valueFor(record: UnknownRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number') return String(value)
  return undefined
}

function numberValue(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return Number.NaN
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compareSourceRows(left: VersionedCoordinateRecord, right: VersionedCoordinateRecord): number {
  return left.source.sourceRow - right.source.sourceRow
}

function geonamesTsvHeaders(): string[] {
  return [
    'geonameid', 'name', 'asciiname', 'alternatenames', 'latitude', 'longitude', 'featureclass',
    'featurecode', 'countrycode', 'cc2', 'admin1code', 'admin2code', 'admin3code', 'admin4code',
    'population', 'elevation', 'dem', 'timezone', 'modificationdate',
  ]
}
