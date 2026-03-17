/**
 * D2: BoldStatusFieldHandler
 *
 * Deviation: "- **Status**: unanswered" (bold field name) instead of
 * the standard "- Status: unanswered" (plain).
 *
 * Impact:
 * 1. STATUS_LINE_RE = /^-\s+Status:\s+(.+)$/ does not match bold variant →
 *    statusText stays as default 'unanswered', which is actually correct for
 *    display purposes.
 * 2. writeAnswer() searches for "- Status: unanswered" to update it to
 *    "- Status: answered". With bold variant, the update fails silently →
 *    question reappears as open after being answered.
 *
 * D2b variant: "- **Status**: unanswered (linked to ADR 0004 QST)" —
 * trailing parenthetical after the status value. The handler strips it,
 * normalizing to just the status keyword.
 *
 * See: src/test/fixtures/zoo/README.md — Deviation Catalogue.
 */

import type { AdrFile } from '../../parser/types'
import type { ViolationHandler, ViolationRecord, Patch } from '../types'
import { contentChecksum } from '../patch-applicator'

/**
 * Matches "- **Status**: value" ONLY for QST-body status values.
 * ADR header status values (Draft, Accepted, Implemented, Superseded, …)
 * use bold format by convention and must NOT be flagged.
 * QST-body values are always lowercase: unanswered / answered.
 */
const BOLD_STATUS_RE = /^(\s*)-\s+\*\*Status\*\*:\s+(unanswered|answered)\b(.*)?$/i

export class D2BoldStatusFieldHandler implements ViolationHandler {
  readonly id = 'd2-bold-status-field'
  readonly dependsOn = undefined
  readonly description = '- **Status**: ... uses bold field name; writeAnswer() cannot update it'

  detect(content: string, _parseResult: AdrFile): ViolationRecord[] {
    const lines = content.split('\n')
    const checksum = contentChecksum(content)
    const records: ViolationRecord[] = []

    for (let i = 0; i < lines.length; i++) {
      if (BOLD_STATUS_RE.test(lines[i])) {
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
    const m = record.originalText.match(BOLD_STATUS_RE)!
    const indent = m[1]
    const statusValue = m[2].toLowerCase().trim() // normalize case too
    // D2b: discard trailing parenthetical (m[3])
    return {
      lineStart: record.lineStart,
      lineEnd: record.lineEnd,
      replacement: `${indent}- Status: ${statusValue}`,
    }
  }

  process(content: string, parseResult: AdrFile): Patch[] {
    return this.detect(content, parseResult).map(r => this.fix(content, r))
  }
}
