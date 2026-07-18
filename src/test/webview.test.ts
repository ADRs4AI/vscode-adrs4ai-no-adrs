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
    expect(match![1]).toContain('function renderRecommendations(list)')
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
    expect(script).toMatch(/if \(isNewQuestion\)[\s\S]{0,20}\$id\('ans'\)\.focus\(\)/)
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
    expect(PANEL_SRC).toContain('createOrShow(composite: CompositeIndex)')
    expect(PANEL_SRC).toContain('constructor(private readonly composite: CompositeIndex)')
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
    expect(PANEL_SRC).toContain('containerId: `${node.namespace}:${adr.number}`')
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
  it('writeAnswer appends a fresh ANS block when the question has Status but no ANS marker at all — only at a REAL boundary (DEBRIEF-006 gate)', () => {
    expect(PANEL_SRC).toContain("} else if (statusLineIdx >= 0 && boundaryKind !== 'window') {")
    expect(PANEL_SRC).toContain('edit.insert(uri, pos, `\\n**ANS:** (by ${author})\\n${msg.answerText}\\n`)')
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
