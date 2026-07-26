// Probe: why does "**ANS**: (by Jérémie) text" not yield answerAuthor?
// Context: ADR-0036 live specimen (Jérémie 2026-07-26); regression test red.
// Run: npx tsx scripts/ephemeral/2026-07-26-probe-colon-outside-ans-byline.ts
import { parseAdr } from '../../src/parser/extractor'

const doc = [
  '## Open Questions',
  '',
  '### QST: Is the token right?',
  '- Status: unanswered',
  '',
  '**ANS**: (by Jérémie) Yes, unresolved reads correctly.',
  '',
].join('\n')

const adr = parseAdr(doc, '/fake/docs/adr/0036-x.md')
console.log(JSON.stringify(adr.questions.map(q => ({
  text: q.text, isAnswered: q.isAnswered, answer: q.answer,
  answerAuthor: q.answerAuthor, answers: (q as any).answers,
})), null, 2))
console.log('warnings:', JSON.stringify((adr as any).warnings ?? [], null, 2))

// OUTCOME (2026-07-26): proved the extractor handles the form correctly and
// answer is an OBJECT {text, author, line} — the red regression tests had
// asserted string-shaped q.answer / q.answerAuthor. Tests fixed; the parser
// change (post-colon byline lift) verified live by this probe's output.
