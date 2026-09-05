import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
export const TOOL_CATALOG_MARKER = 'FENGSHUI_MODEL_TOOL_CATALOG='
export const EXPECTED_REPORT_TOOLS = ['skill'] as const

export function parseToolCatalog(output: string): string[] {
  const line = output.split(/\r?\n/u).find(entry => entry.startsWith(TOOL_CATALOG_MARKER))
  if (line === undefined) throw new Error('Harness audit did not emit a model tool catalog')
  const value: unknown = JSON.parse(line.slice(TOOL_CATALOG_MARKER.length))
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('Harness audit emitted an invalid model tool catalog')
  }
  return [...new Set(value)].sort()
}

export function assertExactReportToolCatalog(actual: readonly string[]): void {
  const expected = [...EXPECTED_REPORT_TOOLS].sort()
  const normalized = [...actual].sort()
  if (normalized.length !== expected.length || normalized.some((tool, index) => tool !== expected[index])) {
    throw new Error(`Unexpected model-visible Harness tools: ${normalized.join(', ') || '(none)'}`)
  }
}

/** Load the real product composition and stop it immediately before any model request. */
export async function auditRealHarnessToolCatalog(): Promise<string[]> {
  const projectDirectory = fileURLToPath(new URL('../../../', import.meta.url))
  const harnessDirectory = join(projectDirectory, 'deepseek-harness')
  const auditDirectory = await mkdtemp(join(tmpdir(), 'fengshui-harness-audit-'))
  const harnessHome = join(auditDirectory, 'home')
  const pluginPath = join(auditDirectory, 'catalog-audit.mjs')
  const patchPath = join(auditDirectory, 'catalog-audit.patch.yml')
  const productPatchPath = join(projectDirectory, 'harness.fengshui.patch.yml')

  await writeFile(pluginPath, `
export const name = 'fengshui-model-tool-catalog-audit'
export const inject = ['agents', 'tools']
let emitted = false
export function apply(ctx) {
  ctx.on('agent/pre-step', async ({ agent }) => {
    if (!emitted) {
      emitted = true
      const names = ctx.tools.schemas(agent).map(schema => schema.name).sort()
      process.stderr.write(${JSON.stringify(TOOL_CATALOG_MARKER)} + JSON.stringify(names) + '\\n')
    }
    return { kind: 'reject' }
  })
}
`, { mode: 0o600 })
  await writeFile(patchPath, `- insert:\n    - id: fengshui-model-tool-catalog-audit\n      name: ./catalog-audit.mjs\n`, { mode: 0o600 })

  let combinedOutput = ''
  try {
    const result = await execFileAsync('pnpm', [
      'dsh', '--profile', 'headless',
      '--patch', productPatchPath,
      '--patch', patchPath,
      'audit model-visible tools without calling the model',
    ], {
      cwd: harnessDirectory,
      timeout: 30_000,
      maxBuffer: 2_000_000,
      env: {
        ...process.env,
        DSH_HOME: harnessHome,
        DSH_TELEMETRY_DISABLED: '1',
        DSH_TELEMETRY_MODE: 'DISABLED',
        FENGSHUI_PROJECT_ROOT: projectDirectory,
      },
    })
    combinedOutput = `${result.stdout}\n${result.stderr}`
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string }
    combinedOutput = `${failed.stdout ?? ''}\n${failed.stderr ?? ''}`
  }

  const catalog = parseToolCatalog(combinedOutput)
  assertExactReportToolCatalog(catalog)
  return catalog
}
