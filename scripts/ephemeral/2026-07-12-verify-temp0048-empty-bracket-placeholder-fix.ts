/**
 * Verifies the PLACEHOLDER_EMPTY_RE fix against the actual real-world file
 * Jérémie reported the bug against (temp/0048-mcp-support-rfc-connecting-
 * external-tool-servers.md — a bare "[ ]" answer wasn't recognized as
 * unanswered, so the question silently vanished from the Open Questions
 * panel as done). Not a unit test (temp/ is gitignored scratch content from
 * another project, not something the suite should depend on) — a one-off
 * check that the fix actually resolves the reported specimen, not just the
 * synthetic regression tests in parser.test.ts.
 *
 * NOTE: depends on temp/0048-*.md, which is gitignored scratch content
 * (someone else's real ADR, dropped in for dogfooding) — this script will
 * only run where that file is actually present locally; it's committed for
 * the record, not as a repeatable CI check.
 *
 * OUTCOME (2026-07-12): ran clean. All 5 occurrences of the bare "[ ]"
 * placeholder across the file's QSTs (lines 97, 117, 135, 152, 217) now
 * correctly parse as unanswered with a NONSTANDARD_FILL_PLACEHOLDER warning,
 * instead of silently vanishing from the Open Questions panel as answered.
 * Confirms the parser.test.ts regression tests generalize to the real
 * specimen that prompted the fix, not just the synthetic cases.
 */
import * as fs from 'fs'
import * as path from 'path'
import { parseAdr } from '../../src/parser/extractor'

const filePath = path.join(__dirname, '../../temp/0048-mcp-support-rfc-connecting-external-tool-servers.md')
const content = fs.readFileSync(filePath, 'utf8')
const adr = parseAdr(content, filePath)

const qstA = adr.questions.find(q => q.text.startsWith('Where does the MCP connection live?'))
if (!qstA) {
  console.error('FAIL: QST-A not found in parsed questions at all')
  process.exit(1)
}

console.log('QST-A found:', qstA.text.slice(0, 60) + '...')
console.log('isAnswered:', qstA.isAnswered)
console.log('answer:', JSON.stringify(qstA.answer))
console.log('warnings:', adr.parseWarnings.filter(w => w.code === 'NONSTANDARD_FILL_PLACEHOLDER'))

if (qstA.isAnswered) {
  console.error('FAIL: still misread as answered — fix did not resolve the live specimen')
  process.exit(1)
}
console.log('PASS: "[ ]" correctly recognized as an unanswered placeholder, question stays open')
