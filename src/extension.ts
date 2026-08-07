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
import { execSync } from 'child_process'
import { AdrIndex } from './index/adrIndex'
import { SeedIndex, findReferencingAdrs } from './index/seedIndex'
import { CompositeIndex } from './index/compositeIndex'
import { isAdrBasename, isSeedBasename, isDirectChildOf } from './index/fileGuards'
import { startRootWatcherLifecycle, type RootWatcherLifecycleController } from './watchers/rootWatcherLifecycle'
import { AdrTreeProvider, captureFullTree, type AdrTreeItem } from './views/adrTreeProvider'
import { appendLedgerRecord, captureDocument } from './drafts/errorLog'
import { aggregateOpenQuestionCount, QUESTION_SOURCES, type SourceInclusion } from './index/questionSource'
import { addBlockEntry, removeBlockEntry, relativeRootPath } from './index/rootsConfigWriter'
import { buildLocalAdrRef, buildLocalSeedRef, seedSlugFromPath } from './deeplink/protocol'
import { buildTourJson, serializeTourJson, tourFilename, tourFilePath } from './index/tourWriter'
import type { RootNode } from './index/compositeIndex'
import type { Question } from './parser/types'
import { AdrDocumentLinkProvider, registerOpenDeepLinkCommand } from './views/documentLinkProvider'
import { createRepositoryContextAdapter } from './index/repositoryContextAdapter'
import { resolveTourEntries, unresolvedTourRefs } from './index/tourIndex'
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
import { buildAdrCommitMessage, type ChangedFile } from './commit/commitMessage'
import { isNewGitStatus, groupChangesByOwningRoot } from './commit/repositoryResolution'
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

    // "The collapse-all trap" (Jérémie, verbatim, 2026-07-22): "when you
    // make the mistake of collapsing everything, you have to manually
    // re-expand it." No native expandAll counterpart to showCollapseAll
    // exists in the VS Code API — implemented via recursive reveal() with
    // expand:3 (the API's own cap) over every top-level item, which covers
    // this tree's actual depth (root -> ADR/seed -> question). A reveal()
    // failure on any one item degrades gracefully — expand what's
    // reachable, never surface an error for what's cosmetic.
    vscode.commands.registerCommand('adrManager.expandAll', async () => {
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

    vscode.commands.registerCommand('adrManager.showVersion', () => {
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

    vscode.commands.registerCommand('adrManager.copyPath', (item) => {
      copyItemPath(item);
    }),

    vscode.commands.registerCommand('adrManager.copyRelativePath', (item) => {
      copyItemRelativePath(item);
    }),

    vscode.commands.registerCommand('adrManager.reportTreeItem', async (item) => {
      if (item) await reportTreeItem(item);
    }),

    vscode.commands.registerCommand('adrManager.excludeRoot', async (item) => {
      if (item?.rootNode) await excludeRoot(item.rootNode);
    }),

    vscode.commands.registerCommand('adrManager.mintTourFromFilter', async () => {
      if (treeProvider && compositeIndex) await mintTourFromFilter(treeProvider, compositeIndex);
    }),

    // seeds-as-issues minimum lovable slice (Lapidary's 2026-07-31
    // founder-escalation dispatch): one gesture appends a correctly-
    // scaffolded, attributed Thread turn — from the sidebar's right-click
    // on a seed, or the Command Palette against whichever seed is the
    // active editor.
    vscode.commands.registerCommand('adrManager.addSeedThreadTurn', async (item) => {
      await addSeedThreadTurn(item);
    }),

    vscode.languages.registerDocumentLinkProvider({ language: 'markdown' }, new AdrDocumentLinkProvider()),
    registerOpenDeepLinkCommand(resolveLink),

    // ADR-0034: tour tree items pass their slug as the first argument
    // ("Walk Tour" command) — the plain sidebar/toolbar invocation passes
    // none, opening the ordinary full walk.
    vscode.commands.registerCommand('adrManager.openQuestionsPanel', (tourSlug?: string) => {
      if (compositeIndex) OpenQuestionsPanel.createOrShow(compositeIndex, tourSlug);
    }),

    vscode.commands.registerCommand('adrManager.filterQuestions', () => {
      if (treeProvider) filterQuestions(treeProvider);
    }),

    vscode.commands.registerCommand('adrManager.changeStatus', (item) => {
      if (item?.adr) changeAdrStatus(item);
    }),

    vscode.commands.registerCommand('adrManager.goToQuestionInPanel', (item) => {
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
 */
async function commitAdrChanges(adrDirRel: string): Promise<void> {
  if (!compositeIndex) return;

  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (!gitExtension) {
    vscode.window.showErrorMessage('ADR Manager: Git extension not found.');
    return;
  }
  const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
  const api = git.getAPI(1);

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
function copyDeepLink(item: import('./views/adrTreeProvider').AdrTreeItem): void {
  let ref: string | undefined;
  if (item.kind === 'adr' && item.adr) {
    ref = buildLocalAdrRef({ number: item.adr.number });
  } else if (item.kind === 'question' && item.question) {
    ref = item.question.sourceKind === 'seed'
      ? buildLocalSeedRef(seedSlugFromPath(item.question.adrPath), item.question.slug)
      : buildLocalAdrRef({ number: item.question.adrNumber, anchor: item.question.slug });
  } else if (item.kind === 'seed' && item.seed) {
    ref = buildLocalSeedRef(seedSlugFromPath(item.seed.path));
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
  if (!vscode.workspace.getConfiguration('adrManager').get<boolean>('logging.observations', true)) {
    vscode.window.setStatusBarMessage('ADR Manager: Observation logging is turned off (adrManager.logging.observations).', 4000);
    return;
  }
  const note = await vscode.window.showInputBox({
    prompt: 'Report this tree item (optional comment) — captures the whole tree hierarchy, this item\'s file, and its open questions',
    placeHolder: 'What did you notice? (leave blank to just mark this moment)',
  });
  if (note === undefined) return; // Escape/cancel — nothing recorded

  try {
    const filePath = resolveReportFilePath(item);
    const anchorPath = resolveReportAnchorPath(item, filePath);
    if (!anchorPath) return;

    const doc = filePath ? captureDocument(filePath) : undefined;
    const openQuestions = filePath
      ? resolveReportOpenQuestions(filePath)?.map(q => ({ id: q.id, text: q.text, status: q.statusText }))
      : undefined;

    appendLedgerRecord({
      schema: 'error-record/2',
      ts: new Date().toISOString(),
      extensionVersion: vscode.extensions.getExtension('jlumbroso.adrs-for-ai')?.packageJSON?.version,
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
    vscode.window.setStatusBarMessage('ADR Manager: Tree item reported.', 3000);
  } catch {
    /* failure-soft: reporting a problem must never itself become one */
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
  })
  if (!title) return

  const workspaceRoot = composite.root.path
  const cfg = vscode.workspace.getConfiguration('adrManager')
  const adrDirRel = cfg.get<string>('adrDirectory', 'docs/adr')
  const humanName = cfg.get<string>('humanName', '') || 'Human'
  const mintedAt = new Date().toISOString()
  const mintedCommit = tryGitRevParseHead(workspaceRoot)

  const tour = buildTourJson({
    title,
    authorName: humanName,
    mintedAt,
    mintedCommit,
    entries: refs.map(ref => ({ ref })),
  })
  const filename = tourFilename(title, mintedAt.slice(0, 10))
  const filePath = tourFilePath(path.join(workspaceRoot, adrDirRel), filename)

  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(filePath)))
  await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(serializeTourJson(tour), 'utf-8'))
  if (watcherLifecycle) void watcherLifecycle.requestRefresh();

  const openNow = await vscode.window.showInformationMessage(`Minted "${title}" (${refs.length} entries) to ${adrDirRel}/tours/${filename}.`, 'Walk it now')
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
    vscode.window.showErrorMessage(`ADR Manager: Could not insert a new Thread turn into ${seedPath}.`);
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
