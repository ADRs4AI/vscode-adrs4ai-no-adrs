# ADR-0002: Primary Datastore — Embedded SQLite vs. Postgres

- **Date**: 2026-06-10
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: Ren Okafor, Sonnet 4.6 (1M)

---

## Quick Reference

**Navigation codes** (for grep):
- `QST:` Questions
- `ANS:` Answers
- `NOT:` Notes

```bash
grep '^### QST' docs/adr/0002-primary-datastore.md
grep 'Status: unanswered' docs/adr/0002-primary-datastore.md
```

---

## Human Context

Same self-hosted-first instinct as ADR-0001: I want someone to be able to `docker compose up` and have a working pantry tracker, no separate database container, no connection string to configure. Embedded SQLite gets me that for free.

But two things nag at me. First, a household sharing one pantry means concurrent writes — someone updates the grocery list from their phone while someone else checks off a pantry item from the kitchen tablet, at the same time. Second, the hosted tier (same one from ADR-0001) will eventually want real concurrent access from many households at once, and SQLite's single-writer model is a known wall there.

**NOT:** I keep going back and forth on whether "ship SQLite, migrate later" is actually cheaper than "just use Postgres from day one and eat the setup friction." I don't trust my own instinct on this one — I've been burned before shipping the "simple" option and paying for the migration later.

---

## AI Interpretation

**What I understand you're asking**: two related but separable questions — (1) does SQLite's concurrency model actually break the *household-scale* use case, or is that a hosted-tier-scale worry being applied too early, and (2) if SQLite is fine for now, what does the migration path to Postgres actually cost when the hosted tier arrives.

**Assumptions I'm making**:
- "Household scale" means single-digit concurrent writers, not the hundreds a hosted tier implies
- A clean migration path matters more than picking the "permanently correct" database up front

---

## Questions

### QST-SCALE: Should we plan for horizontal scaling from day one, or ship SQLite and migrate later if a hosted tier happens?

<!-- @adr-anchor: horizontal-scaling-from-day-one -->

- Status: unanswered
- Why asking: This is the ADR-0001 tension again, one layer down — optimizing for a hosted future that doesn't exist yet vs. shipping the simplest thing that works today.
- Need: a decision, or an explicit "defer until the hosted tier is real"

**Recommendation**: (by Sonnet 4.6 (1M), 2026-06-10)

**Ship SQLite now; treat the Postgres migration as a scoped, deferred task, not a design constraint on today's schema.** SQLite's write-serialization is a real limit, but it's a *hosted-tier* limit — a single household doing occasional concurrent writes will never observe it (SQLite's WAL mode handles concurrent readers plus one writer without contention that a human would notice). Designing today's schema defensively for a problem that only shows up at a scale Larder doesn't have yet is exactly the kind of speculative cost ADR-0001 already argued against.

**ANS:** (by Ren Okafor)
[Fill this in]

---

### QST: How do we handle concurrent writes from multiple household members on the same pantry?
- Status: unanswered
- Why asking: Even without the hosted-tier question, this is a real, near-term scenario — two people in the same kitchen editing the same list.
- Need: a concurrency strategy for the common case (household-scale, not hosted-scale)

**Recommendation**: (by Sonnet 4.6 (1M), 2026-06-10)

**Last-write-wins at the row level, with a `updated_at` optimistic-concurrency check on the pantry-item table only** (not the whole schema — grocery-list reordering doesn't need it, individual item state does). If two people toggle the same item within the same second, the second write wins and the UI just reflects the latest state on next sync; this matches what users already expect from a shared list app (no merge conflict UI, no "resolve this conflict" modal for a pantry tracker).

**ANS:** (by Ren Okafor)
[Fill this in]

---

## Decision

*(Both questions above are open — this ADR stays Draft until the ANS blocks are filled and a Decision section is written.)*

---

## Iterations

### Iteration 1 (2026-06-10)
- Human: Named the concurrency worry (household-scale writes) and the hosted-tier migration worry (Postgres-scale reads/writes) as two separate but related concerns; flagged low trust in own "ship simple, migrate later" instinct given a past bad experience
- AI (Sonnet 4.6): Separated the two concerns explicitly; recommended SQLite now with the Postgres question deferred as its own scoped task rather than folded into today's schema design; recommended row-level optimistic concurrency for the near-term household case
- Outcome: Skeleton with two open questions, awaiting Ren's answers

---

## Links

- Related ADRs: ADR-0001 (Authentication — the `sessions` table this ADR's datastore choice will also hold)
