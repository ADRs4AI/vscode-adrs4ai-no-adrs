/**
 * `vscode.window.registerUriHandler` for ADR-0008's `adr://` deep links —
 * the half of the grammar that was only ever clickable FROM INSIDE VS Code
 * (documentLinkProvider.ts, terminalLinkProvider.ts). Pigeonhole (the
 * estate's human inbox, Plenum's brief 2026-09-14, charter via Lapidary)
 * needs to open one FROM OUTSIDE — its CLI can't call an extension command
 * directly, but every OS already knows how to launch a `vscode://` URL.
 *
 * Same "provider is a CALLER, not a resolver" discipline as the other two
 * providers: this file resolves nothing itself (the injected `resolve`
 * function does that, same `ResolveLink` shape they use), and for its
 * actual leaf behavior — opening a file, or showing the loud "couldn't
 * resolve" error — it delegates wholesale to the SAME OPEN_DEEP_LINK_COMMAND
 * the editor and terminal already use, rather than re-deriving that UX a
 * third time.
 */

import * as vscode from 'vscode'
import { decideRoute, parseUriHandlerTarget, type DeepLinkOpenIn } from '../deeplink/uriTarget'
import { OPEN_DEEP_LINK_COMMAND, type ResolveLink } from './documentLinkProvider'
import { AdrTreeItem } from './adrTreeProvider'
import type { ResolvedRef, RefError } from '../mcp/reference'
import { appendLedgerRecord } from '../drafts/errorLog'

/**
 * A resolved artifact's own tree node — 'section' has no tree node of its
 * own (no section-level tree items exist), so it reveals its owning ADR
 * instead, same conflation `documentLinkProvider.ts`'s `targetOf()` already
 * makes for the file/line it jumps to.
 */
function treeItemFor(resolved: Exclude<ResolvedRef, RefError>): AdrTreeItem | undefined {
  switch (resolved.kind) {
    case 'question':
      return new AdrTreeItem({ kind: 'question', question: resolved.question })
    case 'adr':
    case 'section':
      return new AdrTreeItem({ kind: 'adr', adr: resolved.adr, collapsibleState: vscode.TreeItemCollapsibleState.Collapsed })
    case 'seed':
      return new AdrTreeItem({ kind: 'seed', seed: resolved.seed })
  }
}

export interface DeepLinkUriHandlerDeps {
  resolve: ResolveLink
  treeView: vscode.TreeView<AdrTreeItem>
  /** Open the Open Questions panel, navigated to this question — extension.ts's own closure over the live compositeIndex/OpenQuestionsPanel, so this file never needs either directly. */
  openQuestionDialog: (questionId: string) => void
  /** Ledger anchor for a resolution failure (there's no resolved file to anchor to) — same rootDir+adrDir+placeholder fallback anchorPathFromCommandArg already uses, computed fresh per call since compositeIndex can be swapped mid-session. */
  defaultAnchorPath: () => string | undefined
}

class AdrUriHandler implements vscode.UriHandler {
  constructor(private deps: DeepLinkUriHandlerDeps) {}

  async handleUri(uri: vscode.Uri): Promise<void> {
    const target = parseUriHandlerTarget({ path: uri.path, query: uri.query })
    if (!target) {
      vscode.window.showErrorMessage(`ADR Manager: this link named no target to open (${uri.toString()}).`)
      return
    }

    const resolved = this.deps.resolve(target)
    const openIn = vscode.workspace.getConfiguration('adrManager').get<DeepLinkOpenIn>('deepLink.openIn', 'question-dialog')
    const route = decideRoute(resolved, openIn)

    if (resolved.kind === 'error') {
      const anchorPath = this.deps.defaultAnchorPath()
      if (anchorPath) {
        appendLedgerRecord({
          schema: 'error-record/2',
          ts: new Date().toISOString(),
          extensionVersion: vscode.extensions.getExtension('jlumbroso.adrs4ai')?.packageJSON?.version,
          source: 'uri-handler',
          kind: 'uri-target-unresolved',
          message: `vscode:// open link named "${target}" — ${resolved.message}`,
          anchorPath,
          payload: { target, error: resolved.error },
        })
      }
    }

    if (route === 'question-dialog' && resolved.kind === 'question') {
      this.deps.openQuestionDialog(resolved.question.id)
      return
    }

    if (route === 'tree' && resolved.kind !== 'error') {
      const item = treeItemFor(resolved)
      if (item) {
        try {
          await this.deps.treeView.reveal(item, { select: true, focus: true, expand: true })
          return
        } catch {
          // Filtered out of the tree by an active hide/settle toggle, or
          // the known reveal() API wrinkle already documented elsewhere in
          // adrTreeProvider.ts — degrade to the same loud open-and-jump
          // path 'markdown' uses below, never a silent no-op.
          vscode.window.setStatusBarMessage('ADR Manager: target not visible in the current tree filter — opened the file instead.', 4000)
        }
      }
    }

    // route === 'markdown', a resolved artifact with no tree node, or a
    // failed/degraded tree reveal — OPEN_DEEP_LINK_COMMAND already owns
    // exactly this open-and-jump / loud-error behavior; no parallel logic.
    await vscode.commands.executeCommand(OPEN_DEEP_LINK_COMMAND, target)
  }
}

export function registerDeepLinkUriHandler(deps: DeepLinkUriHandlerDeps): vscode.Disposable {
  return vscode.window.registerUriHandler(new AdrUriHandler(deps))
}
