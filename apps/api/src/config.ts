import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const productionSecrets = ['DEEPSEEK_API_KEY', 'ADMIN_API_TOKEN', 'KNOWLEDGE_MCP_TOKEN'] as const
const examplePlaceholders: Partial<Record<(typeof productionSecrets)[number], string>> = {
  DEEPSEEK_API_KEY: 'replace-with-your-deepseek-api-key',
  ADMIN_API_TOKEN: 'replace-with-a-long-random-admin-token',
  KNOWLEDGE_MCP_TOKEN: 'replace-with-a-long-random-internal-reader-token',
}

export function assertRuntimeEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return
  const missing = productionSecrets.filter((name) => !env[name]?.trim())
  if (missing.length) throw new Error(`production environment is missing required variables: ${missing.join(', ')}`)
  const placeholders = productionSecrets.filter((name) => env[name]?.trim() === examplePlaceholders[name])
  if (placeholders.length) throw new Error(`production environment still uses example placeholder values: ${placeholders.join(', ')}`)
}

export type ReportReadinessReason =
  | 'missing_deepseek_api_key'
  | 'missing_knowledge_mcp_token'
  | 'missing_harness_artifact'
  | 'knowledge_store_unavailable'
  | 'missing_published_expert_knowledge'
  | 'missing_published_rules'

export interface ReportReadinessCheck {
  readonly ready: boolean
  readonly reasons: readonly ReportReadinessReason[]
}

function projectRoot(env: NodeJS.ProcessEnv): string {
  const configured = env.FENGSHUI_PROJECT_ROOT?.trim()
  return configured ? resolve(configured) : fileURLToPath(new URL('../../../', import.meta.url))
}

function requiredReportArtifacts(root: string): readonly string[] {
  return [
    'deepseek-harness/package.json',
    'deepseek-harness/packages/bundle/base/cordis.patch.yml',
    'deepseek-harness/packages/bundle/headless/cordis.patch.yml',
    'harness.fengshui.patch.yml',
    'fengshui-report-plugin/lib/index.js',
    'fengshui-report-plugin/package.json',
    '.agents/skills/fengshui-report/SKILL.md',
    '.agents/skills/fengshui-reasoning/SKILL.md',
    'services/knowledge-mcp/lib/index.js',
  ].map((relative) => join(root, relative))
}

async function allRequiredArtifactsExist(paths: readonly string[]): Promise<boolean> {
  const results = await Promise.all(paths.map(async (path) => {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  }))
  return results.every(Boolean)
}

export async function checkReportReadiness(env: NodeJS.ProcessEnv = process.env): Promise<ReportReadinessCheck> {
  const reasons: ReportReadinessReason[] = []
  if (!env.DEEPSEEK_API_KEY?.trim()) reasons.push('missing_deepseek_api_key')
  if (env.NODE_ENV === 'production' && !env.KNOWLEDGE_MCP_TOKEN?.trim()) reasons.push('missing_knowledge_mcp_token')
  if (!await allRequiredArtifactsExist(requiredReportArtifacts(projectRoot(env)))) {
    reasons.push('missing_harness_artifact')
  }
  return { ready: reasons.length === 0, reasons }
}
