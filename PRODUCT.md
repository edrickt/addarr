# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are the members of one household on a trusted home LAN: deliberately non-technical people (including kids on phones/tablets) who want a title in their media library without learning anything about Radarr, Sonarr, quality profiles, or root folders. They browse and add **anonymously** (v1.1: no member accounts; admin-only login).

The secondary user is the household's self-hoster admin: technically comfortable, runs the server on a home machine, and wants exact control over what "Add" means plus curated day-to-day acquisition management.

## Product Purpose

Addarr is a thin, safe front door to Radarr and Sonarr. Members type a title, see a poster grid, tap **Add**; a live `queued → downloading → available` status shows up afterward. Admins define exactly what Add does (presets) and get curated operational screens (library, queue, history, exclusions, blocklist, calendar, a small allow-list of commands) plus a read-only API passthrough as an escape hatch. Success: a non-technical household member can add a movie or series in one tap, unsupervised, without being able to break anything.

## Positioning

Not Ombi/Overseerr. There is no approval/request workflow. A household does not need gatekeeping. It is not the raw *arr UIs either, with their jargon and destructive power. The mechanism a neighbor cannot truthfully copy is one-tap adds whose entire behavior is preset-defined by the admin, with the *arr API keys held server-side and only a read-only, allow-listed passthrough exposed. That gives deep admin power without ever handing the browser (or the household) the keys to a destructive API.

## Operating Context

- Runs as a single Node process on a home machine; `npm start` is the whole deploy. LAN-only by design (localhost bind by default; opt-in LAN share with mDNS/Bonjour broadcast as "Addarr"). Remote access = Tailscale/WireGuard, never app hardening. No HTTPS, by design.
- Members use browsers on phones, tablets, and desktops across the LAN at `http://<host>:4545` (`addarr.local` via discovery).
- Radarr 4+ / Sonarr 3+ (API v3) are the connected backends; each is optional; the app works with either or both.
- First-run flow: setup wizard (admin username + 4–6 digit PIN) → connect *arr instances → done; members need no onboarding.
- Data lives in one SQLite file (`data/addarr.db`); backing up that file backs up the whole app.

## Capabilities and Constraints

- **Member mode.** Search → poster grid → one Add button using the default preset; "In library ✓" badge; polled status badge after adding. Lookup responses are trimmed server-side so *arr internals never leak.
- **Admin presets.** Quality profile, root folder, monitored, tags, minimum availability, search-on-add, (Sonarr) series type + season monitoring policy. The default preset powers the member Add button.
- **Operations console.** Curated screens only, with typed-confirmation deletes and hand-picked commands (`MoviesSearch`, `SeriesSearch`, `EpisodesSearch`, `RefreshMonitoredDownloads`); no free-form commands. Read-only passthrough (`GET /arrapi/...`) blocks all write verbs structurally.
- **Auth.** Admin PIN login, 12-hour session; members anonymous; activity log records who added what (attribution is a known gap for anonymous adds; see open decisions).
- **Hard constraints.** API keys never reach the client; no raw write passthrough; no internet exposure; no media-server auth integration; no legacy *arr API v2.
- **Open decisions.** Whether adds should eventually support member-facing preset choice or 4K instance routing (services table already supports it); how (or whether) to attribute anonymous adds in the activity log beyond IP.

## Brand Commitments

- The name **Addarr** (also the mDNS/Bonjour broadcast name) is binding.
- The incumbent **"Precision" visual language** is a deliberate, documented commitment (PLAN.md): light colorway, near-white semantic-token palette, Inter (self-hosted), sharp corners (0px radius), light font weights, hairline structure, mono/tabular numerals, no emojis. Binding as the current identity; a dark colorway is undecided, not forbidden.

## Evidence on Hand

- Fully implemented v1 + v1.1 codebase (M1–M5 smoke-tested): `src/routes/` (search, presets, console, activity, settings, setup, login), `src/app.css` token sheet, `PLAN.md` architecture and decision history.
- No testimonials, press, case studies, or marketing assets exist or should be fabricated; this is personal self-hosted software.

## Product Principles

1. **One tap, zero jargon.** The member UI must never show an *arr concept, credential, or decision that the admin preset hasn't already made.
2. **The browser is untrusted.** Keys and write power stay server-side; every exposed route is curated, allow-listed, and read-only by default.
3. **Deep where the admin lives, shallow where members live.** Curated acquisition control beats raw API exposure; the read-only passthrough is the pressure valve, not the interface.
4. **One process, one file, zero ceremony.** `npm start` must remain the entire install, deploy, and update story.
5. **LAN trust, honestly framed.** Design for a trusted network rather than pretending the app is internet-hardened.

## Accessibility & Inclusion

- Primary surfaces must work one-handed on a phone in a couch context: large touch targets, forgiving hit areas for the Add button.
- Copy is jargon-free for members ("Add", "In library ✓", "Downloading") while admin surfaces may use *arr terminology fluently.
- No specific standard is contractually required; sensible contrast and keyboard operability for admin forms are expected.
