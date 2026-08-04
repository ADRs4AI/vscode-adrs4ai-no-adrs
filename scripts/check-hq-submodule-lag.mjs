#!/usr/bin/env node
/**
 * check-hq-submodule-lag — sweep addition per Lapidary 5's 2026-08-04
 * decision record (docs/inbox/2026-08-04-lapidary-decision-record-no-
 * relocation-to-submodule-path.md): the working tree stays here, not
 * moved into the HQ submodule path, on the condition that Gleaner
 * watches for the HQ submodule pointer drifting stale. "Watched, not
 * restructured."
 *
 * Compares the commit date the HQ repo's `subprojects/vscode-adrs-for-ai`
 * submodule pointer is pinned to against this repo's origin/main HEAD
 * commit date. Alerts (non-zero exit + stderr) if the lag exceeds the
 * threshold — default 3 days, per the decision record.
 *
 * Usage:
 *   node scripts/check-hq-submodule-lag.mjs
 *   node scripts/check-hq-submodule-lag.mjs --hq-path ~/Programming/adrs4ai/initial-meta-repository --max-days 3
 */

import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import * as os from 'node:os'

const args = process.argv.slice(2)
const hqIdx = args.indexOf('--hq-path')
const hqPath = (hqIdx >= 0 ? args[hqIdx + 1] : '~/Programming/adrs4ai/initial-meta-repository')
  .replace(/^~/, os.homedir())
const maxDaysIdx = args.indexOf('--max-days')
const maxDays = maxDaysIdx >= 0 ? Number(args[maxDaysIdx + 1]) : 3
const repoPath = path.resolve(new URL('..', import.meta.url).pathname)

function git(cwd, ...gitArgs) {
  return execFileSync('git', gitArgs, { cwd, encoding: 'utf8' }).trim()
}

const submodulePin = git(hqPath, 'ls-tree', 'HEAD', 'subprojects/vscode-adrs-for-ai')
  .split(/\s+/)[2]
if (!submodulePin) {
  console.error(`! could not read submodule pin for subprojects/vscode-adrs-for-ai in ${hqPath}`)
  process.exit(2)
}
const pinDate = new Date(git(repoPath, 'log', '-1', '--format=%cI', submodulePin))

git(repoPath, 'fetch', 'origin', 'main', '--quiet')
const mainDate = new Date(git(repoPath, 'log', '-1', '--format=%cI', 'origin/main'))

const lagDays = (mainDate - pinDate) / (1000 * 60 * 60 * 24)

console.log(`HQ submodule pin:  ${submodulePin.slice(0, 12)}  (${pinDate.toISOString()})`)
console.log(`origin/main HEAD:  ${git(repoPath, 'rev-parse', '--short', 'origin/main')}  (${mainDate.toISOString()})`)
console.log(`lag: ${lagDays.toFixed(2)} day(s) (threshold ${maxDays})`)

if (lagDays > maxDays) {
  console.error(`\n⚠️  HQ submodule pointer is stale — ${lagDays.toFixed(1)} days behind origin/main (threshold ${maxDays})`)
  process.exit(1)
}
