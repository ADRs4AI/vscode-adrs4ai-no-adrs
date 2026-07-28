/**
 * tour-lint core tests. Same lightweight ctx-construction pattern as
 * tourIndex.test.ts's makeCtx() — real parseAdr output through
 * createRepositoryContextAdapter, no filesystem/CompositeIndex needed,
 * since lintTours() only depends on the RepositoryContext boundary.
 *
 * Context: Facet 5's dispatch (docs/inbox/2026-07-28-0507-...) — a broken
 * cross-repo tour Jérémie hit live, 5 of 7 refs pointing at handles that
 * were never actually added.
 */

import { describe, it, expect } from 'vitest'
import { parseAdr } from '../parser/extractor'
import { createRepositoryContextAdapter } from '../index/repositoryContextAdapter'
import { parseTourFile } from '../index/tourIndex'
import { lintTours } from '../index/tourLint'

const ADR_TWO_QUESTIONS = `# ADR-0001: Storage backend

- **Status**: Draft

## Questions

### QST: Which database?
- Status: unanswered

### QST: Which host?
- Status: answered

**ANS:** (by Jérémie)
AWS.
`

function makeCtx() {
  const adr = parseAdr(ADR_TWO_QUESTIONS, '/fake/root/docs/adr/0001-storage.md')
  return createRepositoryContextAdapter({ allAdrs: () => [adr], allSeeds: () => [] })
}

function tourWith(refs: string[], overrides: Partial<{ retired: boolean }> = {}) {
  const json = JSON.stringify({
    schema: 'question-tour/1',
    title: 'Specimen tour',
    author: { name: 'Test' },
    minted_at: '2026-07-28T00:00:00Z',
    retired: overrides.retired ?? false,
    entries: refs.map(ref => ({ ref })),
  })
  const tour = parseTourFile('/fake/root/docs/adr/tours/specimen.tour.json', json)
  if (!tour) throw new Error('test fixture failed to parse — fix the fixture, not the assertion')
  return tour
}

describe('lintTours', () => {
  it('a tour whose every ref resolves to a question produces zero findings', () => {
    const tour = tourWith(['adr:0001#qst-which-database', 'adr:0001#qst-which-host'])
    const result = lintTours([{ tour, namespace: 'project' }], makeCtx())
    expect(result.toursChecked).toBe(1)
    expect(result.findings).toEqual([])
  })

  it('a ref that never resolves (the incident: a handle picked but never added) is an ERROR finding', () => {
    const tour = tourWith(['adr:0001#qst-never-added-this-handle'])
    const result = lintTours([{ tour, namespace: 'project' }], makeCtx())
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      severity: 'error',
      ref: 'adr:0001#qst-never-added-this-handle',
      tourSlug: 'specimen',
    })
    expect(result.findings[0].message).toContain('not_found')
  })

  it('a ref that resolves but not to a question (a whole ADR) is a WARNING, not an error — plausible tour design, not necessarily a mistake', () => {
    const tour = tourWith(['adr:0001'])
    const result = lintTours([{ tour, namespace: 'project' }], makeCtx())
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].severity).toBe('warning')
    expect(result.findings[0].message).toContain('adr')
  })

  it('mirrors the real incident: mostly-broken refs, one real one — errors and a clean ref coexist in the same tour', () => {
    const tour = tourWith([
      'adr:0001#qst-which-database', // real
      'adr:0001#qst-a-typo-nobody-caught',
      'adr:0001#qst-another-never-added-handle',
    ])
    const result = lintTours([{ tour, namespace: 'project' }], makeCtx())
    expect(result.findings).toHaveLength(2)
    expect(result.findings.every(f => f.severity === 'error')).toBe(true)
  })

  it('a retired tour is still linted, and its findings say so', () => {
    const tour = tourWith(['adr:0001#qst-gone'], { retired: true })
    const result = lintTours([{ tour, namespace: 'project' }], makeCtx())
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].retired).toBe(true)
  })

  it('no tours at all is zero findings, not a crash', () => {
    const result = lintTours([], makeCtx())
    expect(result.toursChecked).toBe(0)
    expect(result.findings).toEqual([])
  })
})
