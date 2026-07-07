/**
 * ADR-0004 "ADR Commit" feature — pre-filled commit message.
 * Jérémie's exact spec (answered live, 2026-07-06): "docs: human feedback
 * on ADRs" followed by the affected ADR numbers, comma-separated.
 */

import { describe, it, expect } from 'vitest'
import { buildAdrCommitMessage } from '../commit/commitMessage'

describe('buildAdrCommitMessage', () => {
  it('lists a single changed ADR, zero-padded to 4 digits', () => {
    const msg = buildAdrCommitMessage(['/repo/docs/adr/0007-widget-strategy.md'])
    expect(msg).toBe('docs: human feedback on ADRs 0007')
  })

  it('lists multiple changed ADRs, sorted ascending, comma-space separated', () => {
    const msg = buildAdrCommitMessage([
      '/repo/docs/adr/0007-widget-strategy.md',
      '/repo/docs/adr/0001-project-specifications.md',
      '/repo/docs/adr/0003-mcp-server-design.md',
    ])
    expect(msg).toBe('docs: human feedback on ADRs 0001, 0003, 0007')
  })

  it('deduplicates when the same ADR appears more than once', () => {
    const msg = buildAdrCommitMessage([
      '/repo/docs/adr/0001-project-specifications.md',
      '/repo/docs/adr/0001-project-specifications.md',
    ])
    expect(msg).toBe('docs: human feedback on ADRs 0001')
  })

  it('falls back to a generic message when no path is ADR-numbered (e.g. a seed only)', () => {
    const msg = buildAdrCommitMessage(['/repo/docs/adr/seed-2026-07-06-some-idea.md'])
    expect(msg).toBe('docs: update ADRs')
  })

  it('falls back to a generic message on an empty change list', () => {
    expect(buildAdrCommitMessage([])).toBe('docs: update ADRs')
  })

  it('ignores non-ADR-numbered paths while still listing the ADR-numbered ones', () => {
    const msg = buildAdrCommitMessage([
      '/repo/docs/adr/0002-parser-architecture.md',
      '/repo/docs/adr/seed-2026-07-06-some-idea.md',
      '/repo/docs/adr/templates/collab-adr-lean.md',
    ])
    expect(msg).toBe('docs: human feedback on ADRs 0002')
  })
})
