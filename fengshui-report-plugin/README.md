# Feng Shui Report plugin

This out-of-tree DeepSeek Harness bundle owns the workflow boundary for the
investor-demo product. It deliberately keeps natal-chart computation,
vision extraction, traditional-rule evaluation, and report narration separate.

## Product-owned stages

- `packages/bazi-engine`: deterministic Beijing-time and true-solar-time chart calculation.
- `apps/api/src/vision.ts`: image evidence extraction behind a replaceable provider interface.
- `apps/api/src/knowledge.ts`: versioned expert knowledge and rule retrieval.
- `apps/api/src/harness.ts`: DeepSeek Harness report narration.

The plugin validates the stable workflow envelope and exposes it as a Cordis
service. The API owns explicit photo consent and sends private images only to
the configured DeepSeek vision adapter.

Before Harness starts, the API selects the published knowledge evidence and
persists the exact citations on the report record. On every Agent publication,
this plugin therefore restricts the model-visible tool catalog to `skill`
only, installs a monotonic execution guard for that allowlist, and asserts the
exact resolved schemas. The narration agent cannot call a knowledge MCP, browse
or use files to expand or replace the persisted citation set. A missing or
additional tool, including a read-only knowledge connector, vetoes Agent
publication.
