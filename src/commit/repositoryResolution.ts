/**
 * DEBRIEF-002 ("Commit ADR Changes" silently reports nothing to commit):
 * `commitAdrChanges()` used to resolve "the" git repository with
 * `api.repositories[0]` — a positional first-approximation that has no
 * defined relationship to workspace-folder order. In a real multi-repo
 * workspace (HQ + several submodules), that guess can silently resolve to
 * the wrong repo; every downstream computation is then correct *relative
 * to the wrong repo*, so the bug never throws — it just reports "nothing
 * to commit" with total confidence.
 *
 * The fix is a narrowing-specification lookup: ask the git API for the
 * repository that owns a specific URI, rather than an arbitrary member of
 * the collection. Extracted here (vscode-import-free) so the actual
 * decision — index-position vs. identity lookup — is unit-testable without
 * a vscode mock.
 */

import * as path from 'path'
import type { RootNode } from '../index/compositeIndex'

export interface GitApiLike<Repo> {
  repositories: Repo[]
  getRepository(uri: { fsPath: string }): Repo | null
}

export function resolveWorkspaceRepository<Repo>(
  api: GitApiLike<Repo>,
  workspaceFolderUri: { fsPath: string },
): Repo | null {
  return api.getRepository(workspaceFolderUri)
}

/**
 * DEBRIEF-002's doctrine, finished (Lapidary's 2026-07-31 dispatch — live
 * repro at HQ, a genuine multi-FOLDER VS Code workspace, `.code-workspace`
 * with the parent repo and a submodule as SEPARATE top-level folders):
 * `resolveWorkspaceRepository` fixed resolve-by-URI over resolve-by-position
 * for a SINGLE lookup, but `commitAdrChanges` still asked "what repo does
 * THIS root's bare directory resolve to" — root-first. That can fail even
 * when the repository is perfectly well-known to VS Code's git extension,
 * if the root's own directory doesn't get matched by `getRepository()` the
 * same way a file within it does (a real, observed gap, not a hypothetical
 * one — this is the founding incident's actual failure).
 *
 * The robust direction is the other way around: start from every
 * repository the git extension has ALREADY discovered (`api.repositories`
 * — reliably populated by the extension's own scanning, not something this
 * code has to re-derive), and for each of ITS changed files, resolve the
 * OWNING ADR root via `compositeIndex`'s own `findRoot()` — a pure
 * path-prefix lookup, independent of the git extension's internal
 * repository-root matching. "Resolve the owning folder and repo from the
 * FILE's path," not from the root's.
 */
export interface RepoWithChanges<Change> {
  state: {
    workingTreeChanges: Change[]
    indexChanges: Change[]
  }
  /**
   * The git extension's own force-refresh — optional here only because the
   * founding DEBRIEF-002 test fixtures predate it and have no reason to
   * implement it. Real `Repository` objects from `vscode.git`'s exported
   * API always have it.
   */
  status?(): Promise<void>
}

/**
 * Jérémie's 2026-08-29 founder Report ("commit adrs in this root just now
 * said 'no changes'" right after answering a question in the panel):
 * his own hypothesis was that commit-scoping had gotten coupled to the
 * "Hide ADRs Without Open Questions" tree filter — checked against the
 * actual call graph and refuted; `commitAdrChanges` never reads tree
 * display state at all, only `repo.state` (real git status) via
 * `groupChangesByOwningRoot` below.
 *
 * The real cause: `repo.state.workingTreeChanges`/`indexChanges` are the
 * git extension's OWN cached model, refreshed asynchronously off a file
 * watcher — reading them immediately after this extension's own write
 * (answering a question saves the ADR file) can race the watcher and see
 * pre-write state, exactly matching "just now." `Repository.status()` is
 * the git extension's documented synchronous-refresh call — forcing it
 * right before every read of `.state` here closes the race without
 * touching anything about how roots or scopes are resolved.
 */
export async function refreshRepositories<Repo extends RepoWithChanges<unknown>>(repos: Repo[]): Promise<void> {
  await Promise.all(repos.map(r => r.status?.()))
}

export interface ChangeWithUri {
  uri: { fsPath: string }
}

export interface DirtyRootGroup<Repo, Change> {
  node: RootNode
  repo: Repo
  changes: Change[]
}

export function groupChangesByOwningRoot<Repo extends RepoWithChanges<Change>, Change extends ChangeWithUri>(
  repos: Repo[],
  adrDirRel: string,
  findRoot: (filePath: string) => RootNode | null,
): Array<DirtyRootGroup<Repo, Change>> {
  const byRootPath = new Map<string, DirtyRootGroup<Repo, Change>>()
  for (const repo of repos) {
    const allChanges: Change[] = [...repo.state.workingTreeChanges, ...repo.state.indexChanges]
    for (const change of allChanges) {
      const node = findRoot(change.uri.fsPath)
      if (!node || !node.hasAdrDir) continue
      const adrDirAbs = path.join(node.path, adrDirRel)
      if (!change.uri.fsPath.startsWith(adrDirAbs)) continue
      let group = byRootPath.get(node.path)
      if (!group) {
        group = { node, repo, changes: [] }
        byRootPath.set(node.path, group)
      }
      group.changes.push(change)
    }
  }
  return [...byRootPath.values()]
}

/**
 * A `Change.status` value that means "this path didn't exist in the repo
 * before this edit" — INDEX_ADDED (staged as new) or UNTRACKED (not yet
 * staged), plus INTENT_TO_ADD (`git add -N`). Numeric values match the
 * git extension's own `Status` enum declaration order (stable, unchanged
 * for years — but the extension API is untyped here, so this is a
 * documented assumption, not a compile-time guarantee). Used to pick
 * commitMessage.ts's "new seed: <topic>" vocabulary over the "human
 * feedback on seed" one — an unrecognized/undefined status defaults to
 * `false` (never claims "new" without git actually confirming it).
 */
const NEW_FILE_STATUS_CODES = new Set([1 /* INDEX_ADDED */, 7 /* UNTRACKED */, 9 /* INTENT_TO_ADD */])

export function isNewGitStatus(status: number | undefined): boolean {
  return status !== undefined && NEW_FILE_STATUS_CODES.has(status)
}
