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
import * as path from 'path'
import type { AdrFile, Question, SeedFile } from '../parser/types'
import type { CompositeIndex, RootNode } from '../index/compositeIndex'
import { statusEmoji, statusThemeIcon } from '../parser/statusInfo'
import { stripAdrNumberPrefix } from '../parser/adrTitle'
import { resolveQuestionClickCommand, type ClickOpensIn } from './questionClickCommand'
import { pathFragmentFor } from './rootPathFragment'
import { stableTreeItemId } from './treeItemIdentity'
import { openQuestionCountForNode, QUESTION_SOURCES, type SourceInclusion } from '../index/questionSource'
import { resolveTourEntries, isTourDone, type TourFile, type ResolvedTourEntry } from '../index/tourIndex'
import { createRepositoryContextAdapter } from '../index/repositoryContextAdapter'

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

type AdrTreeItemKind = 'root' | 'adr' | 'question' | 'open-questions-header' | 'adr-group' | 'seed-group' | 'seed' | 'tour-group' | 'tour' | 'tour-entry';

/** The broad implementation parameter type shared by all constructor overloads and static helpers.
 *  Using AdrTreeItemOpts resolves to the LAST overload only,
 *  causing type errors. This alias avoids that. */
type AdrTreeItemOpts = {
  kind: AdrTreeItemKind;
  adr?: AdrFile;
  question?: Question;
  seed?: SeedFile;
  tour?: TourFile;
  done?: boolean;
  entry?: ResolvedTourEntry;
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
  /** ADR-0034: present on 'tour' items, and on 'tour-entry' items (the owning tour, for getParent()). */
  public readonly tour?: TourFile;
  /** ADR-0034: present on 'tour-entry' items — the authored claims (comment/disposition/mustRespond) beside the live question. */
  public readonly entry?: ResolvedTourEntry;
  /** Present on 'root' items, and on 'open-questions-header'/'adr-group'/'seed-group'/'tour-group' items when the tree is multi-root — the container `getChildren()` must dispatch against. Undefined in the N=1 case, where there's only ever one root to mean anyway. */
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
    kind: 'tour-group';
    count: number;
    rootNode?: RootNode;
  });
  constructor(opts: {
    kind: 'tour';
    tour: TourFile;
    done: boolean;
    collapsibleState?: vscode.TreeItemCollapsibleState;
    rootNode?: RootNode;
  });
  constructor(opts: {
    kind: 'tour-entry';
    question: Question;
    tour: TourFile;
    entry: ResolvedTourEntry;
  });
  constructor(opts: {
    kind: AdrTreeItemKind;
    adr?: AdrFile;
    question?: Question;
    seed?: SeedFile;
    tour?: TourFile;
    done?: boolean;
    entry?: ResolvedTourEntry;
    count?: number;
    collapsibleState?: vscode.TreeItemCollapsibleState;
    rootNode?: RootNode;
    pathFragment?: string;
  }) {
    const collapsible = AdrTreeItem.makeCollapsible(opts)
    const label = AdrTreeItem.makeLabel(opts)
    super(label, collapsible)

    // Stable identity across getChildren() calls. reveal() (expand-all) can
    // only match an element to a rendered node through this — the provider
    // recreates item objects on every call, so without an explicit id there
    // is no identity for VS Code to match on and reveal() fails on every
    // item. Must be unique tree-wide (duplicate ids are a rendering error).
    this.id = AdrTreeItem.makeStableId(opts)

    this.kind = opts.kind
    this.adr = opts.adr
    this.question = opts.question
    this.seed = opts.seed
    this.tour = opts.tour
    this.entry = opts.entry
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

    if (opts.kind === 'tour-entry' && opts.question?.isAnswered) {
      // Bug fix (Facet, 2026-07-28 inbox 1337, Jérémie's screenshot):
      // buildTourQuestions() in openQuestionsPanel.ts deliberately excludes
      // already-answered entries from the walk ("nothing left to walk") —
      // so routing an answered tour-entry's click through the normal
      // tour-mode-entry path silently did nothing: navigateTo() posted a
      // jump for a question id the panel's questions[] array never
      // contained, and the dialog just kept showing whatever it last had,
      // no error, no feedback. Jump straight to the file instead — always
      // does something visible and correct. Interim, not a doctrine
      // ruling: whether an already-answered entry should eventually join
      // the walk read-only, or stay tree-visible-but-walk-absent
      // permanently, is routed to Riddle (doctrine) per Facet's dispatch —
      // this fix doesn't foreclose either direction, it just stops the
      // silent no-op today.
      this.command = {
        command: 'adrManager.openAdr',
        title: 'Open Answered Question in File',
        arguments: [opts.question.adrPath, opts.question.lineStart],
      }
    } else if ((opts.kind === 'question' || opts.kind === 'tour-entry') && opts.question) {
      // adrManager.clickOpensIn: resource-scoped so a multi-root workspace
      // can set it per-folder. question.adrPath is correct for both
      // container kinds (an ADR's path, or a seed's) as the scope resource.
      // An unanswered tour-entry's click routes through
      // adrManager.goToQuestionInPanel exactly like an ordinary question's
      // — that command (extension.ts) is what carries the owning tour's
      // slug along when the clicked item is a 'tour-entry', entering tour
      // mode (fixed 2026-07-26, v0.7.39). Entering tour mode via the TREE
      // is possible from either the tour item's own click or an
      // unanswered entry's; only an answered entry's click (above) is
      // special-cased.
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

    if (opts.kind === 'tour' && opts.tour) {
      // ADR-0034 Decision point 4: "tree (click a tour → dialog opens in
      // tour mode)" — clicking the TOUR itself opens the walk; its entries
      // underneath are inventory, unchanged from ordinary question items.
      this.command = {
        command: 'adrManager.openQuestionsPanel',
        title: 'Walk Tour',
        arguments: [opts.tour.slug],
      }
      this.resourceUri = vscode.Uri.file(opts.tour.path)
    }
  }

  /** Unique tree-wide, stable across rebuilds — the pure mapping lives in
   *  treeItemIdentity.ts so its uniqueness properties are unit-testable
   *  behind the vscode-import wall. N=1 group items carry no rootNode —
   *  their bare `kind:` form is still unique because there is only one such
   *  group in an N=1 tree. Question ids are container-scoped, so the
   *  container path prefix keeps them unique across files. */
  private static makeStableId(opts: AdrTreeItemOpts): string {
    return stableTreeItemId({
      kind: opts.kind,
      rootNodePath: opts.rootNode?.path,
      adrPath: opts.adr?.path,
      seedPath: opts.seed?.path,
      questionContainerPath: opts.question?.adrPath,
      questionId: opts.question?.id,
      tourPath: opts.tour?.path,
      tourEntryRef: opts.entry?.ref,
    })
  }

  private static makeCollapsible(opts: AdrTreeItemOpts): vscode.TreeItemCollapsibleState {
    if (opts.kind === 'root') {
      return vscode.TreeItemCollapsibleState.Expanded
    }
    if (opts.kind === 'adr-group' || opts.kind === 'seed-group' || opts.kind === 'tour-group') {
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
    if ((opts.kind === 'question' || opts.kind === 'tour-entry') && opts.question) {
      // Backticks are markup, not content — tree labels can't render code
      // spans, so strip them rather than display literal backquotes
      // (Jérémie, 2026-07-24; the panel renders them properly per the
      // renderMarkdownInQuestionTitles setting).
      //
      // Bug fix (Facet's live-tour report, 2026-07-28 inbox 0732): this
      // case never matched 'tour-entry' — every tour-entry item got the
      // fallthrough `return ''` at the end of this function, an
      // unconditionally EMPTY label. makeIcon and the click-command wiring
      // already shared 'question'/'tour-entry' in one combined check;
      // this was the one spot that didn't, and it's exactly what produced
      // "the sidebar has only question marks that are all empty" — a
      // row with a real (non-dimmed) icon but no label text at all reads
      // as present-but-blank; one dimmed by isAnswered's existing
      // gray-icon treatment on TOP of a blank label reads as functionally
      // invisible, which is the more likely explanation for "missing"
      // entries than a second, separate bug — they were rendering the
      // whole time, just as unlabeled gray ghosts.
      return `? ${opts.question.text.replace(/`/g, '')}`
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
    if (opts.kind === 'tour-group') {
      return `Tours (${opts.count ?? 0})`
    }
    if (opts.kind === 'tour' && opts.tour) {
      return opts.tour.title
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
    if (opts.kind === 'tour' && opts.tour) {
      const parts = [
        opts.tour.retired ? '[retired]' : (opts.done ? '[done]' : null),
        `${opts.tour.entries.length} entr${opts.tour.entries.length === 1 ? 'y' : 'ies'}`,
      ].filter(Boolean)
      return parts.join(' · ')
    }
    if (opts.kind === 'tour-entry' && opts.entry) {
      const parts = [opts.entry.disposition ?? null, opts.entry.mustRespond ? null : 'optional'].filter(Boolean)
      return parts.join(' · ')
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
    if (opts.kind === 'tour-group') {
      return 'Curated walks over the substrate (see ADR-0034) — a tour references questions, it never owns them'
    }
    if (opts.kind === 'tour' && opts.tour) {
      const t = opts.tour
      const parts = [
        `**${t.title}**`,
        `By ${t.author.name}${t.author.role ? ` (${t.author.role})` : ''}`,
        t.minted_at ? `Minted: ${t.minted_at}` : null,
        t.retired ? 'Retired' : (opts.done ? 'Done' : null),
      ].filter(Boolean)
      return parts.join('\n')
    }
    if (opts.kind === 'tour-entry' && opts.question && opts.entry) {
      const parts = [
        opts.question.text,
        opts.entry.comment ? `Comment: ${opts.entry.comment}` : null,
        opts.entry.answerPath ? `Answer shape: ${opts.entry.answerPath}` : null,
      ].filter(Boolean)
      return parts.join('\n')
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
    if ((opts.kind === 'question' || opts.kind === 'tour-entry') && opts.question) {
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
    if (opts.kind === 'tour-group') {
      return new vscode.ThemeIcon('compass', new vscode.ThemeColor('charts.orange'))
    }
    if (opts.kind === 'tour' && opts.tour) {
      if (opts.tour.retired) return new vscode.ThemeIcon('archive', new vscode.ThemeColor('descriptionForeground'))
      return opts.done
        ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
        : new vscode.ThemeIcon('compass', new vscode.ThemeColor('charts.orange'))
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

  /**
   * Required by `TreeView.reveal()` — the expand-all command is a chain of
   * reveals, and VS Code walks this to locate each element's ancestry.
   * Items are recreated per call; identity is carried by the stable
   * `AdrTreeItem.id`, so returning a *fresh* parent object with the right
   * id is sufficient and correct.
   */
  getParent(element: AdrTreeItem): AdrTreeItem | undefined {
    const nodes = Array.from(this.composite.walk())
    const multiRoot = nodes.length > 1
    const workspaceRoot = this.composite.root.path

    const rootItemFor = (node: RootNode | undefined): AdrTreeItem | undefined => {
      if (!multiRoot || !node) return undefined
      return new AdrTreeItem({
        kind: 'root',
        rootNode: node,
        pathFragment: pathFragmentFor(node, workspaceRoot),
        openCount: this.openQuestionCountFor(node),
      })
    }

    // Deepest discovered root whose path prefixes p — mirrors the walker's
    // own containment semantics (nested roots resolve to the nearest one).
    const nodeContaining = (p: string): RootNode | undefined => {
      let best: RootNode | undefined
      for (const n of nodes) {
        if (p === n.path || p.startsWith(n.path + path.sep)) {
          if (!best || n.path.length > best.path.length) best = n
        }
      }
      return best
    }

    switch (element.kind) {
      case 'root':
        return undefined
      case 'open-questions-header':
      case 'adr-group':
      case 'seed-group':
      case 'tour-group':
        return rootItemFor(element.rootNode)
      case 'adr': {
        if (!element.adr) return undefined
        const node = nodeContaining(element.adr.path)
        const count = node ? node.adrs.allAdrs().filter(a => !a.isSeed).length : 0
        return new AdrTreeItem({ kind: 'adr-group', count, rootNode: multiRoot ? node : undefined })
      }
      case 'seed': {
        if (!element.seed) return undefined
        const node = nodeContaining(element.seed.path)
        return new AdrTreeItem({ kind: 'seed-group', count: node?.seeds.size ?? 0, rootNode: multiRoot ? node : undefined })
      }
      case 'question': {
        const containerPath = element.question?.adrPath
        if (!containerPath) return undefined
        const node = nodeContaining(containerPath)
        const adr = node?.adrs.allAdrs().find(a => a.path === containerPath)
        if (adr) {
          return new AdrTreeItem({
            kind: 'adr',
            adr,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          })
        }
        const seed = node?.seeds.allSeeds().find(s => s.path === containerPath)
        if (seed) return new AdrTreeItem({ kind: 'seed', seed })
        return undefined
      }
      case 'tour': {
        if (!element.tour) return undefined
        const node = nodeContaining(element.tour.path)
        const count = node?.tours.length ?? 0
        return new AdrTreeItem({ kind: 'tour-group', count, rootNode: multiRoot ? node : undefined })
      }
      case 'tour-entry': {
        if (!element.tour) return undefined
        // 'tour' items carry no rootNode (identified by tour.path alone, same as adr/seed items above).
        const resolved = resolveTourEntries(element.tour, createRepositoryContextAdapter(this.composite))
        return new AdrTreeItem({
          kind: 'tour',
          tour: element.tour,
          done: isTourDone(resolved),
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        })
      }
    }
  }

  getChildren(element?: AdrTreeItem): AdrTreeItem[] {
    if (!element) return this.getRootItems()
    if (element.kind === 'root' && element.rootNode) return this.getContainerChildren(element.rootNode)
    if (element.kind === 'adr-group') return this.getAdrGroupChildren(this.resolveNode(element.rootNode))
    if (element.kind === 'seed-group') return this.getSeedGroupChildren(this.resolveNode(element.rootNode))
    if (element.kind === 'adr' && element.adr) return this.getAdrChildren(element.adr)
    if (element.kind === 'seed' && element.seed) return this.getSeedChildren(element.seed)
    if (element.kind === 'tour-group') return this.getTourGroupChildren(this.resolveNode(element.rootNode))
    if (element.kind === 'tour' && element.tour) return this.getTourChildren(element.tour)
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

    const tourCount = node.tours.length
    if (tourCount > 0) {
      items.push(new AdrTreeItem({ kind: 'tour-group', count: tourCount, rootNode: rootNodeArg }))
    }

    return items
  }

  /**
   * ADR-0029 QST-E: reads through the same QuestionSource aggregation the
   * badge and status bar use, respecting `adrManager.badge.include.<key>`
   * per source — one computation, three consumers, so the tree header can
   * never silently disagree with the count they show.
   */
  private openQuestionCountFor(node: RootNode): number {
    return openQuestionCountForNode(node, this.badgeInclusion(node))
  }

  private badgeInclusion(node: RootNode): SourceInclusion {
    const cfg = vscode.workspace.getConfiguration('adrManager', vscode.Uri.file(node.path))
    const inclusion: SourceInclusion = {}
    for (const source of QUESTION_SOURCES) inclusion[source.key] = cfg.get<boolean>(`badge.include.${source.key}`, true)
    return inclusion
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

  /**
   * ADR-0034: "Tree: 'Tours' category — same structural algebra as ADRs/
   * Seeds... Pure inventory; no walk machinery in the tree." Doneness is
   * computed fresh from the live substrate (doctrine 1) on every listing —
   * never cached on the tour item itself.
   */
  private getTourGroupChildren(node: RootNode): AdrTreeItem[] {
    const ctx = createRepositoryContextAdapter(this.composite)
    return node.tours.map(tour => {
      const resolved = resolveTourEntries(tour, ctx)
      const walkableCount = resolved.filter(e => e.resolution.kind === 'question').length
      return new AdrTreeItem({
        kind: 'tour',
        tour,
        done: isTourDone(resolved),
        collapsibleState: walkableCount > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      })
    })
  }

  /**
   * A tour entry that fails to resolve, or resolves to something other than
   * a question (a whole ADR/seed/section ref), is skipped here — the tree
   * is inventory-only for v1; doctrine 3's "visible broken-reference row"
   * requirement is met in the walk dialog (openQuestionsPanel.ts), where a
   * human is actually trying to act on the tour, not in this pure listing.
   */
  private getTourChildren(tour: TourFile): AdrTreeItem[] {
    const resolved = resolveTourEntries(tour, createRepositoryContextAdapter(this.composite))
    const items: AdrTreeItem[] = []
    for (const entry of resolved) {
      if (entry.resolution.kind !== 'question') continue
      items.push(new AdrTreeItem({ kind: 'tour-entry', question: entry.resolution.question, tour, entry }))
    }
    return items
  }

  private filterQuestions(questions: Question[]): Question[] {
    if (this.filterMode === 'all') return questions
    if (this.filterMode === 'answered') return questions.filter(q => q.isAnswered)
    return questions.filter(q => !q.isAnswered) // 'open' (default)
  }
}

