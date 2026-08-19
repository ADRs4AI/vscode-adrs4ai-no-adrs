/**
 * ADR-0043 QST-APPLY's falsifier: "replay H1 over the sweep's 13 corrected
 * files — if it proposes even one wrong bump, A is dead and B stands."
 *
 * Touchstone's 2026-08-16 status sweep (commit e7d7a86) touched 13 files.
 * Inspecting the actual diffs (not assumed): 7 are genuine PRE-EXISTING H1
 * drift (the header undercounted an "### Iteration N" heading that already
 * existed in the body before the commit) — 0004, 0008, 0013, 0014, 0015,
 * 0021, 0039. The other 6 (0025, 0029, 0030, 0036, 0038, 0041) added a NEW
 * "### Iteration N" section in the SAME commit as the header bump — before
 * that commit, the header was already correct relative to its
 * then-current body, so H1 replayed against their "before" state must NOT
 * fire (a false positive there would kill option A per the falsifier).
 *
 * This script parses the git-historical "before" content of all 13 files
 * (e7d7a86^:path) and checks H1 against exactly this recall/precision split.
 */

import { execSync } from 'child_process'
import { parseAdr } from '../../src/parser/extractor'
import { detectImplementationDrift } from '../../src/parser/driftHeuristics'

const SWEEP_COMMIT = 'e7d7a86'

const GENUINE_DRIFT = [
  ['docs/adr/0004-ui-paradigm.md', 3],
  ['docs/adr/0008-deep-link-protocol.md', 3],
  ['docs/adr/0013-normalizer-format-conformance.md', 5],
  ['docs/adr/0014-constructive-diagnostic-design.md', 3],
  ['docs/adr/0015-adr-documentation-index.md', 2],
  ['docs/adr/0021-mcp-tool-specification.md', 16],
  ['docs/adr/0039-secretariat-sourcerange-and-the-round-trip-gate.md', 2],
  // 0041 initially miscategorized as "no drift" from the diff alone; the
  // real "before" state has a genuine duplicate "### Iteration 2" heading
  // (1, 2, 2) — Touchstone's real correction bumped the header to 2
  // (distinct count), confirming this IS genuine drift, not a control.
  ['docs/adr/0041-seed-lifecycle-and-rollup-two-axes-one-spine.md', 2],
] as const

const NO_DRIFT = [
  'docs/adr/0025-multi-root-recursive-project-roots.md',
  'docs/adr/0029-open-questions-sidebar-badge-anti-gamification-check.md',
  'docs/adr/0030-captioned-references-resolving-question-handles-in-ui.md',
  'docs/adr/0036-unresolved-returning-the-ball.md',
  'docs/adr/0038-answer-box-inherits-editor-typography.md',
]

function beforeContent(path: string): string {
  return execSync(`git show ${SWEEP_COMMIT}^:${path}`, { cwd: process.cwd(), encoding: 'utf-8' })
}

let failures = 0

console.log('=== Genuine drift specimens (H1 MUST fire, with the correct suggestedIteration) ===')
for (const [path, expectedBump] of GENUINE_DRIFT) {
  const content = beforeContent(path)
  const adr = parseAdr(content, path)
  const findings = detectImplementationDrift(adr).filter(f => f.heuristic === 'H1')
  const ok = findings.length === 1 && findings[0].suggestedIteration === expectedBump
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${path}: header=${adr.iteration}, bodyCount=${adr.iterations.length}, H1=${JSON.stringify(findings)}, expected bump to ${expectedBump}`)
}

console.log('\n=== No-drift specimens (H1 must NOT fire — false positive kills option A) ===')
for (const path of NO_DRIFT) {
  const content = beforeContent(path)
  const adr = parseAdr(content, path)
  const findings = detectImplementationDrift(adr).filter(f => f.heuristic === 'H1')
  const ok = findings.length === 0
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${path}: header=${adr.iteration}, bodyCount=${adr.iterations.length}, H1=${JSON.stringify(findings)}`)
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`} — option A ${failures === 0 ? 'stands' : 'is dead, B stands'}`)
