/**
 * ADR Index — In-Memory Store
 *
 * Forma 1 uses an in-memory Map as the index.
 * SQLite + FTS5 is introduced in Forma 2 when search and the open questions
 * panel require it. See ADR-0002 for the migration plan.
 *
 * The index is the single source of truth for all consumers:
 * tree view, status bar, MCP server, future webview panel.
 */

import * as fs from 'fs'
import * as path from 'path'
import { parseAdr, extractAdrNumber } from '../parser/extractor'
import type { AdrFile, Question } from '../parser/types'

export type IndexChangeEvent =
  | { type: 'added'; adr: AdrFile }
  | { type: 'updated'; adr: AdrFile; previous: AdrFile }
  | { type: 'removed'; adrPath: string; adrNumber: number };

export type IndexChangeListener = (event: IndexChangeEvent) => void;

// ---------------------------------------------------------------------------
// AdrIndex class
// ---------------------------------------------------------------------------

export class AdrIndex {
  private adrs: Map<string, AdrFile> = new Map(); // keyed by absolute path
  private listeners: Set<IndexChangeListener> = new Set();
  private namespace: string | undefined;

  constructor(namespace?: string) {
    this.namespace = namespace;
  }

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  /** Parse and index a single ADR file. Returns the parsed ADR. */
  indexFile(filePath: string): AdrFile {
    const content = fs.readFileSync(filePath, 'utf-8');
    const adr = parseAdr(content, filePath, { namespace: this.namespace });

    const previous = this.adrs.get(filePath);
    this.adrs.set(filePath, adr);

    if (previous) {
      this.emit({ type: 'updated', adr, previous });
    } else {
      this.emit({ type: 'added', adr });
    }

    return adr;
  }

  /** Remove an ADR from the index (file was deleted). */
  removeFile(filePath: string): void {
    const adr = this.adrs.get(filePath);
    if (adr) {
      this.adrs.delete(filePath);
      this.emit({ type: 'removed', adrPath: filePath, adrNumber: adr.number });
    }
  }

  /** Scan a directory and index all matching ADR files. */
  async indexDirectory(adrDir: string): Promise<AdrFile[]> {
    if (!fs.existsSync(adrDir)) return [];

    const entries = fs.readdirSync(adrDir);
    const adrFiles = entries
      .filter(name => name.endsWith('.md') && /^\d{4}[-_]/.test(name))
      .map(name => path.join(adrDir, name))
      .sort();

    const results: AdrFile[] = [];
    for (const filePath of adrFiles) {
      try {
        const adr = this.indexFile(filePath);
        results.push(adr);
      } catch (err) {
        // Don't crash the index if one file is unreadable; log and continue
        console.error(`[ADR Index] Failed to parse ${filePath}:`, err);
      }
    }

    return results;
  }

  /** Update the namespace and re-parse all indexed files. */
  setNamespace(namespace: string | undefined): void {
    if (this.namespace === namespace) return;
    this.namespace = namespace;
    // Re-parse everything with the new namespace (namespace affects deep-link IDs)
    for (const [filePath] of this.adrs) {
      try {
        this.indexFile(filePath);
      } catch { /* ignore */ }
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** All indexed ADRs, sorted by ADR number. */
  allAdrs(): AdrFile[] {
    return Array.from(this.adrs.values())
      .sort((a, b) => a.number - b.number);
  }

  /** Get a specific ADR by number. */
  getByNumber(number: number): AdrFile | undefined {
    return Array.from(this.adrs.values()).find(a => a.number === number);
  }

  /** Get a specific ADR by absolute path. */
  getByPath(filePath: string): AdrFile | undefined {
    return this.adrs.get(filePath);
  }

  /** All open (unanswered) questions across all ADRs, sorted by ADR number. */
  openQuestions(): Question[] {
    return this.allAdrs()
      .flatMap(a => a.questions.filter(q => !q.isAnswered));
  }

  /** Total ADR count. */
  get size(): number {
    return this.adrs.size;
  }

  /** Total open question count (for status bar badge). */
  get openQuestionCount(): number {
    return this.openQuestions().length;
  }

  /** Summary string for status bar: "ADRs: 12 | ? 3" */
  get statusBarText(): string {
    const open = this.openQuestionCount;
    return `ADRs: ${this.size}${open > 0 ? ` | ? ${open}` : ''}`;
  }

  // -------------------------------------------------------------------------
  // Change listeners
  // -------------------------------------------------------------------------

  onChange(listener: IndexChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: IndexChangeEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* don't let a bad listener crash the index */ }
    }
  }

  // -------------------------------------------------------------------------
  // Deep link resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve a deep link reference like "0001#qst-scope" or "adr:0001#decision".
   * Returns { adr, slug } or undefined if not found.
   */
  resolveDeepLink(ref: string): { adr: AdrFile; slug: string } | undefined {
    // Normalize: strip "adr:" prefix, namespace prefix (e.g., "my-project.0001#slug")
    const cleaned = ref.replace(/^adr:/, '').replace(/^[^.]+\./, '');
    const [numPart, slugPart] = cleaned.split('#');
    const num = parseInt(numPart, 10);
    if (isNaN(num)) return undefined;

    const adr = this.getByNumber(num);
    if (!adr) return undefined;

    return { adr, slug: slugPart ?? '' };
  }
}
