/**
 * RepositoryContext — the Forma-5 portability boundary.
 *
 * ADR-0003 Decision (portability requirement 1, "handler purity"): every MCP
 * tool handler lives in handlers.ts with zero `vscode` imports, and depends
 * only on this interface. The VS Code-backed implementation (wired up when
 * the transport lands, ADR-0021 sequencing step 3) uses vscode.workspace.fs
 * and the existing AdrIndex/SeedIndex; a future Forma-5 implementation backs
 * the same interface with the GitHub REST API instead. Same handlers,
 * different context — that's the whole point of the boundary.
 */

import type { AdrFile, SeedFile } from '../parser/types'

export interface GitLogEntry {
  hash: string
  date: string
  subject: string
  author: string
}

export interface RepositoryContext {
  /** All parsed ADRs currently known to the index. */
  listAdrs(): AdrFile[]
  /** Resolve a single ADR by number ("1"), zero-padded string ("0001"), or `adr:NNNN` shorthand. */
  getAdr(ref: string): AdrFile | undefined

  /** All parsed seeds currently known to the index. */
  listSeeds(): SeedFile[]
  /** Resolve a single seed by its slug, with or without the `seed:` prefix. */
  getSeed(ref: string): SeedFile | undefined

  // --- Raw file system primitives (ADR-0003 portability requirement 2) ---
  // FIXED (2026-09-06, docket repo ADR-0001 QST-NODE's survey; owed since
  // my own ANS there promised it in the same pass as DocketSession):
  // this used to say paths are relative to the ADR directory root
  // (adrManager.adrDirectory) — wrong today, confirmed by checking every
  // real call site, not assumed. `handlers.ts` always passes
  // `resolved.adr.path` (an absolute path, from `AdrFile.path`) straight
  // into `readFile`/`writeFile`, and the one real implementation
  // (`repositoryContextAdapter.ts`) hands that path directly to
  // `fs.promises.readFile`/`writeFile` with no join against any root —
  // there is no relative-path contract in effect anywhere in this chain.
  // A future Forma-5 (remote/GitHub-REST-backed) implementation is free to
  // interpret these as repo-relative internally, but the CONTRACT this
  // interface documents is absolute paths, since that's what every current
  // caller and implementation actually agree on.
  readFile(absolutePath: string): Promise<string>
  writeFile(absolutePath: string, content: string): Promise<void>
  listFiles(absoluteDir: string): Promise<string[]>

  /** Optional — not required by any Tier 0/1 read; reserved for a future temporal primitive. */
  getGitLog?(relativePath: string, n?: number): Promise<GitLogEntry[]>
}
