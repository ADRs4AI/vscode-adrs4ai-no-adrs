/**
 * Tour writer — ADR-0034's "mint-from-filter": doctrine 5, "both mint —
 * models author tours for humans; humans author tours for crews ('turn my
 * current filter into a tour')." Pure JSON construction, vscode-free; the
 * command handler (extension.ts) owns gathering the currently-visible refs
 * and the actual file write.
 *
 * `authorRole` (ADR-0037, 2026-08-16): the human mint-from-filter command
 * passes `'human'`; the MCP `mint_tour` tool (ADR-0037's "richer,
 * model-authored mint," doctrine 5's staged v1 form) passes `'model'` with
 * per-entry `disposition`/`answerPath`/`comment`/explicit `mustRespond`.
 * One builder, two callers — never a second JSON constructor for the model
 * case. A field a caller doesn't supply is OMITTED from the entry object
 * entirely (never an `undefined`-valued key) so a bare mint-from-filter
 * still produces exactly `{ ref, must_respond: true }` with nothing else,
 * preserving this module's original, already-tested contract byte-for-byte.
 */

import * as path from 'path'

export interface TourEntryRef {
  ref: string
  /** Defaults to `true` when omitted — matches TourEntryRaw's own read-side default. */
  mustRespond?: boolean
  disposition?: 'decide' | 'ratify' | 'acknowledge' | 'delegate'
  answerPath?: string
  comment?: string
}

export interface MintTourInput {
  title: string
  authorName: string
  authorRole?: 'human' | 'model'
  /** ISO 8601 — caller-supplied so this module stays deterministic and testable (same discipline as DraftStore's timestamps). */
  mintedAt: string
  mintedCommit?: string
  entries: TourEntryRef[]
}

export interface TourFileJson {
  schema: 'question-tour/1'
  title: string
  author: { name: string; role: string }
  minted_at: string
  minted_commit?: string
  retired: false
  entries: Array<{
    ref: string
    must_respond: boolean
    disposition?: 'decide' | 'ratify' | 'acknowledge' | 'delegate'
    answer_path?: string
    comment?: string
  }>
}

export function buildTourJson(input: MintTourInput): TourFileJson {
  return {
    schema: 'question-tour/1',
    title: input.title,
    author: { name: input.authorName, role: input.authorRole ?? 'human' },
    minted_at: input.mintedAt,
    ...(input.mintedCommit ? { minted_commit: input.mintedCommit } : {}),
    retired: false,
    entries: input.entries.map(e => ({
      ref: e.ref,
      must_respond: e.mustRespond ?? true,
      ...(e.disposition ? { disposition: e.disposition } : {}),
      ...(e.answerPath ? { answer_path: e.answerPath } : {}),
      ...(e.comment ? { comment: e.comment } : {}),
    })),
  }
}

export function serializeTourJson(tour: TourFileJson): string {
  return JSON.stringify(tour, null, 2) + '\n'
}

/**
 * `<YYYY-MM-DD>-<slug>.tour.json`, matching this project's own hand-authored
 * naming (ADR-0034's COD example, and the ADR's own `docs/adr/tours/`
 * convention). `date` is caller-supplied (same determinism discipline as
 * `mintedAt`) — pass the same moment used for `minted_at`.
 */
export function tourFilename(title: string, date: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'tour'
  return `${date}-${slug}.tour.json`
}

/** `<adrDirPath>/tours/<filename>` — the one place ADR-0034 says tours live. */
export function tourFilePath(adrDirPath: string, filename: string): string {
  return path.join(adrDirPath, 'tours', filename)
}
