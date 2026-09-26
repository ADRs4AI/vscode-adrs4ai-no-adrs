/**
 * Single source of truth for ADR status definitions.
 *
 * All status-aware code (tree view icons, quick pick menus, parser warnings,
 * tooltips) imports from here. Adding a new status means editing ONE file.
 *
 * Simon's near-decomposability principle: status knowledge should be
 * strongly coupled *within* this module and weakly coupled to consumers.
 *
 * Zero vscode surface, including type-only (Phase 0(a) of the docket
 * extraction, ADR-0001): `statusThemeIcon` — this file's only vscode-typed
 * export — moved to `src/views/statusIcon.ts`. Enforced by
 * `mcpPurity.test.ts`'s static scan of the whole parser/index/mcp graph.
 */

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
  // Suspension states (v0.7.68 document-pause family) — icons added with DEBRIEF-009's migration
  { value: 'Deferred',             emoji: '⏸️',  codicon: 'debug-pause', colorToken: 'disabledForeground',   label: 'Deferred',             requiresScope: false },
  { value: 'Paused',               emoji: '⏸️',  codicon: 'debug-pause', colorToken: 'disabledForeground',   label: 'Paused',               requiresScope: false },
  { value: 'Suspended',            emoji: '⏸️',  codicon: 'debug-pause', colorToken: 'disabledForeground',   label: 'Suspended',            requiresScope: false },
  { value: 'On Hold',              emoji: '⏸️',  codicon: 'debug-pause', colorToken: 'disabledForeground',   label: 'On Hold',              requiresScope: false },
]

// ---------------------------------------------------------------------------
// Lookup helpers (by value)
// ---------------------------------------------------------------------------

const BY_VALUE = new Map<string, StatusInfo>(
  ADR_STATUSES.map(s => [s.value, s])
)


// ---------------------------------------------------------------------------
// Normalization (MOVED HOME from extractor.ts, DEBRIEF-009, 2026-08-16)
// ---------------------------------------------------------------------------
// DEBRIEF-009's root cause: this file kept a PRIVATE exact-match lookup
// (BY_VALUE.get) while normalizeDocumentStatus lived in extractor.ts — a
// second recognition path, the same disease as the write-scan drift, in
// the icon lane. An annotated "Implemented — <note>" got the verified
// checkmark from the parser and a generic file icon from the tree, and the
// ledger said SHIPPED because one consumer of three had migrated. The fix
// is structural: status knowledge lives HERE (this file's own header says
// "single source of truth"), extractor re-exports for its consumers, and
// every lookup below resolves exact-first (legacy display fidelity, incl.
// 'Proposed') then normalized (annotation/emphasis/suspension tolerant).

/** Strip *, _, ` emphasis from keyword-comparison sites — never at content sites. */
export function stripInlineEmphasis(text: string): string {
  return text.replace(/[*_`]/g, '').replace(/\s{2,}/g, ' ').trim();
}

export type NormalizedDocumentStatus =
  | 'Draft' | 'Accepted' | 'Implemented' | 'Partially Implemented' | 'Superseded'
  | 'Deferred' | 'Paused' | 'Suspended' | 'On Hold'
  | 'unknown';

const NORMALIZED_DOCUMENT_STATUS_PATTERNS: ReadonlyArray<{ re: RegExp; token: NormalizedDocumentStatus }> = [
  { re: /^Partially Implemented\b/i, token: 'Partially Implemented' },
  { re: /^Draft\b/i, token: 'Draft' },
  { re: /^Accepted\b/i, token: 'Accepted' },
  { re: /^Implemented\b/i, token: 'Implemented' },
  { re: /^Superseded\b/i, token: 'Superseded' },
  { re: /^Deferred\b/i, token: 'Deferred' },
  { re: /^Paused\b/i, token: 'Paused' },
  { re: /^Suspended\b/i, token: 'Suspended' },
  { re: /^On[ -]Hold\b/i, token: 'On Hold' },
];

/** One exported function, N consumers (ADR-0021 It.16) — the single tolerant read of a declared document Status. */
export function normalizeDocumentStatus(status: string | undefined): NormalizedDocumentStatus {
  if (!status) return 'unknown';
  const cleaned = stripInlineEmphasis(status).trim();
  for (const { re, token } of NORMALIZED_DOCUMENT_STATUS_PATTERNS) {
    if (re.test(cleaned)) return token;
  }
  return 'unknown';
}

/**
 * ADR-0036's two question-level "not waiting on the human" tokens.
 * Leading-token match (word boundary), tolerating a trailing annotation —
 * the SAME tolerance `answered` has always had (ANSWERED_LEADING_TOKEN_RE)
 * and document-level pause has (`isDocumentPausedStatus`). Found 2026-09-26
 * from two independent founder Reports in two repos (moreover: "qualification
 * of 'deferred' intrudes on parsing — is that normal?"; companion etude: "Do
 * we have deferred? … doesn't it have a different glyph?"): every consumer
 * compared the WHOLE status text for equality, so the canonical annotated
 * form — `- Status: deferred — reason`, what the authoring skill itself
 * teaches — never got the [deferred] tag, the history icon, or the
 * `deferred.hideFromPanel` setting; only a bare `deferred` did. One
 * recognizer, three consumers (tree tag, tree icon, panel hide).
 */
export function questionStatusToken(statusText: string | undefined): 'unresolved' | 'deferred' | undefined {
  const m = statusText?.trim().match(/^(unresolved|deferred)\b/i)
  return m ? (m[1].toLowerCase() as 'unresolved' | 'deferred') : undefined
}

/**
 * Category-header filter checkboxes (Facet's go-ahead, 2026-08-16, docs/
 * inbox/2026-08-16-facet-to-fitter-category-header-filters-unblocked-
 * plus-two-stuck-items.md — mechanism (a) from my own 2026-08-06 design
 * brief): "settled" means the decision isn't actively being worked —
 * Implemented/Superseded (the decision's own lifecycle closed) plus the
 * pause family (the DOCUMENT itself is closed, ADR-0021's document-pause
 * ruling). Draft/Proposed/Accepted/Partially Implemented stay visible —
 * those are exactly the statuses where a human's attention is still the
 * bottleneck. Deliberately not reusing seedIndex.ts's classifyAdrProgress
 * here — that classifier answers "how far along is implementation," a
 * different question from "should this stay visible by default," and
 * conflating them would have called Superseded 'not-done' (technically
 * true, practically irrelevant to decluttering).
 */
export function isSettledAdrStatus(status: string | undefined): boolean {
  const normalized = normalizeDocumentStatus(status)
  return normalized === 'Implemented' || normalized === 'Superseded'
    || normalized === 'Deferred' || normalized === 'Paused' || normalized === 'Suspended' || normalized === 'On Hold'
}

/** Layered lookup: exact match first (legacy fidelity — 'Proposed' keeps its lightbulb), then the parser's normalized read. This is the DEBRIEF-009 fix: no consumer of this file can miss an annotated status again. */
function resolveStatusInfo(status: string): StatusInfo | undefined {
  return BY_VALUE.get(status) ?? BY_VALUE.get(normalizeDocumentStatus(status))
}

export function getStatusInfo(status: string): StatusInfo | undefined {
  return resolveStatusInfo(status)
}

export function statusEmoji(status: string): string {
  return resolveStatusInfo(status)?.emoji ?? '📄'
}

export function statusCodicon(status: string): string {
  return resolveStatusInfo(status)?.codicon ?? 'file-text'
}

export function statusColorToken(status: string): string {
  return resolveStatusInfo(status)?.colorToken ?? 'foreground'
}

export function requiresScopeRemaining(status: string): boolean {
  return resolveStatusInfo(status)?.requiresScope ?? false
}

/** The ordered list of canonical status strings (for parser validation) */
export const KNOWN_STATUS_VALUES: string[] = ADR_STATUSES.map(s => s.value)
