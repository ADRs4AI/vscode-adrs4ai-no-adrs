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

/**
 * The document a question lives in. A question has exactly ONE container —
 * modelled as a discriminated union rather than two optional fields so the
 * both-set and neither-set states are unrepresentable.
 *
 * ADR-0034 Iteration 12: doctrine 4 ("homogeneous over both containers...
 * stated explicitly because omission is the easy failure") was implemented
 * everywhere except here. `ResolvedQuestion` carried a required `adr`, so a
 * seed question could not be expressed at all, so the resolver returned the
 * whole seed, so every consumer keying on `kind === 'question'` silently
 * dropped it. Widening this type is the repair; the compiler then forces each
 * consumer to say what it does with a seed-borne question, which is exactly
 * the discovery a `kind: 'seed-question'` variant would NOT have forced.
 */
export type QuestionContainer =
  | { kind: 'adr'; adr: AdrFile }
  | { kind: 'seed'; seed: SeedFile }

export interface ResolvedQuestion {
  kind: 'question'
  container: QuestionContainer
  question: Question
}

/** The on-disk path of whichever document a resolved question lives in. */
export function containerPath(container: QuestionContainer): string {
  return container.kind === 'adr' ? container.adr.path : container.seed.path
}

/** The ADR a question lives in, or undefined when it is seed-borne. For call sites that are genuinely ADR-only. */
export function containerAdr(container: QuestionContainer): AdrFile | undefined {
  return container.kind === 'adr' ? container.adr : undefined
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

/**
 * The canonical `seed:<slug>` reference for a seed — slug WITHOUT the `seed-`
 * filename prefix, matching the form every real tour and deep link uses.
 *
 * Fixed 2026-08-16 (found while repairing seed-question addressability): this
 * emitted the whole basename, so it produced `seed:seed-2026-…`, which
 * `RepositoryContext.getSeed` — matching on `seed-${slug}` — could not resolve.
 * Every seed reference the MCP ever printed back to a model (`project_overview`
 * rows, `lookup` headers) was therefore a reference that failed if the model
 * used it. Round-trip is now covered by a regression test; `getSeed` also
 * accepts the old form so refs already written down keep working.
 */
export function seedRefString(seed: SeedFile): string {
  const filename = seed.path.split('/').pop() ?? seed.title
  return `seed:${filename.replace(/\.md$/, '').replace(/^seed-/, '')}`
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
  if (question) return { kind: 'question', container: { kind: 'adr', adr }, question }
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
    return only.kind === 'question' ? { kind: 'question', container: { kind: 'adr', adr }, question: only.question } : { kind: 'section', adr, section: only.section }
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

function isRefError(x: AdrFile | RefError): x is RefError {
  return (x as RefError).kind === 'error'
}

/**
 * Resolve a bare ADR number against every root in the live index — never
 * `ctx.getAdr`'s first-match semantics directly, because with a genuine
 * multi-root composite (CompositeIndex.fromWorkspace, 2026-07-14) two roots
 * can share a number (elenchus's four ADR trees even have *internal*
 * duplicates within one root — 0016 and 0041 each appear twice in
 * `legacy/docs/adr`). Silently picking the first match here would be
 * exactly the class of bug this module exists to refuse everywhere else.
 */
function resolveAdrByNumber(ctx: RepositoryContext, num: number): AdrFile | RefError {
  const matches = ctx.listAdrs().filter((a) => a.number === num)
  const padded = String(num).padStart(4, '0')
  if (matches.length === 0) {
    return { kind: 'error', error: 'not_found', message: `No ADR numbered ${padded}` }
  }
  if (matches.length === 1) return matches[0]
  // Namespace alone doesn't always disambiguate: a duplicate can live
  // *within* one root too (elenchus's legacy/ tree has two files both
  // numbered 0016), in which case every match shares the same namespace.
  // Always include the filename, which is unique per match regardless of
  // whether the namespace collision is cross-root or same-root — found by
  // testing against elenchus's real corpus, not the (cross-root-only)
  // synthetic unit test this shipped with initially.
  const sameNamespace = new Set(matches.map((a) => a.namespace)).size === 1
  return {
    kind: 'error',
    error: 'ambiguous',
    message: sameNamespace
      ? `ADR ${padded} appears ${matches.length} times within the same namespace/root ("${matches[0].namespace ?? '[no namespace]'}") — likely a real duplicate-numbering problem in that project, not something a namespace qualifier can disambiguate`
      : `ADR ${padded} exists in ${matches.length} roots/namespaces — specify a namespace-qualified reference`,
    candidates: matches.map((a) => `${a.namespace ?? '[no namespace]'}.${padded} (${a.path.split('/').pop()})`),
    hint: sameNamespace ? 'fix the duplicate ADR number at the source, or reference by exact file path' : `use "<namespace>.${padded}" to disambiguate`,
  }
}

/** Resolve just the ADR part of a reference — used by tools whose signature takes a plain `adr_ref`. */
export function resolveAdrByRef(ctx: RepositoryContext, rawRef: string): ResolvedAdr | RefError {
  const ref = rawRef.trim().split('#')[0]
  const qualified = ref.match(/^([a-z0-9-]+)\.(\d+)$/)
  if (qualified) {
    const [, namespace, numStr] = qualified
    const num = parseInt(numStr, 10)
    const match = ctx.listAdrs().find((a) => a.namespace === namespace && a.number === num)
    if (!match) {
      const known = Array.from(new Set(ctx.listAdrs().map((a) => a.namespace).filter(Boolean)))
      return { kind: 'error', error: 'not_found', message: `No ADR ${numStr} in namespace "${namespace}"`, hint: known.length ? `known namespaces: ${known.join(', ')}` : undefined }
    }
    return { kind: 'adr', adr: match }
  }

  const bareNumber = /^\d+$/.test(ref) ? ref : ref.match(/^adr:(\d+)$/)?.[1]
  if (!bareNumber) {
    return { kind: 'error', error: 'unrecognized_reference', message: `"${rawRef}" is not a recognized ADR reference` }
  }
  const result = resolveAdrByNumber(ctx, parseInt(bareNumber, 10))
  return isRefError(result) ? result : { kind: 'adr', adr: result }
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
      if (question) return { kind: 'question', container: { kind: 'adr', adr }, question }
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
    // Resolved against live namespace data (2026-07-14), not a hypothetical
    // registry file: every AdrFile in a real multi-root composite already
    // carries its own `namespace` (set at parse time from the root that
    // contains it — CompositeIndex's buildNode). The original rejection
    // ("no registry mechanism exists yet") no longer holds the moment a
    // genuine multi-root index is in play; for a single-root context this
    // just resolves against that one namespace or reports not-found.
    if (typeof parsed.number !== 'number' || !parsed.namespace) {
      return { kind: 'error', error: 'unrecognized_reference', message: `"${ref}" is not a well-formed cross-project alias` }
    }
    const match = ctx.listAdrs().find((a) => a.namespace === parsed.namespace && a.number === parsed.number)
    if (!match) {
      const known = Array.from(new Set(ctx.listAdrs().map((a) => a.namespace).filter(Boolean)))
      return {
        kind: 'error',
        error: 'not_found',
        message: `No ADR ${parsed.number} in namespace "${parsed.namespace}"`,
        hint: known.length ? `known namespaces: ${known.join(', ')}` : 'no namespaces present in the current index',
      }
    }
    return parsed.anchor ? resolveAnchorInAdr(match, parsed.anchor) : { kind: 'adr', adr: match }
  }

  if (parsed.artifact === 'seed') {
    if (!parsed.seedSlug) {
      return { kind: 'error', error: 'unrecognized_reference', message: `"${ref}" is a seed reference with no slug` }
    }
    const seed = ctx.getSeed(`seed:${parsed.seedSlug}`)
    if (!seed) {
      return { kind: 'error', error: 'not_found', message: `No seed matching "${parsed.seedSlug}"` }
    }
    // ADR-0034 Iteration 12 — the repair. This branch used to return the whole
    // seed unconditionally with the comment "seed anchor drilling is out of
    // scope for this pass," which made doctrine 4 a dead letter and every seed
    // QST in the ecosystem unaddressable by tours, deep links, and MCP lookup
    // alike. Jérémie's ruling, 2026-08-16: "All QSTs should be citable
    // obviously."
    //
    // Question anchors resolve; other seed anchors (e.g. #brain-dump into a
    // thread entry) still fall through to the whole seed, which is honest —
    // SeedFile carries `questions` but not `sections`, so a question is the
    // only sub-node the model can currently name.
    if (parsed.anchor) {
      const question = seed.questions.find((q) => q.slug === parsed.anchor)
      if (question) return { kind: 'question', container: { kind: 'seed', seed }, question }
      // A named-but-unmatched anchor is an ERROR, never a silent widening to
      // the whole seed: doctrine 3 promises a visible broken-reference row,
      // and "resolved to something bigger than you asked for" is precisely the
      // silent-drop class this iteration exists to abolish.
      if (/^qst-/i.test(parsed.anchor)) {
        return {
          kind: 'error',
          error: 'not_found',
          message: `No question "${parsed.anchor}" in ${seedRefString(seed)}`,
          candidates: seed.questions.map((q) => `${seedRefString(seed)}#${q.slug}`),
          hint: seed.questions.length
            ? 'seed question anchors match the heading-derived slug; `@adr-anchor` overrides are not yet honoured on seeds'
            : 'this seed has no parseable QST blocks',
        }
      }
    }
    return { kind: 'seed', seed }
  }

  if (typeof parsed.number !== 'number') {
    return { kind: 'error', error: 'unrecognized_reference', message: `"${ref}" has no resolvable ADR number` }
  }
  const result = resolveAdrByNumber(ctx, parsed.number)
  if (isRefError(result)) return result
  if (!parsed.anchor) {
    return { kind: 'adr', adr: result }
  }
  return resolveAnchorInAdr(result, parsed.anchor)
}
