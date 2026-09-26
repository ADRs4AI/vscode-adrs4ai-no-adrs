/**
 * D9.8: TrailingAliasHandleHandler
 *
 * Deviation: a question heading carries its petname as a TRAILING
 * parenthesis — "### QST: Which store do we use? (QST-STORE)" — instead of
 * the taught canonical LEADING handle, "### QST-STORE: Which store do we
 * use?". A wild dialect (167 headings across 4 repos; founder Report,
 * companion etude, 2026-09-13). The parser reads it wide (ledger ruling
 * 2026-09-26, Riddle 5): the petname binds as an ALIAS anchor, `#qst-store`
 * resolves, display text is stripped — and the question's `id` is left
 * exactly as its heading's bytes derive it. This handler is the second
 * layer: it SUGGESTS migrating to the canonical leading form.
 *
 * SUGGEST-ONLY, never bulk (ruling clause 5): the migration CHANGES the
 * question's id (auto-derived long slug → `qst-<handle>`), so any reference
 * holding the old id/slug stops resolving — the same fragility as retitling
 * any auto-anchored question. That cost is the author's to weigh, per
 * question. Hence `bulkApply = false` (excluded from Coordinator.processAll
 * and the "Normalize to adr format" Quick Fix) and a message that states the
 * cost in plain words, old id and new id both named.
 *
 * Only headings whose parse ACTUALLY bound an alias are offered (a refused
 * collision has its own ALIAS_HANDLE_COLLISION diagnostic, and nothing to
 * migrate to), and only the canonical strict "### QST: …" form (other
 * heading deviations get their own D9.6 fix first; rewriting them here could
 * drop an annotation).
 *
 * See: docs/QST-DETECTION-LEDGER.md (trailing (QST-PETNAME) dialect, RULED
 * 2026-09-26).
 */

import type { AdrFile } from '../../parser/types'
import type { ViolationHandler, ViolationRecord, Patch } from '../types'
import { contentChecksum } from '../patch-applicator'

/** "### QST: text (QST-PETNAME)" + an optional trailing dismissal marker (kept verbatim). */
const TRAILING_ALIAS_HEADING_RE =
  // Strict canonical "QST:" keyword (exact case); the petname's own "QST-"
  // is read case-insensitively, exactly like the parser's alias grammar.
  /^(#{1,6})\s+QST:\s+(.*?)\s*\([Qq][Ss][Tt]-([^)\s]+)\)(\s*<!--\s*@adr-dismissed:[^>]*-->)?\s*$/

function foldedHandle(raw: string): string {
  // Same fold as the parser's foldQstId — kept local (this file must not
  // import the extractor's private helper); only used to double-check that
  // the heading's petname is the one the parser bound.
  return raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24).replace(/^-+|-+$/g, '')
}

export class D98TrailingAliasHandleHandler implements ViolationHandler {
  readonly id = 'd9-8-trailing-alias-handle'
  readonly dependsOn: readonly string[] | undefined = undefined
  readonly bulkApply = false
  readonly quickFixTitle = "Migrate trailing (QST-…) to a leading handle — changes this question's id"
  readonly description =
    'Question heading carries its handle as a trailing "(QST-PETNAME)" — recognized as an alias, but the canonical form is the leading handle (migration changes the question id; suggested per question, never in bulk)'

  detect(content: string, parseResult: AdrFile): ViolationRecord[] {
    const lines = content.split('\n')
    const checksum = contentChecksum(content)
    const records: ViolationRecord[] = []

    for (const q of parseResult.questions) {
      if (!q.aliasSlug || !q.qstId) continue // only a BOUND alias has anything to migrate to
      const lineIdx = q.lineStart - 1
      const m = lines[lineIdx]?.match(TRAILING_ALIAS_HEADING_RE)
      if (!m) continue // not the strict "### QST: …" shape — leave to D9.6 / the author
      if (foldedHandle(m[3]) !== q.qstId) continue // defensive: not the petname the parser bound

      records.push({
        handlerId: this.id,
        description: this.buildMessage(q.id, q.adrNumber, q.qstId, m[2].trim(), m[3]),
        lineStart: q.lineStart,
        lineEnd: q.lineStart,
        originalText: lines[lineIdx],
        contentChecksum: checksum,
      })
    }
    return records
  }

  fix(_content: string, record: ViolationRecord): Patch {
    const m = record.originalText.match(TRAILING_ALIAS_HEADING_RE)!
    const [, hashes, text, petname, dismissal] = m
    return {
      lineStart: record.lineStart,
      lineEnd: record.lineEnd,
      replacement: `${hashes} QST-${foldedHandle(petname)}: ${text.trim()}${dismissal ?? ''}`,
    }
  }

  process(content: string, parseResult: AdrFile): Patch[] {
    return this.detect(content, parseResult).map(r => this.fix(content, r))
  }

  private buildMessage(oldId: string, adrNumber: number, handle: string, text: string, petname: string): string {
    const newId = `adr-${String(adrNumber).padStart(4, '0')}-qst-${handle.toLowerCase()}`
    return `TRAILING_ALIAS_HANDLE: this question carries its handle as a trailing "(QST-${petname})". It is recognized as an alias — "#qst-${handle.toLowerCase()}" resolves — but the canonical form is the LEADING handle.

SUGGESTED (your choice per question — never applied in bulk):
### QST-${handle}: ${text}

COST: migrating CHANGES this question's id from "${oldId}" to "${newId}". Any reference holding the old auto-derived id or slug (tours, briefs, tickets) will stop resolving — the same fragility as retitling any auto-anchored question. References written as "#qst-${handle.toLowerCase()}" keep working either way. If nothing cites the old id, migrate; if unsure, leave it.

WHY: the leading handle is the taught canonical form; the alias exists so the wild dialect is read, not so it is written.
SEE: docs/QST-DETECTION-LEDGER.md (trailing (QST-PETNAME) dialect)`
  }
}
