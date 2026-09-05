# Knowledge MCP

Read-only stdio MCP service for published expert knowledge. It exposes
`search_published_knowledge`, returns immutable version id, content hash,
source/version/exact-excerpt citations, and filters out every non-published
asset. DeepSeek Harness connects through
`harness.fengshui.patch.yml`.
