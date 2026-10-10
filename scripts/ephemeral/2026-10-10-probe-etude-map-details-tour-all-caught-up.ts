/**
 * Context: a SECOND "all caught up" founder Report on a brand-new tour
 * (companion etude, 2026-10-10T22:39:38Z), this time on
 * `tours/2026-10-10-map-details.tour.json` (single entry, must_respond:
 * true — NOT the vacuous-doneness class fixed same-day in v0.7.122/
 * v0.7.123, per 38e10b1's own finding that doneness never gated panel
 * content anyway, only a cosmetic label). extensionVersion on the
 * Report is 0.7.123 — already past both doneness fixes. Running the
 * same two-stage check as the first incident to see if this is the
 * same reload-timing fluke recurring, or something new.
 */
import { CompositeIndex } from '../../src/index/compositeIndex'
import { createRepositoryContextAdapter } from '../../src/index/repositoryContextAdapter'
import { resolveTourEntries } from '../../src/index/tourIndex'
import { readFileSync } from 'fs'
import { parseSeed } from '../../src/parser/seedExtractor'

async function main() {
  const seedPath = '/Users/jlumbroso/Programming/system3/companion-thinking-stream-etude/docs/adr/seed-2026-08-08-conversation-map-epistemic-wholeness.md'
  const seed = parseSeed(readFileSync(seedPath, 'utf8'), seedPath)
  console.log('seed questions:', seed.questions.length)
  for (const q of seed.questions) {
    console.log('  -', q.text, '| slug:', q.slug, '| aliasSlug:', q.aliasSlug, '| isAnswered:', q.isAnswered)
  }

  const workspaceRoot = '/Users/jlumbroso/Programming/system3/companion-thinking-stream-etude'
  const composite = await CompositeIndex.fromWorkspace(workspaceRoot, { adrDirRel: 'docs/adr' })
  console.log('all tours found:', composite.allTours().map(t => t.tour.slug))

  const slug = '2026-10-10-map-details'
  const found = composite.findTour(slug)
  console.log('findTour result:', found ? 'FOUND' : 'NOT FOUND')
  if (!found) return

  const resolved = resolveTourEntries(found.tour, createRepositoryContextAdapter(composite))
  for (const entry of resolved) {
    console.log('---')
    console.log('ref:', entry.ref)
    console.log('resolution.kind:', entry.resolution.kind)
    if (entry.resolution.kind === 'error') console.log('error:', entry.resolution.message)
    if (entry.resolution.kind === 'question') console.log('question text:', entry.resolution.question.text, '| isAnswered:', entry.resolution.question.isAnswered)
  }
}

main()

// OUTCOME (2026-10-10): identical result to the first incident — the real
// question resolves perfectly via a fresh CompositeIndex + resolveTourEntries,
// despite must_respond: true ruling out the vacuous-doneness class (confirmed
// separately, via 38e10b1's own commit message, that doneness never gated
// panel content anyway — only a cosmetic [done] label). This is now TWO
// corroborating specimens of the same class, both brand-new git-committed
// tours clicked shortly after landing, both clean end-to-end once re-scanned
// fresh. Routed to Docent 5 (Tours owner) as a hardening candidate — not
// built myself, since Docent/Commodore are both actively mid-stream on this
// exact area (two tour-doneness fixes landed in the last 24h) and I'd risk
// colliding with live work rather than helping it.
