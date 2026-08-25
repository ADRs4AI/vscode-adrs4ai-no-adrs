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
// ONE definition of the status/answer disagreement, shared with the MCP reads
// that already surface it — not a second copy that can drift (the
// hand-copied-regex-cascade lesson, v0.7.40).
import { isStatusAnswerInconsistent } from '../mcp/handlers'

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
  /**
   * Declares `unanswered` but carries a real ANS block — the substrate's status
   * line disagreeing with its own content. Never a hard failure (ADR-0031:
   * declared status is sovereign), but the loudest warning here: this is the
   * class that walked the founder to two questions he had already answered.
   */
  staleAnswered: boolean
  /**
   * No NATIVE recommendation in the underlying document, whatever the tour-side
   * claims say. NOT a failure — this is doctrine 8's branch (b): the fact the
   * mint must state out loud ("N stops will render unprepared — proceed?") so a
   * minter chooses deliberately instead of discovering it through the founder.
   */
  unprepared: boolean
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

  // Doctrine 8 as machinery (Riddle's ask, routed by Facet 2026-08-25; Facet
  // caught that this predicate looked only at native Recommendation content and
  // ignored `comment`/`answer_path` entirely — a real gap, and one that would
  // have failed the Cartographer specimen's six relocated stops even though
  // their tour-side compensation was real). Their catch is taken; the threshold
  // question it raised is DISSOLVED rather than answered, and here is why.
  //
  // Riddle's ask has two branches: a stop lacking native prep must either
  // (a) carry tour-side claims at answerable grade, OR (b) the mint must say so
  // out loud before creating it. Branch (b) is the home for everything a
  // machine cannot decide — which is exactly what "at answerable grade" is.
  //
  // Measured across the whole ecosystem before choosing (82 entries, 12 tours):
  // EVERY entry ever minted carries a comment (min 30 chars, median 161). So a
  // presence bar passes everything, and a LENGTH bar is a hollowness heuristic
  // — and hollowness is not mechanically decidable (iter-12), which is why
  // `thin` measures and never fails. A hard gate that guessed at grade by
  // character count would be the overreach this module's header warns about,
  // and a gate that cries wolf is one people learn to bypass — which is
  // precisely how tour-lint became advisory in practice.
  //
  // So the split mirrors the two kinds of unready:
  //   policyViolation  — STRUCTURAL absence. A decide-stop with no basis at
  //                      all, or no contract at all. Machine-decidable. Fails.
  //   unprepared       — no NATIVE recommendation, whatever the claims say.
  //                      Not a failure; it is what branch (b) announces out
  //                      loud so a minter decides with their eyes open.
  const hasBasis = len(recs) > 0 || len(entry.comment) > 0
  // `answer_path` is the contract — "the literal tokens that satisfy the ask"
  // (schema v1), and what one-tap Accept needs to exist at all. A native
  // Recommendation carries its own shape, so the contract is only separately
  // required when the basis is tour-side.
  const hasContract = len(recs) > 0 || len(entry.answerPath) > 0
  const isDecideStop = !isReviewStop && entry.mustRespond && entry.disposition === 'decide'
  const policyViolation = isDecideStop && !(hasBasis && hasContract)
  const unprepared = !isReviewStop && len(recs) === 0

  // STALE-ANSWERED — added 2026-08-25, from the incident that produced it.
  // Jérémie's 08-24 launch tour walked him to two stops he had ANSWERED on
  // 08-08; their `Status:` lines were still stale, so the walk presented
  // settled work as awaiting him. He booked a deep-focus slot for it. Neither
  // tour-lint (refs resolved) nor tour-walk (content was substantial) could
  // see it, because the defect was in the substrate's own status lines —
  // register item 3's "fact-rot," which a live-read tour renders truthfully.
  //
  // But it IS mechanically decidable, and the codebase already decides it for
  // MCP reads: a question declaring unanswered while carrying a real ANS block.
  // Cartographer's own fix commit names the lesson exactly — "check ANS
  // presence, never trust the status line alone."
  //
  // NOT a hard failure: ADR-0031 keeps declared status sovereign, so an author
  // may legitimately re-open an answered question. It is the loudest WARNING
  // this module has, because it is the one that costs a booked slot. Doctrine 9
  // already handles the truthful case gracefully — a genuinely answered entry
  // becomes a read-only review stop. This catches the case where the substrate
  // is lying about which it is.
  const staleAnswered = !isReviewStop && isStatusAnswerInconsistent(q)

  return {
    contentChars,
    isReviewStop,
    thin: !isReviewStop && contentChars < THIN_CONTENT_CHARS,
    staleAnswered,
    unprepared,
    policyViolation,
    policyReason: policyViolation
      ? `${q.slug} — must_respond + disposition:decide with ` +
        (!hasBasis ? 'no recommendation AND no authored comment' : 'no answer_path to say what answer satisfies it')
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
  /**
   * Stops with no native recommendation — doctrine 8 branch (b). A mint surface
   * MUST state this before creating the tour ("N stops will render unprepared —
   * proceed?"); it never blocks. Separate from `ready` on purpose: readiness is
   * what a machine can decide, this is what a minter must be told.
   */
  unprepared: string[]
  /**
   * Stops whose question declares unanswered but already carries an answer.
   * Surfaced separately from `thin`/`unprepared` because the cost is different
   * in kind: not a stop that reads poorly, a stop that should not be in the
   * walk at all.
   */
  staleAnswered: string[]
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
    unprepared: stops.flatMap((s, i) =>
      s.assessment.unprepared ? [`stop ${i + 1} — no recommendation in the source document`] : [],
    ),
    staleAnswered: stops.flatMap((s, i) =>
      s.assessment.staleAnswered
        ? [`stop ${i + 1} — declares unanswered but already carries an ANS block`]
        : [],
    ),
    ready: hardFailures.length === 0,
  }
}
