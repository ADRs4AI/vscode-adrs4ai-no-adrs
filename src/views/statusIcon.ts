/**
 * View-layer status icon (moved out of src/parser/statusInfo.ts, Phase 0(a)
 * of the docket extraction — ADR-0001 QST-SHAPE/Scope, docket repo: "the
 * core cannot carry vscode surface, not even type-only." `statusThemeIcon`
 * was the parser package's only vscode-typed export (its own design already
 * avoided a runtime dependency via injected constructors); moving it here
 * makes that structural rather than incidental, so a future strengthened
 * purity check on `src/parser/` has nothing left to catch.
 */

import { getStatusInfo } from '../parser/statusInfo'

/** Build a VS Code ThemeIcon for a status — constructors injected by the caller, so this file (not the parser) carries the only vscode type surface. */
export function statusThemeIcon(
  status: string,
  ThemeIcon: typeof import('vscode').ThemeIcon,
  ThemeColor: typeof import('vscode').ThemeColor,
): import('vscode').ThemeIcon {
  const info = getStatusInfo(status)
  if (!info) return new ThemeIcon('file-text')
  return new ThemeIcon(info.codicon, new ThemeColor(info.colorToken))
}
