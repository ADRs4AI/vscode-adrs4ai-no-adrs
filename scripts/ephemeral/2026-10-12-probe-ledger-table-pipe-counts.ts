/**
 * Context: Docent 5 flagged a real incident — Fitter found two
 * QST-DETECTION-LEDGER.md rows merged onto one physical line (a dropped
 * cell-opener from an Edit whose old_string ended mid-row, per Riddle's
 * own "edit anchor consumption" class). Before writing a structural test
 * asserting "consistent pipe count per table," checking empirically
 * whether a naive per-table header-vs-row pipe-count comparison would
 * actually hold EXACTLY across the real, currently-clean file, or
 * whether legitimate unescaped content pipes require tolerance.
 */
import { readFileSync } from 'fs'

const lines = readFileSync('/Users/jlumbroso/Programming/vscode-adrs-for-ai/docs/QST-DETECTION-LEDGER.md', 'utf8').split('\n')

let currentHeaderCells: number | undefined
let inTable = false
let mismatches = 0

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  const isRow = /^\|.*\|\s*$/.test(line)
  const isSeparator = /^\|[\s:-]+\|?[\s:-]*\|?\s*$/.test(line) && /^[|:\s-]+$/.test(line)

  if (!isRow) { inTable = false; currentHeaderCells = undefined; continue }
  if (isSeparator) continue // the |---|---| row itself carries no content signal

  // Strip backtick-delimited code spans first — this ledger quotes code
  // constantly (`a || b`, regex alternation `x|y`), and every one of
  // those literal pipes is content, not a cell separator. Virtually all
  // the "extra" pipes in a real, uncorrupted row turn out to live inside
  // backticks once checked.
  const stripped = line.replace(/`[^`]*`/g, '')
  const cellCount = stripped.split('|').length
  if (!inTable) {
    // First row line after a non-table line = this table's header.
    currentHeaderCells = cellCount
    inTable = true
    continue
  }
  // A data row — but only once we've seen a separator (so we know this
  // "table" start wasn't itself a one-off header with no body).
  if (currentHeaderCells !== undefined && cellCount !== currentHeaderCells) {
    mismatches++
    console.log(`line ${i + 1}: expected ${currentHeaderCells} cells (header), got ${cellCount} — delta ${cellCount - currentHeaderCells}`)
    console.log('  ' + line.slice(0, 120))
  }
}

console.log('---')
console.log('total mismatches:', mismatches)
console.log('(re-run: after this, decide whether to normalize each flagged row into a header-matching cell count, or grandfather it)')

// OUTCOME: (filled in after running)
