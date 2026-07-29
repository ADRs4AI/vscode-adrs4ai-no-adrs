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
