/**
 * Structural tests for the tree-wide "most excellent report" feature
 * (Jérémie's own words, 2026-08-06, docs/adr/seed-2026-08-06-feedback-on-
 * treeview-context-menus.md; spec'd by Gleaner, docs/inbox/2026-08-06-
 * 0408-gleaner-to-fitter-tree-wide-report-spec.md). vscode-touching glue —
 * both extension.ts and adrTreeProvider.ts import `vscode` directly at
 * module scope ("the vscode-import wall precludes executing the provider
 * here" — treeItemIdentity.test.ts's own doctrine, applied identically
 * here), so this is source-shape verification, same discipline as
 * menuSymmetryWiring.test.ts / commitRepoFirstWiring.test.ts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')
const TREE_SRC = readFileSync(resolve(__dirname, '../views/adrTreeProvider.ts'), 'utf8')
const ERRORLOG_SRC = readFileSync(resolve(__dirname, '../drafts/errorLog.ts'), 'utf8')
const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')

describe('errorLog.ts: LedgerRecord.source gains \'treeview\'', () => {
  it('the union includes treeview alongside the existing sources', () => {
    const line = ERRORLOG_SRC.match(/source: '[^\n]*'/)![0]
    expect(line).toContain("'panel'")
    expect(line).toContain("'treeview'")
  })
})

describe('adrTreeProvider.ts: captureFullTree walks the WHOLE tree via the provider\'s own getChildren', () => {
  const fn = TREE_SRC.match(/export function captureFullTree\([\s\S]*?\n\}/)![0]

  it('starts from the root (undefined element) and recurses into every child returned', () => {
    expect(fn).toContain('function walk(parent: AdrTreeItem | undefined): void')
    expect(fn).toContain('provider.getChildren(parent)')
    expect(fn).toMatch(/walk\(undefined\)/)
    expect(fn).toContain('walk(child)')
  })

  it('each node carries a parentId link (flat array, not nested — per the spec\'s own JSONL-diffability rationale)', () => {
    expect(fn).toContain('snapshotOne(child, parent?.id)')
  })

  it('snapshotOne captures label/description/tooltip/resourceUri/commandTarget, never the full document body', () => {
    const snap = TREE_SRC.match(/function snapshotOne\([\s\S]*?\n\}/)![0]
    expect(snap).toContain('item.label')
    expect(snap).toContain('item.description')
    expect(snap).toContain('item.tooltip')
    expect(snap).toContain('item.resourceUri?.fsPath')
    expect(snap).toContain('item.command')
    expect(snap).not.toContain('captureDocument')
  })
})

describe('extension.ts: resolveReportFilePath (Gleaner\'s spec §3)', () => {
  const fn = EXT_SRC.match(/function resolveReportFilePath\([\s\S]*?\n\}/)![0]

  it('question and tour-entry resolve via question.adrPath — correct for BOTH ADR- and seed-owned questions', () => {
    expect(fn).toMatch(/item\.kind === 'question' \|\| item\.kind === 'tour-entry'/)
    expect(fn).toContain('item.question?.adrPath')
  })

  it('adr/seed/tour resolve via their own resourceUri, not a re-derived path', () => {
    expect(fn).toMatch(/item\.kind === 'adr' \|\| item\.kind === 'seed' \|\| item\.kind === 'tour'/)
    expect(fn).toContain('item.resourceUri?.fsPath')
  })

  it('group headers and root fall through to undefined — not file-backed', () => {
    expect(fn).toMatch(/return undefined;\s*\}$/)
  })
})

describe('extension.ts: resolveReportAnchorPath (Gleaner\'s spec §5)', () => {
  const fn = EXT_SRC.match(/function resolveReportAnchorPath\([\s\S]*?\n\}/)![0]

  it('a file-backed item anchors on its own file path, no synthesis', () => {
    expect(fn).toMatch(/if \(filePath\) return filePath;/)
  })

  it('falls back to the single active root when item.rootNode is absent (the N=1 case Gleaner flagged as unresolved in the spec)', () => {
    expect(fn).toContain('item.rootNode?.path ?? compositeIndex?.root.path')
  })

  it('reads the ACTUAL configured adrDirectory, not a hardcoded "docs/adr" — deviates from the spec\'s literal example on purpose', () => {
    expect(fn).toContain("get<string>('adrDirectory', 'docs/adr')")
    expect(fn).toContain('.tree-report-anchor')
  })
})

describe('extension.ts: resolveReportOpenQuestions (Gleaner\'s spec §4 — no re-parse)', () => {
  it('reads the already-parsed questions off the composite index, not a fresh parse', () => {
    const fn = EXT_SRC.match(/function resolveReportOpenQuestions\([\s\S]*?\n\}/)![0]
    expect(fn).toContain('compositeIndex?.findRoot(filePath)')
    expect(fn).toContain('adr.questions')
    expect(fn).toContain('.questions')
  })
})

describe('extension.ts: reportTreeItem — same UX discipline as the panel Report button', () => {
  const fn = EXT_SRC.match(/async function reportTreeItem\([\s\S]*?\n\}/)![0]

  it('gates on logging.observations BEFORE prompting, same as the panel\'s reportObservation', () => {
    const gateIdx = fn.indexOf("get<boolean>('logging.observations', true)")
    const promptIdx = fn.indexOf('showInputBox')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(promptIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeLessThan(promptIdx)
  })

  it('Escape/cancel (note === undefined) records nothing; an empty-but-submitted note still logs', () => {
    expect(fn).toContain('if (note === undefined) return')
    expect(fn).toContain("note || 'manual tree-item report'")
  })

  it('writes source: treeview, kind: observation — same record class as the panel\'s observations', () => {
    expect(fn).toContain("source: 'treeview'")
    expect(fn).toContain("kind: 'observation'")
  })

  it('the payload carries the whole tree hierarchy, not just the clicked item', () => {
    expect(fn).toContain('treeHierarchy: treeProvider ? captureFullTree(treeProvider) : []')
  })

  it('is failure-soft: wrapped so a capture failure never breaks the tree view', () => {
    expect(fn).toMatch(/catch \{[\s\S]*?reporting a problem must never itself become one/)
  })
})

describe('extension.ts: adrManager.reportTreeItem command registration', () => {
  it('the command is registered and guards against an undefined item', () => {
    expect(EXT_SRC).toContain("vscode.commands.registerCommand('adrManager.reportTreeItem'")
    const reg = EXT_SRC.match(/registerCommand\('adrManager\.reportTreeItem'[\s\S]*?\}\),/)![0]
    expect(reg).toContain('if (item)')
  })
})

describe('package.json: reportTreeItem menu entry — every kind, last position, separator via group boundary', () => {
  it('the command is declared with the plain "Report" label (matching the panel button\'s own tone)', () => {
    const decl = PKG.match(/\{\s*"command": "adrManager\.reportTreeItem",\s*"title": "([^"]*)"/)
    expect(decl, 'command declaration missing').toBeTruthy()
    expect(decl![1]).toBe('Report')
  })

  it('the view/item/context entry has NO viewItem restriction — applies to every kind, per the spec', () => {
    const menuEntry = PKG.match(/\{\s*"command": "adrManager\.reportTreeItem",\s*"when":[^}]*\}/)
    expect(menuEntry, 'menu entry missing').toBeTruthy()
    expect(menuEntry![0]).toContain('"when": "view == adrExplorer"')
    expect(menuEntry![0]).not.toContain('viewItem')
  })

  it('sorts into its own last group ("9_..." — after every other group, VS Code auto-inserts the separator)', () => {
    const menuEntry = PKG.match(/\{\s*"command": "adrManager\.reportTreeItem",\s*"when":[^}]*\}/)![0]
    expect(menuEntry).toMatch(/"group": "9_/)
  })
})
