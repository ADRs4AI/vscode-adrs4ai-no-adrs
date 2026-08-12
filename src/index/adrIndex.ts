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
import { parseAdr, extractAdrNumber, isDocumentPausedStatus } from '../parser/extractor'
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
    return this.indexContent(filePath, content);
  }

  /**
   * Parse already-known content and index it — no disk read. Lets a caller
   * that already has the text (a live editor buffer, notably) reindex
   * without waiting on a disk round-trip.
   *
   * "Question doesn't advance" residual (Lapidary 5, 2026-07-12): the
   * refresh pipeline was disk-watcher-only — nothing in this codebase
   * subscribed to onDidChangeTextDocument/onDidSaveTextDocument — so any
   * write path where the buffer edit landed but the disk save silently
   * failed or raced left the index (and therefore the panel) stale until
   * an unrelated manual save nudged the FileSystemWatcher. This method is
   * what extension.ts's new onDidChangeTextDocument trigger calls with
   * document.getText(), reflecting buffer truth instead of only disk truth.
   */
  indexContent(filePath: string, content: string): AdrFile {
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
      // ADR-0012: Accept any digit count (not just 4-digit). Projects using 3-digit numbers
      // (001-foo.md) are real and should not be invisible to the extension.
      // ADR-0023: explicit dot-entry exclusion (belt-and-suspenders — the
      // digit-prefix requirement already can't match a dot-prefixed name,
      // but this guards docs/adr/.working/ explicitly against any future
      // change to the filter, e.g. a recursive multi-root scan).
      .filter(name => !name.startsWith('.') && name.endsWith('.md') && /^\d+[-_]/.test(name) && !name.startsWith('seed-'))
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

    // ADR-0012: Detect duplicate ADR numbers (e.g., 001-foo.md and 0001-bar.md both → number 1)
    const numToFiles = new Map<number, AdrFile[]>();
    for (const adr of results) {
      const existing = numToFiles.get(adr.number) ?? [];
      existing.push(adr);
      numToFiles.set(adr.number, existing);
    }
    for (const [num, dupes] of numToFiles) {
      if (dupes.length > 1) {
        const names = dupes.map(a => path.basename(a.path)).join(', ');
        for (const adr of dupes) {
          adr.parseWarnings.push({
            code: 'DUPLICATE_NUMBER',
            message: `Two ADRs resolve to the same number ${String(num).padStart(4, '0')}: ${names}. Check filenames for duplicates.`,
          });
          // Re-emit so diagnostics are refreshed
          this.emit({ type: 'updated', adr, previous: adr });
        }
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
    // Document-level pause (2026-08-06 ruling): a Deferred/Paused/Suspended
    // document's questions leave every human-facing count and list.
    return this.allAdrs()
      .flatMap(a => isDocumentPausedStatus(a.status) ? [] : a.questions.filter(q => !q.isAnswered && !q.isRetired && !q.dismissedReason));
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
}
