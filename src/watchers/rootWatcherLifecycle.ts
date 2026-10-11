/**
 * Per-root FileSystemWatcher lifecycle — ADR-0025 Decision 5.
 *
 * `RootNode` (compositeIndex.ts) stays vscode-free by design — pure,
 * directly testable without a vscode mock, the same boundary
 * compositeIndex.ts's own header comment already draws for tree-walking.
 * Decision 5's "each RootNode implements VS Code's Disposable interface" is
 * honored in *spirit* here via a companion `WeakMap<RootNode, Disposable>`
 * rather than literally adding a vscode-typed field to the pure data type —
 * every watcher still composes into `ExtensionContext.subscriptions` exactly
 * as VS Code's own idiom expects, and disposal still closes the watcher,
 * drains nothing else (there's no separate debounce queue at this layer —
 * see buffer-change-trigger in extension.ts for the debounced path), and
 * emits the Decision 3 audit event. `RootNode` itself never imports vscode.
 *
 * Root-set changes (`.settings/roots.json` edited, a `.adrignore` marker
 * created or removed) go through `CoalescingRefresher` so N rapid triggers
 * settle on exactly one rebuild, computed with the state as of the LAST
 * trigger, never an intermediate one.
 *
 * Known v1 simplification: a root-set refresh disposes every current root's
 * watcher and rebuilds the whole `CompositeIndex` from a fresh
 * `discoverRoots` + `indexDirectory` pass, rather than diffing old-vs-new
 * node identity and preserving unchanged roots' already-parsed state.
 * Decision 5 mandates leak-free and observable, not incremental — this is
 * correct, just not maximally efficient; worth revisiting if root-set
 * churn turns out to be frequent in practice.
 */

import * as vscode from 'vscode'
import * as path from 'path'
import { CompositeIndex, type RootNode } from '../index/compositeIndex'
import type { RootDiscoveryOptions } from '../index/rootNode'
import { isAdrBasename, isSeedBasename } from '../index/fileGuards'
import { WatcherMetrics } from '../index/watcherMetrics'
import { CoalescingRefresher } from './coalescingRefresher'

export type WatcherAuditEvent = 'watcher.create' | 'watcher.dispose'
export type WatcherAuditListener = (event: WatcherAuditEvent, node: RootNode) => void

interface RootWatcherHandle extends vscode.Disposable {
  metrics: WatcherMetrics
}

const watchersByRoot = new WeakMap<RootNode, RootWatcherHandle>()

/**
 * Spin up a FileSystemWatcher scoped to ONE root's own docs/adr/ — one per
 * root, per Decision 3's per-root shape. Non-recursive, matching the
 * existing single-root glob (`<adrDir>/*.md`).
 *
 * ADR-0034 tours get the same per-root treatment (Riddle's ruling,
 * 2026-07-28, "tours get full watcher parity" — docs/inbox
 * `riddle-to-fitter-facet-ruling-tours-get-full-watcher-parity.md`):
 * `<adrDir>/tours/*.tour.json` create/change/delete all trigger `onTourChange`
 * — the SAME coalesced full-rebuild `requestRefresh()` mint-from-filter's own
 * write already triggers, not an incremental per-tour update. A tour is a
 * whole-file unit (no partial-parse merge like an ADR's questions), and the
 * rebuild is already coalesced (CoalescingRefresher), so reusing it is
 * strictly simpler than adding a second update path for one file kind.
 */
function createRootWatcher(node: RootNode, adrDirRel: string, onAudit: WatcherAuditListener, onTourChange: () => void): RootWatcherHandle {
  const metrics = new WatcherMetrics(node.namespace)
  const pattern = new vscode.RelativePattern(node.path, `${adrDirRel}/*.md`)
  const watcher = vscode.workspace.createFileSystemWatcher(pattern)
  const tourPattern = new vscode.RelativePattern(node.path, `${adrDirRel}/tours/*.tour.json`)
  const tourWatcher = vscode.workspace.createFileSystemWatcher(tourPattern)

  const handleUpsert = (uri: vscode.Uri, kind: 'created' | 'changed'): void => {
    const base = path.basename(uri.fsPath)
    metrics.recordEvent(kind)
    if (isAdrBasename(base)) node.adrs.indexFile(uri.fsPath)
    else if (isSeedBasename(base)) node.seeds.indexFile(uri.fsPath)
  }

  const handleTourEvent = (kind: 'created' | 'changed' | 'deleted'): void => {
    metrics.recordEvent(kind)
    onTourChange()
  }

  const listeners: vscode.Disposable[] = [
    watcher.onDidCreate(uri => handleUpsert(uri, 'created')),
    watcher.onDidChange(uri => handleUpsert(uri, 'changed')),
    watcher.onDidDelete(uri => {
      metrics.recordEvent('deleted')
      node.adrs.removeFile(uri.fsPath)
      node.seeds.removeFile(uri.fsPath)
    }),
    watcher,
    tourWatcher.onDidCreate(() => handleTourEvent('created')),
    tourWatcher.onDidChange(() => handleTourEvent('changed')),
    tourWatcher.onDidDelete(() => handleTourEvent('deleted')),
    tourWatcher,
  ]

  onAudit('watcher.create', node)
  const handle: RootWatcherHandle = {
    metrics,
    dispose: () => {
      for (const d of listeners) d.dispose()
      onAudit('watcher.dispose', node)
    },
  }
  watchersByRoot.set(node, handle)
  return handle
}

function disposeRootWatcher(node: RootNode): void {
  watchersByRoot.get(node)?.dispose()
  watchersByRoot.delete(node)
}

export function getRootWatcherMetrics(node: RootNode): WatcherMetrics | undefined {
  return watchersByRoot.get(node)?.metrics
}

function setupWatchersForComposite(composite: CompositeIndex, adrDirRel: string, onAudit: WatcherAuditListener, onTourChange: () => void): void {
  for (const node of composite.walk()) createRootWatcher(node, adrDirRel, onAudit, onTourChange)
}

function disposeWatchersForComposite(composite: CompositeIndex): void {
  for (const node of composite.walk()) disposeRootWatcher(node)
}

export interface RootWatcherLifecycleController extends vscode.Disposable {
  /**
   * Current live composite — read this, don't cache the reference from setup
   * time; it's replaced on every root-set refresh.
   *
   * **This is a GETTER, not a field** (`get composite() { return composite }`
   * over the owning closure), which is the whole reason it is safe to read
   * repeatedly. `readonly` here says only "a consumer cannot reassign it" —
   * in TypeScript that is silent about whether the value behind it is live,
   * and a careful auditor read it as an inert setup-time snapshot on
   * 2026-10-11 (Gleaner's sweep after the panel's dead-index bug) precisely
   * because the declaration cannot show the difference. Stated here so the
   * interface carries what the implementation knows.
   *
   * This accessor is the pattern every other holder should imitate: hold an
   * accessor, never a value. See `src/test/compositeSubscriberRegistry.test.ts`.
   */
  readonly composite: CompositeIndex
  /** Re-run discovery and rebuild watchers for the current root set. Coalesced (Decision 5) — safe to call from multiple trigger sources without overlapping rebuilds. */
  requestRefresh(): Promise<void>
}

/**
 * Owns the live `CompositeIndex` plus every root's watcher, and the
 * meta-watchers on `.settings/roots.json` / `.adrignore` markers that
 * trigger a coalesced re-discovery when the root set itself changes.
 */
export async function startRootWatcherLifecycle(
  workspaceRoot: string,
  options: RootDiscoveryOptions,
  context: vscode.ExtensionContext,
  onAudit: WatcherAuditListener,
  onRefreshed: (composite: CompositeIndex) => void,
): Promise<RootWatcherLifecycleController> {
  let composite = await CompositeIndex.fromWorkspace(workspaceRoot, options)

  // Declared before the initial setup call so a tour-file event can reuse
  // the SAME coalesced refresh as the settings/marker meta-watchers below —
  // referencing `requestTourRefresh` inside this closure is fine even
  // though it's assigned after: the closure only runs later, once both are
  // initialized.
  const refresher = new CoalescingRefresher(async () => {
    disposeWatchersForComposite(composite)
    composite = await CompositeIndex.fromWorkspace(workspaceRoot, options)
    setupWatchersForComposite(composite, options.adrDirRel, onAudit, requestTourRefresh)
    onRefreshed(composite)
  })
  const requestTourRefresh = () => { void refresher.request() }

  setupWatchersForComposite(composite, options.adrDirRel, onAudit, requestTourRefresh)

  // Meta-watchers: root-SET changes, not file-content changes. The
  // .settings/roots.json config lives at exactly one place (the workspace
  // root's own ADR dir, per rootNode.ts's readRootsConfig); .adrignore /
  // .adr-root-ignore marker files can appear at any depth.
  const settingsPattern = new vscode.RelativePattern(workspaceRoot, `${options.adrDirRel}/.settings/roots.json`)
  const settingsWatcher = vscode.workspace.createFileSystemWatcher(settingsPattern)
  const markerPattern = new vscode.RelativePattern(workspaceRoot, '**/{.adrignore,.adr-root-ignore}')
  const markerWatcher = vscode.workspace.createFileSystemWatcher(markerPattern)

  const requestRefresh = () => { void refresher.request() }
  const metaDisposables: vscode.Disposable[] = [
    settingsWatcher.onDidCreate(requestRefresh),
    settingsWatcher.onDidChange(requestRefresh),
    settingsWatcher.onDidDelete(requestRefresh),
    settingsWatcher,
    markerWatcher.onDidCreate(requestRefresh),
    markerWatcher.onDidDelete(requestRefresh),
    markerWatcher,
  ]

  const controller: RootWatcherLifecycleController = {
    get composite() { return composite },
    requestRefresh: () => refresher.request(),
    dispose: () => {
      disposeWatchersForComposite(composite)
      for (const d of metaDisposables) d.dispose()
    },
  }
  context.subscriptions.push(controller)
  return controller
}
