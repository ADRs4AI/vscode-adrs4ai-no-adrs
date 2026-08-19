/**
 * ADR-0043's own motivating specimen: 0039's Iteration 2 entry reads
 * "shipped all three items... 1040/1040 green... each piece its own
 * commit" (H2 evidence) while the Outcome line says "Second slice...
 * remains queued" (H3 remaining-work evidence) — while the header still
 * said Accepted, Iteration 1. Both should fire on the real "before" state.
 */

import { execSync } from 'child_process'
import { parseAdr } from '../../src/parser/extractor'
import { detectImplementationDrift } from '../../src/parser/driftHeuristics'

const path = 'docs/adr/0039-secretariat-sourcerange-and-the-round-trip-gate.md'
const content = execSync(`git show e7d7a86^:${path}`, { cwd: process.cwd(), encoding: 'utf-8' })
const adr = parseAdr(content, path)
console.log('status:', adr.status)
console.log(JSON.stringify(detectImplementationDrift(adr), null, 2))
