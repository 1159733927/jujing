import { ensureDemoBaziRuleProfile } from '../src/demo-rule-profile.js'
import { seedProfessionalKnowledge } from '../src/professional-knowledge.js'
import { createDefaultStores } from '../src/storage/factory.js'

const stores = await createDefaultStores(process.env)

try {
  const professional = await seedProfessionalKnowledge(
    stores.knowledge,
    'deployment-professional-editor',
    'deployment-professional-reviewer',
  )
  const baselineSource = (await stores.knowledge.search('扶抑 baseline-v1', 10))
    .find((version) => version.title === '程序方法档案 B1')
  const baziProfile = await ensureDemoBaziRuleProfile(
    stores.ruleProfiles,
    'deployment-rule-editor',
    'deployment-rule-reviewer',
    baselineSource?.versionId,
  )
  process.stdout.write(`${JSON.stringify({ professional, baziProfileId: baziProfile?.id ?? null })}\n`)
} finally {
  await Promise.all([
    stores.reports.close(),
    stores.charts.close(),
    stores.residences.close(),
    stores.knowledge.close(),
    stores.ruleProfiles.close(),
    stores.wenzhenFixtures.close(),
    stores.accounts.close(),
  ])
}
