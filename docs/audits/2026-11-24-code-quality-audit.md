# addarr — code-quality and security audit (2026-11-24)

> **Status: report only.** No file in this repository was modified. Every finding carries a
> proposed fix for review; no regression test was added and no version file was touched.
> Gates at audit: `npm test` 101/101, `npm run check` clean, `npm run build` success.


**Two passes.** This report is the first of two. The first pass (AD-01 … AD-09) read every
source file once; the adversarial second pass appended at the end of this document
(AS-01 … AS-06, plus corrections to AD-04 and AD-06) re-examined the security lanes where a
single reader is most likely to under-report. Read both: **15 findings total — 0 Critical,
0 High, 8 Medium, 7 Low.**

## Baseline

- **Commit:** `c77e84b` (`chore(release): v1.0.2`) on `main`; `git status` before and after the audit: only `?? .scratch/` (untouched). No repository file was created, modified, or deleted by this audit.
- **Gates (run at audit start and re-run at the end):**

| Gate | Result |
| --- | --- |
| `npm test` (`node --test "src/**/*.test.ts"`) | **101 tests, 101 pass, 0 fail**, 565 ms |
| `npm run check` (svelte-check, tsconfig) | **0 errors, 0 warnings** |
| `npm run build` (adapter-node) | **success** (2.1 s; only the pre-existing `node:sqlite` external-dependency warning and the empty `ConfirmDialog` chunk warning) |
| `npm ci --dry-run` | no dependency changes (only npm's `install-scripts` warnings) — the 2026-11-12 AUD-01 lockfile corruption is still fixed |
| `node --check scripts/{serve,service,mock-arrs,icons}.mjs` | all pass |

- **LOC in scope:** 11,596 lines across `src/**` + `scripts/**` (`.ts`, `.svelte`, `.mjs`, `.css`): 7,511 non-test `src` (of which 3,658 is Svelte), 1,831 colocated tests, 1,708 `scripts/`, 546 `src/app.css`. `static/` holds one 253-byte SVG.

## Scope and method

**Read in full:** `AGENTS.md`, `docs/agents/codebase-map.md`, `GLOSSARY.md`, `PRODUCT.md`, `README.md` (features, first-run, LAN, API, security), `docs/audits/2026-11-12-code-quality-audit.md`, and every source file in scope: all 12 `.svelte` files (9 route pages including `+layout.svelte`, plus the 3 components), all 18 `+server.ts`/`+page.server.ts`/`+layout.server.ts` modules (search, add, status single+batch, downloads, files, presets, services, console, activity, auth ×3, settings/lan, restart, arrapi passthrough), all of `src/lib/arr/` (client, radarr, sonarr, status, downloads, files, presentation, preset-input, search-merge, add-resource, service-url, types), all of `src/lib/server/` (db, auth, presets, admin-gating, passthrough, arr-factory), `src/lib/components/` (DownloadSheet, PresetForm, ConfirmDialog), `src/lib/actions/modal.ts`, `src/hooks.server.ts`, `src/app.html`, `src/app.d.ts`, all four `scripts/*.mjs`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `package.json`, and all 17 test files (1,831 lines).

**Deliberately skipped** (per the codebase map's "Don't read" set, or per instructions): `node_modules/`, `.svelte-kit/`, `build/`, `data/`, `.scratch/`, `package-lock.json` (verified only via `npm ci --dry-run`), `PLAN.md` (targeted greps only), `docs/audits/*` other than the most recent, `docs/addarr_demo.gif`, `LICENSE`.

**Probes** — all throwaway, under `/tmp/code-audit/probes/`, none inside the repo; each imports the real module against a temp `ADDARR_DB` in `mktemp -d` or replicas the exact shipped expression:
- `p1-timeleft.mjs` — `formatTimeLeft` boundary sweep (pure module).
- `p2-pid.mjs` — the PID file written by `scripts/serve.mjs` parsed by `scripts/service.mjs`'s `readPid()` and by the `[int]::TryParse` the generated PowerShell tray uses.
- `p3*.mjs`, `p7-console-effect.mjs` — investigation of Svelte 5 effect semantics; `p7` compiles the real `console/+page.svelte` and prints the emitted `$.user_effect`/`load()`.
- `p8/` — the decisive one: a 6-line Svelte 5 component with the console page's exact effect shape, compiled with the repo's compiler and mounted with the repo's runtime under a minimal DOM stub.
- `p4-nullbody.mjs` — calls 8 real route handlers with a literal `null` JSON body.
- `p5-search-amp.mjs` — real `/api/search` handler against a fake Radarr with a 5,000-movie library and a 600-row queue; counts upstream calls and bytes.
- `p6-login-map.mjs` — 20,000 real `POST /api/auth/login` calls with distinct usernames, heap measured with `--expose-gc`.
- `p9-status-n1.mjs` — real `/api/status/batch` + `/api/status/:kind/:id` handlers against a fake Radarr (1,200-row queue) and a fake Sonarr whose `/queue` returns 500; counts upstream calls for one member-page poll tick.
- `p10-calendar-tz.mjs` — console calendar window and timestamp rendering under `TZ=America/Detroit`.

No live Radarr/Sonarr, no browser, no host service command was used.

## Findings

### AD-01 — Console History and Blocklist pagination resets itself to page 1

- **Severity:** Medium
- **Confidence:** High
- **Class:** correctness
- **Location:** `src/routes/console/+page.svelte:109`, `src/routes/console/+page.svelte:85`, `src/routes/console/+page.svelte:424`, `src/routes/console/+page.svelte:485`
- **Code:**
```svelte
	$effect(() => {
		tab;
		service;
		libPage = 1;
		histPage = 1;
		blockPage = 1;
		load();
		loadSummary();
	});
```
```svelte
			const pageQs = tab === 'history' ? `&page=${histPage}` : tab === 'blocklist' ? `&page=${blockPage}` : '';
```
```svelte
<button class="secondary" disabled={((data.items as unknown[]) ?? []).length < 25 || loading} onclick={() => { histPage++; load(); }}>Next</button>
```
- **Defect:** `load()` reads `histPage` (and `blockPage`) synchronously inside the effect body, so both are dependencies of that effect — while the same effect also writes them back to `1`. Clicking **Next** on the History tab does `histPage++` (2) and starts a `page=2` request; the effect then re-runs because `histPage` changed, sets it back to `1`, and re-runs once more for its own write, replacing the page-2 response (`loadSeq` supersedes it) with page 1. Resetting paging to 1 when the tab or service changes is legitimate; the defect is doing it inside an effect that also *reads* those same values. The Library tab is unaffected because the effect only *writes* `libPage` and never reads it. Trigger: Console → History (or Blocklist) → **Next**.
- **Impact:** History and Blocklist are stuck on page 1 forever (`Previous` is always disabled); everything past the newest 25 events is unreachable in the curated console, and each click fires three requests (page 2, page 1, page 1) plus two `summary` fetches.
- **Proposed fix:** move the reset out of the reactive read path — e.g. reset inside `setTab`/`setService` only, or make the effect read the page values through `untrack` (or pass the page number as an argument to `load(page)` and keep the effect writing nothing it reads):
  `$effect(() => { tab; service; untrack(() => { libPage = 1; histPage = 1; blockPage = 1; }); load(); loadSummary(); });`
- **Evidence:** `/tmp/code-audit/probes/p8` mounts a component with exactly this shape (compile with the repo's `svelte/compiler`, run with the repo's `svelte` runtime). Observed:
  `after Next   : load page=2 | load page=1 | load page=1 | page = 1`.
  `/tmp/code-audit/probes/p7-console-effect.mjs` compiles the real page and shows the emitted effect body as `$.get(tab); $.get(service); $.set(libPage, 1); $.set(histPage, 1); … load();` with `load()` emitting `` `&page=${$.get(histPage)}` ``.

### AD-02 — Windows: the PID file cannot be parsed, so status/stop/restart silently do the wrong thing

- **Severity:** Medium
- **Confidence:** High
- **Class:** correctness
- **Location:** `scripts/serve.mjs:251`, `scripts/service.mjs:214`, `scripts/service.mjs:565`, `scripts/service.mjs:741`
- **Code:**
```js
// scripts/serve.mjs:251  (writePidFile)
		writeFileSync(pidPath, `${process.pid} ${Date.now()}\n`);
```
```js
// scripts/service.mjs:212-216
function readPid() {
	try {
		const pid = Number(readFileSync(PID_PATH, 'utf8').trim());   // "51234 1795529322443"
		return Number.isInteger(pid) && pid > 0 ? pid : null;        // -> NaN -> null
```
```powershell
# scripts/service.mjs:562-568 (generated tray script)
function Get-ServerPid {
  if (-not (Test-Path $PidFile)) { return 0 }
  $raw = Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  $serverPid = 0
  if ([int]::TryParse($raw, [ref]$serverPid) -and (Get-Process -Id $serverPid -ErrorAction SilentlyContinue)) { return $serverPid }
  return 0
}
```
- **Defect:** `serve.mjs` writes two space-separated fields (`pid`, start time) into `data/addarr.pid`; both readers parse the *whole line* as one integer. `Number("51234 1795…")` is `NaN` (→ `readPid()` always `null`), and .NET `[int]::TryParse` on that string is `false` (→ `Get-ServerPid` always `0`). Trigger: any `npm run status`, `npm run stop`, `npm run restart`, or tray menu action on Windows, where `readPid()` is the only way `windows.running()`/`windows.stop()` find the server.
- **Impact:** On Windows only — `npm run status` always reports "not running"; `npm run stop` never runs `taskkill`, deletes the PID file and prints "Addarr stopped." while the server keeps serving the LAN; the tray's **Stop server / Restart server / Quit Addarr** are no-ops, so "Quit" leaves the app reachable; `npm run restart` concludes "Addarr was not running — starting it", spawns a second launcher whose server then refuses to start ("Another Addarr instance … refusing to start", `scripts/serve.mjs:242-243`) and reports "Addarr restarted at …" against the old process — so a code update or a baked-in `HOST`/`--lan` change never takes effect.
- **Proposed fix:** in `service.mjs` read only the first field (`readFileSync(PID_PATH,'utf8').trim().split(/\s+/)[0]`), and generate `Get-ServerPid` with `$raw = (Get-Content $PidFile -First 1).Split(' ')[0]` — or write the bare pid into the file and the start time into a second file.
- **Evidence:** `/tmp/code-audit/probes/p2-pid.mjs` writes the exact `serve.mjs` payload and applies both readers:
  `file contents: "71723 1795529322443\n"` / `service.mjs readPid() -> null  (expected 71723)` / `Number("12345 1699999999999") -> NaN` / `Get-ServerPid raw line: … -> [int]::TryParse accepts? false`. Code trace for the consequences: `scripts/service.mjs:741-748` (windows `running`/`stop`), `:868-877` (`commandRestart`), `scripts/serve.mjs:242-243` (duplicate-instance refusal).

### AD-03 — Every member search hydrates the entire library and the entire download queue

- **Severity:** Medium
- **Confidence:** High
- **Class:** performance
- **Location:** `src/lib/arr/radarr.ts:143`, `src/lib/arr/sonarr.ts:129`, `src/routes/api/search/+server.ts:32`, `src/routes/api/add/+server.ts:58`, `src/routes/api/add/+server.ts:83`
- **Code:**
```ts
	async toPosterCards(lookupResults: RadarrMovie[]): Promise<PosterCard[]> {
		const [library, queue] = await Promise.all([this.allMovies(), this.queue()]);
		const byTmdb = new Map(library.map((m) => [m.tmdbId, m]));
```
```ts
	async queue(options: { includeMovie?: boolean } = {}): Promise<Record<string, unknown>[]> {
		const params = new URLSearchParams({ pageSize: '200' });
		const all: Record<string, unknown>[] = [];
		for (let page = 1; page <= 100; page++) {
			params.set('page', String(page));
			const res = await this.raw<Paged<Record<string, unknown>>>('GET', `/queue?${params.toString()}`);
```
```ts
			return json({ service: 'radarr', results: await client.toPosterCards(await client.lookup(q)) });
```
- **Defect:** `toPosterCards()` runs on every search and pulls `GET /movie` (the whole library, with `overview`, `images`, `movieFile`, …) plus the whole paginated `GET /queue`, solely to answer "is this title already in the library, and what is its queue progress" for ≤10 lookup hits. Nothing is cached, and "All" mode issues two such requests per query. `/api/add` repeats the pattern with `client.allMovies()` / `client.allSeries()` for its dedupe check. Trigger: type ≥2 characters in the member search box (350 ms debounce, `src/routes/+page.svelte:114`).
- **Impact:** measured on a synthetic 5,000-movie / 600-queue-row instance: **5 upstream requests and 3.1 MB read from Radarr to produce a 6 KB, 10-card response** (`/api/v3/movie` alone is 2.9 MB). On a Pi-class host with a large library this is seconds of arr CPU and disk per keystroke pause, for every household member at once, and it scales linearly with library size; there is no rate limit on `/api/search` (prior D-09).
- **Proposed fix:** stop fetching the library. Radarr/Sonarr lookup results for titles already added carry the library resource (`id`, `hasFile`, `isAvailable`, `monitored`/`statistics`); use that for `inLibrary` + `movieStatus`/`seriesStatus`, and fetch queue rows only for the hit ids (`GET /queue?movieIds=…` / `?seriesIds=…`) — or cache the library+queue per service for ~15 s in `src/lib/server/`. The same change removes the full-library fetch in `/api/add`'s dedupe (use the lookup `id` instead). Verify the lookup payload against a live arr first (see *Needs runtime verification*).
- **Evidence:** `/tmp/code-audit/probes/p5-search-amp.mjs` (real handler, fake arr):
  `upstream requests for one search: 5` — `lookup?term=dune`, `/movie`, `/queue?pageSize=200&page={1,2,3}`; `upstream response bytes: 3116878`; `browser response: 200 | bytes: 6355 | cards: 10`.

### AD-04 — One arr queue failure turns the 5-second status poll into N full-queue polls

- **Severity:** Medium
- **Confidence:** High
- **Class:** performance
- **Location:** `src/routes/+page.svelte:201`, `src/routes/api/status/[kind]/[id]/+server.ts:26`, `src/routes/api/status/batch/+server.ts:31`
- **Code:**
```ts
						if (!data) {
							const res = await fetch(`/api/status/${card.kind}/${card.watchId}`);
							if (!res.ok) continue;
							data = (await res.json()) as NonNullable<typeof data>;
						}
```
```ts
	try {
		const client = getClient(kind === 'movie' ? 'radarr' : 'sonarr');
		const queue = await client.queue();          // full paginated queue, per single item
```
```ts
			const [queue, library] = await Promise.all([client.queue(), client.allMovies()]);
```
- **Defect:** `/api/status/batch` is all-or-nothing: if *either* connected service's `/queue` fails, the whole batch answers 502 and the page's per-card fallback runs for every watched card — and each `/api/status/:kind/:id` call re-fetches the *entire* queue (and, for Sonarr, then `GET /series/:id`). The page's timer then re-arms at 5 s because a card is still `downloading`. Trigger: a single upstream hiccup (arr restart, 500, 15 s client timeout) while any poster card is downloading.
- **Impact:** measured with a 1,200-row queue and 6 watched cards: **32 upstream requests per poll tick, 30 of them queue pages** (6 pages × 5 movie cards), repeated every 5 s until the arr recovers — a load spike aimed at an arr that is already unwell, while the member UI keeps showing stale badges (the per-card calls also fail).
- **Proposed fix:** make the batch route per-service (`Promise.allSettled` like `/api/downloads`) and return `{ movies, series, errors }` so one service's outage cannot discard the other's data; drop the per-card fallback in the page in favour of "keep last known state + quiet unavailable hint"; and make `/api/status/:kind/:id` use `GET /queue?movieIds=<id>` / `?seriesIds=<id>` instead of the full queue.
- **Evidence:** `/tmp/code-audit/probes/p9-status-n1.mjs` (real handlers, fake arrs) — Sonarr `/queue` returns 500, so the batch is 502; the fallback for 5 movie cards + 1 series card produced:
  `{ 'radarr /api/v3/queue??pageSize=200&page=1': 5, … 'page=6': 5, 'sonarr /api/v3/series': 1, 'sonarr /api/v3/queue': 1 }` → **32 calls**.

### AD-05 — A JSON `null` body is a 500 on five POST routes

- **Severity:** Low
- **Confidence:** High
- **Class:** correctness
- **Location:** `src/routes/api/add/+server.ts:25`, `src/routes/api/services/+server.ts:26`, `src/routes/api/settings/lan/+server.ts:51`, `src/routes/api/auth/login/+server.ts:61`, `src/routes/api/auth/setup/+server.ts:15`
- **Code:**
```ts
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const kind = body.service;
```
- **Defect:** `JSON.parse('null')` succeeds, so the `try/catch` does not fire and the property access throws `TypeError: Cannot read properties of null` outside the routes' own error handling; SvelteKit turns that into a 500 with a stack trace in the log. `POST /api/presets` and `POST /api/console/*` happen to answer 400 first only because they validate a query-string parameter before touching the body. Trigger: `curl -X POST …/api/auth/login -d null`, or any client that serialises `null`. Two of the five are reachable without a session (`/api/auth/login`, `/api/auth/setup`).
- **Impact:** wrong status class for a client error, 500-level noise in `data/addarr.log` for garbage traffic, and an inconsistency the next endpoint will copy. No data or auth consequence (the session was never created).
- **Proposed fix:** either reject non-objects once per route — `if (!body || typeof body !== 'object') return json({ error: 'object body required' }, { status: 400 })` — or read with `await request.json().catch(() => null)` and keep a single shape check; `scripts/mock-arrs.mjs:25` already uses this pattern.
- **Evidence:** `/tmp/code-audit/probes/p4-nullbody.mjs` (real handlers, temp DB), body = `null`:
  `POST /api/add -> THREW TypeError … (reading 'service')`, `POST /api/services -> THREW TypeError … (reading 'type')`, `POST /api/settings/lan -> THREW … (reading 'enabled')`, `POST /api/auth/login -> THREW … (reading 'username')`, `POST /api/auth/setup -> THREW … (reading 'username')`; `/api/presets` and `/api/console` returned 400/503 because of the query-parameter check.

### AD-06 — The login backoff table cannot evict fresh keys

- **Severity:** Low
- **Confidence:** High
- **Class:** concurrency
- **Location:** `src/routes/api/auth/login/+server.ts:21`, `src/routes/api/auth/login/+server.ts:46`, `src/routes/api/auth/login/+server.ts:61`
- **Code:**
```ts
function recordFailure(key: string): void {
	const now = Date.now();
	const entry = attempts.get(key);
	if (!entry || now - entry.first > WINDOW_MS) {
		attempts.set(key, { count: 1, first: now });
	} else {
		entry.count++;
	}
	// Opportunistic prune so the map can't grow unbounded.
	if (attempts.size > 500) {
		for (const [k, v] of attempts) {
			if (now - v.first > WINDOW_MS) attempts.delete(k);
		}
	}
}
```
- **Defect:** the key is `username@ip` and the username is attacker-controlled; the prune only deletes entries *older than the 10-minute window*, so inside any window nothing is ever removed and the map grows one entry per distinct username. The cheap path costs no argon2 and no SQLite work, because an invalid username returns 401 right after `recordFailure` (`src/routes/api/auth/login/+server.ts:69-72`). Trigger: repeated `POST /api/auth/login {"username":"x1!","pin":"0"}`, `x2!`, … from the LAN.
- **Impact:** unbounded process memory on an unauthenticated route (measured ~300 B/key: 20,000 distinct usernames → heap 8.9 MB → 15.1 MB with nothing collected); the same loop can also keep the server's CPU busy. LAN-only, so DoS-by-neighbour rather than drive-by.
- **Proposed fix:** cap the table by size, not age — e.g. after the prune, `if (attempts.size > MAX_KEYS) { for (const k of attempts.keys()) { attempts.delete(k); if (attempts.size <= MAX_KEYS) break; } }` — and key the global backoff on the IP alone as well, so `MAX_ATTEMPTS` cannot be multiplied by username churn.
- **Evidence:** `/tmp/code-audit/probes/p6-login-map.mjs` (real handler): `20000 distinct bad usernames -> statuses [401]`, `heap before: 8893 KB` → `heap after: 15064 KB` — the heap grows with the number of distinct usernames and never shrinks inside the window.

### AD-07 — Member-visible ETA renders as "1h 60m"

- **Severity:** Low
- **Confidence:** High
- **Class:** correctness
- **Location:** `src/lib/arr/presentation.ts:109`
- **Code:**
```ts
export function formatTimeLeft(seconds: number): string {
	if (seconds < 60) return 'under a minute';
	if (seconds < 90 * 60) return `${Math.round(seconds / 60)}m`;
	return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}
```
- **Defect:** the minutes component is rounded instead of floored, so any value whose `seconds % 3600` rounds up to 60. Trigger: a download whose *arr `timeleft` is `01:59:59` (a completely ordinary value two hours before completion) rendered by the poster card (`src/routes/+page.svelte:252`), the Downloads row (`src/routes/downloads/+page.svelte:161`) or the detail sheet (`src/lib/components/DownloadSheet.svelte:186`).
- **Impact:** the household reads "1h 60m left" (also "5h 60m"), which looks broken in the one place the product promises plain, trustworthy progress copy.
- **Proposed fix:** `const m = Math.floor((seconds % 3600) / 60);` and carry: `return `${Math.floor(seconds / 3600)}h ${String(m).padStart(2, '0')}m`` (or round to the nearest minute before splitting: `const total = Math.round(seconds / 60)`).
- **Evidence:** `/tmp/code-audit/probes/p1-timeleft.mjs` (real module): `7199 -> "1h 60m"`, `10799 -> "2h 60m"`, `21599 -> "5h 60m"`; `3600 -> "60m"`, `7200 -> "2h 0m"` show the surrounding behaviour.

### AD-08 — Console calendar window and timestamps are UTC, presented as local

- **Severity:** Low
- **Confidence:** High
- **Class:** correctness
- **Location:** `src/routes/api/console/[...path]/+server.ts:130`, `src/routes/api/console/[...path]/+server.ts:132`, `src/routes/console/+page.svelte:281`
- **Code:**
```ts
			case 'calendar': {
				const days = Math.min(Math.max(num(url, 'days') ?? 14, 1), 60);
				const start = new Date();
				const end = new Date(Date.now() + days * 86400_000);
				const fmt = (d: Date) => d.toISOString().slice(0, 10);
```
```ts
	function when(item: Record<string, unknown>): string {
		return String(item.date ?? item.airDateUtc ?? item.when ?? '').replace('T', ' ').slice(0, 16);
	}
```
- **Defect:** both ends of the `/calendar?start=&end=` window are the UTC calendar date, and the arr's UTC timestamps (`airDateUtc`, `digitalRelease`) are printed by chopping the `T` without any offset conversion. Trigger: any household whose local time is not UTC (the app's own examples are US-hosted) — in particular a calendar opened after 19:00/20:00 local, when UTC has already rolled over to tomorrow, and any episode whose `airDateUtc` falls near midnight UTC.
- **Impact:** the console calendar is systematically one day ahead in the evening: in `America/Detroit` at 20:30 local the window starts *tomorrow*, so tonight's releases are missing; a series episode airing at 21:00 local is listed as "2026-11-25 02:00" (the next day, four hours off). Contrast `src/routes/activity/+page.svelte:51-55`, which correctly appends `Z` before formatting.
- **Proposed fix:** compute the window from local dates (`const fmt = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)`, or build `YYYY-MM-DD` from `getFullYear/getMonth/getDate`), and render arr timestamps through `new Intl.DateTimeFormat(undefined, { dateStyle:'short', timeStyle:'short' })` instead of string slicing.
- **Evidence:** `/tmp/code-audit/probes/p10-calendar-tz.mjs` with `TZ=America/Detroit`: `local date: 2026-11-24` vs `calendar start: 2026-11-25` (`shifts by a day: true`), and `rendered "when": 2026-11-25 02:00` vs `actual local: 2026-11-24, 9:00 p.m.`.

### AD-09 — Member labels contradict the glossary's member vocabulary

- **Severity:** Low
- **Confidence:** High
- **Class:** correctness
- **Location:** `src/lib/arr/presentation.ts:17`, `src/lib/arr/presentation.ts:18`, `GLOSSARY.md:27`, `GLOSSARY.md:19`
- **Code:**
```ts
export const MEMBER_STATE_LABEL: Record<Exclude<ArrItemState, 'available'>, string> = {
	waiting: 'Looking for it…',
	queued: 'Queued',
	paused: 'Paused',
	downloading: 'Downloading…',
	importing: 'Importing…',
	partial: 'Episodes',
	attention: 'Waiting',
	missing: 'Missing',
	unreleased: 'Unreleased'
};
```
```
**Still looking**:
The member-facing state of a monitored title whose released content hasn't been found or downloaded yet. …
_Avoid_: Missing, wanted (admin-side state names)

**Not out yet**:
… _Avoid_: Unreleased (the admin-side state name)
```
- **Defect:** `GLOSSARY.md` — the doc `AGENTS.md` designates as the source of member-visible state names — names the member-facing states **Still looking** and **Not out yet** and explicitly lists `Missing`/`Unreleased` as admin-side words to avoid, yet `MEMBER_STATE_LABEL` (used by the poster badge, `Downloads` rows and the detail sheet) ships exactly those two words. Trigger: any poster card or download row in `missing`/`unreleased`.
- **Impact:** the household's primary screen shows *arr vocabulary, which the product's first principle ("one tap, zero jargon … must never show an *arr concept") and the glossary both forbid; `GLOSSARY.md` therefore no longer describes the shipped app, so the next contributor changing member copy is being pointed at the wrong contract.
- **Proposed fix:** rename in `presentation.ts` (`missing: 'Still looking'`, `unreleased: 'Not out yet'`) and update `src/lib/arr/presentation.test.ts:13` — or, if the shipped words are the intended ones, update `GLOSSARY.md` so the two agree.
- **Evidence:** read-only comparison of the two sources quoted above; `src/lib/arr/presentation.test.ts` asserts only that labels "hide problem-state jargon" for `attention`/`partial`, so the suite cannot catch this.

## Checked and clean

- **Auth/session lane** — `src/lib/server/auth.ts`: 256-bit `base64url` session ids, argon2id (19 MiB/2 passes) with a per-store 16-byte nonce, `timingSafeEqual` for PIN verify, a real hash (not a string compare) for unknown/disabled users (`DUMMY_HASH`, cost-matched), ISO-timestamp expiry comparison (`AUD-09` comment is correct), rolling renewal only past half-life, opportunistic prune, `httpOnly` + `sameSite=lax` + `path=/` (no `secure` by design, documented for LAN http), logout deletes the row and the cookie.
- **Admin gating lane** — `src/lib/server/admin-gating.ts` + `src/hooks.server.ts`: every admin surface is covered (`/settings /presets /console /activity /api/{services,presets,console,activity,settings,restart} /arrapi`); I enumerated every route module (18 `+server.ts`/`+page.server.ts` files plus the 9 page routes) and found no admin surface missing from `ADMIN_PREFIXES`. Matching is `path === prefix || startsWith(prefix + '/')` on both raw and decoded paths, so `%63onsole`-style spellings and prefix lookalikes (`/settingsfoo`) do not slip through; `redirect` targets are all literals (no open redirect).
- **Passthrough lane** — `src/lib/server/passthrough.ts` + `src/routes/arrapi/[service]/[...path]/+server.ts`: normalizes backslashes and dot segments *before* allow-listing and forwards the normalized path; rejects any target still containing `%` (double-encoded traversal); regexes are anchored with `\b`/`$`; the query string is appended after the path so it cannot introduce segments; host always comes from the `services` table (no SSRF via path); POST/PUT/DELETE/PATCH return 405; API key is injected server-side and `ArrClient.toJSON()` redacts it.
- **Secrets to the browser lane** — `GET /api/services` selects `id, type, name, base_url, app_version, enabled` only; `ArrClient` is never serialized into a page payload; `/api/search` and `/api/downloads` return only `PosterCard`/`DownloadItem` shapes (no release names, clients, paths, or keys).
- **Injection lane** — every SQL statement uses bound parameters (grep for `${` inside `prepare(...)` in `db.ts`, `presets.ts`, `auth.ts` and all routes: none); no `{@html}`, `innerHTML`, `eval`, or `new Function` anywhere in `src/`; Svelte escapes all *arr-supplied titles/overviews; `posterUrl()` only ever feeds `img src`.
- **`ArrClient` lane** (`src/lib/arr/client.ts`): 15 s `AbortSignal.timeout` on every upstream call, `redirect: 'error'` (no redirect to an internal host), non-JSON 200s become `ArrError(502)` rather than a `SyntaxError`, `204/205` and empty bodies handled, query strings built with `URLSearchParams`/`encodeURIComponent`.
- **State-derivation lane** — `src/lib/arr/status.ts`: precedence documented and implemented in one place (`warned → downloading → importing → paused → queued`), byte-summed progress clamped 0-100, `timeleft` parser rejects bad minutes/seconds and handles the `[d.]HH:MM:SS` form, Sonarr `episodeCount` (aired) is used as the denominator with `totalEpisodeCount` as fallback, `isPursuitState` suppression for unmonitored items is exactly as its tests describe.
- **Downloads lane** — `src/lib/arr/downloads.ts`: one row per `movieId`/`seriesId`, byte sums via `fieldNumber` (handles both `sizeleft` and `sizeLeft`), release titles never leak (`'Unknown title'` fallback), poster from library-or-nested media, deterministic sort, rows without an id dropped.
- **Preset lane** — `src/lib/arr/preset-input.ts` + `src/routes/api/presets/+server.ts`: shape validation before live validation, live validation only when an arr-side targeting field is actually present (`tags: []` no longer trips it), UNIQUE-name conflicts mapped to 409, the last preset cannot be deleted, deleting the default promotes another, `PATCH` scopes by `service_id` so a preset cannot be edited through the other service's URL.
- **First-run/setup lane** — `POST /api/auth/setup` is a single atomic `INSERT … WHERE NOT EXISTS (SELECT 1 FROM users)`; the `/setup` route is only reachable pre-first-run and admin paths answer 503 before setup rather than 401s; `/login` reports the real `hasAnyUser()` state (AUD-02 still fixed).
- **DB lane** — `src/lib/server/db.ts`: WAL + `foreign_keys=ON`, `users.disabled` migration is idempotent, `ensurePrivateDataDir` only tightens directories it created and always `chmod 0600`s the file and sidecars, every statement is synchronous (no interleaving inside `BEGIN…COMMIT` in `setDefaultPreset`/the presets PATCH).
- **LAN/restart handshake lane** — `/api/settings/lan` separates the persisted preference from live `broadcasting`/`boundLan`/`forced`, and returns `restartRequired` instead of pretending a localhost bind already serves the LAN; the Settings page re-reads the persisted state after a failure; `/api/restart` returns 501 when there is no launcher surface; `serve.mjs` re-reads `lan_enabled` at startup so a restart really applies the bind.
- **Timer/leak lane** — both polling `$effect`s return cleanups that clear their timers (`src/routes/+page.svelte:235-238`, `src/routes/downloads/+page.svelte:81-84`), the console/presets pages guard stale responses with sequence numbers, `DownloadSheet` discards stale file requests with `filesSeq` + `onDestroy`, and `modal.ts` removes its listeners, restores `inert`, and balances the scroll lock.
- **Mock/dev lane** — `scripts/mock-arrs.mjs` guards both control and `POST /api/v3/movie` bodies against malformed JSON (AUD-07 still fixed); `scripts/icons.mjs` failure fallbacks are in place on all three platforms (AUD-08).

## Prior-audit disposition

- **AUD-01 (lockfile corruption)** — FIXED. `npm ci --dry-run` reports no version changes; no phantom `is-module`/`supports-preserve-symlinks-flag` lines.
- **AUD-02 (fresh `/login` dead-end)** — FIXED. `src/routes/login/+page.server.ts` returns `hasAnyUser()`; `route-handlers.test.ts` covers both states and passes.
- **AUD-03 (one-service households saw a false error)** — FIXED. `src/lib/arr/search-merge.ts:65` reports `LIBRARY_NOT_CONNECTED` only when `unconfigured === kinds.length`; `/api/search` still answers `200 {unconfigured:true}` (verified in the 7 merge tests).
- **AUD-04 (status polling accepted non-positive ids)** — FIXED. `src/routes/api/status/[kind]/[id]/+server.ts:22` rejects `id <= 0`; route test green.
- **AUD-05 (add reported a rejection as an outage)** — FIXED. `src/routes/api/add/+server.ts:117-139` classifies 404/429/other-4xx/5xx; three route tests green.
- **AUD-06 (chmod of a pre-existing DB directory)** — FIXED. `ensurePrivateDataDir` records `existed` and returns early; `db.test.ts` covers both paths.
- **AUD-07 (malformed JSON killed the dev mock)** — FIXED. `scripts/mock-arrs.mjs:13-25` (control routes) and `:65-70` (the arr `POST /api/v3/movie`) reject instead of throwing in the `end` handler.
- **AUD-08 (icon failure aborted the install)** — FIXED on all three platforms (`scripts/service.mjs:280`, `:418`, `:662`).
- **AUD-09 (Windows tray probed hardcoded localhost)** — FIXED. The generated tray uses `$Url = '${url}'` (`scripts/service.mjs:542`) from `probeBase()`.
- **AUD-10 (docs claimed the wrong mDNS name)** — PARTIAL. `README.md:179` and `:262` and the startup log now say `Addarr on <hostname>`; `PRODUCT.md:42` still states the broadcast name is "Addarr" ("The name **Addarr** (also the mDNS/Bonjour broadcast name) is binding"). Not worth a finding on its own; fix if the phrasing is touched.
- **D-01 (Downloads whole-library scope)** — STILL PRESENT (unchanged): `/api/downloads` still lists only active queue rows, so *Not out yet / More coming / Still looking / Recently arrived* from `GLOSSARY.md` remain unimplemented. Feature gap, not a defect.
- **D-02 (service PID identity not verified before kill)** — STILL PRESENT **and worse than described**: `readPid()` does not read the pid at all (AD-02), so Windows `taskkill /PID … /T /F` and the tray's `Stop-Process` have been unreachable, and the start-time field `serve.mjs` writes is never compared.
- **D-03 (standalone restart handoff not failure-aware)** — STILL PRESENT: `scripts/serve.mjs:197-205` still spawns the replacement and calls `server.close(() => process.exit(0))` without a `child.on('error')`/early-exit guard; if the child cannot bind, the standalone app stays down. Note the `uncaughtException` handler (`scripts/serve.mjs:308`) exits 1 on a spawned-child `'error'` event, which is the same outcome.
- **D-04 (`GET /api/presets` is all-or-nothing)** — STILL PRESENT: `src/routes/api/presets/+server.ts:66` still 502s when the arr is unreachable, and `src/routes/presets/+page.svelte:55-56` then sets `presets = []` / `options = null`, hiding stored presets during an outage.
- **D-05 (Downloads series episode counts can be missing)** — STILL PRESENT by design: `queueNeedsLibrary()` keys off the nested title only; no new evidence either way without a live Sonarr.
- **D-06 (Blocklisted KPI capped at 25)** — STILL PRESENT (`src/routes/api/console/[...path]/+server.ts:53` uses `blocklist()` page 1).
- **D-07 (login abuse hardening is approximate)** — STILL PRESENT, and the table itself is unbounded (AD-06).
- **D-08 (maintainability leftovers)** — PARTIALLY CLEANED: the unused `total` local (`src/lib/arr/status.ts:126`) and the unused `tick` import in `src/routes/+layout.svelte:5` remain; `safeParseTags` is still duplicated in `src/routes/presets/+page.svelte:2` and `src/lib/components/PresetForm.svelte:2`; `createDefaultPreset` in `presets.ts` is still unused.
- **D-09 (unauthenticated member endpoints drive arr load)** — STILL PRESENT and quantified in AD-03/AD-04.
- **D-10, D-11, D-12** — unchanged (no new evidence); D-12 still blocks the Sonarr add path in the dev mock (`/api/v3/series` POST is not implemented).

## Test-coverage gaps

- **Console History/Blocklist paging** (AD-01) — no test reaches it today and the repo has no component harness (the `p8` probe under `/tmp` shows one is feasible with a stubbed DOM). Minimal regression: mount the page with a fake `$app/state`, click **Next**, assert the requested page; the cheaper structural fix is moving the reset into `setTab`/`setService`, which removes the self-dependency entirely.
- **Windows PID handling** (AD-02) — `scripts/service.mjs` is untested by design (no harness). Extract the two parsers (`readPidLine(text)`) into a tiny pure helper exported from `service.mjs` and unit-test `'123 1699…'` → `123`.
- **`/api/status/batch` partial failure** (AD-04) — no test at all. Add a `route-handlers.test.ts` case: Sonarr configured but `/queue` 500 → expect `{ movies: {...real states}, series: {}, errors: ['sonarr'] }` (currently expects a 502).
- **`/api/downloads`** — no route test despite being the second member surface: add a fake-arr case asserting title grouping, `size`/`sizeleft` sums, `errors[]` for one failing service, and `cache-control: no-store`.
- **`/api/files/:kind/:id`** — no route test: 503 when unconfigured, 404 passthrough vs 502 mapping, and that no `path`/`releaseGroup` field survives `normalizeSeriesFiles`.
- **`/arrapi` route** — `passthrough.ts` is well tested, but the route that wires `url.search` and the client is not: a case asserting `GET /arrapi/radarr/queue?pageSize=999999` forwards the query and that `POST` returns 405.
- **`/api/settings/lan` and `/api/restart`** — no tests: `managedExternally` (no `globalThis.__addarr`), the `boundLan=false` → `restartRequired` branch, and the 501-when-no-launcher path are all pure enough to test with a fake `globalThis.__addarr`.
- **`/api/auth/login|setup` rate limiting and the null-body path** (AD-05, AD-06) — add: 11th failed attempt → 429; a `null` body → 400; `setup` twice → 403.
- **`formatTimeLeft`** (AD-07) — add to `presentation.test.ts`: `7199 → '1h 59m'` (or `'2h 0m'`), and assert no output ever contains `' 60m'`.
- **Console calendar** (AD-08) — add a pure helper (`calendarWindow(now, days, tzOffset)` + `formatArrTime`) and test it under a fixed offset.
- **`add-resource` season policies** — `first`/`latest`/`none` are only partly covered (`all` is); add a series whose lookup has seasons `[0,1,2]` to pin the specials-dropping behaviour.
- **`summary`/KPI and console library mapping** — no tests for `statsText` or the `detail` mapping; low value but cheap.

## Needs runtime verification

- **Windows lifecycle end-to-end (AD-02).** Needs a Windows host: `npm start`, then `npm run status` (expect "running"), `npm run stop` (expect the process gone), `npm run restart`, and the tray's Stop/Restart/Quit with Task Manager open. This audit could only verify the parse failure and the code paths.
- **Real Radarr/Sonarr payload shapes for AD-03's fix.** Confirm that `GET /movie/lookup?term=` and `/movie/lookup/tmdb?tmdbId=` return the library `id`/`hasFile`/`isAvailable` for titles already added (and the Sonarr `tvdb:` equivalent), and that `/queue?movieIds=` filters — that is the prerequisite for dropping the full-library fetch.
- **Console pagination in a browser (AD-01).** `/console?tab=history`, click **Next**, watch the network panel: expect `&page=2` immediately superseded by two `&page=1` requests (probe-reproduced in isolation; a browser confirms it in situ).
- **Arr-stored strings and XSS.** Svelte escapes, but only a browser with a hostile title/overview (e.g. `<img onerror=…>` seeded via `scripts/mock-arrs.mjs`) can confirm the poster grid, Downloads rows, console tables and the detail sheet render it inert.
- **Timezone behaviour on a real host (AD-08).** Open the console Calendar at 20:30 local on a US-Eastern machine with a release dated "today" and confirm whether it is listed.
- **Restart handshake (D-03).** Standalone: `PORT=<busy port> node scripts/serve.mjs` after an in-app Restart, to confirm the old process exits and nothing comes back.
- **Login backoff under a realistic spray (AD-06).** Only a load generator against a running instance can say whether the 10-minute window is long enough to matter in practice.

---

## Second pass — adversarial security review (2026-11-24)

Baseline: `main` @ `c77e84b`. Repo untouched (`git status` before/after: only the pre-existing
`?? .scratch/` and `?? docs/audits/2026-11-24-code-quality-audit.md`); `npm test` 101/101 green.
All probes ran against a throwaway copy at `/tmp/code-audit/probes/pass2-addarr/app` (built with
`npx vite build`, `ADDARR_DB` under /tmp, ports 47531/47532, a fake Radarr on 47801 that logs every
upstream request line). No repo `data/` file was read or written.

### Lanes cleared (no finding)

- **Session token generation / lookup / expiry / logout** — 256-bit `randomBytes(32).toString('base64url')` (`src/lib/server/auth.ts:129`); lookup is a single bound-parameter SELECT joined to `users` with `u.disabled = 0` (`:97-103`); expiry is ISO-compared and an expired row is deleted *and* the request rejected (`:109-111`); sliding renewal only below half-life and the cookie is re-issued with the new expiry (`:115-118`, verified: row `expires_at` and `Set-Cookie Expires` both moved 5h→12h). Logout deletes the DB row and the cookie (`:148-150`); replaying the sid after logout returns 401 and `SELECT COUNT(*) FROM sessions WHERE id=?` = 0 (probed). No session fixation surface: the sid is always server-generated and an unknown cookie maps to `null`.
- **Cookie flags** — `HttpOnly`, `SameSite=Lax`, `Path=/`, explicit `Expires`, no `Secure` by documented design for LAN http (`src/lib/server/auth.ts:153-161`; observed header: `addarr_session=…; Path=/; Expires=…; HttpOnly; SameSite=Lax`). `Secure:false` + plain HTTP is the documented trade-off (README §Security), not a new finding.
- **Authz: admin prefix list vs every route directory** — enumerated all 16 `+server.ts` routes and all page modules; the only non-admin API surfaces are `/api/search`, `/api/add`, `/api/status/**`, `/api/downloads`, `/api/files/**`, `/api/auth/**` (anonymous member + session endpoints), and every other prefix (`/settings /presets /console /activity /api/{services,presets,console,activity,settings,restart} /arrapi`) is in `ADMIN_PREFIXES` (`src/lib/server/admin-gating.ts:14-26`) and enforced before `resolve()` (`src/hooks.server.ts:19-38`). Probed pre-setup (503), anonymous (401), member session (403), admin (200) for all of them. Encoding bypasses all gated: `/%73ettings`→302, `/%61pi/services`→401, `/api%2Fservices`→401, `/api/services%2F..`→401, `/api/services/../services`→401, `/./api/services`→401, `/api/%2e%2e/api/services`→401, `/arrapi%2Fradarr%2F…`→401; `//api/services`, `/API/services`, `/api%252Fservices` are 404 both in the gate and in the router (consistent).
- **Page-level loads** — the only `+page.server.ts` is `src/routes/login/+page.server.ts:10` (returns `{hasAdmin}`); `src/routes/+layout.server.ts:3-5` returns only `{user}`. `__data.json` requests for admin pages run the hook on the stripped path and answer with the SvelteKit redirect envelope `{"type":"redirect","location":"/login"}` — no page data.
- **Role enforcement** — an actual `member` user (inserted into a temp DB, logged in normally) gets 403 on every admin prefix including `POST /api/console/command`, 302 off admin pages, and 200 only on the member surfaces; `hooks.server.ts:34-38` is the only path that can reach `resolve()` for an admin prefix.
- **SQL injection** — every statement in `db.ts`, `auth.ts`, `presets.ts` and all routes uses `?` placeholders; no interpolation of user input into `prepare()`/`exec()` anywhere (grep over `src/**/*.ts`, only static SQL and test fixtures contain template literals).
- **Passthrough path handling / SSRF** — with a live fake Radarr configured, `/arrapi/radarr/queue?pageSize=999999&x=%2e%2e%2f` forwarded exactly `/api/v3/queue?pageSize=999999&x=%2e%2e%2f` to the configured host with `X-Api-Key` injected; `/queue/..%2f..%2fsystem%2fbackup`, `/movie%3F..%2F..%2Fsystem%2Fbackup`, `/system/backup`, `/movie/lookup%00/../../system/backup` → 403 "Endpoint not allowed: /system/backup"; `POST/PUT/DELETE/PATCH` → 405. Normalization runs before matching (`src/lib/server/passthrough.ts:39-62`) and `%`-bearing targets are refused (`:61`). Base URL is admin-supplied only and `normalizeServiceBaseUrl` strips credentials and rejects non-http(s)/query/hash (`src/lib/arr/service-url.ts:20-28`); no request-controlled string ever reaches the host part of a URL (`src/lib/arr/client.ts:30`).
- **SSRF via search term** — `encodeURIComponent` on every lookup term (`src/lib/arr/radarr.ts:32`, `src/lib/arr/sonarr.ts:16,23`); queue/ids built with `URLSearchParams` (`:60-65`).
- **Secret exposure to the browser** — with a real key (`supersecretkey123`) stored, all 21 admin/member endpoints plus `/settings`, `/presets`, `/console`, `/activity`, `/`, `/downloads` and the served `_app/immutable/*.js` bundles were fetched and grepped for the key: **zero hits**. `/api/services` selects `id, type, name, base_url, app_version, enabled` only (`src/routes/api/services/+server.ts:13`); `ArrClient.toJSON()` redacts (`src/lib/arr/client.ts:19-21`); `#apiKey` is a private field and is sent only as an `X-Api-Key` header; the server log from all probes contains no key, no session id, and no request body.
- **Request-body size** — not unbounded: adapter-node's default `BODY_SIZE_LIMIT` of `512K` (`node_modules/@sveltejs/adapter-node/files/handler.js:25`) truncates before the handler. Probed on `/api/auth/login`: 400 KB → 200, 600 KB → 400 "Invalid JSON body", 120 MB → 400 in 1.3 ms with no RSS growth (99 MB → 89 MB).
- **Session-row hygiene** — expired rows are deleted on lookup and opportunistically pruned (`src/lib/server/auth.ts:96,141-144`); `idx_sessions_expires` exists (`db.ts:86`).
- **PIN comparison / username oracle** — `timingSafeEqual` on the argon2 tag (`auth.ts:55`) and a cost-matched `DUMMY_HASH` for unknown/disabled users (`auth.ts:71`, `login/+server.ts:78`). Measured: real user/wrong PIN 16.8–20.8 ms, unknown valid-format user 17.3–20.9 ms — indistinguishable. The 11th attempt from one address returns 429.
- **Setup race / second admin** — 40 concurrent `POST /api/auth/setup` with distinct usernames against a fresh DB: 1×200, 39×403, `users` = exactly one admin row, `sessions` = 1. `INSERT … SELECT … WHERE NOT EXISTS` (`setup/+server.ts:27-29`) holds.
- **`child_process` / spawn** — no spawn or exec anywhere takes request data: `serve.mjs:185,197` use literal argv plus `process.execPath`/`process.argv`; `service.mjs` uses constants and `probeBase()`; `icons.mjs` is build-time only.
- **Control chars in upstream paths** — SvelteKit/node cap request-line size (431) and `url.search` is appended only after allow-list matching (`arrapi/.../+server.ts:25-26`), so no path smuggling into a different arr endpoint.

### New findings

#### AS-01 — `/api/status/batch` is a 100× upstream amplifier for any unauthenticated caller

- **Severity:** Medium
- **Confidence:** High (real handler, fake arr counting requests, no live arr needed)
- **Exploit path:**
  1. Anyone who can reach the port (LAN, or any web page — see AS-02) sends one ~1 KB GET: `GET /api/status/batch?movies=1000,1001,…,1099`.
  2. None of those ids is in the library, so for every id the handler performs a *sequential* upstream `GET /api/v3/movie/{id}` (and for Sonarr `GET /api/v3/series/{id}`) inside the request loop.
  3. One request = 102 upstream requests (1 library + 1 queue + 100 item fetches). Five concurrent requests = 510 upstream calls in 300 ms.
  4. Repeat at 10 req/s → ~1,000 arr requests/s from one client, with no auth, no rate limit and no concurrency cap; each in-flight call holds a socket for up to the 15 s `AbortSignal.timeout` (`src/lib/arr/client.ts:38`), so slow arrs are pinned in parallel.
- **Location:** `src/routes/api/status/batch/+server.ts:15` (`.slice(0, 100)`), `:37-41`, `:57-63`
- **Code:**
```ts
	const parseIds = (v: string | null): number[] =>
		(v ?? '')
			.split(',')
			.map((s) => Number(s.trim()))
			.filter((n) => Number.isInteger(n) && n > 0)
			.slice(0, 100);
```
```ts
					const movie = byId.get(id);
					if (!movie) {
						try {
							const m = await client.movie(id);      // one upstream call per unknown id
```
- **Proposed fix:** drop the per-id fallback entirely (the library map and queue already answer every id the UI can poll — the fallback only fires for ids that are not in the library, i.e. exactly the attacker's case), or cap the fallback at a handful with `Promise.allSettled` plus a per-IP budget. Add a cheap per-IP rate limit to the member `/api/**` surface.
- **Evidence:**
  `GET /api/status/batch?movies=1000..1099` → `status 200`, **102 upstream requests**: `1× /api/v3/movie` (library), `1× /api/v3/queue?pageSize=200&page=1`, `100× /api/v3/movie/{id}`; 5 concurrent → **510** upstream requests. Counted from the fake arr's request log.

#### AS-02 — Cross-site GETs to the expensive member endpoints: any web page can drive the arrs

- **Severity:** Medium
- **Confidence:** High for the app behaviour (probe); exploitability needs the victim's browser to reach the instance (mDNS name or a private IP:port)
- **Exploit path:**
  1. A household member opens any web page on the internet (or any other service on the LAN).
  2. The page contains `<img src="http://addarr.local:4545/api/search?service=movie&q=<random>">` × N, or a `fetch(..., {mode:'no-cors'})` loop — GET, no preflight, no cookie, no CORS response needed.
  3. Each hit is a full `lookup` + whole-library `GET /movie` + whole-queue poll on Radarr (and the Sonarr equivalent if both run). AD-03 measured 5 upstream requests / 3.1 MB per search on a 5,000-movie instance; 20 tags ≈ 60 MB of arr work per page view, repeatable on a timer.
  4. The same works for `/api/downloads` (2 full queue fetches) and `/api/status/batch` (AS-01, 102 calls per tag).
- **Location:** `src/routes/api/search/+server.ts:10` and `:32`; `src/lib/arr/radarr.ts:142-143`; no origin logic anywhere in `src/hooks.server.ts:9-45`
- **Code:**
```ts
export const GET: RequestHandler = async ({ url }) => {
	const kind = url.searchParams.get('service');
	const q = url.searchParams.get('q')?.trim();
```
```ts
	async toPosterCards(lookupResults: RadarrMovie[]): Promise<PosterCard[]> {
		const [library, queue] = await Promise.all([this.allMovies(), this.queue()]);
```
- **Proposed fix:** treat `Sec-Fetch-Site: cross-site` (or an `Origin`/`Referer` that is present and not same-origin) as 403 for all `/api/**`, not only for mutating methods — SvelteKit's own check covers only form content types (`node_modules/@sveltejs/kit/src/utils/http.js:93`, `runtime/server/respond.js:81-89`). Add a short-TTL server cache for library+queue (also the AD-03 fix) so that a page can't turn one img tag into a multi-megabyte arr read.
- **Evidence:** `GET /api/search?service=movie&q=dune` with `Origin: http://evil.example` and `Referer: http://evil.example/` → **200**, and the fake arr log shows 3 upstream requests (`/movie/lookup?term=dune`, `/movie`, `/queue?pageSize=200&page=1`). Same for `/api/downloads` → 200 + 1 upstream `/queue`. `<img>`/`<link>` requests carry no `Origin` at all, and nothing in the app inspects `Referer`/`Sec-Fetch-Site`, so no request shape is rejected.

#### AS-03 — No `Host` validation; DNS rebinding turns any website into a member client (and can claim first run)

- **Severity:** Medium
- **Confidence:** Medium — the missing control and its consequences are probe-proven; the final browser step depends on rebinding and on Private Network Access enforcement in the victim's browser
- **Exploit path:**
  1. Attacker serves `http://rebind.attacker.example:4545/` with DNS TTL 1 s; after the page loads, the name re-resolves to `127.0.0.1` (default install) or the LAN IP.
  2. Because the origin is unchanged, page JS is now *same-origin* with Addarr: no CORS preflight, `Content-Type: application/json` allowed, and `Origin` matches `event.url.origin` (which SvelteKit derives from the attacker-controlled `Host`).
  3. It reads `GET /api/search`, `/api/downloads`, `/api/files/:kind/:id` and `/api/status/batch` (household library, watch history, on-disk metadata) and writes `POST /api/add` (pollute the library, trigger downloads).
  4. On an install with no admin yet, `POST /api/auth/setup` claims the admin account with attacker credentials (AS-05).
  5. Admin cookies are not exposed (they are scoped to the host the admin used), so the damage ceiling is the anonymous surface plus first-run takeover.
- **Location:** `scripts/serve.mjs:170` (`createServer(handler)`, no host check); `src/hooks.server.ts:9-17` (no origin/host logic); `svelte.config.js:7` (`kit: { adapter }` only — no `csrf` policy)
- **Code:**
```ts
const server = createServer(handler);          // scripts/serve.mjs:170
```
```ts
	const path = decodePathname(event.url.pathname);
	const isApi = path.startsWith('/api/') || path.startsWith('/arrapi/');
	const needsAdmin = isAdminPath(event.url.pathname);   // src/hooks.server.ts:16-17
```
- **Proposed fix:** validate `Host` against an allow-list (`localhost`, `127.0.0.1`, `[::1]`, `os.hostname()+'.local'`, and `process.env.HOST` when pinned) in `serve.mjs` before handing off to the adapter, answer 421 otherwise; additionally require `Origin`/`Sec-Fetch-Site: same-origin` on every mutating `/api` request instead of relying on SvelteKit's form-only CSRF check.
- **Evidence:** with `Host: attacker.example:47531` the app answers `GET /api/search` with **200**; `POST /api/add` with `Origin: http://attacker.example:47531` (matching a forged Host) reached the handler and returned the business error `503 {"error":"Radarr is not connected yet"}` rather than a 403 — i.e. no host/origin control exists at any layer. SvelteKit's built-in check fires only for `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain` and binary form posts (`node_modules/@sveltejs/kit/src/utils/http.js:93-102`): the same cross-origin POST as `text/plain` and as `x-www-form-urlencoded` correctly returned `403 Cross-site POST form submissions are forbidden`.

#### AS-04 — Unauthenticated argon2id work on the single event loop: `/api/auth/setup` after setup and `/api/auth/login` username churn

- **Severity:** Medium
- **Confidence:** High (measured on the built server; both routes are unauthenticated)
- **Exploit path:**
  1. After an admin exists, `POST /api/auth/setup {"username":"zzz","pin":"4271"}` returns 403 — but `hashPin(body.pin)` is evaluated as an argument to `.run()` *before* the `WHERE NOT EXISTS` clause, so every request still burns a 19 MiB / 2-pass argon2id hash and discards it. There is no rate limit on this route at all.
  2. Alternatively, `POST /api/auth/login` with distinct *format-valid* usernames (`nobody1`, `nobody2`, …) never trips the backoff (the key is `username@ip`, so each new name starts at 0) and each request runs a full `verifyPin` against `DUMMY_HASH`.
  3. `argon2Sync` blocks the event loop, so while the attacker's requests are being hashed **every other request to the app** (member search, downloads, status polls, admin pages) is queued behind them.
  4. No credentials, no valid username and no pre-setup state is needed; the loop is bounded only by the attacker's request rate.
- **Location:** `src/routes/api/auth/setup/+server.ts:26-29`; `src/routes/api/auth/login/+server.ts:69-82`
- **Code:**
```ts
		const r = db
			.prepare(`INSERT INTO users (username, pin_hash, role) SELECT ?, ?, 'admin' WHERE NOT EXISTS (SELECT 1 FROM users)`)
			.run(body.username, hashPin(body.pin));       // hashed before the NOT EXISTS check
		if (r.changes === 0) {
			return json({ error: 'Setup already completed — log in instead' }, { status: 403 });
```
```ts
	if (!isValidUsername(body.username) || !isValidPin(body.pin)) {
		recordFailure(key);
		return json({ error: 'Wrong username or PIN' }, { status: 401 });
	}
	const user = getUserByUsername(body.username);
	if (!user || user.disabled === 1) {
		try { verifyPin(body.pin, DUMMY_HASH); } catch { /* ignore */ }   // full argon2 per request
```
- **Proposed fix:** short-circuit `/api/auth/setup` with `if (hasAnyUser()) return json({error: 'Setup already completed'}, {status: 403})` *before* hashing (and rate-limit the route); make `argon2Sync` asynchronous or run it in a worker so a verification cannot block the loop; add a per-IP global attempt counter so username churn cannot buy unlimited hashing.
- **Evidence:** post-setup `POST /api/auth/setup` → `403` in **17–28 ms** each (10/10; invalid-format username on `/login` costs 0.7–0.9 ms — a ~20× difference proving the hash runs). `POST /api/login` with distinct valid-format unknown names → `401` in **17–20 ms** each, never 429. 40 concurrent setup requests: 780 ms wall, and a member `GET /api/downloads` issued during the flood took **617 ms** (idle baseline: 0.72 ms).

#### AS-05 — First run: whoever can reach the port first becomes the admin

- **Severity:** Low
- **Confidence:** High
- **Exploit path:**
  1. A fresh install started with LAN sharing (`npm run start:foreground -- --lan` / `HOST=0.0.0.0`, both documented) has no user row, and `/api/auth/setup` is deliberately not admin-gated.
  2. Any LAN client — or a rebinding page (AS-03) — `POST /api/auth/setup {"username":"them","pin":"9999"}`, gets `200 {"ok":true,"role":"admin"}` plus an admin session cookie.
  3. The legitimate owner opening `/setup` is redirected away (`hooks.server.ts:41-43`), and `POST /api/auth/setup` now answers 403; the only recovery is deleting `data/addarr.db` by hand.
- **Location:** `src/routes/api/auth/setup/+server.ts:7-32`; `src/hooks.server.ts:41-45`
- **Code:**
```ts
export const POST: RequestHandler = async ({ request, cookies }) => {
	...
	const user = getUserByUsername(body.username!);
	if (!user) return json({ error: 'Setup failed — try again' }, { status: 500 });
	createSession(cookies, user.id, 'admin');        // admin session handed to the caller
```
- **Proposed fix:** only accept setup from a loopback socket address (`getClientAddress()`), or gate it behind a one-time token printed to the console/log at startup; optionally refuse to bind a LAN interface until `hasAnyUser()`.
- **Evidence:** on a fresh `/tmp` DB the very first request of the probe run — `curl -X POST /api/auth/setup -d '{"username":"admin","pin":"1234"}'` with no cookie — returned `{"ok":true,"role":"admin"}` and an admin `Set-Cookie`; afterwards `/api/services` with that cookie returned 200. (Executed from loopback because the probe host must not be exposed; the route contains no address check to make the LAN case different.)

#### AS-06 — `activity_log` has no retention and every failed login appends a row

- **Severity:** Low
- **Confidence:** High
- **Exploit path:**
  1. An unauthenticated client loops `POST /api/auth/login` with valid-format unknown usernames and any PIN.
  2. Each failure is recorded twice over: an `activity_log` row (`auth.login.failure`, `title` = the attacker's username) and, per AS-04, a full argon2 verify.
  3. Nothing ever deletes from `activity_log` (no DELETE/retention anywhere in `src`), so the SQLite file grows without bound — ~100 B/row, ~40 MB/day at 5 req/s, on hosts where the DB often sits on an SD card; the admin Activity page then pages through attacker-chosen strings.
- **Location:** `src/routes/api/auth/login/+server.ts:80` and `:85`; `src/lib/server/auth.ts:164-183`; no pruning in `db.ts` or any route
- **Code:**
```ts
		try { logActivity({ userId: null, serviceId: null, action: 'auth.login.failure', title: String(body.username ?? '') }); } catch { /* best-effort */ }
```
```ts
		`INSERT INTO activity_log (user_id, service_id, action, arr_item_id, title, payload_json)
		 VALUES (?, ?, ?, ?, ?, ?)`
```
- **Proposed fix:** keep the session-style opportunistic prune for `activity_log` (e.g. delete rows older than 90 days, or cap the table at N rows), and stop persisting a row per failed login for usernames that do not exist — an aggregate counter per address is enough.
- **Evidence:** after 10 failed logins the probe DB held 10 `auth.login.failure` rows plus the two successes and one `auth.setup` (`18` rows total from a few minutes of probing); `grep -rn "DELETE FROM activity_log" src | wc -l` = **0**, and the only other reference to the table is the `CREATE TABLE` (`db.ts:88`).

### Corrections to the first pass

- **AD-06's stated evidence is wrong in the direction that matters.** It says "The cheap path costs no argon2 and no SQLite work, because an invalid username returns 401 right after `recordFailure`". That holds only for *format-invalid* usernames (the probe used `x1!`, rejected by `isValidUsername`). A syntactically valid but unknown username (`nobody1`) reaches `verifyPin(body.pin, DUMMY_HASH)` and costs a full 19 MiB argon2id verify: measured **17–20 ms vs 0.7–0.9 ms** (AS-04). So the unauthenticated CPU/event-loop cost of the same loop is ~20× what AD-06 describes, and `/api/auth/setup` gives the same cost with no username churn and no rate limit at all. AD-06's memory-growth claim itself is correct (I re-read the code; the prune only drops entries older than the window).
- **AD-04 understates the batch route.** It frames the 32-call cascade as a consequence of an upstream failure plus the page's per-card fallback. The same route reaches **102 upstream requests from one request with no failure at all** (`/api/status/batch?movies=<100 unknown ids>`), and an attacker does not need the member page: the route is unauthenticated and takes the id list from the query string. That is a different, simpler vector (AS-01) and a higher amplification factor than 32.
- **"Checked and clean — Auth/session lane" is accurate as far as it goes, but incomplete.** Add: (a) session ids are stored **unhashed** in `sessions.id` (`auth.ts:129-132`), so anyone who can read `data/addarr.db` (0600, but also copied to backups) can impersonate any admin for up to 12 h — cheap fix: store `sha256(sid)` and look up by hash; (b) there is **no absolute session cap** — 12 h sliding forever means a session that is used at least once every 6 h never expires; (c) `/api/activity?page=1e300` is a 500 (`Internal Error`) because `(page-1)*pageSize` is not a safe integer and `node:sqlite` rejects the bind — the server log shows `Error: datatype mismatch` at the route's `.all(pageSize, (page - 1) * pageSize)` (`api/activity/+server.ts:19`); admin-only, so robustness not security, but the lane's "every bound parameter" claim shouldn't hide it.
- **"Checked and clean — Secrets to the browser lane" is stronger than stated.** I verified it adversarially rather than by reading: with a real key stored, 21 endpoints + 5 pages + the JS bundles contain zero occurrences of the key. No correction, just a stronger proof.
- **"Checked and clean — Passthrough lane" holds**, and I closed its biggest evidence gap (the report notes no live arr was used): a fake Radarr shows the normalized path and query arriving intact, the key injected server-side, traversal attempts 403 and write verbs 405.
- **"Needs runtime verification — Arr-stored strings and XSS"** can be closed for the server side: there is no `{@html}`, `innerHTML`, `eval` or `new Function` in `src/`, and `posterUrl` only ever reaches `<img src>` (`+page.svelte:335`, `downloads/+page.svelte:140`, `DownloadSheet.svelte:137`) — a `javascript:` URL in an img src does not execute. Nothing in the app checks `Sec-Fetch-Site`, which is what makes AS-02 possible.
- **The report's "no rate limit on `/api/search` (prior D-09)"** is right but it should be stated as an *unauthenticated, cross-site-reachable* amplifier: the missing control is not only a rate limit, it is that a browser on any page can fire the request (AS-02).

### Notes

- **Not findings, hardening:**
  - `data/addarr.log`, `addarr.error.log`, `addarr-tray.log` and `addarr.pid` are created with the process umask (observed `-rw-r--r--`), while `addarr.db*` is `-rw-------`. No secret is written to them today (verified: the probe log contains no key/sid/body), but they carry stack traces. `mode: 0o600` on the `appendFileSync` open would match the DB.
  - Log injection: `console.error(\`[passthrough] ${service}${upstream} failed:\`, …)` (`arrapi/.../+server.ts:43`) interpolates the attacker-controlled `url.search`; it arrives percent-encoded so a newline cannot be forged today, but it is one `decodeURIComponent` away from forging log lines.
  - No security headers (CSP, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`); clickjacking is currently mitigated only by `SameSite=Lax` (a framed admin page gets no cookie), which is incidental — a CSP would make it deliberate.
  - `Cache-Control: no-store` is set on `/api/downloads` and `/api/files` but not on `/api/search`, `/api/status/*`, `/api/console/*`; an intermediary or a shared browser profile can cache admin console payloads.
  - `scripts/mock-arrs.mjs` exposes unauthenticated `POST /api/v3/movie` on 127.0.0.1 — dev-only, but it is one `--host` away from being a LAN write endpoint.
  - Test gaps that would have caught the new findings: a route test asserting `/api/status/batch` makes ≤ 2 upstream calls for 100 unknown ids; a test asserting `/api/auth/setup` does not hash when `hasAnyUser()`; a hook test that a foreign `Host`/`Origin` is rejected; a `/api/search` test that `Sec-Fetch-Site: cross-site` is 403. None exist today, and `route-handlers.test.ts` already has the fake-event harness to add them.
  - There is no `npm run check`/`npm test` coverage of `scripts/serve.mjs`'s request handling, which is why the Host issue is invisible to the suite.
