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
  /** `state.HEAD.name` is undefined on a detached HEAD — the real vscode.git extension's own shape. */
  state?: { HEAD?: { name?: string } }
  add(paths: string[]): Promise<void>
  commit(message: string): Promise<void>
}

export interface CommitAnswerResult {
  /** False only when no repo owns `adrPath` — not an error, the caller decides whether that's worth logging. */
  committed: boolean
  /**
   * True when the commit landed on a detached HEAD — Concertmaster 5's
   * amendment to the forensics brief (2026-10-11, same day): in the
   * etude's shared tree, HEAD was ALREADY detached when this feature
   * shipped, so every commit this module makes there is a recoverable
   * "stray" (their term) rather than a commit any branch will carry
   * forward on its own — strictly better than an uncommitted file (a
   * stray survives until GC and is rescuable by SHA; an uncommitted file
   * doesn't survive the next overwrite at all), but silently leaving it
   * there risks a stray nobody remembers to fast-forward. The caller
   * decides whether/how to surface this; this module only reports it.
   */
  detachedHead: boolean
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
): Promise<CommitAnswerResult> {
  const repo = findRepoForFile(repos, adrPath)
  if (!repo) return { committed: false, detachedHead: false }
  const label = qstHandle ? `QST-${qstHandle}` : 'a question'
  await repo.add([adrPath])
  await repo.commit(`ans: ${label} (by ${authorName.trim() || 'Human'})`)
  return { committed: true, detachedHead: !repo.state?.HEAD?.name }
}
