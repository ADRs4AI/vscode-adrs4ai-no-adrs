/**
 * Sidebar category order (Lapidary's 2026-07-29 feedback-seed dispatch,
 * item B — source: docs/adr/seed-2026-07-29-random-feedback-from-
 * experience.md): Jérémie's own words, "I would make the order of the
 * categories configurable, and by default I would make it: Tours, ADRs,
 * Seeds." `adrManager.sidebar.categoryOrder` is the setting; this module is
 * the pure ordering logic — vscode-import-free, same reasoning as this
 * directory's other pure helpers (rootPathFragment.ts, treeItemIdentity.ts).
 */

export type SidebarCategory = 'tours' | 'adrs' | 'seeds'

export const DEFAULT_CATEGORY_ORDER: SidebarCategory[] = ['tours', 'adrs', 'seeds']

const VALID_CATEGORIES: SidebarCategory[] = ['tours', 'adrs', 'seeds']

/**
 * Orders `present` (the categories actually populated this render, e.g.
 * seeds/tours are omitted entirely when their count is zero — see
 * adrTreeProvider.ts's getContainerChildren) according to `order`, a raw
 * setting value that may be missing, malformed, or a garbled subset — a
 * broken/incomplete setting must never DROP a category from the tree, only
 * ever misorder it. Any category in `present` but not (validly) named in
 * `order` is appended at the end, in its original relative order, rather
 * than silently vanishing.
 */
export function orderCategories(order: unknown, present: SidebarCategory[]): SidebarCategory[] {
  const requested = Array.isArray(order)
    ? order.filter((c): c is SidebarCategory => VALID_CATEGORIES.includes(c as SidebarCategory))
    : []

  const seen = new Set<string>()
  const result: SidebarCategory[] = []
  for (const cat of requested) {
    if (present.includes(cat) && !seen.has(cat)) {
      result.push(cat)
      seen.add(cat)
    }
  }
  for (const cat of present) {
    if (!seen.has(cat)) {
      result.push(cat)
      seen.add(cat)
    }
  }
  return result
}
