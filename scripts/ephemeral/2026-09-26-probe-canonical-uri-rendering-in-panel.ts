/**
 * Context: founder Report, pneumatic, 2026-09-22T05:37Z: "The deep link is
 * 'adr://v1/repo/ADRs4AI/pneumatic/adr/0026' it looks like 'repo' isn't
 * rendered? is that normal?" — no screenshot, and the reported ADR's own text
 * does not contain that URI, so the display surface is unknown. Checks the one
 * surface I own that renders such a string (the Open Questions panel's
 * renderInline, run through the real webview harness) for prose, code-span,
 * and wrapped-link forms, looking for a dropped `repo` segment.
 */
import { createWebviewHarness } from '../../src/test/helpers/webviewHarness'

const h = createWebviewHarness()
const renderMarkdown = h.sandbox.renderMarkdown as (md: string) => string
const u = 'adr://v1/repo/ADRs4AI/pneumatic/adr/0026'
for (const [label, md] of [
  ['bare in prose', `See ${u} for the brief.`],
  ['code span', `See \`${u}\` for the brief.`],
  ['markdown link', `See [the brief](${u}) for detail.`],
  ['with anchor', `See ${u}#qst-x for detail.`],
] as const) {
  const html = renderMarkdown(md)
  console.log(label.padEnd(14), '| repo kept in visible text:', /<a[^>]*>[^<]*\/repo\//.test(html) || html.includes('/repo/'), '|', html.slice(0, 200).replace(/\n/g, ' '))
}

// OUTCOME (2026-09-26): all four forms render with the `repo` segment intact and
// clickable (data-ref carries the full canonical ref) — NOT reproducible on the
// panel. The reported ADR's own text doesn't contain the URI, so the surface the
// reporter was looking at (panel? editor preview? Pigeonhole? terminal?) is
// unknown; the Report captured the whole tree and file but not the thing he was
// looking at. Routed back to him as a one-line question.
