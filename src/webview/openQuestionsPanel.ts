/**
 * Open Questions Panel — Forma 2
 *
 * A webview panel showing all unanswered questions across the ADR index,
 * one at a time, with an inline answer field.
 *
 * The user types their answer and hits Answer → (or Cmd+Enter).
 * The panel writes the answer back to the ADR file via WorkspaceEdit,
 * updates the - Status: line, and advances to the next question.
 *
 * Philosophy (from ADR-0001): "The extension should let you answer
 * questions without having to open the file." This is that.
 */

import * as vscode from 'vscode'
import { execSync } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { CompositeIndex } from '../index/compositeIndex'
import type { AdrFile, Recommendation, Question } from '../parser/types'
import { parseAdr } from '../parser/extractor'
import { computeAdrContext } from '../parser/adrContext'
import { stripAdrNumberPrefix, normalizeDateForTitle } from '../parser/adrTitle'
import { scanAnswerWriteAnchors, buildInsertionPreview } from './answerWriteScan'
import { parseSeed } from '../parser/seedExtractor'
import { bodyMaxWidthCss } from './panelSettings'
import { DraftStore } from '../drafts/draftStore'
import { resolveTourEntries, isTourDone, unresolvedTourRefs, referencedDocumentPaths, tourLedgerAnchor, type TourFile, type ResolvedTourEntry } from '../index/tourIndex'
import { createRepositoryContextAdapter } from '../index/repositoryContextAdapter'
import { appendErrorRecord, buildErrorRecord, appendLedgerRecord, captureDocument, errorSignature } from '../drafts/errorLog'
import { computeDraftKey, computeOccurrenceOrdinals, computeOccurrenceCounts } from '../drafts/draftKey'

// ---------------------------------------------------------------------------
// Serialized question shape (what we send to the webview)
// ---------------------------------------------------------------------------

interface WebviewQuestion {
  id: string
  text: string
  whyAsking?: string
  whyDeferring?: string
  need?: string
  recommendation?: string
  /** ADR-0019: recommendation blocks, source order, each attributed. */
  recommendations?: Recommendation[]
  body?: string
  bodyPost?: string
  /** ADR-0010: Markdown content of sections before ## Questions (Human Context + AI Interpretation) */
  adrContext?: string
  adrNumber: number
  adrTitle: string
  adrPath: string
  lineStart: number  // 1-indexed line of the ### QST: heading
  /** ADR-0023: adrNumber+textHash+ordinal — stable across line shifts. */
  draftKey: string
  /**
   * ADR-0018 Step 3: which container this question came from. Drives
   * writeAnswer()'s relocation strategy (parseAdr vs parseSeed — a seed
   * question's id/draftKey scheme is not resolvable via parseAdr) and the
   * synchronous reindex call after a successful write.
   */
  sourceKind: 'adr' | 'seed'
  /**
   * ADR-0018 Step 3: TOC grouping key/label, computed server-side so the
   * webview never has to reconstruct "ADR-NNNN:" vs "SEED (date):"
   * formatting itself. Prefixed so a plain string sort puts ADRs before
   * seeds (the ratified ordering, ADR-0018 QST-2 ANS) without needing a
   * container-kind-aware comparator in the webview.
   */
  groupSortKey: string
  groupLabel: string
  /**
   * ADR-0025 panel-aggregation (QST `panel-aggregation`, Option A): which
   * root this question's container belongs to. Feeds the root-filter chip
   * and, for ADR-sourced questions, `draftKey`'s containerId — two roots
   * can each have their own numbered ADR-0001, so a bare adrNumber isn't a
   * safe containerId across roots (same shape of collision Flint's ADR-0018
   * Step 3 fixed for ADR-vs-seed containers, one level up).
   */
  rootNamespace: string
  /** ADR-0023 CATCH 3 guard: sibling count sharing this question's text-hash in the ADR right now. */
  totalOccurrences: number
  /** ADR-0023 drift fence: the ADR file's content checksum at render time. */
  fileChecksum: string
  /** ADR-0023: restored draft text, if a draft exists for this question's key. */
  draftText?: string
  /** The existing (unconfirmed) answer text when the question is OPEN under Status-authority but its ANS block holds a real draft — prefilled into the textarea so replacement is never blind. */
  existingAnswer?: string
  /** File mtime (ms) at push time — renders as the existing answer's save time and dates edit-time drift banners. */
  fileMtime?: number
  /** ADR-0023: ISO timestamp the draft was last saved, for the "draft restored" indicator. */
  draftSavedAt?: string
  /** ADR-0023 square 4 (staleness banner): which surface last wrote this draft — 'panel', 'file-prefill', 'mobile', 'mcp', … Undefined for a draft saved before provenance existed. */
  draftSource?: string
  /** ADR-0034: present only when this question is being walked as part of a tour — the authored claim beside the live facts above. */
  tourEntry?: {
    comment?: string
    disposition?: string
    answerPath?: string
    mustRespond: boolean
  }
  /** ADR-0034 doctrine 9: this entry is already answered — render as a read-only review stop, never an input. Tour mode only. */
  isReviewStop?: boolean
  /** The live answer text to show in the review stop, when isReviewStop is true. */
  finalAnswerText?: string
}

/** ADR-0034: sent alongside `questions` only when the panel is in tour mode. */
interface WebviewTourMeta {
  slug: string
  title: string
  author: { name: string; model?: string; role?: string }
  mintedAt: string
  theme?: { background?: string; foreground?: string }
  retired: boolean
  done: boolean
  /** Doctrine 3: entries that failed to resolve — surfaced as a visible list, never silently dropped. */
  brokenRefs: string[]
}

// ---------------------------------------------------------------------------
// Messages webview → extension
// ---------------------------------------------------------------------------

type WebviewMessage =
  | {
      type: 'answer'
      questionId: string
      adrPath: string
      lineStart: number
      answerText: string
      authorName: string
      draftKey: string
      fileChecksum: string
      /** ADR-0023 drift fence: "Write anyway" — skip the checksum re-check. */
      force?: boolean
      /** ADR-0018 Step 3: selects parseAdr vs parseSeed for relocation. */
      sourceKind: 'adr' | 'seed'
      /** Insertion-preview protocol (DEBRIEF-006): the human has seen the "insertionPreview" context and approved it — proceed with the append-ANS fallback instead of previewing again. */
      confirmedInsertion?: boolean
      /** Insertion-preview ±1 adjustment (Jérémie via Gleaner's sweep, 2026-07-31: "if we are not sure, we should make a guess, and let the user - (move back a line) or + (move down a line)"). Applied to the server-computed insertion line before writing; 0/undefined is the original guess, unmoved. */
      insertLineOffset?: number
      /** ADR-0036: "Respond (unresolved)" — same ANS layer, but the ball moves to the model's court instead of closing the question. Omitted/'answered' is the ordinary Answer gesture. */
      targetStatus?: 'answered' | 'unresolved'
    }
  | { type: 'skip' }
  | { type: 'jumpTo'; adrPath: string; lineNumber: number }
  | { type: 'draft'; draftKey: string; adrPath: string; adrNumber: number; questionText: string; draftText: string; totalOccurrences: number; prevDraftText?: string }
  | { type: 'refreshRequest' }
  | { type: 'ready' }
  /** Persistent save-failure warning (Lapidary 5, 2026-07-16): "Save now" retry. */
  | { type: 'retrySave'; adrPath: string }
  /** ADR-0023 square 4 (staleness banner): "See diff" — open VS Code's own diff editor over two virtual documents rather than a bespoke webview differ. */
  | { type: 'showDraftDiff'; mine: string; theirs: string; questionText: string }
  /** ADR-0034: leave tour mode, back to the full open-questions walk. */
  | { type: 'exitTour' }
  /**
   * ADR-0035 Iteration 3 (seed-2026-07-30, "frictionless observation
   * reporting"): a human-authored observation about the current
   * question/ADR — appended to the error ledger, doesn't touch the
   * question itself. `renderedHtml` (Iteration 5, seed-2026-07-31,
   * Gleaner 5's design): the panel's own current rendered markup for this
   * question card (the rendered markdown fields' innerHTML at Report time) — the
   * render-vs-source comparison that made two same-day rendering bugs
   * diagnosable from a screenshot, captured as text instead of a pixel
   * grab: no OS screen-capture permission, stays in the webview sandbox,
   * the source half of the comparison is already in `documents`.
   */
  | { type: 'reportObservation'; adrPath: string; questionId?: string; draftKey?: string; renderedHtml?: string }

// ---------------------------------------------------------------------------
// Panel class
// ---------------------------------------------------------------------------

export class OpenQuestionsPanel {
  private static instance: OpenQuestionsPanel | undefined

  private readonly panel: vscode.WebviewPanel
  private readonly disposables: vscode.Disposable[] = []
  private readonly draftStore: DraftStore
  /**
   * Monotonic counter, incremented on every sendQuestions() push (seed-2026-
   * 07-06-panel-submit-no-refresh-bug.md, "Problem 2" — panel-advance bug
   * recurring even after b9a04e5's synchronous-reindex fix). This repo has
   * multiple concurrent sessions writing docs/adr/*.md at once; the real
   * FileSystemWatcher can fire an UNRELATED reindex (triggered by another
   * session's write elsewhere) that races with this panel's own post-write
   * reindex. Both eventually push correct 'questions' data, but if the
   * unrelated one is *in flight* when this panel's own write completes, it
   * can be delivered to the webview out of order relative to the correct
   * push — stale data overwriting fresh data. The webview discards any
   * 'questions' message whose generation is behind what it already applied.
   */
  private questionsGeneration = 0

  /** ADR-0034: when set, sendQuestions() walks exactly this tour's unanswered, resolvable entries, in tour order, instead of every open question. Same executor, tour-mode dress — never a second component. */
  private activeTourSlug: string | undefined

  /** ADR-0035 Iteration 2: signatures of tour-unresolved-refs ledger records already written THIS session — re-opening the same broken tour five times writes one record, not five. Session-scoped by design (a fresh panel instance re-logs, since the whole point is "the human/model is looking at this broken tour right now"). */
  private tourUnresolvedSignaturesLogged = new Set<string>()

  /** Retry-storm dedupe (Riddle's adjudication of Gleaner's ledger sweep, 2026-07-31: lumbroso-hq logged 27 workspace-edit-rejected records in ~8 seconds, one question, one specimen — the panel's own save-retry loop re-logging on every retry cycle instead of once per actual failure). Same session-scoped-by-signature shape as tourUnresolvedSignaturesLogged above. */
  private harvestErrorSignaturesLogged = new Set<string>()

  // ---------------------------------------------------------------------------

  static createOrShow(composite: CompositeIndex, tourSlug?: string): void {
    if (OpenQuestionsPanel.instance) {
      OpenQuestionsPanel.instance.panel.reveal(vscode.ViewColumn.One)
      // Bug fix (Facet's live click-through report, 2026-07-26 inbox
      // 0349): every call now fully specifies the desired mode —
      // `tourSlug` present enters/switches to that tour, absent EXPLICITLY
      // returns to the full walk. The old `if (tourSlug)` (no-op when
      // absent) left an already-open tour-mode panel with no way out
      // except the explicit Exit-tour link: clicking any other, non-tour
      // question in the tree called this with no tourSlug, which used to
      // leave activeTourSlug untouched — the click had nowhere to land.
      OpenQuestionsPanel.instance.setTour(tourSlug)
      return
    }
    new OpenQuestionsPanel(composite, tourSlug)
  }

  /** Jump the open panel to a specific question by ID. Call after createOrShow. */
  static navigateTo(questionId: string): void {
    // Post after a short delay to let the panel initialize if it was just opened
    setTimeout(() => {
      OpenQuestionsPanel.instance?.panel.webview.postMessage({ type: 'navigate', questionId })
    }, 150)
  }

  /**
   * ADR-0034: switch an already-open panel into (or between, or OUT of)
   * tour mode. `undefined` explicitly returns to the full walk — every
   * caller states its intended mode outright now, rather than "leave
   * whatever's active alone" (the bug Facet's report named: a click on a
   * non-tour question while tour mode was active used to be a no-op).
   */
  setTour(tourSlug: string | undefined): void {
    this.activeTourSlug = tourSlug
    this.updatePanelTitle()
    this.sendQuestions()
  }

  /** Bug fix (Facet, 2026-07-26 inbox 0349): the tab title never reflected tour mode — indistinguishable from the plain walk at a glance. */
  private updatePanelTitle(): void {
    const found = this.activeTourSlug ? this.composite.findTour(this.activeTourSlug) : undefined
    this.panel.title = found ? `Tour: ${found.tour.title}` : 'Open Questions'
  }

  private constructor(private readonly composite: CompositeIndex, initialTourSlug?: string) {
    OpenQuestionsPanel.instance = this
    this.activeTourSlug = initialTourSlug

    // ADR-0023: docs/adr/.working/ — committed substrate, not a gitignored
    // sidecar (Jérémie's completist reversal). Owned by the ADR directory,
    // not the workspace root.
    const cfg = vscode.workspace.getConfiguration('adrManager')
    const adrDirRel = cfg.get<string>('adrDirectory', 'docs/adr')
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const workingDir = workspaceRoot
      ? path.join(workspaceRoot, adrDirRel, '.working')
      : path.join(os.tmpdir(), 'adr-drafts-no-workspace')
    // adrPath portability (Loftsman/ios-client RFC, ruled by Lapidary
    // 2026-07-22 `2140`): passing workspaceRoot turns on write-canonical +
    // heal-on-save for the committed drafts.json's adrPath field.
    this.draftStore = new DraftStore(workingDir, workspaceRoot)
    if (this.draftStore.quarantinedFiles.length > 0) {
      // CATCH 1 (write-adversary): a corrupt drafts.json/drafts-archive.json
      // was found and quarantined (renamed aside, never deleted) rather than
      // silently discarded. Surface it — recovery from the .bak mirror
      // happens automatically, but the human should know it happened.
      vscode.window.showWarningMessage(
        `ADR Manager: found and quarantined ${this.draftStore.quarantinedFiles.length} corrupt draft file(s); recovered from backup where possible. See ${this.draftStore.quarantinedFiles.join(', ')}.`,
      )
    }

    this.panel = vscode.window.createWebviewPanel(
      'adrOpenQuestions',
      'Open Questions',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    )

    this.panel.webview.html = getHtml(computeBodyMaxWidth())
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.handleMessage(msg),
      null,
      this.disposables,
    )

    // Refresh when anything in the composite changes (file edits, saves,
    // etc.) — any root, not just the one that happened to be active first.
    const unsubscribe = composite.onChange(() => this.sendQuestions())
    this.disposables.push({ dispose: unsubscribe })

    // ADR-0023 square 4 (staleness banner, Riddle 5's design, 2026-07-24
    // `1834`): the vault (drafts.json) can change without the ADR/seed
    // content changing at all — a second Open Questions window saving a
    // draft for the same question. composite.onChange (above) never fires
    // for that. Re-push on any drafts.json write so every open panel
    // learns about it; the webview's own lastSentDraftText already
    // distinguishes "this is my own echo" from "another window wrote this"
    // (see submit()/the 'draft' input handler), so no self-write
    // suppression is needed here — same principle as the edit-time drift
    // banner (v0.7.33), applied to the vault side of the matrix instead of
    // the file side.
    if (workspaceRoot) {
      const draftsWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceRoot, `${adrDirRel}/.working/drafts.json`),
      )
      draftsWatcher.onDidChange(() => this.sendQuestions())
      draftsWatcher.onDidCreate(() => this.sendQuestions())
      this.disposables.push(draftsWatcher)
    }

    this.updatePanelTitle()
    this.sendQuestions()
  }

  /**
   * ADR-0018 Step 3: shared per-question row builder, used for both ADR-
   * sourced and seed-sourced questions. containerId feeds computeDraftKey
   * (a bare ADR number for ADRs, the seed's path for seeds — the fork
   * resolved in the draft-key fix); groupSortKey/groupLabel drive the
   * webview's TOC without it needing any container-kind-aware logic itself.
   */
  private buildRows(
    questions: Question[],
    opts: {
      containerId: string
      adrPath: string
      checksum: string
      sourceKind: 'adr' | 'seed'
      adrNumber: number
      adrContext: string | undefined
      groupSortKey: string
      groupLabel: string
      rootNamespace: string
    },
  ): WebviewQuestion[] {
    // ADR-0023: occurrence ordinals/counts computed over ALL questions in
    // the file (not just unanswered ones) — the key must be stable
    // regardless of which questions have already been answered and
    // filtered out below.
    const ordinals = computeOccurrenceOrdinals(questions.map(q => q.text))
    const totals = computeOccurrenceCounts(questions.map(q => q.text))

    return questions
      .map((q, idx) => ({ q, ordinal: ordinals[idx], total: totals[idx] }))
      .filter(({ q }) => !q.isAnswered && !this.shouldHideFromPanel(q))
      .map(({ q, ordinal, total }) => this.buildRow(q, ordinal, total, opts))
  }

  /**
   * ADR-0036 (ratified hide-allowlist doctrine): hiding a question from the
   * human's Open Questions panel is a privilege reserved for an enumerated
   * allowlist of tokens — `answered` hides unconditionally (the `!q.isAnswered`
   * filter above), `unresolved`/`deferred` join as CONFIGURABLE hiders, each
   * off by default. Default false matches Jérémie's own live-tested and
   * explicitly endorsed behavior ("I actually think have an allowlist... is
   * really smart... it's the right call") — today, before any setting
   * existed, both already showed; this only adds the OPT-IN to hide them,
   * never flips the default. Any OTHER/unrecognized status (a typo, an
   * invented word) always shows — recall-first, no exceptions.
   */
  private shouldHideFromPanel(q: Question): boolean {
    const status = q.statusText?.trim().toLowerCase()
    if (status === 'unresolved') return vscode.workspace.getConfiguration('adrManager').get<boolean>('unresolved.hideFromPanel', false)
    if (status === 'deferred') return vscode.workspace.getConfiguration('adrManager').get<boolean>('deferred.hideFromPanel', false)
    return false
  }

  /** The single-question body `buildRows` maps over — factored out so ADR-0034's tour mode can build exactly one row for a resolved entry, without needing a whole container's question list in hand. */
  private buildRow(
    q: Question,
    ordinal: number,
    total: number,
    opts: {
      containerId: string
      adrPath: string
      checksum: string
      sourceKind: 'adr' | 'seed'
      adrNumber: number
      adrContext: string | undefined
      groupSortKey: string
      groupLabel: string
      rootNamespace: string
    },
  ): WebviewQuestion {
    const draftKey = computeDraftKey(opts.containerId, q.text, ordinal)
    // getIfMatching, not get: a stale key whose duplicate-text group
    // shape has shifted (write-adversary CATCH 3) must never silently
    // restore into the wrong question's answer box.
    const draft = this.draftStore.getIfMatching(draftKey, q.text, total)
    return {
      id: q.id,
      text: q.text,
      whyAsking: q.whyAsking,
      whyDeferring: q.whyDeferring,
      need: q.need,
      recommendation: q.recommendation,
      recommendations: q.recommendations,
      body: q.rawBody,
      bodyPost: q.rawBodyPost,
      adrContext: opts.adrContext,
      adrNumber: opts.adrNumber,
      adrTitle: opts.groupLabel,
      adrPath: opts.adrPath,
      lineStart: q.lineStart,
      draftKey,
      totalOccurrences: total,
      fileChecksum: opts.checksum,
      draftText: draft?.draftText,
      existingAnswer: !q.isAnswered && q.answer ? q.answer.text : undefined,
      fileMtime: statMtimeMs(q.adrPath),
      draftSavedAt: draft?.updatedAt,
      draftSource: draft?.source,
      sourceKind: opts.sourceKind,
      groupSortKey: opts.groupSortKey,
      groupLabel: opts.groupLabel,
      rootNamespace: opts.rootNamespace,
      // ADR-0034 doctrine 9: only meaningful in tour mode (buildTourQuestions
      // overwrites tourEntry right after this call) — an already-answered
      // question is a review stop, never silence.
      isReviewStop: q.isAnswered,
      finalAnswerText: q.isAnswered ? q.answer?.text : undefined,
    }
  }

  /** Row-building opts for one ADR — shared between the full walk (sendQuestions) and a single resolved tour entry (buildTourRow), which only ever targets one ADR at a time. */
  private adrRowOpts(adr: AdrFile): {
    containerId: string; adrPath: string; checksum: string; sourceKind: 'adr'; adrNumber: number
    adrContext: string | undefined; groupSortKey: string; groupLabel: string; rootNamespace: string
  } {
    const node = this.composite.findRoot(adr.path)
    const namespace = node?.namespace ?? ''
    const num = String(adr.number).padStart(4, '0')
    return {
      containerId: `${namespace}:${adr.number}`,
      adrPath: adr.path,
      checksum: adr.checksum,
      sourceKind: 'adr',
      adrNumber: adr.number,
      adrContext: computeAdrContext(adr),
      groupSortKey: `${namespace}::0-${num}`,
      groupLabel: `ADR-${num}: ${stripAdrNumberPrefix(adr.title)}`,
      rootNamespace: namespace,
    }
  }

  private sendQuestions(): void {
    const questions = this.activeTourSlug ? this.buildTourQuestions(this.activeTourSlug) : this.buildAllQuestions()
    const tour = this.activeTourSlug ? this.buildTourMeta(this.activeTourSlug) : null

    const cfg = vscode.workspace.getConfiguration('adrManager')
    const settingsName = cfg.get<string>('humanName', '')
    this.questionsGeneration += 1
    this.panel.webview.postMessage({
      type: 'questions',
      questions,
      tour,
      renderTitleMarkdown: vscode.workspace.getConfiguration('adrManager').get<boolean>('renderMarkdownInQuestionTitles', true),
      // Priority: settings > git config > top name from ADR index
      gitAuthor: settingsName || getGitUserName() || extractHumanNames(this.composite.allAdrs())[0],
      recommendationCollapseThreshold: cfg.get<number>('panel.recommendationCollapseThreshold', 0),
      reportButtonEnabled: cfg.get<boolean>('reportButton.enabled', false),
      // Layout surgery (2026-07-30 inbox 2020): chrome gone by default, capability kept.
      showAuthorshipField: cfg.get<boolean>('showAuthorshipField', false),
      generation: this.questionsGeneration,
    })
  }

  /** The ordinary walk: every open question across every root — unchanged from before ADR-0034. */
  private buildAllQuestions(): WebviewQuestion[] {
    // ADR-0025 panel-aggregation (Option A): walk every root in the
    // composite, not just a single AdrIndex/SeedIndex pair. groupSortKey is
    // prefixed by root namespace FIRST so the TOC clusters by project (per
    // Lapidary's "per-root labels" lean) before falling back to the
    // existing ADR-before-seed, then numeric/path ordering within a root.
    // N=1 case: exactly one namespace, so the prefix is a no-op on display
    // order — zero conditionals needed to keep the single-root case trivial.
    const questions: WebviewQuestion[] = []
    for (const node of this.composite.walk()) {
      const adrRows: WebviewQuestion[] = node.adrs.allAdrs().flatMap(adr => this.buildRows(adr.questions, this.adrRowOpts(adr)))

      const seedRows: WebviewQuestion[] = node.seeds.allSeeds().flatMap(seed => {
        // Gleaner 5 / ledger row 25: the raw Date field carries whatever
        // annotation the author wrote ("2026-07-29 (dictated overnight,
        // ...)") — same title-site normalization as adrTreeProvider.ts's
        // sidebar labels, needed here too since this groupLabel is the
        // panel's own always-visible TOC header, not a tooltip.
        const dateStr = seed.date ? ` (${normalizeDateForTitle(seed.date)})` : ''
        return this.buildRows(seed.questions, {
          // Already globally unique (an absolute path) — no root-qualification needed.
          containerId: seed.path,
          adrPath: seed.path,
          checksum: seed.checksum,
          sourceKind: 'seed',
          adrNumber: 0,
          adrContext: undefined,
          groupSortKey: `${node.namespace}::1-${seed.path}`,
          groupLabel: `SEED${dateStr}: ${seed.topic}`,
          rootNamespace: node.namespace,
        })
      })

      questions.push(...adrRows, ...seedRows)
    }
    return questions
  }

  /**
   * ADR-0034 tour mode: exactly this tour's entries, in tour order,
   * filtered to those that resolve to a question — a seed-anchored or
   * broken ref isn't walkable in this slice (doctrine 3's broken-reference
   * visibility is met by buildTourMeta's brokenRefs list, surfaced in the
   * header, not woven into the per-question walk sequence). Doctrine 9
   * (Riddle's ruling, 2026-07-28): an already-answered entry is NOT
   * skipped — it stays in the walk as a review stop, rendered read-only by
   * the webview (isReviewStop/finalAnswerText, set in buildRow above).
   */
  private buildTourQuestions(slug: string): WebviewQuestion[] {
    const found = this.composite.findTour(slug)
    if (!found) return []
    const resolved = resolveTourEntries(found.tour, createRepositoryContextAdapter(this.composite))
    const rows: WebviewQuestion[] = []
    for (const entry of resolved) {
      if (entry.resolution.kind !== 'question') continue
      const row = this.buildRow(
        entry.resolution.question,
        ...this.tourEntryOrdinal(entry.resolution.adr, entry.resolution.question),
        this.adrRowOpts(entry.resolution.adr),
      )
      row.tourEntry = { comment: entry.comment, disposition: entry.disposition, answerPath: entry.answerPath, mustRespond: entry.mustRespond }
      rows.push(row)
    }
    return rows
  }

  /** Where `question` sits in its own ADR's full (unfiltered) question list — buildRow needs the SAME ordinal/total buildRows would have computed had it walked that ADR whole, so a tour-walked question's draftKey is identical to what the ordinary walk would use for the same question. */
  private tourEntryOrdinal(adr: AdrFile, question: Question): [number, number] {
    const idx = adr.questions.findIndex(q => q.id === question.id)
    const ordinals = computeOccurrenceOrdinals(adr.questions.map(q => q.text))
    const totals = computeOccurrenceCounts(adr.questions.map(q => q.text))
    return idx === -1 ? [0, 1] : [ordinals[idx], totals[idx]]
  }

  /** Doctrine 3 (broken refs are visible, never silent): brokenRefs collects every entry that failed to resolve, for the header — computed fresh from the live substrate on every push, same as doneness. */
  private buildTourMeta(slug: string): WebviewTourMeta | null {
    const found = this.composite.findTour(slug)
    if (!found) return null
    const resolved = resolveTourEntries(found.tour, createRepositoryContextAdapter(this.composite))
    this.logTourUnresolvedIfNeeded(found.tour, resolved)
    return {
      slug: found.tour.slug,
      title: found.tour.title,
      author: { name: found.tour.author.name, model: found.tour.author.model, role: found.tour.author.role },
      mintedAt: found.tour.minted_at,
      theme: found.tour.theme,
      retired: found.tour.retired,
      done: isTourDone(resolved),
      brokenRefs: resolved.filter(e => e.resolution.kind === 'error').map(e => e.ref),
    }
  }

  /**
   * ADR-0035 Iteration 2 (Riddle's design, 2026-07-29 feedback seed, item
   * C5): a tour opened/refreshed with unresolved entries appends one
   * error-record/2 (source: 'tour-resolver') with full reconstruction
   * context — the tour's own JSON, every unresolved ref with its reason,
   * and the full text (+ MD5) of every real file the tour DID successfully
   * touch (Lapidary's size guard: referenced documents only, never "all
   * ADRs"). Deduped per session by signature so re-opening the same broken
   * tour repeatedly writes one record. Gated by its own sublog key,
   * `adrManager.logging.tourUnresolvedRefs` (2026-07-30 addendum: granular
   * per-writer toggles, not one shared switch) — default true, SHIP-FLIP
   * per RELEASE-CHECKLIST.md. Failure-soft by contract, same as harvestError().
   */
  private logTourUnresolvedIfNeeded(tour: TourFile, resolved: ResolvedTourEntry[]): void {
    try {
      const unresolved = unresolvedTourRefs(resolved)
      if (unresolved.length === 0) return
      if (!vscode.workspace.getConfiguration('adrManager').get<boolean>('logging.tourUnresolvedRefs', true)) return

      const tourDoc = captureDocument(tour.path)
      const refDocs = referencedDocumentPaths(resolved)
        .map(p => ({ path: p, doc: captureDocument(p) }))
        .filter((d): d is { path: string; doc: { text: string; md5: string } } => !!d.doc)

      const signature = [
        tourDoc?.md5 ?? '',
        ...refDocs.map(d => d.doc.md5).sort(),
        ...unresolved.map(u => u.ref).sort(),
      ].join('|')
      if (this.tourUnresolvedSignaturesLogged.has(signature)) return
      this.tourUnresolvedSignaturesLogged.add(signature)

      const documents: Record<string, { text: string; md5: string }> = {}
      if (tourDoc) documents[tour.path] = tourDoc
      for (const d of refDocs) documents[d.path] = d.doc

      appendLedgerRecord({
        schema: 'error-record/2',
        ts: new Date().toISOString(),
        extensionVersion: vscode.extensions.getExtension('jlumbroso.adrs-for-ai')?.packageJSON?.version,
        source: 'tour-resolver',
        kind: 'tour-unresolved-refs',
        message: `${unresolved.length} entr${unresolved.length === 1 ? 'y' : 'ies'} in tour "${tour.title}" could not be resolved`,
        anchorPath: tourLedgerAnchor(tour.path),
        payload: { tourJson: tourDoc?.text, unresolved },
        documents,
      })
    } catch {
      /* failure-soft: never let the audit trail take down the panel */
    }
  }

  /**
   * ADR-0035 Iteration 3 (Lapidary's design, seed-2026-07-30 "frictionless
   * observation reporting"): "the report button is a human writer for
   * ADR-0035's error ledger." Jérémie's own words: preserving a problem for
   * later report used to fight with actually answering the question — this
   * is the freeze-evidence-free version. One command, one input box: type
   * the note, the current ADR's full content + hash is captured
   * automatically, nothing about the in-flight answer draft is touched.
   * Reuses error-record/2 as-is (source: 'panel', kind: 'observation') —
   * no schema addition, so no separate blessing gate the way a new field
   * would need (rootsConfigWriter.ts's `names` precedent).
   */
  private async reportObservation(msg: { adrPath: string; questionId?: string; draftKey?: string; renderedHtml?: string }): Promise<void> {
    // Its own sublog key (2026-07-30 addendum: granular per-writer toggles,
    // not one shared switch) — checked BEFORE prompting, so a disabled
    // writer never invites a note it's about to discard.
    if (!vscode.workspace.getConfiguration('adrManager').get<boolean>('logging.observations', true)) {
      vscode.window.setStatusBarMessage('ADR Manager: Observation logging is turned off (adrManager.logging.observations).', 4000)
      return
    }
    // Recovered spec (Lapidary's 2026-07-30 addendum to the report-button
    // seed, item 2 — the original: "a dialog opens that says do you want to
    // attach an optional comment and if you say yes OR NO... that would
    // create an entry"): the entry happens either way — the comment is
    // optional content ON TOP of pressing Report, not a gate on whether
    // anything gets recorded at all. showInputBox distinguishes Escape/
    // cancel (undefined — true "never mind, don't log this") from Enter on
    // an empty field ('' — "log it, I just have nothing to add"); the
    // original bug (a bare falsy check on the returned string) treated both
    // the same, silently dropping the no-comment case entirely.
    const note = await vscode.window.showInputBox({
      prompt: 'Report an observation about this question/ADR (optional comment) — saved for later review, does not affect your answer',
      placeHolder: 'What did you notice? (leave blank to just mark this moment)',
    })
    if (note === undefined) return // Escape/cancel — nothing recorded
    const message = note || 'manual user report from open dialog'
    try {
      const doc = captureDocument(msg.adrPath)
      appendLedgerRecord({
        schema: 'error-record/2',
        ts: new Date().toISOString(),
        extensionVersion: vscode.extensions.getExtension('jlumbroso.adrs-for-ai')?.packageJSON?.version,
        source: 'panel',
        kind: 'observation',
        message,
        anchorPath: msg.adrPath,
        payload: { questionId: msg.questionId, draftKey: msg.draftKey, note: note || undefined, renderedHtml: msg.renderedHtml },
        documents: doc ? { [msg.adrPath]: doc } : undefined,
      })
      vscode.window.setStatusBarMessage('ADR Manager: Observation recorded.', 3000)
    } catch {
      /* failure-soft: reporting a problem must never itself become one */
    }
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'answer': await this.writeAnswer(msg); break
      case 'skip': this.panel.webview.postMessage({ type: 'skip_ack' }); break
      case 'jumpTo': await this.openAtLine(msg.adrPath, msg.lineNumber); break
      case 'draft':
        // ADR-0023: debounced (~500ms) auto-save from the webview's textarea input.
        this.draftStore.save(
          msg.draftKey, msg.adrPath, msg.adrNumber, msg.questionText, msg.draftText,
          new Date().toISOString(), msg.totalOccurrences,
          // Provenance + the CAS clobber fence (ADR-0023's solemn promise):
          // prevDraftText is what THIS window believes it is replacing —
          // a vault mismatch means another window/surface wrote in
          // between, and the vault archives that content marked
          // 'clobbered' before accepting this save.
          { source: 'panel', expectedPrevText: msg.prevDraftText },
        )
        break
      case 'refreshRequest':
        // ADR-0023 drift fence, "Refresh" choice: force a re-parse so the
        // panel's next 'questions' push reflects the file as it is now.
        this.sendQuestions()
        break
      case 'retrySave': await this.retrySave(msg.adrPath); break
      case 'showDraftDiff': await this.showDraftDiff(msg.mine, msg.theirs, msg.questionText); break
      case 'exitTour': this.setTour(undefined); break
      case 'reportObservation': await this.reportObservation(msg); break
    }
  }

  // ---------------------------------------------------------------------------
  // Write answer back to the ADR file
  // ---------------------------------------------------------------------------

  /**
   * Error harvesting at the point of failure (Jérémie's charter, 2026-07-25):
   * every panel error appends a full-reconstruction record — entire ADR text,
   * entire answer box, the triggering message — to the owning root's
   * `.working/errors.jsonl`. Gated by `adrManager.logging.panelErrors`
   * (default ON for the collection era; SHIP-FLIP — see RELEASE-CHECKLIST.md
   * — flips every `adrManager.logging.*` default OFF before the first
   * public release). One of several per-writer sublog keys (Lapidary's
   * 2026-07-30 addendum: "logging.<sublog> settings, individually
   * toggleable, because logging costs speed") — this file's OTHER writers
   * (logTourUnresolvedIfNeeded, reportObservation) each get their own,
   * rather than sharing one switch that couldn't be tuned per-writer.
   * Failure-soft by contract: harvesting must never break the surface it
   * observes, so this method cannot throw.
   */
  private harvestError(
    kind: string,
    message: string,
    msg?: { adrPath?: string; questionId?: string; draftKey?: string; answerText?: string } & Record<string, unknown>,
  ): void {
    try {
      if (!vscode.workspace.getConfiguration('adrManager').get<boolean>('logging.panelErrors', true)) return
      if (!msg?.adrPath) return
      // Retry-storm dedupe: a retry loop hitting the same failure over and
      // over should write one ledger record, not one per retry cycle.
      // Signature is kind+adrPath+questionId+message — a genuinely
      // different failure (different kind, different question, different
      // message) always still logs. ADR-0035's failure-soft clause applies
      // here too: if the signature can't be computed for any reason, fall
      // through and log anyway — dedupe correctness must never gate
      // whether logging happens at all.
      try {
        const signature = errorSignature(kind, msg.adrPath, msg.questionId, message)
        if (this.harvestErrorSignaturesLogged.has(signature)) return
        this.harvestErrorSignaturesLogged.add(signature)
      } catch { /* fall through and log anyway */ }
      // Redact the box text from the meta copy — it's already first-class in
      // boxText; duplicating full drafts in meta doubles record size for nothing.
      const { answerText: _omit, ...metaMsg } = msg
      appendErrorRecord(buildErrorRecord(kind, message, msg.adrPath, {
        extensionVersion: vscode.extensions.getExtension('jlumbroso.adrs-for-ai')?.packageJSON?.version,
        questionId: msg.questionId,
        draftKey: msg.draftKey,
        boxText: msg.answerText,
        meta: { triggeringMessage: metaMsg },
      }))
    } catch {
      /* failure-soft: never let the audit trail take down the panel */
    }
  }

  private async writeAnswer(msg: {
    questionId: string
    adrPath: string
    lineStart: number
    answerText: string
    authorName: string
    draftKey: string
    fileChecksum: string
    force?: boolean
    sourceKind: 'adr' | 'seed'
    confirmedInsertion?: boolean
    /** Insertion-preview ±1 adjustment: applied to the server-computed insertion line before writing. */
    insertLineOffset?: number
    /** ADR-0036: "Respond (unresolved)" writes the same ANS layer but sets Status: unresolved instead of answered — the human has contributed content, but the ball moves to the model's court rather than closing the question. Defaults to 'answered' (the ordinary Answer gesture). */
    targetStatus?: 'answered' | 'unresolved'
  }): Promise<void> {
    try {
      const uri = vscode.Uri.file(msg.adrPath)
      const doc = await vscode.workspace.openTextDocument(uri)
      const currentContent = doc.getText()

      // ADR-0025 panel-aggregation (Option A): resolve which root owns this
      // write BEFORE anything else — the clobber-adjacent stake this QST
      // exists for is a write landing in (or being attributed to) the wrong
      // project when two roots share an ADR number. Refuse rather than
      // guess if the file isn't under any known root (same "never write
      // blind" discipline as the drift fence below).
      const owningRoot = this.composite.findRoot(msg.adrPath)
      if (!owningRoot) {
        const message = `Could not determine which project owns ${msg.adrPath} — it may be outside every discovered root. Please answer it manually.`
        this.harvestError('owning-root-not-found', message, msg)
        this.panel.webview.postMessage({ type: 'error', message })
        return
      }

      // ADR-0023 drift fence: never write blind. If the file changed under
      // this in-flight answer, stop and let the human choose — the draft
      // (already auto-saved) is safe in all three consent paths.
      if (!msg.force) {
        const currentChecksum = crypto.createHash('sha1').update(currentContent).digest('hex')
        if (currentChecksum !== msg.fileChecksum) {
          // Not an error the human sees as one, but the near-miss IS the
          // specimen: every drift record is a clobber that didn't happen.
          this.harvestError('drift-detected', `File changed under in-flight answer (checksum ${msg.fileChecksum.slice(0, 8)} → ${currentChecksum.slice(0, 8)})`, msg)
          this.panel.webview.postMessage({ type: 'driftDetected', questionId: msg.questionId })
          return
        }
      }

      // Re-resolve the question's CURRENT position rather than trusting
      // msg.lineStart, which was captured at render time and can be stale —
      // critical under `force` (the drift fence's checksum check is skipped
      // there entirely). Write-adversary finding (Quarry 5): a stale line
      // offset against shifted content can land the search window in a
      // DIFFERENT question's block, silently overwriting it — misattribution,
      // not just loss. Refuse (visible error) rather than guess when the
      // question can't be relocated, e.g. its heading text itself changed.
      //
      // CATCH 6 (Quarry 5, follow-on): Question.id is NOT reliably stable
      // across a line shift for duplicate-heading-text questions — its
      // duplicate-slug disambiguator embeds the raw heading line number
      // (extractor.ts buildSection), so an edit anywhere ABOVE a duplicate-
      // text question changes its id even though the question itself never
      // changed. draftKey (containerId + normalized-text hash + occurrence
      // ordinal — computeDraftKey/draftKey.ts) carries no line number at
      // all, so it survives exactly the shift id can't; try it first, with
      // id as a secondary confirmation for the common (non-duplicate) case.
      //
      // ADR-0018 Step 3: a seed question's id/draftKey scheme is only
      // resolvable via parseSeed's own question list — parseAdr's collector
      // doesn't know about seed-scoped ids, so re-parsing a seed file with
      // parseAdr would never find the question, no matter how it's matched.
      let freshQuestions: Question[]
      let freshContainerId: string
      if (msg.sourceKind === 'seed') {
        freshQuestions = parseSeed(currentContent, msg.adrPath).questions
        freshContainerId = msg.adrPath
      } else {
        const freshAdr = parseAdr(currentContent, msg.adrPath, { namespace: owningRoot.namespace })
        freshQuestions = freshAdr.questions
        // Root-qualified to match sendQuestions()'s containerId — see the
        // rootNamespace doc comment on WebviewQuestion for why a bare
        // adrNumber isn't safe once more than one root exists.
        freshContainerId = `${owningRoot.namespace}:${freshAdr.number}`
      }
      const freshOrdinals = computeOccurrenceOrdinals(freshQuestions.map(q => q.text))
      const currentQuestion = freshQuestions.find((q, i) =>
        computeDraftKey(freshContainerId, q.text, freshOrdinals[i]) === msg.draftKey || q.id === msg.questionId,
      )
      if (!currentQuestion) {
        const message = `Could not relocate this question in ${msg.adrPath} — it may have been edited or removed. Please answer it manually.`
        this.harvestError('question-relocation-failed', message, msg)
        this.panel.webview.postMessage({ type: 'error', message })
        return
      }

      const lines = currentContent.split('\n')
      const edit = new vscode.WorkspaceEdit()

      // Scan from the QST heading (1-indexed → 0-indexed) to EOF — real
      // boundaries (any heading, thematic break, end of file) terminate the
      // block; there is NO arbitrary line cap. The old 40-line window's cap
      // doubled as the append fallback's insertion point, and a ~50-line
      // ORJ question block (caring-form blocking-docket, 2026-07-18,
      // DEBRIEF-006) got Jérémie's answer spliced mid-sentence into the
      // recommendation at exactly heading+40. See answerWriteScan.ts.
      const start = currentQuestion.lineStart - 1

      // One scan, built from the extractor's own exported regexes — the
      // private near-copy that lived here refused bold-Status questions the
      // extractor itself had surfaced (crossfoot ADR-0030, 2026-07-16) and
      // didn't know handle-form QST boundaries. See answerWriteScan.ts.
      const { statusLineIdx, ansHeaderLineIdx, fillLineIdx, blockEndLineIdx, boundaryKind, ansContentEndLineIdx } =
        scanAnswerWriteAnchors(lines, start)

      // 1. Update status → answered (or, ADR-0036, unresolved — the human
      // has contributed content but the ball moves to the model's court)
      const targetStatus = msg.targetStatus === 'unresolved' ? 'unresolved' : 'answered'
      if (statusLineIdx >= 0) {
        edit.replace(uri, lineRange(doc, statusLineIdx), `- Status: ${targetStatus}`)
      }

      // 2. Update the **ANS:** author line
      if (ansHeaderLineIdx >= 0) {
        const author = msg.authorName.trim() || 'Human'
        edit.replace(uri, lineRange(doc, ansHeaderLineIdx), `**ANS:** (by ${author})`)
      }

      // 3. Replace [Fill this in] with the answer (or insert after ANS header,
      // or append a brand-new ANS block if this question has neither an ANS
      // marker nor a placeholder at all)
      if (fillLineIdx >= 0) {
        edit.replace(uri, lineRange(doc, fillLineIdx), msg.answerText)
      } else if (ansHeaderLineIdx >= 0) {
        // No placeholder — the ANS block already holds REAL content (under
        // Status-authority this is the normal shape of an open question
        // carrying a draft: elenchus legacy, all six waitlist QSTs). The
        // write REPLACES the entire existing answer extent [ansHeader,
        // ansContentEnd) with the canonical two-line block — replace
        // semantics, "a QST has exactly one current answer." The old
        // insert-after-header path PREPENDED the new answer onto the old
        // one, and on the same-line ANS form ("**ANS:** (by X) text…") the
        // header rewrite destroyed the old answer's first line (Jérémie,
        // 2026-07-23). Blind loss is prevented one step earlier: the
        // existing draft is prefilled into the textarea (existingAnswer),
        // so what's being replaced was on screen when Answer was pressed.
        const author = msg.authorName.trim() || 'Human'
        const replaceRange = new vscode.Range(
          new vscode.Position(ansHeaderLineIdx, 0),
          doc.lineAt(Math.max(ansHeaderLineIdx, ansContentEndLineIdx - 1)).range.end,
        )
        edit.replace(uri, replaceRange, `**ANS:** (by ${author})\n${msg.answerText}`)
      } else if (boundaryKind !== 'window' && this.missingAnsBehavior(uri) !== 'refuse') {
        // No statusLineIdx requirement here (Jérémie, 2026-07-25): a QST
        // block with NO "- Status:" line at all is fully surfaceable —
        // status-authority derives openness from the absent answer — but
        // this gate used to demand the Status anchor and hard-refuse the
        // write ("Could not find the ANS block"), even though the insertion
        // point is computed from the block END, not from Status. Once the
        // fresh ANS block lands, answered-ness derives from the answer
        // content (the same derived path that surfaced the question), so
        // skipping step 1's status flip is correct, not a gap. The
        // insertion-preview confirm below still guards the guess.
        // Missing-ANS fallback (Lapidary 5, 2026-07-13, specimen 1 — Jérémie
        // hit this hand-answering a grammar seed tonight): a QST block can
        // have a reliable "- Status:" field and no ANS marker or placeholder
        // whatsoever — the panel used to just refuse ("Please answer it
        // manually"), even though Status is exactly the reliable anchor
        // that already lets step 1 above flip it to answered. Append a
        // fresh ANS block at the end of this question's extent (just
        // before the next heading/thematic break), trimming back over any
        // trailing blank lines so it lands directly after the last real
        // content line, not floating in whitespace.
        const author = msg.authorName.trim() || 'Human'
        let insertLineIdx = blockEndLineIdx
        while (insertLineIdx > start && lines[insertLineIdx - 1].trim() === '') insertLineIdx--

        // Insertion-preview ±1 adjustment (Jérémie via Gleaner's sweep,
        // 2026-07-31: "if we are not sure, we should make a guess, and let
        // the user - (move back a line) or + (move down a line)"). The
        // webview only ever sends this alongside confirmedInsertion:true,
        // after the human has nudged the marker within the previewed
        // context window — clamp to the question's own extent so a runaway
        // offset can't land the ANS block outside its own block.
        if (msg.insertLineOffset) {
          insertLineIdx = Math.min(Math.max(insertLineIdx + msg.insertLineOffset, start), blockEndLineIdx)
        }

        // Insertion-preview protocol (Jérémie's own design, 2026-07-13,
        // docs/inbox/2026-07-13-0710-...; DEBRIEF-006, 2026-07-18: never
        // built until now — this insertion point is a COMPUTED GUESS, not
        // an exact marker match, and the guess once landed mid-sentence in
        // someone else's recommendation). "confirm" (default): show the
        // surrounding lines and stop here — the webview re-sends this exact
        // message with confirmedInsertion:true once the human approves.
        // "silent": skip the preview, insert immediately (pre-DEBRIEF-006
        // behavior, now at least boundary-safe). "refuse" already exited
        // this branch above.
        if (this.missingAnsBehavior(uri) === 'confirm' && !msg.confirmedInsertion) {
          const preview = buildInsertionPreview(lines, insertLineIdx)
          this.panel.webview.postMessage({ type: 'insertionPreview', before: preview.before, after: preview.after, message: msg })
          return
        }

        const pos = new vscode.Position(insertLineIdx, 0)
        edit.insert(uri, pos, `\n**ANS:** (by ${author})\n${msg.answerText}\n`)
      } else {
        // Fallback: can't find where to insert — report error
        const message = `Could not find the ANS block near line ${currentQuestion.lineStart} in ${msg.adrPath}. Please answer this one manually.`
        this.harvestError('ans-anchor-not-found', message, msg)
        this.panel.webview.postMessage({ type: 'error', message })
        return
      }

      // "Question doesn't advance" residual (Lapidary 5, 2026-07-12): prior
      // fixes here checked neither applyEdit's nor save()'s return value —
      // Cmd+Enter's correctness silently depended on the disk write landing
      // every single time. Harden the instance, on top of killing the class
      // (extension.ts's new onDidChangeTextDocument trigger):
      const applied = await vscode.workspace.applyEdit(edit)
      if (!applied) {
        const message = `The edit could not be applied to ${msg.adrPath} — nothing was written. Please try again or answer manually.`
        this.harvestError('workspace-edit-rejected', message, msg)
        this.panel.webview.postMessage({ type: 'error', message })
        return
      }

      // Not-dirty / no-visible-editor false positive (Lapidary 5,
      // 2026-07-16, caught on camera in a GIF take — Jérémie: "seen it
      // blink past many times"): vscode.workspace.save(uri) requires an
      // actual open EDITOR for that URI ("an editor with the provided
      // resource must be opened in order to be saved" — @types/vscode).
      // The panel never shows an editor for the file it's answering into
      // (that's the whole point — "answerable in place"), so this almost
      // always resolved undefined regardless of whether applyEdit's write
      // actually landed, making the retry-and-warn path fire on ordinary,
      // successful writes. doc.save() (TextDocument.save()) operates on
      // the document model directly and needs no visible editor — the
      // correct API for "did this document's pending edit get written."
      let saved = await doc.save()
      if (!saved) {
        // A single retry clears the common transient case (a momentary fs
        // hiccup, a race with another writer); only warn if it fails twice.
        saved = await doc.save()
      }

      // Reindex from the BUFFER (doc.getText()), not disk (indexFile()) —
      // applyEdit already succeeded, so the buffer reflects the answer
      // regardless of whether the disk save did. This is what actually kills
      // this instance of the bug class: the panel's advance no longer
      // depends on the save round-trip completing at all.
      // ADR-0018 Step 3 + ADR-0025 panel-aggregation: reindex the container
      // this write actually belongs to — indexing a seed path via AdrIndex
      // would misfile it there, and reindexing through the WRONG root's
      // AdrIndex would leave the correct root's copy stale (the write lands
      // correctly on disk either way, since msg.adrPath is already an
      // absolute path, but the in-memory index driving the panel needs to
      // be the owning root's, not a global singleton that only knows one root).
      const freshContent = doc.getText()
      if (msg.sourceKind === 'seed') {
        owningRoot.seeds.indexContent(msg.adrPath, freshContent)
      } else {
        owningRoot.adrs.indexContent(msg.adrPath, freshContent)
      }

      // ADR-0023: answer submitted is one atomic event — the draft is
      // promoted (archived, never deleted), not left dangling in the active set.
      this.draftStore.promote(msg.draftKey, new Date().toISOString())

      if (!saved) {
        // Silent partial success is the D9.4 shape again (the UI lying by
        // omission) — the panel DID advance (buffer truth), but the answer
        // isn't actually on disk yet. Say so.
        this.panel.webview.postMessage({
          type: 'answered',
          questionId: msg.questionId,
          adrPath: msg.adrPath,
          warning: `Answer applied but not yet saved to disk (${msg.adrPath}) — save the file manually to make sure it isn't lost.`,
        })
        return
      }

      this.panel.webview.postMessage({ type: 'answered', questionId: msg.questionId })
    } catch (err) {
      this.harvestError('unhandled-exception', String(err), msg)
      this.panel.webview.postMessage({ type: 'error', message: String(err) })
    }
  }

  /**
   * "Save now" retry (Lapidary 5, 2026-07-16) for the persistent save-
   * failure warning. Uses doc.save() (TextDocument.save()) for the same
   * reason writeAnswer does — vscode.workspace.save(uri) requires an open
   * editor for the URI, which this panel deliberately never has.
   */
  private async retrySave(adrPath: string): Promise<void> {
    try {
      const uri = vscode.Uri.file(adrPath)
      const doc = await vscode.workspace.openTextDocument(uri)
      const saved = await doc.save()
      this.panel.webview.postMessage({ type: 'saveRetryResult', adrPath, saved })
    } catch {
      this.panel.webview.postMessage({ type: 'saveRetryResult', adrPath, saved: false })
    }
  }

  /**
   * ADR-0023 square 4 (staleness banner) "See diff" — Riddle 5's design,
   * 2026-07-24 `1834`: VS Code's own diff editor over two virtual, untitled
   * documents rather than a bespoke webview differ. Deliberately the
   * simpler of the two options the brief names (a `adr-draft:`
   * TextDocumentContentProvider vs. untitled docs) — no scheme
   * registration or provider lifecycle to manage for a view that's
   * inspect-only by nature.
   */
  private async showDraftDiff(mine: string, theirs: string, questionText: string): Promise<void> {
    const left = await vscode.workspace.openTextDocument({ content: mine })
    const right = await vscode.workspace.openTextDocument({ content: theirs })
    await vscode.commands.executeCommand('vscode.diff', left.uri, right.uri, `Your draft ↔ Updated draft — ${questionText}`)
  }

  /**
   * DEBRIEF-006 / insertion-preview protocol: adrManager.missingAnsBehavior,
   * resource-scoped so a multi-root workspace can set it per-folder — same
   * scoping pattern as adrManager.clickOpensIn.
   */
  private missingAnsBehavior(uri: vscode.Uri): 'confirm' | 'silent' | 'refuse' {
    return vscode.workspace.getConfiguration('adrManager', uri).get<'confirm' | 'silent' | 'refuse'>('missingAnsBehavior', 'confirm')
  }

  private async openAtLine(adrPath: string, lineNumber: number): Promise<void> {
    const uri = vscode.Uri.file(adrPath)
    const doc = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Two, true)
    const pos = new vscode.Position(Math.max(0, lineNumber - 1), 0)
    editor.selection = new vscode.Selection(pos, pos)
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
  }

  private dispose(): void {
    OpenQuestionsPanel.instance = undefined
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
  }
}

// ---------------------------------------------------------------------------
// Panel body width (ADR-0010 answered QST)
// ---------------------------------------------------------------------------

function computeBodyMaxWidth(): string {
  const cfg = vscode.workspace.getConfiguration('adrManager')
  return bodyMaxWidthCss(cfg.get<string>('panel.bodyMaxWidth', '1100'))
}

// ---------------------------------------------------------------------------
// Author name helpers
// ---------------------------------------------------------------------------

/** Try to get the git user name from the workspace's git config. */
function getGitUserName(): string | undefined {
  try {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const result = execSync('git config user.name', {
      encoding: 'utf-8',
      cwd: workspaceRoot,
      timeout: 2000,
    }).trim()
    return result || undefined
  } catch {
    return undefined
  }
}

/**
 * Extract human author names from the ADR index, ranked by frequency.
 * Filters out AI model names (Sonnet, Opus, Haiku, Claude, GPT, Gemini, etc.)
 * so only human names appear in the suggestion list.
 */
function extractHumanNames(adrs: AdrFile[]): string[] {
  const freq = new Map<string, number>()
  const bump = (name: string) => freq.set(name, (freq.get(name) ?? 0) + 1)

  const AI_NAME_RE = /sonnet|opus|haiku|claude|gpt|gemini|llama|mistral/i

  for (const adr of adrs) {
    for (const d of adr.deciders) {
      if (!AI_NAME_RE.test(d)) bump(d)
    }
    for (const q of adr.questions) {
      if (q.answer?.author && !AI_NAME_RE.test(q.answer.author)) bump(q.answer.author)
    }
    for (const c of adr.inlineCodes) {
      if (c.author && !AI_NAME_RE.test(c.author)) bump(c.author)
    }
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
}

// ---------------------------------------------------------------------------
// Utility: get the full range of a line in a document
// ---------------------------------------------------------------------------

const mtimeCache = new Map<string, number>()
function statMtimeMs(p: string): number | undefined {
  // Cached per push-cycle would be ideal; a plain cache with overwrite on
  // every call is fine — statSync is cheap and correctness (freshest mtime
  // on each push) matters more than the microseconds saved.
  try { const m = fs.statSync(p).mtimeMs; mtimeCache.set(p, m); return m } catch { return mtimeCache.get(p) }
}

function lineRange(doc: vscode.TextDocument, lineIdx: number): vscode.Range {
  const line = doc.lineAt(lineIdx)
  return line.range
}

// ---------------------------------------------------------------------------
// HTML / CSS / JS for the webview
// ---------------------------------------------------------------------------

function getHtml(bodyMaxWidth: string): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Open Questions</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:var(--vscode-font-family);
  font-size:var(--vscode-font-size);
  color:var(--vscode-foreground);
  background:var(--vscode-editor-background);
  padding:32px 24px;
}
#empty{
  display:none;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  height:60vh;
  opacity:.6;
  text-align:center;
  gap:12px;
}
#empty .icon{font-size:48px}
#card{max-width:${bodyMaxWidth};margin:0 auto}
.counter{
  font-size:11px;
  color:var(--vscode-descriptionForeground);
  letter-spacing:.05em;
  text-transform:uppercase;
  margin-bottom:8px;
}
.progress{
  width:100%;height:3px;
  background:var(--vscode-scrollbarSlider-background);
  border-radius:2px;
  margin-bottom:28px;overflow:hidden;
}
.progress-fill{
  height:100%;
  background:var(--vscode-progressBar-background);
  border-radius:2px;
  transition:width .4s ease;
}
.adr-link{
  display:inline-flex;align-items:center;gap:6px;
  background:var(--vscode-badge-background);
  color:var(--vscode-badge-foreground);
  border-radius:4px;
  padding:3px 10px;
  font-size:11px;font-weight:600;
  cursor:pointer;
  margin-bottom:14px;
  border:none;
  font-family:var(--vscode-font-family);
}
.adr-link:hover{opacity:.8}
/* ADR-0025 panel-aggregation: root-filter chip bar, TOC overlay only.
   Hidden entirely when the question set spans a single root (N=1 stays
   the trivial case — no chip bar clutters the common single-project view). */
#q-root-filter{
  display:none;
  flex-wrap:wrap;
  gap:6px;
  padding:0 20px 10px;
}
.root-chip{
  display:inline-flex;align-items:center;
  background:var(--vscode-badge-background);
  color:var(--vscode-badge-foreground);
  border-radius:12px;
  padding:2px 10px;
  font-size:11px;font-weight:600;
  cursor:pointer;
  border:1px solid transparent;
  font-family:var(--vscode-font-family);
  opacity:.65;
}
.root-chip:hover{opacity:.85}
.root-chip.active{
  opacity:1;
  border-color:var(--vscode-focusBorder);
}
.qtext{
  font-size:20px;font-weight:600;
  line-height:1.4;
  margin-bottom:16px;
  color:var(--vscode-editor-foreground);
}
/* ADR-0010: Context box — collapsible summary of ADR before the question */
.ctx-details{
  margin-bottom:16px;
  background:var(--vscode-textBlockQuote-background);
  border:1px solid var(--vscode-textBlockQuote-border,#555);
  border-radius:4px;
  overflow:hidden;
}
.ctx-details summary{
  font-size:11px;
  font-weight:600;
  letter-spacing:.04em;
  text-transform:uppercase;
  color:var(--vscode-descriptionForeground);
  padding:7px 12px;
  cursor:pointer;
  user-select:none;
  list-style:none;
}
.ctx-details summary::-webkit-details-marker{display:none}
.ctx-details summary::before{content:'▶ '}
.ctx-details[open] summary::before{content:'▼ '}
.ctx-body{
  padding:12px 16px 14px;
  border-top:1px solid var(--vscode-textBlockQuote-border,#555);
  font-size:12px;
  line-height:1.6;
  overflow:auto;
}
/* Markdown rendering inside context body */
.ctx-body h2,.ctx-body h3{font-size:13px;font-weight:600;margin:12px 0 4px}
.ctx-body h2:first-child,.ctx-body h3:first-child{margin-top:0}
.ctx-body p{margin:0 0 8px}
.ctx-body p:last-child{margin-bottom:0}
.ctx-body code{
  font-family:var(--vscode-editor-font-family,monospace);
  font-size:11px;
  background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.15));
  padding:1px 4px;border-radius:3px;
}
.ctx-body pre{
  font-family:var(--vscode-editor-font-family,monospace);
  font-size:11px;
  background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.15));
  padding:8px 12px;border-radius:4px;
  overflow-x:auto;
  margin:6px 0;
  white-space:pre;
}
.ctx-body blockquote{
  border-left:3px solid var(--vscode-textBlockQuote-border,#555);
  margin:0 0 8px 0;
  padding:4px 12px;
  opacity:.85;
}
.ctx-body table{border-collapse:collapse;width:100%;margin:8px 0}
.ctx-body th,.ctx-body td{
  border:1px solid var(--vscode-textBlockQuote-border,#555);
  padding:4px 8px;
  font-size:11px;
  text-align:left;
}
.ctx-body th{background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.15));font-weight:600}
.ctx-body ul,.ctx-body ol{padding-left:20px;margin:4px 0}
.ctx-body li{margin:2px 0}
.ctx-body strong{font-weight:600}
.ctx-body em{font-style:italic}
.ctx-body hr{border:none;border-top:1px solid var(--vscode-textBlockQuote-border,#555);margin:10px 0}
/* Why / recommendation */
.why{
  font-size:12px;
  color:var(--vscode-descriptionForeground);
  background:var(--vscode-textBlockQuote-background);
  border-left:3px solid var(--vscode-textBlockQuote-border);
  padding:10px 14px;
  border-radius:0 4px 4px 0;
  margin-bottom:12px;
  line-height:1.5;
}
.recommendation{
  font-size:12px;
  color:var(--vscode-editor-foreground);
  background:var(--vscode-diffEditor-insertedTextBackground,rgba(155,185,85,.1));
  border-left:3px solid var(--vscode-charts-green,#4ec9b0);
  padding:10px 14px;
  border-radius:0 4px 4px 0;
  margin-bottom:20px;
  line-height:1.5;
}
/* ADR-0019: most-recent recommendation in a stack is visually emphasized */
.recommendation.rec-recent{
  border-left-width:4px;
}
/* ADR-0019: attribution chip — color deterministic from author slug */
.rec-chip{
  display:inline-block;
  font-size:10px;font-weight:700;
  letter-spacing:.03em;
  padding:2px 8px;
  border-radius:10px;
  margin-bottom:6px;
  color:#fff;
  background:var(--chip-color, var(--vscode-badge-background));
}
.rec-chip-inferred{
  border-bottom:1px dotted rgba(255,255,255,.7);
}
/* Markdown HTML rendering inside why/recommendation/body/review-stop containers */
.why code,.recommendation code,.qst-body code,.review-stop-answer code{
  font-family:var(--vscode-editor-font-family,monospace);
  font-size:11px;
  background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.15));
  padding:1px 4px;border-radius:3px;
}
.why pre,.recommendation pre,.qst-body pre,.review-stop-answer pre{
  font-family:var(--vscode-editor-font-family,monospace);
  font-size:11px;
  background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.15));
  padding:8px 12px;border-radius:4px;
  overflow-x:auto;margin:6px 0;white-space:pre;
}
.why ul,.why ol,.recommendation ul,.recommendation ol,.review-stop-answer ul,.review-stop-answer ol{padding-left:20px;margin:6px 0}
.why li,.recommendation li,.review-stop-answer li{margin:3px 0}
.why p,.recommendation p,.qst-body p,.review-stop-answer p{margin:0 0 6px}
.why p:last-child,.recommendation p:last-child,.qst-body p:last-child,.review-stop-answer p:last-child{margin-bottom:0}
.why strong,.recommendation strong,.review-stop-answer strong{font-weight:600}
.why em,.recommendation em,.review-stop-answer em{font-style:italic}
.author-row{
  display:flex;align-items:center;gap:8px;
  margin-bottom:10px;
}
.author-row label{
  font-size:12px;
  color:var(--vscode-descriptionForeground);
  white-space:nowrap;
}
.author-row input{
  flex:1;padding:5px 9px;
  background:var(--vscode-input-background);
  color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border,transparent);
  border-radius:3px;
  font-family:var(--vscode-font-family);font-size:13px;
  outline:none;
}
.author-row input:focus{border-color:var(--vscode-focusBorder)}
textarea{
  width:100%;min-height:110px;
  padding:10px 12px;
  background:var(--vscode-input-background);
  color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border,transparent);
  border-radius:4px;
  /* ADR-0038 tier 1: the answer box inherits the user's own EDITOR font
     (what they've configured for writing text/code), not VS Code's UI
     chrome font — the prior rule read the UI-chrome variable instead,
     which is why no amount of editor.fontFamily tuning ever reached
     this field. */
  font-family:var(--vscode-editor-font-family);
  font-size:var(--vscode-editor-font-size,14px);
  font-weight:var(--vscode-editor-font-weight,normal);
  line-height:1.6;resize:vertical;outline:none;
}
textarea:focus{border-color:var(--vscode-focusBorder)}
/* Expand-field affordance (Jérémie, 2026-07-24, system3 ADR-0017 case
   study: a 6,900-char answer-thread in a 110px porthole reads as absence —
   "by rendering it at all, it would inform me that this is not an
   'unanswered' question but one of the most complex threads"). Expanded
   mode grows the SAME element (value, cursor, drafts untouched) to fill
   most of the panel viewport. */
textarea.expanded{min-height:70vh;height:70vh}
.hint{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
/* Layout surgery (2026-07-30 inbox 2020): the expand-field link's own
   row, flush right, directly above the textarea — its one home,
   regardless of whether the authorship row above it is shown or not. */
.expand-row{display:flex;justify-content:flex-end;margin-bottom:6px}
.expand-link{
  cursor:pointer;text-decoration:none;white-space:nowrap;
  color:var(--vscode-textLink-foreground);
  font-size:11px;
}
.expand-link:hover{text-decoration:underline}
/* ADR-0023: draft restored indicator — grey, never red (penn-cv 039 It.5) */
.draft-restored{
  font-size:11px;
  color:var(--vscode-descriptionForeground);
  margin-top:5px;
}
.draft-flash{
  display:none;align-items:center;gap:6px;
  color:var(--vscode-descriptionForeground);
  font-size:12px;
  opacity:.85;
}
/* ADR-0023 drift fence: three-choice consent bar */
.drift-bar{
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  margin-top:12px;padding:10px 14px;
  background:var(--vscode-inputValidation-warningBackground,rgba(220,180,50,.12));
  border:1px solid var(--vscode-inputValidation-warningBorder,#a9822c);
  border-radius:4px;
  font-size:12px;
}
/* Insertion-preview protocol (DEBRIEF-006): reuses the drift-bar look, but
   the marker/context needs a monospace block instead of a one-line message. */
.insertion-preview-bar{
  display:flex;flex-direction:column;gap:8px;
  margin-top:12px;padding:10px 14px;
  background:var(--vscode-inputValidation-warningBackground,rgba(220,180,50,.12));
  border:1px solid var(--vscode-inputValidation-warningBorder,#a9822c);
  border-radius:4px;
  font-size:12px;
}
.insertion-preview-context{
  margin:0;padding:8px 10px;
  background:var(--vscode-textCodeBlock-background,rgba(0,0,0,.15));
  border-radius:3px;
  font-family:var(--vscode-editor-font-family,monospace);
  font-size:11px;line-height:1.5;
  white-space:pre-wrap;word-break:break-word;
  max-height:220px;overflow-y:auto;
}
.insertion-preview-marker{
  color:var(--vscode-inputValidation-warningForeground,#a9822c);
  font-weight:600;
}
.insertion-preview-actions{display:flex;gap:8px}
/* ADR-0034 (QuestionTours): the tour-mode skin's one visible seam — header
   renders provenance-first metadata, per doctrine 2 ("perspectives, not
   consensus" — no ordering ever reads as authoritative without naming its
   author). Default colors here are the UNTHEMED fallback; a tour's own
   theme.background/foreground (doctrine 6, chrome-only — never the
   substrate content below) are applied inline, per tour, in JS. */
.tour-header{
  display:flex;flex-direction:column;gap:4px;
  margin-bottom:14px;padding:10px 14px;border-radius:4px;
  background:var(--vscode-textBlockQuote-background,rgba(127,127,127,.08));
  border:1px solid var(--vscode-textBlockQuote-border,rgba(127,127,127,.25));
}
.tour-header-title{font-size:14px;font-weight:600}
.tour-header-meta{font-size:11px;opacity:.85}
.tour-header-broken{font-size:11px;color:var(--vscode-inputValidation-warningForeground,#a9822c)}
/* Bug fix (Jérémie via Facet, 2026-07-28 inbox 1337): was hardcoded to the
   editor's global link color, independent of the tour's own theme applied
   to #tour-header above — clashed against a custom theme (his exact
   report: "the miscolored link that mismatches"). No color here at all
   now: it INHERITS #tour-header's own color (theme-overridden inline, or
   the default), matching doctrine 6 — theme colors the chrome, including
   this link, not just the title text. Underline stands in for the lost
   link-color affordance so it still reads as clickable.
*/
.tour-header a{font-size:11px;text-decoration:underline;align-self:flex-start}
.tour-entry-info{
  font-size:11px;margin-top:4px;margin-bottom:12px;padding:8px 10px;
  background:var(--vscode-textBlockQuote-background,rgba(127,127,127,.08));
  /* Distinct from .why's border color (Jérémie via Facet, 2026-07-28 inbox
     1337: "visually unparseable... cognitive overload" against the near-
     identical-looking .why block) — orange ties it to this codebase's
     existing "needs your attention" accent (badge/question icons), rather
     than the neutral gray both blocks used to share. */
  border-left:3px solid var(--vscode-charts-orange,#cc8800);
  border-radius:2px;
}
.tour-entry-info .disposition{
  text-transform:uppercase;font-weight:600;letter-spacing:.03em;
  color:var(--vscode-descriptionForeground);
}
/* ADR-0034 doctrine 9: the read-only review-stop answer — an already-
   resolved tour entry's live answer, shown instead of an input box. */
.review-stop-block{margin-bottom:16px}
.review-stop-label{
  font-size:11px;font-style:italic;color:var(--vscode-descriptionForeground);
  margin-bottom:6px;
}
.review-stop-answer{
  font-size:13px;line-height:1.6;padding:10px 12px;
  background:var(--vscode-textBlockQuote-background,rgba(127,127,127,.08));
  border-radius:4px;
}
.hint{
  font-size:11px;
  color:var(--vscode-descriptionForeground);
  margin-top:5px;margin-bottom:16px;
}
.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.btn-answer{
  padding:7px 20px;
  background:var(--vscode-button-background);
  color:var(--vscode-button-foreground);
  border:none;border-radius:3px;cursor:pointer;
  font-family:var(--vscode-font-family);font-size:13px;font-weight:600;
}
.btn-answer:hover{background:var(--vscode-button-hoverBackground)}
.btn-answer:disabled{opacity:.4;cursor:not-allowed}
/* ADR-0036: a secondary gesture, visually distinct from the closing Answer
   button — a court handoff, not a settlement. */
.btn-respond-unresolved{
  padding:7px 14px;
  background:transparent;
  color:var(--vscode-charts-purple,#c586c0);
  border:1px solid var(--vscode-charts-purple,#c586c0);
  border-radius:3px;cursor:pointer;
  font-family:var(--vscode-font-family);font-size:13px;
  opacity:.85;
}
.btn-respond-unresolved:hover{opacity:1}
.btn-respond-unresolved:disabled{opacity:.35;cursor:not-allowed}
.btn-skip{
  padding:7px 14px;
  background:transparent;
  color:var(--vscode-textLink-foreground);
  border:1px solid var(--vscode-textLink-foreground);
  border-radius:3px;cursor:pointer;
  font-family:var(--vscode-font-family);font-size:13px;
  opacity:.8;
}
.btn-skip:hover{opacity:1}
/* ADR-0035 Iteration 3 (frictionless observation reporting): flushed right
   in the button row, per Jérémie's own sketch of this idea — a rare,
   secondary action, visually separated from Answer/Back/Skip rather than
   competing with them for attention. */
.btn-report{
  margin-left:auto;
  padding:7px 14px;
  background:transparent;
  color:var(--vscode-descriptionForeground);
  border:1px solid var(--vscode-descriptionForeground);
  border-radius:3px;cursor:pointer;
  font-family:var(--vscode-font-family);font-size:13px;
  opacity:.7;
}
.btn-report:hover{opacity:1}
.btn-back{
  padding:7px 14px;
  background:transparent;
  color:var(--vscode-textLink-foreground);
  border:1px solid var(--vscode-textLink-foreground);
  border-radius:3px;cursor:pointer;
  font-family:var(--vscode-font-family);font-size:13px;
  opacity:.8;
}
.btn-back:hover{opacity:1}
.btn-back:disabled{opacity:.3;cursor:not-allowed}
/* ADR-0010: Question list overlay */
#q-overlay{
  display:none;position:fixed;inset:0;
  background:rgba(0,0,0,.5);z-index:100;
  align-items:flex-start;justify-content:center;
  padding:40px 24px;
}
#q-overlay.open{display:flex}
#q-panel{
  background:var(--vscode-editor-background);
  border:1px solid var(--vscode-widget-border,#555);
  border-radius:6px;width:100%;max-width:640px;
  max-height:calc(100vh - 80px);overflow-y:auto;
  box-shadow:0 8px 32px rgba(0,0,0,.4);
}
.q-panel-hd{
  display:flex;align-items:center;justify-content:space-between;
  padding:12px 16px;
  border-bottom:1px solid var(--vscode-widget-border,#555);
  position:sticky;top:0;z-index:1;
  background:var(--vscode-editor-background);
}
.q-panel-title{
  font-size:12px;font-weight:600;
  text-transform:uppercase;letter-spacing:.05em;
  color:var(--vscode-descriptionForeground);
}
.q-close{
  background:transparent;border:none;
  color:var(--vscode-foreground);font-size:16px;
  cursor:pointer;opacity:.7;padding:2px 6px;border-radius:3px;
  font-family:var(--vscode-font-family);
}
.q-close:hover{opacity:1;background:var(--vscode-list-hoverBackground)}
.q-adr-hd{
  padding:8px 16px;
  background:var(--vscode-badge-background);
  color:var(--vscode-badge-foreground);
  font-size:12px;font-weight:600;
  position:sticky;top:41px;z-index:1;
}
.q-item{
  display:block;width:100%;
  padding:8px 16px 8px 28px;
  background:transparent;border:none;
  border-bottom:1px solid var(--vscode-widget-border,rgba(128,128,128,.1));
  text-align:left;cursor:pointer;
  font-family:var(--vscode-font-family);font-size:13px;
  color:var(--vscode-foreground);
}
.q-item:hover{background:var(--vscode-list-hoverBackground)}
.q-item.current{
  background:var(--vscode-list-activeSelectionBackground);
  color:var(--vscode-list-activeSelectionForeground);
}
.qst-body{
  font-size:13px;line-height:1.6;
  margin-bottom:16px;
}
.qst-body code{
  font-family:var(--vscode-editor-font-family,monospace);
  font-size:11px;
  background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.15));
  padding:1px 4px;border-radius:3px;
}
.qst-body pre{
  font-family:var(--vscode-editor-font-family,monospace);
  font-size:11px;
  background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.15));
  padding:8px 12px;border-radius:4px;
  overflow-x:auto;margin:6px 0;white-space:pre;
}
.qst-body ul,.qst-body ol{padding-left:20px;margin:4px 0}
.qst-body li{margin:2px 0}
.qst-body strong{font-weight:600}
.qst-body em{font-style:italic}
.qst-body p{margin:0 0 8px}
.qst-body p:last-child{margin-bottom:0}
.flash{
  display:none;align-items:center;gap:6px;
  color:var(--vscode-testing-iconPassed,#4ec9b0);
  font-size:13px;font-weight:500;
}
.error-msg{
  display:none;
  color:var(--vscode-errorForeground);
  font-size:12px;margin-top:10px;
}
</style>
</head>
<body>

<div id="empty">
  <div class="icon">✓</div>
  <div style="font-size:16px;font-weight:600">All caught up</div>
  <div style="font-size:13px">No open questions across your ADRs.</div>
</div>

<!-- ADR-0034: tour-mode header — provenance first, per doctrine 2. Hidden entirely outside tour mode. -->
<div class="tour-header" id="tour-header" style="display:none">
  <div class="tour-header-title" id="tour-header-title"></div>
  <div class="tour-header-meta" id="tour-header-meta"></div>
  <div class="tour-header-broken" id="tour-header-broken" style="display:none"></div>
  <a id="exit-tour" role="button">← Exit tour, back to all open questions</a>
</div>

<div id="card">
  <div class="counter" id="counter"></div>
  <div class="progress"><div class="progress-fill" id="pbar"></div></div>

  <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <button class="adr-link" id="adr-link" style="margin-bottom:0"></button>
    <a id="open-in-file" href="#" style="font-size:11px;color:var(--vscode-textLink-foreground);text-decoration:none;opacity:.8">Open in file ↗</a>
    <a id="q-list-link" href="#" style="font-size:11px;color:var(--vscode-textLink-foreground);text-decoration:none;opacity:.8">List all open questions ↗</a>
  </div>

  <!-- ADR-0010: Collapsible ADR context box (Human Context + AI Interpretation) -->
  <details class="ctx-details" id="ctx-details" style="display:none">
    <summary>ADR context</summary>
    <div class="ctx-body" id="ctx-body"></div>
  </details>

  <!-- ADR-0034: the authored claim, shown BEFORE the question title (Jérémie
       via Facet, 2026-07-28 inbox 1337: it used to sit between the title and
       #why, nearly identical in styling to #why itself, and read as
       "visually unparseable... inserted in the most inconspicuous way" —
       his own fix, taken verbatim: move it above the title so it frames the
       question as a preface rather than competing with the established
       title -> why-asking -> body -> recommendation reading order). Only
       present while walking a tour. -->
  <div class="tour-entry-info" id="tour-entry-info" style="display:none"></div>
  <div class="qtext" id="qtext"></div>
  <div class="why" id="why" style="display:none"></div>
  <div class="qst-body" id="body" style="display:none"></div>
  <div id="rec-wrap"></div>
  <div class="qst-body" id="body-post" style="display:none"></div>

  <!-- ADR-0034 doctrine 9 (Riddle's ruling, 2026-07-28, docs/inbox tour-doctrine-9):
       a resolved tour entry is a REVIEW STOP, never silence — read-only
       (the live answer, beside the live question and authored claim
       already rendered above), no input box, no Answer button. Back/Skip
       still navigate through it; only the answering machinery below is
       suppressed. Only ever shown in tour mode. -->
  <div class="review-stop-block" id="review-stop-block" style="display:none">
    <div class="review-stop-label" id="review-stop-label"></div>
    <div class="review-stop-answer" id="review-stop-answer"></div>
  </div>

  <!-- Layout surgery (Lapidary's spec, 2026-07-30 inbox 2020, "fine
       surgery — build EXACTLY this"): controls never share a line with
       transients; transient messages get reserved, dedicated space, so
       the hand reaching for a button never finds it moved. Document
       order composes the same way whether the authorship row is shown or
       not — one rule, no cases: authorship row (conditional) → expand-
       field link (always, its own row, flush right) → textarea. -->
  <div class="author-row" id="author-row">
    <label for="author">Answering as:</label>
    <input id="author" type="text" placeholder="Your name" autocomplete="off" />
  </div>

  <div class="expand-row" id="expand-row">
    <a id="expand-field" class="expand-link" role="button" title="Grow the answer field to fill the panel (Cmd+Shift+E)">Expand field ⤢</a>
  </div>

  <textarea id="ans" placeholder="Type your answer… (Cmd+Enter to submit)"></textarea>
  <div class="draft-restored" id="draft-restored" style="display:none"></div>
  <!-- "Draft saved" lives here now — the expand-field link's vacated
       flush-right slot in this row is ITS reserved home; nothing else
       ever occupies it, so autosave firing/clearing never shifts the
       button row below. -->
  <div class="hint" id="answer-hint"><span>Cmd+Enter to submit · Skip to come back later · Cmd+Shift+Enter: request follow-up and return the partial answer to the model for consideration</span><span class="draft-flash" id="draft-flash">✓ draft saved</span></div>

  <div class="row">
    <button class="btn-answer" id="btn-ans">Answer →</button>
    <!-- ADR-0036 (Riddle's design, ratified 2026-07-29): the human has
         contributed content but the ball moves to the model's court
         instead of closing the question. Writes the same ANS layer, sets
         Status: unresolved. Label changed from "Respond (unresolved)" to
         "Request Follow-up →" (Jérémie via Gleaner's sweep, 2026-07-31:
         "respond isn't clear... it doesn't differentiate itself from
         answer... maybe put something like request follow-up") — the
         id/class/mechanism (targetStatus:'unresolved') are unchanged, this
         is a label-only fix. -->
    <button class="btn-respond-unresolved" id="btn-respond-unresolved" title="Request follow-up and return the partial answer to the model for consideration (Cmd+Shift+Enter)">Request Follow-up →</button>
    <button class="btn-back" id="btn-back">← Back</button>
    <button class="btn-skip" id="btn-skip">Skip</button>
    <button class="btn-report" id="btn-report" style="display:none" title="Report an observation about this question/ADR — saved for later review, doesn't affect your answer">🚩 Report</button>
    <span class="flash" id="flash">✓ Answered</span>
  </div>
  <div class="error-msg" id="err"></div>

  <!-- ADR-0023 drift fence: three-choice consent, never write blind -->
  <div class="drift-bar" id="drift-bar" style="display:none">
    <span>This file changed while you were answering.</span>
    <button class="btn-skip" id="btn-drift-refresh">Refresh</button>
    <button class="btn-skip" id="btn-drift-write">Write anyway</button>
    <button class="btn-skip" id="btn-drift-hold">Hold draft</button>
  </div>

  <!-- Persistent save-failure warning (Lapidary 5, 2026-07-16): a genuine
       save failure has to stay visible until the human acts on it — #err
       gets wiped by render() on every background "questions" push (any
       concurrent save anywhere in this multi-writer repo), which is what
       made the old inline warning "blink past" before it could be read. -->
  <div class="drift-bar" id="save-warning-bar" style="display:none">
    <span id="save-warning-text"></span>
    <button class="btn-skip" id="btn-save-now">Save now</button>
    <button class="btn-skip" id="btn-save-dismiss">Dismiss</button>
  </div>

  <!-- Insertion-preview protocol (Jérémie's own design, 2026-07-13;
       launch-gating per DEBRIEF-006, 2026-07-18): the append-ANS fallback's
       insertion point is a computed guess, not an exact marker match — show
       the surrounding lines before writing, never insert blind. -->
  <div class="insertion-preview-bar" id="insertion-preview-bar" style="display:none">
    <span>No ANS block found — this will insert a new one here. Check the context below:</span>
    <pre class="insertion-preview-context" id="insertion-preview-context"></pre>
    <div class="insertion-preview-actions">
      <button class="btn-skip" id="btn-insertion-up" title="Move insertion point up one line">- Move up</button>
      <button class="btn-skip" id="btn-insertion-down" title="Move insertion point down one line">+ Move down</button>
      <button class="btn-answer" id="btn-insertion-confirm">Insert here</button>
      <button class="btn-skip" id="btn-insertion-cancel">Cancel</button>
    </div>
  </div>
</div>

<div id="q-overlay">
  <div id="q-panel">
    <div class="q-panel-hd">
      <span class="q-panel-title" id="q-panel-title">Open Questions</span>
      <button class="q-close" id="q-close" title="Close (Esc)">✕</button>
    </div>
    <div id="q-root-filter"></div>
    <div id="q-panel-body"></div>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
let questions = [], idx = 0;
let recCollapseThreshold = 0;
let reportButtonEnabled = false;
let showAuthorshipField = false;
// Insertion-preview protocol (DEBRIEF-006): the exact 'answer' message the
// panel is waiting to resend with confirmedInsertion:true once the human
// approves the previewed insertion point, or null when no preview is open.
let pendingInsertionConfirm = null;
// ±1 adjustment (Jérémie via Gleaner's sweep, 2026-07-31): the previewed
// before/after context lines, and how many lines the human has nudged the
// marker within that already-fetched window. Re-rendered client-side, no
// extra round-trip — the window is only 3+3 lines so a modest nudge in
// either direction always stays in bounds.
let pendingInsertionContext = null;
let insertionAdjustment = 0;
function renderInsertionPreview() {
  if (!pendingInsertionContext) return;
  const allLines = pendingInsertionContext.before.concat(pendingInsertionContext.after);
  const markerIdx = Math.min(Math.max(pendingInsertionContext.before.length + insertionAdjustment, 0), allLines.length);
  const marker = '------ inserting here ------';
  const lines = allLines.slice(0, markerIdx).concat([marker], allLines.slice(markerIdx));
  $id('insertion-preview-context').textContent = lines.join('\\n');
}
// Bug report (2026-07-12, Jérémie, temp/0048 dogfooding session): in a repo
// with concurrent writers, ANY unrelated docs/adr/*.md save elsewhere
// triggers index.onChange -> sendQuestions() -> a 'questions' push here,
// which used to call render() unconditionally every time — resetting the
// textarea to the last-saved draftText and stealing focus even while the
// human was mid-keystroke on the SAME question. That's both "the draft
// mechanism clobbers me" (a background push can carry an older draftText
// than what's currently typed but not yet past the 500ms debounce) and
// "cursor jumps to the end incessantly" (setting .value always collapses
// the selection). Track which question's draftKey is currently shown so
// render() can tell "new question, restore is correct" apart from "same
// question, a page repaint, leave the live textarea alone."
let lastSentDraftText = undefined;
let renderTitleMarkdown = true;
function inlineMd(t) {
  const esc = t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return esc
    .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
    .replace(/\\*\\*([^*]+)\\*\\*/g, '<b>$1</b>')
    .replace(/(^|\\s)_([^_]+)_(?=\\s|$|[.,;:!?])/g, '$1<i>$2</i>');
}
let loadedFileChecksum = null;
let loadedExistingAnswer = '';
let lastShownDraftKey;
// Discards stale/out-of-order 'questions' pushes (Problem 2, panel-submit-
// no-refresh-bug seed): with multiple sessions writing docs/adr/*.md
// concurrently, an unrelated reindex triggered elsewhere can race with this
// panel's own post-write reindex and arrive later despite being computed
// earlier. Never let older data overwrite newer data.
let lastQuestionsGeneration = -1;
// ADR-0034: the active tour's metadata (title/author/theme/brokenRefs), or
// null outside tour mode — set fresh from every 'questions' push, never
// cached longer than that (doctrine 1: facts and claims both re-read live).
let activeTour = null;
const saved = vscode.getState() || {};

const $id = id => document.getElementById(id);

// ---------------------------------------------------------------------------
// ADR-0023 square 4 (staleness banner, Riddle 5's design, 2026-07-24 1834):
// banner-grade word diff — a rough multiset diff, not position-aware. Good
// enough for "+114 -12 words", never claimed to be more.
// ---------------------------------------------------------------------------
function wordDiffCounts(oldText, newText) {
  const countWords = text => {
    const counts = {};
    for (const w of (text || '').split(/\\s+/).filter(Boolean)) counts[w] = (counts[w] || 0) + 1;
    return counts;
  };
  const oldCounts = countWords(oldText);
  const newCounts = countWords(newText);
  let added = 0, removed = 0;
  const allWords = new Set([...Object.keys(oldCounts), ...Object.keys(newCounts)]);
  for (const w of allWords) {
    const delta = (newCounts[w] || 0) - (oldCounts[w] || 0);
    if (delta > 0) added += delta;
    else if (delta < 0) removed += -delta;
  }
  return { added, removed };
}

// Provenance display (Riddle's design): a human label for DraftRecord.source
// when it's informative; 'panel' (the common two-windows-of-this-same-app
// case) is left unlabeled rather than printing a redundant "(from Open
// Questions panel)" on every ordinary race.
function draftSourceLabel(source) {
  if (!source || source === 'panel') return null;
  if (source === 'mobile') return 'Mobile ADR entry';
  if (source === 'file-prefill') return 'file prefill';
  if (source === 'mcp') return 'MCP';
  return source;
}

// ---------------------------------------------------------------------------
// Minimal inline markdown renderer (ADR-0010)
// Handles: headings, bold, italic, inline code, fenced code, tables,
//          blockquotes, HR, ordered and unordered lists.
// No external dependencies — all inline to satisfy VS Code CSP.
// ---------------------------------------------------------------------------
function renderMarkdown(md) {
  if (!md) return '';
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Strip HTML comments (e.g. <!-- @adr-anchor: some-slug -->) BEFORE
  // anything else touches the string. Returning bug (dispatched 2026-07-10,
  // apparently never actually landed a fix — this is its third report):
  // the extractor reads @adr-anchor for slug-override purposes but leaves
  // the literal comment text in rawBody/rawBodyPost, and esc() below turns
  // '<' into '&lt;' before any comment syntax could be recognized as a
  // real HTML comment — so it rendered as visible escaped text instead of
  // vanishing. Stripping first, unconditionally, is the fix that can't be
  // bypassed by whichever field (body/bodyPost/adrContext) the comment
  // happens to land in, since all of them funnel through this function.
  // Uses '.' + the 's' (dotAll) flag rather than a [\s\S] character class —
  // a backslash-escape sequence here would need doubling to survive being
  // embedded in this file's own outer template literal, and the webview
  // test harness (src/test/helpers/webviewHarness.ts) executes this raw
  // .ts source text directly via node:vm without ever evaluating that
  // outer template literal — so a doubled backslash reaches the harness
  // literally (matching backslash/s/S characters, not "any character") even
  // though the real extension host's template-literal evaluation would
  // have collapsed it correctly. '.'  has no such escaping trap.
  //
  // REGRESSION FIX (Gleaner URGENT 1755, founder screenshots, 2026-07-31):
  // this strip used to run BEFORE any code protection, so a line QUOTING
  // comment syntax as a literal example — \`<!-- collab-adr-lean: v1 -->\`
  // — had its contents eaten from inside the backticks, leaving orphaned
  // backticks that re-paired across paragraphs (ADR-0032's own QST-CORE,
  // which quotes three comment examples while discussing the comment
  // channel, rendered sentences of prose as one giant code span). Correct
  // markdown semantics: code content is never comment-stripped. So: protect
  // whole inline spans first (stored verbatim, backticks included, restored
  // immediately after the strip so downstream per-line inline handling is
  // unchanged), then strip comments from what remains.
  // Process fenced code blocks first (protect from inline transforms AND
  // from the comment strip below — a fenced example containing <!-- ... -->
  // keeps it, correct markdown semantics).
  const codeBlocks = [];
  md = md.replace(/\`\`\`[\\s\\S]*?\`\`\`/g, m => {
    const lang = m.match(/\`\`\`(\\w*)/)?.[1] || '';
    const code = m.replace(/\`\`\`\\w*\\n?/, '').replace(/\`\`\`$/, '');
    codeBlocks.push('<pre><code>' + esc(code.trimEnd()) + '</code></pre>');
    return '\\x00CODE' + (codeBlocks.length - 1) + '\\x00';
  });

  const tickSpans = [];
  md = md.replace(/\`[^\`]*\`/g, m => { tickSpans.push(m); return '\\x01T' + (tickSpans.length - 1) + '\\x01'; });
  md = md.replace(/<!--.*?-->/gs, '');
  md = md.replace(/\\x01T(\\d+)\\x01/g, (_, i) => tickSpans[+i]);

  // Lazy-continuation join for hard-wrapped list items — mirrors
  // scripts/unwrap-adrs/unwrap-adrs.mjs's joinSoftWrappedLines exactly
  // (same rule, not reinvented, per Lapidary's 0450 framing): join with a
  // space, except a hyphenated line-break (line ends '-', next starts with
  // a letter/digit/backtick) joins with no space, so "cross-" + "platform"
  // becomes "cross-platform" rather than "cross- platform".
  function joinSoftWrappedLines(parts) {
    return parts.reduce((joined, part) => {
      if (joined === '') return part;
      if (/-$/.test(joined) && /^[A-Za-z0-9\`]/.test(part)) return joined + part;
      return joined + ' ' + part;
    }, '');
  }

  // Guards the lazy-continuation join above: a line immediately following a
  // list item with no blank line between them is normally just wrapped
  // overflow text, but if it's ITSELF the start of some other block
  // construct (heading, HR, blockquote, table, a new ordered-list item),
  // it must not be swallowed into the previous <li>.
  function looksLikeNewBlock(line) {
    return /^\\x00CODE\\d+\\x00$/.test(line.trim())
      || /^\\|/.test(line)
      || /^---+$/.test(line.trim())
      || /^#{1,4}\\s+/.test(line)
      || line.startsWith('> ')
      || /^\\d+\\.\\s+/.test(line);
  }

  // Tables
  function renderTable(block) {
    const rows = block.trim().split('\\n');
    if (rows.length < 2) return block;
    const header = rows[0].split('|').filter((_,i,a)=>i>0&&i<a.length-1).map(c=>'<th>'+renderInline(c.trim())+'</th>').join('');
    const body = rows.slice(2).map(r=>{
      const cells = r.split('|').filter((_,i,a)=>i>0&&i<a.length-1).map(c=>'<td>'+renderInline(c.trim())+'</td>').join('');
      return '<tr>'+cells+'</tr>';
    }).join('');
    return '<table><thead><tr>'+header+'</tr></thead><tbody>'+body+'</tbody></table>';
  }

  function renderInline(s) {
    s = esc(s);
    // Protect backtick spans FIRST — their content must not be processed by bold/italic
    const codes = [];
    s = s.replace(/\`([^\`]+)\`/g, (_, c) => { codes.push(c); return '\\x02' + (codes.length-1) + '\\x02'; });
    s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    s = s.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/_([^_]+)_/g, '<em>$1</em>');
    // Restore backtick spans as <code> elements
    s = s.replace(/\\x02(\\d+)\\x02/g, (_, i) => '<code>' + codes[+i] + '</code>');
    return s;
  }

  const lines = md.split('\\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Restored code block placeholder
    if (/^\\x00CODE\\d+\\x00$/.test(line.trim())) {
      const idx = parseInt(line.trim().replace(/\\x00CODE(\\d+)\\x00/,'$1'));
      out.push(codeBlocks[idx]);
      i++; continue;
    }

    // Tables: detect by | delimiter in first cell
    if (/^\\|/.test(line) && i + 1 < lines.length && /^\\|[-: |]+\\|/.test(lines[i+1])) {
      let tableEnd = i;
      while (tableEnd < lines.length && /^\\|/.test(lines[tableEnd])) tableEnd++;
      out.push(renderTable(lines.slice(i, tableEnd).join('\\n')));
      i = tableEnd; continue;
    }

    // HR
    if (/^---+$/.test(line.trim())) { out.push('<hr>'); i++; continue; }

    // Headings
    const hm = line.match(/^(#{1,4})\\s+(.*)/);
    if (hm) { out.push('<h'+(hm[1].length+1)+'>'+renderInline(hm[2])+'</h'+(hm[1].length+1)+'>'); i++; continue; }

    // Blockquote
    if (line.startsWith('> ')) { out.push('<blockquote>'+renderInline(line.slice(2))+'</blockquote>'); i++; continue; }

    // Unordered list — CommonMark lazy continuation: a non-blank line right
    // after a list item, that isn't itself a new bullet or some other block
    // construct, belongs to that item's content, not a bare new paragraph.
    // Without this, a hard-wrapped bullet's overflow lines "escape" the
    // <li> and render as sibling <p> text below the list (2026-07-13
    // screenshot: inbox-alchemy's wrapped ADR-0021, Option B's continuation
    // bleeding out of its bullet). Join logic mirrors
    // scripts/unwrap-adrs/unwrap-adrs.mjs's joinSoftWrappedLines exactly —
    // lifted, not reinvented, per Lapidary's 0450 framing.
    if (/^[\\-\\*]\\s+/.test(line)) {
      const items = [];
      let current = [];
      const flush = () => { if (current.length) items.push('<li>'+renderInline(joinSoftWrappedLines(current))+'</li>'); current = []; };
      while (i < lines.length) {
        if (/^[\\-\\*]\\s+/.test(lines[i])) {
          flush();
          current.push(lines[i].replace(/^[\\-\\*]\\s+/,'').trim());
          i++;
        } else if (current.length > 0 && lines[i].trim() !== '' && !looksLikeNewBlock(lines[i])) {
          current.push(lines[i].trim());
          i++;
        } else {
          break;
        }
      }
      flush();
      out.push('<ul>'+items.join('')+'</ul>');
      continue;
    }

    // Ordered list — same lazy-continuation treatment as the unordered case.
    if (/^\\d+\\.\\s+/.test(line)) {
      const items = [];
      let current = [];
      const flush = () => { if (current.length) items.push('<li>'+renderInline(joinSoftWrappedLines(current))+'</li>'); current = []; };
      while (i < lines.length) {
        if (/^\\d+\\.\\s+/.test(lines[i])) {
          flush();
          current.push(lines[i].replace(/^\\d+\\.\\s+/,'').trim());
          i++;
        } else if (current.length > 0 && lines[i].trim() !== '' && !looksLikeNewBlock(lines[i])) {
          current.push(lines[i].trim());
          i++;
        } else {
          break;
        }
      }
      flush();
      out.push('<ol>'+items.join('')+'</ol>');
      continue;
    }

    // Blank line
    if (line.trim() === '') { i++; continue; }

    // Paragraph
    out.push('<p>'+renderInline(line)+'</p>');
    i++;
  }

  return out.join('\\n');
}

// ---------------------------------------------------------------------------
// Stacked recommendation rendering (ADR-0010 ANS + ADR-0019 attribution model)
// Default: every recommendation stays expanded ("thinking traces" — Jérémie).
// When adrManager.panel.recommendationCollapseThreshold (N) > 0 and there
// are more than N blocks, older-than-N collapse behind a disclosure; the
// most recent N always stay expanded. Each block carries an attribution
// chip; chip color is deterministic from the author slug; authorInferred
// (legacy **My recommendation**: blocks) gets a dotted-underline affordance.
// ---------------------------------------------------------------------------
function escText(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function authorColor(author) {
  if (!author) return 'var(--vscode-descriptionForeground)';
  let hash = 0;
  for (let i = 0; i < author.length; i++) hash = (hash * 31 + author.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return 'hsl(' + hue + ', 55%, 40%)';
}

function renderRecommendationBlock(rec, isMostRecent) {
  const author = rec.author || 'Recommendation';
  const color = authorColor(rec.author);
  const dateStr = rec.date ? ' · ' + escText(rec.date) : '';
  const inferredClass = rec.authorInferred ? ' rec-chip-inferred' : '';
  const inferredTitle = rec.authorInferred ? ' title="Author inferred from the ADR Deciders field"' : '';
  const emphClass = isMostRecent ? ' rec-recent' : '';
  return '<div class="recommendation' + emphClass + '">' +
    '<span class="rec-chip' + inferredClass + '" style="--chip-color:' + color + '"' + inferredTitle + '>' +
    escText(author) + dateStr + '</span>' +
    renderMarkdown(rec.text) +
    '</div>';
}

function renderRecommendations(list) {
  const wrap = $id('rec-wrap');
  if (!list || list.length === 0) { wrap.innerHTML = ''; return; }

  const threshold = recCollapseThreshold > 0 ? recCollapseThreshold : list.length;
  const splitAt = Math.max(0, list.length - threshold);
  const older = list.slice(0, splitAt);
  const recent = list.slice(splitAt);
  const lastIdx = list.length - 1;

  let html = '';
  if (older.length > 0) {
    const label = older.length + ' earlier recommendation' + (older.length > 1 ? 's' : '');
    html += '<details class="ctx-details rec-older"><summary>' + label + '</summary><div class="ctx-body">' +
      older.map((r, i) => renderRecommendationBlock(r, i === lastIdx)).join('') +
      '</div></details>';
  }
  html += recent.map((r, i) => renderRecommendationBlock(r, (splitAt + i) === lastIdx)).join('');
  wrap.innerHTML = html;
}

// Restore author from persisted state
$id('author').value = saved.author || '';
$id('author').addEventListener('input', () => {
  saved.author = $id('author').value;
  vscode.setState(saved);
});

// Cmd/Ctrl+Enter submits; Cmd/Ctrl+Shift+Enter submits as "Respond
// (unresolved)" (ADR-0036, ratified gesture) — checked FIRST since it's a
// strict superset of the plain Cmd+Enter chord (Shift held too).
$id('ans').addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && e.shiftKey) { e.preventDefault(); submit(false, 'unresolved'); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); toggleExpandField(); }
});

// Expand-field affordance (system3 ADR-0017 case study): grow the SAME
// textarea — value, cursor, draft autosave all untouched — so a long
// existing thread (6,900 chars in that specimen) is readable in place
// instead of glimpsed through a 110px porthole. Toggle survives question
// navigation deliberately: if you expanded to read one long thread, the
// next long thread is probably why you're here.
function toggleExpandField() {
  const ta = $id('ans');
  const expanded = ta.classList.toggle('expanded');
  $id('expand-field').textContent = expanded ? 'Collapse field ⤡' : 'Expand field ⤢';
  ta.focus();
}
$id('expand-field').addEventListener('click', e => { e.preventDefault(); toggleExpandField(); });

// Draft-vs-file swap + vault-staleness resolution (delegated: the links are
// re-created per render). q is re-read fresh at click time, never closed
// over — questions[] is replaced wholesale on every 'questions' push, so a
// stale reference could otherwise act on data superseded since the banner
// was drawn.
$id('draft-restored').addEventListener('click', e => {
  const q = questions[idx];
  const targetId = e.target && e.target.id;

  if (targetId === 'keep-editing') {
    e.preventDefault();
    if (q) { loadedFileChecksum = q.fileChecksum; loadedExistingAnswer = q.existingAnswer || ''; }
    $id('draft-restored').style.display = 'none';
    return;
  }
  if (targetId === 'load-file-answer') {
    e.preventDefault();
    if (!q || !q.existingAnswer) return;
    $id('ans').value = q.existingAnswer;
    $id('ans').dispatchEvent(new Event('input')); // autosave takes the swap as the new draft
    loadedFileChecksum = q.fileChecksum;
    loadedExistingAnswer = q.existingAnswer || '';
    $id('draft-restored').textContent = 'File answer loaded — edit if needed, then Answer to confirm & close';
    $id('ans').focus();
    return;
  }
  // Vault staleness (ADR-0023 square 4): 'Keep yours' acknowledges the
  // external draft as the new CAS baseline WITHOUT touching the textarea —
  // this window's next save then correctly declares "I expected the vault
  // to hold what I just saw", so a real third-party write after this point
  // still detects and archives cleanly (the solemn promise keeps working).
  if (targetId === 'keep-mine') {
    e.preventDefault();
    if (q) lastSentDraftText = q.draftText;
    $id('draft-restored').style.display = 'none';
    return;
  }
  if (targetId === 'update-draft') {
    e.preventDefault();
    if (!q) return;
    // The vault already holds this text — no re-save needed, unlike the
    // file-answer swap above (which moves content INTO the draft).
    $id('ans').value = q.draftText || '';
    lastSentDraftText = q.draftText;
    $id('draft-restored').style.display = 'none';
    $id('ans').focus();
    return;
  }
  if (targetId === 'see-draft-diff') {
    e.preventDefault();
    if (!q) return;
    vscode.postMessage({ type: 'showDraftDiff', mine: $id('ans').value, theirs: q.draftText || '', questionText: q.text });
  }
});

$id('btn-ans').addEventListener('click', submit);
$id('btn-respond-unresolved').addEventListener('click', () => submit(false, 'unresolved'));
$id('open-in-file').addEventListener('click', e => {
  e.preventDefault();
  if (!questions[idx]) return;
  vscode.postMessage({ type: 'jumpTo', adrPath: questions[idx].adrPath, lineNumber: questions[idx].lineStart });
});

$id('btn-skip').addEventListener('click', () => {
  idx = (idx + 1) % Math.max(questions.length, 1);
  render();
  vscode.postMessage({ type: 'skip' });
});

// ADR-0035 Iteration 3 (frictionless observation reporting): doesn't touch
// idx, the draft, or anything else in flight — the note capture itself
// happens host-side (a VS Code input box), so this is a fire-and-forget post.
$id('btn-report').addEventListener('click', () => {
  const q = questions[idx];
  if (!q) return;
  // Iteration 5 (Gleaner 5, 2026-07-31): the current rendered card, as text
  // — reconstructs the same render-vs-source comparison a screenshot gives,
  // without one. Explicit field list, not a single parent's aggregate
  // innerHTML: #card wraps chrome (counter, links, the answer textarea)
  // alongside the actually-rendered markdown fields — this names exactly
  // the fields renderMarkdown() writes to, so a future field earns
  // inclusion by design, not just by sitting inside a div.
  // Best-effort; a DOM read failing must never block the report.
  let renderedHtml;
  try {
    renderedHtml = ['qtext', 'ctx-body', 'why', 'body', 'rec-wrap', 'body-post']
      .map(id => $id(id).innerHTML).join(' ');
  } catch { /* failure-soft */ }
  vscode.postMessage({ type: 'reportObservation', adrPath: q.adrPath, questionId: q.id, draftKey: q.draftKey, renderedHtml });
});

$id('btn-back').addEventListener('click', () => {
  if (idx > 0) { idx--; render(); }
});

function showOverlay() {
  renderOverlay();
  $id('q-overlay').classList.add('open');
  const cur = $id('q-panel-body').querySelector('.current');
  if (cur) cur.scrollIntoView({ block: 'center' });
}
function hideOverlay() { $id('q-overlay').classList.remove('open'); }

// ADR-0034: tour-mode header — called once per 'questions' push (not
// per-render like the per-question card), since provenance/theme don't
// change while skipping/back-ing within the same walk.
function renderTourHeader() {
  const header = $id('tour-header');
  if (!activeTour) {
    header.style.display = 'none';
    header.style.background = '';
    header.style.color = '';
    return;
  }
  header.style.display = 'flex';
  // Doctrine 6: theme colors the tour's chrome ONLY — this header, never
  // the substrate content in #card below it, which always stays in
  // editor-theme colors.
  header.style.background = (activeTour.theme && activeTour.theme.background) || '';
  header.style.color = (activeTour.theme && activeTour.theme.foreground) || '';

  const authorLabel = activeTour.author.role ? activeTour.author.name + ' (' + activeTour.author.role + ')' : activeTour.author.name;
  const mintedLabel = activeTour.mintedAt ? ' · minted ' + new Date(activeTour.mintedAt).toLocaleString() : '';
  const statusLabel = activeTour.retired ? ' [retired]' : (activeTour.done ? ' [done]' : '');
  $id('tour-header-title').textContent = activeTour.title + statusLabel;
  $id('tour-header-meta').textContent = 'By ' + authorLabel + mintedLabel;

  // Doctrine 3: broken references are visible, never silently dropped.
  if (activeTour.brokenRefs && activeTour.brokenRefs.length > 0) {
    const n = activeTour.brokenRefs.length;
    $id('tour-header-broken').textContent = '⚠ ' + n + ' entr' + (n === 1 ? 'y' : 'ies') + ' could not be resolved: ' + activeTour.brokenRefs.join(', ');
    $id('tour-header-broken').style.display = 'block';
  } else {
    $id('tour-header-broken').style.display = 'none';
  }
}
$id('exit-tour').addEventListener('click', e => {
  e.preventDefault();
  vscode.postMessage({ type: 'exitTour' });
});
// ADR-0025 panel-aggregation: null = "All roots". Scoped to the TOC overlay
// only — the main single-question Cmd+Enter flow always advances through
// every root's questions; the filter narrows what's browsable in the list,
// it doesn't remove anything from the underlying to-do list.
let rootFilter = null;

function renderRootFilterChips() {
  const namespaces = [...new Set(questions.map(q => q.rootNamespace))];
  const bar = $id('q-root-filter');
  // N=1 case: exactly one namespace, so the chip bar stays hidden — no
  // clutter for the common single-project view.
  if (namespaces.length < 2) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  if (rootFilter && !namespaces.includes(rootFilter)) rootFilter = null;
  bar.style.display = 'flex';
  let html = '<button class="root-chip' + (rootFilter === null ? ' active' : '') + '" data-root="">All roots</button>';
  for (const ns of namespaces.sort()) {
    html += '<button class="root-chip' + (ns === rootFilter ? ' active' : '') + '" data-root="' + ns + '">' + ns + '</button>';
  }
  bar.innerHTML = html;
}

function renderOverlay() {
  renderRootFilterChips();
  const visible = rootFilter === null ? questions : questions.filter(q => q.rootNamespace === rootFilter);
  $id('q-panel-title').textContent = 'Open Questions (' + visible.length + (rootFilter ? ' of ' + questions.length : '') + ')';
  // ADR-0018 Step 3: group by server-computed groupSortKey/groupLabel, not
  // adrNumber directly — seeds have no number, so grouping by adrNumber
  // alone would merge every seed's questions into one bogus "ADR-0000"
  // group. A plain string sort on groupSortKey keeps roots clustered
  // together (ADR-0025), ADRs before seeds within a root, without any
  // container-kind-aware JS here.
  const byGroup = {};
  visible.forEach(q => {
    const i = questions.indexOf(q);
    if (!byGroup[q.groupSortKey]) byGroup[q.groupSortKey] = { label: q.groupLabel, items: [] };
    byGroup[q.groupSortKey].items.push({ q, i });
  });
  let html = '';
  for (const k of Object.keys(byGroup).sort()) {
    const g = byGroup[k];
    html += '<div class="q-adr-hd">' + g.label + '</div>';
    for (const {q,i} of g.items) {
      html += '<button class="q-item' + (i===idx?' current':'') + '" data-qi="' + i + '">' + q.text + '</button>';
    }
  }
  $id('q-panel-body').innerHTML = html;
}

$id('q-list-link').addEventListener('click', e => { e.preventDefault(); showOverlay(); });
$id('q-close').addEventListener('click', hideOverlay);
$id('q-root-filter').addEventListener('click', e => {
  const btn = e.target.closest('[data-root]');
  if (!btn) return;
  rootFilter = btn.dataset.root || null;
  renderOverlay();
});
$id('q-overlay').addEventListener('click', e => { if (e.target === $id('q-overlay')) hideOverlay(); });
$id('q-panel-body').addEventListener('click', e => {
  const btn = e.target.closest('[data-qi]');
  if (!btn) return;
  idx = parseInt(btn.dataset.qi, 10);
  hideOverlay();
  render();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideOverlay(); });

$id('adr-link').addEventListener('click', () => {
  if (!questions[idx]) return;
  vscode.postMessage({ type: 'jumpTo', adrPath: questions[idx].adrPath, lineNumber: questions[idx].lineStart });
});

function submit(force, targetStatus) {
  const text = $id('ans').value.trim();
  const author = $id('author').value.trim() || 'Human';
  if (!text || !questions[idx]) return;
  $id('btn-ans').disabled = true;
  $id('btn-respond-unresolved').disabled = true;
  $id('err').style.display = 'none';
  $id('drift-bar').style.display = 'none';
  $id('insertion-preview-bar').style.display = 'none';
  pendingInsertionConfirm = null;
  pendingInsertionContext = null;
  insertionAdjustment = 0;
  const q = questions[idx];
  vscode.postMessage({
    type: 'answer', questionId: q.id, adrPath: q.adrPath, lineStart: q.lineStart,
    answerText: text, authorName: author, draftKey: q.draftKey, fileChecksum: q.fileChecksum,
    force: !!force, sourceKind: q.sourceKind,
    // ADR-0036: "Respond (unresolved)" — the human has contributed content
    // but the ball moves to the model's court instead of closing the
    // question. Omitted (undefined) is the ordinary Answer gesture.
    targetStatus: targetStatus === 'unresolved' ? 'unresolved' : undefined,
  });
}

// ---------------------------------------------------------------------------
// ADR-0023: draft auto-save — debounced ~500ms per keystroke
// ---------------------------------------------------------------------------
let draftSaveTimer = null;
$id('ans').addEventListener('input', () => {
  if (!questions[idx]) return;
  const q = questions[idx];
  // DEBRIEF-004: capture the typed text NOW, at input time — not by
  // re-reading $id('ans').value when the timer fires 500ms later. In that
  // window a background 'questions' push or a skip/back navigation can
  // repaint the textarea with a DIFFERENT question's content; reading the
  // DOM at fire time would then save that other question's text under
  // this question's draftKey. Freezing the value at input time ties the
  // save to what was actually typed for this question.
  const val = $id('ans').value;
  // DEBRIEF-004 (Quarry 5, adversarial harness "smoke 2"): keep the LOCAL
  // cache in sync too, not just the server's drafts.json copy. render()
  // reads q.draftText straight out of the questions array, and nothing
  // refreshes that array on skip/back — only a fresh 'questions' push does.
  // Without this, typing -> skip -> back restores whatever draftText was
  // present at the LAST server push (often empty, on a freshly opened
  // question), discarding what was just typed and already auto-saved
  // server-side. Mutating q.draftText in place updates the same object
  // reference sitting in questions[idx], so it survives skip/back even
  // before any new push arrives.
  q.draftText = val;
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    vscode.postMessage({
      type: 'draft', draftKey: q.draftKey, adrPath: q.adrPath, adrNumber: q.adrNumber,
      questionText: q.text, draftText: val, totalOccurrences: q.totalOccurrences,
      prevDraftText: lastSentDraftText,
    });
    lastSentDraftText = val;
    $id('draft-flash').style.display = 'inline-flex';
    setTimeout(() => { $id('draft-flash').style.display = 'none'; }, 900);
  }, 500);
});

$id('btn-drift-refresh').addEventListener('click', () => {
  $id('drift-bar').style.display = 'none';
  $id('btn-ans').disabled = false;
  $id('btn-respond-unresolved').disabled = false;
  vscode.postMessage({ type: 'refreshRequest' });
});
$id('btn-drift-write').addEventListener('click', () => {
  $id('drift-bar').style.display = 'none';
  submit(true);
});
$id('btn-drift-hold').addEventListener('click', () => {
  // Draft is already auto-saved — nothing further to do. Just dismiss.
  $id('drift-bar').style.display = 'none';
  $id('btn-ans').disabled = false;
  $id('btn-respond-unresolved').disabled = false;
});

$id('btn-insertion-up').addEventListener('click', () => {
  if (!pendingInsertionContext) return;
  insertionAdjustment -= 1;
  renderInsertionPreview();
});
$id('btn-insertion-down').addEventListener('click', () => {
  if (!pendingInsertionContext) return;
  insertionAdjustment += 1;
  renderInsertionPreview();
});
$id('btn-insertion-confirm').addEventListener('click', () => {
  if (!pendingInsertionConfirm) return;
  $id('insertion-preview-bar').style.display = 'none';
  $id('btn-ans').disabled = true;
  vscode.postMessage(Object.assign({}, pendingInsertionConfirm, { confirmedInsertion: true, insertLineOffset: insertionAdjustment }));
  pendingInsertionConfirm = null;
  pendingInsertionContext = null;
  insertionAdjustment = 0;
});
$id('btn-insertion-cancel').addEventListener('click', () => {
  // Nothing was written — the draft is untouched, just dismiss and let the
  // human keep editing or pick a different path.
  $id('insertion-preview-bar').style.display = 'none';
  $id('btn-ans').disabled = false;
  $id('btn-respond-unresolved').disabled = false;
  pendingInsertionConfirm = null;
  pendingInsertionContext = null;
  insertionAdjustment = 0;
});

// Persistent save-failure warning (Lapidary 5, 2026-07-16). Tracked
// separately from #err/#drift-bar, which render() clears on every
// routine background refresh — this one must survive those, since it's
// reporting a fact about disk state that doesn't stop being true just
// because an unrelated file was saved elsewhere. Cleared only by an
// explicit Save now (on success) or Dismiss.
let saveWarningPath = null;
function showSaveWarning(message, adrPath) {
  saveWarningPath = adrPath;
  $id('save-warning-text').textContent = message;
  $id('save-warning-bar').style.display = 'flex';
}
function hideSaveWarning() {
  saveWarningPath = null;
  $id('save-warning-bar').style.display = 'none';
}
$id('btn-save-now').addEventListener('click', () => {
  if (!saveWarningPath) return;
  vscode.postMessage({ type: 'retrySave', adrPath: saveWarningPath });
});
$id('btn-save-dismiss').addEventListener('click', hideSaveWarning);

function render() {
  if (questions.length === 0) {
    // DEBRIEF-004 row 4 (Quarry 5): do NOT reset lastShownDraftKey here.
    // An empty array is a CONTENT-SHAPED signal ("nothing to show right
    // now"), not a real navigation event -- a transient empty push (a
    // single-file read racing a concurrent writer mid-save, or any reindex
    // that momentarily sees zero open questions before settling, routine
    // in this multi-writer repo) would otherwise wipe the identity gate,
    // so the SAME question reappearing on the next push gets misjudged as
    // new by isNewQuestion -- reintroducing DEBRIEF-003's exact symptom
    // (textarea reset, focus stolen) even though nothing the human did
    // changed. Showing the empty-state screen doesn't require forgetting
    // what was last displayed; the gate should only move on real
    // navigation/terminal transitions (click-to-panel's focus event is
    // exactly that shape), never as a side effect of "the array is empty
    // right now."
    $id('empty').style.display = 'flex';
    $id('card').style.display = 'none';
    return;
  }
  $id('empty').style.display = 'none';
  $id('card').style.display = 'block';

  const q = questions[idx];
  const pct = (idx / questions.length) * 100;
  // ADR-0034 doctrine 9 (Riddle's ruling, 2026-07-28): walk order is author
  // order over ALL stops (review stops included) — the counter shows both
  // truths rather than picking one: position in the whole walk, and how
  // many of those stops still need a real answer.
  if (activeTour) {
    const awaiting = questions.filter(qq => !qq.isReviewStop).length;
    $id('counter').textContent = 'Stop ' + (idx + 1) + ' of ' + questions.length + ' · ' + awaiting + ' awaiting you';
  } else {
    $id('counter').textContent = 'Question ' + (idx + 1) + ' of ' + questions.length;
  }
  $id('pbar').style.width = pct + '%';
  $id('adr-link').textContent = q.groupLabel;

  if (renderTitleMarkdown) {
    // Inline-only markdown for titles (Jérémie, 2026-07-24: "take into
    // account backticks in question titles") — escape first, then code/
    // bold/italic spans only; never block constructs in a title.
    $id('qtext').innerHTML = inlineMd(q.text);
  } else {
    $id('qtext').textContent = q.text;
  }

  // ADR-0034: the authored claim beside the live facts (doctrine 1) —
  // present only while walking a tour, never in the ordinary full walk.
  if (q.tourEntry) {
    const parts = [];
    if (q.tourEntry.disposition) parts.push('<span class="disposition">' + q.tourEntry.disposition + '</span>');
    if (!q.tourEntry.mustRespond) parts.push('optional for this walk');
    if (q.tourEntry.answerPath) parts.push('Answer shape: ' + q.tourEntry.answerPath);
    if (q.tourEntry.comment) parts.push(q.tourEntry.comment);
    $id('tour-entry-info').innerHTML = parts.join(' · ');
    $id('tour-entry-info').style.display = parts.length > 0 ? 'block' : 'none';
  } else {
    $id('tour-entry-info').style.display = 'none';
  }

  // ADR-0010: Collapsible context box
  if (q.adrContext) {
    $id('ctx-details').style.display = 'block';
    $id('ctx-body').innerHTML = renderMarkdown(q.adrContext);
  } else {
    $id('ctx-details').style.display = 'none';
  }

  const ctx = [q.whyAsking, q.whyDeferring ? '**Why deferring:** ' + q.whyDeferring : null, q.need ? '**Need:** ' + q.need : null].filter(Boolean).join('\\n\\n');
  if (ctx) { $id('why').style.display = 'block'; $id('why').innerHTML = renderMarkdown(ctx); }
  else { $id('why').style.display = 'none'; }

  if (q.body) { $id('body').style.display = 'block'; $id('body').innerHTML = renderMarkdown(q.body); }
  else { $id('body').style.display = 'none'; }

  renderRecommendations(q.recommendations && q.recommendations.length ? q.recommendations : (q.recommendation ? [{ text: q.recommendation }] : []));

  if (q.bodyPost) { $id('body-post').style.display = 'block'; $id('body-post').innerHTML = renderMarkdown(q.bodyPost); }
  else { $id('body-post').style.display = 'none'; }

  // ADR-0034 doctrine 9 (Riddle's ruling, 2026-07-28): a resolved tour entry
  // is a review stop, never silence — its live answer renders read-only in
  // place of the answering machinery below, which this block hides.
  if (q.isReviewStop) {
    $id('review-stop-block').style.display = 'block';
    $id('review-stop-label').textContent = 'Already answered' + (q.tourEntry && q.tourEntry.disposition ? ' · ' + q.tourEntry.disposition : '');
    // Facet's catch (2026-07-28 inbox 2230): plain .textContent collapsed
    // all whitespace, so a multi-paragraph/multi-line real answer rendered
    // as one dense blob. renderMarkdown matches every other prose surface
    // in this dialog (why/body/body-post/recommendations, all a few lines
    // up) rather than making this one field a plain-text special case.
    $id('review-stop-answer').innerHTML = q.finalAnswerText ? renderMarkdown(q.finalAnswerText) : '<em>(no answer text on file)</em>';
    $id('author-row').style.display = 'none';
    $id('expand-row').style.display = 'none';
    $id('ans').style.display = 'none';
    $id('answer-hint').style.display = 'none';
    $id('btn-ans').style.display = 'none';
    $id('btn-respond-unresolved').style.display = 'none';
  } else {
    $id('review-stop-block').style.display = 'none';
    // Layout surgery (2026-07-30 inbox 2020): authorship row is chrome
    // gone by default — the setting controls whether it ever takes up
    // space, independent of review-stop state. The expand-field link
    // always shows here (its one home, above the textarea).
    $id('author-row').style.display = showAuthorshipField ? '' : 'none';
    $id('expand-row').style.display = '';
    $id('ans').style.display = '';
    $id('answer-hint').style.display = '';
    $id('btn-ans').style.display = '';
    $id('btn-respond-unresolved').style.display = '';
  }

  // ADR-0023: restore an in-progress draft, if one exists for this question's
  // key — but ONLY when this is actually a different question than what's
  // already on screen. render() re-runs on every background 'questions'
  // push (e.g. an unrelated ADR saved elsewhere), and re-populating the
  // textarea + stealing focus on every one of those repaints is what was
  // clobbering in-progress typing and yanking the cursor to the end
  // "incessantly" — see the note by lastShownDraftKey's declaration.
  const isNewQuestion = q.draftKey !== lastShownDraftKey;
  if (q.isReviewStop) {
    // A review stop never shows draft/drift banners — there's no live
    // answering happening here for them to protect.
    lastShownDraftKey = q.draftKey;
    $id('draft-restored').style.display = 'none';
  } else if (isNewQuestion) {
    if (q.draftText) {
      $id('ans').value = q.draftText;
      const savedAt = q.draftSavedAt ? new Date(q.draftSavedAt).toLocaleTimeString() : '';
      // Draft-vs-file coexistence (Jérémie's clobber report, 2026-07-24): a
      // stale two-word vault draft silently SHADOWED the file's real answer
      // and replaced it on submit. In-progress drafts still win the prefill
      // (the vault protects live typing — the DEBRIEF-001/003/004 lineage),
      // but the shadowing is now VISIBLE with a one-click swap. Nothing is
      // silently preferred in either direction.
      if (q.existingAnswer && q.existingAnswer !== q.draftText) {
        $id('draft-restored').innerHTML = 'Draft restored' + (savedAt ? ' (saved ' + savedAt + ')' : '') +
          ' · the file also holds an existing answer (' + q.existingAnswer.length + ' chars' + (q.fileMtime ? ', saved ' + new Date(q.fileMtime).toLocaleTimeString() : '') + ') — ' +
          '<a id="load-file-answer" role="button" style="cursor:pointer">load file answer instead</a>';
      } else {
        $id('draft-restored').textContent = 'Draft restored' + (savedAt ? ' (saved ' + savedAt + ')' : '');
      }
      $id('draft-restored').style.display = 'block';
    } else if (q.existingAnswer) {
      // Status-authority draft state (Jérémie's ask, 2026-07-23, elenchus
      // legacy): the question is OPEN but its ANS block already holds a
      // real draft answer awaiting the Status flip. Prefill it so nothing
      // is ever typed blind against invisible content — confirming a
      // legacy draft becomes read, maybe edit, Answer.
      $id('ans').value = q.existingAnswer;
      $id('draft-restored').textContent = 'Existing draft answer loaded from the file' + (q.fileMtime ? ' (saved ' + new Date(q.fileMtime).toLocaleTimeString() + ')' : '') + ' — edit if needed, then Answer to confirm & close';
      $id('draft-restored').style.display = 'block';
    } else {
      $id('ans').value = '';
      $id('draft-restored').style.display = 'none';
    }
    lastShownDraftKey = q.draftKey;
    lastSentDraftText = $id('ans').value; // '' is an opinion: 'I loaded an empty slot' — the CAS fence needs it
    loadedFileChecksum = q.fileChecksum;
    loadedExistingAnswer = q.existingAnswer || '';
  } else if (q.fileChecksum !== loadedFileChecksum && (q.existingAnswer || '') !== loadedExistingAnswer) {
    // Edit-time drift (Jérémie, 2026-07-24, the clobber matrix's last
    // square): the FILE's answer changed while this question is on screen.
    // Never touch the textarea (DEBRIEF-003/004: live typing is sacred) —
    // surface a banner with the file's new save time and an explicit
    // reload choice. 'Keep my editing' re-arms the check for the NEXT
    // change rather than nagging on every background push.
    $id('draft-restored').innerHTML = '⚠ The file changed while you were editing' +
      (q.fileMtime ? ' (saved ' + new Date(q.fileMtime).toLocaleTimeString() + ')' : '') + ' — ' +
      '<a id="load-file-answer" role="button" style="cursor:pointer">load new file answer</a> · ' +
      '<a id="keep-editing" role="button" style="cursor:pointer">keep my editing</a>';
    $id('draft-restored').style.display = 'block';
  } else if (q.draftText !== undefined && q.draftText !== lastSentDraftText && q.draftText !== $id('ans').value) {
    // Vault staleness (Riddle 5's design, ADR-0023 square 4, 2026-07-24
    // inbox 1834): the VAULT draft changed while this question is on screen —
    // a second Open Questions window (or any future draft-writing surface)
    // saved for the same question. The vault layer already guarantees
    // nothing is lost even if this window overwrites blind (v0.7.34's CAS
    // fence archives whatever gets clobbered) — this banner is what makes
    // that safety net VISIBLE and gives a graceful choice instead of a
    // silent overwrite. Never touch the textarea on its own (same
    // DEBRIEF-003/004 discipline as the file-drift sibling above).
    const diff = wordDiffCounts($id('ans').value, q.draftText);
    const savedAt = q.draftSavedAt ? new Date(q.draftSavedAt).toLocaleTimeString() : '';
    const sourceLabel = draftSourceLabel(q.draftSource);
    $id('draft-restored').innerHTML = '⚠ Updated draft detected (+' + diff.added + ' −' + diff.removed + ' words' +
      (savedAt ? ' at ' + savedAt : '') + (sourceLabel ? ' from ' + sourceLabel : '') + ') — ' +
      '<a id="keep-mine" role="button" style="cursor:pointer">Keep yours</a> · ' +
      '<a id="update-draft" role="button" style="cursor:pointer">Update</a> · ' +
      '<a id="see-draft-diff" role="button" style="cursor:pointer">See diff</a>';
    $id('draft-restored').style.display = 'block';
  }
  $id('flash').style.display = 'none';
  $id('drift-bar').style.display = 'none';
  $id('insertion-preview-bar').style.display = 'none';
  pendingInsertionConfirm = null;
  pendingInsertionContext = null;
  insertionAdjustment = 0;
  $id('btn-ans').disabled = false;
  $id('btn-respond-unresolved').disabled = false;
  $id('btn-back').disabled = idx === 0;
  // Bug fix (Facet's live report, 2026-07-28 inbox 2253): "Skip" reads as
  // dishonest on a question you've already answered — you're not skipping
  // it, you're moving on from something already settled. isReviewStop
  // already exists on the row per doctrine 9.
  $id('btn-skip').textContent = q.isReviewStop ? 'Next' : 'Skip';
  $id('err').style.display = 'none';
  if (isNewQuestion && !q.isReviewStop) setTimeout(() => $id('ans').focus(), 50);
}

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'questions') {
    if (typeof msg.generation === 'number' && msg.generation < lastQuestionsGeneration) {
      return; // stale push, superseded by data we already applied — ignore it
    }
    if (typeof msg.generation === 'number') lastQuestionsGeneration = msg.generation;
    // DEBRIEF-004 root cause: idx is a bare POSITION in a rebuilt array.
    // sendQuestions() reflattens every root's every ADR/seed on EVERY push,
    // and AdrIndex.allAdrs() re-sorts fresh each call — so in this
    // multi-writer repo, ANY unrelated docs/adr/*.md save anywhere
    // (not just the file currently open) can add/remove/reorder entries in
    // this list before idx's next use. Blindly keeping the same idx after
    // such a push can silently land it on a COMPLETELY DIFFERENT question;
    // the isNewQuestion gate then (correctly, given that wrong premise)
    // wipes the live textarea. That's the "field vanished mid-typing"
    // incident, and the same drift explains skip-and-return not restoring
    // (the "back" step lands on whatever now occupies that position, not
    // the question that used to be there). Re-locate the question that was
    // actually on screen by its stable draftKey before falling back to the
    // old positional clamp.
    const currentKey = questions[idx] ? questions[idx].draftKey : undefined;
    // Bug fix (Facet's live click-through report, 2026-07-26 inbox 0349,
    // "9 of 9 on first tour open"): capture which pool we were in BEFORE
    // this push, so a tour started/stopped/switched can be told apart from
    // an ordinary reshuffle of the SAME pool.
    const previousTourSlug = activeTour ? activeTour.slug : null;
    renderTitleMarkdown = msg.renderTitleMarkdown !== false;
    questions = msg.questions;
    activeTour = msg.tour || null;
    renderTourHeader();
    const poolChanged = previousTourSlug !== (activeTour ? activeTour.slug : null);
    recCollapseThreshold = msg.recommendationCollapseThreshold || 0;
    reportButtonEnabled = !!msg.reportButtonEnabled;
    $id('btn-report').style.display = reportButtonEnabled ? '' : 'none';
    showAuthorshipField = !!msg.showAuthorshipField;
    if (questions.length === 0) {
      idx = 0;
    } else {
      const relocated = currentKey !== undefined ? questions.findIndex(q => q.draftKey === currentKey) : -1;
      if (relocated >= 0) {
        // Same question, just at a new position — idx corrected, nothing
        // else changes, isNewQuestion will correctly read false in render().
        idx = relocated;
      } else if (poolChanged) {
        // Tour started/stopped/switched: this is a wholesale DISJOINT pool,
        // not a reshuffle of the one idx was already tracking — DEBRIEF-004's
        // "clamp only if out of bounds" assumed pool CONTINUITY (same set,
        // reordered), which tour mode breaks by design. A stale idx that
        // numerically still fit the new (often much smaller) array was
        // otherwise left alone instead of reset — the exact "9 of 9" on
        // first tour open Facet reported live.
        idx = 0;
      } else if (idx >= questions.length) {
        // Genuinely gone (answered/removed elsewhere) and no fallback
        // position: clamp to last item rather than wrapping to 0 — keeps
        // the user near where they were, not back at the first question.
        idx = questions.length - 1;
      }
    }

    // Pre-fill author: saved state > git config > top name from ADR index
    if (!saved.author && (msg.gitAuthor || (msg.authorSuggestions && msg.authorSuggestions[0]))) {
      const best = msg.gitAuthor || msg.authorSuggestions[0];
      $id('author').value = best;
      saved.author = best;
      vscode.setState(saved);
    }

    render();
  }
  if (msg.type === 'answered') {
    // Regression fix (2026-03-12): do NOT advance idx here for the
    // ORDINARY walk. The 'questions' refresh (triggered by file-save)
    // already removes the answered question and re-renders with the
    // correct next idx. Advancing here caused a double-move: answering
    // second-to-last would show the last question (correct), then wrap
    // back to index 0 (wrong). One owner of idx: the 'questions' handler.
    // See ADR-0010.
    //
    // Bug fix (Facet's live report, 2026-07-28 inbox 2253, Jérémie's own
    // words): that non-advance rule was never really "one owner of idx" as
    // a designed feature — in the ordinary walk, answering a question makes
    // it VANISH from the next push (buildAllQuestions filters to open only),
    // so idx staying put and the array shrinking underneath it is what
    // LOOKED like auto-advance. Doctrine 9 (tour mode) keeps every entry,
    // answered or not, so that array never shrinks — the emergent advance
    // silently stopped happening as a side effect of doctrine 9 doing
    // exactly what it was designed to do. Restoring the user-visible EFFECT
    // here, explicitly, only for tour mode (the ordinary walk's own
    // mechanism is untouched and still correct on its own).
    if (activeTour && questions.length > 0) {
      idx = (idx + 1) % questions.length;
      render();
    }
    $id('flash').style.display = 'flex';
    $id('btn-ans').disabled = false;
  $id('btn-respond-unresolved').disabled = false;
    setTimeout(() => { $id('flash').style.display = 'none'; }, 900);
    // "Question doesn't advance" hardening (2026-07-12): the panel now
    // advances even when the disk save itself failed (reindex uses buffer
    // truth) — but the human still needs to know the answer isn't
    // persisted yet, or a crash before the next successful save loses it.
    // Persistent (2026-07-16, Lapidary 5): a background "questions" push
    // (constant, in this multi-writer repo) must not silently dismiss this
    // before it's been read — see showSaveWarning's declaration.
    if (msg.warning) {
      showSaveWarning(msg.warning, msg.adrPath);
    }
  }
  if (msg.type === 'saveRetryResult') {
    if (msg.saved) {
      hideSaveWarning();
    } else {
      $id('save-warning-text').textContent = 'Still not saved — ' + msg.adrPath + '. Try saving the file manually.';
    }
  }
  if (msg.type === 'navigate') {
    const i = questions.findIndex(q => q.id === msg.questionId);
    if (i >= 0) { idx = i; render(); }
  }
  if (msg.type === 'error') {
    $id('btn-ans').disabled = false;
  $id('btn-respond-unresolved').disabled = false;
    $id('err').style.display = 'block';
    $id('err').textContent = msg.message;
  }
  if (msg.type === 'driftDetected') {
    // ADR-0023 drift fence: the file changed under this in-flight answer.
    // Never write blind — the draft is already auto-saved, so all three
    // choices here are safe.
    $id('btn-ans').disabled = false;
  $id('btn-respond-unresolved').disabled = false;
    $id('drift-bar').style.display = 'flex';
  }
  if (msg.type === 'insertionPreview') {
    // Insertion-preview protocol (DEBRIEF-006): no ANS marker/placeholder to
    // fill — the extension host is about to append a fresh block at a
    // computed guess, and stopped before writing to show us where. Nothing
    // has been written yet; the draft is safe either way.
    $id('btn-ans').disabled = false;
  $id('btn-respond-unresolved').disabled = false;
    pendingInsertionConfirm = msg.message;
    pendingInsertionContext = { before: msg.before, after: msg.after };
    insertionAdjustment = 0;
    renderInsertionPreview();
    $id('insertion-preview-bar').style.display = 'flex';
  }
});
</script>
</body>
</html>`
}
