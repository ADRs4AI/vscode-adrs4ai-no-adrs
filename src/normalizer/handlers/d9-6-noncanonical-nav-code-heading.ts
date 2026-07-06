/**
 * D9.6: NoncanonicalNavCodeHeadingHandler
 *
 * Deviation: a heading is recognized as a nav code (QST/ANS/COD/API/FIL/DOC/NOT)
 * only because the parser's tolerant fallback caught it — the heading itself
 * deviates from the canonical "### QST: text" form by case ("### qst:") or by
 * missing whitespace after the colon ("### QST:Question").
 *
 * Impact (pre-fix, ADR-0024): extractor.ts's NAV_CODE_HEADING_RE was exact-match
 * and case-sensitive, so these headings made navCode come back undefined and
 * the question silently vanished from the Open Questions panel — no
 * ParseWarning, nothing. The parser now accepts the tolerant form and always
 * emits NONCANONICAL_NAV_CODE_HEADING (extractor.ts), so the question is never
 * lost. This handler is the second layer: it proposes the canonical rewrite as
 * a Quick Fix, same three-layer shape (parser-recovery -> diagnostic ->
 * Quick-Fix) as D6.5.
 *
 * Scope: any heading line, any level — nav code headings are not restricted to
 * ### specifically, so this scans the whole document rather than a bounded
 * preamble/QST-body region.
 *
 * D-number: D9.6, the QST-block cluster (per Touchstone 4.7's taxonomy
 * pointer, docs/inbox/2026-07-06-2236-touchstone-to-flint-d-taxonomy-pointer-and-welcome.md,
 * against the reorg decided in seed-2026-04-17-dogfood-master-plan.md).
 *
 * See: docs/adr/0024-qst-heading-recognition-tolerance.md
 */

import type { AdrFile } from '../../parser/types'
import type { ViolationHandler, ViolationRecord, Patch } from '../types'
import { contentChecksum } from '../patch-applicator'

const HEADING_LINE_RE = /^(#{1,6})\s+(.*)$/
/** Canonical form: exact case, whitespace required after the colon. */
const NAV_CODE_STRICT_RE = /^(QST|ANS|COD|API|FIL|DOC|NOT):\s+(.*)$/
/** Same code words, case-insensitive, colon spacing optional. */
const NAV_CODE_TOLERANT_RE = /^(QST|ANS|COD|API|FIL|DOC|NOT):\s*(.*)$/i

export class D96NoncanonicalNavCodeHeadingHandler implements ViolationHandler {
  readonly id = 'd9-6-noncanonical-nav-code-heading'
  readonly dependsOn: readonly string[] | undefined = undefined
  readonly description =
    'Nav code heading recognized only case-insensitively or with a glued colon — parses correctly, but the canonical form is what deep links and MCP output expect\n\nSEE: docs/adr/0024-qst-heading-recognition-tolerance.md'

  detect(content: string, _parseResult: AdrFile): ViolationRecord[] {
    const lines = content.split('\n')
    const checksum = contentChecksum(content)
    const records: ViolationRecord[] = []

    for (let i = 0; i < lines.length; i++) {
      const headingMatch = lines[i].match(HEADING_LINE_RE)
      if (!headingMatch) continue

      const headingText = headingMatch[2]
      if (NAV_CODE_STRICT_RE.test(headingText)) continue // already canonical

      const tolerant = headingText.match(NAV_CODE_TOLERANT_RE)
      if (!tolerant) continue // not a nav-code heading at all

      records.push({
        handlerId: this.id,
        description: this.buildMessage(headingText, tolerant[1].toUpperCase(), tolerant[2].trim()),
        lineStart: i + 1,
        lineEnd: i + 1,
        originalText: lines[i],
        contentChecksum: checksum,
      })
    }

    return records
  }

  fix(_content: string, record: ViolationRecord): Patch {
    const headingMatch = record.originalText.match(HEADING_LINE_RE)!
    const hashes = headingMatch[1]
    const tolerant = headingMatch[2].match(NAV_CODE_TOLERANT_RE)!
    const code = tolerant[1].toUpperCase()
    const text = tolerant[2].trim()
    return {
      lineStart: record.lineStart,
      lineEnd: record.lineEnd,
      replacement: `${hashes} ${code}: ${text}`,
    }
  }

  process(content: string, parseResult: AdrFile): Patch[] {
    return this.detect(content, parseResult).map(r => this.fix(content, r))
  }

  private buildMessage(headingText: string, code: string, text: string): string {
    return `NONCANONICAL_NAV_CODE_HEADING: heading "${headingText}" was recognized as ${code} but doesn't match the canonical "${code}: text" form (case or colon spacing differs). Recognized anyway — no data lost — but the canonical form is what deep links (ADR-0002) and MCP output (ADR-0003) expect.

SUGGESTED:
${code}: ${text}

WHY: nav code headings are matched exactly (case-sensitive, space after colon) everywhere except this tolerant recovery path; writing the canonical form keeps every consumer in agreement.
SEE: docs/adr/0024-qst-heading-recognition-tolerance.md`
  }
}
