/**
 * 2026-10-12 — render the panel in a REAL browser engine to see the prologue.
 *
 * CONTEXT (Tenth Directive: don't hesitate to experiment; you have a browser).
 * The prologue shipped with unit tests, stub-DOM harness tests and a real-file
 * parse check — none of which can tell me whether the CARD LOOKS RIGHT. I had
 * been saying "I can't drive a VS Code webview", which is true and was also me
 * stopping at the first obstacle: the panel's HTML and CSS are mine, and a
 * real browser can lay them out. Only VS Code's theme variables and the host
 * message plumbing are missing, and the CSS carries fallbacks for the former.
 *
 * Emits a standalone file: the real getHtml() output, plus an acquireVsCodeApi
 * stub injected BEFORE the inline script, plus a driver that posts the real
 * `questions` message carrying étude tour eight's actual authored prologue.
 */
import * as fs from 'fs'
import * as path from 'path'
import { getHtml } from '../../src/webview/openQuestionsPanel'
import { readPrologue } from '../../src/index/tourPrologue'

const TOUR = '/Users/jlumbroso/Programming/system3/companion-thinking-stream-etude/docs/adr/tours/2026-10-12-the-three-asks-brought-home.tour.json'
const prologue = readPrologue(TOUR)
if (!prologue) { console.error('no prologue on the real tour'); process.exit(1) }
const raw = JSON.parse(fs.readFileSync(TOUR, 'utf-8'))

let html = getHtml('900px')

// Stub the VS Code bridge before the panel's own inline script runs.
html = html.replace('<script>', `<script>
  window.acquireVsCodeApi = () => ({ postMessage: m => console.log('[post]', JSON.stringify(m)), getState: () => ({}), setState: () => {} });
</script>
<script>`)

const message = {
  type: 'questions',
  generation: 0,
  renderTitleMarkdown: true,
  gitAuthor: 'Jérémie',
  questions: [{
    id: 'q1', slug: 'qst-alt-text', text: 'Does the alt-text belong to the author or the renderer?',
    adrPath: '/tmp/x.md', adrTitle: 'ADR-0071', adrNumber: 71, status: 'Draft',
    statusText: 'unanswered', isAnswered: false, lineStart: 10, checksum: 'abc',
    sourceKind: 'adr', groupSortKey: 'a', groupLabel: 'ADR-0071', rootNamespace: '', rootCaption: '',
    occurrenceOrdinal: 1, occurrenceTotal: 1, draftKey: 'k1',
    whyAsking: 'Because the two answers imply different pipelines.',
    tourEntry: { mustRespond: true, comment: 'The gate blocking the alt-text pass.' },
  }],
  tour: {
    slug: '2026-10-12-the-three-asks-brought-home',
    title: raw.title, author: raw.author, mintedAt: raw.minted_at,
    retired: !!raw.retired, done: false, askedSomething: true,
    brokenRefs: [], prologue,
  },
}

html += `\n<script>
  window.postMessage(${JSON.stringify(message)}, '*');
  setTimeout(() => { document.getElementById('tour-header-title').click(); }, 60);
</script>\n`

const out = path.join('/private/tmp/claude-501/-Users-jlumbroso-Programming-vscode-adrs-for-ai/c0849458-981c-4c76-af36-66fe6558c1b9/scratchpad', 'prologue-render.html')
fs.writeFileSync(out, html)
console.log('wrote', out)
console.log('rationale chars:', prologue.rationale.length, '| context:', !!prologue.context)

/*
 * OUTCOME (2026-10-12): found a real CSS bug that no test could see.
 *
 * First render showed the prologue card ~3x taller than its content, with
 * blank bands above the rationale, between rationale and context, and below
 * the context. Diagnosed against the authored string first (zero newlines, so
 * NOT the authored text) and then the CSS: `white-space: pre-wrap` was on the
 * CONTAINER, so the source-code newlines and indentation BETWEEN the child
 * <div>s rendered as visible whitespace. Moved pre-wrap onto the two text
 * nodes, where it is actually wanted. Card height ~290px -> ~160px.
 *
 * Invisible to all 1853 tests: the stub-DOM harness has no layout engine, so
 * it can assert the card's CONTENT and VISIBILITY but never its SHAPE. This is
 * the gap the Tenth Directive exists for — and it would have been the first
 * thing the founder saw.
 *
 * Run: npx vitest run <a temp test importing this body>  (the panel imports
 * vscode at module scope, so it only resolves under vitest's alias), then
 * npx playwright screenshot --viewport-size=960,760 file://<the html> out.png
 */
