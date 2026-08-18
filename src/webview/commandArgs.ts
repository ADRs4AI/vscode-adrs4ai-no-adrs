/**
 * Guards for arguments that arrive at command handlers from VS Code itself.
 *
 * Context (DEBRIEF-worthy pattern, 2026-08-18): `adrManager.openQuestionsPanel`
 * takes an optional tour slug. Explicit callers (tour tree items) pass a
 * string; the view/title toolbar button's invocation lets VS Code inject
 * whatever contextual first argument the host version chooses. The handler
 * trusted `arguments[0]` as a slug, so a truthy non-string sent the panel
 * into tour mode for a tour that cannot resolve — rendering "All caught up"
 * over a corpus with open questions (Jérémie's live catch while re-recording
 * the marketplace GIFs, fixture workspace).
 *
 * Rule: anything crossing the command boundary is untrusted; coerce, never
 * assume.
 */
export function coerceTourSlug(arg: unknown): string | undefined {
  return typeof arg === 'string' && arg.length > 0 ? arg : undefined
}
