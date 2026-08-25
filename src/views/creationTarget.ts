/**
 * ADR-0025 Decision 6 ("ADR/seed creation target — active-editor default
 * + read-before-write visibility + per-workspace override + overlapping-
 * number prevention"): the two pure decisions extension.ts's createNewAdr
 * flow needs — which root to target, and which number to use — pulled
 * out so they get real tests instead of only structural ones.
 * Vscode/fs-free by design, same reasoning as rootCaption.ts:
 * extension.ts sits behind the vscode-import wall, this doesn't need to.
 */

export interface CreationTargetNode {
  namespace: string
}

export type CreationTargetResolution =
  | { kind: 'silent'; namespace: string }
  | { kind: 'prompt' }

/**
 * Decides whether the creation-target root can be resolved silently, and
 * if so, which one — never picks a root itself, just names the winning
 * namespace; the caller looks up the actual node. N<=1 always resolves
 * silently (composability: the single-root case stays exactly as quiet
 * as it was before Decision 6 existed). `pinnedNamespace` wins over the
 * active editor whenever it's not the literal 'active-editor' sentinel —
 * "regardless of which file is active," per the ADR's own wording. A
 * pinned namespace that matches no discovered root (stale/renamed) falls
 * through to the active-editor branch rather than resolving to nothing.
 */
export function resolveTargetRootPolicy(
  nodes: CreationTargetNode[],
  opts: { alwaysPrompt: boolean; pinnedNamespace: string; activeEditorRootNamespace: string | undefined },
): CreationTargetResolution {
  if (nodes.length === 0) return { kind: 'prompt' }
  if (nodes.length === 1) return { kind: 'silent', namespace: nodes[0].namespace }
  if (opts.alwaysPrompt) return { kind: 'prompt' }

  if (opts.pinnedNamespace !== 'active-editor') {
    const pinnedMatch = nodes.find(n => n.namespace === opts.pinnedNamespace)
    if (pinnedMatch) return { kind: 'silent', namespace: pinnedMatch.namespace }
    // Stale/renamed pinned namespace — falls through to the active-editor
    // default below rather than stopping here, same as the branch reached
    // directly when pinnedNamespace IS 'active-editor'.
  }
  if (opts.activeEditorRootNamespace !== undefined) {
    const activeMatch = nodes.find(n => n.namespace === opts.activeEditorRootNamespace)
    if (activeMatch) return { kind: 'silent', namespace: activeMatch.namespace }
  }

  return { kind: 'prompt' }
}

/**
 * Cache-then-verify-then-scan's "verify" step (Decision 6's own
 * pseudocode): given a candidate number (from the cache, or a fresh
 * max-plus-one scan) and the real filenames currently on disk, advance
 * past any collision. The candidate is a HYPOTHESIS about disk state —
 * this is what turns it into a checked one.
 */
export function computeNextNumber(candidateSeed: number, existingFilenames: string[]): number {
  let candidate = candidateSeed
  while (existingFilenames.some(f => f.startsWith(String(candidate).padStart(4, '0') + '-'))) {
    candidate++
  }
  return candidate
}
