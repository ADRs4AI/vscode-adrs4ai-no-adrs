/**
 * Tour writer — ADR-0034's "mint-from-filter": doctrine 5, "both mint —
 * models author tours for humans; humans author tours for crews ('turn my
 * current filter into a tour')." Pure JSON construction, vscode-free; the
 * command handler (extension.ts) owns gathering the currently-visible refs
 * and the actual file write.
 *
 * Every entry mints with `must_respond: true` — a bare mint-from-filter
 * curates WHICH questions and in WHAT order, not per-entry disposition/
 * answer_path (those are for a richer, model-authored mint; doctrine 5's
 * "staged" authoring interface names JSON-by-hand/model as the v1 form for
 * that half). `disposition`/`answer_path`/`comment` are simply absent —
 * "everything not listed is deliberately absent," same discipline the
 * schema's own COD block states for facts.
 */

import * as path from 'path'

export interface TourEntryRef {
  ref: string
}

export interface MintTourInput {
  title: string
  authorName: string
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
  entries: Array<{ ref: string; must_respond: true }>
}

export function buildTourJson(input: MintTourInput): TourFileJson {
  return {
    schema: 'question-tour/1',
    title: input.title,
    author: { name: input.authorName, role: 'human' },
    minted_at: input.mintedAt,
    ...(input.mintedCommit ? { minted_commit: input.mintedCommit } : {}),
    retired: false,
    entries: input.entries.map(e => ({ ref: e.ref, must_respond: true as const })),
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
