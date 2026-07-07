/**
 * Patch Applicator — ADR-0013
 *
 * Applies a list of Patches to file content.
 *
 * Critical invariant: patches are applied in REVERSE line order (last line
 * first). This preserves the line offsets of earlier patches — once a later
 * section is rewritten, the line numbers of earlier sections are unaffected.
 *
 * This is the same principle as applying regex substitutions from end-of-string
 * backwards, and mirrors the LaTeX/BibTeX two-pass offset preservation pattern
 * discussed in ADR-0013.
 */

import * as crypto from 'crypto'
import type { Patch } from './types'

/**
 * Apply patches to content, returning the modified string.
 * Patches may be provided in any order; this function sorts them.
 * A patch with an empty replacement string deletes the target lines.
 */
export function applyPatches(content: string, patches: Patch[]): string {
  if (patches.length === 0) return content

  assertNoOverlaps(patches)

  const lines = content.split('\n')

  // Sort descending by lineStart so we apply from bottom to top
  const sorted = [...patches].sort((a, b) => b.lineStart - a.lineStart)

  for (const patch of sorted) {
    const replacementLines =
      patch.replacement === '' ? [] : patch.replacement.split('\n')
    // splice(start, deleteCount, ...items) — indices are 0-based
    lines.splice(
      patch.lineStart - 1,
      patch.lineEnd - patch.lineStart + 1,
      ...replacementLines,
    )
  }

  return lines.join('\n')
}

/**
 * Refuse to apply a patch set whose line ranges spatially overlap (Quarry 5,
 * write-adversary, CATCH 5). Previously, overlapping patches were spliced
 * through silently: sorting only by lineStart and applying fixed-width
 * splices computed against pre-shift line numbers means a later-applied
 * patch's splice can consume an earlier patch's entire replacement (gone,
 * no trace) and lines outside either patch's declared range (silently
 * deleted) — with zero errors or warnings. `dependsOn` only orders which
 * handler runs first, never whether two different handlers' violation
 * ranges collide, so this is reachable from ordinary multi-handler
 * normalization on a heavily malformed file, not an exotic adversarial input.
 *
 * "Never write blind" (the same posture ADR-0021/0023 established for the
 * write tier) means refusing here, not silently guessing which patch should
 * win — that decision belongs to a smarter layer (Coordinator, or the LLM
 * orchestrator per types.ts's own note on cases ordering can't resolve
 * statically), not to applyPatches.
 */
function assertNoOverlaps(patches: Patch[]): void {
  const ascending = [...patches].sort((a, b) => a.lineStart - b.lineStart)
  let maxEndSoFar = -Infinity
  let maxEndPatch: Patch | undefined

  for (const patch of ascending) {
    if (patch.lineStart <= maxEndSoFar) {
      throw new Error(
        `applyPatches: overlapping patches at lines [${maxEndPatch!.lineStart}-${maxEndPatch!.lineEnd}] and ` +
        `[${patch.lineStart}-${patch.lineEnd}] — refusing to apply, since splicing through the collision ` +
        `would silently corrupt content (one patch's replacement can vanish along with untouched lines outside either range).`,
      )
    }
    if (patch.lineEnd > maxEndSoFar) {
      maxEndSoFar = patch.lineEnd
      maxEndPatch = patch
    }
  }
}

/**
 * Compute a content checksum for staleness detection: real SHA1, matching
 * this codebase's one true checksum convention (AdrFile.checksum, ADR-0021).
 *
 * Fixed 2026-07-07 (Quarry 5, write-adversary, CATCH 4): this was previously
 * a 32-bit djb2 hash while ViolationRecord.contentChecksum's doc comment
 * said, verbatim, "SHA1 of the full file content" and instructed callers to
 * verify it — a caller following that contract by independently computing
 * real SHA1 would never match, on any input. Now the implementation matches
 * the documented (and enforced) contract.
 */
export function contentChecksum(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex')
}
