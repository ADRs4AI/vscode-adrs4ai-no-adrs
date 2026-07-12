# Larder — demo fixture for ADRs for AI

A small, fictional self-hosted recipe-and-pantry app, built specifically to demonstrate the extension's features for Marketplace screenshots/GIFs and manual testing. Not a real product — every ADR below is written to be plausible, but "Ren Okafor" and "Larder" don't exist outside this fixture.

Recording GIFs against this fixture? See `docs/screenshots/GIF-SCRIPTS.md` in the main repo for the exact walkthroughs.

## What each file demonstrates

| File | Status | Demonstrates |
|---|---|---|
| `0001-authentication-strategy.md` | Accepted | **Stacked recommendations** — the model recommends JWT, then walks it back to session cookies after a follow-up question. Two `**Recommendation**:` blocks on one QST, both preserved. |
| `0002-primary-datastore.md` | Draft | **Live-answering fixture** — two unanswered questions, one using the `QST-<ID>` handle grammar (`QST-SCALE`). Use this for the "answer a question" GIF. |
| `0003-recipe-photo-storage.md` | Accepted | **Deep links** — an inline cross-reference to ADR-0001's specific question (`adr:0001#qst-session-cookies-or-jwt`), rendered as a clickable link. |
| `0004-search-naive-like-queries.md` | Superseded | **Format tolerance, intentionally.** This file is deliberately written in plain MADR style (`* Key:` bullets, no QST/ANS codes) rather than backfilled into `collab-adr-lean`. It fires `BULLET_FORMAT` parser warnings **on purpose** — that's the point: the extension still parses it, shows it in the tree, and gently suggests the canonical form rather than choking on it. If you're recording a GIF and this shows diagnostics, that's expected behavior worth showing off, not a bug to fix first. |
| `0005-search-fts5-migration.md` | Accepted | **A real supersession chain** — supersedes ADR-0004 once the fixture's own "recipe count" grew past the naive-search decision's limits. Gives ADR-0004's `Superseded by` field something real to point at. |
| `seed-2026-07-01-offline-and-sync-brain-dump.md` | cooking | **Template-conformant seed with an embedded question** — follows `docs/adr/templates/seed-template.md`'s `Brain Dump` → `Thread` → `Derived Into` shape, and includes a real `### QST:` block inside a Thread response (an AI reply posing a clarifying question back before it would chunk the seed into ADRs). Demonstrates that seed-embedded questions are first-class (ADR-0018), not just ADR questions. |

## Why "Larder" and not this repo's own dogfooding content

This repo's own ADRs are excellent for engineering testing but reference internal crew identities, colors, and multi-agent jargon that would be confusing in a stranger-facing Marketplace GIF. Larder is self-contained, comprehensible on its own, and still exercises the same feature surface.
