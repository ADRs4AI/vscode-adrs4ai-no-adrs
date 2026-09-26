# ADR 0016: Trailing parenthesized QST handles (the "petname" dialect)

- **Date**: 2026-09-26
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

## Questions

<!-- Deviation: a TRAILING parenthesized handle — "### QST: text (QST-PETNAME)"
     — instead of the documented leading form "### QST-PETNAME: text".
     Wild dialect, 167 headings across 4 repos (HQ meta-repo, companion etude,
     caring-form, tablee); founder Report 2026-09-13T22:48Z: "I am curious
     whether the QST petnames in parenthesis at the end are parsed and part
     of the metadata?" — they were not. Ruled 2026-09-26 (Riddle 5, ledger
     row, six clauses): recognized as an ALIAS handle. The canonical `id`
     (long slug, from the heading's bytes alone) NEVER changes; the petname
     only adds `#qst-<petname>` as a second anchor + `qstId`, and strips from
     display text. Collisions refuse loudly. Real specimen (first heading):
     companion etude ADR-0004.

     THIS FILE IS THE CROSS-SURFACE FIXTURE: every implementation of the
     minting rule (extension parser, MCP locator, HQ qst-lint.py) must agree
     with `zoo-016-trailing-parenthesized-qst-handle.expected.json`, one entry
     per heading below, in order. Do not edit a heading without editing its
     expectation — and tell the other two surfaces. -->

### QST: Should the Rust service be a gRPC server too? (QST-RUST-GRPC-SERVER)

- Status: unanswered

### QST: Which store do we use? (qst-store)

- Status: unanswered

### QST-LEAD: Does a leading handle outrank a trailing one? (QST-TRAIL)

- Status: unanswered

### QST: First claimant of a shared petname? (QST-DUP)

- Status: unanswered

### QST: Second claimant of a shared petname? (QST-DUP)

- Status: unanswered

### QST: Is a mid-text (QST-MID) parenthetical a handle?

- Status: unanswered

### QST: Is an over-long petname a handle? (QST-THIS-PETNAME-IS-FAR-TOO-LONG-FOR-THE-GRAMMAR)

- Status: unanswered

### QST: Does an accented petname fold like a leading one? (QST-JÉRÉMIE)

- Status: unanswered

### QST-OWNED: A question that owns the handle a trailing alias wants?

- Status: unanswered

### QST: Can a trailing alias shadow another question's own handle? (QST-OWNED)

- Status: unanswered
