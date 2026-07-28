/**
 * Ephemeral verification — Flint 5, 2026-07-28.
 * Context: Facet's dispatch (docs/inbox/2026-07-28-0507-...) claimed
 * "### QST (Iteration 2): ..." is DETECTED fine (QST_HEADING_LINE_RE
 * tolerates the parenthetical) but slugs badly (sectionSlug()'s narrower
 * regexes don't). Before fixing sectionSlug() alone, this checked whether
 * buildSection()'s OWN candidacy cascade (a separate hand-rolled sequence
 * of handle/nav-code regexes, NOT driven by QST_HEADING_LINE_RE) actually
 * assigns navCode:'QST' to this heading shape at all.
 *
 * Also checked the same specimen shape for a malformed QST handle
 * ("### QST-BAD_CHARS: ...") to see whether its slug matched its own
 * qstId, since sectionSlug() and buildSection() looked like two
 * independently hand-copied cascades of the same regexes.
 *
 * Outcome: BOTH were real bugs, worse than reported.
 * - "QST (Iteration 2): ..." was a TOTAL SILENT DROP (0 questions, 0
 *   parseWarnings) — buildSection()'s cascade had no tolerance for the
 *   annotated form at all, so navCode stayed undefined and the section
 *   never became a Question. Not merely a bad slug.
 * - "QST-BAD_CHARS: ..." got a correct qstId ("BADCHARS") from
 *   buildSection() but the WRONG slug ("qst-bad-chars-does-the-cache-...")
 *   because sectionSlug()'s independent cascade never learned about
 *   QST_HANDLE_MALFORMED_RE when it was added (2026-07-16) — a second,
 *   previously-unreported instance of the exact drift class Facet
 *   predicted ("any future heading variant... needs the same tolerance
 *   threaded into sectionSlug(), or this gap reopens under a different
 *   shape next time").
 *
 * Fix (commit follows): extracted a single resolveNavHeadingIdentity()
 * used by BOTH buildSection() and sectionSlug(), plus a new
 * QST_HEADING_ANNOTATED_RE tolerance tier. Regression tests added to
 * src/test/qstHandleGrammar.test.ts. Full suite green after the fix
 * (812/812), including both specimens below now resolving correctly.
 */
import { parseAdr } from '../../src/parser/extractor'

const annotated = `# ADR 9999: Specimen

- **Date**: 2026-07-28
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

## Questions

### QST (Iteration 2): Does the cache need a version key?

- Status: unanswered
`

const malformed = `# ADR 9998: Specimen

- **Date**: 2026-07-28
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

## Questions

### QST-BAD_CHARS: Does the cache need a version key?

- Status: unanswered
`

console.log('=== annotated heading ===')
const a = parseAdr(annotated, '/tmp/9999-specimen.md')
console.log('questions.length:', a.questions.length)
console.log(JSON.stringify(a.questions, null, 2))
console.log('parseWarnings:', JSON.stringify(a.parseWarnings, null, 2))

console.log('\n=== malformed handle ===')
const m = parseAdr(malformed, '/tmp/9998-specimen.md')
console.log(m.questions.map(q => ({ slug: q.slug, qstId: q.qstId, text: q.text })))
