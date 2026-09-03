/**
 * Real behavioral tests (webviewHarness — actually runs the panel's
 * `<script>` block) for panel link support: Gleaner's escalation,
 * 2026-08-21 (docs/inbox/2026-08-21-gleaner-to-fitter-link-support-
 * escalation-15-days-3-specimens.md — 15 days open, 3rd live specimen).
 * renderInline() had zero link handling of any kind. Covers both
 * destination kinds (external http(s) URLs, internal adr:/seed: local
 * refs) in both forms (markdown-link syntax and bare autolink), plus the
 * delegated click routing to the two new host-side message types.
 */

import { describe, it, expect } from 'vitest'
import { createWebviewHarness } from './helpers/webviewHarness'

function renderMd(md: string): string {
  const h = createWebviewHarness()
  const renderMarkdown = h.sandbox.renderMarkdown as (md: string) => string
  return renderMarkdown(md)
}

describe('renderInline: external URLs', () => {
  it('markdown-link syntax [label](https://...) becomes a clickable external link', () => {
    const html = renderMd('See [the etude](https://jlumbroso.github.io/companion-thinking-stream-etude/etudes.html) for context.')
    expect(html).toContain('class="panel-link"')
    expect(html).toContain('data-kind="ext"')
    expect(html).toContain('data-href="https://jlumbroso.github.io/companion-thinking-stream-etude/etudes.html"')
    expect(html).toContain('>the etude<')
  })

  it('bare https://... autolinks, matching the original 08-06 ask ("neither are the links parsed")', () => {
    const html = renderMd('See https://example.com/foo for details.')
    expect(html).toContain('data-kind="ext"')
    expect(html).toContain('data-href="https://example.com/foo"')
  })

  it('trailing sentence punctuation is NOT swallowed into the bare-URL autolink', () => {
    const html = renderMd('See https://example.com/foo.')
    expect(html).toContain('data-href="https://example.com/foo"')
    // The trailing period survives as plain text after the closing </a>.
    expect(html).toMatch(/<\/a>\./)
  })

  it('http:// (not just https://) also autolinks', () => {
    const html = renderMd('See http://example.com/foo for details.')
    expect(html).toContain('data-href="http://example.com/foo"')
  })
})

describe('renderInline: internal adr:/seed: references', () => {
  // Regression test (fixes real bug, Gleaner's escalation 2026-08-21):
  // HQ pneumatic ADR-0011 QST-WHOIS-2, founder Report verbatim: "The
  // anchor link is not clickable to ADR 15 in my answer, why?" His own
  // ANS text used exactly this bare form, no [] wrapping.
  it('a bare adr:NNNN#slug reference autolinks — the exact specimen from the escalation', () => {
    const html = renderMd('...the discussion at adr:0015#qst-inbox-4, suggesting the possibility...')
    expect(html).toContain('data-kind="ref"')
    expect(html).toContain('data-ref="adr:0015#qst-inbox-4"')
    expect(html).toContain('>adr:0015#qst-inbox-4<')
  })

  it('a bare seed:slug#anchor reference also autolinks', () => {
    const html = renderMd('See seed:2026-03-04-foo#qst-1 for the origin.')
    expect(html).toContain('data-kind="ref"')
    expect(html).toContain('data-ref="seed:2026-03-04-foo#qst-1"')
  })

  it('a bare adr: ref with no anchor still autolinks', () => {
    const html = renderMd('See adr:0008 for the protocol.')
    expect(html).toContain('data-ref="adr:0008"')
  })

  it('markdown-link syntax [label](adr:...) also works, resolving via the ref kind not the ext kind', () => {
    const html = renderMd('See [the deep link protocol](adr:0008#decision) for details.')
    expect(html).toContain('data-kind="ref"')
    expect(html).toContain('data-ref="adr:0008#decision"')
    expect(html).toContain('>the deep link protocol<')
  })

  it('a bare ref is not falsely matched mid-token (word-boundary guarded)', () => {
    const html = renderMd('The word badr:1234 should not become a link.')
    expect(html).not.toContain('data-kind="ref"')
  })
})

describe('renderInline: unrecognized destinations are left as literal text', () => {
  it('[label](mailto:x@y.com) does not become a clickable link — no scheme was asked for', () => {
    const html = renderMd('Email [me](mailto:x@y.com) about it.')
    expect(html).not.toContain('panel-link')
    expect(html).toContain('mailto:x@y.com')
  })
})

describe('renderInline: links coexist with existing formatting/protection', () => {
  it('a URL-looking string inside a code span is NOT autolinked — code protection runs first', () => {
    const html = renderMd('Run `curl https://example.com/api` to fetch it.')
    expect(html).not.toContain('panel-link')
    expect(html).toContain('<code>curl https://example.com/api</code>')
  })

  // Jérémie, 2026-09-03 (re: docket's first-specimen founder Report,
  // "fully specified URIs unfortunately can't be clicked yet"): "can we
  // detect code tags containing only a URL? Or only one of ours?" Scoped
  // to ours only (adr:/seed:), not any bare URL — see the fix's own
  // comment in openQuestionsPanel.ts for the counter-examples (illustrative
  // URLs this repo's own docs deliberately code-wrap without meaning them
  // navigable) that rule out the broader form.
  describe('a code span whose ENTIRE content is one of our own adr:/seed: refs autolinks, staying monospace', () => {
    it('a bare adr:NNNN ref, alone in a code span', () => {
      const html = renderMd('See `adr:0008` for the protocol.')
      expect(html).toContain('data-kind="ref"')
      expect(html).toContain('data-ref="adr:0008"')
      expect(html).toContain('<code>adr:0008</code>')
      expect(html).toMatch(/<a[^>]*data-ref="adr:0008"[^>]*><code>adr:0008<\/code><\/a>/)
    })

    it('a canonical adr://v1/... ref, alone in a code span — the docket specimen itself', () => {
      const html = renderMd('Constitution: `adr://v1/repo/jlumbroso/vscode-adrs-for-ai/seed/2026-08-18-conduit`.')
      expect(html).toContain('data-kind="ref"')
      expect(html).toContain('data-ref="adr://v1/repo/jlumbroso/vscode-adrs-for-ai/seed/2026-08-18-conduit"')
    })

    it('a bare seed: ref with an anchor, alone in a code span', () => {
      const html = renderMd('See `seed:2026-03-04-foo#qst-1` for the origin.')
      expect(html).toContain('data-ref="seed:2026-03-04-foo#qst-1"')
    })

    it('mixed content — an adr: ref alongside other text in the SAME code span — stays inert (whole-content-only, same discipline as the placeholder family)', () => {
      const html = renderMd('Run `adr:0008 is the spec` to see it.')
      expect(html).not.toContain('panel-link')
      expect(html).toContain('<code>adr:0008 is the spec</code>')
    })

    it('a generic https:// URL alone in a code span stays inert — not one of ours, and this repo has real illustrative-URL specimens that must not become misleadingly clickable', () => {
      const html = renderMd('Not yet live: `https://adrs.systems/clients/vscode/`.')
      expect(html).not.toContain('panel-link')
      expect(html).toContain('<code>https://adrs.systems/clients/vscode/</code>')
    })
  })

  it('bold/italic elsewhere in the same string still renders correctly alongside a link', () => {
    const html = renderMd('**Important**: see https://example.com for *details*.')
    expect(html).toContain('<strong>Important</strong>')
    expect(html).toContain('<em>details</em>')
    expect(html).toContain('data-kind="ext"')
  })
})

describe('Delegated click routing on #card', () => {
  it('clicking a rendered external link posts openExternalUrl with its href', () => {
    const h = createWebviewHarness()
    const link = h.element('link-ext-0')
    link.dataset.kind = 'ext'
    link.dataset.href = 'https://example.com/foo'
    h.clickDelegated('card', 'link-ext-0')
    expect(h.sentMessages).toContainEqual({ type: 'openExternalUrl', href: 'https://example.com/foo' })
  })

  it('clicking a rendered internal ref link posts openDeepLinkRef with its ref', () => {
    const h = createWebviewHarness()
    const link = h.element('link-ref-0')
    link.dataset.kind = 'ref'
    link.dataset.ref = 'adr:0015#qst-inbox-4'
    h.clickDelegated('card', 'link-ref-0')
    expect(h.sentMessages).toContainEqual({ type: 'openDeepLinkRef', ref: 'adr:0015#qst-inbox-4' })
  })

  it('clicking something inside #card with no data-kind (e.g. another button) posts nothing link-related', () => {
    const h = createWebviewHarness()
    const other = h.element('some-other-child')
    h.clickDelegated('card', 'some-other-child')
    expect(h.sentMessages.some(m => m.type === 'openExternalUrl' || m.type === 'openDeepLinkRef')).toBe(false)
  })
})
