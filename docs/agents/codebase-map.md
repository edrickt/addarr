# addarr codebase map

Verified against `c8867d0` (2026-11-12). SvelteKit 5 + TypeScript app (Node 22.18+, adapter-node) that fronts Radarr/Sonarr for one household; production starts at `scripts/serve.mjs`, and the abstraction to learn first is the *arr adapters plus the normalized member-state pipeline in `src/lib/arr/`.

Maintenance: after adding, moving, or deleting a source file, update the File index and bump `Verified against` to the commit you checked.

## Orientation

- Two audiences: anonymous members browse, add, and watch Downloads; the admin signs in to configure presets, connections, and a curated operations console.
- Real production entry is `scripts/serve.mjs`: it imports `build/handler.js`, binds the LAN/host, runs mDNS, and exposes `globalThis.__addarr` for the LAN toggle and restart. Development runs `vite dev` instead; `build/` is not needed for it.
- Core abstraction: `ArrClient` (`src/lib/arr/client.ts:10`) is the only HTTP path to the arrs, holding the API key server-side. `RadarrClient` and `SonarrClient` add typed endpoints; nothing raw reaches a page.
- Raw *arr payloads are normalized to a member-facing vocabulary in `src/lib/arr/status.ts` (states) and `src/lib/arr/presentation.ts` (labels, tones, progress), so all surfaces speak the same state names.
- Storage is one SQLite file, `data/addarr.db`, created at runtime from the schema in `src/lib/server/db.ts`; `settings`, `services`, `presets`, `users`, `sessions`, `activity_log`.
- `src/lib/server/` is server-only (auth, DB, presets, admin gate, passthrough, client factory). `src/lib/arr/` is shared client/server code and must stay browser-safe.
- Generated, not source: `build/`, `.svelte-kit/`, `data/`. They are gitignored; never hand-edit.
- Domain docs: `GLOSSARY.md` for member vs admin vocabulary; `PLAN.md` §2-§7 for architecture and security decisions; `docs/adr/` for accepted decisions. Read only when the task changes vocabulary or semantics.

## Layers

| Layer | Path | Owns | Read when |
|---|---|---|---|
| Member UI | `src/routes/+page.svelte`, `src/routes/downloads/` | search, poster grid, Add, badge polling, downloads sheet | member-visible behavior |
| Admin UI | `src/routes/console/`, `src/routes/settings/`, `src/routes/presets/`, `src/routes/activity/` | curated console and configuration screens | admin-only screen change |
| HTTP API | `src/routes/api/`, `src/routes/arrapi/` | internal JSON endpoints, auth-gated read-only passthrough | endpoint or contract change |
| Arr adapters | `src/lib/arr/client.ts`, `src/lib/arr/radarr.ts`, `src/lib/arr/sonarr.ts` | API v3 calls, resource shapes, poster-card mapping | new arr call or field |
| Normalization (pure, tested) | `src/lib/arr/status.ts`, `src/lib/arr/downloads.ts`, `src/lib/arr/files.ts`, `src/lib/arr/presentation.ts`, `src/lib/arr/preset-input.ts`, `src/lib/arr/add-resource.ts`, `src/lib/arr/service-url.ts`, `src/lib/arr/types.ts` | member state vocabulary and pure transforms | state, download, preset, file, or add-payload behavior |
| Server core | `src/lib/server/auth.ts`, `src/lib/server/db.ts`, `src/lib/server/presets.ts`, `src/lib/server/admin-gating.ts`, `src/lib/server/passthrough.ts`, `src/lib/server/arr-factory.ts` | sessions, SQLite, presets, admin gate, allow-list, client factory | auth, storage, presets, or security change |
| Shared UI | `src/lib/components/`, `src/lib/actions/modal.ts` | dialogs, detail sheet, preset form, modal focus/inert handling | dialog or accessibility change |
| Runtime | `scripts/serve.mjs`, `scripts/service.mjs`, `scripts/icons.mjs`, `scripts/mock-arrs.mjs` | production entry, background service, icons, dev mocks | startup, LAN, or service change |

## Where things live

| Concern | Files |
|---|---|
| App shell, nav, role-aware tabs | `src/routes/+layout.svelte`, `src/routes/+layout.server.ts` |
| Every-request auth/admin gate | `src/hooks.server.ts:7`, `src/lib/server/admin-gating.ts:13` |
| Login, logout, first-run setup | `src/routes/api/auth/login/+server.ts`, `src/routes/api/auth/logout/+server.ts`, `src/routes/api/auth/setup/+server.ts`, `src/routes/login/+page.svelte`, `src/routes/setup/+page.svelte` |
| Sessions, PIN hashing, activity log writes | `src/lib/server/auth.ts:94` |
| SQLite schema and settings/services rows | `src/lib/server/db.ts:10` |
| Member search and poster cards | `src/routes/api/search/+server.ts`, `src/lib/arr/radarr.ts:142`, `src/lib/arr/sonarr.ts:128` |
| Add flow and Sonarr add payload | `src/routes/api/add/+server.ts`, `src/lib/arr/add-resource.ts:61` |
| Presets: rows, default, validation, UI | `src/lib/server/presets.ts:27`, `src/lib/arr/preset-input.ts:57`, `src/routes/api/presets/+server.ts`, `src/routes/presets/+page.svelte` |
| Service connections and URL validation | `src/routes/api/services/+server.ts`, `src/lib/arr/service-url.ts`, `src/routes/settings/+page.svelte` |
| Client factory (per-service clients) | `src/lib/server/arr-factory.ts:8` |
| Acquisition states and member labels | `src/lib/arr/status.ts:63`, `src/lib/arr/presentation.ts:9` |
| Status polling (single and batch) | `src/routes/api/status/[kind]/[id]/+server.ts`, `src/routes/api/status/batch/+server.ts` |
| Downloads queue grouping and page | `src/routes/api/downloads/+server.ts`, `src/lib/arr/downloads.ts:109`, `src/routes/downloads/+page.svelte` |
| On-disk file and episode detail | `src/lib/arr/files.ts:95`, `src/routes/api/files/[kind]/[id]/+server.ts`, `src/lib/components/DownloadSheet.svelte` |
| Admin console (curated verbs) | `src/routes/api/console/[...path]/+server.ts`, `src/routes/console/+page.svelte` |
| Read-only arr passthrough | `src/lib/server/passthrough.ts:13`, `src/routes/arrapi/[service]/[...path]/+server.ts` |
| Activity log read path | `src/routes/api/activity/+server.ts`, `src/routes/activity/+page.svelte` |
| LAN sharing and supervised restart | `src/routes/api/settings/lan/+server.ts`, `src/routes/api/restart/+server.ts`, `scripts/serve.mjs` |
| Background service, logs, uninstall | `scripts/service.mjs` |
| Dialogs, focus trap, background inerting | `src/lib/components/ConfirmDialog.svelte`, `src/lib/components/PresetForm.svelte`, `src/lib/actions/modal.ts` |

## Task recipes

**Add or change a member acquisition state.** Read `src/lib/arr/status.ts` (derivation and precedence), `src/lib/arr/presentation.ts` (label, tone, progress, detail line). Change those two, and `src/lib/arr/downloads.ts` when the state feeds the Downloads page. Test with `npm test`.

**Add a member or admin API endpoint.** Read a sibling under `src/routes/api/` and `src/hooks.server.ts:7` for the auth model. Create a route directory under `src/routes/api/` with a `+server.ts`; if admin-only, add its prefix to `src/lib/server/admin-gating.ts:13`. Test with `npm test` and `npm run check`.

**Change what "Add" means.** Read `src/lib/server/presets.ts` (preset row to `AddDefaults`), `src/lib/arr/add-resource.ts:61` (Sonarr payload contract), `src/routes/api/add/+server.ts`. Change `src/lib/arr/preset-input.ts` for input rules and the affected builder for payload. Test with `npm test`.

**Call a new Radarr/Sonarr endpoint.** Read `src/lib/arr/client.ts:10` (`raw`) and the adapter `src/lib/arr/radarr.ts` or `src/lib/arr/sonarr.ts`. Add a typed method to the adapter; keep normalization in `src/lib/arr/`, not in the route. Test with `npm test`; for manual work run `node scripts/mock-arrs.mjs`.

**Change the Downloads page.** Read `src/lib/arr/downloads.ts:109` (grouping and aggregation), `src/routes/api/downloads/+server.ts` (payload), `src/routes/downloads/+page.svelte` (render and poll). Change grouping in the pure module, fetch shape in the route. Test with `npm test`.

**Change startup, bind address, or restart.** Read `scripts/serve.mjs` (production entry, LAN setting, mDNS, `globalThis.__addarr`) and `scripts/service.mjs` (per-OS supervision). Test with `npm run build` then `npm run start:foreground`.

**Change auth, pin, or sessions.** Read `src/lib/server/auth.ts:94`, `src/hooks.server.ts:7`, `src/routes/api/auth/login/+server.ts`. Update `auth.ts` and keep `src/lib/server/auth.test.ts` (temp DB) green. Test with `npm test`.

## Tests

- Colocated `*.test.ts`: 9 under `src/lib/arr/`, 3 under `src/lib/server/`, 1 under `src/lib/actions/`. 84 tests, all headless, about one second total.
- All suites: `npm test`. One suite: `node --test src/lib/arr/status.test.ts`. One test: `node --test --test-name-pattern "AUD-06" src/lib/arr/preset-input.test.ts`.
- Coverage by area: adapter poster-card mapping (`src/lib/arr/poster-cards.test.ts`, network-free fakes), Sonarr add payload, status and queue aggregation, downloads grouping, file normalization, member labels/progress, preset validation, service URL validation, admin gate, passthrough allow-list, auth and sessions, modal inert behavior.
- No golden or fixture directories; each test builds inline fixtures, and HTTP is mocked with local servers in `src/lib/arr/client.test.ts`.
- `npm run check` is the authoritative typecheck (svelte-check, 0 errors/warnings at `c8867d0`).

## Don't read

- `node_modules/`, `.svelte-kit/`, `build/`: installed dependencies, generated SvelteKit files, adapter-node output.
- `data/`: runtime SQLite database and logs.
- `.scratch/`: local issue tracker and prior audit working files (see `docs/agents/issue-tracker.md`).
- `docs/addarr_demo.gif`: binary demo asset.
- `PLAN.md`, `PRODUCT.md`: long planning and positioning docs; read targeted sections, not whole files.
- `docs/audits/`, `docs/plans/`: dated audit reports and plans, history rather than current behavior.
- `package-lock.json`: generated lockfile.

## Gotchas

- `src/lib/server/` is server-only. Importing it from `+page.svelte` or any browser module fails the build. API keys must stay there; `src/lib/arr/` must stay browser-safe.
- Admin gating is split: prefixes in `src/lib/server/admin-gating.ts:13` and redirect/401/403 logic in `src/hooks.server.ts:7`. A new admin page or API without a prefix is publicly reachable.
- `src/lib/arr/poster-cards.test.ts` has no matching `poster-cards.ts`. The code under test is `toPosterCards()` on each adapter.
- Tests import source with explicit `.ts` extensions because `node --test` runs TypeScript directly on Node 22.18+; follow that in new tests.
- `scripts/serve.mjs` imports `build/handler.js` (adapter-node output), so run `npm run build` before `npm run start:foreground` or `npm run serve`.
- The README calls `npm test` "arr resource tests", but the suite also covers server auth, gating, and passthrough.
- The DB path honors `ADDARR_DB` (default `data/addarr.db`); tests point it at a temp directory and must never touch the real file.
- There is no `CONTEXT.md`; `GLOSSARY.md` is the only root domain-vocabulary doc.

## File index

### src/routes/

`src/routes/+page.svelte` — member search, poster grid, add action, status polling, download sheet.
`src/routes/+layout.svelte` — app shell, nav tabs, admin-only tabs, logout.
`src/routes/+layout.server.ts` — exposes `locals.user` to the layout.
`src/routes/login/+page.svelte` — admin sign-in form.
`src/routes/login/+page.server.ts` — login page load data.
`src/routes/setup/+page.svelte` — first-run admin account creation.
`src/routes/downloads/+page.svelte` — member Downloads list and detail sheet.
`src/routes/console/+page.svelte` — admin operations console tabs and destructive actions.
`src/routes/settings/+page.svelte` — connections, LAN sharing toggle, server restart.
`src/routes/presets/+page.svelte` — preset CRUD list and editor.
`src/routes/activity/+page.svelte` — paginated admin activity log.

### src/routes/api/ and src/routes/arrapi/

`src/routes/api/search/+server.ts` — member search, trimmed poster cards.
`src/routes/api/add/+server.ts` — member add through the default preset, deduped and logged.
`src/routes/api/status/[kind]/[id]/+server.ts` — single-item acquisition state.
`src/routes/api/status/batch/+server.ts` — batched state poll, one queue fetch per arr.
`src/routes/api/downloads/+server.ts` — title-grouped active queue for the Downloads page.
`src/routes/api/files/[kind]/[id]/+server.ts` — member-safe on-disk file metadata.
`src/routes/api/presets/+server.ts` — admin preset CRUD plus live arr dropdown options.
`src/routes/api/services/+server.ts` — admin connection get/save, triggers default preset.
`src/routes/api/activity/+server.ts` — admin activity log page data.
`src/routes/api/console/[...path]/+server.ts` — curated admin operations (library, queue, history, exclusions, blocklist, calendar, episodes, summary).
`src/routes/api/auth/login/+server.ts`, `src/routes/api/auth/logout/+server.ts`, `src/routes/api/auth/setup/+server.ts` — session and first-run endpoints.
`src/routes/api/settings/lan/+server.ts` — LAN sharing state and toggle.
`src/routes/api/restart/+server.ts` — supervised/launcher restart request.
`src/routes/arrapi/[service]/[...path]/+server.ts` — read-only allow-listed arr passthrough.

### src/lib/arr/

`src/lib/arr/client.ts` — base v3 HTTP client, timeouts, redacted key serialization.
`src/lib/arr/radarr.ts` — Radarr adapter, lookups, library/queue, poster cards.
`src/lib/arr/sonarr.ts` — Sonarr adapter, lookups, library/queue, poster cards.
`src/lib/arr/add-resource.ts` — pure Sonarr `POST /series` payload builder.
`src/lib/arr/status.ts` — queue aggregation and movie/series state normalization.
`src/lib/arr/downloads.ts` — queue records to title-grouped Downloads items.
`src/lib/arr/files.ts` — member-safe file and episode normalization.
`src/lib/arr/presentation.ts` — member labels, tones, progress bars, formatting.
`src/lib/arr/preset-input.ts` — preset shape and targeting validation, repair plan.
`src/lib/arr/service-url.ts` — service base URL validation and normalization.
`src/lib/arr/types.ts` — shared types, `ArrError`, poster URL helper.

### src/lib/server/

`src/lib/server/db.ts` — SQLite open, schema, settings and services helpers.
`src/lib/server/auth.ts` — PIN hashing, sessions, activity log.
`src/lib/server/admin-gating.ts` — admin prefixes and decoded-path matching.
`src/lib/server/arr-factory.ts` — configured client factory.
`src/lib/server/presets.ts` — preset rows, defaults, default-preset repair.
`src/lib/server/passthrough.ts` — passthrough allow-list and path normalization.

### src/lib/components/, src/lib/actions/, src/

`src/lib/components/DownloadSheet.svelte` — download and file detail dialog.
`src/lib/components/ConfirmDialog.svelte` — typed-confirmation dialog for destructive actions.
`src/lib/components/PresetForm.svelte` — preset editor form with arr dropdowns.
`src/lib/actions/modal.ts` — focus trap, scroll lock, background inerting.
`src/hooks.server.ts` — session resolution and admin gate.
`src/app.css` — Precision theme tokens and base styles.
`src/app.html` — HTML shell.
`src/app.d.ts` — `App.Locals` typing.

### scripts/

`scripts/serve.mjs` — production server entry, LAN bind, mDNS, restart surface.
`scripts/service.mjs` — install/start/stop/restart/status/logs/open/uninstall background service.
`scripts/mock-arrs.mjs` — dev mock Radarr/Sonarr with POST seeding endpoints.
`scripts/icons.mjs` — PNG/ICO/ICNS icon generation.
