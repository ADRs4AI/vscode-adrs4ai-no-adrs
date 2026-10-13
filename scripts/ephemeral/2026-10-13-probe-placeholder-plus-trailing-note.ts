/**
 * 2026-10-13 — why did the panel prefill a malformed ANS slot?
 *
 * CONTEXT: founder in-flow record 2026-10-12T22:34:11Z, QST-WORD-FONTS in
 * seed-2026-08-07-jeremie-visit-queue.md — "the ANS placeholder was [ ] or
 * something and so I have a lot unrelevant preparsed stuff in the box, and it
 * is PARALYZING." Concertmaster's read was that the placeholder wasn't
 * recognized. But PLACEHOLDER_EMPTY_RE already matches a bare `[ ]` (added
 * from Jérémie's own 2026-07-12 report), so the recognizer is NOT blind to it.
 *
 * HYPOTHESIS to falsify: every placeholder regex is anchored ^...$ over the
 * WHOLE trimmed slot, so a placeholder followed by ANY trailing content stops
 * being recognized — which is precisely the case where prefilling is worst.
 */
import { isPlaceholderAnswerText } from '../../src/parser/extractor'

const cases: Array<[string, string]> = [
  ['bare empty box', '[ ]'],
  ['bare empty box, no space', '[]'],
  ['canonical', '[Fill this in]'],
  ['empty box + parenthetical note (the specimen shape)', '[ ]\n\n(note: he wanted the fonts named, see the thread above)'],
  ['canonical + trailing note', '[Fill this in]\n\n(and a stray remark nobody separated with ---)'],
  ['empty box + long preamble', '[ ]\n\nSome unseparated prose that belongs to the question, not the answer.'],
  ['a genuine answer', 'Use Inter for UI and Berkeley Mono for code.'],
]
for (const [label, text] of cases) {
  console.log(String(isPlaceholderAnswerText(text)).padEnd(5), '|', label)
}
