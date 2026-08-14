/**
 * Structural tests (vscode-import wall — openQuestionsPanel.ts imports
 * vscode at module scope, same discipline as treeWideReportWiring.test.ts)
 * for the server-side half of Gleaner's brief 2026-08-14 item 4: threading
 * each root's caption into WebviewQuestion, and the panel setting that
 * controls its visibility. The actual client-side show/hide behavior has
 * real behavioral tests in openQuestionsPanelHeaderCaption.test.ts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const PANEL_SRC = readFileSync(resolve(__dirname, '../webview/openQuestionsPanel.ts'), 'utf8')
const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')

describe('openQuestionsPanel.ts: rootCaption is computed once per send and threaded onto every row', () => {
  it('rootCaptions() computes for the whole composite at once (git-auto needs every root, not one at a time)', () => {
    const fn = PANEL_SRC.match(/private rootCaptions\(\): Map<string, string> \{[\s\S]*?\n  \}/)![0]
    expect(fn).toContain('computeRootCaptions(nodes, mode)')
    expect(fn).toContain("get<RootCaptionMode>('roots.captionMode', 'git-auto')")
  })

  it('adrRowOpts and the seed-row opts both set rootCaption on every WebviewQuestion row', () => {
    expect(PANEL_SRC).toContain('rootCaption: (node && captions.get(node.path)) ?? namespace,')
    expect(PANEL_SRC).toContain('rootCaption,')
    expect(PANEL_SRC).toContain('rootCaption: opts.rootCaption,')
  })

  it('tour mode threads the same captions map through, not a fresh recompute per row', () => {
    const fn = PANEL_SRC.match(/private buildTourQuestions\(slug: string\): WebviewQuestion\[\] \{[\s\S]*?\n  \}/)![0]
    expect(fn).toContain('const captions = this.rootCaptions()')
    expect(fn).toContain('this.adrRowOpts(entry.resolution.adr, captions)')
  })
})

describe('openQuestionsPanel.ts: sendQuestions posts the header-caption display mode', () => {
  it('reads adrManager.panel.showProjectInHeader, defaulting to auto', () => {
    const fn = PANEL_SRC.match(/private sendQuestions\(\): void \{[\s\S]*?\n  \}/)![0]
    expect(fn).toContain("projectNameInHeader: cfg.get<'off' | 'auto' | 'always'>('panel.showProjectInHeader', 'auto')")
  })
})

describe('openQuestionsPanel.ts: the webview <script> reads and applies the mode', () => {
  it('module-level projectNameMode is set from the posted message, default auto', () => {
    expect(PANEL_SRC).toContain("let projectNameMode = 'auto';")
    expect(PANEL_SRC).toContain("projectNameMode = msg.projectNameInHeader || 'auto';")
  })

  it('render() shows/hides #counter-project based on mode and root-count, keyed off rootNamespace (not the display-only rootCaption)', () => {
    expect(PANEL_SRC).toContain("new Set(questions.map(qq => qq.rootNamespace)).size > 1")
    expect(PANEL_SRC).toContain("projectNameMode === 'always' || (projectNameMode !== 'off' && spansMultipleRoots)")
  })
})

describe('package.json: adrManager.panel.showProjectInHeader', () => {
  it('declares the three modes with auto as the default', () => {
    const match = PKG.match(/"adrManager\.panel\.showProjectInHeader":\s*\{[\s\S]*?\n\s*\}/)
    expect(match, 'setting declaration missing').toBeTruthy()
    const decl = match![0]
    expect(decl).toContain('"off"')
    expect(decl).toContain('"auto"')
    expect(decl).toContain('"always"')
    expect(decl).toContain('"default": "auto"')
  })
})
