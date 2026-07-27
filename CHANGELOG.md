# Changelog

All notable changes to the **ADRs for AI** extension are recorded here, loosely following [Keep a Changelog](https://keepachangelog.com/).

This file starts at **v0.5.0** — the first release built from a rebuilt, in-sync `dist/` bundle after several months of the compiled output drifting from source. Development before that point was real (the sidebar, the Open Questions panel, seeds, deep links, ADR Commit all predate it) but wasn't versioned in a way worth reconstructing here; v0.5.0 is where this project's own version numbers became trustworthy.

Several of this project's public incident debriefs (DEBRIEF-003, 004, 006, 007) are referenced by name below rather than smoothed over — see `docs/adr/DEBRIEF-*.md` for the full write-up of each, including the ones not tied to a single version (DEBRIEF-002, a data-scoping bug; DEBRIEF-005, a release-process gap). Keeping a public record of what broke and how it was found is part of what this extension is for.

---

## [0.7.39] - 2026-07-26

### Fixed
- **Tour mode, first click-through fixes**: clicking a specific question inside a tour now actually enters that tour instead of landing in the plain walk; once in tour mode, clicking any other question in the sidebar now correctly leaves the tour instead of silently doing nothing (previously the only way out was the explicit Exit-tour link); the counter no longer misreports "9 of 9" on first opening a tour; the panel's tab title now shows the active tour's name.

## [0.7.38] - 2026-07-26

### Added
- **QuestionTours, reference implementation (ADR-0034)**: a tour is a curated, ordered, annotated walk over your existing open questions — a view, never a second queue. Run **ADR Manager: Mint Tour from Current Filter** to save the sidebar's current filter (open/all/answered) as a named, shareable `docs/adr/tours/*.tour.json`; tours appear in a new **Tours** sidebar category; clicking one opens the Open Questions panel in tour mode — same panel, same drafts, same anti-clobber protections, dressed with the tour's own title, author, and optional color theme. Entries that can't be resolved are shown, never silently dropped.

## [0.7.37] - 2026-07-26

### Fixed
- **The write path now tolerates exactly what the read path tolerates** — the answer-write scan carried private, narrower copies of two recognitions and both diverged from the parser: ANS headers written with the colon outside the bold (`**ANS**: …`) were invisible to the write anchors (causing duplicate ANS blocks and insertion previews for questions with a perfectly good anchor), and only the canonical `[Fill this in]` counted as a replaceable placeholder (so `[Fill this out]`, `[tbd]`, `_pending — routing to …_` and friends prefilled as if they were real answers). Both recognitions now come from the extractor's exported predicates — the same "one parser, N consumers" fix as v0.7.17, one level deeper.
- `**ANS**: (by Name)` — colon-outside marker with the byline after the colon — now captures the author instead of leaking `(by Name)` into the answer text. Keyword-required: a bare `(Name)` after the colon stays content, per the QST-ANS-BYLINE posture (unrecognized bylines degrade to preserved text, never to a fake author).
- `[Fill this out]` is now canonical alongside `[Fill this in]`.

## [0.7.36] - 2026-07-25

### Added
- **Staleness banner** (ADR-0023 square 4): if a second Open Questions window (or any future draft-writing surface) saves a draft for the same question you're looking at, the panel now shows it — a word-diff summary, the save time, and where it came from when that's informative — with Keep yours / Update / See diff (VS Code's own diff editor) instead of silently living with an unseen change. Pairs with v0.7.34's compare-and-swap vault fence, which already guaranteed nothing gets lost; this makes that guarantee visible.
- **Error harvesting at the point of failure is live** (ADR-0035): every panel error now appends a full-reconstruction record — the entire ADR text, the entire answer box, and the triggering message — to the owning project's `docs/adr/.working/errors.jsonl`. On by default (`adrManager.logErrors`) during this collection era; a `scripts/harvest-errors.mjs` sweep script ships alongside it.

## [0.7.35] - 2026-07-25

### Fixed
- Recommendations written as `**Recommendation**: (by Author, …) text` — attribution after the colon on the same line — now parse with the full attribution (reviewers, dates and all) instead of showing a fragment of the Deciders line in the author chip and pushing attached commentary out of order.
- Semicolon-separated Deciders rosters with parenthetical annotations no longer get shredded at every comma.

## [0.7.34] - 2026-07-24

### Added
- **The solemn promise**: whenever a draft save would overwrite same-question content its author never saw (two Open Questions windows racing, or any future surface), the overwritten content is archived first, marked `clobbered` — distinct from typing history, never lost. Detection is compare-and-swap (each save declares what it believes it's replacing), so there are no heuristics to be wrong. Drafts also record their provenance (`source`: panel, file-prefill, mobile, …).

## [0.7.33] - 2026-07-24

### Added
- The "file also holds an existing answer" banner now shows the file's **save time**, and if the file's answer changes **while you're editing**, a banner appears — "the file changed while you were editing (saved HH:MM) — load new file answer · keep my editing" — without ever touching your in-progress text. The submit-time drift fence's protection, moved up to edit time; the clobber-coexistence matrix is recorded in ADR-0023.

## [0.7.32] - 2026-07-24

### Added
- **Answer dialogues parse as layers**: a question holding multiple Q&A rounds — answer, then `**Recommendation (updated)**:`, then `**ANS (to the updated recommendation):**` — now yields every recommendation and every answer round separately (with their round labels), instead of one truncated blob. An empty trailing ANS slot reads as "re-asked, awaiting" — the question stays open with its history intact.
- **Answering writes into the latest slot only** — the dialogue history is never replaced by a new answer, in both the panel and the MCP write path.
- When a local draft and an existing file answer both exist, the panel says so and offers **"load file answer instead"** — nothing is silently preferred in either direction (fixes a stale two-word draft silently shadowing, then replacing, a full file answer).

## [0.7.31] - 2026-07-24

### Added
- **Expand field ⤢** link on the answer box's hint line (and Cmd+Shift+E): grows the field to fill most of the panel, so a long existing answer-thread — the system3 case where a 6,900-character discussion read as "unanswered" through a small box — is readable and editable in place. Same field, same draft; toggle back with Collapse ⤡.

## [0.7.30] - 2026-07-24

### Added
- Right-click a multi-root sidebar entry → **Exclude This Root** — writes the exact relative path into `docs/adr/.settings/roots.json`'s `block` list (never a glob), with a preview of the resulting file contents before anything is written, and a one-shot "Undo" toast right after. The edit is the documentation of the config, the same way `.working/` already is.

## [0.7.27] - 2026-07-22

### Fixed
- Markdown emphasis on keywords no longer defeats recognition, as a class: `- Status: **answered**`, `_accepted_`, document-level `**Withdrawn**`, and bold/code-wrapped placeholders (`**pending**`, `` `tbd` ``) all read as their bare tokens, with a fix-it hint.
- A recommendation with its own structured sub-headings (`**Why**:`, numbered points) is no longer cut off at the first one — an attributed recommendation block runs to its real end (the ANS marker, a new recommendation, or the question's boundary).

## [0.7.29] - 2026-07-23

### Fixed
- Answering a question whose ANS block already holds an unconfirmed draft (open under Status-authority, e.g. legacy ADRs where Status was never flipped) now **replaces** the draft cleanly instead of prepending onto it — and on the compact `**ANS:** (by X) text…` one-line form, no longer destroys the draft's first line.

### Added
- When a question is open but carries an existing draft answer, the panel **prefills the answer box with it** ("Existing draft answer loaded — edit if needed, then Answer to confirm & close") — confirming a legacy draft becomes read, maybe edit, Cmd+Enter, and you can never type blind against invisible content.

## [0.7.28] - 2026-07-22

### Fixed
- **Expand All now actually works.** It had been a 100%-silent no-op since shipping: VS Code's `reveal()` API requires the tree provider to implement `getParent` and to give items stable identities — the provider had neither, so every reveal failed and the command's own error-swallowing hid it. Tree items now carry stable tree-wide ids and the provider implements `getParent`; found by Jérémie testing it live between GIF takes.

## [0.7.26] - 2026-07-22

### Added
- **Sidebar badge** (ADR-0029): the Activity Bar icon now shows your open-question count, native VS Code badge styling (no custom color or animation). Tooltip discloses "N open questions · M files with parse warnings" so a confident number is never trusted blind. Configurable per source — `adrManager.badge.include.adr` / `.seed` — and the tooltip's parse-health line can be turned off with `adrManager.badge.showParseHealth`.
- **Expand All** button in the sidebar's title bar, beside Collapse All — re-expanding a tree you accidentally collapsed no longer requires doing it node by node.

## [0.7.25] - 2026-07-22

### Changed
- `docs/adr/.working/drafts.json`'s `adrPath` field is now repo-relative rather than a machine-local absolute path — the committed file travels between machines (and, for the ios-client mobile companion, to a surface with no local git checkout at all) by design, so an absolute path inside it was a latent cross-machine bug. Existing entries still written in the old absolute form are read tolerantly and rewritten to the new form the next time they're touched — no migration script, no flag day.

## [0.7.24] - 2026-07-22

### Fixed
- Open Follow-up questions' `- Why deferring:` field — part of the template since the beginning — is now extracted and shown in the panel's question context, instead of being silently invisible outside the raw file.

## [0.7.23] - 2026-07-19

### Changed
- **Status-authority (ADR-0031, ratified)**: when a question declares a `- Status:` line, that line alone decides whether it's answered — answer text below is a draft until Status flips. This makes *reopening* a question work (edit Status back to `unanswered`), and a model can no longer accidentally close a question by writing plausible prose. Questions with no Status line behave as before. A migration script for long-settled "zombie" questions ships in `scripts/ephemeral/`.

## [0.7.22] - 2026-07-19

### Fixed
- Question headings written as `### QST 1:` (space before the number, as in the template's own "Iteration 1" style) are now recognized as questions with proper ids and anchors, with a fix-it hint toward `QST-1:` — previously they were silently invisible.

## [0.7.21] - 2026-07-19

### Added
- **Insertion-preview protocol** (DEBRIEF-006, launch-gating): when the Open Questions panel has to append a brand-new ANS block because a question has no `**ANS:**` marker or placeholder at all, it now shows the 3 lines before and after the computed insertion point — with a `------ inserting here ------` marker — and waits for confirmation before writing. New setting `adrManager.missingAnsBehavior` (`confirm` / `silent` / `refuse`, default `confirm`) controls this per folder.

### Fixed
- **DEBRIEF-007**: a question whose ANS block has an empty attribution — `**ANS:** (by )` followed by `[Fill this in]` — is now correctly OPEN. Previously the literal `(by )` text was read as answer content, silently marking the question answered and hiding it from the panel.

## [0.7.20] - 2026-07-18

### Fixed
- **DEBRIEF-006**: answering a question whose block is longer than ~40 lines could insert the answer in the wrong place — mid-sentence inside the recommendation. The insertion point is now always a real structural boundary (next heading, divider, or end of file), never an arbitrary scan limit, and the write refuses rather than guessing.

## [0.7.19] - 2026-07-18

### Fixed
- Recommendations and answers with keyword-less attribution — `**Recommendation** (Author): ...` or `**ANS** (Author): ...`, no "by"/"from" — are now parsed in full with the attribution preserved, instead of falling through to unstyled body text.

## [0.7.18] - 2026-07-16

### Added
- QST handle ids now allow interior hyphens and up to 24 characters (`### QST-STATUS-AUTHORITY: …`), so topical handles are first-class alongside lettered ones — anchors preserve the hyphens (`#qst-status-authority`). Existing short ids are unaffected.

### Fixed
- A `QST-…:` heading whose id doesn't conform to the handle grammar is now recognized as a question with a fix-it warning, instead of silently disappearing from every view with no diagnostic at all.

## [0.7.17] - 2026-07-16

### Fixed
- Questions using bold `- **Status**:` fields can now be answered from the Open Questions panel — previously the panel refused with "Could not find the ANS block… answer this one manually," even though the question displayed fine. The panel's and MCP's write paths now recognize exactly the forms the parser reads (one shared definition), including `### QST-N:` handle headings as block boundaries.
- ADR titles using en/em dashes as the number separator (`# ADR 0033 — Title`) display cleanly in the tree and panel. (Landed 2026-07-14, entry backfilled.)

## [0.7.16] - 2026-07-15

### Fixed
- The "answer may not have saved" warning no longer fires as a false positive (and no longer blinks away — it now persists until dismissed). (Entry backfilled by v0.7.17's release.)

## [0.7.15] - 2026-07-15

### Added
- Multi-root workspaces: the extension now discovers every ADR-bearing project root in the workspace and watches each one — sidebar, panel, and diagnostics aggregate across roots instead of serving only the first folder. (Entry backfilled by v0.7.17's release.)

### Fixed
- Our own demo fixture's recommendation rendered attribution-only with the body escaped below the styled block — root-caused to the attribution regex breaking on a nested parenthesis in the author name (`Sonnet 4.6 (1M)`).

## [0.7.14] - 2026-07-14

### Fixed
- Phantom ADRs: opening or editing any date-prefixed markdown file anywhere in the workspace (e.g. a research report in `docs/reports/`) no longer injects it into the ADR index as a ghost entry. Live-edit reindexing now applies only to files actually inside the configured ADR directory, matching what the disk watchers always enforced.

## [0.7.13] - 2026-07-14

### Fixed
- Answers written in the `**ANS** (by Name): ...` form — attribution between the bold marker and the colon — are now parsed in full, with attribution preserved. (Entry backfilled by v0.7.14's release; shipped in v0.7.13.)
- Bold Status fields inside question blocks (`- **Status**: ...`) are now recognized, and annotated status values (`answered 2026-07-13 (details...)`) correctly mark a question as answered while preserving the annotation.

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
