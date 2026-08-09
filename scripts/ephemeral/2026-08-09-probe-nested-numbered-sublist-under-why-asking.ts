// Probe: founder Report from elenchus-monorepo ADR-0116
// (adr-0116-qst-which-option-a-b-c-or-d), 2026-08-09, message "Parsing
// numbered list seems wrong? Or is it not wrong?" — the rendered panel
// showed the "Why asking" field's nested numbered sub-list (source lines
// 127-129: a "- Why asking: ...:" bullet followed by an indented "  1. ..."
// / "  2. ..." ordered list) flattened into one paragraph with literal
// "1."/"2." text, AND item 2's content appeared a SECOND time verbatim
// (with its raw 2-space indentation intact) after the "Need:" line.
// Does the extractor's whyAsking continuation-join (extractor.ts:1429-1430)
// explain both symptoms, or just the flattening?
// Run: npx tsx scripts/ephemeral/2026-08-09-probe-nested-numbered-sublist-under-why-asking.ts
//
// OUTCOME (Gleaner 5, 2026-08-09): flattening bug CONFIRMED both ways —
// q.whyAsking comes back as one continuous string (extractor.ts:1429-1430
// joins any indented continuation line with a single space, never checking
// whether it's itself a new list-item marker), and running that exact
// string through the REAL renderMarkdown() (via webviewHarness's sandbox)
// renders it as one <p> with literal "1."/"2." text, never an <ol>. The
// duplicate-paragraph half of the report did NOT reproduce here — ctx
// (whyAsking + Need) rendered as exactly two clean paragraphs, no
// duplicate — so that symptom is NOT caused by extractor.ts and was routed
// separately as a plausible (unconfirmed) webview-side stale-innerHTML
// hypothesis. Routed: docs/inbox/2026-08-09-0100-gleaner-to-fitter-nested-
// numbered-sublist-under-why-asking-flattens.md; ledger row added.
import { parseAdr } from '../../src/parser/extractor'
import { readFileSync } from 'fs'
import { createWebviewHarness } from '../../src/test/helpers/webviewHarness'

const realPath = '/Users/jlumbroso/Programming/elenchus-project/elenchus-monorepo/docs/adr/0116-session-type-editor.md'
const doc = readFileSync(realPath, 'utf8')

const adr = parseAdr(doc, realPath)
const q = adr.questions.find(x => x.id === 'adr-0116-qst-which-option-a-b-c-or-d')!
console.log('--- extractor view ---')
console.log('whyAsking:', JSON.stringify(q.whyAsking))
console.log('need:', JSON.stringify((q as any).need))
console.log('rawBody:', JSON.stringify((q as any).rawBody))
console.log('rawBodyPost:', JSON.stringify((q as any).rawBodyPost))
console.log('warnings:', JSON.stringify(adr.warnings, null, 2))

console.log('--- renderMarkdown(ctx) via real webview sandbox ---')
const h = createWebviewHarness()
const ctx = [q.whyAsking, (q as any).whyDeferring ? '**Why deferring:** ' + (q as any).whyDeferring : null, (q as any).need ? '**Need:** ' + (q as any).need : null]
  .filter(Boolean).join('\n\n')
console.log('ctx input:', JSON.stringify(ctx))
const renderMarkdown = h.sandbox.renderMarkdown as (md: string) => string
console.log('rendered:', renderMarkdown(ctx))
