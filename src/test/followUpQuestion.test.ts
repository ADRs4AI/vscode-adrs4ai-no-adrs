/**
 * "This answer opens a follow-up question" (Riddle's brief, 2026-10-12,
 * docs/inbox/2026-10-12-0150-riddle-to-fitter-facet-..., from the
 * ADR-0064 QST-STREAM trial-answer specimen — ledger row cca8ee4). Real
 * behavioral tests for the pure mint/collision logic, plus the parser-side
 * guarantee Docent's review made load-bearing: the marker line must never
 * read as part of the answer it follows.
 */

import { describe, it, expect } from 'vitest'
import { mintFollowUpQuestionBlock, collectExistingHandleSlugs, buildFollowUpMarkerLine } from '../webview/followUpQuestion'
import { parseAdr, isFollowUpMarkerLine } from '../parser/extractor'

describe('mintFollowUpQuestionBlock', () => {
  it('mints a fully handled, immediately write-compatible QST block from a one-line title', () => {
    const result = mintFollowUpQuestionBlock({ title: 'Did A work out?', authorName: 'Jérémie' }, new Set())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.qstId).toBe('DID-A-WORK-OUT')
    expect(result.slug).toBe('qst-did-a-work-out')
    expect(result.blockText).toContain('### QST-DID-A-WORK-OUT: Did A work out?')
    expect(result.blockText).toContain('- Status: unanswered')
    expect(result.blockText).toContain('**ANS:** (by Jérémie)')
    expect(result.blockText).toContain('[Fill this in]')
  })

  it('bounds the minted handle to 24 characters, same grammar bound every other handle already follows', () => {
    const result = mintFollowUpQuestionBlock({ title: 'Did option A actually work out in the end for everyone involved?', authorName: 'Jérémie' }, new Set())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.qstId.length).toBeLessThanOrEqual(24)
  })

  it('refuses a blank title rather than minting a placeholder-derived heading (ADR-0034 It-32\'s exact lesson)', () => {
    const result = mintFollowUpQuestionBlock({ title: '   ', authorName: 'Jérémie' }, new Set())
    expect(result.ok).toBe(false)
  })

  it('refuses a title that folds to nothing addressable, rather than minting an empty handle', () => {
    const result = mintFollowUpQuestionBlock({ title: '??? !!!', authorName: 'Jérémie' }, new Set())
    expect(result.ok).toBe(false)
  })

  it('refuses the WHOLE mint on a handle collision — never silently suffixes or guesses (applyBlessQstHandle\'s own discipline, reused)', () => {
    const existing = collectExistingHandleSlugs([{ slug: 'qst-did-a-work-out' }])
    const result = mintFollowUpQuestionBlock({ title: 'Did A work out?', authorName: 'Jérémie' }, existing)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('collides')
  })

  it('a differently-worded title does not collide even when near-identical in meaning (the check is syntactic, not semantic — by design)', () => {
    const existing = collectExistingHandleSlugs([{ slug: 'qst-did-a-work-out' }])
    const result = mintFollowUpQuestionBlock({ title: 'Did A work?', authorName: 'Jérémie' }, existing)
    expect(result.ok).toBe(true)
  })

  it('defaults the ANS byline to "Human" when authorName is blank, same convention writeAnswer already uses elsewhere', () => {
    const result = mintFollowUpQuestionBlock({ title: 'A fresh follow-up', authorName: '' }, new Set())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.blockText).toContain('**ANS:** (by Human)')
  })
})

describe('buildFollowUpMarkerLine', () => {
  it('is a fixed-prefix, single-line marker — never multi-line, never inside the ANS slot by construction', () => {
    expect(buildFollowUpMarkerLine('adr:0100#qst-trial-verdict')).toBe('**Follows up on**: adr:0100#qst-trial-verdict')
  })
})

describe('isFollowUpMarkerLine', () => {
  it('recognizes the exact marker form', () => {
    expect(isFollowUpMarkerLine('**Follows up on**: adr:0100#qst-trial-verdict')).toBe(true)
  })

  it('does not false-positive on an ANS marker or ordinary bold prose', () => {
    expect(isFollowUpMarkerLine('**ANS:** (by Jérémie)')).toBe(false)
    expect(isFollowUpMarkerLine('**Note**: this follows up on an earlier discussion')).toBe(false)
  })
})

describe('parseAdr: a trailing "**Follows up on**:" line never bleeds into the answer it follows', () => {
  const FIXTURE = `# ADR 0100: Some decision

## Questions

### QST-1: Should we try option A?

- Status: answered
- Why asking: context.
- Need: pick.

**ANS:** (by Jérémie)
A, as a trial — if it's jarring we'll fall back to B.

**Follows up on**: adr:0100#qst-trial-verdict
`

  it('q.answer.text stops at the marker, not after it', () => {
    const adr = parseAdr(FIXTURE, '/fake/0100-x.md')
    const q = adr.questions[0]
    expect(q.answer?.text).toContain("we'll fall back to B")
    expect(q.answer?.text).not.toContain('Follows up on')
  })
})
