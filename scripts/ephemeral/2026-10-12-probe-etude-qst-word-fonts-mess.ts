/**
 * Context: founder Report (companion etude, 2026-10-12, severe distress
 * language — "PARALYZING", "ABORT ABORT ABORT ABORT ABORT"), on
 * seed-2026-08-07-jeremie-visit-queue.md's QST-WORD-FONTS: "Doesn't
 * follow ORRCF at all, I have NO idea what it is asking, 'kit or key'
 * makes no sense, then the ANS placeholder was [ ] or something and so
 * I have a lot of unrelated preparsed stuff in the box." Checking what
 * the REAL parser actually extracts for this question — in particular
 * whether `existingAnswer`'s fallback-to-last-real-round logic is
 * picking up one of this question's non-standard inline "- **Rec**:"
 * or stacked-Recommendation fields as if it were prior answer content.
 */
import { readFileSync } from 'fs'
import { parseSeed } from '../../src/parser/seedExtractor'

const path = '/Users/jlumbroso/Programming/system3/companion-thinking-stream-etude/docs/adr/seed-2026-08-07-jeremie-visit-queue.md'
const seed = parseSeed(readFileSync(path, 'utf8'), path)

const q = seed.questions.find(q => q.id.includes('word-fonts'))
if (!q) {
  console.log('QST-WORD-FONTS not found among', seed.questions.length, 'questions')
} else {
  console.log('id:', q.id)
  console.log('text:', q.text)
  console.log('statusText:', q.statusText)
  console.log('isAnswered:', q.isAnswered)
  console.log('whyAsking:', JSON.stringify(q.whyAsking))
  console.log('need:', JSON.stringify(q.need))
  console.log('recommendation (flat):', JSON.stringify(q.recommendation)?.slice(0, 200))
  console.log('recommendations (rounds) count:', q.recommendations?.length)
  console.log('answer?.text:', JSON.stringify(q.answer?.text))
  console.log('answers (all rounds):', JSON.stringify(q.answers?.map(a => ({ text: a.text, line: a.line }))))
  // The exact field the panel's existingAnswer prefill reads:
  const existingAnswerEquivalent = !q.isAnswered ? (q.answer?.text ?? q.answers?.[q.answers.length - 1]?.text) : undefined
  console.log('>>> existingAnswer the panel would prefill into the box:', JSON.stringify(existingAnswerEquivalent))
}

// OUTCOME (2026-10-12): confirmed the real bug precisely. Before the
// fix: `answer?.text`/`existingAnswer` captured "[ ]" PLUS three further
// unrelated paragraphs (hundreds of words) all the way to the next H2
// heading — exactly the "lot of unrelevant preparsed stuff in the box"
// the founder described. Root cause: the 2026-07-29 stop-check
// (extractor.ts, isPlaceholderOnly guard) only recognized a BOLD-key-
// shaped interruption; the real specimen's first interruption after
// "[ ]" was an ITALIC parenthetical aside, which slipped through and
// permanently poisoned the placeholder-only gate for every later line,
// including the later bold-key ones that WOULD have matched on their
// own. Fixed by dropping the bold-key shape requirement — the check now
// fires on ANY non-blank line while everything accumulated so far is
// still nothing but the placeholder, which is the actual safety
// property that matters (confirmed unchanged: a real answer's own
// prose never trips it, since real content makes isPlaceholderOnly
// false immediately). After the fix: answer?.text/existingAnswer both
// undefined, exactly right. 3 new regression tests in parser.test.ts
// using the real specimen's trimmed shape; full suite green, no
// regressions across the whole real corpus (serializeRoundTrip's
// census-clean byte-for-byte gate included).
