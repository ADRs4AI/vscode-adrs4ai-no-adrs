/**
 * Founder-commissioned protection (Concertmaster 5 forensics brief,
 * 2026-10-11, companion etude — docs/inbox/2026-10-11-1945-…): a human
 * submitted two real answers into a shared working tree; minutes later a
 * crew `git checkout origin/main -- <path>` (no uncommitted-changes
 * guard, by design — unlike switch/merge) silently clobbered both,
 * because nothing had committed them yet. drafts-archive.json's
 * keystroke-level autosave is what actually saved the human's words that
 * day; this module is the second layer the brief asked for — staking a
 * just-submitted ANS block with its own tiny, pathspec'd commit, so the
 * clobber window shrinks from "until someone remembers to commit" to the
 * time between the save and the commit.
 *
 * Pulled out of `openQuestionsPanel.ts`'s writeAnswer (rather than left
 * inline) so the repo-matching and commit logic is testable against plain
 * mock objects, with no `vscode` mock required at all — this project's
 * stated preference for real behavioral tests over structural ones,
 * applied where the logic is self-contained enough to allow it.
 */

import * as path from 'path'

export interface GitRepoLike {
  rootUri?: { fsPath: string }
  add(paths: string[]): Promise<void>
  commit(message: string): Promise<void>
}

/**
 * The repo whose working tree contains `filePath`, by longest matching
 * `rootUri` — same idiom as `CompositeIndex.findRoot` (a submodule nested
 * inside a parent repo has the longer, more specific root). Returns
 * undefined, not a throw, when nothing matches — an out-of-workspace file
 * or a git extension that hasn't reported any repositories yet are both
 * ordinary, not exceptional.
 */
export function findRepoForFile<Repo extends GitRepoLike>(repos: Repo[], filePath: string): Repo | undefined {
  let best: Repo | undefined
  let bestLen = -1
  for (const repo of repos) {
    const root = repo.rootUri?.fsPath
    if (!root) continue
    if ((filePath === root || filePath.startsWith(root + path.sep)) && root.length > bestLen) {
      best = repo
      bestLen = root.length
    }
  }
  return best
}

/**
 * Stakes `adrPath` with a commit scoped to exactly that one path — never
 * `git add -A` or a bare `commit()` with nothing pathspec'd, which would
 * sweep in whatever else happens to be staged in a shared working tree
 * (the exact kind of surprise this whole feature exists to prevent, not
 * reintroduce). Returns `false` (not an error) when no repo owns the
 * path — the caller decides whether that's worth logging. Throws on an
 * actual git failure (hooks, lock contention); the caller's contract
 * (both real callers in this codebase) is to catch and log, never let a
 * commit failure block or fail the answer it's protecting — the file
 * write already succeeded before this is ever called.
 */
export async function commitAnswerFile<Repo extends GitRepoLike>(
  repos: Repo[],
  adrPath: string,
  qstHandle: string | undefined,
  authorName: string,
): Promise<boolean> {
  const repo = findRepoForFile(repos, adrPath)
  if (!repo) return false
  const label = qstHandle ? `QST-${qstHandle}` : 'a question'
  await repo.add([adrPath])
  await repo.commit(`ans: ${label} (by ${authorName.trim() || 'Human'})`)
  return true
}
