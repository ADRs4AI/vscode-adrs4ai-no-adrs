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
import { AdrIndex } from './index/adrIndex'
import { AdrTreeProvider } from './views/adrTreeProvider'

// ---------------------------------------------------------------------------
// Extension state
// ---------------------------------------------------------------------------

let index: AdrIndex | undefined;
let treeProvider: AdrTreeProvider | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let fileWatcher: vscode.FileSystemWatcher | undefined;

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('adrManager');
  const adrDir = config.get<string>('adrDirectory', 'docs/adr');

  // Create the index (no files parsed yet — lazy init)
  index = new AdrIndex();
  treeProvider = new AdrTreeProvider(index);

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
      reindexWorkspace(index!, adrDir);
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
  );

  // ── File watcher ──────────────────────────────────────────────────────────
  setupFileWatcher(context, index, adrDir);

  // ── Initial index population ──────────────────────────────────────────────
  // Trigger when the sidebar is first revealed (lazy) OR immediately if already visible
  treeView.onDidChangeVisibility(e => {
    if (e.visible && index!.size === 0) {
      reindexWorkspace(index!, adrDir);
    }
  }, null, context.subscriptions);

  // Also index now if workspace is already open (common case: extension installed in existing project)
  reindexWorkspace(index, adrDir);
}

// ---------------------------------------------------------------------------
// Deactivation
// ---------------------------------------------------------------------------

export function deactivate(): void {
  fileWatcher?.dispose();
  fileWatcher = undefined;
}

// ---------------------------------------------------------------------------
// Workspace indexing
// ---------------------------------------------------------------------------

async function reindexWorkspace(idx: AdrIndex, adrDirRel: string): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return;

  for (const folder of workspaceFolders) {
    const adrDir = path.join(folder.uri.fsPath, adrDirRel);
    await idx.indexDirectory(adrDir);
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
  return /\d{4}[-_].+\.md$/.test(path.basename(filePath));
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

  const title = await vscode.window.showInputBox({
    prompt: 'ADR title (e.g., "Use SQLite for local ADR index")',
    placeHolder: 'Decision title',
  });

  if (!title) return;

  const adrDir = path.join(workspaceFolder.uri.fsPath, adrDirRel);
  const nextNumber = determineNextNumber(adrDir);
  const slug = title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
  const filename = `${String(nextNumber).padStart(4, '0')}-${slug}.md`;
  const filePath = path.join(adrDir, filename);

  const today = new Date().toISOString().split('T')[0];
  const template = generateAdrTemplate(title, today);

  const uri = vscode.Uri.file(filePath);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(template, 'utf-8'));
  await openAdrFile(filePath);
}

function determineNextNumber(adrDir: string): number {
  if (!index || index.size === 0) return 1;
  const max = Math.max(...index.allAdrs().map(a => a.number));
  return max + 1;
}

function generateAdrTemplate(title: string, date: string): string {
  return `# ${title}

- **Date**: ${date}
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: [Human name], [AI model]

---

## Quick Reference

**Navigation codes** (for grep):
- \`QST:\` Questions
- \`ANS:\` Answers
- \`COD:\` Code examples
- \`NOT:\` Notes

---

## Human Context

[Your thoughts, questions, frustrations, ideas, code snippets...]

---

## AI Interpretation

1. [Thread/topic 1] - [why it matters]

---

## Questions

### QST: [Your first question]
- Status: unanswered
- Why asking: [How this shapes the approach]
- Need: [yes/no | explanation | code example]

**ANS:** (by [name])
[Fill this in]

---

## Decision

### Context
[To be filled]

### Chosen: [TBD]

---

## Action Items

- [ ] [Task 1] — Owner: [who]

---

## Iterations

### Iteration 1 (${date})
- Human: [What you provided]
- AI: [What the AI did]
- Outcome: [What changed]

---

## Links

- Related ADRs: (none)
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
