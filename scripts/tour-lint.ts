#!/usr/bin/env node
/**
 * tour-lint CLI — thin wrapper around src/index/tourLint.ts's pure
 * lintTours(). See that file for the doctrine/context; this file is only
 * argv/env handling, discovery, and console reporting.
 *
 * Reused machinery, not a parallel implementation: same discovery
 * (CompositeIndex.fromWorkspace) and the same resolver
 * (createRepositoryContextAdapter → resolveTourEntries) the extension's own
 * Tours tree/walk dialog already use — see src/views/adrTreeProvider.ts.
 *
 * Usage:
 *   npx tsx scripts/tour-lint.ts [workspaceRoot]
 *   just tour-lint [workspaceRoot]
 *
 * Workspace root: first CLI arg, else $ADR_WORKSPACE_ROOT, else ".".
 * ADR directory within each discovered root: $ADR_DIR_REL, else "docs/adr"
 * — same env-var convention as src/mcp/stdioServer.ts.
 *
 * Exit code: 1 if any tour entry fails to resolve at all (a genuinely
 * broken ref); 0 otherwise (a non-question resolution is reported as a
 * warning, not a failure).
 */

import * as path from 'path'
import { CompositeIndex } from '../src/index/compositeIndex'
import { createRepositoryContextAdapter } from '../src/index/repositoryContextAdapter'
import { lintTours } from '../src/index/tourLint'

async function main(): Promise<number> {
  const workspaceRoot = path.resolve(process.argv[2] ?? process.env.ADR_WORKSPACE_ROOT ?? '.')
  const adrDirRel = process.env.ADR_DIR_REL ?? 'docs/adr'

  const composite = await CompositeIndex.fromWorkspace(workspaceRoot, { adrDirRel })
  const ctx = createRepositoryContextAdapter(composite)
  const tours = composite.allTours().map(({ node, tour }) => ({ tour, namespace: node.namespace }))

  if (tours.length === 0) {
    console.log(`tour-lint: no *.tour.json found under ${workspaceRoot} (searched every discovered docs/adr/tours/)`)
    return 0
  }

  const { findings } = lintTours(tours, ctx)

  if (findings.length === 0) {
    console.log(`tour-lint: ${tours.length} tour(s) across ${new Set(tours.map(t => t.namespace)).size} root(s) — every entry resolves clean.`)
    return 0
  }

  const byTour = new Map<string, typeof findings>()
  for (const f of findings) {
    const key = `${f.tourSlug}|${f.tourPath}`
    if (!byTour.has(key)) byTour.set(key, [])
    byTour.get(key)!.push(f)
  }

  let errorCount = 0
  let warnCount = 0
  for (const [, group] of byTour) {
    const first = group[0]
    console.log(`${first.tourSlug}${first.retired ? ' (retired)' : ''} [${first.namespace}] — ${first.tourPath}`)
    for (const f of group) {
      const icon = f.severity === 'error' ? '✗' : '⚠'
      console.log(`  ${icon} entry ${f.entryIndex + 1} — "${f.ref}" — ${f.message}`)
      if (f.severity === 'error') errorCount++
      else warnCount++
    }
    console.log()
  }

  console.log(`tour-lint: ${errorCount} broken ref(s), ${warnCount} non-question ref(s), across ${tours.length} tour(s).`)
  return errorCount > 0 ? 1 : 0
}

main().then(code => process.exit(code)).catch(err => {
  console.error('tour-lint: unexpected failure —', err)
  process.exit(1)
})
