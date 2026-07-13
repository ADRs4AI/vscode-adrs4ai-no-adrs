/**
 * ADRs for AI — VS Code Extension Entry Point
 *
 * Forma 1: Parser + ActivityBar sidebar tree view + status bar + file watcher.
 *
 * Activation: triggered when the workspace contains docs/adr/*.md files.
 * Lazy init: the ADR index is populated when the sidebar is first revealed,
 * not on activation (avoids startup overhead per ADR-0004 performance note).
 */

import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { AdrIndex } from './index/adrIndex'
import { SeedIndex, findReferencingAdrs } from './index/seedIndex'
import { CompositeIndex } from './index/compositeIndex'
import { computeNamespace } from './index/rootNode'
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

let index: AdrIndex | undefined;
let seedIndex: SeedIndex | undefined;
/**
 * ADR-0025 panel-aggregation (Option A): a trivial (N=1, no filesystem
 * scan) wrap of the SAME `index`/`seedIndex` singletons above — NOT a
 * replacement for them, and NOT the "full activation rewiring" (module
 * singletons → CompositeIndex, per-root watchers) that Lapidary's work
 * order scoped out pending Cairn's three shaped QSTs (watcher lifecycle,
 * creation-target root, deep-link copy format). This just gives the panel
 * a CompositeIndex-shaped seam to build against now, ready for the moment
 * a real multi-root scan replaces `wrapSingle` with `fromWorkspace` —
 * without the panel itself needing to change again when that lands.
 */
let compositeIndex: CompositeIndex | undefined;
let treeProvider: AdrTreeProvider | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let fileWatcher: vscode.FileSystemWatcher | undefined;
let seedFileWatcher: vscode.FileSystemWatcher | undefined;
let diagnosticCollection: vscode.DiagnosticCollection | undefined;

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

  // Create the indices (no files parsed yet — lazy init)
  index = new AdrIndex();
  seedIndex = new SeedIndex();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const namespace = workspaceRoot ? computeNamespace(workspaceRoot) : 'project';
  compositeIndex = CompositeIndex.wrapSingle(workspaceRoot ?? '', index, seedIndex, namespace);
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

  // Whenever the index changes, refresh diagnostics for all indexed ADRs
  index.onChange(event => {
    if (!diagnosticCollection) return;
    if (event.type === 'removed') {
      diagnosticCollection.delete(vscode.Uri.file(event.adrPath));
    } else {
      updateDiagnostics(diagnosticCollection, event.adr);
    }
    // ADR-0016: an ADR add/update may be the first cross-reference that
    // resolves a seed's SEED_INCOMPLETE — recompute seed diagnostics too.
    updateAllSeedDiagnostics(diagnosticCollection, seedIndex!, index!);
  });

  // ADR-0016 SEED_INCOMPLETE: recompute whenever the seed index changes
  // (scoped to the current workspace only — Iteration 3 scoping note).
  seedIndex.onChange(() => {
    if (!diagnosticCollection) return;
    updateAllSeedDiagnostics(diagnosticCollection, seedIndex!, index!);
  });

  // ── Status bar item ──────────────────────────────────────────────────────
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'adrManager.open';
  statusBarItem.tooltip = `Open ADR Explorer (ADR Manager v${runningVersion})`;
  statusBarItem.text = 'ADRs: …';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // ── Tree view ────────────────────────────────────────────────────────────
  const treeView = vscode.window.createTreeView('adrExplorer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Update status bar whenever index changes
  index.onChange(() => {
    if (statusBarItem) {
      statusBarItem.text = `$(file-text) ${index!.statusBarText}`;
    }
  });

  // ── Commands ─────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('adrManager.open', () => {
      vscode.commands.executeCommand('adrExplorer.focus');
    }),

    vscode.commands.registerCommand('adrManager.refresh', () => {
      reindexWorkspace(index!, seedIndex!, adrDir);
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

          const adr = index?.allAdrs().find(a => a.path === document.uri.fsPath);
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

  // ── File watchers ─────────────────────────────────────────────────────────
  setupFileWatcher(context, index, adrDir);
  setupSeedFileWatcher(context, seedIndex, adrDir);
  setupBufferChangeTrigger(context, index, seedIndex);

  // ── Initial index population ──────────────────────────────────────────────
  // Trigger when the sidebar is first revealed (lazy) OR immediately if already visible
  treeView.onDidChangeVisibility(e => {
    if (e.visible && index!.size === 0) {
      reindexWorkspace(index!, seedIndex!, adrDir);
    }
  }, null, context.subscriptions);

  // Also index now if workspace is already open (common case: extension installed in existing project)
  reindexWorkspace(index, seedIndex, adrDir);
}

// ---------------------------------------------------------------------------
// Deactivation
// ---------------------------------------------------------------------------

export function deactivate(): void {
  fileWatcher?.dispose();
  fileWatcher = undefined;
  seedFileWatcher?.dispose();
  seedFileWatcher = undefined;
}

// ---------------------------------------------------------------------------
// Workspace indexing
// ---------------------------------------------------------------------------

async function reindexWorkspace(idx: AdrIndex, sidx: SeedIndex, adrDirRel: string): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return;

  for (const folder of workspaceFolders) {
    const adrDir = path.join(folder.uri.fsPath, adrDirRel);
    await idx.indexDirectory(adrDir);
    await sidx.indexDirectory(adrDir);
  }
}

// ---------------------------------------------------------------------------
// File watcher setup
// ---------------------------------------------------------------------------

function setupFileWatcher(
  context: vscode.ExtensionContext,
  idx: AdrIndex,
  adrDirRel: string,
): void {
  const pattern = new vscode.RelativePattern(
    vscode.workspace.workspaceFolders?.[0] ?? '',
    `${adrDirRel}/*.md`,
  );

  fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

  fileWatcher.onDidCreate(uri => {
    if (isAdrFile(uri.fsPath)) idx.indexFile(uri.fsPath);
  }, null, context.subscriptions);

  fileWatcher.onDidChange(uri => {
    if (isAdrFile(uri.fsPath)) idx.indexFile(uri.fsPath);
  }, null, context.subscriptions);

  fileWatcher.onDidDelete(uri => {
    idx.removeFile(uri.fsPath);
  }, null, context.subscriptions);

  context.subscriptions.push(fileWatcher);
}

function isAdrFile(filePath: string): boolean {
  // Match ADR files (one-or-more-digits followed by - or _ then title.md).
  // ADR-0012: Accept any digit count, not just 4 digits (3-digit projects are real).
  // Exclude seed files (seed-YYYY-MM-DD-title.md) which are indexed separately.
  const base = path.basename(filePath);
  return /^\d+[-_].+\.md$/.test(base) && !base.startsWith('seed-');
}

function isSeedFile(filePath: string): boolean {
  return path.basename(filePath).startsWith('seed-') && filePath.endsWith('.md');
}

function setupSeedFileWatcher(
  context: vscode.ExtensionContext,
  sidx: SeedIndex,
  adrDirRel: string,
): void {
  const pattern = new vscode.RelativePattern(
    vscode.workspace.workspaceFolders?.[0] ?? '',
    `${adrDirRel}/seed-*.md`,
  );

  seedFileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

  seedFileWatcher.onDidCreate(uri => {
    if (isSeedFile(uri.fsPath)) sidx.indexFile(uri.fsPath);
  }, null, context.subscriptions);

  seedFileWatcher.onDidChange(uri => {
    if (isSeedFile(uri.fsPath)) sidx.indexFile(uri.fsPath);
  }, null, context.subscriptions);

  seedFileWatcher.onDidDelete(uri => {
    sidx.removeFile(uri.fsPath);
  }, null, context.subscriptions);

  context.subscriptions.push(seedFileWatcher);
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
  idx: AdrIndex,
  sidx: SeedIndex,
): void {
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const disposable = vscode.workspace.onDidChangeTextDocument(event => {
    const filePath = event.document.uri.fsPath;
    const isAdr = isAdrFile(filePath);
    const isSeed = !isAdr && isSeedFile(filePath);
    if (!isAdr && !isSeed) return;

    const existing = debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    debounceTimers.set(filePath, setTimeout(() => {
      debounceTimers.delete(filePath);
      const content = event.document.getText();
      if (isAdr) idx.indexContent(filePath, content);
      else sidx.indexContent(filePath, content);
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
  // save nudged the watcher).
  index?.indexFile(item.adr.path);
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
