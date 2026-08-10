// Probe: Jérémie's direct correction (2026-08-10, live chat) — the 08-09/
// 08-10 fix (commit 7897483) only handled a NESTED NUMBERED sub-list under
// "- Why asking:"/"- Need:"/"- Why deferring:" (continuesOrderedItem =
// /^\d+\.\s+/.test(line)). He says the unwrapping mechanism is "overly
// aggressive" and "unwraps structural elements... bullet lists are no
// longer lists" — a systemic problem, not the one narrow case that got
// patched. Does a nested BULLET sub-list under the same fields still break,
// and if so, how (flattened like numbers were, or dropped from the field
// entirely, per isContinuation's `!/^-\s+/.test(line)` guard)?
// Run: npx tsx scripts/ephemeral/2026-08-10-probe-bullet-sublist-under-why-asking-still-broken.ts
//
// OUTCOME (Gleaner 5, 2026-08-10): CONFIRMED — the bullet sub-list is
// excluded from whyAsking entirely (isContinuation's `!/^-\s+/` guard
// treats the indented bullet marker as if it were a new top-level `- `
// field) and lands in rawBody instead, vanishing from the "why" section's
// render. Worse than the numbered-list case v0.7.72 fixed (that one at
// least stayed in the field, just flattened). Routed to Fitter/Riddle as
// the systemic class Jérémie named directly — ledger row added,
// docs/inbox/2026-08-10-... brief.
import { parseAdr } from '../../src/parser/extractor'
import { createWebviewHarness } from '../../src/test/helpers/webviewHarness'

const doc = [
  '## Open Questions',
  '',
  '### QST: Which option — A, B, C, or D?',
  '- Status: unanswered',
  '- Why asking: The four options carry different tradeoffs, not buried in prose above:',
  '  - **Option D exists** (Basanos): instructor-composed named bundles over canonical flags.',
  '  - **The renaming falsifier closed.** Legacy shows renaming pressure while building.',
  '- Need: A / B / C / D, or a variant',
  '',
  '**ANS:** _pending_',
  '',
].join('\n')

const adr = parseAdr(doc, '/fake/docs/adr/0116-x.md')
const q = adr.questions[0]
console.log('--- extractor view ---')
console.log('whyAsking:', JSON.stringify(q.whyAsking))
console.log('need:', JSON.stringify((q as any).need))
console.log('rawBody:', JSON.stringify((q as any).rawBody))
console.log('rawBodyPost:', JSON.stringify((q as any).rawBodyPost))

console.log('--- renderMarkdown(ctx) via real webview sandbox ---')
const h = createWebviewHarness()
const ctx = [q.whyAsking, (q as any).need ? '**Need:** ' + (q as any).need : null].filter(Boolean).join('\n\n')
console.log('ctx input:', JSON.stringify(ctx))
const renderMarkdown = h.sandbox.renderMarkdown as (md: string) => string
console.log('rendered:', renderMarkdown(ctx))
