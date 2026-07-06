/**
 * D9.5: MissingRecommendationHandler
 *
 * ADR-0019 QST-2 (answered): fires on open QSTs only ("Status: unanswered"),
 * regardless of the ADR's date — an open question with no Recommendation
 * block is always useful *now* (stating a lean is what lets the human close
 * it); a missing recommendation on an answered question is water under the
 * bridge. Self-quieting: answering the question silences it.
 *
 * Message is Socratic (per ADR-0014): the collab-adr-lean protocol asks the
 * question's author to state a lean; omitting it shifts the entire cognitive
 * load to the human. Body is verbatim from ADR-0019's "NOT: D9.5 message"
 * block; the trailing SEE line points directly at the ADR rather than the
 * superseded docs/adr/adr-docs/ path, per ADR-0015 Decision 2's interim
 * policy (same substitution already applied to D6.2/D6.5).
 *
 * Fix: inserts the SUGGESTED scaffold immediately before the QST's **ANS:**
 * line — a starting structure for the model to fill in, not a substitute for
 * actually reasoning about the recommendation.
 *
 * See: ADR-0019 (Multi-Recommendation Data Model — ORJ as Structure).
 */

import type { AdrFile } from '../../parser/types'
import type { ViolationHandler, ViolationRecord, Patch } from '../types'
import { contentChecksum } from '../patch-applicator'

const ANS_LINE_RE = /^\*\*ANS:\*\*/
const QST_HEADING_RE = /^###\s+QST:/i

const SUGGESTED_BLOCK = `**Recommendation**: (by [your model name])

[Bold pick + 2–4 sentences of justification grounded in evidence.]`

const MESSAGE = `MISSING_RECOMMENDATION: this open QST has no Recommendation block.

The collab-adr-lean protocol asks the question's author to state a lean —
asking without a position shifts the entire cognitive load to the human.

SUGGESTED:
${SUGGESTED_BLOCK}

WHY: see METHODOLOGY.md §5 (Recommendation visibility) — ORJ: never divorce
an opinion from its epistemic trace.
SEE: docs/adr/0019-multi-recommendation-data-model.md`

export class D95MissingRecommendationHandler implements ViolationHandler {
  readonly id = 'd9-5-missing-recommendation'
  readonly dependsOn: readonly string[] | undefined = undefined
  readonly description = 'Open QST has no Recommendation block — the protocol asks the author to state a lean'

  detect(content: string, parseResult: AdrFile): ViolationRecord[] {
    const lines = content.split('\n')
    const checksum = contentChecksum(content)
    const records: ViolationRecord[] = []

    for (const q of parseResult.questions) {
      if (q.isAnswered) continue
      if (q.recommendations && q.recommendations.length > 0) continue

      const ansIdx = this.findAnsLine(lines, q.lineStart)
      if (ansIdx === -1) continue // can't anchor an insertion safely — skip (D8 territory)

      records.push({
        handlerId: this.id,
        description: MESSAGE,
        lineStart: ansIdx + 1,
        lineEnd: ansIdx + 1,
        originalText: lines[ansIdx],
        contentChecksum: checksum,
      })
    }

    return records
  }

  fix(_content: string, record: ViolationRecord): Patch {
    return {
      lineStart: record.lineStart,
      lineEnd: record.lineEnd,
      replacement: `${SUGGESTED_BLOCK}\n\n${record.originalText}`,
    }
  }

  process(content: string, parseResult: AdrFile): Patch[] {
    return this.detect(content, parseResult).map(r => this.fix(content, r))
  }

  /** Find the **ANS:** line within this QST's window (q.lineStart is 1-indexed; lines is 0-indexed). */
  private findAnsLine(lines: string[], qstLineStart: number): number {
    for (let i = qstLineStart; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (QST_HEADING_RE.test(trimmed)) break // reached the next QST without finding ANS
      if (ANS_LINE_RE.test(trimmed)) return i
    }
    return -1
  }
}
