/**
 * ADR-0021 Iteration 16: verify normalizeDocumentStatus() against the three
 * confirmed live false-positive specimens from QST-DETECTION-LEDGER.md
 * (Flint's own 08-11 open item, folded into this function per Riddle's
 * ruling) plus the full frozen spine (5 enum + 4 suspension + unknown).
 */

import { normalizeDocumentStatus } from '../../src/parser/extractor'

const cases: Array<[string | undefined, string]> = [
  ['Superseded — by ADR-0005', 'Superseded'],
  ['Implemented — see PR #123', 'Implemented'],
  ['Accepted — with reservations', 'Accepted'],
  ['Draft', 'Draft'],
  ['Partially Implemented', 'Partially Implemented'],
  ['Partially Implemented — SQLite FTS5 pending', 'Partially Implemented'],
  ['Deferred', 'Deferred'],
  ['Paused', 'Paused'],
  ['Suspended', 'Suspended'],
  ['On Hold', 'On Hold'],
  ['on-hold', 'On Hold'],
  ['**Accepted**', 'Accepted'],
  ['Proposed', 'unknown'], // deliberately excluded from the frozen 5-token spine
  ['Gibberish', 'unknown'],
  [undefined, 'unknown'],
]

let failures = 0
for (const [input, expected] of cases) {
  const got = normalizeDocumentStatus(input)
  const ok = got === expected
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'FAIL'} normalizeDocumentStatus(${JSON.stringify(input)}) = ${JSON.stringify(got)} (expected ${JSON.stringify(expected)})`)
}
console.log(`\n${cases.length - failures}/${cases.length} passed`)
