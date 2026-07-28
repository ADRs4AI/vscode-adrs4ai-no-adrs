/**
 * Structural tests for rootWatcherLifecycle.ts — this module is
 * vscode-dependent glue (creates real `vscode.FileSystemWatcher`s), and
 * there's no VS Code Extension Development Host in this environment, so
 * (per established precedent for this project's other vscode-touching
 * files — openQuestionsPanel.ts, adrTreeProvider.ts) it's verified by
 * source-shape assertions rather than a live-behavior harness.
 *
 * ADR-0034 doctrine (Riddle's ruling, 2026-07-28, docs/inbox
 * `riddle-to-fitter-facet-ruling-tours-get-full-watcher-parity.md`): tours
 * get full per-root FileSystemWatcher parity with ADRs/seeds, routed
 * through the same coalesced full-rebuild `requestRefresh()` path
 * mint-from-filter already triggers — not a lighter per-tour incremental
 * update.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const SRC = readFileSync(resolve(__dirname, '../watchers/rootWatcherLifecycle.ts'), 'utf8')
const COMPOSITE_SRC = readFileSync(resolve(__dirname, '../index/compositeIndex.ts'), 'utf8')

describe('rootWatcherLifecycle: tours get full watcher parity (ADR-0034 ruling)', () => {
  it('a per-root tour watcher exists, globbing the same tours dir tourIndex.ts discovers', () => {
    expect(SRC).toContain('${adrDirRel}/tours/*.tour.json')
    expect(SRC).toContain('createFileSystemWatcher(tourPattern)')
  })

  it('tour create/change/delete all route through the same handler — a retire-flag edit and a deletion both matter', () => {
    expect(SRC).toMatch(/tourWatcher\.onDidCreate\(\(\) => handleTourEvent\('created'\)\)/)
    expect(SRC).toMatch(/tourWatcher\.onDidChange\(\(\) => handleTourEvent\('changed'\)\)/)
    expect(SRC).toMatch(/tourWatcher\.onDidDelete\(\(\) => handleTourEvent\('deleted'\)\)/)
  })

  it('a tour event triggers onTourChange — the coalesced rebuild, not an incremental per-tour update', () => {
    const handler = SRC.match(/const handleTourEvent = \(kind: 'created' \| 'changed' \| 'deleted'\): void => \{([\s\S]*?)\}/)
    expect(handler).toBeTruthy()
    expect(handler![1]).toContain('onTourChange()')
  })

  it('onTourChange is wired to the same CoalescingRefresher the settings/marker meta-watchers already use', () => {
    expect(SRC).toContain('const requestTourRefresh = () => { void refresher.request() }')
    // Passed at both the initial setup AND inside the refresher's own rebuild
    // callback — a root-set refresh must not silently stop watching tours.
    const setupCalls = SRC.match(/setupWatchersForComposite\(composite, options\.adrDirRel, onAudit, requestTourRefresh\)/g)
    expect(setupCalls?.length).toBe(2)
  })

  it('the tour watcher disposes along with the rest of its root\'s watchers (same listeners array, same handle)', () => {
    const listenersBlock = SRC.match(/const listeners: vscode\.Disposable\[\] = \[([\s\S]*?)\]/)
    expect(listenersBlock).toBeTruthy()
    expect(listenersBlock![1]).toContain('tourWatcher')
  })

  it('tour events are counted in the same per-root WatcherMetrics as ADR/seed events', () => {
    const handler = SRC.match(/const handleTourEvent = \(kind: 'created' \| 'changed' \| 'deleted'\): void => \{([\s\S]*?)\}/)
    expect(handler![1]).toContain('metrics.recordEvent(kind)')
  })
})

describe('compositeIndex.ts: the "tours change rarely" assumption is retired, not silently carried forward', () => {
  it('the RootNode.tours doc comment no longer claims tours change less often than ADR content', () => {
    expect(COMPOSITE_SRC).not.toMatch(/tours change (far less often|rarely)/)
  })

  it('the doc comment points at the ruling that retired the assumption', () => {
    expect(COMPOSITE_SRC).toContain('riddle-to-fitter-facet-ruling-tours-get-full-watcher-parity.md')
  })
})
