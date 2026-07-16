/**
 * ADR-0025 Decision 4 (Linear Multi-Root Tree Projection): the parenthetical
 * path fragment shown next to each root in the flat tree list — "root" for
 * the workspace root itself (matches the ADR's own worked example), otherwise
 * the path relative to the workspace root (e.g. "subprojects/elenchus-app").
 *
 * Vscode-import-free by design, same reasoning as commit/repositoryResolution.ts,
 * commit/artifactClassifier.ts, creation/seedTemplate.ts, views/questionClickCommand.ts:
 * adrTreeProvider.ts imports 'vscode' at module load time, which throws
 * outside a real extension host, so the path arithmetic worth pinning lives
 * here instead, directly testable.
 */

import * as path from 'path'
import type { RootNode } from '../index/compositeIndex'

export function pathFragmentFor(node: RootNode, workspaceRoot: string): string {
  if (node.path === workspaceRoot) return 'root'
  const rel = path.relative(workspaceRoot, node.path)
  return rel || 'root'
}
