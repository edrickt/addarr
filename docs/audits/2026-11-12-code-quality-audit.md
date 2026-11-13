# Addarr Code Quality & Feature-Reliability Audit — 2026-11-12

- **Date:** 2026-11-12 (America/Detroit)
- **Baseline commit:** `05f56d7` (`docs: add codebase map for agent exploration`) on `main`
- **Environment:** macOS, Node `v24.21.0`, npm `11.19.0`, dependencies pre-installed (`node_modules` present); release version **pending** (`package.json` is `1.0.1`; this audit did not bump it)
- **Mode:** audit **and** remediation (same as 2026-11-08)
- **Prior audit:** `docs/audits/2026-11-08-code-quality-audit.md` (14 fixed, 10 deferred). This report covers **new or still-remaining** defects, including the package-lock consistency question raised by the Lead.
- **Findings in this report:** 10 fixed (4 Medium, 6 Low; 0 Critical, 0 High) + 12 deferred with rationale. Round 2 (independent-verifier follow-up, §9): 4 further items fixed (1 Medium, 3 Low) and 4 report corrections.
- **Report scope:** all implemented features — member search/add, acquisition status & polling, Downloads, presets/connections, admin console, auth/setup/first-run, activity, read-only passthrough, settings/LAN/restart, service lifecycle scripts, shared frontend, DB + arr client, release metadata.
- **Finding IDs:** `AUD-NN` are scope-local to this report and do not continue prior numbering.

## 1. Pre-existing working-tree state (preserved)

`git status` before this audit, and unchanged by it except for the intentional audit commits:

```
?? .scratch/          (pre-existing untracked audit/issue workspace — never read or modified)
```

`data/addarr.db` SHA-256 before and after: `b8dcae173dcde760df7c08024fb1e0b64707964c05f609bd2b4a784f2088df6e` (unchanged; every runtime probe used a temporary `ADDARR_DB`/`ADDARR_DATA_DIR`).
No push, tag, release, version edit, dependency upgrade, or host service install/uninstall/start/stop was performed. The only lockfile change is the defect fix in AUD-01; `package.json` is untouched. Round-2 follow-ups (§9) are further local commits; none of the above changed.

## 2. Method

1. Read `AGENTS.md`, `docs/agents/codebase-map.md`, `GLOSSARY.md`, `PLAN.md` §2–§7, `docs/adr/0001-downloads-whole-library-scope.md`, the 2026-11-08 audit report and the 2026-10-22 methodology plan, then every source file in `src/**` and `scripts/**`.
2. Static review at `file:line`, then verified each candidate where safe: a fresh production build served from an isolated temp data directory (`ADDARR_DB`/`ADDARR_DATA_DIR`, `HOST=127.0.0.1`, ports `45998`/`45999`), repo mock arrs bound to loopback (`8787`/`8788`), `curl` probes, a throwaway copy of `package.json` + `package-lock.json` with a real `npm ci` (registry reachable), `git show c8867d0 -- package-lock.json`, and a direct `db.ts` import probe. No real arr, no real data file, no host service command.
3. **New this round:** in-process SvelteKit route-handler tests (`src/routes/route-handlers.test.ts`). A `node:module` resolve hook teaches plain `node --test` the `$lib` alias and Vite-style extensionless imports, so the real `+server.ts`/`+page.server.ts` handlers run against a temp SQLite DB and loopback fake arrs with no browser or app server. Pure seams were extracted where behaviour was previously only inline in a component (`src/lib/arr/search-merge.ts`).
4. For every accepted finding: the regression test was written **first** and run against the unfixed tree to capture pre-fix failure, then the minimal fix was applied and all checks re-run. Pre-fix failure evidence is recorded in §4 and §5.
5. Final full gates: `npm test`, `npm run check`, `npm run build`, plus `node --check` on all four scripts.

### Pre-fix failure evidence (recorded before any fix)

| Evidence | Pre-fix result |
| --- | --- |
| `npm test` with the final test set against the restored `05f56d7` sources (round-2 reproduction; command in §9) | **101 tests, 92 passed, 9 failed** — all nine are intended regression tests (lockfile, login, search, status ids, add mapping ×3, DB-directory ×2). This supersedes round 1's intermediate `95 / 88 / 7` measurement; the independent verifier's pre-fix reproduction of the round-1 suite reported `93 / 85 / 8` for the same failure classes |
| `node --test src/lib/server/db.test.ts` against the unfixed `db.ts` | **0 passed, 2 failed** (`ensurePrivateDataDir is not a function`; direct probe below showed the clobber) |
| `npm ci --dry-run` (repo, corrupted lockfile) | `change supports-preserve-symlinks-flag 1.0.0 => 1.0.1` / `change is-module 1.0.0 => 1.0.1` |
| Throwaway `npm ci` with the committed lockfile | installed `node_modules/{is-module,supports-preserve-symlinks-flag}/package.json` = **1.0.0**, while `npm ls` reported **1.0.1** (a version the registry does not have) |
| `GET /login` on a fresh temp DB | no "No admin account exists yet" and no "Run first-time setup" — sign-in form only |
| `GET /api/search?service=movie&q=dune` with no services | `400 {"error":"Search failed"}` |
| `POST /__mock/radarr/movie` with malformed JSON | dev mock process died (socket closed, listener pid gone, later requests refused) |
| import `db.ts` with `ADDARR_DB` inside an existing `0755` directory | directory silently changed to `0700` |
| **Round 2:** `node --test src/lib/arr/search-merge.test.ts` before the round-2 merge fix | **1 failed** — one connected empty library + one unconfigured kind produced the false "library is not connected yet" alert |
| **Round 2:** `POST /api/v3/movie` with malformed JSON (mock arr route) | HTTP 000, fatal stack, mock process died |
| **Round 2:** `node --test src/routes/route-handlers.test.ts` before the AUD-05 classification fix | **2 failed** — lookup 404 and 429 both got the admin-preset wording |

## 3. Findings summary

| ID | Severity | Confidence | Feature | Location (post-fix) | Fix | Regression test |
| --- | --- | --- | --- | --- | --- | --- |
| AUD-01 | Medium | high | Release integrity | `package-lock.json:1477`, `package-lock.json:1763` | restore dependency versions to match `resolved`/`integrity` (1.0.0) | `src/lib/lockfile.test.ts` (2) |
| AUD-02 | Medium | high | Auth / first run | `src/routes/login/+page.server.ts:11` | load real `hasAnyUser()` state | `src/routes/route-handlers.test.ts` |
| AUD-03 | Medium | high | Member search | `src/routes/api/search/+server.ts:24`, `src/lib/arr/search-merge.ts:65`, `src/routes/+page.svelte:95` | not-connected service = normal state; merge extracted, skips unconfigured kinds; setup alert only when no kind is connected (§9) | `src/lib/arr/search-merge.test.ts` (7) + route test |
| AUD-04 | Low | high | Member status API | `src/routes/api/status/[kind]/[id]/+server.ts:22` | reject non-positive ids | `src/routes/route-handlers.test.ts` |
| AUD-05 | Low | high | Member add | `src/routes/api/add/+server.ts:113-142` | classify the arr answer: 404 missing title, 429 busy, other 4xx rejected/admin, 5xx/network outage (§9) | `src/routes/route-handlers.test.ts` (3 add cases) |
| AUD-06 | Medium | high | Data / storage | `src/lib/server/db.ts:13-24` | never chmod a pre-existing `ADDARR_DB` parent dir | `src/lib/server/db.test.ts` (2) |
| AUD-07 | Low | high | Dev scripts | `scripts/mock-arrs.mjs:13-26,69-76` | reject malformed JSON instead of crashing the mock — control routes and the arr `POST /movie` route (§9) | none (top-level script); runtime probe |
| AUD-08 | Low | high | Service lifecycle | `scripts/service.mjs:280,421,662` | icon-generation failure is cosmetic on macOS, Linux and Windows; install continues without an icon (§9) | none (host lifecycle forbidden); `node --check` |
| AUD-09 | Low | high | Service lifecycle (Windows) | `scripts/service.mjs:540` | tray probes the effective bind URL, not hardcoded localhost | none (Windows-only); `node --check` |
| AUD-10 | Low | high | Docs / behaviour drift | `README.md:179,262`, `src/routes/settings/+page.svelte:248`, `scripts/serve.mjs:117,129` | document actual mDNS instance name | none (docs); source evidence |

Deferred items are listed in §6.

## 4. Fixed findings (detail)

### AUD-01 — Medium: release commit corrupted two `package-lock.json` dependency versions

- **Location:** `package-lock.json` entries `node_modules/is-module` (version line 1477) and `node_modules/supports-preserve-symlinks-flag` (version line 1763); introduced by release commit `c8867d0` (`chore(release): v1.0.1`).
- **Impact:** `git show c8867d0 -- package-lock.json` shows the v1.0.1 bump changed exactly four lines: the two root versions and — clearly from a naive `1.0.0 → 1.0.1` replacement — only the `version` field of these two packages, while `resolved`/`integrity` still point at the `1.0.0` tarballs. The registry has no 1.0.1 for either package (`npm view is-module versions` → `["1.0.0"]`; same for `supports-preserve-symlinks-flag`). Consequence: the committed lock is not a truthful dependency graph. Verified in a throwaway copy: after `npm ci`, the installed packages are 1.0.0 (their own `package.json`) but `npm ls` prints **1.0.1**; in a normally-installed tree `npm ci --dry-run` reports phantom `change … 1.0.0 => 1.0.1` lines on every run. Any tooling or future release step that trusts lock metadata (audit, license/SBOM, dependency diffing) sees versions that do not exist.
- **Fix:** restore both `version` fields to `1.0.0`, matching `resolved`/`integrity` and the registry. No other lockfile change; no dependency or version-file change.
- **Regression test:** `src/lib/lockfile.test.ts` — for every `node_modules/*` entry, the lockfile `version` must equal the version in its resolved tarball URL (fails pre-fix on exactly these two entries), plus root lock version must equal `package.json`.
- **Post-fix evidence:** `npm ci --dry-run` → `up to date in 334ms`; `npm ls is-module supports-preserve-symlinks-flag` → both `1.0.0`.

### AUD-02 — Medium: fresh install's `/login` dead-ended instead of offering first-time setup

- **Location:** `src/routes/login/+page.server.ts:11` (pre-fix: `load` returned hard-coded `{ hasAdmin: true }`).
- **Impact:** `src/routes/login/+page.svelte` branches on `!data.hasAdmin` to say "No admin account exists yet" and link to `/setup`. Because the load always claimed an admin existed, that branch was dead: on a fresh install, clicking the header's **Admin sign in** (the natural first action) produced a sign-in form for an account that could not exist, with no visible route to `/setup` (only typing the URL worked). Verified against a fresh temp DB: `GET /login` contained the sign-in form but neither "No admin account exists yet" nor "Run first-time setup" (`/setup` itself returned 200).
- **Fix:** return the real state (`hasAnyUser()`).
- **Regression test:** `src/routes/route-handlers.test.ts` — `load()` reports `hasAdmin: false` with no users and `true` once an admin row exists (fails pre-fix, which always returned `true`).
- **Post-fix probe:** fresh isolated server, `GET /login` contains "No admin account exists yet" and "Run first-time setup".

### AUD-03 — Medium: one-service households saw a permanent false "library unreachable" error

- **Locations:** `src/routes/api/search/+server.ts:24` (new unconfigured branch), `src/lib/arr/search-merge.ts:32` (new pure merge), `src/routes/+page.svelte:95` (uses the merge).
- **Impact:** Settings onboarding explicitly supports connecting only Radarr *or* only Sonarr ("Connect Radarr or Sonarr below"). The member page always searches both media kinds in the default "All" mode. Pre-fix, `/api/search` answered `400 {"error":"Search failed"}` for a service that was never configured, and the page's inline merge treated **any** failed kind as a partial failure. Result: in a one-service household, every search showed a permanent red "Couldn't reach the series library — showing movies instead." (or the movie equivalent) banner even though nothing was wrong. With no services configured, typing a query showed the generic "Search failed" instead of a first-run message. Pre-fix probe: `/api/search?service=movie&q=dune` with no services → 400 `{"error":"Search failed"}`.
- **Fix:** `/api/search` reports an unconnected library as a normal `200 {service, results: [], unconfigured: true}` state (still 400 for bad parameters, still 502 for a configured-but-unreachable instance). The merge was extracted to the pure `$lib/arr/search-merge` module: unconfigured kinds are skipped, a genuine partial failure still produces the partial-error banner, and "nothing configured" produces the distinct first-run message `The library is not connected yet — ask an admin to finish Settings.`
- **Regression test:** `src/lib/arr/search-merge.test.ts` (round 1: 5 cases — unconfigured skipped, nothing configured, unreachable → partial error, both failing, non-array body; round 2 adds 2: §9) + `route-handlers.test.ts` (unconfigured `/api/search` → 200 with flag). Two round-1 merge cases and the route case fail pre-fix against the round-1 code; the round-2 cases fail pre-fix against the round-1 merge.
- **Post-fix probe:** with only Radarr connected, `GET /api/search?service=series&q=test` → `200 {"service":"sonarr","results":[],"unconfigured":true}`; the movie search is unchanged.

### AUD-04 — Low: status polling accepted non-positive ids and invented "waiting"

- **Location:** `src/routes/api/status/[kind]/[id]/+server.ts:22`.
- **Impact:** only `Number.isInteger(id)` was checked, so `id = 0` or `-1` was forwarded upstream; an upstream 404 (or a missing library) is mapped to `{state:"waiting"}`, which the member UI renders as the legitimate "Looking for it…" pending state. A malformed request therefore looked like a real acquisition instead of a bad request. (`/api/files` already rejected `id <= 0`; the two member endpoints disagreed.)
- **Fix:** reject `id <= 0` with `400 {"error":"invalid id"}` before touching the arr.
- **Regression test:** `src/routes/route-handlers.test.ts` — ids `0`, `-1`, `abc`, `1.5` → 400 (pre-fix `0` reached the client path and answered 500/200).
- **Post-fix probe:** `GET /api/status/movie/0` → `400 {"error":"invalid id"}`.

### AUD-05 — Low: member add reported an upstream rejection as a library outage

- **Location:** `src/routes/api/add/+server.ts:116-127`.
- **Impact:** every upstream `ArrError` — including arr 4xx responses such as a stale/invalid preset, a rejected API key, or a duplicate-add race — was mapped to `502 "Could not add — the library is not responding right now"`. The member is told to retry because the library is down, when retrying cannot help and the real cause is an admin-side configuration problem. Verified pre-fix with a loopback fake Radarr that accepts the lookup and rejects `POST /movie` with 400: `POST /api/add` returned **502** with the outage text.
- **Fix (round 2 refinement):** the arr answer is classified — `404` "that title is not available in the library right now", `429` "the library is busy — try again in a moment", any other 4xx "the library rejected this request — ask an admin to check the default preset and connection", and 5xx/network stays the outage message. Every upstream message is still logged server-side. This also makes the intended "not in the library" path reachable when the arr itself answers 404 to the lookup (round 1 mapped it to the admin-preset wording; §9).
- **Regression test:** `src/routes/route-handlers.test.ts` — configurable loopback fake arr: 400 on add → 400 rejected/admin, not "not responding" (round 1); lookup 404 → 404 not-available; lookup 429 → 429 busy (round 2, both fail the round-1 mapping).

### AUD-06 — Medium: importing the DB layer chmodded an existing user-provided directory

- **Location:** `src/lib/server/db.ts:13-24`.
- **Impact:** the old code ran `mkdirSync(dirname(DB_PATH), { recursive: true, mode: 0o700 })` followed by an **unconditional** `chmodSync(dirname(DB_PATH), 0o700)`. `ADDARR_DB` is documented as a custom data-file path, so pointing it into an existing shared directory (e.g. `ADDARR_DB=/srv/media/addarr.db`) silently rewrote that parent directory to `0700`, potentially cutting off other services or users that legitimately share it. Verified: an existing `0755` directory became `0700` merely by importing `db.ts` with `ADDARR_DB` inside it.
- **Fix:** `ensurePrivateDataDir()` records whether the directory existed and only tightens a directory Addarr itself created; the database file (and its `-wal`/`-shm` sidecars when present) is still chmodded `0600`, so the data stays private either way.
- **Regression test:** `src/lib/server/db.test.ts` — pre-existing `0755` directory keeps `0755`; a newly created nested directory is `0700`. Both fail pre-fix (helper absent).
- **Post-fix evidence:** unit test green; DB file still `0600` (`0100600`).

### AUD-07 — Low: malformed JSON at the dev mock endpoints killed the mock process

- **Location:** `scripts/mock-arrs.mjs:11-25`.
- **Impact:** `readBody()` called `JSON.parse` inside the `'end'` event handler, so invalid JSON threw outside the request handler's `try/catch` and terminated the whole `node scripts/mock-arrs.mjs` process. Verified pre-fix: a single `POST /__mock/radarr/movie` with `{bad json` closed the connection, the listening pid disappeared, and subsequent requests were refused — every manual-testing session that mistypes a fixture body loses both mocks.
- **Fix:** reject the promise on parse failure; the control routes answer 400 on rejection (round 1). **Round 2:** the arr `POST /api/v3/movie` handler is guarded the same way — the verifier found the same unhandled rejection there (§9).
- **Test:** none (top-level script with no harness); re-verified at runtime for both routes: malformed body → `400 {"error":"invalid JSON"}` and the same process keeps serving valid seeds.

### AUD-08 — Low: a failed icon generation aborted the service install

- **Locations:** `scripts/service.mjs:280` (`macWriteApp`), `:421` (`linuxWriteLauncher`), `:662` (`winWriteLauncher`); round 1 fixed the Linux one, §9 the other two.
- **Impact:** `ensureIcons()` failure is caught and logged as "Icons unavailable, continuing without them", but the Linux path then unconditionally called `copyFileSync(pngPath, LINUX_ICON)` with `pngPath === ''`, which throws `ENOENT` and propagates out of `install()` — so a degraded host (unwritable `build/icons`, generation error) fails `npm start` after writing the systemd unit, exactly where the code promises to continue. The icon is cosmetic. macOS (`macWriteApp`) and Windows (`winWriteLauncher`) had the same unguarded call (§9).
- **Fix:** all three platform call sites now fall back to "no icon" and continue; Linux copies only a produced PNG, macOS drops `CFBundleIconFile`, Windows falls back to the default shortcut/tray icon. The desktop entry still points at `Icon=addarr` (missing icon = platform fallback).
- **Test:** none — exercising these paths would install/start the host service, which the audit constraints forbid; verified by code review and `node --check scripts/service.mjs`.

### AUD-09 — Low: Windows tray opened/probed hardcoded localhost instead of the bound host

- **Location:** `scripts/service.mjs:540` (generated tray PowerShell).
- **Impact:** the tray script hardcoded `$Url = 'http://localhost:<port>'` while the launcher elsewhere honors `HOST` and `effectiveHost()`/`probeBase()` (documented: `HOST=192.168.1.x npm start` pins one interface and keeps Addarr off the Tailnet). With `HOST` pinned to a LAN IP the server does not listen on loopback, so **Open Addarr** waits 30 s for localhost, logs "open: server did not come up in time", and never opens the browser — the server itself is fine. Fix: generate `$Url` from the launcher's computed `url`, which already maps `0.0.0.0` to localhost.
- **Test:** none — Windows-only code path, and lifecycle commands are not executed on this macOS host; verified by inspection of the generated template and `node --check scripts/service.mjs` (impact on Windows inferred from the generated script).

### AUD-10 — Low: docs and Settings claimed a discovery name the app does not publish

- **Locations:** `README.md:179,262`, `src/routes/settings/+page.svelte:248`, `scripts/serve.mjs:117,129`.
- **Impact:** README said the app broadcasts "as **"Addarr"**" and the Settings checkbox said discovery shows "Addarr"; the runtime publishes `MDNS_NAME = `Addarr on ${os.hostname()}`` via `bonjour.publish({ name: MDNS_NAME, … })`, and the startup log now prints that same name. An admin looking for "Addarr" in a Bonjour browser sees "Addarr on <machine>" instead — misleading setup documentation (the same drift the 2026-11-08 report deferred as D-10).
- **Fix:** README and the startup log now state the published instance name (`Addarr on <hostname>`); the Settings checkbox label was reduced to "discoverable via mDNS/Bonjour" instead of naming a different value. No runtime behaviour change.
- **Test:** none (docs/strings); source evidence cited above.

## 5. Runtime evidence (post-fix, isolated)

Environment: fresh `npm run build`; `ADDARR_DB`/`ADDARR_DATA_DIR` in `mktemp -d`; `HOST=127.0.0.1 PORT=45999`; repo `scripts/mock-arrs.mjs` on loopback; servers killed afterwards (no listeners left). No real data file, no real arr, no host service command.

| Probe | Expected | Observed |
| --- | --- | --- |
| `GET /login` on fresh DB | setup handoff | contains "No admin account exists yet" + "Run first-time setup" |
| `GET /api/status/movie/0` | 400 | `400 {"error":"invalid id"}` |
| `GET /api/search?service=series&q=test` (no Sonarr) | 200 unconfigured | `200 {"service":"sonarr","results":[],"unconfigured":true}` |
| `GET /api/search?service=movie&q=x` (Radarr mock connected) | 200 results | `200 {"service":"radarr","results":[…]}` |
| `POST /__mock/radarr/movie` with `{bad json` | 400, mock survives | `400 {"error":"invalid JSON"}`, process kept serving |
| `POST /api/v3/movie` with `{bad json` (mock arr route; round 2) | 400, mock survives | `400 {"error":"invalid JSON"}`, same pid kept serving and accepted a valid seed |
| `npm ci --dry-run` after lockfile fix | no changes | `up to date in 334ms` |
| `GET /api/add` with `id:0` | 400 | 400 |
| temp `npm ci` with fixed lock | tree and metadata agree | installed package 1.0.0; `npm ls` 1.0.0 (pre-fix: 1.0.1) |

Pre-fix repro details for AUD-01/02/03/04/05/06/07 are recorded in §2 and §4 (test files, direct probes, and the throwaway `npm ci`).

## 6. Deferred items (documented, not changed)

| ID | Severity | Item | Why deferred |
| --- | --- | --- | --- |
| D-01 | High (feature gap) | **Downloads whole-library scope is not implemented.** `GLOSSARY.md`/ADR 0001 promise *Not out yet* / *More coming* / *Still looking* / *Recently arrived* for the whole monitored library; the shipped `GET /api/downloads` + page only list active *arr **queue** rows. | Substantial feature work with product decisions (windows, new states); unchanged from the 2026-11-08 report. Recommend a tracked feature ticket on the existing pure seams. |
| D-02 | High | **Service PID identity is still not verified before kill.** `scripts/service.mjs readPid()` reads only the pid; the start time `serve.mjs` writes is never checked, so Windows `taskkill /PID … /T /F` (and tray `Stop-Process -Force`) can kill an unrelated process tree after PID reuse. | Windows-only; cannot execute/verify service lifecycle on this macOS host. Needs a Windows harness (`Get-Process` image/start-time comparison). |
| D-03 | Medium | **Standalone restart handoff is not failure-aware.** `scripts/serve.mjs restart()` spawns the replacement without handling child `error`/early exit; if the new process cannot bind, the old one exits anyway and the app stays down until a supervisor restarts it (standalone: not at all). | Needs process/signal-level testing that must not be done against the host service. |
| D-04 | Medium | **`GET /api/presets` is all-or-nothing.** When the connected arr is unreachable the route 502s and the Presets page hides stored presets/options (`presets=[]`, "Connect … first"), so an outage blocks inspecting/editing DB-only fields. | API + page contract change (`options:null` + `optionsError`); keep out of a minimal-fix pass. |
| D-05 | Medium (inferred) | **Downloads series episode counts can be missing.** `queueNeedsLibrary()` decides whether to fetch the library from nested-media *title* only; a Sonarr queue payload with a series title but no `statistics` yields `episodes:null`. | Needs a live Sonarr to confirm the payload shape; may add a library fetch per poll (cost/benefit decision). |
| D-06 | Low | Console KPI "Blocklisted" is capped at 25 (uses `blocklist()` page 1 length). | Needs a paged total in the adapter; cosmetic KPI. |
| D-07 | Low | Login abuse hardening is approximate by design: in-memory per-`username@ip` backoff resets on restart, no global per-IP throttle, argon2-only PIN policy. | Documented LAN threat-model tradeoff; changing it needs a policy decision. |
| D-08 | Low | Maintainability leftovers: unused `createDefaultPreset()` in `presets.ts`, unused `total` local in `status.ts:126`, unused `tick` import in `+layout.svelte:5`, duplicated `safeParseTags`. | Style/cleanup only; kept out to keep this fix diff reviewable (prior D-09). |
| D-09 | Low | **Unauthenticated member endpoints can drive arr load.** `/api/search` fetches the full library + queue per request and `/api/status/batch` can fall back to per-id upstream lookups; only login has a rate limit, and request bodies have no size cap. | LAN-trust threat model is documented; adding throttles/body caps is a product/policy decision, not a defect fix. |
| D-10 | Low (inferred) | Console library `PATCH` validates payload shape but not that `qualityProfileId`/`rootFolderPath`/tag ids exist on the live instance; a stale UI can send values the arr rejects. | Admin-only surface; the arr's own validation is the current guard. Fix would mirror the preset live-validation seam. |
| D-11 | Low | Settings does not surface a failed default-preset repair: `POST /api/services` reports `defaultPreset`/note but the UI only shows "Connected", so a service with no quality profile/root folder looks ready while member Add fails. | Requires a component change and the repo has no Svelte component harness; the API already returns the information. |
| D-12 | Low | Dev mock fidelity gaps: no `POST /api/v3/series` support and limited queue payload shapes, so Sonarr add-path and some real-payload claims remain inferred. | Tooling improvement, not shipped behaviour; documented as a limitation. |

## 7. Verification results

| Check | Command | Result |
| --- | --- | --- |
| Unit + route tests | `npm test` | **101 passed, 0 failed** (baseline 84; +13 round-1 tests in 4 new files, +4 round-2 tests in existing suites) |
| Pre-fix reproduction (round 2, final test set) | `git checkout 05f56d7 -- package-lock.json README.md scripts src && npm test`, then `git checkout HEAD -- …` | **101 tests / 92 passed / 9 failed** — all failures are intended regression tests |
| Types / Svelte | `npm run check` | **0 errors, 0 warnings** |
| Production build | `npm run build` | **success** (only the pre-existing `node:sqlite` external warning + empty `ConfirmDialog` chunk warning) |
| Script syntax | `node --check scripts/{serve,service,mock-arrs,icons}.mjs` | all pass |
| Lockfile consistency | `npm ci --dry-run` | `up to date` (pre-fix: two phantom `change` lines) |
| Runtime probes | isolated server + mock arrs (§5) | all expected |
| Repo DB safety | `shasum -a 256 data/addarr.db` | unchanged `b8dcae173dcde760df7c08024fb1e0b64707964c05f609bd2b4a784f2088df6e` |
| Pre-existing state | `git status` | only `?? .scratch/` (untouched) |

Files changed by this audit (round 1 fix commit `dac73fa`, round 2 fix commit `9b24b7a`; report/map in the follow-up docs commits):

```
package-lock.json                              scripts/mock-arrs.mjs
scripts/serve.mjs                              scripts/service.mjs
src/lib/server/db.ts (+ db.test.ts)            src/lib/lockfile.test.ts (new)
src/lib/arr/search-merge.ts (new)              src/lib/arr/search-merge.test.ts (new)
src/routes/+page.svelte                        src/routes/api/add/+server.ts
src/routes/api/search/+server.ts               src/routes/api/status/[kind]/[id]/+server.ts
src/routes/login/+page.server.ts               src/routes/route-handlers.test.ts (new)
src/routes/settings/+page.svelte               README.md
docs/audits/2026-11-12-code-quality-audit.md (this report)  docs/agents/codebase-map.md
```

Round 2 additionally re-touched `src/lib/arr/search-merge.ts` + test, `src/routes/api/add/+server.ts`, `src/routes/route-handlers.test.ts`, `src/lib/server/db.test.ts` (test IDs), `scripts/mock-arrs.mjs`, `scripts/service.mjs`, `docs/agents/codebase-map.md` and this report. No dependency, version, build-config, or data-file changes; `package.json` is untouched.

## 8. Limitations

- **No live Radarr/Sonarr.** All arr behaviour was exercised against `scripts/mock-arrs.mjs` plus loopback fake servers; real-arr-specific claims are marked inferred where relevant (D-05, D-10).
- **Service lifecycle commands were not executed** (install/uninstall/start/stop/restart/tray/mDNS/restart endpoint), per constraints; AUD-08/AUD-09 and D-02/D-03 are code-review evidence (`node --check` + inspection), with Windows behaviour inferred from the generated script.
- **No browser/accessibility harness.** AUD-03's page-side effect was verified through the extracted pure merge unit tests plus route probes and the pre-fix code path, not a rendered browser; AUD-10 is a strings/source comparison.
- **Icon-fallback paths (AUD-08, round 2) were not executed**: installing/starting the host service or writing `~/Applications`/Start-menu artifacts is forbidden here, so macOS/Windows fallbacks are code-review + `node --check` evidence only.
- **Registry state was checked at audit time** (`npm view`) to confirm 1.0.0 is the only published version of the two AUD-01 packages; a future publish of 1.0.1 would make the pre-fix lockfile merely stale rather than wrong.
- The findings are audit-scoped; green `npm test`/`check`/`build` is not proof of absence, particularly for the deferred platform/lifecycle and feature-gap items.

## 9. Verification follow-up (round 2)

An independent verifier (separate audit round) reviewed round 1: all 10 findings were substantively verified — fixes correct, pre-fix failures reproduced, gates independently green (`npm test` 97/97, `npm run check` 0/0, `npm run build` success, lockfile truthful with `npm ci --dry-run` up to date) — with no High/Critical new defects. It raised three residual defects, one refinement question on AUD-05, and four report corrections. Everything was reproduced, fixed minimally and re-tested; **no item was rejected and none of the round-2 items is deferred**.

| ID | Round-1/verifier issue | Fix | Test / evidence |
| --- | --- | --- | --- |
| AUD-03-R | **Medium:** false red "The library is not connected yet — ask an admin to finish Settings." when one kind is unconfigured and the *connected* kind simply has 0 results for the term (common one-service household). Repro: `mergeSearchResponses(['movie','series'], [{results: []}, {results: [], unconfigured: true}])` returned `LIBRARY_NOT_CONNECTED`. | `mergeSearchResponses()` reports the setup message only when **no requested kind is connected** (`unconfigured === kinds.length`); a connected empty search is "Nothing found". `src/lib/arr/search-merge.ts:65`. | `src/lib/arr/search-merge.test.ts` +2: "connected library with zero matches is nothing found, not a setup error" (fails round-1 merge) and "single requested kind that is not connected still reports settings". **1 failed pre-fix** (recorded). |
| AUD-05-R | **Low:** 429 rate-limit and lookup-404 got the admin-preset wording; the intended 404 "not found" branch is dead when the arr itself answers 404. | `/api/add` now classifies the arr answer: `404` "That title is not available in the library right now.", `429` "The library is busy — try again in a moment.", other 4xx rejected/admin wording, 5xx/network outage. Accepted and fixed (not deferred). `src/routes/api/add/+server.ts:113-142`. | `src/routes/route-handlers.test.ts` +2 with a configurable loopback fake arr: lookup 404 → 404 not-available; lookup 429 → 429 busy. **2 failed pre-fix** (both returned the round-1 admin wording). |
| AUD-07-R | **Low:** the same unhandled-rejection crash existed on the mock's real arr route `POST /api/v3/movie` (AUD-07 guarded only `/__mock/*`). Probe: HTTP 000, fatal stack, pid gone. | The arr `POST /api/v3/movie` handler guards `readBody` exactly like the control routes: parse failure → `400 {"error":"invalid JSON"}`, non-object → 400. `scripts/mock-arrs.mjs:69-76`. | Runtime re-verified: pre-fix HTTP **000**, pid dead; post-fix `400 {"error":"invalid JSON"}`, same pid kept serving and accepted a valid seed. No unit test (top-level script). |
| AUD-08-R | **Low:** `macWriteApp()` and `winWriteLauncher()` still called `ensureIcons()` unguarded, so an icon-generation failure aborts the macOS (this host) and Windows install after the plist/unit is written. AUD-08 had fixed only Linux. | Both remaining call sites use the same try/catch fallback as Linux (`icnsPath`/`icoPath`/`png32Path` default to absent); a missing icon never aborts the install. `scripts/service.mjs:280`, `:662`. | `node --check scripts/service.mjs` + code review (executing install paths on the host is forbidden); no behaviour change when icons generate. |

Report corrections requested by the verifier and applied:

- **(a) Pre-fix counts.** The round-1 row `95 tests / 88 pass / 7 fail` was measured while the merge helper was being extracted, not from the baseline tree. §2 now records the round-2 reproduction on the final test set: `git checkout 05f56d7 -- package-lock.json README.md scripts src && npm test` (new tests kept) → **101 tests / 92 passed / 9 failed**, every failure an intended regression test; restore with `git checkout HEAD -- …` afterwards. The verifier's independent pre-fix reproduction of the round-1 suite reported **93 / 85 / 8** for the same failure classes; both figures supersede the round-1 intermediate number.
- **(b) Test IDs.** `src/lib/server/db.test.ts` named the two DB-permission tests `AUD-10`; renamed to **AUD-06** as in this report.
- **(c) Codebase map.** `docs/agents/codebase-map.md` omitted the new `src/lib/arr/search-merge.ts`; added to the Layers row, the "Member search and poster cards" row, and the File index (and the test inventory was updated to 101 tests).
- **(d) AUD-10 wording.** The fix did not make Settings state the instance name; README and the startup log state `Addarr on <hostname>` and the Settings label was reduced to "discoverable via mDNS/Bonjour". §4 corrected.

Round-2 fix commit is `9b24b7a` (`fix: address audit verification follow-ups`). Round-2 gate at `9b24b7a`: `npm test` → **101 passed, 0 failed**; `npm run check` → **0 errors, 0 warnings**; `npm run build` → **success**; `node --check` on all four scripts → OK. `data/addarr.db` SHA-256 unchanged (`b8dcae17…88df6e`); no push, version bump, tag, release, or host service command.
