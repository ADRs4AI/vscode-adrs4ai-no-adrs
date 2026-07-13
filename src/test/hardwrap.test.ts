/**
 * Hard-wrap join helpers (src/parser/hardwrap.ts) — hard-wrap robustness
 * charter (Lapidary 5, 2026-07-13 reframe of the 0420 brief). These are
 * direct unit tests of the ported join logic; the end-to-end effect on
 * parseAdr() (rawBody/recommendation text) is covered in parser.test.ts.
 *
 * Several cases here mirror scripts/unwrap-adrs/unwrap-adrs.mjs's own
 * self-test suite (17/17) — the module this one ports its join primitive
 * and list-continuation detector from ("lift it, don't reinvent it").
 * Matching test names/inputs is deliberate: it's the cheapest way to catch
 * the two implementations drifting apart.
 */

import { describe, it, expect } from 'vitest'
import { joinSoftWrappedLines, unwrapListItems, unwrapParagraphs } from '../parser/hardwrap'

describe('joinSoftWrappedLines', () => {
  it('joins plain wrapped lines with a single space', () => {
    expect(joinSoftWrappedLines(['Alpha wraps', 'onto the next line.'])).toBe('Alpha wraps onto the next line.')
  })

  it('joins a hyphen-split token without inserting a space (unwrap-adrs.mjs parity)', () => {
    expect(joinSoftWrappedLines(['`docs/example-', '2026.md` is referenced.']))
      .toBe('`docs/example-2026.md` is referenced.')
  })

  it('trims each line before joining, so indentation from a list continuation does not leak in', () => {
    expect(joinSoftWrappedLines(['first line', '  second line', '   third line']))
      .toBe('first line second line third line')
  })

  it('a single line passes through unchanged', () => {
    expect(joinSoftWrappedLines(['just one line'])).toBe('just one line')
  })
})

describe('unwrapListItems', () => {
  it('joins a hard-wrapped bullet continuation into its own item (unwrap-adrs.mjs parity)', () => {
    const out = unwrapListItems(['- A bullet wraps', '  onto the next line.'])
    expect(out).toEqual(['- A bullet wraps onto the next line.'])
  })

  it('the real specimen shape: two option bullets, one of them wrapped across three lines', () => {
    const out = unwrapListItems([
      '- **A — Calendar**: fixed date.',
      '- **B — Milestone**: when the pipeline round-trips a real email end-to-end',
      '  (intake → match → extract → draft → validation surface), so the MCP server',
      '  exposes something true and the Assayer has a working loop to mine.',
    ])
    expect(out).toEqual([
      '- **A — Calendar**: fixed date.',
      '- **B — Milestone**: when the pipeline round-trips a real email end-to-end (intake → match → extract → draft → validation surface), so the MCP server exposes something true and the Assayer has a working loop to mine.',
    ])
  })

  it('does not join a genuinely new list item into the previous one', () => {
    const out = unwrapListItems(['- First item.', '- Second item.'])
    expect(out).toEqual(['- First item.', '- Second item.'])
  })

  it('lines outside any list item pass through untouched', () => {
    const out = unwrapListItems(['Some prose before.', '- A list item.', 'Some prose after.'])
    expect(out).toEqual(['Some prose before.', '- A list item.', 'Some prose after.'])
  })

  it('stops a continuation at the ANS/QST/placeholder markers, per unwrap-adrs.mjs protection rules', () => {
    const out = unwrapListItems(['- An option', '**ANS:** (by Human)'])
    expect(out).toEqual(['- An option', '**ANS:** (by Human)'])
  })
})

describe('unwrapParagraphs', () => {
  it('joins a single hard-wrapped paragraph (legacy recommendation form)', () => {
    const out = unwrapParagraphs([
      '**B — milestone-triggered.**',
      'Same argument as the Tablée two-wave decision: stable intermediate forms.',
      'A calendar trigger could seat the MCP/Relay before there is anything to relay.',
    ])
    expect(out).toEqual([
      '**B — milestone-triggered.** Same argument as the Tablée two-wave decision: stable intermediate forms. A calendar trigger could seat the MCP/Relay before there is anything to relay.',
    ])
  })

  it('preserves blank-line paragraph breaks (protocol-form recommendation)', () => {
    const out = unwrapParagraphs([
      'First paragraph wraps',
      'across two lines.',
      '',
      'Second paragraph is',
      'also wrapped.',
    ])
    expect(out).toEqual([
      'First paragraph wraps across two lines.',
      '',
      'Second paragraph is also wrapped.',
    ])
  })
})
