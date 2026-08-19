/**
 * Tour readiness assessment — the shared predicate behind `tour-walk`, and the
 * intended engine for the mint-time gate (ADR-0034 iter-11 item 3) and its MCP
 * surface (ADR-0037). Lives in `src/` rather than in the script so the three
 * consumers cannot drift into three different definitions of "ready."
 *
 * The doctrine this encodes (ADR-0034 iter-12): there are two kinds of unready,
 * and only one is mechanically decidable.
 *
 *   structurally broken -> a machine sees it        (tour-lint, and `dropped` below)
 *   hollow              -> only a WALKER sees it    (rendered, never computed)
 *
 * So this module deliberately does NOT try to score hollowness. It reports one
 * hard POLICY violation — the single slice of register item 8 ("answerability
 * is part of minting") that a machine can actually decide — plus a `thin`
 * measurement offered to the walker as a prompt to look, never as a verdict.
 *
 * The distinction is load-bearing, not fastidious: `tour-lint` passes the
 * Cartographer tour clean, and that is the tour the founder called "never
 * usable... a disaster." A readiness tool that overreaches into claiming it
 * detects hollowness would repeat that failure with a new green check.
 */

import type { ResolvedTourEntry } from './tourIndex'

/** Below this, a stop is flagged for the walker's attention — never failed on. */
export const THIN_CONTENT_CHARS = 200

const len = (s?: string): number => (s ?? '').trim().length

/**
 * The authored-claim caption, composed exactly as `openQuestionsPanel.ts`'s
 * render() builds `#tour-entry-info` (~line 2866). Duplicated deliberately and
 * guarded by a test: if the panel's composition changes and this doesn't, the
 * walk tool starts showing a human something the human will never see, which is
 * worse than showing nothing.
 */
export interface ClaimParts {
  /** Chrome: disposition + the optional marker. Middot-joined, as the panel joins them. */
  meta: string
  /** The answer contract — the literal tokens that satisfy the ask. */
  answerShape?: string
  /** The author's prose argument for why this stop deserves the walker. */
  comment?: string
}

/**
 * The authored claim, split into the same three KINDS the panel renders as
 * separate lines (ADR-0034 item 2, 2026-08-19). Field order matches the panel
 * exactly and is guarded by a test that reads the panel's own source: if the
 * two drift, `tour-walk` starts showing a walker something no human will see,
 * which is a false witness and worse than no witness.
 */
export function composeClaimParts(entry: ResolvedTourEntry): ClaimParts {
  const meta: string[] = []
  if (entry.disposition) meta.push(entry.disposition)
  if (!entry.mustRespond) meta.push('optional for this walk')
  return { meta: meta.join(' · '), answerShape: entry.answerPath, comment: entry.comment }
}

/** One-line form, for surfaces that genuinely have one line (log records, summaries). */
export function composeClaimLine(entry: ResolvedTourEntry): string {
  const p = composeClaimParts(entry)
  return [p.meta, p.answerShape ? 'Answer shape: ' + p.answerShape : '', p.comment ?? '']
    .filter(Boolean).join(' · ')
}

export interface StopAssessment {
  /** Panel-visible prose below the title: why + need + body + recommendation + body-post. */
  contentChars: number
  /** Doctrine 9: an answered entry is a read-only review stop, never silence. */
  isReviewStop: boolean
  /** Under THIN_CONTENT_CHARS and still awaiting an answer — a prompt to look, not a verdict. */
  thin: boolean
  /** The one mechanically-decidable answerability failure; see policyReason. */
  policyViolation: boolean
  policyReason?: string
}

/** Assess a single resolved entry. Entries that aren't questions aren't stops — see assessTour. */
export function assessStop(entry: ResolvedTourEntry): StopAssessment | undefined {
  if (entry.resolution.kind !== 'question') return undefined
  const q = entry.resolution.question
  const recs = q.recommendations?.length ? q.recommendations.map(r => r.text).join('\n\n') : q.recommendation
  const contentChars =
    len(q.whyAsking) + len(q.need) + len(q.rawBody) + len(recs) + len(q.rawBodyPost)
  const isReviewStop = q.isAnswered

  // POLICY: asking a human to DECIDE while offering no recommendation is, by
  // ADR-0034's own words, "a cheap claim on human attention written against
  // expensive substrate." A review stop is exempt — it is already answered, so
  // there is no decision being requested.
  const policyViolation =
    !isReviewStop && entry.mustRespond && entry.disposition === 'decide' && len(recs) === 0

  return {
    contentChars,
    isReviewStop,
    thin: !isReviewStop && contentChars < THIN_CONTENT_CHARS,
    policyViolation,
    policyReason: policyViolation
      ? `${q.slug} — must_respond + disposition:decide with NO recommendation`
      : undefined,
  }
}

export interface DroppedEntry {
  ref: string
  reason: string
}

export interface TourAssessment {
  /** Entries the panel silently omits from the walk (buildTourQuestions skips any non-question). */
  dropped: DroppedEntry[]
  /** Walkable stops, in tour order. */
  stops: Array<{ entry: ResolvedTourEntry; assessment: StopAssessment }>
  /** Stops still awaiting an answer — the panel's "N awaiting you" counter. */
  awaiting: number
  hardFailures: string[]
  thin: string[]
  ready: boolean
}

export function assessTour(resolved: ResolvedTourEntry[]): TourAssessment {
  const dropped: DroppedEntry[] = []
  const stops: TourAssessment['stops'] = []

  for (const entry of resolved) {
    const r = entry.resolution
    if (r.kind === 'error') {
      dropped.push({ ref: entry.ref, reason: r.message })
      continue
    }
    if (r.kind !== 'question') {
      // The silent-drop class: it RESOLVED, so doctrine 3's broken-reference
      // row never fires, and the walk simply has one fewer stop than the tour
      // claims. Named loudly here because nothing else in the stack names it.
      dropped.push({
        ref: entry.ref,
        reason: `resolved to '${r.kind}', not a question — NOT WALKABLE, and the panel shows no row for it`,
      })
      continue
    }
    const assessment = assessStop(entry)
    if (assessment) stops.push({ entry, assessment })
  }

  const hardFailures = [
    ...dropped.map(d => `${d.ref} — ${d.reason}`),
    ...stops.flatMap((s, i) =>
      s.assessment.policyViolation ? [`stop ${i + 1} (${s.assessment.policyReason})`] : [],
    ),
  ]
  if (resolved.length > 0 && stops.length === 0) {
    hardFailures.push('zero walkable stops — a human opening this tour sees nothing')
  }

  return {
    dropped,
    stops,
    awaiting: stops.filter(s => !s.assessment.isReviewStop).length,
    hardFailures,
    thin: stops.flatMap((s, i) =>
      s.assessment.thin ? [`stop ${i + 1} — ${s.assessment.contentChars} chars`] : [],
    ),
    ready: hardFailures.length === 0,
  }
}
