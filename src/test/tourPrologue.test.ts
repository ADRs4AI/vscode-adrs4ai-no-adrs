/**
 * The tour prologue — ADR-0034 Iteration 29.
 *
 * Every case here is a shape the corpus will actually produce, or a refusal the
 * doctrine requires. `parsePrologue` is pure on purpose (it ports to
 * docket-core verbatim when the pin lands), so it is tested without fs.
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { parsePrologue, readPrologue } from '../index/tourPrologue'

describe('parsePrologue', () => {
  it('reads the authored grouping claim — the thing no ADR can hold', () => {
    expect(parsePrologue({ rationale: 'These three are the alpha gate.' }))
      .toEqual({ rationale: 'These three are the alpha gate.' })
  })

  it('carries optional context for the reader who has lost the thread entirely', () => {
    // His own framing: "sometimes I completely forgot the ADR in context and
    // the why needed is not good enough."
    expect(parsePrologue({ rationale: 'The two live gates.', context: 'Endgame, wave A.' }))
      .toEqual({ rationale: 'The two live gates.', context: 'Endgame, wave A.' })
  })

  it('a prologue with no rationale is not a prologue — context alone frames nothing', () => {
    expect(parsePrologue({ context: 'Endgame, wave A.' })).toBeUndefined()
  })

  it('treats a whitespace-only rationale as absent, since a minter may leave the key stubbed', () => {
    expect(parsePrologue({ rationale: '   \n  ' })).toBeUndefined()
  })

  it('drops an empty context rather than rendering a blank second paragraph', () => {
    expect(parsePrologue({ rationale: 'Why these.', context: '  ' })).toEqual({ rationale: 'Why these.' })
  })

  it('trims, because a hand-authored JSON string usually carries stray newlines', () => {
    expect(parsePrologue({ rationale: '\n  Why these.  \n' })).toEqual({ rationale: 'Why these.' })
  })

  it('ignores unknown keys — including the numbers It-29 REFUSES to let a prologue carry', () => {
    // Refusal 2: no count, doneness, effort or freshness. If a minter writes
    // one anyway it must be inert, never read, or it becomes a stored value
    // that lies at a glance (It-23's dead index with a shorter fuse).
    const parsed = parsePrologue({ rationale: 'Why these.', open_count: 3, done: true, freshness: '2026-10-11' })
    expect(parsed).toEqual({ rationale: 'Why these.' })
  })

  it('tolerates malformed shapes instead of throwing — a courtesy must never break a walk', () => {
    for (const junk of [undefined, null, 'a string', 42, [], [{ rationale: 'x' }], {}]) {
      expect(parsePrologue(junk)).toBeUndefined()
    }
  })
})

describe('readPrologue', () => {
  let dir: string

  const writeTour = (body: unknown): string => {
    const file = path.join(dir, 'x.tour.json')
    fs.writeFileSync(file, JSON.stringify(body))
    return file
  }

  it('reads the prologue past the frozen parser, which has no field to carry it', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-prologue-'))
    try {
      // The real reason this function takes a PATH: tourIndex.ts is in the
      // Phase-1 moving set and frozen, so TourFile has no prologue field.
      // TourFile.path is the join until the pin lands.
      const file = writeTour({ schema: 'question-tour/1', title: 'T', entries: [], prologue: { rationale: 'Why these.' } })
      expect(readPrologue(file)).toEqual({ rationale: 'Why these.' })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a tour with no prologue reads as undefined — today\'s behavior, unchanged', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-prologue-'))
    try {
      expect(readPrologue(writeTour({ schema: 'question-tour/1', title: 'T', entries: [] }))).toBeUndefined()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a missing or unparseable file is a missing COURTESY, never a missing tour', () => {
    // Every caller already holds the tour (it came from the index), so a
    // failed re-read must not take the walk down with it.
    expect(readPrologue('/nonexistent/nope.tour.json')).toBeUndefined()

    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-prologue-'))
    try {
      const file = path.join(dir, 'bad.tour.json')
      fs.writeFileSync(file, '{ not json')
      expect(readPrologue(file)).toBeUndefined()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
