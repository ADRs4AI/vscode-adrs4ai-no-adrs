/**
 * Draft keying — ADR-0023 (Anti-Clobbering Posture, Decision 2)
 *
 * draftKey = adrNumber ⊕ sha1(normalize(questionHeadingText)) ⊕ occurrenceOrdinal
 *
 * - normalize: trim, collapse whitespace, lowercase, strip a "QST:" prefix —
 *   so cosmetic edits (extra space, case) don't orphan a draft.
 * - occurrenceOrdinal: among questions in the same file with the same
 *   normalized-text hash, the 0-based index in document order — line-number
 *   robust because it depends only on relative order, not absolute lines
 *   (answering one question shifts every question below it).
 *
 * Threat model (confirmed by field experience, ADR-0023 QST-2 ANS): question
 * *renaming* is exceedingly rare; line shifts from answering are constant.
 * The key is optimized for the common case, not immune to the rare one — a
 * renamed question orphans its draft, surfaced via the reattach picker
 * rather than silently lost.
 */

import * as crypto from 'crypto'

/** Trim, collapse whitespace, lowercase, strip a "QST:" prefix. */
export function normalizeQuestionText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/^qst:\s*/, '')
}

/** Short, stable hash of the normalized question text. */
export function questionTextHash(text: string): string {
  return crypto.createHash('sha1').update(normalizeQuestionText(text)).digest('hex').slice(0, 12)
}

/**
 * For a list of question texts in document order (all from the same file),
 * compute each one's occurrenceOrdinal: the 0-based rank among prior
 * questions sharing the same normalized-text hash.
 */
export function computeOccurrenceOrdinals(questionTexts: string[]): number[] {
  const seen = new Map<string, number>()
  return questionTexts.map(text => {
    const hash = questionTextHash(text)
    const ordinal = seen.get(hash) ?? 0
    seen.set(hash, ordinal + 1)
    return ordinal
  })
}

/** Assemble the draft key from its three components. */
export function computeDraftKey(adrNumber: number, questionText: string, occurrenceOrdinal: number): string {
  return `${adrNumber}::${questionTextHash(questionText)}::${occurrenceOrdinal}`
}

/**
 * For a list of question texts in document order, compute each one's TOTAL
 * sibling count: how many questions in the whole list share its normalized-
 * text hash. Used alongside occurrenceOrdinal to detect the case ordinal
 * alone can't: inserting a new occurrence of duplicate text changes the
 * *count* even when a specific ordinal slot's key string is unchanged (a
 * genuinely different question can inherit a stale ordinal's key when
 * duplicate-worded questions are common — write-adversary CATCH 3). A
 * restore that also checks "the sibling count I saved against is the count
 * I see now" refuses to trust a key whose duplicate-group shape has shifted,
 * rather than silently misattaching content to the wrong question.
 */
export function computeOccurrenceCounts(questionTexts: string[]): number[] {
  const totals = new Map<string, number>()
  for (const text of questionTexts) {
    const hash = questionTextHash(text)
    totals.set(hash, (totals.get(hash) ?? 0) + 1)
  }
  return questionTexts.map(text => totals.get(questionTextHash(text))!)
}
