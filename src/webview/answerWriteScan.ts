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

import { STATUS_LINE_RE, QST_HEADING_LINE_RE } from '../parser/extractor'

/** Thematic break — same boundary set as extractor.ts's THEMATIC_BREAK_RE. */
const THEMATIC_BREAK_LINE_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/

const ANS_HEADER_LINE_RE = /^\*\*ANS:\*\*/
const FILL_PLACEHOLDER_LINE_RE = /^\[\s*fill\s+this\s+in[^\]]*\]$/i

export interface AnswerWriteAnchors {
  /** Line index of the question's Status field (plain or bold form), or -1. */
  statusLineIdx: number
  /** Line index of the `**ANS:**` marker, or -1. */
  ansHeaderLineIdx: number
  /** Line index of the `[Fill this in]` placeholder (only after an ANS marker), or -1. */
  fillLineIdx: number
  /** Exclusive end of the question's block: next QST heading (any form the
   * extractor accepts, handle ids included) or thematic break, else the
   * window end. The append-ANS fallback inserts just before this. */
  blockEndLineIdx: number
}

/**
 * Scan `lines[startIdx..windowEnd)` for the write anchors of the question
 * whose heading is at `startIdx`.
 */
export function scanAnswerWriteAnchors(
  lines: string[],
  startIdx: number,
  windowEnd: number,
): AnswerWriteAnchors {
  const end = Math.min(windowEnd, lines.length)
  const anchors: AnswerWriteAnchors = {
    statusLineIdx: -1,
    ansHeaderLineIdx: -1,
    fillLineIdx: -1,
    blockEndLineIdx: end,
  }

  for (let i = startIdx; i < end; i++) {
    const trimmed = lines[i].trim()
    if (i > startIdx && (QST_HEADING_LINE_RE.test(trimmed) || THEMATIC_BREAK_LINE_RE.test(trimmed))) {
      anchors.blockEndLineIdx = i
      break
    }
    if (anchors.statusLineIdx === -1 && STATUS_LINE_RE.test(trimmed)) anchors.statusLineIdx = i
    if (anchors.ansHeaderLineIdx === -1 && ANS_HEADER_LINE_RE.test(trimmed)) anchors.ansHeaderLineIdx = i
    if (
      anchors.fillLineIdx === -1 &&
      anchors.ansHeaderLineIdx !== -1 &&
      FILL_PLACEHOLDER_LINE_RE.test(trimmed)
    ) anchors.fillLineIdx = i
  }

  return anchors
}
