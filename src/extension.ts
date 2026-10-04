/**
 * ADRs for AI — VS Code Extension Entry Point
 *
 * Forma 1: Parser + ActivityBar sidebar tree view + status bar + file watcher.
 *
 * Activation: triggered when the workspace contains docs/adr/*.md files.
 *
 * Eager init (reversed 2026-07-15, ADR-0025's `fromWorkspace` activation
 * pass, `8f765f8`): root discovery now runs — and every discovered root's
 * indices are fully populated — before `activate()` returns, not lazily on
 * first sidebar reveal as ADR-0004 originally specified. Flint 5's review
 * named this explicitly as an undiscussed reversal; re-ratified here rather
 * than silently left stale. Reasoning: per-root watchers (Decision 5) need
 * to exist before diagnostics, the panel, or the status bar can be correct
 * at all, so deferring `fromWorkspace` to first-reveal would only move the
 * same cost to a different, less predictable moment — not eliminate it.
 * `discoverRoots()` already skips `node_modules`/`.git`/build output during
 * the scan, bounding the common case; if eager startup cost becomes a real
 * complaint in practice, revisit then rather than pre-optimizing for it now.
 */

import * as vscode from 'vscode'
import { coerceTourSlug } from './webview/commandArgs'
import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import { AdrIndex } from './index/adrIndex'
import { SeedIndex, findReferencingAdrs } from './index/seedIndex'
import { CompositeIndex } from './index/compositeIndex'
import { isAdrBasename, isSeedBasename, isDirectChildOf } from './index/fileGuards'
import { startRootWatcherLifecycle, type RootWatcherLifecycleController } from './watchers/rootWatcherLifecycle'
import { AdrTreeProvider, captureFullTree, type AdrTreeItem } from './views/adrTreeProvider'
import { appendLedgerRecord, captureDocument, describeLedgerLocation } from './drafts/errorLog'
import { aggregateOpenQuestionCount, QUESTION_SOURCES, type SourceInclusion } from './index/questionSource'
import { addBlockEntry, removeBlockEntry, relativeRootPath } from './index/rootsConfigWriter'
import { buildLocalAdrRef, buildLocalSeedRef, buildXProjectAdrRef, buildCanonicalRef, seedSlugFromPath } from './deeplink/protocol'
import { buildTourJson, serializeTourJson, tourFilename, tourFilePath } from './index/tourWriter'
import type { RootNode } from './index/compositeIndex'
import type { Question } from './parser/types'
import { AdrDocumentLinkProvider, registerOpenDeepLinkCommand } from './views/documentLinkProvider'
import { registerAdrTerminalLinkProvider } from './views/terminalLinkProvider'
import { registerDeepLinkUriHandler } from './views/deepLinkUriHandler'
import { createRepositoryContextAdapter } from './index/repositoryContextAdapter'
import { resolveTourEntries, unresolvedTourRefs } from './index/tourIndex'
import { assessTour } from './index/tourReadiness'
import { resolveReference } from './mcp/reference'
import { OpenQuestionsPanel } from './webview/openQuestionsPanel'
import { ADR_STATUSES } from './parser/statusInfo'
import { computeRootCaptions, type RootCaptionMode } from './views/rootCaption'
import { resolveTargetRootPolicy, computeNextNumber } from './views/creationTarget'
import { Coordinator } from './normalizer/coordinator'
import { D1OpenQuestionsSectionHandler } from './normalizer/handlers/d1-open-questions-section'
import { D2BoldStatusFieldHandler } from './normalizer/handlers/d2-bold-status-field'
import { D4CollapsedAnsBlockHandler } from './normalizer/handlers/d4-collapsed-ans-block'
import { D6NonStandardPreambleFieldHandler } from './normalizer/handlers/d6-non-standard-preamble-field'
import { D62StatusWithAnnotationHandler } from './normalizer/handlers/d6-2-status-with-annotation'
import { D65MissingBoldPreambleFieldHandler } from './normalizer/handlers/d6-5-missing-bold-preamble-field'
import { D96NoncanonicalNavCodeHeadingHandler } from './normalizer/handlers/d9-6-noncanonical-nav-code-heading'
import { D95MissingRecommendationHandler } from './normalizer/handlers/d9-5-missing-recommendation'
import { D94NonstandardFillPlaceholderHandler } from './normalizer/handlers/d9-4-nonstandard-fill-placeholder'
import { D97RecommendationBulletFormHandler } from './normalizer/handlers/d9-7-recommendation-bullet-form'
import { D98TrailingAliasHandleHandler } from './normalizer/handlers/d9-8-trailing-alias-handle'
import { buildAdrCommitMessage, type ChangedFile } from './commit/commitMessage'
import { isNewGitStatus, groupChangesByOwningRoot, refreshRepositories } from './commit/repositoryResolution'
import { findReferencedUntrackedFiles, type UntrackedReferencesMode } from './commit/untrackedReferences'
import { summarizeCommittedArtifacts } from './commit/artifactClassifier'
import { generateSeedTemplate } from './creation/seedTemplate'
import { planSeedThreadTurnInsertion } from './creation/seedThreadTurn'

// ---------------------------------------------------------------------------
// Normalizer — runs passively on every index update (ADR-0013 Stage 2)
// ---------------------------------------------------------------------------

const normalizerCoordinator = new Coordinator([
  new D1OpenQuestionsSectionHandler(),
  new D2BoldStatusFieldHandler(),
  new D4CollapsedAnsBlockHandler(),
  new D6NonStandardPreambleFieldHandler(),
  new D62StatusWithAnnotationHandler(),
  new D65MissingBoldPreambleFieldHandler(),
  new D96NoncanonicalNavCodeHeadingHandler(),
  new D95MissingRecommendationHandler(),
  new D94NonstandardFillPlaceholderHandler(),
  new D97RecommendationBulletFormHandler(),
  // Suggest-only (bulkApply = false): shown as a diagnostic, fixed per
  // question via its own Quick Fix — never part of "Normalize to adr format".
  new D98TrailingAliasHandleHandler(),
])

// ---------------------------------------------------------------------------
// Extension state
// ---------------------------------------------------------------------------

/**
 * ADR-0025 activation rewiring ("GO on fromWorkspace", 2026-07-15): `index`/
 * `seedIndex` now alias the TOP-LEVEL root's own AdrIndex/SeedIndex —
 * `compositeIndex.root.adrs`/`.seeds` — not independent objects. Kept
 * (rather than retired outright) because several functions below are still
 * deliberately scoped to the top root only: `determineNextNumber`/
 * `createNewAdr` (Decision 6's per-root creation-target logic is its own
 * follow-up pass, not this one) and `copyDeepLink` (Decision 7, same).
 * That's an honest, documented limitation, not a silent regression — it's
 * the exact same scope those two already had before this pass. Everything
 * that genuinely needs every root (diagnostics, the status bar count,
 * `adrManager.refresh`, the buffer-change trigger, `changeAdrStatus`'s
 * reindex-on-write, the panel, deep-link resolution) reads through
 * `compositeIndex` instead.
 */
let index: AdrIndex | undefined;
let seedIndex: SeedIndex | undefined;
let compositeIndex: CompositeIndex | undefined;
let watcherLifecycle: RootWatcherLifecycleController | undefined;
let diagnosticsSubscription: vscode.Disposable | undefined;
/**
 * Flint 5's review of 8f765f8 (2026-07-16): `CompositeIndex.onChange()`
 * walks the tree AT CALL TIME and subscribes to each node's own AdrIndex/
 * SeedIndex individually — it is not a live aggregate. Without re-
 * subscribing this after a root-set refresh (a `.settings/roots.json` edit
 * or `.adrignore` marker change, which replaces `compositeIndex` with a
 * fresh instance holding fresh per-node indices), the old subscription is
 * left listening to now-orphaned objects nothing feeds anymore — the
 * status bar's count silently freezes for the rest of the session. Same
 * dispose-and-resubscribe pattern as `diagnosticsSubscription`.
 */
let statusBarSubscription: (() => void) | undefined;
let diagnosticCollection: vscode.DiagnosticCollection | undefined;
let treeProvider: AdrTreeProvider | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let treeView: vscode.TreeView<AdrTreeItem> | undefined;
/**
 * ADR-0029: same dispose-and-resubscribe requirement as
 * statusBarSubscription (Flint 5's finding, 2026-07-16) — compositeIndex.onChange()
 * is a one-time subscription against the node instances live at call time.
 */
let badgeSubscription: (() => void) | undefined;
/**
 * Module-scoped so failure-soft catch blocks outside activate() (e.g.
 * reportTreeItem) can log diagnosably instead of swallowing silently.
 * Gleaner's brief 2026-08-14: a root-item Report vanished with zero trace
 * — no toast, no ledger write, no error — because the catch around it had
 * nothing to log to from outside activate()'s own local scope.
 */
let outputChannel: vscode.OutputChannel | undefined;

/**
 * Best-effort anchor for a command failure with no dedicated catch block of
 * its own (see registerLoggedCommand below): most `view/item/context`
 * commands' first argument is an `AdrTreeItem`, which names a real file or
 * root one of these ways; falling further back to the active editor, then
 * to any known root at all, means a command invoked from the Command
 * Palette (no tree item) still lands SOMEWHERE rather than being silently
 * unloggable for lack of an owning ledger.
 *
 * Fixture 5's catch (2026-09-06, `docs/inbox/2026-09-06-0522-fixture-to-
 * gleaner-priority-a-command-smoke-deepening-plus-real-catches.md`): a
 * command like `openAdr(filePath: string, ...)` passes its real, correct
 * file path as `args[0]` directly — a raw STRING, not an item object — but
 * this only ever tried reading `.adr`/`.seed`/etc. off it (undefined on a
 * string, no crash, just silently ignored), falling all the way through to
 * a bare ROOT DIRECTORY. `errorLogPathFor` assumes a FILE path and takes
 * its `dirname()` — given a directory instead, that strips one real
 * segment too many, landing `.working/errors.jsonl` one level ABOVE the
 * workspace entirely (confirmed live: a stray file on Fixture's own host
 * filesystem outside any test's temp workspace). Two fixes: (1) a plain
 * string arg — real callers only ever pass one when it's already the exact
 * anchor — is used as-is, never routed through the item-shape guesses at
 * all; (2) the directory-shaped fallbacks (`rootNode.path`/`compositeIndex.
 * root.path`) are joined with the configured ADR directory and a
 * placeholder filename BEFORE being returned, so `errorLogPathFor`'s
 * existing dirname()-based contract lands them in the same `docs/adr/.
 * working/` every other anchor already uses — not a new, second location
 * nothing else scans.
 */
function anchorPathFromCommandArg(arg: unknown): string | undefined {
  if (typeof arg === 'string') return arg;
  const item = arg as
    | { adr?: { path: string }; seed?: { path: string }; question?: { adrPath: string }; rootNode?: { path: string } }
    | undefined;
  const fileShaped = item?.adr?.path ?? item?.seed?.path ?? item?.question?.adrPath
    ?? vscode.window.activeTextEditor?.document.uri.fsPath;
  if (fileShaped) return fileShaped;
  const rootDir = item?.rootNode?.path ?? compositeIndex?.root.path;
  if (!rootDir) return undefined;
  const adrDirRel = vscode.workspace.getConfiguration('adrManager').get<string>('adrDirectory', 'docs/adr');
  return path.join(rootDir, adrDirRel, '.anchor-placeholder');
}

/**
 * Wraps `vscode.commands.registerCommand` so ANY error a handler throws is
 * captured to errors.jsonl before VS Code's own generic "Error running
 * command X: ..." popup surfaces it — Jérémie's own founder Report,
 * 2026-09-02/05 (copyDeepLink's crash sat unlogged for three days,
 * rediscovered only because he happened to hit it again and reported it a
 * second time): "make sure that EVERY error experienced is LOGGED, and
 * doesn't require me RELOGGING it." One wrapper at every registration
 * site, generalizing the commit-failure fix's pattern (2026-08-13,
 * `source: 'commit'`) instead of hand-adding a try/catch per incident —
 * `source: 'command'` covers every command with one tag; `payload.
 * commandId` keeps each ledger row specific to which one failed.
 * Re-throws after logging: this changes NOTHING about what the user sees
 * (VS Code's own popup still fires), only whether it also reached the
 * ledger.
 */
function registerLoggedCommand(commandId: string, handler: (...args: any[]) => any): vscode.Disposable { // eslint-disable-line @typescript-eslint/no-explicit-any
  return vscode.commands.registerCommand(commandId, async (...args: any[]) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      return await handler(...args);
    } catch (err) {
      const anchorPath = anchorPathFromCommandArg(args[0]);
      if (anchorPath) {
        const logged = appendLedgerRecord({
          schema: 'error-record/2',
          ts: new Date().toISOString(),
          extensionVersion: vscode.extensions.getExtension('jlumbroso.adrs4ai')?.packageJSON?.version,
          source: 'command',
          kind: 'command-execution-failed',
          message: `Command "${commandId}" threw — ${err}`,
          anchorPath,
          payload: {
            commandId,
            rawError: err && typeof err === 'object' ? { ...err } : String(err),
          },
        });
        // Jérémie's own feedback, 2026-09-05 (replying to this same fix):
        // "I hope that it reports a little message in the status bar like
        // when we report things because I find that very helpful as
        // feedback to the user." Same pattern reportTreeItem already uses
        // (setStatusBarMessage, auto-dismissing) — VS Code's own error
        // popup still fires unchanged; this just confirms the OTHER half
        // (it reached the ledger) happened too, rather than leaving that
        // invisible the way it was before this fix existed.
        if (logged) vscode.window.setStatusBarMessage('ADR Manager: Error logged to errors.jsonl.', 4000);
      }
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('adrManager');
  const adrDir = config.get<string>('adrDirectory', 'docs/adr');

  // Version check (2026-07-06): the installed extension had gone stale
  // relative to source for months with no way to notice short of reading
  // dist/'s file mtime. `context.extension.packageJSON.version` reads the
  // version from the *installed* manifest, not a hardcoded string, so it's
  // always the true running version, not what's merely in the repo.
  const runningVersion: string = context.extension.packageJSON.version ?? 'unknown';
  const oc = vscode.window.createOutputChannel('ADR Manager');
  outputChannel = oc;
  context.subscriptions.push(oc);
  oc.appendLine(`ADR Manager v${runningVersion} activated at ${new Date().toISOString()}`);

  // ── Root discovery + per-root watchers (ADR-0025, "GO on fromWorkspace") ──
  // No workspace open: fall back to an empty single wrapped root rather than
  // scanning nothing meaningful — matches the prior behavior's graceful
  // degradation (empty indices, no watchers, extension stays inert).
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    watcherLifecycle = await startRootWatcherLifecycle(
      workspaceRoot,
      { adrDirRel: adrDir },
      context,
      (event, node) => oc.appendLine(`[${event}] ${node.namespace} (${node.path})`),
      refreshed => { compositeIndex = refreshed; onCompositeRefreshed(diagnosticCollection); },
    );
    compositeIndex = watcherLifecycle.composite;
  } else {
    compositeIndex = CompositeIndex.wrapSingle('', new AdrIndex(), new SeedIndex());
  }
  index = compositeIndex.root.adrs;
  seedIndex = compositeIndex.root.seeds;
  treeProvider = new AdrTreeProvider(compositeIndex);

  // ── Deep-link click-through (2026-07-13) ────────────────────────────────
  // The provider is a CALLER, not a resolver (Lapidary's brief): it holds no
  // resolution logic of its own. Swapping compositeIndex for a future
  // multi-root-aware backend, once the resolver-unification conversation
  // settles, only changes this one closure — never the provider or command.
  const resolveLink = (ref: string) => resolveReference(createRepositoryContextAdapter(compositeIndex!), ref);

  // ── Diagnostics collection ────────────────────────────────────────────────
  diagnosticCollection = vscode.languages.createDiagnosticCollection('adr-manager');
  context.subscriptions.push(diagnosticCollection);

  // Per-root subscriptions (targeted, event-driven — same per-file logic as
  // before, applied once per discovered root instead of once for a single
  // top-level index) plus one explicit initial pass, since fromWorkspace's
  // own indexDirectory() calls happened before anything was subscribed to
  // hear them.
  diagnosticsSubscription = subscribeDiagnostics(compositeIndex, diagnosticCollection);
  for (const adr of compositeIndex.allAdrs()) updateDiagnostics(diagnosticCollection, adr);
  for (const node of compositeIndex.walk()) updateAllSeedDiagnostics(diagnosticCollection, node.seeds, node.adrs);
  updateTourDiagnostics(diagnosticCollection, compositeIndex);

  // ── Status bar item ──────────────────────────────────────────────────────
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'adrManager.open';
  statusBarItem.tooltip = `Open ADR Explorer (ADR Manager v${runningVersion})`;
  statusBarItem.text = 'ADRs: …';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
  updateStatusBarText();
  statusBarSubscription = compositeIndex.onChange(updateStatusBarText);

  // ── Tree view ────────────────────────────────────────────────────────────
  treeView = vscode.window.createTreeView('adrExplorer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // ── ADR-0029: Open-Questions sidebar badge ──────────────────────────────
  // Native ViewBadge only (QST-C, ratified) — no custom color/animation.
  // Shares the same debounced reindex signal the tree view/status bar
  // already use (Cairn's RFC Flag 1) — not a fresh subscription.
  updateBadge();
  badgeSubscription = compositeIndex.onChange(updateBadge);

  // ── Commands ─────────────────────────────────────────────────────────────
  context.subscriptions.push(
    registerLoggedCommand('adrManager.open', () => {
      vscode.commands.executeCommand('adrExplorer.focus');
    }),

    registerLoggedCommand('adrManager.refresh', () => {
      // Prefer a full rediscovery (picks up new/removed roots too) when a
      // live watcher lifecycle exists; fall back to a content-only
      // re-parse of already-known roots otherwise (no-workspace edge case).
      if (watcherLifecycle) void watcherLifecycle.requestRefresh();
      else if (compositeIndex) reindexWorkspace(compositeIndex, adrDir);
    }),

    // "The collapse-all trap" (Jérémie, verbatim, 2026-07-22): "when you
    // make the mistake of collapsing everything, you have to manually
    // re-expand it." No native expandAll counterpart to showCollapseAll
    // exists in the VS Code API — implemented via recursive reveal() with
    // expand:3 (the API's own cap) over every top-level item, which covers
    // this tree's actual depth (root -> ADR/seed -> question). A reveal()
    // failure on any one item degrades gracefully — expand what's
    // reachable, never surface an error for what's cosmetic.
    registerLoggedCommand('adrManager.expandAll', async () => {
      if (!treeProvider || !treeView) return;
      const topLevel = treeProvider.getChildren();
      for (const item of topLevel) {
        try {
          await treeView.reveal(item, { expand: 3, select: false, focus: false });
        } catch {
          // Known VS Code API wrinkle (Lapidary's spec, 2026-07-23 `0320`) — no-op.
        }
      }
    }),

    // Per-root Expand All (Gleaner's brief 2026-08-14, item B): the
    // tree-wide expandAll above has to iterate every top-level item because
    // there are several independent starting points; a single root is just
    // one reveal() call from that same item, same expand:3 depth cap.
    registerLoggedCommand('adrManager.expandRoot', async (item) => {
      if (!item?.rootNode || !treeView) return;
      try {
        await treeView.reveal(item, { expand: 3, select: false, focus: false });
      } catch {
        // Known VS Code API wrinkle (Lapidary's spec, 2026-07-23 `0320`) — no-op.
      }
    }),

    // "Focus on Root" (Gleaner's brief 2026-08-14, item B — Jérémie's own
    // idea, "streamline that functionality"): collapse everything, then
    // expand just this root, in one click. VS Code's public TreeView API has
    // no per-item collapse (reveal()'s `expand` option only ever expands —
    // a documented, long-standing API gap), so there is no way to build a
    // true "collapse THIS root only" command without either lying about
    // what it does or quietly collapsing every other root too. This is the
    // achievable version of the same end state: collapse-all is the one
    // native primitive that exists, then re-expand the one root Jérémie
    // actually wants visible. workbench.actions.treeView.<viewId>.collapseAll
    // is VS Code's own auto-registered command for any view built with
    // `showCollapseAll: true` (adrExplorer is) — unverified live (no
    // Extension Development Host in this environment), so failure here
    // degrades to "just expand this root" rather than doing nothing.
    registerLoggedCommand('adrManager.focusRoot', async (item) => {
      if (!item?.rootNode || !treeView) return;
      try {
        await vscode.commands.executeCommand('workbench.actions.treeView.adrExplorer.collapseAll');
      } catch {
        // Unverified command id (see comment above) — proceed to expand regardless.
      }
      try {
        await treeView.reveal(item, { expand: 3, select: false, focus: false });
      } catch {
        // Known VS Code API wrinkle (Lapidary's spec, 2026-07-23 `0320`) — no-op.
      }
    }),

    registerLoggedCommand('adrManager.showVersion', () => {
      // 2026-07-30 (live founder-blocked report: report button absent after
      // reload+setting in a companion workspace): this project has a
      // documented recurring failure mode — code verified fixed in source,
      // still broken live, because the INSTALLED extension predates the
      // fix. context.extension.packageJSON.version (below, via
      // runningVersion) is read from the actually-running manifest, not
      // this source tree, so it's the fast, reliable way to rule staleness
      // in or out without needing a remote debugging session. Report a
      // couple of currently-suspect resolved settings alongside it so a
      // "toggled it, still nothing" report can self-diagnose scope/staleness.
      const cfg = vscode.workspace.getConfiguration('adrManager');
      const reportButtonEnabled = cfg.get<boolean>('reportButton.enabled', false);
      vscode.window.showInformationMessage(
        `ADR Manager v${runningVersion} — adrManager.reportButton.enabled resolves to ${reportButtonEnabled}`,
      );
      oc.show();
    }),

    // Founder-flagged distribution gap (Lapidary's 2026-08-14 triple
    // dispatch, item 2): `dist/mcp-server.js` IS bundled in the .vsix
    // (verified directly against a real `vsce package` build, not just
    // `vsce ls` — which doesn't trigger the prepublish build and can read
    // as "missing" against a stale dist/) and has been since `.vscodeignore`
    // Was fixed 2026-07-28 (`df1c87b`), predating this dispatch. The actual
    // remaining gap: a marketplace stranger has no way to know the file is
    // there or how to point an MCP client at it — physically present isn't
    // the same as usable. This command closes that half: shows the real
    // installed path (`context.extensionUri`, not this source tree — same
    // staleness-proofing as `showVersion`, above) and copies a ready-to-
    // paste `.mcp.json` entry for the current workspace.
    registerLoggedCommand('adrManager.configureMcpServer', async () => {
      const serverPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'mcp-server.js').fsPath;
      const snippet = JSON.stringify(
        {
          mcpServers: {
            'adrs-for-ai': {
              command: 'node',
              args: [serverPath, ...(workspaceRoot ? [workspaceRoot] : [])],
            },
          },
        },
        null,
        2,
      );
      await vscode.env.clipboard.writeText(snippet);
      const choice = await vscode.window.showInformationMessage(
        `MCP server path: ${serverPath}\nA .mcp.json entry for this workspace was copied to your clipboard — paste it into .mcp.json at your workspace root.`,
        'Show details',
      );
      if (choice === 'Show details') {
        oc.appendLine(`[MCP] Server binary: ${serverPath}`);
        oc.appendLine(`[MCP] Suggested .mcp.json entry:\n${snippet}`);
        oc.show();
      }
    }),

    // Fixture 5's smoke-test harness catch (2026-09-06, priority-A deepening
    // pass): same bug class as commitAdrs' 2026-09-05 catch, found here by
    // extending the audit to every non-async handler in this file rather
    // than trusting the earlier "this was the one gap" claim (which was
    // itself wrong — see QST-DETECTION-LEDGER.md). A plain arrow calling an
    // async function without await/return turns any internal error into an
    // unhandled promise rejection, invisible to registerLoggedCommand.
    registerLoggedCommand('adrManager.openAdr', async (filePath: string, lineNumber?: number) => {
      await openAdrFile(filePath, lineNumber);
    }),

    // Decision 6's explicit override, plus Jérémie's own extension of it
    // (2026-08-25 live report): right-click a root gets the full ADR/Seed
    // picker scoped to that root (no resolution/prompt — the click already
    // said which project); right-click the ADR or Seed category header
    // skips the kind-picker too, since that's already implied by which
    // header was clicked. Command-palette / nav-button invocations pass no
    // item, so both fall back to undefined and resolveCreationTargetRoot()
    // + the ordinary kind-picker run exactly as before.
    // Fixture 5's smoke-test harness catch (2026-09-06, priority-A deepening
    // pass — same bug class as commitAdrs' 2026-09-05 catch): unawaited
    // async call, error invisible to registerLoggedCommand. Caught by a
    // real "did the file actually land on disk" assertion, not a "doesn't
    // throw" one — createNewAdr's real fs.promises I/O genuinely yields to
    // the event loop, so the missing await was directly observable (0
    // files immediately after the handler "resolved").
    registerLoggedCommand('adrManager.createAdr', async (item) => {
      const targetRoot = item?.kind === 'root' ? item.rootNode
        : item?.kind === 'adr-group' || item?.kind === 'seed-group' ? (item.rootNode ?? compositeIndex?.root)
        : undefined;
      const forceKind = item?.kind === 'adr-group' ? 'adr' : item?.kind === 'seed-group' ? 'seed' : undefined;
      await createNewAdr(adrDir, { targetRoot, forceKind });
    }),

    // Menu coherence (Jérémie, 2026-08-25 live ask): "Commit" now appears
    // on every tree node it can meaningfully apply to — root, category
    // headers, and individual ADR/seed items. An 'adr'/'seed' leaf item
    // never carries `rootNode` (only root/category-header items do), so
    // its owning root is resolved the same way copyDeepLink and friends
    // already resolve container context: via compositeIndex.findRoot()
    // on the item's own file path.
    //
    // Scope FILTER (Jérémie, live, 2026-08-26 — correcting the original
    // "every invocation commits the whole root" call above): an
    // individual ADR/seed item scopes to exactly that one file; a
    // category header scopes to every changed file of that TYPE in the
    // root (isAdrBasename/isSeedBasename — deliberately excludes the
    // OTHER category's files, tours, and `.working/` bookkeeping); root
    // itself stays whole-root, since "the root" IS the everything-scope.
    // Fixture 5's smoke-test harness catch (2026-09-05, first run): this
    // handler used to be a plain (non-async) arrow that called
    // commitAdrChanges(...) without awaiting or returning it — a real,
    // reproducible bug that meant any error thrown inside commitAdrChanges
    // became an UNHANDLED promise rejection, completely bypassing
    // registerLoggedCommand's catch-log-rethrow contract (the very "EVERY
    // error must reach the ledger" guarantee this file shipped THIS SAME
    // DAY, v0.7.109). Every other action-invoking handler in this file
    // already awaits its async call; this one was the one gap. See
    // src/test/commandSmoke.test.ts's "registerLoggedCommand contract"
    // describe block for the regression test (asserted a throwing
    // dependency still reaches errors.jsonl — failed against the
    // unawaited version, passes now).
    // The toolbar button's own command — deliberately ignores its arguments.
    // Founder Report (companion etude, 2026-09-13): "When I click the commit
    // button at the top of the treeview, it acts in accordance to where my
    // cursor is instead of being a global one." Cause, confirmed in VS Code's
    // own release notes (v1.72, docs/research/vscode-docs/release-notes/
    // v1_72.md): commands contributed to `view/title` receive the FOCUSED TREE
    // NODE as their first argument — so the toolbar button was invoking
    // `adrManager.commitAdrs` with whatever item happened to be focused, and
    // that handler (correctly, for context menus) scoped the commit to that
    // item's file/category/root. A focused ADR with no changes → "no changes"
    // (the 08-30 and 09-01 "commit doesn't seem to work" Reports fit this).
    // The context-menu entries keep `commitAdrs`, which reads its item; the
    // toolbar gets this one, which cannot.
    registerLoggedCommand('adrManager.commitAllAdrs', async () => {
      await commitAdrChanges(adrDir);
    }),

    registerLoggedCommand('adrManager.commitAdrs', async (item) => {
      const targetRootPath = item?.rootNode?.path
        ?? (item?.kind === 'adr' && item.adr ? compositeIndex?.findRoot(item.adr.path)?.path : undefined)
        ?? (item?.kind === 'seed' && item.seed ? compositeIndex?.findRoot(item.seed.path)?.path : undefined);
      const scopeFilter = item?.kind === 'adr' && item.adr ? (p: string) => p === item.adr!.path
        : item?.kind === 'seed' && item.seed ? (p: string) => p === item.seed!.path
        : item?.kind === 'adr-group' ? (p: string) => isAdrBasename(path.basename(p))
        : item?.kind === 'seed-group' ? (p: string) => isSeedBasename(path.basename(p))
        : undefined;
      await commitAdrChanges(adrDir, targetRootPath, scopeFilter);
    }),

    registerLoggedCommand('adrManager.copyDeepLink', (item) => {
      copyDeepLink(item);
    }),

    registerLoggedCommand('adrManager.copyPath', (item) => {
      copyItemPath(item);
    }),

    registerLoggedCommand('adrManager.copyRelativePath', (item) => {
      copyItemRelativePath(item);
    }),

    registerLoggedCommand('adrManager.reportTreeItem', async (item) => {
      if (item) await reportTreeItem(item);
    }),

    registerLoggedCommand('adrManager.excludeRoot', async (item) => {
      if (item?.rootNode) await excludeRoot(item.rootNode);
    }),

    registerLoggedCommand('adrManager.mintTourFromFilter', async () => {
      if (treeProvider && compositeIndex) await mintTourFromFilter(treeProvider, compositeIndex);
    }),

    // "Hide completed tours" (Gleaner's brief, 2026-08-14 — unblocked by
    // Facet, 2026-08-16): mechanism (a) from my own 2026-08-06 design
    // brief — two toggle commands whose complementary `when` clauses read
    // the setting directly (`config.adrManager.tours.hideCompleted`), no
    // custom context key to keep in sync. Jérémie's own correction is the
    // spec: a workspace setting, not a per-tour state.
    //
    // treeProvider.refresh() explicitly follows the config write: this
    // codebase has no `onDidChangeConfiguration` listener anywhere (every
    // other config-dependent render — category order, seed thresholds —
    // only takes effect on the NEXT unrelated tree refresh), which is fine
    // for a Settings-UI edit but would make a dedicated TOGGLE COMMAND read
    // as silently broken: click it, nothing visibly happens until some
    // other event happens to redraw the tree.
    // ADR-0034 Iteration 16's lifecycle verb, built under docket ADR-0002
    // Iteration 8's Phase-0 dispensation ("tour retire is urgent... Docent
    // builds it in your repo now; it rides the move").
    //
    // The gesture that did not exist until today. The schema has carried
    // `"retired": false` since v1 and the tree already renders `[retired]`
    // with an archive icon — the field was honored, only the gesture was
    // missing, so retiring a tour meant hand-editing JSON and nobody did it.
    // Consequence, measured in caring-form: a tour minted 2026-07-29 still
    // sits in the tree, mechanically clean, 4 of 8 stops awaiting, 65+ days
    // old and visually identical to one minted this morning. Jérémie:
    // "those QuestionTours took weeks to get working, to the point that
    // nobody remembered what any of the tours was for."
    //
    // No confirmation modal, deliberately: this must be cheap enough to do on
    // a whim, which is the whole point of the feature. Reversibility comes
    // from an Undo on the toast instead — a gate here would re-create the
    // friction that let stale tours accumulate.
    registerLoggedCommand('adrManager.retireTour', async (item?: import('./views/adrTreeProvider').AdrTreeItem) => {
      const tourPath = item?.tour?.path
      if (!tourPath) {
        vscode.window.showErrorMessage('ADR Manager: Retire Tour works on a tour in the sidebar — right-click one.')
        return
      }
      const setRetired = async (value: boolean): Promise<boolean> => {
        try {
          const raw = await fs.promises.readFile(tourPath, 'utf-8')
          const parsed = JSON.parse(raw) as Record<string, unknown>
          if (parsed.retired === value) return false
          parsed.retired = value
          // Re-stringify the WHOLE parsed object rather than rebuilding from a
          // typed shape: a real tour may carry fields this code does not model
          // (theme, minted_commit, author.session), and a lifecycle flip must
          // never be the thing that silently drops them.
          await fs.promises.writeFile(tourPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')
          return true
        } catch (err) {
          vscode.window.showErrorMessage(`ADR Manager: could not ${value ? 'retire' : 'restore'} the tour — ${err instanceof Error ? err.message : String(err)}`)
          return false
        }
      }

      const title = item?.tour?.title ?? path.basename(tourPath)
      if (!(await setRetired(true))) {
        vscode.window.showInformationMessage(`"${title}" is already retired.`)
        return
      }
      treeProvider?.refresh()
      if (watcherLifecycle) void watcherLifecycle.requestRefresh()
      const undo = await vscode.window.showInformationMessage(`Retired "${title}" — it no longer asks for your attention.`, 'Undo')
      if (undo === 'Undo' && await setRetired(false)) {
        treeProvider?.refresh()
        if (watcherLifecycle) void watcherLifecycle.requestRefresh()
      }
    }),
    registerLoggedCommand('adrManager.hideCompletedTours', async () => {
      await vscode.workspace.getConfiguration('adrManager').update('tours.hideCompleted', true);
      treeProvider?.refresh();
    }),
    registerLoggedCommand('adrManager.showCompletedTours', async () => {
      await vscode.workspace.getConfiguration('adrManager').update('tours.hideCompleted', false);
      treeProvider?.refresh();
    }),

    // Category-header filter checkboxes for ADRs/Seeds (Facet's go-ahead,
    // 2026-08-16, unblocking my own 2026-08-06 design brief; built now
    // per Jérémie's live "clear your queue" ask, 2026-08-25) — same
    // mechanism (a) shape as the tours toggle pair just above: two
    // commands per dimension, `when`-clause-driven, `treeProvider.refresh()`
    // explicit for the same "no onDidChangeConfiguration listener" reason.
    registerLoggedCommand('adrManager.hideSettledAdrs', async () => {
      await vscode.workspace.getConfiguration('adrManager').update('adrs.hideSettled', true);
      treeProvider?.refresh();
    }),
    registerLoggedCommand('adrManager.showSettledAdrs', async () => {
      await vscode.workspace.getConfiguration('adrManager').update('adrs.hideSettled', false);
      treeProvider?.refresh();
    }),
    registerLoggedCommand('adrManager.hideAdrsWithoutOpenQuestions', async () => {
      await vscode.workspace.getConfiguration('adrManager').update('adrs.hideWithoutOpenQuestions', true);
      treeProvider?.refresh();
    }),
    registerLoggedCommand('adrManager.showAdrsWithoutOpenQuestions', async () => {
      await vscode.workspace.getConfiguration('adrManager').update('adrs.hideWithoutOpenQuestions', false);
      treeProvider?.refresh();
    }),
    registerLoggedCommand('adrManager.hideClosedSeeds', async () => {
      await vscode.workspace.getConfiguration('adrManager').update('seeds.hideClosed', true);
      treeProvider?.refresh();
    }),
    registerLoggedCommand('adrManager.showClosedSeeds', async () => {
      await vscode.workspace.getConfiguration('adrManager').update('seeds.hideClosed', false);
      treeProvider?.refresh();
    }),
    // Seeds' missing second dimension (Jérémie's 2026-08-30 founder Report:
    // "why are the Hide/show options for seed not the same as ADRs, or not
    // as powerful") — same shape as ADRs' pair just above.
    registerLoggedCommand('adrManager.hideSeedsWithoutOpenQuestions', async () => {
      await vscode.workspace.getConfiguration('adrManager').update('seeds.hideWithoutOpenQuestions', true);
      treeProvider?.refresh();
    }),
    registerLoggedCommand('adrManager.showSeedsWithoutOpenQuestions', async () => {
      await vscode.workspace.getConfiguration('adrManager').update('seeds.hideWithoutOpenQuestions', false);
      treeProvider?.refresh();
    }),
    // The report's second half — "there should also be a root level option
    // that commands the two": one gesture for both ADRs' and Seeds'
    // without-open-questions filters together, so getting to "just show me
    // what's left to do" doesn't take two separate category-header clicks.
    // Sets both dimensions unconditionally (a partially-toggled state
    // resolves to "hide" on the next Hide click, "show" on the next Show
    // click, same convention as every other toggle pair here).
    registerLoggedCommand('adrManager.hideWithoutOpenQuestions', async () => {
      const cfg = vscode.workspace.getConfiguration('adrManager');
      await cfg.update('adrs.hideWithoutOpenQuestions', true);
      await cfg.update('seeds.hideWithoutOpenQuestions', true);
      treeProvider?.refresh();
    }),
    registerLoggedCommand('adrManager.showWithoutOpenQuestions', async () => {
      const cfg = vscode.workspace.getConfiguration('adrManager');
      await cfg.update('adrs.hideWithoutOpenQuestions', false);
      await cfg.update('seeds.hideWithoutOpenQuestions', false);
      treeProvider?.refresh();
    }),

    // seeds-as-issues minimum lovable slice (Lapidary's 2026-07-31
    // founder-escalation dispatch): one gesture appends a correctly-
    // scaffolded, attributed Thread turn — from the sidebar's right-click
    // on a seed, or the Command Palette against whichever seed is the
    // active editor.
    registerLoggedCommand('adrManager.addSeedThreadTurn', async (item) => {
      await addSeedThreadTurn(item);
    }),

    vscode.languages.registerDocumentLinkProvider({ language: 'markdown' }, new AdrDocumentLinkProvider()),
    registerOpenDeepLinkCommand(resolveLink),
    registerAdrTerminalLinkProvider(),
    registerDeepLinkUriHandler({
      resolve: resolveLink,
      treeView,
      openQuestionDialog: (questionId) => {
        if (!compositeIndex) return;
        OpenQuestionsPanel.createOrShow(compositeIndex);
        OpenQuestionsPanel.navigateTo(questionId);
      },
      // Same rootDir+adrDir+placeholder fallback anchorPathFromCommandArg
      // uses when nothing more specific is known — re-read fresh per call
      // (compositeIndex/the setting can both change mid-session).
      defaultAnchorPath: () => {
        const rootDir = compositeIndex?.root.path;
        if (!rootDir) return undefined;
        const adrDirRel = vscode.workspace.getConfiguration('adrManager').get<string>('adrDirectory', 'docs/adr');
        return path.join(rootDir, adrDirRel, '.anchor-placeholder');
      },
    }),

    // ADR-0034: tour tree items pass their slug as the first argument
    // ("Walk Tour" command) — the plain sidebar/toolbar invocation passes
    // none, opening the ordinary full walk.
    registerLoggedCommand('adrManager.openQuestionsPanel', (tourSlugArg?: unknown) => {
      // Fix (Jérémie's GIF-rerecording catch, 2026-08-18): the view/title
      // button's invocation lets VS Code inject a non-string first argument;
      // trusting it as a slug rendered "All caught up" over open questions.
      if (compositeIndex) OpenQuestionsPanel.createOrShow(compositeIndex, coerceTourSlug(tourSlugArg));
    }),

    // Fixture 5's smoke-test harness catch (2026-09-06, priority-A pass) —
    // same bug class as commitAdrs and createAdr above.
    registerLoggedCommand('adrManager.filterQuestions', async () => {
      if (treeProvider) await filterQuestions(treeProvider);
    }),

    // Fixture 5's smoke-test harness catch (2026-09-06, priority-A pass) —
    // same bug class. This one was the hardest to observe directly: the
    // mock's own applyEdit is synchronous fs work wrapped in a promise, so
    // a single microtask-draining `await` in a test happened to let the
    // whole unawaited chain finish "in time" anyway, masking the gap. Real
    // VS Code's applyEdit is genuinely async I/O — the masking would not
    // hold there. Fixed on the same audit, not because a test failed here.
    registerLoggedCommand('adrManager.changeStatus', async (item) => {
      if (item?.adr) await changeAdrStatus(item);
    }),

    registerLoggedCommand('adrManager.goToQuestionInPanel', (item) => {
      if (item?.question && compositeIndex) {
        // ADR-0034 fix (Facet's live click-through report, 2026-07-26
        // inbox 0349): a tour-entry's click carries its owning tour along,
        // so the panel opens (or switches) into THAT tour instead of
        // always landing in the plain, untoured walk — the bug was
        // clicking a specific question inside a tour and never seeing the
        // tour header at all. An ordinary (non-tour) question click passes
        // undefined, which now explicitly RETURNS the panel to full-walk
        // mode if it happened to be showing a tour (see createOrShow).
        OpenQuestionsPanel.createOrShow(compositeIndex, item.kind === 'tour-entry' ? item.tour?.slug : undefined);
        OpenQuestionsPanel.navigateTo(item.question.id);
      }
    }),

    // ── Quick Fix: insert Scope Remaining field after the Status line ──────
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'markdown' },
      {
        provideCodeActions(document, _range, context) {
          const actions: vscode.CodeAction[] = [];
          for (const diag of context.diagnostics) {
            if (diag.source !== 'ADR Manager' || diag.code !== 'MISSING_SCOPE_REMAINING') continue;
            const fix = new vscode.CodeAction(
              'Add "Scope Remaining" to header (below Status line)',
              vscode.CodeActionKind.QuickFix,
            );
            fix.diagnostics = [diag];
            fix.isPreferred = true;
            // Find the Status line and insert directly after it
            const lines = document.getText().split('\n');
            let insertAfterLine = diag.range.start.line;
            for (let i = 0; i < Math.min(20, lines.length); i++) {
              if (/^-\s+\*\*Status\*\*:/.test(lines[i])) { insertAfterLine = i; break; }
            }
            fix.edit = new vscode.WorkspaceEdit();
            fix.edit.insert(document.uri, new vscode.Position(insertAfterLine + 1, 0), '- **Scope Remaining**: \n');
            actions.push(fix);
          }
          return actions;
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),

    // ── Quick Fix: fix a nav-code heading's level to canonical ### ─────────
    // Jérémie's ruling, 2026-07-12 (item 1 of Lapidary's h2-QST dispatch):
    // NONCANONICAL_NAV_CODE_LEVEL fires for "## QST: ..." / "#### QST: ..."
    // — recognized and parsed already (extractor.ts), just at the wrong
    // heading level. Works for both ADR and seed files (language:markdown,
    // not container-specific).
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'markdown' },
      {
        provideCodeActions(document, _range, context) {
          const actions: vscode.CodeAction[] = [];
          for (const diag of context.diagnostics) {
            if (diag.source !== 'ADR Manager' || diag.code !== 'NONCANONICAL_NAV_CODE_LEVEL') continue;
            const line = diag.range.start.line;
            const lineText = document.lineAt(line).text;
            const headingMatch = lineText.match(/^#{1,6}\s+(.*)$/);
            if (!headingMatch) continue;
            const fix = new vscode.CodeAction(
              'Fix heading level to ### (canonical)',
              vscode.CodeActionKind.QuickFix,
            );
            fix.diagnostics = [diag];
            fix.isPreferred = true;
            fix.edit = new vscode.WorkspaceEdit();
            fix.edit.replace(document.uri, document.lineAt(line).range, `### ${headingMatch[1]}`);
            actions.push(fix);
          }
          return actions;
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),

    // ── Quick Fix: apply normalizer patches (ADR-0013 Stage 2) ─────────────
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'markdown' },
      {
        provideCodeActions(document, _range, context) {
          const normDiags = context.diagnostics.filter(d => d.source === 'adr-normalizer');
          if (normDiags.length === 0) return [];

          const adr = compositeIndex?.allAdrs().find(a => a.path === document.uri.fsPath);
          if (!adr) return [];

          const content = document.getText();
          const actions: vscode.CodeAction[] = [];

          // Suggest-only handlers (bulkApply === false — e.g. D9.8, whose
          // migration changes a question's id): one Quick Fix per
          // diagnostic, offered at the author's choice and NEVER folded into
          // the bulk action below (ledger ruling 2026-09-26, clause 5).
          const suggestOnly = normalizerCoordinator.suggestOnlyHandlerIds();
          for (const diag of normDiags) {
            const handlerId = String(diag.code);
            if (!suggestOnly.has(handlerId)) continue;
            const patch = normalizerCoordinator.processOne(content, adr, handlerId, diag.range.start.line + 1);
            if (!patch) continue; // stale diagnostic — never apply a guess
            const one = new vscode.CodeAction(normalizerCoordinator.quickFixTitle(handlerId), vscode.CodeActionKind.QuickFix);
            one.diagnostics = [diag];
            one.isPreferred = false;
            one.edit = new vscode.WorkspaceEdit();
            const endLine = patch.lineEnd - 1;
            one.edit.replace(
              document.uri,
              new vscode.Range(
                new vscode.Position(patch.lineStart - 1, 0),
                new vscode.Position(endLine, document.lineAt(Math.min(endLine, document.lineCount - 1)).text.length),
              ),
              patch.replacement,
            );
            actions.push(one);
          }

          const { patches } = normalizerCoordinator.processAll(content, adr);
          if (patches.length === 0) return actions;

          const label = `Normalize to adr format (${patches.length} fix${patches.length > 1 ? 'es' : ''})`;
          const action = new vscode.CodeAction(label, vscode.CodeActionKind.QuickFix);
          action.diagnostics = normDiags.filter(d => !suggestOnly.has(String(d.code)));
          action.isPreferred = false;
          action.edit = new vscode.WorkspaceEdit();

          // Apply patches in reverse line order to preserve earlier offsets
          const sorted = [...patches].sort((a, b) => b.lineStart - a.lineStart);
          for (const patch of sorted) {
            const startPos = new vscode.Position(patch.lineStart - 1, 0);
            const endLine = patch.lineEnd - 1;
            const endCol = document.lineAt(Math.min(endLine, document.lineCount - 1)).text.length;
            const endPos = new vscode.Position(endLine, endCol);
            action.edit.replace(document.uri, new vscode.Range(startPos, endPos), patch.replacement);
          }

          return [...actions, action];
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),

    // Fixture 5's smoke-test harness catch (2026-09-06, priority-A pass) —
    // same bug class as openAdr above (shares openAdrFile).
    registerLoggedCommand('adrManager.goToAnswerInFile', async (item) => {
      if (item?.question) {
        const line = item.question.answer?.line ?? item.question.lineStart;
        await openAdrFile(item.question.adrPath, line);
      }
    }),
  );

  // ── Buffer-change trigger ────────────────────────────────────────────────
  // Per-root disk watchers are already live (startRootWatcherLifecycle,
  // above) — this is the ADDITIONAL live-typing path (buffer truth, not
  // disk truth; see the function's own doc comment for the incident this
  // closes). Root discovery itself already happened synchronously before
  // this point (fromWorkspace awaited above), so there's no separate
  // "initial index population" step left to schedule — every root's
  // content is already parsed by the time activate() reaches here.
  setupBufferChangeTrigger(context, () => compositeIndex, adrDir);
}

// ---------------------------------------------------------------------------
// Deactivation
// ---------------------------------------------------------------------------

export function deactivate(): void {
  watcherLifecycle?.dispose();
  watcherLifecycle = undefined;
  diagnosticsSubscription?.dispose();
  diagnosticsSubscription = undefined;
  statusBarSubscription?.();
  statusBarSubscription = undefined;
  badgeSubscription?.();
  badgeSubscription = undefined;
}

// ---------------------------------------------------------------------------
// Composite refresh + status bar
// ---------------------------------------------------------------------------

/**
 * Re-parses every already-discovered root's own directory content (does
 * NOT re-run root discovery — that's watcherLifecycle.requestRefresh()'s
 * job, triggered by .settings/roots.json / .adrignore changes). Used by the
 * manual "Refresh" command as a fallback when there's no live watcher
 * lifecycle to delegate to (the no-workspace-open edge case).
 */
async function reindexWorkspace(composite: CompositeIndex, adrDirRel: string): Promise<void> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) return;
  for (const node of composite.walk()) {
    if (!node.hasAdrDir) continue;
    const adrDir = path.join(node.path, adrDirRel);
    await node.adrs.indexDirectory(adrDir);
    await node.seeds.indexDirectory(adrDir);
  }
}

/**
 * ADR-0029 QST-E: which sources currently count toward the open-question
 * aggregate — read unscoped (workspace-wide), since the badge/status bar
 * are single workspace-global surfaces, not tied to one root's resource
 * scope. Missing keys default to included (no speculative "master off"
 * setting — the per-source booleans already provide an implicit all-off
 * state per the ratified Decision).
 */
function badgeInclusion(): SourceInclusion {
  const cfg = vscode.workspace.getConfiguration('adrManager');
  const inclusion: SourceInclusion = {};
  for (const source of QUESTION_SOURCES) inclusion[source.key] = cfg.get<boolean>(`badge.include.${source.key}`, true);
  return inclusion;
}

/** Aggregate ADR count + open-question count across every discovered root, respecting badge.include.* (one computation, shared with the badge and tree header — Cairn's swap). */
function updateStatusBarText(): void {
  if (!statusBarItem || !compositeIndex) return;
  const adrCount = compositeIndex.allAdrs().length;
  const openCount = aggregateOpenQuestionCount(compositeIndex.walk(), badgeInclusion());
  statusBarItem.text = `$(file-text) ADRs: ${adrCount}${openCount > 0 ? ` | ? ${openCount}` : ''}`;
}

/** Count of files currently carrying at least one diagnostic — DiagnosticCollection only holds entries for URIs with a non-empty diagnostics array, so this is exactly "files with parse warnings." */
function countFilesWithDiagnostics(collection: vscode.DiagnosticCollection): number {
  let count = 0;
  collection.forEach(() => { count++; });
  return count;
}

/**
 * ADR-0029: the sidebar/Activity Bar badge. Native `ViewBadge` only (QST-C,
 * ratified) — plain numeral, no custom color escalation, no animation; the
 * badge inherits the user's theme color by construction. Tooltip discloses
 * parse health as a separate, default-on setting (Lapidary's fold addendum,
 * 2026-07-12 `2130`) — "N open questions · M files with parse warnings" —
 * so a confident wrong number can't silently license inattention
 * (DEBRIEF-002's class, applied to the one surface designed to be trusted
 * without checking).
 */
function updateBadge(): void {
  if (!treeView || !compositeIndex) return;
  const count = aggregateOpenQuestionCount(compositeIndex.walk(), badgeInclusion());
  if (count === 0) { treeView.badge = undefined; return; }

  let tooltip = `${count} open question${count === 1 ? '' : 's'}`;
  const cfg = vscode.workspace.getConfiguration('adrManager');
  if (cfg.get<boolean>('badge.showParseHealth', true) && diagnosticCollection) {
    const warnFiles = countFilesWithDiagnostics(diagnosticCollection);
    if (warnFiles > 0) tooltip += ` · ${warnFiles} file${warnFiles === 1 ? '' : 's'} with parse warnings`;
  }
  treeView.badge = { value: count, tooltip };
}

/**
 * Subscribes to every discovered root's own AdrIndex/SeedIndex onChange —
 * the same targeted, event-driven diagnostics logic the pre-ADR-0025
 * single-root code used, applied once per root instead of once for a
 * single top-level index. Seed cross-referencing (SEED_INCOMPLETE) stays
 * scoped to the OWNING root's own ADRs, not global — a seed's "Derived
 * Into" section references ADRs from its own project; cross-root lookup
 * here would be a correctness bug (finding a same-numbered ADR in the
 * wrong project), not a feature. Callers must dispose the previous
 * subscription before calling this again after a root-set refresh (see
 * onCompositeRefreshed).
 */
function subscribeDiagnostics(composite: CompositeIndex, collection: vscode.DiagnosticCollection): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];
  for (const node of composite.walk()) {
    const unsubAdrs = node.adrs.onChange(event => {
      if (event.type === 'removed') {
        collection.delete(vscode.Uri.file(event.adrPath));
      } else {
        updateDiagnostics(collection, event.adr);
      }
      // ADR-0016: an ADR add/update may be the first cross-reference that
      // resolves a seed's SEED_INCOMPLETE — recompute this root's seed diagnostics too.
      updateAllSeedDiagnostics(collection, node.seeds, node.adrs);
      // ADR-0035 Iteration 2: an ADR edit can rename/remove the very
      // question a tour references — recompute this root's tour diagnostics too.
      updateTourDiagnosticsForNode(collection, composite, node);
    });
    const unsubSeeds = node.seeds.onChange(() => {
      updateAllSeedDiagnostics(collection, node.seeds, node.adrs);
      updateTourDiagnosticsForNode(collection, composite, node);
    });
    disposables.push({ dispose: unsubAdrs }, { dispose: unsubSeeds });
  }
  return { dispose: () => { for (const d of disposables) d.dispose(); } };
}

/**
 * Called after watcherLifecycle rebuilds the composite (a root-set change —
 * .settings/roots.json edited, an .adrignore marker created/removed).
 * Re-points the top-root aliases, re-subscribes diagnostics/status-bar/tree
 * against the new node set, plus one explicit diagnostics pass (same
 * reasoning as activate()'s initial pass — the rebuild's own
 * indexDirectory() calls happened before anything new was subscribed to
 * hear them).
 *
 * `treeProvider.setComposite()` (landed alongside the Linear Multi-Root
 * Tree Projection, 2026-07-16) closes what was originally a documented gap
 * here — the tree view no longer freezes at its pre-refresh state after a
 * root-set change.
 */
function onCompositeRefreshed(collection: vscode.DiagnosticCollection | undefined): void {
  if (!compositeIndex) return;
  index = compositeIndex.root.adrs;
  seedIndex = compositeIndex.root.seeds;
  diagnosticsSubscription?.dispose();
  if (collection) {
    diagnosticsSubscription = subscribeDiagnostics(compositeIndex, collection);
    for (const adr of compositeIndex.allAdrs()) updateDiagnostics(collection, adr);
    for (const node of compositeIndex.walk()) updateAllSeedDiagnostics(collection, node.seeds, node.adrs);
    updateTourDiagnostics(collection, compositeIndex);
  }
  // Flint 5's review finding (2026-07-16): compositeIndex.onChange() is a
  // one-time subscription against the node instances live at call time, not
  // a live aggregate — must be re-subscribed against the NEW composite here,
  // same as diagnosticsSubscription just above, or the status bar silently
  // freezes after every root-set refresh for the rest of the session.
  statusBarSubscription?.();
  statusBarSubscription = compositeIndex.onChange(updateStatusBarText);
  updateStatusBarText();
  // Same re-subscribe requirement as statusBarSubscription just above.
  badgeSubscription?.();
  badgeSubscription = compositeIndex.onChange(updateBadge);
  updateBadge();
  treeProvider?.setComposite(compositeIndex);
}

// ---------------------------------------------------------------------------
// File watcher setup
// ---------------------------------------------------------------------------
//
// Per-root disk watchers now live in src/watchers/rootWatcherLifecycle.ts
// (ADR-0025 Decision 3/5) — one FileSystemWatcher per discovered root,
// composed into ExtensionContext.subscriptions, with Disposable-shaped
// teardown and Decision 3's audit events. The single-watcher
// setupFileWatcher()/setupSeedFileWatcher() pair they replaced is gone;
// isAdrFile()/isSeedFile() stay (basename-shape helpers, still used by the
// buffer-change trigger below).

function isAdrFile(filePath: string): boolean {
  // Basename SHAPE only — NOT containment. Safe for the disk watchers,
  // whose `<adrDir>/*.md` glob already scopes the directory; any other
  // caller must pair this with isDirectChildOf (see fileGuards.ts and the
  // 2026-07-14 phantom-ADR incident in setupBufferChangeTrigger).
  return isAdrBasename(path.basename(filePath));
}

function isSeedFile(filePath: string): boolean {
  return isSeedBasename(path.basename(filePath));
}

/**
 * "Question doesn't advance" residual (Lapidary 5, reported 2026-07-12,
 * recurring since pre-v0.6): the refresh pipeline was disk-watcher-only —
 * nothing subscribed to onDidChangeTextDocument or onDidSaveTextDocument —
 * so Cmd+Enter's correctness depended on the answer-write path persisting
 * to disk every single time. Any path where the buffer edit landed but the
 * save silently failed or raced left the index (and the panel) stale until
 * an unrelated manual save nudged the FileSystemWatcher. Each prior fix
 * patched one save path; the class survived because there was no
 * buffer-level trigger at all.
 *
 * Debounced (500ms, matching the draft auto-save interval elsewhere in this
 * codebase) so a fast typist doesn't trigger a reparse per keystroke.
 * Reindexes from document.getText() — buffer truth, not disk truth — so an
 * edit is reflected even before (or if) the save round-trip completes. The
 * disk watchers stay in place for changes made outside the editor.
 */
function setupBufferChangeTrigger(
  context: vscode.ExtensionContext,
  getComposite: () => CompositeIndex | undefined,
  adrDirRel: string,
): void {
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const disposable = vscode.workspace.onDidChangeTextDocument(event => {
    const filePath = event.document.uri.fsPath;
    const composite = getComposite();
    if (!composite) return;
    // Phantom-ADR guard (2026-07-14, system3 incident): this event fires for
    // EVERY document in the workspace, and the basename-shape checks alone
    // are not containment — a date-prefixed report merely opened in the
    // editor ("2026-07-14-...-gpt-5.6-sol.md" in docs/reports/) matched
    // isAdrFile and was injected into the index as phantom ADR-2026. The
    // disk watchers never needed this check only because their glob
    // (`<adrDir>/*.md`) already scoped the directory; this trigger must
    // enforce the same scope explicitly. See src/index/fileGuards.ts.
    //
    // ADR-0025: resolve the OWNING root first (any discovered root, not
    // just the top workspace folder), then require direct-child containment
    // relative to THAT root's own adrDir — the same guard the top root
    // always had, now correctly scoped per-root instead of hardcoded to
    // workspaceFolders[0].
    const owningRoot = composite.findRoot(filePath);
    if (!owningRoot) return;
    // No-workspace fallback guard (Flint 5's review, minor finding): the
    // CompositeIndex.wrapSingle('', ...) used when no workspace is open has
    // an empty root path, under which findRoot()'s prefix match degrades to
    // "starts with '/'" — true for any absolute path. The isDirectChildOf
    // check below happens to still reject everything in that state (it
    // resolves 'docs/adr' as a relative path against the process cwd, never
    // matching a real file), but only by accident of two mismatched
    // assumptions, not by explicit intent — make the intent explicit.
    if (owningRoot.path === '') return;
    if (!isDirectChildOf(filePath, path.join(owningRoot.path, adrDirRel))) return;
    const isAdr = isAdrFile(filePath);
    const isSeed = !isAdr && isSeedFile(filePath);
    if (!isAdr && !isSeed) return;

    const existing = debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    debounceTimers.set(filePath, setTimeout(() => {
      debounceTimers.delete(filePath);
      const content = event.document.getText();
      if (isAdr) owningRoot.adrs.indexContent(filePath, content);
      else owningRoot.seeds.indexContent(filePath, content);
    }, 500));
  }, null, context.subscriptions);

  context.subscriptions.push(disposable, {
    dispose: () => { for (const t of debounceTimers.values()) clearTimeout(t); },
  });
}

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

async function openAdrFile(filePath: string, lineNumber?: number): Promise<void> {
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });

  if (lineNumber && lineNumber > 0) {
    // Jump to the specific line (1-indexed → 0-indexed for VS Code)
    const line = Math.max(0, lineNumber - 1);
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }
}

/**
 * ADR-0025 Decision 6 ("active-editor default + read-before-write
 * visibility + per-workspace override"), the follow-up pass flagged in
 * this file's own "Extension state" doc comment. Silent in the N=1 case
 * (composability, unchanged from before this pass). In multi-root:
 * `adrManager.newAdrTargetRoot` pins a namespace regardless of the active
 * file; otherwise the active editor's own root wins via `findRoot`;
 * `adrManager.alwaysPromptOnMultiRoot` forces the QuickPick even when one
 * of those would have resolved silently. Returns undefined only on
 * Escape/cancel from the QuickPick (or no workspace at all) — never a
 * silent wrong-root guess.
 */
async function resolveCreationTargetRoot(): Promise<RootNode | undefined> {
  if (!compositeIndex) return undefined;
  const nodes = Array.from(compositeIndex.walk());

  const cfg = vscode.workspace.getConfiguration('adrManager');
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const activeEditorRootNamespace = activeUri?.scheme === 'file'
    ? compositeIndex.findRoot(activeUri.fsPath)?.namespace
    : undefined;

  const decision = resolveTargetRootPolicy(nodes, {
    alwaysPrompt: cfg.get<boolean>('alwaysPromptOnMultiRoot', false),
    pinnedNamespace: cfg.get<string>('newAdrTargetRoot', 'active-editor'),
    activeEditorRootNamespace,
  });
  if (decision.kind === 'silent') return nodes.find(n => n.namespace === decision.namespace);

  const mode = cfg.get<RootCaptionMode>('roots.captionMode', 'git-auto');
  const captions = computeRootCaptions(nodes, mode);
  const picked = await vscode.window.showQuickPick(
    nodes.map((n, i) => ({ label: captions[i], description: n.path, node: n })),
    { title: 'Create in which project?', placeHolder: 'Select a root' },
  );
  return picked?.node;
}

/**
 * Cache-then-verify-then-scan (ADR-0025 Decision 6's own pseudocode,
 * verbatim shape): the cache is a hypothesis about disk state, not a
 * substitute for it — always re-verified against a fresh directory
 * listing before being trusted, so a file created by another surface
 * (MCP write tier, a concurrent window) between calls is never silently
 * re-suggested. Keyed by root path, in-memory only — reset naturally
 * each activation, which is fine: a stale cache just costs one extra
 * scan, it never causes a WRONG number (the verify loop below always
 * re-checks disk regardless of what the cache says).
 */
const nextAdrNumberCache = new Map<string, number>();

function nextAdrNumberFor(root: RootNode, adrDirRel: string): number {
  const adrDir = path.join(root.path, adrDirRel);
  const seed = nextAdrNumberCache.get(root.path) ?? (() => {
    const nums = root.adrs.allAdrs().map(a => a.number);
    return (nums.length ? Math.max(...nums) : 0) + 1;
  })();
  let existing: string[] = [];
  try {
    existing = fs.readdirSync(adrDir);
  } catch {
    // ADR dir doesn't exist yet (first ADR in a fresh root) — nothing to collide with.
  }
  const candidate = computeNextNumber(seed, existing);
  nextAdrNumberCache.set(root.path, candidate);
  return candidate;
}

/**
 * The file write is the final, authoritative collision guard (Decision
 * 6: "if nextAdrNumber() returns and the file still races... the second
 * writer's file-open with wx flag fails, is caught, and the accessor is
 * retried — never a silent-overwrite"). `wx` (exclusive create) fails
 * with EEXIST if the target already exists; on that, bump the cache past
 * the collision and recompute, so a concurrent writer (a future MCP
 * create_adr call, or another window) can never cause one of the two to
 * silently clobber the other.
 */
async function writeAdrFileExclusive(root: RootNode, adrDirRel: string, slug: string, content: string): Promise<string> {
  const adrDir = path.join(root.path, adrDirRel);
  for (;;) {
    const num = nextAdrNumberFor(root, adrDirRel);
    const filePath = path.join(adrDir, `${String(num).padStart(4, '0')}-${slug}.md`);
    try {
      await fs.promises.mkdir(adrDir, { recursive: true });
      await fs.promises.writeFile(filePath, content, { flag: 'wx' });
      return filePath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      nextAdrNumberCache.set(root.path, num + 1);
    }
  }
}

/**
 * Seeds have no numbered-slot equivalent to nextAdrNumber (date+slug
 * filenames, by design — see the comment at the call site below); the
 * same "never silently clobber" instinct applies via a suffixed slug
 * instead of an incrementing number. A same-day, same-title collision is
 * rare enough that this is the honest, minimal fit rather than inventing
 * a numbering scheme seeds don't otherwise have.
 */
async function writeSeedFileExclusive(root: RootNode, adrDirRel: string, baseSlug: string, today: string, content: string): Promise<string> {
  const adrDir = path.join(root.path, adrDirRel);
  await fs.promises.mkdir(adrDir, { recursive: true });
  for (let suffix = 0; ; suffix++) {
    const slug = suffix === 0 ? baseSlug : `${baseSlug}-${suffix + 1}`;
    const filePath = path.join(adrDir, `seed-${today}-${slug}.md`);
    try {
      await fs.promises.writeFile(filePath, content, { flag: 'wx' });
      return filePath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

/**
 * `opts.targetRoot`: the explicit override (Decision 6: right-click on a
 * root/category header) — skips resolution entirely, no prompt, matching
 * "Right-click on a RootNode... is the explicit override." `opts.forceKind`:
 * right-click on the ADR or Seed category header already says which kind,
 * so the kind-picker below is skipped too.
 */
async function createNewAdr(adrDirRel: string, opts?: { targetRoot?: RootNode; forceKind?: 'adr' | 'seed' }): Promise<void> {
  const root = opts?.targetRoot ?? await resolveCreationTargetRoot();
  if (!root) {
    if (!compositeIndex) vscode.window.showErrorMessage('ADR Manager: No workspace folder open.');
    return;
  }

  const kind = opts?.forceKind
    ? { value: opts.forceKind }
    : await vscode.window.showQuickPick([
        { label: '$(file-text) New ADR', description: 'Full adr template with questions', value: 'adr' as const },
        { label: '$(edit) New Seed', description: 'Brain dump — AI will chunk into ADRs', value: 'seed' as const },
      ], { title: 'What would you like to create?', placeHolder: 'Select type' });
  if (!kind) return;

  // Read-before-write visibility (Decision 6): the root choice is shown
  // BEFORE the title prompt, whether it was resolved silently or picked —
  // same tempo as ADR-0023's three-choice consent surface.
  vscode.window.setStatusBarMessage(`New ${kind.value === 'seed' ? 'Seed' : 'ADR'} → ${root.namespace}`, 4000);

  const promptLabel = kind.value === 'adr'
    ? 'ADR title (e.g., "Use SQLite for local ADR index")'
    : 'Seed topic (e.g., "Auth strategy thoughts")';

  const title = await vscode.window.showInputBox({
    prompt: promptLabel,
    placeHolder: kind.value === 'adr' ? 'Decision title' : 'Topic',
    ignoreFocusOut: true,
  });

  if (!title) return;

  const slug = title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);

  // Seeds use date-prefixed filenames (seed-YYYY-MM-DD-slug.md), NOT sequential numbers.
  // ADR numbers are permanent slots for decisions; seeds are transient pre-decisional artifacts.
  const today = new Date().toISOString().split('T')[0];

  const cfg = vscode.workspace.getConfiguration('adrManager');
  const humanName = cfg.get<string>('humanName', '') || 'Human';
  const aiModel = cfg.get<string>('aiModel', '(your AI model)');
  const template = kind.value === 'seed'
    ? generateSeedTemplate(title, today, humanName)
    : generateAdrTemplate(title, today, humanName, aiModel);

  const filePath = kind.value === 'seed'
    ? await writeSeedFileExclusive(root, adrDirRel, slug, today, template)
    : await writeAdrFileExclusive(root, adrDirRel, slug, template);

  await openAdrFile(filePath);
}

function generateAdrTemplate(title: string, date: string, humanName: string, aiModel: string): string {
  return `# ${title}

- **Date**: ${date}
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: ${humanName}, ${aiModel}

---

## Quick Reference

**Navigation codes** (for grep):
- \`QST:\` Questions
- \`ANS:\` Answers
- \`COD:\` Code examples
- \`API:\` API calls
- \`FIL:\` Files to examine
- \`DOC:\` Documentation
- \`NOT:\` Note, important observation

**Find things**:
\`\`\`bash
grep '^### QST:' docs/adr/$(basename ${date}-*.md)
grep 'Status: unanswered' docs/adr/
\`\`\`

---

## Human Context

**Your stream-of-consciousness here** — no structure needed, just dump everything.

[Your thoughts, questions, frustrations, ideas, code snippets, whatever's on your mind about this decision]

**Agency Grant**: [Optional: What freedom does the AI have? "Implement as you see fit" / "Explore options" / "Just structure my thoughts"]

---

## AI Interpretation

**What I understand you're asking**:

1. [Thread/topic 1] - [why it matters]

**Assumptions I'm making**:
- [Assumption 1]

**Confirm**: Does this match what you meant?

---

## Questions

### QST: [Question text]
- Status: unanswered
- Why asking: [How this shapes the approach]
- Need: [yes/no | explanation | code example | etc]

**ANS:** (by ${humanName})
[Fill this in]

---

## Supporting Materials

### NOT: [observation]
[Note content]

---

## Decision

### Context
[What problem are we solving? Why does it matter?]

### Options

**Option A**: [Name]
- Pros: [Benefits]
- Cons: [Drawbacks]

**Option B**: [Name]
- Pros: [Benefits]
- Cons: [Drawbacks]

### Chosen: [TBD]

**Why**: [Rationale]

**Trade-offs accepted**: [What we're giving up]

### Consequences
- [Immediate impact]
- [Long-term consideration]

---

## Action Items

- [ ] [Task 1] — Owner: [who]

---

## Validation

- [ ] ${humanName}: Decision captured correctly
- [ ] ${aiModel}: Understood the requirements

---

## Iterations

### Iteration 1 (${date})
- Human: [What you provided]
- AI (${aiModel}): [What the AI did]
- Outcome: [What changed]

---

## Links

- Related ADRs: (none)
- Template: adr v3.1
`;
}

interface DirtyRoot {
  node: RootNode
  repo: any // eslint-disable-line @typescript-eslint/no-explicit-any -- api/repo come from the untyped vscode.git extension API
  changes: any[] // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Untracked/new paths ANYWHERE in this root, outside the ADR-dir change set — candidates for the untracked-referenced-files checklist (addition 2, 2026-07-30 founder-escalation dispatch). A screenshot linked from a seed/ADR is untracked and lives outside docs/adr/, so the primary `changes` scan never sees it. */
  untrackedCandidates: string[]
}

/**
 * ADR-0025 multi-root fix (Lapidary's 2026-07-29 feedback-seed dispatch,
 * item A3), REPO-FIRST since Lapidary's 2026-07-31 dispatch (live repro at
 * HQ — a genuine multi-FOLDER VS Code workspace, `.code-workspace` with
 * the parent repo and a submodule as SEPARATE top-level folders, not a
 * single directory tree). The original A3 fix scanned root-first
 * (`compositeIndex.walk()`, then ask git to resolve a repo for each root's
 * bare directory) — DEBRIEF-002's own fix (resolve by URI, not position)
 * went in one level upstream of THIS call site, but the call site itself
 * still only ever asked "what repo does this root resolve to," which can
 * fail even when the repository is perfectly well-known to VS Code's git
 * extension. `groupChangesByOwningRoot` (repositoryResolution.ts) inverts
 * the direction: start from every repo the git extension has ALREADY
 * discovered, resolve the OWNING root from each changed FILE's path.
 *
 * Jérémie's own framing (seed-2026-07-29): scan every project; if there's
 * just one with changes, commit it — no ceremony; if there's several,
 * show a checkbox palette so more than one can be committed at once.
 *
 * `targetRootPath` (Gleaner's brief 2026-08-14, item 3 — Jérémie's own
 * words, verbatim, from a per-root Report submission: "I'd like it if
 * there was the 'commit changes' menuitem in all roots... so you can
 * circumvent the palette to select projects to commit"): when invoked
 * from a specific root's context menu, commit ONLY that root, skipping
 * the cross-root picker entirely — even when other roots also have
 * changes. Undefined for the existing tree-wide entry points (the top
 * toolbar button, the Command Palette), which keep scanning every root
 * exactly as before.
 *
 * `scopeFilter` (Jérémie, live, 2026-08-26: "the commit menu item commits
 * multiple things, not just the item or group items below"): the menu-
 * coherence pass (v0.7.93) put Commit on every ADR/seed item and both
 * category headers, but every one of them still committed the WHOLE
 * root — an individual ADR's Commit swept in every other changed file
 * under docs/adr/ too, including unrelated ADRs, seeds, and `.working/`
 * bookkeeping. This narrows `targeted.changes` (and therefore the commit
 * message, the staged paths, and the untracked-references scan, which
 * all already just read `dr.changes`) down to exactly what the clicked
 * item scope means — no changes anywhere else needed.
 */
async function commitAdrChanges(adrDirRel: string, targetRootPath?: string, scopeFilter?: (filePath: string) => boolean): Promise<void> {
  if (!compositeIndex) return;

  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (!gitExtension) {
    vscode.window.showErrorMessage('ADR Manager: Git extension not found.');
    return;
  }
  const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
  const api = git.getAPI(1);

  // Force a synchronous git-status refresh before reading `repo.state` —
  // Jérémie's 2026-08-29 Report ("commit adrs in this root just now said
  // 'no changes'" right after saving an answer in-panel): the git
  // extension's own cached state can lag its file watcher by a beat, so
  // reading it immediately after this extension's own write can race and
  // see the pre-write status. See refreshRepositories's own doc comment.
  await refreshRepositories(api.repositories);

  const groups = groupChangesByOwningRoot<any, any>(api.repositories, adrDirRel, fp => compositeIndex!.findRoot(fp)); // eslint-disable-line @typescript-eslint/no-explicit-any
  const dirtyRoots: DirtyRoot[] = groups
    .filter(g => g.changes.length > 0)
    .map(g => {
      const allRepoChanges: any[] = [...g.repo.state.workingTreeChanges, ...g.repo.state.indexChanges]; // eslint-disable-line @typescript-eslint/no-explicit-any
      const untrackedCandidates = allRepoChanges
        .filter((c: any) => isNewGitStatus(c.status) && !g.changes.includes(c)) // eslint-disable-line @typescript-eslint/no-explicit-any
        .map((c: any) => c.uri.fsPath as string); // eslint-disable-line @typescript-eslint/no-explicit-any
      return { node: g.node, repo: g.repo, changes: g.changes, untrackedCandidates };
    });

  if (targetRootPath) {
    let targeted = dirtyRoots.find(dr => dr.node.path === targetRootPath);
    if (!targeted) {
      vscode.window.showInformationMessage(`ADR Manager: No ADR changes to commit in "${path.basename(targetRootPath)}".`);
      return;
    }
    if (scopeFilter) {
      const scopedChanges = targeted.changes.filter((c: any) => scopeFilter(c.uri.fsPath)); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (scopedChanges.length === 0) {
        vscode.window.showInformationMessage('ADR Manager: No changes to commit for this item.');
        return;
      }
      targeted = { ...targeted, changes: scopedChanges };
    }
    await commitOneRoot(targeted, true);
    return;
  }

  if (dirtyRoots.length === 0) {
    vscode.window.showInformationMessage('ADR Manager: No ADR changes to commit.');
    return;
  }

  let toCommit: DirtyRoot[];
  if (dirtyRoots.length === 1) {
    toCommit = dirtyRoots;
  } else {
    // Multiple dirty roots: canPickMany checkbox palette. Pre-checked —
    // Lapidary's QST-PALETTEDEFAULT recommendation ("showing the list IS
    // the consent surface; Enter-through is the common intent"), applied
    // as the interim default. PROVISIONAL pending Jérémie's own ANS to
    // that still-open question in the seed — flip `picked` below if he
    // rules the other way.
    const picks = await vscode.window.showQuickPick(
      dirtyRoots.map(dr => ({
        label: dr.node.namespace || path.basename(dr.node.path),
        description: `${dr.changes.length} change${dr.changes.length === 1 ? '' : 's'}`,
        detail: dr.node.path,
        picked: true,
        dirtyRoot: dr,
      })),
      {
        title: `Commit ADR changes — ${dirtyRoots.length} projects have changes`,
        canPickMany: true,
      },
    );
    if (!picks || picks.length === 0) return;
    toCommit = picks.map(p => p.dirtyRoot);
  }

  if (toCommit.length === 1) {
    await commitOneRoot(toCommit[0], true);
    return;
  }

  // Batch commit: Jérémie's own speed instinct for the multi-select case
  // ("select all of the projects to whom you want to commit") — an
  // auto-generated message per root, no per-repo input-box ceremony.
  let committedCount = 0;
  for (const dr of toCommit) {
    if (await commitOneRoot(dr, false)) committedCount++;
  }
  vscode.window.showInformationMessage(
    `ADR Manager: Committed to ${committedCount} of ${toCommit.length} project${toCommit.length === 1 ? '' : 's'}.`,
  );
}

/**
 * Untracked-referenced-files checklist (addition 2, 2026-07-30
 * founder-escalation dispatch): "before committing, scan untracked files;
 * for each, search the about-to-commit files for mentions (screenshots
 * referenced in seeds/ADRs are the motivating case)." A screenshot linked
 * from a seed/ADR is untracked and lives outside docs/adr/, so it never
 * appears in `dr.changes` on its own — without this it silently never gets
 * committed alongside the content that references it. Only ever prompts in
 * the INTERACTIVE (single-root) path — the batch multi-root commit never
 * shows a checkbox, to keep "select all, go" one gesture; `ask` behaves as
 * `auto-ignore` there, `auto-commit` still applies either way.
 */
async function resolveUntrackedReferencesToStage(dr: DirtyRoot, interactive: boolean): Promise<string[]> {
  if (dr.untrackedCandidates.length === 0) return [];

  const mode = vscode.workspace
    .getConfiguration('adrManager', vscode.Uri.file(dr.node.path))
    .get<UntrackedReferencesMode>('commit.untrackedReferences', 'ask');
  if (mode === 'auto-ignore') return [];

  const committedContents: string[] = [];
  for (const c of dr.changes) {
    try { committedContents.push(fs.readFileSync(c.uri.fsPath, 'utf8')); } catch { /* unreadable/binary/deleted — nothing to search */ }
  }
  const referenced = findReferencedUntrackedFiles(dr.untrackedCandidates, committedContents);
  if (referenced.length === 0) return [];

  if (mode === 'auto-commit') return referenced;

  // mode === 'ask'
  if (!interactive) return []; // batch path: never prompts, per the setting's own description
  const picks = await vscode.window.showQuickPick(
    referenced.map(p => ({ label: path.basename(p), detail: p, picked: true, filePath: p })),
    { title: 'Additional references mentioned — commit these?', canPickMany: true },
  );
  return picks ? picks.map(p => p.filePath) : [];
}

/** Commits one root's already-collected changes. `interactive`: show the editable message input box and the single-root confirmation (the existing, unchanged single-root UX); false for the batch multi-root path, which stays silent per-root and reports one aggregate count instead. */
async function commitOneRoot(dr: DirtyRoot, interactive: boolean): Promise<boolean> {
  const changedFiles: ChangedFile[] = dr.changes.map((c: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    path: c.uri.fsPath,
    isNew: isNewGitStatus(c.status),
  }));
  const generated = buildAdrCommitMessage(changedFiles);

  let message: string | undefined = generated;
  if (interactive) {
    message = await vscode.window.showInputBox({
      prompt: 'Commit message for ADR changes',
      value: generated,
      placeHolder: 'docs: commit message',
      ignoreFocusOut: true,
    });
  }
  if (!message) return false;

  const extraFiles = await resolveUntrackedReferencesToStage(dr, interactive);
  const allPaths = [...dr.changes.map((c: any) => c.uri.fsPath as string), ...extraFiles]; // eslint-disable-line @typescript-eslint/no-explicit-any

  try {
    await dr.repo.add(allPaths);
    await dr.repo.commit(message);

    if (interactive) {
      // Jérémie's report (2026-07-12): every staged path used to get called
      // an "ADR" in this confirmation, including docs/adr/.working/* draft
      // state — not a decision record. Classify instead of counting blind.
      const summary = summarizeCommittedArtifacts(allPaths);
      vscode.window.showInformationMessage(`ADR Manager: Committed ${summary}.`);
    }
    return true;
  } catch (err) {
    const label = dr.node.namespace || path.basename(dr.node.path);
    vscode.window.showErrorMessage(`ADR Manager: Commit failed (${label}) — ${err}`);
    // Gleaner's brief (2026-08-13, docs/inbox/2026-08-13-gleaner-to-
    // fitter-commit-failures-never-reach-error-record.md): a real,
    // reproducible git-policy pre-commit rejection sat invisible to
    // errors.jsonl until a human manually pasted it into conversation —
    // the founding incident's exact shape, in a code path ADR-0035
    // predates. anchorPath: the first changed file (already known to be
    // under the owning root's ADR directory, per groupChangesByOwningRoot
    // — no need to guess adrDirRel here). Failure-soft, same contract as
    // harvestError(): logging a failure must never itself throw.
    try {
      const anchorPath = allPaths[0]
      if (anchorPath) {
        appendLedgerRecord({
          schema: 'error-record/2',
          ts: new Date().toISOString(),
          extensionVersion: vscode.extensions.getExtension('jlumbroso.adrs4ai')?.packageJSON?.version,
          source: 'commit',
          kind: 'commit-failed',
          message: `Commit failed (${label}) — ${err}`,
          anchorPath,
          payload: {
            label,
            rootPath: dr.node.path,
            changedPaths: allPaths,
            rawError: err && typeof err === 'object' ? { ...err } : String(err),
          },
        })
      }
    } catch { /* failure-soft: never let the audit trail take down commit's own error path */ }
    return false;
  }
}

async function filterQuestions(treeProvider: import('./views/adrTreeProvider').AdrTreeProvider): Promise<void> {
  const current = treeProvider.filterMode;
  const picked = await vscode.window.showQuickPick([
    { label: '$(question) Open questions only', value: 'open' as const, description: current === 'open' ? '✓ current' : '' },
    { label: '$(list-flat) All questions', value: 'all' as const, description: current === 'all' ? '✓ current' : '' },
    { label: '$(check) Answered questions only', value: 'answered' as const, description: current === 'answered' ? '✓ current' : '' },
  ], { title: 'Filter Questions in Sidebar' });
  if (picked) treeProvider.setFilter(picked.value);
}

async function changeAdrStatus(item: import('./views/adrTreeProvider').AdrTreeItem): Promise<void> {
  if (!item.adr) return;
  const current = item.adr.status;
  const picked = await vscode.window.showQuickPick(
    ADR_STATUSES.map(s => ({
      label: `${s.emoji} ${s.value}`,
      value: s.value,
      description: s.value === current ? '(current)' : undefined,
    })),
    { title: `Change status of ADR-${String(item.adr.number).padStart(4, '0')}`, placeHolder: `Current: ${current}` }
  );
  if (!picked || picked.value === current) return;

  const uri = vscode.Uri.file(item.adr.path);
  const doc = await vscode.workspace.openTextDocument(uri);
  const edit = new vscode.WorkspaceEdit();
  const lines = doc.getText().split('\n');
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    if (/^-\s+\*\*Status\*\*:/.test(lines[i])) {
      edit.replace(uri, doc.lineAt(i).range, `- **Status**: ${picked.value}`);
      break;
    }
    if (/^\*\s+Status:/.test(lines[i])) {
      edit.replace(uri, doc.lineAt(i).range, `* Status: ${picked.value}`);
      break;
    }
  }
  await vscode.workspace.applyEdit(edit);
  await vscode.workspace.save(uri);
  // Don't rely solely on the FileSystemWatcher round-trip for a write we
  // just made ourselves — reindex synchronously so the tree view updates
  // immediately regardless of watcher latency (seed-2026-07-06-panel-submit-
  // no-refresh-bug.md: the same applyEdit+save-then-wait-for-watcher pattern
  // in the panel's writeAnswer() left the UI stuck until an unrelated manual
  // save nudged the watcher). ADR-0025: reindex through the OWNING root's
  // own index, not the top-root alias — item.adr.path may live in any
  // discovered root.
  compositeIndex?.findRoot(item.adr.path)?.adrs.indexFile(item.adr.path);
}

/**
 * Shared by both ADR and seed diagnostics (updateDiagnostics/
 * updateSeedDiagnostics) so the two container kinds surface the same
 * warning at the same volume — per ADR-0018's "one substrate, two
 * container kinds," a diagnostic's loudness shouldn't depend on which
 * kind of file it was found in. NONCANONICAL_NAV_CODE_LEVEL (Jérémie's
 * ruling, 2026-07-12): louder than the default Information because a
 * wrong-level nav-code heading can silently reshape the surrounding
 * section structure, not just misrecognize one heading.
 */
function parseWarningSeverity(code: import('./parser/types').ParseWarningCode): vscode.DiagnosticSeverity {
  return code === 'MISSING_SCOPE_REMAINING' || code === 'MISSING_STATUS' || code === 'NONCANONICAL_NAV_CODE_LEVEL'
    ? vscode.DiagnosticSeverity.Warning
    : vscode.DiagnosticSeverity.Information;
}

function parseWarningToDiagnostic(w: import('./parser/types').ParseWarning): vscode.Diagnostic {
  const line = Math.max(0, (w.line ?? 1) - 1);
  const range = new vscode.Range(line, 0, line, 999);
  const diag = new vscode.Diagnostic(range, w.message, parseWarningSeverity(w.code));
  diag.source = 'ADR Manager';
  diag.code = w.code;
  return diag;
}

function updateDiagnostics(
  collection: vscode.DiagnosticCollection,
  adr: import('./parser/types').AdrFile,
): void {
  const uri = vscode.Uri.file(adr.path);

  // Parser warnings (existing)
  const diags: vscode.Diagnostic[] = adr.parseWarnings.map(parseWarningToDiagnostic);

  // Normalizer dry-run (ADR-0013 Stage 2) — INFO diagnostics for format deviations
  try {
    const content = fs.readFileSync(adr.path, 'utf8');
    const violations = normalizerCoordinator.detectAll(content, adr);
    for (const v of violations) {
      const line = Math.max(0, v.lineStart - 1);
      const range = new vscode.Range(line, 0, line, 999);
      const diag = new vscode.Diagnostic(range, v.description, vscode.DiagnosticSeverity.Information);
      diag.source = 'adr-normalizer';
      diag.code = v.handlerId;
      diags.push(diag);
    }
  } catch {
    // File unreadable — skip normalizer pass silently
  }

  collection.set(uri, diags.length > 0 ? diags : []);
}

// ---------------------------------------------------------------------------
// Seed diagnostics — SEED_INCOMPLETE (ADR-0016)
// ---------------------------------------------------------------------------

function updateAllSeedDiagnostics(
  collection: vscode.DiagnosticCollection,
  sidx: SeedIndex,
  idx: AdrIndex,
): void {
  for (const seed of sidx.allSeeds()) {
    updateSeedDiagnostics(collection, seed, idx);
  }
}

function updateSeedDiagnostics(
  collection: vscode.DiagnosticCollection,
  seed: import('./parser/types').SeedFile,
  idx: AdrIndex,
): void {
  const uri = vscode.Uri.file(seed.path);

  // Parser warnings — same treatment as ADRs (parseWarningToDiagnostic),
  // now that SeedFile carries them (previously extractSeedQuestions()
  // discarded them entirely; see the DEBRIEF item 1/2 fix in
  // seedExtractor.ts). Accumulated alongside SEED_INCOMPLETE below rather
  // than each early-returning/overwriting the other's diagnostics.
  const diags: vscode.Diagnostic[] = seed.parseWarnings.map(parseWarningToDiagnostic);

  if (!seed.derivedIntoHasPlaceholder) {
    collection.set(uri, diags);
    return;
  }

  const adrEntries = idx.allAdrs().map(a => {
    let content = '';
    try { content = fs.readFileSync(a.path, 'utf8'); } catch { /* unreadable — skip */ }
    return { number: a.number, title: a.title, content };
  });
  const detected = findReferencingAdrs(seed.path, adrEntries);

  if (detected.length === 0) {
    collection.set(uri, diags);
    return;
  }

  let derivedIntoLine = 0;
  try {
    const seedContent = fs.readFileSync(seed.path, 'utf8');
    const lineIdx = seedContent.split('\n').findIndex(l => /^##\s+Derived Into/i.test(l.trim()));
    if (lineIdx >= 0) derivedIntoLine = lineIdx;
  } catch { /* fall back to line 0 */ }

  const detectedList = detected.map(a => `  - ADR-${String(a.number).padStart(4, '0')}: ${a.title}`).join('\n');
  const suggestedList = detected.map(a => `- ADR-${String(a.number).padStart(4, '0')}: ${a.title}`).join('\n');
  const message = `SEED_INCOMPLETE: "Derived Into" section has placeholder text\n\n` +
    `DETECTED DERIVED ADRs (found in index):\n${detectedList}\n\n` +
    `SUGGESTED UPDATE:\n## Derived Into\n\n${suggestedList}\n\n` +
    `SEE: docs/adr/0016-seed-incomplete-diagnostic.md`;

  const range = new vscode.Range(derivedIntoLine, 0, derivedIntoLine, 999);
  const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Information);
  diag.source = 'ADR Manager';
  diag.code = 'SEED_INCOMPLETE';
  diags.push(diag);
  collection.set(uri, diags);
}

// ---------------------------------------------------------------------------
// Tour diagnostics — TOUR_UNRESOLVED_REFS (ADR-0035 Iteration 2)
// ---------------------------------------------------------------------------

/**
 * One aggregated Error diagnostic per `.tour.json` with any unresolved
 * entry — the model-facing surface Riddle's design names explicitly: an
 * LLM reading diagnostics (via the editor or MCP) sees a broken tour
 * without a human having to tell it. Recomputed for every tour on every
 * composite build/refresh, independent of whether any panel has that tour
 * open — unlike the ledger writer (openQuestionsPanel.ts's
 * logTourUnresolvedIfNeeded), which only fires when a tour is actually
 * being walked.
 */
function updateTourDiagnosticsForNode(collection: vscode.DiagnosticCollection, composite: CompositeIndex, node: RootNode): void {
  const ctx = createRepositoryContextAdapter(composite);
  for (const tour of node.tours) {
    const uri = vscode.Uri.file(tour.path);
    const resolved = resolveTourEntries(tour, ctx);
    const unresolved = unresolvedTourRefs(resolved);
    if (unresolved.length === 0) {
      collection.delete(uri); // clear a stale diagnostic from a since-fixed tour
      continue;
    }
    const message = `TOUR_UNRESOLVED_REFS: ${unresolved.length} entr${unresolved.length === 1 ? 'y' : 'ies'} in "${tour.title}" could not be resolved\n\n` +
      unresolved.map(u => `  - ${u.ref}: ${u.reason}`).join('\n');
    const range = new vscode.Range(0, 0, 0, 999);
    const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
    diag.source = 'ADR Manager';
    diag.code = 'TOUR_UNRESOLVED_REFS';
    collection.set(uri, [diag]);
  }
}

/**
 * Recomputed for every tour on every composite build/refresh (activation,
 * root-set change, a `.tour.json` created/changed/deleted — the last now
 * routes here via rootWatcherLifecycle.ts's tour watcher parity), plus
 * per-node whenever THAT node's own ADR/seed content changes
 * (subscribeDiagnostics below) — an ADR edit can rename/remove the very
 * question a tour references. Scoped to the changed node only, same
 * simplification updateAllSeedDiagnostics' cross-reference recompute
 * already makes for SEED_INCOMPLETE: a tour in a DIFFERENT root
 * referencing an ADR in this one won't be caught by that per-node path —
 * rare enough (and no worse than the pre-existing seed-diagnostic scoping)
 * not to warrant a full composite-wide re-scan on every single ADR save.
 */
function updateTourDiagnostics(collection: vscode.DiagnosticCollection, composite: CompositeIndex): void {
  for (const node of composite.walk()) updateTourDiagnosticsForNode(collection, composite, node);
}

/**
 * Menu symmetry (Jérémie's seed, 2026-08-06, docs/adr/seed-2026-08-06-
 * feedback-on-treeview-context-menus.md, dispatched by Lapidary): "copy
 * deep link is something we should have for all objects... it should be
 * symmetric." Before this, seeds had no deep link at all, and a
 * seed-sourced QUESTION's deep link silently produced `adr:0000#slug` (the
 * exact bug ADR-0008 names: "Bug fix needed: adr:0000 deep link for
 * seeds"). Both branches now go through the already-ratified,
 * grammar-hash-tested builders in deeplink/protocol.ts instead of
 * hand-rolled string templates — seedSlugFromPath strips the `seed-`
 * filename prefix per ADR-0008's own worked examples
 * (`seed:2026-03-04-forma-5-web-storage`, not `seed:seed-2026-...`).
 * Tours are deliberately NOT included here: ADR-0008 never ratified a
 * `tour:` reference grammar, and inventing one unilaterally as a side
 * effect of a menu-symmetry pass would be exactly the kind of grammar
 * decision this project reserves for Riddle/council (same precedent as
 * roots.json's `names` field) — flagged back, not guessed.
 */
/**
 * ADR-0025 Decision 7 ("context-aware deep-link copy format"): a bare
 * `adr:NNNN` copied from a multi-root workspace resolves against
 * WHICHEVER root the paste lands in, not necessarily the root it was
 * copied from — silently wrong (not just ambiguous) if pasted into a
 * different root's document, since ADR numbers aren't unique across
 * roots. undefined in the N=1 case, where there's only ever one root to
 * mean anyway (same composability property Decision 6's root-resolution
 * already established) — `owningRootNamespace` below folds straight
 * back to undefined there without a second check.
 */
function isMultiRootWorkspace(): boolean {
  return (compositeIndex ? Array.from(compositeIndex.walk()).length : 1) > 1
}

function owningRootNamespace(filePath: string): string | undefined {
  if (!isMultiRootWorkspace()) return undefined
  return compositeIndex?.findRoot(filePath)?.namespace
}

/**
 * Facet's brief (2026-08-26, docs/inbox/2026-08-26-facet-to-fitter-
 * copydeeplink-never-reaches-repo-scope-plus-terminal-link-provider-
 * ask.md — a live founder bug report against this file's own open
 * Decision 7): copyDeepLink never once reached ADR-0008's tier-3
 * repo-scoped canonical form (`adr://v1/repo/<owner>/<repo>/...`) — the
 * one form meant to survive being pasted into a DIFFERENT repo entirely
 * (HQ, a sibling crew's inbox, anywhere outside the local composite
 * workspace). Not a missing builder (buildCanonicalRef's `scope: 'repo'`
 * branch already existed) — a missing caller.
 *
 * Option A from Facet's brief, chosen at my own discretion (she
 * explicitly left it to me, leaning A herself): always copy the
 * richest form the item's root supports, rather than a second "copy
 * cross-repo" command. Reasoning specific to how this project's own
 * crew actually uses this command: inbox briefs constantly cross repo
 * boundaries (this very bug report is one), so "will this get pasted
 * outside the local workspace" isn't a rare edge case here — it's close
 * to the default case. `root.gitRemoteSlug` (submodule-aware, already
 * computed at discovery time for the root-caption feature, v0.7.81) is
 * the exact input `buildCanonicalRef({scope:'repo',...})` needs — no
 * new git-parsing logic. Checked BEFORE the multi-root project-alias
 * tier, and unlike that tier, applies even in the N=1 case: a namespace
 * alias only ever resolves against the local composite tree, but a
 * repo-scoped canonical ref identifies the source repo regardless of
 * which workspace it's read from.
 */
function owningRootGitSlug(filePath: string): { owner: string; repo: string } | undefined {
  return compositeIndex?.findRoot(filePath)?.gitRemoteSlug
}

/**
 * Tooltip-preview note (Decision 7's other half): VS Code's
 * `view/item/context` menu items have no live hover-preview mechanism —
 * titles are static, declared once in package.json, with no per-
 * invocation callback to show "will copy: X" before the click (the same
 * kind of real API ceiling this session already hit for a true per-item
 * tree collapse). The closest achievable equivalent already exists:
 * `showInformationMessage` below fires immediately on copy, naming the
 * exact string that landed on the clipboard — read-before-acting-on-it,
 * even though it can't be strictly read-before-COMMIT for an action
 * (clipboard copy) that's already trivially reversible by copying again.
 */
function copyDeepLink(item: import('./views/adrTreeProvider').AdrTreeItem): void {
  let ref: string | undefined;
  if (item.kind === 'adr' && item.adr) {
    const gitSlug = owningRootGitSlug(item.adr.path);
    const namespace = owningRootNamespace(item.adr.path);
    ref = gitSlug
      ? buildCanonicalRef({ scope: 'repo', owner: gitSlug.owner, repo: gitSlug.repo, artifact: 'adr', number: item.adr.number })
      : namespace
        ? buildXProjectAdrRef({ namespace, number: item.adr.number })
        : buildLocalAdrRef({ number: item.adr.number });
  } else if (item.kind === 'question' && item.question) {
    const gitSlug = owningRootGitSlug(item.question.adrPath);
    const namespace = owningRootNamespace(item.question.adrPath);
    if (item.question.sourceKind === 'seed') {
      // No cross-project alias exists for seeds in ADR-0008's grammar
      // (XPROJECT_RE only ever resolves an ADR locator) — the canonical
      // form is the correct, already-ratified fallback, not an invented
      // extension to the alias grammar.
      ref = gitSlug
        ? buildCanonicalRef({ scope: 'repo', owner: gitSlug.owner, repo: gitSlug.repo, artifact: 'seed', seedSlug: seedSlugFromPath(item.question.adrPath), anchor: item.question.slug })
        : namespace
          ? buildCanonicalRef({ scope: 'project', namespace, artifact: 'seed', seedSlug: seedSlugFromPath(item.question.adrPath), anchor: item.question.slug })
          : buildLocalSeedRef(seedSlugFromPath(item.question.adrPath), item.question.slug);
    } else {
      ref = gitSlug
        ? buildCanonicalRef({ scope: 'repo', owner: gitSlug.owner, repo: gitSlug.repo, artifact: 'adr', number: item.question.adrNumber, anchor: item.question.slug })
        : namespace
          ? buildXProjectAdrRef({ namespace, number: item.question.adrNumber, anchor: item.question.slug })
          : buildLocalAdrRef({ number: item.question.adrNumber, anchor: item.question.slug });
    }
  } else if (item.kind === 'seed' && item.seed) {
    const gitSlug = owningRootGitSlug(item.seed.path);
    const namespace = owningRootNamespace(item.seed.path);
    ref = gitSlug
      ? buildCanonicalRef({ scope: 'repo', owner: gitSlug.owner, repo: gitSlug.repo, artifact: 'seed', seedSlug: seedSlugFromPath(item.seed.path) })
      : namespace
        ? buildCanonicalRef({ scope: 'project', namespace, artifact: 'seed', seedSlug: seedSlugFromPath(item.seed.path) })
        : buildLocalSeedRef(seedSlugFromPath(item.seed.path));
  }
  if (!ref) return;
  vscode.env.clipboard.writeText(ref);
  vscode.window.showInformationMessage(`Copied deep link: ${ref}`);
}

/**
 * Menu symmetry, same seed as copyDeepLink above: "copy path and copy
 * relative path... for the ADRs, the seeds, and the tours." Any tree item
 * with a resourceUri (adr/seed/root/tour) qualifies — not wired through
 * VS Code's built-in copyFilePath/copyRelativeFilePath commands, since
 * those expect a Uri argument directly and a view/item/context menu
 * command instead receives the TreeItem itself.
 */
function copyItemPath(item: import('./views/adrTreeProvider').AdrTreeItem): void {
  const fsPath = item.resourceUri?.fsPath;
  if (!fsPath) return;
  vscode.env.clipboard.writeText(fsPath);
}

function copyItemRelativePath(item: import('./views/adrTreeProvider').AdrTreeItem): void {
  const fsPath = item.resourceUri?.fsPath;
  const workspaceRoot = compositeIndex?.root.path;
  if (!fsPath || !workspaceRoot) return;
  vscode.env.clipboard.writeText(relativeRootPath(fsPath, workspaceRoot));
}

/**
 * The file a tree item is "about", for report-capture purposes (Gleaner's
 * spec §3): adr/seed/tour resolve via their own resourceUri; question and
 * tour-entry items resolve via question.adrPath — already the correct
 * path for BOTH ADR-owned and seed-owned questions, per the existing
 * navigation pattern (resolveQuestionClickCommand uses the same field).
 * Group headers/root/open-questions-header are not file-backed — undefined.
 */
function resolveReportFilePath(item: import('./views/adrTreeProvider').AdrTreeItem): string | undefined {
  if (item.kind === 'question' || item.kind === 'tour-entry') return item.question?.adrPath;
  if (item.kind === 'adr' || item.kind === 'seed' || item.kind === 'tour') return item.resourceUri?.fsPath;
  return undefined;
}

/**
 * Which ledger a tree-item report lands in (Gleaner's spec §5). File-backed
 * items use their own path (or their question's owning file); group
 * headers and 'root' have no natural file, so a path is synthesized whose
 * `dirname()` resolves to the right root's configured ADR directory —
 * never created, just a path errorLogPathFor can derive `.working/
 * errors.jsonl` from. Deviates from the spec's literal example
 * (hardcoded 'docs'/'adr') by reading the actual adrManager.adrDirectory
 * setting instead — this project respects that setting everywhere else a
 * root's ADR directory is resolved, and a report landing in the wrong
 * ledger for a workspace with a non-default directory would be a real,
 * silent bug.
 */
function resolveReportAnchorPath(item: import('./views/adrTreeProvider').AdrTreeItem, filePath: string | undefined): string | undefined {
  if (filePath) return filePath;
  const rootPath = item.rootNode?.path ?? compositeIndex?.root.path;
  if (!rootPath) return undefined;
  const adrDirRel = vscode.workspace.getConfiguration('adrManager', vscode.Uri.file(rootPath)).get<string>('adrDirectory', 'docs/adr');
  return path.join(rootPath, adrDirRel, '.tree-report-anchor');
}

/** The already-parsed questions for a file the tree already holds in memory — no re-parse (Gleaner's spec §4). */
function resolveReportOpenQuestions(filePath: string): Question[] | undefined {
  const node = compositeIndex?.findRoot(filePath);
  if (!node) return undefined;
  const adr = node.adrs.allAdrs().find(a => a.path === filePath);
  if (adr) return adr.questions;
  return node.seeds.allSeeds().find(s => s.path === filePath)?.questions;
}

/**
 * Tree-wide "most excellent report" (Jérémie's own words, 2026-08-06;
 * spec'd by Gleaner, docs/inbox/2026-08-06-0408-gleaner-to-fitter-tree-
 * wide-report-spec.md): "the same feature that enables that [panel Report]
 * button also enables... report for any of the items on the tree view."
 * Same input-box UX, same gate (adrManager.logging.observations — no new
 * setting; a context-menu entry doesn't need reportButton.enabled's
 * show/hide problem, it's always present, per the spec's own "last menu
 * item... for any of the items"), same error-record/2 shape, new
 * source: 'treeview'. Failure-soft: reporting a problem must never itself
 * become one.
 */
async function reportTreeItem(item: import('./views/adrTreeProvider').AdrTreeItem): Promise<void> {
  if (!vscode.workspace.getConfiguration('adrManager').get<boolean>('logging.observations', false)) {
    vscode.window.setStatusBarMessage('ADR Manager: Observation logging is turned off (adrManager.logging.observations).', 4000);
    return;
  }
  // Founder Report, moreover, 2026-10-04: "I was just typing something,
  // then there was an alert that took my focus and my draft in this
  // palette WAS CLOBBERED." VS Code's own documented default for
  // showInputBox: the box is dismissed (resolving to undefined, byte-
  // identical to Escape) the moment focus moves away from it — a
  // notification popping up, a window losing focus, anything — unless
  // `ignoreFocusOut: true` is set. Every showInputBox in this file and the
  // panel's own Report comment box had this gap; fixed in all of them.
  const note = await vscode.window.showInputBox({
    prompt: 'Report this tree item (optional comment) — captures the whole tree hierarchy, this item\'s file, and its open questions',
    placeHolder: 'What did you notice? (leave blank to just mark this moment)',
    ignoreFocusOut: true,
  });
  if (note === undefined) return; // Escape/cancel — nothing recorded

  try {
    const filePath = resolveReportFilePath(item);
    const anchorPath = resolveReportAnchorPath(item, filePath);
    if (!anchorPath) {
      // Gleaner's brief 2026-08-14: this was the exact "silently eats
      // itself" symptom — no anchor meant no ledger write and no toast,
      // with nothing left behind to diagnose it by. Log unconditionally so
      // the next occurrence has a trail, even though we still don't show
      // the user a toast here (a report that can't be anchored yet isn't
      // an error the user caused).
      outputChannel?.appendLine(`[report] no anchor path for item kind=${item.kind} id=${item.id ?? '(no id)'} — report dropped`);
      return;
    }

    const doc = filePath ? captureDocument(filePath) : undefined;
    const openQuestions = filePath
      ? resolveReportOpenQuestions(filePath)?.map(q => ({ id: q.id, text: q.text, status: q.statusText }))
      : undefined;

    const written = appendLedgerRecord({
      schema: 'error-record/2',
      ts: new Date().toISOString(),
      extensionVersion: vscode.extensions.getExtension('jlumbroso.adrs4ai')?.packageJSON?.version,
      source: 'treeview',
      kind: 'observation',
      message: note || 'manual tree-item report',
      anchorPath,
      payload: {
        clickedItemId: item.id,
        clickedItemKind: item.kind,
        note: note || undefined,
        treeHierarchy: treeProvider ? captureFullTree(treeProvider) : [],
        openQuestions,
      },
      documents: doc && filePath ? { [filePath]: doc } : undefined,
    });
    // appendLedgerRecord is failure-soft by contract — it RETURNS undefined
    // on a failed write instead of throwing. This line used to announce
    // success unconditionally, so an unwritable ledger produced a false
    // "Tree item reported." toast over a report that went nowhere: the
    // founding scar (a Report the reporter believed was collected, that was
    // not) reproduced inside the capture path itself. Found 2026-09-26
    // while answering Ribbon 5's "what must a conforming tool tell the
    // reporter" question (docs/inbox/2026-09-26-*-gleaner-to-ribbon-*).
    // registerLoggedCommand already checks this same return value.
    if (written) {
      vscode.window.setStatusBarMessage(`ADR Manager: Tree item reported — saved to ${describeLedgerLocation(written, compositeIndex?.findRoot(anchorPath)?.path)}`, 6000);
    } else {
      outputChannel?.appendLine(`[report] ledger write FAILED for item kind=${item.kind} id=${item.id ?? '(no id)'} anchor=${anchorPath} — reporter was warned`);
      vscode.window.showWarningMessage(`ADR Manager: your report was NOT saved (the error ledger for this project isn't writable) — nothing was recorded.${note ? ` Your note, so it isn't lost: "${note.slice(0, 300)}"` : ''}`);
    }
  } catch (err) {
    // failure-soft: reporting a problem must never itself become one — but
    // "never itself become one" doesn't mean "leave zero trace." Gleaner's
    // brief 2026-08-14: a root-item report vanished (no toast, no ledger
    // write, no error) and was unrecoverable from outside a debugger. Log
    // unconditionally, still no toast — a report failing is not something
    // to interrupt the user's flow over, but it must be diagnosable.
    outputChannel?.appendLine(`[report] reportTreeItem threw for item kind=${item?.kind ?? '(unknown)'} id=${item?.id ?? '(no id)'}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  }
}

/**
 * ADR-0025 Decision 1 mechanism 2, "Exclude this root" (Jérémie's design,
 * 2026-07-24 `0710`): "that's how things are discoverable, by making the
 * edit an option, like we did with .working." Only reachable on a `root`-
 * kind tree item, which only exists in the multi-root (N>1) case — there is
 * always at least one root left after excluding.
 *
 * Consent-surface preview before writing (house doctrine, same "never write
 * blind" discipline as the insertion-preview protocol): the modal shows the
 * exact relative path and the resulting file contents before anything is
 * written. Undo is a one-shot toast rather than a "shown-but-excluded
 * ghost" tree item — the latter isn't representable: an excluded root is
 * invisible to root discovery itself, so the composite index has no node
 * left to render as a ghost.
 */
async function excludeRoot(node: RootNode): Promise<void> {
  const workspaceRoot = compositeIndex?.root.path;
  if (!workspaceRoot) return;

  const cfg = vscode.workspace.getConfiguration('adrManager');
  const adrDirRel = cfg.get<string>('adrDirectory', 'docs/adr');
  const settingsDir = path.join(workspaceRoot, adrDirRel, '.settings');
  const rootsJsonPath = path.join(settingsDir, 'roots.json');
  const relPath = relativeRootPath(node.path, workspaceRoot);

  const readCurrentText = (): string | undefined =>
    fs.existsSync(rootsJsonPath) ? fs.readFileSync(rootsJsonPath, 'utf-8') : undefined;

  const proposed = addBlockEntry(readCurrentText(), relPath);
  if (!proposed.changed) {
    vscode.window.showInformationMessage(`"${node.namespace}" is already excluded.`);
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `Exclude "${node.namespace}" from ADR Explorer?`,
    {
      modal: true,
      detail: `Adds the exact path "${relPath}" to ${adrDirRel}/.settings/roots.json's block list (no globs — an exact path can't silently match the wrong thing). The file stays committed and auditable; this root won't reappear until the entry is removed.\n\nNew file contents:\n${proposed.text}`,
    },
    'Exclude',
  );
  if (choice !== 'Exclude') return;

  await vscode.workspace.fs.createDirectory(vscode.Uri.file(settingsDir));
  await vscode.workspace.fs.writeFile(vscode.Uri.file(rootsJsonPath), Buffer.from(proposed.text, 'utf-8'));
  if (watcherLifecycle) void watcherLifecycle.requestRefresh();

  const undo = await vscode.window.showInformationMessage(`Excluded "${node.namespace}" from ADR Explorer.`, 'Undo');
  if (undo !== 'Undo') return;

  const reverted = removeBlockEntry(readCurrentText(), relPath);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(rootsJsonPath), Buffer.from(reverted.text, 'utf-8'));
  if (watcherLifecycle) void watcherLifecycle.requestRefresh();
}

/**
 * ADR-0034 doctrine 5, "both mint": "turn my current filter into a tour."
 * Snapshots exactly what the sidebar tree's current filter (open/all/
 * answered — adrManager.filterQuestions) shows right now, across every
 * root, as an ordered ref list — no per-entry curation (disposition/
 * comment/answer_path are a richer, model-authored mint, not this v1
 * command's job). Namespace-qualified refs (`namespace.NNNN#slug`) once
 * more than one root is in play — a bare `adr:NNNN` is ambiguous the
 * moment two roots share a number, and mint-from-filter spans the whole
 * composite by construction.
 */
async function mintTourFromFilter(treeProvider: import('./views/adrTreeProvider').AdrTreeProvider, composite: CompositeIndex): Promise<void> {
  const filterMode = treeProvider.filterMode
  const matchesFilter = (isAnswered: boolean): boolean => {
    if (filterMode === 'all') return true
    if (filterMode === 'answered') return isAnswered
    return !isAnswered // 'open' (default)
  }

  const nodes = Array.from(composite.walk())
  const multiRoot = nodes.length > 1
  const refs: string[] = []
  for (const node of nodes) {
    for (const adr of node.adrs.allAdrs().filter(a => !a.isSeed)) {
      for (const q of adr.questions.filter(qq => matchesFilter(qq.isAnswered))) {
        const prefix = multiRoot ? `${node.namespace}.${adr.number}` : `adr:${String(adr.number).padStart(4, '0')}`
        refs.push(`${prefix}#${q.slug}`)
      }
    }
  }

  if (refs.length === 0) {
    vscode.window.showInformationMessage(`No questions match the sidebar's current filter (${filterMode}) — nothing to mint.`)
    return
  }

  const title = await vscode.window.showInputBox({
    prompt: `Mint a tour from ${refs.length} currently-visible question${refs.length === 1 ? '' : 's'} (filter: ${filterMode})`,
    placeHolder: 'Tour title (e.g., "Morning brief — the four things waiting on you")',
    ignoreFocusOut: true,
  })
  if (!title) return

  const workspaceRoot = composite.root.path
  const cfg = vscode.workspace.getConfiguration('adrManager')
  const adrDirRel = cfg.get<string>('adrDirectory', 'docs/adr')
  const humanName = cfg.get<string>('humanName', '') || 'Human'
  const mintedAt = new Date().toISOString()
  const mintedCommit = tryGitRevParseHead(workspaceRoot)

  // ---------------------------------------------------------------------
  // THE MINT GATE (ADR-0034 iter-11 item 3; doctrine 8's branch (b)).
  //
  // This is the code path that produced the founder's worst tours. Until now
  // it wrote whatever the sidebar filter happened to contain, silently. Two
  // incidents came through here:
  //   - 2026-08-14: stops with no recommendation, rendering as blank walls
  //     ("is this citing the question, or creating a new one?").
  //   - 2026-08-24: two stops he had ANSWERED on 08-08, under stale Status
  //     lines — a booked deep-focus slot spent on settled work.
  //
  // `assessTour` is the same predicate `tour-walk` calls, so the surfaces
  // cannot drift into separate definitions of "ready". It never blocks on a
  // judgment a machine cannot make: `staleAnswered` and `unprepared` are
  // stated OUT LOUD and the human decides. That is doctrine 8's branch (b)
  // exactly — "the mint must say so out loud" — not a weaker form of it.
  // ---------------------------------------------------------------------
  let mintRefs = refs
  const draft = buildTourJson({ title, authorName: humanName, mintedAt, mintedCommit, entries: refs.map(ref => ({ ref })) })
  const assessed = assessTour(resolveTourEntries(draft, createRepositoryContextAdapter(composite)))

  const staleCount = assessed.staleAnswered.length
  const unpreparedCount = assessed.unprepared.length
  if (staleCount > 0 || unpreparedCount > 0) {
    const detail: string[] = []
    // Stale leads, and gets the one-click remedy: it is the only class that
    // costs a booked slot rather than merely reading poorly.
    if (staleCount > 0) detail.push(`${staleCount} stop${staleCount === 1 ? '' : 's'} already carry an answer under an "unanswered" status line — walking these spends your attention on settled work.`)
    if (unpreparedCount > 0) detail.push(`${unpreparedCount} stop${unpreparedCount === 1 ? '' : 's'} have no recommendation in the source document.`)
    detail.push('', 'A tour is ready when someone has walked it and found nothing wrong.')

    const actions = staleCount > 0 ? ['Drop the answered stops', 'Mint anyway'] : ['Mint anyway']
    const choice = await vscode.window.showWarningMessage(
      `"${title}" will render ${staleCount > 0 ? 'settled work and ' : ''}unprepared stops.`,
      { modal: true, detail: detail.join('\n') },
      ...actions,
    )
    if (!choice) return // cancelled — the default, and the safe one
    if (choice === 'Drop the answered stops') {
      const staleRefs = new Set(assessed.stops.filter(s => s.assessment.staleAnswered).map(s => s.entry.ref))
      mintRefs = refs.filter(r => !staleRefs.has(r))
      if (mintRefs.length === 0) {
        vscode.window.showInformationMessage('Every stop was already answered — nothing left to mint.')
        return
      }
    }
  }

  const tour = buildTourJson({
    title,
    authorName: humanName,
    mintedAt,
    mintedCommit,
    entries: mintRefs.map(ref => ({ ref })),
  })
  const filename = tourFilename(title, mintedAt.slice(0, 10))
  const filePath = tourFilePath(path.join(workspaceRoot, adrDirRel), filename)

  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(filePath)))
  await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(serializeTourJson(tour), 'utf-8'))
  if (watcherLifecycle) void watcherLifecycle.requestRefresh();

  const openNow = await vscode.window.showInformationMessage(`Minted "${title}" (${mintRefs.length} entries) to ${adrDirRel}/tours/${filename}.`, 'Walk it now')
  if (openNow === 'Walk it now') OpenQuestionsPanel.createOrShow(composite, filename.replace(/\.tour\.json$/, ''))
}

/**
 * "Add Thread Turn" (Lapidary's 2026-07-31 founder-escalation dispatch —
 * third ask on the same pain, Jérémie's own word for it: "trauma"). One
 * gesture appends a correctly-scaffolded, attributed turn + fresh Model
 * Response Request block, cursor left on the blank content line so typing
 * can start immediately — nobody hand-authors MRR checkboxes, the
 * Instructions-for-Model tail, or gets a `##` vs `###` heading level wrong
 * again. `item` is the right-clicked sidebar seed item when invoked from
 * the tree's context menu; falls back to the active editor's document
 * when invoked from the Command Palette with no argument.
 */
async function addSeedThreadTurn(item?: import('./views/adrTreeProvider').AdrTreeItem): Promise<void> {
  const seedPath = item?.seed?.path ?? vscode.window.activeTextEditor?.document.uri.fsPath;
  if (!seedPath || !isSeedBasename(path.basename(seedPath))) {
    vscode.window.showErrorMessage('ADR Manager: Add Thread Turn only works on a seed file — open one, or right-click a seed in the sidebar.');
    return;
  }

  const uri = vscode.Uri.file(seedPath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const content = doc.getText();

  const cfg = vscode.workspace.getConfiguration('adrManager');
  const humanName = cfg.get<string>('humanName', '') || 'Human';
  const today = new Date().toISOString().slice(0, 10);
  const plan = planSeedThreadTurnInsertion(content, humanName, today);

  const edit = new vscode.WorkspaceEdit();
  edit.insert(uri, new vscode.Position(plan.insertLineIndex, 0), plan.text);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    const message = `Could not insert a new Thread turn into ${seedPath}.`;
    vscode.window.showErrorMessage(`ADR Manager: ${message}`);
    // Gleaner's brief (2026-08-13): same class as commitOneRoot's own
    // gap — a command-handler catch/rejection that only toasted, never
    // logged, structurally identical to the panel's own already-correct
    // 'workspace-edit-rejected' harvest. Failure-soft, same contract.
    try {
      appendLedgerRecord({
        schema: 'error-record/2',
        ts: new Date().toISOString(),
        extensionVersion: vscode.extensions.getExtension('jlumbroso.adrs4ai')?.packageJSON?.version,
        source: 'treeview',
        kind: 'workspace-edit-rejected',
        message,
        anchorPath: seedPath,
        payload: { plannedInsertLine: plan.insertLineIndex, plannedText: plan.text },
        documents: (() => { const d = captureDocument(seedPath); return d ? { [seedPath]: d } : undefined })(),
      })
    } catch { /* failure-soft: never let the audit trail take down this command's own error path */ }
    return;
  }

  const editor = await vscode.window.showTextDocument(doc);
  const cursorLine = plan.insertLineIndex + plan.cursorLineOffset;
  const pos = new vscode.Position(cursorLine, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

/** Best-effort HEAD commit for a tour's minted_commit provenance — never blocks minting on git being absent, uncommitted, or unavailable. */
function tryGitRevParseHead(cwd: string): string | undefined {
  try {
    return execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf-8' }).trim() || undefined
  } catch {
    return undefined
  }
}
