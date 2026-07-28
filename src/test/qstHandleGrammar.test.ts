/**
 * QST handle grammar — the 2026-07-16 widening + the malformed-id recall
 * floor (ADR-0032 QST-IDCHARSET, ratified by Jérémie; HQ-paired with HQ
 * ADR-0012, whose original {1,12} no-hyphen charset was designed from
 * lettered ids).
 *
 * Incident: the ADR-0032 register needed topical handles
 * ("STATUS-AUTHORITY") that the grammar rejected, so its own chair invented
 * a counterfeit id-in-title convention ("### QST: CORE — ...") — and worse,
 * a hyphenated handle written against the OLD grammar ("### QST-STATUS-
 * AUTHORITY:") matched no regex anywhere and vanished with zero warnings.
 * The grammar resisting natural use is a format defect (CoffeeScript
 * doctrine); the silent drop is an ADR-0031 recall violation. Both die here.
 */

import { describe, it, expect } from 'vitest'
import { parseAdr } from '../parser/extractor'

function adrWith(heading: string): string {
  return `# ADR 9000: Handle grammar specimen

- **Date**: 2026-07-16
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

## Questions

${heading}

- Status: unanswered

**ANS:**
[Fill this in]
`
}

describe('QST handle grammar (widened 2026-07-16)', () => {
  describe('Regression tests', () => {
    it('interior-hyphen topical ids are handles — the register incident id parses with a clean anchor (QST-IDCHARSET)', () => {
      const adr = parseAdr(adrWith('### QST-STATUS-AUTHORITY: Should Status control isAnswered?'), '/fake/docs/adr/9000-x.md')
      expect(adr.questions).toHaveLength(1)
      expect(adr.questions[0].qstId).toBe('STATUS-AUTHORITY')
      expect(adr.questions[0].slug).toBe('qst-status-authority')
      expect(adr.parseWarnings.filter(w => w.code === 'MALFORMED_QST_HANDLE_ID')).toHaveLength(0)
    })

    it('a handle-shaped heading with a NON-conforming id is recalled with a warning, never silently dropped (the zero-warning vanish, closed)', () => {
      // Underscore id — fails the grammar. Before 2026-07-16 this matched
      // no regex anywhere: no question, no warning, nothing.
      const adr = parseAdr(adrWith('### QST-BAD_CHARS: Does this vanish?'), '/fake/docs/adr/9000-x.md')
      expect(adr.questions).toHaveLength(1)
      expect(adr.questions[0].text).toBe('Does this vanish?')
      const warnings = adr.parseWarnings.filter(w => w.code === 'MALFORMED_QST_HANDLE_ID')
      expect(warnings).toHaveLength(1)
      expect(warnings[0].message).toContain('BADCHARS') // best-effort folded suggestion
      // Regression (found 2026-07-28 investigating Facet's slug-tolerance
      // dispatch, not separately reported): sectionSlug() maintained its
      // OWN independent regex cascade and never learned about
      // QST_HANDLE_MALFORMED_RE when it was added — so this question got a
      // correct `qstId` ("BADCHARS") but slugged via the whole-heading
      // fallback ("qst-bad-chars-does-this-vanish") instead of the clean
      // qstId-derived anchor every other handle form gets. Fixed by making
      // both consumers share one match function (resolveNavHeadingIdentity).
      expect(adr.questions[0].slug).toBe('qst-badchars')
    })

    it('boundary hyphens stay malformed (recalled + warned), so the grammar keeps clean edges', () => {
      const adr = parseAdr(adrWith('### QST--CORE: Double-hyphen id?'), '/fake/docs/adr/9000-x.md')
      expect(adr.questions).toHaveLength(1)
      expect(adr.parseWarnings.filter(w => w.code === 'MALFORMED_QST_HANDLE_ID')).toHaveLength(1)
    })
  })

  describe('Regression tests: spaced-ordinal handles (system3 ADR-0046, 2026-07-19)', () => {
    it('"### QST 1: title" is recalled with full handle semantics + a fix-it warning — eight of these were invisible with zero warnings', () => {
      const adr = parseAdr(adrWith('### QST 1: Delivery ledger — where does it live?'), '/fake/docs/adr/9000-x.md')
      expect(adr.questions).toHaveLength(1)
      expect(adr.questions[0].qstId).toBe('1')
      expect(adr.questions[0].slug).toBe('qst-1')
      const w = adr.parseWarnings.filter(x => x.code === 'NONCANONICAL_NAV_CODE_HEADING')
      expect(w).toHaveLength(1)
      expect(w[0].message).toContain('QST-1:')
    })

    it('a spaced topical id works too, and a prose heading that merely starts with "QST" is not a question', () => {
      const spaced = parseAdr(adrWith('### QST STATUS-AUTHORITY: spaced topical?'), '/fake/docs/adr/9000-x.md')
      expect(spaced.questions[0]?.qstId).toBe('STATUS-AUTHORITY')
      // Multi-word text after "QST " (no immediate colon after one id token)
      // stays a plain heading — the tolerance is for handles, not prose.
      const prose = parseAdr(adrWith('### QST considerations for later review'), '/fake/docs/adr/9000-x.md')
      expect(prose.questions).toHaveLength(0)
    })
  })

  describe('Regression tests: annotated headings (Facet 5, 2026-07-27 — system3-conversations tour breakage)', () => {
    // Before QST_HEADING_ANNOTATED_RE, "### QST (Iteration 2): ..." matched
    // NOTHING in the cascade: not a handle (the parenthetical isn't an
    // alnum id token), not the adjacent-colon nav-code form. Confirmed
    // live: 0 questions, 0 parseWarnings — a total silent drop, worse than
    // the bad-slug bug this was originally reported as (the slug problem
    // only exists once the question is actually recalled at all).
    it('"### QST (Iteration 2): ..." is recalled with a clean, annotation-free slug and a fix-it warning', () => {
      const adr = parseAdr(adrWith('### QST (Iteration 2): Does the cache need a version key?'), '/fake/docs/adr/9000-x.md')
      expect(adr.questions).toHaveLength(1)
      expect(adr.questions[0].text).toBe('Does the cache need a version key?')
      expect(adr.questions[0].qstId).toBeUndefined() // an annotation is not an author-chosen handle id
      expect(adr.questions[0].slug).toBe('qst-does-the-cache-need-a-version-key')
      const w = adr.parseWarnings.filter(x => x.code === 'NONCANONICAL_NAV_CODE_HEADING')
      expect(w).toHaveLength(1)
      expect(w[0].message).toContain('(Iteration 2)')
    })

    it('a hyphen-separated annotation works the same way ("QST-see note above: ...")', () => {
      // Not a malformed HANDLE (QST_HANDLE_MALFORMED_RE's id class excludes
      // whitespace) — "see note above" contains spaces, so this is genuinely
      // the annotated-nav-code path, not the handle path. Distinguishing
      // the two matters: qstId stays undefined here, same as the spaced form.
      const adr = parseAdr(adrWith('### QST-see note above: Does the cache need a version key?'), '/fake/docs/adr/9000-x.md')
      expect(adr.questions).toHaveLength(1)
      expect(adr.questions[0].qstId).toBeUndefined()
      expect(adr.questions[0].slug).toBe('qst-does-the-cache-need-a-version-key')
    })

    it('does not shadow a real handle — "QST-A: title" still resolves via the handle grammar, not the annotated fallback', () => {
      const adr = parseAdr(adrWith('### QST-A: Lettered handle?'), '/fake/docs/adr/9000-x.md')
      expect(adr.questions[0].qstId).toBe('A')
      expect(adr.questions[0].slug).toBe('qst-a')
      expect(adr.parseWarnings.filter(w => w.code === 'NONCANONICAL_NAV_CODE_HEADING')).toHaveLength(0)
    })

    it('does not shadow the spaced-ordinal handle — "QST 1: title" still resolves via the handle grammar', () => {
      const adr = parseAdr(adrWith('### QST 1: Numbered?'), '/fake/docs/adr/9000-x.md')
      expect(adr.questions[0].qstId).toBe('1')
      expect(adr.questions[0].slug).toBe('qst-1')
    })
  })

  it('the original lettered/numeric ids are unchanged (pure widening)', () => {
    for (const [heading, id] of [
      ['### QST-A: Lettered?', 'A'],
      ['### QST-3: Numbered?', '3'],
      ['### QST-JÉRÉMIE: Accents fold?', 'JEREMIE'],
    ] as const) {
      const adr = parseAdr(adrWith(heading), '/fake/docs/adr/9000-x.md')
      expect(adr.questions[0].qstId).toBe(id)
    }
  })

  it('24-char cap holds: a 25-char id is malformed-recalled, a 24-char id is a handle', () => {
    const id24 = 'A'.repeat(24)
    const ok = parseAdr(adrWith(`### QST-${id24}: Long but legal?`), '/fake/docs/adr/9000-x.md')
    expect(ok.questions[0].qstId).toBe(id24)
    expect(ok.parseWarnings.filter(w => w.code === 'MALFORMED_QST_HANDLE_ID')).toHaveLength(0)

    const tooLong = parseAdr(adrWith(`### QST-${'A'.repeat(25)}: One too many?`), '/fake/docs/adr/9000-x.md')
    expect(tooLong.questions).toHaveLength(1)
    expect(tooLong.parseWarnings.filter(w => w.code === 'MALFORMED_QST_HANDLE_ID')).toHaveLength(1)
  })
})
