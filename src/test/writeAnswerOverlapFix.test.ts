/**
 * Regression test — recurring `workspace-edit-rejected` in elenchus-
 * monorepo (Gleaner's brief, 2026-08-08, docs/inbox/2026-08-08-0417-
 * gleaner-to-fitter-workspace-edit-rejected-recurrence.md: the same
 * failure fired 2026-07-31, 08-02, and 08-08, with file drift and
 * external git races both ruled out via static analysis).
 *
 * Root cause (found by code reading, verified with a realistic specimen
 * through the REAL scanAnswerWriteAnchors — not a hand-simulated model):
 * writeAnswer's step 2 ("update the **ANS:** author line") used to fire
 * unconditionally whenever `ansHeaderLineIdx >= 0`. Step 3's "replace the
 * whole existing answer" branch (a question with a REAL prior answer,
 * not a placeholder, being re-answered — `fillLineIdx === -1 &&
 * ansHeaderLineIdx >= 0`) ALSO replaces a range starting at the exact
 * same `Position(ansHeaderLineIdx, 0)`. Both edits land in the SAME
 * WorkspaceEdit, targeting overlapping ranges on the same document — VS
 * Code's `applyEdit()` silently rejects the whole edit when it detects
 * that (returns `false`, no thrown error), indistinguishable at the call
 * site from any other rejection. Deterministic and 100% local: fires
 * every single time a question with a real existing answer is
 * re-answered, no race or drift involved.
 *
 * vscode-touching glue — writeAnswer isn't independently invocable
 * outside a real extension host, so this is source-shape verification,
 * same discipline as adr0036.test.ts's own writeAnswer tests. The
 * underlying anchor-scan logic (`scanAnswerWriteAnchors`, which IS pure)
 * has its own behavioral tests in answerWriteScan.test.ts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { scanAnswerWriteAnchors } from '../webview/answerWriteScan'

const PANEL_LINES = readFileSync(resolve(__dirname, '../webview/openQuestionsPanel.ts'), 'utf8').split('\n')
// writeAnswer is long (~250 lines) with many nested braces — a brace-
// matching regex is fragile here, so slice by the two method signatures
// bracketing it instead (same file, both stable anchors).
const writeAnswerStart = PANEL_LINES.findIndex(l => l.trim().startsWith('private async writeAnswer('))
const retrySaveStart = PANEL_LINES.findIndex(l => l.trim().startsWith('private async retrySave('))

describe('openQuestionsPanel.ts: writeAnswer no longer queues overlapping edits on the ANS header line', () => {
  const fn = PANEL_LINES.slice(writeAnswerStart, retrySaveStart).join('\n')

  it('sanity: sliced the real method body, not an empty/wrong range', () => {
    expect(writeAnswerStart).toBeGreaterThan(-1)
    expect(retrySaveStart).toBeGreaterThan(writeAnswerStart)
    expect(fn).toContain('applyEdit')
  })

  it('step 2 (the standalone header-line replace) is now guarded by fillLineIdx >= 0, not ansHeaderLineIdx alone', () => {
    expect(fn).toContain('if (ansHeaderLineIdx >= 0 && fillLineIdx >= 0) {')
    // The old, unguarded condition must be gone — this is the exact bug.
    expect(fn).not.toMatch(/if \(ansHeaderLineIdx >= 0\) \{\s*const author = msg\.authorName/)
  })

  it('step 3\'s "replace the whole existing answer" branch is unchanged — it already rewrites the header as part of one combined edit', () => {
    expect(fn).toContain('new vscode.Position(ansHeaderLineIdx, 0)')
    expect(fn).toContain('`**ANS:** (by ${author})\\n${msg.answerText}`')
  })
})

describe('regression: the exact overlap the fix prevents, proven against the real (pure) anchor scanner', () => {
  it('a question with a real existing answer produces two ranges that WOULD have overlapped under the old unconditional step 2', () => {
    const lines = [
      '### QST: Should invitations expire after 7 days?',
      '- Status: answered',
      '',
      '**ANS:** (by Jérémie)',
      'Yes, 7 days, with a resend option.',
      '',
    ]
    const anchors = scanAnswerWriteAnchors(lines, 0)

    // This IS the branch shape that used to double-edit: a real answer
    // (no placeholder) sitting under a real ANS header.
    expect(anchors.fillLineIdx).toBe(-1)
    expect(anchors.ansHeaderLineIdx).toBeGreaterThanOrEqual(0)

    // Old step 2's range (single line, ansHeaderLineIdx..ansHeaderLineIdx)
    // vs. step 3's range (ansHeaderLineIdx..max(ansHeaderLineIdx, ansContentEndLineIdx-1)) —
    // both start at the same line, so they overlap whenever both fire.
    const step2Start = anchors.ansHeaderLineIdx
    const step2End = anchors.ansHeaderLineIdx
    const step3Start = anchors.ansHeaderLineIdx
    const step3End = Math.max(anchors.ansHeaderLineIdx, anchors.ansContentEndLineIdx - 1)
    const wouldHaveOverlapped = step2Start <= step3End && step3Start <= step2End
    expect(wouldHaveOverlapped).toBe(true)

    // Post-fix: step 2 is gated on fillLineIdx >= 0, which is false here —
    // so step 2 never fires in this exact shape, and the overlap is moot.
    const step2FiresPostFix = anchors.ansHeaderLineIdx >= 0 && anchors.fillLineIdx >= 0
    expect(step2FiresPostFix).toBe(false)
  })

  it('a question with an unfilled placeholder still gets BOTH edits (header + placeholder), which never overlap by construction', () => {
    const lines = [
      '### QST: Should invitations expire after 7 days?',
      '- Status: unanswered',
      '',
      '**ANS:** (by Human)',
      '[Fill this in]',
      '',
    ]
    const anchors = scanAnswerWriteAnchors(lines, 0)
    expect(anchors.fillLineIdx).toBeGreaterThan(anchors.ansHeaderLineIdx)

    const step2FiresPostFix = anchors.ansHeaderLineIdx >= 0 && anchors.fillLineIdx >= 0
    expect(step2FiresPostFix).toBe(true) // still fires — this is the ONLY case it should

    // The two single-line ranges are on different lines — no overlap.
    expect(anchors.fillLineIdx).not.toBe(anchors.ansHeaderLineIdx)
  })
})
