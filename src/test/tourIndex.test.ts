/**
 * TourIndex tests — ADR-0034 (QuestionTours) reference-implementation
 * first slice. Real temp directories for discovery (project convention);
 * real parseAdr output for resolution, via createRepositoryContextAdapter,
 * so entry resolution exercises the actual shared resolver, not a stub.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { parseAdr } from '../parser/extractor'
import { createRepositoryContextAdapter } from '../index/repositoryContextAdapter'
import {
  parseTourFile, discoverTourFiles, resolveTourEntries, isTourDone,
} from '../index/tourIndex'

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

describe('parseTourFile', () => {
  const VALID = JSON.stringify({
    schema: 'question-tour/1',
    title: 'Morning brief',
    author: { name: 'Lamplighter', model: 'claude-opus-4-8', role: 'postman' },
    minted_at: '2026-07-24T13:18:05Z',
    minted_commit: 'abc1234',
    retired: false,
    theme: { background: '#556B2F', foreground: '#F5F5F0' },
    entries: [
      { ref: 'adr:0001#qst-which-database', must_respond: true, disposition: 'decide', comment: 'pick one' },
    ],
  })

  it('parses a well-formed tour file in full', () => {
    const tour = parseTourFile('/fake/tours/2026-07-24-morning-brief.tour.json', VALID)
    expect(tour).not.toBeNull()
    expect(tour!.slug).toBe('2026-07-24-morning-brief')
    expect(tour!.title).toBe('Morning brief')
    expect(tour!.author).toEqual({ name: 'Lamplighter', model: 'claude-opus-4-8', session: undefined, role: 'postman' })
    expect(tour!.theme).toEqual({ background: '#556B2F', foreground: '#F5F5F0' })
    expect(tour!.entries).toHaveLength(1)
    expect(tour!.entries[0]).toEqual({
      ref: 'adr:0001#qst-which-database', must_respond: true, disposition: 'decide', answer_path: undefined, comment: 'pick one',
    })
  })

  it('rejects an unrecognized schema string', () => {
    expect(parseTourFile('/fake/x.tour.json', JSON.stringify({ schema: 'something-else', entries: [] }))).toBeNull()
  })

  it('rejects malformed JSON rather than throwing', () => {
    expect(parseTourFile('/fake/x.tour.json', '{ not json')).toBeNull()
  })

  it('rejects a missing entries array', () => {
    expect(parseTourFile('/fake/x.tour.json', JSON.stringify({ schema: 'question-tour/1' }))).toBeNull()
  })

  it('rejects a JSON array at the root (structurally wrong shape)', () => {
    expect(parseTourFile('/fake/x.tour.json', '[1,2,3]')).toBeNull()
  })

  it('filters out entries with no string ref, keeping the rest', () => {
    const tour = parseTourFile('/fake/x.tour.json', JSON.stringify({
      schema: 'question-tour/1', entries: [{ ref: 'adr:0001#a' }, { comment: 'no ref, dropped' }, { ref: 42 }],
    }))
    expect(tour!.entries).toHaveLength(1)
    expect(tour!.entries[0].ref).toBe('adr:0001#a')
  })

  it('defaults title to the slug and author name to "unknown" when absent', () => {
    const tour = parseTourFile('/fake/tours/2026-07-24-untitled.tour.json', JSON.stringify({ schema: 'question-tour/1', entries: [] }))
    expect(tour!.title).toBe('2026-07-24-untitled')
    expect(tour!.author.name).toBe('unknown')
  })

  // Regression (Facet's live-tour report, 2026-07-28 inbox 0732): ADR-0034
  // Iteration 4 renamed `required` to `must_respond` before any
  // implementation existed, but at least one real tour was minted under
  // the old name — its entries were silently getting must_respond's
  // always-true default, since the field this code checked was always
  // absent on them.
  it('tolerates the pre-rename "required" field when "must_respond" is absent', () => {
    const tour = parseTourFile('/fake/x.tour.json', JSON.stringify({
      schema: 'question-tour/1', entries: [{ ref: 'adr:0001#a', required: false }],
    }))
    expect(tour!.entries[0].must_respond).toBe(false)
  })

  it('"must_respond" wins when both the old and new field names are present', () => {
    const tour = parseTourFile('/fake/x.tour.json', JSON.stringify({
      schema: 'question-tour/1', entries: [{ ref: 'adr:0001#a', required: false, must_respond: true }],
    }))
    expect(tour!.entries[0].must_respond).toBe(true)
  })

  it('neither field present leaves must_respond undefined (resolveTourEntries defaults it to true)', () => {
    const tour = parseTourFile('/fake/x.tour.json', JSON.stringify({
      schema: 'question-tour/1', entries: [{ ref: 'adr:0001#a' }],
    }))
    expect(tour!.entries[0].must_respond).toBeUndefined()
  })
})

describe('discoverTourFiles', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-index-test-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns [] when the tours directory does not exist', () => {
    expect(discoverTourFiles(path.join(dir, 'docs', 'adr'))).toEqual([])
  })

  it('discovers .tour.json files, sorted by slug', () => {
    const toursDir = path.join(dir, 'docs', 'adr', 'tours')
    fs.mkdirSync(toursDir, { recursive: true })
    fs.writeFileSync(path.join(toursDir, '2026-07-25-second.tour.json'), JSON.stringify({ schema: 'question-tour/1', entries: [] }))
    fs.writeFileSync(path.join(toursDir, '2026-07-24-first.tour.json'), JSON.stringify({ schema: 'question-tour/1', entries: [] }))

    const found = discoverTourFiles(path.join(dir, 'docs', 'adr'))
    expect(found.map(t => t.slug)).toEqual(['2026-07-24-first', '2026-07-25-second'])
  })

  it('skips a corrupt tour file without losing the others', () => {
    const toursDir = path.join(dir, 'docs', 'adr', 'tours')
    fs.mkdirSync(toursDir, { recursive: true })
    fs.writeFileSync(path.join(toursDir, '2026-07-24-good.tour.json'), JSON.stringify({ schema: 'question-tour/1', entries: [] }))
    fs.writeFileSync(path.join(toursDir, '2026-07-24-corrupt.tour.json'), '{ not json')

    const found = discoverTourFiles(path.join(dir, 'docs', 'adr'))
    expect(found.map(t => t.slug)).toEqual(['2026-07-24-good'])
  })

  it('ignores non-.tour.json files in the same directory', () => {
    const toursDir = path.join(dir, 'docs', 'adr', 'tours')
    fs.mkdirSync(toursDir, { recursive: true })
    fs.writeFileSync(path.join(toursDir, 'README.md'), 'not a tour')
    expect(discoverTourFiles(path.join(dir, 'docs', 'adr'))).toEqual([])
  })
})

describe('resolveTourEntries + isTourDone (doctrine 1: facts read live, doctrine — doneness from must_respond only)', () => {
  it('resolves a question ref to live facts, not a snapshot', () => {
    const tour = parseTourFile('/fake/x.tour.json', JSON.stringify({
      schema: 'question-tour/1', entries: [{ ref: 'adr:0001#qst-which-database', comment: 'pick one' }],
    }))!
    const resolved = resolveTourEntries(tour, makeCtx())
    expect(resolved).toHaveLength(1)
    expect(resolved[0].resolution.kind).toBe('question')
    if (resolved[0].resolution.kind === 'question') {
      expect(resolved[0].resolution.question.isAnswered).toBe(false)
    }
    expect(resolved[0].comment).toBe('pick one')
  })

  it('a broken reference resolves to a structured error, not a thrown exception', () => {
    const tour = parseTourFile('/fake/x.tour.json', JSON.stringify({
      schema: 'question-tour/1', entries: [{ ref: 'adr:9999#nope' }],
    }))!
    const resolved = resolveTourEntries(tour, makeCtx())
    expect(resolved[0].resolution.kind).toBe('error')
  })

  it('must_respond omitted defaults to true', () => {
    const tour = parseTourFile('/fake/x.tour.json', JSON.stringify({
      schema: 'question-tour/1', entries: [{ ref: 'adr:0001#qst-which-database' }],
    }))!
    const resolved = resolveTourEntries(tour, makeCtx())
    expect(resolved[0].mustRespond).toBe(true)
  })

  it('a tour is done when every must_respond entry resolves to an answered question', () => {
    const tour = parseTourFile('/fake/x.tour.json', JSON.stringify({
      schema: 'question-tour/1',
      entries: [
        { ref: 'adr:0001#qst-which-host', must_respond: true }, // answered
        { ref: 'adr:0001#qst-which-database', must_respond: false }, // unanswered but optional
      ],
    }))!
    const resolved = resolveTourEntries(tour, makeCtx())
    expect(isTourDone(resolved)).toBe(true)
  })

  it('an unanswered must_respond entry keeps the tour open', () => {
    const tour = parseTourFile('/fake/x.tour.json', JSON.stringify({
      schema: 'question-tour/1', entries: [{ ref: 'adr:0001#qst-which-database', must_respond: true }],
    }))!
    const resolved = resolveTourEntries(tour, makeCtx())
    expect(isTourDone(resolved)).toBe(false)
  })

  it('a broken must_respond reference keeps the tour open — can\'t confirm done what can\'t be found', () => {
    const tour = parseTourFile('/fake/x.tour.json', JSON.stringify({
      schema: 'question-tour/1', entries: [{ ref: 'adr:9999#nope', must_respond: true }],
    }))!
    const resolved = resolveTourEntries(tour, makeCtx())
    expect(isTourDone(resolved)).toBe(false)
  })

  it('a tour with zero must_respond entries is vacuously done', () => {
    const tour = parseTourFile('/fake/x.tour.json', JSON.stringify({
      schema: 'question-tour/1', entries: [{ ref: 'adr:0001#qst-which-database', must_respond: false }],
    }))!
    const resolved = resolveTourEntries(tour, makeCtx())
    expect(isTourDone(resolved)).toBe(true)
  })

  it('an empty tour is vacuously done', () => {
    const tour = parseTourFile('/fake/x.tour.json', JSON.stringify({ schema: 'question-tour/1', entries: [] }))!
    expect(isTourDone(resolveTourEntries(tour, makeCtx()))).toBe(true)
  })
})
