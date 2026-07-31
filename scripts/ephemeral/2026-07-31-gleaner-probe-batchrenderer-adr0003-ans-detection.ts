/**
 * Probe: does the real parser correctly recognize QST "Headers pattern tree
 * structure details (Iteration 3 from Claude)" in batch-renderer's ADR-0003
 * as answered, with its real ANS text? Jérémie's Report (2026-07-31 18:17):
 * "The ANS detection completely fails (despite it being there), I think
 * the triple quotes really confuse parsing." The QST body has three
 * separate fenced code blocks before the Recommendation/ANS — testing
 * whether that's the actual confusion, not literal `"""` (none in the file).
 *
 * Usage: npx tsx scripts/ephemeral/2026-07-31-gleaner-probe-batchrenderer-adr0003-ans-detection.ts
 */
import * as fs from 'node:fs'
import { parseAdr } from '../../src/parser/extractor'

const isolate = process.argv.includes('--isolate')
const path = isolate
  ? '/private/tmp/claude-501/-Users-jlumbroso-Programming-vscode-adrs-for-ai/3d96f0d3-538a-47ff-b597-4ee6a86a5cad/scratchpad/isolated-qst.md'
  : '/Users/jlumbroso/Programming/batch-renderer/docs/adr/0003-compatibility-mode-and-templates.md'
const content = fs.readFileSync(path, 'utf8')
const parsed = parseAdr(content, path)

const target = parsed.questions.find(q => q.text.includes('Headers pattern tree structure details'))
if (!target) {
  console.log('QUESTION NOT FOUND AT ALL — total questions parsed:', parsed.questions.length)
  console.log(parsed.questions.map(q => q.text))
  process.exit(1)
}

console.log('Found question:', target.text)
console.log('id:', target.id)
console.log('isAnswered:', target.isAnswered)
console.log('answer:', JSON.stringify(target.answer, null, 2))

// OUTCOME (2026-07-31): first pass wrongly read `target.answerText` (not a
// real field — AdrQuestion's field is `answer?.{text,author,line}`), which
// silently returned undefined and looked exactly like a detection failure.
// Corrected probe shows parseAdr() gets this specimen entirely right:
// isAnswered true, answer.text the full real ANS content, no warnings. The
// core parser is NOT the bug here — ruling out Jérémie's own "triple quotes
// confuse parsing" hypothesis (no literal `"""` anywhere in the file
// either). The actual defect is the already-open renderMarkdown() nested-
// list/code-fence bug (QST-DETECTION-LEDGER, same ADR-0003 question) —
// a garbled QUESTION body in the panel is what reads as "ANS detection
// failed," even though extraction is correct and the real answer is intact.
