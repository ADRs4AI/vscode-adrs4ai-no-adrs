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

import type { Patch } from './types'

/**
 * Apply patches to content, returning the modified string.
 * Patches may be provided in any order; this function sorts them.
 * A patch with an empty replacement string deletes the target lines.
 */
export function applyPatches(content: string, patches: Patch[]): string {
  if (patches.length === 0) return content

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
 * Compute a simple content checksum for staleness detection.
 * Uses djb2 hash (fast, dependency-free).
 */
export function contentChecksum(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i)
    h >>>= 0 // keep 32-bit unsigned
  }
  return h.toString(16).padStart(8, '0')
}
