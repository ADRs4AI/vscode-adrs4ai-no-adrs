/**
 * "This answer opens a follow-up question" — the write-path affordance
 * Riddle 5 asked for (2026-10-12, docs/inbox/2026-10-12-0150-riddle-to-
 * fitter-facet-..., from the ADR-0064 QST-STREAM trial-answer specimen;
 * ledger row `cca8ee4`). A trial/partial answer ("Option A to try... this
 * will help decide") is a real, honest way to answer — the format just had
 * no slot for "there's a verdict still owed." This mints that slot: a
 * brand-new, fully blessed `### QST-<ID>:` block in the SAME write as the
 * answer, so the verdict question can never silently fail to exist.
 *
 * Pure and vscode-free by design (openQuestionsPanel.ts's writeAnswer is
 * the thin vscode-touching caller) — refuse-or-succeed (constraint 1 of
 * Riddle's brief, sharpened by Docent's review) means this function either
 * returns a complete, collision-free block ready to insert, or a refusal;
 * there is no third "insert something and hope" outcome.
 *
 * Handle minting reuses `foldQstId` — the SAME fold `### QST-<ID>:`
 * headings already go through — rather than a second, independently
 * drifting charset rule (the hand-copied-cascade lesson, v0.7.40).
 * Collision checking reuses `applyBlessQstHandle`'s own discipline
 * (writeOps.ts: refuse the WHOLE write on collision, never silently
 * suffix or guess) rather than inventing a second collision checker.
 */

import { foldQstId } from '../parser/extractor'

export interface MintFollowUpQuestionInput {
  /** The human-typed one-line new ask — required, never auto-derived from the parent's heading (ADR-0034 It-32's exact lesson: an inherited title makes the stop lie). */
  title: string
  /** Prefilled ANS byline, same convention every freshly-authored QST block already uses (docs/adr/templates/adr.md) — cosmetic only, overwritten the moment this question is actually answered. */
  authorName: string
}

export interface MintedFollowUpQuestion {
  ok: true
  /** The minted handle, e.g. "STREAM-VERDICT" — folded, bounded, collision-checked. */
  qstId: string
  /** This question's own effective anchor, "qst-<lowercase qstId>" — what a `#` fragment resolves against. */
  slug: string
  /** The full `### QST-<ID>: ...` block, ready to insert verbatim (leading blank line included; no trailing blank line — the caller's insertion point supplies that). */
  blockText: string
}

export interface MintFollowUpQuestionRefusal {
  ok: false
  error: string
}

export type MintFollowUpQuestionResult = MintedFollowUpQuestion | MintFollowUpQuestionRefusal

/** Every question's own effective anchor in a file — the collision surface a freshly minted handle must avoid, same discipline as `applyBlessQstHandle`'s `slug_collision` guard (writeOps.ts). */
export function collectExistingHandleSlugs(questions: ReadonlyArray<{ slug: string }>): Set<string> {
  return new Set(questions.map((q) => q.slug.toLowerCase()))
}

/** Space/underscore runs become interior hyphens before folding — `foldQstId` already retains hyphens (ADR-0032 QST-IDCHARSET's 2026-07-16 widening), so this is the one adapter a prose title needs to become a handle-shaped string. */
function titleToHandleId(title: string): string {
  return foldQstId(title.trim().replace(/[\s_]+/g, '-'))
}

export function mintFollowUpQuestionBlock(
  input: MintFollowUpQuestionInput,
  existingHandleSlugs: ReadonlySet<string>,
): MintFollowUpQuestionResult {
  const title = input.title.trim()
  if (!title) {
    return { ok: false, error: 'A follow-up question needs its own one-line title — it was left blank.' }
  }

  const qstId = titleToHandleId(title)
  if (!qstId) {
    return { ok: false, error: `Could not derive a handle from "${title}" — it folds to nothing addressable (try plainer wording with at least one letter or digit).` }
  }

  const slug = `qst-${qstId.toLowerCase()}`
  if (existingHandleSlugs.has(slug)) {
    return { ok: false, error: `"${qstId}" collides with an existing question's handle in this file — refusing to mint a duplicate. Adjust the follow-up title slightly and try again.` }
  }

  const author = input.authorName.trim() || 'Human'
  const blockText = [
    '',
    `### QST-${qstId}: ${title}`,
    '- Status: unanswered',
    '- Why asking: opened as a follow-up at answer time — the question above was answered, but this specific part was left open rather than silently dropped.',
    '- Need: [specify what this follow-up needs]',
    '',
    'Options: none (elicitation)',
    '',
    `**ANS:** (by ${author})`,
    '[Fill this in]   <!-- literal placeholder — parser-significant, do not paraphrase -->',
  ].join('\n')

  return { ok: true, qstId, slug, blockText }
}

/** The forward pointer Docent ruled on (2026-10-12): a sibling marker line, never folded into the ANS slot — "every overload is a question that silently vanishes" (Riddle, ledger `cca8ee4`) is the exact defect this must not recreate. */
export function buildFollowUpMarkerLine(ref: string): string {
  return `**Follows up on**: ${ref}`
}
