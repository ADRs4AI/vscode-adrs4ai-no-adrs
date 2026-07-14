// Context: validating the new stdio MCP server (src/mcp/stdioServer.ts,
// dist/mcp-server.js) end to end, per Lapidary's acceptance criterion
// (2026-07-14-0530-...): "the stdio baseline ships when an external agent
// can port elenchus's ADRs through it." This spawns the real built server
// as a child process over stdio, exactly as Claude Code would, and calls
// real tools against elenchus's actual ADR corpus — not a unit test.
//
// Usage: node scripts/ephemeral/2026-07-14-mcp-stdio-elenchus-smoke-test.mjs
//
// Outcome (2026-07-14): ran clean on the first try against
// dist/mcp-server.js built from vite.mcp-server.config.ts. listTools
// returned all 9 registered tools; project_overview correctly listed
// elenchus's real 8 ADRs (0100-0107); get_outline rendered ADR-0104's full
// section tree (MADR-format, not collab-adr-lean — correctly handled,
// since elenchus predates this project's conventions and porting it IS the
// point); list_open_questions correctly reported 0 (no QST/ANS blocks exist
// in MADR-format ADRs yet). Confirms the stdio transport itself works
// end-to-end over the real MCP protocol. Registering the server with
// `claude mcp add` for a live Claude Code session to discover was attempted
// separately and denied by the auto-mode classifier (self-modification,
// grants write access to an external project) -- routed to Jérémie as a
// decision rather than worked around.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import * as path from 'path'
import * as os from 'os'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const serverPath = path.join(repoRoot, 'dist/mcp-server.js')
const elenchusAdrDir = path.join(os.homedir(), 'Programming/elenchus-project/elenchus-monorepo/docs/adr')

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath, elenchusAdrDir],
  })
  const client = new Client({ name: 'smoke-test-client', version: '1.0.0' })
  await client.connect(transport)

  console.log('=== listTools ===')
  const tools = await client.listTools()
  console.log(tools.tools.map((t) => t.name).join(', '))

  console.log('\n=== project_overview ===')
  const overview = await client.callTool({ name: 'project_overview', arguments: {} })
  console.log(overview.content[0].text)

  console.log('\n=== get_outline(adr_ref: "0104") ===')
  const outline = await client.callTool({ name: 'get_outline', arguments: { adr_ref: '0104' } })
  console.log(outline.content[0].text)

  console.log('\n=== list_open_questions ===')
  const openQuestions = await client.callTool({ name: 'list_open_questions', arguments: { limit: 5 } })
  console.log(openQuestions.content[0].text)

  await client.close()
  console.log('\n✅ smoke test completed without error')
}

main().catch((err) => {
  console.error('❌ smoke test failed:', err)
  process.exit(1)
})
