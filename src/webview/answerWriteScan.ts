/**
 * Answer-write anchor scan — the ONE line-based scan the panel's
 * writeAnswer uses to locate a question's Status line, ANS marker,
 * placeholder, and block end. Pure and vscode-free so it is testable, and
 * built ONLY from the extractor's exported regexes ("one parser, N
 * consumers", ratified 2026-07-14 — private near-copies of this scan are
 * how the crossfoot ADR-0030 refusal happened).
 *
 * Incident (2026-07-16, reported live by Jérémie): a question with bold
 * `- **Status**:` fields and no ANS block — recalled fine by the extractor
 * since v0.7.13 — was refused by the panel's writeAnswer ("Could not find
 * the ANS block... Please answer this one manually") because the panel's
 * private scan knew only the plain `- Status:` form, so the v0.7.8
 * append-ANS fallback had no anchor. The write path must tolerate exactly
 * what the read path tolerates, or recall-first detection surfaces
 * questions the machinery then can't serve (the 0620 composition rule).
 */

import { STATUS_LINE_RE, isAnsMarkerLine, isPlaceholderAnswerText, isFollowUpMarkerLine } from '../parser/extractor'

/** Thematic break — same boundary set as extractor.ts's THEMATIC_BREAK_RE. */
const THEMATIC_BREAK_LINE_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/

// The private FILL_PLACEHOLDER_LINE_RE that lived here (canonical
// "[Fill this in]" only) and the direct ANS_INLINE_RE header test were this
// file's OWN violation of the doctrine stated in its header comment: the
// extractor reads colon-outside ANS markers ("**ANS**: ...") and a whole
// placeholder family ("[Fill this out]", "[tbd]", "_pending — routing to
// Jérémie_", "[]"), and this scan recognized none of them — so the panel
// prefilled placeholder junk as if it were a real answer, or missed the
// header entirely and appended duplicate ANS blocks (Jérémie, 2026-07-26:
// "the inability to insert answers is becoming really almost omnipresent").
// Both recognitions now come from the extractor's exported predicates.

export interface AnswerWriteAnchors {
  /** Line index of the question's Status field (plain or bold form), or -1. */
  statusLineIdx: number
  /** Line index of the `**ANS:**` marker, or -1. */
  ansHeaderLineIdx: number
  /** Line index of the `[Fill this in]` placeholder (only after an ANS marker), or -1. */
  fillLineIdx: number
  /** Exclusive end of the question's block: next heading (ANY level — a
   * question's block never continues past a heading), thematic break, or
   * end of file. The append-ANS fallback inserts just before this. */
  blockEndLineIdx: number
  /**
   * What terminated the block. The append fallback may ONLY insert at a
   * real structural boundary ('heading' | 'break' | 'eof') — never at
   * 'window', an arbitrary scan cap. Caring-form blocking-docket incident
   * (2026-07-18, DEBRIEF-006): a ~50-line ORJ question block overran the
   * old 40-line window, the cap defaulted in as the "block end," and
   * Jérémie's answer was spliced into the middle of a recommendation
   * sentence. A cap is a search budget, not a place in the document.
   */
  boundaryKind: 'heading' | 'break' | 'eof' | 'window'
  /**
   * Exclusive end of the EXISTING answer's content: blockEndLineIdx trimmed
   * back over trailing blank lines. When an ANS block already holds a real
   * draft answer (the normal state under Status-authority for a question
   * awaiting its flip), a new write must REPLACE [ansHeaderLineIdx,
   * ansContentEndLineIdx) — never insert inside it. Elenchus legacy
   * incident (Jérémie, 2026-07-23): the old insert-after-header path
   * prepended his new answer onto the existing one, and on the same-line
   * ANS form ("**ANS:** (by X) text…") the header rewrite destroyed the
   * old answer's first line outright.
   */
  ansContentEndLineIdx: number
}

/**
 * Scan `lines[startIdx..windowEnd)` for the write anchors of the question
 * whose heading is at `startIdx`.
 */
/** Any markdown heading line — a question's block never continues past one,
 * whatever its level or text (same conservative-clamp discipline as the
 * extractor's buildSubsections). */
const ANY_HEADING_LINE_RE = /^#{1,6}\s+\S/

export interface InsertionPreview {
  /** Up to `contextSize` lines immediately before the insertion point, in document order. */
  before: string[]
  /** Up to `contextSize` lines immediately after (starting AT) the insertion point. */
  after: string[]
  insertLineIdx: number
}

/**
 * The insertion-preview protocol (Jérémie's own design, dispatched
 * 2026-07-13, `docs/inbox/2026-07-13-0710-...` — never actually built,
 * which is exactly why DEBRIEF-006 happened five days later): "show the 6
 * surrounding lines (3 before / 3 after) with a marker, y/n confirm." Pure
 * windowing around a single line index — the append-ANS fallback is the
 * caller that matters (the ONLY insertion whose target is a guess rather
 * than an exact placeholder/marker match), but the function itself doesn't
 * know or care which caller it's serving.
 */
export function buildInsertionPreview(lines: string[], insertLineIdx: number, contextSize = 3): InsertionPreview {
  const before = lines.slice(Math.max(0, insertLineIdx - contextSize), insertLineIdx)
  const after = lines.slice(insertLineIdx, Math.min(lines.length, insertLineIdx + contextSize))
  return { before, after, insertLineIdx }
}

export function scanAnswerWriteAnchors(
  lines: string[],
  startIdx: number,
  windowEnd: number = lines.length,
): AnswerWriteAnchors {
  const end = Math.min(windowEnd, lines.length)
  const anchors: AnswerWriteAnchors = {
    statusLineIdx: -1,
    ansHeaderLineIdx: -1,
    fillLineIdx: -1,
    blockEndLineIdx: end,
    boundaryKind: end === lines.length ? 'eof' : 'window',
    ansContentEndLineIdx: end,
  }

  for (let i = startIdx; i < end; i++) {
    const trimmed = lines[i].trim()
    if (i > startIdx && (ANY_HEADING_LINE_RE.test(trimmed) || THEMATIC_BREAK_LINE_RE.test(trimmed))) {
      anchors.blockEndLineIdx = i
      anchors.boundaryKind = ANY_HEADING_LINE_RE.test(trimmed) ? 'heading' : 'break'
      break
    }
    if (anchors.statusLineIdx === -1 && STATUS_LINE_RE.test(trimmed)) anchors.statusLineIdx = i
    // LAST-wins (dialogue layering, system3 ADR-0033): the write target is
    // the CURRENT slot — the last ANS marker in the block — never the
    // first layer of a Q&A history. fill resets with each new marker so a
    // placeholder is only honored under the marker it belongs to.
    if (isAnsMarkerLine(trimmed)) { anchors.ansHeaderLineIdx = i; anchors.fillLineIdx = -1 }
    if (
      anchors.fillLineIdx === -1 &&
      anchors.ansHeaderLineIdx !== -1 &&
      i !== anchors.ansHeaderLineIdx &&
      isPlaceholderAnswerText(trimmed)
    ) anchors.fillLineIdx = i
  }

  // Trim back over trailing blanks AND a trailing "**Follows up on**: ..."
  // marker (2026-10-12, the follow-up-question mint): that marker sits
  // OUTSIDE the ANS content on purpose (Docent's ruling — never inside the
  // slot a future layered write replaces wholesale), so a REPLACE of
  // [ansHeaderLineIdx, ansContentEndLineIdx) must stop before it, or a
  // later re-answer of this same question silently deletes it.
  let contentEnd = anchors.blockEndLineIdx
  while (contentEnd > startIdx) {
    const trailing = (lines[contentEnd - 1] ?? '').trim()
    if (trailing === '' || isFollowUpMarkerLine(trailing)) { contentEnd--; continue }
    break
  }
  anchors.ansContentEndLineIdx = contentEnd

  return anchors
}
