import type { CompositeIndex } from '../index/compositeIndex'

/**
 * The welcome mat's one predicate (2026-10-19, pre-announcement — Jérémie's
 * go on Lapidary's launch-feature pick): "corpus-empty" means a stranger who
 * just installed has NOTHING yet — zero ADRs and zero seeds across every
 * root. It is deliberately distinct from "no open questions": a corpus with
 * documents and nothing left to answer has EARNED the ✓ "All caught up"
 * state; an empty corpus shown the same checkmark is being congratulated for
 * work that doesn't exist — the "empty state that says nothing" family this
 * repo has now fixed three times (broken-tour all-caught-up, fresh-tour
 * not-found, and this). The empty corpus gets an invitation instead.
 */
export function isCorpusEmpty(composite: CompositeIndex): boolean {
  return composite.allAdrs().length === 0 && composite.allSeeds().length === 0
}
