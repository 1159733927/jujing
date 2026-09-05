import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import provinceCityChinaLevel from 'province-city-china/dist/level.json' with { type: 'json' }

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIRECTORY = resolve(SCRIPT_DIRECTORY, '..')

export const DEFAULT_CANDIDATES_PATH = resolve(PACKAGE_DIRECTORY, '../../.data/geonames/2026-08-31/crosswalk-v4/candidates.json')
export const DEFAULT_MANIFEST_PATH = resolve(PACKAGE_DIRECTORY, '../../.data/geonames/2026-08-31/crosswalk-v4/manifest.json')
export const DEFAULT_OUTPUT_PATH = resolve(PACKAGE_DIRECTORY, 'src/generated/geonames-cn-2026-08-31.json')

export function buildGeoNamesArtifact(candidatesDocument, manifestDocument) {
  const records = candidatesDocument?.records
  const source = candidatesDocument?.source
  if (!Array.isArray(records) || !source || typeof source !== 'object') {
    throw new Error('Candidates document must contain source and records')
  }
  if (!manifestDocument?.source || !manifestDocument?.summary) {
    throw new Error('Manifest document must contain source and summary')
  }
  if (JSON.stringify(source) !== JSON.stringify(manifestDocument.source)) {
    throw new Error('Candidates and manifest source metadata do not match')
  }
  if (manifestDocument.summary.outputCount !== records.length) {
    throw new Error(`Manifest outputCount ${manifestDocument.summary.outputCount} does not match ${records.length} records`)
  }

  const administrativeCodes = collectDistrictCodes(provinceCityChinaLevel)
  const seenCodes = new Set()
  const compactRecords = records.map((record, index) => {
    const code = record?.administrativeCode
    const longitude = record?.longitude
    const latitude = record?.latitude
    const externalId = record?.externalId
    const sourceName = record?.audit?.sourceName
    const mappingMethod = record?.audit?.mappingMethod
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new Error(`Record ${index} has an invalid administrative code`)
    if (!administrativeCodes.has(code)) throw new Error(`Record ${index} references an unknown administrative code: ${code}`)
    if (seenCodes.has(code)) throw new Error(`Duplicate administrative code: ${code}`)
    if (!isUsableCoordinate(longitude, latitude)) throw new Error(`Record ${index} has invalid or null-island coordinates: ${code}`)
    if (typeof externalId !== 'string' || !externalId) throw new Error(`Record ${index} is missing externalId: ${code}`)
    if (typeof sourceName !== 'string' || !sourceName) throw new Error(`Record ${index} is missing sourceName: ${code}`)
    if (typeof mappingMethod !== 'string' || !mappingMethod) throw new Error(`Record ${index} is missing mappingMethod: ${code}`)
    seenCodes.add(code)
    return { code, longitude, latitude, externalId, sourceName, mappingMethod }
  }).sort((left, right) => left.code.localeCompare(right.code))

  const placesHash = source.files?.places?.sha256
  if (typeof placesHash !== 'string' || !/^[a-f0-9]{64}$/.test(placesHash)) {
    throw new Error('GeoNames places SHA-256 is missing or invalid')
  }

  const artifact = {
    metadata: {
      id: 'geonames-cn-reviewed-coordinates',
      version: `2026-08-31.${placesHash.slice(0, 12)}`,
      dumpDate: source.dumpDate,
      sourceUrl: source.sourceUrl,
      license: source.license,
      licenseUrl: source.licenseUrl,
      attribution: source.attribution,
      files: source.files,
      inputRecordCount: manifestDocument.summary.inputCount,
      importedRecordCount: compactRecords.length,
      administrativeDistrictCount: administrativeCodes.size,
      coverageRatio: compactRecords.length / administrativeCodes.size,
      contentSha256: hashRecords(compactRecords),
    },
    records: compactRecords,
  }
  verifyGeoNamesArtifactContentHash(artifact)
  return artifact
}

/** Build/test gate for detecting any record change after metadata.contentSha256 was produced. */
export function verifyGeoNamesArtifactContentHash(artifact) {
  if (!artifact?.metadata || !Array.isArray(artifact.records)) {
    throw new Error('GeoNames artifact must contain metadata and records')
  }
  const actualHash = hashRecords(artifact.records)
  if (artifact.metadata.contentSha256 !== actualHash) {
    throw new Error(`GeoNames artifact content SHA-256 mismatch: expected ${artifact.metadata.contentSha256}, got ${actualHash}`)
  }
  return true
}

export async function writeGeoNamesArtifact(outputPath, artifact, { force = false } = {}) {
  const serialized = `${JSON.stringify(artifact)}\n`
  await mkdir(dirname(outputPath), { recursive: true })
  if (!force) {
    try {
      await writeFile(outputPath, serialized, { encoding: 'utf8', flag: 'wx' })
      return
    } catch (error) {
      if (error?.code === 'EEXIST') throw new Error(`Refusing to replace existing artifact: ${outputPath}; pass --force for a deterministic rebuild`)
      throw error
    }
  }

  const temporaryPath = `${outputPath}.tmp-${randomUUID()}`
  try {
    await writeFile(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx' })
    await rename(temporaryPath, outputPath)
  } catch (error) {
    try {
      await unlink(temporaryPath)
    } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') throw cleanupError
    }
    throw error
  }
}

export async function buildArtifactFromFiles({
  candidatesPath = DEFAULT_CANDIDATES_PATH,
  manifestPath = DEFAULT_MANIFEST_PATH,
  outputPath = DEFAULT_OUTPUT_PATH,
  force = false,
} = {}) {
  const [candidatesText, manifestText] = await Promise.all([
    readFile(candidatesPath, 'utf8'),
    readFile(manifestPath, 'utf8'),
  ])
  const artifact = buildGeoNamesArtifact(JSON.parse(candidatesText), JSON.parse(manifestText))
  await writeGeoNamesArtifact(outputPath, artifact, { force })
  return artifact
}

function collectDistrictCodes(level) {
  const codes = new Set()
  for (const province of level) {
    const children = province.children ?? []
    const containsCityLayer = children.some((child) => (child.children?.length ?? 0) > 0)
    if (containsCityLayer) {
      for (const city of children) for (const district of city.children ?? []) codes.add(district.code)
    } else {
      for (const district of children) codes.add(district.code)
    }
  }
  return codes
}

function isUsableCoordinate(longitude, latitude) {
  return Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 &&
    Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    !(longitude === 0 && latitude === 0)
}

function hashRecords(records) {
  return createHash('sha256').update(JSON.stringify(records)).digest('hex')
}

function parseArguments(arguments_) {
  const options = {}
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--') continue
    if (argument === '--force') options.force = true
    else if (argument === '--candidates') options.candidatesPath = resolve(requireValue(arguments_, ++index, argument))
    else if (argument === '--manifest') options.manifestPath = resolve(requireValue(arguments_, ++index, argument))
    else if (argument === '--output') options.outputPath = resolve(requireValue(arguments_, ++index, argument))
    else throw new Error(`Unknown argument: ${argument}`)
  }
  return options
}

function requireValue(arguments_, index, flag) {
  const value = arguments_[index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path`)
  return value
}

async function isMainModule() {
  if (!process.argv[1]) return false
  try {
    await access(process.argv[1])
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (await isMainModule()) {
  try {
    const artifact = await buildArtifactFromFiles(parseArguments(process.argv.slice(2)))
    process.stdout.write(`Wrote ${artifact.records.length} reviewed GeoNames records (${artifact.metadata.version})\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
