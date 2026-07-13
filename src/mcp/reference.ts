/**
 * Reference resolution — the shared core `lookup`, `get_sections`, and
 * `get_outline` all build on (ADR-0021 Tier 1). Built on `../deeplink/protocol`
 * (Codex GPT-5's ADR-0008 grammar parser, adopted 2026-07-06) plus two
 * tool-local input tolerances not yet part of ADR-0008's committed grammar
 * (bare `Question.id`, bare ADR number) — pending fold-in, per Touchstone
 * 4.7's coherence cross-read Note 1.
 *
 * Anchor-resolution precedence (Cairn 4.7's 2026-07-06 catch, proposed for
 * ADR-0008's Decision section): a section's effective anchor is its
 * `<!-- @adr-anchor: --> ` override when present, the heading-derived slug
 * otherwise. Applied once here rather than restated per caller.
 */

import type { AdrFile, AdrSection, Question, SeedFile } from '../parser/types'
import type { RepositoryContext } from './repositoryContext'
import { parseDeepLinkRef } from '../deeplink/protocol'

export interface ResolvedQuestion {
  kind: 'question'
  adr: AdrFile
  question: Question
}

export interface ResolvedSection {
  kind: 'section'
  adr: AdrFile
  section: AdrSection
}

export interface ResolvedAdr {
  kind: 'adr'
  adr: AdrFile
}

export interface ResolvedSeed {
  kind: 'seed'
  seed: SeedFile
}

export type ResolvedRef = ResolvedQuestion | ResolvedSection | ResolvedAdr | ResolvedSeed

export type RefErrorCode = 'ambiguous' | 'not_found' | 'unsupported_reference' | 'unrecognized_reference'

export interface RefError {
  kind: 'error'
  error: RefErrorCode
  message: string
  candidates?: string[]
  hint?: string
}

export function adrRefString(adr: AdrFile): string {
  return `adr:${String(adr.number).padStart(4, '0')}`
}

export function seedRefString(seed: SeedFile): string {
  const filename = seed.path.split('/').pop() ?? seed.title
  return `seed:${filename.replace(/\.md$/, '')}`
}

/** Anchor-resolution precedence: override wins, slug is the fallback. */
export function sectionAnchor(section: AdrSection): string {
  return section.anchorOverride ?? section.slug
}

function flattenSections(sections: AdrSection[]): AdrSection[] {
  const out: AdrSection[] = []
  for (const s of sections) {
    out.push(s)
    if (s.children?.length) out.push(...flattenSections(s.children))
  }
  return out
}

/** All sections (any depth) in document reading order — used for outlines and neighbor-context lookups. */
export function documentOrderedSections(adr: AdrFile): AdrSection[] {
  return flattenSections(adr.sections)
    .slice()
    .sort((a, b) => a.lineStart - b.lineStart)
}

/** The AdrSection a Question corresponds to (every `### QST:` heading is also a section). */
export function findSectionForQuestion(adr: AdrFile, question: Question): AdrSection | undefined {
  return flattenSections(adr.sections).find((s) => s.navCode === 'QST' && s.slug === question.slug)
}

function resolveAnchorInAdr(adr: AdrFile, anchor: string): ResolvedSection | ResolvedQuestion | RefError {
  const allSections = flattenSections(adr.sections)

  // Exact match on a Question's own slug (always heading-derived — the
  // override lives on the AdrSection, never on the Question object).
  const questionByOwnSlug = adr.questions.find((q) => q.slug === anchor)

  // Exact match on a section's *effective* anchor (override-first
  // precedence, per Cairn's catch). If that section is itself a QST node,
  // the override names the *question*, not a separate section — e.g. a QST
  // heading with `<!-- @adr-anchor: stable-name -->` should resolve to the
  // question when looked up by "stable-name", not fall through to generic
  // section text missing status/answer/recommendation.
  //
  // Filter, not find (Cairn's RFC-Q1 edge case, 2026-07-13): two sections
  // can share the same effective anchor — a copy-pasted `@adr-anchor`
  // override, or an override that happens to collide with another
  // section's heading-derived slug. `.find()` would silently pick the
  // first and never surface the collision; that's exactly the silent
  // default-picking this module exists to avoid everywhere else.
  const exactSectionMatches = allSections.filter((s) => sectionAnchor(s) === anchor)
  if (exactSectionMatches.length > 1) {
    return {
      kind: 'error',
      error: 'ambiguous',
      message: `"${anchor}" is the effective anchor of ${exactSectionMatches.length} sections in ${adrRefString(adr)} — duplicate @adr-anchor override or an override colliding with another heading's slug`,
      candidates: exactSectionMatches.map((s) => `${adrRefString(adr)}#${sectionAnchor(s)} (${s.heading})`),
      hint: 'fix the duplicate @adr-anchor comment, or specify by line number',
    }
  }
  const sectionMatch = exactSectionMatches[0]
  const questionViaOverride =
    sectionMatch?.navCode === 'QST' ? adr.questions.find((q) => q.slug === sectionMatch.slug) : undefined

  if (questionByOwnSlug && sectionMatch && sectionMatch.slug !== questionByOwnSlug.slug) {
    // Two genuinely different nodes both claim this exact anchor string.
    return {
      kind: 'error',
      error: 'ambiguous',
      message: `"${anchor}" matched both a section and an unrelated question in ${adrRefString(adr)}`,
      candidates: [`${adrRefString(adr)}#${sectionAnchor(sectionMatch)} (section)`, `${adrRefString(adr)}#${questionByOwnSlug.slug} (question)`],
      hint: 'specify the full slug',
    }
  }

  const question = questionByOwnSlug ?? questionViaOverride
  if (question) return { kind: 'question', adr, question }
  if (sectionMatch) return { kind: 'section', adr, section: sectionMatch }

  // No exact match — fall back to case-insensitive substring matching.
  // Normalize as we go: a QST section matched via its override represents
  // the same node as its question, and must collapse to one candidate
  // rather than count as "ambiguous" against itself.
  const needle = anchor.toLowerCase()
  type Candidate = { kind: 'question'; question: Question } | { kind: 'section'; section: AdrSection }
  const candidates: Candidate[] = []
  const seenQuestionSlugs = new Set<string>()

  for (const s of allSections.filter((s) => sectionAnchor(s).toLowerCase().includes(needle))) {
    const linkedQuestion = s.navCode === 'QST' ? adr.questions.find((q) => q.slug === s.slug) : undefined
    if (linkedQuestion) {
      if (!seenQuestionSlugs.has(linkedQuestion.slug)) {
        candidates.push({ kind: 'question', question: linkedQuestion })
        seenQuestionSlugs.add(linkedQuestion.slug)
      }
    } else {
      candidates.push({ kind: 'section', section: s })
    }
  }
  for (const q of adr.questions.filter((q) => q.slug.toLowerCase().includes(needle))) {
    if (!seenQuestionSlugs.has(q.slug)) {
      candidates.push({ kind: 'question', question: q })
      seenQuestionSlugs.add(q.slug)
    }
  }

  if (candidates.length === 0) {
    return { kind: 'error', error: 'not_found', message: `No section or question anchor matching "${anchor}" in ${adrRefString(adr)}` }
  }
  if (candidates.length === 1) {
    const only = candidates[0]
    return only.kind === 'question' ? { kind: 'question', adr, question: only.question } : { kind: 'section', adr, section: only.section }
  }
  return {
    kind: 'error',
    error: 'ambiguous',
    message: `"${anchor}" matched ${candidates.length} anchors in ${adrRefString(adr)}`,
    candidates: candidates.map((c) =>
      c.kind === 'question' ? `${adrRefString(adr)}#${c.question.slug}` : `${adrRefString(adr)}#${sectionAnchor(c.section)}`,
    ),
    hint: 'specify the full slug',
  }
}

/** Resolve just the ADR part of a reference — used by tools whose signature takes a plain `adr_ref`. */
export function resolveAdrByRef(ctx: RepositoryContext, rawRef: string): ResolvedAdr | RefError {
  const ref = rawRef.trim().split('#')[0]
  const bareNumber = /^\d+$/.test(ref) ? ref : ref.match(/^adr:(\d+)$/)?.[1]
  if (!bareNumber) {
    return { kind: 'error', error: 'unrecognized_reference', message: `"${rawRef}" is not a recognized ADR reference` }
  }
  const adr = ctx.getAdr(`adr:${bareNumber}`)
  if (!adr) {
    return { kind: 'error', error: 'not_found', message: `No ADR numbered ${bareNumber}` }
  }
  return { kind: 'adr', adr }
}

/**
 * Resolve any reference in ADR-0008's grammar, plus the two tool-local
 * input tolerances (bare `Question.id`, bare ADR number). See ADR-0021's
 * `lookup()` spec for the full behavior contract.
 */
export function resolveReference(ctx: RepositoryContext, rawRef: string): ResolvedRef | RefError {
  const ref = rawRef.trim()

  // Tolerance 1: bare Question.id, e.g. "adr-0001-qst-scope".
  if (/^adr-\d{4}-/.test(ref)) {
    for (const adr of ctx.listAdrs()) {
      const question = adr.questions.find((q) => q.id === ref)
      if (question) return { kind: 'question', adr, question }
    }
    return { kind: 'error', error: 'not_found', message: `No question with id "${ref}" found in any ADR` }
  }

  // Tolerance 2: bare ADR number, e.g. "21".
  if (/^\d+$/.test(ref)) {
    return resolveReference(ctx, `adr:${ref}`)
  }

  const parsed = parseDeepLinkRef(ref)
  if (!parsed) {
    return { kind: 'error', error: 'unrecognized_reference', message: `"${ref}" does not match any known reference grammar (ADR-0008)` }
  }

  if (parsed.format === 'xproject-alias') {
    return {
      kind: 'error',
      error: 'unsupported_reference',
      message: 'cross-project reference resolution requires .vscode/namespace_registry.json — not present',
      hint: 'local, seed, and canonical-project-URI references all work today',
    }
  }

  if (parsed.artifact === 'seed') {
    if (!parsed.seedSlug) {
      return { kind: 'error', error: 'unrecognized_reference', message: `"${ref}" is a seed reference with no slug` }
    }
    const seed = ctx.getSeed(`seed:${parsed.seedSlug}`)
    if (!seed) {
      return { kind: 'error', error: 'not_found', message: `No seed matching "${parsed.seedSlug}"` }
    }
    // Seed anchor drilling (e.g. #brain-dump into a specific thread entry) is
    // out of scope for this pass — whole-seed resolution only.
    return { kind: 'seed', seed }
  }

  if (typeof parsed.number !== 'number') {
    return { kind: 'error', error: 'unrecognized_reference', message: `"${ref}" has no resolvable ADR number` }
  }
  const adr = ctx.getAdr(`adr:${parsed.number}`)
  if (!adr) {
    return { kind: 'error', error: 'not_found', message: `No ADR numbered ${parsed.number}` }
  }
  if (!parsed.anchor) {
    return { kind: 'adr', adr }
  }
  return resolveAnchorInAdr(adr, parsed.anchor)
}
