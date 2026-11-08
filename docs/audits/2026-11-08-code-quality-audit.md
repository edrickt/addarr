# Addarr Code Quality & Feature-Reliability Audit — 2026-11-08

- **Date:** 2026-11-08
- **Baseline commit:** `4a7eae4` (`docs: replace screenshots with demo GIF`) on `main`
- **Release-work note:** after this audit's fixes, the Team Lead bumped the project version to **1.0.1** in `package.json`, `package-lock.json` and `README.md`. Those three modified files are Lead release work, not audit changes (see §1/§9).
- **Mode:** audit **and** remediation (prior audit, 2026-10-22, was report-only)
- **Prior audit:** `.scratch/code-quality-audit/` (71 findings, fixed in v1.0.0 `2ea343c`); this report covers only **new or still-remaining** defects.
- **Findings in this report:** 14 fixed (1 Critical, 1 High, 5 Medium, 7 Low) + 10 deferred with rationale.
- **Report scope:** all implemented features — member search/add, acquisition status & polling, Downloads, presets/connections, admin console, auth/setup, activity, read-only passthrough, settings/LAN/restart, service lifecycle scripts, shared frontend/a11y, DB + arr client.
- **Finding IDs:** `AUD-NN` are scope-local to this report and do not continue the 2026-10-22 ID numbering.

## 1. Pre-existing working-tree state (preserved)

`git status` before and after this audit, unchanged by it:

```
 M package.json            (removes "private": true — pre-existing, untouched; version is 1.0.1 from Lead release work)
 M README.md               (Lead release work: 1.0.1 — not an audit change)
 M package-lock.json       (Lead release work: 1.0.1 — not an audit change)
?? .scratch/               (prior audit evidence/plans — untouched)
?? docs/adr/                (ADR 0001 — untouched)
?? docs/plans/              (2026-10-22 audit plan — untouched)
```

`data/addarr.db` SHA-256 before and after: `b8dcae173dcde760df7c08024fb1e0b64707964c05f609bd2b4a784f2088df6e` (unchanged; every runtime probe used a temp `ADDARR_DB` / `ADDARR_DATA_DIR`).
No git commit, push, tag, release, version edit, dependency change, or host service install/uninstall/start/stop was performed.

## 2. Method

1. Read `AGENTS.md`, `README.md`, `GLOSSARY.md`, `docs/adr/0001-downloads-whole-library-scope.md`, the 2026-10-22 audit report/plan and the Downloads spec, then every source file in `src/**` and `scripts/**`.
2. Static review at `file:line`, then verified each candidate at runtime where possible: a fresh build (`node scripts/serve.mjs`) run from an isolated temp dir with temp `ADDARR_DB`/`ADDARR_DATA_DIR`, `HOST=127.0.0.1`, unused port `45999`, repo mock arrs (`scripts/mock-arrs.mjs`) on `127.0.0.1:8787/8788`, curl probes with `--path-as-is` for encoded-path cases, and headless Firefox (`/Applications/Firefox.app`, isolated `-profile`) for browser-semantics claims. No real arr, no real data file, no host service command.
3. For each accepted finding: write a `node:test` regression test that fails pre-fix (verified by temporarily reverting the fix), then the minimal fix, then re-run all checks.
4. Full green gate at the end: `npm test`, `npm run check`, `npm run build`.

## 3. Findings summary

| ID | Severity | Confidence | Feature | Location | Fix | Regression test |
| --- | --- | --- | --- | --- | --- | --- |
| AUD-01 | **Critical** | high | Auth/gating | `src/hooks.server.ts:13-15` | gate on decoded pathname (`src/lib/server/admin-gating.ts`) | `admin-gating.test.ts` (5) |
| AUD-02 | **High** | high | Shared frontend/modal | `src/lib/actions/modal.ts:31-48` | inert background branches, never an ancestor of the dialog | `modal.test.ts` (4) + browser probe |
| AUD-03 | Medium | high | Passthrough | `src/routes/arrapi/[service]/[...path]/+server.ts:21-32` | normalize subpath before allow-list + forward normalized path (`passthrough.ts`) | `passthrough.test.ts` (6) |
| AUD-04 | Medium | high | Downloads/status | `src/lib/arr/downloads.ts:93-101` | use aired `episodeCount` denominator | `downloads.test.ts` (+3) |
| AUD-05 | Medium | high | Search status semantics | `src/lib/arr/radarr.ts:154-163`, `src/lib/arr/sonarr.ts:140-150` | no acquisition state for unmonitored items with no queue activity | `poster-cards.test.ts` (5) |
| AUD-06 | Medium | high | Presets | `src/routes/api/presets/+server.ts:45-52,81-100,159-175` | validate profile/folder/tag/availability against the live instance (`preset-input.ts`) | `preset-input.test.ts` (7) |
| AUD-07 | Medium | high | Presets/connections | `src/lib/server/presets.ts:99-140` | repair a default preset whose profile/folder no longer exists | `presetIsUsable` cases in `preset-input.test.ts` |
| AUD-08 | Low | high | Auth | `src/lib/server/auth.ts:62-71`, `api/auth/login:74-80` | reuse the precomputed `DUMMY_HASH` (single argon2 verify) | `auth.test.ts` |
| AUD-09 | Low | high | Auth/session hygiene | `src/lib/server/auth.ts:141-147` | compare ISO expiry against an ISO timestamp | `auth.test.ts` (DB-backed) |
| AUD-10 | Low | medium | Settings UI | `src/routes/settings/+page.svelte:153-180` | always re-read LAN state after a save attempt | none (Svelte component; no DOM harness) |
| AUD-11 | Low | high | Dev scripts | `scripts/mock-arrs.mjs:60,105` | bind mocks to `127.0.0.1` (host was misplaced in `createServer`) | none (script); verified with `lsof` |
| AUD-12 | Low | high | Connections validation | `src/routes/api/services/+server.ts:32-38` | reject non-HTTP(S)/query/hash base URLs (`service-url.ts`) | `service-url.test.ts` (5) |
| AUD-13 | Low | high | Console validation | `src/routes/api/console/[...path]/+server.ts:358-375` | reject non-positive-integer `ids` | none (route); runtime probe |
| AUD-14 | Low | high | Service lifecycle | `scripts/service.mjs:813-816,925-950` | verify stop/uninstall actually stopped; refuse root on `start` | none (must not execute host service commands) |

Deferred items are listed in §6.

## 4. Fixed findings (detail)

### AUD-01 — Critical: percent-encoded path bypassed every admin gate

- **Locations:** `src/hooks.server.ts:13-15` (pre-fix: `event.url.pathname` compared to `ADMIN_PREFIXES`), SvelteKit routes on the **decoded** pathname.
- **Impact:** an unauthenticated request to `/%61pi/services` (`a` = `%61`) resolved to the `/api/services` route while the gate saw `/%61pi/services` and skipped it. Verified live against the built app:
  - before admin existed: `GET /%61pi/services` → **200** `{"services":[]}` (normal `/api/services` → 503);
  - after first-run setup, with no cookie: `GET /%61pi/activity` → **200** with the activity log including the admin username; `/%61pi/settings/lan` → 200; `/%61rrapi/radarr/system/status` reached the proxy; `/%63onsole` and `/%73ettings` rendered admin pages without redirect.
  - The same class also allowed an unauthenticated **write**: `POST /%61pi/settings/lan {"enabled":true}` persisted `lan_enabled=1` in SQLite (observed via a subsequent read) before failing on the missing `locals.user`.
  - With a configured arr, the bypass reaches destructive console routes (library delete with a guessed typed title, queue removal, commands), preset CRUD, connection re-configuration, and the passthrough.
- **Fix:** new pure module `src/lib/server/admin-gating.ts`: `decodePathname()` (malformed input stays raw; SvelteKit 500s malformed URIs anyway) and `isAdminPath()` checks both the literal and decoded pathname against the admin prefixes. `hooks.server.ts` uses the decoded path for `isApi`, `needsAdmin`, `/setup` and `/login` handling.
- **Regression test:** `src/lib/server/admin-gating.test.ts` — encoded spellings (`/%61pi/services`, `/%61rrapi/...`, `/sett%69ngs`, `/%63onsole`, `/api/serv%69ces`) must require admin; plain member/auth paths must not; malformed percent sequences stay raw.
- **Post-fix runtime probe:** encoded admin paths now 503 pre-setup, 401 (API) / 302 to `/login` (pages) anonymous, 200 with an admin session — matching their plain spellings.

### AUD-02 — High: every modal dialog was inside the inert subtree and therefore unusable

- **Location:** `src/lib/actions/modal.ts:56-59` (pre-fix: `document.querySelector('.app').setAttribute('inert','')` plus `node.removeAttribute('inert')`).
- **Impact:** `inert` is inherited from ancestors; removing the attribute from the dialog does not escape an inert ancestor. Every dialog in the app (console edit/delete/episodes, preset delete, queue/exclusion/blocklist confirms, Downloads detail sheet) is rendered inside `<main>` inside `.app`, so its buttons/inputs became non-focusable and unclickable for all users on browsers with inert support (Chrome 102+, Safari 15.5+, Firefox 112+). Only Escape (a window listener) still closed them.
- **Evidence:**
  - Browser spec probe (headless Firefox, isolated profile) with `<div id="app" inert><div><button id="b">`: after `b.focus()` → `focusedBtn=false activeTag=BODY`, and the button matches `:is([inert] *):not([inert])`.
  - Post-fix algorithm probe on the same DOM shape: `dialogButtonFocused=true backgroundBlocked=true pageInert=true headerInert=true dialogInert=false overlayInert=false`.
- **Fix:** `markBackgroundInert(node, root)` walks from the dialog to `.app` and marks each ancestor's **siblings** inert (skipping `SCRIPT`/`STYLE` and already-inert nodes), leaving the dialog's own branch interactive; `destroy()` removes only the attributes it set. The action only does this when the dialog is actually inside `.app`.
- **Regression test:** `src/lib/actions/modal.test.ts` — dialog branch stays interactive while header/page branches go inert; pre-inert siblings are not claimed for restore; nested dialogs only inactivate the branches outside themselves; detached dialogs are a no-op.

### AUD-03 — Medium: read-only passthrough allow-list escaped via encoded backslash traversal

- **Location:** `src/routes/arrapi/[service]/[...path]/+server.ts:40-54` (pre-fix: regex matched the raw `params.path` and the raw path was forwarded).
- **Impact:** `GET /arrapi/radarr/queue%5C..%5Csystem%5Cbackup` matched `^/queue\b`, then WHATWG URL parsing converted `\` → `/` when the upstream URL was built and resolved `..`, proxying `/api/v3/system/backup`. Verified live: it returned the mock's **404 for `/system/backup`** (out-of-allow-list) instead of the 403 the same path returns directly. Read-only (write verbs still 405), but it lets an admin session read *any* GET endpoint — e.g. download-client/indexer configuration — breaking the documented "allow-listed read-only" contract. Chained with AUD-01 it was unauthenticated.
- **Fix:** new pure module `src/lib/server/passthrough.ts`: `normalizePassthroughPath()` converts `\`→`/`, drops `.`, resolves `..`, collapses empty segments; `resolvePassthroughPath()` matches the allow-list and the route forwards the **normalized** target, so the path that was checked is the path that is proxied.
- **Regression test:** `src/lib/server/passthrough.test.ts` — all 22 ordinary allowed paths pass unchanged; non-allowed reads rejected; forward-slash, backslash, mixed and encoded-dot traversals cannot escape; traversal landing on another allow-listed read endpoint stays allowed; normalization cases.
- **Post-fix runtime probe:** `%2E%2E%5C` and `..%5C` traversals → **403** `Endpoint not allowed: /system/backup` (previously proxied); plain allowed endpoints still 200.

### AUD-04 — Medium: Downloads series episode counts used unaired episodes as the denominator

- **Location:** `src/lib/arr/downloads.ts:93-101` (`seriesEpisodes` used `totalEpisodeCount`).
- **Impact:** a currently airing series that is caught up on aired episodes showed e.g. "10 of 20 episodes" in the Downloads row/detail sheet, contradicting `status.ts` (aired-aware, fixed by the prior audit as F-MEMBER-02) and ADR 0001 ("aired-aware missing"; caught-up series must not read as incomplete). Verified pre-fix: `buildDownloadItems` returned `{have:10,total:20}` for `{episodeFileCount:10, episodeCount:10, totalEpisodeCount:20}`, while `/api/status/series` returned `available`.
- **Fix:** prefer `statistics.episodeCount` (aired), fall back to `totalEpisodeCount` only when the arr omits it; nested queue media uses the same rule.
- **Regression test:** `src/lib/arr/downloads.test.ts` — aired denominator, fallback and nested-series case. **Correction (round 2):** 2 of the 3 fail against the pre-fix code (aired denominator and nested case); the fallback test guards the no-`episodeCount` payload path and passes both before and after.

### AUD-05 — Medium: unmonitored library titles presented as "Missing"

- **Locations:** `src/lib/arr/radarr.ts` and `src/lib/arr/sonarr.ts` `toPosterCards()` (pre-fix: `known ? movieStatus(known, rows) : undefined`).
- **Impact:** a title the admin deliberately unmonitored (arr not pursuing it) appeared in member search as `Missing` / `Unreleased` (and, per GLOSSARY, those are exactly the admin words members should not see). ADR 0001: "unmonitored items are excluded (the arr isn't pursuing them)". Verified live: search returned `{"title":"Unmonitored","status":{"state":"missing"}}`.
- **Fix (round 1, over-broad):** omitted the normalized state for any library item when `monitored === false` and no queue rows matched. **Round 2 correction:** that also hid truthful `available`/`partial` states and the "In library" detail sheet. The final rule suppresses only *false-pursuit* states — `missing`, `unreleased`, `partial` — for unmonitored items with no queue activity; `available` and any live queue state are kept (see §9).
- **Regression test:** `src/lib/arr/poster-cards.test.ts` — unmonitored missing/unreleased → no state; monitored missing/available unchanged; unmonitored-but-downloading keeps progress; round 2 adds unmonitored on-disk → `available` and unmonitored partial → no state (the `available` cases fail the round-1 code).

### AUD-06 — Medium: presets saved with ids/values that do not exist on the connected arr

- **Locations:** `src/routes/api/presets/+server.ts` (pre-fix only checked JSON shape).
- **Impact:** `PATCH /api/presets?service=radarr&id=1 {"qualityProfileId":999}` and `{"minimumAvailability":"bogus"}` both returned **200** and were stored (verified live). The member Add button then sends those values upstream — the library rejects the add and the whole household gets "Could not add — the library is not responding right now". A stale Presets page (profile/folder deleted in the arr between load and save) can do this through the UI, not only via the API. This is the "unusable profiles/folders/tags/availability" half of the prior audit's F-PRESET-03 that only received shape validation.
- **Fix:** new pure module `src/lib/arr/preset-input.ts`: `validatePresetInput()` keeps the existing shape rules, adds the Radarr `minimumAvailability` enum, and — when live options are supplied — rejects unknown quality-profile ids, root-folder paths and tag ids. `POST`/`PATCH` fetch the connected instance's options only when arr-side fields are in the payload, so a DB-only `{"isDefault":true}` PATCH still works while the arr is unreachable; an unreachable instance fails the save with a clear 502 instead of storing a broken preset.
- **Regression test:** `src/lib/arr/preset-input.test.ts` — unknown profile/folder/tag, invalid availability, valid payloads, unchanged shape errors, `presetInputNeedsLiveOptions`.
- **Post-fix runtime probe:** all four invalid payloads → **400** with specific messages; valid payload → 200; `isDefault`-only PATCH → 200 with the arr stopped.

### AUD-07 — Medium: reconnecting a service did not repair a default preset pointing at deleted arr objects

- **Location:** `src/lib/server/presets.ts:99-140` (pre-fix early-returned when `quality_profile_id > 0`).
- **Impact:** if the arr's quality profile or root folder is deleted/renamed, the default preset keeps the stale id/path. Re-saving the connection returned `defaultPreset:"exists"` and changed nothing (verified live: preset row `999`/`bogus` survived a reconnect), so member Add kept failing even though the admin saw "Connected". The prior audit's F-PRESET-04 repair only covered `quality_profile_id <= 0`.
- **Fix:** `presetIsUsable()` (pure, in `preset-input.ts`); `ensureDefaultPreset()` now loads the live profiles/folders and repairs the existing default in place when either no longer resolves.
- **Regression test:** `preset-input.test.ts` usability cases (deleted profile, removed folder, zero/empty) — all false, while a valid pairing is true.
- **Post-fix runtime probe:** corrupting the temp DB preset to `quality_profile_id=999` then re-saving the connection returned `defaultPreset:"created"` and the preset was repaired to `1 / /data/movies`.

### AUD-08 — Low: unknown-user login performed two argon2 verifications

- **Locations:** `src/lib/server/auth.ts:62-71` (`DUMMY_HASH` was defined but unused), `src/routes/api/auth/login/+server.ts:74-80` (recomputed `hashPin('000000')` per request).
- **Impact:** the "constant-time dummy verify" added for F-AUTH-03 actually doubled the work for unknown/disabled usernames (one `hashPin` + one `verifyPin` vs one `verifyPin` for a real account), which both re-introduces a timing distinction (2× slower ⇒ username does not exist) and gives unauthenticated clients a cheap CPU-DoS lever (~2× argon2 per request per distinct `username@ip` before the 10-attempt backoff).
- **Fix:** export the module-level `DUMMY_HASH` and verify against it (one argon2 call, same cost as a real account).
- **Regression test:** `auth.test.ts` asserts only that the exported dummy constant is a real argon2id hash of the fixed PIN (verifies `000000`, rejects others). It does **not** prove the login path performs a single verification — that property is enforced by code review; a timer-based test would be flaky in CI.

### AUD-09 — Low: expired sessions were never pruned on the same UTC day

- **Location:** `src/lib/server/auth.ts:141-147` (pre-fix `DELETE ... WHERE expires_at < datetime('now')`).
- **Impact:** `expires_at` is written as `toISOString()` (`...T...Z`) while `datetime('now')` is `YYYY-MM-DD HH:MM:SS`. Lexicographically `'T'` > `' '`, so an expired same-day session sorted *after* "now" and survived the prune (still rejected on presentation, so cosmetic/table-growth only). F-AUTH-04's hygiene was partially ineffective.
- **Fix:** compare against `new Date().toISOString()`.
- **Regression test:** `src/lib/server/auth.test.ts` writes an expired same-day row plus a live row into a **temp** DB (`ADDARR_DB` set to `mkdtemp` before import; repo DB never opened) and asserts only the live row remains — fails deterministically against the old SQL.

### AUD-10 — Low: LAN toggle checkbox could stay visually checked after a failed save

- **Location:** `src/routes/settings/+page.svelte:153-180`.
- **Impact:** the checkbox uses `checked={lan.enabled || lan.forced}` with an uncontrolled `onchange`; on a failed POST (e.g. broadcast failure returns 500 after the preference was persisted, or a network error when nothing was saved) the state object did not change and Svelte did not re-apply `checked`, leaving the UI disagreeing with the saved preference. Now the page always re-reads `/api/settings/lan` in `finally`, so the checkbox reflects persisted state either way.
- **Test:** none — the repo has no DOM/component harness and adding one would be a new dependency; verified by inspection and `npm run check`.

### AUD-11 — Low: dev mock arr servers listened on all interfaces

- **Location:** `scripts/mock-arrs.mjs:60,105` — the `'127.0.0.1'` host was passed to `http.createServer()` (ignored) instead of `listen()`, so `lsof` showed `*:8787` / `*:8788`.
- **Impact:** while a developer runs the mocks, their unauthenticated `/__mock/*` seed endpoints (POST-only) are reachable from the LAN. The prior audit-fix commit claims "mock localhost"; it was misplaced.
- **Fix:** `.listen(8787, '127.0.0.1', …)` / `.listen(8788, '127.0.0.1', …)`. Verified with `lsof`: both now `127.0.0.1` only. No unit test (top-level-starting script).

### AUD-12 — Low: service base URL accepted non-HTTP(S) schemes

- **Location:** `src/routes/api/services/+server.ts:32-38`.
- **Impact:** `baseUrl:"file:///etc/passwd"` parsed as a `URL`, its `origin` is the literal `null`, and the probe error shown to the admin was `Arr request failed (Failed to parse URL from null/etc/passwd/api/v3/system/status)` — confusing and a sign the connection form validates nothing about the scheme. Probe failure meant nothing was stored, so impact is low.
- **Fix:** new pure `src/lib/arr/service-url.ts` `normalizeServiceBaseUrl()` — http/https only, no query/fragment, keeps reverse-proxy subpath (F-SETTINGS-03), strips trailing slashes.
- **Regression test:** `service-url.test.ts` (5) — accepted forms, subpath/trailing slash, rejected schemes/malformed/empty/query/fragment.

### AUD-13 — Low: console command `ids` forwarded without validation

- **Location:** `src/routes/api/console/[...path]/+server.ts:358-375`.
- **Impact:** `{"name":"MoviesSearch","ids":"abc"}` was forwarded to the arr as `movieIds:"abc"` (verified; the arr's own validation is the only guard). The curated console contract says hand-built commands; payload types should be checked at the trust boundary like library PATCH is (F-CONSOLE-02).
- **Fix:** reject `ids` unless it is an array of positive integers (400), inline in the route.
- **Post-fix runtime probe:** `ids:"abc"` → **400** `ids must be an array of positive integers`. No route-level unit test (no HTTP test harness in the repo; the runtime probe is the evidence).

### AUD-14 — Low: stop/uninstall reported success without verifying; `npm start` had no root guard

- **Location:** `scripts/service.mjs:925-950` (`verifyStopped()` existed but was never called; `refuseRoot()` only ran for the `install` subcommand).
- **Impact:** prior F-SCRIPT-06 ("Stop/uninstall ignore failures and report success") was still open: `npm run stop` printed "stopped" even when the process survived, and `npm run uninstall` printed success with a running server. `npm start` is the documented install command and ran as root without the guard the `install` path has (README/service header: "Nothing here runs as root").
- **Fix:** call `refuseRoot()` in `commandStart`; after `stop`/`uninstall` call the existing `verifyStopped()` and exit non-zero with an actionable message instead of claiming success.
- **Round 2 correction:** on Windows this verification was still vacuous — `windows.stop()` deletes the PID file as part of stopping, so `verifyStopped()`'s `platform.running()` probe saw "not running" even if the process survived. Round 2 captures the pid before stopping and probes its liveness with `pidAlive()` on Windows (macOS/Linux behaviour unchanged), and adds `refuseRoot()` to `restart`/`open` (§9).
- **Test:** none — exercising these paths would stop/uninstall the host's real service, which the audit constraints forbid. Verified by `node --check` and code review only.

## 5. Runtime evidence (post-fix, isolated)

Environment: fresh build, `ADDARR_DB`/`ADDARR_DATA_DIR` in `mktemp -d`, `HOST=127.0.0.1 PORT=45999`, `scripts/mock-arrs.mjs` (now localhost-only), curl with `--path-as-is`.

| Probe | Expected | Observed |
| --- | --- | --- |
| `GET /%61pi/services` pre-setup | 503 JSON | 503 `{"error":"Admin setup required"}` |
| `GET /%61pi/activity` anonymous | 401 JSON | 401 `{"error":"Admin sign-in required"}` |
| `GET /%63onsole`, `/sett%69ngs` anonymous | 302 `/login` | 302 |
| `GET /%61pi/services` admin session | 200 | 200 services list |
| `GET /%61rrapi/radarr/system/status` anonymous | 401 | 401 |
| `GET /arrapi/radarr/queue/%2E%2E%5Csystem%5Cbackup` | 403 | 403 `Endpoint not allowed: /system/backup` |
| `GET /arrapi/radarr/queue/..%5Cdownloadclient` | 403 | 403 |
| `GET /arrapi/radarr/system/status` | 200 | 200 `{"appName":"Radarr","version":"5.0.0"}` |
| `PATCH preset minimumAvailability:"bogus"` | 400 | 400 enum message |
| `PATCH preset qualityProfileId:999` | 400 | 400 "does not exist on the connected instance" |
| `PATCH preset rootFolderPath:"/gone"` | 400 | 400 |
| `PATCH preset tags:[77]` | 400 | 400 |
| `PATCH preset valid fields` | 200 | 200 |
| `PATCH preset {"isDefault":true}` (arr reachable) | 200 | 200 |
| Corrupt default preset to profile 999 → re-save connection | repaired | preset restored to `1 / /data/movies`, response `defaultPreset:"created"` |
| `GET /api/search?q=unmonitored` (unmonitored movie) | no `status` | `{"inLibrary":true,"id":2}` (no status) |
| `GET /api/status/series/5` (caught-up airing series) | available | `{"state":"available"}` |
| `POST /api/services` with `file:///etc/passwd` | 400 scheme error | 400 `baseUrl must start with http:// or https://` |
| `POST /api/console/command` `ids:"abc"` | 400 | 400 |
| `POST /api/add` (member, no auth) | 200 added | 200 `{"ok":true,"id":501,...}` |
| `lsof -iTCP:8787,8788` | 127.0.0.1 | `TCP 127.0.0.1:8787`, `TCP 127.0.0.1:8788` |

Browser semantics (headless Firefox, isolated profile, synthetic DOM matching the app shell):
- pre-fix shape (`inert` on `.app`): `focusedBtn=false activeTag=BODY`.
- fixed algorithm: `dialogButtonFocused=true backgroundBlocked=true pageInert=true headerInert=true dialogInert=false overlayInert=false`.

Pre-fix reproduction evidence for AUD-04/05/09 (regression tests re-run against the reverted code) and for AUD-01/03/06/07 (live probes against the unfixed build) is recorded above and in the corresponding finding sections.

## 6. Deferred items (documented, not changed)

| ID | Severity | Item | Why deferred |
| --- | --- | --- | --- |
| D-01 | High (feature gap) | **Downloads whole-library scope is not implemented.** `GLOSSARY.md` and ADR 0001 promise the page also shows *Not out yet* / *More coming* / *Still looking* (whole monitored library, aired-aware) and *Recently arrived*; the implemented `GET /api/downloads` + page only list active arr **queue** rows (`.scratch/downloads/spec.md` is a ready-for-agent spec, not shipped). Member badge copy also still says "Missing"/"Unreleased", the exact jargon the glossary says to avoid. | This is substantial feature work (new normalized states, library/history data in the aggregate endpoint, page sections, monitored+watching-window logic and tests), not a defect fix, and needs product decisions (7-day window, "More coming" state). Bolting it onto a code-quality pass would be speculative. Recommend a tracked feature ticket built on the new pure seams (`status.ts`/`downloads.ts`). |
| D-02 | High | **Service PID identity is still not verified before kill.** `serve.mjs` now writes `${pid} ${startTime}` and refuses a second sequential instance, but `service.mjs readPid()` still reads only the pid; Windows `taskkill /PID … /T /F` / tray `Stop-Process -Force` can kill an unrelated process tree after PID reuse, and the stored start time is never checked. Prior F-SCRIPT-01 remediation is incomplete. | Windows-only code path; cannot execute or verify service lifecycle on this macOS host, and changing kill semantics without a Windows harness could break the primary `npm start` path. Needs a Windows verification pass (compare image name/start time via `Get-Process`, refuse on mismatch). |
| D-03 | Medium | **Standalone restart handoff is not failure-aware.** `serve.mjs restart()` spawns the replacement without handling child `error`/early exit; if the new process cannot bind, the old one exits anyway and the app stays down until launchd/systemd restarts it (standalone: not at all). | Same lifecycle-verification limitation; the fix needs process/signal testing that must not be done against the host service. |
| D-04 | Medium | **`GET /api/presets` is all-or-nothing.** When the connected arr is unreachable the route returns 502 and the Presets page hides stored presets/options (`presets=[]`, "Connect … first"), so an outage blocks inspecting/editing DB-only preset fields. | API + page contract change (`options:null` + `optionsError`, render list from stored rows); keep out of a minimal-fix pass. |
| D-05 | Medium (inferred) | **Downloads series episode counts can be missing.** `queueNeedsLibrary()` decides whether to fetch the library from nested-media *title* only; if Sonarr's `includeSeries` queue payload has a title but no `statistics`, `buildDownloadItems` gets `episodes:null` (reproduced with the mock). Real Sonarr payload shape unverified here. | Needs a live Sonarr to confirm; the fix may add a library fetch per poll (cost/benefit decision). |
| D-06 | Low | Console KPI "Blocklisted" is capped at 25 (uses `blocklist()` page 1 length). | Needs a paged-total in the adapter; cosmetic KPI, low impact. |
| D-07 | Low | Member `/api/add` maps every upstream `ArrError` to 502 "not responding" — an upstream 4xx (e.g. an invalid preset or a duplicate race) reads as an outage. | Error-classification polish; no security/user-trust break. |
| D-08 | Low | Login timing/abuse hardening is approximate by design: in-memory backoff resets on restart, no global per-IP throttle, argon2 only for the PIN check. | Documented LAN threat-model tradeoff; changing it needs a policy decision (accounts for members do not exist). |
| D-09 | Low | Maintainability leftovers: unused `createDefaultPreset()` in `presets.ts`; unused `total` local in `seriesStatus()`; unused `tick` import in `+layout.svelte`; duplicated `safeParseTags` in presets page/PresetForm. | Style/cleanup, no user impact; deliberately excluded to keep the fix diff reviewable. |
| D-10 | Low | Documentation drift beyond D-01: mDNS publishes the instance name `Addarr on <hostname>` while README/UI say discovery shows "Addarr"; `docs/agents/` and the old PLAN are stale. | Cosmetic docs alignment; better done as a docs-only change. |

## 7. Verification results

| Check | Command | Result |
| --- | --- | --- |
| Unit tests | `npm test` | **84 passed, 0 failed** (baseline was 39; +45 new tests across both rounds, in 9 new/updated test files) |
| Types / Svelte | `npm run check` | **0 errors, 0 warnings** |
| Production build | `npm run build` | **success** (only the pre-existing `node:sqlite` external warning + empty ConfirmDialog chunk warning) |
| Script syntax | `node --check scripts/{serve,service,mock-arrs,icons}.mjs` | all pass |
| Runtime probes | isolated server + mock arrs (see §5) | all expected results |
| Browser probe | headless Firefox, isolated profile | pre-fix dialog unfocusable; fixed algorithm focusable + background inert |
| Repo DB safety | `shasum -a 256 data/addarr.db` | unchanged: `b8dcae17…88df6e` |
| Pre-existing changes | `git status` | `M package.json`, `?? .scratch/`, `?? docs/adr/`, `?? docs/plans/` — all preserved and untouched |

Files changed by this audit:

```
scripts/mock-arrs.mjs                          scripts/service.mjs
src/hooks.server.ts                            src/lib/actions/modal.ts (+ test)
src/lib/arr/downloads.ts (+ test)              src/lib/arr/preset-input.ts (+ test)
src/lib/arr/status.ts                          src/lib/server/passthrough.ts (round 2)
src/lib/actions/modal.ts (round 2)             scripts/service.mjs (round 2)
src/lib/arr/service-url.ts (+ test)            src/lib/arr/radarr.ts
src/lib/arr/sonarr.ts (+ poster-cards test)    src/lib/server/admin-gating.ts (+ test)
src/lib/server/auth.ts (+ test)                src/lib/server/passthrough.ts (+ test)
src/lib/server/presets.ts                      src/routes/api/auth/login/+server.ts
src/routes/api/console/[...path]/+server.ts    src/routes/api/presets/+server.ts
src/routes/api/services/+server.ts             src/routes/arrapi/[service]/[...path]/+server.ts
src/routes/settings/+page.svelte
```

No dependency, version, lockfile, build-config, or data-file changes.

## 8. Limitations and incident note

- **No live Radarr/Sonarr.** All arr behavior was exercised against `scripts/mock-arrs.mjs` plus fixture probes; real-arr-specific claims are marked inferred (e.g. D-05, and the "real Radarr rejects stale qualityProfileId" consequence behind AUD-06/07 — the DB-side evidence is verified, the upstream rejection is by Radarr's documented add validation).
- **No accessibility/browser harness in the repo.** The AUD-02 and AUD-10 claims were verified with a headless-Firefox semantics probe / source inspection respectively; no screen reader was used.
- **Service lifecycle commands were not executed** (install/uninstall/start/stop/restart/tray/mDNS/restart endpoint), per constraints; AUD-14 and D-02/D-03 are code-review evidence only.
- **Incident during cleanup:** a stray process-cleanup command killed the host's running launchd Addarr process (`com.addarr.server`, listening `127.0.0.1:4545`). launchd's `KeepAlive` immediately respawned it (new pid `52658`); health was re-verified (`GET /` → 200) and no service file, setting, or database content was changed by the audit (repo DB hash unchanged). No `service.mjs` command was run. This was a transient, self-healing side effect of shell cleanup, not part of the tested code paths.
- The findings here are audit-scoped; a clean `npm test`/`check`/`build` is not proof of absence, particularly for the deferred platform/lifecycle items.

## 9. Verification follow-up (round 2)

An independent verifier reviewed the round-1 fixes and confirmed the core security fixes hold (no gate/passthrough/preset/auth bypass; tests green). It also found one regression and several lower-severity gaps. All were reproduced against the round-1 code, fixed minimally, and re-tested. **No finding was rejected.**

| ID | Round-1 issue | Fix | Test / evidence |
| --- | --- | --- | --- |
| AUD-05-R | **Regression:** unmonitored suppression was too broad — `available`/`partial` states and the in-library detail sheet disappeared (suppressed whenever `monitored===false && rows.length===0`). | Suppress only false-pursuit states (`missing`, `unreleased`, `partial`); keep `available` and any live queue state (`isPursuitState()` in `status.ts`, used by both adapters). | `poster-cards.test.ts` +3 (unmonitored on-disk → `available`, unmonitored partial → no state, unmonitored unreleased → no state); the two `available` cases fail the round-1 code. Live probe: search returns `{"state":"available"}` for an unmonitored movie with `hasFile:true`, no status for the unmonitored missing one. |
| AUD-07-R | Repair overwrote **both** `quality_profile_id` and `root_folder_path` when only one was stale, discarding a still-valid admin choice; `/api/services` reported `"created"` for a repair. | `planPresetRepair()` keeps the valid field(s) and replaces only the stale one(s); `ensureDefaultPreset()` applies the plan and returns `note:'repaired'`; the services route surfaces `defaultPreset:"repaired"`. | `preset-input.test.ts` repair-plan cases (profile-stale keeps folder, folder-stale keeps profile). Live probe: corrupt only the folder (`/gone`, profile 1 valid) → reconnect → response `defaultPreset:"repaired"`, preset restored to `(1, /data/movies)` with profile preserved. |
| AUD-06-R | `tags: []` triggered a live-options fetch, so every UI preset save 502'd during an arr outage. | `presetInputNeedsLiveOptions()` ignores empty tag arrays (only non-empty tag lists need live verification). | Test in `preset-input.test.ts`. Live probe with the arr stopped: `PATCH {"tags":[]}` → **200** and `PATCH {"monitored":true}` → 200, while `PATCH {"qualityProfileId":1}` → **502** (still verified when a live id is sent). |
| AUD-02-R | **Incomplete AUD-02:** the DownloadSheet's click-outside `.backdrop` button is a sibling of the modal card inside `.overlay`, so it was marked inert — click-outside-to-close still broken. | `markBackgroundInert()` now starts its walk at `node.closest('.overlay') ?? node`, keeping the whole modal layer (dialog + backdrop) active while page background goes inert; `restoreInert()` restores only marked elements. | `modal.test.ts` +2: DownloadSheet DOM shape (backdrop/dialog/close stay active, page/topbar inert — the backdrop assertion fails the round-1 walk) and a destroy/restore test. |
| LAN toggle false failure | Pre-existing bug: the Settings UI treated the normal localhost-bound response (`ok:true, broadcasting:false, restartRequired:true`) as "discovery failed" and showed a red error on a successful first-time enable. | UI now errors only on `!res.ok` / `data.error`; otherwise shows the server `message` and lets the existing hint explain "restart required". | API probe: `POST /api/settings/lan {"enabled":true}` → `{"ok":true,"enabled":true,"broadcasting":false,"restartRequired":true,"message":"Saved. Restart Addarr to make it reachable on the LAN."}`; no component harness, so UI change is code-review + `npm run check`. |
| AUD-03-R | Defense-in-depth: double-encoded traversal (`%252E%252E%255C…`) decodes once in SvelteKit and still passed the allow-list; forwarding it lets the upstream HTTP server decode the traversal. | `resolvePassthroughPath()` rejects any normalized target still containing `%` (never forwarded), after normalization/allow-list. | `passthrough.test.ts` +1 (four double-encoded forms rejected; ordinary paths still allowed). Live probe: `%252E…` requests → **403**, plain `/queue` and `/movie/lookup` → 200. Real-Radarr second-decode behaviour is inferred (mock cannot represent it), so the rule is deliberately stricter than strictly necessary. |
| AUD-14-R | **Incomplete AUD-14:** `verifyStopped()` was vacuous on Windows because `windows.stop()` deletes the PID file before verification. | Capture the pid before stopping; `verifyStopped(previousPid)` additionally probes `pidAlive(previousPid)` on Windows only, so macOS/Linux behaviour is unchanged. Also `refuseRoot()` now runs for `restart` and `open`. | `node --check scripts/service.mjs` + code review only (host lifecycle commands are forbidden). |

Report corrections made in this round: AUD-04 pre-fix test claim (2 of 3, not all 3), AUD-08 test strength (constant validity only, not single-verification), AUD-05 framing (final suppression rule), AUD-14 Windows caveat, the hooks "same view" wording (gating decodes with `decodeURIComponent` and also checks the raw path, which is stricter than SvelteKit's `decode_pathname`), and the modal test-coverage gap (backdrop/restore now covered). The 1.0.1 version bump in `package.json`/`package-lock.json`/`README.md` is Lead release work, not part of this audit.

**Round-2 gate:** `npm test` → **84 passed, 0 failed** (+7 round-2 tests); `npm run check` → 0 errors/0 warnings; `npm run build` → success; `node --check` on all four scripts → ok; isolated probes re-verified the round-1 security fixes (encoded admin path 401, passthrough backslash traversal 403, preset invalid 400/valid 200). Repo `data/addarr.db` SHA-256 unchanged.
