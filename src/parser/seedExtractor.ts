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
import type { SeedFile, SeedThreadEntry, SeedRequest, DerivedAdr, Question, AdrSection, ParseWarning } from './types'
import { tokenize, extractRawSections, type Token } from './tokenizer'
import { buildSection, extractQuestion, resolveAliasHandles, stripInlineEmphasis } from './extractor'

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/** Matches "- **Date**: YYYY-MM-DD" or similar */
const DATE_RE = /^-\s+\*\*Date\*\*:\s+(.+)$/
/** Matches "- **From**: Name" */
const FROM_RE = /^-\s+\*\*From\*\*:\s+(.+)$/
/** Matches "- **Status**: ..." (ADR-0041 item 2's seed-scoped declared status) */
const SEED_STATUS_RE = /^-\s+\*\*Status\*\*:\s+(.+)$/
/** Matches "Author Name - Date" (text after ### has been stripped); date group is optional */
const THREAD_ENTRY_DATE_RE = /^(.+?)\s+-\s+(\d{4}-\d{2}-\d{2})$/
/**
 * ADR-0041 item 3 (recall-first Derived-Into): the ADR NUMBER is the
 * load-bearing signal (feeds the axis-2 rollup); a real ADR link must
 * never be silently dropped just because its title didn't parse cleanly.
 * "ADR-NNNN" (literal, no digits) is the template's own unfilled
 * placeholder and correctly never matches (\d+ requires real digits).
 */
const DERIVED_ADR_NUMBER_RE = /ADR-(\d+)\b/i
/** Matches the unprocessed placeholder text */
const UNPROCESSED_RE = /^\*?\(?\s*This seed has not yet been chunked/i
/** Matches **Model Response Request:** block start (colon is inside bold: **text:**) */
const MRR_RE = /^\*\*Model Response Request:/
/**
 * Matches checkbox lines: "- [ ] text" / "- [X] text" / "- [x] text", and
 * (ADR-0041 item 3, Naturalist's 108-seed finding) the ancestral pre-dash
 * stratum "[ ] text" / "[X] text" — real specimens predate the dash-bullet
 * convention. Only reached while inMrr is true (gated on MRR_RE matching
 * first), so this stays scoped to genuine Model Response Request blocks.
 */
const CHECKBOX_RE = /^-?\s*\[([Xx\s])\]\s+(.+)$/

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

  // --- Metadata (date, from, status) from header bullet lines ---
  let date: string | undefined
  let from: string | undefined
  let status: string | undefined
  for (let i = 1; i < Math.min(10, lines.length); i++) {
    const line = lines[i].trim()
    if (line.startsWith('##')) break // stop at first section heading
    const dateMatch = line.match(DATE_RE)
    if (dateMatch) { date = dateMatch[1].trim(); continue }
    const fromMatch = line.match(FROM_RE)
    if (fromMatch) { from = fromMatch[1].trim(); continue }
    const statusMatch = line.match(SEED_STATUS_RE)
    if (statusMatch) { status = statusMatch[1].trim(); continue }
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

  // --- Questions (ADR-0018 Step 2) ---
  const { questions, warnings: parseWarnings } = extractSeedQuestions(content, filePath)

  // --- Last activity date (ADR-0041 item 4: turn-date derivation) ---
  const { lastActivityDate, clampedDates } = deriveLastActivityDate(
    [date, ...threadEntries.map(e => e.date)],
    new Date(parsedAt),
  )
  for (const c of clampedDates) {
    parseWarnings.push({
      code: 'IMPLAUSIBLE_TURN_DATE',
      message: `Turn date "${c}" is in the future relative to parse time — excluded from lastActivityDate.`,
    })
  }

  return {
    path: filePath,
    title,
    topic,
    date,
    from,
    status,
    brainDump,
    threadEntries,
    derivedAdrs,
    isProcessed,
    derivedIntoHasPlaceholder: hasPlaceholder,
    checksum,
    parsedAt,
    questions,
    parseWarnings,
    lastActivityDate,
  }
}

// ---------------------------------------------------------------------------
// Declared status (ADR-0041 item 2 — seed-scoped axis-1 lifecycle)
// ---------------------------------------------------------------------------

/**
 * Closed-family axis-1 tokens for seeds, ratified by Naturalist's 108-seed
 * classifier run (2026-08-12): "the population invents no fourth closed
 * state." Sibling to isRetiredStatusToken (per-question) and
 * isDocumentPausedStatus (ADR document) — third arrival of the same
 * leading-token-strict pattern, seed-scoped this time. Canonical write is
 * "- **Status**: TERMINATED — duplicate capture, merged 2026-07-28" (this
 * repo's own corpus:002890 specimen); parked/superseded stay lowercase in
 * the wild, TERMINATED is the one all-caps token, so this classifier is
 * case-insensitive on all three rather than encoding that asymmetry.
 */
export function isRetiredSeedStatus(status: string | undefined): boolean {
  if (!status) return false
  return /^(?:parked|superseded|terminated)\b/i.test(stripInlineEmphasis(status).trim())
}

// ---------------------------------------------------------------------------
// Last activity date (ADR-0041 item 4 — turn-date derivation, sanity-clamped)
// ---------------------------------------------------------------------------

interface ActivityDerivation {
  lastActivityDate?: string
  /** Candidates excluded for being in the future relative to `now` */
  clampedDates: string[]
}

/**
 * The most recent parseable date among `candidates`, sanity-clamped
 * against implausible future dates rather than trusted blindly. Naturalist's
 * 108-seed run banked a wild 2027 year-typo turn heading (corpus:003975) as
 * a misread-specimen fixture: an unclamped max-date scan would let that one
 * typo become the seed's reported "most recent activity," inverting a
 * genuinely stale seed into a falsely-fresh one. Same "future = no
 * meaningful signal" convention as seedAging.ts's daysSince(), applied here
 * to candidate SELECTION rather than age computation — mostRecentDate() in
 * that module has no such guard, so this is the piece that must run first.
 */
function deriveLastActivityDate(candidates: Array<string | undefined>, now: Date): ActivityDerivation {
  const clampedDates: string[] = []
  let lastActivityDate: string | undefined
  let lastActivityTime = -Infinity
  for (const c of candidates) {
    if (!c) continue
    const t = new Date(c).getTime()
    if (Number.isNaN(t)) continue
    if (t > now.getTime()) { clampedDates.push(c); continue }
    if (t > lastActivityTime) { lastActivityTime = t; lastActivityDate = c }
  }
  return { lastActivityDate, clampedDates }
}

// ---------------------------------------------------------------------------
// Questions (ADR-0018 Step 2 — the QST/ANS substrate applied to seeds)
// ---------------------------------------------------------------------------

/**
 * `### QST:` blocks anywhere in a seed file were previously invisible to
 * the Open Questions panel — not a bug, a categorical exclusion
 * (ADR-0018's "Human Context": Jérémie hand-editing markdown because the
 * panel couldn't surface a seed's own questions).
 *
 * DEBRIEF (Lapidary 5, 2026-07-12, item 2): this used to only descend into
 * top-level sections literally named "Thread" or containing "Brain Dump" —
 * a fixed allowlist the seed-template format implied but that increasingly
 * freeform, dictated seeds (custom section names like "## Lineage",
 * "## Threads") don't follow, so a correctly-formatted QST under any other
 * heading silently never reached the panel. parseAdr() never had this
 * restriction — it scans every top-level section via buildSection(). Now
 * this does too: same rule, not a narrower one, per ADR-0018's "one
 * substrate, two container kinds." This also incidentally covers item 1
 * (a "## QST:" heading, one level too shallow, becomes its own top-level
 * section under extractRawSections' ##-only split) — buildSection()
 * recognizes navCode from heading TEXT regardless of level, and now warns
 * (NONCANONICAL_NAV_CODE_LEVEL) rather than silently either dropping or
 * silently accepting it.
 */
function extractSeedQuestions(content: string, filePath: string): { questions: Question[]; warnings: ParseWarning[] } {
  const tokens = tokenize(content)
  const { sections: rawSections } = extractRawSections(tokens)

  const questions: Question[] = []
  const warnings: ParseWarning[] = []
  const allSlugs = new Set<string>()
  const slugOccurrences = new Map<string, number>()
  const seedSlug = path.basename(filePath, '.md')

  const sections = rawSections.map(raw => buildSection(raw, allSlugs, warnings, slugOccurrences))

  // Trailing "(QST-PETNAME)" aliases (ledger ruling 2026-09-26): seed
  // questions get exactly the ADR-side recognition and collision law — one
  // substrate, two container kinds — resolved file-wide before questions
  // are read off the sections.
  resolveAliasHandles(sections, warnings)

  collectQstSections(sections, filePath, seedSlug, questions, warnings)

  return { questions, warnings }
}

function collectQstSections(
  sections: AdrSection[],
  filePath: string,
  seedSlug: string,
  out: Question[],
  warnings: ParseWarning[],
): void {
  for (const s of sections) {
    if (s.navCode === 'QST') {
      const base = extractQuestion(s, 0, filePath, [], warnings)
      out.push({
        ...base,
        id: `${seedSlug}-${s.slug}`,
        sourceKind: 'seed',
      })
    }
    collectQstSections(s.children, filePath, seedSlug, out, warnings)
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

/**
 * Best-effort title extraction for a Derived-Into line already known to
 * contain an "ADR-NNNN" mention. Tries the shapes actually observed in
 * this repo's own 22-seed corpus, most specific first — bold
 * ("**ADR-0039: Title**"), markdown link ("[ADR-0017 — Title](path)"),
 * plain ("ADR-0039: Title", with a trailing "(YYYY-MM-DD)" date and/or
 * "— annotation" tail stripped). Recall-first fallback: if none of those
 * shapes match (e.g. "[ADR-0009 Iteration 3](...)" — no colon/dash
 * separator at all, a real specimen in this repo's own dogfood-master-plan
 * seed), the WHOLE line stands as the title rather than dropping the
 * entry — an ugly title beats a silently missing one; the ADR number
 * (already captured by the caller) is what the axis-2 rollup actually
 * needs.
 */
function extractDerivedAdrTitle(trimmed: string): string {
  const bold = trimmed.match(/\*\*ADR-\d+\s*[:—-]\s*([^*]+)\*\*/i)
  if (bold) return bold[1].trim()

  const link = trimmed.match(/\[ADR-\d+\s*[:—-]\s*([^\]]+)\]/i)
  if (link) return link[1].trim()

  const plain = trimmed.match(/ADR-\d+\s*[:—-]\s*(.+)$/i)
  if (plain) {
    // Only a trailing "(YYYY-MM-DD)" date is stripped here — NOT a
    // trailing em/en-dash annotation. Unlike the bold/link forms (where
    // the closing "**"/"]" unambiguously marks where the real title ends),
    // a plain title has no such boundary, and this repo's own real titles
    // routinely contain their OWN internal em-dash ("Open Questions Panel
    // — Rich Rendering and Context" is ADR-0010's actual title) —
    // indistinguishable from a trailing annotation without that boundary,
    // so guessing would silently truncate real title content.
    return plain[1]
      .replace(/\*\*/g, '')
      .replace(/\s*\(\d{4}-\d{2}-\d{2}\).*$/, '') // trailing date + everything after
      .trim()
  }

  return trimmed.replace(/^-\s*/, '').replace(/\*\*/g, '').trim()
}

/**
 * Recall-first (ADR-0041 item 3): the current repo's own Secretariat seed
 * sat "chunked but wrenched" — its real Derived-Into line,
 * "- **ADR-0039: Secretariat — ...** (2026-07-30) — chunked from...", is
 * bolded AND dated AND annotated, none of which the old exact-shape regex
 * ("- ADR-NNNN: Title" only) tolerated. Tokenizes the section's own
 * content (not a raw split) so fenced code examples never get misread as
 * real links — the same "quotation vs. declaration" false-positive class
 * ADR-0041's fixture set names for Status lines, applied here too since
 * it's the identical mechanism (tokenize() already tracks it for free).
 */
function parseDerivedInto(content: string): { derivedAdrs: DerivedAdr[]; isProcessed: boolean; hasPlaceholder: boolean } {
  const tokens: Token[] = tokenize(content)
  const derivedAdrs: DerivedAdr[] = []
  let hasPlaceholder = false

  for (const token of tokens) {
    if (token.kind !== 'body' || token.inFence) continue
    const trimmed = token.text.trim()
    if (!trimmed || trimmed.startsWith('<!--') || trimmed.startsWith('-->')) continue

    if (UNPROCESSED_RE.test(trimmed)) {
      hasPlaceholder = true
      continue
    }

    // Recall-first has a floor: only dash-bullet list items count as
    // Derived-Into ENTRIES. Real corpus counter-examples (this repo's own
    // seeds) that must NOT count: a "**NOT:**" prose note cross-referencing
    // "ADR-0014/0015/0016 for Jérémie to answer" (a pointer, not a
    // derivation claim), and a seed explicitly marked "Not chunked into an
    // ADR — this was a diagnosable bug" whose body prose still COMPARES
    // itself to "ADR-0023"/"ADR-0028" in passing — without this guard that
    // seed's own explicit non-derivation gets overturned by its own prose,
    // flipping isProcessed to true, which is the wrong-direction error for
    // a recall-first sensor (inventing a link is worse than missing a
    // messily-formatted one).
    if (!/^-\s/.test(trimmed)) continue

    const numMatch = trimmed.match(DERIVED_ADR_NUMBER_RE)
    if (numMatch) {
      derivedAdrs.push({
        number: parseInt(numMatch[1], 10),
        title: extractDerivedAdrTitle(trimmed),
        raw: trimmed,
      })
    }
  }

  const isProcessed = derivedAdrs.length > 0 && !hasPlaceholder
  return { derivedAdrs, isProcessed, hasPlaceholder }
}
