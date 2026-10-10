/**
 * Context: founder Reports (companion-thinking-stream-etude, 2026-10-10,
 * source=treeview, clickedItemKind=tour-entry) on the brand-new tour
 * `2026-10-10-dechrome-residue.tour.json` (minted by Concertmaster 5):
 * clicking into BOTH entries (qst-header-companion, qst-new-plus-placement)
 * "shows as 'all caught up'" — the empty-state message, not the real
 * question. The seed uses the trailing `(QST-PETNAME)` alias form
 * (`### QST: ... (QST-HEADER-COMPANION)`), and this repo (companion
 * etude) is one of the three live repos in the trailing-alias census
 * this session tracked earlier. Checking whether the alias binds at
 * the parser level before looking anywhere else.
 */
import { readFileSync } from 'fs'
import { parseSeed } from '../../src/parser/seedExtractor'

const path = '/Users/jlumbroso/Programming/system3/companion-thinking-stream-etude/docs/adr/seed-2026-08-07-semi-final-uiux-braindump-dechrome.md'
const seed = parseSeed(readFileSync(path, 'utf8'), path)

console.log('total questions in seed:', seed.questions.length)
for (const q of seed.questions) {
  console.log('---')
  console.log('text:', q.text)
  console.log('slug:', q.slug)
  console.log('aliasSlug:', q.aliasSlug)
  console.log('qstId:', q.qstId)
  console.log('isAnswered:', q.isAnswered)
  console.log('statusText:', q.statusText)
}

// OUTCOME (2026-10-10): both questions parse cleanly — real, unanswered,
// correct aliasSlug matching the tour's refs exactly. Not the phantom/
// dismissed class. Continued in the sibling probe
// (2026-10-10-probe-etude-dechrome-tour-resolution.ts), which runs the
// FULL live path (fresh CompositeIndex + findTour + resolveTourEntries)
// and finds it resolves perfectly too — so the file and the resolution
// logic are both confirmed correct; the founder's "all caught up" is most
// likely a one-off index-staleness/watcher-miss, not a parser or
// resolver defect. Reported to the founder directly with that finding
// and a reload/refresh as the practical remedy, per "diagnose, don't
// guess-fix" — I have no way to reproduce his live window's state.
