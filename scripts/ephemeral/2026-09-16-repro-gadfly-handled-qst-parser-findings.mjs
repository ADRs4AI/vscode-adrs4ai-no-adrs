// Context: Gadfly 5 (elenchus falsifier seat) reported two parser findings
// on handled QSTs (docs/inbox/2026-09-10-0318-gadfly-to-relay-mcp-parser-two-findings-handled-qsts.md):
// (1) a 24-char handle ceiling that silently made a QST invisible to
// list_open_questions/lookup/answer_question while a different counter
// (lookup's ADR summary) still saw it; (2) answer_question failing to
// locate a handled QST that get_outline indexed correctly.
//
// This script reconstructs the EXACT real repro — the actual pre-rename
// heading from elenchus-monorepo/docs/adr/0114-roles-and-permissions.md,
// byte-for-byte (confirmed via docs/mcp-feedback.md's 2026-09-09 entry,
// since the live file had already been hand-fixed by the time this ran) —
// and runs it through the real parseAdr/list_open_questions/lookup/
// answer_question code paths, not a synthetic simplification.
//
// Usage: npx tsx scripts/ephemeral/2026-09-16-repro-gadfly-handled-qst-parser-findings.mjs
// (requires a local checkout of elenchus-monorepo at the path below; if
// absent, the script still runs against a reconstructed fixture using the
// exact quoted heading text from the feedback file)
//
// Outcome (2026-09-16): NEITHER bug reproduces against current source.
// `git log -S MALFORMED_QST_HANDLE_ID` shows the fallback that fixes
// exactly Finding 1 shipped 2026-07-16, five weeks before Gadfly's report.
// answer_question correctly located and answered the handled QST in both
// a minimal fixture and the full real 8-question file. Root-caused to a
// deployment gap instead: dist/mcp-server.js is gitignored, and elenchus's
// own .mcp.json (checked directly) points at the literal absolute path in
// this dev tree — a long-running server process from an older build can't
// signal its own staleness. Fixed by baking a build-time git SHA into the
// version string (see the same-day commit, vite.mcp-server.config.ts +
// stdioServer.ts) so this class of report is a one-line diagnostic next
// time, not a five-week-old ghost.

import { parseAdr } from '../../src/parser/extractor.ts'
import { lookup, listOpenQuestions, answerQuestion } from '../../src/mcp/handlers.ts'
import { DocketSession } from '../../src/mcp/session.ts'
import * as fs from 'fs'
import * as path from 'path'

const ADR_PATH = '/fake/docs/adr/0114-roles-and-permissions.md'
const ELENCHUS_PATH = path.resolve(
  import.meta.dirname,
  '../../../elenchus-project/elenchus-monorepo/docs/adr/0114-roles-and-permissions.md',
)

// The exact pre-rename heading, quoted verbatim in Gadfly's own feedback
// entry (elenchus-monorepo/docs/mcp-feedback.md, 2026-09-09) — 25 chars,
// one over the documented 24-char handle ceiling.
const ORIGINAL_HEADING = 'QST-INV9-SEPARATION-OF-DUTIES'

let content
if (fs.existsSync(ELENCHUS_PATH)) {
  const live = fs.readFileSync(ELENCHUS_PATH, 'utf8')
  content = live.replace('QST-INV9-SOD:', `${ORIGINAL_HEADING}:`)
  console.log(`Using real elenchus corpus file, handle reverted to pre-rename: ${ELENCHUS_PATH}`)
} else {
  content = [
    '# ADR-0114: Roles and Permissions',
    '',
    '- **Date**: 2026-01-01',
    '- **Iteration**: 10',
    '- **Status**: Draft',
    '- **Deciders**: Test',
    '',
    '---',
    '',
    '## Questions',
    '',
    `### ${ORIGINAL_HEADING}: Does elenchus adopt separation of duties between staff-granting and PII power (INV-9), and if so by which mechanism?`,
    '- Status: unanswered',
    '- Why asking: Real security question.',
    '- Need: a decision',
    '',
    '**ANS:** (by nobody)',
    '[Fill this in]',
    '',
    '---',
    '',
    '## Links',
    '',
  ].join('\n')
  console.log('Elenchus checkout not found locally — using a minimal reconstructed fixture with the exact quoted heading.')
}

const adr = parseAdr(content, ADR_PATH)
const target = adr.questions.find((q) => q.text.toLowerCase().includes('separation of duties'))

console.log(`\n=== Finding 1: is the over-long-handle QST recognized at all? ===`)
console.log(`total questions parsed: ${adr.questions.length}`)
console.log(`target found: ${!!target}`)
if (target) console.log(`  id: ${target.id}\n  slug: ${target.slug}\n  isAnswered: ${target.isAnswered}`)
const malformedWarning = adr.parseWarnings?.find((w) => w.code === 'MALFORMED_QST_HANDLE_ID')
console.log(`MALFORMED_QST_HANDLE_ID warning fired: ${!!malformedWarning}`)

const files = new Map([[ADR_PATH, content]])
const ctx = {
  listAdrs: () => [...files.entries()].map(([p, c]) => parseAdr(c, p)),
  getAdr: (ref) => {
    const num = parseInt(ref.replace(/^adr:/, ''), 10)
    const e = [...files.entries()].find(([p, c]) => parseAdr(c, p).number === num)
    return e ? parseAdr(e[1], e[0]) : undefined
  },
  listSeeds: () => [],
  getSeed: () => undefined,
  readFile: async (p) => files.get(p),
  writeFile: async (p, c) => { files.set(p, c) },
  listFiles: async () => [...files.keys()],
}
const session = DocketSession.createForTests()

console.log(`\nlookup(adr:0114) summary: ${lookup(ctx, 'adr:0114').split('\n')[0]}`)
console.log(`list_open_questions(adr_ref: 0114): ${listOpenQuestions(ctx, { adrRef: '0114' }).split('\n')[0]}`)

if (target && !target.isAnswered) {
  console.log(`\n=== Finding 2: can answer_question locate the handled QST? ===`)
  const result = await answerQuestion(ctx, session, '0114', target.id, 'Test answer via repro script.', { author: 'Repro' })
  console.log(result.split('\n')[0])
  console.log(result.startsWith('Answered') ? '✅ located and answered correctly' : '❌ FAILED to locate — bug reproduces')
} else if (target?.isAnswered) {
  console.log('\n(target question is already answered in the live corpus — skipping the write-path check; the read-path checks above already confirm recognition)')
}
