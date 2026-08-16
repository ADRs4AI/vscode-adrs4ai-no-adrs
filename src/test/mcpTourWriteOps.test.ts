/**
 * Behavioral tests for the ADR-0037 write primitives — bless_qst_handle
 * first (mint_tour and tour_validate build on top of it and land
 * separately). Real markdown through the real parser, same discipline as
 * mcpWriteTier.test.ts, not hand-built fixture objects — the placement bug
 * this tool exists to prevent (Facet 5's incident chain, ADR-0037 Human
 * Context) was exactly the kind of thing a hand-built AdrSection fixture
 * would never have caught.
 */

import { describe, it, expect } from 'vitest'
import { parseAdr } from '../parser/extractor'
import { applyBlessQstHandle } from '../mcp/writeOps'

const ADR_PATH = '/fake/docs/adr/0052-agency-supportive-scaffolding.md'

const FIXTURE = `# ADR-0052: Agency-supportive scaffolding

- **Date**: 2026-08-16
- **Status**: Accepted
- **Deciders**: Jérémie Lumbroso

---

## Questions

### QST: The stated promotion trigger has fired — design now, hold, or fold?
- Status: unanswered

**ANS:**
[Fill this in]

### QST: Should we also create an interface for EmailClient?
- Status: unanswered

**ANS:**
[Fill this in]

---

## Links
`

describe('applyBlessQstHandle', () => {
  it('inserts the anchor AFTER the heading (blank line, then the comment) — the exact placement bug Facet\'s incident chain was about', () => {
    const result = applyBlessQstHandle(FIXTURE, ADR_PATH, 'promotion trigger', 'promotion-trigger')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const lines = result.newContent.split('\n')
    const headingIdx = lines.findIndex((l) => l.includes('The stated promotion trigger'))
    expect(lines[headingIdx + 1]).toBe('')
    expect(lines[headingIdx + 2]).toBe('<!-- @adr-anchor: promotion-trigger -->')
    expect(result.headingLine).toBe(headingIdx + 1)
    expect(result.anchorLine).toBe(headingIdx + 3)
  })

  it('the blessed question resolves by the new slug after reparsing', () => {
    const result = applyBlessQstHandle(FIXTURE, ADR_PATH, 'promotion trigger', 'promotion-trigger')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const reparsed = parseAdr(result.newContent, ADR_PATH)
    const q = reparsed.questions.find((qq) => qq.text.includes('promotion trigger'))
    expect(q?.slug).toBe('promotion-trigger')
  })

  it('the OTHER question is untouched — no collateral change', () => {
    const result = applyBlessQstHandle(FIXTURE, ADR_PATH, 'promotion trigger', 'promotion-trigger')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.newContent).toContain('Should we also create an interface for EmailClient?')
    const reparsed = parseAdr(result.newContent, ADR_PATH)
    const other = reparsed.questions.find((qq) => qq.text.includes('EmailClient'))
    expect(other?.slug).toBe('qst-should-we-also-create-an-interface-for-emailclient')
  })

  it('rejects an invalid slug (uppercase, spaces) before touching the content', () => {
    const result = applyBlessQstHandle(FIXTURE, ADR_PATH, 'promotion trigger', 'Not A Valid Slug')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('error: invalid_slug')
  })

  it('returns a structured not_found error when no question matches', () => {
    const result = applyBlessQstHandle(FIXTURE, ADR_PATH, 'something that does not exist', 'whatever')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('error: not_found')
  })

  it('returns a structured ambiguous error, listing candidates, rather than silently picking the first match', () => {
    // Both questions contain "we" — force a genuine two-way match.
    const bothMatch = FIXTURE
    const result = applyBlessQstHandle(bothMatch, ADR_PATH, 'e', 'whatever') // "e" is in every question's text
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('error: ambiguous')
    expect(result.error).toContain('candidates:')
  })

  it('is idempotent when re-blessed with the EXACT SAME slug — a retry is not an error', () => {
    const first = applyBlessQstHandle(FIXTURE, ADR_PATH, 'promotion trigger', 'promotion-trigger')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = applyBlessQstHandle(first.newContent, ADR_PATH, 'promotion trigger', 'promotion-trigger')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.alreadyBlessed).toBe(true)
    expect(second.newContent).toBe(first.newContent)
  })

  it('refuses to silently overwrite a DIFFERENT existing anchor', () => {
    const first = applyBlessQstHandle(FIXTURE, ADR_PATH, 'promotion trigger', 'promotion-trigger')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = applyBlessQstHandle(first.newContent, ADR_PATH, 'promotion trigger', 'a-different-slug')
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.error).toContain('error: already_blessed')
  })

  it('refuses a slug that collides with an existing anchor/slug elsewhere in the same ADR', () => {
    // The second question's heading-derived slug already exists — collide with it on purpose.
    const result = applyBlessQstHandle(FIXTURE, ADR_PATH, 'promotion trigger', 'qst-should-we-also-create-an-interface-for-emailclient')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('error: slug_collision')
  })
})
