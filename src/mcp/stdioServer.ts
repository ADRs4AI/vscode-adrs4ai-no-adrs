#!/usr/bin/env node
/**
 * Standalone stdio MCP server entry point (ADR-0003 transport decision:
 * stdio baseline first). This is deliberately NOT part of the VS Code
 * extension bundle (dist/extension.js) — it's a separate Node program that
 * an MCP client (Claude Code) spawns directly and pipes stdin/stdout to.
 * Runs with no VS Code extension host involved at all, per Jérémie's ADR-0003
 * ANS: "someone wanting to only use Claude Code but without VSCode... stdio
 * could be simpler for other clients."
 *
 * Every tool handler this registers (src/mcp/handlers.ts) and the
 * RepositoryContext it's built against (src/index/repositoryContextAdapter.ts
 * over CompositeIndex/AdrIndex/SeedIndex) are already vscode-free — this
 * file is the first thing in the whole MCP surface that assembles them into
 * a running server, not new resolution or write logic.
 *
 * Native multi-project (2026-07-14, Lapidary's ADR-0021 Iteration 8
 * addition): a workspace root can contain several ADR-bearing trees — e.g.
 * elenchus-monorepo has docs/adr at its root plus ui/docs/adr, legacy/docs/adr,
 * api/docs/adr. Running one server instance per tree is a workaround, not
 * the answer; CompositeIndex.fromWorkspace (Fitter's ADR-0025 discovery
 * walker, already vscode-free) is the obvious backend, so this server scans
 * from a *workspace root* rather than a single ADR directory.
 *
 * Workspace root: first CLI argument, else $ADR_WORKSPACE_ROOT, else "."
 * (the directory the client launches this with). ADR directory within each
 * discovered root: $ADR_DIR_REL, else "docs/adr" — matching the extension's
 * own `adrManager.adrDirectory` default.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import * as path from 'path'
import * as fs from 'fs'
import { CompositeIndex } from '../index/compositeIndex'
import { createRepositoryContextAdapter } from '../index/repositoryContextAdapter'
import {
  projectOverview,
  lookup,
  getOutline,
  getSections,
  listOpenQuestions,
  answerQuestion,
  addRecommendation,
  appendIteration,
  updateResolution,
} from './handlers'

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] }
}

// Read from the package alongside this file rather than a bundled JSON
// import — this file ships as a single portable CJS bundle (dist/mcp-server.js)
// and the repo's package.json is its only reliable version source at runtime.
// Falls back to 'unknown' rather than throwing: a missing version stamp is
// far less harmful than a server that won't start.
function readServerVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

async function main() {
  const workspaceRoot = path.resolve(process.argv[2] ?? process.env.ADR_WORKSPACE_ROOT ?? '.')
  const adrDirRel = process.env.ADR_DIR_REL ?? 'docs/adr'
  const serverVersion = readServerVersion()

  const composite = await CompositeIndex.fromWorkspace(workspaceRoot, { adrDirRel })
  // Scan happens once, here, at startup — there is no per-call refresh yet
  // (elenchus feedback 2026-07-23, Catch 1: ADRs committed mid-session are
  // invisible until restart). scannedAt captures *when* this snapshot was
  // taken so a stale read is at least detectable, even though it isn't yet
  // preventable — the harder fix (mtime-based rescan or a refresh_corpus
  // tool) is still open.
  const scannedAt = new Date().toISOString()
  // CompositeIndex already exposes allAdrs()/allSeeds() aggregated across
  // every discovered root — the adapter's IndexSource shape needs nothing
  // more, so this is a direct pass-through, not a new integration.
  const ctx = createRepositoryContextAdapter(composite)

  const server = new McpServer({ name: 'adrs-for-ai', version: serverVersion })

  server.registerTool(
    'project_overview',
    {
      description: 'Pre-linearized project map: one row per ADR, one row per seed, summary line first. Call this at session start.',
      inputSchema: { include_seeds: z.boolean().optional() },
    },
    async ({ include_seeds }) =>
      text(projectOverview(ctx, { includeSeeds: include_seeds, scannedAt, serverVersion })),
  )

  server.registerTool(
    'lookup',
    {
      description: 'Resolve any ADR-0008-grammar reference (adr:NNNN#slug, seed:slug#anchor, bare Question.id, bare ADR number) to its content.',
      inputSchema: { ref: z.string(), context_lines: z.number().optional() },
    },
    async ({ ref, context_lines }) => text(lookup(ctx, ref, context_lines)),
  )

  server.registerTool(
    'get_outline',
    {
      description: 'Flat section map of one ADR: slug | heading | level | lines | words, with inline QST status.',
      inputSchema: { adr_ref: z.string() },
    },
    async ({ adr_ref }) => text(getOutline(ctx, adr_ref)),
  )

  server.registerTool(
    'get_sections',
    {
      description: 'Batch-fetch multiple refs in one call, each its own labeled block. Refs may span multiple ADRs.',
      inputSchema: { refs: z.array(z.string()), token_budget: z.number().optional() },
    },
    async ({ refs, token_budget }) => text(getSections(ctx, refs, token_budget)),
  )

  server.registerTool(
    'list_open_questions',
    {
      description: 'Summary line first, then one row per open (unanswered) question across all ADRs, or scoped to one adr_ref.',
      inputSchema: {
        adr_ref: z.string().optional(),
        priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
        status: z.string().optional(),
        limit: z.number().optional(),
      },
    },
    async ({ adr_ref, priority, status, limit }) =>
      text(listOpenQuestions(ctx, { adrRef: adr_ref, priority, status, limit })),
  )

  server.registerTool(
    'answer_question',
    {
      description: 'Answer a QST — replace semantics (a question has exactly one current answer). Anchored write, safe with no prior read.',
      inputSchema: {
        adr_ref: z.string(),
        question_id: z.string(),
        answer_text: z.string(),
        author: z.string(),
        base_checksum: z.string().optional(),
        client_msg_id: z.string().optional(),
      },
    },
    async ({ adr_ref, question_id, answer_text, author, base_checksum, client_msg_id }) =>
      text(await answerQuestion(ctx, adr_ref, question_id, answer_text, { author, baseChecksum: base_checksum, clientMsgId: client_msg_id })),
  )

  server.registerTool(
    'add_recommendation',
    {
      description: 'Stack a recommendation under a QST — append semantics (recommendations stack; the eventual answer stays singular).',
      inputSchema: {
        adr_ref: z.string(),
        question_id: z.string(),
        author: z.string(),
        text: z.string(),
        client_msg_id: z.string().optional(),
      },
    },
    async ({ adr_ref, question_id, author, text: body, client_msg_id }) =>
      text(await addRecommendation(ctx, adr_ref, question_id, author, body, { clientMsgId: client_msg_id })),
  )

  server.registerTool(
    'append_iteration',
    {
      description: 'Append an iteration log entry. The next iteration number is computed server-side (MAX+1 over the actual log).',
      inputSchema: {
        adr_ref: z.string(),
        human: z.string().optional(),
        ai: z.string().optional(),
        outcome: z.string().optional(),
        date: z.string().optional(),
        client_msg_id: z.string().optional(),
      },
    },
    async ({ adr_ref, human, ai, outcome, date, client_msg_id }) =>
      text(await appendIteration(ctx, adr_ref, { human, ai, outcome, date, clientMsgId: client_msg_id })),
  )

  server.registerTool(
    'update_resolution',
    {
      description: "Set an ADR's Resolution field (consensus|fiat|unresolved|forked|contested). A note is required for fiat/contested.",
      inputSchema: {
        adr_ref: z.string(),
        resolution: z.enum(['consensus', 'fiat', 'unresolved', 'forked', 'contested']),
        note: z.string().optional(),
      },
    },
    async ({ adr_ref, resolution, note }) => text(await updateResolution(ctx, adr_ref, resolution, note)),
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('[adrs-for-ai MCP server] fatal error:', err)
  process.exit(1)
})
