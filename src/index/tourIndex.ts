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
 * grammar (ADR-0034 Decision point 4) and seed-anchor drilling in the
 * shared resolver (a pre-existing gap in mcp/reference.ts, not introduced
 * here) — both out of scope for the first slice, per the reference-
 * implementation register's own "explicit v2, not drifted into" discipline.
 */

import * as fs from 'fs'
import * as path from 'path'
import { resolveReference, type ResolvedRef, type RefError } from '../mcp/reference'
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
      must_respond: typeof e.must_respond === 'boolean' ? e.must_respond : undefined,
      disposition: typeof e.disposition === 'string' ? (e.disposition as TourDisposition) : undefined,
      answer_path: typeof e.answer_path === 'string' ? e.answer_path : undefined,
      comment: typeof e.comment === 'string' ? e.comment : undefined,
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
  resolution: ResolvedRef | RefError
}

/** Doctrine 1: facts are read live, every time — never cached alongside the claim. */
export function resolveTourEntries(tour: TourFile, ctx: RepositoryContext): ResolvedTourEntry[] {
  return tour.entries.map(e => ({
    ref: e.ref,
    mustRespond: e.must_respond !== false,
    disposition: e.disposition,
    answerPath: e.answer_path,
    comment: e.comment,
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
