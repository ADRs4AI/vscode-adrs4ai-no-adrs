/**
 * Context: founder Report (muster, 2026-10-07T16:22:19.729Z, treeview, on
 * ADR-0008): "I'm puzzled by the 'QST: none open' — why Reveille did
 * this; does this correspond to a real use case we should support? —
 * I'm confused."
 *
 * Reveille wrote `### QST: none open` followed by `- NOT: no open
 * questions — ...` to assert, using existing nav-code grammar, that this
 * ADR has zero real open questions (and why). Reading extractor.ts's
 * collectQuestions/extractQuestion: ANY section with navCode === 'QST'
 * is unconditionally collected as a real Question, and statusText
 * defaults to 'unanswered' whenever no `- Status:` line is declared.
 * This probe runs the REAL parser against the REAL file to confirm
 * whether this produces a phantom open question, before answering the
 * founder's design question with a theory instead of a fact.
 */
import { readFileSync } from 'fs'
import { parseAdr } from '../../src/parser/extractor'

const path = '/Users/jlumbroso/Programming/muster/docs/adr/0008-tmux-actuation-contract-target-by-id-prove-by-listing.md'
const adr = parseAdr(readFileSync(path, 'utf8'), path)

console.log('total questions extracted:', adr.questions.length)
for (const q of adr.questions) {
  console.log('---')
  console.log('text:', JSON.stringify(q.text))
  console.log('status:', q.status, '(declared:', q.statusDeclared, ')')
  console.log('isAnswered:', q.isAnswered)
}

// OUTCOME (2026-10-07): confirmed against the real parser — 1 question
// extracted, text "none open", isAnswered: false. `### QST: none open`
// IS read as a real, unanswered open question (navCode === 'QST' is
// collected unconditionally in extractor.ts's collectQuestions; no
// `- Status:` line defaults statusText to 'unanswered'). Not a parser
// bug: the blessed mechanism for "this heading isn't really a
// question" already exists (`<!-- @adr-dismissed: <reason-slug> -->`,
// ADR-0032 QST-DISMISSAL-MARKER) — Reveille's seat just never found it,
// because it's documented only in references/questions-reference.md
// (loaded on demand), not SKILL.md's always-loaded core or either mint
// template. Reported to the founder directly and routed to Shipwright
// as a discoverability gap, not a code fix.
