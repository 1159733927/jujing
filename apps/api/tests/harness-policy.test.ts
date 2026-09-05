import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  assertExactReportToolCatalog,
  parseToolCatalog,
  TOOL_CATALOG_MARKER,
} from './harness-tool-catalog-audit.js'

const patchPath = fileURLToPath(new URL('../../../harness.fengshui.patch.yml', import.meta.url))
const harnessSourcePath = fileURLToPath(new URL('../src/harness.ts', import.meta.url))

const DISABLED_PLUGIN_IDS = [
  'session-telemetry-otel',
  'session-log-deepseek',
  'session-title-llm',
  'plugin-package-inventory-deepseek',
  'code-runtime',
  'user-questions',
  'agent-instructions',
  'commands',
  'command-compact',
  'goal',
  'plan-mode',
  'tool-bash',
  'tool-pwsh',
  'tool-jobs',
  'tool-fs',
  'tool-fs-search',
  'subagent',
  'tool-subagent',
  'tool-workflow',
  'tool-todo',
  'tool-goal',
  'tool-ralph',
  'tool-str-replace-editor',
  'web',
  'tool-web',
] as const

describe('fengshui Harness security policy', () => {
  it('disables every general-purpose coding-agent capability in the report overlay', async () => {
    const policy = await readFile(patchPath, 'utf8')
    for (const id of DISABLED_PLUGIN_IDS) {
      const block = (`\n${policy}`).split('\n- id: ').find((entry) => entry.startsWith(`${id}\n`))
      expect(block, `missing policy block for ${id}`).toBeDefined()
      expect(block).toContain('  disabled: true')
    }
    expect(policy).toContain('includeDefaultRoots: false')
    expect(policy).toContain('watch: false')
    expect(policy).not.toContain('id: fengshui-knowledge-mcp')
    expect(policy).toContain('preselects published knowledge evidence before the task reaches Harness')
    expect(policy).toContain('Never search for additional evidence')
    expect(policy).toContain('id: tool-skill')
  })

  it('pins report runs to a private Harness home with telemetry disabled', async () => {
    const source = await readFile(harnessSourcePath, 'utf8')
    expect(source).toContain("DSH_HOME: harnessHome")
    expect(source).toContain("DSH_TELEMETRY_DISABLED: '1'")
    expect(source).toContain("DSH_TELEMETRY_MODE: 'DISABLED'")
    expect(source).toContain("bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app']")
  })

  it('allows only the report skill and rejects knowledge MCP from the runtime model-tool catalog', () => {
    const catalog = parseToolCatalog(`loader noise\n${TOOL_CATALOG_MARKER}["skill"]\n`)
    expect(catalog).toEqual(['skill'])
    expect(() => assertExactReportToolCatalog([
      ...catalog,
      'mcp__fengshui_knowledge__search_published_knowledge',
    ])).toThrow('Unexpected model-visible Harness tools')
    expect(() => assertExactReportToolCatalog([...catalog, 'bash'])).toThrow('Unexpected model-visible Harness tools')
    expect(() => parseToolCatalog('no catalog here')).toThrow('did not emit')
  })
})
