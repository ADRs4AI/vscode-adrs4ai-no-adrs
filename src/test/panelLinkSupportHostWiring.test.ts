/**
 * Structural tests (vscode-import wall — openQuestionsPanel.ts imports
 * vscode at module scope, same discipline as treeWideReportWiring.test.ts)
 * for the HOST-side half of Gleaner's escalation, 2026-08-21 (docs/inbox/
 * 2026-08-21-gleaner-to-fitter-link-support-escalation-15-days-3-
 * specimens.md). The client-side rendering/click-routing has real
 * behavioral tests in panelLinkSupport.test.ts; this file only pins that
 * the host actually wires the two new message types safely.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const PANEL_SRC = readFileSync(resolve(__dirname, '../webview/openQuestionsPanel.ts'), 'utf8')

describe('openQuestionsPanel.ts: handleMessage routes the two new link message types', () => {
  const fn = PANEL_SRC.match(/private async handleMessage\(msg: WebviewMessage\): Promise<void> \{[\s\S]*?\n  \}/)![0]

  it('openExternalUrl and openDeepLinkRef are both handled', () => {
    expect(fn).toContain("case 'openExternalUrl': await this.openExternalUrl(msg.href); break")
    expect(fn).toContain("case 'openDeepLinkRef': await vscode.commands.executeCommand(OPEN_DEEP_LINK_COMMAND, msg.ref); break")
  })

  it('openDeepLinkRef reuses the SAME command the editor\'s own DocumentLinkProvider uses — no new resolution logic', () => {
    expect(PANEL_SRC).toContain("import { OPEN_DEEP_LINK_COMMAND } from '../views/documentLinkProvider'")
  })
})

describe('openQuestionsPanel.ts: openExternalUrl — scheme-restricted, per Gleaner\'s own 08-06 security flag', () => {
  const fn = PANEL_SRC.match(/private async openExternalUrl\(href: string\): Promise<void> \{[\s\S]*?\n  \}/)![0]

  it('only http/https reach vscode.env.openExternal — everything else is silently ignored', () => {
    expect(fn).toContain("if (uri.scheme !== 'http' && uri.scheme !== 'https') return")
    expect(fn).toContain('vscode.env.openExternal(uri)')
  })

  it('a URI that fails to parse degrades to a no-op, not a throw (content-derived input)', () => {
    expect(fn).toMatch(/try \{[\s\S]*?vscode\.Uri\.parse\(href, true\)[\s\S]*?\} catch \{[\s\S]*?return[\s\S]*?\}/)
  })
})

describe('openQuestionsPanel.ts: WebviewMessage type includes both new message shapes', () => {
  it('openExternalUrl carries href, openDeepLinkRef carries ref', () => {
    expect(PANEL_SRC).toContain("| { type: 'openExternalUrl'; href: string }")
    expect(PANEL_SRC).toContain("| { type: 'openDeepLinkRef'; ref: string }")
  })
})
