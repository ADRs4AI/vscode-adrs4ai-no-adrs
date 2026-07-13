/**
 * D9.4: NonstandardFillPlaceholderHandler
 *
 * Deviation: the ANS placeholder uses a non-canonical stock token — e.g.
 * "**ANS:** [unanswered]" (inline) instead of "**ANS:**" + newline +
 * "[Fill this in]".
 *
 * Impact (pre-fix, live specimen 2026-07-10):
 * temp/0011-agent-sessions-json-linter-fuzzy-field-and-shape-validation.md
 * used "[unanswered]" — extractor.ts's placeholder regex only recognized
 * "fill this in" variants, so the bracketed text became a real `answer` ->
 * isAnswered: true -> the question silently vanished from the Open
 * Questions panel AS DONE. The parser now tolerates this (accepts,
 * extracts, does not treat as an answer) and always emits
 * NONSTANDARD_FILL_PLACEHOLDER — this handler is the second layer: propose
 * the canonical rewrite as a Quick Fix, same three-layer shape as D6.5/D9.6.
 *
 * DMA (ADR-0014): the message must not scold what was right. The emitting
 * model structured the QST/ANS block correctly — it just reached for the
 * wrong bracketed word. Validate that before correcting the token.
 *
 * Scope: any "**ANS:**" line, any heading level's QST body — not restricted
 * to the preamble (unlike the D6.x cluster).
 *
 * See: docs/inbox/2026-07-10-0541-lapidary-to-flint-d9-4-specimen-live-
 * placeholder-drift-reads-as-answered.md, docs/adr/0013-normalizer-format-
 * conformance.md.
 */

import type { AdrFile } from '../../parser/types'
import type { ViolationHandler, ViolationRecord, Patch } from '../types'
import { contentChecksum } from '../patch-applicator'
import { stripPlaceholderWrapper, PLACEHOLDER_LEXICON_RE } from '../../parser/extractor'

/**
 * Matches "**ANS:** [synonym]" on one line, with an optional attribution
 * (by/from Author) between the marker and the bracket. Whole-line anchored
 * so a real answer that merely starts with a bracketed reference on the
 * same line as the marker is never misread — this only matches when the
 * ENTIRE trailing content is one of the synonym stock tokens.
 */
// "awaiting" added 2026-07-12 (Quarry 5 ecosystem sweep, corpus zoo-005) —
// same lexicon addition as extractor.ts's PLACEHOLDER_SYNONYM_RE; kept in
// sync by hand until ADR-0031's placeholder.ts module replaces all three
// sites with one source of truth.
const INLINE_ANS_PLACEHOLDER_RE =
  /^(\s*)\*\*ANS:\*\*\s*(\((?:by|from)\s+[^)]+\)\s*)?\[\s*(?:unanswered|to be answered|tbd|pending|todo|awaiting)[^\]]*\]\s*$/i
// Bug report (2026-07-12, Jérémie, temp/0048): a bare "[ ]"/"[]" is the same
// deviation class as the named synonyms above, but a separate regex on
// purpose — folding it into the group above (matching on empty) would let
// its trailing `[^\]]*` swallow ANY bracketed text ("[see ADR-0014]") as a
// false-positive placeholder, same hazard noted in extractor.ts's sibling fix.
const INLINE_ANS_EMPTY_PLACEHOLDER_RE =
  /^(\s*)\*\*ANS:\*\*\s*(\((?:by|from)\s+[^)]+\)\s*)?\[\s*\]\s*$/i

// D9.4 morphology #4 (Lapidary's charter, 2026-07-12, temp/0021-crew-
// architecture-and-staffing.md — Athanor 5 specimen): the same deviation,
// split across two lines instead of inline — "**ANS:** (by Author)" on its
// own line, then "_(pending)_" (or "(pending)", "*(TBD)*", "_todo_") on the
// next. extractor.ts's stripPlaceholderWrapper()/PLACEHOLDER_LEXICON_RE are
// the single source of truth for "is this a wrapped placeholder word" —
// reused here rather than a parallel regex, so the normalizer's Quick Fix
// never drifts from what the parser already tolerates.
const ANS_MARKER_ONLY_LINE_RE = /^(\s*)\*\*ANS:\*\*\s*(\((?:by|from)\s+[^)]+\)\s*)?$/i

export class D94NonstandardFillPlaceholderHandler implements ViolationHandler {
  readonly id = 'd9-4-nonstandard-fill-placeholder'
  readonly dependsOn: readonly string[] | undefined = undefined
  readonly description =
    'ANS placeholder uses a non-canonical stock token (e.g. "[unanswered]") instead of "[Fill this in]" — parses correctly as unanswered, but the canonical form is what every tool expects\n\nSEE: docs/adr/0013-normalizer-format-conformance.md'

  detect(content: string, _parseResult: AdrFile): ViolationRecord[] {
    const lines = content.split('\n')
    const checksum = contentChecksum(content)
    const records: ViolationRecord[] = []

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(INLINE_ANS_PLACEHOLDER_RE) ?? lines[i].match(INLINE_ANS_EMPTY_PLACEHOLDER_RE)
      if (m) {
        records.push({
          handlerId: this.id,
          description: this.buildMessage(lines[i].trim()),
          lineStart: i + 1,
          lineEnd: i + 1,
          originalText: lines[i],
          contentChecksum: checksum,
        })
        continue
      }

      // Two-line wrapped-placeholder form: bare "**ANS:**" marker line,
      // then a next line that IS (whole-content) an italic/paren-wrapped
      // stock word.
      const markerMatch = lines[i].match(ANS_MARKER_ONLY_LINE_RE)
      if (markerMatch && i + 1 < lines.length) {
        const { inner, wrapped } = stripPlaceholderWrapper(lines[i + 1].trim())
        if (wrapped && PLACEHOLDER_LEXICON_RE.test(inner)) {
          records.push({
            handlerId: this.id,
            description: this.buildMessage(lines[i + 1].trim()),
            lineStart: i + 1,
            lineEnd: i + 2,
            originalText: `${lines[i]}\n${lines[i + 1]}`,
            contentChecksum: checksum,
          })
        }
      }
    }

    return records
  }

  fix(_content: string, record: ViolationRecord): Patch {
    const recordLines = record.originalText.split('\n')
    const markerLine = recordLines[0]
    const m = markerLine.match(INLINE_ANS_PLACEHOLDER_RE)
      ?? markerLine.match(INLINE_ANS_EMPTY_PLACEHOLDER_RE)
      ?? markerLine.match(ANS_MARKER_ONLY_LINE_RE)!
    const indent = m[1]
    const attribution = m[2]?.trim()
    const marker = attribution ? `**ANS:** ${attribution}` : '**ANS:**'
    return {
      lineStart: record.lineStart,
      lineEnd: record.lineEnd,
      replacement: `${indent}${marker}\n${indent}[Fill this in]`,
    }
  }

  process(content: string, parseResult: AdrFile): Patch[] {
    return this.detect(content, parseResult).map(r => this.fix(content, r))
  }

  private buildMessage(originalLine: string): string {
    return `NONSTANDARD_FILL_PLACEHOLDER: the QST heading and structure here are correct — the placeholder text just isn't the canonical one ("${originalLine}").

This was recognized as unanswered (not a real answer), so the question is still showing correctly in the Open Questions panel. But the canonical placeholder is "[Fill this in]" on its own line after "**ANS:**".

SUGGESTED:
**ANS:**
[Fill this in]

WHY: "[Fill this in]" is the one form every tool in this project (parser, panel, MCP) recognizes without a fallback path — using it exactly keeps this question visible and answerable everywhere, not just here.
SEE: docs/adr/0013-normalizer-format-conformance.md`
  }
}
