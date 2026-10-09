/**
 * Structural tests (vscode-import wall — adrTreeProvider.ts / extension.ts
 * import vscode at module scope, same discipline as treeItemIdentity.test.ts)
 * for "Hide completed tours" (Gleaner's brief, 2026-08-14, docs/inbox/2026-
 * 08-14-1935-gleaner-to-fitter-paused-adr-expander-plus-hide-completed-
 * tours.md; unblocked/bundled by Facet, 2026-08-16). Jérémie's own
 * correction is the spec: a workspace-level setting, not a per-tour state
 * — his walked-back first idea ("give each of these a state") is exactly
 * what these tests pin as NOT how this was built.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { isTourHidden } from '../views/adrTreeProvider'

const TREE_SRC = readFileSync(resolve(__dirname, '../views/adrTreeProvider.ts'), 'utf8')
const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')
const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')

describe('adrTreeProvider.ts: visibleTours() — one shared filter, no per-tour state', () => {
  const fn = TREE_SRC.match(/private visibleTours\(node: RootNode\)[\s\S]*?\n  \}/)![0]

  it('reads the workspace setting, default true (Jérémie\'s "on/checked" framing)', () => {
    expect(fn).toContain("get<boolean>('tours.hideCompleted', true)")
  })

  it('doneness is still computed fresh per call, never cached on the tour item (doctrine 1, unchanged)', () => {
    expect(fn).toContain('resolveTourEntries(tour, ctx)')
    expect(fn).toContain('isTourDone(resolved)')
  })

  it('getTourGroupChildren and the container\'s header count both go through visibleTours — never disagree', () => {
    const groupChildrenFn = TREE_SRC.match(/private getTourGroupChildren\(node: RootNode\): AdrTreeItem\[\] \{[\s\S]*?\n  \}/)![0]
    expect(groupChildrenFn).toContain('this.visibleTours(node)')
    const containerFn = TREE_SRC.match(/private getContainerChildren\(node: RootNode\): AdrTreeItem\[\] \{[\s\S]*?\n  \}/)![0]
    expect(containerFn).toContain('const tourCount = this.visibleTours(node).length')
  })
})

// ---------------------------------------------------------------------------
// Regression tests — the founder's 2026-10-09 Report: "I don't understand wth
// this is ... It is not showing up as a tour in the sidebar."
//
// Concertmaster minted a 3-stop trial tour with every stop `must_respond:
// false` (being modest — not blocking him). `isTourDone` returns true for a
// tour with zero required entries, deliberately, per Commodore's Iteration-5
// ruling: if open FYI stops held a tour at half-done forever, `retired` would
// become the escape hatch and doneness would stop meaning anything. That rule
// is right and untouched. The consequence nobody traced is that such a tour is
// VACUOUSLY done at birth — so three genuinely unanswered questions were hidden
// as "completed" before any human saw them. Docent widened this same filter on
// 2026-10-02 (to also hide `retired`) and walked straight past the case.
// ---------------------------------------------------------------------------
describe('Regression tests: vacuous doneness must not hide a tour', () => {
  it('does NOT hide a tour whose every stop is optional, even though it is "done"', () => {
    // The exact shape of 2026-10-09-alpha-gate.
    expect(isTourHidden({ done: true, retired: false, askedSomething: false })).toBe(false)
  })

  it('still hides a tour that genuinely asked and finished', () => {
    expect(isTourHidden({ done: true, retired: false, askedSomething: true })).toBe(true)
  })

  it('still hides a retired tour regardless of doneness', () => {
    expect(isTourHidden({ done: false, retired: true, askedSomething: true })).toBe(true)
    expect(isTourHidden({ done: true, retired: true, askedSomething: false })).toBe(true)
  })

  it('shows an ordinary in-progress tour', () => {
    expect(isTourHidden({ done: false, retired: false, askedSomething: true })).toBe(false)
  })

  // The filter must route through the pure predicate rather than re-deriving
  // the rule inline — that inline duplication is how the case got missed.
  it('visibleTours delegates to isTourHidden instead of inlining the rule', () => {
    const fn = TREE_SRC.match(/private visibleTours\(node: RootNode\)[\s\S]*?\n  \}/)![0]
    expect(fn).toContain('isTourHidden(')
    expect(fn).toContain('askedSomething')
  })
})

describe('extension.ts: hideCompletedTours / showCompletedTours commands', () => {
  it('both are registered and write the workspace setting directly — no custom context key to keep in sync', () => {
    expect(EXT_SRC).toContain("registerLoggedCommand('adrManager.hideCompletedTours', async () => {")
    expect(EXT_SRC).toContain("registerLoggedCommand('adrManager.showCompletedTours', async () => {")
    expect(EXT_SRC).toContain("update('tours.hideCompleted', true)")
    expect(EXT_SRC).toContain("update('tours.hideCompleted', false)")
  })

  it('both explicitly refresh the tree — this codebase has no onDidChangeConfiguration listener, so a bare setting write would silently not redraw', () => {
    const hideBlock = EXT_SRC.match(/registerLoggedCommand\('adrManager\.hideCompletedTours'[\s\S]*?\}\),/)![0]
    const showBlock = EXT_SRC.match(/registerLoggedCommand\('adrManager\.showCompletedTours'[\s\S]*?\}\),/)![0]
    expect(hideBlock).toContain('treeProvider?.refresh();')
    expect(showBlock).toContain('treeProvider?.refresh();')
  })
})

describe('package.json: Hide/Show Completed Tours — complementary when clauses, no per-tour property', () => {
  it('adrManager.tours.hideCompleted defaults to true, not resource-scoped (workspace-level, per Jérémie\'s own correction)', () => {
    const match = PKG.match(/"adrManager\.tours\.hideCompleted":\s*\{[\s\S]*?\n\s*\}/)
    expect(match, 'setting declaration missing').toBeTruthy()
    expect(match![0]).toContain('"default": true')
    expect(match![0]).not.toContain('"scope"')
  })

  it('the two commands appear on the tour-group context menu with mutually exclusive when clauses', () => {
    const hideEntry = PKG.match(/\{\s*"command": "adrManager\.hideCompletedTours",\s*"when": "([^"]+)"/)
    const showEntry = PKG.match(/\{\s*"command": "adrManager\.showCompletedTours",\s*"when": "([^"]+)"/)
    expect(hideEntry, 'hideCompletedTours menu entry missing').toBeTruthy()
    expect(showEntry, 'showCompletedTours menu entry missing').toBeTruthy()
    expect(hideEntry![1]).toContain('viewItem == tour-group')
    expect(hideEntry![1]).toContain('!config.adrManager.tours.hideCompleted')
    expect(showEntry![1]).toContain('viewItem == tour-group')
    expect(showEntry![1]).toContain('config.adrManager.tours.hideCompleted')
    expect(showEntry![1]).not.toContain('!config.adrManager.tours.hideCompleted')
  })

  it('icons read as a toggle pair (eye / eye-closed), matching the checked-state-reflected-in-icon mechanism (a) from the 2026-08-06 design brief', () => {
    const hideDecl = PKG.match(/\{\s*"command": "adrManager\.hideCompletedTours",\s*"title": "[^"]*",\s*"category": "[^"]*",\s*"icon": "([^"]+)"/)
    const showDecl = PKG.match(/\{\s*"command": "adrManager\.showCompletedTours",\s*"title": "[^"]*",\s*"category": "[^"]*",\s*"icon": "([^"]+)"/)
    expect(hideDecl![1]).toBe('$(eye-closed)')
    expect(showDecl![1]).toBe('$(eye)')
  })
})
