// Context: validating native multi-project support in the stdio MCP server
// (Lapidary's 2026-07-14 ADR-0021 Iteration 8 addition): elenchus-monorepo
// actually has FOUR ADR trees (root docs/adr, ui/docs/adr, legacy/docs/adr,
// api/docs/adr) — running one server instance per tree was a workaround,
// not the answer. This points the server at the WORKSPACE ROOT (not a
// single docs/adr) so CompositeIndex.fromWorkspace discovers all four,
// and confirms project_overview surfaces ADRs from every tree in one call.
//
// Usage: node scripts/ephemeral/2026-07-14-mcp-stdio-elenchus-multiroot-smoke-test.mjs
//
// Outcome (2026-07-14): project_overview correctly listed all four trees in
// one call (root's 8 + ui's 1 + legacy's ~41, including two genuine
// internal duplicate-number pairs -- 0016 and 0041 each appear twice in
// legacy/docs/adr -- + api's 1), no separate server instances needed.
//
// First run surfaced a real bug the synthetic unit test hadn't caught: the
// ambiguous-error candidate list formatted each match as "namespace.NNNN",
// which assumes namespace alone disambiguates -- but legacy/'s two 0016
// files share the SAME namespace (they're in the same root), so both
// candidates printed identically. Fixed in src/mcp/reference.ts
// (resolveAdrByNumber): candidates now always include the filename, and the
// message names the same-namespace case distinctly ("appears N times
// within the same namespace/root" vs. "exists in N roots/namespaces").
// Added a matching regression test built on this exact elenchus specimen
// (two files, both "0016", same namespace) before re-running this script.
// Second run confirmed the fix: distinct filenames in the candidate list,
// correct message for the same-namespace case.
//
// Re-run (2026-07-23/24): reused to validate the scanned_at/version stamp
// added to project_overview after elenchus's first real feedback (Lapidary
// inbox 2620, Gadfly's mcp-feedback.md entry) reported an unexplained
// 68->65 open-question delta between two runs a day apart, same 53-ADR
// count. Diagnosed by checking out the extractor at 24c34b3^ and 24c34b3
// (v0.7.27's emphasis-robust status parsing) and diffing project_overview's
// output against the real corpus at both revisions: exactly 3 questions
// flip open->answered (legacy/0018-email-module-encapsulation.md's
// "- Status: **answered**" lines, the exact zoo-015 class), zero newly
// opened -- confirming the delta was the parser changing, not the corpus.
// This run's output now stamps that fact directly: "scanned_at:
// 2026-07-24T03:13:50.597Z | version: 0.7.28" -- real timestamp, real
// running package version (previously hardcoded '1.0.0' in the McpServer
// constructor, silently wrong the whole time). Corpus-refresh itself
// (mtime rescan / refresh_corpus tool, elenchus's Catch 1) is still open --
// this only makes staleness/version-drift detectable, not prevented.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import * as path from 'path'
import * as os from 'os'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const serverPath = path.join(repoRoot, 'dist/mcp-server.js')
const elenchusRoot = path.join(os.homedir(), 'Programming/elenchus-project/elenchus-monorepo')

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath, elenchusRoot],
  })
  const client = new Client({ name: 'smoke-test-multiroot-client', version: '1.0.0' })
  await client.connect(transport)

  console.log('=== project_overview (all four trees?) ===')
  const overview = await client.callTool({ name: 'project_overview', arguments: { include_seeds: false } })
  console.log(overview.content[0].text)

  console.log('\n=== lookup("adr:0016") — should be ambiguous (legacy/ has it twice) ===')
  const ambiguous = await client.callTool({ name: 'lookup', arguments: { ref: 'adr:0016' } })
  console.log(ambiguous.content[0].text)

  await client.close()
  console.log('\n✅ multi-root smoke test completed without error')
}

main().catch((err) => {
  console.error('❌ smoke test failed:', err)
  process.exit(1)
})
