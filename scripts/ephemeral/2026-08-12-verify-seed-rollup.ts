/**
 * ADR-0041 item 1, Slice 6: verify computeSeedRollup against the ADR's own
 * named conformance fixture — "the origin seed itself... must read
 * `chunked · rollup: partial` (this ADR exists; implementation pending)."
 *
 * Real check: the origin seed is docs/adr/seed-2026-08-02-nits-on-the-
 * commit-feature-seed-status.md, derived into ADR-0041 alone. ADR-0041's
 * CURRENT declared Status is "Accepted — FULLY ratified..." (not yet
 * "Partially Implemented"), so the honest current rollup is 'none' —
 * the ADR's own text frames the 'partial' read as what happens ONCE
 * implementation lands and someone updates the Status field, not a
 * standing truth the parser should force. Surfacing this as a doubt for
 * the completion brief rather than silently declaring the fixture "met."
 */

import { AdrIndex } from '../../src/index/adrIndex'
import { SeedIndex, computeSeedRollup } from '../../src/index/seedIndex'
import * as path from 'path'

async function main() {
  const adrDir = path.join(process.cwd(), 'docs/adr')
  const adrIndex = new AdrIndex()
  await adrIndex.indexDirectory(adrDir)
  const seedIndex = new SeedIndex()
  await seedIndex.indexDirectory(adrDir)

  const origin = seedIndex.getByPath(path.join(adrDir, 'seed-2026-08-02-nits-on-the-commit-feature-seed-status.md'))
  if (!origin) throw new Error('origin seed not found')

  console.log('origin seed derivedAdrs:', origin.derivedAdrs)
  const adr0041 = adrIndex.getByNumber(41)
  console.log('ADR-0041 status:', adr0041?.status)

  const rollup = computeSeedRollup(origin.derivedAdrs, n => adrIndex.getByNumber(n)?.status)
  console.log('computed rollup:', rollup)
}

main()
