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
    })

    it('boundary hyphens stay malformed (recalled + warned), so the grammar keeps clean edges', () => {
      const adr = parseAdr(adrWith('### QST--CORE: Double-hyphen id?'), '/fake/docs/adr/9000-x.md')
      expect(adr.questions).toHaveLength(1)
      expect(adr.parseWarnings.filter(w => w.code === 'MALFORMED_QST_HANDLE_ID')).toHaveLength(1)
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
