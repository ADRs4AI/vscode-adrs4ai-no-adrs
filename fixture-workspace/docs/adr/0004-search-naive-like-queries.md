# Search: Naive LIKE Queries Over Recipe Titles

* Status: Superseded
* Deciders: Ren Okafor
* Date: 2026-04-02

## Context and Problem Statement

Larder needs recipe search. The MVP just needs title/ingredient substring matching — full-text ranking can wait.

## Decision Drivers

* Ship search in the MVP without adding a search engine dependency
* Good enough for a personal recipe box (dozens to low hundreds of recipes), not a public recipe site

## Considered Options

* Option A: `LIKE '%term%'` queries against title and ingredients columns
* Option B: SQLite FTS5 virtual table
* Option C: External search service (Meilisearch, Typesense)

## Decision Outcome

Chosen option: Option A. Simplest possible thing that works at MVP scale; revisit once recipe counts or "search inside instructions" requests make substring matching feel bad.

## Consequences

* No ranking — results are unordered beyond whatever the database returns
* No typo tolerance, no stemming ("roast" won't match "roasted")

---

**Superseded 2026-07-02** by the FTS5 migration once the recipe count in real usage passed ~400 and substring search started missing obvious matches (plural/singular mismatches were the most common complaint). See the (forthcoming) ADR-0005 for the FTS5 decision — kept here, unedited, as the record of what shipped first and why it stopped being enough. This file is deliberately left in the older plain-MADR shape it was written in, rather than backfilled into the QST/ANS format — the format drift is itself part of the record.
