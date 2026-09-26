/**
 * Context: founder Report, companion etude, 2026-09-13T22:48Z: "I am curious
 * whether the QST petnames in parenthesis at the end are parsed and part of
 * the metadata?" — headings like
 *   ### QST: Should the Rust service be a gRPC server too? (QST-RUST-GRPC-SERVER)
 * Checks what the REAL parser does with a trailing parenthesized handle vs.
 * the documented forms (`### QST-ID: title`, and the `<!-- @adr-anchor -->`
 * comment), and counts the wild dialect across the ecosystem's docs/adr trees.
 */
import { parseAdr } from '../../src/parser/extractor'

const mk = (heading: string) => ['## Questions', '', heading, '- Status: unanswered', '', '**ANS:** (by )', '[Fill this in]', ''].join('\n')
for (const [label, h] of [
  ['trailing (QST-…) [wild dialect]', '### QST: Should the Rust service be a gRPC server too? (QST-RUST-GRPC-SERVER)'],
  ['leading handle [documented]', '### QST-RUST-GRPC-SERVER: Should the Rust service be a gRPC server too?'],
  ['plain, no handle', '### QST: Should the Rust service be a gRPC server too?'],
] as const) {
  const q = parseAdr(mk(h), '/fake/docs/adr/0004-x.md').questions[0]
  console.log(label.padEnd(34), '| id =', q.id, '| qstId =', q.qstId, '| text =', JSON.stringify(q.text))
}

// OUTCOME (2026-09-26): the trailing "(QST-…)" is NOT recognized as a handle — it
// is slugified into the id (…-pushes-qst-rust-grpc-server), qstId stays undefined,
// and `adr:0004#qst-rust-grpc-server` cannot resolve. Wild-dialect census (grep
// over ecosystem docs/adr trees): 167 headings across 4 repos (HQ meta-repo,
// companion etude, caring-form, tablee). A read-wide gap, not a bug in any one
// file; the fix has an id-stability tradeoff (recognizing it changes existing
// ids), so it is routed to Riddle with options rather than shipped unilaterally.
