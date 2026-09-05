/**
 * Structural tests (vscode-import wall — extension.ts imports vscode at
 * module scope, same discipline as commitRepoFirstWiring.test.ts) for the
 * per-root tree/root actions batch (Gleaner's brief, 2026-08-14, docs/
 * inbox/2026-08-14-1740-gleaner-to-fitter-four-tree-root-features-batch.md,
 * items B and 3): per-root Expand All, "Focus on Root", and a per-root
 * "Commit changes" that bypasses the cross-root picker.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')
const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')

describe('extension.ts: adrManager.expandRoot', () => {
  it('registered, guards on item.rootNode, reveals with the same expand:3 depth as tree-wide expandAll', () => {
    expect(EXT_SRC).toContain("registerLoggedCommand('adrManager.expandRoot', async (item) => {");
    const reg = EXT_SRC.match(/registerLoggedCommand\('adrManager\.expandRoot'[\s\S]*?\}\),/)![0]
    expect(reg).toContain('if (!item?.rootNode || !treeView) return;')
    expect(reg).toContain('treeView.reveal(item, { expand: 3, select: false, focus: false })')
  })
})

describe('extension.ts: adrManager.focusRoot', () => {
  const reg = EXT_SRC.match(/registerLoggedCommand\('adrManager\.focusRoot'[\s\S]*?\n    \}\),/)![0]

  it('attempts a tree-wide collapse before expanding this root', () => {
    expect(reg).toContain("workbench.actions.treeView.adrExplorer.collapseAll")
    const collapseIdx = reg.indexOf('collapseAll')
    const expandIdx = reg.indexOf('treeView.reveal(item')
    expect(collapseIdx).toBeGreaterThan(-1)
    expect(expandIdx).toBeGreaterThan(collapseIdx)
  })

  it('a failed/unknown collapse-all command does not block the expand step — wrapped in its own try/catch', () => {
    expect(reg).toMatch(/try \{\s*await vscode\.commands\.executeCommand\('workbench\.actions\.treeView\.adrExplorer\.collapseAll'\);\s*\} catch/)
  })
})

describe('extension.ts: commitAdrChanges accepts an optional targetRootPath', () => {
  const fn = EXT_SRC.match(/async function commitAdrChanges\([\s\S]*?\n\}/)![0]

  it('the command registration threads a resolved targetRootPath (+ scopeFilter) through, unchanged for tree-wide invocations (no item)', () => {
    // Superseded by menu-coherence (Jérémie, 2026-08-25) and the scope-
    // filter correction (2026-08-26): the handler now also resolves
    // adr/seed items' owning root AND a per-item scope filter, not just
    // item.rootNode — see commitMenuCoherenceWiring.test.ts and
    // commitScopeFilterWiring.test.ts for that full behavior. This test
    // only pins that a tree-wide invocation (no item at all) still ends
    // up passing targetRootPath/scopeFilter through unchanged (both
    // undefined in that case, via the ternary chains' own fallthrough).
    expect(EXT_SRC).toContain("registerLoggedCommand('adrManager.commitAdrs', (item) => {")
    expect(EXT_SRC).toContain('commitAdrChanges(adrDir, targetRootPath, scopeFilter);')
  })

  it('when targeted, commits that one root directly — no cross-root QuickPick, matching Jérémie\'s own ask to "circumvent the palette"', () => {
    expect(fn).toContain('if (targetRootPath) {')
    const targetedBlock = fn.match(/if \(targetRootPath\) \{[\s\S]*?\n  \}/)![0]
    expect(targetedBlock).toContain('dirtyRoots.find(dr => dr.node.path === targetRootPath)')
    expect(targetedBlock).toContain('commitOneRoot(targeted, true)')
    expect(targetedBlock).not.toContain('showQuickPick')
  })

  it('a targeted root with nothing to commit gets its own message, not the generic tree-wide one', () => {
    const targetedBlock = fn.match(/if \(targetRootPath\) \{[\s\S]*?\n  \}/)![0]
    expect(targetedBlock).toContain('No ADR changes to commit in')
  })
})

describe('package.json: per-root context menu — Expand All, Focus on Root, Commit changes', () => {
  it('declares adrManager.expandRoot and adrManager.focusRoot commands', () => {
    expect(PKG).toContain('"command": "adrManager.expandRoot"')
    expect(PKG).toContain('"command": "adrManager.focusRoot"')
    expect(PKG).toContain('"title": "Focus on Root"')
  })

  it('all three appear on the root item context menu (viewItem == root)', () => {
    const rootMenuEntries = [...PKG.matchAll(/\{\s*"command": "([^"]+)",\s*"when": "view == adrExplorer && viewItem == root"/g)].map(m => m[1])
    expect(rootMenuEntries).toContain('adrManager.excludeRoot')
    expect(rootMenuEntries).toContain('adrManager.commitAdrs')
    expect(rootMenuEntries).toContain('adrManager.expandRoot')
    expect(rootMenuEntries).toContain('adrManager.focusRoot')
  })

  it('Focus on Root sorts after Expand All (Jérémie: "Focus on Root maybe below Expand, Collapse")', () => {
    const expandEntry = PKG.match(/\{\s*"command": "adrManager\.expandRoot",\s*"when": "[^"]*",\s*"group": "([^"]+)"/)
    const focusEntry = PKG.match(/\{\s*"command": "adrManager\.focusRoot",\s*"when": "[^"]*",\s*"group": "([^"]+)"/)
    expect(expandEntry, 'expandRoot menu entry missing').toBeTruthy()
    expect(focusEntry, 'focusRoot menu entry missing').toBeTruthy()
    expect(expandEntry![1] < focusEntry![1]).toBe(true)
  })
})
