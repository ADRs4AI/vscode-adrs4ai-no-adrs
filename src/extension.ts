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
import { AdrTreeProvider } from './views/adrTreeProvider'
import { OpenQuestionsPanel } from './webview/openQuestionsPanel'
import { ADR_STATUSES } from './parser/statusInfo'
import { Coordinator } from './normalizer/coordinator'
import { D1OpenQuestionsSectionHandler } from './normalizer/handlers/d1-open-questions-section'
import { D2BoldStatusFieldHandler } from './normalizer/handlers/d2-bold-status-field'
import { D4CollapsedAnsBlockHandler } from './normalizer/handlers/d4-collapsed-ans-block'
import { D6NonStandardPreambleFieldHandler } from './normalizer/handlers/d6-non-standard-preamble-field'
import { D62StatusWithAnnotationHandler } from './normalizer/handlers/d6-2-status-with-annotation'
import { D65MissingBoldPreambleFieldHandler } from './normalizer/handlers/d6-5-missing-bold-preamble-field'

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
])

// ---------------------------------------------------------------------------
// Extension state
// ---------------------------------------------------------------------------

let index: AdrIndex | undefined;
let seedIndex: SeedIndex | undefined;
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

  // Create the indices (no files parsed yet — lazy init)
  index = new AdrIndex();
  seedIndex = new SeedIndex();
  treeProvider = new AdrTreeProvider(index, seedIndex);

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
  statusBarItem.tooltip = 'Open ADR Explorer';
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

    vscode.commands.registerCommand('adrManager.openQuestionsPanel', () => {
      if (index) OpenQuestionsPanel.createOrShow(index);
    }),

    vscode.commands.registerCommand('adrManager.filterQuestions', () => {
      if (treeProvider) filterQuestions(treeProvider);
    }),

    vscode.commands.registerCommand('adrManager.changeStatus', (item) => {
      if (item?.adr) changeAdrStatus(item);
    }),

    vscode.commands.registerCommand('adrManager.goToQuestionInPanel', (item) => {
      if (item?.question && index) {
        OpenQuestionsPanel.createOrShow(index);
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
  const repo = api.repositories[0];
  if (!repo) {
    vscode.window.showErrorMessage('ADR Manager: No git repository found.');
    return;
  }

  const message = await vscode.window.showInputBox({
    prompt: 'Commit message for ADR changes',
    value: `docs: update ADRs`,
    placeHolder: 'docs: commit message',
  });
  if (!message) return;

  try {
    // Stage only files in the ADR directory
    const changes = [
      ...repo.state.workingTreeChanges,
      ...repo.state.indexChanges,
    ].filter(c => c.uri.fsPath.startsWith(adrDir));

    if (changes.length === 0) {
      vscode.window.showInformationMessage('ADR Manager: No ADR changes to commit.');
      return;
    }

    // Stage the ADR files
    await repo.add(changes.map(c => c.uri.fsPath));
    // Commit
    await repo.commit(message);

    vscode.window.showInformationMessage(
      `ADR Manager: Committed ${changes.length} ADR file${changes.length === 1 ? '' : 's'}.`
    );
  } catch (err) {
    vscode.window.showErrorMessage(`ADR Manager: Commit failed — ${err}`);
  }
}

function generateSeedTemplate(title: string, date: string, humanName: string): string {
  return `# SEED: ${title}

- **Date**: ${date}
- **From**: ${humanName}

---

## Brain Dump

[Everything here — no structure needed. Dump your thoughts, ideas, questions, code snippets, frustrations, inspirations, whatever is on your mind about this topic.]

---

**Model Response Request:**

- [ ] Chunk this into ADRs (I'm ready to formalize)
- [ ] Iterate with me (keep exploring)
- [ ] Structure in place (organize but don't split)

---

## Thread

*(No thread entries yet — paste the model's response below as ### Model Name - Date)*

---

## Derived Into

*(This seed has not yet been chunked into ADRs)*

<!-- When this seed is processed, the AI should update this section with:
- ADR-NNNN: Brief title

If anything in the seed remains unprocessed, make a note at the end of this section.
-->
`
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
}

function updateDiagnostics(
  collection: vscode.DiagnosticCollection,
  adr: import('./parser/types').AdrFile,
): void {
  const uri = vscode.Uri.file(adr.path);

  // Parser warnings (existing)
  const diags: vscode.Diagnostic[] = adr.parseWarnings.map(w => {
    const line = Math.max(0, (w.line ?? 1) - 1);
    const range = new vscode.Range(line, 0, line, 999);
    const severity =
      w.code === 'MISSING_SCOPE_REMAINING' || w.code === 'MISSING_STATUS'
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;
    const diag = new vscode.Diagnostic(range, w.message, severity);
    diag.source = 'ADR Manager';
    diag.code = w.code;
    return diag;
  });

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

  if (!seed.derivedIntoHasPlaceholder) {
    collection.delete(uri);
    return;
  }

  const adrEntries = idx.allAdrs().map(a => {
    let content = '';
    try { content = fs.readFileSync(a.path, 'utf8'); } catch { /* unreadable — skip */ }
    return { number: a.number, title: a.title, content };
  });
  const detected = findReferencingAdrs(seed.path, adrEntries);

  if (detected.length === 0) {
    collection.delete(uri);
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
  collection.set(uri, [diag]);
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
