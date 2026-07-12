# ADR-0005: Search — Migrate to SQLite FTS5

- **Date**: 2026-07-02
- **Iteration**: 1
- **Status**: Accepted
- **Supersedes**: ADR-0004
- **Deciders**: Ren Okafor, Sonnet 4.6 (1M)

---

## Quick Reference

**Navigation codes** (for grep):
- `QST:` Questions
- `ANS:` Answers
- `NOT:` Notes

---

## Human Context

Recipe count in real usage passed ~400 this week, and `LIKE '%term%'` search (ADR-0004) is now missing obvious matches — the most common complaint is plural/singular mismatches ("roast" not matching "roasted"). Time to do the FTS5 migration ADR-0004 already flagged as the eventual next step.

---

## AI Interpretation

**What I understand you're asking**: whether to move straight to FTS5, or consider an external search service now that there's real usage data to size the problem against.

**Assumptions I'm making**: recipe count will keep growing but stay in the low thousands for the foreseeable future (personal/household use, not a public recipe site) — this bounds the decision to "embedded full-text search" vs. "external service," not "which distributed search cluster."

---

## Questions

### QST: SQLite FTS5, or an external search service (Meilisearch, Typesense)?
- Status: answered
- Why asking: ADR-0004 already named FTS5 as the natural next step, but 400 recipes was also the point where "just add a real search engine" becomes tempting — worth confirming the smaller option still holds before defaulting to it out of inertia.
- Need: pick one

**Recommendation**: (by Sonnet 4.6 (1M), 2026-07-02)

**FTS5 — no new service.** At low-thousands scale, FTS5's ranking (BM25) and prefix/stemming support cover the actual complaint (plural mismatches) without adding a process to the self-hosted deployment. An external search service is the right call at a scale Larder isn't at and may never be at, per ADR-0002's own "ship for the scale you have" precedent.

**ANS:** (by Ren Okafor)
Agreed — FTS5. Reintroducing "one more container to run" for a personal recipe box would undo the whole point of ADR-0002's self-hosted-first stance.

---

## Decision

### Chosen: SQLite FTS5 virtual table, `porter` tokenizer for stemming

**Why**: Solves the specific complaint (stemming) without adding infrastructure; consistent with the self-hosted-first posture set in ADR-0001 and ADR-0002.

### Consequences

- One-time backfill migration to populate the FTS5 index from existing recipes
- `* Key:` bullet-style ADR-0004 stays exactly as originally written (not rewritten to match this ADR's format) — it's the record of what shipped first and why it stopped being enough; superseding it doesn't mean erasing it

---

## Iterations

### Iteration 1 (2026-07-02)
- Human: Reported the plural-mismatch complaint at ~400 recipes, asked whether FTS5 still holds or an external service is now warranted
- AI (Sonnet 4.6): Confirmed FTS5 sufficient at this scale, recommended against introducing a new service
- Outcome: **Accepted** — supersedes ADR-0004

---

## Links

- Supersedes: ADR-0004 (Search — Naive LIKE Queries)
- Related: ADR-0002 (Primary Datastore — same SQLite instance hosts the FTS5 virtual table)
