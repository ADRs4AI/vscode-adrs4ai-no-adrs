/**
 * Structural tests for the ADR-0035 Iteration 3 report button
 * (seed-2026-07-30, "frictionless observation reporting" — Lapidary's
 * design: "the report button is a human writer for ADR-0035's error
 * ledger"). openQuestionsPanel.ts's reportObservation() is vscode-touching
 * glue (showInputBox, showStatusBarMessage) with no live Extension
 * Development Host here, so verified by source-shape assertions — same
 * discipline as tourDiagnosticsWiring.test.ts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const PANEL_SRC = readFileSync(resolve(__dirname, '../webview/openQuestionsPanel.ts'), 'utf8')

describe('openQuestionsPanel.ts: reportObservation (ADR-0035 Iteration 3)', () => {
  const method = PANEL_SRC.match(/private async reportObservation\([\s\S]*?\n  \}/)![0]

  it('exists and is wired from handleMessage', () => {
    expect(method).toBeTruthy()
    expect(PANEL_SRC).toContain("case 'reportObservation': await this.reportObservation(msg); break")
  })

  it('cancelling the input box (empty/undefined note) records nothing', () => {
    expect(method).toMatch(/if \(!note\) return/)
  })

  it('reuses error-record/2 as-is — source: panel, kind: observation, no new schema field', () => {
    expect(method).toContain("schema: 'error-record/2'")
    expect(method).toContain("source: 'panel'")
    expect(method).toContain("kind: 'observation'")
    expect(method).toContain('anchorPath: msg.adrPath')
  })

  it('captures the current ADR\'s full content, keyed by its own path', () => {
    expect(method).toContain('captureDocument(msg.adrPath)')
    expect(method).toContain('documents: doc ? { [msg.adrPath]: doc } : undefined')
  })

  it('is wrapped in try/catch — failure-soft, reporting a problem must never itself become one', () => {
    expect(method).toMatch(/try \{[\s\S]*\} catch \{/)
  })

  it('the report button is gated by adrManager.reportButton.enabled, default false', () => {
    expect(PANEL_SRC).toContain("reportButtonEnabled: cfg.get<boolean>('reportButton.enabled', false)")
  })

  it('package.json declares the setting, default false', () => {
    const pkg = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')
    const match = pkg.match(/"adrManager\.reportButton\.enabled":\s*\{[^}]*\}/)
    expect(match).toBeTruthy()
    expect(match![0]).toContain('"default": false')
  })
})
