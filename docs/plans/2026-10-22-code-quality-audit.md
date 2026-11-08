# Code Quality Audit Plan — Addarr

- **Date:** 2026-10-22
- **Status:** ready for execution
- **Baseline commit:** `f33660e` on `main`
- **Mode:** report only; no application code changes, commits, or pushes
- **Report destination:** `.scratch/code-quality-audit/report.md`

## 1. Goal and success criteria

Audit every implemented major feature of Addarr for correctness, security, maintainability, test coverage, and material UX/accessibility risk, then produce a prioritized, evidence-backed report.

Success means:

- Every feature in the ownership map has a findings file.
- Every finding has a severity, confidence, verification status, `file:line` evidence, impact, and suggested remediation.
- Critical and High findings are reproduced at runtime where feasible, or explicitly marked `inferred` with the reason.
- `npm run check`, `npm test`, and `npm run build` are run and their exact results recorded.
- High-risk auth, gating, add, status, preset, console, and passthrough paths are exercised against mock arrs in an isolated data directory.
- No user data, live arrs, service installation, or host service state is touched.
- The final report is deduplicated, traceable to findings files, and includes a coverage matrix and remediation sequence.

## 2. Context

Addarr is a SvelteKit/Node app for one household LAN. Members search and add anonymously; only the admin signs in. Radarr/Sonarr API keys stay server-side. The app has roughly 7,000 source lines across 41 source files and 4 script files.

The implemented feature inventory is:

| Feature | Primary code | Notes |
| --- | --- | --- |
| Member search and add | `src/routes/+page.svelte`, `src/routes/api/search`, `src/routes/api/add`, `src/lib/arr/radarr.ts`, `src/lib/arr/sonarr.ts`, `src/lib/arr/add-resource.ts` | Includes lookup trimming, dedupe, preset application, and activity attribution |
| Acquisition status | `src/lib/arr/status.ts`, `src/routes/api/status`, poller in `src/routes/+page.svelte` | Pure normalizer plus adaptive client polling |
| Admin presets and connections | `src/routes/api/presets`, `src/routes/presets`, `src/lib/components/PresetForm.svelte`, `src/lib/server/presets.ts`, `src/routes/api/services` | Includes default-preset creation and live arr option loading |
| Admin console | `src/routes/api/console/[...path]`, `src/routes/console/+page.svelte`, `src/lib/components/ConfirmDialog.svelte` | Library, queue, history, calendar, commands, exclusions, blocklist |
| Auth and setup | `src/hooks.server.ts`, `src/lib/server/auth.ts`, `src/routes/api/auth/*`, `src/routes/login/*`, `src/routes/setup/*` | Anonymous member access; admin-only surfaces |
| Activity log | `src/routes/api/activity`, `src/routes/activity/+page.svelte` | Admin-only read surface |
| Read-only passthrough | `src/routes/arrapi/[service]/[...path]/+server.ts` | GET-only allow-list; the security escape hatch |
| Settings, LAN, restart | `src/routes/settings/+page.svelte`, `src/routes/api/settings/lan`, `src/routes/api/restart` | LAN preference, live broadcast toggle, supervisor handoff |
| Service lifecycle | `scripts/serve.mjs`, `scripts/service.mjs`, `scripts/mock-arrs.mjs`, `scripts/icons.mjs` | launchd, systemd, Windows startup, tray, PID/log handling |
| Shared frontend | `src/routes/+layout.svelte`, `src/app.css`, `src/lib/actions/modal.ts` | Navigation, dialogs, mobile, accessibility primitives |
| Data/client foundation | `src/lib/server/db.ts`, `src/lib/arr/client.ts`, `src/lib/arr/types.ts`, `src/lib/server/arr-factory.ts`, build config | SQLite, HTTP client, shared types, dependency hygiene |

Out of scope: the Downloads page (specified in `.scratch/downloads/spec.md` but not implemented), visual redesign, penetration testing beyond the stated LAN threat model, live Radarr/Sonarr instances, and service install/uninstall on the host.

## 3. Baseline

Recorded before any audit work:

| Check | Result |
| --- | --- |
| Git state | clean `main` at `f33660e` |
| Node / npm | `v24.21.0` / `11.19.0` |
| `npm test` | 8 passed, 0 failed; only `src/lib/arr/add-resource.test.ts` |
| `npm run check` | 0 errors, 0 warnings |
| `npm run build` | success; adapter-node warns that `node:sqlite` is treated as external |
| Lint/format | no lint or format script |
| Integration tests | none; no test covers status normalization, routes, auth, presets, console, or passthrough |
| Runtime mocks | `scripts/mock-arrs.mjs` supports Radarr lookup/add/queue and Sonarr lookup/queue, but not Sonarr `POST /series` |

The build writes only ignored `.svelte-kit/` output. `data/addarr.db` must remain untouched.

## 4. Decisions and assumptions

- **Coverage:** all implemented features listed above. Downloads is not audited as code because it does not exist yet.
- **Lens:** balanced and risk-first. Correctness and security lead; maintainability, tests, and material UX/accessibility follow.
- **Authorization:** report only. No application edits, no commits, no dependency upgrades.
- **Verification:** static review, existing project checks, targeted pure-function probes, and an isolated runtime harness against mock arrs.
- **Deliverable:** one findings file per feature under `.scratch/code-quality-audit/findings/`, plus a synthesized report.
- **Severity rubric:**
  - `Critical`: admin auth bypass, credential/API-key exposure, unauthenticated destructive write, remote code execution, or data loss/corruption.
  - `High`: privilege escalation, destructive action without required confirmation, materially wrong add/delete semantics, stored XSS, secret leakage in logs/errors, or persistent denial of service.
  - `Medium`: auth robustness gaps, SSRF limited to the admin role, race conditions, unbounded resource growth, incorrect status/error behavior, or missing validation with limited blast radius.
  - `Low`: maintainability, duplication, naming, documentation, or efficiency issues with no direct user/security impact.
- **Evidence standard:** `verified` means reproduced by a command, test, or HTTP probe. `inferred` means static reasoning only, with the reason stated. Critical and High findings should be verified unless the harness cannot reproduce them.
- **Low findings:** report all Critical/High/Medium findings in full; compact Low findings into one table per feature.
- **Threat model:** trusted home LAN, no HTTPS, no internet exposure. Do not report the absence of internet hardening as a vulnerability unless it violates the documented model.
- **Runtime isolation:** use a temporary working directory, `ADDARR_DB` pointing into it, `HOST=127.0.0.1`, an unused port, and mock arrs. Never use `npm start`, `scripts/service.mjs install`, the real `data/addarr.db`, real API keys, or the host restart endpoint.
- **Dependency audit:** run `npm audit --json` if the registry is reachable; otherwise record the skipped check. Dependency findings are supplemental, not a substitute for source review.

## 5. Non-goals

- Implementing remediations or opening pull requests.
- Auditing the Downloads spec or treating an unimplemented feature as a defect.
- Testing real Radarr/Sonarr version drift or network failure modes that mocks cannot represent.
- Running service install, uninstall, stop, restart, or tray commands against the host.
- Enabling LAN broadcast or invoking `/api/restart`.
- Rewriting style or brand decisions from `PRODUCT.md` and `PLAN.md`.

## 6. Shared interfaces

### 6.1 Findings schema

Every finding is an `H3` heading followed by these exact metadata lines:

```markdown
### F-AREA-NN: Short title

Severity: Critical | High | Medium | Low
Confidence: high | medium | low
Status: verified | inferred
Feature: Human-readable feature name
Locations: `path/to/file.ts:12`, `path/to/other.ts:34`
Impact: What can go wrong and for whom.
Evidence: Command/probe and result, or the precise code path. Cite runtime evidence IDs where applicable.
Recommendation: The smallest correct fix, not a full redesign.
Effort: S | M | L
```

`AREA` values: `FOUND`, `AUTH`, `MEMBER`, `PRESET`, `CONSOLE`, `SETTINGS`, `SCRIPT`, `UI`.

Files start with a short coverage note and a summary table (`ID`, `Severity`, `Title`). A finding may be `inferred` only when the evidence line explains why a probe was impossible or unsafe.

### 6.2 Runtime evidence schema

`evidence/runtime.md` uses stable IDs:

```markdown
### E-NN: Scenario name

Request/command:
Expected:
Observed:
Result: pass | fail | blocked
Finding candidate: F-AREA-NN or none
```

The harness must print a machine-readable pass/fail summary and exit non-zero on unexpected results. Reviewers cite `E-NN` rather than repeating raw output.

### 6.3 File ownership

| Task | Owns for review | Does not own |
| --- | --- | --- |
| T01 | `db.ts`, `client.ts`, `types.ts`, `arr-factory.ts`, build/dependency config | Feature route logic |
| T02 | `hooks.server.ts`, `server/auth.ts`, auth routes, login/setup pages and server load | Layout markup, generic modal behavior |
| T03 | Member page, search/add/status routes, Radarr/Sonarr adapters, add-resource, status normalizer | Admin console, presets UI |
| T04 | Preset API, preset page, `PresetForm`, `server/presets.ts` | Connection probe UX in Settings |
| T05 | Console API/page, activity API/page | `ConfirmDialog` internals, generic a11y |
| T06 | Passthrough, services API, LAN/restart APIs, Settings page | Preset semantics |
| T07 | `scripts/serve.mjs`, `service.mjs`, `mock-arrs.mjs`, `icons.mjs` | Application routes |
| T08 | Layout, `app.css`, `modal.ts`, `ConfirmDialog`, cross-page a11y/mobile patterns | Auth semantics, feature-specific logic |
| T09 | Runtime harness and evidence | Source findings files |
| T10 | Synthesized report | New findings not present in a findings file |

If two reviewers see the same issue, the owner records it and the other cites the owner's ID. Deduplication happens in T10.

## 7. Approach

1. **Freeze the contract.** T00 creates the rubric, schema, feature map, validator, and baseline record.
2. **Review in parallel.** T01, T07, T08, and T09 run together. T09 produces runtime evidence before the feature reviewers finish.
3. **Review feature slices.** T02 through T06 run together, using T09 evidence where a claim can be proven at runtime.
4. **Synthesize.** T10 validates every findings file, deduplicates, ranks, checks traceability, and writes the report.

Every reviewer works read-only against application code. Test fixtures, temporary databases, HTTP harnesses, and evidence belong under `.scratch/code-quality-audit/` or a temporary directory.

## 8. Tasks

### T00 — Audit contract, baseline, and validator

- **Depends:** none
- **Parallel-safe:** no; gate for all other tasks
- **Write scope:** `.scratch/code-quality-audit/method.md`, `.scratch/code-quality-audit/tools/check-findings.mjs`, `.scratch/code-quality-audit/evidence/baseline.md`, `.scratch/code-quality-audit/findings/`
- **Test-first check:** create one deliberately incomplete fixture and one complete fixture; the validator must reject the first and accept the second before any audit findings are written.
- **Steps:**
  1. Record the audit goal, non-goals, severity rubric, evidence legend, and feature ownership map in `method.md`.
  2. Write the finding schema from §6.1 and the runtime evidence schema from §6.2.
  3. Implement `check-findings.mjs` with no dependencies. It must validate required metadata, severity/confidence/status enums, location format, and non-empty impact/evidence/recommendation. Add a `--self-test` mode using the two fixtures.
  4. Record the baseline commands and exact outputs from §3 in `evidence/baseline.md`, including `git status` and the test count.
  5. Create empty findings files for T01–T08 with only their coverage note and summary table, so parallel writers never create the same file.
  6. Record the runtime isolation rules and the prohibition on touching `data/addarr.db`, host services, and real arrs.
- **Verification:** `node .scratch/code-quality-audit/tools/check-findings.mjs --self-test` exits 0; `git status --short` shows only intended audit files.
- **Output contract:** a reviewer can write a finding without re-deciding format or severity.

### T01 — Foundation: SQLite, arr client, shared types, build and dependencies

- **Depends:** T00
- **Parallel-safe:** yes
- **Write scope:** `.scratch/code-quality-audit/findings/01-foundation.md`
- **Read scope:** `src/lib/server/db.ts`, `src/lib/arr/client.ts`, `src/lib/arr/types.ts`, `src/lib/server/arr-factory.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `svelte.config.js`, `vite.config.ts`, `src/app.d.ts`
- **Test-first check:** before recording an `ArrClient` behavior finding, run a throwaway local HTTP server that returns 204, 401, 500 JSON, and 200 non-JSON; capture the client's actual error/return behavior. If a probe is unsafe or impossible, mark the finding `inferred` and say why.
- **Steps:**
  1. Review schema constraints, foreign keys, WAL, DB-path handling, migration error swallowing, settings access, and service upsert behavior.
  2. Review `ArrClient` URL construction, path/query handling, timeout, non-JSON responses, status/error mapping, response-size assumptions, and secret handling.
  3. Review `arr-factory` failure behavior and the duplicate `Paged`/adapter type patterns.
  4. Review build config, strictness, dependency surface, lockfile risk, and the `node:sqlite` external warning.
  5. Run `npm audit --json` if reachable.
  6. Write findings with severity, confidence, and concrete fixes.
- **Verification:** `node .scratch/code-quality-audit/tools/check-findings.mjs .scratch/code-quality-audit/findings/01-foundation.md` exits 0; at least one probe output is quoted for any High/Critical client finding.
- **Output contract:** a bounded foundation findings file with no feature-level duplication.

### T02 — Auth, setup, sessions, and route gating

- **Depends:** T00, T09 for runtime evidence
- **Parallel-safe:** yes
- **Write scope:** `.scratch/code-quality-audit/findings/02-auth.md`
- **Read scope:** `src/hooks.server.ts`, `src/lib/server/auth.ts`, `src/routes/api/auth/login`, `src/routes/api/auth/logout`, `src/routes/api/auth/setup`, `src/routes/login/+page.server.ts`, `src/routes/login/+page.svelte`, `src/routes/setup/+page.svelte`
- **Test-first check:** write the expected access matrix first: anonymous, invalid-session, admin, and member-role behavior for each protected prefix. Verify it against T09 evidence before recording any gating finding.
- **Steps:**
  1. Check prefix matching for bypasses via trailing slashes, encoded paths, case, and nested paths.
  2. Check setup race/TOCTOU, second-setup behavior, username enumeration through the login page and API, and account-disabled handling.
  3. Check PIN validation, argon2 parameters, timing behavior, rate-limit key/window/reset semantics, and distributed username/IP bypass.
  4. Check session creation, rotation, fixation, expiry/rolling behavior, cookie flags, logout, stale sessions, and cleanup.
  5. Check CSRF exposure given `sameSite=lax` and JSON endpoints, and whether any state-changing GET exists.
  6. Check `locals.user!` assumptions and consistency between hook gating and route-level checks.
- **Verification:** validator exits 0; every Critical/High gating finding cites `E-NN` or an explicit inferred rationale.
- **Output contract:** auth findings separated from generic frontend concerns.

### T03 — Member search, add, and acquisition status

- **Depends:** T00, T09 for runtime evidence
- **Parallel-safe:** yes
- **Write scope:** `.scratch/code-quality-audit/findings/03-member.md`
- **Read scope:** `src/routes/+page.svelte`, `src/routes/api/search`, `src/routes/api/add`, `src/routes/api/status`, `src/lib/arr/radarr.ts`, `src/lib/arr/sonarr.ts`, `src/lib/arr/add-resource.ts`, `src/lib/arr/add-resource.test.ts`, `src/lib/arr/status.ts`, `src/lib/arr/types.ts`
- **Test-first check:** before writing status-normalizer findings, run fixture-based probes for: downloading plus paused rows, warning precedence, zero-size rows, malformed `sizeLeft`, missing `timeleft`, and a series with unaired episodes. Record the actual outputs. UI race/poller findings may be `inferred` if no browser harness exists.
- **Steps:**
  1. Review search debounce/race handling, partial-failure merge, response validation, result trimming, and library/queue lookup efficiency.
  2. Review add flow: id validation, service selection, dedupe TOCTOU, default preset lookup, adapter dispatch, error mapping, double-submit protection, activity attribution, and response shape.
  3. Review Radarr/Sonarr add payloads against the documented constraints, especially season 0, empty season lists, series type, minimum availability, and search-on-add.
  4. Review status precedence, progress arithmetic, time-left parsing, series partial/available semantics, and whether unaired episodes distort member states.
  5. Review the client poller for cleanup on component teardown, overlapping requests, stale responses, backoff, and visibility/focus behavior.
  6. Identify missing tests at the module boundary.
- **Verification:** validator exits 0; probe commands and outputs are quoted; every status finding states whether it is verified by a fixture or inferred.
- **Output contract:** one member-flow file with search, add, status, and test-gap findings.

### T04 — Presets and default-add semantics

- **Depends:** T00, T09 for runtime evidence
- **Parallel-safe:** yes
- **Write scope:** `.scratch/code-quality-audit/findings/04-presets.md`
- **Read scope:** `src/routes/api/presets`, `src/routes/presets/+page.svelte`, `src/lib/components/PresetForm.svelte`, `src/lib/server/presets.ts`, `src/lib/server/db.ts` (preset schema only)
- **Test-first check:** reproduce the default-preset creation invariant with a temporary SQLite database or the T09 preset scenario. Specifically test whether the newly created preset is identified correctly when existing preset names sort before or after it. Record the observed IDs before rating the finding.
- **Steps:**
  1. Review input validation for names, quality profiles, root folders, tags, minimum availability, booleans, series type, and season policy.
  2. Review create/update/delete transactions, partial-update behavior, unique-name failures, and default-preset invariants.
  3. Review the `listPresets(...).at(-1)` creation lookup and any reliance on ordering.
  4. Review `ensureDefaultPreset`, the unusable-default state, and duplicate-name handling on reconnect.
  5. Review preset UI error handling, loading states, delete/default confirmation, and stale option data.
  6. Check test coverage for preset validation and default selection.
- **Verification:** validator exits 0; the ordering/default finding has a reproduced result or a precise SQLite trace.
- **Output contract:** preset findings that do not duplicate T06 connection-probe findings.

### T05 — Admin console and activity log

- **Depends:** T00, T09 for runtime evidence
- **Parallel-safe:** yes
- **Write scope:** `.scratch/code-quality-audit/findings/05-console.md`
- **Read scope:** `src/routes/api/console/[...path]/+server.ts`, `src/routes/console/+page.svelte`, `src/routes/api/activity`, `src/routes/activity/+page.svelte`, `src/lib/components/ConfirmDialog.svelte` (read-only; T08 owns the component)
- **Test-first check:** use T09 console scenarios for typed-confirmation rejection, command allow-listing, and queue removal. Before rating a destructive-action finding, confirm whether the server, the UI, or both enforce confirmation.
- **Steps:**
  1. Review every GET resource for input validation, pagination bounds, response trimming, and unauthorized data exposure.
  2. Review PATCH validation and partial-object handling for movies and series, including season updates and tags.
  3. Review DELETE flows for typed confirmation, file deletion, import exclusions, queue removal, blocklist/exclusion deletion, and activity logging.
  4. Review command allow-listing and ID validation for Radarr and Sonarr.
  5. Review the console UI for tab/race handling, stale responses, error surfaces, destructive-flow clarity, and keyboard/focus behavior.
  6. Review activity pagination and data exposure.
  7. Check test coverage for destructive routes.
- **Verification:** validator exits 0; destructive findings cite either a runtime `E-NN` or the exact missing server/UI check.
- **Output contract:** console and activity findings with destructive-action risk called out explicitly.

### T06 — Passthrough, settings, connections, LAN, and restart

- **Depends:** T00, T09 for runtime evidence
- **Parallel-safe:** yes
- **Write scope:** `.scratch/code-quality-audit/findings/06-settings-passthrough.md`
- **Read scope:** `src/routes/arrapi/[service]/[...path]/+server.ts`, `src/routes/api/services`, `src/routes/api/settings/lan`, `src/routes/api/restart`, `src/routes/settings/+page.svelte`, `scripts/serve.mjs` (LAN/restart integration only; T07 owns scripts)
- **Test-first check:** use T09 passthrough probes for allowed GET, disallowed GET, all write verbs, encoded traversal attempts, and secret leakage. For connection probing, use a throwaway HTTP server with a known key and verify what is persisted and returned.
- **Steps:**
  1. Review allow-list regexes for over- and under-matching, query-string handling, encoded path traversal, host selection, and write-verb blocking.
  2. Review service URL validation for origin handling, path loss, credential handling, SSRF/metadata access, probe-before-save behavior, key masking, and error-detail leakage.
  3. Review LAN preference persistence, forced/CLI precedence, live broadcast failure behavior, host/address exposure, and restart-required messaging.
  4. Review restart route gating, response-flush timing, failure fallback, and supervisor assumptions.
  5. Review settings UI for fetch error handling, restart polling, API-key handling, and stale state.
  6. Check test coverage for passthrough and connection validation.
- **Verification:** validator exits 0; passthrough Critical/High claims cite `E-NN`; any skipped probe is documented as a limitation.
- **Output contract:** security-boundary findings separated from operational settings findings.

### T07 — Service lifecycle and developer scripts

- **Depends:** T00
- **Parallel-safe:** yes
- **Write scope:** `.scratch/code-quality-audit/findings/07-service-scripts.md`
- **Read scope:** `scripts/serve.mjs`, `scripts/service.mjs`, `scripts/mock-arrs.mjs`, `scripts/icons.mjs`, `package.json` scripts, `README.md` operational sections
- **Test-first check:** run `node --check` on each script before review. If ShellCheck is available, run it on extracted generated shell templates. Do not run install, uninstall, start, stop, restart, or tray commands against the host.
- **Steps:**
  1. Review shell/command construction for quoting and injection via paths, hostnames, environment variables, and repository location.
  2. Review launchd/systemd/Windows startup generation, permissions, path assumptions, working directory, logs, PID handling, duplicate instances, and port takeover.
  3. Review restart/stop/status behavior, supervisor handoff, stale PID cleanup, and crash/restart loops.
  4. Review mDNS lifecycle, LAN bind resolution, and forced/CLI precedence.
  5. Review mock arr fixtures for fidelity limits that affect the audit.
  6. Review icon generation only for unsafe file operations; do not audit visual output.
- **Verification:** validator exits 0; `node --check scripts/serve.mjs scripts/service.mjs scripts/mock-arrs.mjs scripts/icons.mjs` exits 0; output is recorded.
- **Output contract:** operational risks with explicit statement that install/uninstall paths were not executed.

### T08 — Cross-cutting frontend, mobile, and accessibility

- **Depends:** T00
- **Parallel-safe:** yes
- **Write scope:** `.scratch/code-quality-audit/findings/08-frontend.md`
- **Read scope:** `src/routes/+layout.svelte`, `src/app.css`, `src/lib/actions/modal.ts`, `src/lib/components/ConfirmDialog.svelte`, `src/app.html`, and cross-page patterns in the member/console/settings pages (read-only; feature owners write behavior findings)
- **Test-first check:** run `npm run check` and record the zero-warning baseline. If a browser or accessibility tool is available, use it for one member-page and one console-page smoke check; otherwise mark interaction findings `inferred`.
- **Steps:**
  1. Review modal focus management, escape/backdrop behavior, focus restoration, and dialog semantics.
  2. Review navigation landmarks, heading order, labels, live regions, error/status announcements, keyboard operability, and touch target sizes.
  3. Review mobile safe areas, viewport behavior, reduced motion, contrast tokens, and one-handed use.
  4. Review loading/empty/error states for consistency and whether failures are surfaced or silently blank.
  5. Review shared CSS for brittle coupling, duplicated rules, and token misuse with material impact.
  6. Record only issues with a concrete user or maintenance consequence; no aesthetic preferences.
- **Verification:** validator exits 0; `npm run check` output is attached; browser-dependent claims are marked `inferred` when not exercised.
- **Output contract:** cross-cutting UI findings with file/line references, no duplication of feature logic.

### T09 — Isolated runtime verification

- **Depends:** T00
- **Parallel-safe:** yes, but it is the only task allowed to start application servers
- **Write scope:** `.scratch/code-quality-audit/tools/runtime/`, `.scratch/code-quality-audit/evidence/runtime.md`
- **Read scope:** built application, `scripts/mock-arrs.mjs`, route contracts, `package.json`
- **Test-first check:** write the expected request/status/body matrix before executing it. The harness must fail on an unexpected status, a missing/extra field, or a secret appearing in a response.
- **Steps:**
  1. Create a temporary directory outside the repo. Set `ADDARR_DB` into it, run from that cwd, bind `127.0.0.1`, and choose a free port other than 4545. Start the built server with `node scripts/serve.mjs`; never use `npm start`.
  2. Start the mock arrs on 8787/8788 if free. If occupied, stop and record a blocked scenario rather than killing the process. Seed a movie, a series, and queue rows through `/__mock/*`. Extend the mock only in the temporary harness if Sonarr add must be exercised; do not edit the repository script.
  3. Exercise setup, second setup, invalid login, lockout, valid login, cookie flags, logout, and anonymous/invalid/admin access to every protected prefix.
  4. Exercise search (movie/series), add (success, duplicate, invalid id, missing preset), and status (queued/downloading/importing/available and malformed queue data).
  5. Exercise preset list/create/update/delete/default invariants, including a name-ordering scenario that can expose wrong-row identification.
  6. Exercise console summary/library/queue/history, validation failures, typed-confirmation rejection and success, queue removal, and command allow-listing.
  7. Exercise passthrough allowed GET, disallowed GET, all four write verbs, encoded traversal attempts, and key-leak checks.
  8. Exercise settings GET; avoid POST that starts mDNS unless the temp environment proves it is harmless. Do not call `/api/restart`.
  9. Scan every response and captured log for the mock API key and session cookie. Record redacted evidence.
  10. Tear down all child processes and the temp directory. Confirm the repository database checksum is unchanged and `git status` shows no source changes.
- **Verification:** `node .scratch/code-quality-audit/tools/runtime/run.mjs` exits 0; `evidence/runtime.md` contains `E-NN` entries with expected/observed/result; `git status --short` shows no application changes; no listeners remain on the chosen ports.
- **Output contract:** a reproducible evidence catalog that feature reviewers can cite without running their own servers.

### T10 — Synthesis and report

- **Depends:** T00, T01, T02, T03, T04, T05, T06, T07, T08, T09
- **Parallel-safe:** no; final gate
- **Write scope:** `.scratch/code-quality-audit/report.md`
- **Test-first check:** build a traceability table before writing prose: every report finding ID must map to exactly one findings file; every findings file must be represented in the coverage matrix.
- **Steps:**
  1. Run the validator against all findings files and fix only formatting or missing evidence, not substance.
  2. Deduplicate cross-feature findings by root cause; keep the owner's ID and list secondary locations.
  3. Reconcile severity/confidence conflicts and verify that every Critical/High is either runtime-verified or explicitly inferred.
  4. Write the report: executive summary, top risks, scope/method, baseline, findings by severity and feature, cross-cutting themes, test gaps, remediation sequence, coverage matrix, limitations, and evidence index.
  5. Include quick wins, structural fixes, and test-first recommendations, but do not implement them.
  6. State checks not run and any mock fidelity gaps.
  7. Confirm no application files changed.
- **Verification:** `for f in .scratch/code-quality-audit/findings/*.md; do node .scratch/code-quality-audit/tools/check-findings.mjs "$f" || exit 1; done` exits 0; `git status --short` shows no application changes; the report contains every finding ID and every coverage area.
- **Output contract:** a single report suitable for the user to triage and authorize remediation from.

## 9. Execution order and parallel batches

| Batch | Tasks | Rule |
| --- | --- | --- |
| 0 | T00 | Must finish before any findings are written |
| 1 | T01, T07, T08, T09 | Independent; T09 is the only runtime task |
| 2 | T02, T03, T04, T05, T06 | Feature reviewers use T09 evidence; findings files are disjoint |
| 3 | T10 | Synthesis only after every findings file passes validation |

No two tasks in the same batch write the same file. Shared source files are read-only for every reviewer. If a batch cannot run in parallel because of tool or port limits, run tasks sequentially in ID order without changing write scopes.

## 10. Verification strategy

- **Project checks:** `npm run check`, `npm test`, `npm run build`; record exact output and any warnings.
- **Format validation:** `node .scratch/code-quality-audit/tools/check-findings.mjs <file>` for every findings file.
- **Pure-function probes:** fixture-based `node --test` or inline `node -e` checks for status aggregation, add-resource payloads, preset defaults, and parsing helpers. Probes live in the audit tree or a temporary directory.
- **Runtime probes:** T09 harness with expected status/body assertions and secret scanning.
- **Destructive safety:** no host service commands, no real arrs, no real DB, no LAN broadcast, no restart endpoint.
- **Traceability:** every report claim maps to a finding; every finding maps to a file and evidence.
- **Final gate:** validator passes for all files; `git status` is clean for application code; report path exists and contains the required sections.

## 11. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Mock arrs differ from real Radarr/Sonarr | Mark API-shape findings `inferred` when the mock cannot represent them; state the fidelity gap in the report |
| Runtime harness mutates user data | Temp cwd, `ADDARR_DB` override, checksum check, no real DB |
| Port collisions or lingering processes | Check ports before start, fail safely, tear down in a `finally` path, record blocked scenarios |
| Static review misses Svelte reactivity/races | Use T09 where possible; otherwise mark `inferred` and cite the exact reactive path |
| Finding volume overwhelms the report | Full detail for Critical/High/Medium; compact table for Low; deduplicate by root cause |
| Reviewer duplication or conflicting severity | Explicit ownership map; T10 reconciles |
| No browser/a11y tooling | Static review plus `svelte-check`; do not overclaim runtime accessibility |
| Dependency audit unavailable offline | Record skipped check; do not substitute stale advisory data |
| Service scripts are platform-specific | Static review plus syntax checks only; no host install/uninstall |

## 12. Open questions

- Should dependency advisories be included in the main severity ranking, or kept as a supplemental appendix? Default: supplemental unless a direct exploitable path is found.
- Is `npm audit` acceptable network access in the execution environment? Default: run if reachable, otherwise record as skipped.
- Should the report include a proposed issue breakdown for `.scratch/` tickets? Default: include a remediation sequence, but do not create issue files without a separate authorization.
- Should Low findings be included at all? Default: yes, compactly, because the user requested a code quality audit rather than a security-only review.

## 13. Done definition

The plan is complete when the report exists at `.scratch/code-quality-audit/report.md`, every implemented feature in §2 has a coverage entry, every finding passes the validator, all Critical/High findings have verified evidence or a justified `inferred` label, the baseline checks and runtime results are recorded, and no application code or user data has changed.
