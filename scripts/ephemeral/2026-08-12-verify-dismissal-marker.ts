/**
 * ADR-0032 QST-DISMISSAL-MARKER, ratified 2026-08-12: verify the
 * `<!-- @adr-dismissed: <reason-slug> -->` marker on a QST heading line is
 * recognized, stripped from the displayed text/slug, and excludes the
 * question from open counts — while staying present in the parsed model
 * (per the ruling: "the panel and census both SHOW dismissals").
 */

import { parseAdr } from '../../src/parser/extractor'

const doc = `# ADR-0099: Test

- **Status**: Draft
- **Deciders**: Test

## Open Questions

### QST: What do we do? <!-- @adr-dismissed: not-a-question -->

- Status: unanswered
- Why asking: testing.

### QST: A real question

- Status: unanswered
- Why asking: testing.
`

const adr = parseAdr(doc, '/fake/0099-test.md')
for (const q of adr.questions) {
  console.log(JSON.stringify({ text: q.text, slug: q.slug, dismissedReason: q.dismissedReason, isAnswered: q.isAnswered }, null, 2))
}
