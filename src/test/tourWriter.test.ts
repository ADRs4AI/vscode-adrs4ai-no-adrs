/**
 * Tour writer tests — ADR-0034 mint-from-filter (doctrine 5: "turn my
 * current filter into a tour").
 */

import { describe, it, expect } from 'vitest'
import { buildTourJson, serializeTourJson, tourFilename, tourFilePath } from '../index/tourWriter'
import { parseTourFile } from '../index/tourIndex'

describe('buildTourJson', () => {
  it('mints every entry with must_respond: true, and nothing else authored', () => {
    const tour = buildTourJson({
      title: 'Morning brief', authorName: 'Jérémie', mintedAt: '2026-07-26T10:00:00Z',
      entries: [{ ref: 'adr:0001#qst-a' }, { ref: 'adr:0002#qst-b' }],
    })
    expect(tour.entries).toEqual([
      { ref: 'adr:0001#qst-a', must_respond: true },
      { ref: 'adr:0002#qst-b', must_respond: true },
    ])
    expect(tour.entries[0]).not.toHaveProperty('disposition')
    expect(tour.entries[0]).not.toHaveProperty('comment')
  })

  it('author is human-role, named from the caller', () => {
    const tour = buildTourJson({ title: 'x', authorName: 'Jérémie', mintedAt: '2026-07-26T10:00:00Z', entries: [] })
    expect(tour.author).toEqual({ name: 'Jérémie', role: 'human' })
  })

  it('omits minted_commit entirely when not provided — never a null/empty placeholder', () => {
    const tour = buildTourJson({ title: 'x', authorName: 'J', mintedAt: '2026-07-26T10:00:00Z', entries: [] })
    expect(tour).not.toHaveProperty('minted_commit')
  })

  it('includes minted_commit when provided', () => {
    const tour = buildTourJson({ title: 'x', authorName: 'J', mintedAt: '2026-07-26T10:00:00Z', mintedCommit: 'abc1234', entries: [] })
    expect(tour.minted_commit).toBe('abc1234')
  })

  it('always mints retired: false and the canonical schema string', () => {
    const tour = buildTourJson({ title: 'x', authorName: 'J', mintedAt: '2026-07-26T10:00:00Z', entries: [] })
    expect(tour.retired).toBe(false)
    expect(tour.schema).toBe('question-tour/1')
  })
})

describe('serializeTourJson + round-trip through parseTourFile', () => {
  it('a minted tour is itself a valid, parseable tour file', () => {
    const tour = buildTourJson({
      title: 'Morning brief', authorName: 'Jérémie', mintedAt: '2026-07-26T10:00:00Z', mintedCommit: 'abc1234',
      entries: [{ ref: 'adr:0001#qst-a' }],
    })
    const text = serializeTourJson(tour)
    const parsed = parseTourFile('/fake/docs/adr/tours/2026-07-26-morning-brief.tour.json', text)
    expect(parsed).not.toBeNull()
    expect(parsed!.title).toBe('Morning brief')
    expect(parsed!.entries).toEqual([{ ref: 'adr:0001#qst-a', must_respond: true, disposition: undefined, answer_path: undefined, comment: undefined }])
  })
})

describe('tourFilename', () => {
  it('slugifies the title and prefixes the date', () => {
    expect(tourFilename('Morning brief — the four things waiting on you', '2026-07-26')).toBe('2026-07-26-morning-brief-the-four-things-waiting-on-you.tour.json')
  })

  it('falls back to "tour" for a title with no alphanumeric characters', () => {
    expect(tourFilename('★★★', '2026-07-26')).toBe('2026-07-26-tour.tour.json')
  })

  it('caps the slug length so filenames stay reasonable', () => {
    // date (11) + up-to-60-char slug + '.tour.json' (10) = 81 max.
    const longTitle = 'a'.repeat(200)
    const name = tourFilename(longTitle, '2026-07-26')
    expect(name.length).toBeLessThanOrEqual(81)
  })
})

describe('tourFilePath', () => {
  it('places the file under <adrDirPath>/tours/', () => {
    expect(tourFilePath('/ws/docs/adr', '2026-07-26-x.tour.json')).toBe('/ws/docs/adr/tours/2026-07-26-x.tour.json')
  })
})
