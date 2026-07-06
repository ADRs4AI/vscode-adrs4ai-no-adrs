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
import type { SeedFile } from '../parser/types'

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
    const candidates = entries.filter(name =>
      name.endsWith('.md') && !name.startsWith('seed-') && !ADR_FILENAME_RE.test(name),
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
