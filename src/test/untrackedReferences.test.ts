/**
 * Untracked-referenced-files checklist (Lapidary's 2026-07-30
 * founder-escalation dispatch, addition 2): a screenshot dropped into
 * docs/screenshots/ and linked from a seed/ADR is untracked and outside
 * the ADR-dir commit scan — this is the "was it mentioned" detector.
 */

import { describe, it, expect } from 'vitest'
import { findReferencedUntrackedFiles } from '../commit/untrackedReferences'

describe('findReferencedUntrackedFiles', () => {
  it('the motivating case: a screenshot mentioned by filename in a seed', () => {
    const untracked = ['/repo/docs/screenshots/2026-07-30-report-button.png']
    const committed = ['See docs/screenshots/2026-07-30-report-button.png for the evidence.']
    expect(findReferencedUntrackedFiles(untracked, committed)).toEqual(untracked)
  })

  it('matches on bare filename, not the full path (a seed rarely repeats git\'s own relative path exactly)', () => {
    const untracked = ['/repo/docs/screenshots/evidence.png']
    const committed = ['![bug](evidence.png)']
    expect(findReferencedUntrackedFiles(untracked, committed)).toEqual(untracked)
  })

  it('an untracked file never mentioned anywhere is not included', () => {
    const untracked = ['/repo/docs/screenshots/unrelated.png']
    const committed = ['Nothing about images here.']
    expect(findReferencedUntrackedFiles(untracked, committed)).toEqual([])
  })

  it('searches across ALL committed contents, not just the first', () => {
    const untracked = ['/repo/docs/screenshots/second-file.png']
    const committed = ['First file, no mention.', 'Second file mentions second-file.png right here.']
    expect(findReferencedUntrackedFiles(untracked, committed)).toEqual(untracked)
  })

  it('multiple untracked candidates: only the mentioned ones come back, order preserved', () => {
    const untracked = [
      '/repo/docs/screenshots/mentioned-1.png',
      '/repo/docs/screenshots/never-mentioned.png',
      '/repo/docs/screenshots/mentioned-2.png',
    ]
    const committed = ['mentioned-1.png and mentioned-2.png are both linked here.']
    expect(findReferencedUntrackedFiles(untracked, committed)).toEqual([
      '/repo/docs/screenshots/mentioned-1.png',
      '/repo/docs/screenshots/mentioned-2.png',
    ])
  })

  it('empty untracked list or empty committed content: no matches, no crash', () => {
    expect(findReferencedUntrackedFiles([], ['some content'])).toEqual([])
    expect(findReferencedUntrackedFiles(['/repo/x.png'], [])).toEqual([])
  })

  it('handles Windows-style backslash paths the same as POSIX paths', () => {
    const untracked = ['C:\\repo\\docs\\screenshots\\win.png']
    const committed = ['linked as win.png']
    expect(findReferencedUntrackedFiles(untracked, committed)).toEqual(untracked)
  })
})
