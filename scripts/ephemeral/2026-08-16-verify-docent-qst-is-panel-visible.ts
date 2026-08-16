// Context: CONVENTIONS §11 says a question for the human is only real if the
// panel parses and surfaces it — "perfect form, wrong surface, zero visibility"
// is the named antipattern. Docent 5 added QST-TOUR-SIX-HOTS to ADR-0034 on
// 2026-08-16; this checks the claim rather than asserting it, by running our
// own parser over our own ADR (the dogfooding cross-check this repo is built on).
//
// Usage: npx vite-node scripts/ephemeral/2026-08-16-verify-docent-qst-is-panel-visible.ts

import * as path from 'path'
import { CompositeIndex } from '../../src/index/compositeIndex'

async function main() {
  const workspaceRoot = path.resolve(__dirname, '../..')
  const composite = await CompositeIndex.fromWorkspace(workspaceRoot, { adrDirRel: 'docs/adr' })
  const adr = composite.allAdrs().find(a => a.number === 34)
  if (!adr) return console.log('FAIL: ADR-0034 not in index')

  console.log(`ADR-0034 parsed: ${adr.questions.length} questions`)
  for (const q of adr.questions) {
    console.log(`  slug='${q.slug}'  answered=${q.isAnswered}  status='${q.statusText}'`)
  }

  const target = adr.questions.find(q => q.slug === 'qst-tour-six-hots')
  console.log('\n--- QST-TOUR-SIX-HOTS ---')
  if (!target) {
    console.log('FAIL: not parsed — it would be invisible to the panel (CONVENTIONS §11 antipattern)')
    process.exit(1)
  }
  const chars = (s?: string) => (s ?? '').trim().length
  console.log(`PASS: parsed, slug='${target.slug}'`)
  console.log(`  isAnswered=${target.isAnswered} (must be false to show as OPEN)`)
  console.log(`  whyAsking=${chars(target.whyAsking)}  need=${chars(target.need)}  rec=${chars(target.recommendation)}`)
  console.log(`  has ANS slot: ${target.answer !== undefined}`)
  if (target.isAnswered) {
    console.log('FAIL: reads as already answered — it would not surface in the open-questions panel')
    process.exit(1)
  }
  if (chars(target.recommendation) === 0) {
    console.log('WARN: no recommendation parsed — this is the exact hollow-stop defect Docent was founded to fix')
    process.exit(1)
  }
  console.log('\nOK — parses, reads open, carries a recommendation. Panel-visible.')
}

main().catch(e => { console.error(e); process.exit(1) })
