/**
 * Structural tests for adrManager.configureMcpServer (Lapidary's 2026-08-14
 * triple dispatch, item 2 — the vsix distribution gap: dist/mcp-server.js
 * is already bundled, verified against a real `vsce package` build, but a
 * marketplace stranger had no way to discover the path or how to point an
 * MCP client at it). vscode-touching glue, no live Extension Development
 * Host here — verified by source-shape assertions, same discipline as
 * commitRepoFirstWiring.test.ts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')
const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')

describe('extension.ts: adrManager.configureMcpServer', () => {
  it('is registered', () => {
    expect(EXT_SRC).toContain("registerLoggedCommand('adrManager.configureMcpServer'")
  })

  it('resolves the server path from the INSTALLED extension (context.extensionUri), never this source tree — same staleness-proofing as showVersion', () => {
    const fn = EXT_SRC.slice(EXT_SRC.indexOf("registerLoggedCommand('adrManager.configureMcpServer'"))
    const body = fn.slice(0, fn.indexOf('}),'))
    expect(body).toContain("vscode.Uri.joinPath(context.extensionUri, 'dist', 'mcp-server.js')")
  })

  it('copies a ready-to-paste .mcp.json snippet to the clipboard, not just a path string', () => {
    const fn = EXT_SRC.slice(EXT_SRC.indexOf("registerLoggedCommand('adrManager.configureMcpServer'"))
    const body = fn.slice(0, fn.indexOf('}),'))
    expect(body).toContain('vscode.env.clipboard.writeText(snippet)')
    expect(body).toContain('mcpServers')
  })
})

describe('package.json: adrManager.configureMcpServer is declared', () => {
  it('appears in contributes.commands', () => {
    expect(PKG).toContain('"command": "adrManager.configureMcpServer"')
  })
})
