/**
 * The tour PROLOGUE — ADR-0034 Iteration 29.
 *
 * One authored object with four renderings: the desktop panel's title-click
 * card, the mobile cover-card before stop one, the tour-inbox preview card,
 * and the CLI walk's preamble. Concertmaster relayed the founder's in-flow
 * idea (*"a title card / index card where the seat who minted the tour could
 * provide rationale for grouping the questions"*) and Portolan's T1/T3 asked
 * for the same thing from two mobile surfaces; ruling them one object is what
 * keeps him from meeting three dialects of his own idea.
 *
 * WHY THIS IS A SEPARATE FILE, and not a field on `TourFile`. `tourIndex.ts`
 * is in the Phase-1 moving set and **frozen** — Lapidary's ruling of record is
 * (b)-pure, no exception, and I argued the controlling verification-cost
 * reason for it myself, so I am not taking an exception for my own feature.
 * New files create no divergence of moved bytes, so the prologue lands as one.
 * `parsePrologue` is deliberately **pure** (no fs, no vscode) so it ports to
 * docket-core verbatim when the pin arrives and this file dissolves into
 * `TourFile.prologue`.
 *
 * DOCTRINE. The prologue is the most doctrinally-native thing in the format:
 * doctrine 1 confines a tour to *commenting* on sovereign substrate, and "why
 * THESE questions, together, now" is content **nothing in the substrate can
 * hold** — no ADR knows it was bundled. It is the tour's own claim, in its
 * purest form.
 *
 * Named `prologue`, not `card`: a schema key is ALGEBRA, and "card" names a
 * widget, which is DISPLAY register (Mint's №70 three-register law). The gloss
 * on any surface may be "title card"; the key stays honest about what it is —
 * the thing said before the walk.
 *
 * WHAT IT MUST NEVER CARRY (ADR-0034 It-29, refusal 2): no count, no doneness,
 * no effort number, no freshness date. Those derive at render from the live
 * substrate or they lie — storing them reproduces It-23's dead-index defect
 * with a shorter fuse, and an inbox card is read at a glance, so a stale
 * "3 open" is a lie the reader has no way to catch.
 */

import * as fs from 'fs'

export interface TourPrologue {
  /** Why THESE questions, together, now — the grouping claim only the tour can make. */
  rationale: string
  /** Optional wider framing, for the reader who has lost the thread entirely. */
  context?: string
}

/** Trim, and treat whitespace-only as absent — an empty rationale is not a prologue. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Pure shape-validation of a raw `prologue` value.
 *
 * Tolerant by design, in the same posture as the rest of the tour parser: a
 * malformed prologue yields `undefined` (the tour renders exactly as it does
 * today) rather than throwing. A prologue is an *optional courtesy* to the
 * reader, and a courtesy that can break a walk is not one — the walk is the
 * thing his scheduled slot is spent on.
 *
 * `rationale` is required because it is the whole point; `context` alone is a
 * framing with nothing framed.
 */
export function parsePrologue(raw: unknown): TourPrologue | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const rationale = text((raw as { rationale?: unknown }).rationale)
  if (!rationale) return undefined
  const context = text((raw as { context?: unknown }).context)
  return context ? { rationale, context } : { rationale }
}

/**
 * Read one tour file's prologue from disk.
 *
 * Takes a path rather than a `TourFile` because the frozen parsed shape has no
 * prologue field to carry — `TourFile.path` is the join. Returns `undefined`
 * for a missing file, unreadable file or unparseable JSON: every caller here
 * already has the tour (it came from the index), so a failure to re-read is a
 * missing courtesy, never a missing tour.
 */
export function readPrologue(tourPath: string): TourPrologue | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(tourPath, 'utf-8')) as { prologue?: unknown }
    return parsePrologue(parsed.prologue)
  } catch {
    return undefined
  }
}
