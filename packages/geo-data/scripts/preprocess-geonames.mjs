#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import process from 'node:process'

import { crosswalkGeoNamesChina } from '../src/geonames-crosswalk.ts'
import { writeJsonDirectoryAtomically } from './atomic-json-output.mjs'

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  process.stdout.write(usage())
  process.exit(0)
}

const required = ['cn', 'admin1', 'admin2', 'output', 'dump-date']
const missing = required.filter((name) => !args[name])
if (missing.length > 0) fail(`Missing required options: ${missing.map((name) => `--${name}`).join(', ')}\n\n${usage()}`)

const paths = {
  places: resolve(args.cn),
  admin1CodesAscii: resolve(args.admin1),
  admin2Codes: resolve(args.admin2),
}
const [places, admin1CodesAscii, admin2Codes] = await Promise.all([
  readFile(paths.places),
  readFile(paths.admin1CodesAscii),
  readFile(paths.admin2Codes),
])
const source = {
  dumpDate: args['dump-date'],
  sourceUrl: 'https://download.geonames.org/export/dump/',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: 'GeoNames',
  files: {
    places: sourceFile(paths.places, places),
    admin1CodesAscii: sourceFile(paths.admin1CodesAscii, admin1CodesAscii),
    admin2Codes: sourceFile(paths.admin2Codes, admin2Codes),
  },
}
const report = crosswalkGeoNamesChina({
  geoNamesText: places.toString('utf8'),
  admin1CodesAsciiText: admin1CodesAscii.toString('utf8'),
  admin2CodesText: admin2Codes.toString('utf8'),
  source,
})

const outputDirectory = resolve(args.output)
try {
  await writeJsonDirectoryAtomically(outputDirectory, [
    ['candidates.json', { source, records: report.records }],
    ['manifest.json', { source, summary: report.summary }],
    ['filtered.json', report.filtered],
    ['rejected.json', report.rejected],
    ['conflicts.json', report.conflicts],
    ['duplicates.json', report.duplicates],
  ])
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

process.stdout.write(`${JSON.stringify({ outputDirectory, ...report.summary }, null, 2)}\n`)
if (args.strict && (report.filtered.length > 0 || report.rejected.length > 0 || report.conflicts.length > 0)) process.exitCode = 2

function sourceFile(filePath, bytes) {
  return { fileName: basename(filePath), sha256: createHash('sha256').update(bytes).digest('hex') }
}

function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index]
    if (token === '--') continue
    if (token === '--help' || token === '-h') parsed.help = true
    else if (token === '--strict') parsed.strict = true
    else if (token.startsWith('--')) {
      const value = values[index + 1]
      if (!value || value.startsWith('--')) fail(`Option ${token} requires a value`)
      parsed[token.slice(2)] = value
      index += 1
    } else fail(`Unexpected argument: ${token}`)
  }
  return parsed
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function usage() {
  return `GeoNames China administrative crosswalk preprocessor

Usage:
  pnpm --filter @fengshui/geo-data preprocess:geonames -- \\
    --cn /path/CN.txt \\
    --admin1 /path/admin1CodesASCII.txt \\
    --admin2 /path/admin2Codes.txt \\
    --dump-date 2026-08-30 \\
    --output /path/crosswalk-output

Options:
  --strict   Exit 2 after writing reports if any row is filtered, rejected, or conflicted
  --help     Show this help

The command never downloads data and atomically publishes a new output directory; it refuses to replace an existing one.
`
}
