# Changelog

## [0.7.117] - 2026-09-26

### Fixed
- **The Commit button at the top of the sidebar now always commits every project's ADR changes, wherever your cursor is.** VS Code hands the currently focused tree item to toolbar buttons, and the button was treating it as "commit just this item" — so with an ADR focused that had no changes, it reported "no changes" even when other files did. Right-click Commit on an item still commits just that item.

## [0.7.116] - 2026-09-26

### Fixed
- **A question marked `Status: deferred — <reason>` (or `unresolved — <reason>`) now gets its [deferred] tag, its own icon, and honors the "hide deferred questions from the panel" setting** — previously only a bare `deferred` did, so anyone following the template's annotated status form saw none of it. Reported independently from two different projects.

## [0.7.115] - 2026-09-26

### Fixed
- **A Recommendation whose "(by …)" attribution wraps across several lines is now recognized whole.** Previously the author was lost, the first attribution line leaked into the recommendation text, and the actual recommendation paragraph spilled out below the styled block. Hard-wrapped attributions are ordinary model output; they now read exactly like single-line ones.

## [0.7.114] - 2026-09-26

### Fixed
- **The Report buttons no longer say "recorded" when nothing was recorded.** Both the panel's Report and the sidebar's Report announced success right after writing to the project's error ledger without checking whether the write actually happened — so an unwritable ledger produced a "reported" confirmation over a report that went nowhere. A failed save now warns you, echoing your note back so you can keep it; and the panel Report's catch-all, which used to swallow any error with no trace, now tells you too.

## [0.7.113] - 2026-09-14

### Added
- **`adr:`/`seed:` links now open from outside VS Code, not just from inside it** — a new `vscode://jlumbroso.adrs4ai/open?target=<link>` handler (built for Pigeonhole, the estate's human inbox, but usable by anything that can launch a URL). A link naming a question opens the Open Questions panel navigated to it; a link naming just an ADR or seed reveals it in the sidebar tree — both configurable via the new `adrManager.deepLink.openIn` setting (`question-dialog` | `tree` | `markdown`), which also doubles as the plain-markdown off-switch. A target that can't be shown the preferred way — hidden by an active tree filter, or unresolvable altogether — always falls back to opening the file directly, loudly, never silently.

## [0.7.112] - 2026-09-06

### Fixed
- **A logged command error could land one level ABOVE your workspace instead of inside it** — commands whose real argument is a plain file path (like "Open ADR"), or any Command-Palette-invoked command with no tree item at all, could have their error-ledger anchor resolve to the workspace root's own parent directory instead of `docs/adr/.working/`. Found by Fixture 5 while deepening the command smoke-test harness (a stray `errors.jsonl` actually appeared outside a test's temp workspace on their own machine).

## [0.7.111] - 2026-09-06

### Fixed
- **Four more commands had the exact same unawaited-async bug 0.7.110 fixed in "Commit ADR changes"**: "Open ADR", "Create ADR", "Filter Questions", "Change Status", and "Go to Answer in File" could all silently drop an internal error as an invisible unhandled rejection instead of it reaching `errors.jsonl` or the user. Found by extending the new command smoke-test harness's audit to every command in the file, rather than trusting that the first fix had closed the whole class.

### Added
- **Deeper, real-behavior assertions for eight more commands** in the smoke-test harness (Create ADR, Copy Path/Copy Relative Path, Add Thread Turn, Exclude Root, Mint Tour, and the Hide/Show Completed Tours pair) — checking that the right file/config actually changed on disk, not just that the command didn't crash.

## [0.7.110] - 2026-09-06

### Fixed
- **A real bug in the error-logging safety net itself**: the "Commit ADR changes" command's own registration never awaited its work, so an error inside it became an invisible unhandled rejection instead of reaching `errors.jsonl` — the exact guarantee 0.7.109 shipped to close. Found by a new automated test harness that actually invokes every menu command's real handler (previously, tests could only check the source code's shape, never call the code and see what it does).

### Added
- **A menu-command smoke-test harness** — every sidebar right-click command is now automatically invoked end-to-end in tests, against a real fixture workspace with a real mixed-case GitHub remote (the exact shape that caused 0.7.108/0.7.109's "Copy Deep Link" crash), catching this class of bug before it ships instead of after.

## [0.7.109] - 2026-09-05

### Fixed
- **Copied deep links to a repo with a mixed-case GitHub org (like this one's own `ADRs4AI`) now keep the real case** instead of being silently lowercased. The previous fix (0.7.108) avoided the crash by normalizing at build time, which erased the real name everywhere the link got pasted; it now validates case-insensitively but preserves exactly what's there, matching how GitHub itself displays names.

### Added
- **A status-bar confirmation when a command error reaches the ledger** ("Error logged to errors.jsonl"), alongside VS Code's own error popup — the same lightweight feedback the Report button already gives.

## [0.7.108] - 2026-09-05

### Fixed
- **"Copy Deep Link" (and every command building a repo-scoped canonical link) no longer crashes in THIS repo itself.** Its own GitHub org, `ADRs4AI`, has mixed case, and the canonical-reference grammar required an all-lowercase owner/repo — a real, reproducible crash on every item, not an edge case. Owner/repo are now case-normalized before validating and encoding, so differently-cased refs to the same repo also now produce the identical canonical string.

### Added
- **Every command error is now automatically captured to `errors.jsonl`**, not just the ones with their own hand-added logging. A single wrapper around command registration catches whatever a handler throws, logs it (which command, the raw error), and re-throws — VS Code's own error popup still fires exactly as before, this only adds the automatic paper trail behind it.

## [0.7.107] - 2026-09-03

### Added
- **A code span whose entire content is one of our own `adr:`/`seed:` refs (bare or canonical `adr://v1/...`) is now clickable**, staying monospace. Scoped narrowly to our own reference scheme, not any URL in backticks — this repo's own docs have real examples of a code-wrapped URL that's deliberately not meant to be navigated yet, and those stay inert.

## [0.7.106] - 2026-08-30

### Fixed
- **A reopened question no longer shows a fully blank answer box.** A bare `**ANS:** (by ...)` placeholder round placed after a real answer (with no new Recommendation between them) correctly reopens the question — that's intentional dialogue-layering behavior, unchanged — but the answer box had nothing to show because it only ever looked at the *current* round. It now falls back to the last real round's text, so your prior answer resurfaces as a pre-filled draft instead of vanishing.

## [0.7.105] - 2026-08-30

### Added
- **Seeds' Hide/Show filters now match ADRs': a "Hide/Show Seeds Without Open Questions" pair**, alongside the existing "Hide/Show Closed Seeds" — the Seeds category header was one filter dimension short of the ADRs one, with no design reason behind the gap.
- **A root-level "Hide/Show Without Open Questions" toggle** that sets the ADRs and Seeds dimensions together in one gesture, from a project root's own right-click menu — no more toggling each category header separately to get to "just show me what's left to do."

## [0.7.104] - 2026-08-29

### Fixed
- **"Commit ADR changes" no longer says "no changes" right after you've just saved one** (answered a question, added a recommendation, etc.). The command was reading the git extension's own cached status, which refreshes asynchronously off a file watcher and can lag a beat behind a write this extension just made itself — a real race, not a display-filter issue. It now forces a synchronous git-status refresh immediately before checking for anything to commit.

## [0.7.102] - 2026-08-26

### Added
- **`adr:`/`seed:` refs are now clickable in the integrated terminal**, not just in editor documents — crew briefs and logs routinely print bare refs and canonical `adr://v1/...` URIs in terminal output; clicking one jumps to the target the same way clicking an in-document link already does.

## [0.7.101] - 2026-08-26

### Fixed
- **"Copy Deep Link" now copies a link that survives being pasted into a different repo**, not just a different project in the same workspace. When your project has a git remote, the copied link is now fully qualified (`adr://v1/repo/<owner>/<repo>/...`) instead of stopping at the project-local form.

## [0.7.98] - 2026-08-26

### Added
- **Fully qualified deep links are clickable everywhere**: canonical `adr://v1/project/...` and `adr://v1/repo/owner/name/...` URIs now parse (per ADR-0008's grammar) and resolve like their short forms — and the editor's link detection catches bare refs (`adr:0008#decision` typed straight into prose) and canonical URIs, not just `[wrapped](adr:...)` links, matching what the panel learned in v0.7.91. A canonical ref that doesn't resolve tells you which project/repo it was scoped to, so "not found" and "wrong workspace" are different messages.

## [0.7.97] - 2026-08-26

### Fixed
- **"Commit" on an individual ADR or seed (or the ADRs/Seeds category header) now commits only what it applies to**, instead of every changed file in the whole project. Right-clicking one ADR no longer sweeps in unrelated ADRs, seeds, or bookkeeping changes.

## [0.7.96] - 2026-08-26

### Fixed
- **A recommendation mentioning `<details>` by name (in backticks, as prose) no longer silently swallows everything after it.** The parser's `<details>` fold-tracking didn't know the difference between a real HTML tag and a code-quoted mention of one — a stacked second recommendation and its answer could vanish into the first recommendation's text.

## [0.7.95] - 2026-08-25

### Added
- **"Copy Deep Link" is now multi-root aware.** In a workspace with more than one project, the copied reference is now qualified (e.g. `elenchus-app.0025`) instead of a bare `adr:0025` — a bare reference pasted into a different project could silently resolve to the wrong document, since ADR numbers aren't unique across projects.

## [0.7.94] - 2026-08-25

### Fixed
- **Cmd+Enter now works when an insertion preview is showing** — it used to do nothing, silently re-showing the same preview, forcing you to click "Insert here" by hand.

## [0.7.93] - 2026-08-25

### Added
- **"Commit" is now on every tree node it can apply to** — individual ADR and seed items, and the ADRs/Seeds category headers, not just the root. Always commits that item's whole owning project, one consistent mental model everywhere.
- **Hide/Show Settled ADRs, Hide/Show ADRs Without Open Questions, Hide/Show Closed Seeds** — new right-click toggles on the ADRs and Seeds category headers, same shape as the existing Hide/Show Completed Tours.

### Fixed
- **The Report button no longer shows when it can't actually do anything.** It used to stay visible even with reporting turned off, then show a "turned off" warning on click — now it's hidden in that state, on both the panel button and the tree-wide Report menu entry.

## [0.7.92] - 2026-08-25

### Fixed
- **"Create New ADR" now asks which project in a multi-root workspace**, instead of silently guessing the first workspace folder (and numbering off the wrong project's ADRs). Follows your active editor's project by default; `adrManager.newAdrTargetRoot` pins one project regardless of which file is open, `adrManager.alwaysPromptOnMultiRoot` always asks.

### Added
- **Right-click a project → Create New ADR** opens the same ADR/Seed picker, scoped to that project directly — no prompt needed.
- **Right-click the ADRs or Seeds category header → Create New ADR/Seed** creates that kind directly in that project.

## [0.7.91] - 2026-08-21

### Added
- **Links now work in the Open Questions panel.** External `https://` URLs (both `[text](url)` and bare) open in your browser; internal `adr:NNNN#slug` / `seed:...#slug` references (both wrapped and bare, e.g. typed straight into an answer) jump to the right spot in your workspace — previously neither form did anything at all.

## [0.7.89] - 2026-08-18

### Fixed
- **A question's real `- Status: answered` line could be silently overridden by an illustrative example inside a fenced code block further down the same question.** If a question's body included a ` ```markdown ` example showing what a header field looks like (e.g. `- **Status**: Accepted` inside a sample block), the parser had no concept of code fences and treated that example line as the question's own status — same doctrine gap `<details>` folding already closed, applied to a second real specimen.

## [0.7.87] - 2026-08-16

### Fixed
- **Annotated statuses get their real icons** (DEBRIEF-009): a document whose Status carries an annotation — `Implemented — see PR #123` — showed a generic file icon instead of its checkmark, because the icon table did its own exact matching instead of asking the parser. Status knowledge now lives in one place with layered resolution (exact first for legacy fidelity, the parser's normalized read second); the suspension states (`Deferred`/`Paused`/`Suspended`/`On Hold`) get pause icons for the first time.

## [0.7.86] - 2026-08-16

### Fixed
- **A paused ADR no longer shows an expand arrow that opens onto nothing.** The sidebar's parent-item row wasn't checking document-pause the same way its children already did.

### Added
- **"Hide Completed Tours"** — the Tours category can now hide fully-done tours by default (`adrManager.tours.hideCompleted`, on by default). Toggle from the Tours category's own right-click menu.

## [0.7.85] - 2026-08-15

### Changed
- **New extension icon: the scale** (`scale-only-amber`, by Caliper, brand-studio). Chosen by Jérémie over three pinion variants after live A/B on the activity bar: "the scale, as deliberation, is a powerful metaphor alone" — amber for the Marketplace tile, `currentColor` outline on the activity bar, legible at every size, beautiful without a badge and still clear with one. The documents icon retires; deliberation is the brand, files are just where it lives.

## [0.7.81] - 2026-08-14

### Added
- **Configurable root captions** (`adrManager.roots.captionMode`, default `git-auto`) — a submodule root used to show a slugified CLAUDE.md description instead of its real name (the old git-remote reader never followed a submodule's gitlink). Choose "git slugs" (`owner/repo`), "git repo names", or "auto" (bare repo name unless a root's owner isn't the workspace's majority owner).
- **Per-root "Expand All" and "Focus on Root"** context-menu items — expand just one root's subtree, or collapse everything and re-expand one root in a single click.
- **Per-root "Commit changes"** context-menu item — commits that one root directly, skipping the cross-root picker.
- **Project name in the Open Questions panel header** (`adrManager.panel.showProjectInHeader`, default `auto`) — shows the owning root's caption flush-right next to "Question N of M" when your question set spans more than one root, so you always know which project you're answering for.

## [0.7.80] - 2026-08-14

### Fixed
- **Tree-wide Report no longer crashes on any open question** (root cause of the 0.7.79 silent failure). Reporting used to throw "Converting circular structure to JSON" the moment its full-tree snapshot reached an open question anywhere — not just root items — because a question's default click-target embeds a live reference to itself. The diagnostic snapshot now degrades gracefully instead of crashing.

## [0.7.79] - 2026-08-14

### Fixed
- **Tree-wide Report on a root item no longer vanishes with zero trace.** A reported root tree item could silently no-op — no confirmation, no ledger entry, no error — leaving nothing to diagnose. It now logs unconditionally to the "ADR Manager" output channel whenever the report can't be anchored or something throws, so the next occurrence is diagnosable instead of a second silent void.

## [0.7.78] - 2026-08-13

### Fixed
- **Commit failures and rejected "Add Thread Turn" edits now reach the error ledger**, not just a toast you'd have to copy by hand. Both write full diagnostic detail (including the raw git error) to `.working/errors.jsonl` alongside the existing on-screen message.

## [0.7.77] - 2026-08-12

### Added
- **Seeds get real lifecycle glyphs** (ADR-0041) — no more one wrench for everything pending. The sidebar now distinguishes parked / superseded / terminated (declared), chunked with a rollup badge (`chunked · rollup: partial`), and iterating vs. quiet (staleness shown by icon brightness, not a new label). New setting `adrManager.seeds.showOpenQuestionCount` (default on) lets you hide the open-question count from the description.

## [0.7.76] - 2026-08-12

### Added
- **Seed aging threshold settings** (`adrManager.seeds.agingMode`/`.adaptiveMultiplier`/`.fixedThresholdDays`) — foundation for ADR-0041's two-axis seed lifecycle display, landing incrementally. Not yet wired into the sidebar; this ships the configurable threshold math ahead of the tree-rendering work.

## [0.7.75] - 2026-08-12

### Fixed
- **"(stacked by Name, ...)" attribution is now recognized** — recommendations using this same-line form used to all attribute to the wrong person (whoever's inferred from the Deciders field), regardless of who actually wrote them, with the literal parenthetical leaking into the visible text.

## [0.7.74] - 2026-08-11

### Fixed
- **Two adjacent recommendation bullets with no blank line between them no longer merge into one run-on line** — the second bullet's marker used to survive as a stray literal dash-and-text tail glued onto the first bullet's sentence.

## [0.7.73] - 2026-08-10

### Fixed
- **A bulleted sub-list under "Why asking" or "Need" no longer disappears** — v0.7.72 only fixed numbered sub-lists; a bulleted one was silently dropped from the "why" section entirely rather than just mis-rendered. Both nested numbered and bulleted lists now render correctly, and the underlying fix is general (indentation-based) rather than per-marker-type.

## [0.7.72] - 2026-08-10

### Fixed
- **A numbered sub-list under "Why asking" or "Need" now renders as a real list** — previously it flattened into one run-on line with the literal "1."/"2." showing as plain text.
- **Fixed a cross-question content leak**: switching from a question with a long body/context to one without could leave the previous question's text behind on screen, invisible-but-present, and sometimes visible again mixed into unrelated content. Each field now clears fully when empty, not just hidden.

## [0.7.71] - 2026-08-08

### Fixed
- **"The edit could not be applied" no longer fires when re-answering a question that already has a real answer** — the write was silently queuing two conflicting edits on the same line, which VS Code rejects outright. Answering, then later updating that same answer, now always lands.

## [0.7.70] - 2026-08-07

### Added
- **"Report" now appears on every sidebar item**, last in the right-click menu — the same mechanism as the Open Questions panel's Report button, extended tree-wide. Captures the entire tree hierarchy (every caption, description, and link target), a copy of the clicked file if it's file-backed, and any parsed open questions, plus your optional note.

## [0.7.69] - 2026-08-07

### Added
- **Retire a question without answering it**: `- Status: withdrawn — <why>` (or `superseded` / `moot`) closes a question that will never be answered — it leaves the Open Questions walk, the badge, and the tree's open counts, without ever counting as *answered*. Declaration-only and leading-token strict, mirroring the document-pause rule; the question stays fully parsed and census-visible. Fills the gap that had questions carrying hand-written "⚠️ WITHDRAWN" annotations glued onto their headings.

## [0.7.68] - 2026-08-06

### Added
- **Pause an ADR, silence its questions**: a document whose `Status:` *leads* with `Deferred`, `Paused`, `Suspended`, or `On Hold` (annotations after a dash welcome: `Deferred — designed in full, not pursued now`) drops out of the Open Questions walk, the sidebar's question children, and the badge count — everywhere a human is asked for attention. The document, its questions, and the census all stay fully parsed and visible to tooling: paused is suppressed, never invisible. Leading-token strict, so a passing mention like `Proposed (deferred — …)` does not pause; the parser's own hint will suggest the canonical form.

## [0.7.67] - 2026-08-06

### Fixed
- **`<details>` blocks are archival, by ruling**: a folded block inside a question — the "superseded, don't treat as live" gesture — no longer lets markers *inside* it hijack the dialogue structure (a historical `**ANS (…):**` wrapped in `<details>` was being selected as the question's *current* answer instead of the live one above it). Folded content stays byte-faithful inside its surrounding container; a would-be marker inside a fold gets a `STRUCTURAL_MARKER_INSIDE_DETAILS` hint instead of silently restructuring the round.

## [0.7.66] - 2026-08-06

### Added
- **"Copy Path" and "Copy Relative Path" now appear on ADRs, seeds, and tours** in the sidebar's right-click menu, alongside "Copy Deep Link" (previously ADR-only). All three now live together as their own section of the menu.
- **Seeds get a real deep link**: right-click a seed → Copy Deep Link now copies a `seed:<slug>` reference instead of doing nothing.

### Fixed
- **A seed-sourced question's "Copy Deep Link" no longer produces `adr:0000#...`** — it now copies a proper `seed:<slug>#<anchor>` reference.

## [0.7.65] - 2026-08-06

### Fixed
- **A multi-paragraph blockquote now renders as one continuous quote** — previously each paragraph became its own separate box, with a stray literal `>` character floating between them.

## [0.7.64] - 2026-08-05

### Added
- **An attention toast now appears when the insertion-preview picker renders off-screen** — if you press ⌘Enter and the "insert here?" prompt lands below your current scroll position, a small toast in the panel's accent color points down toward it instead of it firing silently below the fold. Click it to scroll the picker into view.

## [0.7.63] - 2026-08-05

### Fixed
- **A bold span containing a nested italic word now renders correctly** — previously the whole bold span silently failed to render as bold at all, leaving a stray literal `*` and the italic scoped over the wrong text.

## [0.7.62] - 2026-07-31

### Fixed
- **A fenced code block or sub-bullet list nested under a numbered/bulleted item now renders correctly** — previously it broke the list mid-way (splitting one numbered list into several, each restarting at "1.") or flattened nested sub-bullets into one run-on line inside a single item. Found via three founder Reports on the same batch-renderer question.
- **Retry loops no longer flood the error ledger**: repeated identical failures (the panel retrying the same rejected save) now write one ledger record instead of one per retry.

## [0.7.61] - 2026-07-31

### Fixed
- **Backtick-quoted comment examples render again**: the panel's comment-stripping (added earlier today) ran before code-span protection, so documentation that *quotes* comment syntax — like ADR-0032 discussing `@adr-anchor` — had the quoted contents eaten and the leftover backticks re-paired whole paragraphs into one giant code span. Code spans and fenced blocks are now protected before the strip; a comment inside a fenced example survives too.

## [0.7.60] - 2026-07-31

### Added
- **The insertion-preview bar now has "- Move up" / "+ Move down" buttons**: when the append-ANS fallback shows you where it's about to insert (no existing ANS block found), you can nudge the guessed line up or down within the previewed context before confirming, instead of only Insert/Cancel. No extra round-trip — the adjustment replays within the context already shown.

### Changed
- **The "Respond (unresolved)" button is now "Request Follow-up →"**: same gesture (writes your answer, sets `Status: unresolved` so the ball returns to the model instead of closing the question) — only the label changed, to stop it reading as a synonym for the ordinary Answer button.

## [0.7.59] - 2026-07-31

### Fixed
- **HTML comments no longer defeat placeholder detection**: `[Fill this in] <!-- literal placeholder — parser-significant, do not paraphrase -->` — the HQ template's own anti-paraphrase comment, on the same line (or the next) — read as a real answer, silently closing the question and refusing writes. Comments are the format's reserved invisible channel, and they are now invisible to content classification everywhere (placeholder, scaffold, and emptiness tests); the stored text keeps them byte-for-byte. Found by Gleaner's first ecosystem sweep, confirmed in two repos the same day.
- `[to be filled]` / `(to be filled)` join the recognized placeholder family.

## [0.7.58] - 2026-07-31

### Added
- **"Add Thread Turn"**: right-click a seed in the sidebar (or run it from the Command Palette on the seed file you're viewing) to append a correctly-scaffolded, attributed conversation turn — the MRR checkbox block and heading level are generated, never hand-typed, and the cursor lands ready for you to write. No more copy-pasting template scaffolding to keep iterating on a seed.

## [0.7.57] - 2026-07-31

### Fixed
- **"Commit ADR Changes" now works in genuine multi-folder VS Code workspaces** (a `.code-workspace` with the main project and a submodule as separate top-level folders) — it used to fail there even with real, staged changes. The scan now resolves which project owns a change from the changed file's own path, instead of asking git to resolve a repository for each project's bare folder path (which can fail even when the repository is perfectly well-known to VS Code).

## [0.7.56] - 2026-07-30

### Added
- **The ADR Commit button now catches untracked files you referenced but forgot to stage** — a screenshot linked from a seed/ADR, say. Before committing, it checks whether any untracked file's name is mentioned in what you're about to commit, and offers a pre-checked list to include them too. `adrManager.commit.untrackedReferences`: `ask` (default) / `auto-commit` / `auto-ignore`. Only prompts in the single-file commit case — the multi-root batch commit stays one gesture.
- **A commit of only draft answers or the error ledger now gets a real message** instead of the generic fallback — "docs: sync draft answers", "docs: sync error ledger", or both. The confirmation toast also stopped calling a harvested error record "draft state" — it's now its own "error ledger" class.

## [0.7.55] - 2026-07-30

### Fixed
- **The answering dialog no longer jumps on every autosave**: "Draft saved" shared the button row with the Report button, so its own row shifted every time an autosave fired. It now lives in the hint line above, in the spot the "Expand field" link (moved to its own row, flush right, above the textarea) used to occupy — reserved, dedicated space that nothing else will ever share.

### Changed
- **The "Answering as:" name field is now hidden by default** (`adrManager.showAuthorshipField`) — the author name is still supplied the same way it always was (`adrManager.humanName` or your git config); this only controls whether the field itself takes up space in the dialog.

## [0.7.54] - 2026-07-30

### Fixed
- **Dash-bullet ANS fields are markers, not question text**: `- **ANS**: (by Name) [unanswered]` — the whole-bullet-list QST dialect (real system3 specimen, three questions) — now parses as the ANS marker + byline + placeholder it is, instead of rendering inside the question body with its placeholder showing. Bold dash-bullet recommendations (`- **Recommendation** (author): …`) likewise now extract with their attribution. A `NONCANONICAL_ANS_MARKER` hint suggests the standalone canonical form; writes canonicalize automatically.
- **Unrelated trailing paragraphs are no longer swallowed into an unfilled answer** (Flint's fix): `**ANS:**` + `[Fill this in]` followed by an unrelated bold-key paragraph (no separator) kept the question unanswered and the paragraph out of the answer box — closing the duplicate-on-submit trap from the 2026-07-29 report.

## [0.7.53] - 2026-07-30

### Added
- **"ADR Manager: Show Version" now also reports whether the Report button is enabled**, as resolved live from your current settings — a one-command way to tell "the extension needs reinstalling" apart from "the setting isn't reaching this workspace."

## [0.7.52] - 2026-07-30

### Fixed
- **The Report button now logs even when you leave the comment blank** — pressing it always marks the moment; the note you type is optional content on top, not a precondition. Previously, submitting with nothing typed was silently treated the same as cancelling.

### Changed
- **Error-ledger logging is now controlled per writer, not by one shared switch**: `adrManager.logging.panelErrors`, `adrManager.logging.tourUnresolvedRefs`, `adrManager.logging.observations` replace the old `adrManager.logErrors` — each defaults on, each can be turned off independently ("logging costs speed").

## [0.7.51] - 2026-07-30

### Added
- **"Respond (unresolved)"** (ADR-0036): a new way to submit an answer that doesn't close the question — the human has contributed content, but the next move is the model's. Button next to Answer, or Cmd+Shift+Enter. Sets `Status: unresolved` instead of `answered`; the vocabulary also recognizes `deferred` (nobody's ball right now, blocked on data/build/users). Both show in the sidebar with their own icon, and can optionally be hidden from the Open Questions panel (`adrManager.unresolved.hideFromPanel`, `adrManager.deferred.hideFromPanel` — both off by default, matching how they already behaved before these settings existed).

## [0.7.50] - 2026-07-30

### Added
- **Report button** (off by default — `adrManager.reportButton.enabled`): a frictionless way to flag a problem without leaving the Open Questions panel. Type a note, and the current ADR's full content, a checksum, and your note are saved to the project's error ledger — your in-progress answer is never touched.

### Fixed
- **Tour mode now advances past a question you just answered**, instead of staying put until a background refresh happened to remove it. This used to happen "for free" as a side effect of answered questions vanishing from the walk — doctrine 9 (v0.7.43) deliberately keeps every entry visible as a review stop, which stopped the side effect along with it; restored explicitly.
- **The forward button reads "Next" instead of "Skip"** once you've already answered the question in front of you — "Skip" read as dishonest on something you'd just settled.

## [0.7.49] - 2026-07-29

### Added
- **Unresolvable tour references now self-harvest** (ADR-0035 Iteration 2): opening a tour with a broken entry appends a full-reconstruction record (the tour's own JSON, every unresolved reference with its reason, and the full text + checksum of every ADR/seed the tour successfully touched) to the project's error ledger, and shows up as one aggregated error in VS Code's Problems panel — visible to a model reading diagnostics without a human having to point it out.

## [0.7.48] - 2026-07-29

### Added
- **The ADR Commit button now understands seeds and multi-root projects**: a seed-only changeset gets its own message ("new seed: `<topic>`" for a brand-new file, "human feedback on seed" for a first response, "human iterated on seed" once a Thread conversation is already underway) instead of the generic ADR fallback; a mixed ADR+seed commit composes both ("human feedback on ADRs 0031, 0034 + one seed"). The command now scans every discovered project root instead of only the first — a workspace with more than one root (submodules, a forest workspace) used to report "No ADR changes to commit" the moment the first root happened to be clean. Exactly one dirty root still commits directly, no extra steps; more than one shows a checkbox picker (pre-checked) so several can be committed at once.
- **Configurable sidebar category order**: `adrManager.sidebar.categoryOrder` controls the Tours/ADRs/Seeds order in the tree, default Tours-ADRs-Seeds.
- **Tour questions can show their disposition as a lean-verb prefix** (DECIDE / RATIFY / ACKNOWLEDGE / DELEGATE) in the sidebar — `adrManager.tours.showLeanVerbPrefix`, on by default.

### Changed
- ADRs now use the `law` category icon (in place of `list-tree`); Seeds use `thinking` (in place of the braces-like `symbol-namespace`). Tours keep the compass.

## [0.7.47] - 2026-07-28

### Fixed
- **Review-stop answer text had no list indent or paragraph spacing**: v0.7.46's markdown fix rendered a resolved tour entry's answer correctly, but the class never got the scoped `ul`/`ol`/`p`/`strong`/`em`/`code`/`pre` rules the panel's other prose boxes (`.why`, `.qst-body`, `.recommendation`) already carry, so everything fell through to the file's blanket margin/padding reset. It now shares the same scaffold as its siblings.

## [0.7.46] - 2026-07-28

### Fixed
- **Review-stop answers no longer read as one collapsed blob**: a resolved tour entry's live answer (ADR-0034 doctrine 9, v0.7.43) rendered via plain `.textContent` with no whitespace handling, so a real multi-paragraph or multi-line answer lost all its structure. Now rendered as markdown, matching every other prose surface in the panel.
- **ADR-0038 tier 1 — the answer box uses your editor font**: the answer textarea inherited VS Code's UI chrome font instead of the editor font you've actually configured for writing — the reason bullet-point indentation had no way to render in monospace. It now reads `--vscode-editor-font-*` directly; anyone with a configured editor font gets it here with zero new settings.

## [0.7.45] - 2026-07-28

### Fixed
- **Byline scaffolds no longer prefill as answers**: an ANS slot whose entire content is one bare parenthetical — `**ANS:** (Jérémie Lumbroso)` with no `by` keyword and nothing else — now reads as an empty scaffold reserving the slot (question stays open, no author invented, nothing prefilled), with an `ANS_BYLINE_SCAFFOLD` diagnostic suggesting the recognized `(by Name)` form. Found live in Herald's second tour, where every open stop's answer box arrived pre-noised with "(Jérémie Lumbroso)". Slots that already carry a keyword byline keep parenthetical content as real draft answers.

All notable changes to the **ADRs for AI** extension are recorded here, loosely following [Keep a Changelog](https://keepachangelog.com/).

This file starts at **v0.5.0** — the first release built from a rebuilt, in-sync `dist/` bundle after several months of the compiled output drifting from source. Development before that point was real (the sidebar, the Open Questions panel, seeds, deep links, ADR Commit all predate it) but wasn't versioned in a way worth reconstructing here; v0.5.0 is where this project's own version numbers became trustworthy.

Several of this project's public incident debriefs (DEBRIEF-003, 004, 006, 007) are referenced by name below rather than smoothed over — see `docs/adr/DEBRIEF-*.md` for the full write-up of each, including the ones not tied to a single version (DEBRIEF-002, a data-scoping bug; DEBRIEF-005, a release-process gap). Keeping a public record of what broke and how it was found is part of what this extension is for.

---

## [0.7.44] - 2026-07-28

### Fixed
- A tour minted or edited outside the extension (hand-written JSON, a sibling crew's commit, a `git pull`) stayed invisible in the sidebar until something else happened to trigger a reindex. `docs/adr/tours/*.tour.json` now has the same per-root FileSystemWatcher coverage as ADRs/seeds — create, change, and delete all refresh the tree automatically. No "tours may be stale, refresh?" affordance was added; the fix is the watcher, not a label asking you to work around its absence.

## [0.7.43] - 2026-07-28

### Changed
- ADR-0034 doctrine 9 (resolved entries are review stops): walking a tour no longer skips already-answered entries. Each renders read-only — the live answer shown in place of the input box, no Answer button — so Back/Skip still pass through it and the step count includes it. The counter reads "Stop N of M · K awaiting you" in tour mode. This supersedes v0.7.42's interim fix, which jumped an answered entry's click straight to the file instead; that click now stays in the panel like every other tour-entry click.

## [0.7.42] - 2026-07-28

### Fixed
- Clicking an already-answered question inside a tour used to do nothing visible — it now jumps straight to the file (the walk dialog only ever held the tour's still-open questions, so the click had nowhere else correct to go).
- The tour's authored note ("DECIDE: ...", etc.) now appears above the question instead of being sandwiched between the title and the ADR's own "why asking" text, where it read as near-identical clutter; it also has its own accent color now instead of blending in.
- The "Exit tour" link no longer clashes with a custom-themed tour's colors — it follows the tour's own theme like the rest of the header.

## [0.7.41] - 2026-07-28

### Fixed
- A tour's questions in the sidebar **Tours** tree had no title at all — a real question and status icon with completely blank text, easy to mistake for the entry being missing entirely rather than just unlabeled. Every entry in a tour now shows its actual question text, same as anywhere else in the tree.
- A tour minted before ADR-0034's schema rename (`required` → `must_respond`) had every entry silently treated as required, regardless of what the tour actually said — the old field name is now read as a fallback.

## [0.7.40] - 2026-07-28

### Fixed
- A `### QST (some annotation): ...` heading — a parenthetical between "QST" and the colon — was a total silent drop: no question, no warning, invisible in the panel. Root-caused from a cross-repo tour that broke live; also found and fixed a second, previously-unreported case of the same drift (a malformed handle like `QST-BAD_CHARS:` recognized the question correctly but computed the wrong anchor slug). Both were caused by the same underlying bug: slug computation and question detection each kept their own hand-copied list of recognized heading shapes, and the two had quietly fallen out of sync. They now share one definition, so this can't happen a third time.

### Added
- **`just tour-lint`**: checks every tour's questions actually exist before you share it, instead of finding out the hard way when someone else clicks a broken link.

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
