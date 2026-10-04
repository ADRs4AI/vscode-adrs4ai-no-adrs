import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Regression tests — tool-description content that matters to a model
 * deciding which tool to call, verified as source text (no live MCP
 * session needed; same discipline as buildConfig.test.ts).
 *
 * Bug: Midden 5's field study of Ribbon 5 (`moreover`, 12-day session,
 * docs/mcp-adoption-ledger.md row E11) found `update_resolution` called
 * with `{"status": "answered"}` — the model reached for this tool to mark
 * a QUESTION answered, guessing the Status vocabulary (answered/unanswered)
 * that's used everywhere else in this grammar, because nothing at the call
 * site signalled that `resolution` is a DIFFERENT axis (ADR-0009's whole-ADR
 * decision-disposition enum). "Two conflated status vocabularies in one
 * tool surface," per Midden — the sharper, more fixable half of the finding.
 * Zod's enum validation already rejected the bad value correctly; the gap
 * was the description never saying so before the guess was made.
 */
describe('Regression tests', () => {
  const src = readFileSync(resolve(__dirname, '../mcp/stdioServer.ts'), 'utf8')

  it("update_resolution's description explicitly disambiguates from per-QST Status (fixes Ribbon's E11 guess)", () => {
    const match = src.match(/'update_resolution',\s*\{\s*description:\s*"([^"]+)"/)
    expect(match, 'update_resolution tool registration not found in stdioServer.ts').not.toBeNull()
    const description = match![1]
    expect(description).toMatch(/not the same/i)
    expect(description.toLowerCase()).toContain('answer_question')
  })
})
