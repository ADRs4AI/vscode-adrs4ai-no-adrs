/**
 * Diagnostic-only display text for one VS Code command argument. Pure —
 * no `vscode` import — so it can be exercised with a real behavioral test
 * instead of only a source-shape regex (adrTreeProvider.ts sits behind the
 * vscode-import wall; this module doesn't need to).
 *
 * Root cause (Gleaner, 2026-08-14, docs/inbox/2026-08-14-1600-gleaner-to-
 * fitter-treeview-report-root-cause-confirmed.md): a question/tour-entry
 * tree item's default `clickOpensIn: 'panel'` command carries
 * `arguments: [treeItem]` — the item embeds a live reference to ITSELF,
 * correct for VS Code's in-process command dispatch but fatal to
 * `JSON.stringify` on the whole array ("Converting circular structure to
 * JSON"), reproduced live on every tree-wide Report click once the walk
 * reached any open question — not just root items, as first suspected.
 * The value never matters here (display-only, never re-parsed), so
 * primitives pass through and anything else degrades to a type tag.
 */
export function stringifyCommandArg(arg: unknown): string {
  if (arg === null || arg === undefined) return JSON.stringify(arg ?? null)
  const t = typeof arg
  if (t === 'string' || t === 'number' || t === 'boolean') return JSON.stringify(arg)
  const ctorName = (arg as { constructor?: { name?: string } }).constructor?.name
  return `[${ctorName || t}]`
}
