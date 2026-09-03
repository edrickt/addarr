# Addarr — Project Plan

A small self-hosted web app for the home LAN. Non-technical household members search for movies and series and add them to Radarr/Sonarr in one tap. An admin mode configures exactly what "add" does and provides deep, curated control over the *arr instances.

Status: **v1.2 complete — M1–M6 implemented and smoke-tested.** v1.1: anonymous member access, admin-only login; visual restyle to light "Precision" theme. v1.2: real acquisition states on poster cards (server-normalized status API: queued/downloading/importing/partial/paused/attention/missing/unreleased, poster progress bar, adaptive polling), admin-only server restart with graceful self-restart and port takeover, LAN sharing toggle in Settings, first-run onboarding handoff (setup → connect → default preset), full mobile adaptation (safe areas, 44px touch targets, no iOS focus zoom), and a technical audit + hardening pass (login attempt backoff, no silent fetch failures, watch-detail strip fix). Visual style: "Precision" theme, light colorway — near-white semantic-token palette, top-bar app shell, Inter (self-hosted), sharp corners, light font weights, hairline structure, mono numerals, console KPI strip, no emojis. Architecture validated by a 3-advisor council (see session memo); API facts verified against Radarr/Sonarr source and v3 swagger docs.

---

## 1. Goals and non-goals

### Goals
- **Dead-simple member UX:** type a title, see posters, tap "Add." Done. No accounts ceremony, no approval queue, no jargon.
- **Admin presets:** the admin defines what "Add" means — quality profile, root folder, monitored, tags, minimum availability, and whether a search starts immediately (`addOptions.searchForMovie` / `addOptions.searchForMissingEpisodes`).
- **Deep admin mode:** curated screens for everything that affects *acquisition*, plus a **read-only API passthrough** as a power escape hatch. Radarr/Sonarr settings screens stay reachable in a frame/link.
- **Single deployable:** one process, one config file, one container.

### Non-goals (v1)
- ❌ Raw full-API passthrough (write access). ~150 endpoints include destructive ops (`DELETE /movie/{id}?deleteFiles=true`, mass editors, backup/restore). Council verdict: unanimous scope trap.
- ❌ Approval/request workflow (that's Ombi/Overseerr; wrong for a household).
- ❌ Media-server auth integration (Jellyfin/Plex login).
- ❌ Internet-exposed deployment. LAN only; remote access = Tailscale/WireGuard, not app hardening.
- ❌ Legacy *arr API v2 support. Minimum: Radarr 4+ / Sonarr 3+ (Sonarr v4 keeps `/api/v3` routes).

---

## 2. Architecture

```
Browser (member or admin)
   │  http://addarr.local
   ▼
Addarr server (single Node process)
   ├── SvelteKit SSR frontend  (member UI + admin UI)
   ├── /api/* internal routes  (auth-gated, reshaped responses)
   ├── SQLite                  (users, presets, settings, activity log)
   └── ArrClient (per service) ──► Radarr /api/v3   (X-Api-Key held server-side)
                              └──► Sonarr /api/v3   (never sent to browser)
```

Principles:
1. **The browser only ever talks to Addarr.** Arr API keys never leave the server.
2. **Addarr owns the user model.** Radarr/Sonarr have a single all-powerful shared API key and no per-user accounts — so all auth/roles live here.
3. **One module per arr service** (`src/lib/arr/radarr.ts`, `src/lib/arr/sonarr.ts`). Resource shapes differ enough that a shared abstraction leaks; thin adapters keep version-drift fixes local.
4. **Startup capability probe:** on connect, call `GET /api/v3/system/status`, record app version, fail loudly with a friendly message if unsupported.

### Stack (decision D1 — default chosen, confirm to override)

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js + TypeScript | one language, huge ecosystem, reviewer's concrete recommendation |
| Framework | SvelteKit (SSR) | server routes double as the internal API; minimal client JS — right size for "search box + forms" |
| DB | SQLite via better-sqlite3 | zero-config, file-based, one container |
| Styling | Plain CSS with semantic tokens | zero deps, full control for a minimal dashboard look |
| Deploy | Single command launch: `npm start` (install + build + `node build`) | zero-deploy, OS-agnostic |

Rejected alternates: FastAPI/Go backends (fine, but two runtimes or more boilerplate), Next.js/Nuxt (heavier than needed), heavy SPA (oracle: scope inversion for a LAN app).

---

## 3. Users and auth (decision D2/D3 — defaults chosen)

**v1.1 change:** members browse and add anonymously (no accounts); only the admin signs in. Section kept for history:

Two roles, local accounts only:

- **Admin** — full control panel, preset management, arr connection settings.
- **Member** — search and add. Nothing else.

Auth: username + 4–6 digit PIN (household-friendly), argon2-hashed, server-side session cookie. First-run wizard creates the admin account. Members are seeded by the admin (no self-registration).

- Default: **named members, each a PIN.** Alternative if you want zero maintenance: one shared household PIN (setting flag, same code path).
- Session: httpOnly secure cookie, 30-day rolling for members; 12-hour for admin.
- Admin routes require the admin role; member routes require any valid session.

---

## 4. Data model (SQLite)

```sql
users          (id, username, pin_hash, role, created_at)
sessions       (id, user_id, expires_at)

services       (id, type 'radarr'|'sonarr', name, base_url, api_key,
                app_version, enabled)              -- supports 4K instances later

presets        (id, service_id, name, is_default,
                quality_profile_id, root_folder_path,
                monitored, tags_json, minimum_availability,
                search_on_add,                     -- maps to addOptions.searchFor*
                series_type_default,               -- sonarr: standard/daily/anime
                season_monitor_policy)             -- sonarr: all/future/missing/none

activity_log   (id, user_id, service_id, action, arr_item_id, title,
                payload_json, created_at)          -- "who added what, when"
```

- Every add records an `activity_log` row — cheap and answers "who added this?"
- Presets are per-service; the default preset is what the member "Add" button uses. Admin can expose multiple presets later (v2).

---

## 5. Member experience

**Flow:** search box → debounced lookup → poster grid (title, year, poster, status badge) → **one Add button on the card** (uses default preset) → confirmation toast → done. Cards already in the library show a live acquisition state instead of an Add button: `waiting → queued → downloading → importing → available`, plus `partial` (some episodes on disk), `paused`, `attention` (admin-visible problem states render as a neutral "Waiting" for members), `missing`, `unreleased` — with a progress bar and a time-left detail strip while downloading. A grid-wide self-scheduling poller refreshes badges every 5 s while anything is downloading, 20 s otherwise.

Internal routes (all member-facing, all server-side):

| Route | Does |
|---|---|
| `GET /api/search?service=movie|series&q=` | proxies to `/movie/lookup?term=` / `/series/lookup?term=`; merges "already in library" flag by pre-checking `movie?tmdbId=` / `series?tvdbId` |
| `POST /api/add` | body: `{service, tmdbId|tvdbId}`; server applies default preset → `POST /api/v3/movie` or `/series`; dedupe-check first; writes activity log |
| `GET /api/status/:service/:id` | optional: queue/availability for the item just added |

Member rules:
- Lookup results are trimmed to poster card fields (no arr internals leak).
- Sonarr lookup returns unreliable monitoring defaults for new series — server resets them; the preset decides (researcher: sonarr issue #5761).
- Search trigger: rely **only** on `addOptions.searchForMovie` / `searchForMissingEpisodes`. Never also fire a `MoviesSearch`/`SeriesSearch` command for the same add (duplicate-search footgun).
- Status after add (decision D4 — default: **show it**): polled badge with the full acquisition state machine (§5) from `GET /api/v3/queue` + item state. No websockets in v1.

---

## 6. Admin experience

### 6.1 Settings screens (curated, full write access)
- **Connections:** add/test Radarr & Sonarr instances (URL + API key, capability probe, version display).
- **Presets:** CRUD per service; live dropdowns populated from `GET /api/v3/qualityprofile`, `/rootfolder`, `/tag`; toggles for monitored, search-on-add; Sonarr: series-type and season-monitor policy.
- **Activity log:** who added what, when.
- **Network:** LAN sharing toggle (bind + mDNS/Bonjour broadcast), with restart guidance.
- **Server:** admin-only graceful restart (self-restart with port takeover).

### 6.2 Operations console (curated, full write access, confirm-gated)
The ~15 endpoints admins actually touch, hand-built:

- **Library:** list/edit movies & series; change quality profile, root folder, tags, monitored state; **delete — with typed-confirmation dialog**.
- **Queue:** view + delete queue items (remove from client? — confirm-gated).
- **History:** browsable, filterable.
- **Commands:** curated buttons only — `MoviesSearch`, `SeriesSearch`, `EpisodesSearch`, `RefreshMonitoredDownloads`. No free-form command input.
- **Exclusions / blocklist:** view + remove.
- **Calendar:** upcoming releases (read-only).

### 6.3 Read-only passthrough (the escape hatch)
- `GET /arrapi/:service/*` — proxies **GET only** to whitelisted read endpoints, API key injected server-side.
- Purpose: inspect any payload the curated UI doesn't show; feed future feature decisions.
- Write verbs never pass through. If a gap appears, the answer is a curated screen, not opening POST.

---

## 7. Security rules (non-negotiable)

1. Arr API keys exist only in SQLite/server memory; never serialized to any client response.
2. Every internal route role-gated server-side (not just hidden UI).
3. Destructive admin ops require typed confirmation; logged in activity_log.
4. Passthrough: GET-only + endpoint allow-list + no user-supplied URL parts reaching the arr host (SSRF guard).
5. Bind to LAN interface; document Tailscale for remote access rather than HTTPS/earned complexity in-app.

---

## 8. Milestones

### M1 — Skeleton talks to the arrs
SvelteKit scaffold, SQLite schema, settings page storing one Radarr + one Sonarr connection, capability probe, `ArrClient` adapters for lookup/add/qualityprofile/rootfolder/tag/system-status. *Done when:* a curl-able `/api/search` returns trimmed poster results from both services.

### M2 — Member flow ✅
Auth (admin first-run + member PINs), search UI, add-with-default-preset, already-in-library badge, activity log. *Done when:* a non-technical user adds a movie and an episode-bearing series with zero instruction, and the item appears in Radarr/Sonarr monitored with a search triggered per preset.

### M3 — Admin presets + status ✅
Preset CRUD with live dropdowns; polled add-status badge; per-series-type Sonarr defaults. *Done when:* changing a preset changes add behavior, verified end-to-end.

### M4 — Admin operations console ✅
Library edit/delete (confirm-gated), queue, history, commands buttons, exclusions, calendar. *Done when:* the admin never needs the Radarr/Sonarr UI for day-to-day acquisition decisions.

### M5 — Read-only passthrough + polish ✅
`/arrapi` GET proxy with allow-list, error surfaces friendly to non-admins, one-line launch, README. *Done when:* v1 is taggable.

### M6 — Acquisition states, mobile, hardening ✅ (v1.2)
Server-normalized status API and real states on poster cards (badges, progress bar, time-left strip, adaptive polling); admin-only restart with self-restart + port takeover; LAN sharing toggle; setup→settings onboarding handoff; mobile pass (safe areas, 44px targets, iOS zoom fix); technical audit + hardening (login backoff, error states on every fetch path, watch-detail strip fix). *Done when:* an anonymous member can watch an add go from queued to available on a phone, unsupervised.

---

## 9. Open owner decisions (defaults applied — override anything)

| # | Decision | Default in this plan |
|---|---|---|
| D1 | Stack | Node + SvelteKit + SQLite (§2) |
| D2 | User model | **changed v1.1:** no member accounts — anonymous one-tap adds; single admin login guards admin surfaces (§3) |
| D3 | Approval workflow | none — direct add |
| D4 | Post-add status | yes, simple polled badge (§5) |
| D5 | v1 scope | Radarr + Sonarr both; 4K instances via `services` table but UI-hidden until needed (§4) |
| D6 | Admin depth | curated console + GET-only passthrough; no write passthrough (§6) |
| D7 | Name | keep "Addarr" (collides with existing Telegram bots; acceptable for personal LAN use) |

## 10. Risks carried forward

- **API drift** across Radarr 4→5 / Sonarr 3→4 — mitigated by per-service adapters + startup probe.
- **Sonarr add complexity** (seasons, series types) — per-series-type presets, server resets lookup monitoring defaults.
- **Swagger under-specifies required fields** — required-field sets pinned in code (tmdbId/tvdbId, qualityProfileId, rootFolderPath).
- **"Full control" scope creep** — capped by design: curated console + read-only passthrough is the ceiling; new needs become curated screens.
