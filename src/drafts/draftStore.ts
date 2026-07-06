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
 * All timestamps are passed in by the caller (never computed internally)
 * so this class stays deterministic and unit-testable.
 */

import * as fs from 'fs'
import * as path from 'path'
import { normalizeQuestionText } from './draftKey'

export interface DraftRecord {
  key: string
  adrPath: string
  adrNumber: number
  questionText: string
  draftText: string
  updatedAt: string
  /** Prior draftText revisions, oldest first, capped at MAX_HISTORY. */
  history: string[]
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

  constructor(private readonly workingDir: string) {
    this.draftsPath = path.join(workingDir, 'drafts.json')
    this.archivePath = path.join(workingDir, 'drafts-archive.json')
    this.load()
  }

  private load(): void {
    try {
      if (fs.existsSync(this.draftsPath)) {
        const raw = JSON.parse(fs.readFileSync(this.draftsPath, 'utf8')) as DraftRecord[]
        this.drafts = new Map(raw.map(d => [d.key, d]))
      }
    } catch {
      // Corrupt or unreadable — start fresh rather than crash the panel.
      this.drafts = new Map()
    }
    try {
      if (fs.existsSync(this.archivePath)) {
        this.archive = JSON.parse(fs.readFileSync(this.archivePath, 'utf8')) as ArchivedDraftRecord[]
      }
    } catch {
      this.archive = []
    }
  }

  private persistDrafts(): void {
    fs.mkdirSync(this.workingDir, { recursive: true })
    fs.writeFileSync(this.draftsPath, JSON.stringify(Array.from(this.drafts.values()), null, 2))
  }

  private persistArchive(): void {
    fs.mkdirSync(this.workingDir, { recursive: true })
    fs.writeFileSync(this.archivePath, JSON.stringify(this.archive, null, 2))
  }

  /** Look up a draft by key. */
  get(key: string): DraftRecord | undefined {
    return this.drafts.get(key)
  }

  /** All active (non-archived) drafts. */
  all(): DraftRecord[] {
    return Array.from(this.drafts.values())
  }

  /** All archived (promoted/replaced) drafts — the permanent purgatory. */
  allArchived(): ArchivedDraftRecord[] {
    return [...this.archive]
  }

  /**
   * Auto-save on keystroke (debounced ~500ms by the caller, per ADR-0023's
   * answered auto-save/restore QST). Idempotent per key — one draft per slot.
   */
  save(key: string, adrPath: string, adrNumber: number, questionText: string, draftText: string, now: string): void {
    const existing = this.drafts.get(key)
    const history = existing
      ? [...existing.history, existing.draftText].slice(-MAX_HISTORY)
      : []
    this.drafts.set(key, { key, adrPath, adrNumber, questionText, draftText, updatedAt: now, history })
    this.persistDrafts()
  }

  /**
   * Answer submitted — one atomic event per ADR-0023's auto-save/restore
   * decision: the draft is archived (never deleted) and removed from the
   * active set. Safe to call on a key with no active draft (no-op).
   */
  promote(key: string, now: string): void {
    const existing = this.drafts.get(key)
    if (!existing) return
    this.archive.push({ ...existing, archivedAt: now, reason: 'promoted' })
    this.drafts.delete(key)
    this.persistDrafts()
    this.persistArchive()
  }

  /** Drafts whose key no longer matches any currently-live question — candidates for reattach. */
  orphans(liveKeys: ReadonlySet<string>): DraftRecord[] {
    return this.all().filter(d => !liveKeys.has(d.key))
  }

  /**
   * Move an orphaned draft to a different (live) key. Never automatic —
   * callers only invoke this from an explicit human confirmation (the
   * "reattach to..." picker), per ADR-0023's "no silent auto-reattach."
   */
  reattach(oldKey: string, newKey: string, now: string): void {
    const existing = this.drafts.get(oldKey)
    if (!existing) return
    this.drafts.delete(oldKey)
    const target = this.drafts.get(newKey)
    const history = target
      ? [...target.history, target.draftText, ...existing.history].slice(-MAX_HISTORY)
      : existing.history
    this.drafts.set(newKey, { ...existing, key: newKey, updatedAt: now, history })
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
}

/**
 * Default suggestion for the orphan-reattach picker: same-ADR question with
 * highest textual similarity (ADR-0023 QST-2 ANS). Falls back to any live
 * question if none share the orphan's ADR. Returns undefined only when no
 * live questions exist at all.
 */
export function bestReattachCandidate(orphan: DraftRecord, liveQuestions: LiveQuestionRef[]): string | undefined {
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
