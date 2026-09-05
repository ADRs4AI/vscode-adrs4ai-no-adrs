/**
 * Structural tests (vscode-import wall, same discipline as
 * commitErrorLoggingWiring.test.ts) for `registerLoggedCommand` — Jérémie's
 * founder Report, 2026-09-02/05: copyDeepLink threw a raw, uncaught
 * exception (VS Code's own generic "Error running command X: ..." popup)
 * that never reached errors.jsonl, sitting unlogged for three days until he
 * hit it again and had to report it a second time. His own pointed
 * question: "make sure that EVERY error experienced is LOGGED, and doesn't
 * require me RELOGGING it."
 *
 * The fix generalizes the commit-failure pattern (2026-08-13, `source:
 * 'commit'`) to every command with ONE wrapper at the registration site,
 * rather than a per-incident manual try/catch. This file pins two things:
 * the wrapper's own catch/log/rethrow shape, and — the part that actually
 * answers "EVERY error" — that every one of extension.ts's own command
 * registrations goes through it, not a stray raw
 * `vscode.commands.registerCommand` left uncovered.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')

describe('extension.ts: registerLoggedCommand catches, logs, and re-throws', () => {
  const fn = EXT_SRC.match(/function registerLoggedCommand\([\s\S]*?\n\}/)![0]

  it('delegates to the real vscode.commands.registerCommand — not a reimplementation', () => {
    expect(fn).toContain('vscode.commands.registerCommand(commandId,')
  })

  it('logs with a dedicated source tag and the failing command\'s id in payload', () => {
    expect(fn).toContain("source: 'command'")
    expect(fn).toContain("kind: 'command-execution-failed'")
    expect(fn).toContain('commandId,')
  })

  it('re-throws after logging — VS Code\'s own error popup still fires, this is additive not a replacement', () => {
    expect(fn).toMatch(/appendLedgerRecord\(\{[\s\S]*?\}\);[\s\S]*?\}\s*throw err;/)
  })

  it('captures the raw error object, same discipline as the commit-failure fix', () => {
    expect(fn).toContain('rawError:')
  })

  // Jérémie's feedback, 2026-09-05 (replying to this same fix): "I hope
  // that it reports a little message in the status bar... I find that
  // very helpful as feedback to the user." Same pattern reportTreeItem
  // already uses.
  it('confirms via the status bar when logging actually succeeded — same pattern as reportTreeItem', () => {
    expect(fn).toContain("if (logged) vscode.window.setStatusBarMessage('ADR Manager: Error logged to errors.jsonl.', 4000);")
  })
})

describe('extension.ts: anchorPathFromCommandArg — best-effort, never guesses a wrong file', () => {
  const fn = EXT_SRC.match(/function anchorPathFromCommandArg\([\s\S]*?\n\}/)![0]

  it('tries every AdrTreeItem shape before falling back to the active editor, then any known root', () => {
    expect(fn).toContain('item?.adr?.path')
    expect(fn).toContain('item?.seed?.path')
    expect(fn).toContain('item?.question?.adrPath')
    expect(fn).toContain('item?.rootNode?.path')
    expect(fn).toContain('vscode.window.activeTextEditor?.document.uri.fsPath')
    expect(fn).toContain('compositeIndex?.root.path')
  })
})

// The actual answer to "EVERY error" — mechanically verified, not asserted
// in prose. A single command still calling the raw API directly would be
// exactly the kind of first-order gap this whole fix exists to close.
describe('extension.ts: every command registration in the disposables array is logged, none left raw', () => {
  it('the only remaining raw vscode.commands.registerCommand call is the wrapper\'s own delegation, not a command left uncovered', () => {
    const rawCallSites = (EXT_SRC.match(/vscode\.commands\.registerCommand\(/g) ?? []).length
    expect(rawCallSites).toBe(1)
    const wrapperFn = EXT_SRC.match(/function registerLoggedCommand\([\s\S]*?\n\}/)![0]
    expect(wrapperFn).toContain('vscode.commands.registerCommand(')
  })

  it('every OTHER command registration in the file goes through registerLoggedCommand — 30+ real commands, none left calling the raw API directly', () => {
    const loggedCallSites = (EXT_SRC.match(/registerLoggedCommand\(/g) ?? []).length
    expect(loggedCallSites).toBeGreaterThan(30)
  })

  it('copyDeepLink\'s own registration — the specimen that started this — goes through the wrapper', () => {
    expect(EXT_SRC).toContain("registerLoggedCommand('adrManager.copyDeepLink'")
  })
})

describe('drafts/errorLog.ts: LedgerRecord.source gains \'command\'', () => {
  it('the union includes command alongside the existing sources', () => {
    const src = readFileSync(resolve(__dirname, '../drafts/errorLog.ts'), 'utf8')
    const line = src.match(/source: '[^\n]*'/)![0]
    expect(line).toContain("'commit'")
    expect(line).toContain("'command'")
  })
})
