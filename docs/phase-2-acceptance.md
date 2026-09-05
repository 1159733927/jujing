# Phase 2 acceptance contract

This phase upgrades the single-machine investor Demo into a production-shaped,
recoverable demonstration. It does not authorize publishing to an external cloud
account; provider, domain, billing and credentials remain an explicit deployment
handoff.

## Product flow

- The user can calculate and revisit a standalone chart at `/chart` without
  uploading residence photos; the latest server-backed chart survives refresh
  on the same browser and can be removed without rewriting existing reports.
- The user can submit birth data, residence context and 1–12 annotated images.
- Image constraints are checked before upload and server validation remains the
  authority.
- The UI exposes upload, queued, analysing, validating, completed and failed
  states without clearing the form.
- Once the API returns a task identifier, timeout or refresh leaves enough
  information to retrieve the task again.
- A completed report shows the deterministic chart, vision evidence, matched
  rules, expert citations and the cultural-use notice.
- The expert console clearly separates disconnected, loading, empty, saving,
  published and failed states, and can filter the asset list.

## Persistence

- Production mode requires PostgreSQL and refuses to silently fall back to JSON.
- File persistence remains available only through an explicit `file` storage
  driver for local demos and isolated tests.
- Report and knowledge writes are atomic. Published knowledge snapshots remain
  immutable and retain their version identifier and content hash.
- Anonymous chart access uses an opaque HttpOnly browser credential whose hash,
  never the raw token, is stored by the server.
- Chart profiles use optimistic revisions and append immutable versions; every
  report records the exact chart version used to generate it.
- Concurrent expert writes do not lose assets or duplicate a published version.
- Reports remain retrievable after the API process restarts.
- Database schema changes are versioned migrations with a repeatable status and
  apply command.

## Runtime and deployment

- API configuration is validated before listening; secrets never enter a Vite
  client bundle or committed environment file.
- Liveness proves the process is running. Readiness proves required persistence
  is available.
- The production topology has same-origin `/api`, separate user/admin static
  entry points, a private PostgreSQL service and persistent upload/data volumes.
- The stack has documented build, start, stop, backup, upgrade and rollback
  procedures plus health checks.
- A local production smoke test is run when a Docker-compatible runtime is
  available; otherwise image/config validation is recorded as blocked rather
  than reported as passed.

## Safety and QA

- Missing consent, invalid birth data, invalid image type/size/count, bad admin
  credentials and unknown task identifiers fail with bounded responses.
- Model timeout, invalid model output and persistence failure become failed tasks
  without returning unvalidated report text.
- Prompt-injection-like text in user notes remains data, and the restricted
  Harness tool catalog remains exact.
- Browser requests check HTTP status, can be cancelled, and use bounded polling.
- Desktop and 390px mobile layouts cover empty, error, queued and success states
  with keyboard focus and live-region feedback.

## Out of scope

- Public multi-user authentication, tenancy and payment.
- Video ingestion and automated floor-plan reconstruction.
- External cloud provisioning, DNS or TLS changes before a provider and account
  are selected by the product owner.
- Medical, legal, financial or deterministic life-decision recommendations.
