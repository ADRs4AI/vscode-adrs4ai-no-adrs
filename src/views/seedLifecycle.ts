/**
 * Seed axis-1 lifecycle classification for the tree glyph (ADR-0041,
 * ratified 2026-08-12). Founding complaint (Jérémie's diaeresis + the
 * census): 21/22 seeds showed the same wrench glyph — "not a sensitivity
 * bug, a dimensional one... the UI's job is to discriminate KINDS of
 * pending, never to minimize wrenches." Composes what Flint's rollup-
 * parser lane shipped (isRetiredSeedStatus, SeedFile.status/
 * lastActivityDate) with this repo's own adaptive threshold math
 * (seedAging.ts) into ONE glyph state per seed. Pure and vscode-import-
 * free, same discipline as this directory's other pure helpers.
 *
 * Deliberately does NOT attempt Naturalist's full eight-way census
 * taxonomy (that was pre-ratification EVIDENCE for the closed-family
 * token list, not itself a ratified UI vocabulary) — the ADR's actual
 * Decision items are the spec: declared closed-family tokens (item 5),
 * derived chunked/unchunked (item 1's axis-1/axis-2 split), and
 * staleness as a RENDERING treatment only (item 6: "thresholds are
 * renderer/sweep policy, never format" — never a new declared token).
 */

import { isStale } from './seedAging'

export type SeedAxis1State =
  | 'parked'
  | 'superseded'
  | 'terminated'
  | 'chunked'
  | 'iterating'
  | 'dormant'

const PARKED_RE = /^parked\b/i
const SUPERSEDED_RE = /^superseded\b/i
const TERMINATED_RE = /^terminated\b/i

/**
 * Which declared closed-family token a seed's raw `status` string leads
 * with — undefined when it isn't one (mirrors isRetiredSeedStatus's own
 * leading-token-strict, bold-tolerant matching, but returns which token
 * rather than a bare boolean, since the tree glyph needs to distinguish
 * parked from superseded from terminated).
 */
export function closedFamilyToken(status: string | undefined): 'parked' | 'superseded' | 'terminated' | undefined {
  if (!status) return undefined
  // Bold-tolerant: strip a leading **...** wrapper the same way
  // isRetiredSeedStatus's stripInlineEmphasis does, without importing the
  // parser module here — a plain leading-emphasis strip is all this needs.
  const s = status.trim().replace(/^\*\*([^*]+)\*\*/, '$1').trim()
  if (PARKED_RE.test(s)) return 'parked'
  if (SUPERSEDED_RE.test(s)) return 'superseded'
  if (TERMINATED_RE.test(s)) return 'terminated'
  return undefined
}

/**
 * Classify one seed's axis-1 state. `daysSinceLastActivity` is the
 * caller's own responsibility to compute (via seedAging.daysSince on
 * SeedFile.lastActivityDate) — kept as a plain number here so this
 * function needs no Date/`now` handling of its own. `undefined` (no
 * measurable activity at all) reads as 'iterating', never 'dormant' —
 * absence of a signal is not evidence of quiet, matching the same
 * recall-first posture the rest of this format uses for silence.
 */
export function classifySeedAxis1(
  seed: { status?: string; isProcessed: boolean },
  daysSinceLastActivity: number | undefined,
  thresholdDays: number,
): SeedAxis1State {
  const closed = closedFamilyToken(seed.status)
  if (closed) return closed
  if (seed.isProcessed) return 'chunked'
  if (daysSinceLastActivity === undefined) return 'iterating'
  return isStale(daysSinceLastActivity, thresholdDays) ? 'dormant' : 'iterating'
}
