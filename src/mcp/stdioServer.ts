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
import { createRepositoryContextAdapter } from '../index/repositoryContextAdapter'
import { DocketSession } from './session'
import type { BatchOperation } from './writeOps'
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
  applyBatch,
  blessQstHandle,
  reportObservation,
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
  // report_observation's fallback anchor when no adr_ref is given — a
  // workspace-wide observation still needs a real root's ledger to land in.
  // Never read (errorLogPathFor only needs its dirname), so it doesn't need
  // to exist on disk.
  const defaultReportAnchorPath = path.join(workspaceRoot, adrDirRel, '.mcp-report-observation-anchor')

  // Scan happens at startup, owned by the session (Phase 0 of the docket
  // extraction, docket repo ADR-0001 QST-SESSION — src/mcp/session.ts's own
  // header has the full history: dedupe.ts/pathLock.ts's module-level Maps
  // and this file's own composite/scannedAt closure used to be three
  // separate singletons, correct for this one long-lived stdio process but
  // meaningless for a per-invocation CLI mouth that needs fresh state each
  // call). `refresh_corpus` (below) calls session.refreshCorpus() to rescan
  // and swap the composite in place — the fix for Gadfly 5's 2026-07-23
  // "Catch 1" corpus-staleness report, now a session method any adapter can
  // reach, not a capability stranded in this file's own closure.
  const session = await DocketSession.create({ workspaceRoot, adrDirRel })
  // CompositeIndex already exposes allAdrs()/allSeeds() aggregated across
  // every discovered root — the adapter's IndexSource shape needs nothing
  // more, so this is a direct pass-through, not a new integration. Built
  // fresh per call (not cached) so every tool handler sees whatever the
  // session's composite currently points at, including right after a refresh.
  const ctx = () => createRepositoryContextAdapter(session.getComposite())

  const server = new McpServer({ name: 'adrs-for-ai', version: serverVersion })

  server.registerTool(
    'project_overview',
    {
      description: 'Pre-linearized project map: one row per ADR, one row per seed, summary line first. Call this at session start.',
      inputSchema: { include_seeds: z.boolean().optional() },
    },
    async ({ include_seeds }) =>
      text(projectOverview(ctx(), { includeSeeds: include_seeds, scannedAt: session.getScannedAt(), serverVersion })),
  )

  server.registerTool(
    'refresh_corpus',
    {
      description: 'Rescans the workspace from disk and replaces the in-memory corpus — call this if a just-created or just-edited ADR is returning not_found, or after a mid-session commit. Returns the new ADR/seed counts and scan timestamp.',
      inputSchema: {},
    },
    async () => {
      const result = await session.refreshCorpus()
      return text(`Corpus rescanned: ${result.adrCount} ADRs, ${result.seedCount} seeds. scanned_at: ${result.scannedAt}`)
    },
  )

  server.registerTool(
    'lookup',
    {
      description: 'Resolve any ADR-0008-grammar reference (adr:NNNN#slug, seed:slug#anchor, bare Question.id, bare ADR number) to its content.',
      inputSchema: { ref: z.string(), context_lines: z.number().optional() },
    },
    async ({ ref, context_lines }) => text(lookup(ctx(), ref, context_lines)),
  )

  server.registerTool(
    'get_outline',
    {
      description: 'Flat section map of one ADR: slug | heading | level | lines | words, with inline QST status.',
      inputSchema: { adr_ref: z.string() },
    },
    async ({ adr_ref }) => text(getOutline(ctx(), adr_ref)),
  )

  server.registerTool(
    'get_sections',
    {
      description: 'Batch-fetch multiple refs in one call, each its own labeled block. Refs may span multiple ADRs.',
      inputSchema: { refs: z.array(z.string()), token_budget: z.number().optional() },
    },
    async ({ refs, token_budget }) => text(getSections(ctx(), refs, token_budget)),
  )

  server.registerTool(
    'list_open_questions',
    {
      description: "Summary line first, then one row per open question across all ADRs, or scoped to one adr_ref. court: 'model' scopes to unresolved questions — the model's own docket (ADR-0036), the ball in its court. namespace scopes to one root's tree (see project_overview's ns: column for the real value — folder names like \"legacy\" are usually NOT it).",
      inputSchema: {
        adr_ref: z.string().optional(),
        priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
        status: z.string().optional(),
        court: z.literal('model').optional(),
        namespace: z.string().optional(),
        limit: z.number().optional(),
      },
    },
    async ({ adr_ref, priority, status, court, namespace, limit }) =>
      text(listOpenQuestions(ctx(), { adrRef: adr_ref, priority, status, court, namespace, limit })),
  )

  server.registerTool(
    'answer_question',
    {
      description: 'Answer a QST — replace semantics (a question has exactly one current answer). Anchored write, safe with no prior read. adr_ref and question_id are separate params here (unlike read tools, which accept a fused "adr:NNNN#slug" ref) — question_id is the bare slug/id, e.g. "qst-what-is-the-scope", not "adr:0001#qst-what-is-the-scope".',
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
      text(await answerQuestion(ctx(), session, adr_ref, question_id, answer_text, { author, baseChecksum: base_checksum, clientMsgId: client_msg_id })),
  )

  server.registerTool(
    'add_recommendation',
    {
      description: 'Stack a recommendation under a QST — append semantics (recommendations stack; the eventual answer stays singular). adr_ref and question_id are separate params here (unlike read tools, which accept a fused "adr:NNNN#slug" ref) — question_id is the bare slug/id, e.g. "qst-what-is-the-scope", not "adr:0001#qst-what-is-the-scope". If this returns write_failed "Could not locate question", the corpus may be stale (a recently created/edited ADR) — try refresh_corpus first.',
      inputSchema: {
        adr_ref: z.string(),
        question_id: z.string(),
        author: z.string(),
        text: z.string(),
        client_msg_id: z.string().optional(),
      },
    },
    async ({ adr_ref, question_id, author, text: body, client_msg_id }) =>
      text(await addRecommendation(ctx(), session, adr_ref, question_id, author, body, { clientMsgId: client_msg_id })),
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
      text(await appendIteration(ctx(), session, adr_ref, { human, ai, outcome, date, clientMsgId: client_msg_id })),
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
    async ({ adr_ref, resolution, note }) => text(await updateResolution(ctx(), session, adr_ref, resolution, note)),
  )

  const batchOperationSchema = z.discriminatedUnion('tool', [
    z.object({ tool: z.literal('answer_question'), question_id: z.string(), answer_text: z.string(), author: z.string() }),
    z.object({ tool: z.literal('add_recommendation'), question_id: z.string(), author: z.string(), text: z.string(), date: z.string() }),
    z.object({ tool: z.literal('append_iteration'), human: z.string().optional(), ai: z.string().optional(), outcome: z.string().optional(), date: z.string() }),
    z.object({ tool: z.literal('update_resolution'), resolution: z.enum(['consensus', 'fiat', 'unresolved', 'forked', 'contested']), note: z.string().optional() }),
  ])

  server.registerTool(
    'apply_batch',
    {
      description: 'Apply several related mutations to ONE ADR atomically, in order — a status flip + a superseding recommendation + an iteration append, one write. Each operation is the same shape as its single-op tool (answer_question/add_recommendation/append_iteration/update_resolution), tagged by "tool". If any operation fails, nothing in the batch is written. Not a general scripting surface — no loops or conditionals, just an ordered list.',
      inputSchema: {
        adr_ref: z.string(),
        operations: z.array(batchOperationSchema),
        client_msg_id: z.string().optional(),
      },
    },
    async ({ adr_ref, operations, client_msg_id }) => {
      const mapped: BatchOperation[] = operations.map((op) => {
        switch (op.tool) {
          case 'answer_question':
            return { tool: 'answer_question', questionId: op.question_id, answerText: op.answer_text, author: op.author }
          case 'add_recommendation':
            return { tool: 'add_recommendation', questionId: op.question_id, author: op.author, text: op.text, date: op.date }
          case 'append_iteration':
            return { tool: 'append_iteration', human: op.human, ai: op.ai, outcome: op.outcome, date: op.date }
          case 'update_resolution':
            return { tool: 'update_resolution', resolution: op.resolution, note: op.note }
        }
      })
      return text(await applyBatch(ctx(), session, adr_ref, mapped, { clientMsgId: client_msg_id }))
    },
  )

  server.registerTool(
    'bless_qst_handle',
    {
      description: 'Insert a missing <!-- @adr-anchor: slug --> for a question that has none yet, placed correctly (after the heading) by construction. question_match is a substring of the question\'s TEXT (how you\'d naturally identify it having read the ADR), not a slug or index — the whole point is the question doesn\'t have a stable handle yet. Idempotent on the exact same slug; refuses to overwrite a different existing anchor.',
      inputSchema: {
        adr_ref: z.string(),
        question_match: z.string(),
        slug: z.string(),
        client_msg_id: z.string().optional(),
      },
    },
    async ({ adr_ref, question_match, slug, client_msg_id }) =>
      text(await blessQstHandle(ctx(), session, adr_ref, question_match, slug, { clientMsgId: client_msg_id })),
  )

  server.registerTool(
    'report_observation',
    {
      description: 'The Report button, for models. Capture anything worth a specimen — a wrong result, a format the parser mishandled, a corpus that feels stale — to the error ledger (docs/adr/.working/errors.jsonl), the same substrate the panel\'s human Report button writes to. author is required (a specific model slug/seat, never "AI"). adr_ref is optional — omit it for a workspace-wide observation not tied to one ADR. This is for specimens/incidents, not prose feedback (elenchus-style mcp-feedback.md files are still the right place for that).',
      inputSchema: {
        note: z.string(),
        author: z.string(),
        adr_ref: z.string().optional(),
        context: z.string().optional(),
      },
    },
    async ({ note, author, adr_ref, context }) =>
      text(await reportObservation(ctx(), note, defaultReportAnchorPath, { author, adrRef: adr_ref, context, scannedAt: session.getScannedAt(), serverVersion })),
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('[adrs-for-ai MCP server] fatal error:', err)
  process.exit(1)
})
