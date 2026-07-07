/**
 * ADR-0004 ("ADR Commit" UI feature, answered 2026-07-05): Jérémie's exact
 * spec for the pre-filled commit message — "docs: human feedback on ADRs"
 * followed by the affected ADR numbers, comma-separated. Pure/testable:
 * no vscode import, so it's usable outside the extension host.
 */

import { extractAdrNumber } from '../parser/extractor'

export function buildAdrCommitMessage(changedPaths: string[]): string {
  const numbers = [...new Set(
    changedPaths
      .map(p => extractAdrNumber(p))
      .filter(n => n > 0),
  )].sort((a, b) => a - b)

  if (numbers.length === 0) return 'docs: update ADRs'

  const list = numbers.map(n => String(n).padStart(4, '0')).join(', ')
  return `docs: human feedback on ADRs ${list}`
}
