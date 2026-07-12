/**
 * Regression tests for sidebar question-click routing (2026-07-13).
 *
 * Bug: clicking a question in the sidebar always opened the file, even
 * though the panel is described in Jérémie's own words as "our value
 * proposition in part" and the original intent was to default there.
 * `adrManager.clickOpensIn` (default: panel) is the fix's setting; this
 * pins the decision logic that reads it.
 */

import { describe, it, expect } from 'vitest'
import { resolveQuestionClickCommand } from '../views/questionClickCommand'

const QUESTION = { adrPath: '/repo/docs/adr/0001-storage.md', lineStart: 42 }

describe('resolveQuestionClickCommand', () => {
  it('defaults to opening the panel, focused on the clicked question', () => {
    const fakeTreeItem = { question: QUESTION }
    const resolved = resolveQuestionClickCommand('panel', QUESTION, fakeTreeItem)
    expect(resolved.command).toBe('adrManager.goToQuestionInPanel')
    // adrManager.goToQuestionInPanel's handler reads .question off the
    // FIRST argument -- must be the tree item itself, not a derived value.
    expect(resolved.arguments).toEqual([fakeTreeItem])
  })

  it('"file" opens the ADR/seed file at the question\'s line, one affordance switch away from the default', () => {
    const fakeTreeItem = { question: QUESTION }
    const resolved = resolveQuestionClickCommand('file', QUESTION, fakeTreeItem)
    expect(resolved.command).toBe('adrManager.openAdr')
    expect(resolved.arguments).toEqual([QUESTION.adrPath, QUESTION.lineStart])
  })

  it('an unrecognized setting value falls back to the panel default rather than doing nothing or throwing (Postel\'s Law)', () => {
    const fakeTreeItem = { question: QUESTION }
    // @ts-expect-error -- deliberately passing a value outside the enum, simulating a stale/misconfigured setting
    const resolved = resolveQuestionClickCommand('modal', QUESTION, fakeTreeItem)
    expect(resolved.command).toBe('adrManager.goToQuestionInPanel')
  })

  it('works for seed-sourced questions the same as ADR-sourced ones (question.adrPath is the seed\'s own path)', () => {
    const seedQuestion = { adrPath: '/repo/docs/adr/seed-2026-01-01-x.md', lineStart: 10 }
    const resolved = resolveQuestionClickCommand('file', seedQuestion, {})
    expect(resolved.arguments).toEqual([seedQuestion.adrPath, seedQuestion.lineStart])
  })
})
