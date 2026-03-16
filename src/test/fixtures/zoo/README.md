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

---

## Deviation Catalogue

**D1 — `## Open Questions` section name** (instead of `## Questions`)
Root cause of all missed questions in projects 0002–0005. The parser's section filter
only matched `questions` exactly.
- Fix: also accept `open questions` as the Questions section.

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
The answer block is collapsed: `**ANS:** (fill in)` on one line, no separate placeholder.
Consequence: `writeAnswer()` can't find the `[Fill this in]` line to replace.
- Fix: treat `(fill in)` as a valid placeholder detection pattern; normalizer expands it
  to the standard two-line form.

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
