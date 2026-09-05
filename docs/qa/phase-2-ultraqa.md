# UltraQA Report — Phase 2

## Goal and success criteria
- Goal: verify the production-shaped investor Demo across user, admin, storage,
  deployment and constrained-Harness boundaries.
- Stop condition: every scenario below is classified with evidence; blocking
  failures are fixed and rerun or explicitly reported as external blockers.
- Safety bounds: local workspace and local services only; no cloud, DNS, billing,
  production database or external-account mutations.
- Target environment: macOS local development plus Docker Compose when a
  compatible container runtime is available.
- Parameter sheet: file storage for deterministic UI/API tests; PostgreSQL for
  storage integration and production topology; injected vision/report generator
  for most cases; one bounded real Harness catalog test without a model call.
- Routine matrix coverage: custom local product matrix, not a daily/runtime
  messaging matrix.

## Scenario matrix

| ID | Scope | Scenario | Command/harness | Expected signal | Actual result | Status | Evidence | Cleanup |
|----|-------|----------|-----------------|-----------------|---------------|--------|----------|---------|
| API-01 | API | liveness and readiness | API inject/curl | live process; ready store | live dev API returned healthy and ready after restart | PASS | `curl /health` → `ok`; `curl /ready` → `ready` | dev server remains running |
| API-02 | API | invalid consent/birth/media/admin token | Vitest | bounded 4xx; no model call | bounded validation/auth suites passed, including standalone chart and missing uploaded media | PASS | `pnpm --filter @fengshui/api test` → 9 files, 55 tests passed | temp dirs |
| JOB-01 | storage | queued report recovers after restart | storage/API test | task completes or fails after restart | queued recovery suite passed with injected generator | PASS | `apps/api/tests/storage.test.ts` in API test run | temp dirs |
| DB-01 | storage | published versions are immutable under concurrent writes | storage test | one stable asset/version snapshot | parameterized writes and unique published-version schema verified; live concurrent PostgreSQL run blocked by missing Docker/Postgres runtime | PARTIAL | API storage tests and `apps/api/migrations/001_initial_storage.sql` | temp DB/schema |
| DB-02 | storage | production refuses missing PostgreSQL config | config test | startup fails before listen | config test passed | PASS | `resolveStorageConfig({ NODE_ENV: 'production' })` throws without `DATABASE_URL` | env restore |
| DB-03 | chart storage | anonymous chart is owned, versioned and report-bound | API/storage tests | opaque credential; immutable append; stale revision rejected; exact report reference | file-store and API paths passed, including stale report-version rejection; PG SQL/transaction semantics passed against fake pool, live PG unavailable | PARTIAL | chart API/storage tests; `002_chart_profiles.sql`; 55-test API run | temp dirs |
| MCP-01 | Knowledge MCP | service reads only published knowledge through production bridge | MCP test | validated, bounded read-only result | API success, auth header, result-limit propagation, HTTP failure, timeout, missing config and file-demo cases passed | PASS | `node --test services/knowledge-mcp/tests/*.test.mjs` → 6 passed | mock server |
| VIS-01 | model adapter | DeepSeek vision URL and bounded fan-out | Vitest | standard chat-completions URL; at most three concurrent calls | endpoint and peak concurrency regression tests passed | PASS | `apps/api/tests/vision.test.ts` in API test run | temp images |
| HAR-01 | Harness | exact model-visible tool catalog | existing integration | only product Skill; knowledge is API-prefetched evidence | exact tool catalog verified before model call | PASS | `pnpm --filter @fengshui/api exec tsx tests/harness-tool-catalog.integration.ts` | isolated Harness home |
| HAR-02 | Harness | injection-shaped note remains data | prompt/policy tests | no expanded capabilities/instructions | prompt/policy suites passed | PASS | API test run includes harness policy/prompt suites | none |
| UI-01 | user UI | empty, validation, upload failure, queued, completed | browser/static inspection | preserved input and announced state | production build contains nonblank fallback and React app; runtime browser interaction still manual | PARTIAL | `pnpm build`; built `apps/web/dist/index.html` contains visible fallback and assets | revoke object URLs |
| UI-02 | user UI | 390px and keyboard flow | in-app browser | no horizontal overflow; visible focus | 390px viewport had `scrollWidth=390`, all primary controls were present, and missing-photo error was announced | PASS | browser DOM/viewport inspection on `http://127.0.0.1:4173/` | viewport reset |
| UI-03 | chart UI | independent server-backed chart route and refresh recovery | in-app browser | `/chart` works without photos; server version survives reload under anonymous credential | reloaded the live route and recovered version 1 plus all four pillars from the server-backed profile | PASS | browser DOM inspection on `http://127.0.0.1:4173/chart`; API ownership/version/delete tests | deliverable tab retained |
| ADM-01 | admin UI | disconnected, bad token, empty, save, publish, filter | browser/API | explicit state and recoverable error | disconnected and invalid-token states verified; save/publish with a real admin token remains unexecuted | PARTIAL | browser DOM inspection on `http://127.0.0.1:4174/`; API auth suite | no persistent asset created |
| DEP-01 | deployment | compose config and health dependency graph | compose config | valid services/secrets/health checks | deployment files added; Docker CLI unavailable so Compose parse is blocked | BLOCKED_RUNTIME | `docker compose config` → `zsh:1: command not found: docker` | none |
| DEP-02 | deployment | local production smoke | compose up/curl | user/admin/API/DB healthy | blocked by missing Docker runtime | BLOCKED_RUNTIME | `docker --version` and `docker compose config` both missing | none |

## Commands run

- `[0] pnpm typecheck` - workspace TypeScript checks passed.
- `[0] pnpm build` - user app, admin app, API, BaZi, knowledge MCP and Harness plugin builds passed.
- `[0] pnpm test` - API 9 files/55 tests, BaZi 1 file/16 tests and knowledge MCP 6 tests passed.
- `[0] node --test services/knowledge-mcp/tests/*.test.mjs` - 6 MCP data-source tests passed.
- `[0] pnpm --filter @fengshui/bazi-engine test` - 1 file and 16 tests passed.
- `[0] pnpm --filter @fengshui/api exec tsx tests/harness-tool-catalog.integration.ts` - model-visible tools verified as `skill`.
- `[127] docker compose config` - Docker CLI is not installed on this host.
- `[0] curl http://127.0.0.1:3001/health` - live dev API returned `{"status":"ok","service":"fengshui-api"}` after restart.
- `[0] curl http://127.0.0.1:3001/ready` - live dev API returned `{"status":"ready","service":"fengshui-api"}` after restart.
- `[0] curl http://127.0.0.1:4173/` - user Demo returned nonblank Vite HTML.
- `[0] curl http://127.0.0.1:4174/admin/` - expert console returned nonblank Vite HTML.
- `[0] in-app browser 390px inspection` - user page had no horizontal overflow and exposed the missing-photo error through `role=alert`.
- `[0] in-app browser admin inspection` - disconnected and invalid-token states rendered with explicit status/error feedback.
- `[0] in-app browser chart inspection` - standalone chart generated without photos, survived reload, and had `scrollWidth=390` at a 390px viewport.

## Failures found

- `DEP-01` and `DEP-02`: blocked by missing Docker runtime, not by Compose design evidence.
- Code review found an incorrect `/beta/chat/completions` vision endpoint, missing
  knowledge-limit propagation, missing report media preflight and unbounded
  per-report vision fan-out. All four were fixed and regression-tested.
- Direct local `curl` health checks initially failed because dev processes were
  stopped; after restarting the API, web and admin dev servers, health, readiness
  and nonblank HTML checks passed.

## Fixes applied

- Added Docker Compose single-VM deployment packaging with private PostgreSQL,
  same-origin nginx routing, named data volumes, runtime-only secrets and the
  internal `KNOWLEDGE_MCP_TOKEN` bridge.
- Added an opaque anonymous principal, server-backed chart profiles, immutable
  chart versions, optimistic revisions, soft deletion and exact report-version
  references for both file and PostgreSQL storage drivers.
- Added `/admin/` production base for the expert console.
- Added deployment scripts and documentation covering configuration, health,
  logs, backup, upgrade, rollback and safe stop.
- Corrected DeepSeek vision requests to the configured base URL's standard
  `/chat/completions` endpoint, capped per-report vision concurrency at three,
  rejected missing upload IDs before queueing, and propagated knowledge limits.

## Cleanup and rollback

- Test data must use temporary directories, schemas or explicitly named compose
  volumes. User `.data` and `.env` are never deleted.

## Residual risks

- External cloud deployment remains blocked until provider, domain and account
  authority are selected.
- Local PostgreSQL/container integration may be blocked if the host has no
  compatible runtime; that case must remain BLOCKED rather than inferred PASS.
- Anonymous chart recovery is browser-credential scoped until account claiming
  and user-directed hard-deletion/retention policy are implemented.

## Evidence

- This file is the durable state record because OMX runtime state is not required
  for this repository-local custom QA pass.
- Built static HTML for both user and admin surfaces contains visible fallback
  content and hashed JS/CSS assets; admin assets are correctly rooted at
  `/admin/assets/...`.
