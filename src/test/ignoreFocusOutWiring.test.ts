/**
 * Structural regression test (vscode-import wall — same discipline as
 * registerLoggedCommandWiring.test.ts) for a real data-loss bug: founder
 * Report, moreover, 2026-10-04: "I was just typing something, then there
 * was an alert that took my focus and my draft in this palette WAS
 * CLOBBERED. any fixes possible?"
 *
 * VS Code's own documented default for `showInputBox`: the box is
 * dismissed — its promise resolves to `undefined`, byte-identical to the
 * user pressing Escape — the moment focus moves away from it, for ANY
 * reason (a notification, another window, a dialog), unless
 * `ignoreFocusOut: true` is passed. None of this extension's five
 * `showInputBox` calls had it, so a typed draft in any of them (a Report
 * comment, an ADR/seed title, a commit message, a tour title) could be
 * silently discarded by an unrelated event the user had no control over.
 *
 * This is mechanically, exhaustively checkable from source — every
 * `showInputBox({` call site must carry `ignoreFocusOut: true` — so the
 * check is a completeness sweep, not a sample, the same discipline the
 * "every command is logged" test already uses for a different property.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')
const PANEL_SRC = readFileSync(resolve(__dirname, '../webview/openQuestionsPanel.ts'), 'utf8')

// Line-based, not a naive `indexOf('})')`: a prompt built from a template
// literal (mintTourFromFilter's does) can contain an interpolation whose
// closing `}` sits directly before a literal `)` in the prompt text itself
// (`${filterMode})`), which reads as a false "})" close mid-string. Every
// real call site in this codebase closes on its own line (`  });` or
// `  })`), so scan lines instead of raw character offsets.
function callBlocks(src: string): string[] {
  const lines = src.split('\n')
  const blocks: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!/showInputBox\(\{/.test(lines[i])) continue
    const block = [lines[i]]
    for (let j = i + 1; j < lines.length; j++) {
      block.push(lines[j])
      if (/^\s*\}\)[;,]?\s*$/.test(lines[j])) break
    }
    blocks.push(block.join('\n'))
  }
  return blocks
}

describe('extension.ts: every showInputBox call sets ignoreFocusOut — a typed draft must survive a focus-stealing alert', () => {
  const blocks = callBlocks(EXT_SRC)

  it('finds all five known call sites (createAdr, commitAdrChanges, reportTreeItem, mintTourFromFilter) — a count check so a NEW showInputBox added later cannot silently skip this test', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(4)
  })

  it('every single one carries ignoreFocusOut: true — none left behind', () => {
    const missing = blocks.filter(b => !b.includes('ignoreFocusOut: true'))
    expect(missing, `showInputBox call(s) missing ignoreFocusOut:\n${missing.join('\n---\n')}`).toEqual([])
  })
})

describe('openQuestionsPanel.ts: the Report comment box — the specimen VS Code surface in the real founder Report — also sets ignoreFocusOut', () => {
  const blocks = callBlocks(PANEL_SRC)

  it('has exactly its one known showInputBox call', () => {
    expect(blocks).toHaveLength(1)
  })

  it('carries ignoreFocusOut: true', () => {
    expect(blocks[0]).toContain('ignoreFocusOut: true')
  })
})
