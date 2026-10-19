/**
 * Structural tests (vscode-import wall — extension.ts imports vscode at
 * module scope) for a review catch on the welcome mat (`aeec349`, shipped
 * under launch pressure; review requested by Lapidary, 2026-10-19).
 *
 * The bug: `updateCorpusEmptyContext()` was called at activation and inside
 * `onCompositeRefreshed` (a root-set-level event: `.adrignore`/roots.json
 * changes) — but never subscribed to `compositeIndex.onChange`, the signal
 * that fires on an ORDINARY content change. Creating the very first ADR
 * (the welcome mat's own one action, and the walkthrough's first step)
 * calls `node.adrs.indexFile()` via the per-root file watcher — an
 * incremental update, not a root-set refresh — so the native tree's
 * `adrManager.corpusEmpty` context key would have silently outlived the
 * exact moment it was supposed to flip, surviving until a manual "Refresh"
 * or a window reload. The panel's own corpusEmpty flag was unaffected (it's
 * recomputed fresh inside sendQuestions(), already subscribed to
 * compositeIndex.onChange for the questions list itself) — this was a
 * TREE-only gap.
 *
 * No behavioral test is possible here: vscodeMock.ts's createFileSystemWatcher
 * stub never actually invokes its registered onDidCreate/onDidChange
 * callbacks (same shape of gap Docent found in the checkbox/change-event
 * harness the week before), so the real watcher-to-setContext pipeline
 * can't be driven end-to-end in this suite yet. This file pins the fix the
 * same way statusBarSubscription/badgeSubscription's own re-wiring is
 * pinned — by source shape, matching their established, already-correct
 * pattern exactly.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')

describe('extension.ts: corpusEmptySubscription follows the SAME dispose-and-resubscribe pattern as statusBarSubscription/badgeSubscription', () => {
  it('declared as a disposer, same shape as its two siblings', () => {
    expect(EXT_SRC).toContain('let corpusEmptySubscription: (() => void) | undefined;')
  })

  it('subscribed at activation, right after the first updateCorpusEmptyContext() call', () => {
    const activateFn = EXT_SRC.slice(EXT_SRC.indexOf('export async function activate'))
    const callIdx = activateFn.indexOf('updateCorpusEmptyContext();')
    const subIdx = activateFn.indexOf('corpusEmptySubscription = compositeIndex.onChange(updateCorpusEmptyContext);')
    expect(callIdx).toBeGreaterThan(0)
    expect(subIdx).toBeGreaterThan(callIdx)
    expect(subIdx - callIdx).toBeLessThan(200)
  })

  it('re-wired inside onCompositeRefreshed — Flint 5\'s class (2026-07-16): compositeIndex.onChange() is a one-time subscription against the node instances live at call time, never a live aggregate', () => {
    const refreshFn = EXT_SRC.slice(EXT_SRC.indexOf('function onCompositeRefreshed'), EXT_SRC.indexOf('function onCompositeRefreshed') + 2000)
    expect(refreshFn).toContain('corpusEmptySubscription?.();')
    expect(refreshFn).toContain('corpusEmptySubscription = compositeIndex.onChange(updateCorpusEmptyContext);')
  })

  it('disposed on deactivate(), same as its two siblings', () => {
    const deactivateFn = EXT_SRC.slice(EXT_SRC.indexOf('export function deactivate'), EXT_SRC.indexOf('export function deactivate') + 500)
    expect(deactivateFn).toContain('corpusEmptySubscription?.();')
    expect(deactivateFn).toContain('corpusEmptySubscription = undefined;')
  })
})
