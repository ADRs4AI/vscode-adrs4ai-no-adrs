/**
 * DraftStore — ADR-0023 (Anti-Clobbering Posture, Decision 1/3/5)
 *
 * Persists in-progress Open Questions panel answers to
 * `docs/adr/.working/drafts.json`, keyed by computeDraftKey() (see
 * draftKey.ts). Committed to git, NOT gitignored (Jérémie's completist
 * reversal: "why would we .gitignore these drafts? ... we're talking a few
 * hundred kB at most, ever").
 *
 * Drafts are never hard-deleted. On promotion (answer submitted) they move
 * to `drafts-archive.json` — permanent purgatory; no purge mechanism exists
 * yet (the ADR names ≥30 days as a future possibility, "if ever").
 *
 * Hardened 2026-07-07 against three catches from Quarry 5 (write-adversary):
 * see docs/inbox/2026-07-07-2018-quarry-to-fitter-three-catches-in-the-
 * shipped-draft-store.md. All timestamps are still caller-supplied so this
 * class stays deterministic and unit-testable.
 *
 * adrPath portability (2026-07-22, Loftsman/ios-client RFC `1951`, ruled by
 * Lapidary `2140`): `adrPath` is stable contract, repo-relative. See
 * adrPathPortability.ts for the read-tolerant resolver used by any future
 * caller that needs to turn a stored (possibly still-legacy-absolute) entry
 * back into a real file path; this class's own job is only the write side —
 * canonicalize at every persist, so the vault heals through ordinary use.
 */

import * as fs from 'fs'
import * as path from 'path'
import { normalizeQuestionText } from './draftKey'
import { toRepoRelative } from './adrPathPortability'

export interface DraftRecord {
  key: string
  adrPath: string
  adrNumber: number
  questionText: string
  draftText: string
  updatedAt: string
  /** Prior draftText revisions, oldest first, capped at MAX_HISTORY. */
  history: string[]
  /**
   * How many questions in the ADR shared questionText's normalized hash at
   * save time (CATCH 3 guard). A restore is only trusted when this still
   * matches the current document — if it changed, a duplicate-text question
   * was inserted or removed and the ordinal-based key may now point at a
   * different physical question than the one this draft was written for.
   */
  totalOccurrences: number
}

export interface ArchivedDraftRecord extends DraftRecord {
  archivedAt: string
  reason: 'promoted' | 'replaced'
}

const MAX_HISTORY = 10

export class DraftStore {
  private drafts: Map<string, DraftRecord> = new Map()
  private archive: ArchivedDraftRecord[] = []
  private readonly draftsPath: string
  private readonly archivePath: string

  /**
   * Paths of any corrupt files quarantined during load (CATCH 1) — e.g.
   * `drafts.json.corrupt-1720383600000`. Empty in the normal case. Callers
   * (the panel) should warn the human when this is non-empty rather than
   * let the recovery happen invisibly.
   */
  readonly quarantinedFiles: string[] = []

  /**
   * `workspaceRoot`, when provided, turns on adrPath portability (Loftsman
   * RFC, ruled by Lapidary 2026-07-22 `2140`): every persisted active-set
   * entry's `adrPath` is canonicalized to repo-relative, POSIX-separated
   * form — write canonical, heal opportunistically. Omitted (e.g. existing
   * tests, or no open workspace) preserves the exact prior behavior of
   * storing whatever the caller passed, verbatim.
   */
  constructor(private readonly workingDir: string, private readonly workspaceRoot?: string) {
    this.draftsPath = path.join(workingDir, 'drafts.json')
    this.archivePath = path.join(workingDir, 'drafts-archive.json')
    this.reload()
  }

  private canonicalAdrPath(adrPath: string): string {
    return this.workspaceRoot ? toRepoRelative(adrPath, this.workspaceRoot) : adrPath
  }

  // ---------------------------------------------------------------------------
  // Load / persist — atomic writes + backup mirror + quarantine-on-corruption
  // ---------------------------------------------------------------------------

  /**
   * Re-read both files from disk into memory. Called on construction and at
   * the start of every mutating method (CATCH 2): re-reading immediately
   * before applying a single-key change, rather than trusting a possibly-
   * stale in-memory snapshot, means two concurrent DraftStore instances
   * (two VS Code windows) each pick up the other's latest persisted state
   * before writing their own change — turning "last full-file write wins,
   * unconditionally" into "only a genuinely simultaneous write can collide."
   */
  private reload(): void {
    this.drafts = new Map(this.loadArrayWithBackup<DraftRecord>(this.draftsPath).map(d => [d.key, d]))
    this.archive = this.loadArrayWithBackup<ArchivedDraftRecord>(this.archivePath)
  }

  /**
   * Read a JSON array file, falling back to its `.bak` mirror if the primary
   * is missing-but-corrupt (CATCH 1: a truncated write, e.g. a crash mid-
   * `fs.writeFileSync`). A corrupt primary is quarantined (renamed aside,
   * never deleted) rather than silently discarded, so the fallback to `.bak`
   * never has to compete with an overwrite of forensic evidence.
   */
  private loadArrayWithBackup<T>(primaryPath: string): T[] {
    if (fs.existsSync(primaryPath)) {
      const parsed = this.tryParseArray<T>(primaryPath)
      if (parsed !== null) return parsed
      this.quarantine(primaryPath)
    }
    const backupPath = this.backupPathFor(primaryPath)
    return this.tryParseArray<T>(backupPath) ?? []
  }

  private tryParseArray<T>(filePath: string): T[] | null {
    if (!fs.existsSync(filePath)) return null
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      return Array.isArray(parsed) ? (parsed as T[]) : null
    } catch {
      return null
    }
  }

  private quarantine(filePath: string): void {
    try {
      const quarantinePath = `${filePath}.corrupt-${Date.now()}`
      fs.renameSync(filePath, quarantinePath)
      this.quarantinedFiles.push(quarantinePath)
    } catch {
      // Best effort — if even the rename fails, don't crash the panel over it.
    }
  }

  private backupPathFor(filePath: string): string {
    return `${filePath}.bak`
  }

  /**
   * Write `data` to `primaryPath` AND mirror it to `primaryPath.bak`, both
   * atomically (temp file + rename — a crash mid-write leaves the previous,
   * complete file in place rather than a truncated one). The backup always
   * mirrors the just-written primary, so if the primary is later found
   * corrupt (e.g. external truncation), the backup is a same-generation,
   * complete fallback — not one write behind.
   */
  private writeArrayWithBackup(primaryPath: string, data: unknown[]): void {
    fs.mkdirSync(this.workingDir, { recursive: true })
    const json = JSON.stringify(data, null, 2)
    this.writeFileAtomic(primaryPath, json)
    this.writeFileAtomic(this.backupPathFor(primaryPath), json)
  }

  private writeFileAtomic(filePath: string, content: string): void {
    const tmpPath = `${filePath}.tmp-${process.pid}`
    fs.writeFileSync(tmpPath, content)
    fs.renameSync(tmpPath, filePath)
  }

  private persistDrafts(): void {
    this.writeArrayWithBackup(this.draftsPath, Array.from(this.drafts.values()))
  }

  private persistArchive(): void {
    this.writeArrayWithBackup(this.archivePath, this.archive)
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** Raw lookup by key — trusts the caller. Prefer getIfMatching() for restore-on-render. */
  get(key: string): DraftRecord | undefined {
    return this.drafts.get(key)
  }

  /**
   * Safe accessor for restore-on-render: returns the draft only if its
   * stored questionText and totalOccurrences both still match what the
   * caller sees right now for this key. Guards against CATCH 3 (ordinal
   * reindexing handing a stale key to a different live question) — a
   * mismatch on either axis means don't trust it, full stop, rather than
   * silently pre-filling the wrong answer.
   */
  getIfMatching(key: string, currentQuestionText: string, currentTotalOccurrences: number): DraftRecord | undefined {
    const draft = this.drafts.get(key)
    if (!draft) return undefined
    if (normalizeQuestionText(draft.questionText) !== normalizeQuestionText(currentQuestionText)) return undefined
    if (draft.totalOccurrences !== currentTotalOccurrences) return undefined
    return draft
  }

  /** All active (non-archived) drafts. */
  all(): DraftRecord[] {
    return Array.from(this.drafts.values())
  }

  /** All archived (promoted/replaced) drafts — the permanent purgatory. */
  allArchived(): ArchivedDraftRecord[] {
    return [...this.archive]
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /**
   * Auto-save on keystroke (debounced ~500ms by the caller, per ADR-0023's
   * answered auto-save/restore QST). Idempotent per key — one draft per slot.
   *
   * If an existing record at this key belongs to a genuinely different
   * question (a key-collision from ordinal reindexing, CATCH 3), its content
   * is archived (reason: 'replaced') rather than folded into this question's
   * history or silently overwritten — the old content is never discarded,
   * only relocated.
   */
  save(
    key: string,
    adrPath: string,
    adrNumber: number,
    questionText: string,
    draftText: string,
    now: string,
    totalOccurrences = 1,
  ): void {
    this.reload()
    const existing = this.drafts.get(key)
    const sameQuestion = !!existing && normalizeQuestionText(existing.questionText) === normalizeQuestionText(questionText)

    if (existing && !sameQuestion) {
      this.archive.push({ ...existing, archivedAt: now, reason: 'replaced' })
    }

    const history = sameQuestion
      ? [...existing!.history, existing!.draftText].slice(-MAX_HISTORY)
      : []
    // Write canonical (adrPath portability): store repo-relative form
    // regardless of what the caller passed — heals a legacy absolute value
    // the moment this key is touched again, no migration script needed.
    this.drafts.set(key, {
      key, adrPath: this.canonicalAdrPath(adrPath), adrNumber, questionText, draftText, updatedAt: now, history, totalOccurrences,
    })
    this.persistDrafts()
    if (existing && !sameQuestion) this.persistArchive()
  }

  /**
   * Answer submitted — one atomic event per ADR-0023's auto-save/restore
   * decision: the draft is archived (never deleted) and removed from the
   * active set. Safe to call on a key with no active draft (no-op).
   */
  promote(key: string, now: string): void {
    this.reload()
    const existing = this.drafts.get(key)
    if (!existing) return
    this.archive.push({ ...existing, archivedAt: now, reason: 'promoted' })
    this.drafts.delete(key)
    this.persistDrafts()
    this.persistArchive()
  }

  /**
   * Drafts that don't safely match any currently-live question — candidates
   * for the reattach picker. A draft is live only if its key exists among
   * `liveQuestions` AND its stored questionText/totalOccurrences both match
   * what's live there now (CATCH 3: a key can be technically "present" in
   * the live set while actually belonging to a different question).
   */
  orphans(liveQuestions: ReadonlyArray<LiveQuestionRef>): DraftRecord[] {
    const liveByKey = new Map(liveQuestions.map(q => [q.key, q]))
    return this.all().filter(d => {
      const live = liveByKey.get(d.key)
      if (!live) return true
      if (normalizeQuestionText(live.text) !== normalizeQuestionText(d.questionText)) return true
      if (live.totalOccurrences !== undefined && live.totalOccurrences !== d.totalOccurrences) return true
      return false
    })
  }

  /**
   * Move an orphaned draft to a different (live) key. Never automatic —
   * callers only invoke this from an explicit human confirmation (the
   * "reattach to..." picker), per ADR-0023's "no silent auto-reattach."
   */
  reattach(oldKey: string, newKey: string, now: string): void {
    this.reload()
    const existing = this.drafts.get(oldKey)
    if (!existing) return
    this.drafts.delete(oldKey)
    const target = this.drafts.get(newKey)
    const history = target
      ? [...target.history, target.draftText, ...existing.history].slice(-MAX_HISTORY)
      : existing.history
    // Same heal-opportunistically treatment as save() — reattach also
    // persists the active set, so it's another chance to canonicalize a
    // still-legacy adrPath without a dedicated migration pass.
    this.drafts.set(newKey, { ...existing, key: newKey, adrPath: this.canonicalAdrPath(existing.adrPath), updatedAt: now, history })
    this.persistDrafts()
  }
}

// ---------------------------------------------------------------------------
// Reattach suggestion (word-overlap similarity — cheap, no dependency)
// ---------------------------------------------------------------------------

function wordSet(text: string): Set<string> {
  return new Set(normalizeQuestionText(text).split(/\W+/).filter(Boolean))
}

/** Jaccard similarity over normalized word sets — 0 (disjoint) to 1 (identical). */
export function textSimilarity(a: string, b: string): number {
  const sa = wordSet(a)
  const sb = wordSet(b)
  if (sa.size === 0 && sb.size === 0) return 1
  let intersection = 0
  for (const w of sa) if (sb.has(w)) intersection += 1
  const union = new Set([...sa, ...sb]).size
  return union === 0 ? 0 : intersection / union
}

export interface LiveQuestionRef {
  key: string
  text: string
  adrNumber: number
  /** Total sibling count sharing text's normalized hash in this ADR right now (CATCH 3 guard). */
  totalOccurrences?: number
}

/**
 * Default suggestion for the orphan-reattach picker: same-ADR question with
 * highest textual similarity (ADR-0023 QST-2 ANS). Falls back to any live
 * question if none share the orphan's ADR. Returns undefined only when no
 * live questions exist at all.
 */
export function bestReattachCandidate(
  orphan: Pick<DraftRecord, 'adrNumber' | 'questionText'>,
  liveQuestions: LiveQuestionRef[],
): string | undefined {
  const sameAdr = liveQuestions.filter(q => q.adrNumber === orphan.adrNumber)
  const pool = sameAdr.length > 0 ? sameAdr : liveQuestions
  if (pool.length === 0) return undefined

  let best = pool[0]
  let bestScore = textSimilarity(orphan.questionText, best.text)
  for (const q of pool.slice(1)) {
    const score = textSimilarity(orphan.questionText, q.text)
    if (score > bestScore) { best = q; bestScore = score }
  }
  return best.key
}
