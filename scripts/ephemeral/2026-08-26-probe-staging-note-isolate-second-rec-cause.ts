/**
 * Isolating exactly which piece of the second Recommendation marker line
 * breaks its recognition as a NEW recommendation block, so it merges into
 * the first one's text instead. Testing variants of the real specimen.
 */
import { parseAdr } from '../../src/parser/extractor'

function build(secondRecLine: string): string {
  return [
    '## Questions', '',
    '### QST-X: Test question?',
    '- Status: answered', '',
    '**Options**', '',
    '- **A — Accept.**', '',
    '**Recommendation**: (by Pharos 5, Claude Fable 5, 2026-08-25)', '',
    '**A.** First recommendation text.', '',
    secondRecLine, '',
    '**STAGING-NOTE — concur A** (correlated).', '',
    '**ANS:** Concur.', '',
  ].join('\n')
}

const variants: [string, string][] = [
  ['exact real line', '**Recommendation**: (by Fable 5 (claude.ai), 2026-08-25, append-only patch — verbatim)'],
  ['no nested parens, no qualifier', '**Recommendation**: (by Fable 5, 2026-08-25)'],
  ['nested parens, no qualifier', '**Recommendation**: (by Fable 5 (claude.ai), 2026-08-25)'],
  ['no nested parens, with qualifier', '**Recommendation**: (by Fable 5, 2026-08-25, append-only patch — verbatim)'],
]

for (const [label, line] of variants) {
  const content = build(line)
  const adr = parseAdr(content, '/fake/docs/adr/x.md')
  const q = adr.questions[0]
  console.log(`--- ${label} ---`)
  console.log('  recommendations count:', (q.recommendations ?? []).length)
  console.log('  answer:', q.answer ? `"${q.answer.text}" by ${q.answer.author}` : 'undefined')
}

// Hypothesis: a backtick-quoted mention of `<details>` (prose reference,
// not a live tag) inside the FIRST recommendation's text falsely opens
// the details-fold depth tracker, swallowing everything after it.
const withBacktickDetailsMention = [
  '## Questions', '',
  '### QST-X: Test question?',
  '- Status: answered', '',
  '**Recommendation**: (by Pharos 5, 2026-08-25)', '',
  'First rec text. If the `<details>` renders poorly, inline returns.', '',
  '**Recommendation**: (by Fable 5, 2026-08-25)', '',
  'Second rec text.', '',
  '**ANS:** Concur.', '',
].join('\n')
const adr2 = parseAdr(withBacktickDetailsMention, '/fake/docs/adr/x.md')
const q2 = adr2.questions[0]
console.log('--- backtick <details> mention in first rec ---')
console.log('  recommendations count:', (q2.recommendations ?? []).length)
console.log('  answer:', q2.answer ? `"${q2.answer.text}" by ${q2.answer.author}` : 'undefined')
