// Context: Jérémie's ANS on ADR-0034 QST-TOUR-SIX-HOTS (2026-08-16): seed QSTs
// being uncitable is "an aberration in architecture-of-complexity terms... I find
// [it] sincerely humiliating; given I thought we were developing a well-formed
// algebra of concepts, I am surprised to find that QSTs in ADRs are
// algebraically/structurally different in our data model." He asked for the DEEP
// answer: "What about the model/infrastructure around seeds makes this happen?"
//
// The question is falsifiable, so measure it instead of theorizing. If seed
// questions are genuinely second-class (no stable id, no slug, no anchor
// override, different shape), the model IS asymmetric and the fix is deep. If
// they are the same Question objects with the same identity machinery, the
// asymmetry lives ONLY in the resolver and the model was right all along.
//
// Usage: npx vite-node scripts/ephemeral/2026-08-16-probe-are-seed-questions-second-class-in-the-model.ts

import * as path from 'path'
import { CompositeIndex } from '../../src/index/compositeIndex'

async function main() {
  const workspaceRoot = path.resolve(__dirname, '../..')
  const composite = await CompositeIndex.fromWorkspace(workspaceRoot, { adrDirRel: 'docs/adr' })

  const adrs = composite.allAdrs()
  const seeds = composite.allSeeds()
  const adrQs = adrs.flatMap(a => a.questions)
  const seedQs = seeds.flatMap(s => s.questions)

  console.log(`corpus: ${adrs.length} ADRs (${adrQs.length} QSTs) | ${seeds.length} seeds (${seedQs.length} QSTs)\n`)

  // Do seed questions carry the SAME identity machinery ADR questions do?
  const audit = (label: string, qs: typeof adrQs) => {
    const has = (f: (q: (typeof adrQs)[number]) => unknown) => qs.filter(q => Boolean(f(q))).length
    console.log(`${label} (n=${qs.length})`)
    console.log(`  with stable id:        ${has(q => q.id)}/${qs.length}`)
    console.log(`  with slug:             ${has(q => q.slug)}/${qs.length}`)
    console.log(`  with statusText:       ${has(q => q.statusText)}/${qs.length}`)
    console.log(`  isAnswered computed:   ${qs.filter(q => q.isAnswered).length} answered`)
    console.log(`  with recommendation:   ${has(q => q.recommendation)}`)
    console.log(`  with answer object:    ${has(q => q.answer)}`)
    console.log(`  DISTINCT id values:    ${new Set(qs.map(q => q.id)).size}`)
  }
  audit('ADR questions', adrQs)
  console.log()
  audit('SEED questions', seedQs)

  // The id-shape question: do seed QSTs get a namespace that ADMITS they are
  // seed-borne, or do they masquerade under an `adr-` prefix?
  console.log('\n--- id shapes (first 6 of each) ---')
  console.log('ADR: ', adrQs.slice(0, 6).map(q => q.id).join('\n      '))
  console.log('SEED:', seedQs.slice(0, 6).map(q => q.id).join('\n      '))

  // Is any ADR question's id colliding with a seed question's id? (Would mean
  // the identity space is genuinely shared and ambiguous.)
  const adrIds = new Set(adrQs.map(q => q.id))
  const collisions = seedQs.filter(q => adrIds.has(q.id))
  console.log(`\nid collisions between the two containers: ${collisions.length}`)

  console.log('\n--- VERDICT ---')
  const seedHasFullIdentity = seedQs.every(q => q.id && q.slug)
  console.log(
    seedHasFullIdentity
      ? 'Seed questions carry the SAME identity machinery as ADR questions.\n' +
        'The parser layer treats both containers as one algebra. The asymmetry is\n' +
        'NOT in the data model — it is in the resolver alone (reference.ts:303-305).'
      : 'Seed questions are missing identity fields — the model IS asymmetric.',
  )
}

main().catch(e => { console.error(e); process.exit(1) })
