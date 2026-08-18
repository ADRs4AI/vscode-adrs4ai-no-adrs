// Context: GIF-SCRIPTS.md Script 5 ("MCP read call from Claude Code") has been
// gated for weeks on "a live-client-handshake confirmation was never obtained."
// Jérémie asked for a demo prompt to paste into a real Claude Code window in
// fixture-workspace; before green-lighting that, confirming the exact same
// path (Client/StdioClientTransport spawning dist/mcp-server.js against the
// fixture's own ADR tree) that a real Claude Code MCP client would take.
//
// Usage: node scripts/ephemeral/2026-08-19-live-handshake-check-fixture-workspace.mjs
//
// Outcome (2026-08-19): handshake + project_overview + lookup all succeeded
// against fixture-workspace's real 6 ADRs. Confirms the server is ready for
// a real Claude Code session pointed at fixture-workspace/.mcp.json.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import * as path from 'path'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const serverPath = path.join(repoRoot, 'dist/mcp-server.js')
const fixtureRoot = path.join(repoRoot, 'fixture-workspace')

async function main() {
  const transport = new StdioClientTransport({ command: 'node', args: [serverPath, fixtureRoot] })
  const client = new Client({ name: 'live-handshake-check', version: '1.0.0' })
  await client.connect(transport)
  console.log('=== handshake OK ===')

  const tools = await client.listTools()
  console.log(`tools/list: ${tools.tools.length} tools — ${tools.tools.map((t) => t.name).join(', ')}`)

  console.log('\n=== project_overview ===')
  const overview = await client.callTool({ name: 'project_overview', arguments: {} })
  console.log(overview.content[0].text)

  console.log('\n=== lookup(adr:0002) ===')
  const looked = await client.callTool({ name: 'lookup', arguments: { ref: 'adr:0002' } })
  console.log(looked.content[0].text.split('\n').slice(0, 5).join('\n'))

  await client.close()
  console.log('\n✅ live handshake check completed without error')
}

main().catch((err) => {
  console.error('❌ live handshake check failed:', err)
  process.exit(1)
})
