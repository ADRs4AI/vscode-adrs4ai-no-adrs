/**
 * Ephemeral probe — Flint 5, 2026-07-30.
 * Context: ADR-0039 §2 Tier 1 (semantic round-trip). Before writing the
 * CI test's baseline, check how many real docs/adr files already
 * round-trip via serializeAdr(parseAdr(x)) === x, and what specifically
 * breaks for the ones that don't (informs whether the census-clean filter
 * alone is close enough, or whether hard-wrap is the dominant blocker as
 * predicted).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseAdr } from '../../src/parser/extractor'
import { parseSeed } from '../../src/parser/seedExtractor'
import { serializeAdr } from '../../src/parser/serialize'
import { censusDiff } from '../../src/census/diff'

const dir = resolve(__dirname, '../../docs/adr')
const files = readdirSync(dir, { withFileTypes: true })
  .filter(e => e.isFile() && e.name.endsWith('.md'))
  .map(e => e.name)
  .sort()

let ok = 0, censusCleanOk = 0, censusCleanFail = 0, notCensusClean = 0, noFidelity = 0
for (const file of files) {
  const p = resolve(dir, file)
  const content = readFileSync(p, 'utf8')
  const isCensusClean = censusDiff(content, p).length === 0
  if (!isCensusClean) { notCensusClean++; continue }

  const adr = file.startsWith('seed-') ? parseSeed(content, p) : parseAdr(content, p)
  const serialized = serializeAdr(adr as any)
  if (serialized === null) { noFidelity++; console.log(`NO FIDELITY: ${file}`); continue }
  if (serialized === content) { ok++; censusCleanOk++ }
  else {
    censusCleanFail++
    // Find first diff point
    let i = 0
    while (i < Math.min(serialized.length, content.length) && serialized[i] === content[i]) i++
    console.log(`MISMATCH: ${file} at char ${i}: expected ${JSON.stringify(content.slice(Math.max(0,i-20), i+40))} got ${JSON.stringify(serialized.slice(Math.max(0,i-20), i+40))}`)
  }
}
console.log(`\ncensus-clean: ${censusCleanOk} ok, ${censusCleanFail} mismatch; ${notCensusClean} not census-clean (skipped); ${noFidelity} no-fidelity (fixture, not real parse)`)
