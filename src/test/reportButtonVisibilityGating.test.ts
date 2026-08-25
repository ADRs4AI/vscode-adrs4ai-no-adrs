/**
 * Structural tests (vscode-import wall) for the Report affordance
 * visibility fix (Jérémie, live, 2026-08-25): "the Report button is still
 * there, but doesn't work with a warning when reporting is turned off —
 * that's not logical. The button should be hidden when the reporting
 * mode is off." adrManager.logging.observations' own package.json
 * description already promised this ("turning this on keeps the button
 * visible and enables the write") — the code just never enforced it.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const PANEL_SRC = readFileSync(resolve(__dirname, '../webview/openQuestionsPanel.ts'), 'utf8')
const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')

describe('openQuestionsPanel.ts: reportButtonEnabled requires BOTH settings, not just reportButton.enabled', () => {
  it('sendQuestions ANDs reportButton.enabled with logging.observations before it ever reaches the webview', () => {
    const fn = PANEL_SRC.match(/private sendQuestions\(\): void \{[\s\S]*?\n  \}/)![0]
    expect(fn).toContain("cfg.get<boolean>('reportButton.enabled', false) && cfg.get<boolean>('logging.observations', false)")
  })
})

describe('package.json: the tree-wide Report menu entry is hidden the same way, for coherence', () => {
  it('adrManager.reportTreeItem\'s when clause also requires config.adrManager.logging.observations', () => {
    const entry = PKG.match(/\{\s*"command": "adrManager\.reportTreeItem",\s*"when": "([^"]+)"/)
    expect(entry, 'reportTreeItem menu entry missing').toBeTruthy()
    expect(entry![1]).toContain('config.adrManager.logging.observations')
  })
})
