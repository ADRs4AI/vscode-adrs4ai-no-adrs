/**
 * Context: Jérémie's live Report from moreover's ADR manager, 2026-09-26T17:27Z
 * (moreover/docs/adr/.working/errors.jsonl, treeview source, QST-VERB-RECUT in
 * seed-2026-09-26-the-reporting-pipeline-standard.md): "The recommendation
 * after the 'Recommendation' header seems not to have been parsed correctly
 * because multiline header?". Ribbon 5's Recommendation there opens with an
 * attribution parenthetical that wraps across several lines and contains
 * bold markup. This runs the REAL parser on the REAL file (his local copy) and
 * on minimal variants to isolate which property breaks recognition — never a
 * hand-traced guess.
 */
import { readFileSync } from 'fs'
import { parseAdr } from '../../src/parser/extractor'

const path = '/Users/jlumbroso/Programming/lumbroso/lumbroso-hq/subprojects/commons-hq/subprojects/moreover/docs/adr/seed-2026-09-26-the-reporting-pipeline-standard.md'
const real = parseAdr(readFileSync(path, 'utf8'), path)
const q = real.questions.find(x => x.slug === 'qst-verb-recut')
console.log('REAL FILE qst-verb-recut: recommendations =', q?.recommendations?.length ?? 0, ' rounds =', q?.rounds?.length)
for (const r of q?.recommendations ?? []) console.log('  rec author=', JSON.stringify(r.author), 'text starts=', JSON.stringify(r.text.slice(0, 70)))
console.log('  rawBody contains "**C — the census cut.**"? ', (q?.rawBody ?? '').includes('the census cut.**'), '| rawBodyPost?', (q?.rawBodyPost ?? '').includes('the census cut.**'))

function variant(label: string, header: string) {
  const doc = ['## Questions', '', '### QST: Q?', '- Status: unanswered', '', header, '', '**C — pick.** Because reasons.', '', '**ANS:** (by )', '[Fill this in]', ''].join('\n')
  const v = parseAdr(doc, '/fake/docs/adr/x.md').questions[0]
  console.log(label.padEnd(58), 'recs=', v.recommendations?.length ?? 0, 'author=', JSON.stringify(v.recommendations?.[0]?.author))
}
variant('one-line attribution (control)', '**Recommendation**: (by Ribbon 5, Claude Fable 5 — revised same-day; walks forward)')
variant('attribution wraps to 2 lines, no bold', '**Recommendation**: (by Ribbon 5, Claude Fable 5 — revised same-day;\nwalks forward to C)')
variant('attribution wraps to 4 lines WITH bold inside (real shape)', '**Recommendation**: (by Ribbon 5, Claude Fable 5 — revised same-day;\n**this walks forward from A to C** on Gleaner 5\'s census, which fired\nthe falsifier: a real corpus named the third kind)')
variant('one line WITH bold inside', '**Recommendation**: (by Ribbon 5, Claude Fable 5 — **this walks forward from A to C**)')
