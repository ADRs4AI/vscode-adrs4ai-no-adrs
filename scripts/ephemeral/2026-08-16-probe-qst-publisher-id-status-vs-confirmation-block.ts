/**
 * Context: Jérémie's founder Report (2026-08-16, panel, ADR-0042
 * "Trouble parsing the answer here, and recommendations, or
 * confirmation? Maybe this is normal.") against QST-PUBLISHER-ID.
 * The raw markdown has `Status: unanswered` (stale — a full ANS exists
 * below it) followed by a non-template `**Confirmation (...)**:` block
 * after the ANS. Checking against the REAL parser what isAnswered/
 * statusText/answer text actually come out as, rather than hand-tracing.
 */
import { readFileSync } from 'fs'
import { parseAdr } from '../../src/parser/extractor'

const content = readFileSync('docs/adr/0042-marketplace-release-runbook.md', 'utf8')
const adr = parseAdr(content, 'docs/adr/0042-marketplace-release-runbook.md')
const q = adr.questions.find(q => q.id === 'adr-0042-publisher-id')
if (!q) {
  console.log('QUESTION NOT FOUND — id list:', adr.questions.map(q => q.id))
  process.exit(1)
}
console.log('isAnswered:', q.isAnswered)
console.log('statusText:', q.statusText)
console.log('answer (full):')
console.log(q.answer)
console.log('---answer length---', q.answer?.length)

// OUTCOME (2026-08-16): confirmed against the real parser, not guessed —
// isAnswered: false, statusText: 'unanswered' for a question with a full
// ANS + trailing "Confirmation" block, because the raw file's `Status:`
// line was stale ("unanswered" despite a complete answer). This is the
// existing Status-authority rule (ratified, v0.7.23) working exactly as
// designed, not a bug — declared Status always wins over ANS content.
// The "Confirmation" block itself parses fine, appended into the same
// answer text, nothing lost or orphaned. Routed as: no code fix needed;
// Jérémie was already live-editing the file himself (uncommitted, `git
// diff` showed him flipping Status: unanswered -> answered in real time)
// by the time this was reported back to him, so no further action taken
// on the content either.
