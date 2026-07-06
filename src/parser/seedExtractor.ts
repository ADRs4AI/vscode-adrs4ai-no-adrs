/**
 * Seed Parser — Semantic Extractor
 *
 * Parses seed files (brain dumps, pre-decisional artifacts) into SeedFile objects.
 * Supports both the new Thread-based format and older iteration-style formats.
 *
 * New format (seed-template v2):
 *   # SEED: Topic
 *   - **Date**: YYYY-MM-DD
 *   - **From**: Author
 *   ## Brain Dump
 *   ## Thread
 *   ### Author Name - Date
 *   ## Derived Into
 *
 * Older format:
 *   # SEED: Topic
 *   ## Brain Dump (or direct prose)
 *   ## Iteration N — Model (date)
 *
 * See ADR-0011: Seeds as First-Class Artifacts for design rationale.
 */

import * as crypto from 'crypto'
import * as path from 'path'
import type { SeedFile, SeedThreadEntry, SeedRequest, DerivedAdr } from './types'

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/** Matches "- **Date**: YYYY-MM-DD" or similar */
const DATE_RE = /^-\s+\*\*Date\*\*:\s+(.+)$/
/** Matches "- **From**: Name" */
const FROM_RE = /^-\s+\*\*From\*\*:\s+(.+)$/
/** Matches "Author Name - Date" (text after ### has been stripped); date group is optional */
const THREAD_ENTRY_DATE_RE = /^(.+?)\s+-\s+(\d{4}-\d{2}-\d{2})$/
/** Matches ADR references in Derived Into: "- ADR-NNNN: Title" */
const DERIVED_ADR_RE = /^-\s+ADR-(\d+):\s+(.+)$/i
/** Matches the unprocessed placeholder text */
const UNPROCESSED_RE = /^\*?\(?\s*This seed has not yet been chunked/i
/** Matches **Model Response Request:** block start (colon is inside bold: **text:**) */
const MRR_RE = /^\*\*Model Response Request:/
/** Matches checkbox lines: "- [ ] text" or "- [X] text" or "- [x] text" */
const CHECKBOX_RE = /^-\s+\[([Xx\s])\]\s+(.+)$/

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Parse a seed file from its raw content and absolute path.
 * Never throws — always returns a SeedFile (with empty fields on parse failure).
 */
export function parseSeed(content: string, filePath: string): SeedFile {
  const checksum = crypto.createHash('sha1').update(content).digest('hex')
  const parsedAt = Date.now()

  const lines = content.split('\n')

  // --- Title (first non-empty line that starts with "# ") ---
  // We scan up to the first 5 lines to tolerate leading blank lines.
  let title = path.basename(filePath, '.md')
  let topic = title
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (lines[i].startsWith('# ')) {
      title = lines[i].slice(2).trim()
      topic = title.replace(/^SEED:\s*/i, '').trim() || title
      break
    }
  }

  // --- Metadata (date, from) from header bullet lines ---
  let date: string | undefined
  let from: string | undefined
  for (let i = 1; i < Math.min(10, lines.length); i++) {
    const line = lines[i].trim()
    if (line.startsWith('##')) break // stop at first section heading
    const dateMatch = line.match(DATE_RE)
    if (dateMatch) { date = dateMatch[1].trim(); continue }
    const fromMatch = line.match(FROM_RE)
    if (fromMatch) { from = fromMatch[1].trim(); continue }
  }

  // --- Section splitting ---
  // Split content into top-level (##) sections
  const sections = splitIntoSections(lines)

  // --- Brain Dump ---
  const brainDumpSection = sections.find(s => s.heading.toLowerCase().includes('brain dump'))
  const brainDump = brainDumpSection?.content.trim() || undefined

  // --- Thread entries (new format: ## Thread) ---
  const threadSection = sections.find(s => s.heading.toLowerCase() === 'thread')
  const threadEntries: SeedThreadEntry[] = threadSection
    ? parseThreadEntries(threadSection.content, threadSection.lineStart)
    : []

  // --- Derived Into ---
  const derivedSection = sections.find(s => s.heading.toLowerCase().includes('derived into'))
  const { derivedAdrs, isProcessed, hasPlaceholder } = parseDerivedInto(derivedSection?.content ?? '')

  return {
    path: filePath,
    title,
    topic,
    date,
    from,
    brainDump,
    threadEntries,
    derivedAdrs,
    isProcessed,
    derivedIntoHasPlaceholder: hasPlaceholder,
    checksum,
    parsedAt,
  }
}

// ---------------------------------------------------------------------------
// Section splitting
// ---------------------------------------------------------------------------

interface RawSection {
  heading: string
  content: string
  lineStart: number
}

function splitIntoSections(lines: string[]): RawSection[] {
  const sections: RawSection[] = []
  let current: RawSection | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('## ')) {
      if (current) sections.push(current)
      current = { heading: line.slice(3).trim(), content: '', lineStart: i + 1 }
    } else if (current) {
      current.content += line + '\n'
    }
  }
  if (current) sections.push(current)
  return sections
}

// ---------------------------------------------------------------------------
// Thread entry parsing
// ---------------------------------------------------------------------------

function parseThreadEntries(content: string, sectionLineStart: number): SeedThreadEntry[] {
  const lines = content.split('\n')
  const entries: SeedThreadEntry[] = []
  let current: { author: string; date?: string; lineStart: number; contentLines: string[] } | null = null
  let pendingMrr: SeedRequest | undefined

  function flush() {
    if (!current) return
    // Strip trailing horizontal rules and blank lines from content
    const bodyLines = current.contentLines.slice()
    while (bodyLines.length > 0) {
      const last = bodyLines[bodyLines.length - 1].trim()
      if (last === '---' || last === '') bodyLines.pop()
      else break
    }
    entries.push({
      author: current.author,
      date: current.date,
      content: bodyLines.join('\n').trim(),
      request: pendingMrr,
      lineStart: sectionLineStart + current.lineStart,
    })
    pendingMrr = undefined
  }

  let inMrr = false
  let mrrChunk: Partial<SeedRequest> = {}

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // New thread entry heading
    if (line.startsWith('### ')) {
      if (inMrr) {
        pendingMrr = { chunk: !!mrrChunk.chunk, iterate: !!mrrChunk.iterate, structure: !!mrrChunk.structure }
        inMrr = false
        mrrChunk = {}
      }
      flush()
      const headingText = trimmed.slice(4).trim() // strip '### '
      const m = headingText.match(THREAD_ENTRY_DATE_RE)
      const author = m ? m[1].trim() : headingText
      const date = m?.[2]
      current = { author, date, lineStart: i, contentLines: [] }
      continue
    }

    // Model Response Request block
    if (MRR_RE.test(trimmed)) {
      inMrr = true
      mrrChunk = {}
      continue
    }

    if (inMrr) {
      const cbMatch = trimmed.match(CHECKBOX_RE)
      if (cbMatch) {
        const checked = cbMatch[1].toLowerCase() === 'x'
        const label = cbMatch[2].toLowerCase()
        if (label.includes('chunk')) mrrChunk.chunk = checked
        else if (label.includes('iterate')) mrrChunk.iterate = checked
        else if (label.includes('structure')) mrrChunk.structure = checked
        continue
      }
      // Blank lines between **Model Response Request:** header and checkboxes are allowed
      if (trimmed === '') continue
      // Any non-checkbox, non-blank line ends the MRR block
      pendingMrr = { chunk: !!mrrChunk.chunk, iterate: !!mrrChunk.iterate, structure: !!mrrChunk.structure }
      inMrr = false
      mrrChunk = {}
      // If it's a heading, back up so it gets processed in the ### handler above
      if (line.startsWith('### ')) {
        i--
        continue
      }
    }

    if (current) {
      current.contentLines.push(line)
    }
  }

  if (inMrr) {
    pendingMrr = { chunk: !!mrrChunk.chunk, iterate: !!mrrChunk.iterate, structure: !!mrrChunk.structure }
  }
  flush()

  return entries
}

// ---------------------------------------------------------------------------
// Derived Into parsing
// ---------------------------------------------------------------------------

function parseDerivedInto(content: string): { derivedAdrs: DerivedAdr[]; isProcessed: boolean; hasPlaceholder: boolean } {
  const lines = content.split('\n')
  const derivedAdrs: DerivedAdr[] = []
  let hasPlaceholder = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('<!--') || trimmed.startsWith('-->')) continue

    if (UNPROCESSED_RE.test(trimmed)) {
      hasPlaceholder = true
      continue
    }

    const adrMatch = trimmed.match(DERIVED_ADR_RE)
    if (adrMatch) {
      derivedAdrs.push({
        number: parseInt(adrMatch[1], 10),
        title: adrMatch[2].trim(),
        raw: trimmed,
      })
    }
  }

  const isProcessed = derivedAdrs.length > 0 && !hasPlaceholder
  return { derivedAdrs, isProcessed, hasPlaceholder }
}
