/**
 * DocketSession — adapter-lifetime state, owned by whichever adapter
 * constructs it (ADR-0021's own "Forma-3-only" scope, now made an explicit
 * object instead of three module-level singletons).
 *
 * Phase 0 of the docket extraction (docket repo ADR-0001, QST-SESSION,
 * answered 2026-09-01): `dedupe.ts`'s `seen` map, `pathLock.ts`'s `queues`
 * map, and `stdioServer.ts`'s `composite`/`scannedAt` closure variables were
 * three separate module-level singletons — correct for a long-lived stdio
 * server (exactly one process, exactly one session, for the process's whole
 * life), wrong for a per-invocation CLI mouth, which needs to construct a
 * *fresh* session per call rather than inherit cross-invocation state (a
 * stale dedup cache) or silently lack a capability entirely (`refresh_corpus`
 * was reachable only through the adapter's own closure, so nothing outside
 * `stdioServer.ts` could refresh the corpus at all).
 *
 * Riddle 5's boundary line (stacked ANS, same QST): this object owns
 * *adapter-lifetime* state and nothing enters the parser proper — confirmed
 * true of the code today, `parseAdr(content, filePath, options)` takes no
 * session or context argument. Any future state a *parse* genuinely needs
 * is a different question than this one.
 */

import { CompositeIndex } from '../index/compositeIndex'
import { AdrIndex } from '../index/adrIndex'
import { SeedIndex } from '../index/seedIndex'

export interface DocketSessionOptions {
  workspaceRoot: string
  adrDirRel?: string
}

export interface RefreshResult {
  adrCount: number
  seedCount: number
  scannedAt: string
}

export class DocketSession {
  private composite: CompositeIndex
  private scannedAt: string
  private readonly seen = new Map<string, string>()
  private readonly lockQueues = new Map<string, Promise<void>>()
  private readonly workspaceRoot: string
  private readonly adrDirRel: string

  private constructor(composite: CompositeIndex, scannedAt: string, workspaceRoot: string, adrDirRel: string) {
    this.composite = composite
    this.scannedAt = scannedAt
    this.workspaceRoot = workspaceRoot
    this.adrDirRel = adrDirRel
  }

  /** Scans the workspace once and returns a session ready to use — the one async step every adapter needs before it can serve a single call. */
  static async create(options: DocketSessionOptions): Promise<DocketSession> {
    // Same default stdioServer.ts's own $ADR_DIR_REL resolution already
    // used — kept here so a caller that already has a concrete value (the
    // common case) pays nothing, and one that doesn't gets the same
    // behavior the server always had.
    const adrDirRel = options.adrDirRel ?? 'docs/adr'
    const composite = await CompositeIndex.fromWorkspace(options.workspaceRoot, { adrDirRel })
    return new DocketSession(composite, new Date().toISOString(), options.workspaceRoot, adrDirRel)
  }

  /**
   * Test-only, synchronous: no filesystem scan. Write-tier tests inject
   * their own `RepositoryContext` mock (a `files` Map, not real disk) and
   * only exercise dedupe/lock — they have no real workspace root to scan
   * and don't need one. Uses `CompositeIndex.wrapSingle`, the same
   * no-scan seam existing single-root callers already use.
   */
  static createForTests(): DocketSession {
    const composite = CompositeIndex.wrapSingle('/fake', new AdrIndex(), new SeedIndex())
    return new DocketSession(composite, new Date().toISOString(), '/fake', 'docs/adr')
  }

  // --- Corpus (moved from stdioServer.ts's `composite`/`scannedAt` closure) ---

  getComposite(): CompositeIndex {
    return this.composite
  }

  getScannedAt(): string {
    return this.scannedAt
  }

  /** Rescans the workspace from disk and swaps the composite in place. Same mechanism `refresh_corpus` has always used, now a session method any adapter can call, not a capability stranded in stdioServer.ts's own closure. */
  async refreshCorpus(): Promise<RefreshResult> {
    this.composite = await CompositeIndex.fromWorkspace(this.workspaceRoot, { adrDirRel: this.adrDirRel })
    this.scannedAt = new Date().toISOString()
    return { adrCount: this.composite.allAdrs().length, seedCount: this.composite.allSeeds().length, scannedAt: this.scannedAt }
  }

  // --- Dedup (moved from dedupe.ts, unchanged behavior) ---

  private dedupeKey(toolName: string, clientMsgId: string): string {
    return `${toolName}:${clientMsgId}`
  }

  getCached(toolName: string, clientMsgId: string | undefined): string | undefined {
    if (!clientMsgId) return undefined
    return this.seen.get(this.dedupeKey(toolName, clientMsgId))
  }

  recordSuccess(toolName: string, clientMsgId: string | undefined, result: string): void {
    if (!clientMsgId) return
    this.seen.set(this.dedupeKey(toolName, clientMsgId), result)
  }

  // --- Path lock (moved from pathLock.ts, unchanged behavior) ---

  async withPathLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.lockQueues.get(path) ?? Promise.resolve()
    const run = prior.then(fn, fn)
    const queued = run.then(
      () => undefined,
      () => undefined,
    )
    this.lockQueues.set(path, queued)
    queued.then(() => {
      // Only clean up if no newer call re-queued behind us in the meantime —
      // avoids one call's cleanup racing ahead of a call queued after it.
      if (this.lockQueues.get(path) === queued) this.lockQueues.delete(path)
    })
    return run
  }

  /** Test-only: reset dedup + lock state without a fresh corpus scan. */
  _resetForTests(): void {
    this.seen.clear()
    this.lockQueues.clear()
  }
}
