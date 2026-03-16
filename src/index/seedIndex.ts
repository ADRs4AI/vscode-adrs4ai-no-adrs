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
    const seedFiles = entries
      .filter(name => name.endsWith('.md') && name.startsWith('seed-'))
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
