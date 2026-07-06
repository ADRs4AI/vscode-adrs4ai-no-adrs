/**
 * D6.5: MissingBoldPreambleFieldHandler
 *
 * Deviation: a preamble field is present with its key unbold —
 * "- Status: Draft" instead of the canonical "- **Status**: Draft".
 *
 * Impact (pre-fix): the parser's BOLD_BULLET_RE required `**Key**:`, so this
 * form was invisible to extractMetadata() and the Status field fired
 * MISSING_STATUS even though the value was present. That diagnostic was
 * factually wrong — Jérémie's dogfood report named this exact failure mode:
 * "when the tool says things obviously not true, it gets fully tuned out."
 * (temp/misc-problem-adr-08-with-tooltip/README.md:14). extractor.ts now
 * tolerates this form (DASH_PLAIN_BULLET_RE), so this handler's job is purely
 * the second layer: propose the bold form as a Quick Fix.
 *
 * DMA (Diagnostic Message Accuracy, ADR-0014): the message must never say
 * "missing" — the field is present, only the format deviates.
 *
 * Scope: preamble lines only (between the # Title line and the first ## or
 * --- section boundary), same boundary logic as D6NonStandardPreambleFieldHandler.
 *
 * See: ADR-0014 (Constructive Diagnostic Design), Iteration 2 D6.5 canonical spec.
 */

import type { AdrFile } from '../../parser/types'
import type { ViolationHandler, ViolationRecord, Patch } from '../types'
import { contentChecksum } from '../patch-applicator'

/** Dash bullet, unbold key, colon-space value — key restricted to letters/digits/spaces
 *  so this never matches the bold form (which starts with "- **") or arbitrary prose. */
const MISSING_BOLD_RE = /^(\s*)-\s+([A-Za-z][A-Za-z0-9 ]*)\s*:\s+(.+)$/

export class D65MissingBoldPreambleFieldHandler implements ViolationHandler {
  readonly id = 'd6-5-missing-bold-preamble-field'
  readonly dependsOn: readonly string[] | undefined = undefined
  readonly description = 'Preamble field is unbold (e.g., "- Status: Draft") — parses correctly, but bold keys are what make the preamble skimmable'

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

      // Preamble ends at first ## heading or --- separator
      if (trimmed.startsWith('##')) break
      if (!inPreamble || trimmed === '' || trimmed === '---') continue

      const m = lines[i].match(MISSING_BOLD_RE)
      if (m) {
        const key = m[2].trim()
        const value = m[3].trim()
        records.push({
          handlerId: this.id,
          description: this.buildMessage(key, value),
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
    const m = record.originalText.match(MISSING_BOLD_RE)!
    const indent = m[1]
    const key = m[2].trim()
    const value = m[3].trim()
    return {
      lineStart: record.lineStart,
      lineEnd: record.lineEnd,
      replacement: `${indent}- **${key}**: ${value}`,
    }
  }

  process(content: string, parseResult: AdrFile): Patch[] {
    return this.detect(content, parseResult).map(r => this.fix(content, r))
  }

  private buildMessage(key: string, value: string): string {
    return `MISSING_BOLD_ON_PREAMBLE_FIELD: your ${key} field is unbold (\`- ${key}: ${value}\` instead of \`- **${key}**: ${value}\`). The field parses correctly — your value is \`${value}\` — but the tree view and MCP outputs render bold preamble keys as structural, and unbold as prose. This is a rendering cue, not a content problem.

SUGGESTED:
- **${key}**: ${value}

WHY: preamble keys are **Bold** by convention so tools (and other authors) can pick them out on a skim.
SEE: docs/adr/0014-constructive-diagnostic-design.md`
  }
}
