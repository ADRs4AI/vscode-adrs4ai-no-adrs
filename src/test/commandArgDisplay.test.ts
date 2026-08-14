/**
 * Real behavioral tests (no vscode-import wall — commandArgDisplay.ts is
 * pure) for stringifyCommandArg, the diagnostic-only display helper used
 * by adrTreeProvider.ts's snapshotOne/captureFullTree.
 */

import { describe, it, expect } from 'vitest'
import { stringifyCommandArg } from '../views/commandArgDisplay'

describe('stringifyCommandArg', () => {
  it('passes primitive arguments through as their JSON form — these are the useful, common case (e.g. a file path)', () => {
    expect(stringifyCommandArg('docs/adr/0001-foo.md')).toBe('"docs/adr/0001-foo.md"')
    expect(stringifyCommandArg(42)).toBe('42')
    expect(stringifyCommandArg(true)).toBe('true')
  })

  it('renders null/undefined as null, matching how they appear in a real command.arguments array', () => {
    expect(stringifyCommandArg(null)).toBe('null')
    expect(stringifyCommandArg(undefined)).toBe('null')
  })

  it('a plain object degrades to its constructor name, not a stringified dump', () => {
    class AdrTreeItem { kind = 'question' }
    expect(stringifyCommandArg(new AdrTreeItem())).toBe('[AdrTreeItem]')
  })

  // Regression test (fixes real bug, Gleaner's brief 2026-08-14, docs/
  // inbox/2026-08-14-1600-gleaner-to-fitter-treeview-report-root-cause-
  // confirmed.md): live-reproduced by Jérémie via v0.7.79's own new
  // instrumentation — a tree-wide Report click threw "TypeError:
  // Converting circular structure to JSON" the moment captureFullTree's
  // walk reached ANY open question anywhere in the tree (not root-item-
  // specific, as first suspected). Cause: a question/tour-entry item's
  // default clickOpensIn:'panel' command carries `arguments: [treeItem]`
  // — the item embeds a live reference to itself. This reproduces that
  // exact shape directly, without needing the real AdrTreeItem class or a
  // vscode extension host.
  it('does not throw on a self-referential object — the exact shape that crashed JSON.stringify in production', () => {
    const treeItem: Record<string, unknown> = { kind: 'question', id: 'qst-1' }
    treeItem.command = { command: 'adrManager.goToQuestionInPanel', arguments: [treeItem] }
    expect(() => stringifyCommandArg(treeItem)).not.toThrow()
    expect(stringifyCommandArg(treeItem)).toBe('[Object]')
  })

  it('does not throw on an array containing a self-referential object, matching arguments.map() usage', () => {
    const treeItem: Record<string, unknown> = { kind: 'tour-entry' }
    treeItem.self = treeItem
    const args = [treeItem]
    expect(() => args.map(stringifyCommandArg).join(', ')).not.toThrow()
  })
})
