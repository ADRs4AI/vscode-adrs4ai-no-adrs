// Probe: founder Report on OUR OWN repo, 2026-08-11, ADR-0032 QST-CORE:
// "still hard wrap problems see '- **A2 — ' and also Touchstone's two
// recommendations not parsed cleanly." Captured renderedHtml shows A1 and
// A2 (two adjacent "- " bullets, no blank line between them, source lines
// 119-120) collapsed into ONE <li> — "- **A2 —" leaks as literal text
// inside A1's <li> instead of starting its own. Hand-tracing hardwrap.ts's
// unwrapListItems/unwrapMarkdownish and openQuestionsPanel.ts's renderBlocks
// unordered-list loop both suggest they SHOULD keep A1/A2 as separate
// lines — so where does the merge actually happen? Probe the real pipeline
// end to end against the real file rather than continuing to hand-trace.
// Run: npx tsx scripts/ephemeral/2026-08-11-probe-adr0032-a1-a2-adjacent-bullets-merge.ts
//
// OUTCOME (Gleaner 5, 2026-08-11): CONFIRMED — a FOURTH independent
// instance of the systemic class. A1/A2 aren't in rawBody at all; they're
// inside Touchstone's recommendation.text (extractor.ts:1780, built via
// hardwrap.ts's unwrapParagraphs). unwrapParagraphs has NO list-item
// awareness whatsoever — unlike unwrapMarkdownish (which checks
// matchListItem() before deciding to buffer-and-join vs. flush-and-pass-
// through), unwrapParagraphs only breaks on BLANK lines, so two adjacent
// bullets with no blank line between them get silently joined into one
// paragraph by joinSoftWrappedLines. Routed to Fitter/Riddle.
import { parseAdr } from '../../src/parser/extractor'
import { readFileSync } from 'fs'
import { createWebviewHarness } from '../../src/test/helpers/webviewHarness'
import { unwrapMarkdownish } from '../../src/parser/hardwrap'

const realPath = '/Users/jlumbroso/Programming/vscode-adrs-for-ai/docs/adr/0032-format-stability-council-hardening-roundup.md'
const doc = readFileSync(realPath, 'utf8')

const adr = parseAdr(doc, realPath)
const q = adr.questions.find(x => x.id === 'adr-0032-qst-core')!
console.log('--- extractor view ---')
console.log('rawBody has A1?', ((q as any).rawBody as string | undefined)?.includes('A1 —'))
console.log('recommendations count:', (q as any).recommendations?.length)
const rec = ((q as any).recommendations as any[]).find(r => (r.text ?? '').includes('A1 —'))
console.log('found recommendation with A1:', !!rec)
console.log('rec.author:', rec?.author)
const idx = (rec.text as string).indexOf('A1 —')
console.log('rec.text around A1/A2 (raw, showing \\n explicitly):')
console.log(JSON.stringify(rec.text.slice(idx - 5, idx + 700)))

console.log('\n--- full renderMarkdown(rec.text) via real webview sandbox ---')
const h = createWebviewHarness()
const renderMarkdown = h.sandbox.renderMarkdown as (md: string) => string
const rendered = renderMarkdown(rec.text)
const liIdx = rendered.indexOf('A1 —')
console.log(rendered.slice(liIdx - 20, liIdx + 900))
