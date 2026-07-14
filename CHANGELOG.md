# Changelog

All notable changes to the **ADRs for AI** extension are recorded here, loosely following [Keep a Changelog](https://keepachangelog.com/).

This file starts at **v0.5.0** — the first release built from a rebuilt, in-sync `dist/` bundle after several months of the compiled output drifting from source. Development before that point was real (the sidebar, the Open Questions panel, seeds, deep links, ADR Commit all predate it) but wasn't versioned in a way worth reconstructing here; v0.5.0 is where this project's own version numbers became trustworthy.

Three of this project's public incident debriefs (DEBRIEF-002 through DEBRIEF-004) are referenced by name below rather than smoothed over — see `docs/adr/DEBRIEF-*.md` for the full write-up of each. Keeping a public record of what broke and how it was found is part of what this extension is for.

---

## [0.7.12] - 2026-07-14

### Fixed
- The Open Questions panel's collapsible "ADR context" box no longer shows the entire file (questions and freshly-written answers included) for ADRs whose questions don't live under a section literally named `## Questions`. The context boundary is now derived from where the questions actually sit, so freeform layouts get a correct, questions-free context box — and a corpus-wide regression test enforces that context can never again contain a question.

## [0.7.11] - 2026-07-13

### Fixed
- Parser now tolerates `[fill (this) in]` as a placeholder variant, joining the growing list of recognized non-canonical "not yet answered" tokens (see 0.7.2, 0.7.6).

## [0.7.10] - 2026-07-13

### Fixed
- Recommendations with inline attribution that span multiple paragraphs are now parsed in full, instead of being cut off at the first paragraph break.

## [0.7.9] - 2026-07-13

### Fixed
- A recommendation written with a dash bullet (`- Recommendation: ...`) instead of the canonical bold form is now recognized and can be auto-migrated, rather than silently dropped.

## [0.7.8] - 2026-07-13

### Fixed
- Fixed a block-extent bug where a section could swallow more trailing content than it should. `writeAnswer` now appends a missing `**ANS:**` block instead of failing when one isn't present.

## [0.7.7] - 2026-07-12

### Fixed
- A bullet point that hard-wraps onto a second line in your editor no longer escapes its list item or gets chopped out of the extracted text — fixed in both the parser and the Open Questions panel's rendering.

## [0.7.6] - 2026-07-12

### Fixed
- Follow-up to DEBRIEF-004: a transient, empty data refresh from the file watcher no longer resets which question the panel thinks you're viewing.
- `awaiting` added to the list of tolerated non-canonical "not yet answered" placeholder words.

### Added
- An internal, standing test program that continuously checks the parser against real-world ADR formatting variations, to catch tolerance gaps before they reach users.

## [0.7.5] - 2026-07-12

### Added
- **Clicking a question in the sidebar now opens the Open Questions panel by default**, focused on that question, instead of jumping straight to the raw file. File access is still one right-click away (`Go to Answer Field in File`). Configurable via `adrManager.clickOpensIn` (`panel` | `file`).

### Fixed
- `<!-- @adr-anchor: ... -->` HTML comments no longer leak into the Open Questions panel's rendered text.
- The `New Seed` command's generated template had drifted from the canonical seed template — now generated from the same single source, so they can't drift apart again.
- Wrapped-placeholder recommendations with inline attribution now parse correctly.

## [0.7.4] - 2026-07-12

### Fixed
- Seeds now scan every section for questions, not only ones under specific headings like "Thread" or "Brain Dump" — a correctly-formatted question under a custom section name no longer silently disappears from the Open Questions panel.
- A heading one level too shallow (e.g. `## QST:` instead of `### QST:`) is now tolerated, with a diagnostic, instead of being silently mis-parsed.
- The "changes committed" notification now names what was actually committed (ADRs, seeds, etc.) instead of calling everything an "ADR."

## [0.7.3] - 2026-07-12

### Fixed
- **DEBRIEF-004** — the most severe panel bug found this cycle: the Open Questions panel could silently discard an entire in-progress answer while it was being typed, and the draft-recovery safety net (0.6.0) didn't catch this specific case. Root-caused to three distinct bugs sharing one underlying cause (question identity drifting when the question list re-ordered mid-session); all three fixed and regression-tested.

## [0.7.2] - 2026-07-12

### Fixed
- **DEBRIEF-003** — the Open Questions panel was resetting the answer box and moving the cursor to the end of the text on *any* file change elsewhere in the project, not just the file being viewed. It now only touches the answer box on an actual navigation to a different question.
- A bare `[ ]` (empty brackets) as a placeholder answer is now recognized as "not yet answered," the same as the canonical `[Fill this in]` — previously it silently counted as a real answer and the question vanished from the panel.

## [0.7.1] - 2026-07-12

### Fixed
- A recurring bug where the Open Questions panel sometimes failed to advance to the next question after an answer was submitted — root-caused and fixed at the source.

## [0.7.0] - 2026-07-11

### Added
- Questions can now carry an explicit, stable id — `### QST-<ID>: <title>` (e.g. `QST-AUTH`) — alongside the plain `### QST:` form, for referencing a specific question without relying on its exact wording.

## [0.6.1] - 2026-07-10

### Added
- A Quick Fix that rewrites a non-canonical "not yet answered" placeholder (e.g. `[unanswered]`) to the canonical `[Fill this in]` form.

## [0.6.0] - 2026-07-09

The largest release in this project's history so far.

### Added
- **Questions inside seed files are now fully first-class** — they appear in the sidebar tree and the Open Questions panel, answerable in place exactly like ADR questions. Previously a seed's own questions were invisible to both.
- **MCP tool handlers implemented** (read tier: `lookup`, `get_outline`, `get_sections`, `list_open_questions`; write tier: `answer_question`, `add_recommendation`, `append_iteration`, `update_resolution`) — the foundation for AI assistants to read and update ADRs directly. Not yet exposed as a connectable server in this release.
- The README was rewritten for people encountering the extension for the first time, not only for its existing contributors.

### Fixed
- Draft persistence (the anti-clobbering safety net) hardened against three additional ways it could still lose or misattach an in-progress answer.
- A panel-advance race that could, under specific timing, show the wrong next question after answering.
- Question identity is now stable across line-number shifts even when duplicate question text exists in the same file.

## [0.5.2] - 2026-07-06

### Added
- `Commit ADR Changes` now pre-fills a commit message, and gained a context-menu entry and a keyboard shortcut (`Cmd+Alt+Shift+A` / `Ctrl+Alt+Shift+A`).

### Fixed
- Extension icon corrected for the Marketplace listing.

## [0.5.1] - 2026-07-06

### Added
- A way to check which version of the extension is actually running (status-bar tooltip, and an `ADR Manager: Show Version` command) — so a stale install becomes obvious in seconds, not by accident.

### Fixed
- The packaged extension no longer bundles a multi-megabyte `temp/` test-fixture folder that had been shipping by accident.

## [0.5.0] - 2026-07-06

Rebuilt and republished after the compiled `dist/` bundle had gone stale since March — the first release where the shipped extension matched its source again.
