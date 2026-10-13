/**
 * Regression — a malformed ANS slot must never arrive as the human's draft.
 *
 * SPECIMEN (founder in-flow record, 2026-10-12T22:34:11Z, QST-WORD-FONTS in
 * seed-2026-08-07-jeremie-visit-queue.md, relayed by Concertmaster): the slot
 * held a bare `[ ]` plus an unseparated parenthetical note. His words:
 *
 *   "the ANS placeholder was [ ] or something and so I have a lot unrelevant
 *    preparsed stuff in the box, and it is PARALYZING."
 *
 * MECHANISM: every placeholder regex is anchored `^…$` over the WHOLE trimmed
 * slot, so a placeholder plus ANY trailing content stops being recognized as a
 * placeholder — and is then treated as a real prior answer and prefilled. That
 * is the worst case to prefill: the slot says *unanswered*, and its noise
 * arrives as his draft on a slot he has scheduled.
 */

import { describe, it, expect } from 'vitest'
import { isPlaceholderAnswerText } from '../parser/extractor'

/** Mirrors the panel's own predicate; kept here so the mechanism is pinned even though the panel is behind the vscode-import wall. */
const leadsWithPlaceholder = (text: string | undefined): boolean => {
  const first = (text ?? '').split('\n').map(l => l.trim()).find(l => l.length > 0)
  return first !== undefined && isPlaceholderAnswerText(first)
}

describe('Regression tests: a placeholder-led ANS slot is context, never a prefilled draft', () => {
  it('the specimen shape — a bare [ ] plus an unseparated note — is recognized as placeholder-led', () => {
    expect(leadsWithPlaceholder('[ ]\n\n(note: he wanted the fonts named, see the thread above)')).toBe(true)
  })

  it('pins WHY it was prefilled: the whole-slot recognizer says false on exactly that shape', () => {
    // Not a bug in isPlaceholderAnswerText — it answers "is this slot ONLY a
    // placeholder", which is the right question for its own callers. The panel
    // was asking it the wrong question.
    expect(isPlaceholderAnswerText('[ ]\n\n(note: he wanted the fonts named)')).toBe(false)
    expect(isPlaceholderAnswerText('[ ]')).toBe(true)
  })

  it('covers the other placeholder spellings with trailing content', () => {
    for (const lead of ['[ ]', '[]', '[Fill this in]', '[TBD]', '[pending]', '[unanswered]']) {
      expect(leadsWithPlaceholder(lead + '\n\nstray prose nobody separated with ---')).toBe(true)
    }
  })

  it('a genuine prior answer is STILL prefilled — the anti-blind-replace property survives', () => {
    // The prefill exists so a replace is never blind (v0.7.x, Jérémie
    // 2026-07-23). Suppressing real drafts would trade one harm for another.
    expect(leadsWithPlaceholder('Use Inter for UI and Berkeley Mono for code.')).toBe(false)
    expect(leadsWithPlaceholder('[Inter] is my pick, with Berkeley Mono for code.')).toBe(false)
  })

  it('an empty or absent slot is not placeholder-led — nothing to show as context', () => {
    expect(leadsWithPlaceholder(undefined)).toBe(false)
    expect(leadsWithPlaceholder('')).toBe(false)
    expect(leadsWithPlaceholder('   \n\n  ')).toBe(false)
  })
})
