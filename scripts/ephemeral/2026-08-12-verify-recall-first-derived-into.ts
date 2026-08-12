/**
 * Verification — Flint 5, 2026-08-12, ADR-0041 build wave.
 * Sweeps every real seed in this repo's own docs/adr/ through the new
 * recall-first parseDerivedInto(), checking the two known-blind specimens
 * ADR-0041 itself names: the Secretariat seed (bolded/dated/annotated)
 * and dogfood-master-plan (markdown-link form, multiple shapes).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSeed } from '../../src/parser/seedExtractor'

const dir = resolve(__dirname, '../../docs/adr')
const files = readdirSync(dir).filter(f => f.startsWith('seed-') && f.endsWith('.md')).sort()

for (const file of files) {
  const p = resolve(dir, file)
  const seed = parseSeed(readFileSync(p, 'utf8'), p)
  if (seed.derivedAdrs.length > 0) {
    console.log(`${file}: ${seed.derivedAdrs.length} derived ADR(s), isProcessed=${seed.isProcessed}`)
    for (const d of seed.derivedAdrs) console.log(`  ADR-${d.number}: ${d.title}`)
  }
}
