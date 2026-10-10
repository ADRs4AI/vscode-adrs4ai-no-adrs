/**
 * Webview Script Syntax Tests
 *
 * The webview JS lives inside a template string in openQuestionsPanel.ts.
 * TypeScript has zero visibility into that string — syntax errors are invisible
 * to tsc, vitest, and vite. This test extracts the <script> block and validates
 * it with Node's vm.Script, catching syntax errors in under 50ms.
 *
 * This test exists because of a real incident: a blank panel regression shipped
 * undetected because all 120 parser/normalizer tests passed while the webview
 * script had a broken if/else structure. See ADR-0010 action items for the
 * deeper fix (extract webview JS into a separately bundled file).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, it, expect, vi } from 'vitest'
import { bodyMaxWidthCss } from '../webview/panelSettings'
import { createWebviewHarness } from './helpers/webviewHarness'

const PANEL_SRC = readFileSync(
  resolve(__dirname, '../webview/openQuestionsPanel.ts'),
  'utf8',
)

describe('Webview script block syntax', () => {
  it('extracts a non-empty <script> block from the panel template', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    expect(match).toBeTruthy()
    expect(match![1].trim().length).toBeGreaterThan(100)
  })

  it('webview script is syntactically valid JavaScript (catches blank-panel class of bug)', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    const scriptContent = match![1]
    // vm.Script parses and compiles without executing — safe and fast
    expect(() => new vm.Script(scriptContent)).not.toThrow()
  })

  it('render() function is defined in the script', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    expect(match![1]).toContain('function render()')
  })

  it('all expected DOM element IDs are referenced in the script', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    const script = match![1]
    // Every element referenced in render() must actually exist in the HTML
    const ids = ['qtext', 'why', 'body', 'rec-wrap', 'body-post',
                 'counter', 'pbar', 'adr-link', 'ans', 'btn-ans', 'btn-back']
    for (const id of ids) {
      expect(script, `script must reference element #${id}`).toContain(`'${id}'`)
    }
  })

  it('all referenced DOM IDs exist in the HTML template', () => {
    const ids = ['qtext', 'why', 'body', 'rec-wrap', 'body-post',
                 'counter', 'pbar', 'adr-link', 'ans', 'btn-ans', 'btn-back']
    for (const id of ids) {
      expect(
        PANEL_SRC,
        `HTML must contain element with id="${id}"`,
      ).toMatch(new RegExp(`id="${id}"`))
    }
  })

  it('getHtml() interpolates the computed body max-width into #card', () => {
    expect(PANEL_SRC).toContain('#card{max-width:${bodyMaxWidth}')
  })

  it('renderRecommendations() function is defined and wired into render()', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    expect(match![1]).toContain('function renderRecommendations(list, q)')
    expect(match![1]).toContain('renderRecommendations(q.recommendations')
  })

  it('stacked recommendations: older-than-N collapse behind a disclosure, per adrManager.panel.recommendationCollapseThreshold', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    const script = match![1]
    expect(script).toContain('recCollapseThreshold')
    expect(script).toContain('earlier recommendation')
    expect(script).toContain('recommendationCollapseThreshold')
  })

  it('ADR-0019: renders an attribution chip per recommendation, distinguishing inferred authors', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    const script = match![1]
    expect(script).toContain('function authorColor(author)')
    expect(script).toContain('rec-chip')
    expect(script).toContain('rec-chip-inferred')
    expect(script).toContain('rec.authorInferred')
    expect(PANEL_SRC).toContain('.rec-chip{')
    expect(PANEL_SRC).toContain('.recommendation.rec-recent{')
  })

  it('expand-field affordance: link on the hint line, class toggle on the SAME textarea, Cmd+Shift+E (system3 ADR-0017 case study, 2026-07-24)', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    const script = match![1]
    expect(PANEL_SRC).toMatch(/id="expand-field"/)
    expect(PANEL_SRC).toContain('textarea.expanded{')
    expect(script).toContain('function toggleExpandField()')
    expect(script).toContain("classList.toggle('expanded')")
    // Same element grows — value/cursor/draft autosave untouched; no
    // second editor surface that could fork the draft.
    expect(script).not.toContain('createElement(\'textarea\')')
  })

  it('ADR-0023: auto-saves a draft (debounced) on textarea input', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    const script = match![1]
    expect(script).toContain("addEventListener('input'")
    expect(script).toContain("type: 'draft'")
    expect(script).toContain('setTimeout')
  })

  it('ADR-0023: restores a draft on render with a "draft restored" indicator', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    const script = match![1]
    expect(script).toContain('q.draftText')
    expect(script).toContain('Draft restored')
    expect(PANEL_SRC).toMatch(/id="draft-restored"/)
  })

  // Regression (fixes bug reported 2026-07-12 by Jérémie): render() re-runs
  // on every background 'questions' push — including ones triggered by an
  // unrelated ADR saved elsewhere in the workspace, which is constant in a
  // repo with concurrent writers. It used to unconditionally reset the
  // textarea to the last-saved draftText and steal focus on every single one
  // of those repaints, which both clobbered in-progress typing (a background
  // push can carry an older draftText than what's currently typed but not
  // yet past the 500ms debounce) and yanked the cursor to the end of the box
  // "incessantly" (setting .value always collapses the selection). The fix
  // tracks which question was last shown and only touches the textarea/focus
  // when the question actually changed.
  it('render() only restores the textarea/focus when the question actually changed, not on every background refresh', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    const script = match![1]
    expect(script).toContain('lastShownDraftKey')
    // The draft-restore block and the focus() call must both be gated on the
    // same-question check — not run unconditionally on every render().
    expect(script).toMatch(/isNewQuestion\s*=\s*q\.draftKey\s*!==\s*lastShownDraftKey/)
    // ADR-0034 doctrine 9: focus is also withheld for a review stop (there's
    // no textarea to focus), so the guard grew an extra clause.
    expect(script).toMatch(/if \(isNewQuestion && !q\.isReviewStop\)[\s\S]{0,20}\$id\('ans'\)\.focus\(\)/)
  })

  it('ADR-0023: submit() includes draftKey + fileChecksum for the drift fence', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    const script = match![1]
    expect(script).toContain('draftKey: q.draftKey')
    expect(script).toContain('fileChecksum: q.fileChecksum')
  })

  it('ADR-0023: drift-detected shows a three-choice consent bar, not a blind write', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    const script = match![1]
    expect(script).toContain("msg.type === 'driftDetected'")
    for (const id of ['btn-drift-refresh', 'btn-drift-write', 'btn-drift-hold', 'drift-bar']) {
      expect(PANEL_SRC, `must reference #${id}`).toMatch(new RegExp(`(id="${id}"|'${id}')`))
    }
  })

  it('Problem 2 fix (panel-submit-no-refresh-bug seed): discards stale/out-of-order "questions" pushes by generation', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    const script = match![1]
    expect(script).toContain('lastQuestionsGeneration')
    expect(script).toContain('msg.generation < lastQuestionsGeneration')
    expect(PANEL_SRC).toContain('this.questionsGeneration')
    expect(PANEL_SRC).toContain('generation: this.questionsGeneration')
  })

  // ADR-0018 Step 3: seed questions merged into the panel's read/write path.
  it('ADR-0018 Step 3: TOC groups by server-computed groupSortKey/groupLabel, not adrNumber directly', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    const script = match![1]
    // Regression: grouping by adrNumber alone would merge every seed's
    // questions into one bogus "ADR-0000" group, since seeds all share the
    // same adrNumber sentinel (0).
    expect(script).toContain('byGroup[q.groupSortKey]')
    expect(script).not.toContain('byAdr[q.adrNumber]')
  })

  it('ADR-0018 Step 3: submit() forwards sourceKind so writeAnswer can pick parseAdr vs parseSeed', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    const script = match![1]
    expect(script).toContain('sourceKind: q.sourceKind')
  })

  it('ADR-0025 panel-aggregation: createOrShow and the constructor both take a CompositeIndex', () => {
    // ADR-0034: both gained an optional tour-slug parameter — the CompositeIndex requirement itself is unchanged.
    expect(PANEL_SRC).toContain('createOrShow(composite: CompositeIndex, tourSlug?: string)')
    expect(PANEL_SRC).toContain('constructor(private readonly composite: CompositeIndex, initialTourSlug?: string)')
  })

  // Regression (Facet's live click-through report, 2026-07-26 inbox 0349):
  // an already-open panel stuck in tour mode had no way out except the
  // explicit Exit-tour link — clicking any other, non-tour question in the
  // tree was a silent no-op, because `if (tourSlug) setTour(tourSlug)`
  // left activeTourSlug untouched when tourSlug was omitted. Fixed by
  // making every call state its intended mode outright: setTour(undefined)
  // now explicitly returns to the full walk instead of being skipped.
  it('createOrShow calls setTour UNCONDITIONALLY on an already-open panel — omitting tourSlug must clear tour mode, not leave it alone', () => {
    expect(PANEL_SRC).toContain('OpenQuestionsPanel.instance.setTour(tourSlug)')
    expect(PANEL_SRC).not.toContain('if (tourSlug) OpenQuestionsPanel.instance.setTour(tourSlug)')
  })

  it('setTour accepts string | undefined (a bare boolean-truthy check would silently re-introduce the "stuck in tour mode" bug)', () => {
    expect(PANEL_SRC).toContain('setTour(tourSlug: string | undefined): void')
  })

  // Regression (same report): the tab title never distinguished tour mode from the plain walk.
  it('the panel title reflects tour mode, and reverts to "Open Questions" outside it', () => {
    expect(PANEL_SRC).toContain("this.panel.title = found ? `Tour: ${found.tour.title}` : 'Open Questions'")
    expect(PANEL_SRC).toContain('this.updatePanelTitle()')
  })

  // Regression (Jérémie via Facet, 2026-07-28 inbox 1337): the authored-
  // claim block used to sit between the question title and #why, styled
  // almost identically to #why ("visually unparseable... cognitive
  // overload"). Jérémie's own fix, taken verbatim: move it ABOVE the
  // title so it prefaces the question instead of competing with the
  // established title -> why-asking -> body -> recommendation order.
  it('#tour-entry-info renders BEFORE #qtext in source order, not between the title and #why', () => {
    const entryInfoPos = PANEL_SRC.indexOf('id="tour-entry-info"')
    const qtextPos = PANEL_SRC.indexOf('id="qtext"')
    expect(entryInfoPos).toBeGreaterThan(-1)
    expect(qtextPos).toBeGreaterThan(-1)
    expect(entryInfoPos).toBeLessThan(qtextPos)
  })

  it('.tour-entry-info is visually distinct from .why (Jérémie via Facet, 2026-07-28: "visually unparseable" against .why\'s near-identical border/background)', () => {
    const match = PANEL_SRC.match(/\.tour-entry-info\{[^}]*\}/)
    expect(match).toBeTruthy()
    expect(match![0]).not.toContain('textBlockQuote-border')
  })

  it('the Exit-tour link inherits the tour header\'s own (possibly themed) color instead of a hardcoded editor link color', () => {
    expect(PANEL_SRC).not.toContain('.tour-header a{font-size:11px;color:var(--vscode-textLink-foreground)')
    const match = PANEL_SRC.match(/\.tour-header a\{[^}]*\}/)
    expect(match).toBeTruthy()
    expect(match![0]).not.toContain('color:')
  })

  describe('ADR-0038 tier 1: the answer box inherits the editor font, not the UI font', () => {
    it('the textarea rule uses the editor-font CSS variables, not --vscode-font-family', () => {
      const match = PANEL_SRC.match(/^textarea\{[^}]*\}/m)
      expect(match).toBeTruthy()
      expect(match![0]).toContain('font-family:var(--vscode-editor-font-family)')
      expect(match![0]).toContain('font-size:var(--vscode-editor-font-size,14px)')
      expect(match![0]).toContain('font-weight:var(--vscode-editor-font-weight,normal)')
      expect(match![0]).not.toContain('--vscode-font-family')
    })
  })

  // Regression (Facet, 2026-07-28 inbox 2247, Jérémie's screenshot):
  // .review-stop-answer got the renderMarkdown() swap (v0.7.46, fixing the
  // whitespace-collapse bug) but never the CSS scaffold every OTHER class
  // receiving renderMarkdown's output already carries — no ul/ol indent, no
  // paragraph spacing, everything fell through to the file's universal
  // `*{margin:0;padding:0}` reset. Named here as a standing check so a
  // FUTURE new prose container can't silently ship without its scaffold
  // the same way this one did — per Facet's own suggested regression.
  describe('Every class rendering renderMarkdown() output carries its CSS scaffold (ul/ol indent, p margin)', () => {
    const proseClasses = ['.why', '.qst-body', '.ctx-body', '.recommendation', '.review-stop-answer']
    for (const cls of proseClasses) {
      it(`${cls} has a ul/ol padding rule and a p margin rule`, () => {
        const escaped = cls.replace('.', '\\.')
        expect(PANEL_SRC, `${cls} is missing a ul/ol padding-left rule`).toMatch(new RegExp(`${escaped} (ul|ol)[,{]`))
        expect(PANEL_SRC, `${cls} is missing a p margin rule`).toMatch(new RegExp(`${escaped} p[,{]`))
      })
    }
  })

  it('ADR-0018 Step 3: writeAnswer branches to parseSeed for seed-sourced questions, never parseAdr for them', () => {
    expect(PANEL_SRC).toContain("msg.sourceKind === 'seed'")
    expect(PANEL_SRC).toContain('parseSeed(currentContent, msg.adrPath)')
  })

  it('ADR-0018 Step 3 + ADR-0025: reindexes the OWNING ROOT\'s seed index (not the ADR index) after a seed write', () => {
    // Updated 2026-07-12: reindexes from buffer content (indexContent), not
    // disk (indexFile) — see the "question doesn't advance" fix below.
    // Updated again same day (ADR-0025 panel-aggregation): reindexes through
    // the CompositeIndex.findRoot()-resolved owning root, not a single
    // global seedIndex singleton — a write in one root must never be
    // reindexed against a different root's index.
    expect(PANEL_SRC).toContain('owningRoot.seeds.indexContent(msg.adrPath, freshContent)')
  })

  // "Question doesn't advance" residual (Lapidary 5, 2026-07-12): no file in
  // src/ subscribed to onDidChangeTextDocument/onDidSaveTextDocument, so the
  // refresh pipeline was disk-watcher-only. Any write path where the buffer
  // edit landed but the disk save silently failed or raced left the panel
  // stale until an unrelated manual save nudged the watcher.
  it('writeAnswer checks applyEdit\'s return value and refuses to proceed on failure', () => {
    expect(PANEL_SRC).toContain('const applied = await vscode.workspace.applyEdit(edit)')
    expect(PANEL_SRC).toContain('if (!applied)')
  })

  // Updated 2026-07-16 (Lapidary 5, not-dirty/no-visible-editor false
  // positive, caught on camera): doc.save() (TextDocument.save()), not
  // vscode.workspace.save(uri) — the latter requires an open EDITOR for
  // the URI, which the panel never has ("answerable in place"), so it
  // resolved falsy on ordinary successful writes and fired the warning
  // over nothing.
  it('writeAnswer checks doc.save()\'s return value and retries once before warning', () => {
    expect(PANEL_SRC).toContain('let saved = await doc.save()')
    expect(PANEL_SRC).toContain('if (!saved) {')
    expect((PANEL_SRC.match(/doc\.save\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  // DEBRIEF (Lapidary 5, 2026-07-16, caught on camera in a GIF take —
  // Jérémie: "seen it blink past many times"): the save-failure warning
  // used to share #err with everything else render() clears on every
  // background "questions" push (any concurrent save anywhere in this
  // multi-writer repo) — so it could vanish before it was ever read.
  // These run the ACTUAL shipped script (Quarry 5's harness), not a
  // description of intended behavior.
  describe('Persistent save-failure warning survives background refreshes', () => {
    const Q1 = { id: 'q1', text: 'Q1', adrPath: '/fake/a.md', adrNumber: 1, lineStart: 1, draftKey: 'key-1', fileChecksum: 'c1', totalOccurrences: 1, groupLabel: 'ADR-0001', groupSortKey: '0-0001', sourceKind: 'adr' }

    it('a save-failure warning stays visible across an unrelated background "questions" push', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1] })
      h.postToWebview({ type: 'answered', questionId: 'q1', adrPath: '/fake/a.md', warning: 'Answer applied but not yet saved to disk (/fake/a.md) — save the file manually to make sure it isn\'t lost.' })
      expect(h.element('save-warning-bar').style.display).toBe('flex')

      // An unrelated background refresh — same shape as any concurrent
      // save elsewhere triggering index.onChange -> sendQuestions().
      h.postToWebview({ type: 'questions', generation: 1, questions: [Q1] })

      expect(h.element('save-warning-bar').style.display).toBe('flex')
      expect(h.element('save-warning-text').textContent).toContain('not yet saved to disk')
    })

    it('"Save now" posts a retrySave message with the warned file\'s path', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1] })
      h.postToWebview({ type: 'answered', questionId: 'q1', adrPath: '/fake/a.md', warning: 'not saved' })
      h.click('btn-save-now')
      expect(h.sentMessages).toContainEqual({ type: 'retrySave', adrPath: '/fake/a.md' })
    })

    it('a successful retry result hides the warning', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1] })
      h.postToWebview({ type: 'answered', questionId: 'q1', adrPath: '/fake/a.md', warning: 'not saved' })
      h.postToWebview({ type: 'saveRetryResult', adrPath: '/fake/a.md', saved: true })
      expect(h.element('save-warning-bar').style.display).toBe('none')
    })

    it('a failed retry result keeps the warning visible and updates its text', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1] })
      h.postToWebview({ type: 'answered', questionId: 'q1', adrPath: '/fake/a.md', warning: 'not saved' })
      h.postToWebview({ type: 'saveRetryResult', adrPath: '/fake/a.md', saved: false })
      expect(h.element('save-warning-bar').style.display).toBe('flex')
      expect(h.element('save-warning-text').textContent).toContain('Still not saved')
    })

    it('Dismiss hides the warning', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1] })
      h.postToWebview({ type: 'answered', questionId: 'q1', adrPath: '/fake/a.md', warning: 'not saved' })
      h.click('btn-save-dismiss')
      expect(h.element('save-warning-bar').style.display).toBe('none')
    })

    it('does not show the warning bar at all on an ordinary successful answer', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1] })
      h.postToWebview({ type: 'answered', questionId: 'q1' })
      expect(h.element('save-warning-bar').style.display).not.toBe('flex')
    })
  })

  it('reindexes from the live buffer (doc.getText()), not disk, so the panel advances even if the save failed', () => {
    expect(PANEL_SRC).toContain('const freshContent = doc.getText()')
    expect(PANEL_SRC).toContain('owningRoot.adrs.indexContent(msg.adrPath, freshContent)')
  })

  it('ADR-0025 panel-aggregation: writeAnswer resolves the owning root via findRoot() and refuses (not guesses) when the file is outside every known root', () => {
    expect(PANEL_SRC).toContain('const owningRoot = this.composite.findRoot(msg.adrPath)')
    expect(PANEL_SRC).toContain('if (!owningRoot) {')
  })

  it('ADR-0025 panel-aggregation: ADR-sourced draftKey containerId is root-qualified, seed containerId is unchanged', () => {
    // ADR-0034: this row-opts computation was factored into adrRowOpts() (shared with tour mode's buildTourQuestions), reading node.findRoot(adr.path) rather than closing over a loop's `node` — same root-qualification, same value.
    expect(PANEL_SRC).toContain('containerId: `${namespace}:${adr.number}`')
    expect(PANEL_SRC).toContain('freshContainerId = `${owningRoot.namespace}:${freshAdr.number}`')
    // Seed containerId stays the seed's own absolute path — already globally unique.
    expect(PANEL_SRC).toContain("freshContainerId = msg.adrPath")
  })

  it('surfaces a visible warning when the answer was applied but not saved — never a silent partial success', () => {
    expect(PANEL_SRC).toContain('Answer applied but not yet saved to disk')
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    expect(match![1]).toContain('if (msg.warning)')
  })

  // Missing-ANS fallback (Lapidary 5, 2026-07-13, specimen 1 — Jérémie hit
  // this hand-answering a grammar seed: three QSTs shipped with
  // "- Status: unanswered" but no "**ANS:**" marker and no placeholder at
  // all, and the panel just refused: "no ANS or placeholder and it wasn't
  // able to insert one, which I thought was already a feature"). writeAnswer
  // now appends a brand-new ANS block when neither an ANS header nor a
  // placeholder line is found, using Status as the reliable anchor.
  it('writeAnswer appends a fresh ANS block when the question has no ANS marker at all — only at a REAL boundary (DEBRIEF-006 gate)', () => {
    expect(PANEL_SRC).toContain("} else if (boundaryKind !== 'window' && this.missingAnsBehavior(uri) !== 'refuse') {")
    expect(PANEL_SRC).toContain('edit.insert(uri, pos, `\\n**ANS:** (by ${author})\\n${msg.answerText}\\n`)')
  })

  describe('Regression tests', () => {
    // Bug (Jérémie, 2026-07-25): a perfectly well-formed question with no
    // "[Fill this out]" placeholder, no ANS marker, AND no "- Status:" line
    // hit "Could not find the ANS block ... Please answer this one manually"
    // — the append-ANS fallback gate demanded `statusLineIdx >= 0` even
    // though the insertion point is computed from the block END, not from
    // Status. The read path (status-authority's derived-openness rule) had
    // no such requirement, so the panel surfaced questions its own write
    // path then refused. Fixed 2026-07-25: the gate keeps the DEBRIEF-006
    // boundary check and the refuse/confirm setting, but not the Status
    // anchor; answered-ness then derives from the appended ANS content —
    // the same derived path that surfaced the question.
    it('the append-ANS fallback gate must not require a Status line (fixes the status-less refusal, 2026-07-25)', () => {
      expect(PANEL_SRC).not.toContain("statusLineIdx >= 0 && boundaryKind !== 'window'")
      // Step 1's flip stays conditional — no Status line means nothing to rewrite.
      expect(PANEL_SRC).toContain('if (statusLineIdx >= 0) {')
    })
  })

  it('writeAnswer\'s anchor scan is the SHARED module, never a private re-derivation — block extent, Status form, and boundaries are answerWriteScan.ts\'s to define', () => {
    // This test used to pin the inline scan's source strings ("kept in sync
    // by hand until there's a single shared module for both" — its own
    // words). The shared module arrived 2026-07-16 (crossfoot ADR-0030
    // refusal: the panel's private scan couldn't see bold Status, so the
    // append fallback refused a question the extractor had surfaced). The
    // behavioral coverage — thematic-break stop, handle-form boundaries,
    // bold-Status anchoring — now lives in answerWriteScan.test.ts; what
    // this file still owns is the wiring claim: the panel consumes the
    // shared scan and has no private scan left to drift.
    expect(PANEL_SRC).toContain('scanAnswerWriteAnchors(lines, start)')
    // DEBRIEF-006 (2026-07-18): no arbitrary line cap may reappear — the
    // 40-line window's cap doubled as the append fallback's insertion
    // point and spliced an answer mid-recommendation.
    expect(PANEL_SRC).not.toContain('start + 40')
    expect(PANEL_SRC).toContain("boundaryKind !== 'window'")
    expect(PANEL_SRC).not.toContain('let blockEndLineIdx')
    expect(PANEL_SRC).not.toContain("startsWith('- Status:')")
  })

  // Insertion-preview protocol (Jérémie's own design, dispatched 2026-07-13;
  // launch-gating per DEBRIEF-006's ratification, 2026-07-18): the append-ANS
  // fallback's insertion point is a computed guess, not an exact marker
  // match. Before writing, the panel shows the surrounding lines and waits
  // for confirmation — these run the ACTUAL shipped webview script, not a
  // description of intended behavior.
  describe('Insertion-preview protocol (DEBRIEF-006): confirm before the append-ANS fallback writes', () => {
    const originalAnswer = {
      type: 'answer', questionId: 'q1', adrPath: '/fake/a.md', lineStart: 10,
      answerText: 'my answer', authorName: 'Jérémie', draftKey: 'key-1',
      fileChecksum: 'c1', force: false, sourceKind: 'adr',
    }
    const previewMsg = {
      type: 'insertionPreview',
      before: ['line1', 'line2', 'line3'],
      after: ['line4', 'line5', 'line6'],
      message: originalAnswer,
    }

    it('shows the before/marker/after context and re-enables the answer button, without writing anything', () => {
      const h = createWebviewHarness()
      h.postToWebview(previewMsg)
      expect(h.element('insertion-preview-bar').style.display).toBe('flex')
      expect(h.element('btn-ans').disabled).toBe(false)
      const context = h.element('insertion-preview-context').textContent
      expect(context).toContain('line3')
      expect(context).toContain('------ inserting here ------')
      expect(context).toContain('line4')
      expect(h.sentMessages).toHaveLength(0)
    })

    it('"Insert here" resends the original answer message with confirmedInsertion:true and insertLineOffset:0, and hides the bar', () => {
      const h = createWebviewHarness()
      h.postToWebview(previewMsg)
      h.click('btn-insertion-confirm')
      expect(h.element('insertion-preview-bar').style.display).toBe('none')
      expect(h.sentMessages).toContainEqual({ ...originalAnswer, confirmedInsertion: true, insertLineOffset: 0 })
    })

    // Regression test (fixes real bug, Jérémie live, 2026-08-25): "when the
    // answer must be inserted, I do see the [preview], but the subsequent
    // Cmd+Enter doesn't submit the answer. I currently have to manually
    // click on 'Insert here'." Root cause: submit() (what the Cmd+Enter
    // keydown handler calls) unconditionally cleared pendingInsertionConfirm
    // and posted a FRESH, non-confirmed 'answer' message — Cmd+Enter just
    // re-ran the same no-marker-found path and redrew the same preview,
    // reading as "does nothing." Fixed by having submit() check for a
    // pending preview FIRST and resend the stored confirmation, same as the
    // button already did.
    it('a subsequent Cmd+Enter, while the preview is showing, confirms it exactly like clicking "Insert here" — does not start a fresh submit', () => {
      const h = createWebviewHarness()
      h.postToWebview(previewMsg)
      const ans = h.element('ans')
      for (const handler of ans.listeners['keydown'] ?? []) {
        handler({ metaKey: true, ctrlKey: false, shiftKey: false, key: 'Enter', preventDefault: () => {} })
      }
      expect(h.element('insertion-preview-bar').style.display).toBe('none')
      expect(h.sentMessages).toContainEqual({ ...originalAnswer, confirmedInsertion: true, insertLineOffset: 0 })
      // Exactly one message sent — not the confirm PLUS a second, fresh
      // (non-confirmed) 'answer' message from submit() falling through.
      expect(h.sentMessages).toHaveLength(1)
    })

    it('Cmd+Shift+Enter ("Respond unresolved"), while the preview is showing, ALSO just confirms the pending preview — the stored message already carries the original targetStatus', () => {
      const unresolvedAnswer = { ...originalAnswer, targetStatus: 'unresolved' }
      const h = createWebviewHarness()
      h.postToWebview({ ...previewMsg, message: unresolvedAnswer })
      const ans = h.element('ans')
      for (const handler of ans.listeners['keydown'] ?? []) {
        handler({ metaKey: true, ctrlKey: false, shiftKey: true, key: 'Enter', preventDefault: () => {} })
      }
      expect(h.sentMessages).toContainEqual({ ...unresolvedAnswer, confirmedInsertion: true, insertLineOffset: 0 })
      expect(h.sentMessages).toHaveLength(1)
    })

    it('Cancel dismisses the preview without sending anything, and re-enables the answer button', () => {
      const h = createWebviewHarness()
      h.postToWebview(previewMsg)
      h.click('btn-insertion-cancel')
      expect(h.element('insertion-preview-bar').style.display).toBe('none')
      expect(h.element('btn-ans').disabled).toBe(false)
      expect(h.sentMessages).toHaveLength(0)
    })

    // ±1 adjustment (Jérémie via Gleaner's sweep, 2026-07-31): "if we are not
    // sure, we should make a guess, and let the user - (move back a line) or
    // + (move down a line)" — a directional nudge within the already-fetched
    // 3+3 context window, re-rendered client-side with no extra round-trip.
    it('Move down shifts the marker later in the context and is sent as insertLineOffset on confirm', () => {
      const h = createWebviewHarness()
      h.postToWebview(previewMsg)
      h.click('btn-insertion-down')
      const context = h.element('insertion-preview-context').textContent
      const lines = context.split('\n')
      expect(lines.indexOf('------ inserting here ------')).toBe(lines.indexOf('line4') + 1)
      h.click('btn-insertion-confirm')
      expect(h.sentMessages).toContainEqual({ ...originalAnswer, confirmedInsertion: true, insertLineOffset: 1 })
    })

    it('Move up shifts the marker earlier in the context and is sent as insertLineOffset on confirm', () => {
      const h = createWebviewHarness()
      h.postToWebview(previewMsg)
      h.click('btn-insertion-up')
      const context = h.element('insertion-preview-context').textContent
      const lines = context.split('\n')
      expect(lines.indexOf('------ inserting here ------')).toBe(lines.indexOf('line2') + 1)
      h.click('btn-insertion-confirm')
      expect(h.sentMessages).toContainEqual({ ...originalAnswer, confirmedInsertion: true, insertLineOffset: -1 })
    })

    it('resets the adjustment to 0 on a fresh preview', () => {
      const h = createWebviewHarness()
      h.postToWebview(previewMsg)
      h.click('btn-insertion-up')
      h.postToWebview(previewMsg)
      h.click('btn-insertion-confirm')
      expect(h.sentMessages).toContainEqual({ ...originalAnswer, confirmedInsertion: true, insertLineOffset: 0 })
    })

    // Host-side half of the same feature: writeAnswer() must apply the
    // offset (clamped to the question's own extent) before writing, not
    // trust the webview's arithmetic blindly.
    it('writeAnswer applies insertLineOffset, clamped to [start, blockEndLineIdx]', () => {
      expect(PANEL_SRC).toContain('if (msg.insertLineOffset) {')
      expect(PANEL_SRC).toContain('insertLineIdx = Math.min(Math.max(insertLineIdx + msg.insertLineOffset, start), blockEndLineIdx)')
    })
  })

  // Feature (Jérémie via Gleaner's sweep, 2026-08-05, docs/inbox/2026-08-
  // 05-0433-...): the insertion-preview picker sometimes renders below the
  // human's current scroll position with no visible cue it fired. A toast
  // in the panel's own accent color (never the insertion-preview-bar's own
  // warning-yellow — explicitly excluded by the ask) appears when the bar
  // is offscreen, and disappears once it scrolls into view.
  describe('Off-screen insertion-picker attention toast', () => {
    const previewMsg = {
      type: 'insertionPreview',
      before: ['line1', 'line2', 'line3'],
      after: ['line4', 'line5', 'line6'],
      message: {
        type: 'answer', questionId: 'q1', adrPath: '/fake/a.md', lineStart: 10,
        answerText: 'x', authorName: 'Jérémie', draftKey: 'k', fileChecksum: 'c', sourceKind: 'adr',
      },
    }

    it('isElementOffscreenBelow: true once the element\'s top reaches or passes the viewport height', () => {
      const isElementOffscreenBelow = createWebviewHarness().sandbox.isElementOffscreenBelow as (rect: { top: number }, viewportHeight: number) => boolean
      expect(isElementOffscreenBelow({ top: 799 }, 800)).toBe(false)
      expect(isElementOffscreenBelow({ top: 800 }, 800)).toBe(true)
      expect(isElementOffscreenBelow({ top: 5000 }, 800)).toBe(true)
      expect(isElementOffscreenBelow({ top: 0 }, 800)).toBe(false)
    })

    it('stays hidden when the picker renders within the viewport (the default/common case)', () => {
      const h = createWebviewHarness()
      h.postToWebview(previewMsg)
      expect(h.element('offscreen-toast').style.display).toBe('none')
    })

    it('shows when the picker renders below the viewport', () => {
      const h = createWebviewHarness()
      h.element('insertion-preview-bar').rect = { top: 5000, bottom: 5050, left: 0, right: 0, width: 0, height: 50 }
      h.postToWebview(previewMsg)
      expect(h.element('offscreen-toast').style.display).toBe('block')
    })

    it('hides again once a scroll brings the picker into view', () => {
      const h = createWebviewHarness()
      h.element('insertion-preview-bar').rect = { top: 5000, bottom: 5050, left: 0, right: 0, width: 0, height: 50 }
      h.postToWebview(previewMsg)
      expect(h.element('offscreen-toast').style.display).toBe('block')
      h.element('insertion-preview-bar').rect = { top: 100, bottom: 150, left: 0, right: 0, width: 0, height: 50 }
      h.triggerWindowEvent('scroll')
      expect(h.element('offscreen-toast').style.display).toBe('none')
    })

    it('hides on Cancel, Insert here, and plain submit — never left dangling once the picker itself is gone', () => {
      for (const dismiss of [
        (h: ReturnType<typeof createWebviewHarness>) => h.click('btn-insertion-cancel'),
        (h: ReturnType<typeof createWebviewHarness>) => h.click('btn-insertion-confirm'),
      ]) {
        const h = createWebviewHarness()
        h.element('insertion-preview-bar').rect = { top: 5000, bottom: 5050, left: 0, right: 0, width: 0, height: 50 }
        h.postToWebview(previewMsg)
        expect(h.element('offscreen-toast').style.display).toBe('block')
        dismiss(h)
        expect(h.element('offscreen-toast').style.display).toBe('none')
      }
    })

    it('clicking the toast scrolls the picker into view', () => {
      const h = createWebviewHarness()
      h.element('insertion-preview-bar').rect = { top: 5000, bottom: 5050, left: 0, right: 0, width: 0, height: 50 }
      h.postToWebview(previewMsg)
      let scrolled = false
      h.element('insertion-preview-bar').scrollIntoView = () => { scrolled = true }
      h.click('offscreen-toast')
      expect(scrolled).toBe(true)
    })

    it('uses the panel\'s own accent color (button-background), never the insertion-preview-bar\'s warning-yellow', () => {
      const cssBlock = PANEL_SRC.match(/\.offscreen-toast\{[\s\S]*?\}/)?.[0]
      expect(cssBlock, 'expected a .offscreen-toast CSS rule').toBeTruthy()
      expect(cssBlock).toContain('var(--vscode-button-background)')
      expect(cssBlock).not.toContain('warningBackground')
      expect(cssBlock).not.toContain('warningBorder')
    })

    it('uses down-pointing arrow SYMBOLS, not emoji, flanking the message', () => {
      const match = PANEL_SRC.match(/<div class="offscreen-toast" id="offscreen-toast"[^>]*>([^<]*)<\/div>/)
      expect(match, 'expected the offscreen-toast element in the panel HTML').toBeTruthy()
      const text = match![1]
      expect(text.trim().startsWith('↓')).toBe(true)
      expect(text.trim().endsWith('↓')).toBe(true)
      // eslint-disable-next-line no-control-regex -- deliberately checking for the absence of any codepoint outside the BMP (the emoji block), not matching one
      expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)).toBe(false)
    })
  })

  // DEBRIEF-004 (Jérémie, 2026-07-12, ADR-0025 QST-1): live answer vanished
  // mid-typing, and skip-then-return-to-question failed to restore the
  // draft. Root cause: idx is a bare POSITION in the flattened `questions`
  // array, which sendQuestions() rebuilds from scratch on EVERY push — in
  // this multi-writer repo, any unrelated docs/adr/*.md save anywhere can
  // reorder or resize that array between pushes. Keeping the same idx after
  // such a push can silently repoint it at a different question; the
  // isNewQuestion gate then (correctly, given the wrong premise) wipes the
  // live textarea — that's the vanish, and the same drift explains why
  // "back" after a skip doesn't land on the question that was actually
  // skipped. Fix: re-locate the on-screen question by its stable draftKey
  // before falling back to positional clamping.
  describe('DEBRIEF-004: idx re-anchoring across background "questions" pushes', () => {
    it('captures the on-screen question\'s draftKey before the array is replaced, and relocates by it', () => {
      const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
      const script = match![1]
      expect(script).toContain('const currentKey = questions[idx] ? questions[idx].draftKey : undefined')
      expect(script).toContain('questions.findIndex(q => q.draftKey === currentKey)')
    })

    it('only falls back to positional clamping when the on-screen question cannot be found by key', () => {
      const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
      const script = match![1]
      expect(script).toMatch(/relocated >= 0/)
      expect(script).toMatch(/idx = relocated/)
    })

    it('harness: mid-typing vanish — a background push that reorders the array does not clobber the live-typed answer', () => {
      // Runs the ACTUAL shipped script (Quarry 5's node:vm harness), not a
      // reimplementation. This is the incident shape: user is on the second
      // question in the list; an unrelated docs/adr/*.md save elsewhere
      // (constant in this multi-writer repo) triggers a 'questions' push
      // whose flattened array now lists that same question FIRST (e.g. a
      // new, earlier-sorting ADR/root was indexed in between) — before the
      // fix, idx stayed put and silently pointed at a different question,
      // whose empty draftText wiped the live textarea.
      const Q1 = { id: 'q1', text: 'Q1', adrPath: '/fake/a.md', adrNumber: 1, lineStart: 1, draftKey: 'key-1', fileChecksum: 'c1', totalOccurrences: 1, groupLabel: 'ADR-0001', groupSortKey: '0-0001', sourceKind: 'adr' }
      const Q2 = { id: 'q2', text: 'Q2', adrPath: '/fake/b.md', adrNumber: 2, lineStart: 1, draftKey: 'key-2', fileChecksum: 'c1', totalOccurrences: 1, groupLabel: 'ADR-0002', groupSortKey: '0-0002', sourceKind: 'adr' }
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1, Q2] })
      h.click('btn-skip') // idx now 1 (Q2)
      h.typeAnswer('typed while on Q2')

      // Background push: same two questions, Q2 now sorts first.
      h.postToWebview({ type: 'questions', generation: 1, questions: [Q2, Q1] })

      expect(h.element('ans').value).toBe('typed while on Q2')
    })

    it('harness: skip-then-back restores what was just typed and auto-saved, not stale cached data from the last server push', () => {
      // The third bug this harness caught independently (per 4e6aff5's commit
      // message): Back is purely client-side (idx--; render()) — it never
      // re-fetches from the server. Before the fix, render() read
      // questions[idx].draftText straight out of the array the last
      // 'questions' push provided, which predates whatever the human typed
      // and auto-saved while they were actually on that question. Fixed by
      // mutating q.draftText in place at input time, so the SAME object
      // reference sitting in the questions array already reflects the
      // latest typed text before any server round-trip.
      const Q1 = { id: 'q1', text: 'Q1 text', adrPath: '/fake/0029.md', adrNumber: 29, lineStart: 10, draftKey: 'key-q1', fileChecksum: 'c1', totalOccurrences: 1, groupLabel: 'ADR-0029', groupSortKey: '0-0029', sourceKind: 'adr' }
      const Q2 = { id: 'q2', text: 'Q2 text', adrPath: '/fake/0029.md', adrNumber: 29, lineStart: 20, draftKey: 'key-q2', fileChecksum: 'c1', totalOccurrences: 1, groupLabel: 'ADR-0029', groupSortKey: '0-0029', sourceKind: 'adr' }
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1, Q2] })
      h.typeAnswer('my in-progress answer')

      h.click('btn-skip') // idx -> Q2
      h.click('btn-back') // idx -> Q1, purely client-side, no server round-trip

      expect(h.element('ans').value).toBe('my in-progress answer')
    })
  })

  it('DEBRIEF-004: draft-save debounce captures the typed text at input time, not at timer-fire time', () => {
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    const script = match![1]
    // Regression: previously read $id('ans').value inside the setTimeout
    // callback — a navigation during the 500ms window (a background push
    // repainting the box, or skip/back) would then save whatever the box
    // happened to contain at fire time under the ORIGINAL question's
    // draftKey, potentially a different question's text entirely.
    expect(script).toContain("const val = $id('ans').value")
    expect(script).toContain('draftText: val')
    expect(script).not.toMatch(/draftText:\s*\$id\('ans'\)\.value/)
    // The capture must happen before the debounce timer is armed, not inside it.
    const inputHandlerIdx = script.indexOf("addEventListener('input', () => {\n  if (!questions[idx]) return;")
    const valIdx = script.indexOf("const val = $id('ans').value")
    const timerIdx = script.indexOf('draftSaveTimer = setTimeout')
    expect(inputHandlerIdx).toBeGreaterThan(-1)
    expect(valIdx).toBeGreaterThan(inputHandlerIdx)
    expect(timerIdx).toBeGreaterThan(valIdx)
  })

  // Returning bug (dispatched once before, 2026-07-10 dogfooding batch —
  // "one bug, two reports" — apparently never actually landed a fix; this
  // is its third report). Root cause: the extractor reads an @adr-anchor
  // comment for slug-override purposes but leaves the literal comment text
  // in rawBody/rawBodyPost, and renderMarkdown's esc() turned '<' into
  // '&lt;' before any comment syntax could be recognized as a real HTML
  // comment — so it rendered as visible escaped text instead of vanishing.
  // Harness-based (runs the ACTUAL shipped renderMarkdown, not a
  // reimplementation of the regex) precisely because the prior fix, if any,
  // lacked a test that actually executes the panel's markdown path.
  it('DEBRIEF (returning, 3rd report): a raw <!-- @adr-anchor: ... --> comment never renders as visible text in the panel', () => {
    const Q1 = {
      id: 'q1', text: 'Q1', adrPath: '/fake/a.md', adrNumber: 1, lineStart: 1,
      draftKey: 'key-1', fileChecksum: 'c1', totalOccurrences: 1,
      groupLabel: 'ADR-0001', groupSortKey: '0-0001', sourceKind: 'adr',
      adrContext: '## Human Context\n\n<!-- @adr-anchor: horizontal-scaling-from-day-one -->\n\nSome real context.',
      body: 'Body text.\n\n<!-- @adr-anchor: another-slug -->\n\nMore body.',
      bodyPost: 'Post text <!-- @adr-anchor: inline-comment --> continues.',
    }
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [Q1] })

    for (const id of ['ctx-body', 'body', 'body-post']) {
      const html = h.element(id).innerHTML
      expect(html, `#${id} must not contain the raw comment`).not.toContain('adr-anchor')
      expect(html, `#${id} must not contain escaped comment syntax either`).not.toContain('&lt;!--')
    }
  })

  // Hard-wrap reframe (Lapidary 5, 0450): "the extension must be robust to
  // hard-wrapped input at render time." Screenshot evidence
  // (docs/screenshots/evidence/2026-07-13-hardwrap-question-ui-impact.png):
  // inbox-alchemy's real, hard-wrapped ADR-0021 rendered Option B's
  // continuation lines as bare paragraphs BELOW the bullet list instead of
  // inside Option B's own <li> — a hard-wrapped bullet's lazy-continuation
  // lines "escaping" their construct. Acceptance per that brief: the
  // screenshot's case renders correctly FROM THE WRAPPED SOURCE, no
  // unwrap-adrs preprocessing required.
  //
  // Fixture note: kept inline here (not added to src/test/fixtures/zoo/)
  // deliberately -- that corpus's own recall.test.ts requires a CORPUS
  // ground-truth entry for every file added there (Quarry 5's recall-
  // detection domain, ADR-0031), and this is a rendering concern, not a
  // detection-recall one. This inline specimen (reproducing the
  // screenshot's exact wrapped Option A/B shape) is the permanent,
  // checkable-forever record for THIS consumer.
  it('DEBRIEF (hard-wrap reframe, 0450): a hard-wrapped bullet\'s continuation lines stay inside their <li>, not as sibling paragraphs', () => {
    const Q1 = {
      id: 'q1', text: 'When does wave 2 trigger?', adrPath: '/fake/0021.md', adrNumber: 21, lineStart: 1,
      draftKey: 'key-1', fileChecksum: 'c1', totalOccurrences: 1,
      groupLabel: 'ADR-0021', groupSortKey: '0-0021', sourceKind: 'adr',
      body:
        '- A — Calendar: fixed date.\n' +
        '- B — Milestone: when the pipeline round-trips a real email end-to-end\n' +
        '(intake → match → extract → draft → validation surface), so the MCP server\n' +
        'exposes something true and the Assayer has a working loop to mine.',
    }
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [Q1] })

    const html = h.element('body').innerHTML
    // The continuation text must be INSIDE Option B's <li>...
    expect(html).toMatch(/<li>B — Milestone:[^<]*working loop to mine\.<\/li>/)
    // ...and must NOT appear as sibling paragraph text after the </ul>.
    const afterList = html.slice(html.indexOf('</ul>'))
    expect(afterList).not.toContain('validation surface')
    expect(afterList).not.toContain('working loop to mine')
  })

  // Regression tests (fixes real founder-reported bug, batch-renderer
  // ADR-0003, three Reports on the same question). Bug: renderMarkdown()'s
  // list-continuation logic only understood FLAT lazy-continuation prose
  // (the 0450 hard-wrap fix above) — a fenced code block or a sub-bullet
  // list indented under a numbered item had no home, so its
  // \x00CODEn\x00 placeholder token hit looksLikeNewBlock and broke the
  // list mid-way (splitting one numbered list into several, each
  // restarting at "1."), and a nested sub-bullet list got silently
  // space-joined into one run-on line inside its <li>. Fixed by giving
  // list items a real nested-block region: an INDENTED (or blank-then-
  // indented) continuation line is dedented and recursively rendered via
  // the same block renderer, instead of only ever flat-joined.
  describe('Regression tests: nested block content inside a list item (batch-renderer ADR-0003)', () => {
    const FIXTURE = readFileSync(
      resolve(__dirname, 'fixtures/webview-render/2026-07-31-batch-renderer-adr0003-nested-fence-list-ans.md'),
      'utf8',
    )
    // The body a real q.body would carry: everything between the intro
    // bold line and the Recommendation marker — the exact span that
    // garbled in the panel per the three founder Reports.
    const body = FIXTURE.slice(
      FIXTURE.indexOf('**Understanding your tree vision:**'),
      FIXTURE.indexOf('**Recommendation**:'),
    ).trim()

    function render(): string {
      const h = createWebviewHarness()
      const renderMarkdown = h.sandbox.renderMarkdown as (md: string) => string
      return renderMarkdown(body)
    }

    // Item boundaries via indexOf/slice rather than regex balancing — each
    // item nests its own <li>...</li> (the sub-bullet lists in items 3/4),
    // so a naive non-greedy </li> match closes on the FIRST (nested) tag,
    // not the item's own.
    function itemSlice(html: string, marker: string, nextMarker: string | undefined): string {
      const start = html.indexOf(marker)
      expect(start, `expected to find "${marker}" in the rendered output`).toBeGreaterThanOrEqual(0)
      const end = nextMarker ? html.indexOf(nextMarker) : html.indexOf('</ol>', start)
      return html.slice(start, end < 0 ? undefined : end)
    }

    it('no \\x00CODEn\\x00 placeholder token leaks into the rendered output', () => {
      const html = render()
      expect(html).not.toMatch(/CODE\d/)
    })

    it('all four numbered questions render as ONE list, not split into several restarting at "1."', () => {
      const html = render()
      const questionsList = (html.match(/<ol>[\s\S]*?<\/ol>/g) ?? []).find(ol => ol.includes('Path formatting'))
      expect(questionsList, 'expected one <ol> containing all four questions').toBeTruthy()
      for (const marker of ['Path formatting', 'Text at multiple levels', 'Numbering/IDs', 'Edge cases']) {
        expect(questionsList).toContain(marker)
      }
    })

    it('item 1\'s nested fenced code block renders as a real <pre><code> inside its own <li>, not a sibling block', () => {
      const html = render()
      const item1 = itemSlice(html, '<strong>Path formatting</strong>', '<strong>Text at multiple levels</strong>')
      expect(item1).toContain('<pre><code>')
      expect(item1).toContain('Option A: Nested folders matching tree')
      expect(item1).toContain('</code></pre></li>')
    })

    it('item 2\'s nested code block AND its trailing paragraph both stay inside item 2\'s <li>', () => {
      const html = render()
      const item2 = itemSlice(html, '<strong>Text at multiple levels</strong>', '<strong>Numbering/IDs</strong>')
      expect(item2).toContain('<pre><code>')
      expect(item2).toContain('# Main Title')
      expect(item2).toContain('<p>Should both become prompts? Just the leaf nodes?</p></li>')
    })

    it('item 3\'s nested sub-bullets render as a real nested <ul>, not flattened into one run-on line', () => {
      const html = render()
      const item3 = itemSlice(html, '<strong>Numbering/IDs</strong>', '<strong>Edge cases:</strong>')
      expect(item3).toContain('<ul>')
      expect(item3).toMatch(/<li>Number prompts sequentially[^<]*<\/li>/)
      expect(item3).toMatch(/<li>Use tree path as ID[^<]*<\/li>/)
      expect(item3).toMatch(/<li>No numbering, just use titles\?<\/li>/)
    })

    it('item 4\'s nested sub-bullets likewise render as a real nested <ul>', () => {
      const html = render()
      const item4 = itemSlice(html, '<strong>Edge cases:</strong>', undefined)
      expect(item4).toContain('<ul>')
      expect(item4).toMatch(/<li>File with no headers at all[^<]*<\/li>/)
      expect(item4).toMatch(/<li>Empty sections[^<]*<\/li>/)
      expect(item4).toMatch(/<li>Multiple paragraphs under one header[^<]*<\/li>/)
    })
  })

  // Regression tests (fixes real founder-reported bug, Gleaner's brief
  // 2026-08-05-0414: "The part 'First, the census' doesn't get bolded. It
  // looks like the first character was truncated..."). Bug: renderInline()'s
  // bold pass (`/\*\*([^*]+)\*\*/g`) excluded ANY asterisk from its
  // captured span, so a **bold** run containing a nested *italic* word
  // never matched bold at all — the regex hit the internal '*' and the
  // whole span fell through unprocessed to the italic pass, which then
  // greedily mispaired asterisks across what was meant to be one bold
  // span. Fixed by making the bold pass non-greedy (`[\s\S]*?` instead of
  // `[^*]+`) so it finds the nearest closing '**' and correctly spans one
  // level of nested emphasis in either direction; the italic pass right
  // after still finds and wraps the nested span since the bold pass leaves
  // captured content unprocessed.
  describe('Regression tests: a **bold** span containing a nested *italic* word renders correctly', () => {
    function render(md: string): string {
      const h = createWebviewHarness()
      const renderMarkdown = h.sandbox.renderMarkdown as (md: string) => string
      return renderMarkdown(md)
    }

    it('the exact founder specimen: bold survives, the nested italic word renders inside it', () => {
      const html = render(
        '**First, the census answer to the founding question — most seeds are wrenches because most seeds are *supposed* to be.** The rest of the sentence.',
      )
      expect(html).toBe(
        '<p><strong>First, the census answer to the founding question — most seeds are wrenches because most seeds are <em>supposed</em> to be.</strong> The rest of the sentence.</p>',
      )
    })

    it('the reverse nesting — italic containing a nested bold word — also renders correctly', () => {
      const html = render('*italic with **bold** inside* rest.')
      expect(html).toBe('<p><em>italic with <strong>bold</strong> inside</em> rest.</p>')
    })

    it('the underscore variant (__bold__ containing _italic_) gets the same fix', () => {
      const html = render('__bold with _italic_ inside__ rest.')
      expect(html).toBe('<p><strong>bold with <em>italic</em> inside</strong> rest.</p>')
    })

    it('two separate, non-nested bold spans on one line still render independently, not merged into one', () => {
      const html = render('**a** middle **b**')
      expect(html).toBe('<p><strong>a</strong> middle <strong>b</strong></p>')
    })
  })

  // Regression tests (fixes real founder-reported bug, Gleaner's brief
  // 2026-08-05-2220: "It seems quoting > is not supported in our
  // interface, it's not parsed well?"). Bug: the blockquote branch handled
  // ONE '> text' line at a time, so a multi-paragraph quote (paragraphs
  // separated by the standard bare-'>' idiom) fragmented into N separate
  // <blockquote> boxes; a bare '>' continuation line (no trailing space)
  // didn't even match '> ' at all and fell through to plain-paragraph
  // handling, rendering as a literal stray "<p>&gt;</p>". Fixed by
  // consuming the whole consecutive run of '> '/bare-'>' lines as one
  // block, dequoting (bare '>' becomes a blank paragraph separator), and
  // recursing into renderBlocks so internal paragraphs render inside ONE
  // blockquote instead of one box per source line.
  describe('Regression tests: a multi-paragraph blockquote renders as ONE box, not fragmented', () => {
    function render(md: string): string {
      const h = createWebviewHarness()
      const renderMarkdown = h.sandbox.renderMarkdown as (md: string) => string
      return renderMarkdown(md)
    }

    it('the exact founder specimen shape: 3 paragraphs, bare "&gt;" separators, ONE <blockquote>', () => {
      const html = render('> First paragraph of quote.\n>\n> Second paragraph of quote.\n>\n> Third paragraph.')
      expect((html.match(/<blockquote>/g) ?? []).length).toBe(1)
      expect(html).not.toContain('&gt;')
      expect(html).toBe(
        '<blockquote><p>First paragraph of quote.</p>\n<p>Second paragraph of quote.</p>\n<p>Third paragraph.</p></blockquote>',
      )
    })

    it('a single-line blockquote still renders correctly (no regression on the common case)', () => {
      const html = render('> A single-line quote.')
      expect(html).toBe('<blockquote><p>A single-line quote.</p></blockquote>')
    })

    it('a blockquote followed by a blank line and a normal paragraph: only the quote lines join, the paragraph stays outside', () => {
      const html = render('> Quoted text.\n\nNormal paragraph after.')
      expect(html).toBe('<blockquote><p>Quoted text.</p></blockquote>\n<p>Normal paragraph after.</p>')
    })
  })

  describe('DEBRIEF-004 residual (Quarry 5, post-4e6aff5 state-machine pass): a transient EMPTY "questions" push still trips isNewQuestion for the SAME unchanged question', () => {
    // 4e6aff5 fixed the headline symptom (positional idx drift losing text)
    // by relocating the on-screen question by draftKey, and separately fixed
    // the local-draftText-cache staleness (this harness's own earlier "smoke
    // 2" catch). Neither touches render()'s OTHER path to the same gate:
    // `if (questions.length === 0) { ...; lastShownDraftKey = undefined;
    // return; }`. A single-file read racing a concurrent writer mid-save (or
    // any reindex that transiently sees zero open questions before settling)
    // is exactly the kind of glitch this multi-writer repo produces
    // routinely — DEBRIEF-003's own lesson #2 ("a busy multi-writer repo is
    // a stress test the single-user case never exercises") applies here
    // unchanged. The two live fixes happen to prevent TEXT loss in this
    // scenario (q.draftText was already kept in sync locally, so the
    // spurious "restore" repopulates correctly) — but isNewQuestion still
    // misfires, so the human-visible symptoms below are real and unfixed.
    const Q1 = { id: 'q1', text: 'Q1 text', adrPath: '/fake/0029.md', adrNumber: 29, lineStart: 10, draftKey: 'key-q1', fileChecksum: 'c1', totalOccurrences: 1, groupLabel: 'ADR-0029', groupSortKey: 'ns::0-0029', rootNamespace: 'ns', sourceKind: 'adr' }

    it('the card flips to the empty-state screen mid-typing, then back — a visible flicker even though the text itself survives', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1] })
      h.typeAnswer('my in-progress answer')

      h.postToWebview({ type: 'questions', generation: 1, questions: [] })
      expect(h.element('card').style.display).toBe('none')
      expect(h.element('empty').style.display).toBe('flex')

      h.postToWebview({ type: 'questions', generation: 2, questions: [Q1] })
      expect(h.element('ans').value).toBe('my in-progress answer') // survives, thanks to the local-cache fix
      expect(h.element('card').style.display).toBe('block') // but the human watched it vanish and reappear
    })

    it('focus is stolen again (the exact DEBRIEF-003 symptom) on a transient-empty-then-return cycle, even though nothing the human did changed', () => {
      vi.useFakeTimers()
      try {
        const h = createWebviewHarness()
        h.postToWebview({ type: 'questions', generation: 0, questions: [Q1] })
        h.typeAnswer('my in-progress answer')
        vi.runAllTimers() // settle the initial (legitimate) focus() from the first real navigation

        let focusCallsAfterInitialLoad = 0
        const originalFocus = h.element('ans').focus
        h.element('ans').focus = () => { focusCallsAfterInitialLoad++; originalFocus() }

        h.postToWebview({ type: 'questions', generation: 1, questions: [] })
        h.postToWebview({ type: 'questions', generation: 2, questions: [Q1] })
        vi.runAllTimers()

        expect(focusCallsAfterInitialLoad).toBe(0) // FAILS today — isNewQuestion misfires, focus() is scheduled again
      } finally {
        vi.useRealTimers()
      }
    })
  })
})

// ---------------------------------------------------------------------------
// ADR-0034 (QuestionTours): the tour-mode skin — header, theme, broken-refs
// disclosure, exit affordance, and the per-question authored-claim block.
// These run the actual shipped script via the harness, not a description
// of intended behavior.
// ---------------------------------------------------------------------------

describe('Tour-mode skin (ADR-0034)', () => {
  const Q1 = { id: 'q1', text: 'Q1', adrPath: '/fake/a.md', adrNumber: 1, lineStart: 1, draftKey: 'key-1', fileChecksum: 'c1', totalOccurrences: 1, groupLabel: 'ADR-0001', groupSortKey: '0-0001', sourceKind: 'adr' }
  const TOUR = {
    slug: '2026-07-24-morning-brief', title: "Morning brief", author: { name: 'Lamplighter', role: 'postman' },
    mintedAt: '2026-07-24T13:18:05Z', theme: { background: '#556B2F', foreground: '#F5F5F0' },
    retired: false, done: false, brokenRefs: [],
  }

  // ADR-0034 item 2 — Gleaner's SEVERE, and the founder's own words: "is this
  // citing the question from Parallax's seed, or creating a new question?
  // There's a lot of content, recommendations missing... The QuestionTour have
  // never been usable." Root cause was two-part and BOTH parts are covered
  // here: the Recommendation area rendered literally nothing when a document
  // had no recommendation (so a relocated one read as "nothing here"), and the
  // authored claim was middot-joined onto one 11px line beside that emptiness.
  describe('Hollow stops: a stated absence, and a claim that looks like a claim', () => {
    const HOLLOW = { ...Q1, tourEntry: { comment: 'full ORJC lives in the first-contact audit seed', answerPath: 'one of A/B/C', disposition: 'decide', mustRespond: true } }

    it('names the absent recommendation instead of rendering nothing at all', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [HOLLOW], tour: TOUR })
      const wrap = h.element('rec-wrap')
      expect(wrap.innerHTML).toContain('No recommendation in this document')
      // and it points at the claim, which is where the real guidance sits
      expect(wrap.innerHTML).toContain('top of this stop')
    })

    it('says only that it is absent when there is no authored guidance to point at', () => {
      const h = createWebviewHarness()
      const bare = { ...Q1, tourEntry: { mustRespond: true } }
      h.postToWebview({ type: 'questions', generation: 0, questions: [bare], tour: TOUR })
      expect(h.element('rec-wrap').innerHTML).toContain('No recommendation in this document')
      expect(h.element('rec-wrap').innerHTML).not.toContain('top of this stop')
    })

    // The ordinary walk must not gain a line on every unanswered question in a
    // corpus — the claim/substrate gap is what makes it worth saying, and there
    // is no claim outside a tour.
    it('stays silent outside tour mode, where an absent recommendation is unremarkable', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1], tour: null })
      expect(h.element('rec-wrap').innerHTML).toBe('')
    })

    // Doctrine 1: the Recommendation slot is a substrate FACT; comment and
    // answer_path are authored CLAIMS. The originally-proposed fix put the
    // claim into this slot; that would style a tour author's opinion as the
    // document's own recommendation. The absence is named; the claim stays put.
    it('does NOT move the authored claim into the recommendation slot', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [HOLLOW], tour: TOUR })
      expect(h.element('rec-wrap').innerHTML).not.toContain('full ORJC')
      expect(h.element('tour-entry-info').innerHTML).toContain('full ORJC')
    })

    it('gives the claim three separate elements rather than one middot-joined line', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [HOLLOW], tour: TOUR })
      const html = h.element('tour-entry-info').innerHTML
      expect(html).toContain('claim-meta')
      expect(html).toContain('claim-shape')
      expect(html).toContain('claim-comment')
      expect(html).toContain('one of A/B/C')
    })

    // A review stop is already answered — nothing is being asked for, so the
    // absence of a recommendation is not a gap worth flagging there.
    it('stays silent on a review stop', () => {
      const h = createWebviewHarness()
      const answered = { ...HOLLOW, isReviewStop: true, finalAnswerText: 'settled' }
      h.postToWebview({ type: 'questions', generation: 0, questions: [answered], tour: TOUR })
      expect(h.element('rec-wrap').innerHTML).toBe('')
    })
  })

  it('the tour header is hidden outside tour mode (tour: null)', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [Q1], tour: null })
    expect(h.element('tour-header').style.display).toBe('none')
  })

  it('shows title, provenance, and applies the tour theme to the header chrome only', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [Q1], tour: TOUR })
    expect(h.element('tour-header').style.display).toBe('flex')
    expect(h.element('tour-header-title').textContent).toBe('Morning brief')
    expect(h.element('tour-header-meta').textContent).toContain('Lamplighter (postman)')
    expect(h.element('tour-header').style.background).toBe('#556B2F')
    expect(h.element('tour-header').style.color).toBe('#F5F5F0')
  })

  // Regression — Gleaner's TWO specimens (2026-10-09 dechrome-residue,
  // 2026-10-10 map-details with must_respond: true, so NOT the vacuous-
  // doneness class v0.7.122/123 closed): the founder clicks a tour-entry on a
  // just-committed tour and the panel says "All caught up". buildTourQuestions
  // did `if (!found) return []`, so a tour the index cannot see rendered as the
  // ordinary walk with nothing left — the silent lie this program exists to
  // abolish, in the one path never audited, and it told him his work was DONE.
  describe('Regression tests: an empty TOUR walk is a failure, never "All caught up"', () => {
    it('names a tour the index cannot find, and offers the one action that helps', () => {
      const h = createWebviewHarness()
      h.postToWebview({
        type: 'questions', generation: 0, questions: [],
        tour: { ...TOUR, emptyReason: 'tour-not-found', slug: 'just-committed' },
      })
      expect(h.element('empty-title').textContent).toContain('could not be found')
      expect(h.element('empty-title').textContent).not.toContain('All caught up')
      expect(h.element('empty-detail').textContent).toContain('just-committed')
      expect(h.element('empty-detail').textContent).toContain('reload the window')
    })

    it('distinguishes found-but-nothing-walkable from not-found, so the next report is decisive', () => {
      const h = createWebviewHarness()
      h.postToWebview({
        type: 'questions', generation: 0, questions: [],
        tour: { ...TOUR, emptyReason: 'no-walkable' },
      })
      expect(h.element('empty-title').textContent).toContain('no walkable stops')
      expect(h.element('empty-detail').textContent).toContain('tour-walk')
    })

    // The ordinary walk must keep its genuine achievement message — this fix
    // must not turn "you are done" into an error for everyone else.
    it('still says "All caught up" on the ordinary walk with nothing open', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [], tour: null })
      expect(h.element('empty-title').textContent).toBe('All caught up')
      expect(h.element('empty-icon').textContent).toBe('✓')
    })
  })

  it('a done tour is labeled [done] in the title, a retired one [retired] instead', () => {
    const h = createWebviewHarness()
    // askedSomething: a tour that genuinely asked and finished (2026-10-10).
    h.postToWebview({ type: 'questions', generation: 0, questions: [Q1], tour: { ...TOUR, done: true, askedSomething: true } })
    expect(h.element('tour-header-title').textContent).toContain('[done]')

    h.postToWebview({ type: 'questions', generation: 1, questions: [Q1], tour: { ...TOUR, retired: true, done: true, askedSomething: true } })
    expect(h.element('tour-header-title').textContent).toContain('[retired]')
    expect(h.element('tour-header-title').textContent).not.toContain('[done]')
  })

  // Regression (Concertmaster's 2026-10-09 trial + the founder's same-evening
  // Report): a tour with no must_respond stop is VACUOUSLY done under
  // Commodore's It-5 ruling. Labelling that [done] tells the human work was
  // finished when none was ever asked — the same lie staleAnswered's old
  // "already answered" message told, in the same week. The label must name the
  // real state, which also tells the minter their tour asks for nothing.
  it('a vacuously-done tour (no must_respond stop) is NOT labeled [done]', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [Q1], tour: { ...TOUR, done: true, askedSomething: false } })
    const label = h.element('tour-header-title').textContent
    expect(label).not.toContain('[done]')
    expect(label).toContain('[nothing required]')
  })

  it('doctrine 3: broken references render as a visible list, not silently dropped', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [Q1], tour: { ...TOUR, brokenRefs: ['adr:9999#nope', 'seed:missing#x'] } })
    expect(h.element('tour-header-broken').style.display).toBe('block')
    expect(h.element('tour-header-broken').textContent).toContain('2 entries')
    expect(h.element('tour-header-broken').textContent).toContain('adr:9999#nope')
    expect(h.element('tour-header-broken').textContent).toContain('seed:missing#x')
  })

  it('no broken refs: the disclosure stays hidden', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [Q1], tour: TOUR })
    expect(h.element('tour-header-broken').style.display).toBe('none')
  })

  it('"Exit tour" posts exitTour and nothing else', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [Q1], tour: TOUR })
    h.click('exit-tour')
    expect(h.sentMessages).toContainEqual({ type: 'exitTour' })
  })

  it('a walked question carrying tourEntry shows the authored claim beside the live question', () => {
    const h = createWebviewHarness()
    const withEntry = { ...Q1, tourEntry: { comment: 'crew lean is A-now-C-next', disposition: 'decide', answerPath: 'one word: B yes/no', mustRespond: true } }
    h.postToWebview({ type: 'questions', generation: 0, questions: [withEntry], tour: TOUR })
    expect(h.element('tour-entry-info').style.display).toBe('block')
    const html = h.element('tour-entry-info').innerHTML
    expect(html).toContain('decide')
    expect(html).toContain('crew lean is A-now-C-next')
    expect(html).toContain('one word: B yes/no')
    expect(html).not.toContain('optional for this walk')
  })

  it('an optional (must_respond: false) entry is labeled as such', () => {
    const h = createWebviewHarness()
    const withEntry = { ...Q1, tourEntry: { mustRespond: false } }
    h.postToWebview({ type: 'questions', generation: 0, questions: [withEntry], tour: TOUR })
    expect(h.element('tour-entry-info').innerHTML).toContain('optional for this walk')
  })

  it('an ordinary (non-tour) question never shows the authored-claim block', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [Q1], tour: null })
    expect(h.element('tour-entry-info').style.display).toBe('none')
  })

  // Layout surgery (Lapidary's spec, 2026-07-30 inbox 2020, "fine surgery
  // — build EXACTLY this"): "Draft saved" used to share the button row
  // with Report, shifting the whole row on every autosave — Jérémie's own
  // words, "IT'S SUPER DISTRACTING." The paradigm: controls never share a
  // line with transients; transients get reserved, dedicated space.
  describe('Layout surgery: controls never share a line with transients (2026-07-30 inbox 2020)', () => {
    it('"Draft saved" is structurally in the hint row (the expand-field link\'s vacated slot), never in the button row', () => {
      const rowBlock = PANEL_SRC.match(/<div class="row">[\s\S]*?<\/div>/)![0]
      const hintBlock = PANEL_SRC.match(/<div class="hint" id="answer-hint">[\s\S]*?<\/div>/)![0]
      expect(rowBlock).not.toContain('id="draft-flash"')
      expect(hintBlock).toContain('id="draft-flash"')
    })

    it('the expand-field link has its own row, above the textarea — one home regardless of the authorship row', () => {
      const expandRowIdx = PANEL_SRC.indexOf('id="expand-row"')
      const authorRowIdx = PANEL_SRC.indexOf('id="author-row"')
      const textareaIdx = PANEL_SRC.indexOf('id="ans"')
      expect(authorRowIdx).toBeGreaterThan(-1)
      expect(expandRowIdx).toBeGreaterThan(authorRowIdx) // document order: authorship row, then link row
      expect(textareaIdx).toBeGreaterThan(expandRowIdx) // then the textarea
      const hintBlock = PANEL_SRC.match(/<div class="hint" id="answer-hint">[\s\S]*?<\/div>/)![0]
      expect(hintBlock).not.toContain('id="expand-field"')
    })

    it('toggling the draft-saved flash never touches the button row\'s own children', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1] })
      expect(h.element('btn-report').style.display).toBeDefined()
      const before = { ans: h.element('btn-ans').style.display, back: h.element('btn-back').style.display, skip: h.element('btn-skip').style.display }
      h.element('draft-flash').style.display = 'inline-flex' // simulates the autosave flash firing
      expect(h.element('btn-ans').style.display).toBe(before.ans)
      expect(h.element('btn-back').style.display).toBe(before.back)
      expect(h.element('btn-skip').style.display).toBe(before.skip)
    })

    it('adrManager.showAuthorshipField: capability kept, chrome gone by default', () => {
      const pkg = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')
      const match = pkg.match(/"adrManager\.showAuthorshipField":\s*\{[^}]*\}/)
      expect(match).toBeTruthy()
      expect(match![0]).toContain('"default": false')
      expect(match![0]).toContain('"scope": "resource"')
    })
  })

  // ADR-0036 ("Unresolved: Returning the Ball", ratified 2026-07-29): the
  // panel gesture — "Respond (unresolved)" writes the same ANS layer but
  // sets Status: unresolved instead of answered, so the ball moves to the
  // model's court instead of the question closing.
  describe('ADR-0036: "Respond (unresolved)" panel gesture', () => {
    it('clicking Respond (unresolved) posts targetStatus: unresolved, the plain Answer button does not', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1] })
      h.typeAnswer('a partial answer')
      h.click('btn-respond-unresolved')
      const msg = h.sentMessages.find(m => m.type === 'answer')
      expect(msg?.targetStatus).toBe('unresolved')
      expect(msg?.answerText).toBe('a partial answer')
    })

    it('the plain Answer button omits targetStatus entirely (the ordinary answered gesture, unchanged)', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1] })
      h.typeAnswer('a full answer')
      h.click('btn-ans')
      const msg = h.sentMessages.find(m => m.type === 'answer')
      expect(msg?.targetStatus).toBeUndefined()
    })

    it('the button is hidden on a review stop, alongside the rest of the answering machinery', () => {
      const h = createWebviewHarness()
      const answered = { ...Q1, isReviewStop: true, finalAnswerText: 'x' }
      h.postToWebview({ type: 'questions', generation: 0, questions: [answered], tour: TOUR })
      expect(h.element('btn-respond-unresolved').style.display).toBe('none')
    })

    it("Cmd+Shift+Enter is wired to submit(false, 'unresolved'), checked before the plain Cmd+Enter branch", () => {
      const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
      const script = match![1]
      expect(script).toMatch(/e\.key === 'Enter' && e\.shiftKey\) \{ e\.preventDefault\(\); submit\(false, 'unresolved'\)/)
    })

    it('the hint line explains the unresolved gesture', () => {
      expect(PANEL_SRC).toContain('request follow-up and return the partial answer to the model for consideration')
    })

    // Label rename (Jérémie via Gleaner's sweep, 2026-07-31): "respond isn't
    // clear... it doesn't differentiate itself from answer... maybe put
    // something like request follow-up". Mechanism (id/class/targetStatus)
    // is unchanged — covered by the tests above — this only pins the
    // visible copy.
    it('the visible button label reads "Request Follow-up →", not "Respond (unresolved)"', () => {
      expect(PANEL_SRC).toContain('>Request Follow-up →</button>')
      expect(PANEL_SRC).not.toContain('>Respond (unresolved)</button>')
    })
  })

  // ADR-0034 doctrine 9 (Riddle's ruling, 2026-07-28): a resolved tour
  // entry is a review stop, never silence — buildTourQuestions no longer
  // skips answered entries, and the panel renders the live answer
  // read-only in place of the answering machinery.
  describe('Doctrine 9: resolved entries are review stops', () => {
    const answered = { ...Q1, id: 'q-answered', draftKey: 'key-answered', isReviewStop: true, finalAnswerText: 'We picked option B.' }

    it('a review stop shows the live answer read-only and hides the answering machinery', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [answered], tour: TOUR })
      expect(h.element('review-stop-block').style.display).toBe('block')
      // Rendered as markdown (Facet's catch, 2026-07-28 inbox 2230), not
      // plain .textContent — a real multi-line answer needs paragraph/list
      // structure, not one whitespace-collapsed blob.
      expect(h.element('review-stop-answer').innerHTML).toContain('We picked option B.')
      expect(h.element('author-row').style.display).toBe('none')
      expect(h.element('ans').style.display).toBe('none')
      expect(h.element('answer-hint').style.display).toBe('none')
      expect(h.element('btn-ans').style.display).toBe('none')
    })

    // Regression (Facet, 2026-07-28 inbox 2230, Jérémie: "it's a bit
    // performative to read the answer"): plain .textContent into a div with
    // no white-space handling collapsed a multi-paragraph answer into one
    // dense, space-joined blob. Now rendered as markdown, same as every
    // other prose surface in this dialog (why/body/body-post/
    // recommendations) — each paragraph gets its own <p>.
    it('a multi-paragraph review-stop answer keeps its paragraph structure, not one collapsed blob', () => {
      const h = createWebviewHarness()
      const multiPara = { ...answered, finalAnswerText: 'First paragraph.\n\nSecond paragraph.' }
      h.postToWebview({ type: 'questions', generation: 0, questions: [multiPara], tour: TOUR })
      const html = h.element('review-stop-answer').innerHTML
      expect(html).toContain('<p>First paragraph.</p>')
      expect(html).toContain('<p>Second paragraph.</p>')
    })

    it('an empty/missing answer text shows a placeholder, never a blank review stop', () => {
      const h = createWebviewHarness()
      const noText = { ...answered, finalAnswerText: undefined }
      h.postToWebview({ type: 'questions', generation: 0, questions: [noText], tour: TOUR })
      expect(h.element('review-stop-answer').innerHTML).toContain('(no answer text on file)')
    })

    it('a still-open entry shows the answering machinery (not the authorship row, off by default), not the review stop', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1], tour: TOUR })
      expect(h.element('review-stop-block').style.display).toBe('none')
      // Layout surgery (2026-07-30 inbox 2020): authorship row is chrome
      // gone by default — capability kept (author name still prefilled/sent),
      // just not shown unless adrManager.showAuthorshipField is on.
      expect(h.element('author-row').style.display).toBe('none')
      expect(h.element('expand-row').style.display).toBe('')
      expect(h.element('ans').style.display).toBe('')
      expect(h.element('answer-hint').style.display).toBe('')
      expect(h.element('btn-ans').style.display).toBe('')
    })

    it('the authorship row shows when adrManager.showAuthorshipField is on', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1], tour: TOUR, showAuthorshipField: true })
      expect(h.element('author-row').style.display).toBe('')
    })

    it('the counter shows both truths in tour mode: total stops walked and how many still await an answer', () => {
      const h = createWebviewHarness()
      const open2 = { ...Q1, id: 'q2', draftKey: 'key-2' }
      h.postToWebview({ type: 'questions', generation: 0, questions: [answered, Q1, open2], tour: TOUR })
      expect(h.element('counter').textContent).toBe('Stop 1 of 3 · 2 awaiting you')
    })

    it('outside tour mode the counter keeps its plain "Question N of M" form', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1], tour: null })
      expect(h.element('counter').textContent).toBe('Question 1 of 1')
    })

    it('Skip still walks past a review stop into the next entry', () => {
      const h = createWebviewHarness()
      const open2 = { ...Q1, id: 'q2', draftKey: 'key-2' }
      h.postToWebview({ type: 'questions', generation: 0, questions: [answered, open2], tour: TOUR })
      expect(h.element('counter').textContent).toContain('Stop 1 of 2')
      h.click('btn-skip')
      expect(h.element('counter').textContent).toContain('Stop 2 of 2')
      expect(h.element('review-stop-block').style.display).toBe('none')
    })

    it('a review stop never shows a draft-restored banner', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [answered], tour: TOUR })
      expect(h.element('draft-restored').style.display).toBe('none')
    })

    // Regression (Facet, 2026-07-28 inbox 2253, Jérémie's own words): "Skip"
    // reads as dishonest on a question you've just answered or landed on
    // already-answered — you're not skipping it, you've already answered it.
    it('the forward button reads "Next" on a review stop, "Skip" on a still-open question', () => {
      const h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [answered], tour: TOUR })
      expect(h.element('btn-skip').textContent).toBe('Next')

      h.postToWebview({ type: 'questions', generation: 1, questions: [Q1], tour: TOUR })
      expect(h.element('btn-skip').textContent).toBe('Skip')
    })

    // Regression (Facet, 2026-07-28 inbox 2253): doctrine 9 keeps every tour
    // entry (answered or not), so the array never shrinks after answering —
    // the ordinary walk's implicit "auto-advance" (really just idx sitting
    // still while the array shrinks underneath it) silently stopped
    // happening as a side effect. Restored explicitly, tour-mode only — the
    // ordinary (non-tour) walk's own untouched mechanism is covered by the
    // "Regression fix (2026-03-12): do NOT advance idx" tests elsewhere.
    it('answering in tour mode advances to the next entry, without waiting for a background "questions" push', () => {
      const h = createWebviewHarness()
      const open2 = { ...Q1, id: 'q2', draftKey: 'key-2' }
      const open3 = { ...Q1, id: 'q3', draftKey: 'key-3' }
      h.postToWebview({ type: 'questions', generation: 0, questions: [open2, open3], tour: TOUR })
      expect(h.element('counter').textContent).toContain('Stop 1 of 2')

      h.postToWebview({ type: 'answered', questionId: 'q2' })
      expect(h.element('counter').textContent).toContain('Stop 2 of 2')
    })

    it('answering the LAST entry in tour mode wraps back to the first, same convention as Skip', () => {
      const h = createWebviewHarness()
      const open2 = { ...Q1, id: 'q2', draftKey: 'key-2' }
      h.postToWebview({ type: 'questions', generation: 0, questions: [answered, open2], tour: TOUR })
      h.click('btn-skip') // move onto the last entry (open2)
      expect(h.element('counter').textContent).toContain('Stop 2 of 2')

      h.postToWebview({ type: 'answered', questionId: 'q2' })
      expect(h.element('counter').textContent).toContain('Stop 1 of 2')
    })

    it('answering outside tour mode does NOT advance idx here — that stays the "questions" push\'s job (ADR-0010)', () => {
      const h = createWebviewHarness()
      const open2 = { ...Q1, id: 'q2', draftKey: 'key-2' }
      h.postToWebview({ type: 'questions', generation: 0, questions: [Q1, open2], tour: null })
      expect(h.element('counter').textContent).toBe('Question 1 of 2')

      h.postToWebview({ type: 'answered', questionId: 'q1' })
      expect(h.element('counter').textContent).toBe('Question 1 of 2')
    })
  })

  // Regression tests (Facet's live click-through report, 2026-07-26 inbox
  // 0349): DEBRIEF-004's relocate-or-clamp idx logic assumed pool
  // CONTINUITY (the same set, possibly reshuffled) — tour mode breaks that
  // assumption by swapping to a wholesale DISJOINT pool. A stale idx that
  // numerically still fit the new (often much smaller) array was silently
  // left alone instead of reset, landing on "9 of 9" instead of "1 of 9".
  describe('Regression tests: idx resets when the POOL identity changes (tour started/stopped/switched)', () => {
    function makePool(prefix: string, count: number, adrNumber: number) {
      return Array.from({ length: count }, (_, i) => ({
        id: prefix + i, text: prefix + i, adrPath: '/fake/' + prefix + '.md', adrNumber,
        lineStart: 1, draftKey: prefix + '-key-' + i, fileChecksum: 'c-' + prefix,
        totalOccurrences: 1, groupLabel: 'ADR-000' + adrNumber, groupSortKey: '0-000' + adrNumber, sourceKind: 'adr',
      }))
    }
    const TOUR = { slug: 'x', title: 'X', author: { name: 'A' }, mintedAt: '', retired: false, done: false, brokenRefs: [] }

    // idx is a script-internal `let` binding, not a property of the vm
    // context object — h.sandbox.idx can't read or write it. Navigate via
    // the real btn-skip click (advances idx client-side, same as a human
    // skipping) and verify via the rendered #counter text instead.
    function skip(h: ReturnType<typeof createWebviewHarness>, times: number) {
      for (let i = 0; i < times; i++) h.click('btn-skip')
    }

    it('entering a tour resets idx to 0 even though the stale idx (8) numerically still fits the tour\'s 9-entry array — the exact "9 of 9" bug', () => {
      const h = createWebviewHarness()
      const bigPool = makePool('full', 28, 32) // simulates ADR-0032's raw 28-question register
      h.postToWebview({ type: 'questions', generation: 0, questions: bigPool, tour: null })
      skip(h, 8) // "question 9 of 28" — the position Jérémie was browsing before entering the tour
      expect(h.element('counter').textContent).toBe('Question 9 of 28')

      const tourPool = makePool('tour', 9, 32) // disjoint draftKeys — none relocate
      h.postToWebview({ type: 'questions', generation: 1, questions: tourPool, tour: TOUR })

      expect(h.element('counter').textContent).toBe('Stop 1 of 9 · 9 awaiting you')
    })

    it('exiting a tour back to the full walk also resets idx, not just entering one', () => {
      const h = createWebviewHarness()
      const tourPool = makePool('tour', 3, 32)
      h.postToWebview({ type: 'questions', generation: 0, questions: tourPool, tour: TOUR })
      skip(h, 2) // last entry of the tour
      expect(h.element('counter').textContent).toBe('Stop 3 of 3 · 3 awaiting you')

      const bigPool = makePool('full', 28, 32) // disjoint draftKeys — idx=2 would otherwise still "fit"
      h.postToWebview({ type: 'questions', generation: 1, questions: bigPool, tour: null })

      expect(h.element('counter').textContent).toBe('Question 1 of 28')
    })

    it('switching from one tour directly to a different tour resets idx too', () => {
      const h = createWebviewHarness()
      const tourA = makePool('a', 5, 1)
      h.postToWebview({ type: 'questions', generation: 0, questions: tourA, tour: { ...TOUR, slug: 'tour-a' } })
      skip(h, 3)
      expect(h.element('counter').textContent).toBe('Stop 4 of 5 · 5 awaiting you')

      const tourB = makePool('b', 4, 2) // disjoint draftKeys — idx=3 would otherwise still "fit"
      h.postToWebview({ type: 'questions', generation: 1, questions: tourB, tour: { ...TOUR, slug: 'tour-b' } })

      expect(h.element('counter').textContent).toBe('Stop 1 of 4 · 4 awaiting you')
    })

    it('an ordinary reshuffle WITHIN the same tour (no pool change) still uses relocate-by-key, not a blind reset', () => {
      const h = createWebviewHarness()
      const tourPool = makePool('tour', 5, 1)
      h.postToWebview({ type: 'questions', generation: 0, questions: tourPool, tour: TOUR })
      skip(h, 3) // now on 'tour-key-3'
      expect(h.element('counter').textContent).toBe('Stop 4 of 5 · 5 awaiting you')

      // Same tour, same entries, reordered (e.g. an unrelated background push) — draftKey 'tour-key-3' still present, just moved.
      const reordered = [tourPool[4], tourPool[3], tourPool[2], tourPool[1], tourPool[0]]
      h.postToWebview({ type: 'questions', generation: 1, questions: reordered, tour: TOUR })

      // 'tour-key-3' relocated to its new position (index 1) — not reset to 0.
      expect(h.element('counter').textContent).toBe('Stop 2 of 5 · 5 awaiting you')
    })

    it('an ordinary reshuffle of the full (non-tour) walk is unaffected by the pool-change guard', () => {
      const h = createWebviewHarness()
      const bigPool = makePool('full', 5, 1)
      h.postToWebview({ type: 'questions', generation: 0, questions: bigPool, tour: null })
      skip(h, 3) // now on 'full-key-3'
      expect(h.element('counter').textContent).toBe('Question 4 of 5')

      const reordered = [bigPool[4], bigPool[3], bigPool[2], bigPool[1], bigPool[0]]
      h.postToWebview({ type: 'questions', generation: 1, questions: reordered, tour: null })

      expect(h.element('counter').textContent).toBe('Question 2 of 5')
    })
  })
})

// ---------------------------------------------------------------------------
// ADR-0023 square 4: staleness banner (Riddle 5's design, 2026-07-24 inbox
// 1834) — the vault-side sibling of the v0.7.33 edit-time file-drift
// banner. These run the actual shipped script via the harness, not a
// description of intended behavior.
// ---------------------------------------------------------------------------

// ADR-0035 Iteration 3 (seed-2026-07-30, "frictionless observation
// reporting"): off-by-default report button — hidden unless the host says
// reportButtonEnabled, and posts the current question's identity when clicked.
describe('Report button (ADR-0035 Iteration 3)', () => {
  const Q1 = { id: 'q1', text: 'Q1', adrPath: '/fake/a.md', adrNumber: 1, lineStart: 1, draftKey: 'key-1', fileChecksum: 'c1', totalOccurrences: 1, groupLabel: 'ADR-0001', groupSortKey: '0-0001', sourceKind: 'adr' }

  it('hidden by default (reportButtonEnabled omitted/false)', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [Q1] })
    expect(h.element('btn-report').style.display).toBe('none')
  })

  it('shown when the host reports the setting is on', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [Q1], reportButtonEnabled: true })
    expect(h.element('btn-report').style.display).toBe('')
  })

  it('hides again on a later push where the setting reads off', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [Q1], reportButtonEnabled: true })
    h.postToWebview({ type: 'questions', generation: 1, questions: [Q1], reportButtonEnabled: false })
    expect(h.element('btn-report').style.display).toBe('none')
  })

  it('clicking posts reportObservation with the current question\'s identity', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [Q1], reportButtonEnabled: true })
    h.click('btn-report')
    const sent = h.sentMessages.find(m => m.type === 'reportObservation')
    expect(sent).toMatchObject({ type: 'reportObservation', adrPath: '/fake/a.md', questionId: 'q1', draftKey: 'key-1' })
  })

  // Iteration 5 (Gleaner 5, 2026-07-31, seed-2026-07-31-shift-click-report-...):
  // the rendered card's own markup rides along on Report — the render-vs-source
  // comparison that made two same-day rendering bugs diagnosable from a
  // screenshot, captured as text so no OS screen-capture permission is ever
  // needed.
  it('includes the current rendered card\'s markup (real render, not a placeholder)', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [Q1], reportButtonEnabled: true })
    h.click('btn-report')
    const sent = h.sentMessages.find(m => m.type === 'reportObservation')
    expect(typeof sent?.renderedHtml).toBe('string')
    expect(sent?.renderedHtml).toContain('Q1')
  })
})

type WordDiffCounts = (oldText: string, newText: string) => { added: number; removed: number }
type DraftSourceLabel = (source: string | undefined) => string | null

describe('wordDiffCounts (banner-grade multiset diff)', () => {
  it('counts added and removed words between two texts', () => {
    const wordDiffCounts = createWebviewHarness().sandbox.wordDiffCounts as WordDiffCounts
    expect(wordDiffCounts('hello world', 'hello there world friend')).toEqual({ added: 2, removed: 0 })
    expect(wordDiffCounts('hello there world friend', 'hello world')).toEqual({ added: 0, removed: 2 })
  })

  it('identical text is a zero diff', () => {
    const wordDiffCounts = createWebviewHarness().sandbox.wordDiffCounts as WordDiffCounts
    expect(wordDiffCounts('same text here', 'same text here')).toEqual({ added: 0, removed: 0 })
  })

  it('handles empty strings on either side', () => {
    const wordDiffCounts = createWebviewHarness().sandbox.wordDiffCounts as WordDiffCounts
    expect(wordDiffCounts('', 'a b c')).toEqual({ added: 3, removed: 0 })
    expect(wordDiffCounts('a b c', '')).toEqual({ added: 0, removed: 3 })
  })

  it('a repeated word that changes count is tracked as a multiset, not a set', () => {
    const wordDiffCounts = createWebviewHarness().sandbox.wordDiffCounts as WordDiffCounts
    // 'the the the' -> 'the the': one fewer occurrence of 'the'.
    expect(wordDiffCounts('the the the', 'the the')).toEqual({ added: 0, removed: 1 })
  })
})

describe('draftSourceLabel', () => {
  it('labels known non-panel sources for display', () => {
    const draftSourceLabel = createWebviewHarness().sandbox.draftSourceLabel as DraftSourceLabel
    expect(draftSourceLabel('mobile')).toBe('Mobile ADR entry')
    expect(draftSourceLabel('file-prefill')).toBe('file prefill')
    expect(draftSourceLabel('mcp')).toBe('MCP')
  })

  it('leaves an unrecognized source as its raw value (free-form by design)', () => {
    const draftSourceLabel = createWebviewHarness().sandbox.draftSourceLabel as DraftSourceLabel
    expect(draftSourceLabel('some-future-surface')).toBe('some-future-surface')
  })

  it('the common "another Open Questions window" case (panel) is unlabeled, not a redundant self-reference', () => {
    const draftSourceLabel = createWebviewHarness().sandbox.draftSourceLabel as DraftSourceLabel
    expect(draftSourceLabel('panel')).toBeNull()
    expect(draftSourceLabel(undefined)).toBeNull()
  })
})

describe('Vault staleness banner (ADR-0023 square 4)', () => {
  const Q1 = { id: 'q1', text: 'Q1', adrPath: '/fake/a.md', adrNumber: 1, lineStart: 1, draftKey: 'key-1', fileChecksum: 'c1', totalOccurrences: 1, groupLabel: 'ADR-0001', groupSortKey: '0-0001', sourceKind: 'adr' }

  it('shows the banner when the vault draft changes for the SAME question, with a word-diff and timestamp', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [{ ...Q1, draftText: 'hello world' }] })
    expect(h.element('ans').value).toBe('hello world')

    h.postToWebview({
      type: 'questions', generation: 1,
      questions: [{ ...Q1, draftText: 'hello there world friend', draftSavedAt: '2026-07-24T12:12:00Z' }],
    })

    expect(h.element('draft-restored').style.display).toBe('block')
    const text = h.element('draft-restored').innerHTML
    expect(text).toContain('Updated draft detected')
    expect(text).toContain('+2')
    expect(text).toContain('−0')
    // The textarea itself is never touched by the mere detection — only an explicit Update click may change it.
    expect(h.element('ans').value).toBe('hello world')
  })

  it('does NOT show the banner for this window\'s own echo — lastSentDraftText already matches what it just sent', () => {
    // vi.useFakeTimers() must be installed BEFORE createWebviewHarness() —
    // the sandbox captures setTimeout/clearTimeout at construction time
    // (webviewHarness.ts's own documented design: real timers pass through
    // so fake-timers control the debounce), so faking timers afterward
    // leaves the harness holding the pre-fake, real setTimeout reference.
    vi.useFakeTimers()
    let h
    try {
      h = createWebviewHarness()
      h.postToWebview({ type: 'questions', generation: 0, questions: [{ ...Q1, draftText: 'hello world' }] })
      h.typeAnswer('hello world v2') // schedules the 500ms debounced autosave
      vi.runAllTimers() // fires it: posts 'draft' and sets lastSentDraftText = 'hello world v2'
    } finally {
      vi.useRealTimers()
    }
    expect(h.sentMessages).toContainEqual(expect.objectContaining({ type: 'draft', draftText: 'hello world v2' }))

    // The extension's resulting push (its own write settling, or the drafts.json
    // watcher firing) echoes back exactly what this window just sent. The
    // "Draft restored" status from the initial load is expected to still be
    // showing (unrelated to staleness) — only the staleness text must be absent.
    h.postToWebview({ type: 'questions', generation: 1, questions: [{ ...Q1, draftText: 'hello world v2' }] })
    expect(h.element('draft-restored').innerHTML).not.toContain('Updated draft detected')
  })

  it('provenance is named in the banner when the source is not this same panel surface', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [{ ...Q1, draftText: 'hello world' }] })
    h.postToWebview({ type: 'questions', generation: 1, questions: [{ ...Q1, draftText: 'hello world v2', draftSource: 'mobile' }] })
    expect(h.element('draft-restored').innerHTML).toContain('Mobile ADR entry')
  })

  it('"Update" loads the vault text into the textarea and hides the banner, without re-sending a draft save', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [{ ...Q1, draftText: 'hello world' }] })
    h.postToWebview({ type: 'questions', generation: 1, questions: [{ ...Q1, draftText: 'hello there world friend' }] })
    h.clickDelegated('draft-restored', 'update-draft')
    expect(h.element('ans').value).toBe('hello there world friend')
    expect(h.element('draft-restored').style.display).toBe('none')
    expect(h.sentMessages.filter(m => m.type === 'draft')).toHaveLength(0)
  })

  it('"Keep yours" hides the banner without touching the textarea, and re-arms so the SAME vault text doesn\'t nag again', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [{ ...Q1, draftText: 'hello world' }] })
    h.postToWebview({ type: 'questions', generation: 1, questions: [{ ...Q1, draftText: 'hello there world friend' }] })
    h.clickDelegated('draft-restored', 'keep-mine')
    expect(h.element('ans').value).toBe('hello world')
    expect(h.element('draft-restored').style.display).toBe('none')

    // Re-arm check: the identical vault text arriving again must not re-trigger the banner.
    h.postToWebview({ type: 'questions', generation: 2, questions: [{ ...Q1, draftText: 'hello there world friend' }] })
    expect(h.element('draft-restored').style.display).not.toBe('block')
  })

  it('"See diff" posts showDraftDiff with the live textarea value and the vault text, never touching the textarea itself', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [{ ...Q1, draftText: 'hello world' }] })
    h.postToWebview({ type: 'questions', generation: 1, questions: [{ ...Q1, draftText: 'hello there world friend' }] })
    h.clickDelegated('draft-restored', 'see-draft-diff')
    expect(h.sentMessages).toContainEqual({ type: 'showDraftDiff', mine: 'hello world', theirs: 'hello there world friend', questionText: 'Q1' })
    expect(h.element('ans').value).toBe('hello world')
  })

  it('a same-question background push with unchanged draftText never shows the staleness banner (the ordinary, silent case)', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [{ ...Q1, draftText: 'hello world' }] })
    // The plain "Draft restored" status message from the first push is expected
    // to persist (unrelated to staleness) — only the staleness text must be absent.
    h.postToWebview({ type: 'questions', generation: 1, questions: [{ ...Q1, draftText: 'hello world' }] })
    expect(h.element('draft-restored').innerHTML).not.toContain('Updated draft detected')
  })
})

// ---------------------------------------------------------------------------
// bodyMaxWidthCss (ADR-0010 answered QST — panel body width setting)
// ---------------------------------------------------------------------------

describe('bodyMaxWidthCss', () => {
  it('defaults to min(94%, 1100px) for the shipped default setting value', () => {
    expect(bodyMaxWidthCss('1100')).toBe('min(94%, 1100px)')
  })

  it('"full" removes the cap entirely', () => {
    expect(bodyMaxWidthCss('full')).toBe('none')
    expect(bodyMaxWidthCss('Full')).toBe('none') // case-insensitive
  })

  it('a custom pixel value keeps the 94% viewport safety net', () => {
    expect(bodyMaxWidthCss('1400')).toBe('min(94%, 1400px)')
  })

  it('falls back to the default for garbage input', () => {
    expect(bodyMaxWidthCss('not-a-number')).toBe('min(94%, 1100px)')
    expect(bodyMaxWidthCss('')).toBe('min(94%, 1100px)')
    expect(bodyMaxWidthCss('-50')).toBe('min(94%, 1100px)')
  })
})

describe("Regression tests: comment-strip must not eat backtick-quoted comment examples (Gleaner URGENT 1755, founder screenshots, 2026-07-31)", () => {
  // ADR-0032's own QST-CORE quotes \`<!-- collab-adr-lean: v1 -->\` and two
  // sibling examples while DISCUSSING the comment channel; the render-side
  // strip (e8ab283) ran before any code protection, gutted the spans'
  // contents, and the orphaned backticks re-paired across paragraphs —
  // sentences of prose rendered as one giant code span. These run the
  // ACTUAL shipped webview script via the harness, through the real
  // questions-message flow (q.body renders via renderMarkdown).
  const mkQ = (body: string) => ({ id: 'q1', text: 'Q1', body, adrPath: '/fake/a.md', adrNumber: 1, lineStart: 1, draftKey: 'key-1', fileChecksum: 'c1', totalOccurrences: 1, groupLabel: 'ADR-0001', groupSortKey: '0-0001', sourceKind: 'adr' })

  it('a backtick-quoted comment example survives verbatim; a bare comment is still stripped; no orphaned-backtick mega-span', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [mkQ(
      'Version marker: `<!-- collab-adr-lean: v1 -->` in the header.\n\n<!-- really invisible -->\n\nAnd `<!-- @adr-anchor: slug -->` likewise.')] })
    const html = h.element('body').innerHTML
    expect(html).toContain('collab-adr-lean: v1')
    expect(html).toContain('@adr-anchor: slug')
    expect(html).not.toContain('really invisible')
    expect(html).not.toMatch(/<code>[^<]*in the header/)
  })

  it('a fenced block keeps a comment inside it', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [mkQ('```\n[Fill this in] <!-- keep me -->\n```')] })
    expect(h.element('body').innerHTML).toContain('keep me')
  })
})

// Regression tests (fixes real founder-reported bug, Gleaner's briefs
// 2026-08-09/2026-08-10: a SECOND founder Report on the same question
// proved the first was worse than guessed — the leaked text wasn't even
// FROM the ADR on screen; it was left behind by a DIFFERENT question
// viewed earlier in the same panel session, from an entirely unrelated
// ADR). Bug: #why/#body/#body-post's empty-state only toggled
// `style.display = 'none'` — none of the three ever cleared `.innerHTML`,
// unlike renderRecommendations' own empty-state two hundred lines away
// (`wrap.innerHTML = ''`). A question with real why/body/bodyPost content
// left that HTML sitting in the hidden div; if the NEXT question rendered
// had that field empty, the div stayed hidden but the stale HTML was
// still there — genuinely wrong content, not just a visual glitch,
// confirmed against a live cross-document specimen.
describe('Regression tests: #why/#body/#body-post clear their innerHTML on the empty-state path, not just display (cross-question stale-DOM leak)', () => {
  const mkQ = (overrides: Record<string, unknown>) => ({
    id: 'q1', text: 'Q1', adrPath: '/fake/a.md', adrNumber: 1, lineStart: 1,
    draftKey: 'key-1', fileChecksum: 'c1', totalOccurrences: 1,
    groupLabel: 'ADR-0001', groupSortKey: '0-0001', sourceKind: 'adr',
    ...overrides,
  })

  it('why: populated on question 1, empty on question 2 — the stale HTML from question 1 must not survive', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [
      mkQ({ id: 'q1', whyAsking: 'unrelated content about semantic colours from a different ADR entirely' }),
      mkQ({ id: 'q2', text: 'Q2' }),
    ] })
    expect(h.element('why').innerHTML).toContain('semantic colours')
    h.click('btn-skip') // advance to question 2, which has no why/body content at all
    expect(h.element('why').style.display).toBe('none')
    expect(h.element('why').innerHTML).toBe('')
  })

  it('body: same guarantee — no cross-question leak once the field goes empty', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [
      mkQ({ id: 'q1', body: 'Leaked paragraph from an unrelated ADR.' }),
      mkQ({ id: 'q2', text: 'Q2' }),
    ] })
    expect(h.element('body').innerHTML).toContain('Leaked paragraph')
    h.click('btn-skip')
    expect(h.element('body').style.display).toBe('none')
    expect(h.element('body').innerHTML).toBe('')
  })

  it('body-post: same guarantee', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [
      mkQ({ id: 'q1', bodyPost: 'Trailing leaked content.' }),
      mkQ({ id: 'q2', text: 'Q2' }),
    ] })
    expect(h.element('body-post').innerHTML).toContain('Trailing leaked content')
    h.click('btn-skip')
    expect(h.element('body-post').style.display).toBe('none')
    expect(h.element('body-post').innerHTML).toBe('')
  })
})
