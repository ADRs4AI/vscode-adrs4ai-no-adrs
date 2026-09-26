/**
 * Pure, testable core of scripts/watch-errors.mjs — split out 2026-09-26 after
 * the watcher's three blind spots were found the hard way in one session:
 *
 * 1. Discovery depth. `findLogs` looked two levels deep, so a ledger four
 *    levels down (moreover, under lumbroso-hq/subprojects/commons-hq/
 *    subprojects/) was never seen — four founder Reports (09-22, 09-26) reached
 *    no one. `--depth` is now a parameter, default 6.
 * 2. Restarts swallowed the gap. Whatever existed when the watcher started was
 *    a baseline, "never alerted on" — so after the 09-20 reboot killed it, six
 *    days of Reports (14 records) were silently baselined away the moment it
 *    was re-armed. A persisted per-log line count (state file) turns a restart
 *    into a catch-up: lines appended while it was down ARE alerted.
 * 3. A brand-new ledger's first Report was baselined. A log first seen MID-RUN
 *    (the first Report ever filed in a newly-enabled repo — the founding scar's
 *    exact shape) was recorded as baseline "not alerting". Now records stamped
 *    after the watcher started are alerted; older ones (a `git pull` bringing
 *    committed history) are still baseline, so a pull can't cause a wake storm.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

/** Every `docs/adr/.working/errors.jsonl` at or under `root`, depth-limited. */
export function findLogs(root, maxDepth = 6) {
  const found = []
  function walk(dir, depth) {
    const direct = path.join(dir, 'docs', 'adr', '.working', 'errors.jsonl')
    if (fs.existsSync(direct)) found.push(direct)
    if (depth >= maxDepth) return
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue
      walk(path.join(dir, e.name), depth + 1)
    }
  }
  walk(root, 0)
  return found
}

/**
 * Decide which lines of a log are NEW (to alert on) and what to remember.
 *
 * @param {object} p
 * @param {string[]} p.lines        non-empty lines currently in the file
 * @param {number|undefined} p.savedCount  line count remembered for this log (this run, or the state file); undefined = never seen
 * @param {boolean} p.isStartup     first sweep of this process
 * @param {number} p.startedAtMs    when this process started
 * @returns {{ alertLines: string[], nextSeen: number, kind: 'steady'|'catch-up'|'baseline'|'discovered' }}
 */
export function decideNewLines({ lines, savedCount, isStartup, startedAtMs }) {
  if (savedCount !== undefined) {
    // A file SHORTER than remembered was truncated/rotated: re-baseline, alert nothing.
    if (lines.length <= savedCount) return { alertLines: [], nextSeen: lines.length, kind: 'steady' }
    return { alertLines: lines.slice(savedCount), nextSeen: lines.length, kind: isStartup ? 'catch-up' : 'steady' }
  }
  if (isStartup) return { alertLines: [], nextSeen: lines.length, kind: 'baseline' }
  // Discovered mid-run: only records stamped after we started count as new.
  const alertLines = lines.filter((l) => {
    try { return Date.parse(JSON.parse(l).ts) >= startedAtMs } catch { return false }
  })
  return { alertLines, nextSeen: lines.length, kind: 'discovered' }
}

export function loadState(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return raw && typeof raw === 'object' && raw.counts && typeof raw.counts === 'object' ? new Map(Object.entries(raw.counts)) : new Map()
  } catch { return new Map() }
}

export function saveState(file, seen) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ savedAt: new Date().toISOString(), counts: Object.fromEntries(seen) }), 'utf8')
  } catch { /* failure-soft: losing the cursor degrades to the old baseline-on-restart behavior, never breaks the watch */ }
}
