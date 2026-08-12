/**
 * Seed Index — In-Memory Store
 *
 * Mirrors AdrIndex but for seed files (brain dumps, pre-decisional artifacts).
 * Seed files use date-prefixed filenames: seed-YYYY-MM-DD-slug.md
 *
 * See ADR-0011: Seeds as First-Class Artifacts for design rationale.
 */

import * as fs from 'fs'
import * as path from 'path'
import { parseSeed } from '../parser/seedExtractor'
import { stripInlineEmphasis } from '../parser/extractor'
import type { SeedFile, Question, DerivedAdr } from '../parser/types'

// ---------------------------------------------------------------------------
// SEED_INCOMPLETE cross-reference detection (ADR-0016)
// ---------------------------------------------------------------------------

/** Minimal shape needed from an indexed ADR for cross-reference detection. */
export interface AdrRefEntry {
  number: number
  title: string
  /** Raw file content — caller reads this from disk; kept pure/testable here. */
  content: string
}

/** An ADR detected as (likely) derived from a seed, for the SEED_INCOMPLETE message. */
export interface DetectedDerivedAdr {
  number: number
  title: string
}

/**
 * ADR-0016 Decision 1 (condition b): for a seed whose "Derived Into" section
 * still has placeholder text, find ADRs that reference it — string match on
 * the seed's filename stem (e.g. "seed-2026-03-07-bug-reports") anywhere in
 * the ADR's raw content. Pure function: callers own file I/O so this stays
 * unit-testable without fs/vscode.
 */
export function findReferencingAdrs(seedPath: string, adrs: AdrRefEntry[]): DetectedDerivedAdr[] {
  const stem = path.basename(seedPath, '.md')
  return adrs
    .filter(a => a.content.includes(stem))
    .map(a => ({ number: a.number, title: a.title }))
}

/** ADR filename convention: digits followed by "-" or "_" (matches AdrIndex's own filter). */
const ADR_FILENAME_RE = /^\d+[-_]/

/**
 * ADR-0016 Iteration 2 precondition (Fable 5, 2026-05-24): seeds with
 * non-standard filenames (not "seed-YYYY-MM-DD-*.md") are invisible to a
 * filename-only scan, so SEED_INCOMPLETE can never fire for exactly the
 * seeds most likely to have a stale "Derived Into" section. Jérémie's ANS
 * agreed both directions of the seed<->ADR reference need to be parseable.
 * This is the "detect seedness from content as well as filename" half of
 * that precondition (the alternative to full D15.1 filename tolerance +
 * rename Quick Fix, which is a separate, larger normalizer feature).
 *
 * Pure/testable: takes content, not a path, so no fs dependency here.
 */
export function looksLikeSeedByContent(content: string): boolean {
  const lines = content.split('\n')
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (lines[i].startsWith('# ')) {
      return /^SEED:/i.test(lines[i].slice(2).trim())
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Axis-2 rollup (ADR-0041 item 1 — derived implementation rollup)
// ---------------------------------------------------------------------------

/**
 * "The derived implementation rollup of its chunked ADRs (none/partial/
 * full, aggregated from the linked ADRs' own declared Statuses — the ADRs
 * are the truth; the seed aggregates)." A closed vocabulary distinct from
 * axis-1's (item 7's firewall: "axis-2's rollup badge never borrows
 * axis-1's words") — deliberately shares no token with
 * isRetiredSeedStatus's parked/superseded/terminated.
 *
 * 'unknown' covers a derived ADR reference whose number doesn't resolve in
 * the index (e.g. cross-repo herbarium specimens, or a not-yet-indexed
 * file) — "the ADRs are the truth" only holds when the ADR is actually
 * found; recall-first for Derived-Into applies here too: never confidently
 * report full/none/partial when a component status can't be verified.
 */
export type SeedRollup = 'none' | 'partial' | 'full' | 'unknown'

type AdrProgress = 'done' | 'not-done' | 'in-progress' | 'unknown'

/**
 * Leading-token-strict, same convention as isRetiredStatusToken /
 * isDocumentPausedStatus / isRetiredSeedStatus — an AdrFile.status carries
 * its full declared line ("Accepted — FULLY ratified 2026-08-12: ...",
 * not just "Accepted"), so this reads the leading token and ignores the
 * trailing annotation rather than exact-matching the whole string.
 */
function classifyAdrProgress(status: string | undefined): AdrProgress {
  if (status === undefined) return 'unknown'
  const s = stripInlineEmphasis(status).trim()
  if (/^Partially Implemented\b/i.test(s)) return 'in-progress'
  if (/^Implemented\b/i.test(s)) return 'done'
  if (/^(?:Draft|Proposed|Accepted|Superseded)\b/i.test(s)) return 'not-done'
  return 'unknown' // unrecognized status value — same "don't guess" posture as an unresolved number
}

/**
 * Rollup only applies to chunked seeds (derivedAdrs.length > 0) — undefined
 * means "axis-2 doesn't apply," not "no progress." A seed with 0% progress
 * across its (real, resolved) derived ADRs is the 'none' rollup value;
 * an unchunked seed has no rollup at all. `lookupStatus` is dependency-
 * injected (not an AdrIndex import) to keep this pure/testable, same
 * pattern as findReferencingAdrs above.
 */
export function computeSeedRollup(
  derivedAdrs: DerivedAdr[],
  lookupStatus: (adrNumber: number) => string | undefined,
): SeedRollup | undefined {
  if (derivedAdrs.length === 0) return undefined

  const progresses = derivedAdrs.map(d =>
    classifyAdrProgress(d.number !== undefined ? lookupStatus(d.number) : undefined),
  )

  if (progresses.some(p => p === 'unknown')) return 'unknown'
  if (progresses.every(p => p === 'done')) return 'full'
  if (progresses.every(p => p === 'not-done')) return 'none'
  return 'partial' // mixed done/not-done, or any in-progress
}

// ---------------------------------------------------------------------------
// SeedIndex class
// ---------------------------------------------------------------------------

export class SeedIndex {
  private seeds: Map<string, SeedFile> = new Map() // keyed by absolute path
  private listeners: Set<() => void> = new Set()

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  /** Parse and index a single seed file. Returns the parsed SeedFile. */
  indexFile(filePath: string): SeedFile {
    const content = fs.readFileSync(filePath, 'utf-8')
    return this.indexContent(filePath, content)
  }

  /**
   * Parse already-known content and index it — no disk read. See
   * AdrIndex.indexContent's doc comment for why this exists ("question
   * doesn't advance" residual, disk-watcher-only root cause).
   */
  indexContent(filePath: string, content: string): SeedFile {
    const seed = parseSeed(content, filePath)
    this.seeds.set(filePath, seed)
    this.emit()
    return seed
  }

  /** Remove a seed from the index (file was deleted). */
  removeFile(filePath: string): void {
    if (this.seeds.has(filePath)) {
      this.seeds.delete(filePath)
      this.emit()
    }
  }

  /** Scan a directory and index all matching seed files. */
  async indexDirectory(adrDir: string): Promise<SeedFile[]> {
    if (!fs.existsSync(adrDir)) return []

    const entries = fs.readdirSync(adrDir)

    const byFilename = entries.filter(name => name.endsWith('.md') && name.startsWith('seed-'))

    // Content-based fallback (ADR-0016 Iteration 2 precondition): a .md file
    // that isn't ADR-numbered and isn't already matched by filename might
    // still be a seed with a drifted filename — check its title.
    // ADR-0023: exclude dot-prefixed entries explicitly — this fallback's
    // broad ".md, not seed-, not numbered" match would otherwise be the one
    // path that could accidentally sweep up a stray dotfile (docs/adr/.working/
    // itself is a subdirectory readdirSync won't descend into, but this
    // guards the content-based path specifically, which is broader than the
    // filename-only checks).
    const candidates = entries.filter(name =>
      !name.startsWith('.') && name.endsWith('.md') && !name.startsWith('seed-') && !ADR_FILENAME_RE.test(name),
    )
    const byContent = candidates.filter(name => {
      try {
        return looksLikeSeedByContent(fs.readFileSync(path.join(adrDir, name), 'utf-8'))
      } catch {
        return false
      }
    })

    const seedFiles = [...byFilename, ...byContent]
      .map(name => path.join(adrDir, name))
      .sort()

    const results: SeedFile[] = []
    for (const filePath of seedFiles) {
      try {
        results.push(this.indexFile(filePath))
      } catch (err) {
        console.error(`[Seed Index] Failed to parse ${filePath}:`, err)
      }
    }
    return results
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** All indexed seeds, sorted by date (most recent last). */
  allSeeds(): SeedFile[] {
    return Array.from(this.seeds.values())
      .sort((a, b) => (a.date ?? a.path).localeCompare(b.date ?? b.path))
  }

  /** Get a seed by absolute path. */
  getByPath(filePath: string): SeedFile | undefined {
    return this.seeds.get(filePath)
  }

  /** Total seed count. */
  get size(): number {
    return this.seeds.size
  }

  /** Count of unprocessed seeds (Derived Into still empty). */
  get unprocessedCount(): number {
    return this.allSeeds().filter(s => !s.isProcessed).length
  }

  /** Seeds whose "Derived Into" section still has placeholder text (ADR-0016 precondition). */
  incompleteSeeds(): SeedFile[] {
    return this.allSeeds().filter(s => s.derivedIntoHasPlaceholder)
  }

  /**
   * ADR-0018 Step 3: all open (unanswered) questions across every indexed
   * seed, for the Open Questions panel's merge with AdrIndex's questions.
   * Read-only aggregation — does not touch the panel or the draft-key
   * scheme, which need a source-aware key before seeds can safely use them
   * (flagged separately: a seed's questions all having no ADR number risks
   * draft-key collisions across different seeds if naively assigned one).
   */
  allOpenQuestions(): Question[] {
    return this.allSeeds().flatMap(s => s.questions.filter(q => !q.isAnswered))
  }

  // -------------------------------------------------------------------------
  // Change listeners
  // -------------------------------------------------------------------------

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try { listener() } catch { /* don't let a bad listener crash the index */ }
    }
  }
}
