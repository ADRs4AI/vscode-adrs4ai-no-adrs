/**
 * Structural tests for the ADR-0035 Iteration 2 tour-diagnostics wiring
 * (Riddle's design, 2026-07-29 feedback seed, item C5 — "Fitter wires"):
 * the ledger writer in openQuestionsPanel.ts and the VS Code Problems
 * surface in extension.ts. Both are vscode-touching glue with no live
 * Extension Development Host here, so — same discipline as
 * treeItemIdentity.test.ts's provider checks — verified by source-shape
 * assertions rather than instantiating the real classes.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const PANEL_SRC = readFileSync(resolve(__dirname, '../webview/openQuestionsPanel.ts'), 'utf8')
const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')

describe('openQuestionsPanel.ts: tour-unresolved-refs ledger writer', () => {
  it('buildTourMeta calls the logger on every tour open/refresh', () => {
    expect(PANEL_SRC).toMatch(/this\.logTourUnresolvedIfNeeded\(found\.tour, resolved\)/)
  })

  it('gated by the SAME adrManager.logErrors kill switch harvestError() already uses — not a second setting', () => {
    const method = PANEL_SRC.match(/private logTourUnresolvedIfNeeded\([\s\S]*?\n  \}/)
    expect(method).toBeTruthy()
    expect(method![0]).toContain("get<boolean>('logErrors', true)")
  })

  it('writes error-record/2, source tour-resolver, kind tour-unresolved-refs', () => {
    const method = PANEL_SRC.match(/private logTourUnresolvedIfNeeded\([\s\S]*?\n  \}/)![0]
    expect(method).toContain("schema: 'error-record/2'")
    expect(method).toContain("source: 'tour-resolver'")
    expect(method).toContain("kind: 'tour-unresolved-refs'")
    expect(method).toContain('anchorPath: tourLedgerAnchor(tour.path)')
    expect(method).toContain('payload: { tourJson: tourDoc?.text, unresolved }')
  })

  it('dedupes per session via a signature built from tour+document MD5s and the unresolved ref set', () => {
    expect(PANEL_SRC).toContain('private tourUnresolvedSignaturesLogged = new Set<string>()')
    const method = PANEL_SRC.match(/private logTourUnresolvedIfNeeded\([\s\S]*?\n  \}/)![0]
    expect(method).toContain('this.tourUnresolvedSignaturesLogged.has(signature)')
    expect(method).toContain('this.tourUnresolvedSignaturesLogged.add(signature)')
  })

  it('is wrapped in try/catch — failure-soft, same contract as harvestError()', () => {
    const method = PANEL_SRC.match(/private logTourUnresolvedIfNeeded\([\s\S]*?\n  \}/)![0]
    expect(method).toMatch(/try \{[\s\S]*\} catch \{/)
  })
})

describe('extension.ts: TOUR_UNRESOLVED_REFS Problems diagnostic', () => {
  it('one aggregated Error diagnostic per tour, code TOUR_UNRESOLVED_REFS', () => {
    const fn = EXT_SRC.match(/function updateTourDiagnosticsForNode\([\s\S]*?\n\}/)
    expect(fn).toBeTruthy()
    expect(fn![0]).toContain("diag.code = 'TOUR_UNRESOLVED_REFS'")
    expect(fn![0]).toContain('vscode.DiagnosticSeverity.Error')
    expect(fn![0]).toContain('collection.set(uri, [diag])')
  })

  it('clears a stale diagnostic once a tour\'s refs all resolve again', () => {
    const fn = EXT_SRC.match(/function updateTourDiagnosticsForNode\([\s\S]*?\n\}/)![0]
    expect(fn).toContain('collection.delete(uri)')
  })

  it('recomputed on activation, on every composite refresh, and per-node on ADR/seed changes', () => {
    expect(EXT_SRC).toContain('updateTourDiagnostics(diagnosticCollection, compositeIndex)')
    expect(EXT_SRC).toContain('updateTourDiagnostics(collection, compositeIndex)')
    const matches = EXT_SRC.match(/updateTourDiagnosticsForNode\(collection, composite, node\)/g)
    // node.adrs.onChange, node.seeds.onChange, and updateTourDiagnostics'
    // own walk() loop (activation/full-refresh path) — three call sites.
    expect(matches?.length).toBe(3)
  })
})
