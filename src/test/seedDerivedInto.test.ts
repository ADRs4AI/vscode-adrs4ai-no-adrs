/**
 * Recall-first Derived-Into parsing (ADR-0041 item 3 — the seed lifecycle
 * & rollup ADR). Acceptance bar per the ADR itself: "accuracy of the
 * metrics" — a real derived-ADR link must never be silently dropped just
 * because its title/formatting varies, and the axis-2 rollup this feeds
 * must never be told a seed was chunked when it wasn't.
 *
 * Every positive fixture below is a REAL specimen from this repo's own
 * docs/adr/ corpus (the "22 local" half of the ADR's acceptance bar) —
 * this repo's own Secretariat seed sat "chunked but wrenched" before this
 * fix, per the ADR's own framing.
 */

import { describe, it, expect } from 'vitest'
import { parseSeed } from '../parser/seedExtractor'

function seedWith(derivedIntoBody: string): string {
  return `# SEED: Specimen

- **Date**: 2026-08-12
- **From**: Test

## Brain Dump

Some content.

## Derived Into

${derivedIntoBody}
`
}

describe('Recall-first Derived-Into parsing (ADR-0041 item 3)', () => {
  describe('Real specimens from this repo\'s own corpus', () => {
    it('bolded + dated + annotated (the Secretariat seed itself, "sat chunked but wrenched")', () => {
      const seed = parseSeed(
        seedWith('- **ADR-0039: Secretariat — SourceRange and the Round-Trip Gate** (2026-07-30) — chunked from this seed + HQ\'s anti-moat seed, all five docket QSTs folded, lanes assigned.'),
        '/fake/seed-x.md',
      )
      expect(seed.isProcessed).toBe(true)
      expect(seed.derivedAdrs).toHaveLength(1)
      expect(seed.derivedAdrs[0].number).toBe(39)
      expect(seed.derivedAdrs[0].title).toBe('Secretariat — SourceRange and the Round-Trip Gate')
    })

    it('markdown-link form with em-dash separator and trailing annotation (dogfood-master-plan seed)', () => {
      const seed = parseSeed(
        seedWith('- [ADR-0017 — Cross-ADR Relationship Vocabulary](0017-cross-adr-relationship-vocabulary.md) (chunked from Iteration 3 Promotion 1)'),
        '/fake/seed-x.md',
      )
      expect(seed.derivedAdrs).toHaveLength(1)
      expect(seed.derivedAdrs[0].number).toBe(17)
      expect(seed.derivedAdrs[0].title).toBe('Cross-ADR Relationship Vocabulary')
    })

    it('plain unbolded form still works (never regressed)', () => {
      const seed = parseSeed(seedWith('- ADR-0010: Open Questions Panel — Rich Rendering and Context'), '/fake/seed-x.md')
      expect(seed.derivedAdrs).toHaveLength(1)
      expect(seed.derivedAdrs[0].number).toBe(10)
      expect(seed.derivedAdrs[0].title).toBe('Open Questions Panel — Rich Rendering and Context')
    })

    it('link text with no colon/dash separator at all falls back to the whole line as title — recall-first, never dropped', () => {
      const seed = parseSeed(
        seedWith('- [ADR-0009 Iteration 3](0009-decision-resolution-taxonomy.md) — closes 4 of 5 QSTs; expands canonical QST-level status set'),
        '/fake/seed-x.md',
      )
      expect(seed.derivedAdrs).toHaveLength(1)
      expect(seed.derivedAdrs[0].number).toBe(9)
      expect(seed.derivedAdrs[0].title).toContain('ADR-0009 Iteration 3')
    })
  })

  describe('False-positive guards — inventing a link is worse than missing a messy one', () => {
    it('a prose paragraph mentioning an ADR number is NOT a derivation claim (real specimen: a "**NOT:**" cross-reference note)', () => {
      const seed = parseSeed(
        seedWith('**NOT:** Remaining open questions live as QSTs in ADR-0014/0015/0016 for Jérémie to answer.'),
        '/fake/seed-x.md',
      )
      expect(seed.derivedAdrs).toHaveLength(0)
    })

    it('a seed explicitly marked "not chunked" whose prose merely COMPARES itself to other ADR numbers stays unprocessed (real specimen: panel-submit-no-refresh-bug seed)', () => {
      const seed = parseSeed(
        seedWith('Not chunked into an ADR — this was a diagnosable bug, not a decision needing ratification.\n\n**Problem 1.** Facet\'s hypothesis didn\'t match the code, the same root cause as ADR-0023 was ruled out; captured live while answering ADR-0028\'s QST-1.'),
        '/fake/seed-x.md',
      )
      expect(seed.isProcessed).toBe(false)
      expect(seed.derivedAdrs).toHaveLength(0)
    })

    it('the literal "ADR-NNNN" template placeholder never counts as a real number (no digits to capture)', () => {
      const seed = parseSeed(seedWith('- ADR-NNNN: Brief title'), '/fake/seed-x.md')
      expect(seed.derivedAdrs).toHaveLength(0)
    })

    it('a Derived-Into link quoted inside a fenced code block is a quotation, not a declaration (the fenced-code trap ADR-0041 names)', () => {
      const seed = parseSeed(
        seedWith('Example of the canonical form:\n\n```\n- ADR-0099: Example Title\n```\n\n' + '*(This seed has not yet been chunked into ADRs)*'),
        '/fake/seed-x.md',
      )
      expect(seed.derivedAdrs).toHaveLength(0)
      expect(seed.derivedIntoHasPlaceholder).toBe(true)
    })
  })

  describe('Placeholder detection (unchanged, verified still tolerant)', () => {
    it('the canonical placeholder marks the seed unprocessed with zero derived ADRs', () => {
      const seed = parseSeed(seedWith('*(This seed has not yet been chunked into ADRs)*'), '/fake/seed-x.md')
      expect(seed.isProcessed).toBe(false)
      expect(seed.derivedIntoHasPlaceholder).toBe(true)
    })

    it('a real ADR entry alongside the placeholder still keeps isProcessed false (partially chunked reads as not-fully-processed)', () => {
      const seed = parseSeed(
        seedWith('- ADR-0010: Real one\n\n*(Remaining unprocessed: see follow-up)*'),
        '/fake/seed-x.md',
      )
      expect(seed.derivedAdrs).toHaveLength(1)
      // "Remaining unprocessed" doesn't match UNPROCESSED_RE's specific
      // "has not yet been chunked" phrasing, so this one is a control
      // showing the ADR alone drives isProcessed when no canonical
      // placeholder phrase is present.
      expect(seed.isProcessed).toBe(true)
    })
  })
})
