/**
 * Falsification check, routed by Riddle 5 (Flint + Docent), 2026-09-02:
 * Cartographer's 08-24 hypothesis that tour stop 2
 * (seed:2026-08-08-how-jérémie-gets-started#qst-anthony-inseed) fails to
 * resolve because slugify() deletes non-ASCII while getSeed() matches
 * against preserved filenames.
 *
 * Verified by static read first (getSeed() in repositoryContextAdapter.ts
 * never calls slugify() at all — raw filename string comparison) and by
 * a Python Unicode-normalization check (both sides are NFC, byte-identical
 * 0xe9 codepoints — no NFC/NFD mismatch either). This script confirms it
 * end-to-end against the real specimen using the actual shipped code.
 */

import { parseSeed } from '../../src/parser/seedExtractor'
import { createRepositoryContextAdapter } from '../../src/index/repositoryContextAdapter'
import { resolveTourEntries } from '../../src/index/tourIndex'
import * as fs from 'fs'
import * as path from 'path'

const META = '/Users/jlumbroso/Programming/adrs4ai/initial-meta-repository'
const seedPath = path.join(META, 'docs/adr/seed-2026-08-08-how-jérémie-gets-started.md')
const content = fs.readFileSync(seedPath, 'utf-8')
const seed = parseSeed(content, seedPath)

console.log('Parsed seed path:', seed.path)
console.log('Questions found:', seed.questions.map(q => ({ id: q.id, slug: q.slug, text: q.text.slice(0, 40) })))

const ctx = createRepositoryContextAdapter({
  allAdrs: () => [],
  allSeeds: () => [seed],
})

const tourPath = path.join(META, 'docs/adr/tours/2026-08-24-launch-answer-surface.tour.json')
const tour = JSON.parse(fs.readFileSync(tourPath, 'utf-8'))
const stop2 = tour.entries[1] // 0-indexed second entry, the seed stop
console.log('\nStop 2 ref:', stop2.ref)

const resolved = resolveTourEntries({ ...tour, entries: [stop2] }, ctx)
console.log('\nResolution result:', JSON.stringify(resolved, null, 2).slice(0, 800))
