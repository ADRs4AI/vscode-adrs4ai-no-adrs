/**
 * Regression tests for the commit-confirmation artifact classifier.
 *
 * Bug (reported twice by Jérémie, 2026-07-12): "Committed N ADR file(s)"
 * called every staged path an ADR, including docs/adr/.working/drafts.json
 * — draft-answer state, not a decision record. The classifier's whole job
 * is to make that message honest.
 */

import { describe, it, expect } from 'vitest'
import { summarizeCommittedArtifacts } from '../commit/artifactClassifier'

describe('summarizeCommittedArtifacts', () => {
  it('Third Directive regression: a commit containing ONLY .working churn does not report "1 ADR"', () => {
    const summary = summarizeCommittedArtifacts(['/repo/docs/adr/.working/drafts.json'])
    expect(summary).toBe('draft state')
    expect(summary).not.toContain('ADR')
  })

  it('classifies ADRs, seeds, and draft state separately, in that display order', () => {
    const summary = summarizeCommittedArtifacts([
      '/repo/docs/adr/0001-storage.md',
      '/repo/docs/adr/0002-testing.md',
      '/repo/docs/adr/seed-2026-03-07-bug-reports.md',
      '/repo/docs/adr/.working/drafts.json',
      '/repo/docs/adr/.working/drafts.json.bak',
    ])
    expect(summary).toBe('draft state, 1 seed, 2 ADRs')
  })

  it('omits classes with zero members entirely — no "0 seeds" noise', () => {
    const summary = summarizeCommittedArtifacts(['/repo/docs/adr/0001-storage.md'])
    expect(summary).toBe('1 ADR')
    expect(summary).not.toContain('seed')
    expect(summary).not.toContain('draft')
  })

  it('pluralizes correctly at count boundaries (1 vs 2+)', () => {
    expect(summarizeCommittedArtifacts(['/repo/docs/adr/0001-a.md'])).toBe('1 ADR')
    expect(summarizeCommittedArtifacts(['/repo/docs/adr/0001-a.md', '/repo/docs/adr/0002-b.md'])).toBe('2 ADRs')
    expect(summarizeCommittedArtifacts(['/repo/docs/adr/seed-2026-01-01-x.md'])).toBe('1 seed')
  })

  it('groups unrecognized paths as "other files" rather than silently mislabeling them as ADRs', () => {
    const summary = summarizeCommittedArtifacts([
      '/repo/docs/adr/0001-storage.md',
      '/repo/docs/adr/.settings/roots.json',
      '/repo/docs/adr/README.md',
    ])
    expect(summary).toBe('1 ADR, 2 other files')
  })

  it('a numbered-looking file nested under .working/ is draft state, never misfiled as an ADR', () => {
    // Guards the class-ordering invariant: draft-state detection must run
    // before the ADR-filename pattern, or a file like this would match
    // both and the more general (wrong) one could win depending on order.
    const summary = summarizeCommittedArtifacts(['/repo/docs/adr/.working/0001-looks-like-an-adr.md'])
    expect(summary).toBe('draft state')
  })

  it('handles Windows-style backslash paths the same as POSIX paths', () => {
    const summary = summarizeCommittedArtifacts(['C:\\repo\\docs\\adr\\.working\\drafts.json'])
    expect(summary).toBe('draft state')
  })
})
