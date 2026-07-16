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
import * as path from 'path'
import * as fs from 'fs'
import { AdrIndex } from './index/adrIndex'
import { SeedIndex, findReferencingAdrs } from './index/seedIndex'
import { CompositeIndex } from './index/compositeIndex'
import { isAdrBasename, isSeedBasename, isDirectChildOf } from './index/fileGuards'
import { startRootWatcherLifecycle, type RootWatcherLifecycleController } from './watchers/rootWatcherLifecycle'
import { AdrTreeProvider } from './views/adrTreeProvider'
import { AdrDocumentLinkProvider, registerOpenDeepLinkCommand } from './views/documentLinkProvider'
import { createRepositoryContextAdapter } from './index/repositoryContextAdapter'
import { resolveReference } from './mcp/reference'
import { OpenQuestionsPanel } from './webview/openQuestionsPanel'
import { ADR_STATUSES } from './parser/statusInfo'
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
import { buildAdrCommitMessage } from './commit/commitMessage'
import { resolveWorkspaceRepository } from './commit/repositoryResolution'
import { summarizeCommittedArtifacts } from './commit/artifactClassifier'
import { generateSeedTemplate } from './creation/seedTemplate'

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
  const outputChannel = vscode.window.createOutputChannel('ADR Manager');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine(`ADR Manager v${runningVersion} activated at ${new Date().toISOString()}`);

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
      (event, node) => outputChannel.appendLine(`[${event}] ${node.namespace} (${node.path})`),
      refreshed => { compositeIndex = refreshed; onCompositeRefreshed(diagnosticCollection); },
    );
    compositeIndex = watcherLifecycle.composite;
  } else {
    compositeIndex = CompositeIndex.wrapSingle('', new AdrIndex(), new SeedIndex());
  }
  index = compositeIndex.root.adrs;
  seedIndex = compositeIndex.root.seeds;
  treeProvider = new AdrTreeProvider(index, seedIndex);

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
  const treeView = vscode.window.createTreeView('adrExplorer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // ── Commands ─────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('adrManager.open', () => {
      vscode.commands.executeCommand('adrExplorer.focus');
    }),

    vscode.commands.registerCommand('adrManager.refresh', () => {
      // Prefer a full rediscovery (picks up new/removed roots too) when a
      // live watcher lifecycle exists; fall back to a content-only
      // re-parse of already-known roots otherwise (no-workspace edge case).
      if (watcherLifecycle) void watcherLifecycle.requestRefresh();
      else if (compositeIndex) reindexWorkspace(compositeIndex, adrDir);
    }),

    vscode.commands.registerCommand('adrManager.showVersion', () => {
      vscode.window.showInformationMessage(`ADR Manager v${runningVersion}`);
      outputChannel.show();
    }),

    vscode.commands.registerCommand('adrManager.openAdr', (filePath: string, lineNumber?: number) => {
      openAdrFile(filePath, lineNumber);
    }),

    vscode.commands.registerCommand('adrManager.createAdr', () => {
      createNewAdr(adrDir);
    }),

    vscode.commands.registerCommand('adrManager.commitAdrs', () => {
      commitAdrChanges(adrDir);
    }),

    vscode.commands.registerCommand('adrManager.copyDeepLink', (item) => {
      copyDeepLink(item);
    }),

    vscode.languages.registerDocumentLinkProvider({ language: 'markdown' }, new AdrDocumentLinkProvider()),
    registerOpenDeepLinkCommand(resolveLink),

    vscode.commands.registerCommand('adrManager.openQuestionsPanel', () => {
      if (compositeIndex) OpenQuestionsPanel.createOrShow(compositeIndex);
    }),

    vscode.commands.registerCommand('adrManager.filterQuestions', () => {
      if (treeProvider) filterQuestions(treeProvider);
    }),

    vscode.commands.registerCommand('adrManager.changeStatus', (item) => {
      if (item?.adr) changeAdrStatus(item);
    }),

    vscode.commands.registerCommand('adrManager.goToQuestionInPanel', (item) => {
      if (item?.question && compositeIndex) {
        OpenQuestionsPanel.createOrShow(compositeIndex);
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
          const { patches } = normalizerCoordinator.processAll(content, adr);
          if (patches.length === 0) return [];

          const label = `Normalize to collab-adr-lean format (${patches.length} fix${patches.length > 1 ? 'es' : ''})`;
          const action = new vscode.CodeAction(label, vscode.CodeActionKind.QuickFix);
          action.diagnostics = normDiags;
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

          return [action];
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),

    vscode.commands.registerCommand('adrManager.goToAnswerInFile', (item) => {
      if (item?.question) {
        const line = item.question.answer?.line ?? item.question.lineStart;
        openAdrFile(item.question.adrPath, line);
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

/** Aggregate ADR count + open-question count across every discovered root. */
function updateStatusBarText(): void {
  if (!statusBarItem || !compositeIndex) return;
  const adrCount = compositeIndex.allAdrs().length;
  const openCount = compositeIndex.allAdrs()
    .flatMap(a => a.questions)
    .filter(q => !q.isAnswered).length
    + compositeIndex.allSeeds().flatMap(s => s.questions).filter(q => !q.isAnswered).length;
  statusBarItem.text = `$(file-text) ADRs: ${adrCount}${openCount > 0 ? ` | ? ${openCount}` : ''}`;
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
    });
    const unsubSeeds = node.seeds.onChange(() => {
      updateAllSeedDiagnostics(collection, node.seeds, node.adrs);
    });
    disposables.push({ dispose: unsubAdrs }, { dispose: unsubSeeds });
  }
  return { dispose: () => { for (const d of disposables) d.dispose(); } };
}

/**
 * Called after watcherLifecycle rebuilds the composite (a root-set change —
 * .settings/roots.json edited, an .adrignore marker created/removed).
 * Re-points the top-root aliases, re-subscribes diagnostics against the new
 * node set, and refreshes the status bar, plus one explicit diagnostics
 * pass (same reasoning as activate()'s initial pass — the rebuild's own
 * indexDirectory() calls happened before anything new was subscribed to
 * hear them).
 *
 * Known gap, not fixed here: `treeProvider` is NOT updated. It was
 * constructed once with the top root's AdrIndex/SeedIndex instances
 * (AdrTreeProvider has no API to swap them post-construction, and it only
 * ever renders the top root anyway — the Linear Multi-Root Tree Projection,
 * ADR-0025 Decision 4, is its own follow-up pass, not this one). A root-set
 * change is rare relative to routine file edits — .settings/roots.json
 * edits or .adrignore markers, not everyday saves — so the tree view
 * staying frozen at its pre-refresh state until that pass lands (or a
 * window reload) is an accepted, honest limitation, not a silent bug.
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
  }
  // Flint 5's review finding (2026-07-16): compositeIndex.onChange() is a
  // one-time subscription against the node instances live at call time, not
  // a live aggregate — must be re-subscribed against the NEW composite here,
  // same as diagnosticsSubscription just above, or the status bar silently
  // freezes after every root-set refresh for the rest of the session.
  statusBarSubscription?.();
  statusBarSubscription = compositeIndex.onChange(updateStatusBarText);
  updateStatusBarText();
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

async function createNewAdr(adrDirRel: string): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('ADR Manager: No workspace folder open.');
    return;
  }

  const kind = await vscode.window.showQuickPick([
    { label: '$(file-text) New ADR', description: 'Full collab-adr-lean template with questions', value: 'adr' as const },
    { label: '$(edit) New Seed', description: 'Brain dump — AI will chunk into ADRs', value: 'seed' as const },
  ], { title: 'What would you like to create?', placeHolder: 'Select type' });
  if (!kind) return;

  const promptLabel = kind.value === 'adr'
    ? 'ADR title (e.g., "Use SQLite for local ADR index")'
    : 'Seed topic (e.g., "Auth strategy thoughts")';

  const title = await vscode.window.showInputBox({
    prompt: promptLabel,
    placeHolder: kind.value === 'adr' ? 'Decision title' : 'Topic',
  });

  if (!title) return;

  const adrDir = path.join(workspaceFolder.uri.fsPath, adrDirRel);
  const slug = title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);

  // Seeds use date-prefixed filenames (seed-YYYY-MM-DD-slug.md), NOT sequential numbers.
  // ADR numbers are permanent slots for decisions; seeds are transient pre-decisional artifacts.
  const today = new Date().toISOString().split('T')[0];
  const filename = kind.value === 'seed'
    ? `seed-${today}-${slug}.md`
    : `${String(determineNextNumber(adrDir)).padStart(4, '0')}-${slug}.md`;
  const filePath = path.join(adrDir, filename);

  const cfg = vscode.workspace.getConfiguration('adrManager');
  const humanName = cfg.get<string>('humanName', '') || 'Human';
  const aiModel = cfg.get<string>('aiModel', 'Sonnet 4.6 (1M)');
  const template = kind.value === 'seed'
    ? generateSeedTemplate(title, today, humanName)
    : generateAdrTemplate(title, today, humanName, aiModel);

  const uri = vscode.Uri.file(filePath);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(template, 'utf-8'));
  await openAdrFile(filePath);
}

function determineNextNumber(adrDir: string): number {
  if (!index || index.size === 0) return 1;
  const max = Math.max(...index.allAdrs().map(a => a.number));
  return max + 1;
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
- Template: collab-adr-lean v3.1
`;
}

async function commitAdrChanges(adrDirRel: string): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;

  const adrDir = path.join(workspaceFolder.uri.fsPath, adrDirRel);
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (!gitExtension) {
    vscode.window.showErrorMessage('ADR Manager: Git extension not found.');
    return;
  }

  const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
  const api = git.getAPI(1);
  // DEBRIEF-002: api.repositories[0] is a positional first-approximation —
  // there is no defined relationship between repository-discovery order and
  // workspace-folder order, so in a real multi-repo workspace (HQ + several
  // submodules) it can silently resolve to the wrong repo. Ask for the
  // repository that owns THIS workspace folder's URI instead of guessing.
  const repo = resolveWorkspaceRepository<any>(api, workspaceFolder.uri); // eslint-disable-line @typescript-eslint/no-explicit-any -- api/repo come from the untyped vscode.git extension API, same dynamic typing as before this fix
  if (!repo) {
    vscode.window.showErrorMessage('ADR Manager: No git repository found.');
    return;
  }

  // Stage only files in the ADR directory
  const changes = [
    ...repo.state.workingTreeChanges,
    ...repo.state.indexChanges,
  ].filter(c => c.uri.fsPath.startsWith(adrDir));

  if (changes.length === 0) {
    vscode.window.showInformationMessage('ADR Manager: No ADR changes to commit.');
    return;
  }

  const message = await vscode.window.showInputBox({
    prompt: 'Commit message for ADR changes',
    value: buildAdrCommitMessage(changes.map(c => c.uri.fsPath)),
    placeHolder: 'docs: commit message',
  });
  if (!message) return;

  try {
    // Stage the ADR files
    await repo.add(changes.map(c => c.uri.fsPath));
    // Commit
    await repo.commit(message);

    // Jérémie's report (2026-07-12): every staged path used to get called
    // an "ADR" in this confirmation, including docs/adr/.working/* draft
    // state — not a decision record. Classify instead of counting blind.
    const summary = summarizeCommittedArtifacts(changes.map(c => c.uri.fsPath));
    vscode.window.showInformationMessage(`ADR Manager: Committed ${summary}.`);
  } catch (err) {
    vscode.window.showErrorMessage(`ADR Manager: Commit failed — ${err}`);
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

function copyDeepLink(item: import('./views/adrTreeProvider').AdrTreeItem): void {
  if (item.kind === 'adr' && item.adr) {
    const ref = `adr:${String(item.adr.number).padStart(4, '0')}`;
    vscode.env.clipboard.writeText(ref);
    vscode.window.showInformationMessage(`Copied deep link: ${ref}`);
  } else if (item.kind === 'question' && item.question) {
    const ref = `adr:${String(item.question.adrNumber).padStart(4, '0')}#${item.question.slug}`;
    vscode.env.clipboard.writeText(ref);
    vscode.window.showInformationMessage(`Copied deep link: ${ref}`);
  }
}
