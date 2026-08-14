/**
 * Root tree-item caption computation (Gleaner's brief, 2026-08-14, docs/
 * inbox/2026-08-14-1740-gleaner-to-fitter-four-tree-root-features-batch.md,
 * item A — Jérémie's own spec, verbatim from the preserved report): root
 * captions currently show `namespace`, which for a submodule falls through
 * to a slugified CLAUDE.md description line (the git-remote reader never
 * follows a submodule's `.git` gitlink — see rootNode.ts's gitRemoteSlugFor).
 * Wants a configurable caption:
 *   - "Git slugs": always `owner/repo`
 *   - "Git repo names": always `repo`
 *   - "Git auto": `repo` alone when all (or most) roots share one owner,
 *     `owner/repo` only for roots whose owner ISN'T the majority — his own
 *     words: "just repo name if all owners are the same, only owner to
 *     disambiguate the non-majority."
 *
 * Vscode-import-free by design, same reasoning as rootPathFragment.ts —
 * adrTreeProvider.ts sits behind the vscode-import wall, so the actual
 * decision logic worth pinning with real tests lives here instead.
 *
 * Known limitation, surfaced rather than silently patched over (out of
 * scope for this spec): 'git-auto' doesn't disambiguate two same-owner
 * repos that happen to share a repo name — Jérémie's spec only describes
 * owner-based disambiguation, not repo-name collisions within one owner.
 */

import type { GitOwnerRepo } from '../index/rootNode'

export type RootCaptionMode = 'git-slugs' | 'git-repo-names' | 'git-auto'

export interface CaptionInput {
  gitRemoteSlug?: GitOwnerRepo
  /** Fallback caption when there's no discoverable git remote at all. */
  namespace: string
}

/** The owner shared by the most roots (ties broken alphabetically, for a result independent of scan order). */
function majorityOwner(nodes: CaptionInput[]): string | undefined {
  const counts = new Map<string, number>()
  for (const n of nodes) {
    if (!n.gitRemoteSlug) continue
    counts.set(n.gitRemoteSlug.owner, (counts.get(n.gitRemoteSlug.owner) ?? 0) + 1)
  }
  let best: string | undefined
  let bestCount = -1
  for (const [owner, count] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (count > bestCount) {
      best = owner
      bestCount = count
    }
  }
  return best
}

/** One caption per input node, same order, same length. */
export function computeRootCaptions(nodes: CaptionInput[], mode: RootCaptionMode): string[] {
  if (mode === 'git-slugs') {
    return nodes.map(n => (n.gitRemoteSlug ? `${n.gitRemoteSlug.owner}/${n.gitRemoteSlug.repo}` : n.namespace))
  }
  if (mode === 'git-repo-names') {
    return nodes.map(n => n.gitRemoteSlug?.repo ?? n.namespace)
  }
  const majority = majorityOwner(nodes)
  return nodes.map(n => {
    if (!n.gitRemoteSlug) return n.namespace
    return n.gitRemoteSlug.owner === majority ? n.gitRemoteSlug.repo : `${n.gitRemoteSlug.owner}/${n.gitRemoteSlug.repo}`
  })
}
