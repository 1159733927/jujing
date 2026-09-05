import { fileURLToPath } from 'node:url'
import { buildApp } from './app.js'
import { assertRuntimeEnvironment } from './config.js'
import { createDefaultStores } from './storage/factory.js'

function loadLocalDevelopmentEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') return
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export function resolveListenOptions(env: NodeJS.ProcessEnv = process.env): { host: string; port: number } {
  const host = env.HOST?.trim() || '127.0.0.1'
  const portText = env.PORT?.trim() || '3001'
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535')
  return { host, port }
}

loadLocalDevelopmentEnvironment()
assertRuntimeEnvironment()
const stores = await createDefaultStores()
await buildApp(
  stores.reports,
  undefined,
  stores.knowledge,
  undefined,
  undefined,
  stores.charts,
  stores.ruleProfiles,
  stores.wenzhenFixtures,
  stores.wenzhenEvidence,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  stores.residences,
  stores.accounts,
).listen(resolveListenOptions())
