/**
 * Ephemeral verification — Riddle 5, 2026-07-13.
 * Context: Grafter 5 (HQ, brief 2026-07-12-2102) root-caused a false-answered
 * class: `**ANS:** (by )` + `[Fill this in]` — the empty attribution fails
 * ANS_INLINE_RE's `([^)]+)` group, "(by )" leaks into answerText, the leading
 * "(" defeats the whole-content-anchored placeholder regexes, and the QST
 * reads as answered despite `- Status: unanswered`. Routed to Cartographer
 * for dispatch to this crew; no dispatch brief found in our inbox.
 * This script checks whether the bug is live in today's working tree.
 */
import { parseAdr } from '../../src/parser/extractor'

const specimen = `# ADR 9999: Specimen

- **Date**: 2026-07-13
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

## Questions

### QST: Is this question visible?

- Status: unanswered
- Why asking: Grafter's (by )-leak reproduction.

**ANS:** (by )
[Fill this in]
`

const adr = parseAdr(specimen, '/tmp/9999-specimen.md')
const q = adr.questions[0]
console.log('questions found:', adr.questions.length)
console.log('isAnswered:', q?.isAnswered, '(expected false — true means the bug is live)')
console.log('answer text:', JSON.stringify(q?.answer?.text))

// OUTCOME (2026-07-13, Riddle 5): run via `npx tsx` against the working tree
// (v0.7.10 era). Output: questions found: 1 / isAnswered: true / answer text:
// "(by )\n[Fill this in]" — the bug is LIVE, exactly as Grafter diagnosed.
// Decision: dispatched to Flint as a same-day-fix-class item (Phase A′
// ride-along) in docs/inbox/2026-07-13-*-riddle-to-flint-addendum-*.md, with
// a zoo-specimen ask to Quarry; HQ (Cartographer/Grafter) notified that the
// handoff landed and has an owner.
