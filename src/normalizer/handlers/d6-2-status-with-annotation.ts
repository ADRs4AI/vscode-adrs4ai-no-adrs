/**
 * D6.2: StatusWithAnnotationHandler (previousIds: ['D7', 'd7-status-with-annotation'])
 *
 * Deviation: the preamble Status field carries semantic load beyond the base
 * status value — "Draft — awaiting human answers", "Accepted (updated)",
 * "Draft: awaiting review". This is the pattern named in ADR-0014's founding
 * in-vivo observation: a model stripped "Draft — awaiting human answers" down
 * to "Draft" because the old UNKNOWN_STATUS diagnostic pressured it to,
 * destroying information. The right structural answer is a dedicated field
 * (**Awaiting**:, **Scope Remaining**:, **Last Updated**:), not silence and
 * not a stripped status.
 *
 * Detection (all annotations flagged — no "short decoratives" exemption,
 * per Jérémie's Iteration-2 answer: it is unsustainable to anticipate which
 * annotations are purely cosmetic):
 *   - `BaseStatus — annotation` / `BaseStatus – annotation` (em/en-dash separator)
 *   - `BaseStatus (annotation)` (parenthetical with any meaningful text)
 *   - `BaseStatus: annotation` (colon extending the status value)
 *
 * Message: Socratic-but-pedagogical, per ADR-0014 Iteration 2/3 canonical
 * wording verbatim (Cairn 4.7's phrasing) — validates the impulse, teaches
 * the structural principle, offers a pattern menu, grants permission to
 * compose custom fields. No single-best-guess.
 *
 * Scope: preamble Status field only (between `# Title` and the first `##`
 * or `---`) — same boundary as D6/D6.5. Distinct from D2, which handles the
 * QST-body `- Status: unanswered/answered` field.
 *
 * See: ADR-0014 (Constructive Diagnostic Design), Decision 1 + Iterations 2/3.
 */

import type { AdrFile } from '../../parser/types'
import type { ViolationHandler, ViolationRecord, Patch } from '../types'
import { contentChecksum } from '../patch-applicator'

/** Preamble Status field, bold or unbold key (D6.5 tolerates both on read). */
const STATUS_FIELD_RE = /^(\s*)-\s+(?:\*\*Status\*\*|Status)\s*:\s+(.+)$/

/** Em/en-dash separator: "Draft — awaiting human answers" */
const EM_DASH_RE = /^(.+?)\s+[—–]\s+(.+)$/
/** Parenthetical annotation: "Accepted (updated)" — requires non-empty content */
const PAREN_RE = /^(.+?)\s*\(([^)]+)\)\s*$/
/** Colon-extended value: "Draft: awaiting review" */
const COLON_RE = /^([^:]+):\s*(.+)$/

interface Split {
  base: string
  annotation: string
}

function splitAnnotation(value: string): Split | null {
  const em = value.match(EM_DASH_RE)
  if (em) return { base: em[1].trim(), annotation: em[2].trim() }

  const paren = value.match(PAREN_RE)
  if (paren && paren[2].trim()) return { base: paren[1].trim(), annotation: paren[2].trim() }

  const colon = value.match(COLON_RE)
  if (colon && colon[2].trim()) return { base: colon[1].trim(), annotation: colon[2].trim() }

  return null
}

export class D62StatusWithAnnotationHandler implements ViolationHandler {
  readonly id = 'd6-2-status-with-annotation'
  readonly dependsOn: readonly string[] | undefined = undefined
  readonly description = 'Status value carries an annotation ("Draft — awaiting answers") — the annotation belongs in its own structured field'

  detect(content: string, _parseResult: AdrFile): ViolationRecord[] {
    const lines = content.split('\n')
    const checksum = contentChecksum(content)
    const records: ViolationRecord[] = []

    let seenTitle = false
    let inPreamble = false

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()

      if (!seenTitle) {
        if (trimmed.startsWith('# ')) { seenTitle = true; inPreamble = true }
        continue
      }

      if (trimmed.startsWith('##')) break
      if (!inPreamble || trimmed === '' || trimmed === '---') continue

      const m = lines[i].match(STATUS_FIELD_RE)
      if (!m) continue

      const rawValue = m[2].trim()
      const split = splitAnnotation(rawValue)
      if (!split) continue

      records.push({
        handlerId: this.id,
        description: this.buildMessage(rawValue),
        lineStart: i + 1,
        lineEnd: i + 1,
        originalText: lines[i],
        contentChecksum: checksum,
      })
    }

    return records
  }

  fix(_content: string, record: ViolationRecord): Patch {
    const m = record.originalText.match(STATUS_FIELD_RE)!
    const indent = m[1]
    const split = splitAnnotation(m[2].trim())!
    return {
      lineStart: record.lineStart,
      lineEnd: record.lineEnd,
      replacement: `${indent}- **Status**: ${split.base}`,
    }
  }

  process(content: string, parseResult: AdrFile): Patch[] {
    return this.detect(content, parseResult).map(r => this.fix(content, r))
  }

  private buildMessage(rawValue: string): string {
    // DMA (ADR-0014): quote the value exactly as written. Reconstructing
    // "base — annotation" here would silently substitute an em-dash even when
    // the author used parens or a colon — a message that misquotes what the
    // user actually typed is exactly the "obviously not true" failure mode
    // this ADR exists to prevent.
    return `STATUS_WITH_ANNOTATION: your status value contains a description ("${rawValue}").

THIS IS A STRUCTURED FIELD. Its value drives the tree view, the Open Questions panel, and the MCP outputs — LLMs and humans depend on it being pickable from a controlled set.

Your annotation is not wrong to add. It just needs to live in its own structured field, so the tools can use both signals independently. Some patterns other authors use:
  - **Awaiting**: what is blocking (freeform text, or \`ADR NNNN == implemented\` for a structured blocker)
  - **Scope Remaining**: what is still to do when status is Partially Implemented
  - **Last Updated**: YYYY-MM-DD when the status was reviewed

Compose your own if none of these fit. The tool won't error on unknown preamble fields — unrecognized fields are informational, not a block.

SEE: docs/adr/0014-constructive-diagnostic-design.md`
  }
}
