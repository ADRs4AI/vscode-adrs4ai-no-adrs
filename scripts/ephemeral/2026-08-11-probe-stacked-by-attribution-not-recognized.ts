// Probe: founder Report on our own repo, 2026-08-11, ADR-0032
// adr-0032-qst-status-vocab: "The mimetic 'stacked by' has interfered with
// the parsing." Seven council-round recommendations use the inline form
// "**Recommendation**: (stacked by X, council round, date) <body text on
// same line>" — different from the canonical form where "(by X, date)"
// sits ALONE on its own line, followed by a blank line, then the body.
// renderedHtml shows the first ("stacked by Lapidary 5...") getting
// mis-attributed to "Riddle 5" (rec-chip-inferred, wrong person) with the
// literal "(stacked by Lapidary 5, council round, 2026-08-08)" leaking as
// plain text at the start of the body. Confirm against the real file for
// all seven entries.
// Run: npx tsx scripts/ephemeral/2026-08-11-probe-stacked-by-attribution-not-recognized.ts
//
// OUTCOME (Gleaner 5, 2026-08-11): CONFIRMED precisely — all seven "stacked
// by X" recommendations get author: "Riddle 5" (WRONG, same wrong name
// every time, authorInferred: true — falls back to a Deciders-field guess)
// and the literal "(stacked by X, ...)" parenthetical leaks as the first
// text in rec.text. Root cause: extractor.ts:1593's inline-attribution
// fallback regex /^\((?:by|from)\b\s*([^)]*)\)\s*(.*)$/i — built
// specifically for this same-line-attribution shape per its own adjacent
// comment (a documented prior incident, same class) — only recognizes
// bare "by"/"from" as the preposition, not "stacked by". Six different
// crew members' real words are being misattributed to one name. Routed.
import { parseAdr } from '../../src/parser/extractor'
import { readFileSync } from 'fs'

const realPath = '/Users/jlumbroso/Programming/vscode-adrs-for-ai/docs/adr/0032-format-stability-council-hardening-roundup.md'
const doc = readFileSync(realPath, 'utf8')

const adr = parseAdr(doc, realPath)
const q = adr.questions.find(x => x.id === 'adr-0032-qst-status-vocab')!
console.log('recommendations count:', (q as any).recommendations?.length)
for (const rec of (q as any).recommendations ?? []) {
  console.log('---')
  console.log('author:', JSON.stringify(rec.author))
  console.log('authorInferred:', rec.authorInferred)
  console.log('text starts with:', JSON.stringify((rec.text as string).slice(0, 90)))
}
