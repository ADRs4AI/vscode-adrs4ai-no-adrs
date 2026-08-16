// Context: ADR-0037 (MCP Tools for QuestionTours), first tool implemented
// (2026-08-16), Docent 5's dispatch. End-to-end smoke test against the
// actual built dist/mcp-server.js, spawned as a real MCP server, in a
// disposable temp workspace.
//
// Usage: node scripts/ephemeral/2026-08-16-smoke-test-bless-qst-handle.mjs
//
// Outcome (2026-08-16): all three checks passed against the real built
// server. Found along the way: a lookup() immediately after bless_qst_handle
// resolves the new anchor only by SUBSTRING FALLBACK against the stale
// in-memory corpus (not an exact match) until refresh_corpus is called --
// the same general write-tier staleness refresh_corpus already exists to
// solve (writes go straight to disk; the served composite index doesn't
// auto-refresh). Not a new bug in this tool -- confirmed the SAME
// characteristic would apply to any write tool's immediate follow-up read.
// Worth a future call on whether write tools should auto-refresh their own
// corpus slice after a successful write, but that's a bigger architectural
// change, not this tool's to make unilaterally.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const serverPath = path.join(repoRoot, 'dist/mcp-server.js')

const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bless-qst-handle-smoke-'))
const adrDir = path.join(tmpWorkspace, 'docs/adr')
fs.mkdirSync(adrDir, { recursive: true })
const adrPath = path.join(adrDir, '0001-smoke-test.md')
fs.writeFileSync(adrPath, [
  '# ADR-0001: Smoke test fixture',
  '',
  '- **Status**: Draft',
  '',
  '## Questions',
  '',
  '### QST: The stated promotion trigger has fired — design now, hold, or fold?',
  '- Status: unanswered',
  '',
].join('\n'))

async function main() {
  const transport = new StdioClientTransport({ command: 'node', args: [serverPath, tmpWorkspace] })
  const client = new Client({ name: 'smoke-test-bless-client', version: '1.0.0' })
  await client.connect(transport)

  console.log('=== (1) bless a question with no handle yet ===')
  const result = await client.callTool({
    name: 'bless_qst_handle',
    arguments: { adr_ref: '1', question_match: 'promotion trigger', slug: 'promotion-trigger' },
  })
  console.log(result.content[0].text)

  const content = fs.readFileSync(adrPath, 'utf8')
  console.log('\nfile now contains anchor AFTER heading:', content.includes('trigger has fired — design now, hold, or fold?\n\n<!-- @adr-anchor: promotion-trigger -->'))

  console.log('\n=== (2) the new anchor resolves via lookup, after refresh_corpus (writes do not auto-refresh the served index) ===')
  await client.callTool({ name: 'refresh_corpus', arguments: {} })
  const looked = await client.callTool({ name: 'lookup', arguments: { ref: 'adr:0001#promotion-trigger' } })
  console.log(looked.content[0].text.split('\n')[0])

  console.log('\n=== (3) idempotent re-bless with same slug ===')
  const again = await client.callTool({
    name: 'bless_qst_handle',
    arguments: { adr_ref: '1', question_match: 'promotion trigger', slug: 'promotion-trigger' },
  })
  console.log(again.content[0].text)

  await client.close()
  fs.rmSync(tmpWorkspace, { recursive: true, force: true })
  console.log('\n✅ smoke test completed without error (temp workspace cleaned up)')
}

main().catch((err) => {
  console.error('❌ smoke test failed:', err)
  fs.rmSync(tmpWorkspace, { recursive: true, force: true })
  process.exit(1)
})
