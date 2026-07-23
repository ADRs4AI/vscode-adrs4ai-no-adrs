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
  kind: 'root' | 'adr' | 'question' | 'open-questions-header' | 'adr-group' | 'seed-group' | 'seed'
  rootNodePath?: string
  adrPath?: string
  seedPath?: string
  questionContainerPath?: string
  questionId?: string
}

export function stableTreeItemId(s: TreeItemIdentitySource): string {
  switch (s.kind) {
    case 'root': return `root:${s.rootNodePath ?? ''}`
    case 'open-questions-header': return `oq-header:${s.rootNodePath ?? ''}`
    case 'adr-group': return `adr-group:${s.rootNodePath ?? ''}`
    case 'seed-group': return `seed-group:${s.rootNodePath ?? ''}`
    case 'adr': return `adr:${s.adrPath ?? ''}`
    case 'seed': return `seed:${s.seedPath ?? ''}`
    case 'question': return `question:${s.questionContainerPath ?? ''}::${s.questionId ?? ''}`
  }
}
