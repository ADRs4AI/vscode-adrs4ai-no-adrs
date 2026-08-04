// Probe: Jérémie's cross-registration specimen (2026-07-27) — same-line
// answer text after "**ANS:** (by Jérémie) Wow..." was NOT in the panel
// prefill, so Submit's replace-extent destroyed paragraph 1 while keeping
// paragraphs 2-3 (which came from the box). Where is the truncation:
// extractor parse, or panel existingAnswer computation?
// Run: npx tsx scripts/ephemeral/2026-07-27-probe-sameline-ans-prefill-loss.ts
import { parseAdr } from '../../src/parser/extractor'
import { scanAnswerWriteAnchors } from '../../src/webview/answerWriteScan'

const doc = [
  '## Open Questions',
  '',
  '### QST: How do we handle capacity fairness in cross-registration?',
  '- Status: unanswered',
  '- Why asking: If Section 001 has 50 students...',
  '- Need: Policy decision + implementation approach',
  '',
  '**ANS:** (by Jérémie) Wow, what a great anticipation of a failure mode! I think we would have a mode that selects proportions.',
  '',
  "I don't think we should give users more control besides FCFS vs preallocation.",
  '',
  'Thanks again for your generative question!',
  '',
].join('\n')

const adr = parseAdr(doc, '/fake/docs/adr/0042-x.md')
const q = adr.questions[0]
console.log('--- extractor view ---')
console.log('isAnswered:', q.isAnswered)
console.log('answer.text:', JSON.stringify(q.answer?.text ?? (q as any).answers?.at(-1)?.text))
console.log('answers:', JSON.stringify((q as any).answers, null, 2))

console.log('--- write-scan view ---')
const lines = doc.split('\n')
const a = scanAnswerWriteAnchors(lines, 2)
console.log(JSON.stringify(a))
console.log('replace extent lines [ansHeader..ansContentEnd):',
  JSON.stringify(lines.slice(a.ansHeaderLineIdx, a.ansContentEndLineIdx)))
