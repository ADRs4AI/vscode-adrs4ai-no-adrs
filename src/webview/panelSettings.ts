/**
 * Pure Open Questions panel settings translations (ADR-0010, ADR-0019).
 *
 * Kept free of any `vscode` import so these are unit-testable directly —
 * openQuestionsPanel.ts owns reading vscode.workspace.getConfiguration()
 * and passes the raw setting strings/numbers in.
 */

/**
 * Translate the `adrManager.panel.bodyMaxWidth` setting into a CSS max-width.
 * 'full' removes the cap entirely; a positive integer is combined with a 94%
 * viewport cap so it never overflows a narrow window; anything else falls
 * back to the default (min(94%, 1100px)).
 */
export function bodyMaxWidthCss(setting: string): string {
  const trimmed = setting.trim()
  if (trimmed.toLowerCase() === 'full') return 'none'
  const px = parseInt(trimmed, 10)
  if (!isNaN(px) && px > 0) return `min(94%, ${px}px)`
  return 'min(94%, 1100px)'
}
