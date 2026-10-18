/**
 * Regression test for Glazier 5.5's porthole brief (2026-10-18, finding 3):
 * "Open in file ↗" used to open the ADR with a hardcoded `ViewColumn.Two`,
 * which VS Code resolves by counting every window's editor groups —
 * auxiliary (floating) windows included. With one floating window open,
 * column Two silently resolved to that window's own locked group instead
 * of opening beside the panel. `Beside` resolves relative to the active
 * group instead, so it is immune to floating windows existing or not.
 */
import { describe, it, expect } from 'vitest'
import * as vscode from 'vscode'
import { openInFileShowOptions } from '../webview/openInFileTarget'

describe('openInFileShowOptions', () => {
  it('targets Beside, never a fixed column number', () => {
    const options = openInFileShowOptions()
    expect(options.viewColumn).toBe(vscode.ViewColumn.Beside)
    expect(options.viewColumn).not.toBe(vscode.ViewColumn.Two)
  })

  it('preserves focus on the panel', () => {
    expect(openInFileShowOptions().preserveFocus).toBe(true)
  })
})
