/**
 * ADR Tree View Provider
 *
 * Implements VS Code's TreeDataProvider to display ADRs and Seeds in the ActivityBar sidebar.
 *
 * Tree structure (ADR-0011 decision), N=1 (single root, the common case — unchanged, no extra nesting):
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
 * Multi-root (ADR-0025 Decision 4, Linear Multi-Root Tree Projection —
 * founder-priority fix, 2026-07-16, "provenance vertigo": Jérémie answered
 * a question belonging to a different root via the panel and the tree
 * showed nothing for it): every discovered root becomes a flat top-level
 * entry, regardless of nesting depth —
 *   ▶ vscode-adrs-for-ai (root)
 *   ▶ elenchus-app (subprojects/elenchus-app)
 * — each expanding into exactly the SAME structure shown above. The N=1
 * case is not a special code path: `getRootItems()` flattens directly to
 * the container structure when there's exactly one discovered root, and
 * every container-listing method is parameterized by a `RootNode` rather
 * than closing over a single fixed index — one shape at every depth, per
 * this whole project's composability discipline.
 *
 * See ADR-0004: UI Paradigm, ADR-0011: Seeds as First-Class Artifacts,
 * ADR-0025: Multi-Root Recursive Project Roots.
 */

import * as vscode from 'vscode'
import type { AdrFile, Question, SeedFile } from '../parser/types'
import type { CompositeIndex, RootNode } from '../index/compositeIndex'
import { statusEmoji, statusThemeIcon } from '../parser/statusInfo'
import { stripAdrNumberPrefix } from '../parser/adrTitle'
import { resolveQuestionClickCommand, type ClickOpensIn } from './questionClickCommand'
import { pathFragmentFor } from './rootPathFragment'

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

type AdrTreeItemKind = 'root' | 'adr' | 'question' | 'open-questions-header' | 'adr-group' | 'seed-group' | 'seed';

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
  rootNode?: RootNode;
  pathFragment?: string;
};

export class AdrTreeItem extends vscode.TreeItem {
  public readonly kind: AdrTreeItemKind;
  public readonly adr?: AdrFile;
  public readonly question?: Question;
  public readonly seed?: SeedFile;
  /** Present on 'root' items, and on 'open-questions-header'/'adr-group'/'seed-group' items when the tree is multi-root — the container `getChildren()` must dispatch against. Undefined in the N=1 case, where there's only ever one root to mean anyway. */
  public readonly rootNode?: RootNode;

  constructor(opts: {
    kind: 'root';
    rootNode: RootNode;
    pathFragment: string;
    openCount: number;
  });
  constructor(opts: {
    kind: 'adr';
    adr: AdrFile;
    collapsibleState: vscode.TreeItemCollapsibleState;
  });
  constructor(opts: {
    kind: 'question';
    question: Question;
    /**
     * ADR-0018 Step 3 (tree-view parity): optional so seed-embedded
     * questions — which have no AdrFile — can use this same tree-item kind.
     * Navigation uses question.adrPath (correct for both container kinds),
     * not this field; it's kept for ADR-sourced callers that still pass it.
     */
    adr?: AdrFile;
  });
  constructor(opts: {
    kind: 'open-questions-header';
    count: number;
    rootNode?: RootNode;
  });
  constructor(opts: {
    kind: 'adr-group';
    count: number;
    rootNode?: RootNode;
  });
  constructor(opts: {
    kind: 'seed-group';
    count: number;
    rootNode?: RootNode;
  });
  constructor(opts: {
    kind: 'seed';
    seed: SeedFile;
    collapsibleState?: vscode.TreeItemCollapsibleState;
  });
  constructor(opts: {
    kind: AdrTreeItemKind;
    adr?: AdrFile;
    question?: Question;
    seed?: SeedFile;
    count?: number;
    collapsibleState?: vscode.TreeItemCollapsibleState;
    rootNode?: RootNode;
    pathFragment?: string;
  }) {
    const collapsible = AdrTreeItem.makeCollapsible(opts)
    const label = AdrTreeItem.makeLabel(opts)
    super(label, collapsible)

    this.kind = opts.kind
    this.adr = opts.adr
    this.question = opts.question
    this.seed = opts.seed
    this.rootNode = opts.rootNode

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
      // adrManager.clickOpensIn: resource-scoped so a multi-root workspace
      // can set it per-folder. question.adrPath is correct for both
      // container kinds (an ADR's path, or a seed's) as the scope resource.
      const clickOpensIn = vscode.workspace
        .getConfiguration('adrManager', vscode.Uri.file(opts.question.adrPath))
        .get<ClickOpensIn>('clickOpensIn', 'panel')
      const resolved = resolveQuestionClickCommand(clickOpensIn, opts.question, this)
      this.command = { command: resolved.command, title: resolved.title, arguments: resolved.arguments }
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

    if (opts.kind === 'root' && opts.rootNode) {
      this.resourceUri = vscode.Uri.file(opts.rootNode.path)
    }
  }

  private static makeCollapsible(opts: AdrTreeItemOpts): vscode.TreeItemCollapsibleState {
    if (opts.kind === 'root') {
      return vscode.TreeItemCollapsibleState.Expanded
    }
    if (opts.kind === 'adr-group' || opts.kind === 'seed-group') {
      return (opts.count ?? 0) > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    }
    return opts.collapsibleState ?? vscode.TreeItemCollapsibleState.None
  }

  private static makeLabel(opts: AdrTreeItemOpts): string {
    if (opts.kind === 'root' && opts.rootNode) {
      return opts.rootNode.namespace
    }
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
      // Strip leading "ADR <number><separator>" from title to avoid duplication
      // (shared helper — tolerates :, -, – and — separators; see adrTitle.ts).
      const title = stripAdrNumberPrefix(opts.adr.title)
      return `ADR-${num}: ${title}`
    }
    if (opts.kind === 'question' && opts.question) {
      return `? ${opts.question.text}`
    }
    if (opts.kind === 'open-questions-header') {
      const c = opts.count ?? 0
      return `${c} open question${c === 1 ? '' : 's'}`
    }
    if (opts.kind === 'adr-group') {
      return `ADRs (${opts.count ?? 0})`
    }
    if (opts.kind === 'seed-group') {
      return `Seeds (${opts.count ?? 0})`
    }
    if (opts.kind === 'seed' && opts.seed) {
      const s = opts.seed
      const dateStr = s.date ? ` (${s.date})` : ''
      return `SEED${dateStr}: ${s.topic}`
    }
    return ''
  }

  private static makeDescription(opts: AdrTreeItemOpts): string {
    if (opts.kind === 'root') {
      const parts = [opts.pathFragment, (opts.count ?? 0) > 0 ? `${opts.count} open` : null].filter(Boolean)
      return parts.join(' · ')
    }
    if (opts.kind === 'adr' && opts.adr) {
      const openCount = opts.adr.questions.filter(q => !q.isAnswered).length
      const statusPart = `[${opts.adr.status}]`
      const questionPart = openCount > 0 ? ` · ${openCount} open` : ''
      return `${statusPart}${questionPart}`
    }
    if (opts.kind === 'seed' && opts.seed) {
      const openCount = opts.seed.questions.filter(q => !q.isAnswered).length
      const statusPart = opts.seed.isProcessed ? '[processed]' : ''
      const questionPart = openCount > 0 ? ` · ${openCount} open` : ''
      return `${statusPart}${questionPart}`
    }
    return ''
  }

  private static makeTooltip(opts: AdrTreeItemOpts): string {
    if (opts.kind === 'root' && opts.rootNode) {
      const parts = [
        `**${opts.rootNode.namespace}**`,
        `Path: ${opts.rootNode.path}`,
        opts.rootNode.isSubmodule ? 'Git submodule' : null,
      ].filter(Boolean)
      return parts.join('\n')
    }
    if (opts.kind === 'adr' && opts.adr) {
      const a = opts.adr
      const parts = [
        `**${a.title}**`,
        `Status: ${a.status} ${statusEmoji(a.status)}`,
        `Format: ${a.format}`,
        a.date ? `Date: ${a.date}` : null,
        a.awaiting ? `Awaiting: ${a.awaiting}` : null,
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
    if (opts.kind === 'root') {
      return new vscode.ThemeIcon('root-folder')
    }
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
  private composite: CompositeIndex
  private compositeSubscription: (() => void) | undefined

  constructor(composite: CompositeIndex) {
    this.composite = composite
    this.compositeSubscription = composite.onChange(() => this.refresh())
  }

  /**
   * Swap the underlying composite after a root-set refresh (ADR-0025
   * Decision 5 — a `.settings/roots.json` edit or `.adrignore` marker
   * change rebuilds `CompositeIndex` from scratch). Re-subscribes against
   * the new node instances, same dispose-and-resubscribe discipline as
   * `extension.ts`'s `diagnosticsSubscription`/`statusBarSubscription` —
   * this is what closes the "tree view freezes after a root-set change"
   * gap named in `8f765f8`'s own known-limitations note.
   */
  setComposite(composite: CompositeIndex): void {
    this.compositeSubscription?.()
    this.composite = composite
    this.compositeSubscription = composite.onChange(() => this.refresh())
    this.refresh()
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
    if (element.kind === 'root' && element.rootNode) return this.getContainerChildren(element.rootNode)
    if (element.kind === 'adr-group') return this.getAdrGroupChildren(this.resolveNode(element.rootNode))
    if (element.kind === 'seed-group') return this.getSeedGroupChildren(this.resolveNode(element.rootNode))
    if (element.kind === 'adr' && element.adr) return this.getAdrChildren(element.adr)
    if (element.kind === 'seed' && element.seed) return this.getSeedChildren(element.seed)
    return []
  }

  /** N=1's group items carry no rootNode (there's only ever one to mean); fall back to the composite's own root. */
  private resolveNode(rootNode: RootNode | undefined): RootNode {
    return rootNode ?? this.composite.root
  }

  /**
   * Linear Multi-Root Tree Projection (ADR-0025 Decision 4): one flat entry
   * per discovered root, regardless of nesting depth. N=1 stays the trivial
   * case — flattens directly to the container structure with no extra
   * wrapper layer, zero behavior change from the pre-multi-root tree.
   */
  private getRootItems(): AdrTreeItem[] {
    const nodes = Array.from(this.composite.walk())
    if (nodes.length <= 1) return this.getContainerChildren(nodes[0] ?? this.composite.root)

    const workspaceRoot = this.composite.root.path
    return nodes.map(node => new AdrTreeItem({
      kind: 'root',
      rootNode: node,
      pathFragment: pathFragmentFor(node, workspaceRoot),
      openCount: this.openQuestionCountFor(node),
    }))
  }

  private getContainerChildren(node: RootNode): AdrTreeItem[] {
    const items: AdrTreeItem[] = []
    const multiRoot = Array.from(this.composite.walk()).length > 1
    const rootNodeArg = multiRoot ? node : undefined

    const openCount = this.openQuestionCountFor(node)
    if (openCount > 0) {
      items.push(new AdrTreeItem({ kind: 'open-questions-header', count: openCount, rootNode: rootNodeArg }))
    }

    const adrCount = node.adrs.allAdrs().filter(a => !a.isSeed).length
    items.push(new AdrTreeItem({ kind: 'adr-group', count: adrCount, rootNode: rootNodeArg }))

    const seedCount = node.seeds.size
    if (seedCount > 0) {
      items.push(new AdrTreeItem({ kind: 'seed-group', count: seedCount, rootNode: rootNodeArg }))
    }

    return items
  }

  private openQuestionCountFor(node: RootNode): number {
    return node.adrs.openQuestionCount + node.seeds.allOpenQuestions().length
  }

  private getAdrGroupChildren(node: RootNode): AdrTreeItem[] {
    const adrs = node.adrs.allAdrs().filter(a => !a.isSeed)
    return adrs.map(adr => {
      const visibleQuestions = this.filterQuestions(adr.questions)
      return new AdrTreeItem({
        kind: 'adr',
        adr,
        collapsibleState: visibleQuestions.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      })
    })
  }

  private getSeedGroupChildren(node: RootNode): AdrTreeItem[] {
    return node.seeds.allSeeds().map(seed => {
      const visible = this.filterQuestions(seed.questions)
      return new AdrTreeItem({
        kind: 'seed',
        seed,
        collapsibleState: visible.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      })
    })
  }

  private getAdrChildren(adr: AdrFile): AdrTreeItem[] {
    return this.filterQuestions(adr.questions).map(q => new AdrTreeItem({ kind: 'question', question: q, adr }))
  }

  private getSeedChildren(seed: SeedFile): AdrTreeItem[] {
    return this.filterQuestions(seed.questions).map(q => new AdrTreeItem({ kind: 'question', question: q }))
  }

  private filterQuestions(questions: Question[]): Question[] {
    if (this.filterMode === 'all') return questions
    if (this.filterMode === 'answered') return questions.filter(q => q.isAnswered)
    return questions.filter(q => !q.isAnswered) // 'open' (default)
  }
}

