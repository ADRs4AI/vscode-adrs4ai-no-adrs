/**
 * ADR Parser — Type Contract
 *
 * This is the stable interface that all consumers (UI, MCP server, index) depend on.
 * See ADR-0002: Parser Architecture for the design rationale.
 *
 * Two format variants are supported:
 *  - 'collab-adr-lean': the primary target (QST/ANS/COD/NOT navigation codes, iterations)
 *  - 'madr-standard': classic MADR format (Context and Problem Statement, Decision Outcome, etc.)
 */

export type AdrFormat =
  | 'collab-adr-lean'
  | 'madr-standard'
  | 'madr-partial'   // has a title + some sections, but doesn't match either variant cleanly
  | 'unknown';       // unrecognized; shown in tree view but not indexed for questions

export type AdrStatus =
  | 'Draft'
  | 'Proposed'
  | 'Accepted'
  | 'Partially Implemented'
  | 'Implemented'
  | 'Superseded'
  | string;          // tolerate unknown statuses (warn, don't reject)

/** Navigation codes used in collab-adr-lean format */
export type NavCode = 'QST' | 'ANS' | 'COD' | 'API' | 'FIL' | 'DOC' | 'NOT';

/** @deprecated Import KNOWN_STATUS_VALUES from statusInfo.ts instead */
export const KNOWN_STATUSES: AdrStatus[] = [
  'Draft', 'Proposed', 'Accepted', 'Partially Implemented', 'Implemented', 'Superseded',
];

// ---------------------------------------------------------------------------
// Top-level ADR file
// ---------------------------------------------------------------------------

export interface AdrFile {
  /** Absolute path on disk */
  path: string;
  /** Numeric ADR number (from filename: 0001-*.md → 1) */
  number: number;
  /** ADR title (from the `# Title` heading) */
  title: string;
  /**
   * ADR-0039 §2 (round-trip gate, Tier 1): exact original title heading
   * line and exact raw text of everything between it and the first `##`
   * section (or EOF) — undefined when there's no title line to anchor to
   * (matches `titleLine` being undefined in parseAdr()). Additive fields
   * for reconstruction; `title`/parsed metadata fields are unchanged.
   */
  titleRaw?: string;
  preambleRaw?: string;
  date?: string;
  /** Latest iteration number from the header */
  iteration: number;
  status: AdrStatus;
  /**
   * When status is 'Partially Implemented', this field is required.
   * A brief description of what remains — parseable from the header bullet list.
   * Example: "SQLite FTS5 (Forma 2), MCP server (Forma 3), AI features (Forma 4)"
   * The parser emits MISSING_SCOPE_REMAINING if this is absent and status is Partially Implemented.
   */
  scopeRemaining?: string;
  /**
   * ADR-0014 Decision 2: optional free-form preamble field naming what
   * blocks this ADR from progressing. Parsed from `- **Awaiting**: value`.
   */
  awaiting?: string;
  /**
   * ADR-0014 Iteration 2 refinement: optional structured reading of `awaiting`
   * when it follows the `ADR-NNNN == predicate` DSL (e.g. `ADR-0035 == implemented`).
   * Populated alongside `awaiting` (the raw text); undefined when the value
   * is free-form prose.
   */
  awaitingCondition?: { adr: string; predicate: string };
  deciders: string[];
  format: AdrFormat;

  /** All top-level (##) and sub-level (###, ####) sections */
  sections: AdrSection[];
  /** Extracted QST blocks (collab-adr-lean only) */
  questions: Question[];
  /** Inline **NAV:** occurrences (ANS, NOT, etc.) outside of section headings */
  inlineCodes: InlineNavCode[];
  /** Iteration history entries (collab-adr-lean only) */
  iterations: AdrIteration[];
  /**
   * ADR-0039 §3 (SourceRange, first slice): the exact 1-indexed line a new
   * `### Iteration N` entry should be appended before — computed once,
   * structurally, at parse time (skipping the section's trailing blank
   * lines and its closing "---" separator) instead of re-derived by every
   * write site via its own backward-scan. Retires the guessing DEBRIEF-006
   * came from for this specific write target. Undefined when there's no
   * "## Iterations" section at all.
   */
  iterationsAppendLine?: number;

  /** Resolved project namespace for cross-project deep links */
  namespace?: string;
  /** All addressable anchors (for deep-link resolution) */
  deepLinks: DeepLink[];

  /** True when the title starts with "SEED:" — brain dumps, not decisions */
  isSeed: boolean;
  /** sha1 hex of raw file content — for change detection */
  checksum: string;
  parsedAt: number;
  parseWarnings: ParseWarning[];
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export interface AdrSection {
  level: number;          // 2 = ##, 3 = ###, 4 = ####
  heading: string;        // raw heading text (without # marks)
  navCode?: NavCode;      // present when heading matches "QST: text", "NOT: text", etc.
  navCodeText?: string;   // the text after "QST: " in the heading
  body: string;           // everything below this heading until the next same-or-higher heading
  lineStart: number;      // 1-indexed line number of the heading
  lineEnd: number;        // 1-indexed line number of last line in body
  /** Slug derived from heading for deep-linking. Overridden by @adr-anchor comment. */
  slug: string;
  /** Value from <!-- @adr-anchor: custom-slug --> comment immediately after heading */
  anchorOverride?: string;
  /**
   * HQ ADR-0012 (QST Identifier Grammar): the explicit, author-chosen id
   * from "### QST-<ID>: text", NFD-folded to [A-Z0-9-]{1,24} — interior
   * hyphens allowed since the 2026-07-16 widening (ADR-0032 QST-IDCHARSET,
   * HQ-paired; accents stripped — "QST-JÉRÉMIE" → "JEREMIE"). Undefined for
   * plain "### QST: text" headings (positional, no explicit handle) and for
   * non-QST nav codes (only questions get this grammar).
   */
  qstId?: string;
  children: AdrSection[]; // nested sub-sections
  /**
   * ADR-0039 §2 (round-trip gate, Tier 1): the exact original heading line,
   * unlike `heading` (text only, `#` marks and any unusual whitespace
   * stripped) — needed to reconstruct the source byte-for-byte. Optional:
   * always populated by buildSection(), but undefined on any hand-built
   * AdrSection fixture that bypasses the real parser (several exist in
   * tests) — required would force updating every one of them for a field
   * they have no reason to care about.
   */
  headingRaw?: string;
  /**
   * ADR-0039 §2: `body` above is `.trim()`-med (leading/trailing blank
   * lines collapsed) for every existing consumer; `bodyRaw` is the exact
   * untrimmed text, added alongside rather than changing `body` itself —
   * changing what hundreds of existing call sites receive is a much
   * larger blast radius than this ADR's scope. Optional for the same
   * hand-built-fixture reason as headingRaw.
   */
  bodyRaw?: string;
}

// ---------------------------------------------------------------------------
// Navigation code occurrences
// ---------------------------------------------------------------------------

/** An inline nav code occurrence: **ANS:** (by Jérémie) or **NOT:** text */
export interface InlineNavCode {
  code: NavCode;
  text: string;            // content after the code marker
  author?: string;         // extracted from "(by X)" or "(from X)"
  line: number;
  sectionSlug: string;     // which section this occurs in
}

// ---------------------------------------------------------------------------
// Recommendations (ADR-0019: Multi-Recommendation Data Model — ORJ as Structure)
// ---------------------------------------------------------------------------

export interface Recommendation {
  /** Model slug ("Fable 5", "Sonnet 4.6") or human name */
  author?: string;
  /** True when author was inferred from the ADR's Deciders line (legacy `**My recommendation**:` form) */
  authorInferred?: boolean;
  /** ISO date when present in the attribution parens (protocol form only) */
  date?: string;
  /** Body, including justification. For protocol form, excludes the attribution-only first line. */
  text: string;
  /** Bold first sentence — the skimmable lean — when present at the start of `text` */
  pick?: string;
  /** Line number of the block's marker (**Recommendation**:/**My recommendation**:) */
  line: number;
}

// ---------------------------------------------------------------------------
// Questions (QST blocks)
// ---------------------------------------------------------------------------

export interface Question {
  /** Stable unique ID: "adr-0001-qst-what-is-the-scope" */
  id: string;
  /** Short slug for deep-links: "qst-what-is-the-scope" */
  slug: string;
  /** The question text from the ### QST: heading */
  text: string;
  /** Raw status field value from "- Status: unanswered" */
  statusText: string;
  /** True if statusText is 'answered' or an answer block was found */
  isAnswered: boolean;
  /** Closed WITHOUT an answer: declared Status leads with withdrawn|superseded|moot (2026-08-07 ruling). Excluded from open counts; never 'answered'. */
  isRetired?: boolean;
  whyAsking?: string;
  /** The Open Follow-ups subtype's deferral reason (`- Why deferring:`) — the template's own field, extracted since v0.7.24 (Loftsman's catch). */
  whyDeferring?: string;
  need?: string;
  recommendation?: string;
  /**
   * ADR-0019: recommendation blocks split by source order (one entry per
   * **Recommendation**:/**My recommendation**: marker), each attributed.
   * `recommendation` above stays the flat concatenation for backward
   * compatibility with older consumers. ADR-0021 Iteration 10 (Riddle 5,
   * format ruling): this is now a DERIVED view — `rounds.flatMap(r =>
   * r.recommendations)` — kept through a deprecation window (anti-DLL-Hell),
   * not the source of truth. Consumers that need round correspondence
   * should read `rounds` instead.
   */
  recommendations?: Recommendation[];
  /** Pre-recommendation body: proposed grammars, option lists, analysis —
   *  unrecognized content that appears before **My recommendation**. */
  rawBody?: string;
  /** Post-recommendation body: orphaned closing remarks that appear after
   *  the recommendation's blank-line stop and before **ANS:**. */
  rawBodyPost?: string;
  answer?: QuestionAnswer;
  /**
   * Dialogue layering (system3 ADR-0033, 2026-07-24): all REAL answer
   * rounds, in document order, each optionally qualified ("to the updated
   * recommendation") and attributed. `answer` above stays the CURRENT
   * verdict — the last layer when real, undefined when the last layer is
   * an empty/placeholder slot (a re-ask awaiting its answer). Renderers
   * show `answer` prominently and may collapse earlier layers, mirroring
   * the stacked-recommendations display. ADR-0021 Iteration 10: also now a
   * DERIVED view — `rounds.filter(r => r.answer).map(r => r.answer)` —
   * kept through a deprecation window, not the source of truth.
   */
  answers?: RoundAnswer[];
  /**
   * ADR-0021 Iteration 10 (Riddle 5, format ruling, 2026-07-26): explicit
   * round grouping — the source of truth `recommendations`/`answers` above
   * are now derived from. Replaces implicit document-order correspondence
   * between the two flat arrays, which had no way to say which
   * recommendations a given answer round responds to once more than one
   * recommendation preceded an answer (found auditing this exact question
   * against `architecture-of-complexity`'s near-decomposability framework).
   *
   * Fold rule, stated once here — every consumer implements the same fold,
   * never a private re-derivation: a round is zero-or-more recommendations
   * followed by at most one answer; an answer CLOSES the current round; a
   * recommendation appearing after an answer OPENS a new round; an answer
   * with no preceding recommendation is a round with `recommendations: []`;
   * the empty trailing ANS slot (re-asked/awaiting, v0.7.32) is a final
   * round whose `answer` is undefined.
   *
   * Qualifiers (`RoundAnswer.qualifier`) are DISPLAY-ONLY — never parsed to
   * resolve correspondence. Document order alone decides round membership.
   */
  rounds: QuestionRound[];
  adrNumber: number;
  adrPath: string;
  /** Line number of the ### QST: heading */
  lineStart: number;
  /** AI-inferred priority (1 = highest). Null until Haiku inference runs. */
  priority?: 1 | 2 | 3 | 4;
  /**
   * ADR-0018 (QST/ANS Substrate, Step 3): which container kind this question
   * came from — 'adr' (default, omitted for pre-existing callers) or 'seed'.
   * Drives the merged Open Questions panel's icon/grouping per container.
   */
  sourceKind?: 'adr' | 'seed';
  /**
   * HQ ADR-0012 (QST Identifier Grammar): the explicit, author-chosen
   * handle from "### QST-<ID>: text" (NFD-folded, e.g. "JEREMIE"), or
   * undefined for a plain "### QST: text" heading. Mirrors
   * AdrSection.qstId — the default anchor is "qst-" + lowercase(qstId),
   * already reflected in `slug`; `@adr-anchor` still overrides both.
   */
  qstId?: string;
  /**
   * ADR-0039 §3 (SourceRange, first slice — single-line write-target
   * fields): the exact character span of the Status VALUE (e.g.
   * "unanswered" in "- Status: unanswered"), not the whole line — a write
   * tool can issue a surgical TextEdit at exactly these characters instead
   * of a line-number find-replace. Undefined when no Status line was
   * declared for this question at all (`statusText` still derives from
   * other signals in that case, per Status-authority).
   */
  statusRange?: SourceRange;
}

/**
 * ADR-0039 §2/§3 (Secretariat: SourceRange and the round-trip gate) —
 * character-level source location for a write-target node, in the spirit
 * of the seed's original interface sketch. 1-indexed lines (matching every
 * other `line`/`lineStart` field in this file); 0-indexed character
 * columns within that line (so `line.slice(startCol, endCol)` is the
 * exact span). Single-line only for now — `startLine === endLine` at every
 * current call site (Status lines, the Iterations append point); a
 * multi-line SourceRange (ANS/recommendation extents) is the second slice,
 * gated on hard-wrap reversibility (a wrapped field's true extent is a
 * LIST of single-line spans, not one multi-line range — see ADR-0039 §3).
 */
export interface SourceRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface QuestionAnswer {
  text: string;
  author?: string;
  /** Line number of the **ANS:** marker */
  line: number;
}

/**
 * One answer layer's content, as it appears within a round. `qualifier` is
 * DISPLAY-ONLY (e.g. "to the updated recommendation") — ADR-0021 Iteration
 * 10: never parsed to resolve which round an answer belongs to. Document
 * order alone decides that.
 */
export interface RoundAnswer {
  qualifier?: string;
  author?: string;
  text: string;
  line: number;
}

/**
 * ADR-0021 Iteration 10 (Riddle 5, format ruling): one fold-grouped round of
 * a question's dialogue. See `Question.rounds`'s doc comment for the fold
 * rule. `recommendations` may be empty (an answer with nothing preceding
 * it); `answer` is undefined for a round still awaiting its answer (the
 * empty trailing ANS slot, v0.7.32).
 */
export interface QuestionRound {
  recommendations: Recommendation[];
  answer?: RoundAnswer;
}

// ---------------------------------------------------------------------------
// Iterations
// ---------------------------------------------------------------------------

export interface AdrIteration {
  number: number;
  date?: string;
  human?: string;   // human's contribution summary
  ai?: string;      // AI's contribution summary (may include model name)
  outcome?: string;
  lineStart: number;
}

// ---------------------------------------------------------------------------
// Deep links
// ---------------------------------------------------------------------------

export interface DeepLink {
  /** Short slug usable in `adr:0001#slug` references */
  slug: string;
  displayText: string;
  lineNumber: number;
  type: 'section' | 'question' | 'answer' | 'iteration';
}

// ---------------------------------------------------------------------------
// Parse warnings (surfaced as VS Code diagnostics)
// ---------------------------------------------------------------------------

export type ParseWarningCode =
  | 'UNKNOWN_STATUS'           // status field has an unrecognized value
  | 'MISSING_STATUS'           // status field is absent
  | 'MISSING_SCOPE_REMAINING'  // status is 'Partially Implemented' but no Scope Remaining field
  | 'BULLET_FORMAT'            // metadata line uses * instead of - **Key**:
  | 'DUPLICATE_SLUG'           // two sections resolve to the same slug
  | 'UNKNOWN_FORMAT'           // file doesn't match any known format
  | 'MISSING_TITLE'            // no # Title heading found
  | 'ANSWER_WITHOUT_QST'       // **ANS:** found but no preceding QST block
  | 'NONSTANDARD_NUMBERING'    // ADR filename uses non-4-digit prefix (e.g., 001-foo.md)
  | 'DUPLICATE_NUMBER'         // two ADRs resolve to the same zero-padded number
  | 'NONSTANDARD_QST_FORMAT'   // QST blocks use a non-standard format (### QST-N: or **Preference?**)
  | 'NONCANONICAL_NAV_CODE_HEADING' // nav code heading recognized only case-insensitively or with a glued colon
  | 'NONCANONICAL_NAV_CODE_LEVEL'  // nav code heading recognized, but at the wrong heading level (## or #### instead of ###)
  | 'NONSTANDARD_FILL_PLACEHOLDER'  // ANS placeholder uses a non-canonical stock token (e.g. "[unanswered]" instead of "[Fill this in]")
  | 'NONSTANDARD_RECOMMENDATION_FORM' // Recommendation written as a dash-bullet field ("- Recommendation: ...") instead of the canonical standalone "**Recommendation**:" block
  | 'NONCANONICAL_ANS_MARKER'
  | 'STRUCTURAL_MARKER_INSIDE_DETAILS'       // ANS marker recognized, but with the colon outside the bold span ("**ANS** (by X):" instead of "**ANS:** (by X)")
  | 'NONSTANDARD_STATUS_LINE_FORM'  // QST-block Status field is bold ("- **Status**:") instead of the canonical plain form ("- Status:")
  | 'NONSTANDARD_STATUS_ANNOTATION'  // QST-block Status value is "answered"/"unanswered" plus a trailing annotation (e.g. "answered 2026-07-13 (reason)")
  | 'MALFORMED_QST_HANDLE_ID'        // handle-shaped heading ("### QST-<id>:") whose id fails the grammar — recognized as a question anyway, never silently dropped (ADR-0032 QST-IDCHARSET)
  | 'EMPHASIZED_STATUS_VALUE'        // status keyword wrapped in Markdown emphasis ("**answered**", "_accepted_") — recognized via stripInlineEmphasis, never defeats token matching (ADR-0052 specimen, 2026-07-22)
  | 'ANS_BYLINE_SCAFFOLD';           // ANS slot's entire content is a bare parenthetical ("(Name)") with no author already captured — read as an unfilled byline scaffold, not an answer (Herald's second tour, prefill noise, 2026-07-28)

export interface ParseWarning {
  code: ParseWarningCode;
  message: string;
  line?: number;
}

// ---------------------------------------------------------------------------
// Utility type for format detection results
// ---------------------------------------------------------------------------

export interface FormatDetectionResult {
  format: AdrFormat;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];  // what signals led to this detection (for debugging)
}

// ---------------------------------------------------------------------------
// Seed files (brain dumps, pre-decisional artifacts)
// See ADR-0011: Seeds as First-Class Artifacts
// ---------------------------------------------------------------------------

/** The three Model Response Request checkbox options on a seed thread entry */
export interface SeedRequest {
  /** [X] Chunk this into ADRs */
  chunk: boolean;
  /** [X] Iterate with me */
  iterate: boolean;
  /** [X] Structure in place */
  structure: boolean;
}

/** A single entry in a seed's discussion thread (model or human turn) */
export interface SeedThreadEntry {
  /** Author name from "### Author Name - Date" heading */
  author: string;
  /** Date string extracted from the heading (if present) */
  date?: string;
  /** The response content (everything below the heading until next heading or MRR block) */
  content: string;
  /** Model Response Request checkboxes at the end of this entry (if present) */
  request?: SeedRequest;
  /** 1-indexed line number of the ### heading */
  lineStart: number;
}

/** A reference to an ADR derived from this seed (in the ## Derived Into section) */
export interface DerivedAdr {
  /** ADR number if parseable from "ADR-NNNN:" */
  number?: number;
  /** Title / brief description */
  title: string;
  /** Raw line text */
  raw: string;
}

/** A parsed seed file (brain dump → decisions artifact) */
export interface SeedFile {
  /** Absolute path on disk */
  path: string;
  /** Full title from "# SEED: topic" heading */
  title: string;
  /** Topic text with "SEED: " prefix stripped */
  topic: string;
  /** Date from "- **Date**: YYYY-MM-DD" */
  date?: string;
  /** Author from "- **From**: Name" */
  from?: string;
  /**
   * Raw text from the header's "- **Status**: ..." bullet, when declared
   * (ADR-0041 item 2's seed-scoped axis-1 lifecycle: closed-family tokens
   * `parked | superseded | TERMINATED — <annotation>`). Undeclared for
   * most seeds (14/108 in the ratifying census) — absence is not a
   * closed state, just silence. Only the header bullet counts; a "Status"
   * line appearing later, inside section content (nested template quotes,
   * embedded examples), is not this seed's own declared status. Use
   * isRetiredSeedStatus() to classify.
   */
  status?: string;
  /** Content of the ## Brain Dump section */
  brainDump?: string;
  /** Thread entries from ## Thread section (new-format seeds) */
  threadEntries: SeedThreadEntry[];
  /** ADRs derived from this seed (from ## Derived Into section) */
  derivedAdrs: DerivedAdr[];
  /**
   * True if the Derived Into section contains real ADR references.
   * False if it still shows the default "(This seed has not yet been chunked into ADRs)" placeholder.
   */
  isProcessed: boolean;
  /**
   * True if the Derived Into section still contains the placeholder text,
   * regardless of whether any real ADR references are also present.
   * ADR-0016: precondition for the SEED_INCOMPLETE diagnostic.
   */
  derivedIntoHasPlaceholder: boolean;
  /** sha1 hex of raw file content */
  checksum: string;
  parsedAt: number;
  /**
   * ADR-0018 (QST/ANS Substrate, Step 2): `### QST:` blocks found anywhere
   * in this seed's top-level sections (not restricted to Brain Dump/Thread —
   * see DEBRIEF, Lapidary 5, 2026-07-12: a fixed section-name allowlist
   * silently dropped a QST living under an arbitrary heading like
   * "## Lineage"). Empty when the seed has none — previously these were
   * invisible to the Open Questions panel entirely.
   */
  questions: Question[];
  /** Parse-time diagnostics (heading-level/form deviations, etc.) — same shape as AdrFile.parseWarnings. */
  parseWarnings: ParseWarning[];
}
