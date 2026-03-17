/**
 * D1: OpenQuestionsSectionHandler
 *
 * Deviation: "## Open Questions" section name instead of "## Questions".
 *
 * Impact: Does NOT prevent QST blocks inside the section from being indexed
 * (the parser finds ### QST: headings regardless of parent section name).
 * BUT: the Open Questions panel's ADR context extraction uses an exact-match
 * lookup — adr.sections.find(s => s.heading === 'Questions'). With "Open
 * Questions", this lookup returns undefined, so the panel's lineStart boundary
 * falls back to Infinity — all sections are treated as "before Questions" and
 * the entire ADR is included as context.
 *
 * Fix: rename "## Open Questions" → "## Questions".
 * Also handles "## Open questions" (case variation).
 *
 * dependsOn: none — this handler has no preconditions.
 *
 * See: src/test/fixtures/zoo/README.md — Empirical Findings, Problem 2.
 */

import type { AdrFile } from '../../parser/types'
import type { ViolationHandler, ViolationRecord, Patch } from '../types'
import { contentChecksum } from '../patch-applicator'

/** Matches "## Open Questions" (case-insensitive, optional trailing whitespace) */
const OPEN_QUESTIONS_RE = /^(#{1,3})\s+Open\s+Questions\s*$/i

export class D1OpenQuestionsSectionHandler implements ViolationHandler {
  readonly id = 'd1-open-questions-section'
  readonly dependsOn = undefined
  readonly description = '"## Open Questions" section name prevents ADR context boundary detection'

  detect(content: string, _parseResult: AdrFile): ViolationRecord[] {
    const lines = content.split('\n')
    const checksum = contentChecksum(content)
    const records: ViolationRecord[] = []

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(OPEN_QUESTIONS_RE)
      if (m) {
        records.push({
          handlerId: this.id,
          description: this.description,
          lineStart: i + 1,
          lineEnd: i + 1,
          originalText: lines[i],
          contentChecksum: checksum,
        })
      }
    }

    return records
  }

  fix(_content: string, record: ViolationRecord): Patch {
    const m = record.originalText.match(OPEN_QUESTIONS_RE)!
    const hashes = m[1] // preserve heading level (##, ###, etc.)
    return {
      lineStart: record.lineStart,
      lineEnd: record.lineEnd,
      replacement: `${hashes} Questions`,
    }
  }

  process(content: string, parseResult: AdrFile): Patch[] {
    return this.detect(content, parseResult).map(r => this.fix(content, r))
  }
}
