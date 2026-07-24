// Context: elenchus's first external-user feedback (Lapidary inbox 2620,
// Gadfly 5's entry in elenchus-monorepo/docs/mcp-feedback.md) flagged an
// unexplained delta -- Grafter's 2026-07-22 smoke test counted 68 open
// questions across 14 ADRs; Gadfly's 2026-07-23 live session counted 65
// across 13, same 53-ADR corpus. Lapidary's hypothesis: v0.7.27's
// emphasis-robust status parsing (commit 24c34b3, tagged 2026-07-23 14:41
// ET -- landed *between* the two runs) newly recognizes previously-missed
// "answered" statuses, which would silently shrink the open count with no
// corpus change at all.
//
// This script counts open questions across a workspace via CompositeIndex
// (same code path project_overview uses) so the same corpus can be diffed
// across two git revisions of THIS repo (the reader), not two points in
// elenchus's history (the corpus).
//
// Usage (run once per revision, in a git worktree checked out at that
// revision, with node_modules symlinked in from the main repo):
//   git worktree add /tmp/wt-before 24c34b3^
//   git worktree add /tmp/wt-after  24c34b3
//   ln -s <repo>/node_modules /tmp/wt-before/node_modules
//   ln -s <repo>/node_modules /tmp/wt-after/node_modules
//   cp scripts/ephemeral/2026-07-23-diagnose-elenchus-68-to-65-delta.ts /tmp/wt-before/scripts/ephemeral/
//   cp scripts/ephemeral/2026-07-23-diagnose-elenchus-68-to-65-delta.ts /tmp/wt-after/scripts/ephemeral/
//   (cd /tmp/wt-before && npx vite-node scripts/ephemeral/2026-07-23-diagnose-elenchus-68-to-65-delta.ts <elenchus-root>) > /tmp/before.json
//   (cd /tmp/wt-after  && npx vite-node scripts/ephemeral/2026-07-23-diagnose-elenchus-68-to-65-delta.ts <elenchus-root>) > /tmp/after.json
//   diff the openIds arrays.
//
// Outcome (2026-07-23): confirmed. Same corpus (55 ADRs both runs -- more
// than Gadfly's 53 since the live corpus has grown since), open count
// dropped from 73 to 70 (a controlled 3-question delta, not 68->65, because
// this corpus is the CURRENT elenchus tree, not a snapshot from either
// historical run -- the mechanism is what matters, not matching the exact
// historical numbers). All 3 flips were open->answered, zero newly opened,
// all three in legacy/docs/adr/0018-email-module-encapsulation.md, all
// three the exact zoo-015 pattern: "- Status: **answered**" (bold-wrapped
// keyword, previously misread as open under Status-authority since the
// leading-token check saw literal asterisks). This is a direct empirical
// reproduction of the hypothesis, not just a plausible story: the delta was
// entirely the reader (parser) changing, zero corpus drift. Led to shipping
// project_overview's scanned_at + version stamp (src/mcp/handlers.ts,
// src/mcp/stdioServer.ts) so future parser changes don't silently redefine
// what a past count meant.

import { CompositeIndex } from '../../src/index/compositeIndex'

async function main() {
  const workspaceRoot = process.argv[2]
  const composite = await CompositeIndex.fromWorkspace(workspaceRoot, { adrDirRel: 'docs/adr' })
  const adrs = composite.allAdrs()
  let openCount = 0
  const openIds: string[] = []
  const adrsWithOpen = new Set<string>()
  for (const adr of adrs) {
    for (const q of adr.questions) {
      if (!q.isAnswered) {
        openCount++
        openIds.push(`${adr.number ?? adr.path}#${q.id}`)
        adrsWithOpen.add(adr.path)
      }
    }
  }
  console.log(JSON.stringify({
    adrCount: adrs.length,
    openCount,
    adrsWithOpenCount: adrsWithOpen.size,
    openIds: openIds.sort(),
  }, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
