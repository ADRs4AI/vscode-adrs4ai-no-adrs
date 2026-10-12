/**
 * ADR Parser — Stage 2: Semantic Extractor
 *
 * Takes the structural output from the tokenizer and extracts ADR-specific
 * entities: metadata, sections with nav codes, questions, iterations, etc.
 *
 * This is where all ADR format knowledge lives.
 * See ADR-0002 for the design rationale and data model.
 */

import * as crypto from 'crypto'
import * as path from 'path'
import { KNOWN_STATUS_VALUES, requiresScopeRemaining, stripInlineEmphasis, normalizeDocumentStatus } from './statusInfo'
import { tokenize, extractRawSections, type RawSection, type Token, type HeadingToken } from './tokenizer'
import { unwrapListItems, unwrapMarkdownish } from './hardwrap'
import type {
  AdrFile,
  AdrFormat,
  AdrSection,
  AdrStatus,
  AdrIteration,
  DeepLink,
  FormatDetectionResult,
  InlineNavCode,
  NavCode,
  ParseWarning,
  ParseWarningCode,
  Question,
  QuestionAnswer,
  QuestionRound,
  Recommendation,
  RoundAnswer,
  SourceRange,
} from './types'
import { KNOWN_STATUSES } from './types'

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/** All heading text that strongly signals the adr format (formerly collab-adr-lean) */
const COLLAB_ADR_LEAN_SIGNALS = [
  'Quick Reference',
  'Human Context',
  'AI Interpretation',
  'Iterations',
  'Validation',
];

/** All heading text (or prefixes) that signal standard MADR */
const MADR_STANDARD_SIGNALS = [
  'Context and Problem Statement',
  'Decision Drivers',
  'Considered Options',
  'Decision Outcome',
  'Pros and Cons of the Options',
];

/** Regex for nav code headings (### QST: ..., ### NOT: ..., etc.) */
const NAV_CODE_HEADING_RE = /^(QST|ANS|COD|API|FIL|DOC|NOT):\s+(.*)$/;

// ADR-0024: the strict form above is exact-match, case-sensitive, and requires
// whitespace after the colon. A heading that only deviates in case (### qst:)
// or has a glued colon (### QST:Question) matched neither NAV_CODE_HEADING_RE
// nor NONSTANDARD_QST_HEADING_RE (below, which only catches "### QST-N:"), so
// navCode came back undefined and the question silently vanished from the
// Open Questions panel — no ParseWarning, no diagnostic, nothing (Postel's
// law violation: the parser should accept liberally and flag, not drop).
// This tolerant form recovers the question; NONCANONICAL_NAV_CODE_HEADING
// (below) keeps the deviation from disappearing silently.
const NAV_CODE_HEADING_TOLERANT_RE = /^(QST|ANS|COD|API|FIL|DOC|NOT):\s*(.*)$/i;

// HQ ADR-0012 (QST Identifier Grammar — Blessing the Handle, 2026-07-11):
// explicit, author-chosen question handles — "### QST-<ID>: <title>" —
// canonical-optional alongside plain "### QST: <title>". Only QST gets this
// id-suffix grammar (ANS/COD/etc. aren't cited across inbox briefs and deep
// links the way questions are). Checked BEFORE the generic nav-code regexes
// above: "QST-A:" matches neither (confirmed independently by concertmaster-5
// in companion-thinking-stream-etude and by this repo — the motivating
// incident for the HQ ADR). `id` accepts Unicode letters/digits on input
// (so "QST-JÉRÉMIE" can be typed) and is NFD-folded to the ratified bounded
// ASCII charset before use — see foldQstId().
// Widened 2026-07-16 (ADR-0032 QST-IDCHARSET, ratified by Jérémie; grammar
// change HQ-paired with ADR-0012): ids allow INTERIOR hyphens and run up to
// 24 chars — "QST-STATUS-AUTHORITY:" is a handle, not a dialect. The
// original {1,12} no-hyphen charset was designed from lettered/numeric ids
// (QST-A, QST-3); its first sustained topical-slug user (the ADR-0032
// register's own chair) bounced off it within a day and invented a
// counterfeit id-in-title convention — the grammar resisting natural use is
// a format defect, not an author error (CoffeeScript doctrine). Start/end
// stay alphanumeric so "QST--X:"/"QST-X-:" remain malformed (caught by the
// recall fallback below, never silently dropped).
const QST_HANDLE_RE = /^QST-([\p{L}\p{N}](?:[\p{L}\p{N}-]{0,22}[\p{L}\p{N}])?):\s*(.*)$/u;
// Tolerant fallback (same posture as ADR-0024): a lowercase/mixed-case "QST"
// keyword ("qst-a: Title") would otherwise fall through this AND the generic
// nav-code regexes (which need literal "QST:", no hyphen-id support) —
// shipping this grammar without a case-tolerant fallback would reopen the
// exact silent-drop hole it exists to close, just spelled differently.
const QST_HANDLE_TOLERANT_RE = /^qst-([\p{L}\p{N}](?:[\p{L}\p{N}-]{0,22}[\p{L}\p{N}])?):\s*(.*)$/iu;
// Recall floor for handle-SHAPED headings whose id fails the grammar
// ("QST-BAD_CHARS:", "QST--X:", an over-long id): before 2026-07-16 these
// matched NOTHING — not the handle regexes, not the generic nav-code
// regexes (which require "QST:" with no hyphen), not even
// NONSTANDARD_QST_HEADING_RE — a total silent drop, discovered while
// investigating the counterfeit-id incident. The QST token is present; the
// question must appear (recall-first, ADR-0031 element 1), wearing a
// model-facing warning about the id instead of vanishing.
const QST_HANDLE_MALFORMED_RE = /^QST-([^\s:]{1,64}):\s*(.*)$/iu;
// Space-separated ordinal — "### QST 1: title" (system3 ADR-0046, 2026-07-19:
// eight questions invisible, zero warnings — matched neither the colon form,
// the hyphen handle, nor the malformed net, which requires the hyphen). The
// interpolation source is the template ITSELF: "### Iteration 1 (date)" is
// space-number, and prose cross-references read "see QST 6" — the author
// regularized the handle toward the template's own sibling convention.
// Recalled with full handle semantics (id folded, anchor stable) + a
// fix-it warning toward the canonical hyphen form.
const QST_HANDLE_SPACED_RE = /^QST\s+([\p{L}\p{N}](?:[\p{L}\p{N}-]{0,22}[\p{L}\p{N}])?)\s*:\s*(.*)$/iu;
// Annotated form — "### QST (Iteration 2): title" (Facet 5, 2026-07-27
// dispatch: broken cross-repo tour, root-caused in a system3-conversations
// ADR). The parenthetical is neither a handle id (QST_HANDLE_SPACED_RE
// requires a pure alnum token, not "(...)") nor adjacent-colon nav-code
// form — before this, it matched NOTHING in this cascade at all: no
// handle, no nav-code, not even the generic tolerant form, so the heading
// carried no navCode and the question was a TOTAL SILENT DROP (confirmed
// live: 0 questions, 0 warnings) — worse than the slug-only bug this was
// first reported as. Separator class mirrors QST_HEADING_LINE_RE's own
// tolerance (hyphen OR whitespace) so the two can't drift the way this
// class of bug already did once (see resolveNavHeadingIdentity below).
const QST_HEADING_ANNOTATED_RE = /^QST[-\s]([^:]{1,64}):\s*(.*)$/i;

/**
 * NFD-normalize, strip combining marks (diacritics), uppercase, keep only
 * [A-Z0-9-] — "QST-JÉRÉMIE" → "JEREMIE" (HQ ADR-0012 Iteration 2, "fold,
 * don't forbid": authoring with accents is accepted input; the substrate
 * files with its spine, not the author's keyboard). Hyphens are retained
 * since the 2026-07-16 widening (see the inline note below); re-bounded to
 * 24 chars after folding — combining-mark stripping only shortens in
 * practice, but this keeps the bound explicit rather than assumed.
 */
export function foldQstId(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks (U+0300-U+036F)
    .toUpperCase()
    // Hyphens RETAINED (2026-07-16 widening, ADR-0032 QST-IDCHARSET):
    // stripping them would collapse distinct ids ("RE-CALL" vs "RECALL")
    // and break the visible↔anchor mapping — the folded id IS the anchor
    // ("qst-status-authority"). Re-bounded to 24 after folding, then
    // edge-hyphens trimmed so a slice can never mint a boundary hyphen
    // the grammar itself forbids.
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 24)
    .replace(/^-+|-+$/g, '');
}

// Trailing alias handle — "### QST: Should the Rust service be a gRPC
// server too? (QST-RUST-GRPC-SERVER)" (founder Report, companion etude,
// 2026-09-13: "I am curious whether the QST petnames in parenthesis at the
// end are parsed and part of the metadata?" — answer was no; 167 wild
// headings across 4 repos). Ruled A-amended by Riddle 5, 2026-09-26 (ledger
// row, six clauses); this is clause 3's grammar: `\(QST-<handle charset,
// 1–24>\)` at END OF LINE only — a mid-text "(QST-…)" parenthetical stays
// content. The capture is deliberately liberal (\p{M} admits NFD combining
// marks, so an NFD-typed "é" still reads); ALIAS_HANDLE_GRAMMAR_RE then
// validates the NFC-normalized id against the SAME charset/bounds as the
// leading QST_HANDLE_RE, and foldQstId is the SAME fold — one fold, no
// second recognition path. Case-insensitive read ("(qst-foo)").
const TRAILING_ALIAS_HANDLE_RE = /\s*\(QST-([\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}-]{0,63})\)\s*$/iu;
const ALIAS_HANDLE_GRAMMAR_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,22}[\p{L}\p{N}])?$/u;

interface TrailingAliasHandle {
  /** Author-typed id, NFC-normalized (for diagnostics). */
  rawId: string;
  /** foldQstId(rawId) — the same fold a leading handle gets. */
  folded: string;
  /** Anchor the alias resolves by: "qst-" + lowercase(folded). */
  aliasSlug: string;
  /** The heading text with the trailing "(QST-…)" removed (display text). */
  stripped: string;
}

/**
 * Pure function of the heading text's bytes — no document state, so the
 * result can never depend on edit history (clause 1's deterministic-id
 * rule). Null for anything outside the grammar (over-long, boundary hyphen,
 * bad characters, an id that folds to nothing, or a heading that would be
 * left with no text): those stay content, exactly as before this dialect
 * was recognized.
 */
function extractTrailingAliasHandle(text: string): TrailingAliasHandle | null {
  const m = TRAILING_ALIAS_HANDLE_RE.exec(text);
  if (!m) return null;
  const rawId = m[1].normalize('NFC');
  if (!ALIAS_HANDLE_GRAMMAR_RE.test(rawId)) return null;
  const folded = foldQstId(rawId);
  if (!folded) return null;
  const stripped = text.slice(0, m.index).trimEnd();
  if (stripped.trim() === '') return null;
  return { rawId, folded, aliasSlug: `qst-${folded.toLowerCase()}`, stripped };
}

export function detectFormat(tokens: ReturnType<typeof tokenize>): FormatDetectionResult {
  const headings = tokens
    .filter((t): t is ReturnType<typeof tokenize>[number] & { kind: 'heading' } => t.kind === 'heading')
    .map(t => t.text);

  const signals: string[] = [];

  // Strong signal: any heading that starts with a nav code
  if (headings.some(h => NAV_CODE_HEADING_RE.test(h))) {
    signals.push('nav-code-heading');
  }

  const collabSignals = COLLAB_ADR_LEAN_SIGNALS.filter(s => headings.includes(s));
  if (collabSignals.length > 0) {
    signals.push(...collabSignals.map(s => `collab-section:${s}`));
  }

  const madrSignals = MADR_STANDARD_SIGNALS.filter(s => headings.includes(s));
  if (madrSignals.length > 0) {
    signals.push(...madrSignals.map(s => `madr-section:${s}`));
  }

  if (signals.some(s => s === 'nav-code-heading' || s.startsWith('collab-section'))) {
    return { format: 'adr', confidence: 'high', signals };
  }

  if (madrSignals.length >= 2) {
    return { format: 'madr-standard', confidence: 'high', signals };
  }

  if (madrSignals.length === 1) {
    return { format: 'madr-standard', confidence: 'medium', signals };
  }

  // Has at least a title + some content?
  const hasTitle = tokens.some(t => t.kind === 'heading' && t.level === 1);
  const hasContent = tokens.some(t => t.kind === 'heading' && t.level === 2);
  if (hasTitle && hasContent) {
    return { format: 'madr-partial', confidence: 'low', signals: ['has-title-and-sections'] };
  }

  return { format: 'unknown', confidence: 'low', signals: ['no-structure-detected'] };
}

// ---------------------------------------------------------------------------
// Metadata extraction (from header bullet list)
// ---------------------------------------------------------------------------

// Matches: - **Key**: value  OR  - **Key (with spaces)**: value
const BOLD_BULLET_RE = /^-\s+\*\*([^*:]+)\*\*:\s+(.+)$/;
// Matches: - Key: value  (dash bullet, unbold key — ADR-0014 D6.5 MISSING_BOLD_ON_PREAMBLE_FIELD)
const DASH_PLAIN_BULLET_RE = /^-\s+([^*:]+):\s+(.+)$/;
// Matches: * Key: value  (old-style MADR)
const PLAIN_BULLET_RE = /^\*\s+([^:]+):\s+(.+)$/;

interface ExtractedMetadata {
  date?: string;
  iteration: number;
  /** 1-indexed line of the header's own "- **Iteration**: N" field — ADR-0043 H1 (counter drift) points diagnostics here. */
  iterationLine?: number;
  status?: AdrStatus;
  scopeRemaining?: string;
  awaiting?: string;
  awaitingCondition?: { adr: string; predicate: string };
  deciders: string[];
  warnings: ParseWarning[];
}

// ADR-0014 Iteration 2: "- **Awaiting**: ADR-0035 == implemented" (or "ADR 0035", "== accepted", etc.)
const AWAITING_DSL_RE = /^ADR[-\s]?(\d+)\s*==\s*(.+)$/i;

function splitRoster(value: string): string[] {
  if (value.includes(';')) return value.split(';').map(s => s.trim()).filter(Boolean);
  const parts: string[] = [];
  let depth = 0, current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; }
    else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

function extractMetadata(tokens: Token[], lineOffset = 0): ExtractedMetadata {
  const result: ExtractedMetadata = { iteration: 1, deciders: [], warnings: [] };

  for (const token of tokens) {
    if (token.kind !== 'body') continue;
    const text = token.text.trim();
    if (!text.startsWith('-') && !text.startsWith('*')) continue;

    let key: string | undefined;
    let value: string | undefined;

    const boldMatch = text.match(BOLD_BULLET_RE);
    if (boldMatch) {
      key = boldMatch[1].toLowerCase().trim();
      value = boldMatch[2].trim();
    } else {
      // ADR-0014 D6.5 MISSING_BOLD_ON_PREAMBLE_FIELD: field present, key unbold
      // ("- Status: Draft"). Postel's Law (ADR-0012): accept and extract the
      // value silently here — no ParseWarning, the field IS present, it's a
      // format deviation the normalizer's D6.5 handler proposes fixing.
      const dashPlainMatch = text.match(DASH_PLAIN_BULLET_RE);
      if (dashPlainMatch) {
        key = dashPlainMatch[1].toLowerCase().trim();
        value = dashPlainMatch[2].trim();
      } else {
        const plainMatch = text.match(PLAIN_BULLET_RE);
        if (plainMatch) {
          key = plainMatch[1].toLowerCase().trim();
          value = plainMatch[2].trim();
          result.warnings.push({
            code: 'BULLET_FORMAT',
            message: `Metadata field "${plainMatch[1]}" uses "* Key:" format instead of "- **Key**:". This may render poorly in some markdown viewers.`,
            line: token.line,
          });
        }
      }
    }

    if (!key || !value) continue;

    switch (key) {
      case 'date': result.date = value; break;
      case 'iteration': {
        const n = parseInt(value, 10);
        if (!isNaN(n)) { result.iteration = n; result.iterationLine = token.line; }
        break;
      }
      case 'status': {
        // Emphasis-robust enum (same class as the QST-level fix): a
        // document Status of "**Accepted**" is Accepted. Stripped before
        // the KNOWN check and before storage, so downstream consumers
        // (statusEmoji, filters) key on the bare token.
        const cleanedStatus = stripInlineEmphasis(value);
        if (cleanedStatus !== value) {
          result.warnings.push({
            code: 'EMPHASIZED_STATUS_VALUE',
            message: `ADR status "${value}" uses Markdown emphasis on the keyword. Recognized anyway (read as "${cleanedStatus}"). SUGGESTED: "- **Status**: ${cleanedStatus}"`,
            line: token.line,
          });
        }
        result.status = cleanedStatus;
        // INTENTIONALLY strict: do NOT add prefix-match tolerance here.
        // Even a "short" annotation like "Accepted (updated)" pollutes the status
        // taxonomy and sends the wrong signal — that ad-hoc annotations in the
        // status field are acceptable. The field encodes workflow state only.
        // The right fix is ADR-0014's D7 Socratic handler, which detects annotated
        // values and guides models toward structured alternatives (**Awaiting**:,
        // **Scope Remaining**:, etc.) instead of silently accepting them.
        // See: seed-2026-03-18-case-studies-on-models-experience-with-extension-feedback-ho.md
        if (!KNOWN_STATUS_VALUES.includes(cleanedStatus)) {
          result.warnings.push({
            code: 'UNKNOWN_STATUS',
            message: `ADR status "${cleanedStatus}" is not a recognized value. Known statuses: ${KNOWN_STATUS_VALUES.join(', ')}.`,
            line: token.line,
          });
        }
        break;
      }
      case 'deciders': {
        // Semicolon-separated rosters exist precisely BECAUSE entries carry
        // commas inside parentheticals ("Jérémie Lumbroso (charter,
        // sequencing call); Understudy 5 (Claude Sonnet 5, HQ — ...)").
        // The naive comma-split shredded such a roster into paren-fragments,
        // and inferAuthorFromDeciders then served a shard as an author chip
        // ("sequencing call); Understudy 5 (Claude Sonnet 5" — HQ ADR-0015
        // QST-7, 2026-07-25). Prefer ';' when present; otherwise split on
        // top-level commas only (never inside parentheses).
        result.deciders = splitRoster(value);
        break;
      }
      case 'scope remaining': {
        result.scopeRemaining = value;
        break;
      }
      case 'awaiting': {
        result.awaiting = value;
        const dslMatch = value.match(AWAITING_DSL_RE);
        if (dslMatch) {
          result.awaitingCondition = { adr: dslMatch[1], predicate: dslMatch[2].trim() };
        }
        break;
      }
    }
  }

  if (!result.status) {
    result.warnings.push({
      code: 'MISSING_STATUS',
      message: 'ADR is missing a status field (Draft, Proposed, Accepted, Partially Implemented, Implemented, or Superseded).',
    });
    result.status = 'Draft'; // default fallback
  }

  if (result.status && requiresScopeRemaining(result.status) && !result.scopeRemaining) {
    result.warnings.push({
      code: 'MISSING_SCOPE_REMAINING',
      message: 'Status is "Partially Implemented" but the header is missing "- **Scope Remaining**: ...". Add this line directly below the Status line in the header metadata block. A quick fix is available.',
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function sectionSlug(heading: string): string {
  // resolveNavHeadingIdentity() is the SAME cascade buildSection() uses to
  // assign navCode — sharing it is the fix for two drift incidents where
  // this function's own independent (hand-copied) cascade fell behind:
  // QST_HANDLE_MALFORMED_RE headings got a correct qstId in buildSection()
  // but slugged via the whole-heading fallback here (never reported
  // separately — found investigating the bug below), and
  // QST_HEADING_ANNOTATED_RE headings (Facet 5, 2026-07-27) matched
  // nothing here OR in buildSection(), a total silent drop.
  const match = resolveNavHeadingIdentity(heading);
  if (!match) {
    return slugify(heading);
  }
  // HQ ADR-0012: an explicit QST handle IS the default anchor — "qst-" +
  // lowercase(folded id) — takes priority over the generic nav-code slug
  // below (the whole point of an author-chosen id is a stable, predictable
  // anchor, not one derived from title wording that can drift).
  if (match.qstId !== undefined) {
    return `qst-${match.qstId.toLowerCase()}`;
  }
  // Nav code headings: "QST: What is the scope?" → "qst-what-is-the-scope"
  return slugify(`${match.code.toLowerCase()}-${match.text}`);
}

// ---------------------------------------------------------------------------
// ADR number extraction from filename
// ---------------------------------------------------------------------------

// ADR-0012: Accept any digit count (not just 4-digit) for variable-numbering projects.
const ADR_FILENAME_RE = /^(\d+)[-_]/;

export function extractAdrNumber(filePath: string): number {
  const basename = path.basename(filePath);
  const match = basename.match(ADR_FILENAME_RE);
  return match ? parseInt(match[1], 10) : 0;
}

/** True when the ADR filename uses a non-4-digit prefix (e.g., 001-foo.md or 1-foo.md). */
export function hasNonstandardNumbering(filePath: string): boolean {
  const basename = path.basename(filePath);
  const match = basename.match(ADR_FILENAME_RE);
  if (!match) return false;
  // Canonical form is exactly 4 digits
  return match[1].length !== 4;
}

// ---------------------------------------------------------------------------
// Section building
// ---------------------------------------------------------------------------

/** Look for <!-- @adr-anchor: slug --> on the line immediately after a heading */
const ANCHOR_COMMENT_RE = /^@adr-anchor:\s+(.+)$/;

/**
 * ADR-0032 QST-DISMISSAL-MARKER: `<!-- @adr-dismissed: <reason-slug> -->`
 * embedded IN the heading line itself (unlike @adr-anchor, which is its own
 * following body line) — e.g. "QST: What do we do? <!-- @adr-dismissed:
 * not-a-question -->". `<reason-slug>` matches the anchor-slug grammar
 * (`[a-z0-9][a-z0-9-]*`), same as @adr-anchor's own value grammar.
 */
const DISMISSAL_MARKER_RE = /\s*<!--\s*@adr-dismissed:\s*([a-z0-9][a-z0-9-]*)\s*-->/;

/**
 * Which deviation (if any) a heading's nav-code identity carries — drives
 * buildSection()'s per-tier warning message. sectionSlug() ignores this
 * entirely; it only needs the matched code/text/qstId below.
 */
type NavHeadingDeviation =
  | { kind: 'handle-lowercase'; rawId: string }
  | { kind: 'handle-spaced'; rawId: string }
  | { kind: 'handle-malformed'; rawId: string }
  | { kind: 'nav-tolerant'; rawCode: string }
  | { kind: 'nav-annotated'; annotation: string };

interface NavHeadingMatch {
  /** ADR-0012 handle id (any tier, already folded), when this heading carries an explicit QST handle. */
  qstId?: string;
  /** Recognized nav code, uppercased (QST/ANS/COD/API/FIL/DOC/NOT). */
  code: string;
  /** Text after the colon (or after the id, for handle forms) — untrimmed. */
  text: string;
  deviation?: NavHeadingDeviation;
}

/**
 * Single source of truth for "what nav-code identity does this heading
 * carry" — used by BOTH buildSection() (navCode assignment + warnings) and
 * sectionSlug() (anchor computation). These two used to maintain
 * independent, hand-copied cascades of the same regexes, and drifted apart
 * TWICE silently: once when QST_HANDLE_MALFORMED_RE was added to
 * buildSection() but never to sectionSlug() (a malformed-handle question
 * got a correct `qstId` but an ugly whole-heading slug instead of
 * `qst-<id>` — found while investigating the bug below, not separately
 * reported), and once with the QST_HEADING_ANNOTATED_RE class Facet 5
 * reported 2026-07-27 (which turned out to be a full silent DROP, not just
 * a bad slug — see that regex's own comment). Merging the two cascades
 * into one function makes this whole class of drift structurally
 * impossible: a future tolerance tier only needs to be added here once.
 */
function resolveNavHeadingIdentity(heading: string): NavHeadingMatch | null {
  const strictHandle = heading.match(QST_HANDLE_RE);
  if (strictHandle) {
    return { qstId: foldQstId(strictHandle[1]) || undefined, code: 'QST', text: strictHandle[2] };
  }
  const lowercaseHandle = heading.match(QST_HANDLE_TOLERANT_RE);
  if (lowercaseHandle) {
    return {
      qstId: foldQstId(lowercaseHandle[1]) || undefined, code: 'QST', text: lowercaseHandle[2],
      deviation: { kind: 'handle-lowercase', rawId: lowercaseHandle[1] },
    };
  }
  const spacedHandle = heading.match(QST_HANDLE_SPACED_RE);
  if (spacedHandle) {
    return {
      qstId: foldQstId(spacedHandle[1]) || undefined, code: 'QST', text: spacedHandle[2],
      deviation: { kind: 'handle-spaced', rawId: spacedHandle[1] },
    };
  }
  const malformedHandle = heading.match(QST_HANDLE_MALFORMED_RE);
  if (malformedHandle) {
    return {
      qstId: foldQstId(malformedHandle[1]) || undefined, code: 'QST', text: malformedHandle[2],
      deviation: { kind: 'handle-malformed', rawId: malformedHandle[1] },
    };
  }
  const strictNav = heading.match(NAV_CODE_HEADING_RE);
  if (strictNav) {
    return { code: strictNav[1].toUpperCase(), text: strictNav[2] };
  }
  const tolerantNav = heading.match(NAV_CODE_HEADING_TOLERANT_RE);
  if (tolerantNav) {
    return {
      code: tolerantNav[1].toUpperCase(), text: tolerantNav[2],
      deviation: { kind: 'nav-tolerant', rawCode: tolerantNav[1] },
    };
  }
  const annotatedQst = heading.match(QST_HEADING_ANNOTATED_RE);
  if (annotatedQst) {
    return {
      code: 'QST', text: annotatedQst[2],
      deviation: { kind: 'nav-annotated', annotation: annotatedQst[1] },
    };
  }
  return null;
}

/**
 * ADR-0018 (QST/ANS Substrate): exported so seedExtractor.ts can build a
 * section — including its navCode/heading-level checks — for a seed's
 * top-level (##) sections the same way parseAdr() does, not a narrower
 * reimplementation. See DEBRIEF (Lapidary 5, 2026-07-12): a seed extractor
 * that only descended into a fixed allowlist of top-level section names
 * (Thread/Brain Dump) silently dropped a correctly-formatted QST living
 * under any other heading (e.g. "## Lineage") — the same "one substrate,
 * two container kinds" principle this function already embodies for ADRs.
 */
export function buildSection(
  raw: RawSection,
  allSlugs: Set<string>,
  warnings: ParseWarning[],
  slugOccurrences: Map<string, number>,
): AdrSection {
  // ADR-0032 QST-DISMISSAL-MARKER: stripped BEFORE any downstream heading
  // work (nav-code matching, slug, warning messages) so a dismissal marker
  // can never leak into a slug, an anchor, or a quoted diagnostic message.
  // headingRaw (below) is computed from raw.heading.raw independently, so
  // round-trip serialization stays byte-faithful — only this semantic
  // `heading` loses the marker.
  const dismissalMatch = raw.heading.text.match(DISMISSAL_MARKER_RE);
  const dismissedReason = dismissalMatch?.[1];
  const heading = dismissedReason
    ? raw.heading.text.replace(DISMISSAL_MARKER_RE, '').trimEnd()
    : raw.heading.text;

  // HQ ADR-0012 / ADR-0024 / ADR-0031: every heading-shape tolerance this
  // extractor accepts lives in ONE cascade now (resolveNavHeadingIdentity),
  // shared with sectionSlug() below — never silently drop, never let the
  // two consumers of "what does this heading identify as" drift apart.
  const match = resolveNavHeadingIdentity(heading);
  const qstId = match?.qstId;

  // Trailing "(QST-PETNAME)" aliases are NOT handled here: whether one binds
  // depends on the whole document (cross-question collisions), so it lives
  // in resolveAliasHandles(), run by the callers once every section exists
  // — buildSection() never sets aliasSlug itself. (Ledger ruling
  // 2026-09-26, clause 2 as AMENDED: a leading handle owns identity, but no
  // longer refuses a trailing petname on the same heading — see there.)

  if (match?.deviation) {
    const d = match.deviation;
    switch (d.kind) {
      case 'handle-lowercase':
        warnings.push({
          code: 'NONCANONICAL_NAV_CODE_HEADING',
          message: `Heading "${heading}" was recognized as a QST handle but "QST" isn't uppercase. Recognized anyway — no data lost — but the canonical form is what other tools (deep links, MCP) expect. SUGGESTED: "QST-${foldQstId(d.rawId)}: ${match.text.trim()}"`,
          line: raw.heading.line,
        });
        break;
      case 'handle-spaced':
        warnings.push({
          code: 'NONCANONICAL_NAV_CODE_HEADING',
          message: `Heading "${heading}" was recognized as a QST handle written with a space ("QST ${d.rawId}:") instead of the canonical hyphen form. Recognized anyway — no data lost, anchor derived from the id — but the canonical form is what other tools (deep links, MCP, grep recipes) expect. SUGGESTED: "QST-${foldQstId(d.rawId)}: ${match.text.trim()}"`,
          line: raw.heading.line,
        });
        break;
      case 'handle-malformed': {
        // Recall floor (2026-07-16, ADR-0032 QST-IDCHARSET incident): a
        // handle-SHAPED heading whose id fails the grammar (bad chars,
        // boundary hyphen, over-long) still carries the QST token and MUST
        // appear — before this, it matched nothing anywhere and vanished
        // with zero warnings. The id is best-effort folded (a usable
        // anchor survives); the warning is the model-facing letter about
        // what to fix.
        const folded = foldQstId(d.rawId);
        warnings.push({
          code: 'MALFORMED_QST_HANDLE_ID',
          message: `Heading "${heading}" looks like a QST handle, but the id "${d.rawId}" doesn't conform to the handle grammar (1-24 characters, letters/digits with interior hyphens only). Recognized as a question anyway — never silently dropped — with the best-effort id "${folded || 'none'}". SUGGESTED: "QST-${folded || '<ID>'}: ${match.text.trim()}"`,
          line: raw.heading.line,
        });
        break;
      }
      case 'nav-tolerant':
        // Tolerant fallback (ADR-0024): recover navCode for headings that
        // only deviate in case or colon spacing, so the question doesn't
        // just disappear. The deviation itself is still surfaced — accept
        // liberally, warn always.
        warnings.push({
          code: 'NONCANONICAL_NAV_CODE_HEADING',
          message: `Heading "${heading}" was recognized as ${match.code} but doesn't match the canonical "${match.code}: text" form (case or colon spacing differs). Recognized anyway — no data lost — but the canonical form is what other tools (deep links, MCP) expect. SUGGESTED: "${match.code}: ${match.text.trim()}"`,
          line: raw.heading.line,
        });
        break;
      case 'nav-annotated':
        // Facet 5, 2026-07-27: "### QST (Iteration 2): ..." — the
        // parenthetical is neither a handle id nor adjacent-colon nav-code
        // form. Before QST_HEADING_ANNOTATED_RE existed, this was a total
        // silent drop (0 questions, 0 warnings, confirmed live) — worse
        // than the bad-slug bug it was first reported as.
        warnings.push({
          code: 'NONCANONICAL_NAV_CODE_HEADING',
          message: `Heading "${heading}" was recognized as QST, but "${d.annotation.trim()}" between "QST" and the colon isn't part of the canonical "QST: text" form (and isn't a recognized handle id either — see ADR-0012). Recognized anyway — no data lost — but the annotation is dropped from the anchor slug. SUGGESTED: either "QST: ${match.text.trim()}" or an explicit handle, "QST-<ID>: ${match.text.trim()}".`,
          line: raw.heading.line,
        });
        break;
    }
  }

  // Jérémie's ruling, dictated 2026-07-12 (Lapidary's dispatch, item 1):
  // a nav-code heading written at the wrong LEVEL ("## QST: ..." or
  // "#### QST: ...") should still parse — extractRawSections/buildSubsections
  // don't gate navCode matching on level, only on text — but the deviation
  // needs a LOUDER diagnostic than NONCANONICAL_NAV_CODE_HEADING's (that one
  // covers heading FORM: case/colon spacing; this is a different axis,
  // heading LEVEL) because a wrong-level QST is structurally riskier: at
  // level 2 it silently becomes its own top-level section boundary instead
  // of a child of whatever it was meant to nest under, which can reshape
  // the document's section tree, not just this one heading's recognition.
  // Mapped to DiagnosticSeverity.Warning (not Information) in extension.ts.
  if (match && raw.heading.level !== 3) {
    warnings.push({
      code: 'NONCANONICAL_NAV_CODE_LEVEL',
      message: `Heading "${heading}" was recognized as ${match.code} but is a level-${raw.heading.level} heading (${'#'.repeat(raw.heading.level)}) instead of the canonical level-3 (###). Recognized anyway — no data lost — but a wrong-level heading can silently reshape the surrounding section structure. SUGGESTED: "### ${heading}"`,
      line: raw.heading.line,
    });
  }

  let slug = sectionSlug(heading);
  let anchorOverride: string | undefined;

  // Scan the LEADING COMMENT RUN after the heading for an @adr-anchor —
  // not just the single first token. Hardened 2026-08-25 (Herald's AORP
  // circulation): the reserved channel now grows sibling markers
  // (@adr-fingerprint sits in the same after-heading slot), and the old
  // first-token-only check silently LOST the anchor whenever another
  // family member happened to precede it. Order-independent by design:
  // any @adr-* comment in the run may come in any order; the reader finds
  // the anchor wherever it sits in the run. (SPEC-adr-v1 §6 registry.)
  for (const tok of raw.body) {
    if (tok.kind === 'blank') continue;
    if (tok.kind !== 'html_comment') break;
    const anchorMatch = tok.content.match(ANCHOR_COMMENT_RE);
    if (anchorMatch) {
      anchorOverride = anchorMatch[1].trim();
      slug = anchorOverride; // override slug with explicit anchor
      break;
    }
  }

  // Check for duplicate slugs. Disambiguate with an occurrence ORDINAL, not
  // the raw heading line number (write-adversary CATCH 6, Quarry 5): a line
  // number shifts on any edit above this section — including edits that
  // have nothing to do with either duplicate — so it made Question.id
  // unstable across ordinary edits for duplicate-heading-text questions,
  // undermining anything that resolves a question by id later (writeAnswer's
  // re-resolution fix, and ADR-0021's MCP write tools' "id is stable" claim).
  // An ordinal only changes if a NEW duplicate is inserted before this one —
  // the same, narrower threat model draftKey.ts's occurrenceOrdinal already
  // accepts.
  if (allSlugs.has(slug)) {
    const ordinal = (slugOccurrences.get(slug) ?? 0) + 1;
    slugOccurrences.set(slug, ordinal);
    const unique = `${slug}-${ordinal}`;
    warnings.push({
      code: 'DUPLICATE_SLUG',
      message: `Two sections resolve to the same slug "${slug}". Using "${unique}" (duplicate occurrence ${ordinal}, line ${raw.heading.line}).`,
      line: raw.heading.line,
    });
    slug = unique;
  }
  allSlugs.add(slug);

  // Build body text (re-join body tokens, preserving blank lines)
  const bodyLines = raw.body.map(t => t.raw);
  const bodyRaw = bodyLines.join('\n');
  const body = bodyRaw.trim();

  const lineEnd = raw.body.length > 0
    ? raw.body[raw.body.length - 1].line
    : raw.heading.line;

  // Find nested subsections within the body (### and #### headings)
  const children = buildSubsections(raw.body, allSlugs, warnings, slugOccurrences);

  return {
    level: raw.heading.level,
    heading,
    navCode: match ? match.code as NavCode : undefined,
    navCodeText: match ? match.text.trim() : undefined,
    body,
    lineStart: raw.heading.line,
    lineEnd,
    slug,
    anchorOverride,
    dismissedReason,
    qstId,
    children,
    headingRaw: raw.heading.raw,
    bodyRaw,
  };
}

function flattenAllSections(sections: AdrSection[]): AdrSection[] {
  const out: AdrSection[] = [];
  for (const s of sections) {
    out.push(s, ...flattenAllSections(s.children));
  }
  return out;
}

/**
 * Trailing "(QST-PETNAME)" alias binding — the document-level half of the
 * ledger ruling (Riddle 5, 2026-09-26, clause 2 AMENDED same-day on the
 * etude-0058 specimen; founder Report 09-13, 167 wild headings). Run by
 * parseAdr() and extractSeedQuestions() after every section is built and
 * BEFORE questions are extracted from them, because whether a petname binds
 * depends on the whole file:
 *
 *  - Clause 1 (deterministic id): binding NEVER touches `slug` — the long
 *    slug (and so `Question.id`) stays what the heading's bytes alone
 *    derive, so a file's ids can't depend on which other questions exist or
 *    on edit history. A bound alias only ADDS `aliasSlug` and strips the
 *    "(QST-…)" from the DISPLAY text (`navCodeText`); `heading`/`headingRaw`
 *    are untouched. `qstId` is set from the alias ONLY when the heading had
 *    no handle of its own — a leading handle keeps its own `qstId`.
 *  - Clause 2, AMENDED (identity vs. addressability): the job is settling
 *    WHICH handle owns identity, never killing the durable name. A leading
 *    handle always owns `qstId`/`id` (unchanged) — but a trailing petname on
 *    the SAME heading is now ALWAYS ALSO a secondary alias (resolves,
 *    strips from display): `### QST-1: text (QST-PEEK-TASKFIT)` binds BOTH.
 *    Refusal survives only for a petname aimed at ANOTHER heading's own
 *    identity: two questions claiming one petname bind NEITHER (ambiguity
 *    refuses, never last-wins); a petname equal to a DIFFERENT section's own
 *    slug/`@adr-anchor` doesn't bind either — downgraded from a hard
 *    collision to a SUGGESTED fold-into-leading hint, since the petname
 *    never competed for identity in the first place.
 */
export function resolveAliasHandles(sections: AdrSection[], warnings: ParseWarning[]): void {
  const all = flattenAllSections(sections);

  const candidates: Array<{ section: AdrSection; alias: TrailingAliasHandle }> = [];
  for (const s of all) {
    if (s.navCode !== 'QST' || s.navCodeText === undefined) continue;
    const alias = extractTrailingAliasHandle(s.navCodeText);
    if (alias) candidates.push({ section: s, alias });
  }
  if (candidates.length === 0) return;

  // Anchor OWNERSHIP, not a bare reserved set: a petname aimed at a
  // heading's OWN slug/anchor (the same-heading leading+trailing case,
  // or the degenerate "(QST-STORE)" on the heading that already IS
  // qst-store) is a no-op/self-reference, never a collision — only a
  // petname matching ANOTHER section's identity is refused.
  const ownerOf = new Map<string, AdrSection>();
  for (const s of all) {
    ownerOf.set(s.slug, s);
    if (s.anchorOverride) ownerOf.set(s.anchorOverride, s);
  }

  const byAlias = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const group = byAlias.get(c.alias.aliasSlug) ?? [];
    group.push(c);
    byAlias.set(c.alias.aliasSlug, group);
  }

  for (const [aliasSlug, group] of byAlias) {
    if (group.length > 1) {
      const lines = group.map(c => c.section.lineStart).join(', ');
      for (const c of group) {
        warnings.push({
          code: 'ALIAS_HANDLE_COLLISION',
          message: `${group.length} questions in this file (lines ${lines}) claim the trailing handle "(QST-${c.alias.rawId})" — ambiguity refuses: NONE of them binds "#${aliasSlug}" (never last-wins). Each keeps its title text and its own id unchanged. SUGGESTED: give each question a distinct petname.`,
          line: c.section.lineStart,
        });
      }
      continue;
    }
    const { section, alias } = group[0];
    const owner = ownerOf.get(aliasSlug);
    if (owner && owner !== section) {
      warnings.push({
        code: 'ALIAS_HANDLE_COLLISION',
        message: `The trailing handle "(QST-${alias.rawId})" would bind "#${aliasSlug}", but that is already another heading's own identity in this file (its leading handle or @adr-anchor). It does NOT bind; the heading keeps its title text and its own id unchanged. SUGGESTED: fold this petname into that heading's own leading handle instead, or pick a distinct one.`,
        line: section.lineStart,
      });
      continue;
    }
    section.aliasSlug = aliasSlug;
    if (section.qstId === undefined) section.qstId = alias.folded; // a leading handle keeps owning identity
    section.navCodeText = alias.stripped.trim();
  }
}

/**
 * ADR-0018 (QST/ANS Substrate): exported so seedExtractor.ts can build the
 * same nav-code-aware section tree (with ADR-0024's heading tolerance) over
 * a seed's Brain Dump / Thread body tokens — container-agnostic reuse
 * rather than a parallel reimplementation.
 */
// Block-extent tail-swallow (Lapidary 5, 2026-07-13, grammar-seed +
// temp/0011 specimens): a subsection's body previously ran until the NEXT
// level>=3 heading — fine when one exists, but the LAST subsection in an
// enclosing section has no such heading to stop it, so its body ran all
// the way to the enclosing section's own end. For a seed's last QST, that
// swallowed the trailing "---" divider, the "**Model Response Request:**"
// checkbox block, and everything after — Jérémie: "the last question then
// parsed the dash-dash-dash that separates, with the checkbox... I think
// none of my questions were parsed accurately." Same conservative-clamp
// discipline as the h2-tolerance guard: block extent should stop at ANY
// structural boundary, heading or not. A bare thematic break ("---",
// "***", "___" — the template's own between-questions divider, never
// legitimately part of a question's own content) is exactly that boundary.
const THEMATIC_BREAK_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;

export function buildSubsections(
  bodyTokens: Token[],
  allSlugs: Set<string>,
  warnings: ParseWarning[],
  slugOccurrences: Map<string, number> = new Map(),
): AdrSection[] {
  const subsections: AdrSection[] = [];
  let current: { heading: ReturnType<typeof tokenize>[number] & { kind: 'heading' }; body: Token[] } | null = null;

  for (const token of bodyTokens) {
    if (token.kind === 'heading' && token.level >= 3) {
      if (current) {
        subsections.push(buildSection(
          { heading: current.heading, body: current.body },
          allSlugs,
          warnings,
          slugOccurrences,
        ));
      }
      current = { heading: token, body: [] };
      continue;
    }
    if (current && token.kind === 'body' && THEMATIC_BREAK_RE.test(token.text)) {
      subsections.push(buildSection(
        { heading: current.heading, body: current.body },
        allSlugs,
        warnings,
        slugOccurrences,
      ));
      current = null;
      continue;
    }
    if (current) {
      current.body.push(token);
    }
  }
  if (current) {
    subsections.push(buildSection({ heading: current.heading, body: current.body }, allSlugs, warnings, slugOccurrences));
  }

  return subsections;
}

// ---------------------------------------------------------------------------
// Question extraction
// ---------------------------------------------------------------------------

// Matches: **ANS:** (by Author) or **ANS:** (from Author)
// Attribution group is `[^)]*` — ZERO or more — so the empty-attribution
// scaffold "**ANS:** (by )" (models emit it constantly: the canonical
// two-line form with the author left blank) matches WITH its parenthetical
// consumed. Before 2026-07-19 the group required 1+ chars, "(by )" failed
// the whole optional group, and the literal text "(by )" leaked into
// answerLines as content — the leading "(" then defeated every
// whole-content placeholder regex, so `[Fill this in]` questions read as
// ANSWERED and vanished from the panel. Root-caused by Grafter 5 (HQ,
// 2026-07-14, sidebar-undercount brief), dispatched same-day class,
// recurred 2026-07-19 (HQ ADR-0015, six questions invisible) before the
// fix actually shipped — see DEBRIEF-007 for the dispatch-aging lesson.
// An empty/keyword-only capture is normalized to "no author" downstream.
// Marker QUALIFIER (2026-07-24, system3 ADR-0033 dialogue specimen): the
// wild layers Q&A rounds — "**ANS (to the updated recommendation):** (by
// Jérémie)" / "**Recommendation (updated)**: (by Herald 5)". The
// parenthetical INSIDE/beside the bold keyword is a qualifier (labels the
// round), positionally distinct from the attribution parenthetical. In all
// three markers: group 1 = qualifier, group 2 = attribution.
export const ANS_INLINE_RE = /^\*\*ANS(?:\s*\(([^)]*)\))?:\*\*\s*(?:\((?:by|from)\b\s*([^)]*)\))?/;
// ANS colon-outside-bold with inline attribution (Riddle 5's crossfoot
// ADR-0029 specimen, 2026-07-14): "**ANS** (by Jérémie): text" — the
// closing ** lands BEFORE the attribution and colon, mirroring the
// Recommendation inline-attribution form's exact shape one level up
// (**Recommendation** (by X): text — v0.7.5). ANS_INLINE_RE requires the
// colon INSIDE the bold ("**ANS:**"), so this matched nothing at all: no
// `answer` was ever set, and the human-authored answer sat as body text
// while whatever flipped isAnswered (declared Status) made the panel
// show the question as OPEN with no visible answer field content.
// Keyword-less attribution (2026-07-18, HQ mobile-clients seed specimen +
// the sweep's logged "**ANS** (Jérémie):" pattern): the by/from keyword is
// optional when the parenthetical sits BETWEEN the bold marker and the
// colon — that structural position is unambiguously attribution (unlike a
// parenthetical AFTER the marker, which can be content like "(see
// ADR-14)"; that position stays keyword-required).
const ANS_COLON_OUTSIDE_RE = /^\*\*ANS(?:\s*\(([^)]*)\))?\*\*\s*(?:\((?:(?:by|from)\b\s*)?([^)]*)\))?:\s*/;
// Matches: - Status: value
// Bold form ("- **Status**: value" — D2, Zoarium since March, crossfoot
// ADR-0029 specimen) tolerated alongside plain form; group 1 is always the
// value regardless of which form matched.
// EXPORTED ("one parser, N consumers", ratified 2026-07-14): the write
// paths' Status anchoring must use THIS definition, never a private copy —
// the panel's private `startsWith('- Status:')` couldn't see bold Status,
// so the append-ANS fallback refused a question the extractor itself had
// surfaced (crossfoot ADR-0030 incident, 2026-07-16).
export const STATUS_LINE_RE = /^-\s+(?:\*\*Status\*\*|Status):\s+(.+)$/;
const STATUS_LINE_BOLD_RE = /^-\s+\*\*Status\*\*:/;
// Raw-LINE form of "a heading the extractor reads as a QST" — any level
// (level tolerance is NONCANONICAL_NAV_CODE_LEVEL's lane), case-tolerant,
// optional handle id. For line-based write-path scans that need a question
// BOUNDARY without re-tokenizing; kept beside its heading-text cousins
// (NAV_CODE_HEADING_TOLERANT_RE / QST_HANDLE_RE) so the definitions can't
// drift apart. Same export rationale as STATUS_LINE_RE above.
// The id joint accepts hyphen OR whitespace (spaced-ordinal tolerance,
// system3 ADR-0046) — a boundary false-positive on a prose "QST …:" heading
// is conservative-safe (clamps a write scan early); a false-negative is the
// wrong-question-write hazard.
export const QST_HEADING_LINE_RE = /^#{1,6}\s+QST(?:[-\s][^:]{0,64})?:/iu;
// Annotated status value (Naturalist's status-with-annotation dialect,
// ~20 docs across a 1,061-doc survey; crossfoot ADR-0029: "answered
// 2026-07-13 (registrar implicit — ...)"). isAnswered's exact `=== 'answered'`
// check failed on this — real ADRs annotate the value with a date/reason.
// Leading-token match: the value must START with the canonical token
// (word boundary), tolerating trailing annotation for display.
const ANSWERED_LEADING_TOKEN_RE = /^answered\b/i;

/**
 * ADR-0036 ("Unresolved: Returning the Ball", Riddle 5, ratified 2026-07-29):
 * the fourth status token — open, but the ball is in the MODEL's court (the
 * human has contributed content; the next move is the model's). Exported
 * so every consumer (the MCP court filter, the panel's future visibility
 * attributes) matches the SAME leading-token rule rather than each growing
 * a private copy — the exact class of drift this project keeps re-learning
 * the cost of. No change to `isAnswered`/read-side needed beyond this: the
 * hide-allowlist doctrine already reads an unrecognized-as-closing token as
 * open, so `unresolved` was already open before this constant existed —
 * this just gives consumers a way to recognize WHICH open state it is.
 */
export const UNRESOLVED_LEADING_TOKEN_RE = /^unresolved\b/i;

/**
 * Markdown-emphasis robustness for KEYWORDS (Jérémie's ruling, 2026-07-22,
 * caring-form ADR-0052: "- Status: **answered** (…)" read as open because
 * the leading-token check saw literal asterisks — "we should be robust to
 * formatting on the keyword. **accepted**, _accepted_ etc. should all be
 * accepted"). This is a CLASS, not an instance: everywhere the grammar
 * compares a token or enum value, authors will eventually emphasize it,
 * because emphasis is how Markdown authors express "this word is load-
 * bearing" — the exact words we're matching. One shared normalizer,
 * applied at every keyword-comparison site (question status, document
 * status, and via the wrapper-peeler for placeholders) — never at content
 * sites, where asterisks are data.
 */
// stripInlineEmphasis MOVED to statusInfo.ts (DEBRIEF-009) — re-exported below for all existing consumers.
export { stripInlineEmphasis } from './statusInfo';
// Matches: - Why asking: value
const WHY_ASKING_RE = /^-\s+Why asking:\s+(.+)$/;
// Matches: - Why deferring: value — the template's OWN second QST subtype
// (## Open Follow-ups, templates/adr.md — formerly collab-adr-lean.md — lines 167-176) used this field
// from the start and the parser never learned it: every Follow-up QST in
// the ecosystem lost its stated deferral reason in every structured view
// (Loftsman/ios-client, 2026-07-20 — found via a Jérémie regression
// report on the mobile dossier). A spec field, not a tolerance.
const WHY_DEFERRING_RE = /^-\s+Why deferring:\s+(.+)$/;
// Matches: - Need: value
const NEED_RE = /^-\s+Need:\s+(.+)$/;
// Matches the legacy form (**My recommendation**: text, ADR-0002 Iteration 3),
// the protocol form (**Recommendation**: (by Author, date), ADR-0019), and
// the inline-attribution form (**Recommendation** (by Author): text —
// Lapidary's charter, 2026-07-12, temp/0021 Athanor specimen: attribution
// lands BETWEEN the bold marker and the colon, not after it. The strict
// "colon right after **Recommendation**" form silently dropped this —
// no field matched, the whole line and everything after it until ANS fell
// through to rawBody as plain prose, and the recommendation vanished as a
// structured field (not a visible-loss bug, a silent-misclassification one:
// same nemesis, different shape). Group 1 (optional): the inline
// attribution text, used as an explicit `author` — see recMatch handling.
// Keyword-less inline attribution (2026-07-18, HQ mobile-clients seed —
// "**Recommendation** (Portolan 5, Claude Fable 5): text"): same
// between-bold-and-colon position rule as ANS_COLON_OUTSIDE_RE above; the
// captured attribution drives extent parity (recSpansParagraphs) exactly
// like the by/from form, per the v0.7.10 lesson.
const RECOMMENDATION_RE = /^\*\*(?:My recommendation|Recommendation)(?:\s+\(([^)]+)\))?\*\*(?:\s*\((?:(?:by|from)\s+)?([^)]+)\))?:\s*(.*)/;
// Protocol-form label lines carry only an attribution: "(by Fable 5, 2026-06-10)"
// or "(from Sonnet 4.6)". Their body spans blank lines (paragraphs), unlike
// legacy single-paragraph prose.
//
// Group 1 captures EVERYTHING between "by"/"from" and the FINAL closing
// paren — author/date splitting is a separate step (splitRecAttribution
// below), not baked into this regex. The previous version excluded `)`
// from the author-name character class to stop at the "real" close paren
// before an optional ", date" — which breaks the moment the author name
// itself contains a paren (our own fixture, Lapidary 5, 2026-07-15/16,
// docs.../0002-primary-datastore.md: "(by Sonnet 4.6 (1M), 2026-06-10)").
// `[^,)]+?` cannot span the nested "(1M)" at all — the whole regex failed
// to match, recProtocolForm computed false, and the entire multi-paragraph
// recommendation body escaped past the first blank line into rawBodyPost,
// rendering unstyled below the (attribution-only) green block. `.+` has no
// such exclusion, so it spans nested parens; `\)\s*$` still anchors to the
// true final close paren since only one position lets the greedy match
// reach end-of-string.
const REC_ATTRIBUTION_RE = /^\((?:by|from)\s+(.+)\)\s*$/i;
// A trailing ", YYYY-MM-DD" on the captured attribution is the date;
// everything before it is the author, however many parens it contains.
const REC_ATTRIBUTION_DATE_RE = /^(.*?),\s*(\d{4}-\d{2}-\d{2})\s*$/;

function splitRecAttribution(raw: string): { author: string; date?: string } {
  const dateMatch = raw.match(REC_ATTRIBUTION_DATE_RE);
  if (dateMatch) return { author: dateMatch[1].trim(), date: dateMatch[2].trim() };
  return { author: raw.trim() };
}
// ADR-0019 QST-1: legacy `**My recommendation**:` blocks infer attribution
// from the ADR's Deciders line (single-AI ADRs dominate the legacy corpus).
const AI_AUTHOR_RE = /sonnet|opus|haiku|claude|gpt|gemini|llama|mistral|fable/i;

// Dash-bullet field form (Lapidary 5, 2026-07-13, temp/0015-database-schema.md
// specimen): "- Recommendation: text" or "- Recommendation (Author): text" —
// a plain dash-bullet field, not the canonical standalone "**Recommendation**:"
// block. Lapidary's diagnosis: the model regularized toward LOCAL
// consistency — three dash-bullet fields in a row (Status/Why asking/Need)
// invite a fourth, so the block-form Recommendation gets flattened into the
// same shape as its neighbors. Before this fix it matched neither
// RECOMMENDATION_RE nor any other field regex, so it fell through to raw
// prose: unstyled, unattributed (a real DMA/§1 attribution loss, not just a
// cosmetic one), and absent from `recommendations[]` entirely.
// Bold tolerance added 2026-07-30 (system3 etude ADR-0056 ×3, same live
// report as the dash-bullet ANS): "- **Recommendation** (builder-47): **B**
// — …" — the bullet form with the keyword bolded, which the un-bolded
// original never matched, so the whole recommendation rendered as question
// body text. Colon stays REQUIRED (an optional colon would false-positive
// on prose like "- Recommendation for later…"); group indices unchanged.
const RECOMMENDATION_BULLET_RE = /^-\s+(?:\*\*)?Recommendation(?:\*\*)?(?:\s*\(([^)]+)\))?\s*:\s*(.*)/i;

// ADR-0012: the canonical placeholder — tolerated silently, no diagnostic.
// "out" variant added 2026-07-26: Jérémie SAYS "fill this out" (his 07-25
// charter message), and Riddle 5 then TYPED the spoken form into ADR-0036's
// four QSTs — the seat whose whole program is format interpolation
// interpolated the placeholder. Both prepositions are the same intent;
// enumerating them here is cheaper than every future transcription drifting.
const PLACEHOLDER_CANONICAL_RE = /^\[\s*fill\s+this\s+(?:in|out)[^\]]*\]$/i;
// D9.4 (live specimen, 2026-07-10, temp/0011-agent-sessions-json-linter-…):
// models sometimes emit a *different* stock placeholder token — inline
// "**ANS:** [unanswered]" instead of "**ANS:**" + newline + "[Fill this
// in]". Before this fix, none of these matched PLACEHOLDER_CANONICAL_RE, so
// the bracketed text became a real `answer` → isAnswered: true → the
// question silently vanished from the Open Questions panel *as done*
// (ADR-0024's founding bug in the opposite direction: there a question
// vanished as nonexistent, here it vanishes as answered). Whole-content-only
// (anchored ^...$) so a real answer that happens to reference something in
// brackets — "[see ADR-0014]" — is never misread as a placeholder; only a
// body that IS one of these stock tokens, and nothing else, counts.
// "awaiting" added 2026-07-12 (Quarry 5, ecosystem sweep, llm-orchestration-
// mcp/lyrical-mcp specimen — corpus zoo-005): "[Awaiting answer]", a fifth
// stock token. Confirms the lexicon design in ADR-0031: an enumerable list
// is always one incident behind, but naming the CLASS (a wait-state word,
// wrapped or bracketed) at least means adding a word is a one-line change,
// not a new regex.
const PLACEHOLDER_SYNONYM_RE = /^\[\s*(unanswered|to be answered|to be filled|tbd|pending|todo|awaiting)[^\]]*\]$/i;
// Bug report (2026-07-12, Jérémie, temp/0048-mcp-support-rfc-connecting-
// external-tool-servers.md): a bare "[ ]" (or "[]") is a placeholder too —
// no stock word, just an empty box, and apparently a common one. A separate,
// tightly-scoped regex rather than widening PLACEHOLDER_SYNONYM_RE's group
// to match empty: that regex's trailing `[^\]]*` exists to tolerate extra
// words after the stock token, and letting the group itself match nothing
// would make `[^\]]*` swallow ANY bracketed text ("[see ADR-0014]") as a
// placeholder — exactly the false positive the whole-content-only anchoring
// on both regexes is designed to prevent.
const PLACEHOLDER_EMPTY_RE = /^\[\s*\]$/;

// D9.4 morphology #4 (Lapidary's charter, 2026-07-12, temp/0021-crew-
// architecture-and-staffing.md — Athanor 5 specimen): "_(pending)_" — no
// brackets at all, just italics wrapping a parenthesized stock word. Every
// prior D9.4 regex is bracket-anchored (PLACEHOLDER_CANONICAL_RE/_SYNONYM_RE/
// _EMPTY_RE all start `^\[`), so a bracket-free wrapped placeholder matched
// none of them, became a real `answer`, and the QST silently vanished as
// answered — even though "- Status: unanswered" was declared correctly
// right there in the same block (the declared-vs-derived conflict Lapidary's
// posture charter names directly). stripPlaceholderWrapper() peels ONE
// layer of italic (_..._ / *...*) and ONE layer of parens, in either
// combination, then the lexicon check runs ONLY on text that actually HAD
// at least one wrapper — never on bare unwrapped prose, so a real short
// answer like "Pending on budget approval" is never misread (no wrapper to
// strip → not eligible). Whole-content-only, same discipline as the
// bracket forms.
// "fill (this) in" added 2026-07-13 (Riddle 5, ADR-0031 implementation
// plan §5 Phase A′): zoo-001/zoo-003's real specimen "**ANS:** (fill in)"
// already peels to "fill in" via stripPlaceholderWrapper (paren-wrapped,
// no italics) — it just wasn't in the lexicon, so it read as a real
// answer. Wrapped-only + whole-content anchoring (inherited from the
// caller) keep the false-positive surface unchanged: bare "fill in the
// form below" prose is never eligible (no wrapper to strip).
export const PLACEHOLDER_LEXICON_RE = /^(?:unanswered|to be answered|to be filled|tbd|todo|pending|awaiting|fill(?:\s+this)?\s+(?:in|out))\b.*$/i;

/**
 * "One parser, N consumers" predicates (2026-07-26). The write scan
 * (answerWriteScan.ts) carried PRIVATE narrower copies of both of these
 * recognitions — ANS_INLINE_RE only for headers (blind to the colon-outside
 * form THIS file has read tolerantly since crossfoot ADR-0029), and a
 * canonical-only fill regex (blind to every synonym/wrapped placeholder
 * this classifier accepts). Result: questions the extractor surfaced were
 * unwritable or mis-anchored — Jérémie's "inability to insert answers is
 * becoming really almost omnipresent" (2026-07-26). These exports ARE the
 * recognition; the scan may not re-derive it.
 */
/**
 * Strip a leading list-bullet from an ANS marker line — the dash-bullet ANS
 * dialect ("- **ANS**: (by Jérémie) [unanswered]", system3 etude ADR-0056
 * ×3, Jérémie's frustrated live report 2026-07-30: the whole field rendered
 * INSIDE the question text because every ANS regex is line-start anchored).
 * Models writing QST blocks as uniform bullet lists put ANS on a bullet
 * like every sibling field — same interpolation pressure as the dash-bullet
 * Recommendation form (recognized since v0.7.9). Scoped to bold ANS forms
 * only; a plain-prose list item starting "- ANS..." stays content.
 */
function debulletAnsLine(line: string): string {
  const m = line.match(/^-\s+(?=\*\*ANS)/);
  return m ? line.slice(m[0].length) : line;
}

/**
 * Document-level pause (Riddle ruling, 2026-08-06, founder Report on HQ
 * ADR-0009: "This ADR is 'deferred' or suspended or whatever, but the
 * questions still popup... we're creating a 'focus' machine"). A document
 * whose declared Status LEADS with a pause token suspends its questions
 * from every human-facing surface (panel, tree children, badge counts) —
 * unconditionally, no setting; the escape hatch is editing one status
 * line. Census and parse output stay complete (recall-first: paused is
 * suppressed, never invisible to machinery). Leading-token-strict: a
 * parenthetical mention ("Proposed (deferred — …)") does NOT pause — the
 * canonical write is "- **Status**: Deferred — <why>". Composes with
 * ADR-0036's question grid: pause is deferred-by-inheritance at document
 * scope; QST-STATUS-VOCAB's eventual freeze should fold this vocabulary.
 */
/**
 * Question-level retirement (Riddle ruling, 2026-08-07, founder Report on
 * system3 0061: "we need a 'withdrawn | superseded' keyword for a question,
 * before it is answered" — hand-written ⚠️ WITHDRAWN heading annotations as
 * live specimens). Third arrival of the closed-vocabulary gap: document
 * pause (v0.7.68), seed closed-family (ADR-0041), now per-question. A
 * declared Status LEADING with withdrawn|superseded|moot RETIRES the
 * question: closed-without-an-answer — leaves every open count and human
 * surface, never counts as answered, stays parsed and census-visible.
 * Leading-token strict, same as the document rule; canonical write is
 * "- Status: withdrawn — <why>". Feeds QST-STATUS-VOCAB's freeze (the
 * register's closing-token question, now founder-evidenced from the field).
 */
export function isRetiredStatusToken(statusText: string | undefined): boolean {
  if (!statusText) return false;
  // Found auditing this function for the QST-STATUS-VOCAB council round
  // (2026-08-11): its sibling isDocumentPausedStatus() strips inline
  // emphasis before matching (v0.7.27's class fix — "**answered**"/
  // "_accepted_" must never defeat token matching) but this one, shipped
  // later (v0.7.69), never got the same tolerance. A bold-wrapped
  // "**withdrawn** — reason" silently failed to retire the question —
  // exactly the DEBRIEF-007-shaped silent-miss this vocabulary exists to
  // close, just reopened one level down by an asymmetry between two
  // near-identical functions.
  return /^(?:withdrawn|superseded|moot)\b/i.test(stripInlineEmphasis(statusText).trim());
}

export function isDocumentPausedStatus(status: string | undefined): boolean {
  if (!status) return false;
  const t = stripInlineEmphasis(status).trim().toLowerCase();
  return /^(?:deferred|paused|suspended|on[ -]hold)\b/.test(t);
}

/**
 * The frozen v1 spine (ADR-0021 Iteration 16, ADR-0032 QST-CORE's ratified
 * A2 enum): five enum tokens + four suspension states, or 'unknown'.
 * Deliberately does NOT include 'Proposed' — statusInfo.ts's broader
 * ADR_STATUSES/KNOWN_STATUS_VALUES list keeps it for tree-icon/UNKNOWN_STATUS
 * purposes, but the frozen normalization spine this function targets is
 * exactly the nine tokens the council ratified, nothing coined new.
 */
// NormalizedDocumentStatus + normalizeDocumentStatus MOVED HOME to statusInfo.ts
// (DEBRIEF-009: the icon lane kept a private exact-match while this lived here —
// a second recognition path). Re-exported so ADR-0021 It.16 consumers keep their import path.
export { normalizeDocumentStatus, type NormalizedDocumentStatus } from './statusInfo';

export function isAnsMarkerLine(line: string): boolean {
  const l = debulletAnsLine(line);
  return ANS_INLINE_RE.test(l) || ANS_COLON_OUTSIDE_RE.test(l);
}

/**
 * `**Follows up on**: <ref>` — the forward pointer from an answered
 * question to a follow-up question minted at the same time (Riddle's
 * brief, 2026-10-12, from the ADR-0064 QST-STREAM trial-answer specimen;
 * Docent's ruling: a sibling marker line, never folded into the ANS slot
 * itself — "every overload is a question that silently vanishes" is the
 * exact defect this feature exists to prevent, so the fix must not
 * recreate it).
 *
 * Tolerant, same reasoning as isAnsMarkerLine's bullet/colon variants
 * (Docent's review, same sitting, probed not asserted — a fourth
 * hand-rolled marker regex stricter than the other three is exactly how
 * the family drifts, v0.7.40's hand-copied-cascade lesson): the mint path
 * is the only writer TODAY, but the marker is about to be taught
 * (Docent's authoring prompt, Shipwright's ✗/✓ pair), and a hand-authored
 * line that fails to match falls straight into the ANS overload this
 * feature exists to prevent. Tolerates a leading bullet (debulletFollowUp
 * Line, same technique as debulletAnsLine), case, and a space before the colon.
 */
const FOLLOW_UP_MARKER_RE = /^\*\*follows up on\*\*\s*:\s*\S/i;
function debulletFollowUpLine(line: string): string {
  const m = line.match(/^-\s+(?=\*\*follows up on\*\*)/i);
  return m ? line.slice(m[0].length) : line;
}
export function isFollowUpMarkerLine(line: string): boolean {
  return FOLLOW_UP_MARKER_RE.test(debulletFollowUpLine(line.trim()));
}

/** Whole-content placeholder test — same composition finalizeAnswerLayer uses. */
/**
 * HTML comments are the format's reserved INVISIBLE channel (ADR-0032
 * framing 4 / CORE item (h)) — so they must be invisible to CONTENT
 * classification too. Found the hard way (Gleaner's first sweep, 2026-07-31,
 * two repos same day): the HQ template's own anti-paraphrase comment —
 * "[Fill this in] <!-- literal placeholder — parser-significant, do not
 * paraphrase -->" — defeated PLACEHOLDER_CANONICAL_RE's `\]$` anchor, so
 * the device protecting the placeholder made it read as a REAL answer
 * (silent false-answered + write refusals). Classification strips comments;
 * stored text keeps them (extents and prefill stay byte-faithful).
 */
function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

export function isPlaceholderAnswerText(text: string): boolean {
  const t = stripHtmlComments(text.trim());
  if (PLACEHOLDER_CANONICAL_RE.test(t) || PLACEHOLDER_SYNONYM_RE.test(t) || PLACEHOLDER_EMPTY_RE.test(t)) return true;
  const stripped = stripPlaceholderWrapper(t);
  return stripped.wrapped && PLACEHOLDER_LEXICON_RE.test(stripped.inner);
}

/**
 * Exported so the D9.4 normalizer handler (d9-4-nonstandard-fill-
 * placeholder.ts) can detect the SAME wrapped-placeholder morphology on its
 * own two-line "**ANS:**\n_(pending)_" form and offer a matching Quick Fix
 * — one placeholder-recognition rule, not two regexes drifting apart.
 */
export function stripPlaceholderWrapper(text: string): { inner: string; wrapped: boolean } {
  let s = text.trim();
  let wrapped = false;
  // N-layer peel (generalized 2026-07-22 with the emphasis-robustness
  // class fix — originally two fixed layers, italic then paren, which
  // missed bold ("**pending**") and code ("`tbd`") wrappers entirely, and
  // any composition deeper than one of each). Wrappers compose in any
  // order; peel until fixpoint.
  const LAYERS: Array<[RegExp, number]> = [
    [/^\*\*(.+)\*\*$/, 1],   // bold
    [/^([*_])(.+)\1$/, 2],   // italic (either marker)
    [/^`(.+)`$/, 1],          // inline code
    [/^\((.+)\)$/, 1],        // parens
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const [re, idx] of LAYERS) {
      const m = s.match(re);
      if (m) { s = m[idx].trim(); wrapped = true; changed = true; }
    }
  }
  return { inner: s, wrapped };
}

/**
 * Is `text` recognizable as nothing but a stock placeholder token — the
 * same three-way test `finalizeAnswerLayer()` uses to decide isAnswered,
 * extracted so the answer-collection loop can ask the SAME question
 * mid-collection (see the bold-key stop-check below) rather than growing
 * a second, drifting copy.
 */
function isPlaceholderOnly(text: string): boolean {
  text = stripHtmlComments(text);
  if (PLACEHOLDER_CANONICAL_RE.test(text)) return true;
  if (PLACEHOLDER_SYNONYM_RE.test(text) || PLACEHOLDER_EMPTY_RE.test(text)) return true;
  const stripped = stripPlaceholderWrapper(text);
  return stripped.wrapped && PLACEHOLDER_LEXICON_RE.test(stripped.inner);
}

function inferAuthorFromDeciders(deciders: string[]): string | undefined {
  const aiName = deciders.find(d => AI_AUTHOR_RE.test(d));
  if (!aiName) return undefined;
  // "Sonnet 4.6 (1M)" → "Sonnet 4.6" — strip a trailing parenthetical annotation.
  return aiName.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/** Bold first sentence at the start of a recommendation's text — the skimmable "lean". */
function extractPick(text: string): string | undefined {
  const m = text.match(/^\*\*([^*]+)\*\*/);
  return m ? m[1].trim() : undefined;
}

// ADR-0012: Detect non-standard QST formats like "### QST-1:" or "**Your preference?**"
const NONSTANDARD_QST_HEADING_RE = /^QST-\d+:/i;
const NONSTANDARD_PREF_RE = /^\*\*[^*]*(?:preference|choice|option)\??\*\*/i;

function detectNonstandardQstFormat(tokens: ReturnType<typeof tokenize>): boolean {
  for (const token of tokens) {
    if (token.kind === 'heading' && token.level === 3) {
      if (NONSTANDARD_QST_HEADING_RE.test(token.text)) return true;
    }
    if (token.kind === 'body') {
      const trimmed = token.text.trim();
      if (NONSTANDARD_PREF_RE.test(trimmed)) return true;
    }
  }
  return false;
}

/**
 * ADR-0021 Iteration 10 (Riddle 5, format ruling, 2026-07-26): fold a
 * question's separately-parsed recommendations and answer layers into
 * explicit rounds, by document order (line number) ALONE — qualifiers are
 * display-only and must never be consulted here. Fold rule: a round is
 * zero-or-more recommendations followed by at most one answer; an answer
 * CLOSES the current round; a recommendation appearing after an answer
 * OPENS a new round; an answer with no preceding recommendation is a round
 * with `recommendations: []`; trailing recommendations with no closing
 * answer at all become a final round whose `answer` is undefined — the
 * same "awaiting" shape as an empty trailing ANS placeholder (v0.7.32).
 * One fold, implemented once — `recommendations`/`answers` (plural, flat)
 * are derived FROM this, never computed independently, so the two can
 * never drift apart.
 */
function foldQuestionRounds(
  recommendations: Recommendation[],
  answerLayers: { qualifier?: string; author?: string; text: string; line: number; isReal: boolean }[],
): QuestionRound[] {
  type Event =
    | { line: number; kind: 'rec'; rec: Recommendation }
    | { line: number; kind: 'ans'; layer: (typeof answerLayers)[number] }
  const events: Event[] = [
    ...recommendations.map((rec): Event => ({ line: rec.line, kind: 'rec', rec })),
    ...answerLayers.map((layer): Event => ({ line: layer.line, kind: 'ans', layer })),
  ].sort((a, b) => a.line - b.line)

  const rounds: QuestionRound[] = []
  let currentRecs: Recommendation[] = []
  for (const event of events) {
    if (event.kind === 'rec') {
      currentRecs.push(event.rec)
      continue
    }
    const answer: RoundAnswer | undefined = event.layer.isReal
      ? { qualifier: event.layer.qualifier, author: event.layer.author, text: event.layer.text, line: event.layer.line }
      : undefined
    rounds.push({ recommendations: currentRecs, answer })
    currentRecs = []
  }
  if (currentRecs.length > 0) {
    rounds.push({ recommendations: currentRecs, answer: undefined })
  }
  return rounds
}

/**
 * ADR-0018 (QST/ANS Substrate): exported so seedExtractor.ts can extract
 * QST/ANS fields from a seed-embedded question the same way an ADR's
 * question is parsed — one field parser, two container kinds. `adrNumber`/
 * `adrPath` are seed-parlance-agnostic in practice (a source number and a
 * source path); seeds pass 0 and their own file path. `warnings` is
 * optional so existing/seed callers that don't yet thread a warnings array
 * through aren't forced to (ADR-0016-style: a real gap, not silently
 * assumed away — see the D9.4 fix note below).
 */
export function extractQuestion(
  section: AdrSection,
  adrNumber: number,
  adrPath: string,
  deciders: string[],
  warnings?: ParseWarning[],
): Question {
  // ADR-0039 §3 (found investigating SourceRange, not separately reported):
  // `section.body` is `.trim()`-med — whenever a QST section has ANY
  // leading blank line before its first real content (virtually every real
  // one: "### QST: ...\n\n- Status: ..." is the standard spacing), trimming
  // shifts `lines[0]` to the first NON-blank line, so `absLine =
  // section.lineStart + i + 1` below silently reports the wrong line for
  // EVERY warning in this function — off by exactly the trimmed leading-
  // blank-line count (verified: a standard single-blank-line QST block
  // reports its Status warning one line too early). `bodyRaw` (untrimmed,
  // ADR-0039 §2's round-trip field) has no such shift; falls back to
  // `body` only for hand-built test fixtures that bypass buildSection()
  // and never got bodyRaw populated.
  const lines = (section.bodyRaw ?? section.body).split('\n');
  let statusText = 'unanswered';
  // Whether a `- Status:` line was actually DECLARED in the block (vs the
  // default above). Load-bearing for Status-authority (below): declared
  // status is authoritative; the default is not a declaration.
  let statusDeclared = false;
  // ADR-0039 §3 (SourceRange, first slice): exact character span of the
  // Status VALUE, so a write tool can flip it with one surgical TextEdit
  // instead of a line-number find-replace + re-parse.
  let statusRange: SourceRange | undefined;
  let whyAsking: string | undefined;
  let whyDeferring: string | undefined;
  let need: string | undefined;
  let recommendation: string | undefined;
  let answer: QuestionAnswer | undefined;

  let inAnswer = false;
  let inRecommendation = false;
  // ADR-0019 interim bridge: protocol-form blocks span blank lines; legacy
  // blocks end at the first blank line (preserving ADR-0010 behavior).
  // `recProtocolForm` specifically means "the first body line is an
  // attribution-only line to strip" (block-building, below) — it must NOT
  // be reused for "should collection span multiple paragraphs," which is
  // `recSpansParagraphs` (Lapidary 5, 2026-07-13, rec-extent-escape fix):
  // the inline-attribution form ("**Recommendation** (by X): text") has
  // real content on its own first line, not an attribution-only line, so
  // conflating the two flags would make block-building wrongly strip that
  // first line of real content while trying to parse it as an attribution.
  let recProtocolForm = false;
  let recSpansParagraphs = false;
  // pastRecommendation: true once we have seen AND exited a recommendation block.
  // Lines before recommendation → rawBody (context/grammar/options).
  // Lines after recommendation → rawBodyPost (orphaned closing remarks).
  let pastRecommendation = false;
  // Multi-line field continuation: LLMs often word-wrap field values at ~80 chars.
  // A continuation line starts with whitespace (2-space indent) and is not a new
  // bullet field or block element. Join with ' ' (space) since it's word-wrapping.
  let inWhyAsking = false;
  let inWhyDeferring = false;
  let inNeed = false;
  // Base indentation of whichever of the three fields above is currently
  // open — the column its own "- Why asking:"/"- Need:"/"- Why deferring:"
  // marker started at. Mutually exclusive with the three flags above (only
  // one field is ever "in progress" at a time), so one shared variable is
  // enough. Used below to tell a genuinely NESTED list item (indented
  // further than the field itself) apart from a new SIBLING field at the
  // field's own column — see the fix note at isContinuation.
  let fieldBaseIndent = 0;
  const answerLines: string[] = [];
  // Dialogue layering (system3 ADR-0033, 2026-07-24): a QST block can hold
  // MULTIPLE answer rounds interleaved with updated recommendations
  // (rec -> ANS -> "Recommendation (updated)" -> "ANS (to the updated
  // recommendation)" ...). Each ANS marker starts a LAYER; a layer ends at
  // the next ANS or Recommendation marker. `answers` keeps the real
  // layers in order; `answer` (singular, back-compat) is the CURRENT
  // verdict: the last layer if real, undefined if the last layer is an
  // empty/placeholder slot (a re-ask awaiting its answer — which also
  // makes derived answered-ness correctly false for statusless files).
  const answerLayers: { qualifier?: string; author?: string; text: string; line: number; isReal: boolean }[] = [];
  let answerQualifier: string | undefined;
  const recommendationLines: string[] = [];
  // ADR-0019: index into recommendationLines where each new
  // **Recommendation**:/**My recommendation**: block starts, so the flat
  // array can be re-split into per-block Recommendation objects.
  const recommendationBlockStarts: number[] = [];
  // Parallel to recommendationBlockStarts: whether that block used the
  // protocol form (attribution-only first line), the marker's source line,
  // and an inline attribution captured directly off the marker line itself
  // (see inlineAttribution note at RECOMMENDATION_RE).
  const recommendationBlockMeta: { protocolForm: boolean; line: number; inlineAttribution?: string; qualifier?: string }[] = [];
  const rawBodyLinesPre: string[] = [];
  const rawBodyLinesPost: string[] = [];
  let answerAuthor: string | undefined;
  let answerLine: number | undefined;

  // Classify + close the current answer layer (placeholder logic identical
  // to the historical single-answer path — one classifier, N layers).
  const finalizeAnswerLayer = (): void => {
    if (answerLine === undefined) return;
    while (answerLines.length > 0) {
      const last = answerLines[answerLines.length - 1].trim();
      if (last === '---' || last === '') answerLines.pop();
      else break;
    }
    const answerText = answerLines.join('\n').trim();
    const classifiable = stripHtmlComments(answerText);
    const isCanonicalPlaceholder = PLACEHOLDER_CANONICAL_RE.test(classifiable);
    const isSynonymPlaceholder = !isCanonicalPlaceholder &&
      (PLACEHOLDER_SYNONYM_RE.test(classifiable) || PLACEHOLDER_EMPTY_RE.test(classifiable));
    const strippedAnswer = stripPlaceholderWrapper(classifiable);
    const isWrappedPlaceholder = !isCanonicalPlaceholder && !isSynonymPlaceholder &&
      strippedAnswer.wrapped && PLACEHOLDER_LEXICON_RE.test(strippedAnswer.inner);
    if ((isSynonymPlaceholder || isWrappedPlaceholder) && warnings) {
      warnings.push({
        code: 'NONSTANDARD_FILL_PLACEHOLDER',
        message: `The QST heading and structure here are correct — the placeholder text just isn't the canonical one. "${answerText}" was recognized as an unanswered placeholder (not a real answer), but the canonical form is "[Fill this in]" on its own line after "**ANS:**". SUGGESTED: **ANS:**\n[Fill this in]`,
        line: answerLine,
      });
    }
    // Byline scaffold (Herald's second tour, Jérémie verbatim 2026-07-28:
    // "All the questions from Herald's tour have '(Jérémie Lumbroso)'
    // preparsed in the answer... it introduces noise"): an ANS slot whose
    // ENTIRE content is one bare parenthetical — "**ANS:** (Jérémie
    // Lumbroso)" with nothing else — is a scaffold reserving the slot, not
    // an answer. Cousin of the "(by )" empty-attribution class (v0.7.21).
    // The QST-ANS-BYLINE posture is intact: we still never ATTRIBUTE a
    // keyword-less name (no author set), and a bare parenthetical followed
    // by real text is still preserved as content — whole-content-only
    // anchoring, same discipline as the placeholder family. Single-line
    // only ([^()\n]): a multi-line parenthesized paragraph is real content.
    // And ONLY when the layer captured no author: a slot that already has
    // a keyword byline can't be awaiting one — its parenthetical content
    // ("(see ADR-0014 for the full argument)") stays a real draft answer,
    // per the pre-existing guard-the-guard test.
    const isBylineScaffold = !answerAuthor && !isCanonicalPlaceholder && !isSynonymPlaceholder && !isWrappedPlaceholder &&
      /^\([^()\n]+\)$/.test(classifiable);
    if (isBylineScaffold && warnings) {
      warnings.push({
        code: 'ANS_BYLINE_SCAFFOLD',
        message: `The ANS slot's entire content is the bare parenthetical "${answerText}" — read as an empty byline scaffold (the question stays unanswered), not as an answer. If this names the intended answerer, the recognized byline form is "**ANS:** (by ${answerText.slice(1, -1)})". If it was meant as a real answer, add text outside the parentheses.`,
        line: answerLine,
      });
    }
    // Emptiness judged on the stripped text too: a slot whose only content
    // is an HTML comment is an empty slot, not an answer.
    const isReal = !!classifiable && !isCanonicalPlaceholder && !isSynonymPlaceholder && !isWrappedPlaceholder && !isBylineScaffold;
    answerLayers.push({ qualifier: answerQualifier, author: answerAuthor, text: answerText, line: answerLine, isReal });
    answerLines.length = 0;
    answerQualifier = undefined;
    answerAuthor = undefined;
    answerLine = undefined;
  };

  // FORMAT RULING (Riddle 5, 2026-08-06, Gleaner's 0530 dispatch — system3
  // etude 0055 specimen): **folded is archival, not invisible.** A
  // <details>…</details> block inside a question is the author's explicit
  // "superseded, don't treat as live" gesture (Jérémie wrapped a historical
  // ANS round in one, and the scanner selected the ARCHIVED answer as
  // current). Rule: content inside <details> is INERT to dialogue structure
  // — it never opens/closes an answer round, never mints a recommendation,
  // never flips a field; it belongs byte-faithfully to whatever container
  // surrounds it (here: the live answer's own text, folded on render).
  // Distinct from the HTML-comment channel (invisible-by-doctrine, framing
  // 4): details content stays visible and preserved. And per recall-first,
  // never SILENTLY inert: a would-be marker inside a fold gets a diagnostic.
  // (Heading-level splitting — a "### QST:" inside <details> — happens
  // upstream in buildSection and is a separate, ledger-noted boundary.)
  let detailsDepth = 0;
  // A fenced code block (```/~~~) is illustrative example content, never
  // live field data — same doctrine as <details> above, applied to a
  // second real specimen (HQ ADR-0009, founder Report 2026-08-18): a
  // QST's own "- Status: answered" line was overridden by a LATER
  // "- **Status**: Accepted" line sitting inside a ```markdown fenced
  // "Proposed header format" example a few lines further down the same
  // block — STATUS_LINE_RE has no fence awareness, so the example's
  // illustrative status silently won over the question's real one.
  // Toggled on any fence-delimiter line (```/~~~, common-mark tolerant of
  // either), open or close; routed exactly like insideDetails below so a
  // fenced example can never flip a field, mint a recommendation, or open
  // an answer round — it belongs byte-faithfully to whatever container
  // surrounds it.
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const absLine = section.lineStart + i + 1;

    if (/^(```|~~~)/.test(line)) inFence = !inFence;

    // Founder Report, 2026-08-26 (HQ seed-2026-08-25-sol-precision-pass-
    // ratification.md, QST-STAGING-NOTE): a recommendation's own PROSE
    // mentioned the HTML tag by name as a backtick-quoted code span —
    // "If the `<details>` renders poorly..." — describing the feature, not
    // opening one. The fold-depth scan below ran on the raw line with no
    // code-span awareness, so it read that mention as a real opening
    // <details> tag with no matching close, leaving detailsDepth stuck
    // open for the rest of the question: the next Recommendation marker
    // and the ANS marker both got swallowed into the first recommendation's
    // text instead of starting their own blocks. Strip backtick spans
    // before scanning for tags — same discipline the webview's own
    // renderInline already applies before its bold/italic pass, just
    // never extended to this scan.
    const lineForTagScan = line.replace(/`[^`]*`/g, '');
    const opens = (lineForTagScan.match(/<details\b/gi) || []).length;
    const closes = (lineForTagScan.match(/<\/details>/gi) || []).length;
    const insideDetails = detailsDepth > 0 || opens > 0;
    detailsDepth = Math.max(0, detailsDepth + opens - closes);
    if (inFence || insideDetails) {
      if (warnings && (isAnsMarkerLine(line) || RECOMMENDATION_RE.test(line) || RECOMMENDATION_BULLET_RE.test(line))) {
        warnings.push({
          code: 'STRUCTURAL_MARKER_INSIDE_DETAILS',
          message: `A dialogue marker ("${line.slice(0, 40)}…") sits inside a <details> block and was treated as archival content, not live structure — the fold rule ("folded is archival") keeps it out of the current round. If this marker SHOULD be live, move it outside the <details> block.`,
          line: absLine,
        });
      }
      if (inAnswer) { answerLines.push(lines[i]); continue; }
      if (inRecommendation) { recommendationLines.push(lines[i]); continue; }
      if (pastRecommendation) { rawBodyLinesPost.push(lines[i]); } else { rawBodyLinesPre.push(lines[i]); }
      continue;
    }

    if (inAnswer) {
      // A new ANS marker or a Recommendation marker ends the current layer
      // (an attributed block ends at the next attributed block — the same
      // rule recommendations follow). Anything else belongs to the layer.
      if (isAnsMarkerLine(line)) {
        finalizeAnswerLayer();
        inAnswer = false; // fall through to the ANS-start handler below
      } else if (isFollowUpMarkerLine(line)) {
        // Unconditional — same tier as the ANS/Recommendation markers
        // above, never gated on isPlaceholderOnly the way the generic
        // bold-key check below is. This is a STRUCTURAL marker this
        // program itself mints, not prose that happens to look bold-keyed;
        // it must never read as the tail of the answer it follows.
        finalizeAnswerLayer();
        inAnswer = false;
        // fall through — ordinary post-body content; not its own field (v1
        // scope, Docent's ruling: prose today, a one-line parser lift
        // later if a structured consumer is ever funded).
      } else if (RECOMMENDATION_RE.test(line) || RECOMMENDATION_BULLET_RE.test(line)) {
        finalizeAnswerLayer();
        inAnswer = false; // fall through — the rec handlers below take it
      } else if (line.trim() !== '' && isPlaceholderOnly(answerLines.join('\n').trim())) {
        // Jérémie's report, 2026-07-29 (seed-2026-07-29-issue-parsing-text-
        // after-ans-placeholder-of-qsts.md): "**ANS:**\n[Fill this in]"
        // directly followed (blank line only — no "---", no next heading)
        // by an unrelated bold-key paragraph ("**ADR mapping**: ...") got
        // swallowed whole into answer.text, defeating the whole-content-
        // anchored placeholder check (it's no longer JUST the placeholder)
        // — the panel then showed the placeholder plus that unrelated text
        // as "the current answer," which Jérémie felt he had to preserve,
        // producing a duplicate on submit. Once everything collected so
        // far is recognizably nothing but a placeholder, nothing else is
        // ever a continuation of it — mirrors the identical stop-check
        // recommendations already have (ADR-0010), scoped to the
        // placeholder case only: a REAL in-progress answer can legitimately
        // contain a line shaped like "**Note**: ..." as its own prose, so
        // this must not fire once real content has started.
        //
        // Widened 2026-10-12 (companion etude, founder Report — distressed
        // language, "PARALYZING... ABORT ABORT ABORT"): the original fix
        // only recognized a BOLD-key-shaped interruption
        // (`/^\*\*[A-Z][^*]+\*\*:/`). The real specimen's bare `[ ]` was
        // followed first by an ITALIC parenthetical aside
        // (`*(The Brain-Dump sitting is already QST-VISIT-BRAINDUMP
        // above...)*`) — a different shape the bold-only check never saw,
        // so it got swallowed, which then permanently poisoned
        // isPlaceholderOnly for every later line (including the bold-key
        // ones that WOULD have matched) — three further unrelated
        // paragraphs, hundreds of words, ended up pre-filled into the
        // human's answer box as "existing content to preserve." The gate
        // that actually matters is "is everything so far nothing but the
        // placeholder" — that's unchanged and still the only thing that
        // can make this fire — so dropping the bold-key shape requirement
        // widens WHICH interruption shapes are caught without widening
        // WHEN: a real in-progress answer's own prose still never
        // triggers this, because by the time real content exists,
        // isPlaceholderOnly is already false.
        finalizeAnswerLayer();
        inAnswer = false;
        // fall through — this line belongs to whatever surrounds the QST,
        // not to this answer.
      } else {
        answerLines.push(lines[i]);
        continue;
      }
    }

    // Multi-line field continuation: an indented line (starts with
    // whitespace) that is not blank and not a new SIBLING field.
    //
    // Nested-list fix, round 2 (Gleaner's brief, 2026-08-10, relaying
    // Jérémie's direct correction on v0.7.72: "it unwraps structural
    // elements... this is a systemic problem"). Round 1 (2026-08-09) only
    // special-cased ordered markers ("1. ") — Gleaner never tested the
    // bullet sibling before calling it fixed, and bullets are WORSE: a
    // nested "- **Option D exists**..." line, once trimmed, is
    // indistinguishable by CHARACTER ALONE from a genuine new top-level
    // field ("- Need: ..."), so the old `!/^-\s+/.test(line)` guard
    // excluded it from continuation entirely — it never even reached
    // `whyAsking`, landing in rawBody instead and vanishing from the "why"
    // section's render. Round 1's "add another special case per marker
    // type" was the wrong shape, per Gleaner's own review: two other
    // places in this codebase already solve the SAME class correctly —
    // scripts/unwrap-adrs/unwrap-adrs.mjs's isListItem/isListContinuationLine
    // and openQuestionsPanel.ts's renderBlocks — both by checking
    // INDENTATION relative to the surrounding construct, never by which
    // character follows it. A genuine sibling field always starts at the
    // SAME column as the field currently open (fieldBaseIndent, captured
    // where "- Why asking:"/etc. was matched); anything indented FURTHER
    // is nested content, whatever marker it uses.
    const rawIndent = lines[i].length - lines[i].trimStart().length;
    const isNestedRelativeToField = rawIndent > fieldBaseIndent;
    const looksLikeSiblingField = !isNestedRelativeToField && /^-\s+/.test(line);
    const isContinuation = /^\s+\S/.test(lines[i]) && line !== ''
      && !looksLikeSiblingField && !/^\*\*/.test(line);

    // A continuation line that is itself a nested list item — ordered
    // ("1. ") or bulleted ("- "/"* ") — must not be glued onto the growing
    // string with a plain space, which flattens the marker into inline
    // prose with no line break at all. Preserve the break so renderMarkdown
    // (already block-aware, since the ADR-0003 nested-fence fix) can
    // recognize a real list once it re-parses the joined string from
    // scratch. Every other continuation line (plain wrapped prose, whether
    // before any list starts or continuing a single item's own text) keeps
    // the flat space-join — renderMarkdown's own lazy-continuation rule
    // for list items already handles that case correctly on its own.
    const continuesListItem = /^\d+\.\s+/.test(line) || /^[-*]\s+/.test(line);
    const joiner = continuesListItem ? '\n' : ' ';

    if (inWhyAsking) {
      if (isContinuation) { whyAsking = (whyAsking ?? '') + joiner + line; continue; }
      inWhyAsking = false; // fall through to process this line normally
    }
    if (inWhyDeferring) {
      if (isContinuation) { whyDeferring = (whyDeferring ?? '') + joiner + line; continue; }
      inWhyDeferring = false; // fall through
    }
    if (inNeed) {
      if (isContinuation) { need = (need ?? '') + joiner + line; continue; }
      inNeed = false; // fall through
    }

    const statusMatch = line.match(STATUS_LINE_RE);
    // ADR-0012: trim to handle "- Status:  answered " with trailing/leading spaces
    if (statusMatch) {
      const rawStatus = statusMatch[1].trim();
      // Emphasis-robust keyword (ADR-0052 specimen): "**answered** (…)"
      // must read as answered. Stored stripped — comparisons and display
      // both want the words, not the styling.
      statusText = stripInlineEmphasis(rawStatus);
      statusDeclared = true;
      // ADR-0039 §3: `line` is `lines[i].trim()`, so `statusMatch.index` is
      // relative to the TRIMMED line — add back the stripped leading
      // whitespace length to land on `lines[i]`'s real columns. Group 1 is
      // anchored at `$` (end of line), so its start is exactly
      // `match[0].length - match[1].length` characters into the match —
      // the RAW (untrimmed) captured span, matching what a write tool
      // would actually be replacing in the source.
      {
        const leadingWs = lines[i].length - lines[i].trimStart().length;
        const matchStart = leadingWs + (statusMatch.index ?? 0);
        const valueStart = matchStart + (statusMatch[0].length - statusMatch[1].length);
        statusRange = {
          startLine: absLine, startCol: valueStart,
          endLine: absLine, endCol: valueStart + statusMatch[1].length,
        };
      }
      if (warnings && statusText !== rawStatus) {
        warnings.push({
          code: 'EMPHASIZED_STATUS_VALUE',
          message: `Status value "${rawStatus}" uses Markdown emphasis on the keyword. Recognized anyway (read as "${statusText}") — no data lost — but tools key on the bare token. SUGGESTED: "- Status: ${statusText}"`,
          line: absLine,
        });
      }
      inRecommendation = false; inWhyAsking = false; inNeed = false;
      if (warnings) {
        if (STATUS_LINE_BOLD_RE.test(line)) {
          warnings.push({
            code: 'NONSTANDARD_STATUS_LINE_FORM',
            message: `Status field "${line.trim()}" was recognized, but written as "- **Status**:" (bold) instead of the canonical plain form "- Status:". Recognized anyway — no data lost. SUGGESTED: "- Status: ${statusText}"`,
            line: absLine,
          });
        }
        if (ANSWERED_LEADING_TOKEN_RE.test(statusText) && statusText.toLowerCase() !== 'answered') {
          warnings.push({
            code: 'NONSTANDARD_STATUS_ANNOTATION',
            message: `Status value "${statusText}" was recognized as answered (leading token match), but carries a trailing annotation beyond the canonical bare "answered". Recognized anyway — no data lost, annotation preserved for display. SUGGESTED: keep the annotation in Why asking or a NOT: note instead, if it doesn't need to live in the Status value itself.`,
            line: absLine,
          });
        }
      }
      continue;
    }

    const whyMatch = line.match(WHY_ASKING_RE);
    if (whyMatch) {
      whyAsking = whyMatch[1].trim(); inRecommendation = false; inWhyAsking = true; inNeed = false; inWhyDeferring = false;
      fieldBaseIndent = lines[i].length - lines[i].trimStart().length;
      continue;
    }

    const whyDeferringMatch = line.match(WHY_DEFERRING_RE);
    if (whyDeferringMatch) {
      whyDeferring = whyDeferringMatch[1].trim(); inRecommendation = false; inWhyDeferring = true; inWhyAsking = false; inNeed = false;
      fieldBaseIndent = lines[i].length - lines[i].trimStart().length;
      continue;
    }

    const needMatch = line.match(NEED_RE);
    if (needMatch) {
      need = needMatch[1].trim(); inRecommendation = false; inNeed = true; inWhyAsking = false;
      fieldBaseIndent = lines[i].length - lines[i].trimStart().length;
      continue;
    }

    // Recommendation: starts with **My recommendation**: and may span multiple lines
    const recMatch = line.match(RECOMMENDATION_RE);
    if (recMatch) {
      // A second **Recommendation**: label lands here too — stacked blocks
      // (multiple models on one QST) accumulate into a single field until
      // ADR-0019's multi-recommendation model replaces this bridge.
      // Each marker also opens a new block boundary (see recommendations[] below).
      inRecommendation = true;
      recommendationBlockStarts.push(recommendationLines.length);
      const recQualifier = recMatch[1]?.trim();
      let inlineAttribution = recMatch[2]?.trim();
      let firstLine = recMatch[3].trim();
      // Wrapped attribution (Jérémie's live Report from moreover's ADR
      // manager, 2026-09-26, QST-VERB-RECUT: "The recommendation after the
      // 'Recommendation' header seems not to have been parsed correctly
      // because multiline header?" — his hypothesis was exactly right):
      // an attribution parenthetical hard-wrapped across lines ("(by Ribbon
      // 5, Claude Fable 5 — revised same-day;\nthis walks forward … )") never
      // closed on its first line, so neither REC_ATTRIBUTION_RE nor the
      // leading-qualifier fallback below could match; the author fell back to
      // Deciders-inference, the attribution's first line leaked into the rec
      // body, and — because the block was then read as legacy form, which ends
      // at the first blank line — the actual recommendation paragraph spilled
      // into rawBodyPost, outside the styled block. Hard-wrapping a long
      // attribution is ordinary model output, not a malformation. Join the
      // continuation lines up to the closing ")" (bounded: no blank line, at
      // most 6 lines) before recognizing it, exactly as if it had been written
      // on one line. Not a warning: nothing here is worth nagging about.
      if (/^\((?:[A-Za-z]+\s+){0,2}(?:by|from)\b/i.test(firstLine) && !firstLine.includes(')')) {
        let joined = firstLine;
        for (let k = i + 1; k < lines.length && k <= i + 6; k++) {
          const next = lines[k].trim();
          if (next === '') break;
          joined += ' ' + next;
          if (next.includes(')')) { firstLine = joined; i = k; break; }
        }
      }
      recProtocolForm = REC_ATTRIBUTION_RE.test(firstLine);
      // Fourth attribution position (HQ ADR-0015 QST-7, 2026-07-25):
      // "**Recommendation**: (by Consul 5, Iteration 18, reviewed by
      // Understudy 5) **Staged: ...**" — the parenthetical AFTER the colon,
      // same line, content following. Neither the protocol form (attribution
      // ALONE on the line), the pre-colon inline form, nor the two-line
      // shape — so the parenthetical leaked into rec text and the author
      // was inferred from Deciders (see splitRoster's incident note).
      // Captured whole as the author (it may carry commas, reviewers,
      // em-dashes — never re-split as author,date), attributed ⇒ the block
      // spans paragraphs, extent parity as always.
      if (!recProtocolForm && !inlineAttribution) {
        // "stacked by" (Gleaner's brief, 2026-08-11, live on our own
        // repo's ADR-0032 council round — six real crew members'
        // recommendations misattributed to one wrong name): a leading
        // qualifier word before "by"/"from" ("(stacked by Lapidary 5,
        // council round, 2026-08-08) ...") made the whole match fail —
        // this fallback only recognized the bare preposition — so the
        // parenthetical was never consumed as attribution, its literal
        // text leaked as the first sentence of the recommendation body,
        // and the author fell through to Deciders-inference, which
        // returns the SAME wrong name for every recommendation in the
        // file regardless of who actually wrote it. Up to two leading
        // words are tolerated before by/from (covers "stacked by" and
        // similar short qualifiers); the qualifier itself is intentionally
        // NOT captured or preserved — it carries no information beyond
        // what "this is one of several stacked Recommendation blocks"
        // already conveys structurally.
        const leading = firstLine.match(/^\((?:[A-Za-z]+\s+){0,2}(?:by|from)\b\s*([^)]*)\)\s*(.*)$/i);
        if (leading && leading[1].trim()) {
          inlineAttribution = leading[1].trim();
          firstLine = leading[2].trim();
        }
      }
      // Rec-extent escape (Lapidary 5, 2026-07-13, inbox-alchemy ADR-0022
      // specimen): v0.7.5's inline-attribution tolerance ("**Recommendation**
      // (by Author): text") captured only the same-line content — legacy-
      // form's end-at-first-blank-line rule applied, since `firstLine` here
      // is real content, not an attribution-only line, so REC_ATTRIBUTION_RE
      // never matched it. A multi-paragraph justification after an inline
      // attribution escaped past the first blank line into rawBodyPost,
      // rendering as bare paragraphs below the styled block in the panel.
      // An explicit inline attribution is just as much a signal of a real,
      // possibly multi-paragraph recommendation as the protocol form's own
      // attribution line — extent parity, not just form tolerance.
      recSpansParagraphs = recProtocolForm || !!inlineAttribution;
      recommendationBlockMeta.push({ protocolForm: recProtocolForm, line: absLine, inlineAttribution, qualifier: recQualifier });
      if (firstLine) recommendationLines.push(firstLine);
      continue;
    }

    // Dash-bullet field form fallback (temp/0015 specimen): tolerate,
    // extract correctly (attribution included), warn — never silently drop
    // the structure the way the pre-fix behavior did (fell through to raw
    // prose, no attribution, absent from recommendations[] entirely).
    const recBulletMatch = line.match(RECOMMENDATION_BULLET_RE);
    if (recBulletMatch) {
      inRecommendation = true;
      recommendationBlockStarts.push(recommendationLines.length);
      const inlineAttribution = recBulletMatch[1]?.trim();
      const firstLine = recBulletMatch[2].trim();
      recProtocolForm = false; // dash-bullet form is always single-field, never multi-paragraph
      recSpansParagraphs = false;
      recommendationBlockMeta.push({ protocolForm: false, line: absLine, inlineAttribution });
      if (firstLine) recommendationLines.push(firstLine);
      if (warnings) {
        const suggestedMarker = inlineAttribution ? `**Recommendation** (by ${inlineAttribution}):` : '**Recommendation**:';
        // Recommendation text can run long — the diagnostic names the FORM
        // problem and shows the canonical marker to rewrite to, not a
        // full echo of the (potentially multi-hundred-word) recommendation
        // text itself.
        warnings.push({
          code: 'NONSTANDARD_RECOMMENDATION_FORM',
          message: `A Recommendation was found written as a "- Recommendation:" dash-bullet field, not the canonical standalone block. Recognized anyway — no data lost, attribution ${inlineAttribution ? `("${inlineAttribution}") ` : ''}included — but this form doesn't render with the recommendation's attribution styling, and it's an easy shape to regularize into by accident next to Status/Why asking/Need. SUGGESTED: rewrite this line as its own block starting with "${suggestedMarker}" rather than a dash-bullet field.`,
          line: absLine,
        });
      }
      continue;
    }

    // Continue collecting recommendation lines until hitting a new bold-key block,
    // the ANS block, or a blank line followed by a heading-like continuation.
    // ADR-0010: Fix greediness — stop at "**Caveat**:", "**Edge case**:", etc.
    if (inRecommendation) {
      if (line === '') {
        // Protocol-form AND inline-attribution bodies are multi-paragraph:
        // keep collecting across blank lines until ANS / a new bold-key
        // block / the QST's end (rec-extent escape fix — see
        // recSpansParagraphs' declaration for why this isn't recProtocolForm).
        if (recSpansParagraphs) { recommendationLines.push(''); continue; }
        inRecommendation = false; pastRecommendation = true; continue;
      }
      // Stop at any new **Key**: block that isn't the ANS marker — but ONLY
      // for the legacy single-paragraph form. An ATTRIBUTED block (protocol
      // or inline-attribution — recSpansParagraphs) owns its own structured
      // sub-fields: system3 ADR-0045 (Sophist 4.5, 2026-07-22) organized a
      // recommendation as pick + "**Why**:" + numbered items, and the
      // ADR-0010-era bold-key stop beheaded it at "**Why**:", orphaning the
      // entire justification as unstyled body. The greediness ADR-0010
      // guarded against is a legacy-form problem; an attributed block ends
      // at ANS, a new Recommendation marker, or the block's own extent.
      if (!recSpansParagraphs && /^\*\*[A-Z][^*]+\*\*:/.test(line) && !ANS_INLINE_RE.test(line) && !/^\*\*My recommendation\*\*:/.test(line)) {
        inRecommendation = false; pastRecommendation = true;
        /* fall through — process this line normally */
      } else if (isAnsMarkerLine(line)) {
        // The colon-outside-bold ANS form ("**ANS** (by X): text") has no
        // "**:" immediately after the bold span, so the bold-key check above
        // never fires for it either — without this explicit check it fell
        // straight to the `else` branch and got swallowed as more
        // recommendation prose, and the ANS marker below never saw the line.
        inRecommendation = false; pastRecommendation = true; /* fall through */
      } else {
        recommendationLines.push(line);
        continue;
      }
    }

    // Dash-bullet ANS dialect (system3 etude ADR-0056): recognize the same
    // marker grammar with a leading "- " stripped; the bullet is recorded
    // via a diagnostic below, and writes canonicalize to the standalone form.
    const ansLine = debulletAnsLine(line);
    const ansMatch = ansLine.match(ANS_INLINE_RE);
    const ansColonOutsideMatch = ansMatch ? null : ansLine.match(ANS_COLON_OUTSIDE_RE);
    if (ansMatch || ansColonOutsideMatch) {
      inAnswer = true;
      const matched = ansMatch ?? ansColonOutsideMatch!;
      // Empty or keyword-only attribution — "(by )", "(by)", "(from )" —
      // normalizes to no author (the scaffold's blank, not a name). The
      // parenthetical is still CONSUMED by the marker match, which is the
      // actual fix: "(by )" must never fall through into answer content.
      answerQualifier = matched[1]?.trim() || undefined;
      const rawAuthor = matched[2]?.trim();
      answerAuthor = rawAuthor && !/^(?:by|from)$/i.test(rawAuthor) ? rawAuthor : undefined;
      answerLine = absLine;
      // Collect any text on the same line after the ANS marker
      const markerRe = ansMatch ? ANS_INLINE_RE : ANS_COLON_OUTSIDE_RE;
      let afterMarker = ansLine.replace(markerRe, '').trim();
      if (ansLine !== line && warnings) {
        warnings.push({
          code: 'NONCANONICAL_ANS_MARKER',
          message: `ANS marker written as a dash-bullet field ("- **ANS**…"). Recognized anyway — no data lost — but the canonical form is a standalone "**ANS:** (by Name)" line, which is also what the panel writes back. SUGGESTED: drop the leading "- ".`,
          line: absLine,
        });
      }
      // Post-colon byline on the colon-outside form (Jérémie's own hand-form,
      // 2026-07-25/26, ADR-0036 live specimen): "**ANS**: (by Jérémie)" — the
      // colon lands right after the bold, so COLON_OUTSIDE's attribution
      // group (which sits BEFORE the colon) captures nothing and "(by
      // Jérémie)" leaked into answer content. Keyword-REQUIRED here, same
      // reasoning as the recommendations' fourth position and QST-ANS-BYLINE
      // (ADR-0032): after the colon, only "by"/"from" distinguishes a byline
      // from content like "(see ADR-14)" — a bare "(Name)" stays content.
      if (!answerAuthor) {
        const postColonByline = afterMarker.match(/^\((?:by|from)\b\s*([^)]*)\)\s*(.*)$/i);
        if (postColonByline && postColonByline[1].trim()) {
          answerAuthor = postColonByline[1].trim();
          afterMarker = postColonByline[2].trim();
        }
      }
      if (afterMarker) answerLines.push(afterMarker);
      if (ansColonOutsideMatch && warnings) {
        warnings.push({
          code: 'NONCANONICAL_ANS_MARKER',
          message: `ANS marker "${line.trim().slice(0, 60)}${line.trim().length > 60 ? '…' : ''}" was recognized, but written with the colon outside the bold span instead of the canonical "**ANS:**${matched[2] ? ' (by ' + matched[2] + ')' : ''}" form. Recognized anyway — no data lost. SUGGESTED: "**ANS:**${matched[2] ? ' (by ' + matched[2] + ')' : ''}"`,
          line: absLine,
        });
      }
      continue;
    }

    // Every line that didn't match a recognized field: route by position
    if (pastRecommendation) {
      rawBodyLinesPost.push(lines[i]);
    } else {
      rawBodyLinesPre.push(lines[i]);
    }
  }

  // Trim leading/trailing blank lines from both body sections
  const trimBlanks = (arr: string[]) => {
    while (arr.length > 0 && arr[0].trim() === '') arr.shift()
    while (arr.length > 0 && arr[arr.length - 1].trim() === '') arr.pop()
  }
  trimBlanks(rawBodyLinesPre)
  trimBlanks(rawBodyLinesPost)
  // Hard-wrap robustness (Lapidary 5, 2026-07-13 reframe): rawBody/
  // rawBodyPost is typically the option bullets (A/B/C...) and gets handed
  // to the webview's markdown renderer as-is. A hard-wrapped continuation
  // line inside a bullet has no marker of its own, so the renderer's
  // line-based list detection can't tell it apart from a new paragraph —
  // the exact "Option B's text bleeding out of its bullet" screenshot.
  // Rejoining wrapped list items HERE, at extraction time, means every
  // downstream consumer (panel, MCP, future ones) sees already-normalized
  // markdown, not a renderer-specific patch.
  const rawBody = rawBodyLinesPre.length > 0 ? unwrapMarkdownish(rawBodyLinesPre).join('\n') : undefined
  const rawBodyPost = rawBodyLinesPost.length > 0 ? unwrapMarkdownish(rawBodyLinesPost).join('\n') : undefined

  finalizeAnswerLayer();
  const lastLayer = answerLayers[answerLayers.length - 1];
  if (lastLayer?.isReal) {
    answer = { text: lastLayer.text, author: lastLayer.author, line: lastLayer.line };
  }

  // ADR-0012: Case-insensitive, trimmed comparison — human-typed values like "Answered" should work.
  // Leading-token match (not exact-match) tolerates a trailing annotation
  // ("answered 2026-07-13 (reason)") — see ANSWERED_LEADING_TOKEN_RE.
  // STATUS-AUTHORITY (ADR-0031, ratified by Jérémie "in full"; implemented
  // 2026-07-19 after the blast-radius measurement Flint's recommendation
  // required — 38/431 questions across 5 repos flip open, mostly March-era
  // zombies with the date-cutoff migration Jérémie's ANS proposed): when a
  // `- Status:` line is DECLARED, it alone decides answered-ness — ANS
  // content becomes a draft until the author flips Status. Derived
  // ANS-content evidence closes a question ONLY when no Status is declared
  // at all. This is what makes REOPENING possible: before this rule, an
  // explicit "unanswered (reopened — ...)" lost to the stale answer beneath
  // it (HQ ADR-0015 QST-3, the live specimen that triggered implementation).
  const declaredAnswered = ANSWERED_LEADING_TOKEN_RE.test(statusText.trim());
  const isAnswered = statusDeclared ? declaredAnswered : (declaredAnswered || !!answer);
  const isRetired = statusDeclared && isRetiredStatusToken(statusText);

  if (recommendationLines.length > 0) {
    // Hard-wrap robustness: join wrapped continuation lines within each
    // paragraph, preserving genuine blank-line paragraph breaks AND list
    // items (unwrapMarkdownish, not the narrower unwrapParagraphs — same
    // "join lines back together" primitive independently reinvented a
    // fourth time, Gleaner's brief 2026-08-11-0147: unwrapParagraphs only
    // ever breaks on a blank line, no matchListItem() check at all, so two
    // adjacent recommendation bullets with no blank line between them
    // — perfectly valid markdown, the real ADR-0032 A1/A2 specimen —
    // merged into one run-on string with a literal "- **A2 — ..." tail.
    // unwrapMarkdownish is a strict superset: identical output for
    // plain-prose input (its own list-item pass is a no-op when there are
    // no list items), plus the boundary-awareness unwrapParagraphs never
    // had. See the matching rawBody fix above, same function.
    recommendation = unwrapMarkdownish(recommendationLines).join('\n').trim() || undefined;
  }

  let recommendations: Recommendation[] | undefined;
  if (recommendationBlockStarts.length > 0) {
    const bounds = [...recommendationBlockStarts, recommendationLines.length];
    const blocks: Recommendation[] = [];
    for (let i = 0; i < recommendationBlockStarts.length; i++) {
      const meta = recommendationBlockMeta[i];
      const rawLines = recommendationLines.slice(bounds[i], bounds[i + 1]);

      let author: string | undefined;
      let authorInferred: boolean | undefined;
      let date: string | undefined;
      let bodyLines = rawLines;

      if (meta.protocolForm) {
        const attrMatch = (rawLines[0] ?? '').match(REC_ATTRIBUTION_RE);
        if (attrMatch) {
          const split = splitRecAttribution(attrMatch[1]);
          author = split.author;
          date = split.date;
        }
        bodyLines = rawLines.slice(1);
      } else if (meta.inlineAttribution) {
        // Inline-attribution form: "**Recommendation** (by Athanor 5, Claude
        // Fable 5): text" — the parenthetical is "seat, model", not
        // "author, date" (REC_ATTRIBUTION_RE's split assumption), so it's
        // used whole as the author string rather than re-split. Explicit,
        // not inferred — authorInferred stays unset, same as protocolForm.
        author = meta.inlineAttribution;
      } else {
        author = inferAuthorFromDeciders(deciders);
        if (author !== undefined) authorInferred = true;
      }

      // Hard-wrap robustness: same join as the legacy `recommendation`
      // field above (unwrapMarkdownish, not unwrapParagraphs — see that
      // fix's comment), applied per-block.
      const text = unwrapMarkdownish(bodyLines).join('\n').trim();
      if (!text) continue;

      blocks.push({
        author,
        authorInferred,
        date,
        text,
        pick: extractPick(text),
        line: meta.line,
      });
    }
    if (blocks.length > 0) recommendations = blocks;
  }

  // ADR-0021 Iteration 10: rounds is the source of truth; recommendations/
  // answers (plural, flat) are DERIVED from it, never computed independently
  // — the two can never drift apart because there's only one computation.
  const rounds = foldQuestionRounds(recommendations ?? [], answerLayers);
  recommendations = rounds.flatMap((r) => r.recommendations);
  if (recommendations.length === 0) recommendations = undefined;
  let answers: RoundAnswer[] | undefined = rounds.filter((r) => r.answer).map((r) => r.answer!);
  if (answers.length === 0) answers = undefined;

  return {
    id: `adr-${String(adrNumber).padStart(4, '0')}-${section.slug}`,
    slug: section.slug,
    text: section.navCodeText || section.heading,
    statusText,
    isAnswered,
    isRetired,
    dismissedReason: section.dismissedReason,
    whyAsking,
    whyDeferring,
    need,
    recommendation,
    recommendations,
    rawBody,
    rawBodyPost,
    answer,
    answers,
    rounds,
    adrNumber,
    adrPath,
    lineStart: section.lineStart,
    qstId: section.qstId,
    aliasSlug: section.aliasSlug,
    statusRange,
  };
}

// ---------------------------------------------------------------------------
// Inline nav code extraction
// ---------------------------------------------------------------------------

// Matches inline **NOT:** or **ANS:** etc.
const INLINE_NAV_RE = /\*\*(QST|ANS|COD|API|FIL|DOC|NOT):\*\*\s*(?:\((?:by|from)\s+([^)]+)\))?\s*(.*)/;

function extractInlineCodes(sections: AdrSection[]): InlineNavCode[] {
  const found: InlineNavCode[] = [];

  function scanSection(section: AdrSection): void {
    const lines = section.body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(INLINE_NAV_RE);
      if (m) {
        found.push({
          code: m[1] as NavCode,
          text: m[3]?.trim() || '',
          author: m[2]?.trim(),
          line: section.lineStart + i + 1,
          sectionSlug: section.slug,
        });
      }
    }
    for (const child of section.children) {
      scanSection(child);
    }
  }

  for (const section of sections) {
    scanSection(section);
  }

  return found;
}

// ---------------------------------------------------------------------------
// Iteration extraction
// ---------------------------------------------------------------------------

// Matches: ### Iteration 2 (2026-03-02), ### Iteration 1, or ### Iteration 2
// (2026-07-05) — Treeview as visual question dashboard *(chunked from...)*
// — a trailing em-dash/hyphen title suffix, real and common in this repo's
// own corpus (found investigating ADR-0043 H1: the un-anchored `$` here
// silently dropped every titled Iteration heading from AdrFile.iterations,
// undercounting H1's "count of Iteration N headings" input on exactly the
// files that needed it — a recall bug, not an H1 bug, caught verifying H1
// against Touchstone's real sweep corpus rather than trusting a synthetic
// fixture).
const ITERATION_HEADING_RE = /^Iteration\s+(\d+)(?:\s+\(([^)]+)\))?(?:\s+[—-].*)?$/i;

/**
 * Exported so ADR-0043's H1 heuristic (driftHeuristics.ts) can count
 * "### Iteration N" headings ANYWHERE in the document — not just those
 * nested under "## Iterations" — without hand-copying this regex ("sibling
 * parsers are banned," one recognition pass, this is the one definition).
 * Real specimen (ADR-0004's pre-sweep state): an "### Iteration 3" entry
 * physically landed after "## Questions" started (a content-placement
 * anomaly, not a formatting one) — extractIterations()'s scoped children-
 * of-"## Iterations" walk correctly excludes it for append-point purposes,
 * but H1's COUNT still needs to see it; Touchstone's real correction did.
 */
export function parseIterationHeading(heading: string): { number: number; date?: string } | undefined {
  const m = heading.match(ITERATION_HEADING_RE);
  if (!m) return undefined;
  return { number: parseInt(m[1], 10), date: m[2] };
}
// Matches: - Human: ...  or  - AI (Sonnet 4.6):  ...
const ITERATION_FIELD_RE = /^-\s+(Human|AI[^:]*|Outcome):\s+(.+)$/;

/**
 * ADR-0039 §3 (SourceRange, first slice): where a new `### Iteration N`
 * entry should be appended — computed once, structurally, instead of
 * re-derived by every write site via its own backward-scan (writeOps.ts's
 * applyAppendIteration used to do exactly this scan itself; now consumes
 * this field, this function is the one definition). Mirrors that scan's
 * proven logic exactly: walk backward from the section's last body line,
 * skip trailing blank lines and the closing "---" separator, insert right
 * after the last real content line — never inside the separator that
 * terminates the section.
 */
function computeIterationsAppendLine(sections: AdrSection[]): number | undefined {
  const iterationsSection = sections.find(s => s.heading.trim().toLowerCase() === 'iterations');
  if (!iterationsSection || iterationsSection.bodyRaw === undefined) return undefined;

  const bodyLines = iterationsSection.bodyRaw.split('\n');
  let idx = bodyLines.length - 1;
  while (idx > 0 && (bodyLines[idx].trim() === '' || bodyLines[idx].trim() === '---')) {
    idx--;
  }
  idx += 1; // slice point: right after the last real content line
  return iterationsSection.lineStart + 1 + idx;
}

function extractIterations(sections: AdrSection[]): AdrIteration[] {
  const iterationsSection = sections.find(s => s.heading === 'Iterations');
  if (!iterationsSection) return [];

  const iterations: AdrIteration[] = [];
  let current: Partial<AdrIteration> | null = null;

  for (const child of iterationsSection.children) {
    const iterMatch = parseIterationHeading(child.heading);
    if (iterMatch) {
      if (current?.number !== undefined) iterations.push(current as AdrIteration);
      current = {
        number: iterMatch.number,
        date: iterMatch.date,
        lineStart: child.lineStart,
      };
      // Parse the body for Human/AI/Outcome fields
      const lines = child.body.split('\n');
      for (const line of lines) {
        const fieldMatch = line.trim().match(ITERATION_FIELD_RE);
        if (!fieldMatch) continue;
        const fieldKey = fieldMatch[1].toLowerCase();
        const fieldValue = fieldMatch[2].trim();
        if (fieldKey === 'human') current.human = fieldValue;
        else if (fieldKey.startsWith('ai')) {
          // Preserve model attribution: "AI (Sonnet 4.6):" → "(Sonnet 4.6): text"
          const suffix = fieldMatch[1].slice(2).trim(); // e.g., "(Sonnet 4.6)"
          current.ai = suffix ? `${suffix}: ${fieldValue}` : fieldValue;
        }
        else if (fieldKey === 'outcome') current.outcome = fieldValue;
      }
    }
  }

  if (current?.number !== undefined) iterations.push(current as AdrIteration);
  return iterations;
}

// ---------------------------------------------------------------------------
// Deep link generation
// ---------------------------------------------------------------------------

function buildDeepLinks(sections: AdrSection[], questions: Question[]): DeepLink[] {
  const links: DeepLink[] = [];

  function addSectionLinks(section: AdrSection): void {
    links.push({
      slug: section.slug,
      displayText: section.heading,
      lineNumber: section.lineStart,
      type: 'section',
    });
    for (const child of section.children) addSectionLinks(child);
  }

  for (const section of sections) addSectionLinks(section);

  for (const q of questions) {
    links.push({
      slug: q.slug,
      displayText: q.text,
      lineNumber: q.lineStart,
      type: 'question',
    });
    if (q.aliasSlug) {
      // Bound trailing "(QST-PETNAME)" alias — a second addressable anchor
      // for the same question; `slug` above stays the canonical one.
      links.push({
        slug: q.aliasSlug,
        displayText: q.text,
        lineNumber: q.lineStart,
        type: 'question',
      });
    }
    if (q.answer) {
      links.push({
        slug: `${q.slug}-answer`,
        displayText: `Answer to: ${q.text}`,
        lineNumber: q.answer.line,
        type: 'answer',
      });
    }
  }

  return links;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface ParseOptions {
  /** Project namespace for cross-project deep links */
  namespace?: string;
}

/**
 * Parse an ADR file from its raw content and absolute path.
 * Returns a fully typed AdrFile regardless of format variant.
 * Never throws — parse errors are surfaced as ParseWarning entries.
 */
export function parseAdr(content: string, filePath: string, options: ParseOptions = {}): AdrFile {
  const checksum = crypto.createHash('sha1').update(content).digest('hex');
  const parsedAt = Date.now();
  const warnings: ParseWarning[] = [];
  const allSlugs = new Set<string>();

  // Stage 1: tokenize
  const tokens = tokenize(content);

  // Detect format
  const { format } = detectFormat(tokens);

  // Extract raw sections from the token stream
  const { title, titleLine, sections: rawSections } = extractRawSections(tokens);

  if (!title) {
    warnings.push({ code: 'MISSING_TITLE', message: 'ADR is missing a level-1 heading (# Title).' });
  }

  // Extract metadata from the preamble (tokens before the first ## section)
  // These appear between the # Title heading and the ## Quick Reference or first ## section
  const preambleTokens = tokens.filter(t => t.line > (titleLine ?? 0) && (
    rawSections.length === 0 || t.line < rawSections[0].heading.line
  ));
  const metadata = extractMetadata(preambleTokens);
  warnings.push(...metadata.warnings);

  // ADR-0039 §2 (round-trip gate, Tier 1): exact raw title line + exact raw
  // preamble text, undefined when there's no title line to anchor to. The
  // title token is looked up by line rather than threaded through
  // extractRawSections' return (which only carries text) — cheap, and
  // keeps that function's signature untouched for its other callers.
  const titleToken = titleLine !== undefined
    ? tokens.find((t): t is HeadingToken => t.kind === 'heading' && t.line === titleLine)
    : undefined;
  const titleRaw = titleToken?.raw;
  const preambleRaw = titleLine !== undefined ? preambleTokens.map(t => t.raw).join('\n') : undefined;

  // Build typed sections
  const slugOccurrences = new Map<string, number>();
  const sections: AdrSection[] = rawSections.map(raw =>
    buildSection(raw, allSlugs, warnings, slugOccurrences)
  );

  // Trailing "(QST-PETNAME)" aliases: bound (or refused) file-wide BEFORE
  // questions are read off the sections, so Question.text/qstId/aliasSlug
  // reflect the outcome (ledger ruling 2026-09-26).
  resolveAliasHandles(sections, warnings);

  // Extract questions (QST sections + their children)
  const adrNumber = extractAdrNumber(filePath);
  const questions: Question[] = [];

  function collectQuestions(sectionList: AdrSection[]): void {
    for (const s of sectionList) {
      if (s.navCode === 'QST') {
        questions.push({ ...extractQuestion(s, adrNumber, filePath, metadata.deciders, warnings), sourceKind: 'adr' });
      }
      collectQuestions(s.children);
    }
  }
  collectQuestions(sections);

  // Extract inline nav codes (ANS, NOT that appear inline, not as headings)
  const inlineCodes = extractInlineCodes(sections);

  // Extract iteration history
  const iterations = extractIterations(sections);
  const iterationsAppendLine = computeIterationsAppendLine(sections);

  // Build deep link index
  const deepLinks = buildDeepLinks(sections, questions);

  // ADR-0012: Warn when ADR filename uses non-4-digit prefix (e.g., 001-foo.md)
  if (hasNonstandardNumbering(filePath)) {
    warnings.push({
      code: 'NONSTANDARD_NUMBERING',
      message: `ADR filename "${path.basename(filePath)}" uses a non-4-digit number prefix. The canonical format is 4-digit zero-padded (0001). Displayed as ADR-${String(adrNumber).padStart(4, '0')} — no data loss.`,
    });
  }

  // ADR-0012: Warn when non-standard QST format is detected (### QST-N: or **Preference?**)
  const hasNonstandardQst = detectNonstandardQstFormat(tokens);
  if (hasNonstandardQst) {
    warnings.push({
      code: 'NONSTANDARD_QST_FORMAT',
      message: 'Some question blocks appear to use a non-standard format (e.g., ### QST-1: or **Your preference?**). The extension only extracts questions using the "### QST: text / - Status: unanswered" format. See the adr template for the canonical structure.',
    });
  }

  // Seeds (title starts with "SEED:") are brain dumps, not decisions.
  // They don't require a Status field — remove the MISSING_STATUS warning.
  const isSeed = (title ?? '').toUpperCase().startsWith('SEED:');
  const finalWarnings = isSeed
    ? warnings.filter(w => w.code !== 'MISSING_STATUS')
    : warnings;

  return {
    path: filePath,
    number: adrNumber,
    title: title ?? path.basename(filePath, '.md'),
    titleRaw,
    preambleRaw,
    isSeed,
    date: metadata.date,
    iteration: metadata.iteration,
    iterationLine: metadata.iterationLine,
    status: metadata.status ?? 'Draft',
    scopeRemaining: metadata.scopeRemaining,
    awaiting: metadata.awaiting,
    awaitingCondition: metadata.awaitingCondition,
    deciders: metadata.deciders,
    format,
    sections,
    questions,
    inlineCodes,
    iterations,
    iterationsAppendLine,
    namespace: options.namespace,
    deepLinks,
    checksum,
    parseWarnings: finalWarnings,
    parsedAt,
  };
}
