/**
 * Structural tests (vscode-import wall — terminalLinkProvider.ts imports
 * vscode at module scope, same discipline as panelLinkSupportHostWiring.
 * test.ts) for task #92 (Facet's brief, 2026-08-26: "zero
 * registerTerminalLinkProvider calls anywhere"). detectDeepLinks itself
 * (bare/wrapped/canonical detection) has its own behavioral tests in
 * linkDetection.test.ts; this file only pins that the terminal provider
 * wires that detection to the SAME OPEN_DEEP_LINK_COMMAND the editor's
 * DocumentLinkProvider already uses — no new resolution logic, matching
 * the "provider is a CALLER, not a resolver" constraint documentLink
 * Provider.ts already follows.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const SRC = readFileSync(resolve(__dirname, '../views/terminalLinkProvider.ts'), 'utf8')
const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')

describe('terminalLinkProvider.ts: detection reuses the shared, already-extended detector', () => {
  it('imports detectDeepLinks from the pure, vscode-free detection module — no parallel regex', () => {
    expect(SRC).toContain("import { detectDeepLinks } from '../deeplink/linkDetection'")
  })

  it('provideTerminalLinks scans context.line, not the whole buffer', () => {
    const fn = SRC.match(/provideTerminalLinks\(context: vscode\.TerminalLinkContext\)[\s\S]*?\n  \}/)![0]
    expect(fn).toContain('detectDeepLinks(context.line)')
  })

  it('maps startOffset/endOffset to the TerminalLink startIndex/length shape', () => {
    const fn = SRC.match(/provideTerminalLinks\(context: vscode\.TerminalLinkContext\)[\s\S]*?\n  \}/)![0]
    expect(fn).toContain('startIndex: startOffset')
    expect(fn).toContain('length: endOffset - startOffset')
  })
})

describe('terminalLinkProvider.ts: handleTerminalLink is a CALLER, not a resolver', () => {
  it('imports OPEN_DEEP_LINK_COMMAND from documentLinkProvider — same command the editor click-path uses', () => {
    expect(SRC).toContain("import { OPEN_DEEP_LINK_COMMAND } from './documentLinkProvider'")
  })

  it('handleTerminalLink dispatches through that command, carrying no resolution logic of its own', () => {
    const fn = SRC.match(/handleTerminalLink\(link: AdrTerminalLink\): void \{[\s\S]*?\n  \}/)![0]
    expect(fn).toContain('vscode.commands.executeCommand(OPEN_DEEP_LINK_COMMAND, link.ref)')
  })
})

describe('extension.ts: terminal link provider is registered at activation', () => {
  it('imports registerAdrTerminalLinkProvider', () => {
    expect(EXT_SRC).toContain("import { registerAdrTerminalLinkProvider } from './views/terminalLinkProvider'")
  })

  it('registers it alongside the existing document-link wiring', () => {
    expect(EXT_SRC).toContain('registerAdrTerminalLinkProvider()')
  })
})
