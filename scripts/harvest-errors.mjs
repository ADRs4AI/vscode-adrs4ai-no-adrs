#!/usr/bin/env node
/**
 * harvest-errors — sweep panel-error logs across repos (Jérémie's charter,
 * 2026-07-25: "you can even set up like a monitor to find through all of
 * the .working error logs as they come in").
 *
 * Reads every `docs/adr/.working/errors.jsonl` under the given roots and
 * prints a digest: per-repo, per-kind counts and one line per record
 * (timestamp, kind, ADR, box-text size) — enough for a crew member to
 * decide which specimens to pull. Use --full to dump complete records
 * (entire ADR text + box text) for chosen specimens.
 *
 * Usage:
 *   node scripts/harvest-errors.mjs [root ...]          # digest (default root: cwd)
 *   node scripts/harvest-errors.mjs --full [root ...]   # complete records as JSON
 *   node scripts/harvest-errors.mjs --since 2026-07-25 [root ...]
 *
 * Roots may be project dirs (docs/adr/.working/errors.jsonl is found inside)
 * or parent dirs holding many projects (scanned two levels deep).
 *
 * Schema-v2 aware (Gleaner 5, 2026-07-31, standing authority per Riddle 5):
 * `error-record/2` (ADR-0035 Iteration 2/3 — source/anchorPath/payload/
 * documents, includes the founder's Report-button `kind: 'observation'`
 * records) used to print as `?  (no box, NO FILE CAPTURED)` here — every
 * observation/tour/drift record was invisible in the digest. Folded in
 * from `scripts/ephemeral/2026-07-31-gleaner-first-sweep-extract-schema2-records.mjs`.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const args = process.argv.slice(2)
const full = args.includes('--full')
const sinceIdx = args.indexOf('--since')
const since = sinceIdx >= 0 ? new Date(args[sinceIdx + 1]) : null
// BUG FIXED 2026-07-31 (Gleaner 5): when --since was absent, sinceIdx was -1,
// so `i !== sinceIdx + 1` excluded index 0 unconditionally — the first
// positional root argument was silently dropped on every invocation that
// didn't pass --since, and the empty roots[] fell through to the cwd
// fallback below with no warning. `node harvest-errors.mjs <one-root>` from
// inside this repo silently scanned THIS repo instead. The `sinceIdx < 0 ||`
// guard is the fix — only exclude index sinceIdx+1 when --since was found.
const roots = args.filter((a, i) => !a.startsWith('--') && (sinceIdx < 0 || i !== sinceIdx + 1))
if (roots.length === 0) roots.push(process.cwd())

/** Find errors.jsonl files: direct hit, project-shaped, or parent-of-projects. */
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

let totalRecords = 0
for (const root of roots) {
  for (const logPath of findLogs(path.resolve(root))) {
    const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
    const records = []
    for (const [i, line] of lines.entries()) {
      try {
        const r = JSON.parse(line)
        if (since && new Date(r.ts) < since) continue
        records.push(r)
      } catch {
        console.error(`  ! unparseable line ${i + 1} in ${logPath}`)
      }
    }
    if (records.length === 0) continue
    totalRecords += records.length

    if (full) {
      for (const r of records) console.log(JSON.stringify(r, null, 2))
      continue
    }

    console.log(`\n${logPath} — ${records.length} record(s)`)
    const byKind = {}
    for (const r of records) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
    for (const [kind, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)} × ${kind}`)
    }
    for (const r of records) {
      if (r.schema === 'error-record/2') {
        const anchor = path.basename(r.anchorPath ?? '?')
        const docs = r.documents ? `${Object.keys(r.documents).length} doc(s)` : 'no docs'
        const note = r.message ? ` — "${r.message.slice(0, 80).replace(/\n/g, ' ')}${r.message.length > 80 ? '…' : ''}"` : ''
        console.log(`  - ${r.ts}  [${r.kind}]  source=${r.source ?? '?'}  ${anchor}  (${docs})  v${r.extensionVersion ?? '?'}${note}`)
        continue
      }
      const adr = path.basename(r.adrPath ?? '?')
      const box = r.boxText != null ? `box ${r.boxText.length}ch` : 'no box'
      const file = r.adrContent != null ? `file ${r.adrContent.length}ch` : 'NO FILE CAPTURED'
      console.log(`  - ${r.ts}  [${r.kind}]  ${adr}  (${box}, ${file})  v${r.extensionVersion ?? '?'}`)
    }
  }
}

if (!full) {
  console.log(totalRecords === 0
    ? '\nNo error records found. The wild is quiet (or the setting is off).'
    : `\n${totalRecords} record(s) total. Rerun with --full to dump complete specimens.`)
}
