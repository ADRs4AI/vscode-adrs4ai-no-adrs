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
  | 'Accepted'
  | 'Implemented'
  | 'Superseded'
  | 'Proposed'
  | string;          // tolerate unknown statuses (warn, don't reject)

/** Navigation codes used in collab-adr-lean format */
export type NavCode = 'QST' | 'ANS' | 'COD' | 'API' | 'FIL' | 'DOC' | 'NOT';

export const KNOWN_STATUSES: AdrStatus[] = [
  'Draft', 'Accepted', 'Implemented', 'Superseded', 'Proposed',
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
  date?: string;
  /** Latest iteration number from the header */
  iteration: number;
  status: AdrStatus;
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

  /** Resolved project namespace for cross-project deep links */
  namespace?: string;
  /** All addressable anchors (for deep-link resolution) */
  deepLinks: DeepLink[];

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
  children: AdrSection[]; // nested sub-sections
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
  whyAsking?: string;
  need?: string;
  answer?: QuestionAnswer;
  adrNumber: number;
  adrPath: string;
  /** Line number of the ### QST: heading */
  lineStart: number;
  /** AI-inferred priority (1 = highest). Null until Haiku inference runs. */
  priority?: 1 | 2 | 3 | 4;
}

export interface QuestionAnswer {
  text: string;
  author?: string;
  /** Line number of the **ANS:** marker */
  line: number;
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
  | 'UNKNOWN_STATUS'       // status field has an unrecognized value
  | 'MISSING_STATUS'       // status field is absent
  | 'BULLET_FORMAT'        // metadata line uses * instead of - **Key**:
  | 'DUPLICATE_SLUG'       // two sections resolve to the same slug
  | 'UNKNOWN_FORMAT'       // file doesn't match any known format
  | 'MISSING_TITLE'        // no # Title heading found
  | 'ANSWER_WITHOUT_QST';  // **ANS:** found but no preceding QST block

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
