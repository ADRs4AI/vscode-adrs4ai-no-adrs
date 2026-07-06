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
import { KNOWN_STATUS_VALUES, requiresScopeRemaining } from './statusInfo'
import { tokenize, extractRawSections, type RawSection, type Token } from './tokenizer'
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
} from './types'
import { KNOWN_STATUSES } from './types'

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/** All heading text that strongly signals collab-adr-lean format */
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
    return { format: 'collab-adr-lean', confidence: 'high', signals };
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
  status?: AdrStatus;
  scopeRemaining?: string;
  awaiting?: string;
  awaitingCondition?: { adr: string; predicate: string };
  deciders: string[];
  warnings: ParseWarning[];
}

// ADR-0014 Iteration 2: "- **Awaiting**: ADR-0035 == implemented" (or "ADR 0035", "== accepted", etc.)
const AWAITING_DSL_RE = /^ADR[-\s]?(\d+)\s*==\s*(.+)$/i;

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
        if (!isNaN(n)) result.iteration = n;
        break;
      }
      case 'status': {
        result.status = value;
        // INTENTIONALLY strict: do NOT add prefix-match tolerance here.
        // Even a "short" annotation like "Accepted (updated)" pollutes the status
        // taxonomy and sends the wrong signal — that ad-hoc annotations in the
        // status field are acceptable. The field encodes workflow state only.
        // The right fix is ADR-0014's D7 Socratic handler, which detects annotated
        // values and guides models toward structured alternatives (**Awaiting**:,
        // **Scope Remaining**:, etc.) instead of silently accepting them.
        // See: seed-2026-03-18-case-studies-on-models-experience-with-extension-feedback-ho.md
        if (!KNOWN_STATUS_VALUES.includes(value)) {
          result.warnings.push({
            code: 'UNKNOWN_STATUS',
            message: `ADR status "${value}" is not a recognized value. Known statuses: ${KNOWN_STATUS_VALUES.join(', ')}.`,
            line: token.line,
          });
        }
        break;
      }
      case 'deciders': {
        result.deciders = value.split(',').map(s => s.trim()).filter(Boolean);
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
  // Nav code headings: "QST: What is the scope?" → "qst-what-is-the-scope"
  // Falls back to the tolerant match so a glued colon ("QST:What is it") still
  // slugs as "qst-what-is-it" instead of merging into "qstwhat-is-it" — the
  // slug must stay canonical regardless of which form the heading used
  // (deep-link stability, ADR-0002), independent of the ParseWarning below.
  const navMatch = heading.match(NAV_CODE_HEADING_RE) ?? heading.match(NAV_CODE_HEADING_TOLERANT_RE);
  if (navMatch) {
    return slugify(`${navMatch[1].toLowerCase()}-${navMatch[2]}`);
  }
  return slugify(heading);
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

function buildSection(raw: RawSection, allSlugs: Set<string>, warnings: ParseWarning[]): AdrSection {
  const heading = raw.heading.text;
  let navMatch = heading.match(NAV_CODE_HEADING_RE);

  // Tolerant fallback (ADR-0024): recover navCode for headings that only
  // deviate in case or colon spacing, so the question doesn't just disappear.
  // The deviation itself is still surfaced — accept liberally, warn always.
  if (!navMatch) {
    const tolerant = heading.match(NAV_CODE_HEADING_TOLERANT_RE);
    if (tolerant) {
      navMatch = tolerant;
      warnings.push({
        code: 'NONCANONICAL_NAV_CODE_HEADING',
        message: `Heading "${heading}" was recognized as ${tolerant[1].toUpperCase()} but doesn't match the canonical "${tolerant[1].toUpperCase()}: text" form (case or colon spacing differs). Recognized anyway — no data lost — but the canonical form is what other tools (deep links, MCP) expect. SUGGESTED: "${tolerant[1].toUpperCase()}: ${tolerant[2].trim()}"`,
        line: raw.heading.line,
      });
    }
  }

  let slug = sectionSlug(heading);
  let anchorOverride: string | undefined;

  // Check if the first non-blank token after the heading is an @adr-anchor comment
  const firstNonBlank = raw.body.find(t => t.kind !== 'blank');
  if (firstNonBlank?.kind === 'html_comment') {
    const anchorMatch = firstNonBlank.content.match(ANCHOR_COMMENT_RE);
    if (anchorMatch) {
      anchorOverride = anchorMatch[1].trim();
      slug = anchorOverride; // override slug with explicit anchor
    }
  }

  // Check for duplicate slugs
  if (allSlugs.has(slug)) {
    const unique = `${slug}-${raw.heading.line}`;
    warnings.push({
      code: 'DUPLICATE_SLUG',
      message: `Two sections resolve to the same slug "${slug}". Using "${unique}" for line ${raw.heading.line}.`,
      line: raw.heading.line,
    });
    slug = unique;
  }
  allSlugs.add(slug);

  // Build body text (re-join body tokens, preserving blank lines)
  const bodyLines = raw.body.map(t => t.raw);
  const body = bodyLines.join('\n').trim();

  const lineEnd = raw.body.length > 0
    ? raw.body[raw.body.length - 1].line
    : raw.heading.line;

  // Find nested subsections within the body (### and #### headings)
  const children = buildSubsections(raw.body, allSlugs, warnings);

  return {
    level: raw.heading.level,
    heading,
    navCode: navMatch ? navMatch[1].toUpperCase() as NavCode : undefined,
    navCodeText: navMatch ? navMatch[2].trim() : undefined,
    body,
    lineStart: raw.heading.line,
    lineEnd,
    slug,
    anchorOverride,
    children,
  };
}

function buildSubsections(bodyTokens: Token[], allSlugs: Set<string>, warnings: ParseWarning[]): AdrSection[] {
  const subsections: AdrSection[] = [];
  let current: { heading: ReturnType<typeof tokenize>[number] & { kind: 'heading' }; body: Token[] } | null = null;

  for (const token of bodyTokens) {
    if (token.kind === 'heading' && token.level >= 3) {
      if (current) {
        subsections.push(buildSection(
          { heading: current.heading, body: current.body },
          allSlugs,
          warnings,
        ));
      }
      current = { heading: token, body: [] };
      continue;
    }
    if (current) {
      current.body.push(token);
    }
  }
  if (current) {
    subsections.push(buildSection({ heading: current.heading, body: current.body }, allSlugs, warnings));
  }

  return subsections;
}

// ---------------------------------------------------------------------------
// Question extraction
// ---------------------------------------------------------------------------

// Matches: **ANS:** (by Author) or **ANS:** (from Author)
const ANS_INLINE_RE = /^\*\*ANS:\*\*\s*(?:\((?:by|from)\s+([^)]+)\))?/;
// Matches: - Status: value
const STATUS_LINE_RE = /^-\s+Status:\s+(.+)$/;
// Matches: - Why asking: value
const WHY_ASKING_RE = /^-\s+Why asking:\s+(.+)$/;
// Matches: - Need: value
const NEED_RE = /^-\s+Need:\s+(.+)$/;
// Matches the legacy form (**My recommendation**: text, ADR-0002 Iteration 3)
// and the protocol form (**Recommendation**: (by Author, date), ADR-0019).
const RECOMMENDATION_RE = /^\*\*(?:My recommendation|Recommendation)\*\*:\s*(.*)/;
// Protocol-form label lines carry only an attribution: "(by Fable 5, 2026-06-10)".
// Their body spans blank lines (paragraphs), unlike legacy single-paragraph prose.
const REC_ATTRIBUTION_ONLY_RE = /^\((?:by|from)[^)]*\)\s*$/;

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

function extractQuestion(section: AdrSection, adrNumber: number, adrPath: string): Question {
  const lines = section.body.split('\n');
  let statusText = 'unanswered';
  let whyAsking: string | undefined;
  let need: string | undefined;
  let recommendation: string | undefined;
  let answer: QuestionAnswer | undefined;

  let inAnswer = false;
  let inRecommendation = false;
  // ADR-0019 interim bridge: protocol-form blocks span blank lines; legacy
  // blocks end at the first blank line (preserving ADR-0010 behavior).
  let recProtocolForm = false;
  // pastRecommendation: true once we have seen AND exited a recommendation block.
  // Lines before recommendation → rawBody (context/grammar/options).
  // Lines after recommendation → rawBodyPost (orphaned closing remarks).
  let pastRecommendation = false;
  // Multi-line field continuation: LLMs often word-wrap field values at ~80 chars.
  // A continuation line starts with whitespace (2-space indent) and is not a new
  // bullet field or block element. Join with ' ' (space) since it's word-wrapping.
  let inWhyAsking = false;
  let inNeed = false;
  const answerLines: string[] = [];
  const recommendationLines: string[] = [];
  // ADR-0019 display bridge: index into recommendationLines where each new
  // **Recommendation**:/**My recommendation**: block starts, so the flat
  // array can be re-split into per-block text for stacked rendering.
  const recommendationBlockStarts: number[] = [];
  const rawBodyLinesPre: string[] = [];
  const rawBodyLinesPost: string[] = [];
  let answerAuthor: string | undefined;
  let answerLine: number | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const absLine = section.lineStart + i + 1;

    if (inAnswer) {
      answerLines.push(lines[i]);
      continue;
    }

    // Multi-line field continuation: an indented line (starts with whitespace)
    // that is not blank, not a new bullet field, and not a block element.
    const isContinuation = /^\s+\S/.test(lines[i]) && line !== ''
      && !/^-\s+/.test(line) && !/^\*\*/.test(line);

    if (inWhyAsking) {
      if (isContinuation) { whyAsking = (whyAsking ?? '') + ' ' + line; continue; }
      inWhyAsking = false; // fall through to process this line normally
    }
    if (inNeed) {
      if (isContinuation) { need = (need ?? '') + ' ' + line; continue; }
      inNeed = false; // fall through
    }

    const statusMatch = line.match(STATUS_LINE_RE);
    // ADR-0012: trim to handle "- Status:  answered " with trailing/leading spaces
    if (statusMatch) { statusText = statusMatch[1].trim(); inRecommendation = false; inWhyAsking = false; inNeed = false; continue; }

    const whyMatch = line.match(WHY_ASKING_RE);
    if (whyMatch) { whyAsking = whyMatch[1].trim(); inRecommendation = false; inWhyAsking = true; inNeed = false; continue; }

    const needMatch = line.match(NEED_RE);
    if (needMatch) { need = needMatch[1].trim(); inRecommendation = false; inNeed = true; inWhyAsking = false; continue; }

    // Recommendation: starts with **My recommendation**: and may span multiple lines
    const recMatch = line.match(RECOMMENDATION_RE);
    if (recMatch) {
      // A second **Recommendation**: label lands here too — stacked blocks
      // (multiple models on one QST) accumulate into a single field until
      // ADR-0019's multi-recommendation model replaces this bridge.
      // Each marker also opens a new block boundary (see recommendations[] below).
      inRecommendation = true;
      recommendationBlockStarts.push(recommendationLines.length);
      const firstLine = recMatch[1].trim();
      recProtocolForm = REC_ATTRIBUTION_ONLY_RE.test(firstLine);
      if (firstLine) recommendationLines.push(firstLine);
      continue;
    }

    // Continue collecting recommendation lines until hitting a new bold-key block,
    // the ANS block, or a blank line followed by a heading-like continuation.
    // ADR-0010: Fix greediness — stop at "**Caveat**:", "**Edge case**:", etc.
    if (inRecommendation) {
      if (line === '') {
        // Protocol-form bodies are multi-paragraph: keep collecting across
        // blank lines until ANS / a new bold-key block / the QST's end.
        if (recProtocolForm) { recommendationLines.push(''); continue; }
        inRecommendation = false; pastRecommendation = true; continue;
      }
      // Stop at any new **Key**: block that isn't the ANS marker
      if (/^\*\*[A-Z][^*]+\*\*:/.test(line) && !/^\*\*ANS:\*\*/.test(line) && !/^\*\*My recommendation\*\*:/.test(line)) {
        inRecommendation = false; pastRecommendation = true;
        /* fall through — process this line normally */
      } else if (/^\*\*ANS:\*\*/.test(line)) {
        inRecommendation = false; pastRecommendation = true; /* fall through */
      } else {
        recommendationLines.push(line);
        continue;
      }
    }

    const ansMatch = line.match(ANS_INLINE_RE);
    if (ansMatch) {
      inAnswer = true;
      answerAuthor = ansMatch[1]?.trim();
      answerLine = absLine;
      // Collect any text on the same line after the ANS marker
      const afterMarker = line.replace(ANS_INLINE_RE, '').trim();
      if (afterMarker) answerLines.push(afterMarker);
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
  const rawBody = rawBodyLinesPre.length > 0 ? rawBodyLinesPre.join('\n') : undefined
  const rawBodyPost = rawBodyLinesPost.length > 0 ? rawBodyLinesPost.join('\n') : undefined

  if (answerLines.length > 0) {
    // Strip trailing horizontal rules and blank lines (--- separators between sections
    // are included in the section body and leak into the answer text)
    while (answerLines.length > 0) {
      const last = answerLines[answerLines.length - 1].trim();
      if (last === '---' || last === '') answerLines.pop();
      else break;
    }
    const answerText = answerLines.join('\n').trim();
    // ADR-0012: Tolerant placeholder matching — treat "[Fill this in]" variants as no-answer.
    const isPlaceholder = /^\[\s*fill\s+this\s+in[^\]]*\]$/i.test(answerText);
    if (answerText && !isPlaceholder) {
      answer = { text: answerText, author: answerAuthor, line: answerLine! };
    }
  }

  // ADR-0012: Case-insensitive, trimmed comparison — human-typed values like "Answered" should work.
  const isAnswered = statusText.toLowerCase().trim() === 'answered' || !!answer;

  if (recommendationLines.length > 0) {
    recommendation = recommendationLines.join('\n').trim() || undefined;
  }

  let recommendations: string[] | undefined;
  if (recommendationBlockStarts.length > 0) {
    const bounds = [...recommendationBlockStarts, recommendationLines.length];
    const blocks: string[] = [];
    for (let i = 0; i < recommendationBlockStarts.length; i++) {
      const text = recommendationLines.slice(bounds[i], bounds[i + 1]).join('\n').trim();
      if (text) blocks.push(text);
    }
    if (blocks.length > 0) recommendations = blocks;
  }

  return {
    id: `adr-${String(adrNumber).padStart(4, '0')}-${section.slug}`,
    slug: section.slug,
    text: section.navCodeText || section.heading,
    statusText,
    isAnswered,
    whyAsking,
    need,
    recommendation,
    recommendations,
    rawBody,
    rawBodyPost,
    answer,
    adrNumber,
    adrPath,
    lineStart: section.lineStart,
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

// Matches: ### Iteration 2 (2026-03-02) or ### Iteration 1
const ITERATION_HEADING_RE = /^Iteration\s+(\d+)(?:\s+\(([^)]+)\))?$/i;
// Matches: - Human: ...  or  - AI (Sonnet 4.6):  ...
const ITERATION_FIELD_RE = /^-\s+(Human|AI[^:]*|Outcome):\s+(.+)$/;

function extractIterations(sections: AdrSection[]): AdrIteration[] {
  const iterationsSection = sections.find(s => s.heading === 'Iterations');
  if (!iterationsSection) return [];

  const iterations: AdrIteration[] = [];
  let current: Partial<AdrIteration> | null = null;

  for (const child of iterationsSection.children) {
    const iterMatch = child.heading.match(ITERATION_HEADING_RE);
    if (iterMatch) {
      if (current?.number !== undefined) iterations.push(current as AdrIteration);
      current = {
        number: parseInt(iterMatch[1], 10),
        date: iterMatch[2],
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

  // Build typed sections
  const sections: AdrSection[] = rawSections.map(raw =>
    buildSection(raw, allSlugs, warnings)
  );

  // Extract questions (QST sections + their children)
  const adrNumber = extractAdrNumber(filePath);
  const questions: Question[] = [];

  function collectQuestions(sectionList: AdrSection[]): void {
    for (const s of sectionList) {
      if (s.navCode === 'QST') {
        questions.push(extractQuestion(s, adrNumber, filePath));
      }
      collectQuestions(s.children);
    }
  }
  collectQuestions(sections);

  // Extract inline nav codes (ANS, NOT that appear inline, not as headings)
  const inlineCodes = extractInlineCodes(sections);

  // Extract iteration history
  const iterations = extractIterations(sections);

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
      message: 'Some question blocks appear to use a non-standard format (e.g., ### QST-1: or **Your preference?**). The extension only extracts questions using the "### QST: text / - Status: unanswered" format. See the collab-adr-lean template for the canonical structure.',
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
    isSeed,
    date: metadata.date,
    iteration: metadata.iteration,
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
    namespace: options.namespace,
    deepLinks,
    checksum,
    parseWarnings: finalWarnings,
    parsedAt,
  };
}
