/**
 * ADR Parser — Stage 1: Structural Tokenizer
 *
 * Converts raw markdown text into a flat array of structural tokens.
 * No ADR-specific knowledge lives here — just markdown structure.
 *
 * Design principle (ADR-0002): Keeping Stage 1 and Stage 2 separate means
 * we can swap the tokenizer without touching the semantic extractor.
 */

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

export type TokenKind = 'heading' | 'body' | 'html_comment' | 'blank';

interface BaseToken {
  kind: TokenKind;
  raw: string;
  line: number;  // 1-indexed
}

export interface HeadingToken extends BaseToken {
  kind: 'heading';
  level: number;  // 1–6
  text: string;   // heading content without # marks or surrounding whitespace
}

export interface BodyToken extends BaseToken {
  kind: 'body';
  text: string;
}

export interface HtmlCommentToken extends BaseToken {
  kind: 'html_comment';
  content: string;  // everything inside <!-- ... -->
}

export interface BlankToken extends BaseToken {
  kind: 'blank';
}

export type Token = HeadingToken | BodyToken | HtmlCommentToken | BlankToken;

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const FENCE_OPEN_RE = /^(`{3,}|~{3,})/;

// Matches a complete single-line HTML comment: <!-- content -->
// Multi-line comments are collapsed to the first line only (rare in ADRs)
const HTML_COMMENT_RE = /^<!--\s*(.*?)\s*-->$/;

/**
 * Tokenize a markdown string into a flat sequence of tokens.
 * Line numbers are 1-indexed and correspond to the original source.
 */
export function tokenize(source: string): Token[] {
  const lines = source.split('\n');
  const tokens: Token[] = [];

  // Track fenced code blocks so that `# headings` inside them are not
  // misidentified as document headings. This was the root cause of ADR-0005
  // showing a code-block example line as its title.
  let inFencedCode = false;
  let fenceChar = '';
  let fenceLen = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNumber = i + 1;
    const trimmed = raw.trimStart();

    // Detect fenced code block open/close
    const fenceMatch = trimmed.match(FENCE_OPEN_RE);
    if (fenceMatch) {
      const fc = fenceMatch[1][0];
      const fl = fenceMatch[1].length;
      if (!inFencedCode) {
        inFencedCode = true;
        fenceChar = fc;
        fenceLen = fl;
        tokens.push({ kind: 'body', text: raw, raw, line: lineNumber });
        continue;
      } else if (fc === fenceChar && fl >= fenceLen) {
        inFencedCode = false;
        tokens.push({ kind: 'body', text: raw, raw, line: lineNumber });
        continue;
      }
    }

    // Inside a fenced code block — everything is body, no heading detection
    if (inFencedCode) {
      tokens.push({ kind: 'body', text: raw, raw, line: lineNumber });
      continue;
    }

    if (raw.trim() === '') {
      tokens.push({ kind: 'blank', raw, line: lineNumber });
      continue;
    }

    const headingMatch = raw.match(HEADING_RE);
    if (headingMatch) {
      tokens.push({
        kind: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2],
        raw,
        line: lineNumber,
      });
      continue;
    }

    const commentMatch = raw.trim().match(HTML_COMMENT_RE);
    if (commentMatch) {
      tokens.push({
        kind: 'html_comment',
        content: commentMatch[1],
        raw,
        line: lineNumber,
      });
      continue;
    }

    tokens.push({ kind: 'body', text: raw, raw, line: lineNumber });
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Utility: group tokens into sections by heading level
// ---------------------------------------------------------------------------

/**
 * A raw structural section: a heading token followed by its body tokens.
 * Nesting is NOT resolved at this stage — that's the extractor's job.
 */
export interface RawSection {
  heading: HeadingToken;
  /** All tokens between this heading and the next heading at the same or higher level */
  body: Token[];
}

/**
 * Extract a flat list of top-level (##) sections from the token stream.
 * Level-1 heading (# Title) is treated as the document title, not a section.
 * Sections below ## are included as body tokens of their parent section.
 */
export function extractRawSections(tokens: Token[]): {
  title: string | undefined;
  titleLine: number | undefined;
  sections: RawSection[];
} {
  let title: string | undefined;
  let titleLine: number | undefined;
  const sections: RawSection[] = [];
  let current: RawSection | null = null;

  for (const token of tokens) {
    if (token.kind === 'heading' && token.level === 1) {
      title = token.text;
      titleLine = token.line;
      // Close any open section (shouldn't happen but be safe)
      if (current) sections.push(current);
      current = null;
      continue;
    }

    if (token.kind === 'heading' && token.level === 2) {
      if (current) sections.push(current);
      current = { heading: token, body: [] };
      continue;
    }

    // Everything else (including deeper headings) is body of the current section
    if (current) {
      current.body.push(token);
    }
    // Tokens before any ## heading (between title and first section) are ignored
  }

  if (current) sections.push(current);

  return { title, titleLine, sections };
}
