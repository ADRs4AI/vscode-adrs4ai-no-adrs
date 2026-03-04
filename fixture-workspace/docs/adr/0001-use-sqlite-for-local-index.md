# ADR-0001: Use SQLite for Local ADR Index

- **Date**: 2026-03-03
- **Iteration**: 1
- **Status**: Accepted
- **Deciders**: Jérémie Lumbroso, Sonnet 4.6 (1M)

---

## Quick Reference

**Navigation codes** (for grep):
- `QST:` Questions
- `ANS:` Answers
- `NOT:` Notes

---

## Human Context

We need a local index for fast querying of up to 150 ADRs with ~750 questions.
In-memory is fine for Forma 1 but won't support FTS in Forma 2.

---

## AI Interpretation

SQLite with FTS5 is the right call. No server, no infra, file-based, ships with Node.

---

## Questions

### QST: Should we use better-sqlite3 or sql.js (WASM)?
- Status: answered
- Why asking: better-sqlite3 is a native addon (needs rebuild per Node version); sql.js is pure WASM (portable but no FTS5 support out of the box).
- Need: pick one

**ANS:** (by Jérémie)
Use better-sqlite3. We'll cross the native addon bridge when we get to Forma 2.
Native performance matters at 750+ questions.

---

## Decision

### Chosen: SQLite with better-sqlite3

In-memory Map for Forma 1, migrate to SQLite + FTS5 in Forma 2.

---

## Iterations

### Iteration 1 (2026-03-03)
- Human: Confirmed SQLite approach from ADR-0002
- AI (Sonnet 4.6): Drafted this ADR, confirmed better-sqlite3 choice
- Outcome: Accepted
