/**
 * Context: Jérémie's live question, 2026-09-05, re: the docket repo's
 * ADR-0001, QST-SHAPE — he answered with a real ANS, invited further
 * clarification, several seats stacked more Recommendations, and he
 * stacked a SECOND real ANS. He asked directly: "is this parsed
 * correctly, or does the parser try to find one ANS and miss the rest
 * or something?" Verifying against the REAL file (docket doesn't have
 * its own parser yet — the extraction RFC we're mid-deliberation on is
 * about exactly that — so this repo's own parser is the correct one to
 * check with) rather than reasoning about it from memory.
 */
import { readFileSync } from 'fs'
import { parseAdr } from '../../src/parser/extractor'

const path = '/Users/jlumbroso/Programming/adrs4ai/initial-meta-repository/subprojects/docket/docs/adr/0001-the-extraction-how-the-conduit-core-leaves-the-extension-and-lands-here.md'
const content = readFileSync(path, 'utf8')
const adr = parseAdr(content, path)
const q = adr.questions.find(q => q.slug === 'qst-shape')
if (!q) {
  console.log('QST-SHAPE not found at all — questions found:', adr.questions.map(x => x.slug))
  process.exit(1)
}

console.log('isAnswered:', q.isAnswered)
console.log('statusText:', q.statusText)
console.log('rounds.length:', q.rounds.length)
for (const [i, r] of q.rounds.entries()) {
  console.log(`round ${i}: recommendations=${r.recommendations.length}, answer=${r.answer ? JSON.stringify(r.answer.text.slice(0, 60)) : 'undefined'}`)
}
console.log('answers (plural) count:', q.answers?.length ?? 0)
console.log('answers texts:', q.answers?.map(a => a.text.slice(0, 60)))
console.log('current .answer.text:', q.answer?.text)
console.log('recommendations (flat) count:', q.recommendations?.length ?? 0)

// OUTCOME (2026-09-05): parses correctly. Round 0 = 1 rec + Jérémie's first
// real ANS ("Sounds good... componentize the parser..."); round 1 = 2 recs
// (Riddle + Naturalist) + his SECOND real ANS ("Excellent work all...").
// `answers` (plural) correctly retains BOTH real answers in order; the
// singular `.answer` correctly reflects the latest one; isAnswered: true.
// Not a bug — this is exactly ADR-0033's dialogue-layering fold working as
// designed, the same mechanism verified this session for the reopened-
// question case, now confirmed for the "invited more input, got it,
// answered again" case too. Aside, not asked about: Flint's "**Sign-off
// (stacked)**:" block (a new attribution keyword, distinct from
// "Recommendation") correctly does NOT get miscounted as a third
// recommendation — it isn't recognized as one at all, falling through as
// inert body prose. Fine for this question's fold correctness; whether
// "Sign-off" deserves its own recognized attribution form is a separate,
// unasked question, not investigated further here.
