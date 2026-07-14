/**
 * ADR-context extraction for the Open Questions panel's collapsible
 * "ADR context" box (ADR-0010).
 *
 * The boundary is DERIVED from where the extracted questions actually sit,
 * not from section names. The previous implementation (inline in
 * openQuestionsPanel.ts) anchored on the section literally named
 * "Questions" (exact match) plus a denylist of canonical template section
 * names — so any ADR whose questions live under other headings ("## Open
 * Questions" — D1; or freeform layouts with QSTs spread across several
 * design sections and no Questions section at all — overfly hq ADR-0031,
 * reported live by Jérémie 2026-07-14) got a context box containing the
 * ENTIRE file, questions and answers included.
 *
 * Deriving from `adr.questions` makes the boundary inherit every recall
 * improvement automatically: whatever the extractor learns to recognize as
 * a question (ADR-0031 multi-signal candidacy included) is excluded from
 * context by construction, from the same source of truth. The invariant —
 * context never overlaps any extracted question — is enforced by a property
 * test over the corpus (adrContext.test.ts), not per-specimen expectations.
 */

import type { AdrFile, AdrSection } from './types'

/**
 * Canonical template sections that are boilerplate, not context, even when
 * they precede the questions. No longer load-bearing for correctness (the
 * derived boundary is) — this only keeps known-noise sections out of the box.
 */
const BOILERPLATE_HEADINGS = new Set([
  'questions',
  'open questions',
  'quick reference',
  'decision',
  'action items',
  'iterations',
  'links',
  'validation',
  'supporting materials',
])

/** True when any extracted question starts within this section's extent. */
function isQuestionBearing(section: AdrSection, adr: AdrFile): boolean {
  return adr.questions.some(
    q => q.lineStart >= section.lineStart && q.lineStart <= section.lineEnd,
  )
}

/**
 * The top-level sections that form the ADR's context: the prefix of
 * sections strictly before the first question-bearing section, minus
 * boilerplate. When the first section already bears a question — or the
 * ADR has no questions at all — there is no context.
 */
export function contextSections(adr: AdrFile): AdrSection[] {
  const firstQuestionBearing = adr.sections.find(s => isQuestionBearing(s, adr))
  if (!firstQuestionBearing) return []
  return adr.sections.filter(
    s =>
      s.lineStart < firstQuestionBearing.lineStart &&
      !BOILERPLATE_HEADINGS.has(s.heading.toLowerCase()),
  )
}

/**
 * Rendered context for the panel's collapsible box, in the same markdown
 * shape the panel always used (## heading + body, ----separated), or
 * undefined when there is nothing to show.
 */
export function computeAdrContext(adr: AdrFile): string | undefined {
  const sections = contextSections(adr)
  if (sections.length === 0) return undefined
  return sections
    .map(s => `## ${s.heading}\n\n${s.body}`)
    .join('\n\n---\n\n')
    .trim() || undefined
}
