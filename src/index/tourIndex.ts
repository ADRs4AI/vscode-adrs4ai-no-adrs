/**
 * TourIndex — ADR-0034 (QuestionTours), reference-implementation first
 * slice: discovery + parsing of `docs/adr/tours/*.tour.json`, plus entry
 * resolution against the live substrate.
 *
 * Doctrine (ADR-0034 Decision, corollary 1 — "facts vs. claims, structurally
 * separate"): an entry carries authored CLAIMS (comment, ordering,
 * tour-relative requiredness) and nothing else; resolved FACTS (question
 * text, status, answeredness) are read live from the substrate at render
 * time, never snapshotted. This module produces exactly that split —
 * `TourEntryRaw` is the claim, `ResolvedTourEntry.resolution` is the fact,
 * fetched fresh via the same shared resolver (`mcp/reference.ts`) every
 * other consumer uses. Pure and vscode-free (fs only), so it's directly
 * testable.
 *
 * Deliberately NOT in scope for this module: `tour:<slug>` deep-link
 * grammar (ADR-0034 Decision point 4).
 *
 * RESOLVED 2026-08-16 (ADR-0034 Iteration 12): seed-anchor drilling, listed
 * here as an accepted out-of-scope gap since the first slice, turned out to be
 * the root cause of the founder's "honeypot of attention" report — it made
 * every seed QST unwalkable, and the workaround (relocating questions into
 * ADRs to obtain addressability) is what produced the hollow stops he saw.
 * `mcp/reference.ts` now resolves `seed:<slug>#qst-<handle>` to the question.
 * Noted here because this comment is the artifact that made the gap look
 * settled: an "explicitly deferred" label is not the same as a harmless one,
 * and nothing in the deferral recorded who would be hurt by it.
 */

import * as fs from 'fs'
import * as path from 'path'
import { resolveReference, containerPath, type ResolvedRef, type RefError } from '../mcp/reference'
import type { RepositoryContext } from '../mcp/repositoryContext'

export interface TourAuthor {
  name: string
  model?: string
  session?: string
  role?: string
}

export interface TourTheme {
  background?: string
  foreground?: string
}

export type TourDisposition = 'decide' | 'ratify' | 'acknowledge' | 'delegate'

export interface TourEntryRaw {
  ref: string
  must_respond?: boolean
  disposition?: TourDisposition
  answer_path?: string
  comment?: string
  /**
   * ADR-0046: a tour-scoped, author-facing claim that an OPTIONAL
   * (`must_respond: false`) stop has been deliberately dismissed for this
   * tour — distinct from "haven't looked at it yet" (absent/false) and
   * distinct from `disposition`, whose four values (`decide` / `ratify` /
   * `acknowledge` / `delegate`) all name the act the human is being ASKED
   * to perform (Docent 5's ruling, 2026-10-20): overloading `disposition`
   * with a value naming what the human DID would mix two registers in one
   * field and violate Mint's №79 ("a field's claim must be true at every
   * read"). Own field, own meaning. Never set on a `must_respond: true`
   * entry — a required stop is never passable, only answerable.
   */
  passed?: boolean
}

export interface TourFile {
  /** Absolute path to the .tour.json file. */
  path: string
  /** Filename without the .tour.json suffix — the tour's stable slug. */
  slug: string
  schema: string
  title: string
  author: TourAuthor
  minted_at: string
  minted_commit?: string
  retired: boolean
  theme?: TourTheme
  entries: TourEntryRaw[]
}

const TOUR_FILE_SUFFIX = '.tour.json'
const TOUR_SCHEMA = 'question-tour/1'

/**
 * Parse a `.tour.json` file's content. Tolerant by contract (never throws):
 * malformed JSON, a non-object root, an unrecognized schema string, or a
 * missing `entries` array all return `null` rather than a half-populated
 * object — a tour the reader can't trust structurally is not a tour the
 * reader should partially render.
 */
export function parseTourFile(filePath: string, content: string): TourFile | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  if (obj.schema !== TOUR_SCHEMA) return null
  if (!Array.isArray(obj.entries)) return null

  const slug = path.basename(filePath).replace(new RegExp(`\\${TOUR_FILE_SUFFIX}$`), '')
  const entries: TourEntryRaw[] = obj.entries
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && typeof e.ref === 'string')
    .map(e => ({
      ref: e.ref as string,
      // Read-tolerant for the pre-rename field (Facet's live-tour report,
      // 2026-07-28 inbox 0732): ADR-0034 Iteration 4 renamed `required` to
      // `must_respond` before any implementation existed, but at least one
      // real tour was minted under the old name and never migrated — its
      // entries were silently getting the ALWAYS-true default (the field
      // this code actually checked was always absent), which happened not
      // to explain that report's specific symptom but is a real, separate
      // divergence worth closing now that it's been spotted. `must_respond`
      // wins when both are present.
      must_respond: typeof e.must_respond === 'boolean'
        ? e.must_respond
        : (typeof e.required === 'boolean' ? e.required : undefined),
      disposition: typeof e.disposition === 'string' ? (e.disposition as TourDisposition) : undefined,
      answer_path: typeof e.answer_path === 'string' ? e.answer_path : undefined,
      comment: typeof e.comment === 'string' ? e.comment : undefined,
      passed: e.passed === true,
    }))

  const author = obj.author && typeof obj.author === 'object'
    ? (obj.author as Record<string, unknown>)
    : {}

  return {
    path: filePath,
    slug,
    schema: obj.schema,
    title: typeof obj.title === 'string' ? obj.title : slug,
    author: {
      name: typeof author.name === 'string' ? author.name : 'unknown',
      model: typeof author.model === 'string' ? author.model : undefined,
      session: typeof author.session === 'string' ? author.session : undefined,
      role: typeof author.role === 'string' ? author.role : undefined,
    },
    minted_at: typeof obj.minted_at === 'string' ? obj.minted_at : '',
    minted_commit: typeof obj.minted_commit === 'string' ? obj.minted_commit : undefined,
    retired: obj.retired === true,
    theme: obj.theme && typeof obj.theme === 'object' ? (obj.theme as TourTheme) : undefined,
    entries,
  }
}

/**
 * Discover every `.tour.json` in `<adrDirPath>/tours/` — a flat, non-
 * recursive scan (mirrors AdrIndex/SeedIndex's own `indexDirectory`
 * discipline). A file that fails to parse is skipped, not thrown — one
 * corrupt tour must never take down discovery for every other one.
 */
export function discoverTourFiles(adrDirPath: string): TourFile[] {
  const toursDir = path.join(adrDirPath, 'tours')
  if (!fs.existsSync(toursDir)) return []

  const names = fs.readdirSync(toursDir).filter(n => n.endsWith(TOUR_FILE_SUFFIX))
  const out: TourFile[] = []
  for (const name of names) {
    const filePath = path.join(toursDir, name)
    try {
      const parsed = parseTourFile(filePath, fs.readFileSync(filePath, 'utf-8'))
      if (parsed) out.push(parsed)
    } catch {
      // Unreadable file — skip, don't crash discovery for the rest.
    }
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug))
}

export interface ResolvedTourEntry {
  ref: string
  /** Tour-relative: "this walk's purpose needs your response here." Omitted in the source defaults to true — an entry is presumed to need a response unless explicitly marked otherwise. */
  mustRespond: boolean
  disposition?: TourDisposition
  answerPath?: string
  comment?: string
  /** ADR-0046: deliberately dismissed for this tour (optional stops only — see TourEntryRaw.passed). */
  passed: boolean
  resolution: ResolvedRef | RefError
}

/** Doctrine 1: facts are read live, every time — never cached alongside the claim. */
// Takes only what it reads — the entry list — rather than a whole parsed
// TourFile (widened 2026-10-02 for the mint gate). The gate must assess a tour
// that does not exist on disk yet, and `buildTourJson`'s serialization shape is
// a different type from the parser's. Narrowing the parameter to the one field
// this function actually touches lets both callers in without a cast, and makes
// the dependency honest: resolution needs entries, never a file.
export function resolveTourEntries(tour: Pick<TourFile, 'entries'>, ctx: RepositoryContext): ResolvedTourEntry[] {
  return tour.entries.map(e => ({
    ref: e.ref,
    mustRespond: e.must_respond !== false,
    disposition: e.disposition,
    answerPath: e.answer_path,
    comment: e.comment,
    passed: e.passed === true,
    resolution: resolveReference(ctx, e.ref),
  }))
}

/**
 * Doneness is derived from `must_respond` entries only (Commodore's ruling,
 * Iteration 5) — optional entries render as residue on a done tour, never
 * block it. A broken reference can't be confirmed answered, so it holds a
 * must_respond tour open until fixed. A tour with zero must_respond entries
 * is vacuously done.
 */
export function isTourDone(resolved: ResolvedTourEntry[]): boolean {
  const required = resolved.filter(e => e.mustRespond)
  if (required.length === 0) return true
  return required.every(e => e.resolution.kind === 'question' && e.resolution.question.isAnswered)
}

/**
 * ADR-0046: stricter than `isTourDone` — every entry, required OR optional,
 * must be settled: a required entry must be answered (same contract as
 * `isTourDone`); an optional entry must be EITHER answered OR explicitly
 * `passed`. Feeds `adrManager.tours.hideCompletedMode`'s `'optional-aware'`
 * state.
 */
export function isTourFullyResolved(resolved: ResolvedTourEntry[]): boolean {
  if (!isTourDone(resolved)) return false
  return resolved
    .filter(e => !e.mustRespond)
    .every(e => e.passed || (e.resolution.kind === 'question' && e.resolution.question.isAnswered))
}

// ---------------------------------------------------------------------------
// ADR-0035 Iteration 2 (Riddle's design, 2026-07-29 feedback seed, item C5):
// tour-unresolved-ref logging + the VS Code Problems surface. Both consumers
// (openQuestionsPanel.ts's ledger writer, extension.ts's diagnostics) need
// the same "which entries are broken, and why" and "which real files does
// this tour touch" facts — computed once here, pure, rather than each
// consumer re-deriving its own copy.
// ---------------------------------------------------------------------------

export interface TourUnresolvedRef {
  ref: string
  reason: string
}

/** Every entry that failed to resolve, with its human-readable reason — the richer sibling of buildTourMeta's brokenRefs (ref strings only, for the webview header). */
export function unresolvedTourRefs(resolved: ResolvedTourEntry[]): TourUnresolvedRef[] {
  return resolved
    .filter((e): e is ResolvedTourEntry & { resolution: RefError } => e.resolution.kind === 'error')
    .map(e => ({ ref: e.ref, reason: e.resolution.message }))
}

/** Absolute paths of every real ADR/seed file at least one entry actually resolved to — deduplicated, order of first appearance. The reconstruction context alongside the unresolved list: what DID resolve often explains why the one that didn't couldn't (e.g. every sibling entry in the same ADR resolves fine, isolating the break to one stale slug). */
export function referencedDocumentPaths(resolved: ResolvedTourEntry[]): string[] {
  const seen = new Set<string>()
  for (const e of resolved) {
    const r = e.resolution
    // A question's own document, whichever container it lives in (ADR-0034
    // iter-12): a seed-borne question contributes its SEED's path here, so the
    // error-ledger and Problems surfaces attribute it to the file a human would
    // actually open.
    if (r.kind === 'question') seen.add(containerPath(r.container))
    else if (r.kind === 'section' || r.kind === 'adr') seen.add(r.adr.path)
    else if (r.kind === 'seed') seen.add(r.seed.path)
  }
  return [...seen]
}

/**
 * A synthetic path whose dirname is the tour's own `docs/adr` (not
 * `docs/adr/tours`) — errorLog.ts's `errorLogPathFor` picks the owning
 * ledger by taking `path.dirname()` of whatever anchor it's given, and a
 * tour file's own path is one directory too deep for that to resolve
 * correctly on its own. Reliable because `discoverTourFiles` hardcodes the
 * `<adrDir>/tours/` layout — `tourPath`'s grandparent is always the real
 * ADR dir, tours-subdirectory notwithstanding. The returned path is never
 * read or written; it exists only to pick the right ledger file.
 */
export function tourLedgerAnchor(tourPath: string): string {
  return path.join(path.dirname(path.dirname(tourPath)), path.basename(tourPath))
}
