/**
 * ADR-0041 item 2, Slice 4: verify the new SeedFile.status header field +
 * isRetiredSeedStatus() classifier against real local specimens.
 *
 * Positive: docs/adr/seed-2026-03-17-secretariat-parser-lossless-adr-editing.md
 * — line 5's "- **Status**: TERMINATED — duplicate capture, merged
 * 2026-07-28" is the ADR's own corpus:002890 specimen.
 *
 * Negative (scope guard): docs/adr/seed-2026-04-17-dogfood-master-plan.md
 * contains many "- **Status**:" lines nested deep inside section content
 * (quoted/nested ADR template demonstrations) — none of those should be
 * read as THIS seed's own declared status; only the header bullet counts.
 */

import { parseSeed, isRetiredSeedStatus } from '../../src/parser/seedExtractor'
import * as fs from 'fs'
import * as path from 'path'

const positive = 'docs/adr/seed-2026-03-17-secretariat-parser-lossless-adr-editing.md'
const negative = 'docs/adr/seed-2026-04-17-dogfood-master-plan.md'

for (const rel of [positive, negative]) {
  const full = path.join(process.cwd(), rel)
  const content = fs.readFileSync(full, 'utf-8')
  const seed = parseSeed(content, full)
  console.log(`\n=== ${rel} ===`)
  console.log('status:', JSON.stringify(seed.status))
  console.log('isRetiredSeedStatus:', isRetiredSeedStatus(seed.status))
}
