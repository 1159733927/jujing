# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-09-01
- Primary product surfaces: investor-facing intake and report flow; persistent personal chart page; expert knowledge and rule console.
- Evidence reviewed: `README.md`, `apps/web/src/main.tsx`, `apps/web/src/styles.css`, `apps/admin/src/main.tsx`, `apps/admin/src/styles.css`, current API contracts and report provenance fields.
- Assumption: phase two uses admin-issued C-end accounts, no public registration and no first-login forced password reset; payments remain out of scope.

## Brand
- Personality: calm, modern, culturally literate, evidence-conscious, premium without mysticism theatre.
- Trust signals: explicit analysis stages, deterministic calculation labels, consent and retention copy, immutable source versions, citations, uncertainty language, visible failure recovery.
- Avoid: fortune-telling theatrics, cosmic visual clichés, unverifiable certainty, chat-product chrome, dense enterprise dashboards, ornamental motion.

## Product goals
- Goals: let an investor complete the workflow unaided; show why each conclusion exists; demonstrate that experts can govern knowledge without changing code; make slow model work understandable and recoverable.
- Non-goals: public registration, payment, video processing, automated expert training, deterministic medical/legal/financial/life predictions.
- Success signals: a first-time viewer can submit a valid case in under five minutes; a queued report can survive refresh/restart; every completed report exposes calculation, vision, rule and expert-source provenance; errors preserve input and offer a next action.

## Personas and jobs
- Primary personas: investor or product evaluator using a desktop presentation; invited home resident completing their own case; professional feng-shui reviewer curating approved material.
- User jobs: provide accurate birth and residence context; annotate several photos; understand progress; read and revisit a bounded cultural report; publish or archive expert evidence with traceable versions.
- Key contexts of use: desktop investor meeting, laptop expert review, mobile form completion with touch and camera-library uploads.

## Information architecture
- Primary navigation: product brand; “住宅分析”, “我的命盘” and “我的报告” as persistent first-level destinations; member switching lives in the top bar after login; expert console is a separate admin surface.
- Core routes/screens: `/` residence analysis; `/chart` persistent member chart; `/reports` historical reports scoped by current member or all members; `/admin/` separate admin console for expert materials, rules and issued user accounts.
- Content hierarchy: current task and next action first; the chart is an independent reusable personal record rather than a report appendix; report provenance and technical detail follow the report outcome.
- Report-page default: a three-step flow only — bind a birth chart, describe/upload residence evidence, generate/read the report. The top of the page shows these three user-facing steps as the primary orientation. Completed reports start with four human-readable evidence cards — 命盘依据、住宅照片、专家资料、规则命中 — before the generated prose. Task lookup, readiness diagnostics, technical calculation controls and provenance stay collapsed until explicitly needed.
- Chart-page tabs: primary `合盘`, `生辰`, `流盘`; utility `专业详情`, `参数`, `设置`. The default `生辰` view follows the information structure of professional Bazi chart apps such as Wenzhen: birth record on the left, a dense four-pillar matrix on the right, and a short deterministic digest underneath for day master, five elements, ten gods, branch relations, void branches and first luck cycle. `流盘` first shows the target moment as five current cards — 大运、流年、流月、流日、流时 — before exposing scrollable detail lists. `参数` contains calculation parameters and provenance; `设置` contains version history and engineering acceptance such as Wenzhen parity. This is a functional/information-architecture reference, not permission to copy proprietary visual assets, copy, icons, or brand styling.
- Admin navigation: `工作台`, `知识库`, `排盘规则`, `问真验收`; daily queues and next actions precede editor and audit detail.
- Engineering-only evidence: Wenzhen parity fixtures, assertion coverage, hashes, raw rule IDs, provider diagnostics and data-source licence detail must not appear on ordinary user surfaces by default.

## Design principles
- Make the evidence chain visible: user label → deterministic calculation → visual observation → versioned rule/source → bounded report.
- Progressive disclosure: keep the default path simple while allowing provenance, hashes and rule details to be inspected.
- Slow work needs state: queued, analysing, validating, completed and failed must be explicit rather than represented by a single spinner.
- Preserve user effort: network/model failures never clear entered fields or selected-photo annotations.
- Cultural interpretation is content, not authority: uncertainty and the entertainment/research boundary remain visible near the result.
- Tradeoffs: favour clarity and auditability over dense information; favour reliable native controls over custom interaction effects.

## Visual language
- Color: warm paper background, ink text, deep jade primary, muted jade surfaces, restrained bronze accent, vermilion only for risk/error.
- Typography: system serif for editorial titles and report headings; system sans-serif for controls, metadata and operational states.
- Spacing/layout rhythm: 4/8px base rhythm; 24–32px card padding; wide desktop grids; deliberate vertical separation between stages.
- Shape/radius/elevation: 8px controls, 14–18px panels, thin warm-grey borders, minimal shadow only for active/raised state.
- Motion: 120–200ms state transitions; no looping decoration; respect `prefers-reduced-motion`.
- Imagery/iconography: user-provided residence photography is the primary imagery; use simple semantic line/icons only where a label is insufficient.

## Components
- Existing components to reuse: editorial hero, numbered stage rail, form card, photo annotation fieldset, analysis chain, report chart, source list, admin asset card.
- New/changed components: persistent top-level navigation, compact three-step report composer, three-step report status cards, bound-chart summary, standalone four-pillar chart with primary `合盘/生辰/流盘` tabs and utility `专业详情/参数/设置` tabs, deterministic compatibility summary, chart provenance/correction disclosure, server-record removal action, stage-aware submission status shown only while active or failed, upload constraints/help, collapsed task-id recovery, collapsed generation-readiness diagnostics, report summary/provenance disclosure, admin work queue, filtered asset library, list-detail editor and inline operation feedback.
- Variants and states: default/hover/focus/disabled/busy/error/success for controls; empty/selected/uploading/uploaded/failed for media; disconnected/loading/empty/populated/error for admin library.
- Token/component ownership: CSS custom properties in each app own shared visual tokens for now; do not introduce a component framework in this phase.

## Accessibility
- Target standard: WCAG 2.2 AA for the Demo surfaces.
- Keyboard/focus behavior: visible `:focus-visible`; logical DOM/tab order; all upload, removal, disclosure and state actions keyboard reachable; focus moves to the first error or completed-report heading after submission.
- Contrast/readability: minimum AA text contrast; never use low-contrast metadata as the only explanation; report body target line length 60–75 characters.
- Screen-reader semantics: one `h1`; labelled controls and fieldsets; status changes through `role=status`/`aria-live`; errors through `role=alert`; decorative marks hidden.
- Reduced motion and sensory considerations: disable non-essential transition/animation under reduced motion; status never depends on motion or colour alone.

## Responsive behavior
- Supported breakpoints/devices: current Safari/Chrome/Edge; desktop ≥1024px, tablet 720–1023px, mobile 360–719px.
- Layout adaptations: two-column intake becomes one column; stage rail becomes horizontal scroll or compact list; photo metadata becomes stacked; report/provenance remains readable without horizontal scrolling; admin editor/library stacks.
- Touch/hover differences: minimum 44px touch targets for primary actions; do not hide required actions behind hover; native file picker remains the mobile upload entry.

## Interaction states
- Loading: show current stage, elapsed expectation and task identifier once created; prevent duplicate submissions while allowing cancellation of client polling.
- Empty: explain the minimum evidence set and give one clear upload/create action.
- Error: distinguish validation, upload, API, model timeout and report-validation failures; preserve form state; give retry or task lookup action when safe.
- Success: focus and scroll to report; show completed timestamp/task identifier and concise evidence counts before full prose.
- Disabled: pair disabled controls with a visible reason; busy actions retain stable width and label.
- Offline/slow network: requests use bounded timeouts/cancellation; uploads report the affected filename; polling backs off and ends with a recoverable task id.
- Persistent chart: once calculated, each member's server-backed chart remains available from “我的命盘” across report navigation and browser refresh after account login; the page identifies its immutable version and provides a clear removal action. Browser storage is display cache, not the source of truth.

## Disclosure policy
- Remove from report-page default UI: the disabled “信息规则：用户标注优先” control, permanent seven-stage rail, permanent component-readiness panel, standalone analysis-chain diagram and unimplemented feature promises.
- Collapse on the report page: task-id recovery, rule-profile selection, true-solar algorithm, daylight-saving policy, day-boundary method, luck-cycle method, coordinates and generation provenance.
- Move to `专业详情`: hidden stems, branch gods, Na Yin, void branches, growth stages, self-sitting, Shen Sha, stem/branch relations, strength and pattern.
- Move to `流盘`: luck cycles, annual, monthly, daily and hourly cycles plus target date/time controls.
- Move to `参数`: coordinates and dataset versions, time-correction method, day-boundary method, luck-cycle method, raw engine/version IDs and hashes. Move to `设置` or an engineering-only acceptance surface: Wenzhen fixture status, parity differences, licence detail, version restore and destructive chart actions.
- Admin lists show only type, title, source, tags, publication state, updated time and next action. Actor history, immutable IDs and hashes live in a collapsed audit section.

## Content voice
- Tone: precise, measured, respectful, plain Chinese; explain technical boundaries without engineering jargon where possible.
- Terminology: use “传统文化分析/参考”“可见事实”“程序排盘”“专家资料依据”; reserve “规则命中” for provenance detail.
- Microcopy rules: never promise accuracy or outcomes; never describe experts as “training the model” when they are publishing evidence/rules; state photo processing and deletion at consent and upload points; errors say what happened and what the user can do next.

## Implementation constraints
- Framework/styling system: React + Vite + handwritten CSS; Fastify API; no embedded Harness UI and no new UI framework in phase two.
- Design-token constraints: extend the existing ink/paper/jade/bronze palette via CSS custom properties; avoid duplicated arbitrary colours in new rules.
- Performance constraints: first UI renders without API credentials; large photos are validated before upload; no report-model call during static render; polling is cancellable and bounded.
- Compatibility constraints: API base path must be deployable behind same-origin `/api`; secrets and admin credentials must never enter the client build; local URLs may appear only as development defaults/config.
- Test/screenshot expectations: verify desktop and 390px mobile layouts; cover empty, validation error, upload failure, queued, timeout, completed and admin-auth failure states; build/typecheck green is necessary but not sufficient.

## Open questions
- [ ] Final investor-demo brand name and logo / product owner / affects naming and shareable assets, not implementation structure.
- [ ] PDF/export requirement / product owner / affects report pagination and typography; excluded until the HTML report flow is accepted.
- [ ] Target cloud/provider, domain and TLS ownership / product owner / required only for external deployment, not local production packaging.
- [ ] Production-grade account policy, password reset delivery and tenant isolation / product owner / required before external beta, not required for local investor demo.
