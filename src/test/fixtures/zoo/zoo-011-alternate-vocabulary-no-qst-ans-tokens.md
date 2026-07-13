# ADR 0016: Implementation Plan

- **Date**: 2026-06-10
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

---

<!-- Deviation: the whole QST/ANS navigation-code vocabulary is abandoned. Questions
     are headed "### Q1:"/"### Q2:" (no QST token at all); answers use spelled-out
     "**ANSWER: <text>**" inline rather than the two-line ANS pattern. A parser
     matching literally on "QST" or "**ANS:**" finds nothing in this file. -->
## Answers to Open Questions

### Q1: Allowlist — hardcoded or database?

**ANSWER: Hardcoded** (at least initially, revisit if the list grows past a dozen entries)

### Q2: Should the allowlist check happen client-side or server-side?

**ANSWER: (undecided — revisit after the hardcoded-vs-database question above settles)**
