/**
 * Context: two founder Reports (muster, 2026-10-12), both about Reveille
 * 5 producing "### QST: none open" phantom-question headings — the exact
 * class investigated and routed to Shipwright on 2026-10-07, which they
 * reported shipping a template-level fix for the same day (c5dae88).
 * Specimen 1 is NEW (ADR-0013) — the class recurred in a brand-new file
 * six days after the fix allegedly shipped. Specimen 2 is the ORIGINAL
 * ADR-0008 — never healed in the file itself (expected; Shipwright's fix
 * was prospective/teaching-only). This probe confirms, with the real
 * parser, that both still produce the phantom question, and checks
 * whether the fix actually reached muster's own skill copy.
 */
import { readFileSync } from 'fs'
import { parseAdr } from '../../src/parser/extractor'

for (const relPath of [
  'docs/adr/0013-the-remontoires-hands-down-and-up.md',
  'docs/adr/0008-tmux-actuation-contract-target-by-id-prove-by-listing.md',
]) {
  const path = `/Users/jlumbroso/Programming/muster/${relPath}`
  const adr = parseAdr(readFileSync(path, 'utf8'), path)
  console.log(`=== ${relPath} ===`)
  console.log('questions found:', adr.questions.length)
  for (const q of adr.questions) {
    console.log(' -', JSON.stringify(q.text), '| isAnswered:', q.isAnswered, '| dismissedReason:', q.dismissedReason)
  }
}

// OUTCOME (2026-10-12): both files confirmed still producing the phantom
// question (text "none open", isAnswered: false, dismissedReason:
// undefined -- @adr-dismissed was never applied to either file). Skill
// version check (separate from this probe, done directly): muster's
// .claude/skills/adr-authoring/SKILL.md is still 3.11.6 with NO mention
// of @adr-dismissed outside references/questions-reference.md -- the
// same state as 2026-10-07, confirming Shipwright's reported c5dae88 fix
// never reached this repo's checkout. The canonical
// human-ai-collaboration-template-A DOES have the fix (same 3.11.6
// version string, different content -- version number alone isn't a
// reliable "has the fix" signal). A SEPARATE copy,
// skill-human-ai-collaboration-template-A, also lacks it. Routed to
// Shipwright as a propagation-mechanism finding, not something to
// unilaterally fix in muster's files (not this seat's repo to edit
// uninvited, matching Shipwright's own stated norm on the 0001/0007 pair).
