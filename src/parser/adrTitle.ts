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
