# The Zoarium

A curated collection of non-conforming ADR specimens — real-world deviations from the
`collab-adr-lean` format produced by LLMs that weren't given the template.

Each specimen is a minimal, self-contained example of one or more deviation patterns.
These are the primary regression test fodder for `src/normalizer/`.

---

## Specimens

| File | Deviation(s) | Notes |
|------|-------------|-------|
| [zoo-001-bold-fields-open-questions.md](zoo-001-bold-fields-open-questions.md) | D1, D2, D3, D4 | Most common cluster — all from `## Open Questions` + bold field names |
| [zoo-002-decision-style-no-qsts.md](zoo-002-decision-style-no-qsts.md) | D5 | No Questions section; uses `### Decision N:` structure |
| [zoo-003-status-with-parenthetical.md](zoo-003-status-with-parenthetical.md) | D2b | `- **Status**: unanswered (see ADR 0004)` — extra text after status value |
| [zoo-004-wrapped-placeholder-inline-attribution.md](zoo-004-wrapped-placeholder-inline-attribution.md) | D9.4 morphology #4 | `_(pending)_` italic/paren-wrapped placeholder + `**Recommendation** (by X):` inline-attribution form. Real specimen — an "Athanor 5" seat, `temp/0021-crew-architecture-and-staffing.md`, 2026-07-12. Fixed same-day, v0.7.5. |

---

## Wild-format corpus recall (ADR-0031)

This directory doubles as the standing corpus ADR-0031 (Recall-First Question
Detection) charters Quarry 5 to build and grow. `recall.test.ts` runs
`parseAdr` against every specimen here and prints a tracked number —
`detection: N/M corpus specimens` — on every test run. Two counts per
specimen: **ground truth** (what a human reading the file would recognize as
open questions) and **today's baseline** (what bare `parseAdr` actually
detects, no normalizer pass — the panel shows raw parse output; normalizing
is a manual Quick-Fix, not automatic). The hard assertion is regression
protection against the baseline, not an idealized 100% — closing the
ground-truth gap for zoo-001/003-shaped specimens is ADR-0031's own
outstanding Action Items (`placeholder.ts`, `qst-census`, multi-signal
candidacy), not something this corpus can force green by itself.

**Growing the corpus**: per ADR-0031's specimen protocol, every new
wild-format specimen gets a corpus entry here (whether or not it's already
fixed elsewhere) — add `zoo-NNN-<slug>.md` (minimized, not a raw dump — see
Provenance below) and a `CORPUS` entry in `recall.test.ts` the day it's
found.

---

## Empirical Findings (2026-03-16)

Tested by manually editing `temp/misc-adr/` files and observing extension behavior.
These are ground-truth observations, not inferences.

### What actually caused questions to not surface at all

**D4 was the primary blocker** — not D1 as initially suspected.

Changing `**ANS:** (fill in)` to:
```
**ANS:**
[Fill this in]
```
caused the questions to surface in the tree view. The parser found the `### QST:` heading
but required a detectable answer placeholder to confirm the question was open.

D1 (`## Open Questions`) was NOT the cause of questions being invisible in this case —
the `### QST:` headings inside `## Open Questions` were still indexed. D1's impact is
on the **ADR context** shown in the Open Questions panel (see below).

### Remaining problems after D4 fix (questions surface but panel is degraded)

**Problem 1 — Question content is empty in the panel**

The Open Questions panel shows only the question title (heading text). The body of
the QST block — `Why asking`, `Options`, `Need` — is not displayed.

Root cause: the field parser in `extractor.ts` uses plain `- Why asking:` patterns.
The zoo specimens use `- **Why asking**:` (bold). D2/D3 apply to content fields too,
not just the Status field. The parser silently drops fields it doesn't recognize.

This is a **display degradation**, not a surfacing failure. The question appears, but
without context. For questions with long, nuanced bodies (the norm in real projects)
this makes the panel nearly useless.

**Problem 2 — ADR context is the entire ADR**

The collapsible "ADR context" box in the Open Questions panel shows all sections
before `## Questions`. When the section is `## Open Questions` (D1), the parser does
not recognize it as the Questions boundary — so every section of the ADR is treated
as "before questions" and included in the context box. The context becomes the whole
file, which is overwhelming and defeats the purpose.

Root cause: D1. Fixing `## Open Questions` → `## Questions` would restore the correct
context boundary.

**Problem 3 — Status not updated to `answered` after writing answer**

`writeAnswer()` searches for `- Status: unanswered` to update it to `- Status: answered`.
When the file has `- **Status**: unanswered` (D2), the search fails silently. The answer
text IS written (the `[Fill this in]` replacement works), but the status line stays as
`unanswered`. The question therefore reappears in the panel on next index.

Root cause: D2. The status update regex in `writeAnswer()` doesn't strip bold markers.

### Impact summary

| Deviation | Effect | Severity |
|-----------|--------|----------|
| D4: collapsed ANS block | Questions don't surface at all | 🔴 Blocking |
| D2/D3: bold field names | Question content empty in panel | 🟠 Degraded |
| D1: `## Open Questions` | ADR context is the whole file | 🟠 Degraded |
| D2: bold Status field | Answer written but question recurs | 🟠 Degraded |
| D5: no Questions section | 0 questions, correct behavior | 🟡 Expected |

### What we are NOT fixing (by design)

These are deviations the extension does not and should not silently accommodate.
The normalizer (ADR-0013) is the right path for permanent fixes. The extension
should surface diagnostics pointing users toward normalization, not absorb arbitrary
LLM output formats.

---

## Test Coverage Gaps

The following behaviors have **no current tests** in `src/test/parser.test.ts`:

1. **QST field content extraction** — `whyAsking`, `need`, `recommendation` fields
   are parsed by `extractor.ts` but no test verifies they are correctly extracted
   from a realistic QST block. A question that parses with `whyAsking: undefined`
   when the field is present is a silent failure.

2. **ADR context section boundary** — `openQuestionsPanel.ts` extracts sections
   before `## Questions` as context. No test verifies this boundary is correct,
   or that it degrades gracefully when the section is named `## Open Questions`.

3. **`writeAnswer()` status update** — the status line replacement is tested
   implicitly by the answer-write flow but never in isolation. A test with
   `- **Status**: unanswered` (bold) would catch D2's write failure.

4. **Bold field variant parsing** — no test exercises what happens when a QST
   block uses `- **Why asking**:` vs `- Why asking:`. Currently: silent drop.

---

## Deviation Catalogue

**D1 — `## Open Questions` section name** (instead of `## Questions`)
Does NOT cause questions to be missed (the `### QST:` headings are still indexed).
Impact: the ADR context box in the Open Questions panel expands to the entire file,
because the parser never finds the Questions section boundary.
- Fix: also accept `open questions` (case-insensitive) as the Questions section name.

**D2 — Bold field names in QST blocks** (`- **Status**: unanswered`)
All QST field lines use bold markers: `- **Status**: ...`, `- **Why asking**: ...`.
The standard format uses plain `- Status: unanswered`.
- Fix: strip `**` when parsing QST field keys.

**D2b — Status with parenthetical note** (`- **Status**: unanswered (linked to ADR 0004 QST)`)
A variant of D2 where the status value has trailing commentary.
- Fix: parse only the first word(s) of the status value, ignore trailing text.

**D3 — Bold `Why asking` / `Options` field names**
Same as D2 but for non-Status fields: `- **Why asking**: ...`, `- **Options**: ...`.
These are informational and don't affect parseability of the question itself, but they
should be normalizable to the plain form.

**D4 — `**ANS:** (fill in)` placeholder** (instead of separate `[Fill this in]` line)
**Empirically confirmed as the primary blocker** — questions don't surface in the tree
until this is fixed. The parser finds `### QST:` headings but requires a detectable
answer placeholder to confirm the question is open. `(fill in)` is not recognized.
Consequence: question silently dropped from the index.
- Fix: treat `(fill in)` as a valid placeholder detection pattern; normalizer expands it
  to the standard two-line form (`**ANS:**\n\n[Fill this in]`).

**D5 — Decision-style ADR with no Questions section**
The ADR uses `## Architecture Decisions` + `### Decision N:` subheadings instead of
`## Questions` + `### QST:` blocks. Questions may be implicit in the Decision blocks
but are not surfaced as open questions. The parser correctly produces 0 questions —
this is not a bug to fix silently, but a pattern to detect and surface diagnostically.

---

## Provenance

All specimens are minimized synthetic reproductions of patterns observed in
`temp/misc-adr/` (a local collection of case-study ADRs from other projects, not
tracked in this repo). The originals were produced by Sonnet 4.5 and 4.6 without
access to the `collab-adr-lean` template.

Observed in: `hugo-canvas-sync` project ADRs (0001–0005), 2026-03-16.
