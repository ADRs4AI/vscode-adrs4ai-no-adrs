// Context: ADR-0021 Iteration 10 (Riddle 5's format ruling) shipped
// Question.rounds — explicit fold grouping recommendations/answers by
// document order. Validating against the real elenchus corpus (55+ wild-
// format ADRs, MADR + collab-adr-lean dialects) before trusting the
// synthetic parser.test.ts fixtures alone: no exception should be thrown,
// every question needs rounds as an array, and any multi-round question in
// the wild is worth eyeballing for plausibility.
//
// Usage: npx vite-node scripts/ephemeral/2026-07-27-validate-rounds-fold-against-elenchus.ts [workspaceRoot]
// (also re-run against this repo's own docs/adr — 68 files, most likely to
// carry real dialogue-layered questions since that convention originates
// in system3, a sibling repo, not elenchus)
//
// Outcome (2026-07-27): elenchus (57 ADRs, 104 questions) — 0 multi-round
// questions (expected, the layering convention hasn't reached that repo
// yet), all rounds arrays present and consistent with the derived flat
// views, no exceptions. This repo's own docs/adr (36 ADRs, 153 questions,
// run with arg ".") — 2 real multi-round questions found (ADR-0003's
// stdio/https QST, ADR-0010's rendering QST), both folded correctly, all
// consistency checks passed. Confirms the fold against real wild-format
// documents, not just the synthetic parser.test.ts fixtures.
import { CompositeIndex } from '../../src/index/compositeIndex'
import * as os from 'os'
import * as path from 'path'

async function main() {
  const workspaceRoot = process.argv[2] ?? path.join(os.homedir(), 'Programming/elenchus-project/elenchus-monorepo')
  const composite = await CompositeIndex.fromWorkspace(workspaceRoot, { adrDirRel: 'docs/adr' })
  const adrs = composite.allAdrs()

  let totalQuestions = 0
  let multiRound = 0
  for (const adr of adrs) {
    for (const q of adr.questions) {
      totalQuestions++
      if (!Array.isArray(q.rounds)) {
        console.error(`FAIL: ${adr.path}#${q.id} — rounds is not an array`)
        process.exit(1)
      }
      // Sanity: derived views must equal what the fold produces.
      const flatRecs = q.rounds.flatMap((r) => r.recommendations)
      const flatAnswers = q.rounds.filter((r) => r.answer).map((r) => r.answer)
      const recsOk = JSON.stringify(q.recommendations ?? []) === JSON.stringify(flatRecs)
      const ansOk = JSON.stringify(q.answers ?? []) === JSON.stringify(flatAnswers)
      if (!recsOk || !ansOk) {
        console.error(`FAIL: ${adr.path}#${q.id} — derived views inconsistent with rounds`)
        process.exit(1)
      }
      if (q.rounds.length > 1) {
        multiRound++
        console.log(`multi-round: ${adr.path}#${q.id} — ${q.rounds.length} rounds`)
      }
    }
  }
  console.log(`OK: ${adrs.length} ADRs, ${totalQuestions} questions, all rounds arrays consistent, ${multiRound} multi-round questions found in the wild`)
}

main().catch((e) => { console.error(e); process.exit(1) })
