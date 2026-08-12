/**
 * ADR-0041 axis-1 seed lifecycle classification (ratified 2026-08-12).
 * Founding complaint the classification exists to fix: 21/22 seeds
 * showed the same wrench glyph. These tests pin the actual decision
 * boundaries (declared closed-family > chunked > staleness-as-rendering),
 * not Naturalist's full research taxonomy — the ADR's Decision items are
 * the spec.
 */

import { describe, it, expect } from 'vitest'
import { closedFamilyToken, classifySeedAxis1 } from '../views/seedLifecycle'

describe('closedFamilyToken', () => {
  it('recognizes all three declared closed-family tokens, case-insensitively', () => {
    expect(closedFamilyToken('parked')).toBe('parked')
    expect(closedFamilyToken('SUPERSEDED')).toBe('superseded')
    expect(closedFamilyToken('Terminated')).toBe('terminated')
  })

  it('tolerates a trailing annotation after the leading token', () => {
    expect(closedFamilyToken('TERMINATED — duplicate capture, merged 2026-07-28')).toBe('terminated')
    expect(closedFamilyToken('parked — waiting on ADR-0021')).toBe('parked')
  })

  it('is bold-tolerant', () => {
    expect(closedFamilyToken('**parked**')).toBe('parked')
  })

  it('is undefined for undeclared or non-closed-family status', () => {
    expect(closedFamilyToken(undefined)).toBeUndefined()
    expect(closedFamilyToken('growing')).toBeUndefined()
    expect(closedFamilyToken('CRITICAL')).toBeUndefined()
  })

  it('a passing mention mid-sentence does not count — leading-token-strict', () => {
    expect(closedFamilyToken('This work is not parked, just quiet')).toBeUndefined()
  })
})

describe('classifySeedAxis1', () => {
  it('declared closed-family always wins, regardless of isProcessed or age', () => {
    expect(classifySeedAxis1({ status: 'parked', isProcessed: true }, 200, 14)).toBe('parked')
    expect(classifySeedAxis1({ status: 'superseded', isProcessed: false }, undefined, 14)).toBe('superseded')
    expect(classifySeedAxis1({ status: 'TERMINATED — done', isProcessed: false }, 0, 14)).toBe('terminated')
  })

  it('chunked (isProcessed) when no closed-family status is declared', () => {
    expect(classifySeedAxis1({ isProcessed: true }, 100, 14)).toBe('chunked')
  })

  it('unchunked and recently active is "iterating"', () => {
    expect(classifySeedAxis1({ isProcessed: false }, 5, 14)).toBe('iterating')
  })

  it('unchunked and past the threshold is "dormant" — a RENDERING state, not a new token', () => {
    expect(classifySeedAxis1({ isProcessed: false }, 20, 14)).toBe('dormant')
  })

  it('exactly at the threshold is still "iterating" — matches isStale\'s own strict-greater-than boundary', () => {
    expect(classifySeedAxis1({ isProcessed: false }, 14, 14)).toBe('iterating')
  })

  it('no measurable activity at all reads as "iterating", never "dormant" — absence isn\'t evidence of quiet', () => {
    expect(classifySeedAxis1({ isProcessed: false }, undefined, 14)).toBe('iterating')
  })
})
