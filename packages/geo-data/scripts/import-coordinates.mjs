#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import process from 'node:process'
import administrativeLevel from 'province-city-china/dist/level.json' with { type: 'json' }
import { importCoordinateRecords, parseCoordinateInput } from '../src/coordinate-import.ts'

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  process.stdout.write(usage())
  process.exit(0)
}

const required = ['input', 'output', 'dataset-version', 'source-id', 'source-label', 'source-version', 'license']
const missing = required.filter((name) => !args[name])
if (missing.length > 0) fail(`Missing required options: ${missing.map((name) => `--${name}`).join(', ')}\n\n${usage()}`)

const inputPath = resolve(args.input)
const outputDirectory = resolve(args.output)
const input = await readFile(inputPath)
const format = resolveFormat(args.format, inputPath)
const source = {
  id: args['source-id'],
  label: args['source-label'],
  version: args['source-version'],
  license: args.license,
  sourceUrl: args['source-url'],
  licenseUrl: args['license-url'],
  attribution: args.attribution,
  inputFile: basename(inputPath),
  inputSha256: createHash('sha256').update(input).digest('hex'),
}
const records = parseCoordinateInput(input.toString('utf8'), format)
const report = importCoordinateRecords(records, flattenAdministrativeHierarchy(administrativeLevel), {
  datasetVersion: args['dataset-version'],
  source,
})

await mkdir(outputDirectory, { recursive: true })
await Promise.all([
  writeJsonExclusive(resolve(outputDirectory, 'coordinates.json'), {
    schemaVersion: report.schemaVersion,
    datasetVersion: report.datasetVersion,
    source: report.source,
    records: report.records,
  }),
  writeJsonExclusive(resolve(outputDirectory, 'matches.json'), report.matches),
  writeJsonExclusive(resolve(outputDirectory, 'conflicts.json'), report.conflicts),
  writeJsonExclusive(resolve(outputDirectory, 'unmatched.json'), report.unmatched),
  writeJsonExclusive(resolve(outputDirectory, 'rejected.json'), report.rejected),
  writeJsonExclusive(resolve(outputDirectory, 'manifest.json'), {
    schemaVersion: report.schemaVersion,
    datasetVersion: report.datasetVersion,
    source: report.source,
    summary: report.summary,
  }),
])

process.stdout.write(`${JSON.stringify({ outputDirectory, ...report.summary }, null, 2)}\n`)
if (args.strict && (report.conflicts.length > 0 || report.unmatched.length > 0 || report.rejected.length > 0)) process.exitCode = 2

function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index]
    if (token === '--') continue
    if (token === '--help' || token === '-h') parsed.help = true
    else if (token === '--strict') parsed.strict = true
    else if (token.startsWith('--')) {
      const name = token.slice(2)
      const value = values[index + 1]
      if (!value || value.startsWith('--')) fail(`Option ${token} requires a value`)
      parsed[name] = value
      index += 1
    } else fail(`Unexpected argument: ${token}`)
  }
  return parsed
}

function resolveFormat(requested, filePath) {
  const format = requested ?? extname(filePath).slice(1).toLowerCase()
  if (!['csv', 'tsv', 'json'].includes(format)) fail(`Unsupported input format: ${format || '(missing)'}. Use --format csv|tsv|json.`)
  return format
}

function flattenAdministrativeHierarchy(level) {
  return level.flatMap((province) => {
    const provinceChildren = province.children ?? []
    const hasCityLayer = provinceChildren.some((child) => (child.children?.length ?? 0) > 0)
    const cities = hasCityLayer
      ? provinceChildren
      : [{ code: `${province.code.slice(0, 2)}0100`, name: province.name, children: provinceChildren }]
    return cities.flatMap((city) => (city.children ?? []).map((district) => ({
      code: district.code,
      name: district.name,
      provinceName: province.name,
      cityName: city.name,
    })))
  })
}

async function writeJsonExclusive(filePath, value) {
  try {
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (error && error.code === 'EEXIST') fail(`Refusing to overwrite existing output: ${filePath}`)
    throw error
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function usage() {
  return `Offline licensed coordinate importer

Usage:
  pnpm --filter @fengshui/geo-data import:coordinates -- \\
    --input /path/source.tsv --output /path/output-dir \\
    --dataset-version 2026.08.1 --source-id geonames-cn \\
    --source-label "GeoNames China export" --source-version 2026-08-30 \\
    --license "CC BY 4.0" --source-url https://download.geonames.org/export/dump/

Options:
  --format csv|tsv|json   Override format inferred from the input extension
  --license-url URL       License evidence URL
  --attribution TEXT      Attribution text required by the source
  --strict                Exit 2 after writing reports if any row is unresolved
  --help                  Show this help

The command never downloads data and refuses to overwrite existing report files.
`
}
