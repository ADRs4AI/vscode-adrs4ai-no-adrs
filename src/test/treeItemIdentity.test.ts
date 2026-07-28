/**
 * Regression tests — expand-all silent failure (2026-07-23).
 *
 * Bug: adrManager.expandAll did nothing, silently. TreeView.reveal()
 * requires (a) provider.getParent and (b) element identity that survives
 * the provider recreating item objects on every getChildren() call. The
 * provider had neither: no getParent existed, items carried no id, and the
 * command's own degrade-gracefully catch{} swallowed every failure — a
 * 100%-failing button that never errored. Fixed by stable TreeItem.id
 * (this module) + AdrTreeProvider.getParent (structural check below, the
 * vscode-import wall precludes executing the provider here).
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { stableTreeItemId } from '../views/treeItemIdentity'

describe('stableTreeItemId', () => {
  it('is unique across a realistic multi-root tree (collision = VS Code rendering error)', () => {
    const ids = [
      stableTreeItemId({ kind: 'root', rootNodePath: '/ws' }),
      stableTreeItemId({ kind: 'root', rootNodePath: '/ws/sub' }),
      stableTreeItemId({ kind: 'adr-group', rootNodePath: '/ws' }),
      stableTreeItemId({ kind: 'adr-group', rootNodePath: '/ws/sub' }),
      stableTreeItemId({ kind: 'seed-group', rootNodePath: '/ws' }),
      stableTreeItemId({ kind: 'open-questions-header', rootNodePath: '/ws' }),
      stableTreeItemId({ kind: 'adr', adrPath: '/ws/docs/adr/0001-a.md' }),
      stableTreeItemId({ kind: 'adr', adrPath: '/ws/sub/docs/adr/0001-a.md' }),
      stableTreeItemId({ kind: 'seed', seedPath: '/ws/docs/adr/seed-x.md' }),
      // container-scoped question ids can collide across files; the
      // container-path prefix is what keeps the tree-wide id unique
      stableTreeItemId({ kind: 'question', questionContainerPath: '/ws/docs/adr/0001-a.md', questionId: '1::abc::0' }),
      stableTreeItemId({ kind: 'question', questionContainerPath: '/ws/sub/docs/adr/0001-a.md', questionId: '1::abc::0' }),
      stableTreeItemId({ kind: 'tour-group', rootNodePath: '/ws' }),
      stableTreeItemId({ kind: 'tour', tourPath: '/ws/docs/adr/tours/2026-07-24-a.tour.json' }),
      stableTreeItemId({ kind: 'tour', tourPath: '/ws/sub/docs/adr/tours/2026-07-24-a.tour.json' }),
      stableTreeItemId({ kind: 'tour-entry', tourPath: '/ws/docs/adr/tours/2026-07-24-a.tour.json', tourEntryRef: 'adr:0001#qst-x' }),
      stableTreeItemId({ kind: 'tour-entry', tourPath: '/ws/docs/adr/tours/2026-07-25-b.tour.json', tourEntryRef: 'adr:0001#qst-x' }),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('the same question referenced from two different tours gets two distinct tour-entry ids', () => {
    const a = stableTreeItemId({ kind: 'tour-entry', tourPath: '/ws/docs/adr/tours/tour-a.tour.json', tourEntryRef: 'adr:0001#qst-x' })
    const b = stableTreeItemId({ kind: 'tour-entry', tourPath: '/ws/docs/adr/tours/tour-b.tour.json', tourEntryRef: 'adr:0001#qst-x' })
    expect(a).not.toBe(b)
  })

  it('is stable across rebuilds — same facts, same id (reveal depends on it)', () => {
    const a = stableTreeItemId({ kind: 'adr', adrPath: '/ws/docs/adr/0002-b.md' })
    const b = stableTreeItemId({ kind: 'adr', adrPath: '/ws/docs/adr/0002-b.md' })
    expect(a).toBe(b)
  })

  it('N=1 group items (no rootNode) get bare-kind ids, distinct per kind', () => {
    const g = [
      stableTreeItemId({ kind: 'adr-group' }),
      stableTreeItemId({ kind: 'seed-group' }),
      stableTreeItemId({ kind: 'open-questions-header' }),
    ]
    expect(new Set(g).size).toBe(3)
  })
})

describe('AdrTreeProvider reveal prerequisites (structural — vscode wall)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../views/adrTreeProvider.ts'), 'utf8')

  it('provider implements getParent (reveal() hard-requires it)', () => {
    expect(src).toMatch(/getParent\(element: AdrTreeItem\)/)
  })

  it('every constructed item is assigned the stable id', () => {
    expect(src).toMatch(/this\.id = AdrTreeItem\.makeStableId\(opts\)/)
  })

  // Regression (Facet's live-tour report, 2026-07-28 inbox 0732): makeIcon
  // and the click-command wiring both shared a combined
  // `(opts.kind === 'question' || opts.kind === 'tour-entry')` check;
  // makeLabel did NOT — every tour-entry item fell through to the
  // function's final `return ''`, an unconditionally empty label ("the
  // sidebar has only question marks that are all empty"). Pinning the
  // shared-condition shape here so a future edit to one can't silently
  // drop the other again.
  it('makeLabel treats tour-entry the same as question — never the empty-label fallthrough', () => {
    expect(src).toMatch(/if \(\(opts\.kind === 'question' \|\| opts\.kind === 'tour-entry'\) && opts\.question\)/)
  })

  // Regression (Facet, 2026-07-28 inbox 1337, Jérémie's screenshot): an
  // already-answered tour-entry isn't part of buildTourQuestions' walk
  // (openQuestionsPanel.ts deliberately excludes answered entries —
  // "nothing left to walk"), so routing its click through the normal
  // tour-mode-entry path silently did nothing — the dialog just kept
  // showing whatever it last had, no error, no feedback. An answered
  // tour-entry's click now jumps straight to the file instead.
  it('an answered tour-entry jumps to the file directly, never through the tour-mode-entry path that silently no-ops', () => {
    expect(src).toMatch(/if \(opts\.kind === 'tour-entry' && opts\.question\?\.isAnswered\)/)
    expect(src).toContain("command: 'adrManager.openAdr'")
  })
})
