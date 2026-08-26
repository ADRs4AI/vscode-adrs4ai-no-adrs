/**
 * Context: founder Report, HQ seed-2026-08-25-sol-precision-pass-ratification.md,
 * QST-STAGING-NOTE: "the second recommendation is parsed incorrectly, and the
 * ANS is parsed incorrectly." Real block has TWO stacked Recommendation
 * blocks (Pharos, then "Fable 5 (claude.ai)... append-only patch — verbatim")
 * with NO "Recommendation (updated)" round in between (unlike the sibling
 * QST-BIBLIO-ADDS/QST-SYNTH-HOME blocks in the same file, which DO have a
 * third "(updated)" round) -- going straight from rec#2 to a bare
 * "**ANS:**" (no "(by X)" attribution at all) with just "Concur." Checking
 * against the real parser what actually comes out.
 */
import { readFileSync } from 'fs'
import { parseAdr } from '../../src/parser/extractor'

const path = '/Users/jlumbroso/Programming/adrs4ai/initial-meta-repository/docs/adr/seed-2026-08-25-sol-precision-pass-ratification.md'
const content = readFileSync(path, 'utf8')
const adr = parseAdr(content, path)
const q = adr.questions.find(q => q.id === 'seed-2026-08-25-sol-precision-pass-ratification-qst-staging-note' || q.id === 'adr-0000-qst-staging-note')
if (!q) {
  console.log('NOT FOUND. ids:', adr.questions.map(q => q.id))
  process.exit(1)
}
console.log('isAnswered:', q.isAnswered)
console.log('statusText:', q.statusText)
console.log('recommendations count:', (q.recommendations ?? []).length)
for (const [i, r] of (q.recommendations ?? []).entries()) {
  console.log(`--- recommendation[${i}] ---`)
  console.log('author:', (r as any).author)
  console.log('text:', (r as any).text)
}
console.log('--- answer ---')
console.log('author:', q.answer?.author)
console.log('text:', q.answer?.text)
