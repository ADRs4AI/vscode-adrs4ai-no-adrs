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
 * At the time this fix landed, no behavioral test was possible:
 * vscodeMock.ts's createFileSystemWatcher stub never actually invoked its
 * registered onDidCreate/onDidChange callbacks (same shape of gap Docent
 * found in the checkbox/change-event harness the week before), so the real
 * watcher-to-setContext pipeline couldn't be driven end-to-end. This file
 * pinned the fix the same way statusBarSubscription/badgeSubscription's own
 * re-wiring is pinned — by source shape, matching their established,
 * already-correct pattern exactly. That gap is now closed (Fixture 5,
 * 2026-10-19, two independent reports in one week — Fitter's here, Docent's
 * elsewhere — made it worth fixing rather than re-flagging a third time):
 * createFileSystemWatcher now returns a real EventEmitter-backed watcher
 * whose fireCreate/fireChange/fireDelete actually invoke what was
 * registered. The structural tests below stay (they're still real signal —
 * pinning the SHAPE guards against a future refactor silently dropping the
 * dispose-and-resubscribe pattern even if the behavioral test above it
 * would also catch the symptom); the new describe block below is the
 * behavioral test that was impossible before today.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'

import { activate } from '../extension'
import {
  resetVscodeMock,
  mockWorkspace,
  getFileSystemWatchers,
  commands,
  Uri,
  type MockFileSystemWatcher,
} from './helpers/vscodeMock'

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

/**
 * The behavioral test Fitter couldn't write (2026-10-19): drives the REAL
 * watcher-to-setContext pipeline end to end, through activate()'s real
 * registration, not a structural pin. This is the welcome mat's own exact
 * scenario — a fresh workspace with zero ADRs, the stranger creates their
 * first one, the tree's context key must flip without a manual refresh.
 */
describe('corpusEmptySubscription — real behavioral coverage (needs vscodeMock\'s FileSystemWatcher to actually fire)', () => {
  let root: string

  beforeEach(() => {
    resetVscodeMock()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-empty-sub-'))
    fs.mkdirSync(path.join(root, 'docs', 'adr'), { recursive: true })
    fs.mkdirSync(path.join(root, '.git'), { recursive: true })
    fs.writeFileSync(path.join(root, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/example/empty-corpus.git\n')
    mockWorkspace.workspaceFolders = [{ uri: Uri.file(root) }]
  })

  function fakeExtensionContext() {
    return {
      subscriptions: [] as Array<{ dispose(): void }>,
      extension: { packageJSON: { version: '0.0.0-fixture-test' } },
      extensionUri: Uri.file(root),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
  }

  function lastCorpusEmptyValue(): unknown {
    const calls = commands.executeCommand.mock.calls.filter(
      args => args[0] === 'setContext' && args[1] === 'adrManager.corpusEmpty',
    )
    expect(calls.length, 'setContext was never called for adrManager.corpusEmpty').toBeGreaterThan(0)
    return calls.at(-1)![2]
  }

  it('starts true on a real empty workspace, flips to false the moment the ADR watcher reports the first file — no refresh, no root-set event', async () => {
    await activate(fakeExtensionContext())
    expect(lastCorpusEmptyValue()).toBe(true)

    // The per-root ADR watcher — same glob rootWatcherLifecycle.ts actually
    // registers (`${adrDirRel}/*.md`), found by inspecting the live
    // registry rather than assumed by position (createRootWatcher also
    // registers a tours watcher and extension.ts registers settings/marker
    // watchers — this must be the right one, not just "the first one").
    const adrWatcher = getFileSystemWatchers().find((w: MockFileSystemWatcher) => {
      const p = w.pattern as { pattern?: string }
      return p?.pattern === 'docs/adr/*.md'
    })
    expect(adrWatcher, 'no watcher registered for docs/adr/*.md').toBeDefined()

    // The welcome mat's own one action: write the stranger's first ADR for
    // real, then fire the create event — createFileSystemWatcher's old stub
    // would have accepted this call and done nothing, silently passing a
    // test that proved nothing.
    const newAdrPath = path.join(root, 'docs', 'adr', '0001-first-decision.md')
    fs.writeFileSync(
      newAdrPath,
      ['# ADR-0001: First decision', '', '- **Date**: 2026-10-19', '- **Status**: Draft', ''].join('\n'),
      'utf8',
    )
    adrWatcher!.fireCreate(Uri.file(newAdrPath))

    expect(lastCorpusEmptyValue()).toBe(false)
  })

  it('a non-ADR file change on the same watcher (e.g. a stray .md that fails the basename test) must not be what flips it — the index, not the watcher firing alone, is the actual signal', async () => {
    await activate(fakeExtensionContext())
    expect(lastCorpusEmptyValue()).toBe(true)

    const adrWatcher = getFileSystemWatchers().find((w: MockFileSystemWatcher) => {
      const p = w.pattern as { pattern?: string }
      return p?.pattern === 'docs/adr/*.md'
    })!

    // A seed, not an ADR (isAdrBasename excludes the seed- prefix by name) —
    // real file, real watcher event, but indexFile() routes it to
    // node.seeds, not node.adrs. isCorpusEmpty checks both, so this SHOULD
    // still flip corpusEmpty — the point of this test is that the watcher
    // pipeline reaches the real predicate, not a hand-picked happy path.
    const seedPath = path.join(root, 'docs', 'adr', 'seed-2026-10-19-first-seed.md')
    fs.writeFileSync(seedPath, '# SEED: First seed\n\n- **Date**: 2026-10-19\n', 'utf8')
    adrWatcher.fireCreate(Uri.file(seedPath))

    expect(lastCorpusEmptyValue()).toBe(false)
  })
})
