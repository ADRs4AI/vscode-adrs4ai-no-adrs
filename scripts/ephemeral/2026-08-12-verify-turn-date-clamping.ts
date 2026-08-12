/**
 * ADR-0041 item 4, Slice 5: verify lastActivityDate sanity-clamps an
 * implausible future turn-date rather than trusting it.
 *
 * The ADR's own banked fixture (corpus:003975, external 108-seed
 * herbarium, not locally available) is "a wild 2027 year-typo turn
 * heading." Reconstructed here per the ADR's description since the real
 * file isn't in this repo.
 */

import { parseSeed } from '../../src/parser/seedExtractor'

const seed = parseSeed(
  `# SEED: Reconstructed year-typo fixture

- **Date**: 2026-03-07
- **From**: Jérémie Lumbroso

## Thread

### Sonnet 4.6 - 2026-03-07

First real turn.

### Jérémie - 2027-03-08

Typo: should have been 2026-03-08. One digit off.
`,
  '/fake/seed-year-typo.md',
)

console.log('lastActivityDate:', seed.lastActivityDate)
console.log('parseWarnings:', JSON.stringify(seed.parseWarnings, null, 2))
console.log('threadEntries dates:', seed.threadEntries.map(e => e.date))
