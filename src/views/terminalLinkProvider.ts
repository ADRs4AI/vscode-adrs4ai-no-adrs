/**
 * Makes ADR-0008-grammar deep links clickable in the integrated terminal —
 * crew briefs/logs routinely print `adr:0001#qst-scope` or a full
 * `adr://v1/repo/...` canonical ref, and until now nothing turned those into
 * clickable terminal links (Facet's brief, 2026-08-26: "zero
 * registerTerminalLinkProvider calls anywhere").
 *
 * Same "provider is a CALLER, not a resolver" constraint as
 * documentLinkProvider.ts: this file holds zero resolution logic. It reuses
 * detectDeepLinks (already extended to match bare refs and canonical URIs,
 * not just markdown-wrapped ones — see linkDetection.ts) and dispatches
 * through the SAME OPEN_DEEP_LINK_COMMAND the editor's provider already
 * registers, so the resolve-and-jump behavior is identical in both places
 * by construction, not by parallel maintenance.
 */

import * as vscode from 'vscode'
import { detectDeepLinks } from '../deeplink/linkDetection'
import { OPEN_DEEP_LINK_COMMAND } from './documentLinkProvider'

interface AdrTerminalLink extends vscode.TerminalLink {
  ref: string
}

export class AdrTerminalLinkProvider implements vscode.TerminalLinkProvider<AdrTerminalLink> {
  provideTerminalLinks(context: vscode.TerminalLinkContext): AdrTerminalLink[] {
    return detectDeepLinks(context.line).map(({ ref, startOffset, endOffset }) => ({
      startIndex: startOffset,
      length: endOffset - startOffset,
      tooltip: `Open ${ref}`,
      ref,
    }))
  }

  handleTerminalLink(link: AdrTerminalLink): void {
    vscode.commands.executeCommand(OPEN_DEEP_LINK_COMMAND, link.ref)
  }
}

export function registerAdrTerminalLinkProvider(): vscode.Disposable {
  return vscode.window.registerTerminalLinkProvider(new AdrTerminalLinkProvider())
}
