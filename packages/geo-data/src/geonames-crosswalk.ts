import provinceCityChinaLevel from 'province-city-china/dist/level.json' with { type: 'json' }

import type { AdministrativeCoordinateImportTree, CoordinateInputRecord } from './coordinate-import.js'

const GEONAMES_COLUMN_COUNT = 19
const SUPPORTED_FEATURE_CODES = new Set(['ADM2', 'ADM3', 'ADM4'])

export type GeoNamesMappingMethod =
  | 'verified-admin4-six-digit'
  | 'verified-admin3-six-digit'
  | 'verified-admin2-six-digit'
  | 'verified-admin2-parent-and-name'
  | 'verified-province-direct-and-name'

export interface GeoNamesRecord {
  sourceRow: number
  geonameId: string
  name: string
  asciiName: string
  alternateNames: readonly string[]
  latitude: string
  longitude: string
  featureClass: string
  featureCode: string
  countryCode: string
  alternateCountryCodes: string
  admin1Code: string
  admin2Code: string
  admin3Code: string
  admin4Code: string
  population: string
  elevation: string
  dem: string
  timezone: string
  modificationDate: string
}

export interface GeoNamesAdminCodeEntry {
  code: string
  name: string
  asciiName: string
  geonameId: string
}

export interface GeoNamesSourceManifest {
  dumpDate: string
  sourceUrl: string
  license: string
  licenseUrl: string
  attribution: string
  files: {
    places: GeoNamesSourceFile
    admin1CodesAscii: GeoNamesSourceFile
    admin2Codes: GeoNamesSourceFile
  }
}

export interface GeoNamesSourceFile {
  fileName: string
  sha256: string
}

export interface GeoNamesCandidateRecord extends CoordinateInputRecord {
  administrativeCode: string
  externalId: string
  provinceName: string
  cityName: string
  audit: {
    geonameId: string
    sourceName: string
    sourceRow: number
    mappingMethod: GeoNamesMappingMethod
    featureCode: 'ADM2' | 'ADM3' | 'ADM4'
    geoNamesAdminCodes: {
      admin1: string
      admin2: string
      admin3: string
      admin4: string
    }
    source: GeoNamesSourceManifest
  }
}

export type GeoNamesFilteredReason =
  | 'country-not-cn'
  | 'feature-class-not-administrative'
  | 'unsupported-feature-code'
  | 'adm4-not-imported'
  | 'parent-reference-row'

export type GeoNamesRejectedReason =
  | 'invalid-column-count'
  | 'missing-geoname-id'
  | 'missing-name'
  | 'invalid-longitude'
  | 'invalid-latitude'
  | 'zero-coordinate'

export type GeoNamesConflictReason =
  | 'multiple-six-digit-codes'
  | 'no-verifiable-six-digit-code'
  | 'administrative-code-not-found'
  | 'administrative-code-name-mismatch'
  | 'ambiguous-name'
  | 'district-name-not-found-in-parent'
  | 'admin1-context-missing'
  | 'admin2-context-missing'
  | 'parent-context-mismatch'
  | 'duplicate-coordinate-disagreement'

export interface GeoNamesFiltered {
  sourceRow: number
  geonameId?: string
  reason: GeoNamesFilteredReason
  detail: string
}

export interface GeoNamesRejected {
  sourceRow: number
  geonameId?: string
  reason: GeoNamesRejectedReason
  detail: string
}

export interface GeoNamesConflict {
  sourceRow: number
  geonameId: string
  inputName: string
  reason: GeoNamesConflictReason
  candidateCodes: readonly string[]
  detail: string
}

export interface GeoNamesDuplicate {
  sourceRow: number
  geonameId: string
  inputName: string
  administrativeCode: string
  longitude: number
  latitude: number
  keptSourceRow: number
  keptGeonameId: string
  reason: 'duplicate-coordinate-agreement'
}

export interface ParsedGeoNamesTsv {
  records: readonly GeoNamesRecord[]
  rejected: readonly GeoNamesRejected[]
  inputCount: number
}

export interface GeoNamesCrosswalkReport {
  source: GeoNamesSourceManifest
  summary: {
    inputCount: number
    outputCount: number
    filteredCount: number
    rejectedCount: number
    conflictCount: number
    duplicateCount: number
  }
  records: readonly GeoNamesCandidateRecord[]
  filtered: readonly GeoNamesFiltered[]
  rejected: readonly GeoNamesRejected[]
  conflicts: readonly GeoNamesConflict[]
  duplicates: readonly GeoNamesDuplicate[]
}

interface LocalDivisionReference {
  code: string
  name: string
  provinceCode: string
  provinceName: string
  cityCode: string
  cityName: string
}

interface LocalCityReference {
  cityCode: string
  cityName: string
  provinceCode: string
  provinceName: string
  districts: readonly LocalDivisionReference[]
}

interface LocalProvinceReference {
  provinceCode: string
  provinceName: string
  cities: readonly LocalCityReference[]
}

interface VerifiedParentContext {
  city: LocalCityReference
  admin1: GeoNamesAdminCodeEntry
  admin2: GeoNamesAdminCodeEntry
}

interface LevelNode {
  code: string
  name: string
  children?: readonly LevelNode[]
}

/** Parse GeoNames' standard, headerless 19-column tab-separated dump format. */
export function parseGeoNamesTsv(text: string): ParsedGeoNamesTsv {
  const records: GeoNamesRecord[] = []
  const rejected: GeoNamesRejected[] = []
  let inputCount = 0

  for (const [index, rawLine] of text.split('\n').entries()) {
    const sourceRow = index + 1
    const line = rawLine.replace(/\r$/, '')
    if (!line.trim()) continue
    inputCount += 1
    const columns = line.split('\t')
    if (columns.length !== GEONAMES_COLUMN_COUNT) {
      rejected.push({
        sourceRow,
        geonameId: columns[0]?.trim() || undefined,
        reason: 'invalid-column-count',
        detail: `GeoNames rows must have exactly ${GEONAMES_COLUMN_COUNT} tab-separated columns; received ${columns.length}.`,
      })
      continue
    }
    records.push(recordFromColumns(columns, sourceRow))
  }

  return { records, rejected, inputCount }
}

/** Parse admin1CodesASCII.txt or admin2Codes.txt (four tab-separated columns). */
export function parseGeoNamesAdminCodes(text: string, label: string): ReadonlyMap<string, GeoNamesAdminCodeEntry> {
  const entries = new Map<string, GeoNamesAdminCodeEntry>()
  for (const [index, rawLine] of text.split('\n').entries()) {
    const line = rawLine.replace(/\r$/, '')
    if (!line.trim()) continue
    const columns = line.split('\t')
    if (columns.length !== 4 || !columns[0].trim()) {
      throw new Error(`${label} row ${index + 1} must contain exactly four tab-separated columns and a code`)
    }
    const entry = {
      code: columns[0].trim(),
      name: columns[1].trim(),
      asciiName: columns[2].trim(),
      geonameId: columns[3].trim(),
    }
    if (entries.has(entry.code)) throw new Error(`${label} contains duplicate code ${entry.code}`)
    entries.set(entry.code, entry)
  }
  return entries
}

export function crosswalkGeoNamesChina(options: {
  geoNamesText: string
  admin1CodesAsciiText: string
  admin2CodesText: string
  source: GeoNamesSourceManifest
  administrativeTree?: readonly AdministrativeCoordinateImportTree[]
}): GeoNamesCrosswalkReport {
  validateSourceManifest(options.source)
  const parsed = parseGeoNamesTsv(options.geoNamesText)
  const admin1Codes = parseGeoNamesAdminCodes(options.admin1CodesAsciiText, 'admin1CodesASCII')
  const admin2Codes = parseGeoNamesAdminCodes(options.admin2CodesText, 'admin2Codes')
  const cities = flattenAdministrativeCities(options.administrativeTree ?? defaultAdministrativeTree())
  const references = cities.flatMap((city) => city.districts)
  const byCode = new Map(references.map((reference) => [reference.code, reference] as const))
  const citiesByAdmin2Code = groupCitiesByAdmin2Code(cities)
  const provincePrefixesByAdmin1 = provincePrefixesByAdmin1Code(admin2Codes)
  const provinces = groupLocalProvinces(cities)
  const parentRecordsById = groupParentRecordsById(parsed.records)

  const filtered: GeoNamesFiltered[] = []
  const rejected: GeoNamesRejected[] = [...parsed.rejected]
  const conflicts: GeoNamesConflict[] = []
  const provisional: GeoNamesCandidateRecord[] = []

  for (const record of parsed.records) {
    const filter = filterRecord(record)
    if (filter) {
      filtered.push(filter)
      continue
    }
    const rejection = rejectInvalidRecord(record)
    if (rejection) {
      rejected.push(rejection)
      continue
    }

    const codeCandidates = sixDigitCodeCandidates(record)
    if (codeCandidates.length > 1) {
      conflicts.push(conflict(record, 'multiple-six-digit-codes', codeCandidates.map(({ code }) => code),
        'GeoNames supplied different six-digit values across admin2/admin3/admin4; none was treated as GB/T 2260.'))
      continue
    }
    if (codeCandidates.length === 0) {
      if (record.featureCode === 'ADM2') {
        conflicts.push(conflict(record, 'no-verifiable-six-digit-code', [],
          'An ADM2 row without a six-digit district code cannot be emitted by the district-coordinate importer.'))
        continue
      }
      if (shouldTryProvinceDirectMatch(record, citiesByAdmin2Code)) {
        const directMatch = resolveProvinceDirectDistrict(
          record,
          admin1Codes,
          admin2Codes,
          provinces,
          parentRecordsById,
        )
        if (directMatch.status === 'matched') {
          provisional.push(candidateRecord(record, directMatch.reference, 'verified-province-direct-and-name', options.source))
          continue
        }
        if (directMatch.status === 'conflict') {
          conflicts.push(directMatch.conflict)
          continue
        }
      }
      const parent = verifyParentContext(
        record,
        admin1Codes,
        admin2Codes,
        citiesByAdmin2Code,
        provincePrefixesByAdmin1,
        provinces,
        parentRecordsById,
      )
      if ('conflict' in parent) {
        conflicts.push(parent.conflict)
        continue
      }
      const nameCandidates = candidatesForRecordNameInCity(record, parent.city)
      if (nameCandidates.length !== 1) {
        conflicts.push(conflict(
          record,
          nameCandidates.length > 1 ? 'ambiguous-name' : 'district-name-not-found-in-parent',
          nameCandidates.map(({ code }) => code).sort(),
          nameCandidates.length > 1
            ? `The GeoNames name matches multiple districts inside verified parent city ${parent.city.cityName}; none was selected.`
            : `No district inside verified parent city ${parent.city.cityName} exactly matches the GeoNames name or alternate names. Cross-city fallback was not used.`,
        ))
        continue
      }
      provisional.push(candidateRecord(record, nameCandidates[0], 'verified-admin2-parent-and-name', options.source))
      continue
    }

    const selected = codeCandidates[0]
    const reference = byCode.get(selected.code)
    if (!reference) {
      conflicts.push(conflict(record, 'administrative-code-not-found', [selected.code],
        'The six-digit GeoNames value is not present in the local province-city-china hierarchy.'))
      continue
    }
    if (!recordNames(record).some((name) => normalizeName(name) === normalizeName(reference.name))) {
      conflicts.push(conflict(record, 'administrative-code-name-mismatch', [selected.code],
        `The local division is ${reference.name}, but no GeoNames name or alternate name matches it exactly.`))
      continue
    }

    const parent = verifyParentContext(
      record,
      admin1Codes,
      admin2Codes,
      citiesByAdmin2Code,
      provincePrefixesByAdmin1,
      provinces,
      parentRecordsById,
    )
    if ('conflict' in parent) {
      conflicts.push({ ...parent.conflict, candidateCodes: [selected.code] })
      continue
    }
    if (parent.city.cityCode !== reference.cityCode) {
      conflicts.push(conflict(record, 'parent-context-mismatch', [selected.code],
        `GeoNames parent resolves to ${parent.city.provinceName}/${parent.city.cityName}, not local ${reference.provinceName}/${reference.cityName}.`))
      continue
    }
    provisional.push(candidateRecord(record, reference, selected.method, options.source))
  }

  const { records, duplicates } = removeCoordinateConflicts(provisional, conflicts)
  records.sort((left, right) => left.administrativeCode.localeCompare(right.administrativeCode))
  filtered.sort(compareSourceRow)
  rejected.sort(compareSourceRow)
  conflicts.sort(compareSourceRow)

  return {
    source: options.source,
    summary: {
      inputCount: parsed.inputCount,
      outputCount: records.length,
      filteredCount: filtered.length,
      rejectedCount: rejected.length,
      conflictCount: conflicts.length,
      duplicateCount: duplicates.length,
    },
    records,
    filtered,
    rejected,
    conflicts,
    duplicates,
  }
}

function shouldTryProvinceDirectMatch(
  record: GeoNamesRecord,
  citiesByAdmin2Code: ReadonlyMap<string, readonly LocalCityReference[]>,
): boolean {
  if (!record.admin2Code || !/^\d{4}$/.test(record.admin2Code)) return true
  return (citiesByAdmin2Code.get(record.admin2Code) ?? []).some(isProvinceDirectContainer)
}

function resolveProvinceDirectDistrict(
  record: GeoNamesRecord,
  admin1Codes: ReadonlyMap<string, GeoNamesAdminCodeEntry>,
  admin2Codes: ReadonlyMap<string, GeoNamesAdminCodeEntry>,
  provinces: readonly LocalProvinceReference[],
  parentRecordsById: ReadonlyMap<string, readonly GeoNamesRecord[]>,
):
  | { status: 'matched'; reference: LocalDivisionReference }
  | { status: 'not-found' }
  | { status: 'conflict'; conflict: GeoNamesConflict } {
  const admin1Key = `CN.${record.admin1Code}`
  const admin1 = admin1Codes.get(admin1Key)
  if (!admin1) {
    return { status: 'conflict', conflict: conflict(record, 'admin1-context-missing', [], `No ${admin1Key} entry exists in admin1CodesASCII.txt.`) }
  }
  const admin1Rows = (parentRecordsById.get(admin1.geonameId) ?? []).filter((row) => row.featureCode === 'ADM1')
  if (admin1Rows.length !== 1) {
    return {
      status: 'conflict',
      conflict: conflict(record, 'parent-context-mismatch', [],
        `Province-direct matching requires exactly one CN.txt ADM1 row for ${admin1.geonameId}; found ${admin1Rows.length}.`),
    }
  }
  const provinceCandidates = matchChineseParentNames(admin1Rows[0], provinces, (province) => province.provinceName)
  if (provinceCandidates.length !== 1 || admin1Rows[0].admin1Code !== record.admin1Code) {
    return {
      status: 'conflict',
      conflict: conflict(record, 'parent-context-mismatch', [],
        `The ADM1 row ${admin1.geonameId} must uniquely verify the candidate province by a Chinese name.`),
    }
  }
  const directCities = provinceCandidates[0].cities.filter(isProvinceDirectContainer)
  const candidates = directCities.flatMap((city) => candidatesForRecordNameInCity(record, city))
  const unique = [...new Map(candidates.map((candidate) => [candidate.code, candidate] as const)).values()]
  if (unique.length === 0) return { status: 'not-found' }
  if (unique.length > 1) {
    return {
      status: 'conflict',
      conflict: conflict(record, 'ambiguous-name', unique.map(({ code }) => code).sort(),
        `The ADM3 name matches multiple province-direct districts inside ${provinceCandidates[0].provinceName}.`),
    }
  }
  const parentConflict = nonFourAdmin2EvidenceConflict(
    record,
    unique[0],
    admin2Codes.get(`${admin1Key}.${record.admin2Code}`),
    parentRecordsById,
  )
  if (parentConflict) return { status: 'conflict', conflict: parentConflict }
  return { status: 'matched', reference: unique[0] }
}

function nonFourAdmin2EvidenceConflict(
  record: GeoNamesRecord,
  reference: LocalDivisionReference,
  admin2: GeoNamesAdminCodeEntry | undefined,
  parentRecordsById: ReadonlyMap<string, readonly GeoNamesRecord[]>,
): GeoNamesConflict | undefined {
  if (!record.admin2Code || /^\d{4}$/.test(record.admin2Code) || !admin2) return undefined
  const rows = (parentRecordsById.get(admin2.geonameId) ?? []).filter((row) => row.featureCode === 'ADM2')
  if (rows.length === 0) return undefined
  if (rows.length !== 1 || rows[0].admin1Code !== record.admin1Code) {
    return conflict(record, 'parent-context-mismatch', [reference.code], 'The optional non-four-digit ADM2 parent evidence is duplicated or belongs to another province.')
  }
  const chineseNames = recordNames(rows[0]).filter(containsCjk).map(normalizeAdministrativeName)
  if (chineseNames.length > 0 && !chineseNames.includes(normalizeAdministrativeName(reference.name))) {
    return conflict(record, 'parent-context-mismatch', [reference.code],
      `The optional ADM2 parent row ${admin2.geonameId} does not corroborate province-direct district ${reference.name}.`)
  }
  return undefined
}

function isProvinceDirectContainer(city: LocalCityReference): boolean {
  return /(?:省|自治区)?直辖县级行政区划/u.test(city.cityName)
}

function validateSourceManifest(source: GeoNamesSourceManifest): void {
  for (const [label, value] of Object.entries({
    dumpDate: source.dumpDate,
    sourceUrl: source.sourceUrl,
    license: source.license,
    licenseUrl: source.licenseUrl,
    attribution: source.attribution,
    'files.places.fileName': source.files.places.fileName,
    'files.admin1CodesAscii.fileName': source.files.admin1CodesAscii.fileName,
    'files.admin2Codes.fileName': source.files.admin2Codes.fileName,
  })) {
    if (!value.trim()) throw new Error(`GeoNames source ${label} is required`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.dumpDate)) throw new Error('GeoNames source dumpDate must use YYYY-MM-DD')
  for (const [label, file] of Object.entries(source.files)) {
    if (!/^[a-f\d]{64}$/i.test(file.sha256)) throw new Error(`GeoNames source ${label} SHA-256 must contain 64 hexadecimal characters`)
  }
}

function recordFromColumns(columns: readonly string[], sourceRow: number): GeoNamesRecord {
  return {
    sourceRow,
    geonameId: columns[0].trim(),
    name: columns[1].trim(),
    asciiName: columns[2].trim(),
    alternateNames: columns[3].split(',').map((name) => name.trim()).filter(Boolean),
    latitude: columns[4].trim(),
    longitude: columns[5].trim(),
    featureClass: columns[6].trim(),
    featureCode: columns[7].trim(),
    countryCode: columns[8].trim(),
    alternateCountryCodes: columns[9].trim(),
    admin1Code: columns[10].trim(),
    admin2Code: columns[11].trim(),
    admin3Code: columns[12].trim(),
    admin4Code: columns[13].trim(),
    population: columns[14].trim(),
    elevation: columns[15].trim(),
    dem: columns[16].trim(),
    timezone: columns[17].trim(),
    modificationDate: columns[18].trim(),
  }
}

function filterRecord(record: GeoNamesRecord): GeoNamesFiltered | undefined {
  if (record.countryCode !== 'CN') return filtered(record, 'country-not-cn', `Expected countryCode CN; received ${record.countryCode || '(empty)'}.`)
  if (record.featureClass !== 'A') return filtered(record, 'feature-class-not-administrative', `Expected featureClass A; received ${record.featureClass || '(empty)'}.`)
  if (!SUPPORTED_FEATURE_CODES.has(record.featureCode)) return filtered(record, 'unsupported-feature-code', `Only ADM2, ADM3 and ADM4 are eligible; received ${record.featureCode || '(empty)'}.`)
  if (record.featureCode === 'ADM2') return filtered(record, 'parent-reference-row', 'ADM2 rows are used only to verify parent hierarchy and are not district-coordinate candidates.')
  if (record.featureCode === 'ADM4') return filtered(record, 'adm4-not-imported', 'ADM4 rows are retained for review but are not eligible for district-coordinate output.')
  return undefined
}

function rejectInvalidRecord(record: GeoNamesRecord): GeoNamesRejected | undefined {
  if (!record.geonameId) return rejected(record, 'missing-geoname-id', 'A GeoNames ID is required for auditability.')
  if (!record.name) return rejected(record, 'missing-name', 'A GeoNames place name is required and is never inferred from coordinates.')
  const longitude = Number(record.longitude)
  if (!record.longitude || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return rejected(record, 'invalid-longitude', `Longitude must be a finite WGS84 value between -180 and 180; received ${record.longitude || '(empty)'}.`)
  }
  const latitude = Number(record.latitude)
  if (!record.latitude || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return rejected(record, 'invalid-latitude', `Latitude must be a finite WGS84 value between -90 and 90; received ${record.latitude || '(empty)'}.`)
  }
  if (longitude === 0 && latitude === 0) {
    return rejected(record, 'zero-coordinate', 'The 0,0 sentinel is not accepted as a coordinate for a China administrative division.')
  }
  return undefined
}

function sixDigitCodeCandidates(record: GeoNamesRecord): Array<{ code: string; method: GeoNamesMappingMethod }> {
  const candidates = [
    { code: record.admin4Code, method: 'verified-admin4-six-digit' as const },
    { code: record.admin3Code, method: 'verified-admin3-six-digit' as const },
    { code: record.admin2Code, method: 'verified-admin2-six-digit' as const },
  ].filter(({ code }) => /^\d{6}$/.test(code))
  return [...new Map(candidates.map((candidate) => [candidate.code, candidate] as const)).values()]
}

function recordNames(record: GeoNamesRecord): readonly string[] {
  return [record.name, record.asciiName, ...record.alternateNames].filter(Boolean)
}

function candidatesForRecordNameInCity(record: GeoNamesRecord, city: LocalCityReference): LocalDivisionReference[] {
  const candidates = new Map<string, LocalDivisionReference>()
  const byName = new Map<string, LocalDivisionReference[]>()
  for (const district of city.districts) {
    const group = byName.get(normalizeName(district.name)) ?? []
    group.push(district)
    byName.set(normalizeName(district.name), group)
  }
  for (const name of recordNames(record)) {
    for (const candidate of byName.get(normalizeName(name)) ?? []) candidates.set(candidate.code, candidate)
  }
  return [...candidates.values()]
}

function verifyParentContext(
  record: GeoNamesRecord,
  admin1Codes: ReadonlyMap<string, GeoNamesAdminCodeEntry>,
  admin2Codes: ReadonlyMap<string, GeoNamesAdminCodeEntry>,
  citiesByAdmin2Code: ReadonlyMap<string, readonly LocalCityReference[]>,
  provincePrefixesByAdmin1: ReadonlyMap<string, ReadonlySet<string>>,
  provinces: readonly LocalProvinceReference[],
  parentRecordsById: ReadonlyMap<string, readonly GeoNamesRecord[]>,
): VerifiedParentContext | { conflict: GeoNamesConflict } {
  const admin1Key = `CN.${record.admin1Code}`
  const admin2Key = `${admin1Key}.${record.admin2Code}`
  const admin1 = admin1Codes.get(admin1Key)
  if (!admin1) {
    return { conflict: conflict(record, 'admin1-context-missing', [], `No ${admin1Key} entry exists in admin1CodesASCII.txt.`) }
  }
  const admin2 = admin2Codes.get(admin2Key)
  if (!admin2) {
    return { conflict: conflict(record, 'admin2-context-missing', [], `No ${admin2Key} entry exists in admin2Codes.txt.`) }
  }
  if (!/^\d{4}$/.test(record.admin2Code)) {
    return verifyNonFourDigitParentContext(record, admin1, admin2, provinces, parentRecordsById)
  }
  const cities = citiesByAdmin2Code.get(record.admin2Code) ?? []
  if (cities.length !== 1) {
    return {
      conflict: conflict(
        record,
        'parent-context-mismatch',
        cities.flatMap((city) => city.districts.map(({ code }) => code)).sort(),
        `GeoNames admin2 ${record.admin2Code || '(empty)'} must identify exactly one city in the local hierarchy; found ${cities.length}.`,
      ),
    }
  }
  const city = cities[0]
  const provincePrefixes = provincePrefixesByAdmin1.get(admin1Key) ?? new Set<string>()
  const expectedProvincePrefix = city.provinceCode.slice(0, 2)
  if (provincePrefixes.size !== 1 || !provincePrefixes.has(expectedProvincePrefix) ||
      mappedChineseNameConflicts(admin1, city.provinceName) ||
      mappedChineseNameConflicts(admin2, city.cityName)) {
    return {
      conflict: conflict(
        record,
        'parent-context-mismatch',
        city.districts.map(({ code }) => code).sort(),
        `GeoNames admin1 ${admin1Key} does not uniquely correspond to local province prefix ${expectedProvincePrefix} for ${city.provinceName}/${city.cityName}.`,
      ),
    }
  }
  return { city, admin1, admin2 }
}

function verifyNonFourDigitParentContext(
  record: GeoNamesRecord,
  admin1: GeoNamesAdminCodeEntry,
  admin2: GeoNamesAdminCodeEntry,
  provinces: readonly LocalProvinceReference[],
  parentRecordsById: ReadonlyMap<string, readonly GeoNamesRecord[]>,
): VerifiedParentContext | { conflict: GeoNamesConflict } {
  const admin1Rows = (parentRecordsById.get(admin1.geonameId) ?? []).filter((row) => row.featureCode === 'ADM1')
  const admin2Rows = (parentRecordsById.get(admin2.geonameId) ?? []).filter((row) => row.featureCode === 'ADM2')
  if (admin1Rows.length !== 1 || admin2Rows.length !== 1) {
    return {
      conflict: conflict(
        record,
        'parent-context-mismatch',
        [],
        `Non-four-digit admin2 requires exactly one CN.txt ADM1 row for ${admin1.geonameId} and one ADM2 row for ${admin2.geonameId}; found ${admin1Rows.length}/${admin2Rows.length}.`,
      ),
    }
  }
  const admin1Row = admin1Rows[0]
  const admin2Row = admin2Rows[0]
  if (admin1Row.admin1Code !== record.admin1Code || admin2Row.admin1Code !== record.admin1Code) {
    return {
      conflict: conflict(record, 'parent-context-mismatch', [], 'The CN.txt ADM1/ADM2 rows do not share the candidate row admin1Code.'),
    }
  }
  const provinceCandidates = matchChineseParentNames(admin1Row, provinces, (province) => province.provinceName)
  if (provinceCandidates.length !== 1) {
    return {
      conflict: conflict(
        record,
        'parent-context-mismatch',
        provinceCandidates.flatMap((province) => province.cities.flatMap((city) => city.districts.map(({ code }) => code))).sort(),
        `The ADM1 row ${admin1.geonameId} must uniquely match one local province by a Chinese name; found ${provinceCandidates.length}.`,
      ),
    }
  }
  const cityCandidates = matchChineseParentNames(admin2Row, provinceCandidates[0].cities, (city) => city.cityName)
  if (cityCandidates.length !== 1) {
    return {
      conflict: conflict(
        record,
        'parent-context-mismatch',
        cityCandidates.flatMap((city) => city.districts.map(({ code }) => code)).sort(),
        `The ADM2 row ${admin2.geonameId} must uniquely match one city inside ${provinceCandidates[0].provinceName} by a Chinese name; found ${cityCandidates.length}.`,
      ),
    }
  }
  return { city: cityCandidates[0], admin1, admin2 }
}

function groupCitiesByAdmin2Code(cities: readonly LocalCityReference[]): ReadonlyMap<string, readonly LocalCityReference[]> {
  const grouped = new Map<string, LocalCityReference[]>()
  for (const city of cities) {
    const admin2Code = city.cityCode.slice(0, 4)
    const group = grouped.get(admin2Code) ?? []
    group.push(city)
    grouped.set(admin2Code, group)
  }
  return grouped
}

function groupLocalProvinces(cities: readonly LocalCityReference[]): LocalProvinceReference[] {
  const grouped = new Map<string, { provinceCode: string; provinceName: string; cities: LocalCityReference[] }>()
  for (const city of cities) {
    const existing = grouped.get(city.provinceCode)
    if (existing) {
      existing.cities.push(city)
    } else {
      grouped.set(city.provinceCode, {
        provinceCode: city.provinceCode,
        provinceName: city.provinceName,
        cities: [city],
      })
    }
  }
  return [...grouped.values()]
}

function groupParentRecordsById(records: readonly GeoNamesRecord[]): ReadonlyMap<string, readonly GeoNamesRecord[]> {
  const grouped = new Map<string, GeoNamesRecord[]>()
  for (const record of records) {
    if (record.countryCode !== 'CN' || record.featureClass !== 'A' ||
        (record.featureCode !== 'ADM1' && record.featureCode !== 'ADM2') || !record.geonameId) continue
    const group = grouped.get(record.geonameId) ?? []
    group.push(record)
    grouped.set(record.geonameId, group)
  }
  return grouped
}

function matchChineseParentNames<T>(record: GeoNamesRecord, candidates: readonly T[], nameFor: (candidate: T) => string): T[] {
  const names = new Set(recordNames(record).filter(containsCjk).map(normalizeAdministrativeName))
  return candidates.filter((candidate) => names.has(normalizeAdministrativeName(nameFor(candidate))))
}

function provincePrefixesByAdmin1Code(
  admin2Codes: ReadonlyMap<string, GeoNamesAdminCodeEntry>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const grouped = new Map<string, Set<string>>()
  for (const key of admin2Codes.keys()) {
    const match = /^(CN\.[^.]+)\.(\d{4})$/.exec(key)
    if (!match) continue
    const prefixes = grouped.get(match[1]) ?? new Set<string>()
    prefixes.add(match[2].slice(0, 2))
    grouped.set(match[1], prefixes)
  }
  return grouped
}

function candidateRecord(
  record: GeoNamesRecord,
  reference: LocalDivisionReference,
  mappingMethod: GeoNamesMappingMethod,
  source: GeoNamesSourceManifest,
): GeoNamesCandidateRecord {
  return {
    sourceRow: record.sourceRow,
    externalId: record.geonameId,
    administrativeCode: reference.code,
    name: reference.name,
    provinceName: reference.provinceName,
    cityName: reference.cityName,
    longitude: Number(record.longitude),
    latitude: Number(record.latitude),
    audit: {
      geonameId: record.geonameId,
      sourceName: record.name,
      sourceRow: record.sourceRow,
      mappingMethod,
      featureCode: record.featureCode as 'ADM2' | 'ADM3' | 'ADM4',
      geoNamesAdminCodes: {
        admin1: record.admin1Code,
        admin2: record.admin2Code,
        admin3: record.admin3Code,
        admin4: record.admin4Code,
      },
      source,
    },
  }
}

function mappedChineseNameConflicts(entry: GeoNamesAdminCodeEntry, localName: string): boolean {
  const mappedNames = [entry.name, entry.asciiName].filter(containsCjk)
  return mappedNames.length > 0 && !mappedNames.some((name) => normalizeAdministrativeName(name) === normalizeAdministrativeName(localName))
}

function removeCoordinateConflicts(
  provisional: readonly GeoNamesCandidateRecord[],
  conflicts: GeoNamesConflict[],
): { records: GeoNamesCandidateRecord[]; duplicates: GeoNamesDuplicate[] } {
  const grouped = new Map<string, GeoNamesCandidateRecord[]>()
  for (const record of provisional) {
    const group = grouped.get(record.administrativeCode) ?? []
    group.push(record)
    grouped.set(record.administrativeCode, group)
  }
  const accepted: GeoNamesCandidateRecord[] = []
  const duplicates: GeoNamesDuplicate[] = []
  for (const [code, group] of grouped) {
    const coordinates = new Set(group.map((record) => `${record.longitude},${record.latitude}`))
    if (coordinates.size > 1) {
      for (const record of group) {
        conflicts.push({
          sourceRow: record.sourceRow,
          geonameId: record.audit.geonameId,
          inputName: record.audit.sourceName,
          reason: 'duplicate-coordinate-disagreement',
          candidateCodes: [code],
          detail: `Multiple GeoNames rows mapped to ${code} with different coordinates (${[...coordinates].join('; ')}); no coordinate was emitted.`,
        })
      }
      continue
    }
    const sorted = [...group].sort(compareSourceRow)
    const kept = sorted[0]
    accepted.push(kept)
    for (const duplicate of sorted.slice(1)) {
      duplicates.push({
        sourceRow: duplicate.sourceRow,
        geonameId: duplicate.audit.geonameId,
        inputName: duplicate.audit.sourceName,
        administrativeCode: code,
        longitude: duplicate.longitude,
        latitude: duplicate.latitude,
        keptSourceRow: kept.sourceRow,
        keptGeonameId: kept.audit.geonameId,
        reason: 'duplicate-coordinate-agreement',
      })
    }
  }
  duplicates.sort(compareSourceRow)
  return { records: accepted, duplicates }
}

function defaultAdministrativeTree(): readonly AdministrativeCoordinateImportTree[] {
  return (provinceCityChinaLevel as readonly LevelNode[]).map((province) => {
    const children = province.children ?? []
    const hasCityLayer = children.some((child) => (child.children?.length ?? 0) > 0)
    return {
      code: province.code,
      name: province.name,
      cities: hasCityLayer
        ? children.map((city) => ({
            code: city.code,
            name: city.name,
            districts: (city.children ?? []).map((district) => ({ code: district.code, name: district.name })),
          }))
        : [{
            code: `${province.code.slice(0, 2)}0100`,
            name: province.name,
            districts: children.map((district) => ({ code: district.code, name: district.name })),
          }],
    }
  })
}

function flattenAdministrativeCities(tree: readonly AdministrativeCoordinateImportTree[]): LocalCityReference[] {
  return tree.flatMap((province) => province.cities.map((city) => {
    const base = {
      provinceCode: province.code,
      provinceName: province.name,
      cityCode: city.code,
      cityName: city.name,
    }
    return {
      ...base,
      districts: city.districts.map((district) => ({ ...base, code: district.code, name: district.name })),
    }
  }))
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, '').toLocaleLowerCase('zh-CN')
}

function normalizeAdministrativeName(value: string): string {
  return normalizeName(value).replace(/(特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|自治州|地区|盟|省|市)$/u, '')
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value)
}

function filtered(record: GeoNamesRecord, reason: GeoNamesFilteredReason, detail: string): GeoNamesFiltered {
  return { sourceRow: record.sourceRow, geonameId: record.geonameId || undefined, reason, detail }
}

function rejected(record: GeoNamesRecord, reason: GeoNamesRejectedReason, detail: string): GeoNamesRejected {
  return { sourceRow: record.sourceRow, geonameId: record.geonameId || undefined, reason, detail }
}

function conflict(
  record: GeoNamesRecord,
  reason: GeoNamesConflictReason,
  candidateCodes: readonly string[],
  detail: string,
): GeoNamesConflict {
  return { sourceRow: record.sourceRow, geonameId: record.geonameId, inputName: record.name, reason, candidateCodes, detail }
}

function compareSourceRow(left: { sourceRow: number }, right: { sourceRow: number }): number {
  return left.sourceRow - right.sourceRow
}
