import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import { fileURLToPath } from 'node:url'

import { buildArtifactFromFiles, buildGeoNamesArtifact, verifyGeoNamesArtifactContentHash } from './build-geonames-artifact.mjs'

const PACKAGE_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GENERATED_ARTIFACT_PATH = resolve(PACKAGE_DIRECTORY, 'src/generated/geonames-cn-2026-08-31.json')

const source = {
  dumpDate: '2026-08-31',
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

function candidate(code, longitude, latitude) {
  return {
    administrativeCode: code,
    longitude,
    latitude,
    externalId: `external-${code}`,
    audit: { sourceName: `source-${code}`, mappingMethod: 'verified-admin2-parent-and-name' },
  }
}

function documents(records) {
  return [
    { source, records },
    { source, summary: { inputCount: records.length, outputCount: records.length } },
  ]
}

test('builds a compact artifact sorted by administrative code with source metadata once', () => {
  const [candidates, manifest] = documents([
    candidate('330106', 120.13333, 30.26667),
    candidate('110101', 116.41834, 39.93264),
  ])
  const artifact = buildGeoNamesArtifact(candidates, manifest)
  assert.deepEqual(artifact.records.map((record) => record.code), ['110101', '330106'])
  assert.equal(artifact.records[0].source, undefined)
  assert.equal(artifact.metadata.importedRecordCount, 2)
  assert.equal(artifact.metadata.administrativeDistrictCount, 3311)
  assert.match(artifact.metadata.contentSha256, /^[a-f0-9]{64}$/)
  assert.match(artifact.metadata.version, /a{12}$/)
})

test('rejects duplicate, unknown and null-island records', () => {
  let [candidates, manifest] = documents([candidate('330106', 120, 30), candidate('330106', 121, 31)])
  assert.throws(() => buildGeoNamesArtifact(candidates, manifest), /Duplicate administrative code/)
  ;[candidates, manifest] = documents([candidate('999999', 120, 30)])
  assert.throws(() => buildGeoNamesArtifact(candidates, manifest), /unknown administrative code/)
  ;[candidates, manifest] = documents([candidate('330106', 0, 0)])
  assert.throws(() => buildGeoNamesArtifact(candidates, manifest), /null-island/)
})

test('refuses an existing artifact unless force is explicit and rebuilds deterministically', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'geonames-artifact-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const candidatesPath = join(directory, 'candidates.json')
  const manifestPath = join(directory, 'manifest.json')
  const outputPath = join(directory, 'artifact.json')
  const [candidates, manifest] = documents([candidate('330106', 120.13333, 30.26667)])
  await writeFile(candidatesPath, JSON.stringify(candidates))
  await writeFile(manifestPath, JSON.stringify(manifest))

  await buildArtifactFromFiles({ candidatesPath, manifestPath, outputPath })
  const first = await readFile(outputPath, 'utf8')
  await assert.rejects(
    buildArtifactFromFiles({ candidatesPath, manifestPath, outputPath }),
    /Refusing to replace existing artifact/,
  )
  await buildArtifactFromFiles({ candidatesPath, manifestPath, outputPath, force: true })
  assert.equal(await readFile(outputPath, 'utf8'), first)
})

test('recomputes the bundled artifact records hash using the canonical serialization', async () => {
  const artifact = JSON.parse(await readFile(GENERATED_ARTIFACT_PATH, 'utf8'))
  const independentlyComputedHash = createHash('sha256')
    .update(JSON.stringify(artifact.records))
    .digest('hex')

  assert.equal(independentlyComputedHash, artifact.metadata.contentSha256)
  assert.equal(verifyGeoNamesArtifactContentHash(artifact), true)
})

test('fails the content hash gate after a generated coordinate record is tampered with', async () => {
  const artifact = JSON.parse(await readFile(GENERATED_ARTIFACT_PATH, 'utf8'))
  artifact.records[0].longitude += 0.00001

  const tamperedHash = createHash('sha256')
    .update(JSON.stringify(artifact.records))
    .digest('hex')
  assert.notEqual(tamperedHash, artifact.metadata.contentSha256)
  assert.throws(
    () => verifyGeoNamesArtifactContentHash(artifact),
    /content SHA-256 mismatch/,
  )
})
