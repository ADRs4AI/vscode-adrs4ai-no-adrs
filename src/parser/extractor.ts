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
// Matches: * Key: value  (old-style MADR)
const PLAIN_BULLET_RE = /^\*\s+([^:]+):\s+(.+)$/;

interface ExtractedMetadata {
  date?: string;
  iteration: number;
  status?: AdrStatus;
  scopeRemaining?: string;
  deciders: string[];
  warnings: ParseWarning[];
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
        if (!KNOWN_STATUSES.includes(value)) {
          result.warnings.push({
            code: 'UNKNOWN_STATUS',
            message: `ADR status "${value}" is not a recognized value. Known statuses: ${KNOWN_STATUSES.join(', ')}.`,
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
    }
  }

  if (!result.status) {
    result.warnings.push({
      code: 'MISSING_STATUS',
      message: 'ADR is missing a status field (Draft, Proposed, Accepted, Partially Implemented, Implemented, or Superseded).',
    });
    result.status = 'Draft'; // default fallback
  }

  if (result.status === 'Partially Implemented' && !result.scopeRemaining) {
    result.warnings.push({
      code: 'MISSING_SCOPE_REMAINING',
      message: 'ADR status is "Partially Implemented" but has no "Scope Remaining" field. Add: - **Scope Remaining**: what is still to be built.',
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
  const navMatch = heading.match(NAV_CODE_HEADING_RE);
  if (navMatch) {
    return slugify(`${navMatch[1].toLowerCase()}-${navMatch[2]}`);
  }
  return slugify(heading);
}

// ---------------------------------------------------------------------------
// ADR number extraction from filename
// ---------------------------------------------------------------------------

const ADR_FILENAME_RE = /^(\d{4})[-_]/;

export function extractAdrNumber(filePath: string): number {
  const basename = path.basename(filePath);
  const match = basename.match(ADR_FILENAME_RE);
  return match ? parseInt(match[1], 10) : 0;
}

// ---------------------------------------------------------------------------
// Section building
// ---------------------------------------------------------------------------

/** Look for <!-- @adr-anchor: slug --> on the line immediately after a heading */
const ANCHOR_COMMENT_RE = /^@adr-anchor:\s+(.+)$/;

function buildSection(raw: RawSection, allSlugs: Set<string>, warnings: ParseWarning[]): AdrSection {
  const heading = raw.heading.text;
  const navMatch = heading.match(NAV_CODE_HEADING_RE);

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
    navCode: navMatch ? navMatch[1] as NavCode : undefined,
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
// Matches: **My recommendation**: text
const RECOMMENDATION_RE = /^\*\*My recommendation\*\*:\s*(.*)/;

function extractQuestion(section: AdrSection, adrNumber: number, adrPath: string): Question {
  const lines = section.body.split('\n');
  let statusText = 'unanswered';
  let whyAsking: string | undefined;
  let need: string | undefined;
  let recommendation: string | undefined;
  let answer: QuestionAnswer | undefined;

  let inAnswer = false;
  let inRecommendation = false;
  const answerLines: string[] = [];
  const recommendationLines: string[] = [];
  let answerAuthor: string | undefined;
  let answerLine: number | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const absLine = section.lineStart + i + 1;

    if (inAnswer) {
      answerLines.push(lines[i]);
      continue;
    }

    const statusMatch = line.match(STATUS_LINE_RE);
    if (statusMatch) { statusText = statusMatch[1].trim(); inRecommendation = false; continue; }

    const whyMatch = line.match(WHY_ASKING_RE);
    if (whyMatch) { whyAsking = whyMatch[1].trim(); inRecommendation = false; continue; }

    const needMatch = line.match(NEED_RE);
    if (needMatch) { need = needMatch[1].trim(); inRecommendation = false; continue; }

    // Recommendation: starts with **My recommendation**: and may span multiple lines
    const recMatch = line.match(RECOMMENDATION_RE);
    if (recMatch) {
      inRecommendation = true;
      const firstLine = recMatch[1].trim();
      if (firstLine) recommendationLines.push(firstLine);
      continue;
    }

    // Continue collecting recommendation lines until the ANS block or a blank line
    // followed by a new bold/option line
    if (inRecommendation) {
      if (line === '') { inRecommendation = false; continue; }
      if (/^\*\*ANS:\*\*/.test(line)) { inRecommendation = false; /* fall through */ }
      else { recommendationLines.push(line); continue; }
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
  }

  if (answerLines.length > 0) {
    // Strip trailing horizontal rules and blank lines (--- separators between sections
    // are included in the section body and leak into the answer text)
    while (answerLines.length > 0) {
      const last = answerLines[answerLines.length - 1].trim();
      if (last === '---' || last === '') answerLines.pop();
      else break;
    }
    const answerText = answerLines.join('\n').trim();
    if (answerText && answerText !== '[Fill this in]') {
      answer = { text: answerText, author: answerAuthor, line: answerLine! };
    }
  }

  const isAnswered = statusText === 'answered' || !!answer;

  if (recommendationLines.length > 0) {
    recommendation = recommendationLines.join('\n').trim() || undefined;
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

  return {
    path: filePath,
    number: adrNumber,
    title: title ?? path.basename(filePath, '.md'),
    date: metadata.date,
    iteration: metadata.iteration,
    status: metadata.status ?? 'Draft',
    scopeRemaining: metadata.scopeRemaining,
    deciders: metadata.deciders,
    format,
    sections,
    questions,
    inlineCodes,
    iterations,
    namespace: options.namespace,
    deepLinks,
    checksum,
    parsedAt,
    parseWarnings: warnings,
  };
}
