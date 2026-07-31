// Context: Gleaner 5's founder-evidence brief (2026-07-31, docs/inbox/
// 2026-07-31-1624-gleaner-to-fitter-insertion-preview-not-firing-plus-ux-
// reports.md) reports "[to be filled]" causing a write refusal instead of
// the intended flow. Checking whether src/mcp/writeOps.ts (my file) has
// the same "one parser, N consumers" gap answerWriteScan.ts's own header
// comment says it used to have: a PRIVATE placeholder regex narrower than
// the extractor's actual recognized lexicon (isPlaceholderAnswerText,
// PLACEHOLDER_SYNONYM_RE — both of which DO recognize "[to be filled]").
//
// Usage: npx vite-node scripts/ephemeral/2026-07-31-probe-writeops-tofilled-placeholder.ts
import { parseAdr, isPlaceholderAnswerText } from '../../src/parser/extractor'
import { applyAnswerQuestion } from '../../src/mcp/writeOps'
import { scanAnswerWriteAnchors } from '../../src/webview/answerWriteScan'

const DOC = [
  '## Open Questions', '',
  '### QST: Does the fix land here?', '- Status: unanswered', '',
  '**ANS:**', '[to be filled]', '',
].join('\n')

console.log('isPlaceholderAnswerText("[to be filled]"):', isPlaceholderAnswerText('[to be filled]'))

const lines = DOC.split('\n')
const start = lines.findIndex((l) => l.startsWith('### QST:'))
const panelAnchors = scanAnswerWriteAnchors(lines, start)
console.log('panel (answerWriteScan) fillLineIdx:', panelAnchors.fillLineIdx, '-> line:', lines[panelAnchors.fillLineIdx])

const adr = parseAdr(DOC, '/fake/docs/adr/x.md')
const q = adr.questions[0]
const result = applyAnswerQuestion(DOC, '/fake/docs/adr/x.md', q.id, 'A real answer.', 'Jérémie')
console.log('MCP applyAnswerQuestion result:', JSON.stringify(result, null, 2))
