/**
 * ADR-0004 "ADR Commit" feature — pre-filled commit message.
 * Jérémie's exact spec (answered live, 2026-07-06): "docs: human feedback
 * on ADRs" followed by the affected ADR numbers, comma-separated.
 *
 * Extended per Lapidary's 2026-07-29 feedback-seed dispatch (A1/A2):
 * seeds get their own vocabulary, and mixed ADR+seed changesets compose
 * both halves. `composeCommitMessage` is the pure core; `buildAdrCommitMessage`
 * is the fs-reading wrapper the real call site uses.
 */

import { readFileSync } from 'node:fs'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { buildAdrCommitMessage, composeCommitMessage, type SeedCommitInfo } from '../commit/commitMessage'

describe('composeCommitMessage (pure core)', () => {
  it('lists a single changed ADR, zero-padded to 4 digits', () => {
    expect(composeCommitMessage([7], [])).toBe('docs: human feedback on ADRs 0007')
  })

  it('lists multiple changed ADRs, sorted ascending, comma-space separated', () => {
    expect(composeCommitMessage([7, 1, 3], [])).toBe('docs: human feedback on ADRs 0001, 0003, 0007')
  })

  it('deduplicates when the same ADR appears more than once', () => {
    expect(composeCommitMessage([1, 1], [])).toBe('docs: human feedback on ADRs 0001')
  })

  it('falls back to a generic message on no ADRs and no seeds', () => {
    expect(composeCommitMessage([], [])).toBe('docs: update ADRs')
  })

  it('ignores non-positive ADR numbers (e.g. extractAdrNumber returning 0 for an unrecognized path)', () => {
    expect(composeCommitMessage([0, 2], [])).toBe('docs: human feedback on ADRs 0002')
  })

  // A1: seed-only vocabulary, Jérémie's own dictated phrasing.
  describe('seed-only (A1)', () => {
    const newSeed: SeedCommitInfo = { topic: 'Random Feedback From Experience', isNew: true, threadEntryCount: 0 }
    const feedbackSeed: SeedCommitInfo = { topic: 'Random Feedback From Experience', isNew: false, threadEntryCount: 0 }
    const iteratedSeed: SeedCommitInfo = { topic: 'Random Feedback From Experience', isNew: false, threadEntryCount: 1 }

    it('a brand-new seed file: "new seed: <topic>"', () => {
      expect(composeCommitMessage([], [newSeed])).toBe('docs: new seed: Random Feedback From Experience')
    })

    it('an existing seed with no Thread entries yet: "human feedback on seed: <topic>" (first engagement)', () => {
      expect(composeCommitMessage([], [feedbackSeed])).toBe('docs: human feedback on seed: Random Feedback From Experience')
    })

    it('an existing seed that already has a Thread entry: "human iterated on seed: <topic>" (a continuation)', () => {
      expect(composeCommitMessage([], [iteratedSeed])).toBe('docs: human iterated on seed: Random Feedback From Experience')
    })

    it('more than one seed at once collapses to a pluralized count, not per-topic composition', () => {
      expect(composeCommitMessage([], [feedbackSeed, iteratedSeed])).toBe('docs: human feedback on 2 seeds')
    })
  })

  // A2: mixed ADR+seed changesets compose, per Lapidary's own example.
  describe('mixed ADR + seed changesets (A2)', () => {
    it('ADRs plus one seed: "human feedback on ADRs N, M + one seed"', () => {
      const msg = composeCommitMessage([31, 34], [{ topic: 'x', isNew: false, threadEntryCount: 0 }])
      expect(msg).toBe('docs: human feedback on ADRs 0031, 0034 + one seed')
    })

    it('ADRs plus multiple seeds pluralizes the seed count', () => {
      const seeds: SeedCommitInfo[] = [
        { topic: 'a', isNew: false, threadEntryCount: 0 },
        { topic: 'b', isNew: true, threadEntryCount: 0 },
      ]
      const msg = composeCommitMessage([7], seeds)
      expect(msg).toBe('docs: human feedback on ADRs 0007 + 2 seeds')
    })
  })
})

describe('buildAdrCommitMessage (fs-reading wrapper)', () => {
  it('falls back to a generic message on an empty change list', () => {
    expect(buildAdrCommitMessage([])).toBe('docs: update ADRs')
  })

  it('ignores non-ADR-numbered, non-seed paths while still listing the ADR-numbered ones', () => {
    const msg = buildAdrCommitMessage([
      { path: '/repo/docs/adr/0002-parser-architecture.md' },
      { path: '/repo/docs/adr/templates/collab-adr-lean.md' },
    ])
    expect(msg).toBe('docs: human feedback on ADRs 0002')
  })

  it('reads a real seed file from disk and extracts its topic + thread state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'commit-message-test-'))
    const seedPath = join(dir, 'seed-2026-07-29-real-topic.md')
    writeFileSync(seedPath, [
      '# SEED: Real Topic Here',
      '',
      '- **Date**: 2026-07-29',
      '- **From**: Human',
      '',
      '## Brain Dump',
      '',
      'Some feedback.',
      '',
      '## Thread',
    ].join('\n'))

    const msg = buildAdrCommitMessage([{ path: seedPath, isNew: true }])
    expect(msg).toBe('docs: new seed: Real Topic Here')

    // Sanity: the fixture itself really has zero Thread entries, so the
    // isNew=false case below is exercising "feedback", not "iterated".
    const content = readFileSync(seedPath, 'utf-8')
    expect(content).not.toMatch(/^### /m)

    const msg2 = buildAdrCommitMessage([{ path: seedPath, isNew: false }])
    expect(msg2).toBe('docs: human feedback on seed: Real Topic Here')
  })

  it('a seed with a real Thread entry on disk reads as "iterated", not "feedback"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'commit-message-test-'))
    const seedPath = join(dir, 'seed-2026-07-29-active-thread.md')
    writeFileSync(seedPath, [
      '# SEED: Active Thread',
      '',
      '## Brain Dump',
      '',
      'Some feedback.',
      '',
      '## Thread',
      '',
      '### Lapidary 5 (Claude Fable 5) - 2026-07-29',
      '',
      'A real response.',
    ].join('\n'))

    const msg = buildAdrCommitMessage([{ path: seedPath, isNew: false }])
    expect(msg).toBe('docs: human iterated on seed: Active Thread')
  })

  it('an unreadable/deleted seed path is skipped rather than guessed at', () => {
    const msg = buildAdrCommitMessage([
      { path: '/repo/docs/adr/0002-parser-architecture.md' },
      { path: '/nonexistent/seed-does-not-exist.md' },
    ])
    expect(msg).toBe('docs: human feedback on ADRs 0002')
  })
})
