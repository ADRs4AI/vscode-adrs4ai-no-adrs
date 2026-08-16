/**
 * Structural test (vscode-import wall — adrTreeProvider.ts imports vscode
 * at module scope, same discipline as treeItemIdentity.test.ts) for the
 * paused-ADR expander bug (Gleaner's brief, 2026-08-14, docs/inbox/2026-
 * 08-14-1935-gleaner-to-fitter-paused-adr-expander-plus-hide-completed-
 * tours.md; unblocked/bundled by Facet, 2026-08-16).
 *
 * Real founder Report, verbatim: "this ADR 0009 has an expander, but no
 * questions? UI glitch." Root cause: getAdrChildren() already returned []
 * for a paused ADR, but getAdrGroupChildren() — which builds the PARENT
 * item and decides whether to render an expand arrow at all — never
 * checked isDocumentPausedStatus, only visibleQuestions.length > 0 (which
 * has zero concept of document-pause). A paused ADR with real QST:
 * headings in the raw file still got an expand arrow that opened onto
 * nothing.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const TREE_SRC = readFileSync(resolve(__dirname, '../views/adrTreeProvider.ts'), 'utf8')

describe('adrTreeProvider.ts: getAdrGroupChildren respects document-pause, same as getAdrChildren', () => {
  const fn = TREE_SRC.match(/private getAdrGroupChildren\(node: RootNode\): AdrTreeItem\[\] \{[\s\S]*?\n  \}/)![0]

  it('a paused ADR never contributes visible questions to the collapsibleState decision', () => {
    expect(fn).toContain('isDocumentPausedStatus(adr.status) ? [] : this.filterQuestions(adr.questions)')
  })

  it('collapsibleState is still driven by visibleQuestions.length, unchanged for a non-paused ADR', () => {
    expect(fn).toMatch(/collapsibleState: visibleQuestions\.length > 0\s*\? vscode\.TreeItemCollapsibleState\.Collapsed\s*: vscode\.TreeItemCollapsibleState\.None,/)
  })
})

describe('adrTreeProvider.ts: seeds — confirmed no parity gap exists for this bug class', () => {
  // Gleaner explicitly flagged this as unverified ("worth a quick check...
  // I didn't check, flagging rather than assuming") rather than asserting
  // seeds had the same bug. Checked: neither getSeedGroupChildren nor
  // getSeedChildren filters a seed's questions by status at all today
  // (closedFamilyToken is used only for the aging-threshold median, not
  // for hiding question children) — so there is no PARITY gap to fix here,
  // just a possible future design question (should a parked/superseded/
  // terminated seed hide its questions?) that's out of scope for a
  // parent/child consistency bug. Pinning the current (consistent) shape
  // so a future edit that adds pause-filtering to only one of the two
  // functions gets caught the same way this ADR bug should have been.
  it('getSeedGroupChildren does not filter by status when computing collapsibleState', () => {
    const fn = TREE_SRC.match(/private getSeedGroupChildren\(node: RootNode\): AdrTreeItem\[\] \{[\s\S]*?\n  \}/)![0]
    expect(fn).toContain('collapsibleState: visible.length > 0')
    expect(fn).not.toContain('isDocumentPausedStatus')
    expect(fn).not.toContain('closedFamilyToken(seed.status)')
  })

  it('getSeedChildren does not filter by status either — consistent with its parent, unlike the ADR bug', () => {
    const fn = TREE_SRC.match(/private getSeedChildren\(seed: SeedFile\): AdrTreeItem\[\] \{[\s\S]*?\n  \}/)![0]
    expect(fn).not.toContain('isDocumentPausedStatus')
    expect(fn).not.toContain('closedFamilyToken')
  })
})
