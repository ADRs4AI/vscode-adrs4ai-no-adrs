/**
 * Makes ADR-0008-grammar deep links (`[text](adr:0001#qst-scope)`) clickable
 * in the editor. Diagnosed 2026-07-13 (docs/inbox/2026-07-13-1844-...): no
 * such provider existed — VS Code's generic link-following was attempting
 * to open the bare locator as a file path and failing ("Unable to open
 * '0001'"), because nothing intercepted the `adr:`/`seed:` scheme.
 *
 * Architectural constraint (Lapidary's 2026-07-13 brief, "the provider is a
 * CALLER, not a resolver"): this file contains zero resolution logic. It
 * turns clicks into calls against an injected `resolve` function. Today
 * that function is `resolveReference` from `src/mcp/reference.ts` bound to
 * a `RepositoryContextAdapter` over the live `CompositeIndex` (extension.ts
 * wiring: `resolveReference(createRepositoryContextAdapter(compositeIndex!), ref)`)
 * — the resolver-unification conversation this comment used to flag as
 * pending (Fitter's CompositeIndex overlap, routed to Cairn) has since
 * settled; multi-root resolution is live. Only the injected function at the
 * call site would change if that ever moves again — this provider and its
 * command handler never do.
 */

import * as vscode from 'vscode'
import { detectDeepLinks } from '../deeplink/linkDetection'
import { containerPath } from '../mcp/reference'
import type { ResolvedRef, RefError } from '../mcp/reference'

export type ResolveLink = (ref: string) => ResolvedRef | RefError

export const OPEN_DEEP_LINK_COMMAND = 'adrManager.openDeepLink'

export class AdrDocumentLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    const text = document.getText()
    return detectDeepLinks(text).map(({ ref, startOffset, endOffset }) => {
      const range = new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset))
      const args = encodeURIComponent(JSON.stringify([ref]))
      const link = new vscode.DocumentLink(range, vscode.Uri.parse(`command:${OPEN_DEEP_LINK_COMMAND}?${args}`))
      link.tooltip = `Open ${ref}`
      return link
    })
  }
}

function targetOf(result: Exclude<ResolvedRef, RefError>): { filePath: string; line: number } {
  switch (result.kind) {
    // ADR-0034 iter-12: a seed-borne question now lands on its own line in the
    // seed, not at line 1 of the whole file. Before the resolver could express
    // a seed question, `seed:...#qst-...` fell into the 'seed' case below and
    // silently dropped the anchor — the link "worked," it just went somewhere
    // else, which is the failure mode a broken link would at least have named.
    case 'question':
      return { filePath: containerPath(result.container), line: result.question.lineStart }
    case 'section':
      return { filePath: result.adr.path, line: result.section.lineStart }
    case 'adr':
      return { filePath: result.adr.path, line: 1 }
    case 'seed':
      return { filePath: result.seed.path, line: 1 }
  }
}

/** Registers the command a clicked link's `command:` URI invokes. Status-agnostic (ADR-0030 QST-RENDER): resolution never checks `isAnswered`. */
export function registerOpenDeepLinkCommand(resolve: ResolveLink): vscode.Disposable {
  return vscode.commands.registerCommand(OPEN_DEEP_LINK_COMMAND, async (ref: string) => {
    const result = resolve(ref)
    if (result.kind === 'error') {
      vscode.window.showErrorMessage(`Could not open "${ref}": ${result.message}`)
      return
    }
    const { filePath, line } = targetOf(result)
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath))
    const editor = await vscode.window.showTextDocument(doc)
    const pos = new vscode.Position(Math.max(0, line - 1), 0)
    editor.selection = new vscode.Selection(pos, pos)
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
  })
}
