/**
 * D9.7: RecommendationBulletFormHandler
 *
 * Deviation: a Recommendation is written as a dash-bullet field
 * ("- Recommendation: text" or "- Recommendation (Author): text") instead
 * of the canonical standalone "**Recommendation**:" block.
 *
 * Impact (pre-fix, live specimen 2026-07-13, temp/0015-database-schema.md):
 * a model regularized toward LOCAL consistency — three dash-bullet fields
 * in a row (Status/Why asking/Need) invite a fourth (Lapidary 5's
 * diagnosis). extractor.ts's RECOMMENDATION_RE only matched the standalone
 * "**Recommendation**:" block, so the dash-bullet form fell through to raw
 * prose entirely: unstyled, uncaptured in recommendations[], and — the
 * real DMA/§1 violation — carrying NO attribution at all even when one was
 * present ("- Recommendation (Azoth): ..." lost "Azoth" completely). The
 * parser now tolerates this (RECOMMENDATION_BULLET_RE), extracts the
 * attribution correctly, and always emits NONSTANDARD_RECOMMENDATION_FORM.
 * This handler is the second layer: propose the canonical rewrite as a
 * Quick Fix, same three-layer shape (parser-recovery -> diagnostic ->
 * Quick-Fix) as D9.4/D9.6.
 *
 * DMA (ADR-0014): the message must not scold what was right. The model's
 * Recommendation content and attribution are correct and preserved — only
 * the field FORM needs to change from a dash-bullet to a standalone block.
 *
 * D-number: D9.7, the QST-block cluster (same taxonomy as D9.4/D9.5/D9.6).
 */

import type { AdrFile } from '../../parser/types'
import type { ViolationHandler, ViolationRecord, Patch } from '../types'
import { contentChecksum } from '../patch-applicator'

/**
 * Matches "- Recommendation: text" or "- Recommendation (Author): text" on
 * one line. Whole-line anchored at the field name so a real Options bullet
 * that merely mentions "recommendation" in prose is never misread — this
 * only matches the dash-bullet FIELD form specifically.
 */
const RECOMMENDATION_BULLET_LINE_RE = /^(\s*)-\s+Recommendation(?:\s*\(([^)]+)\))?:\s*(.*)$/i

export class D97RecommendationBulletFormHandler implements ViolationHandler {
  readonly id = 'd9-7-recommendation-bullet-form'
  readonly dependsOn: readonly string[] | undefined = undefined
  readonly description =
    'Recommendation written as a "- Recommendation:" dash-bullet field instead of the canonical standalone "**Recommendation**:" block — parses correctly, but renders without attribution styling\n\nSEE: docs/adr/0031-recall-first-question-detection.md'

  detect(content: string, _parseResult: AdrFile): ViolationRecord[] {
    const lines = content.split('\n')
    const checksum = contentChecksum(content)
    const records: ViolationRecord[] = []

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(RECOMMENDATION_BULLET_LINE_RE)
      if (!m) continue
      records.push({
        handlerId: this.id,
        description: this.buildMessage(m[2]?.trim()),
        lineStart: i + 1,
        lineEnd: i + 1,
        originalText: lines[i],
        contentChecksum: checksum,
      })
    }

    return records
  }

  fix(_content: string, record: ViolationRecord): Patch {
    const m = record.originalText.match(RECOMMENDATION_BULLET_LINE_RE)!
    const indent = m[1]
    const attribution = m[2]?.trim()
    const text = m[3].trim()
    // Single line, text inline after the marker — matches the "inline-
    // attribution" recommendation form extractor.ts already recognizes
    // (RECOMMENDATION_RE), not the two-line protocol form (which needs an
    // attribution-only line immediately after a BARE marker, with content
    // starting only after a blank line — putting text there would leave it
    // uncaptured, since the legacy/inline paths both require content on
    // the marker's own line to be treated as a single-paragraph block).
    const marker = attribution ? `**Recommendation** (by ${attribution}):` : '**Recommendation**:'
    return {
      lineStart: record.lineStart,
      lineEnd: record.lineEnd,
      replacement: `${indent}${marker} ${text}`,
    }
  }

  process(content: string, parseResult: AdrFile): Patch[] {
    return this.detect(content, parseResult).map(r => this.fix(content, r))
  }

  private buildMessage(attribution: string | undefined): string {
    const suggestedMarker = attribution ? `**Recommendation** (by ${attribution}):` : '**Recommendation**:'
    return `NONSTANDARD_RECOMMENDATION_FORM: a Recommendation was found written as a "- Recommendation:" dash-bullet field, not the canonical standalone block.

This was recognized correctly (including the attribution${attribution ? ` — "${attribution}"` : ''}), so nothing is lost — but the dash-bullet form doesn't render with the recommendation's attribution styling, and it's an easy shape to regularize into by accident next to Status/Why asking/Need.

SUGGESTED:
${suggestedMarker} <recommendation text>

WHY: the standalone block is what every consumer (panel, MCP, recommendations[]) expects for attribution/pick styling — a dash-bullet field is a plausible-looking but non-canonical shape.
SEE: docs/adr/0031-recall-first-question-detection.md`
  }
}
