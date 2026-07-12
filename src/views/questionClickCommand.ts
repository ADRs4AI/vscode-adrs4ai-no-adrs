/**
 * Sidebar question click routing — panel vs. file.
 *
 * Jérémie's clarification of original intent (2026-07-12): "we offer to
 * click through to file-QST, file-ANS. But the original intent was to
 * allow going to the question in the Open Question Dialog. I wanted to be
 * able to go either in the file or in the modal, and to give the choice
 * to user of which — and default to the modal (since it's our value
 * proposition in part)." Clicking a question in the sidebar always opened
 * the file; this decides which command a click should run instead,
 * honoring the `adrManager.clickOpensIn` setting (default: panel).
 *
 * Vscode-import-free by design (same reasoning as commit/repositoryResolution.ts,
 * commit/artifactClassifier.ts, creation/seedTemplate.ts): adrTreeProvider.ts
 * imports 'vscode' at module load time, which throws outside a real
 * extension host, so the DECISION (which command, which args) lives here
 * where it's directly testable, and the TreeItem wiring in
 * adrTreeProvider.ts just calls this and assigns the result.
 */

export type ClickOpensIn = 'panel' | 'file'

export interface TreeItemCommand {
  command: string
  title: string
  arguments: unknown[]
}

/**
 * `treeItem` is passed through opaquely as the sole argument to
 * `adrManager.goToQuestionInPanel` — that command's handler expects the
 * clicking `AdrTreeItem` itself (it reads `.question` off it), the same
 * shape VS Code already passes automatically for context-menu-triggered
 * commands but does NOT pass automatically for TreeItem.command-triggered
 * (click) invocations, hence needing it listed explicitly here.
 */
export function resolveQuestionClickCommand(
  clickOpensIn: ClickOpensIn,
  question: { adrPath: string; lineStart: number },
  treeItem: unknown,
): TreeItemCommand {
  if (clickOpensIn === 'file') {
    return {
      command: 'adrManager.openAdr',
      title: 'Jump to Question',
      arguments: [question.adrPath, question.lineStart],
    }
  }
  // Default (also the fallback for any unrecognized setting value —
  // Postel's Law: a stale/misconfigured setting shouldn't silently regress
  // clicking to do nothing, or throw).
  return {
    command: 'adrManager.goToQuestionInPanel',
    title: 'Answer in Open Questions Panel',
    arguments: [treeItem],
  }
}
