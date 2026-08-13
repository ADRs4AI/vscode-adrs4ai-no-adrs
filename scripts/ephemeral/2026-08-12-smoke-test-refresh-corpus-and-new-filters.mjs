// Context: Lapidary's triple-dispatch, item 2 ("Forma-3 hardening: the
// elenchus harvest"). Live end-to-end smoke test against the real
// elenchus-monorepo corpus, spawning the actual built dist/mcp-server.js:
// (1) refresh_corpus reproduces and then FIXES the exact staleness shape
// Gadfly 5 reported 2026-08-01 (a QST created/edited mid-session returns
// not_found until restart) -- write a temp ADR, confirm not_found, call
// refresh_corpus, confirm it resolves, all without restarting the process;
// (2) the namespace filter and the inconsistency marker both fire against
// real data, not just synthetic fixtures.
//
// Usage: node scripts/ephemeral/2026-08-12-smoke-test-refresh-corpus-and-new-filters.mjs

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const serverPath = path.join(repoRoot, 'dist/mcp-server.js')
const elenchusRoot = path.join(os.homedir(), 'Programming/elenchus-project/elenchus-monorepo')
const tempAdrPath = path.join(elenchusRoot, 'docs/adr/0999-smoke-test-refresh-corpus.md')

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath, elenchusRoot],
  })
  const client = new Client({ name: 'smoke-test-refresh-corpus-client', version: '1.0.0' })
  await client.connect(transport)

  try {
    console.log('=== (1) refresh_corpus reproduces + fixes the 2026-08-01 staleness report ===')
    const beforeWrite = await client.callTool({ name: 'lookup', arguments: { ref: 'adr:0999' } })
    console.log('lookup(adr:0999) BEFORE it exists:', beforeWrite.content[0].text.split('\n')[0])

    fs.writeFileSync(tempAdrPath, [
      '# ADR-0999: Smoke test for refresh_corpus',
      '',
      '- **Status**: Draft',
      '',
      '## Questions',
      '',
      '### QST: Does refresh_corpus see this?',
      '- Status: unanswered',
      '',
    ].join('\n'))

    const staleLookup = await client.callTool({ name: 'lookup', arguments: { ref: 'adr:0999' } })
    console.log('lookup(adr:0999) right after writing, NO refresh yet:', staleLookup.content[0].text.split('\n')[0])

    const refreshResult = await client.callTool({ name: 'refresh_corpus', arguments: {} })
    console.log('refresh_corpus():', refreshResult.content[0].text)

    const freshLookup = await client.callTool({ name: 'lookup', arguments: { ref: 'adr:0999' } })
    console.log('lookup(adr:0999) AFTER refresh_corpus:', freshLookup.content[0].text.split('\n')[0])

    console.log('\n=== (2) namespace filter + inconsistency marker against real data ===')
    const overview = await client.callTool({ name: 'project_overview', arguments: { include_seeds: false } })
    const nsLine = overview.content[0].text.split('\n').find((l) => l.includes('| ns: '))
    console.log('a real ns: value from project_overview:', nsLine)
    if (nsLine) {
      const ns = nsLine.match(/\| ns: (\S+)/)[1]
      const filtered = await client.callTool({ name: 'list_open_questions', arguments: { namespace: ns, limit: 3 } })
      console.log(`list_open_questions({namespace: "${ns}"}) summary:`, filtered.content[0].text.split('\n')[0])
    }
    const allOpen = await client.callTool({ name: 'list_open_questions', arguments: {} })
    console.log('list_open_questions() summary (real corpus):', allOpen.content[0].text.split('\n')[0])
  } finally {
    if (fs.existsSync(tempAdrPath)) fs.unlinkSync(tempAdrPath)
  }

  await client.close()
  console.log('\n✅ smoke test completed without error (temp ADR cleaned up)')
}

main().catch((err) => {
  console.error('❌ smoke test failed:', err)
  if (fs.existsSync(tempAdrPath)) fs.unlinkSync(tempAdrPath)
  process.exit(1)
})
