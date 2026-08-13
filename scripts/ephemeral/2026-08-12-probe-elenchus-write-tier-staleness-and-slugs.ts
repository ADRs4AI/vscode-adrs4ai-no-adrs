// Context: Lapidary's triple-dispatch (docs/inbox/2026-08-14-lapidary-triple-dispatch-*.md,
// item 2, "Forma-3 hardening: the elenchus harvest") — checking two things
// from elenchus's mcp-feedback.md against the real, CURRENT corpus:
// (1) Gadfly's 2026-08-01 report: add_recommendation refused a QST
//     ("...doesn't count toward target, signup optional...") that verifiably
//     existed on disk -- was it staleness, or slug-derivation trouble on a
//     long, comma/quote-heavy heading? (2) whether the corpus still shows
//     the same class of Status/ANS mismatch Hypomnema measured on
//     legacy/0021-0024 (25 "unanswered" labels, 0 "answered", 22/22 real
//     QSTs already had a substantive ANS block).
//
// Usage: npx vite-node scripts/ephemeral/2026-08-12-probe-elenchus-write-tier-staleness-and-slugs.ts
import { CompositeIndex } from '../../src/index/compositeIndex'
import * as os from 'os'
import * as path from 'path'

async function main() {
  const workspaceRoot = path.join(os.homedir(), 'Programming/elenchus-project/elenchus-monorepo')
  const composite = await CompositeIndex.fromWorkspace(workspaceRoot, { adrDirRel: 'docs/adr' })
  const adrs = composite.allAdrs()

  // (1) the exact heading Gadfly's report named
  const target = adrs.find((a) => a.path.endsWith('0300-priority-based-fair-distribution-ui.md'))
  if (target) {
    const q = target.questions.find((qq) => qq.text.includes("doesn't count toward"))
    console.log('--- (1) slug-derivation check ---')
    console.log('found question:', !!q)
    if (q) console.log('id:', q.id, '| slug:', q.slug, '| isAnswered:', q.isAnswered)
  }

  // (2) Status/ANS mismatch sweep, mirroring Hypomnema's measurement
  console.log('\n--- (2) Status/ANS mismatch sweep (all trees) ---')
  let mismatchCount = 0
  let totalQuestions = 0
  for (const adr of adrs) {
    for (const q of adr.questions) {
      totalQuestions++
      const declaredUnanswered = /^unanswered\b/i.test(q.statusText.trim())
      const hasRealAnswer = !!q.answer && q.answer.text.trim().length > 0
      if (declaredUnanswered && hasRealAnswer) {
        mismatchCount++
        console.log(`MISMATCH: ${adr.path}#${q.slug} — statusText="${q.statusText}" but has a real ANS`)
      }
    }
  }
  console.log(`\n${mismatchCount} mismatches out of ${totalQuestions} questions total`)
}

main().catch((e) => { console.error(e); process.exit(1) })
