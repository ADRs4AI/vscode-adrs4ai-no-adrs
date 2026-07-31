#!/usr/bin/env node
/**
 * Gleaner 5's first ecosystem sweep — extract error-record/2 specimens
 * (observation, tour-unresolved-refs, drift-detected, etc.) that
 * scripts/harvest-errors.mjs's digest mode can't render.
 *
 * Context: scripts/harvest-errors.mjs (Riddle 5, ADR-0035) reads r.adrPath,
 * r.boxText, r.adrContent — the panel-error/1 shape. error-record/2 records
 * (ADR-0035 Iteration 2/3: source, anchorPath, payload, documents) print as
 * "?  (no box, NO FILE CAPTURED)" in its digest — every founder Report
 * (kind: 'observation') and every tour/census/write-fidelity record is
 * invisible there. This is the founding friction the Ledger Warden seat's
 * brief invited surfacing (§7): "the tooling was built before you existed."
 *
 * Usage: node scripts/ephemeral/2026-07-31-gleaner-first-sweep-extract-schema2-records.mjs [root ...]
 *   Prints one block per error-record/2 line found under each root's
 *   docs/adr/.working/errors.jsonl, with full message/payload/documents keys.
 *
 * OUTCOME (2026-07-31): used to read all 10 founder Report-button records
 * across 5 repos in the seat's first sweep. Riddle 5 blessed folding this
 * logic into scripts/harvest-errors.mjs directly as standing authority
 * (`2026-07-31-riddle-to-gleaner-first-sweep-class-shipped-blessings-and-answers.md`,
 * item 1) — done same day. This file is now superseded; kept per the
 * ephemeral-script convention (record of the investigative tool, not a
 * live dependency).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const roots = process.argv.slice(2)
if (roots.length === 0) roots.push(process.cwd())

for (const root of roots) {
  const logPath = path.join(path.resolve(root), 'docs', 'adr', '.working', 'errors.jsonl')
  if (!fs.existsSync(logPath)) continue
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
  for (const line of lines) {
    let r
    try { r = JSON.parse(line) } catch { continue }
    if (r.schema !== 'error-record/2') continue
    console.log(`\n=== [${path.basename(root)}] ${r.ts} kind=${r.kind} source=${r.source}`)
    console.log('anchorPath:', r.anchorPath)
    console.log('message:', r.message)
    if (r.payload) console.log('payload:', JSON.stringify(r.payload, null, 2))
    if (r.documents) console.log('documents:', Object.keys(r.documents))
  }
}
