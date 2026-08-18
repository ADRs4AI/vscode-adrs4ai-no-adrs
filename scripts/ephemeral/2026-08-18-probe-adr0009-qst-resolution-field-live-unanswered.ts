/**
 * Context: founder Report, "why does this still show as unanswered in the
 * extension? fix please" -- ADR-0009, question id
 * adr-0009-qst-where-in-the-adr-header-does-the-resolution-field-live.
 * Raw file shows Status: answered + a real ANS block. Checking against the
 * REAL parser rather than concluding from raw text alone (memory lesson,
 * 2026-08-14/08-19: a raw-content check that agrees with what I expect is
 * not the same as checking what the extension actually renders).
 */
import { readFileSync } from 'fs'
import { parseAdr } from '../../src/parser/extractor'

const path = 'docs/adr/0009-decision-resolution-taxonomy.md'
const content = readFileSync(path, 'utf8')
const adr = parseAdr(content, path)
console.log('total questions:', adr.questions.length)
for (const q of adr.questions) {
  console.log(q.id, '| isAnswered:', q.isAnswered, '| statusText:', JSON.stringify(q.statusText), '| text:', q.text.slice(0, 60))
}
