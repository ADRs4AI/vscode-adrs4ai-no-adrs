// Context: Lapidary's 2026-08-13 dispatch, founder-ratified report_observation
// MCP tool ("the Report button for transformers"). End-to-end smoke test
// against the ACTUAL BUILT dist/mcp-server.js, spawned as a real MCP
// server, in a disposable temp workspace (not elenchus's real corpus --
// that repo's docs/adr/.working/errors.jsonl is a real specimen ledger,
// and a smoke-test line doesn't belong in it).
//
// Usage: node scripts/ephemeral/2026-08-13-smoke-test-report-observation.mjs
//
// Outcome (2026-08-13): all four checks passed against the real built
// server — missing author rejected; a workspace-wide observation (no
// adr_ref) written with no document captured; an ADR-tied observation
// written WITH the full referenced document captured (hasDocument=true);
// both records show schema=error-record/2, source=mcp, kind=observation,
// correct author and extensionVersion. Confirms report_observation before
// routing to Riddle for the ADR-0035 schema blessing.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const serverPath = path.join(repoRoot, 'dist/mcp-server.js')

const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'report-observation-smoke-'))
const adrDir = path.join(tmpWorkspace, 'docs/adr')
fs.mkdirSync(adrDir, { recursive: true })
fs.writeFileSync(path.join(adrDir, '0001-smoke-test.md'), [
  '# ADR-0001: Smoke test fixture',
  '',
  '- **Status**: Draft',
  '',
  '## Questions',
  '',
  '### QST: Does report_observation capture me?',
  '- Status: unanswered',
  '',
].join('\n'))

async function main() {
  const transport = new StdioClientTransport({ command: 'node', args: [serverPath, tmpWorkspace] })
  const client = new Client({ name: 'smoke-test-report-observation-client', version: '1.0.0' })
  await client.connect(transport)

  console.log('=== (1) missing author is rejected ===')
  const missingAuthor = await client.callTool({ name: 'report_observation', arguments: { note: 'test', author: '' } })
  console.log(missingAuthor.content[0].text)

  console.log('\n=== (2) workspace-wide observation, no adr_ref ===')
  const wide = await client.callTool({
    name: 'report_observation',
    arguments: { note: 'The corpus felt stale after a mid-session commit.', author: 'Relay 5 (smoke test)' },
  })
  console.log(wide.content[0].text)

  console.log('\n=== (3) observation tied to a real ADR, with context ===')
  const tied = await client.callTool({
    name: 'report_observation',
    arguments: {
      note: 'This QST reads as unanswered but the parser sees a real answer beneath it.',
      author: 'Relay 5 (smoke test)',
      adr_ref: '1',
      context: 'found while probing the inconsistency marker',
    },
  })
  console.log(tied.content[0].text)

  console.log('\n=== (4) inspecting the actual ledger written ===')
  const logPath = path.join(adrDir, '.working/errors.jsonl')
  const lines = fs.readFileSync(logPath, 'utf8').trimEnd().split('\n')
  console.log(`${lines.length} record(s) written`)
  for (const line of lines) {
    const rec = JSON.parse(line)
    console.log(`- schema=${rec.schema} source=${rec.source} kind=${rec.kind} author=${rec.payload?.author} hasDocument=${!!rec.documents} extensionVersion=${rec.extensionVersion}`)
  }

  await client.close()
  fs.rmSync(tmpWorkspace, { recursive: true, force: true })
  console.log('\n✅ smoke test completed without error (temp workspace cleaned up)')
}

main().catch((err) => {
  console.error('❌ smoke test failed:', err)
  fs.rmSync(tmpWorkspace, { recursive: true, force: true })
  process.exit(1)
})
