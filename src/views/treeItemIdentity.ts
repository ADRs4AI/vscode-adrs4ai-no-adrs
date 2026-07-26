/**
 * Stable tree-item identity — extracted pure (no vscode import) so the
 * uniqueness properties reveal() depends on are unit-testable.
 *
 * Context (expand-all regression, 2026-07-23): TreeView.reveal() matches
 * elements to rendered nodes via TreeItem.id when the provider recreates
 * item objects per getChildren() call. Ids must be unique tree-wide and
 * stable across rebuilds; a collision is a rendering error, a drift breaks
 * reveal-based commands (expand-all was the silent casualty).
 */

export type TreeItemIdentitySource = {
  kind: 'root' | 'adr' | 'question' | 'open-questions-header' | 'adr-group' | 'seed-group' | 'seed' | 'tour-group' | 'tour' | 'tour-entry'
  rootNodePath?: string
  adrPath?: string
  seedPath?: string
  questionContainerPath?: string
  questionId?: string
  /** ADR-0034: the tour file's absolute path — unique per tour, mirrors adrPath/seedPath. */
  tourPath?: string
  /** ADR-0034: a tour-entry's raw ref string — combined with tourPath, since the same question can appear in more than one tour (each occurrence needs its own tree identity, distinct from the question's own 'question'-kind id elsewhere in the tree). */
  tourEntryRef?: string
}

export function stableTreeItemId(s: TreeItemIdentitySource): string {
  switch (s.kind) {
    case 'root': return `root:${s.rootNodePath ?? ''}`
    case 'open-questions-header': return `oq-header:${s.rootNodePath ?? ''}`
    case 'adr-group': return `adr-group:${s.rootNodePath ?? ''}`
    case 'seed-group': return `seed-group:${s.rootNodePath ?? ''}`
    case 'tour-group': return `tour-group:${s.rootNodePath ?? ''}`
    case 'adr': return `adr:${s.adrPath ?? ''}`
    case 'seed': return `seed:${s.seedPath ?? ''}`
    case 'tour': return `tour:${s.tourPath ?? ''}`
    case 'tour-entry': return `tour-entry:${s.tourPath ?? ''}::${s.tourEntryRef ?? ''}`
    case 'question': return `question:${s.questionContainerPath ?? ''}::${s.questionId ?? ''}`
  }
}
