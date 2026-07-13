// Context: DEBRIEF (Lapidary 5, 2026-07-13 0450 reframe) — hard-wrap
// robustness charter. Checks how much of Athanor's ORIGINAL wrapped
// inbox-alchemy 0021 (pre-unwrap commit 031dacf, fetched via git show
// 031dacf^:docs/adr/0021-...md) the current parser already recalls, before
// any extractor changes, to establish what's actually broken vs. already
// working (the existing multi-line field continuation logic covers
// *indented* wraps for Why-asking/Need; unclear if it covers everything
// Lapidary's brief worries about).
//
// To regenerate the input file this script reads:
//   cd ~/Programming/inbox-alchemy && git show 031dacf^:docs/adr/0021-crew-architecture-and-staffing.md > /tmp/0021-wrapped-original.md
//
// OUTCOME (2026-07-13): confirmed whyAsking/need already unwrap correctly
// (pre-existing indented-continuation logic in extractQuestion()), but
// recommendation.text and rawBody/rawBodyPost retained raw embedded "\n"s
// from the hard-wrapped source — the exact input that broke the panel's
// list rendering (Option B's continuation "bleeding out of its bullet").
// Re-ran after adding src/parser/hardwrap.ts's unwrapListItems/
// unwrapParagraphs and wiring them into rawBody/rawBodyPost/recommendation
// construction: both fields now come out as single joined lines. Informed
// the fix in extractor.ts; not itself part of the shipped fix.
import { readFileSync } from 'node:fs'
import { parseAdr } from '../../src/parser/extractor.ts'

const content = readFileSync('/tmp/0021-wrapped-original.md', 'utf8')
const adr = parseAdr(content, '/fake/docs/adr/0021-crew-architecture-and-staffing.md')

console.log('questions found:', adr.questions.length)
for (const q of adr.questions) {
  console.log('---')
  console.log('text:', q.text)
  console.log('isAnswered:', q.isAnswered)
  console.log('whyAsking:', JSON.stringify(q.whyAsking))
  console.log('need:', JSON.stringify(q.need))
  console.log('recommendations:', JSON.stringify(q.recommendations, null, 2))
  console.log('rawBody:', JSON.stringify(q.rawBody))
}
console.log('parseWarnings:', JSON.stringify(adr.parseWarnings, null, 2))
