# AGENTS.md

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as `Status:` values in issue files. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Codebase navigation

File routing lives in `docs/agents/codebase-map.md`. Read it before the first broad search (`ls`, tree-wide `grep`/`glob`, or reading whole directories).

Layout: `src/routes/` holds member pages, admin pages, and JSON API routes; `src/lib/arr/` holds the Radarr/Sonarr adapters and pure normalizers; `src/lib/server/` holds server-only auth, SQLite, presets, and gates; `src/lib/components/` and `src/lib/actions/` hold shared UI; `scripts/` holds the production entry, background service, dev mocks, and icons.

Changes usually start from one of: `src/routes/+page.svelte` (member UI), `src/routes/api/add/+server.ts` (add flow), `src/lib/arr/status.ts` and `src/lib/arr/presentation.ts` (member states), `src/lib/server/db.ts` (storage), or `scripts/serve.mjs` (runtime).

Do not read `node_modules/`, `.svelte-kit/`, `build/`, `data/`, or `.scratch/`; the map lists the full "Don't read" set.

Domain docs: read `GLOSSARY.md` before changing member-visible state names, `PLAN.md` §2-§7 for architecture and security rationale, and `docs/adr/` for accepted decisions. Reference only; the map is the routing source.

Commands: `npm run dev`, `npm test`, `npm run check`, `npm run build`; production foreground is `npm run start:foreground`. Full setup is README §For developers.
