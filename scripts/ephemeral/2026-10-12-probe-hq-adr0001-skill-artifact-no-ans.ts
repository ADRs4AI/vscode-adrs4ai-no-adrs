/**
 * Context: founder Report (initial-meta-repository, 2026-10-12, panel):
 * "may be interesting to find otu why there is no ANS here — but the
 * insertion protocol we designed is robust and works beautifully!!!"
 * questionId in the record: adr-0001-qst-skill-artifact. A direct read
 * of the raw file shows a real, substantial **ANS:** block for this
 * exact question. Running the REAL parser to see whether it agrees with
 * what a human eyeballing the file sees, or whether there's a genuine
 * extraction gap the panel hit that a raw read wouldn't show.
 */
import { readFileSync } from 'fs'
import { parseAdr } from '../../src/parser/extractor'

const path = '/Users/jlumbroso/Programming/adrs4ai/initial-meta-repository/docs/adr/0001-template-guide-skill-placement.md'
const adr = parseAdr(readFileSync(path, 'utf8'), path)

for (const q of adr.questions) {
  console.log('---')
  console.log('id:', q.id)
  console.log('text:', q.text)
  console.log('statusText:', q.statusText)
  console.log('isAnswered:', q.isAnswered)
  console.log('answer?.text:', JSON.stringify(q.answer?.text))
  console.log('answers (all rounds) count:', q.answers?.length)
}

// OUTCOME (2026-10-12): all three questions, including
// adr-0001-qst-skill-artifact (the one named in the Report's own
// questionId), parse as isAnswered: true with their full real answer
// text — no parsing gap, no panel bug. QST-SKILL-ARTIFACT's own ANS
// block (unlike its two siblings) carries no "(by Jérémie, date, via
// interactive walkthrough)" annotation, just "(by Jérémie Lumbroso)" --
// consistent with it being answered live, today, through the panel
// (matching the Report's own draftKey/questionId context), right before
// filing this Report. Most likely reading: the founder was musing about
// why this ONE question (added later, Cartographer's 2026-08-30 audit
// pass, well after the ADR's original Decision/Action-Items sections)
// had sat unanswered for so long -- an ordinary, non-buggy explanation
// -- right as he answered it, and the "insertion protocol... works
// beautifully" is praise for that exact submission landing cleanly.
// Not a bug; replied to the founder with the verified parser result and
// the mundane explanation, honestly flagged as a best reading rather
// than a confirmed one, since the Report captured no further pointer.
