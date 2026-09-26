#!/usr/bin/env node
/**
 * watch-errors — a standing watcher for `docs/adr/.working/errors.jsonl`
 * across the ecosystem, so new specimens announce themselves instead of
 * needing a periodic `harvest-errors.mjs --since` sweep (Gleaner 5's own
 * manual loop, replaced here at Jérémie's request, 2026-08-01: "write a
 * script to monitor for new errors.jsonl... streamline our pipeline
 * further").
 *
 * Polls each root's errors.jsonl for new lines (mtime-gated stat, so an
 * unchanged file costs one syscall, not a re-read) and prints a digest of
 * anything new since the watcher started — same schema-aware formatting
 * as harvest-errors.mjs (panel-error/1 and error-record/2, including
 * founder Report `kind: observation` records). Existing content at start
 * is a baseline, never alerted on — same "only new since start" contract
 * as `just wait-for-brief`.
 *
 * Usage:
 *   node scripts/watch-errors.mjs [root ...]                  # print only
 *   node scripts/watch-errors.mjs --poll-secs 10 [root ...]
 *   node scripts/watch-errors.mjs --wake gleaner [root ...]   # also
 *     `just wake <alias> "..."` on every new founder Report (kind:
 *     observation) — the pipeline waking its own triager, not the other
 *     way around. Requires running from a repo with a `justfile` wake
 *     recipe (this one).
 *
 * Roots may be project dirs (docs/adr/.working/errors.jsonl found inside)
 * or parent dirs holding many projects (scanned two levels deep) — same
 * discovery rule as harvest-errors.mjs, duplicated rather than imported
 * (harvest-errors.mjs is a CLI script, not a module, and duplicating one
 * small function here is cheaper than restructuring it for one import).
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { findLogs, decideNewLines, loadState, saveState } from './watch-errors-core.mjs'

const args = process.argv.slice(2)
const pollIdx = args.indexOf('--poll-secs')
const pollSecs = pollIdx >= 0 ? Number(args[pollIdx + 1]) : 15
const wakeIdx = args.indexOf('--wake')
const wakeAlias = wakeIdx >= 0 ? args[wakeIdx + 1] : null
// 2026-09-26: discovery depth is a parameter (default 6, was a hard 2) — a
// ledger four levels down (moreover) was invisible; see watch-errors-core.mjs.
const depthIdx = args.indexOf('--depth')
const maxDepth = depthIdx >= 0 ? Number(args[depthIdx + 1]) : 6
// Persisted per-log line counts, so a restart CATCHES UP on what arrived while
// the watcher was down instead of baselining it away (the 09-20 reboot gap).
const stateIdx = args.indexOf('--state')
const stateFile = stateIdx >= 0 ? args[stateIdx + 1] : path.join(os.homedir(), '.cache', 'adrs4ai', 'watch-errors-state.json')
const startedAtMs = Date.now()
const roots = args.filter((a, i) =>
  !a.startsWith('--') && i !== pollIdx + 1 && i !== wakeIdx + 1 && i !== depthIdx + 1 && i !== stateIdx + 1)
if (roots.length === 0) roots.push(process.cwd())

// BUG FOUND IN PRODUCTION (2026-08-14, Gleaner self-audit, Jérémie's "you're
// no longer watching reports"): this used to `return [direct]` the instant
// the ROOT itself had its own errors.jsonl — which HQ always does — so a
// root with both its own ledger AND subproject ledgers (HQ's own
// subprojects/ios-client, /pneumatic, etc.) silently watched only the top
// one. Every HQ subproject report landed invisibly to this watcher all
// session; only manual sweeps caught them. Fixed to UNION the direct hit
// with a real depth-limited walk (matches the doc comment's own promise of
// "two levels deep," which the old one-level early-return never actually
// honored either).
// findLogs lives in watch-errors-core.mjs now (depth-limited walk; see its header).

function describeRecord(r) {
  if (r.schema === 'error-record/2') {
    const anchor = path.basename(r.anchorPath ?? '?')
    const note = r.message ? ` — "${r.message.slice(0, 100).replace(/\n/g, ' ')}${r.message.length > 100 ? '…' : ''}"` : ''
    return `[${r.kind}] source=${r.source ?? '?'} ${anchor}${note}`
  }
  const adr = path.basename(r.adrPath ?? '?')
  return `[${r.kind}] ${adr}`
}

// BUG FOUND IN PRODUCTION (2026-08-02): `just wake`'s own recipe body
// re-quotes its {{message}} argument inside a shell script (confirmed via
// the actual failure: "unexpected EOF while looking for matching `''"). A
// message containing an apostrophe or quote — trivially common in a
// founder Report's own words ("doesn't exist") — breaks that inner
// quoting even though execFile here never shells out itself. Not our
// recipe to fix; stripping quote characters before handing off is cheap
// and the message is a short summary anyway, not the specimen record.
function wake(alias, message) {
  const safe = message.replace(/['"]/g, '')
  execFile('just', ['wake', alias, safe], (err) => {
    if (err) console.error(`  ! wake failed: ${err.message}`)
  })
}

// logPath -> last-seen line count, seeded from the state file so a restart
// resumes where the last run stopped (catch-up) rather than re-baselining.
const seen = loadState(stateFile)
// logPath -> mtimeMs at last read, to skip re-reading unchanged files.
const lastMtime = new Map()

// Directory walks are the expensive part; rediscover on a slower cadence than
// the per-log stat, so new hives are still picked up within minutes.
const DISCOVER_EVERY_MS = 5 * 60 * 1000
let knownLogs = []
let lastDiscoveredAt = 0
function discover() {
  if (Date.now() - lastDiscoveredAt < DISCOVER_EVERY_MS && knownLogs.length) return knownLogs
  knownLogs = [...new Set(roots.flatMap((r) => findLogs(path.resolve(r), maxDepth)))]
  lastDiscoveredAt = Date.now()
  return knownLogs
}

function readLines(logPath) {
  return fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
}

function sweepOnce(isStartup) {
  let changed = false
  const caughtUp = []
  for (const logPath of discover()) {
    let stat
    try { stat = fs.statSync(logPath) } catch { continue }
    if (lastMtime.get(logPath) === stat.mtimeMs) continue
    lastMtime.set(logPath, stat.mtimeMs)

    const lines = readLines(logPath)
    const { alertLines, nextSeen, kind } = decideNewLines({
      lines, savedCount: seen.get(logPath), isStartup, startedAtMs,
    })
    if (seen.get(logPath) !== nextSeen) changed = true
    seen.set(logPath, nextSeen)
    if (kind === 'discovered') {
      console.log(`\n🆕 new log discovered: ${logPath} (${lines.length} record(s); ${alertLines.length} stamped after this watcher started, alerting on those)`)
    }
    for (const line of alertLines) {
      let r
      try { r = JSON.parse(line) } catch { console.error(`  ! unparseable new line in ${logPath}`); continue }
      console.log(`\n📬 ${new Date().toISOString()}${kind === 'catch-up' ? ' [CATCH-UP: arrived while the watcher was down]' : ''}  ${logPath}`)
      console.log(`   ${r.ts}  ${describeRecord(r)}`)
      if (wakeAlias && r.kind === 'observation') {
        if (kind === 'catch-up') { caughtUp.push({ logPath, r }); continue }
        const shortMsg = `New founder Report in ${path.basename(path.dirname(path.dirname(path.dirname(logPath))))}: "${(r.message ?? '').slice(0, 120)}"`
        wake(wakeAlias, shortMsg)
      }
    }
  }
  // One wake for the whole catch-up, not one per record (a restart after days
  // down must not become a wake storm).
  if (wakeAlias && caughtUp.length) {
    const repos = [...new Set(caughtUp.map(({ logPath }) => path.basename(path.dirname(path.dirname(path.dirname(logPath))))))]
    wake(wakeAlias, `CATCH-UP: ${caughtUp.length} founder Report(s) filed while the watcher was down, in ${repos.join(', ')} — run harvest-errors or read the watcher digest`)
  }
  if (changed) saveState(stateFile, seen)
}

console.log(`👁  watch-errors: polling ${roots.length} root(s) (depth ${maxDepth}, state ${stateFile}) every ${pollSecs}s${wakeAlias ? ` (waking '${wakeAlias}' on new founder Reports)` : ''}`)
sweepOnce(true)
console.log(`   baseline set — ${[...seen.values()].reduce((a, b) => a + b, 0)} existing record(s) across ${seen.size} log(s), not alerted on`)
setInterval(() => sweepOnce(false), pollSecs * 1000)
