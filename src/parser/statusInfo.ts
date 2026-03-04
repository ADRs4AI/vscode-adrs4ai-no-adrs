/**
 * Single source of truth for ADR status definitions.
 *
 * All status-aware code (tree view icons, quick pick menus, parser warnings,
 * tooltips) imports from here. Adding a new status means editing ONE file.
 *
 * Simon's near-decomposability principle: status knowledge should be
 * strongly coupled *within* this module and weakly coupled to consumers.
 */

import type * as vscode from 'vscode'

// ---------------------------------------------------------------------------
// Status definitions
// ---------------------------------------------------------------------------

export interface StatusInfo {
  /** The canonical status string written in ADR files */
  value: string
  /** Emoji used in Quick Pick menus and tooltip text */
  emoji: string
  /** VS Code codicon name for the tree view icon */
  codicon: string
  /** VS Code ThemeColor token for the tree view icon tint */
  colorToken: string
  /** Short label for display */
  label: string
  /** Whether this status requires a Scope Remaining field */
  requiresScope: boolean
}

export const ADR_STATUSES: StatusInfo[] = [
  { value: 'Draft',                emoji: '✏️',  codicon: 'edit',     colorToken: 'charts.yellow',           label: 'Draft',                requiresScope: false },
  { value: 'Proposed',             emoji: '💡',  codicon: 'lightbulb', colorToken: 'charts.blue',            label: 'Proposed',             requiresScope: false },
  { value: 'Accepted',             emoji: '✅',  codicon: 'check',    colorToken: 'testing.iconPassed',      label: 'Accepted',             requiresScope: false },
  { value: 'Partially Implemented', emoji: '🔧', codicon: 'tools',    colorToken: 'charts.orange',           label: 'Partially Implemented', requiresScope: true  },
  { value: 'Implemented',          emoji: '🏗️', codicon: 'verified', colorToken: 'testing.iconPassed',      label: 'Implemented',          requiresScope: false },
  { value: 'Superseded',           emoji: '🔄', codicon: 'history',  colorToken: 'disabledForeground',      label: 'Superseded',           requiresScope: false },
]

// ---------------------------------------------------------------------------
// Lookup helpers (by value)
// ---------------------------------------------------------------------------

const BY_VALUE = new Map<string, StatusInfo>(
  ADR_STATUSES.map(s => [s.value, s])
)

export function getStatusInfo(status: string): StatusInfo | undefined {
  return BY_VALUE.get(status)
}

export function statusEmoji(status: string): string {
  return BY_VALUE.get(status)?.emoji ?? '📄'
}

export function statusCodicon(status: string): string {
  return BY_VALUE.get(status)?.codicon ?? 'file-text'
}

export function statusColorToken(status: string): string {
  return BY_VALUE.get(status)?.colorToken ?? 'foreground'
}

export function requiresScopeRemaining(status: string): boolean {
  return BY_VALUE.get(status)?.requiresScope ?? false
}

/** The ordered list of canonical status strings (for parser validation) */
export const KNOWN_STATUS_VALUES: string[] = ADR_STATUSES.map(s => s.value)

/** Build a VS Code ThemeIcon for a status (requires vscode import at call site) */
export function statusThemeIcon(
  status: string,
  ThemeIcon: typeof import('vscode').ThemeIcon,
  ThemeColor: typeof import('vscode').ThemeColor,
): import('vscode').ThemeIcon {
  const info = BY_VALUE.get(status)
  if (!info) return new ThemeIcon('file-text')
  return new ThemeIcon(info.codicon, new ThemeColor(info.colorToken))
}
