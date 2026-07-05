/**
 * ADR Tree View Provider
 *
 * Implements VS Code's TreeDataProvider to display ADRs and Seeds in the ActivityBar sidebar.
 *
 * Tree structure (ADR-0011 decision):
 *   [? N open questions]         (header, shown when any questions exist)
 *   ▼ ADRs (12)
 *     ADR-0001: Project Specifications [Accepted]
 *     ADR-0002: Parser Architecture    [Accepted]   · 3 open
 *       └─ ? qst-server-placement      (open question sub-item)
 *       └─ ? qst-write-atomicity
 *   ▼ Seeds (4)
 *     SEED (2026-03-07): Bug Reports   [wrench = unprocessed]
 *     SEED (2026-03-12): Debrief       [check = processed]
 *
 * See ADR-0004: UI Paradigm, ADR-0011: Seeds as First-Class Artifacts.
 */

import * as vscode from 'vscode'
import type { AdrFile, Question, SeedFile } from '../parser/types'
import type { AdrIndex } from '../index/adrIndex'
import type { SeedIndex } from '../index/seedIndex'
import { statusEmoji, statusThemeIcon } from '../parser/statusInfo'

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

type AdrTreeItemKind = 'adr' | 'question' | 'open-questions-header' | 'adr-group' | 'seed-group' | 'seed';

/** The broad implementation parameter type shared by all constructor overloads and static helpers.
 *  Using AdrTreeItemOpts resolves to the LAST overload only,
 *  causing type errors. This alias avoids that. */
type AdrTreeItemOpts = {
  kind: AdrTreeItemKind;
  adr?: AdrFile;
  question?: Question;
  seed?: SeedFile;
  count?: number;
  collapsibleState?: vscode.TreeItemCollapsibleState;
};

export class AdrTreeItem extends vscode.TreeItem {
  public readonly kind: AdrTreeItemKind;
  public readonly adr?: AdrFile;
  public readonly question?: Question;
  public readonly seed?: SeedFile;

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
    kind: 'adr-group';
    count: number;
  });
  constructor(opts: {
    kind: 'seed-group';
    count: number;
  });
  constructor(opts: {
    kind: 'seed';
    seed: SeedFile;
  });
  constructor(opts: {
    kind: AdrTreeItemKind;
    adr?: AdrFile;
    question?: Question;
    seed?: SeedFile;
    count?: number;
    collapsibleState?: vscode.TreeItemCollapsibleState;
  }) {
    const collapsible = AdrTreeItem.makeCollapsible(opts)
    const label = AdrTreeItem.makeLabel(opts)
    super(label, collapsible)

    this.kind = opts.kind
    this.adr = opts.adr
    this.question = opts.question
    this.seed = opts.seed

    this.contextValue = opts.kind
    this.iconPath = AdrTreeItem.makeIcon(opts)
    this.description = AdrTreeItem.makeDescription(opts)
    this.tooltip = AdrTreeItem.makeTooltip(opts)

    if (opts.kind === 'adr' && opts.adr) {
      this.command = {
        command: 'adrManager.openAdr',
        title: 'Open ADR',
        arguments: [opts.adr.path],
      }
      this.resourceUri = vscode.Uri.file(opts.adr.path)
    }

    if (opts.kind === 'question' && opts.question) {
      this.command = {
        command: 'adrManager.openAdr',
        title: 'Jump to Question',
        arguments: [opts.adr!.path, opts.question.lineStart],
      }
    }

    if (opts.kind === 'open-questions-header') {
      this.command = {
        command: 'adrManager.openQuestionsPanel',
        title: 'Answer Open Questions',
      }
    }

    if (opts.kind === 'seed' && opts.seed) {
      this.command = {
        command: 'adrManager.openAdr',
        title: 'Open Seed',
        arguments: [opts.seed.path],
      }
      this.resourceUri = vscode.Uri.file(opts.seed.path)
    }
  }

  private static makeCollapsible(opts: AdrTreeItemOpts): vscode.TreeItemCollapsibleState {
    if (opts.kind === 'adr-group' || opts.kind === 'seed-group') {
      return (opts as { count?: number }).count! > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    }
    return opts.collapsibleState ?? vscode.TreeItemCollapsibleState.None
  }

  private static makeLabel(opts: AdrTreeItemOpts): string {
    if (opts.kind === 'adr' && opts.adr) {
      // Defensive guard: seeds should not reach the ADR tree (they're excluded by
      // indexDirectory's /^\d+[-_]/ filter), but if a legacy numeric-prefix seed
      // file does appear, render it as a SEED entry instead of "ADR-0000: SEED: ...".
      // See ADR-0011 for the full seed treeview design.
      if (opts.adr.isSeed) {
        const title = opts.adr.title.replace(/^SEED:\s*/i, '').trim() || opts.adr.title
        const dateStr = opts.adr.date || ''
        return dateStr ? `SEED (${dateStr}): ${title}` : `SEED: ${title}`
      }
      const num = String(opts.adr.number).padStart(4, '0')
      // Strip leading "ADR-NNNN:" or "ADR NNN:" from title to avoid duplication.
      // Handles both hyphen ("ADR-001:") and space ("ADR 001:") separators.
      const title = opts.adr.title.replace(/^ADR[-\s]*\d+[:\s\-]+/i, '').trim() || opts.adr.title
      return `ADR-${num}: ${title}`
    }
    if (opts.kind === 'question' && opts.question) {
      return `? ${opts.question.text}`
    }
    if (opts.kind === 'open-questions-header') {
      const c = (opts as { count: number }).count
      return `${c} open question${c === 1 ? '' : 's'}`
    }
    if (opts.kind === 'adr-group') {
      const c = (opts as { count: number }).count
      return `ADRs (${c})`
    }
    if (opts.kind === 'seed-group') {
      const c = (opts as { count: number }).count
      return `Seeds (${c})`
    }
    if (opts.kind === 'seed' && opts.seed) {
      const s = opts.seed
      const dateStr = s.date ? ` (${s.date})` : ''
      return `SEED${dateStr}: ${s.topic}`
    }
    return ''
  }

  private static makeDescription(opts: AdrTreeItemOpts): string {
    if (opts.kind === 'adr' && opts.adr) {
      const openCount = opts.adr.questions.filter(q => !q.isAnswered).length
      const statusPart = `[${opts.adr.status}]`
      const questionPart = openCount > 0 ? ` · ${openCount} open` : ''
      return `${statusPart}${questionPart}`
    }
    if (opts.kind === 'seed' && opts.seed) {
      return opts.seed.isProcessed ? '[processed]' : ''
    }
    return ''
  }

  private static makeTooltip(opts: AdrTreeItemOpts): string {
    if (opts.kind === 'adr' && opts.adr) {
      const a = opts.adr
      const parts = [
        `**${a.title}**`,
        `Status: ${a.status} ${statusEmoji(a.status)}`,
        `Format: ${a.format}`,
        a.date ? `Date: ${a.date}` : null,
        a.deciders.length > 0 ? `Deciders: ${a.deciders.join(', ')}` : null,
        a.questions.length > 0
          ? `Questions: ${a.questions.filter(q => q.isAnswered).length}/${a.questions.length} answered`
          : null,
      ].filter(Boolean)
      return parts.join('\n')
    }
    if (opts.kind === 'question' && opts.question) {
      const q = opts.question
      const parts = [q.text, q.whyAsking ? `Why: ${q.whyAsking}` : null].filter(Boolean)
      return parts.join('\n')
    }
    if (opts.kind === 'seed' && opts.seed) {
      const s = opts.seed
      const parts = [
        `**${s.title}**`,
        s.from ? `From: ${s.from}` : null,
        s.date ? `Date: ${s.date}` : null,
        s.isProcessed
          ? `Derived into: ${s.derivedAdrs.map(d => `ADR-${String(d.number ?? '?').padStart(4, '0')}`).join(', ')}`
          : 'Not yet processed into ADRs',
      ].filter(Boolean)
      return parts.join('\n')
    }
    if (opts.kind === 'adr-group') {
      return 'Architectural Decision Records'
    }
    if (opts.kind === 'seed-group') {
      return 'Brain dumps and pre-decisional artifacts (see ADR-0011)'
    }
    return ''
  }

  private static makeIcon(opts: AdrTreeItemOpts): vscode.ThemeIcon {
    if (opts.kind === 'adr' && opts.adr) {
      return statusThemeIcon(opts.adr.status, vscode.ThemeIcon, vscode.ThemeColor)
    }
    if (opts.kind === 'question' && opts.question) {
      // Unanswered: bright orange (needs attention)
      // Answered: dimmed (same shape, distinguished by brightness not hue — colorblind-safe)
      const color = opts.question.isAnswered
        ? new vscode.ThemeColor('descriptionForeground')
        : new vscode.ThemeColor('charts.orange')
      return new vscode.ThemeIcon('question', color)
    }
    if (opts.kind === 'open-questions-header') {
      return new vscode.ThemeIcon('comment-discussion', new vscode.ThemeColor('charts.orange'))
    }
    if (opts.kind === 'adr-group') {
      return new vscode.ThemeIcon('list-tree')
    }
    if (opts.kind === 'seed-group') {
      return new vscode.ThemeIcon('symbol-namespace', new vscode.ThemeColor('charts.orange'))
    }
    if (opts.kind === 'seed' && opts.seed) {
      // Orange wrench = unprocessed (needs attention); green check = processed into ADRs
      return opts.seed.isProcessed
        ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
        : new vscode.ThemeIcon('wrench', new vscode.ThemeColor('charts.orange'))
    }
    return new vscode.ThemeIcon('file')
  }
}

// ---------------------------------------------------------------------------
// Tree data provider
// ---------------------------------------------------------------------------

export type QuestionFilter = 'open' | 'all' | 'answered';

export class AdrTreeProvider implements vscode.TreeDataProvider<AdrTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AdrTreeItem | undefined | null | void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  filterMode: QuestionFilter = 'open'

  constructor(
    private readonly index: AdrIndex,
    private readonly seedIndex: SeedIndex,
  ) {
    index.onChange(() => this.refresh())
    seedIndex.onChange(() => this.refresh())
  }

  setFilter(mode: QuestionFilter): void {
    this.filterMode = mode
    this.refresh()
  }

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: AdrTreeItem): vscode.TreeItem {
    return element
  }

  getChildren(element?: AdrTreeItem): AdrTreeItem[] {
    if (!element) return this.getRootItems()
    if (element.kind === 'adr-group') return this.getAdrGroupChildren()
    if (element.kind === 'seed-group') return this.getSeedGroupChildren()
    if (element.kind === 'adr' && element.adr) return this.getAdrChildren(element.adr)
    return []
  }

  private getRootItems(): AdrTreeItem[] {
    const items: AdrTreeItem[] = []

    const openCount = this.index.openQuestionCount
    if (openCount > 0) {
      items.push(new AdrTreeItem({ kind: 'open-questions-header', count: openCount }))
    }

    const adrCount = this.index.allAdrs().filter(a => !a.isSeed).length
    items.push(new AdrTreeItem({ kind: 'adr-group', count: adrCount }))

    const seedCount = this.seedIndex.size
    if (seedCount > 0) {
      items.push(new AdrTreeItem({ kind: 'seed-group', count: seedCount }))
    }

    return items
  }

  private getAdrGroupChildren(): AdrTreeItem[] {
    const adrs = this.index.allAdrs().filter(a => !a.isSeed)
    return adrs.map(adr => {
      const visibleQuestions = this.visibleQuestions(adr)
      return new AdrTreeItem({
        kind: 'adr',
        adr,
        collapsibleState: visibleQuestions.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      })
    })
  }

  private getSeedGroupChildren(): AdrTreeItem[] {
    return this.seedIndex.allSeeds().map(seed => new AdrTreeItem({ kind: 'seed', seed }))
  }

  private getAdrChildren(adr: AdrFile): AdrTreeItem[] {
    return this.visibleQuestions(adr).map(q => new AdrTreeItem({ kind: 'question', question: q, adr }))
  }

  private visibleQuestions(adr: AdrFile) {
    if (this.filterMode === 'all') return adr.questions
    if (this.filterMode === 'answered') return adr.questions.filter(q => q.isAnswered)
    return adr.questions.filter(q => !q.isAnswered) // 'open' (default)
  }
}
