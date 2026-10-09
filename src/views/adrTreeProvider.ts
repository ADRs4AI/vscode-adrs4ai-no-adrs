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
 *     SEED (2026-03-07): Bug Reports   [orange wrench = iterating; dimmed wrench = quiet;
 *                                        history/arrow-swap/circle-slash = parked/superseded/
 *                                        terminated; green check = chunked, · rollup: N/A|
 *                                        none|partial|full|unknown — ADR-0041, ratified 2026-08-12]
 *     SEED (2026-03-12): Debrief       [chunked · rollup: full]
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
import { statusEmoji, isSettledAdrStatus, questionStatusToken } from '../parser/statusInfo'
import { statusThemeIcon } from './statusIcon'
import { isDocumentPausedStatus } from '../parser/extractor'
import { classifySeedAxis1, closedFamilyToken, type SeedAxis1State } from './seedLifecycle'
import { daysSince, computeDisplayThresholdDays, type SeedAgingConfig } from './seedAging'
import { computeSeedRollup, type SeedRollup } from '../index/seedIndex'
import { stripAdrNumberPrefix, normalizeDateForTitle } from '../parser/adrTitle'
import { resolveQuestionClickCommand, type ClickOpensIn } from './questionClickCommand'
import { pathFragmentFor } from './rootPathFragment'
import { stableTreeItemId } from './treeItemIdentity'
import { openQuestionCountForNode, QUESTION_SOURCES, type SourceInclusion } from '../index/questionSource'
import { resolveTourEntries, isTourDone, type TourFile, type ResolvedTourEntry } from '../index/tourIndex'
import { orderCategories, DEFAULT_CATEGORY_ORDER, type SidebarCategory } from './categoryOrder'
import { createRepositoryContextAdapter } from '../index/repositoryContextAdapter'
import { stringifyCommandArg } from './commandArgDisplay'
import { computeRootCaptions, type RootCaptionMode } from './rootCaption'

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
  /** Gleaner's brief 2026-08-14, item A: computed by the caller (getRootItems has the whole discovered-roots list a mode like 'git-auto' needs for owner-majority disambiguation) via computeRootCaptions, and passed in already-resolved. Falls back to rootNode.namespace when absent — same "identity-only reconstruction doesn't need the real thing" reasoning as seedAxis1State below. */
  rootCaption?: string;
  /** ADR-0041 axis-1: computed by the caller (getSeedGroupChildren has the repo-wide seed list a per-item classification needs — median activity age, closed-family status) and passed in already-classified. */
  seedAxis1State?: SeedAxis1State;
  /** ADR-0041 axis-2: computed by the caller (needs an ADR-status lookup this class doesn't own) via computeSeedRollup. undefined when the seed isn't chunked — rollup doesn't apply, not "no progress". */
  seedRollup?: SeedRollup;
};

/**
 * ADR-0036: VS Code's TreeItem label has no italic/rich-text support (only
 * `highlights` for search-match bold ranges), so Jérémie's "italic when
 * shown in place" suggestion isn't directly buildable against this API —
 * a `[unresolved]`/`[deferred]` description tag is the achievable
 * equivalent, same convention this file already uses for `[retired]`/
 * `[done]` tour tags and ADR status brackets.
 */
function statusDescriptionTag(question?: Question): string | null {
  const status = questionStatusToken(question?.statusText)
  if (status === 'unresolved') return '[unresolved]'
  if (status === 'deferred') return '[deferred]'
  return null
}

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
    rootCaption?: string;
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
    /** Optional so getParent()'s identity-only reconstruction (icon/description accuracy doesn't matter there — see its own comment) doesn't need to recompute a real classification; makeIcon/makeDescription fall back to the pre-ADR-0041 isProcessed-only distinction when absent. */
    seedAxis1State?: SeedAxis1State;
    seedRollup?: SeedRollup;
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
    rootCaption?: string;
    seedAxis1State?: SeedAxis1State;
    seedRollup?: SeedRollup;
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

    if ((opts.kind === 'question' || opts.kind === 'tour-entry') && opts.question) {
      // adrManager.clickOpensIn: resource-scoped so a multi-root workspace
      // can set it per-folder. question.adrPath is correct for both
      // container kinds (an ADR's path, or a seed's) as the scope resource.
      // A tour-entry's click — answered or not — routes through
      // adrManager.goToQuestionInPanel exactly like an ordinary question's
      // — that command (extension.ts) is what carries the owning tour's
      // slug along when the clicked item is a 'tour-entry', entering tour
      // mode (fixed 2026-07-26, v0.7.39). ADR-0034 doctrine 9 (Riddle's
      // ruling, 2026-07-28): an already-answered entry is a review stop
      // inside the walk, not a file-jump special case — the panel itself
      // renders it read-only (buildTourQuestions no longer skips answered
      // entries; openQuestionsPanel.ts's render() shows the live answer in
      // place of the input box). This supersedes the interim fix from
      // inbox 1337 that jumped straight to the file instead.
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
      return opts.rootCaption ?? opts.rootNode.namespace
    }
    if (opts.kind === 'adr' && opts.adr) {
      // Defensive guard: seeds should not reach the ADR tree (they're excluded by
      // indexDirectory's /^\d+[-_]/ filter), but if a legacy numeric-prefix seed
      // file does appear, render it as a SEED entry instead of "ADR-0000: SEED: ...".
      // See ADR-0011 for the full seed treeview design.
      if (opts.adr.isSeed) {
        const title = opts.adr.title.replace(/^SEED:\s*/i, '').trim() || opts.adr.title
        const dateStr = opts.adr.date ? normalizeDateForTitle(opts.adr.date) : ''
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
      const base = `? ${opts.question.text.replace(/`/g, '')}`

      // Lean-verb prefix (2026-07-29 feedback seed, item C4): Jérémie's
      // ask, "the questions should have a prefix the word DEFINE/RATIFY or
      // whatever capital letter verb we allow as a first word." Per
      // Lapidary's dispatch, the vocabulary is the tour schema's own
      // controlled TourDisposition list (decide/ratify/acknowledge/
      // delegate), not free text — a tour-entry with no disposition set
      // gets no prefix rather than inventing one. Setting default on.
      if (opts.kind === 'tour-entry' && opts.entry?.disposition) {
        const showVerb = vscode.workspace
          .getConfiguration('adrManager', vscode.Uri.file(opts.question.adrPath))
          .get<boolean>('tours.showLeanVerbPrefix', true)
        if (showVerb) return `${opts.entry.disposition.toUpperCase()} ${base}`
      }

      return base
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
      const dateStr = s.date ? ` (${normalizeDateForTitle(s.date)})` : ''
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
      const openCount = isDocumentPausedStatus(opts.adr.status) ? 0 : opts.adr.questions.filter(q => !q.isAnswered && !q.isRetired && !q.dismissedReason).length
      const statusPart = `[${opts.adr.status}]`
      const questionPart = openCount > 0 ? ` · ${openCount} open` : ''
      return `${statusPart}${questionPart}`
    }
    if (opts.kind === 'seed' && opts.seed) {
      // ADR-0041 (ratified 2026-08-12): two-axis display, vocabulary
      // firewall — axis-2's rollup badge never borrows axis-1's words.
      // "chunked · rollup: partial" is the ADR's own cited wording for
      // its first conformance fixture (the origin seed), used verbatim.
      // 'iterating' (the common/default case) gets no bracket tag at
      // all — salience comes from the icon color (makeIcon below), not
      // from crowding every seed's description with a tag that's true
      // most of the time. seedAxis1State is undefined only for
      // getParent()'s identity-only reconstruction, which falls back to
      // the pre-ADR-0041 [processed] shape — accuracy doesn't matter
      // there (see that constructor overload's own comment).
      // ADR-0041 QST-SEEDQSTBADGE ANS, Jérémie's closing note: "Only
      // request is that what is included in badges should be
      // customizable." The open-QST count is the one piece of this
      // description that's content-state, not lifecycle (his own
      // caution, held through the fold) — the toggle below is scoped to
      // exactly that request, not the whole description string.
      const showOpenCount = vscode.workspace.getConfiguration('adrManager').get<boolean>('seeds.showOpenQuestionCount', true)
      const openCount = opts.seed.questions.filter(q => !q.isAnswered && !q.isRetired && !q.dismissedReason).length
      const questionPart = showOpenCount && openCount > 0 ? ` · ${openCount} open` : ''
      let lifecyclePart = ''
      switch (opts.seedAxis1State) {
        case 'parked':
        case 'superseded':
        case 'terminated':
          lifecyclePart = `[${opts.seedAxis1State}]`
          break
        case 'chunked':
          lifecyclePart = opts.seedRollup ? `[chunked · rollup: ${opts.seedRollup}]` : '[chunked]'
          break
        case 'dormant':
          // "quiet," not "dormant"/"stale" — Jérémie's own framing (ADR-0041
          // QST-SEEDTHRESHOLDS ANS): "I am not in the business of making any
          // canned judgments of value... definitely not meaning 'dim means
          // unusual'." The word choice matters here as much as the color does.
          lifecyclePart = '[quiet]'
          break
        case 'iterating':
          lifecyclePart = ''
          break
        case undefined:
          lifecyclePart = opts.seed.isProcessed ? '[processed]' : ''
          break
      }
      return `${lifecyclePart}${questionPart}`
    }
    if (opts.kind === 'tour' && opts.tour) {
      const parts = [
        opts.tour.retired ? '[retired]' : (opts.done ? '[done]' : null),
        `${opts.tour.entries.length} entr${opts.tour.entries.length === 1 ? 'y' : 'ies'}`,
      ].filter(Boolean)
      return parts.join(' · ')
    }
    if (opts.kind === 'tour-entry' && opts.entry) {
      const parts = [opts.entry.disposition ?? null, opts.entry.mustRespond ? null : 'optional', statusDescriptionTag(opts.question)].filter(Boolean)
      return parts.join(' · ')
    }
    if (opts.kind === 'question' && opts.question) {
      return statusDescriptionTag(opts.question) ?? ''
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
        s.status ? `Status: ${s.status}` : null,
        s.lastActivityDate ? `Last activity: ${s.lastActivityDate}` : null,
        s.isProcessed
          ? `Derived into: ${s.derivedAdrs.map(d => `ADR-${String(d.number ?? '?').padStart(4, '0')}`).join(', ')}${opts.seedRollup ? ` (rollup: ${opts.seedRollup})` : ''}`
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
      // ADR-0036: unresolved/deferred get their own icon when shown in
      // place (today's default — no separate tree section built yet, see
      // this ADR's Fitter completion brief) — distinct from the plain
      // open/answered question mark, since neither is really "waiting on
      // the human" the way an ordinary open question is.
      const status = questionStatusToken(opts.question.statusText)
      if (status === 'unresolved') {
        return new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('charts.purple'))
      }
      if (status === 'deferred') {
        return new vscode.ThemeIcon('history', new vscode.ThemeColor('descriptionForeground'))
      }
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
      // Jérémie's ask (2026-07-29 feedback seed, item B): 'law' — ADRs are
      // jurisprudential, deliberative records. Replaces 'list-tree'.
      return new vscode.ThemeIcon('law')
    }
    if (opts.kind === 'seed-group') {
      // Jérémie's ask (same seed): 'thinking' — the bubble manifests
      // brainstorming, replacing 'symbol-namespace' ("the braces").
      return new vscode.ThemeIcon('thinking', new vscode.ThemeColor('charts.orange'))
    }
    if (opts.kind === 'seed' && opts.seed) {
      // ADR-0041 (ratified 2026-08-12): the founding complaint this
      // replaces — "21 of 22 seeds showed the same wrench glyph... not a
      // sensitivity bug, a dimensional one" — was the old binary
      // isProcessed ? check : wrench. Six real glyph states now, same
      // "brightness not hue, colorblind-safe" convention already used for
      // question isAnswered dimming above: 'iterating' and 'dormant' are
      // the SAME wrench shape, distinguished by color only — staleness is
      // a rendering treatment (item 6), never a new declared token.
      switch (opts.seedAxis1State) {
        case 'parked':
          return new vscode.ThemeIcon('history', new vscode.ThemeColor('descriptionForeground'))
        case 'superseded':
          return new vscode.ThemeIcon('arrow-swap', new vscode.ThemeColor('descriptionForeground'))
        case 'terminated':
          return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('descriptionForeground'))
        case 'chunked':
          return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
        case 'dormant':
          return new vscode.ThemeIcon('wrench', new vscode.ThemeColor('descriptionForeground'))
        case 'iterating':
          return new vscode.ThemeIcon('wrench', new vscode.ThemeColor('charts.orange'))
        case undefined:
          // getParent()'s identity-only reconstruction — pre-ADR-0041 fallback.
          return opts.seed.isProcessed
            ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
            : new vscode.ThemeIcon('wrench', new vscode.ThemeColor('charts.orange'))
      }
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

/**
 * Is this tour hidden while `tours.hideCompleted` is on? Pure, exported, and
 * tested — because the rule it encodes was got wrong once, invisibly.
 *
 * - `retired`: the author said stop presenting this. Always hidden.
 * - `done && askedSomething`: required work was asked and finished. Hidden.
 * - `done && !askedSomething`: **VACUOUSLY done — never hidden.**
 *
 * That last line is the founder's 2026-10-09 Report ("It is not showing up as a
 * tour in the sidebar"). `isTourDone` returns true for a tour with zero
 * `must_respond` entries — deliberately, per Commodore's Iteration-5 ruling, so
 * that open FYI stops cannot hold a tour at half-done forever. The rule is
 * right. The consequence nobody traced is that a tour whose every stop is
 * optional is **done at birth**, so Concertmaster's 3-stop trial tour — three
 * genuinely unanswered questions, every stop marked `must_respond: false` out
 * of modesty — was hidden as "completed" before any human saw it.
 *
 * "Completed" must mean work was asked and finished, never that nothing was
 * ever asked. An unasked tour is unasked, not complete; `retire` is the gesture
 * for ending it.
 */
export function isTourHidden(t: { done: boolean; retired: boolean; askedSomething: boolean }): boolean {
  if (t.retired) return true
  return t.done && t.askedSomething
}

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
    const captionMode = vscode.workspace.getConfiguration('adrManager').get<RootCaptionMode>('roots.captionMode', 'git-auto')
    const captions = computeRootCaptions(nodes, captionMode)
    return nodes.map((node, i) => new AdrTreeItem({
      kind: 'root',
      rootNode: node,
      pathFragment: pathFragmentFor(node, workspaceRoot),
      rootCaption: captions[i],
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

    // Same visibleAdrs()/visibleSeeds()/visibleTours() filters the children
    // lists use — the header count and what's actually listed underneath
    // it must never disagree, so these count what the active filters leave
    // visible, not every item on disk (Gleaner's brief, 2026-08-14, for
    // Tours; extended to ADRs/Seeds, 2026-08-25, for coherence).
    const adrCount = this.visibleAdrs(node).length
    const seedCount = this.visibleSeeds(node).length
    const tourCount = this.visibleTours(node).length

    // Jérémie's ask (2026-07-29 feedback seed, item B): the ADRs/Seeds/Tours
    // category order is configurable, default Tours-ADRs-Seeds. ADRs group
    // is always present (even at zero count, matching pre-existing
    // behavior); Seeds/Tours are omitted entirely at zero, same as before —
    // orderCategories only ever reorders what's actually present, never
    // conjures an empty group into existence.
    const present: SidebarCategory[] = ['adrs']
    if (seedCount > 0) present.push('seeds')
    if (tourCount > 0) present.push('tours')

    const configuredOrder = vscode.workspace.getConfiguration('adrManager').get<unknown>('sidebar.categoryOrder', DEFAULT_CATEGORY_ORDER)
    const order = orderCategories(configuredOrder, present)

    const groupItem: Record<SidebarCategory, AdrTreeItem> = {
      adrs: new AdrTreeItem({ kind: 'adr-group', count: adrCount, rootNode: rootNodeArg }),
      seeds: new AdrTreeItem({ kind: 'seed-group', count: seedCount, rootNode: rootNodeArg }),
      tours: new AdrTreeItem({ kind: 'tour-group', count: tourCount, rootNode: rootNodeArg }),
    }
    for (const cat of order) items.push(groupItem[cat])

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

  /**
   * Category-header filter checkboxes (Facet's go-ahead, 2026-08-16;
   * Jérémie's own coherence ask, 2026-08-25). Two independent dimensions,
   * both default off (nothing hidden until asked for): `adrs.hideSettled`
   * (Implemented/Superseded/paused-family — see isSettledAdrStatus's own
   * doc comment for why this differs from "implementation progress"),
   * and `adrs.hideWithoutOpenQuestions` (nothing left to actually do
   * here). Shared by getAdrGroupChildren (the list) and
   * getContainerChildren (the header count) — same "these two must never
   * disagree" discipline visibleTours() already established for Tours.
   */
  private visibleAdrs(node: RootNode): AdrFile[] {
    const cfg = vscode.workspace.getConfiguration('adrManager')
    const hideSettled = cfg.get<boolean>('adrs.hideSettled', false)
    const hideWithoutOpenQuestions = cfg.get<boolean>('adrs.hideWithoutOpenQuestions', false)
    if (!hideSettled && !hideWithoutOpenQuestions) return node.adrs.allAdrs().filter(a => !a.isSeed)
    return node.adrs.allAdrs().filter(a => !a.isSeed).filter(adr => {
      if (hideSettled && isSettledAdrStatus(adr.status)) return false
      if (hideWithoutOpenQuestions) {
        const visible = isDocumentPausedStatus(adr.status) ? [] : this.filterQuestions(adr.questions)
        if (visible.length === 0) return false
      }
      return true
    })
  }

  private getAdrGroupChildren(node: RootNode): AdrTreeItem[] {
    const adrs = this.visibleAdrs(node)
    return adrs.map(adr => {
      // Document-level pause (2026-08-06 ruling), parent-item side (Gleaner's
      // brief, 2026-08-14): getAdrChildren() already returns [] for a paused
      // ADR, but this collapsibleState computation didn't check the same
      // thing — visibleQuestions.length > 0 has zero concept of document-
      // pause, so a paused ADR with real QST: headings in the raw file still
      // rendered an expand arrow that opened onto nothing ("this ADR has an
      // expander, but no questions?" — a real founder Report).
      const visibleQuestions = isDocumentPausedStatus(adr.status) ? [] : this.filterQuestions(adr.questions)
      return new AdrTreeItem({
        kind: 'adr',
        adr,
        collapsibleState: visibleQuestions.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      })
    })
  }

  /**
   * ADR-0041 axis-1 classification, one pass over the whole root's seed
   * list: first the repo-wide adaptive threshold (median days-since-last-
   * activity across the "iterating-family" population — unchunked,
   * non-closed-family seeds, matching Naturalist's own ratifying census
   * scope), then each seed classified against it. Computed here (not in
   * AdrTreeItem's constructor) because the median is inherently repo-
   * wide — a single seed's own constructor has no way to see its
   * siblings.
   */
  /**
   * Category-header filter checkboxes for Seeds (Facet's go-ahead,
   * 2026-08-16; Jérémie's coherence ask, 2026-08-25; second dimension —
   * `seeds.hideWithoutOpenQuestions` — added 2026-08-30 per his own
   * founder Report: the Seeds category had only `hideClosed`, one
   * dimension short of ADRs' two, an unexplained asymmetry with no
   * design reason behind it, seeds carry `.questions` the same as ADRs
   * do). `seeds.hideClosed` hides the closed-family seeds (parked/
   * superseded/terminated — closedFamilyToken, ADR-0041's own
   * vocabulary); `seeds.hideWithoutOpenQuestions` hides seeds with
   * nothing left to actually do, same `filterQuestions` the ADR side
   * uses — no seed-side "document paused" concept to short-circuit on,
   * unlike ADRs. Both default off. Kept separate from
   * getSeedGroupChildren's own aging-median computation below on
   * purpose — the median is a statistical property of the whole repo's
   * activity, not of what's currently being displayed, so it's always
   * computed from the FULL seed list regardless of either filter.
   */
  private visibleSeeds(node: RootNode): SeedFile[] {
    const cfg = vscode.workspace.getConfiguration('adrManager')
    const hideClosed = cfg.get<boolean>('seeds.hideClosed', false)
    const hideWithoutOpenQuestions = cfg.get<boolean>('seeds.hideWithoutOpenQuestions', false)
    if (!hideClosed && !hideWithoutOpenQuestions) return node.seeds.allSeeds()
    return node.seeds.allSeeds().filter(seed => {
      if (hideClosed && closedFamilyToken(seed.status)) return false
      if (hideWithoutOpenQuestions && this.filterQuestions(seed.questions).length === 0) return false
      return true
    })
  }

  private getSeedGroupChildren(node: RootNode): AdrTreeItem[] {
    const allSeeds = node.seeds.allSeeds()
    const seeds = this.visibleSeeds(node)
    const now = new Date()

    const config = vscode.workspace.getConfiguration('adrManager')
    const agingConfig: SeedAgingConfig = {
      mode: config.get<'adaptive' | 'fixed'>('seeds.agingMode', 'adaptive'),
      adaptiveMultiplier: config.get<number>('seeds.adaptiveMultiplier', 0.5),
      fixedThresholdDays: config.get<number>('seeds.fixedThresholdDays', 14),
    }

    const eligibleAges = allSeeds
      .filter(s => !closedFamilyToken(s.status) && !s.isProcessed)
      .map(s => s.lastActivityDate ? daysSince(s.lastActivityDate, now) : undefined)
      .filter((d): d is number => d !== undefined)
    const thresholdDays = computeDisplayThresholdDays(eligibleAges, agingConfig)

    return seeds.map(seed => {
      const visible = this.filterQuestions(seed.questions)
      const age = seed.lastActivityDate ? daysSince(seed.lastActivityDate, now) : undefined
      const axis1 = classifySeedAxis1(seed, age, thresholdDays)
      const rollup = computeSeedRollup(seed.derivedAdrs, n => node.adrs.getByNumber(n)?.status)
      return new AdrTreeItem({
        kind: 'seed',
        seed,
        collapsibleState: visible.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        seedAxis1State: axis1,
        seedRollup: rollup,
      })
    })
  }

  private getAdrChildren(adr: AdrFile): AdrTreeItem[] {
    // Document-level pause (2026-08-06 ruling): a paused ADR shows no question children.
    if (isDocumentPausedStatus(adr.status)) return []
    return this.filterQuestions(adr.questions).map(q => new AdrTreeItem({ kind: 'question', question: q, adr }))
  }

  private getSeedChildren(seed: SeedFile): AdrTreeItem[] {
    return this.filterQuestions(seed.questions).map(q => new AdrTreeItem({ kind: 'question', question: q }))
  }

  /**
   * Gleaner's brief 2026-08-14 (unblocked by Facet, 2026-08-16) — Jérémie's
   * own words, his own correction as the operative spec: "not sure we
   * should give each of these a state... this should be a setting of the
   * workspace user etc." One workspace-level `adrManager.tours.hideCompleted`
   * boolean, default true (his "on/checked" framing), not a per-tour
   * property. Doneness is still computed fresh from the live substrate
   * (doctrine 1, unchanged) — this only ADDS a filter on top, shared by
   * both the group header's count and its children so the two can never
   * disagree about how many tours are actually visible.
   */
  private visibleTours(node: RootNode): Array<{ tour: TourFile; resolved: ResolvedTourEntry[]; done: boolean }> {
    const ctx = createRepositoryContextAdapter(this.composite)
    const all = node.tours.map(tour => {
      const resolved = resolveTourEntries(tour, ctx)
      return { tour, resolved, done: isTourDone(resolved) }
    })
    // ADR-0034 iter-16: the setting hides tours that are no longer LIVE, which
    // is two states, not one — `done` (every must_respond entry answered) and
    // `retired` (the author said stop presenting this). Retired was honored in
    // the label and icon but never in visibility, so the only tours the setting
    // could hide were the ones that had resolved themselves. A stale tour is by
    // definition NOT done — it is the exact case that needed hiding and the one
    // case this filter could not touch. Jérémie's words for the result: "those
    // QuestionTours took weeks to get working, to the point that nobody
    // remembered what any of the tours was for."
    //
    // Widening only ever hides MORE, and only what an author explicitly marked
    // — so no tour disappears that someone did not deliberately retire. Turn
    // the setting off and everything returns, labelled `[retired]`.
    // VACUOUS DONENESS MUST NOT HIDE A TOUR (founder Report, 2026-10-09:
    // "It is not showing up as a tour in the sidebar").
    //
    // `isTourDone` returns true when a tour has ZERO `must_respond` entries —
    // deliberately, per Commodore's Iteration-5 ruling: if open FYI stops held
    // a tour at half-done forever, `retired` would become the escape hatch and
    // doneness would stop meaning anything. That rule is right and stands.
    //
    // What nobody noticed is the degenerate case it creates. Concertmaster
    // minted a 3-stop trial tour with every stop `must_respond: false` — being
    // modest, not blocking him — which made it **vacuously done at birth** and
    // therefore invisible before any human saw it. Three unanswered questions,
    // hidden as "completed". I widened this very filter on 2026-10-02 to also
    // hide `retired` and walked straight past the case.
    //
    // "Completed" must mean work was asked and finished, never that nothing was
    // ever asked. A tour with no required stops is UNASKED, not complete — so
    // it never auto-hides, and `retire` is the author's gesture for ending it,
    // which is exactly what `retired` is for.
    const hideCompleted = vscode.workspace.getConfiguration('adrManager').get<boolean>('tours.hideCompleted', true)
    if (!hideCompleted) return all
    return all.filter(t =>
      !isTourHidden({ done: t.done, retired: t.tour.retired, askedSomething: t.resolved.some(e => e.mustRespond) }),
    )
  }

  /**
   * ADR-0034: "Tree: 'Tours' category — same structural algebra as ADRs/
   * Seeds... Pure inventory; no walk machinery in the tree." Doneness is
   * computed fresh from the live substrate (doctrine 1) on every listing —
   * never cached on the tour item itself.
   */
  private getTourGroupChildren(node: RootNode): AdrTreeItem[] {
    return this.visibleTours(node).map(({ tour, resolved, done }) => {
      const walkableCount = resolved.filter(e => e.resolution.kind === 'question').length
      return new AdrTreeItem({
        kind: 'tour',
        tour,
        done,
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
    return questions.filter(q => !q.isAnswered && !q.isRetired && !q.dismissedReason) // 'open' (default; retired = closed-without-answer, 2026-08-07; dismissed = never-was-a-question, ADR-0032)
  }
}

/**
 * Tree-wide "most excellent report" (Jérémie's own words, 2026-08-06,
 * docs/adr/seed-2026-08-06-feedback-on-treeview-context-menus.md; spec'd
 * by Gleaner, docs/inbox/2026-08-06-0408-gleaner-to-fitter-tree-wide-
 * report-spec.md): "store like the entire hierarchy of the tree view
 * exactly every description of every caption of every tree view in the
 * menu options... and what it links to." A flat array with `parentId`
 * links, not nested objects — easier to grep/diff in a JSONL payload, and
 * `id` is already collision-safe (stableTreeItemId).
 */
export interface TreeSnapshotNode {
  id: string
  parentId?: string
  kind: AdrTreeItemKind
  label: string
  description?: string
  tooltip?: string
  resourceUri?: string
  /** What this item's click navigates to — the command id alone when there are no arguments (e.g. "Answer Open Questions"), else the command id + its arguments (e.g. which file/question it opens). */
  commandTarget?: string
}

function snapshotOne(item: AdrTreeItem, parentId: string | undefined): TreeSnapshotNode {
  const label = typeof item.label === 'string' ? item.label : (item.label as vscode.TreeItemLabel | undefined)?.label
  const description = typeof item.description === 'string' ? item.description : undefined
  const tooltip = typeof item.tooltip === 'string' ? item.tooltip : undefined
  const commandTarget = item.command
    ? (item.command.arguments?.length
        ? `${item.command.command}(${item.command.arguments.map(stringifyCommandArg).join(', ')})`
        : item.command.command)
    : undefined
  return {
    id: String(item.id),
    parentId,
    kind: item.kind,
    label: label ?? '',
    description,
    tooltip,
    resourceUri: item.resourceUri?.fsPath,
    commandTarget,
  }
}

/**
 * Walk the WHOLE tree from the top via the provider's own `getChildren()`
 * — the same traversal VS Code itself uses to render, so this can never
 * drift from what's actually on screen. Captions/descriptions/tooltips
 * only (short strings, one row per item) — deliberately not document
 * bodies, which stay scoped to the one clicked file (Lapidary's size-guard
 * doctrine: "the full text of the documents the incident REFERENCES —
 * never 'all ADRs'" applies to bodies, not to this kind of metadata).
 */
export function captureFullTree(provider: AdrTreeProvider): TreeSnapshotNode[] {
  const out: TreeSnapshotNode[] = []
  function walk(parent: AdrTreeItem | undefined): void {
    for (const child of provider.getChildren(parent)) {
      out.push(snapshotOne(child, parent?.id))
      walk(child)
    }
  }
  walk(undefined)
  return out
}

