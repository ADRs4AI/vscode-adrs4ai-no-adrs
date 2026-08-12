/**
 * Structural tests for ADR-0036 ("Unresolved: Returning the Ball",
 * ratified 2026-07-29) — the write path (writeAnswer's targetStatus),
 * panel-hide settings (shouldHideFromPanel), and the tree's per-status
 * icon/description. All vscode-touching glue with no live Extension
 * Development Host here — verified by source-shape assertions, same
 * discipline as tourDiagnosticsWiring.test.ts / treeItemIdentity.test.ts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const PANEL_SRC = readFileSync(resolve(__dirname, '../webview/openQuestionsPanel.ts'), 'utf8')
const TREE_SRC = readFileSync(resolve(__dirname, '../views/adrTreeProvider.ts'), 'utf8')
const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')

describe('openQuestionsPanel.ts: writeAnswer writes Status: unresolved on request', () => {
  it('defaults to answered, but writes the requested targetStatus', () => {
    expect(PANEL_SRC).toContain("const targetStatus = msg.targetStatus === 'unresolved' ? 'unresolved' : 'answered'")
    expect(PANEL_SRC).toContain('edit.replace(uri, lineRange(doc, statusLineIdx), `- Status: ${targetStatus}`)')
  })

  it('the WebviewMessage answer type carries targetStatus', () => {
    expect(PANEL_SRC).toMatch(/targetStatus\?: 'answered' \| 'unresolved'/)
  })
})

describe('openQuestionsPanel.ts: shouldHideFromPanel (hide-allowlist doctrine)', () => {
  const method = PANEL_SRC.match(/private shouldHideFromPanel\([\s\S]*?\n  \}/)![0]

  it('answered questions are already excluded upstream — this only ever gates unresolved/deferred', () => {
    expect(method).toContain("status === 'unresolved'")
    expect(method).toContain("status === 'deferred'")
  })

  it('both default to false — an unrecognized/typo status is never hidden, recall-first', () => {
    expect(method).toContain("get<boolean>('unresolved.hideFromPanel', false)")
    expect(method).toContain("get<boolean>('deferred.hideFromPanel', false)")
    expect(method).toMatch(/return false\s*\}?\s*$/)
  })

  it('wired into buildRows alongside the existing !isAnswered filter', () => {
    expect(PANEL_SRC).toContain('.filter(({ q }) => !q.isAnswered && !q.isRetired && !q.dismissedReason && !this.shouldHideFromPanel(q))')
  })

  it('package.json declares both settings, default false', () => {
    for (const key of ['adrManager.unresolved.hideFromPanel', 'adrManager.deferred.hideFromPanel']) {
      const match = PKG.match(new RegExp(`"${key.replace(/\./g, '\\.')}":\\s*\\{[^}]*\\}`))
      expect(match, `${key} missing from package.json`).toBeTruthy()
      expect(match![0]).toContain('"default": false')
    }
  })
})

describe('adrTreeProvider.ts: unresolved/deferred get their own icon + description tag', () => {
  it('unresolved: debug-pause icon, [unresolved] description tag', () => {
    expect(TREE_SRC).toContain("status === 'unresolved'")
    expect(TREE_SRC).toContain("new vscode.ThemeIcon('debug-pause'")
    expect(TREE_SRC).toContain("return '[unresolved]'")
  })

  it('deferred: history icon, [deferred] description tag', () => {
    expect(TREE_SRC).toContain("status === 'deferred'")
    expect(TREE_SRC).toContain("new vscode.ThemeIcon('history'")
    expect(TREE_SRC).toContain("return '[deferred]'")
  })

  it('the description tag applies to both plain questions and tour entries', () => {
    expect(TREE_SRC).toContain("if (opts.kind === 'question' && opts.question) {\n      return statusDescriptionTag(opts.question) ?? ''")
    expect(TREE_SRC).toMatch(/statusDescriptionTag\(opts\.question\)\]\.filter\(Boolean\)/)
  })
})
