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
