/**
 * Structural regression test (vscode-import wall — openQuestionsPanel.ts
 * imports vscode at module scope, same discipline as
 * reopenedAnswerFallbackWiring.test.ts) for the panel Report button's
 * false-success gap, found 2026-09-26 while answering Ribbon 5's question
 * "what should a conforming tool be REQUIRED to tell the reporter about
 * collection?" (docs/inbox/2026-09-26-1649-ribbon-moreover-to-gleaner-
 * opinion-request-the-feedback-verb-recut.md).
 *
 * `appendLedgerRecord` is failure-soft by contract: on a failed write it
 * RETURNS undefined, it does not throw. The panel's reportObservation used
 * to show "Observation recorded." unconditionally after calling it, and its
 * catch block swallowed everything with no trace — so an unwritable ledger
 * told the reporter their observation was collected when it went nowhere.
 * That is the founding scar of the Ledger Warden seat (a Report the
 * reporter believed was collected, that was not) reproduced inside the
 * capture path itself. The tree-item Report had the identical gap and is
 * covered behaviorally in commandSmoke.test.ts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const PANEL_SRC = readFileSync(resolve(__dirname, '../webview/openQuestionsPanel.ts'), 'utf8')

describe('openQuestionsPanel.ts: reportObservation never announces success over a failed write', () => {
  const fn = PANEL_SRC.match(/private async reportObservation\([\s\S]*?\n  \}\n/)![0]

  it('captures appendLedgerRecord\'s return value instead of discarding it', () => {
    expect(fn).toContain('const written = appendLedgerRecord(')
  })

  it('the "recorded" status message is conditional on that return value', () => {
    expect(fn).toMatch(/if \(written\) \{\s*vscode\.window\.setStatusBarMessage\('ADR Manager: Observation recorded\.'/)
  })

  it('the failed-write branch warns the reporter and echoes their note back so it is not lost', () => {
    expect(fn).toContain('your report was NOT saved')
    expect(fn).toContain('note.slice(0, 300)')
  })

  it('the catch block is no longer a silent drop — it tells the reporter', () => {
    const catchBlock = fn.match(/\} catch \(err\) \{[\s\S]*$/)![0]
    expect(catchBlock).toContain('showWarningMessage')
  })
})
