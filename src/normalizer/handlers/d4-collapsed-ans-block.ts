/**
 * D4: CollapsedAnsBlockHandler
 *
 * Deviation: "**ANS:** (fill in)" on a single line instead of the standard:
 *   **ANS:** (by Human)
 *
 *   [Fill this in]
 *
 * Root cause (subtle): The parser's ANS_INLINE_RE matches "**ANS:**" and
 * captures the remainder of the line as the answer text. "(fill in)" does
 * NOT match the square-bracket placeholder pattern /^\[\s*fill\s+this\s+in/,
 * so it is treated as a real answer. This sets isAnswered=true, making the
 * question silently disappear from the Open Questions panel.
 *
 * Empirically confirmed as the PRIMARY blocker for questions not surfacing.
 * See: src/test/fixtures/zoo/README.md — Empirical Findings (2026-03-16).
 */

import type { AdrFile } from '../../parser/types'
import type { ViolationHandler, ViolationRecord, Patch } from '../types'
import { contentChecksum } from '../patch-applicator'

/** Matches "**ANS:** (fill in)" or "**ANS:** (fill this in)" variants */
const COLLAPSED_ANS_RE = /^\*\*ANS:\*\*\s*\(\s*fill\s*(this\s*)?in\s*\)\s*$/i

export class D4CollapsedAnsBlockHandler implements ViolationHandler {
  readonly id = 'd4-collapsed-ans-block'
  readonly description = '**ANS:** (fill in) collapsed onto one line — causes question to be treated as answered\n\nSEE: docs/adr/0013-normalizer-format-conformance.md'

  detect(content: string, _parseResult: AdrFile): ViolationRecord[] {
    const lines = content.split('\n')
    const checksum = contentChecksum(content)
    const records: ViolationRecord[] = []

    for (let i = 0; i < lines.length; i++) {
      if (COLLAPSED_ANS_RE.test(lines[i].trim())) {
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
    return {
      lineStart: record.lineStart,
      lineEnd: record.lineEnd,
      // Expand to standard two-line form with blank line between
      replacement: '**ANS:** (by Human)\n\n[Fill this in]',
    }
  }

  process(content: string, parseResult: AdrFile): Patch[] {
    return this.detect(content, parseResult).map(r => this.fix(content, r))
  }
}
