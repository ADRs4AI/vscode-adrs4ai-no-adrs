/**
 * Structural integrity guard for docs/QST-DETECTION-LEDGER.md itself —
 * Docent 5's routing (2026-10-12), surfacing Riddle 5's own named,
 * independently-discovered failure class ("edit anchor consumption",
 * project memory `riddle-edit-anchor-consumption`): a string-replacement
 * Edit whose `old_string` ends mid-row, with the tail anchor not
 * restated in `new_string`, silently welds two table rows into one —
 * the file still parses as markdown, the table still renders, and the
 * row that vanished is precisely the thing that would have reminded
 * someone it existed. Two real instances in ten days, both caught by a
 * DIFFERENT seat than the author, never by the author.
 *
 * Docent's framing, verbatim, for why this is this file's own class and
 * not cosmetic: "a merged row with a dropped cell-opener can take a
 * tracked defect class out of the ledger without anyone noticing... the
 * thing that would catch it is the thing that broke."
 *
 * What this does NOT catch: a merge where the dropped text happens to
 * leave a syntactically normal-looking row (extremely unlikely given
 * this file's long, idiosyncratic cell text, but not impossible). What
 * it DOES catch, mechanically: every data row in every table has EXACTLY
 * the header's own cell count, after stripping backtick-delimited code
 * spans (which legitimately contain unescaped `|` — regex alternation,
 * `||`, etc. — this file quotes code constantly, and a naive raw split
 * flagged 6 false positives before this stripping was added, all of
 * them this file's own pre-existing multi-round "addendum" cells, not
 * corruption). A genuine row-merge inflates the cell count by roughly a
 * whole additional row's worth (not by one stray content pipe), which is
 * exactly the shape this catches.
 *
 * Convention this guard ENFORCES going forward, not just checks: an
 * addendum/correction/closure appended to an existing row joins the
 * LAST cell's own text (a new sentence, optionally its own bold marker
 * inline) — it never opens a new `|`-delimited cell. Three rows in this
 * file predated the convention and were normalized to it the same day
 * this guard was added (no content removed, only the cell-separating
 * pipes between rounds, joined with connecting prose).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const LEDGER_PATH = resolve(__dirname, '../../docs/QST-DETECTION-LEDGER.md')
const LINES = readFileSync(LEDGER_PATH, 'utf8').split('\n')

/** Strips backtick-delimited code spans — see the file-level doc comment for why. */
function stripCodeSpans(line: string): string {
  return line.replace(/`[^`]*`/g, '')
}

interface RowIssue {
  line: number
  expected: number
  got: number
  preview: string
}

function findIssues(lines: string[] = LINES): RowIssue[] {
  const issues: RowIssue[] = []
  let headerCells: number | undefined
  let sawSeparator = false

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const isTableLine = /^\|.*\|\s*$/.test(raw)
    if (!isTableLine) { headerCells = undefined; sawSeparator = false; continue }

    // The `|---|---|` separator row — marks "the line above was the
    // header", carries no content signal of its own.
    const isSeparator = /^[|:\s-]+$/.test(raw)
    if (isSeparator) { sawSeparator = true; continue }

    const cellCount = stripCodeSpans(raw).split('|').length
    if (headerCells === undefined) {
      headerCells = cellCount
      sawSeparator = false
      continue
    }
    if (sawSeparator && cellCount !== headerCells) {
      issues.push({ line: i + 1, expected: headerCells, got: cellCount, preview: raw.slice(0, 100) })
    }
  }
  return issues
}

describe('QST-DETECTION-LEDGER.md: every table row has exactly its header\'s cell count', () => {
  it('sanity: the file has the tables we expect (more than a handful of header/separator pairs)', () => {
    const separatorCount = LINES.filter(l => /^\|.*\|\s*$/.test(l) && /^[|:\s-]+$/.test(l)).length
    expect(separatorCount).toBeGreaterThan(5)
  })

  it('no row\'s cell count diverges from its table\'s header — a divergence is either a welded row (Riddle\'s edit-anchor-consumption class) or a new multi-cell addendum that should have joined the last cell\'s text instead', () => {
    const issues = findIssues()
    const report = issues.map(i => `line ${i.line}: expected ${i.expected} cells, got ${i.got} — ${i.preview}`).join('\n')
    expect(issues, `\n${report}`).toEqual([])
  })

  // Verified firing, not just asserted clean — same discipline as the
  // compositeSubscriberRegistry guard (Docent 5, 2026-10-10): a probe
  // reproducing the EXACT incident shape (two real rows, the second
  // one's `| **` opener dropped, fusing it onto the first) must fail
  // before this guard is trusted on the real file.
  it('fires on a synthetic reproduction of the real incident — two rows welded by a dropped cell-opener', () => {
    const fixture = [
      '| Class | Owner | Dispatched | State |',
      '|---|---|---|---|',
      // One single physical line: row 1's content, then row 2's content
      // with its OWN leading "| **" eaten (the exact Riddle/Fitter
      // shape) — so this line ends with row 2's real closing "|", not a
      // fresh one of its own.
      '| **ANS-slot lifecycle overload — a real row** | Riddle | 10-01 | open — A second row whose own opener got silently consumed | Fitter | 10-02 | open |',
    ]
    const issues = findIssues(fixture)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0].line).toBe(3)
  })

  it('does NOT fire on two genuinely separate, well-formed rows — the guard isn\'t just flagging "more than one row"', () => {
    const fixture = [
      '| Class | Owner | Dispatched | State |',
      '|---|---|---|---|',
      '| A real row | Riddle | 10-01 | open |',
      '| A second, genuinely separate real row | Fitter | 10-02 | open |',
    ]
    expect(findIssues(fixture)).toEqual([])
  })

  it('every row\'s first cell (its identifying description) is non-empty — a blank one is the other half of a dropped-opener: content that landed with nothing identifying it', () => {
    const emptyFirstCells: number[] = []
    let sawSeparator = false
    for (let i = 0; i < LINES.length; i++) {
      const raw = LINES[i]
      const isTableLine = /^\|.*\|\s*$/.test(raw)
      if (!isTableLine) { sawSeparator = false; continue }
      const isSeparator = /^[|:\s-]+$/.test(raw)
      if (isSeparator) { sawSeparator = true; continue }
      if (!sawSeparator) continue // this line IS the header — not a data row
      const firstCell = stripCodeSpans(raw).split('|')[1] ?? ''
      if (firstCell.trim().length === 0) emptyFirstCells.push(i + 1)
    }
    expect(emptyFirstCells).toEqual([])
  })
})
