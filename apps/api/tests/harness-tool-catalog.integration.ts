import { auditRealHarnessToolCatalog } from './harness-tool-catalog-audit.js'

const catalog = await auditRealHarnessToolCatalog()
process.stdout.write(`Verified model-visible Harness tools: ${catalog.join(', ')}\n`)
