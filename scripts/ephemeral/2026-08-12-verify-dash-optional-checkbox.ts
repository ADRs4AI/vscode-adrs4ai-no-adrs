/**
 * ADR-0041 item 3, Slice 2: verify the dash-optional CHECKBOX_RE widening
 * against this repo's own real seed corpus before/after the change.
 *
 * Context: Naturalist's 108-seed classifier run found an "ancestral"
 * pre-dash-convention stratum of MRR checkboxes ("[X] text" with no
 * leading "- "). Confirmed two real specimens locally:
 *   - docs/adr/seed-2026-03-04-seeds-listing-in-the-adr-manager-treeview.md
 *   - docs/adr/seed-2026-03-12-bug-debrief-template.md
 *
 * The first specimen is inside prose demonstrating "what the checkbox
 * thing could look like" (a quotation, not a live MRR for that Thread
 * entry) — but its MRR header text is "**Model Response Request**:"
 * (colon OUTSIDE the bold), which MRR_RE (colon INSIDE the bold) does not
 * match, so inMrr never triggers and the checkbox lines are correctly
 * never scanned regardless of dash-optionality. Verified below.
 */

import { parseSeed } from '../../src/parser/seedExtractor'
import * as fs from 'fs'
import * as path from 'path'

const files = [
  'docs/adr/seed-2026-03-04-seeds-listing-in-the-adr-manager-treeview.md',
  'docs/adr/seed-2026-03-12-bug-debrief-template.md',
]

for (const rel of files) {
  const full = path.join(process.cwd(), rel)
  const content = fs.readFileSync(full, 'utf-8')
  const seed = parseSeed(content, full)
  console.log(`\n=== ${rel} ===`)
  console.log('threadEntries:', seed.threadEntries.length)
  for (const e of seed.threadEntries) {
    if (e.request) {
      console.log(`  entry "${e.author}" request:`, e.request)
    }
  }
}
