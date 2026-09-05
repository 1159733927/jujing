# Phase 1: BaZi Chart Foundation

## Goal

Build the chart product into a reproducible professional foundation before expanding interpretation. A generated report must point to an immutable chart version, and every chart can be recomputed from saved input, rules, location data and dependency versions.

## Non-negotiable Scope

- Solar and lunar calendar conversion, including leap lunar month input.
- Solar-term boundary tests around year and month pillars.
- Configurable day-boundary rule: midnight or Zi-hour start.
- Timezone and historical DST handling before true-solar correction.
- Birthplace selector backed by a versioned city geography database.
- Configurable start-of-luck profile.
- Four-pillar golden fixtures and WenZhen comparison reports.
- Chart export as PDF and image from a saved snapshot.
- Chart version history.
- Soft delete and restore.

## Current Status

| Area | Current state | Phase 1 target |
| --- | --- | --- |
| Calendar conversion | `lunar-typescript@1.8.6` conversion is wired and tested for round trips. `getLunarYearProfile` and `GET /v1/calendar/lunar-years/:year` expose the authoritative 1801–2100 month sequence; the Web picker renders leap months as independent choices and enforces each 29/30-day boundary. | Keep the locked dependency version in recomputation evidence and expand cross-version golden fixtures before any calendar-library upgrade. |
| Solar terms | Month/year pillars come from the calendar engine; a 24-term before/exact/after matrix covers 145 boundary assertions. | Keep WenZhen evidence separate from dependency-alignment tests. |
| Zi-hour boundary | `dayBoundary` supports `midnight` and `zi-hour-start`. | Expand fixtures and show the active rule in every export/report. |
| Timezone/DST | IANA timezone resolution and a complete 1986–1991 China transition matrix exist. `auto` rejects missing/repeated v3 wall times; `ignore` interprets input against the zone's fixed standard clock and records that standard offset. True-solar correction uses the standard meridian plus equation of time. New chart versions persist the actual Node Intl provider plus available TZDB, ICU, CLDR and Unicode version identifiers; old charts keep the field absent rather than being relabelled with the current runtime. | Expand v2/v3 external comparison evidence before considering any default migration. |
| Geography data | The national administrative tree is present through `province-city-china@8.5.8`. A dated GeoNames China snapshot is bundled after conservative crosswalk review: 2612/3311 districts have reviewed GeoNames coordinates, plus 2 explicit `manual-demo` fallbacks, for 2614 selectable districts and 697 unavailable districts. Persisted chart/report writes and the expert WenZhen capture form require `placeCode`; the server re-derives coordinates, timezone and dataset version. | Expand coverage only through reviewed, licensed records; expose attribution, hashes and unavailable counts; never imply coverage beyond accepted records. |
| Luck cycles | `luckMethod` supports the underlying engine's profiles. | Document selected school defaults and add gender/direction fixtures. |
| Flow cycles | `calculateBaziFlow` and authenticated `POST /v1/charts/:id/flow` return target-query luck, annual, solar-term monthly, daily and two-hour cycles from the exact persisted chart version without creating a new version. `/v1/bazi/flow` remains an unstored compatibility endpoint. | Add WenZhen-verified flow fixtures and richer UI state coverage. |
| WenZhen parity | Local golden fixtures exist; strict runtime validation, canonical append-only file/PostgreSQL storage, concurrent-write protection and machine-readable reports are implemented. Verified mismatches remain failed unless an administrator accepts every current difference with a reason; review identity and time are server-owned. The current corpus contains 6 real WenZhen screenshot-backed samples. They cover ordinary professional-table output, a LiChun boundary case, 23:00 Zi-hour day-boundary behavior, Urumqi with `dstPolicy: ignore` and far-west longitude, lunar leap fourth-month input, and publicly visible dynamic year/month output. The local diff command passes 6/6 for four pillars and the asserted professional fields. | Expand the real corpus to the full 31-case Stage 1 matrix; review any school-rule or display-time differences with real evidence. |
| Export | Saved charts support browser PNG and deterministic server-side PDF from an exact immutable chart version. Completed residential reports also use an authenticated server-side PDF endpoint, a shared allowlisted template, safe Markdown rendering, bounded Playwright Core rendering, blocked external requests, Chromium and Noto CJK in the container. | Keep real rendered-artifact checks in the release gate and add manual-four-pillar report export only after its missing civil-time provenance has a defined representation. |
| Versioning | Anonymous current chart, immutable versions and audited history restore-by-append exist; the chart UI separates form refill from one-click restore. | Keep PostgreSQL migration and conflict tests in the release gate. |
| Deletion | Soft delete and restore repository APIs exist. | Add product copy and hard-delete retention decision later. |
| Expert assessments | Four-pillar table details now include deterministic baseline ShenSha names with `shensha-baseline-v1-transparent-rules`. `schemaVersion: 2` rule profiles execute as data-only decision tables for strength, pattern and full school-specific shenSha. The engine records matched rule IDs, source version IDs, profile hashes and a facts hash; conflicts or missing matches fail closed. | Enter real expert-reviewed rule content and require double-review before production publishing. |

## Dependency Decisions

### Calendar and BaZi Engine

Keep `lunar-typescript` for Phase 1. It is already integrated, MIT licensed, has no runtime dependencies in our package, and covers the professional fields we need: solar/lunar, Gan-Zhi, BaZi, five elements, ten gods, NaYin, void branches and growth stages.

Do not migrate to `tyme4ts` during the current investor-demo hardening. `tyme4ts` looks like a stronger future candidate because it is newer and positioned as an upgrade, but migration would change core chart results. Treat it as a Phase 1.5 evaluation after WenZhen fixtures exist.

### Timezone Lookup

Use IANA timezone IDs as the persistent fact. For coordinate-to-timezone lookup, prefer `@photostructure/tz-lookup` for the frontend/API utility path because it is small and actively maintained. Keep `geo-tz` as the precision fallback if we need polygon-level certainty outside China or server-only processing.

### Administrative Divisions

Use `province-city-china` only for administrative hierarchy if we need a complete China province/city/district/town selector. It is MIT licensed and provides JSON/CSV/SQL files, but it does not provide coordinates. Coordinates must come from a separate licensed dataset or from a geocoding provider whose terms allow storage.

### Export

Use browser Canvas for PNG and the authenticated API for deterministic chart PDF. The API renders the requested immutable version with Playwright Core; deployment therefore installs a fixed Chromium package and Noto CJK fonts. Rendering is bounded, does not access the network, and fails explicitly when its runtime is unavailable.

## Geography Data Policy

The app must distinguish three facts:

1. Administrative code and name.
2. Latitude/longitude coordinate used for true-solar correction.
3. IANA timezone used for civil time and DST.

These fields must include dataset version metadata. A selector result must never be stored as free text only. If the user selects a district, the saved birth input should include province, city, district, administrative code if available, longitude, latitude, timezone and dataset version.

The current product package is labeled `licensed-partial`: it is suitable for an investor demo and reproducible testing, but not for claiming complete China coordinate coverage. The old hand-curated demo subset is retained only as explicitly marked `manual-demo` fallback records when no reviewed GeoNames record exists.

The coordinate source is the official GeoNames China dump (`CN.zip`) under CC BY 4.0. GeoNames administrative codes are not GB/T 2260 codes, so raw rows pass a conservative crosswalk against the local six-digit administrative tree before bundling. Only Chinese administrative features with an unambiguous, hierarchy-consistent match may be emitted. Wrong-country rows, populated places, invalid coordinates, duplicate-coordinate disagreements, name ambiguity and parent-context mismatches remain in review reports instead of receiving a guessed coordinate. Every accepted snapshot retains the download date, input SHA-256, source URL, license URL and attribution text. Hong Kong and Macao coverage remains an explicit product-policy decision and is not silently inferred from the `CN` country package.

## WenZhen Comparison Strategy

WenZhen should be treated as a manual reference source, not a runtime dependency.

- Create fixture cases by entering birth date, birth time, gender, location, calendar mode and true-solar settings in WenZhen.
- Record WenZhen output fields: four pillars, hidden stems, branch ten-gods, ten gods, NaYin, void branches, growth stages, self-sitting, major luck cycles and selected current annual/monthly/daily/hourly cycles.
- Store each fixture with the exact WenZhen URL, capture date, input settings and screenshot or note reference.
- Use the expert admin console to preview a captured sample, then explicitly save it only after evidence is attached and a human confirms that the visible WenZhen result was transcribed. Screenshots go through `POST /v1/bazi/wenzhen/evidence`, which validates image signatures and stores immutable SHA-256 evidence under `.data/evidence/wenzhen/`. `POST /v1/bazi/compare` returns leaf paths such as `pillars[0]`; those paths are intentionally the same paths accepted by `POST /v1/bazi/wenzhen/fixtures`. When the captured expected fields include dynamic annual, monthly, daily or hourly cycles, the admin console must carry an explicit `flowQuery.targetDate`; `targetTime` is optional and no current-date fallback is allowed. For no-Chrome manual capture, set the flow target date/time, click the admin template insertion button, transcribe the WenZhen flow year/month/day/hour pillars into the generated stable-key rows, attach a cropped or redacted screenshot, then compare and save. The template's annual year, monthly `monthYear`/month, daily date and hourly slot must come from the server `flow.selection`, never from browser-side local date/time derivation. Empty or placeholder dynamic pillars are rejected before they can become fixture evidence. API fixture saves append to the schema-versioned fixture store and reject duplicate sample IDs. A mismatch remains failed by default; every newly accepted difference requires a non-empty reason and one of `dependency`, `school-rule`, `timezone-location`, or `display-rounding`. `bug` is never acceptable and must be fixed. `acceptedAt` and `acceptedBy` are supplied only by the server through the reviewer credential; legacy stored differences without a classification remain readable.
- Run `pnpm --filter @fengshui/bazi-engine verify:wenzhen -- --fixtures <fixture-directory> --output <new-output-directory> --evidence-root <private-screenshot-directory>` to validate repository fixtures, the detached `evidence-manifest.json`, and every referenced screenshot body's size, SHA-256 and MIME signature, then write immutable `wenzhen-difference-report-v2` reports as JSON. `--evidence-root` defaults to `.data/evidence/wenzhen`; a missing or altered body fails closed. `POST /v1/bazi/compare` remains an ad-hoc diagnostic endpoint and is not evidence ingestion.
- Classify mismatches as: dependency difference, school-rule difference, timezone/location difference, display/rounding difference, or bug. A bug is a fix ticket, not an accepted compatibility difference.

`passed` means only that every field present in the fixture's partial `expected` object matched or was explicitly accepted; it is not a full-page parity claim. Reports derive assertion coverage from the actual expected leaf paths and aggregate five categories: pillars, time correction, professional table, luck cycles, and dynamic cycles. The current six real samples cover these categories `6/5/5/1/1` respectively. `pnpm wenzhen:diff` is diagnostic; `pnpm wenzhen:gate` additionally requires the entire governed matrix, evidence/input bindings and scenario-required assertions to be complete.

No code should claim parity until all target fixture categories pass or have an accepted documented school-rule difference.

Current verified sample baseline:

- `wz-020-professional-table` covers solar `1992-08-21 12:03`, male, Zhejiang Hangzhou Xihu, true solar enabled, and validates visible WenZhen pillars, corrected true-solar minute display, professional pillar rows and major luck pillars/ages.
- `wz-021-lichun-boundary-before` covers the 2024 LiChun boundary before the cutover and validates that year/month pillars remain `癸卯`/`乙丑` with WenZhen's displayed true-solar time and Haidian coordinates.
- `wz-022-late-zi-day-boundary` covers a late-zi-hour case where `zi-hour-start` matches WenZhen and midnight day-boundary does not.
- `wz-023-urumqi-dst-ignore` covers far-west China longitude with true solar time and ignored DST, making the DST policy visible in the comparison corpus.
- `wz-024-lunar-leap-fourth-month` covers lunar leap fourth-month input and validates the corresponding WenZhen four pillars.

These fixtures intentionally do not assert WenZhen shen-sha labels, day-stem presentation labels, or exact luck-start wording until those fields have reviewed school-specific rules and comparison fields. The late-zi, Urumqi and leap-month samples also leave WenZhen's displayed corrected local minute out of the automated assertion where it differs by one minute from the current documented true-solar approximation; this is tracked as a display/algorithm difference, not patched with sample-specific constants.

The capture matrix now contains exactly 31 governed cases: the six evidence-backed fixtures above plus 25 `pending-capture` cases. Pending rows contain no `expected` output and no evidence reference; they become verified only after Chrome capture, private evidence ingestion and human transcription. Diff manifests and the API expose a `captureMatrix` readiness summary so partial fixture success is not mistaken for full parity.

Every label in a capture plan is also classified in the generated scenario requirement as one of: a machine assertion backed by an `expected` path, an input-bound fact covered by immutable birth/flow-query comparison, or a screenshot-only manual review item. A label that matches none of these categories produces an `unmapped-capture-label` governance failure, including while the case is still pending, so adding prose to `capture` can never silently expand the claimed verification scope.

## Acceptance Tests

- `packages/bazi-engine`: golden tests for conversion, solar terms, day-boundary, DST, luck cycles, professional matrix fields and WenZhen differences.
- `packages/geo-data`: dataset integrity, code lookup, search/pagination, metadata exposure.
- `apps/api`: chart create/update/list/delete/restore with immutable version IDs and conflict handling.
- `apps/web`: chart page can edit birth data via pickers, view current chart anytime, list history, restore deleted chart, export PDF/image.
- `apps/web`: flow panel can choose a target date/time, call the API, and highlight the selected luck cycle, year, month, day and two-hour slot.
- `fengshui-report-plugin`: report generation must reference the exact chart version and include rule versions.

The lunar-picker acceptance case uses 2023: the profile must report leap month 2, render both `二月` and `闰二月`, reject day 30 for the 29-day leap month, preserve the original birth record on cancel, and keep solar input usable if the profile endpoint fails.

## Rollout Order

1. Stabilize geography package and API contract.
2. Replace chart page free-text inputs with selector-backed saved values everywhere.
3. Promote pending golden tests into real tests.
4. Add WenZhen fixture ingestion and difference JSON output.
5. Add chart history and delete/restore UI.
6. Add export verification.
7. Evaluate `tyme4ts` migration only after fixture coverage is credible.
