/**
 * Trailing "(QST-PETNAME)" alias handles — the wild dialect
 *   ### QST: Should the Rust service be a gRPC server too? (QST-RUST-GRPC-SERVER)
 * Founder Report, companion etude, 2026-09-13T22:48Z: "I am curious whether
 * the QST petnames in parenthesis at the end are parsed and part of the
 * metadata?" — they were not (167 headings across 4 repos). Ruled A-amended
 * by Riddle 5, 2026-09-26 (docs/QST-DETECTION-LEDGER.md, six clauses).
 *
 * The clauses these tests pin, each against a real failure it prevents:
 *  1. The alias NEVER changes `id`/`slug` derivation (fossil law: 167 emitted
 *     ids are never re-stamped, and an id must be a pure function of the
 *     heading's bytes — not of which other questions exist).
 *  2. A leading handle outranks a trailing one; two claimants of one petname
 *     bind NEITHER, loudly — never last-wins.
 *  3. One grammar/fold: end-of-line only, handle charset 1–24, the SAME
 *     foldQstId as leading handles, case-insensitive, NFC/NFD-safe.
 *  6. This file: same-day regression tests naming the 09-13 Report.
 *
 * The fixture (zoo-016 + .expected.json) is the cross-surface conformance
 * artifact clause 4 requires — the MCP locator and HQ qst-lint.py must agree
 * with the same expectations.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseAdr } from '../parser/extractor'
import { parseSeed } from '../parser/seedExtractor'
import { serializeAdr } from '../parser/serialize'
import { resolveReference } from '../mcp/reference'
import type { RepositoryContext } from '../mcp/repositoryContext'
import type { AdrFile } from '../parser/types'

const ZOO = resolve(__dirname, 'fixtures/zoo')
const FIXTURE_MD = readFileSync(resolve(ZOO, 'zoo-016-trailing-parenthesized-qst-handle.md'), 'utf8')
const EXPECTED = JSON.parse(readFileSync(resolve(ZOO, 'zoo-016-trailing-parenthesized-qst-handle.expected.json'), 'utf8')) as {
  headings: Array<{ heading: string; slug: string; qstId: string | null; aliasSlug: string | null; displayText: string; warnings: string[] }>
  exactAnchorsThatMustResolve: Record<string, number>
  anchorsNoQuestionOwns: { anchors: string[] }
}
const FIXTURE_PATH = '/fake/docs/adr/0016-trailing-parenthesized-qst-handle.md'

function adrWith(headings: string[]): string {
  return `# ADR 9001: Alias specimen

- **Date**: 2026-09-26
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

## Questions

${headings.map(h => `${h}\n\n- Status: unanswered\n`).join('\n')}
`
}

function ctxFor(adr: AdrFile): RepositoryContext {
  return {
    listAdrs: () => [adr],
    getAdr: (ref: string) => (parseInt(ref.replace(/^adr:/, ''), 10) === adr.number ? adr : undefined),
    listSeeds: () => [],
    getSeed: () => undefined,
    readFile: async () => { throw new Error('not needed') },
    writeFile: async () => { throw new Error('not needed') },
    listFiles: async () => [],
  }
}

describe('Regression tests: trailing (QST-PETNAME) alias handles (founder Report 2026-09-13; ledger ruling 2026-09-26)', () => {
  describe("the founder's own specimen (companion etude ADR-0004)", () => {
    const adr = parseAdr(adrWith(['### QST: Should the Rust service be a gRPC server too? (QST-RUST-GRPC-SERVER)']), '/fake/docs/adr/0004-x.md')
    const q = adr.questions[0]

    it('the petname is now part of the metadata: qstId set, `#qst-rust-grpc-server` is its alias anchor, display text no longer carries it', () => {
      expect(q.qstId).toBe('RUST-GRPC-SERVER')
      expect(q.aliasSlug).toBe('qst-rust-grpc-server')
      expect(q.text).toBe('Should the Rust service be a gRPC server too?')
    })

    it('clause 1 — the canonical id is BYTE-IDENTICAL to what the parser minted before this dialect was recognized (fossil law: emitted ids are never re-stamped)', () => {
      // Pinned verbatim from the pre-recognition probe (2026-09-26) — this
      // string is what the 167 wild refs may already hold.
      expect(q.id).toBe('adr-0004-qst-should-the-rust-service-be-a-grpc-server-too-qst-rust-grpc-server')
      expect(q.slug).toBe('qst-should-the-rust-service-be-a-grpc-server-too-qst-rust-grpc-server')
    })

    it('`adr:0004#qst-rust-grpc-server` now resolves EXACTLY to the question (it could not before), and the old long slug still does', () => {
      const ctx = ctxFor(adr)
      for (const anchor of ['qst-rust-grpc-server', q.slug]) {
        const r = resolveReference(ctx, `adr:0004#${anchor}`)
        expect(r.kind).toBe('question')
        if (r.kind === 'question') expect(r.question.id).toBe(q.id)
      }
    })

    it('the alias is also an addressable deep link', () => {
      expect(adr.deepLinks.some(l => l.type === 'question' && l.slug === 'qst-rust-grpc-server')).toBe(true)
    })
  })

  describe('cross-surface conformance fixture (zoo-016 + .expected.json — the file MCP locator and qst-lint.py must also satisfy)', () => {
    const adr = parseAdr(FIXTURE_MD, FIXTURE_PATH)

    it('there is one expectation per real heading, in document order', () => {
      expect(adr.questions).toHaveLength(EXPECTED.headings.length)
    })

    it.each(EXPECTED.headings.map((h, i) => [i, h.heading, h] as const))('#%i %s', (i, _label, want) => {
      const q = adr.questions[i]
      expect(q.slug).toBe(want.slug)
      expect(q.id).toBe(`adr-0016-${want.slug}`)
      expect(q.qstId ?? null).toBe(want.qstId)
      expect(q.aliasSlug ?? null).toBe(want.aliasSlug)
      expect(q.text).toBe(want.displayText)
      const codes = adr.parseWarnings.filter(w => w.line === q.lineStart && w.code === 'ALIAS_HANDLE_COLLISION').map(w => w.code)
      expect([...new Set(codes)]).toEqual(want.warnings)
    })

    it('every anchor the fixture says must resolve, resolves — to the expected heading, exact-match', () => {
      const ctx = ctxFor(adr)
      for (const [anchor, idx] of Object.entries(EXPECTED.exactAnchorsThatMustResolve)) {
        const r = resolveReference(ctx, `adr:0016#${anchor}`)
        expect(r.kind, anchor).toBe('question')
        if (r.kind === 'question') expect(r.question.id, anchor).toBe(adr.questions[idx].id)
      }
    })

    it('anchors nobody legitimately owns are owned by no question (ambiguity refuses; leading outranks; mid-text is content)', () => {
      for (const anchor of EXPECTED.anchorsNoQuestionOwns.anchors) {
        expect(adr.questions.some(q => q.slug === anchor || q.aliasSlug === anchor), anchor).toBe(false)
      }
    })

    it('round-trip fidelity is untouched — headingRaw keeps every trailing petname byte-for-byte', () => {
      expect(serializeAdr(adr)).toBe(FIXTURE_MD)
    })
  })

  describe('clause 1 — id derivation is a pure function of the heading bytes', () => {
    it('the same heading gets the same id whether its petname BINDS (alone) or is REFUSED (a second claimant appears)', () => {
      const h = '### QST: Which store do we use? (QST-STORE)'
      const alone = parseAdr(adrWith([h]), '/fake/docs/adr/9001-x.md').questions[0]
      const contested = parseAdr(adrWith([h, '### QST: Which cache do we use? (QST-STORE)']), '/fake/docs/adr/9001-x.md').questions[0]
      expect(alone.aliasSlug).toBe('qst-store')
      expect(contested.aliasSlug).toBeUndefined()
      expect(contested.id).toBe(alone.id)
    })
  })

  describe('clause 2 — collision law (AMENDED 2026-09-26 on the real etude-0058 specimen: a leading handle always owns identity, but a trailing petname on the SAME heading is now ALWAYS ALSO a secondary alias — refusal survives only against ANOTHER heading\'s own identity)', () => {
    it('a leading handle keeps owning qstId/id, AND a trailing petname on the same heading binds as a secondary alias — cleanly, no diagnostic (the real specimen this amendment was ruled for: "### QST-1: … (QST-PEEK-TASKFIT)")', () => {
      const adr = parseAdr(adrWith(['### QST-A: Which one wins? (QST-B)']), '/fake/docs/adr/9001-x.md')
      const q = adr.questions[0]
      expect(q.qstId).toBe('A') // leading handle still owns identity
      expect(q.slug).toBe('qst-a') // id still unchanged by the petname
      expect(q.aliasSlug).toBe('qst-b') // AND the petname binds as a secondary alias
      expect(q.text).toBe('Which one wins?') // stripped from display, same as any other bound alias
      expect(adr.parseWarnings.filter(w => w.code === 'ALIAS_HANDLE_COLLISION')).toHaveLength(0)
      const r = resolveReference(ctxFor(adr), 'adr:9001#qst-b')
      expect(r.kind === 'question' && r.question.id === q.id).toBe(true)
    })

    it('two questions claiming one petname bind NEITHER — loud on both, never last-wins', () => {
      const adr = parseAdr(adrWith(['### QST: First? (QST-SAME)', '### QST: Second? (QST-SAME)']), '/fake/docs/adr/9001-x.md')
      expect(adr.questions.map(q => q.aliasSlug)).toEqual([undefined, undefined])
      expect(adr.questions.map(q => q.text)).toEqual(['First? (QST-SAME)', 'Second? (QST-SAME)'])
      expect(adr.parseWarnings.filter(w => w.code === 'ALIAS_HANDLE_COLLISION')).toHaveLength(2)
      // …and the ref therefore can't silently pick one:
      const r = resolveReference(ctxFor(adr), 'adr:9001#qst-same')
      expect(r.kind === 'question' && r.question.aliasSlug === 'qst-same').toBe(false)
    })

    it("a trailing petname can never shadow another question's own leading handle, in either document order", () => {
      for (const order of [
        ['### QST-OWN: The owner?', '### QST: The claimant? (QST-OWN)'],
        ['### QST: The claimant? (QST-OWN)', '### QST-OWN: The owner?'],
      ]) {
        const adr = parseAdr(adrWith(order), '/fake/docs/adr/9001-x.md')
        const owner = adr.questions.find(q => q.slug === 'qst-own')!
        const claimant = adr.questions.find(q => q.slug !== 'qst-own')!
        expect(owner.qstId).toBe('OWN')
        expect(claimant.aliasSlug).toBeUndefined()
        const r = resolveReference(ctxFor(adr), 'adr:9001#qst-own')
        expect(r.kind === 'question' && r.question.id === owner.id).toBe(true)
      }
    })

    it('a petname equal to another question\'s @adr-anchor is refused too', () => {
      const doc = `# ADR 9001: x

- **Status**: Draft

## Questions

### QST: Anchored explicitly?

<!-- @adr-anchor: qst-taken -->

- Status: unanswered

### QST: Wants that anchor? (QST-TAKEN)

- Status: unanswered
`
      const adr = parseAdr(doc, '/fake/docs/adr/9001-x.md')
      expect(adr.questions[1].aliasSlug).toBeUndefined()
      expect(adr.parseWarnings.some(w => w.code === 'ALIAS_HANDLE_COLLISION')).toBe(true)
    })
  })

  describe('clause 3 — one grammar, one fold', () => {
    it('reads case-insensitively: "(qst-store)" binds as STORE', () => {
      const q = parseAdr(adrWith(['### QST: Which store? (qst-store)']), '/fake/docs/adr/9001-x.md').questions[0]
      expect(q.qstId).toBe('STORE')
      expect(q.aliasSlug).toBe('qst-store')
    })

    it('a mid-text parenthetical stays content — end-of-line only', () => {
      const q = parseAdr(adrWith(['### QST: Is (QST-MID) a handle here?']), '/fake/docs/adr/9001-x.md').questions[0]
      expect(q.aliasSlug).toBeUndefined()
      expect(q.text).toBe('Is (QST-MID) a handle here?')
    })

    it('outside the handle grammar (over 24 chars, boundary hyphen, bad chars) it stays content, exactly as before the dialect was recognized', () => {
      for (const bad of ['(QST-THIS-PETNAME-IS-FAR-TOO-LONG-FOR-THE-GRAMMAR)', '(QST--LEADING)', '(QST-TRAILING-)', '(QST-BAD_CHARS)']) {
        const q = parseAdr(adrWith([`### QST: Question text? ${bad}`]), '/fake/docs/adr/9001-x.md').questions[0]
        expect(q.aliasSlug, bad).toBeUndefined()
        expect(q.qstId, bad).toBeUndefined()
        expect(q.text, bad).toBe(`Question text? ${bad}`)
      }
    })

    it('accented petnames fold through the SAME path as leading handles, NFC- or NFD-typed alike', () => {
      const nfc = 'JÉRÉMIE'
      const nfd = nfc.normalize('NFD')
      expect(nfc).not.toBe(nfd) // the point of the test: different bytes
      const leading = parseAdr(adrWith([`### QST-${nfc}: Same person?`]), '/fake/docs/adr/9001-x.md').questions[0]
      for (const petname of [nfc, nfd]) {
        const q = parseAdr(adrWith([`### QST: Same person? (QST-${petname})`]), '/fake/docs/adr/9001-x.md').questions[0]
        expect(q.qstId).toBe(leading.qstId)
        expect(q.aliasSlug).toBe(leading.slug)
        expect(q.text).toBe('Same person?')
      }
    })

    it('does not touch other nav codes — only questions get the handle grammar', () => {
      const doc = adrWith(['### NOT: A note (QST-NOTE)'])
      const adr = parseAdr(doc, '/fake/docs/adr/9001-x.md')
      expect(adr.questions).toHaveLength(0)
    })
  })

  describe('seeds get the identical recognition (one substrate, two container kinds)', () => {
    const seedDoc = `# SEED: Petname specimen

- **Date**: 2026-09-26
- **From**: Test

## Brain Dump

Something.

### QST: Should the seed carry a petname? (QST-SEED-PET)

- Status: unanswered

### QST: A dup? (QST-DUPE)

- Status: unanswered

### QST: Another dup? (QST-DUPE)

- Status: unanswered

## Derived Into

*(This seed has not yet been chunked into ADRs)*
`
    const seed = parseSeed(seedDoc, '/fake/docs/adr/seed-2026-09-26-petname.md')

    it('binds a lone petname and strips it from display, id unchanged', () => {
      const q = seed.questions[0]
      expect(q.aliasSlug).toBe('qst-seed-pet')
      expect(q.qstId).toBe('SEED-PET')
      expect(q.text).toBe('Should the seed carry a petname?')
      expect(q.id).toBe('seed-2026-09-26-petname-qst-should-the-seed-carry-a-petname-qst-seed-pet')
    })

    it('refuses a shared petname on both claimants, loudly', () => {
      expect(seed.questions[1].aliasSlug).toBeUndefined()
      expect(seed.questions[2].aliasSlug).toBeUndefined()
      expect(seed.parseWarnings.filter(w => w.code === 'ALIAS_HANDLE_COLLISION')).toHaveLength(2)
    })

    it('`seed:<slug>#qst-seed-pet` resolves to the question', () => {
      const ctx: RepositoryContext = {
        listAdrs: () => [],
        getAdr: () => undefined,
        listSeeds: () => [seed],
        getSeed: (ref: string) => (ref.replace(/^seed:/, '') === '2026-09-26-petname' ? seed : undefined),
        readFile: async () => { throw new Error('not needed') },
        writeFile: async () => { throw new Error('not needed') },
        listFiles: async () => [],
      }
      const r = resolveReference(ctx, 'seed:2026-09-26-petname#qst-seed-pet')
      expect(r.kind).toBe('question')
      if (r.kind === 'question') expect(r.question.id).toBe(seed.questions[0].id)
    })
  })
})
