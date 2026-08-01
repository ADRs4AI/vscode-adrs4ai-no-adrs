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
import * as path from 'node:path'
import { execFile } from 'node:child_process'

const args = process.argv.slice(2)
const pollIdx = args.indexOf('--poll-secs')
const pollSecs = pollIdx >= 0 ? Number(args[pollIdx + 1]) : 15
const wakeIdx = args.indexOf('--wake')
const wakeAlias = wakeIdx >= 0 ? args[wakeIdx + 1] : null
const roots = args.filter((a, i) =>
  !a.startsWith('--') && i !== pollIdx + 1 && i !== wakeIdx + 1)
if (roots.length === 0) roots.push(process.cwd())

function findLogs(root) {
  const direct = path.join(root, 'docs', 'adr', '.working', 'errors.jsonl')
  if (fs.existsSync(direct)) return [direct]
  const found = []
  let entries = []
  try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return found }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue
    const candidate = path.join(root, e.name, 'docs', 'adr', '.working', 'errors.jsonl')
    if (fs.existsSync(candidate)) found.push(candidate)
  }
  return found
}

function describeRecord(r) {
  if (r.schema === 'error-record/2') {
    const anchor = path.basename(r.anchorPath ?? '?')
    const note = r.message ? ` — "${r.message.slice(0, 100).replace(/\n/g, ' ')}${r.message.length > 100 ? '…' : ''}"` : ''
    return `[${r.kind}] source=${r.source ?? '?'} ${anchor}${note}`
  }
  const adr = path.basename(r.adrPath ?? '?')
  return `[${r.kind}] ${adr}`
}

function wake(alias, message) {
  execFile('just', ['wake', alias, message], (err) => {
    if (err) console.error(`  ! wake failed: ${err.message}`)
  })
}

// logPath -> last-seen line count. Established on first sight of each file
// (whether at startup or a file created mid-run) — that count is the
// baseline; only lines past it are new.
const seen = new Map()
// logPath -> mtimeMs at last read, to skip re-reading unchanged files.
const lastMtime = new Map()

function lineCount(logPath) {
  const text = fs.readFileSync(logPath, 'utf8')
  return text.split('\n').filter(Boolean)
}

function sweepOnce(isStartup) {
  for (const root of roots) {
    for (const logPath of findLogs(path.resolve(root))) {
      let stat
      try { stat = fs.statSync(logPath) } catch { continue }
      if (lastMtime.get(logPath) === stat.mtimeMs) continue
      lastMtime.set(logPath, stat.mtimeMs)

      const lines = lineCount(logPath)
      const baseline = seen.get(logPath)
      if (baseline === undefined) {
        seen.set(logPath, lines.length)
        if (!isStartup) {
          console.log(`\n🆕 new log discovered: ${logPath} (${lines.length} existing record(s), baseline set, not alerting)`)
        }
        continue
      }
      if (lines.length <= baseline) { seen.set(logPath, lines.length); continue }

      const newLines = lines.slice(baseline)
      seen.set(logPath, lines.length)
      for (const line of newLines) {
        let r
        try { r = JSON.parse(line) } catch { console.error(`  ! unparseable new line in ${logPath}`); continue }
        console.log(`\n📬 ${new Date().toISOString()}  ${logPath}`)
        console.log(`   ${r.ts}  ${describeRecord(r)}`)
        if (wakeAlias && r.kind === 'observation') {
          const shortMsg = `New founder Report in ${path.basename(path.dirname(path.dirname(path.dirname(logPath))))}: "${(r.message ?? '').slice(0, 120)}"`
          wake(wakeAlias, shortMsg)
        }
      }
    }
  }
}

console.log(`👁  watch-errors: polling ${roots.length} root(s) every ${pollSecs}s${wakeAlias ? ` (waking '${wakeAlias}' on new founder Reports)` : ''}`)
sweepOnce(true)
console.log(`   baseline set — ${[...seen.values()].reduce((a, b) => a + b, 0)} existing record(s) across ${seen.size} log(s), not alerted on`)
setInterval(() => sweepOnce(false), pollSecs * 1000)
