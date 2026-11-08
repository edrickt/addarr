# Downloads covers the whole library, not just Addarr requests

The member-facing Downloads page (see `GLOSSARY.md`) answers "where's my stuff?" for the whole household. We decided it reflects the entire monitored library's pipeline rather than only titles added through Addarr: the download side shows everything the arrs are actively working on — admin grabs and quality upgrades included — and the not-yet-possible side covers every monitored title that is unreleased, or missing released content. The household library is shared, members care about what's coming to it rather than who added each thing, and activity-log correlation would be fragile. To keep the page sane at library scale, two filters apply: unmonitored items are excluded (the arr isn't pursuing them), and series missing-ness is measured against aired episodes only, with scheduled future episodes shown as "More coming" / "Not out yet" rather than as missing.

## Considered Options

- **Addarr-added only**, correlating the activity log with library items — rejected: fragile, and it silently hides titles the admin added directly that members are waiting on.
- **Whole library with the arrs' raw state semantics** — rejected: airing series would permanently read as "Still looking" (unaired episodes counted as missing), and long-abandoned items would persist on the page.
- **Whole monitored library with air-aware semantics** — chosen.

## Consequences

Downloads' member states deliberately diverge from the arrs' raw state semantics (monitored filter, aired-aware missing), so the page cannot be a thin formatting layer over the raw queue/library payloads — it owns its own state logic for the "not yet in the library" side.
