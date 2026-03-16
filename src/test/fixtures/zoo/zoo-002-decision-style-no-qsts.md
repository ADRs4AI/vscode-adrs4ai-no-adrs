# ADR 0001: Data Storage Backend

- **Date**: 2026-03-16
- **Iteration**: 2
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso, Claude Sonnet 4.5

---

## Human Context

We need to choose a data storage backend for the project.
Must support offline use, low latency reads, and easy backup.

**Agency Grant**: Full design authority.

---

## AI Interpretation

Three viable options: SQLite, PostgreSQL, or flat files.
SQLite wins for this use case: zero-config, file-based, good offline story.

---

## Architecture Decisions

<!-- Deviation D5: No "## Questions" section; uses "### Decision N:" structure -->
<!-- Questions are implicit in the decision text, not surfaced as open QSTs -->

### Decision 1: Use SQLite for local storage

**Chosen**: SQLite via `better-sqlite3`.

**Why**:
- Zero server setup
- Single-file database, easy to back up
- Synchronous API matches our use case

**Rejected**: PostgreSQL (requires server), flat JSON (no transactions).

### Decision 2: Schema migrations via `drizzle-orm`

**Chosen**: `drizzle-orm` for type-safe schema and migrations.

**Why**: Generates TypeScript types from schema. Migration files are plain SQL — auditable.

**Open question** (not yet a QST): Should we support schema rollback, or only forward migrations?
