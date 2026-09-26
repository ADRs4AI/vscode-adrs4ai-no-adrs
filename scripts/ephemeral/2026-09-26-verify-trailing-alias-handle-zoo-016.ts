/**
 * Context: ledger ruling 2026-09-26 (Riddle 5) — trailing "(QST-PETNAME)" is an
 * ALIAS handle (founder Report 09-13; 167 wild headings). Prints what the real
 * parser now yields for every heading of the cross-surface fixture
 * zoo-016-trailing-parenthesized-qst-handle.md, so its .expected.json can be
 * hand-verified against the six clauses (never generated blind).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseAdr } from '../../src/parser/extractor'

const file = resolve(__dirname, '../../src/test/fixtures/zoo/zoo-016-trailing-parenthesized-qst-handle.md')
const adr = parseAdr(readFileSync(file, 'utf8'), '/fake/docs/adr/0016-zoo.md')
for (const q of adr.questions) {
  console.log(JSON.stringify({ line: q.lineStart, id: q.id, slug: q.slug, qstId: q.qstId, aliasSlug: q.aliasSlug, text: q.text }))
}
console.log('--- warnings ---')
for (const w of adr.parseWarnings) console.log(w.code, 'line', w.line, '|', w.message.slice(0, 110))
