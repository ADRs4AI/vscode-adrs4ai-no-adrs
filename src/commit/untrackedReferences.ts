/**
 * Untracked-referenced-files checklist (Lapidary's 2026-07-30
 * founder-escalation dispatch, addition 2 — tonight's dictation): "before
 * committing, scan untracked files; for each, search the about-to-commit
 * files for mentions (screenshots referenced in seeds/ADRs are the
 * motivating case)." A screenshot dropped into `docs/screenshots/` and
 * linked from a seed/ADR is untracked and outside the ADR-dir scan the
 * commit command otherwise limits itself to — without this, it silently
 * never gets committed alongside the content that references it.
 *
 * Pure and vscode-free: given the untracked candidates and the text of
 * what's about to be committed, decides which untracked files are
 * mentioned. The extension-host call site owns reading file content from
 * disk and the human-facing checkbox prompt.
 */

/** An untracked file is "referenced" when its own basename appears as a substring anywhere in the content about to be committed — the same loose match a human skimming for "did I mention this filename anywhere" would use. Matches on basename, not full path, since a seed/ADR typically links a screenshot by its filename (relative or bare), not a path identical to git's own. */
export function findReferencedUntrackedFiles(untrackedPaths: string[], committedContents: string[]): string[] {
  const haystack = committedContents.join('\n')
  return untrackedPaths.filter(p => {
    const base = p.replace(/\\/g, '/').split('/').pop() ?? ''
    return base.length > 0 && haystack.includes(base)
  })
}

export type UntrackedReferencesMode = 'ask' | 'auto-commit' | 'auto-ignore'
