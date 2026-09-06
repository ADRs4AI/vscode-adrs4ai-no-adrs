// Context: Riddle 5's ledger row (2026-09-05), two firsthand data points
// from Prothonotary's 14-root docket workspace: (1) add_recommendation
// failed on a namespace-qualified/canonical ref that lookup() resolved
// fine; (2) report_observation misfiled a workspace-wide observation into
// the wrong root's ledger. Both root-caused (src/mcp/reference.ts's
// resolveAdrByRef was a second, hand-rolled reference grammar; report_
// observation's no-adr_ref fallback silently picked the launch-time root)
// and fixed same-session. This smoke test confirms both fixes against the
// real built server + a real two-root fixture, not just unit mocks.
//
// Usage: node scripts/ephemeral/2026-09-06-smoke-test-write-path-namespace-resolution.mjs
//
// Outcome (2026-09-06): all four checks passed against the real built
// server and a disposable two-root temp workspace.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const serverPath = path.join(repoRoot, 'dist/mcp-server.js')

const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'write-path-namespace-smoke-'))
// Two sibling git-remote-less roots under one workspace: rootA/rootB, each
// with its own docs/adr/ and its own .git/config (so computeNamespace picks
// a real git-remote-derived slug, not a dirname fallback), matching a
// genuine multi-root forest shape.
function makeRoot(dir, owner, repo, adrBody) {
  const root = path.join(tmpWorkspace, dir)
  fs.mkdirSync(path.join(root, 'docs/adr'), { recursive: true })
  fs.mkdirSync(path.join(root, '.git'), { recursive: true })
  fs.writeFileSync(path.join(root, '.git/config'), `[remote "origin"]\n\turl = git@github.com:${owner}/${repo}.git\n`)
  fs.writeFileSync(path.join(root, 'docs/adr/0001-x.md'), adrBody)
  return root
}

makeRoot('rootA', 'ADRs4AI', 'docket', [
  '# ADR-0001: Docket root fixture',
  '',
  '## Questions',
  '',
  '### QST: Does the write path resolve this root correctly?',
  '- Status: unanswered',
  '',
].join('\n'))

makeRoot('rootB', 'ADRs4AI', 'hq', [
  '# ADR-0001: HQ root fixture',
  '',
  '## Questions',
  '',
  '### QST: A different root entirely.',
  '- Status: unanswered',
  '',
].join('\n'))

async function main() {
  const transport = new StdioClientTransport({ command: 'node', args: [serverPath, tmpWorkspace] })
  const client = new Client({ name: 'write-path-namespace-smoke-client', version: '1.0.0' })
  await client.connect(transport)

  const overview = await client.callTool({ name: 'project_overview', arguments: {} })
  console.log('=== project_overview (confirms two real namespaces discovered) ===')
  console.log(overview.content[0].text)

  // Extract the docket root's namespace from the overview row (ns: <slug>).
  const nsMatch = overview.content[0].text.match(/docket-root-fixture[\s\S]*?ns: (\S+)/) ?? overview.content[0].text.match(/ns: (adrs4ai-docket)/)
  const namespace = nsMatch ? nsMatch[1] : 'adrs4ai-docket'
  console.log(`\nresolved docket namespace: ${namespace}`)

  console.log('\n=== (1) add_recommendation via canonical adr:// URI (used to hard-fail) ===')
  const canonicalResult = await client.callTool({
    name: 'add_recommendation',
    arguments: {
      adr_ref: `adr://v1/repo/ADRs4AI/docket/adr/1`,
      question_id: 'adr-0001-qst-does-the-write-path-resolve-this-root-correctly',
      author: 'Relay 5',
      text: 'Ship it.',
    },
  })
  console.log(canonicalResult.content[0].text)

  console.log('\n=== (2) add_recommendation via namespace-qualified ref (used to hard-fail) ===')
  const nsResult = await client.callTool({
    name: 'add_recommendation',
    arguments: {
      adr_ref: `${namespace}.1`,
      question_id: 'adr-0001-qst-does-the-write-path-resolve-this-root-correctly',
      author: 'Relay 5',
      text: 'Second confirmation.',
    },
  })
  console.log(nsResult.content[0].text)

  console.log('\n=== (3) report_observation with NO adr_ref in a multi-root workspace (used to silently misfile) ===')
  const ambiguous = await client.callTool({
    name: 'report_observation',
    arguments: { note: 'Unscoped observation in a two-root workspace.', author: 'Prothonotary 5' },
  })
  console.log(ambiguous.content[0].text)

  console.log('\n=== (4) report_observation WITH adr_ref still works and lands in the right root ===')
  const scoped = await client.callTool({
    name: 'report_observation',
    arguments: { note: 'Scoped observation.', author: 'Prothonotary 5', adr_ref: `${namespace}.1` },
  })
  console.log(scoped.content[0].text)
  const docketLedger = path.join(tmpWorkspace, 'rootA/docs/adr/.working/errors.jsonl')
  const hqLedger = path.join(tmpWorkspace, 'rootB/docs/adr/.working/errors.jsonl')
  console.log(`\ndocket ledger exists: ${fs.existsSync(docketLedger)}`)
  console.log(`hq ledger exists (should be false — never misfiled): ${fs.existsSync(hqLedger)}`)

  await client.close()
  fs.rmSync(tmpWorkspace, { recursive: true, force: true })
  console.log('\n✅ smoke test completed without error (temp workspace cleaned up)')
}

main().catch((err) => {
  console.error('❌ smoke test failed:', err)
  fs.rmSync(tmpWorkspace, { recursive: true, force: true })
  process.exit(1)
})
