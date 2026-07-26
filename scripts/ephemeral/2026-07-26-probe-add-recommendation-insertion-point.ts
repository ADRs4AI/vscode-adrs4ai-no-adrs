// Context: verifying a suspected bug before reporting it (Midden 5's
// work-trace analysis, E1/E3: add_recommendation's insertion point wasn't
// updated by v0.7.32's dialogue-layering change). applyAddRecommendation
// scans for the FIRST **ANS...**: marker and inserts before it (`break` on
// first match) -- but the dialogue-layering convention (system3 ADR-0033)
// can put a real answer, an updated recommendation, AND a second ANS
// marker all in the same question. If a caller adds a new recommendation
// to a question that already has this shape, does it land after the whole
// history (correct) or between the ORIGINAL recommendation and ORIGINAL
// ANS (wrong -- DEBRIEF-006 class, silent wrong-location splice)?
//
// Usage: npx vite-node scripts/ephemeral/2026-07-26-probe-add-recommendation-insertion-point.ts
import { parseAdr } from '../../src/parser/extractor'
import { applyAddRecommendation } from '../../src/mcp/writeOps'

const DIALOGUE = `# ADR 0033: Team completism

## Status meta

### QST: The stated promotion trigger has fired — design now, hold, or fold?
- Status: unanswered (added by the 2026-07-09 ORJ tour)

**Recommendation**: (by Herald 5, 2026-07-09)

**B — hold with the concrete trigger.**

**ANS:** (by Jérémie Lumbroso — given in chat 2026-07-14, transcribed by Herald 5)
Hold — "I'd like to put the Team completism a bit on hold, and tackle it as
the last standing thing for full sync."

**Recommendation (updated)**: (by Herald 5, 2026-07-24)

**Your hold stands unchanged — but it's time to stop letting time-windowed analytics expire.**

Recommend a ~20-line ride-along snapshot. This stops the bleeding while the hold holds.

**ANS (to the updated recommendation):** (by Jérémie Lumbroso)
`

const adr = parseAdr(DIALOGUE, '/fake/docs/adr/0033-t.md')
const q = adr.questions[0]
const result = applyAddRecommendation(DIALOGUE, '/fake/docs/adr/0033-t.md', q.id, 'Probe Agent', 'A brand new third-round recommendation.', '2026-07-25')
console.log(JSON.stringify(result, null, 2))
