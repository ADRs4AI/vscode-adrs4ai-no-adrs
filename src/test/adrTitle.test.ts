/**
 * Title-prefix cleaning — regression tests.
 *
 * Nit (Jérémie, 2026-07-14, system3): `# ADR 0033 — Team-completism...`
 * rendered as "ADR-0033: — Team-completism..." because the display cleaner
 * knew ":", "-", and whitespace as separators but not the en/em dashes
 * models routinely emit. The cleaner also existed as two identical inline
 * copies (tree + panel); it now lives once in parser/adrTitle.ts.
 */

import { describe, it, expect } from 'vitest'
import { stripAdrNumberPrefix, normalizeDateForTitle } from '../parser/adrTitle'

describe('stripAdrNumberPrefix', () => {
  describe('Regression tests', () => {
    it('em-dash separator — the real system3 ADR-0033 title (2026-07-14 nit)', () => {
      expect(stripAdrNumberPrefix('ADR 0033 — Team-completism: capture admin atoms for Claude Team / org accounts'))
        .toBe('Team-completism: capture admin atoms for Claude Team / org accounts')
    })

    it('colon separator — the real system3 ADR-0032 title, already working, pinned', () => {
      expect(stripAdrNumberPrefix('ADR 0032: Projects vs Custom Assistants Ontology'))
        .toBe('Projects vs Custom Assistants Ontology')
    })

    it('en-dash separator, and en-dash in the ADR/number joint', () => {
      expect(stripAdrNumberPrefix('ADR 0031 – Domain plan')).toBe('Domain plan')
      expect(stripAdrNumberPrefix('ADR–0031: Domain plan')).toBe('Domain plan')
    })
  })

  it('hyphen and space forms keep working', () => {
    expect(stripAdrNumberPrefix('ADR-0001: Storage')).toBe('Storage')
    expect(stripAdrNumberPrefix('adr 001 - lowercase and hyphen')).toBe('lowercase and hyphen')
  })

  it('titles without the prefix pass through untouched; a mid-title dash is never a separator', () => {
    expect(stripAdrNumberPrefix('Recall-first question detection — once and for all'))
      .toBe('Recall-first question detection — once and for all')
  })

  it('a title that IS just the prefix falls back to itself rather than emptying', () => {
    expect(stripAdrNumberPrefix('ADR 0031:')).toBe('ADR 0031:')
  })
})

describe('normalizeDateForTitle', () => {
  describe('Regression tests (QST-DETECTION-LEDGER row 25, Gleaner 5 / HQ meta-repo founder Report, 2026-07-31)', () => {
    it('the real specimen: a trailing parenthetical annotation is stripped for the title, leaving just the date', () => {
      expect(normalizeDateForTitle('2026-07-29 (dictated overnight, pre-sleep; captured same night)'))
        .toBe('2026-07-29')
    })
  })

  it('a bare YYYY-MM-DD date passes through unchanged', () => {
    expect(normalizeDateForTitle('2026-07-29')).toBe('2026-07-29')
  })

  it('a date string that does not start with YYYY-MM-DD falls back to itself — never hides content that does not fit the pattern', () => {
    expect(normalizeDateForTitle('sometime in July')).toBe('sometime in July')
  })

  it('an annotation with its own parentheses/nested content is still stripped, since only the leading date prefix is kept', () => {
    expect(normalizeDateForTitle('2026-07-29 (approx — see thread for the real timeline (2026-07-28 to -30))'))
      .toBe('2026-07-29')
  })
})
