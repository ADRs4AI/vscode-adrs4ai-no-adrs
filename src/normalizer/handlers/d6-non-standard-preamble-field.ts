/**
 * D6: NonStandardPreambleFieldHandler
 *
 * Deviation: preamble (header) fields use the wrong format.
 * The standard collab-adr-lean format is:
 *   - **Key**: value         (bullet dash, bold key, colon OUTSIDE bold)
 *
 * Common deviations (all confirmed in temp/misc-problem-adr-03/):
 *   **Key:** value            (no bullet, colon INSIDE bold)
 *   **Key**: value            (no bullet, colon outside bold)
 *   - **Key:** value          (has bullet, colon INSIDE bold)
 *
 * Impact: extractMetadata() uses BOLD_BULLET_RE = /^-\s+\*\*([^*:]+)\*\*:\s+(.+)$/
 * None of the deviant forms match → Status, Date, Iteration fields not parsed
 * → MISSING_STATUS warning fires even though the field is present.
 *
 * Scope: preamble lines only (between the # Title line and the first ## section).
 * The handler stops scanning at the first ## heading or --- separator after the
 * preamble block.
 *
 * See: temp/misc-problem-adr-03/8001-freirean-problem-posing-pedagogy.md
 */

import type { AdrFile } from '../../parser/types'
import type { ViolationHandler, ViolationRecord, Patch } from '../types'
import { contentChecksum } from '../patch-applicator'

/** Colon inside bold, with or without bullet prefix */
const COLON_INSIDE_RE = /^(?:-\s+)?\*\*([^*:\n]+):\*\*\s+(.+)$/
/** Colon outside bold, no bullet prefix */
const COLON_OUTSIDE_NO_DASH_RE = /^\*\*([^*:\n]+)\*\*:\s+(.+)$/

function isNonStandard(trimmed: string): boolean {
  return COLON_INSIDE_RE.test(trimmed) || COLON_OUTSIDE_NO_DASH_RE.test(trimmed)
}

function extractKeyValue(trimmed: string): { key: string; value: string } | null {
  const stripped = trimmed.replace(/^-\s+/, '') // strip leading "- "
  const inside = stripped.match(/^\*\*([^*:]+):\*\*\s+(.+)$/)
  if (inside) return { key: inside[1].trim(), value: inside[2].trim() }
  const outside = stripped.match(/^\*\*([^*:]+)\*\*:\s+(.+)$/)
  if (outside) return { key: outside[1].trim(), value: outside[2].trim() }
  return null
}

export class D6NonStandardPreambleFieldHandler implements ViolationHandler {
  readonly id = 'd6-non-standard-preamble-field'
  readonly dependsOn = undefined
  readonly description =
    'Preamble field missing "- " prefix or uses "**Key:**" (colon inside bold) — extractMetadata() cannot parse it\n\nSEE: docs/adr/0013-normalizer-format-conformance.md'

  detect(content: string, _parseResult: AdrFile): ViolationRecord[] {
    const lines = content.split('\n')
    const checksum = contentChecksum(content)
    const records: ViolationRecord[] = []

    let seenTitle = false
    let inPreamble = false

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()

      if (!seenTitle) {
        if (trimmed.startsWith('# ')) { seenTitle = true; inPreamble = true; }
        continue
      }

      // Preamble ends at first ## heading
      if (trimmed.startsWith('##')) break
      if (!inPreamble || trimmed === '' || trimmed === '---') continue

      if (isNonStandard(trimmed)) {
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
    const kv = extractKeyValue(record.originalText.trim())
    const replacement = kv
      ? `- **${kv.key}**: ${kv.value}`
      : `- ${record.originalText.trim()}` // fallback: just add "- "
    return { lineStart: record.lineStart, lineEnd: record.lineEnd, replacement }
  }

  process(content: string, parseResult: AdrFile): Patch[] {
    return this.detect(content, parseResult).map(r => this.fix(content, r))
  }
}
