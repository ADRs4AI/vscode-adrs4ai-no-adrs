// Context: ADR-0021's batch-mutation QST (2026-07-26 design, answered
// 2026-08-14 after Touchstone 4.7's re-read + Midden 5's status nudge
// confirmed nothing was blocking it). End-to-end smoke test against the
// actual built dist/mcp-server.js, spawned as a real MCP server, in a
// disposable temp workspace: three operations (answer + recommendation +
// iteration) applied atomically in one call, plus an atomic-failure check.
//
// Usage: node scripts/ephemeral/2026-08-14-smoke-test-apply-batch.mjs
//
// Outcome (2026-08-14): both checks passed against the real built server.
// (1) three operations (answer_question, update_resolution,
// append_iteration) applied in one call, one write, with a clear per-
// operation diff summary; all three changes verified present in the
// written file. (2) a batch where the second of two operations fails
// (bad question_id) correctly leaves the file byte-for-byte unchanged --
// the first operation's would-be change never lands either. Confirms
// apply_batch before closing ADR-0021's 19-day-overdue batch-mutation QST.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const serverPath = path.join(repoRoot, 'dist/mcp-server.js')

const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-batch-smoke-'))
const adrDir = path.join(tmpWorkspace, 'docs/adr')
fs.mkdirSync(adrDir, { recursive: true })
const adrPath = path.join(adrDir, '0001-smoke-test.md')
const fixture = [
  '# ADR-0001: Smoke test fixture',
  '',
  '- **Date**: 2026-01-01',
  '- **Iteration**: 1',
  '- **Status**: Draft',
  '',
  '---',
  '',
  '## Questions',
  '',
  '### QST: What is the scope?',
  '- Status: unanswered',
  '',
  '**ANS:** (by nobody)',
  '[Fill this in]',
  '',
  '---',
  '',
  '## Iterations',
  '',
  '### Iteration 1 (2026-01-01)',
  '- Human: Started.',
  '- AI: Drafted.',
  '- Outcome: Draft created.',
  '',
  '---',
  '',
  '## Links',
  '',
].join('\n')
fs.writeFileSync(adrPath, fixture)

async function main() {
  const transport = new StdioClientTransport({ command: 'node', args: [serverPath, tmpWorkspace] })
  const client = new Client({ name: 'smoke-test-apply-batch-client', version: '1.0.0' })
  await client.connect(transport)

  console.log('=== (1) three operations, one atomic write ===')
  const result = await client.callTool({
    name: 'apply_batch',
    arguments: {
      adr_ref: '1',
      operations: [
        { tool: 'answer_question', question_id: 'adr-0001-qst-what-is-the-scope', answer_text: 'SQLite for now.', author: 'Relay 5 (smoke test)' },
        { tool: 'update_resolution', resolution: 'consensus' },
        { tool: 'append_iteration', human: 'Reviewed the batch.', ai: 'Answered scope, set resolution.', outcome: 'Landed in one commit.', date: '2026-08-14' },
      ],
    },
  })
  console.log(result.content[0].text)

  const afterFirst = fs.readFileSync(adrPath, 'utf8')
  console.log('\ncontains "SQLite for now.":', afterFirst.includes('SQLite for now.'))
  console.log('contains "- **Resolution**: consensus":', afterFirst.includes('- **Resolution**: consensus'))
  console.log('contains "### Iteration 2 (2026-08-14)":', afterFirst.includes('### Iteration 2 (2026-08-14)'))

  console.log('\n=== (2) atomic failure: a bad question_id rejects the WHOLE batch ===')
  const failResult = await client.callTool({
    name: 'apply_batch',
    arguments: {
      adr_ref: '1',
      operations: [
        { tool: 'append_iteration', human: 'Should never land.', date: '2026-08-14' },
        { tool: 'answer_question', question_id: 'adr-0001-qst-does-not-exist', answer_text: 'irrelevant', author: 'Relay 5 (smoke test)' },
      ],
    },
  })
  console.log(failResult.content[0].text)
  const afterFail = fs.readFileSync(adrPath, 'utf8')
  console.log('content unchanged since (1):', afterFail === afterFirst)

  await client.close()
  fs.rmSync(tmpWorkspace, { recursive: true, force: true })
  console.log('\n✅ smoke test completed without error (temp workspace cleaned up)')
}

main().catch((err) => {
  console.error('❌ smoke test failed:', err)
  fs.rmSync(tmpWorkspace, { recursive: true, force: true })
  process.exit(1)
})
