/**
 * Ephemeral: run ADR-0043's shipped H1–H3 drift heuristics over docs/adr/00*.md
 * Context: Jérémie asked (2026-08-29) "where was draft-status/iteration-gap
 * detection discussed, is it implemented?" — answer: ADR-0043, Flint shipped
 * detectImplementationDrift 2026-08-19 (7b2656d), parser-side only, never yet
 * run over the live corpus as a sweep. This IS that first live sweep, feeding
 * Touchstone's status-sweep round 2. Also executes QST-APPLY's falsifier.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseAdr } from '../../src/parser/extractor'
import { detectImplementationDrift } from '../../src/parser/driftHeuristics'

const dir = 'docs/adr'
for (const f of readdirSync(dir).filter(f => /^00\d\d-.*\.md$/.test(f)).sort()) {
  const adr = parseAdr(readFileSync(join(dir, f), 'utf8'), join(dir, f))
  const findings = detectImplementationDrift(adr)
  for (const fi of findings) {
    console.log(`${f} | ${fi.id} | ${(fi as any).message ?? JSON.stringify(fi).slice(0,160)}`)
  }
}
