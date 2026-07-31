/**
 * ADR title-prefix cleaning, shared by every display surface (tree labels,
 * panel group labels). Previously two identical inline regexes (tree +
 * panel) — consolidated here so the tolerance can't drift between copies.
 *
 * Nit (Jérémie, 2026-07-14, system3): titles in the wild write the
 * number/title separator as ":", "-", "–" (en dash), or "—" (em dash) —
 * `# ADR 0033 — Team-completism...` kept its em-dash glued to the label
 * because the old class knew only colon/hyphen/whitespace. Same for the
 * ADR/number joint ("ADR–0033"). Tolerate the whole dash family.
 */

/** Dash family observed in the wild: hyphen-minus, en, em, figure, horizontal bar, minus sign. */
const DASHES = '\\-–—‒―−'

const ADR_NUMBER_PREFIX_RE = new RegExp(`^ADR[${DASHES}\\s]*\\d+[:${DASHES}\\s]+`, 'i')

/**
 * Strip a leading "ADR <number><separator>" prefix from a title for display
 * next to an already-shown ADR number. Falls back to the input when the
 * strip would leave nothing (a title that IS just the prefix).
 */
export function stripAdrNumberPrefix(title: string): string {
  return title.replace(ADR_NUMBER_PREFIX_RE, '').trim() || title
}

/**
 * Gleaner 5 (HQ meta-repo, 2026-07-31, founder Report): the `- **Date**:`
 * field's captured value is whatever the author wrote after the colon,
 * annotation and all — "2026-07-29 (dictated overnight, pre-sleep;
 * captured same night)" — and every treeview title site interpolated that
 * WHOLE string, no normalization. Jérémie, explicitly tied to his stated
 * LLI sensitivity: "increases cognitive load by making the sidebar a
 * mess... for someone with Low Latent Inhibition, it can be a huge pain."
 *
 * Display-only: this strips the annotation for TITLE SITES specifically —
 * the raw `date` field itself is untouched everywhere else, per the
 * format's "preserved always" degradation contract (an annotation is real
 * authored content, not noise, and stays fully intact in the document and
 * in `AdrFile.date`/`SeedFile.date`; only the sidebar label narrows it).
 * Falls back to the original string when it doesn't start with a bare
 * YYYY-MM-DD — never hides a date that doesn't fit the pattern.
 */
const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})\b/

export function normalizeDateForTitle(date: string): string {
  const m = date.match(DATE_PREFIX_RE)
  return m ? m[1] : date
}
