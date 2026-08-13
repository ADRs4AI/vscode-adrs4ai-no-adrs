/**
 * Structural tests for the "Add Thread Turn" command's extension.ts wiring
 * (Lapidary's 2026-07-31 founder-escalation dispatch, seeds-as-issues
 * minimum lovable slice). vscode-touching glue with no live Extension
 * Development Host here — verified by source-shape assertions, same
 * discipline as tourDiagnosticsWiring.test.ts. The insertion-point
 * computation itself has its own behavioral tests in
 * seedThreadTurn.test.ts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')
const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')

describe('extension.ts: addSeedThreadTurn', () => {
  const fn = EXT_SRC.match(/async function addSeedThreadTurn\([\s\S]*?\n\}/)![0]

  it('registered and reachable from both the tree context menu and the Command Palette', () => {
    expect(EXT_SRC).toContain("vscode.commands.registerCommand('adrManager.addSeedThreadTurn', async (item) => {")
  })

  it('falls back to the active editor\'s document when invoked with no tree item', () => {
    expect(fn).toContain('item?.seed?.path ?? vscode.window.activeTextEditor?.document.uri.fsPath')
  })

  it('refuses on a non-seed file rather than scaffolding garbage into the wrong document', () => {
    expect(fn).toContain('isSeedBasename(path.basename(seedPath))')
  })

  it('uses planSeedThreadTurnInsertion for the actual insertion point/text', () => {
    expect(fn).toContain('planSeedThreadTurnInsertion(content, humanName, today)')
  })

  it('writes via WorkspaceEdit (undo-safe), not a direct fs write', () => {
    expect(fn).toContain('new vscode.WorkspaceEdit()')
    expect(fn).toContain('edit.insert(uri, new vscode.Position(plan.insertLineIndex, 0), plan.text)')
  })

  it('leaves the cursor on the fresh content line, ready to type — not just applies the edit silently', () => {
    expect(fn).toContain('const cursorLine = plan.insertLineIndex + plan.cursorLineOffset;')
    expect(fn).toContain('editor.selection = new vscode.Selection(pos, pos);')
  })

  // Regression test (fixes real bug, Gleaner's brief 2026-08-13, docs/
  // inbox/2026-08-13-gleaner-to-fitter-commit-failures-never-reach-error-
  // record.md): applyEdit rejection here only toasted, never logged —
  // structurally identical to the panel's own already-correct
  // 'workspace-edit-rejected' harvest, just never wired for this command.
  it('a rejected applyEdit is now harvested to the error ledger, not just toasted (Gleaner\'s brief, 2026-08-13)', () => {
    const rejectionBlock = fn.match(/if \(!applied\) \{[\s\S]*?\n  \}/)![0]
    expect(rejectionBlock).toContain("source: 'treeview'")
    expect(rejectionBlock).toContain("kind: 'workspace-edit-rejected'")
    expect(rejectionBlock).toContain('anchorPath: seedPath')
    expect(rejectionBlock).toContain('captureDocument(seedPath)')
  })

  it('the ledger write is failure-soft — wrapped so it can never throw into this command\'s own error path', () => {
    const rejectionBlock = fn.match(/if \(!applied\) \{[\s\S]*?\n  \}/)![0]
    expect(rejectionBlock).toMatch(/try \{[\s\S]*appendLedgerRecord[\s\S]*\} catch \{/)
  })
})

describe('package.json: Add Thread Turn command + context menu', () => {
  it('declares the command', () => {
    expect(PKG).toContain('"command": "adrManager.addSeedThreadTurn"')
    expect(PKG).toContain('"title": "Add Thread Turn"')
  })

  it('appears in the seed item context menu', () => {
    const entry = PKG.match(/\{\s*"command": "adrManager\.addSeedThreadTurn",\s*"when": "[^"]*"[^}]*\}/)
    expect(entry).toBeTruthy()
    expect(entry![0]).toContain('viewItem == seed')
  })
})
