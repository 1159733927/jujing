import { ensureDemoBaziRuleProfile } from '../src/demo-rule-profile.js'
import { demoKnowledgeAssets } from '../src/demo-knowledge.js'
import { seedProfessionalKnowledge } from '../src/professional-knowledge.js'
import { createDefaultStores } from '../src/storage/factory.js'

const stores = await createDefaultStores(process.env)

try {
  const baselineInput = demoKnowledgeAssets.find((asset) => asset.title === '程序方法档案 B1')
  if (!baselineInput) throw new Error('baseline knowledge definition is missing')
  let baselineSource = (await stores.knowledge.search('扶抑 baseline-v1', 10))
    .find((version) => version.title === baselineInput.title)
  if (!baselineSource) {
    const draft = await stores.knowledge.create(baselineInput, 'deployment-baseline-editor')
    await stores.knowledge.setState(draft.id, 'in-review', 'deployment-baseline-editor')
    const published = await stores.knowledge.setState(draft.id, 'published', 'deployment-baseline-reviewer')
    baselineSource = published?.currentPublishedVersionId
      ? await stores.knowledge.getVersion(published.currentPublishedVersionId)
      : undefined
  }
  if (!baselineSource) throw new Error('baseline knowledge could not be published')
  const professional = await seedProfessionalKnowledge(
    stores.knowledge,
    'deployment-professional-editor',
    'deployment-professional-reviewer',
  )
  const baziProfile = await ensureDemoBaziRuleProfile(
    stores.ruleProfiles,
    'deployment-rule-editor',
    'deployment-rule-reviewer',
    baselineSource.versionId,
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
