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
import { describe, it, expect } from 'vitest'
import { bodyMaxWidthCss } from '../webview/panelSettings'

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

  it('ADR-0018 Step 3: createOrShow and the constructor both take a SeedIndex', () => {
    expect(PANEL_SRC).toContain('createOrShow(index: AdrIndex, seedIndex: SeedIndex)')
    expect(PANEL_SRC).toContain('constructor(private readonly index: AdrIndex, private readonly seedIndex: SeedIndex)')
  })

  it('ADR-0018 Step 3: writeAnswer branches to parseSeed for seed-sourced questions, never parseAdr for them', () => {
    expect(PANEL_SRC).toContain("msg.sourceKind === 'seed'")
    expect(PANEL_SRC).toContain('parseSeed(currentContent, msg.adrPath)')
  })

  it('ADR-0018 Step 3: reindexes the seed index (not the ADR index) after a seed write', () => {
    // Updated 2026-07-12: reindexes from buffer content (indexContent), not
    // disk (indexFile) — see the "question doesn't advance" fix below.
    expect(PANEL_SRC).toContain('this.seedIndex.indexContent(msg.adrPath, freshContent)')
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

  it('writeAnswer checks save()\'s return value and retries once before warning', () => {
    expect(PANEL_SRC).toContain('let saved = await vscode.workspace.save(uri)')
    expect(PANEL_SRC).toContain('if (!saved) {')
    // Two save() call sites: the retry, and the (now-decoupled) reindex
    // that no longer depends on it.
    expect((PANEL_SRC.match(/vscode\.workspace\.save\(uri\)/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('reindexes from the live buffer (doc.getText()), not disk, so the panel advances even if the save failed', () => {
    expect(PANEL_SRC).toContain('const freshContent = doc.getText()')
    expect(PANEL_SRC).toContain('this.index.indexContent(msg.adrPath, freshContent)')
  })

  it('surfaces a visible warning when the answer was applied but not saved — never a silent partial success', () => {
    expect(PANEL_SRC).toContain('Answer applied but not yet saved to disk')
    const match = PANEL_SRC.match(/<script>([\s\S]*?)<\/script>/)
    expect(match![1]).toContain('if (msg.warning)')
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
