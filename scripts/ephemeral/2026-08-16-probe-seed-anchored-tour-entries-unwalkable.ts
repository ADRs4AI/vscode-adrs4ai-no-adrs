// Context: Docent 5's founding diagnosis (QuestionTours Owner seat, founded
// 2026-08-15). Jérémie's Report — "There's something deeply and horribly wrong
// every single time I try a questiontour — they are a honeypot of attention as
// opposed to a helper of it" — was routed by Gleaner as a PRESENTATION bug on
// the Cartographer tour's hollow ADR-0024 stubs. Jérémie's own hypothesis when
// consenting the seat: "it seems seed questions can't be included in the tour,
// so [someone] rewrote a separate ADR and didn't copy everything. All QSTs
// should be citable obviously."
//
// This probe tests that hypothesis against the REAL parser and the REAL HQ
// corpus, rather than against a code read. Two questions:
//
//   (1) What does the resolver actually return for a `seed:<slug>#qst-<handle>`
//       tour entry? (src/mcp/reference.ts:303-305 says whole-seed only.)
//   (2) What is the downstream consequence for the three live HQ tours —
//       specifically walkability (adrTreeProvider.ts:932 counts only
//       `kind === 'question'`), doneness (tourIndex.ts:188, same predicate),
//       and the broken-ref disclosure (tourIndex.ts:208, `kind === 'error'`
//       only — so a seed resolution is neither walkable NOR disclosed).
//
// Usage: npx vite-node scripts/ephemeral/2026-08-16-probe-seed-anchored-tour-entries-unwalkable.ts
//
// OUTCOME (2026-08-16, run against HQ): hypothesis CONFIRMED, and the damage is
// wider than the Report showed.
//   - 2026-07-30-modularization tour: 4 entries, 0 walkable, 0 disclosed broken,
//     done=false permanently (2 must_respond). An empty walk since July 30,
//     never reported — a tour showing nothing gives nothing to report.
//   - 2026-08-14-cartographer tour: 10/10 walk, but the 6 REBAPTISM-relocated
//     stops carry 55-116 content chars with recommendation EMPTY on all six,
//     against 188-3188 chars (recs up to 1655) on the 4 native stops in the
//     same walk. Six blank walls in a ten-stop tour.
//   - Causal link: the relocation was the only route to walkability, so the
//     hollow-stub bug is a SYMPTOM of seed-uncitability, not an independent
//     defect. Repair (make seed QSTs citable) sequenced ahead of compensation
//     (render the relocated recommendation prominently).
// Folded into ADR-0034 Iteration 10 + docs/TOURS-MESS-INVENTORY.md items 1-3.
// Correction made mid-probe: an earlier version measured a nonexistent
// `Question.body` field and printed a meaningless "0"; the real fields are
// whyAsking/need/recommendation/rawBody. Kept as a caution — a probe can lie
// with a plausible zero.

import * as os from 'os'
import * as path from 'path'
import { CompositeIndex } from '../../src/index/compositeIndex'
import { createRepositoryContextAdapter } from '../../src/index/repositoryContextAdapter'
import { discoverTourFiles, resolveTourEntries, isTourDone, unresolvedTourRefs } from '../../src/index/tourIndex'

async function main() {
  const workspaceRoot = path.join(os.homedir(), 'Programming/adrs4ai/initial-meta-repository')
  const composite = await CompositeIndex.fromWorkspace(workspaceRoot, { adrDirRel: 'docs/adr' })
  const ctx = createRepositoryContextAdapter(composite)

  const tours = discoverTourFiles(path.join(workspaceRoot, 'docs/adr'))
  console.log(`workspace: ${workspaceRoot}`)
  console.log(`tours discovered: ${tours.length}\n`)

  for (const tour of tours) {
    const resolved = resolveTourEntries(tour, ctx)
    // The two predicates the real UI uses, restated here verbatim:
    const walkable = resolved.filter(e => e.resolution.kind === 'question')
    const disclosedBroken = unresolvedTourRefs(resolved)

    console.log('='.repeat(78))
    console.log(`TOUR: ${tour.title}`)
    console.log(`  file: ${path.basename(tour.path)}`)
    console.log(`  entries: ${resolved.length}  |  WALKABLE: ${walkable.length}  |  disclosed-broken: ${disclosedBroken.length}  |  done: ${isTourDone(resolved)}`)
    console.log('-'.repeat(78))
    for (const e of resolved) {
      const r = e.resolution
      // The distinction that matters: 'question' walks; 'error' at least gets a
      // visible broken-reference row (doctrine 3); anything else is SILENT.
      const verdict =
        r.kind === 'question' ? 'WALKS'
        : r.kind === 'error' ? 'broken (disclosed)'
        : `SILENT DROP (resolved to '${r.kind}')`
      console.log(`  [${e.mustRespond ? 'must_respond' : 'optional   '}] ${e.ref}`)
      console.log(`      -> resolution.kind='${r.kind}'  ${verdict}`)
    }
    console.log()
  }

  // (2) The Cartographer specimen: are the relocated ADR-0024 blocks really
  //     hollow, and do the seed originals really hold the content?
  console.log('='.repeat(78))
  console.log('CARTOGRAPHER SPECIMEN — relocated block vs. seed original')
  console.log('='.repeat(78))
  // Measure the REAL Question fields (there is no `body` field — the content a
  // walker sees is whyAsking / need / recommendation / rawBody).
  const RELOCATED = ['qst-universal-posture', 'qst-invariants', 'qst-scale', 'qst-interface', 'qst-human-evidence', 'qst-origin']
  const NATIVE = ['qst-home', 'qst-staging', 'qst-visibility', 'qst-anthony']
  const adr0024 = composite.allAdrs().find(a => a.number === 24)
  if (!adr0024) {
    console.log('  ADR-0024 not found in composite index')
  } else {
    const report = (slug: string, tag: string) => {
      const q = adr0024.questions.find(qq => qq.slug === slug)
      if (!q) return console.log(`  ${tag} ${slug}: NOT FOUND`)
      const chars = (s?: string) => (s ?? '').trim().length
      const total = chars(q.whyAsking) + chars(q.need) + chars(q.recommendation) + chars(q.rawBody)
      console.log(
        `  ${tag} ${slug}: whyAsking=${chars(q.whyAsking)} need=${chars(q.need)} ` +
        `rec=${chars(q.recommendation)} rawBody=${chars(q.rawBody)} => TOTAL=${total}`,
      )
    }
    console.log('RELOCATED under the REBAPTISM precedent (content left behind in the seed):')
    RELOCATED.forEach(s => report(s, '[reloc]'))
    console.log("NATIVE to ADR-0024 (the control group — same tour, same walk):")
    NATIVE.forEach(s => report(s, '[nativ]'))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
