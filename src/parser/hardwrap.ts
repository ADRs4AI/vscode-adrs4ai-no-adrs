/**
 * Hard-wrap join helpers — hard-wrap robustness charter (Lapidary 5,
 * 2026-07-13 reframe of the 0420 brief: "the extension must be robust to
 * hard-wrapped input at render time... a filter that does a best-effort
 * translate for rendering", not just a weak recommendation against it —
 * Jérémie: "there's *never* a time where you want" a viewport's line-fold
 * baked into the substrate).
 *
 * Ported from scripts/unwrap-adrs/unwrap-adrs.mjs's join logic (17/17
 * self-tested, proven prior art — Lapidary: "lift it, don't reinvent it")
 * rather than reimplementing hyphen-aware soft-wrap joining from scratch.
 * Deliberately narrower than the script: the script normalizes an entire
 * markdown document (fences, blockquotes, tables, headings, HTML blocks —
 * a full line-classification state machine); this module only needs to
 * join the CONSTRAINED constructs that appear inside an already-isolated
 * QST section body (recommendation prose, option bullets) — so it ports
 * the join primitive and the list-item continuation detector, not the
 * full document-level machinery.
 */

/**
 * Join lines that were hard-wrapped back into one logical line, joining a
 * hyphenated word split across the wrap point without inserting a space
 * (`docs/example-` + `2026.md` → `docs/example-2026.md`, not
 * `docs/example- 2026.md`).
 */
export function joinSoftWrappedLines(lines: string[]): string {
  return lines.map(l => l.trim()).reduce((joined, line) => {
    if (joined === '') return line;
    if (/-$/.test(joined) && /^[A-Za-z0-9`]/.test(line)) return `${joined}${line}`;
    return `${joined} ${line}`;
  }, '');
}

function countLeadingSpaces(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

const LIST_ITEM_RE = /^( {0,3})([-*+]|(?:0|[1-9]\d{0,8})[.)])(\s+)(.*)$/;

function matchListItem(line: string): RegExpMatchArray | null {
  return line.match(LIST_ITEM_RE);
}

/**
 * Is `line` a hard-wrapped continuation of a list item whose content
 * starts at `minIndent`, rather than a new list item, a heading, a
 * blockquote, a table row, or one of the QST/ANS/placeholder markers this
 * parser treats specially? Mirrors unwrap-adrs.mjs's
 * isListContinuationLine, minus the fence/HTML-block/link-ref-definition
 * checks (rawBody is already isolated to a QST section — those constructs
 * don't appear there in practice, and skipping them keeps this a direct,
 * auditable port rather than a speculative superset).
 */
function isListContinuationLine(line: string, minIndent: number): boolean {
  if (line.trim() === '') return false;
  if (countLeadingSpaces(line) < minIndent) return false;
  const trimmed = line.trim();
  if (matchListItem(line)) return false;
  if (/^#{1,6}\s+/.test(trimmed)) return false;
  if (/^>/.test(trimmed)) return false;
  if (/^\|/.test(trimmed)) return false;
  if (/^\*\*(?:ANS|QST)\b/.test(trimmed)) return false;
  if (/^\[Fill this in\]$/.test(trimmed)) return false;
  return true;
}

/**
 * Unwrap hard-wrapped list items in a block of lines — a QST's rawBody/
 * rawBodyPost, typically the A/B/C option bullets (Lapidary's named
 * specimen: "wrapped option bullets" escaping their `<li>` and rendering
 * as bare paragraphs in the panel, since the webview's line-based markdown
 * renderer only recognizes a line as a list item if it itself starts with
 * a marker — a hard-wrapped continuation line doesn't). Lines that aren't
 * part of a list item are passed through untouched.
 */
export function unwrapListItems(lines: string[]): string[] {
  const output: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const match = matchListItem(lines[i]);
    if (!match) {
      output.push(lines[i]);
      i += 1;
      continue;
    }
    const [, indent, marker, spacing, content] = match;
    const minIndent = indent.length + marker.length + spacing.length;
    const block = [content];
    let j = i + 1;
    while (j < lines.length && isListContinuationLine(lines[j], minIndent)) {
      block.push(lines[j]);
      j += 1;
    }
    output.push(`${indent}${marker}${spacing}${joinSoftWrappedLines(block)}`);
    i = j;
  }
  return output;
}

/**
 * Unwrap hard-wrapped prose paragraphs — every non-blank line joins its
 * neighbors until a blank line, which is preserved as a genuine paragraph
 * break. Used for recommendation text: the legacy form is a single
 * paragraph (no blank lines, everything joins); the protocol form is
 * multi-paragraph (ADR-0019), and paragraph boundaries must survive.
 */
export function unwrapParagraphs(lines: string[]): string[] {
  const output: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length > 0) {
      output.push(joinSoftWrappedLines(buffer));
      buffer = [];
    }
  };
  for (const line of lines) {
    if (line.trim() === '') {
      flush();
      output.push('');
      continue;
    }
    buffer.push(line);
  }
  flush();
  return output;
}
