/**
 * MCP tool handlers — ADR-0021's tool contract, implemented against
 * RepositoryContext only. Zero `vscode` imports (ADR-0003 Decision, "handler
 * purity" requirement) — mechanically enforced by src/test/mcpPurity.test.ts.
 *
 * Tier 0 (`project_overview`) and Tier 1 reads (`lookup`, `get_outline`,
 * `get_sections`, `list_open_questions`) are implemented here (ADR-0021
 * sequencing step 3, the launch sprint's Track 1). The write tier and 3XR
 * format validation are the next steps on this track.
 */

import { createHash } from 'crypto'
import { UNRESOLVED_LEADING_TOKEN_RE } from '../parser/extractor'
import { computeSeedRollup } from '../index/seedIndex'
import type { RepositoryContext } from './repositoryContext'
import type { AdrFile, AdrSection, Question, SeedFile } from '../parser/types'
import {
  adrRefString,
  seedRefString,
  sectionAnchor,
  documentOrderedSections,
  findSectionForQuestion,
  resolveReference,
  resolveAdrByRef,
  type RefError,
} from './reference'
import { applyAnswerQuestion, applyAddRecommendation, applyAppendIteration, applyUpdateResolution } from './writeOps'
import { getCached, recordSuccess } from './dedupe'
import { withPathLock } from './pathLock'

function bracket(ref: string): string {
  return `[${ref}]`
}

/**
 * Elenchus feedback (Gadfly 5, 2026-07-27, legacy/adr:0007: six QSTs
 * declared `unanswered` under a full decision log; Hypomnema 5, 2026-08-02,
 * MEASURED across legacy/0021-0024: 22/22 real QSTs declared `unanswered`
 * already carried a substantive ANS block — "every label in this corpus is
 * wrong"): Status-authority (ADR-0031, ratified) is working exactly as
 * designed — declared status stays sovereign, ANS content is a draft until
 * the author flips it — but a reader has no way to tell "genuinely open" apart
 * from "labeled open, already answered, nobody flipped the switch" without
 * opening the file. This doesn't change isAnswered/Status-authority at all;
 * it just surfaces the disagreement Gadfly/Hypomnema both asked for.
 */
function isStatusAnswerInconsistent(question: Question): boolean {
  return !question.isAnswered && !!question.answer
}

/**
 * ADR-0041 item 1's "census integration": the axis-2 rollup needs each
 * derived ADR's own declared Status, looked up through the same
 * RepositoryContext an MCP caller already has — ctx.getAdr accepts a bare
 * number string ("41"), same as the zero-padded/`adr:` forms.
 */
function seedRollupLookup(ctx: RepositoryContext): (adrNumber: number) => string | undefined {
  return (n) => ctx.getAdr(String(n))?.status
}

export interface ProjectOverviewOptions {
  includeSeeds?: boolean
  tokenBudget?: number
  /** ISO timestamp of when the corpus was scanned. Caller-supplied (the
   * server process knows its own scan time; handlers.ts stays pure/no-Date). */
  scannedAt?: string
  /** Server/parser version — identical calls can differ across time not
   * because the corpus drifted but because the reader (parser) did; see
   * elenchus's 2026-07-23 feedback (68→65 delta traced to v0.7.27's
   * emphasis-robust status parsing, not corpus change). */
  serverVersion?: string
}

/**
 * Tier 0 — project_overview (ADR-0021).
 *
 * Pre-linearized project map: one row per ADR, one row per seed. Summary
 * line first, `optimized`-format grammar (bracketed refs, `--- label ---`
 * blocks, explicit-over-absent, self-teaching Usage footer).
 */
export function projectOverview(ctx: RepositoryContext, options: ProjectOverviewOptions = {}): string {
  const includeSeeds = options.includeSeeds ?? true
  const adrs = [...ctx.listAdrs()].sort((a, b) => a.number - b.number)
  const seeds = includeSeeds ? ctx.listSeeds() : []

  const adrsWithOpenQuestions = adrs.filter((adr) => adr.questions.some((q) => !q.isAnswered))
  const openQuestionTotal = adrs.reduce(
    (sum, adr) => sum + adr.questions.filter((q) => !q.isAnswered).length,
    0,
  )

  const lines: string[] = []
  lines.push(
    `${adrs.length} ADRs, ${seeds.length} seeds — ${openQuestionTotal} open questions across ${adrsWithOpenQuestions.length} ADRs`,
  )
  lines.push(`scanned_at: ${options.scannedAt ?? '[unset]'} | version: ${options.serverVersion ?? '[unset]'}`)

  lines.push('--- adrs ---')
  for (const adr of adrs) {
    const openCount = adr.questions.filter((q) => !q.isAnswered).length
    // `resolution` is not yet a parsed field on AdrFile — ADR-0009's Action
    // Item (owner: Hearth 4.6) adds it. Explicit-over-absent in the
    // meantime: always emit `[unset]`, never omit the field.
    // Namespace is printed only when set (multi-root workspaces) — omitted
    // for the common single-root case, where it's not a meaningful concept.
    // Elenchus 2026-07-24 (Eikon 5): the namespace string a caller needs for
    // `namespace.NNNN` refs is derived from git-remote/CLAUDE.md identity,
    // not the folder name docs tend to illustrate it with (e.g. "legacy") —
    // unguessable without this row surfacing the real value.
    const nsSuffix = adr.namespace ? ` | ns: ${adr.namespace}` : ''
    lines.push(
      `${bracket(adrRefString(adr))} ${adr.title} | ${adr.status} | resolution: [unset] | open: ${openCount} | iter: ${adr.iteration}${nsSuffix}`,
    )
  }

  if (includeSeeds) {
    lines.push('--- seeds ---')
    const rollupLookup = seedRollupLookup(ctx)
    for (const seed of seeds) {
      // ADR-0041's two-axis spine + item 7's vocabulary firewall: `status`
      // (axis-1, declared) and `rollup` (axis-2, derived) are printed as
      // distinct fields, never merged into one word — explicit-over-absent
      // per this file's own convention (`[unset]`/`n/a`, never omitted).
      const rollup = computeSeedRollup(seed.derivedAdrs, rollupLookup)
      lines.push(
        `${bracket(seedRefString(seed))} ${seed.date ?? '[unknown date]'} | ${seed.isProcessed ? 'processed' : 'unprocessed'} | status: ${seed.status ?? '[unset]'} | rollup: ${rollup ?? 'n/a'}`,
      )
    }
  }

  lines.push('Usage: call get_outline(adr_ref) for a section map of any ADR above.')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Tier 1 reads
// ---------------------------------------------------------------------------

function formatRefError(err: RefError): string {
  const lines = [`error: ${err.error}`, `message: ${err.message}`]
  if (err.candidates?.length) lines.push(`candidates: [${err.candidates.join(', ')}]`)
  if (err.hint) lines.push(`hint: ${err.hint}`)
  return lines.join('\n')
}

function formatQuestion(adr: AdrFile, question: Question): string {
  const lines: string[] = []
  lines.push(`${bracket(`${adrRefString(adr)}#${question.slug}`)} ${adr.title}`)
  lines.push(`text: ${question.text}`)
  lines.push(`status: ${question.isAnswered ? 'answered' : question.statusText}`)
  lines.push(`recommendation: ${question.recommendation ?? '[none]'}`)
  if (question.answer) {
    lines.push(`answer: ${question.answer.text.replace(/\n/g, '\\n')}`)
    lines.push(`answered_by: ${question.answer.author ?? '[unknown]'}`)
  } else {
    lines.push('answer: [none]')
  }
  return lines.join('\n')
}

function formatSection(adr: AdrFile, section: AdrSection): string {
  const lines: string[] = []
  lines.push(`${bracket(`${adrRefString(adr)}#${sectionAnchor(section)}`)} ${adr.title} — ${section.heading}`)
  lines.push(section.body.trim())
  return lines.join('\n')
}

/**
 * Elenchus feedback (Eikon 5, 2026-07-24): a bare `adr:NNNN` ref (no
 * `#slug`) degrading to this summary — never the document body — was
 * correct but silent; `get_sections`' own description reads as "batch-fetch
 * multiple refs," which primed a first-time caller to expect content. The
 * "no slug given" framing states the narrowing explicitly instead of making
 * a caller infer it from an empty-feeling result.
 */
function formatAdrSummary(adr: AdrFile): string {
  const openCount = adr.questions.filter((q) => !q.isAnswered).length
  const ref = adrRefString(adr)
  return [
    `${bracket(ref)} ${adr.title} | ${adr.status} | open: ${openCount} | iter: ${adr.iteration}`,
    `Usage: no slug given — showing summary only. Call get_outline("${ref}") for the section map, or lookup("${ref}#<slug>") for a specific part.`,
  ].join('\n')
}

function formatSeed(ctx: RepositoryContext, seed: SeedFile): string {
  const lines = [`${bracket(seedRefString(seed))} ${seed.title}`]
  lines.push(`date: ${seed.date ?? '[unknown]'}`)
  lines.push(`processed: ${seed.isProcessed ? 'yes' : 'no'}`)
  lines.push(`status: ${seed.status ?? '[unset]'}`)
  const rollup = computeSeedRollup(seed.derivedAdrs, seedRollupLookup(ctx))
  lines.push(`rollup: ${rollup ?? 'n/a'}`)
  lines.push(`brain_dump: ${seed.brainDump ? seed.brainDump.trim().replace(/\n/g, '\\n') : '[none]'}`)
  return lines.join('\n')
}

/**
 * `context_lines` simplification, named rather than hidden: true grep-style
 * "N raw source lines before/after" needs file I/O (`ctx.readFile`), which
 * would make every Tier-1 read async for one optional param. Until that's
 * wired, context is approximated from already-parsed data: the tail of the
 * previous section's body and the head of the next section's body, in
 * document order. Good enough for "what's around this" today; a fuller
 * raw-line version is future work, not a silent omission.
 */
function buildContextLines(adr: AdrFile, anchorSection: AdrSection | undefined, contextLines?: number): string[] {
  if (!contextLines || !anchorSection) return []
  const ordered = documentOrderedSections(adr)
  const idx = ordered.indexOf(anchorSection)
  if (idx === -1) return []
  const out: string[] = []
  if (idx > 0) {
    const tail = ordered[idx - 1].body.split('\n').slice(-contextLines).join('\n').trim()
    if (tail) out.push(`--- context before (${ordered[idx - 1].heading}) ---`, tail)
  }
  if (idx < ordered.length - 1) {
    const head = ordered[idx + 1].body.split('\n').slice(0, contextLines).join('\n').trim()
    if (head) out.push(`--- context after (${ordered[idx + 1].heading}) ---`, head)
  }
  return out
}

/** Tier 1 — lookup (ADR-0021). Resolves any ADR-0008 reference, plus two tool-local input tolerances. */
export function lookup(ctx: RepositoryContext, ref: string, contextLines?: number): string {
  const resolved = resolveReference(ctx, ref)
  if (resolved.kind === 'error') return formatRefError(resolved)

  switch (resolved.kind) {
    case 'question': {
      const section = findSectionForQuestion(resolved.adr, resolved.question)
      const body = [formatQuestion(resolved.adr, resolved.question)]
      body.push(...buildContextLines(resolved.adr, section, contextLines))
      return body.join('\n')
    }
    case 'section': {
      const body = [formatSection(resolved.adr, resolved.section)]
      body.push(...buildContextLines(resolved.adr, resolved.section, contextLines))
      return body.join('\n')
    }
    case 'adr':
      return formatAdrSummary(resolved.adr)
    case 'seed':
      return formatSeed(ctx, resolved.seed)
  }
}

/** Tier 1 — get_outline (ADR-0021). Flat section map with inline QST status. */
export function getOutline(ctx: RepositoryContext, adrRef: string): string {
  const resolved = resolveAdrByRef(ctx, adrRef)
  if (resolved.kind === 'error') return formatRefError(resolved)

  const adr = resolved.adr
  const lines: string[] = [`${bracket(adrRefString(adr))} ${adr.title} — ${adr.sections.length} top-level sections`]
  for (const section of documentOrderedSections(adr)) {
    const anchor = sectionAnchor(section)
    const words = section.body.trim() ? section.body.trim().split(/\s+/).length : 0
    let row = `${'  '.repeat(section.level - 2)}${anchor} | ${section.heading} | level ${section.level} | lines ${section.lineStart}-${section.lineEnd} | words ${words}`
    if (section.navCode === 'QST') {
      const question = adr.questions.find((q) => q.slug === section.slug)
      if (question) {
        row += ` | status: ${question.isAnswered ? 'answered' : question.statusText}`
        if (isStatusAnswerInconsistent(question)) row += ' | inconsistent: unanswered label but has a real answer'
      }
    }
    lines.push(row)
  }
  lines.push(`Usage: call get_sections(["${adrRefString(adr)}#<slug>", ...]) to fetch specific ids.`)
  return lines.join('\n')
}

/** Tier 1 — get_sections (ADR-0021). Batch fetch; refs may span multiple ADRs/seeds. */
export function getSections(ctx: RepositoryContext, refs: string[], tokenBudget?: number): string {
  const blocks = refs.map((ref) => {
    const resolved = resolveReference(ctx, ref)
    if (resolved.kind === 'error') return { ref, text: formatRefError(resolved) }
    switch (resolved.kind) {
      case 'question':
        return { ref, text: formatQuestion(resolved.adr, resolved.question) }
      case 'section':
        return { ref, text: formatSection(resolved.adr, resolved.section) }
      case 'adr':
        return { ref, text: formatAdrSummary(resolved.adr) }
      case 'seed':
        return { ref, text: formatSeed(ctx, resolved.seed) }
    }
  })

  if (!tokenBudget) {
    return blocks.map((b) => `--- ${b.ref} ---\n${b.text}`).join('\n')
  }

  // Never truncate mid-node: drop whole refs from the end until under budget.
  // Token estimate is a character-count approximation (chars/4) — no
  // tokenizer dependency added for this; documented, not silent.
  const estimateTokens = (s: string) => Math.ceil(s.length / 4)
  const kept: typeof blocks = []
  const dropped: string[] = []
  let used = 0
  for (const block of blocks) {
    const cost = estimateTokens(block.text) + 5
    if (used + cost > tokenBudget) {
      dropped.push(block.ref)
      continue
    }
    kept.push(block)
    used += cost
  }

  const lines = kept.map((b) => `--- ${b.ref} ---\n${b.text}`)
  if (dropped.length > 0) {
    lines.push(
      `Usage: result truncated at token_budget=${tokenBudget}; dropped [${dropped.join(', ')}] — re-request at a larger budget or individually.`,
    )
  }
  return lines.join('\n')
}

export interface ListOpenQuestionsOptions {
  adrRef?: string
  priority?: 1 | 2 | 3 | 4
  status?: string
  /**
   * ADR-0036 ("Unresolved: Returning the Ball"): `court: 'model'` scopes to
   * `unresolved` questions — open, human has contributed, the model's move
   * next. This is the model's own docket, distinct from the full open-list
   * (which already includes unresolved/deferred/unanswered together, per
   * the hide-allowlist doctrine — nothing hides by default). Matches via
   * the shared `UNRESOLVED_LEADING_TOKEN_RE`, never a private re-derivation.
   */
  court?: 'model'
  /**
   * Elenchus feedback (Gadfly 5, 2026-07-23, "Catch 2" — sprint triage
   * wanted exactly "open questions in the trees I'm porting" vs.
   * cross-cutting): scope to one root's namespace, matching the
   * `namespace.NNNN` reference grammar that already exists for refs.
   */
  namespace?: string
  limit?: number
  tokenBudget?: number
}

/** Tier 1 — list_open_questions (ADR-0021). Reads parsed Question.isAnswered/statusText, never regexes the raw file. */
export function listOpenQuestions(ctx: RepositoryContext, options: ListOpenQuestionsOptions = {}): string {
  let adrs = [...ctx.listAdrs()].sort((a, b) => a.number - b.number)
  if (options.adrRef) {
    const resolved = resolveAdrByRef(ctx, options.adrRef)
    if (resolved.kind === 'error') return formatRefError(resolved)
    adrs = [resolved.adr]
  }
  if (options.namespace !== undefined) {
    adrs = adrs.filter((a) => a.namespace === options.namespace)
  }

  type Row = { adr: AdrFile; question: Question }
  let rows: Row[] = []
  for (const adr of adrs) {
    for (const question of adr.questions) {
      if (question.isAnswered) continue
      if (options.priority !== undefined && question.priority !== options.priority) continue
      if (options.status !== undefined && question.statusText !== options.status) continue
      if (options.court === 'model' && !UNRESOLVED_LEADING_TOKEN_RE.test(question.statusText.trim())) continue
      rows.push({ adr, question })
    }
  }

  const adrsWithOpen = new Set(rows.map((r) => r.adr.number)).size
  const total = rows.length
  const inconsistentCount = rows.filter((r) => isStatusAnswerInconsistent(r.question)).length
  if (options.limit !== undefined) rows = rows.slice(0, options.limit)

  const courtSuffix = options.court === 'model' ? ' (court: model)' : ''
  const namespaceSuffix = options.namespace !== undefined ? ` (namespace: ${options.namespace})` : ''
  const inconsistentSuffix = inconsistentCount > 0 ? ` (${inconsistentCount} inconsistent: unanswered label, real answer present)` : ''
  const lines = [`${total} open across ${adrsWithOpen} ADRs${options.limit !== undefined ? ` (limit: ${options.limit})` : ''}${courtSuffix}${namespaceSuffix}${inconsistentSuffix}`]
  for (const { adr, question } of rows) {
    const inconsistentTag = isStatusAnswerInconsistent(question) ? ' | inconsistent: unanswered label but has a real answer' : ''
    lines.push(
      `${bracket(`${adrRefString(adr)}#${question.slug}`)} ${question.text} — status: ${question.statusText} | priority: ${question.priority ?? '[none]'}${inconsistentTag}`,
    )
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Write tier
// ---------------------------------------------------------------------------

/**
 * Write-conflict contract (ADR-0021 conventions): `base_checksum` is
 * optional — anchored writes (id-addressed, never offset-addressed) are safe
 * without it. When provided and stale, returns a structured conflict instead
 * of overwriting.
 */
function checkConflict(currentContent: string, baseChecksum: string | undefined): string | undefined {
  if (!baseChecksum) return undefined
  const currentChecksum = createHash('sha1').update(currentContent).digest('hex')
  if (currentChecksum === baseChecksum) return undefined
  return [
    'status: conflict',
    `current_checksum: ${currentChecksum}`,
    'hint: file changed since base_checksum was read',
    'options: refresh | branch-anyway | cancel',
  ].join('\n')
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface AnswerQuestionOptions {
  author?: string
  baseChecksum?: string
  clientMsgId?: string
  attempt?: number
}

/**
 * answer_question — replace semantics; anchored write, safe with no prior
 * read. The dedup check and the whole read→mutate→write sequence run inside
 * a per-path lock (Quarry 5's CATCH 7/8 fix, 2026-07-09): without it, two
 * concurrent calls on the same file both read the same pre-write snapshot
 * and whichever writes last silently discards the other's answer; and two
 * concurrent calls sharing a `client_msg_id` both pass the cache-miss check
 * before either records success, defeating the dedup contract. Serializing
 * per path closes both — the second call in any race now sees the first
 * call's completed result before it starts.
 */
export async function answerQuestion(
  ctx: RepositoryContext,
  adrRef: string,
  questionId: string,
  answerText: string,
  options: AnswerQuestionOptions = {},
): Promise<string> {
  if (!options.author?.trim()) {
    return 'error: missing_author\nmessage: answer_question requires an explicit author (a specific model slug, never "AI") — no default is configured.'
  }

  const resolved = resolveAdrByRef(ctx, adrRef)
  if (resolved.kind === 'error') return formatRefError(resolved)

  return withPathLock(resolved.adr.path, async () => {
    const cached = getCached('answer_question', options.clientMsgId)
    if (cached !== undefined) return cached

    const currentContent = await ctx.readFile(resolved.adr.path)
    const conflict = checkConflict(currentContent, options.baseChecksum)
    if (conflict) return conflict

    const result = applyAnswerQuestion(currentContent, resolved.adr.path, questionId, answerText, options.author!.trim())
    if (!result.ok) return `error: write_failed\nmessage: ${result.error}`

    await ctx.writeFile(resolved.adr.path, result.newContent)
    const confirmation = `Answered ${questionId} in ${adrRefString(resolved.adr)}\n${result.diff}`
    recordSuccess('answer_question', options.clientMsgId, confirmation)
    return confirmation
  })
}

export interface AddRecommendationOptions {
  clientMsgId?: string
  attempt?: number
}

/** add_recommendation — append semantics; recommendations stack, ANS stays singular. Per-path locked, same reasoning as answer_question. */
export async function addRecommendation(
  ctx: RepositoryContext,
  adrRef: string,
  questionId: string,
  author: string,
  text: string,
  options: AddRecommendationOptions = {},
): Promise<string> {
  if (!author?.trim()) {
    return 'error: missing_author\nmessage: add_recommendation requires an explicit author (a specific model slug, never "AI").'
  }

  const resolved = resolveAdrByRef(ctx, adrRef)
  if (resolved.kind === 'error') return formatRefError(resolved)

  return withPathLock(resolved.adr.path, async () => {
    const cached = getCached('add_recommendation', options.clientMsgId)
    if (cached !== undefined) return cached

    const currentContent = await ctx.readFile(resolved.adr.path)
    const result = applyAddRecommendation(currentContent, resolved.adr.path, questionId, author.trim(), text, todayIsoDate())
    if (!result.ok) return `error: write_failed\nmessage: ${result.error}`

    await ctx.writeFile(resolved.adr.path, result.newContent)
    const confirmation = `Added recommendation (by ${author.trim()}) to ${questionId} in ${adrRefString(resolved.adr)}\n${result.diff}`
    recordSuccess('add_recommendation', options.clientMsgId, confirmation)
    return confirmation
  })
}

export interface AppendIterationEntry {
  human?: string
  ai?: string
  outcome?: string
  date?: string
  clientMsgId?: string
  attempt?: number
}

/**
 * append_iteration — computes the next number server-side (MAX+1 over the
 * actual log, not the header field). Per-path locked: without it, two
 * concurrent calls both compute MAX+1 from the same pre-write snapshot and
 * the second write silently discards the first's entire entry (not merely a
 * duplicate number) — the exact class of race append_iteration was already
 * meant to close by moving the computation server-side (CATCH 9).
 */
export async function appendIteration(ctx: RepositoryContext, adrRef: string, entry: AppendIterationEntry = {}): Promise<string> {
  const resolved = resolveAdrByRef(ctx, adrRef)
  if (resolved.kind === 'error') return formatRefError(resolved)

  return withPathLock(resolved.adr.path, async () => {
    const cached = getCached('append_iteration', entry.clientMsgId)
    if (cached !== undefined) return cached

    const currentContent = await ctx.readFile(resolved.adr.path)
    const result = applyAppendIteration(currentContent, resolved.adr.path, {
      human: entry.human,
      ai: entry.ai,
      outcome: entry.outcome,
      date: entry.date ?? todayIsoDate(),
    })
    if (!result.ok) return `error: write_failed\nmessage: ${result.error}`

    await ctx.writeFile(resolved.adr.path, result.newContent)
    const confirmation = `Appended Iteration ${result.iterationNumber} to ${adrRefString(resolved.adr)}\n${result.diff}`
    recordSuccess('append_iteration', entry.clientMsgId, confirmation)
    return confirmation
  })
}

export interface UpdateResolutionOptions {
  clientMsgId?: string
  attempt?: number
}

/** update_resolution — per ADR-0009; note is required (and server-validated) for fiat/contested. Per-path locked, same reasoning as the other write tools. */
export async function updateResolution(
  ctx: RepositoryContext,
  adrRef: string,
  resolution: string,
  note?: string,
  options: UpdateResolutionOptions = {},
): Promise<string> {
  const resolved = resolveAdrByRef(ctx, adrRef)
  if (resolved.kind === 'error') return formatRefError(resolved)

  return withPathLock(resolved.adr.path, async () => {
    const cached = getCached('update_resolution', options.clientMsgId)
    if (cached !== undefined) return cached

    const currentContent = await ctx.readFile(resolved.adr.path)
    const result = applyUpdateResolution(currentContent, resolved.adr.path, resolution, note)
    if (!result.ok) return result.error

    await ctx.writeFile(resolved.adr.path, result.newContent)
    const confirmation = `Updated resolution for ${adrRefString(resolved.adr)} to '${resolution}'\n${result.diff}`
    recordSuccess('update_resolution', options.clientMsgId, confirmation)
    return confirmation
  })
}
