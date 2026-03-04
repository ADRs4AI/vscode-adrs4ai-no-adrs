/**
 * ADR Tree View Provider
 *
 * Implements VS Code's TreeDataProvider to display ADRs in the ActivityBar sidebar.
 *
 * Forma 1 tree structure:
 *   ADR-0001: Project Specifications [Accepted]
 *   ADR-0002: Parser Architecture    [Accepted]   ? 3 open
 *   ADR-0003: MCP Server Design      [Accepted]
 *     └─ ? qst-server-placement      (open question sub-item)
 *     └─ ? qst-write-atomicity
 *
 * See ADR-0004: UI Paradigm for the design rationale.
 */

import * as vscode from 'vscode'
import type { AdrFile, Question } from '../parser/types'
import type { AdrIndex } from '../index/adrIndex'

function statusEmoji(status: string): string {
  switch (status) {
    case 'Accepted':    return '✅'
    case 'Implemented': return '🏗️'
    case 'Superseded':  return '🔄'
    case 'Draft':       return '✏️'
    case 'Proposed':    return '🔲'
    default:            return '📄'
  }
}

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

type AdrTreeItemKind = 'adr' | 'question' | 'open-questions-header';

export class AdrTreeItem extends vscode.TreeItem {
  public readonly kind: AdrTreeItemKind;
  public readonly adr?: AdrFile;
  public readonly question?: Question;

  constructor(opts: {
    kind: 'adr';
    adr: AdrFile;
    collapsibleState: vscode.TreeItemCollapsibleState;
  });
  constructor(opts: {
    kind: 'question';
    question: Question;
    adr: AdrFile;
  });
  constructor(opts: {
    kind: 'open-questions-header';
    count: number;
  });
  constructor(opts: {
    kind: AdrTreeItemKind;
    adr?: AdrFile;
    question?: Question;
    count?: number;
    collapsibleState?: vscode.TreeItemCollapsibleState;
  }) {
    const label = AdrTreeItem.makeLabel(opts);
    super(label, opts.collapsibleState ?? vscode.TreeItemCollapsibleState.None);

    this.kind = opts.kind;
    this.adr = opts.adr;
    this.question = opts.question;

    this.contextValue = opts.kind;
    this.iconPath = AdrTreeItem.makeIcon(opts);
    this.description = AdrTreeItem.makeDescription(opts);
    this.tooltip = AdrTreeItem.makeTooltip(opts);

    if (opts.kind === 'adr' && opts.adr) {
      this.command = {
        command: 'adrManager.openAdr',
        title: 'Open ADR',
        arguments: [opts.adr.path],
      };
      this.resourceUri = vscode.Uri.file(opts.adr.path);
    }

    if (opts.kind === 'question' && opts.question) {
      this.command = {
        command: 'adrManager.openAdr',
        title: 'Jump to Question',
        arguments: [opts.adr!.path, opts.question.lineStart],
      };
    }

    if (opts.kind === 'open-questions-header') {
      this.command = {
        command: 'adrManager.openQuestionsPanel',
        title: 'Answer Open Questions',
      };
    }
  }

  private static makeLabel(opts: ConstructorParameters<typeof AdrTreeItem>[0]): string {
    if (opts.kind === 'adr' && opts.adr) {
      const num = String(opts.adr.number).padStart(4, '0');
      // Strip leading "ADR-NNNN:" from title to avoid "ADR-0001: ADR-0001: ..." duplication
      const title = opts.adr.title.replace(/^ADR-\d{4}[:\s\-]+/i, '').trim() || opts.adr.title;
      return `ADR-${num}: ${title}`;
    }
    if (opts.kind === 'question' && opts.question) {
      return `? ${opts.question.text}`;
    }
    if (opts.kind === 'open-questions-header') {
      return `${opts.count} open question${opts.count === 1 ? '' : 's'}`;
    }
    return '';
  }

  private static makeDescription(opts: ConstructorParameters<typeof AdrTreeItem>[0]): string {
    if (opts.kind === 'adr' && opts.adr) {
      const openCount = opts.adr.questions.filter(q => !q.isAnswered).length;
      const statusPart = `[${opts.adr.status}]`;
      const questionPart = openCount > 0 ? ` · ${openCount} open` : '';
      return `${statusPart}${questionPart}`;
    }
    return '';
  }

  private static makeTooltip(opts: ConstructorParameters<typeof AdrTreeItem>[0]): string {
    if (opts.kind === 'adr' && opts.adr) {
      const a = opts.adr;
      const parts = [
        `**${a.title}**`,
        `Status: ${a.status} ${statusEmoji(a.status)}`,
        `Format: ${a.format}`,
        a.date ? `Date: ${a.date}` : null,
        a.deciders.length > 0 ? `Deciders: ${a.deciders.join(', ')}` : null,
        a.questions.length > 0
          ? `Questions: ${a.questions.filter(q => q.isAnswered).length}/${a.questions.length} answered`
          : null,
      ].filter(Boolean);
      return parts.join('\n');
    }
    if (opts.kind === 'question' && opts.question) {
      const q = opts.question;
      const parts = [q.text, q.whyAsking ? `Why: ${q.whyAsking}` : null].filter(Boolean);
      return parts.join('\n');
    }
    return '';
  }

  private static makeIcon(opts: ConstructorParameters<typeof AdrTreeItem>[0]): vscode.ThemeIcon {
    if (opts.kind === 'adr' && opts.adr) {
      switch (opts.adr.status) {
        case 'Accepted': return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        case 'Implemented': return new vscode.ThemeIcon('verified', new vscode.ThemeColor('testing.iconPassed'));
        case 'Superseded': return new vscode.ThemeIcon('history', new vscode.ThemeColor('disabledForeground'));
        case 'Draft': return new vscode.ThemeIcon('edit', new vscode.ThemeColor('charts.yellow'));
        default: return new vscode.ThemeIcon('file-text');
      }
    }
    if (opts.kind === 'question') {
      return new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.orange'));
    }
    if (opts.kind === 'open-questions-header') {
      return new vscode.ThemeIcon('comment-discussion', new vscode.ThemeColor('charts.orange'));
    }
    return new vscode.ThemeIcon('file');
  }
}

// ---------------------------------------------------------------------------
// Tree data provider
// ---------------------------------------------------------------------------

export class AdrTreeProvider implements vscode.TreeDataProvider<AdrTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AdrTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly index: AdrIndex) {
    // Refresh tree whenever the index changes
    index.onChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AdrTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AdrTreeItem): AdrTreeItem[] {
    if (!element) {
      return this.getRootItems();
    }

    if (element.kind === 'adr' && element.adr) {
      return this.getAdrChildren(element.adr);
    }

    return [];
  }

  private getRootItems(): AdrTreeItem[] {
    const adrs = this.index.allAdrs();
    if (adrs.length === 0) return [];

    const items: AdrTreeItem[] = [];

    // Optional header row showing total open questions
    const openCount = this.index.openQuestionCount;
    if (openCount > 0) {
      items.push(new AdrTreeItem({ kind: 'open-questions-header', count: openCount }));
    }

    for (const adr of adrs) {
      const hasOpenQuestions = adr.questions.some(q => !q.isAnswered);
      items.push(new AdrTreeItem({
        kind: 'adr',
        adr,
        collapsibleState: hasOpenQuestions
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      }));
    }

    return items;
  }

  private getAdrChildren(adr: AdrFile): AdrTreeItem[] {
    const openQuestions = adr.questions.filter(q => !q.isAnswered);
    return openQuestions.map(q => new AdrTreeItem({ kind: 'question', question: q, adr }));
  }
}
