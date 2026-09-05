import { assertWenzhenStage1Ready, formatWenzhenManifestSummary, generateWenzhenFixtureReports } from '../src/wenzhen-fixtures.js'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

function readOption(name: '--fixtures' | '--output' | '--evidence-root'): string | undefined {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

const flags = process.argv.slice(2).filter((value) => value.startsWith('--') && value !== '--')
const requireStage1Ready = process.argv.includes('--require-stage1-ready')
const unknown = flags.filter((value) => value !== '--fixtures' && value !== '--output' && value !== '--evidence-root' && value !== '--require-stage1-ready')
if (unknown.length) throw new Error(`unknown option(s): ${unknown.join(', ')}`)

const inputDirectory = readOption('--fixtures')
const outputDirectory = readOption('--output')
const evidenceDirectory = readOption('--evidence-root')
if ((inputDirectory && !outputDirectory) || (!inputDirectory && outputDirectory)) {
  throw new Error('usage: pnpm verify:wenzhen -- --fixtures <directory> --output <new-directory> [--evidence-root <directory>]')
}

const invocationDirectory = process.env.INIT_CWD ?? process.cwd()
const now = new Date()
const timestamp = [
  String(now.getUTCFullYear()),
  String(now.getUTCMonth() + 1).padStart(2, '0'),
  String(now.getUTCDate()).padStart(2, '0'),
  '-',
  String(now.getUTCHours()).padStart(2, '0'),
  String(now.getUTCMinutes()).padStart(2, '0'),
  String(now.getUTCSeconds()).padStart(2, '0'),
].join('')
const runId = `${timestamp}-${process.pid}-${randomUUID().slice(0, 8)}`
const manifest = await generateWenzhenFixtureReports({
  inputDirectory: resolve(invocationDirectory, inputDirectory ?? 'packages/bazi-engine/tests/fixtures/wenzhen'),
  outputDirectory: resolve(invocationDirectory, outputDirectory ?? `output/wenzhen-diffs/run-verify-${runId}`),
  evidenceDirectory: resolve(invocationDirectory, evidenceDirectory ?? '.data/evidence/wenzhen'),
})
console.log(formatWenzhenManifestSummary(manifest))
if (requireStage1Ready) assertWenzhenStage1Ready(manifest)
else if (manifest.totals.failed > 0) process.exitCode = 1
