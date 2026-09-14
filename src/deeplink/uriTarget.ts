/**
 * Pure decision logic for the `vscode://` URI handler — ADR-0008's deep-link
 * half that was only ever clickable FROM INSIDE VS Code (documentLinkProvider.
 * ts, terminalLinkProvider.ts). Pigeonhole (the estate's human inbox,
 * Plenum's brief 2026-09-14, relayed by Lapidary) needs to open one FROM
 * OUTSIDE — a plain CLI process can't call an extension command directly,
 * but every OS already knows how to launch a `vscode://` URL. No vscode
 * import here: parsing the `target` query param and deciding which surface
 * a resolved ref should open in are both pure, unit-tested directly; the
 * vscode.UriHandler wrapper in views/deepLinkUriHandler.ts is the thin
 * glue that calls these and does the actual opening.
 */

import type { ResolvedRef, RefError } from '../mcp/reference'

export type DeepLinkOpenIn = 'question-dialog' | 'tree' | 'markdown'

/**
 * `vscode://<ext-id>/open?target=<urlencoded ref>` — only the `/open` path
 * is recognized (an unrecognized path is a deliberate extension point for
 * later, not a malformed link — callers treat `undefined` as "nothing to
 * open" either way). `target`'s value is percent-decoded automatically by
 * URLSearchParams. `path`/`query` mirror `vscode.Uri`'s own field shapes,
 * kept minimal here so this stays testable without a real Uri instance.
 */
export function parseUriHandlerTarget(uri: { path: string; query: string }): string | undefined {
  if (uri.path !== '/open') return undefined
  const target = new URLSearchParams(uri.query).get('target')
  return target && target.length > 0 ? target : undefined
}

/**
 * Which surface a resolved (or failed) reference should open in, given the
 * `adrManager.deepLink.openIn` setting (Jérémie's verbatim pref, via
 * pigeonhole: "open the ADR manager on treeview... open the Question
 * Dialog on that question — better than markdown file... could also be a
 * setting, default to what I told you, configurable to the markdown").
 *
 * `'question-dialog'` only ever applies to an actual resolved question —
 * a bare ADR/seed/section has no question to navigate the dialog to, so it
 * degrades to `'tree'` the same as asking for `'tree'` directly. A
 * resolution failure always routes to `'markdown'`: there is no file to
 * reveal in the tree for something that didn't resolve, and 'markdown' is
 * the route whose glue actually shows the loud "couldn't resolve" error
 * (reusing OPEN_DEEP_LINK_COMMAND's own existing error path, not a new one).
 */
export function decideRoute(resolved: ResolvedRef | RefError, openIn: DeepLinkOpenIn): DeepLinkOpenIn {
  if (resolved.kind === 'error') return 'markdown'
  if (openIn === 'markdown') return 'markdown'
  if (openIn === 'question-dialog') return resolved.kind === 'question' ? 'question-dialog' : 'tree'
  return 'tree'
}
