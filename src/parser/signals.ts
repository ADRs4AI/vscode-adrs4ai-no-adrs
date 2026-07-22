/**
 * ADR-0031 element 1 — multi-signal candidacy, and the loose tier that
 * powers the census (`docs/QST-DETECTION-LEDGER.md` "qst-census harness"
 * row). Spec: Riddle 5's implementation plan, `docs/inbox/2026-07-13-1709-
 * riddle-to-flint-adr-0031-implementation-plan-signals-census-recall-
 * path.md`, §1/§3.
 *
 * Two tiers, deliberately different detectors:
 *  - candidateSignals(): what extractor.ts actually turns into a Question
 *    today. Reuses QST_HEADING_LINE_RE — the exported, canonical "is this
 *    heading read as a QST" line test that write-path scans already share
 *    with the extractor — so this tier can never silently drift from real
 *    parsing behavior by re-deriving its own copy of that judgment.
 *  - looseSignals(): a strict superset of token-presence greps for
 *    morphologies extractor.ts doesn't parse (yet): bare Status
 *    declarations, ANS-marker variants, placeholder-ish content, and QST
 *    tokens that never became a heading at all. This is where the census's
 *    discovery power comes from — a loose hit with no covering candidate
 *    is exactly the "unknown morphology" ADR-0031 exists to catch.
 *
 * Invariant (enforced by test, signals.test.ts): every line flagged by
 * candidateSignals() is also flagged by looseSignals(). If this ever
 * breaks, the census would diff detector-A against detector-B and report
 * noise as discovery instead of a real gap — see the 1709 plan, §3.
 *
 * Phase A scope only (per the plan's §5 table): this module does NOT
 * change what extractor.ts treats as a real question — S2/S5 promotion to
 * candidacy, the section-label guard, and the Q\d+ heading promotion are
 * Phase B. Fence-awareness (the mandatory guard before any loose signal
 * ships, §1) is applied throughout via BodyToken.inFence.
 */

import { tokenize, type Token } from './tokenizer';
import {
  QST_HEADING_LINE_RE,
  STATUS_LINE_RE,
  PLACEHOLDER_LEXICON_RE,
  stripPlaceholderWrapper,
} from './extractor';

export type SignalKind = 'S1' | 'S2' | 'S3' | 'S4' | 'S5';

export interface Signal {
  kind: SignalKind;
  line: number;
  raw: string;
}

// S1 — QST-ish heading. Loose tier extends the candidate tier with the
// "abandoned vocabulary" heading class (zoo-011: "### Q1:", "### Q2:" — no
// QST token at all, just a numbered question heading).
const Q_NUMBERED_HEADING_RE = /^#{1,6}\s+Q\d+[.:)]/;

// S5 — QST token that never became (or isn't) a heading.
// Bullet form (zoo-010: "- QST: ..."), fully-bold-inline form (zoo-012:
// "**QST: does the cache need a version key?**" — the whole "QST: text" is
// inside the bold span, unlike INLINE_NAV_RE's "**QST:**" + trailing text
// shape, which requires the closing ** immediately after the colon).
const QST_BULLET_RE = /^-\s*QST:/i;
const QST_BOLD_INLINE_RE = /^\*\*QST:\s*[^*]+\*\*/i;

// S3 — ANS-marker variants extractor.ts already parses (ANS_INLINE_RE /
// ANS_COLON_OUTSIDE_RE) plus the abandoned-vocabulary form (zoo-011:
// "**ANSWER: text**" inline, no two-line ANS pattern at all).
const ANS_MARKER_LOOSE_RE = /^\*\*ANS(?::\*\*|\*\*\s*(?:\([^)]*\))?:)|^\*\*ANSWER:\s*[^*]*\*\*|^\*\*ANSWER:\*\*/i;

// S4 — placeholder-ish content, loosened past the extractor's whole-content
// anchoring: a lexicon word appearing bracket/paren/italic-wrapped ANYWHERE
// in the line (not only when it IS the entire line), plus the bare empty
// box `[ ]` the whole-content regexes already catch as PLACEHOLDER_EMPTY_RE.
const PLACEHOLDER_EMPTY_RE = /^\[\s*\]$/;
const PLACEHOLDER_INLINE_WRAPPED_RE =
  /[[(_]\s*(?:unanswered|to be answered|tbd|todo|pending|awaiting|fill(?:\s+this)?\s+in)\b/i;

function hasPlaceholderSignal(text: string): boolean {
  const trimmed = text.trim();
  if (PLACEHOLDER_EMPTY_RE.test(trimmed)) return true;
  const { inner, wrapped } = stripPlaceholderWrapper(trimmed);
  if (wrapped && PLACEHOLDER_LEXICON_RE.test(inner)) return true;
  return PLACEHOLDER_INLINE_WRAPPED_RE.test(trimmed);
}

/**
 * What extractor.ts turns into a Question today: any heading line
 * QST_HEADING_LINE_RE recognizes as a QST heading (strict, tolerant-case,
 * handle, or malformed-handle forms — all recalled, per ADR-0031's own
 * recall-first floor).
 */
export function candidateSignals(tokens: Token[]): Signal[] {
  const signals: Signal[] = [];
  for (const token of tokens) {
    if (token.kind === 'heading' && QST_HEADING_LINE_RE.test(token.raw)) {
      signals.push({ kind: 'S1', line: token.line, raw: token.raw });
    }
  }
  return signals;
}

/**
 * The superset: everything candidateSignals() finds, plus morphologies the
 * extractor doesn't parse into a Question (yet) — the census's raw
 * material. Skips fenced code (inFence) for every body-token scan; heading
 * detection is already fence-suppressed at tokenize time.
 */
export function looseSignals(tokens: Token[]): Signal[] {
  const signals: Signal[] = [...candidateSignals(tokens)];

  // Preamble exclusion (2026-07-22, fixture perfection pass): the document
  // header's own metadata block — `- **Status**: Draft` etc., before the
  // first ## section — is NOT question territory, and S2 firing on it was
  // the census's single largest noise class (63 of the original 75 triaged
  // snapshot entries, plus 5 of 6 findings on the perfectly-canonical
  // fixture workspace). A question signal below needs a section to live in;
  // the preamble structurally cannot hold a QST.
  const firstSectionLine = tokens.find(t => t.kind === 'heading' && t.level >= 2)?.line ?? 0;

  for (const token of tokens) {
    if (token.kind === 'heading') {
      if (Q_NUMBERED_HEADING_RE.test(token.raw) && !QST_HEADING_LINE_RE.test(token.raw)) {
        signals.push({ kind: 'S1', line: token.line, raw: token.raw });
      }
      continue;
    }

    if (token.kind !== 'body' || token.inFence) continue;
    const text = token.text;

    if (STATUS_LINE_RE.test(text) && token.line > firstSectionLine) {
      signals.push({ kind: 'S2', line: token.line, raw: token.raw });
    }
    if (ANS_MARKER_LOOSE_RE.test(text.trim())) {
      signals.push({ kind: 'S3', line: token.line, raw: token.raw });
    }
    if (hasPlaceholderSignal(text)) {
      signals.push({ kind: 'S4', line: token.line, raw: token.raw });
    }
    if (QST_BULLET_RE.test(text.trim()) || QST_BOLD_INLINE_RE.test(text.trim())) {
      signals.push({ kind: 'S5', line: token.line, raw: token.raw });
    }
  }

  return signals.sort((a, b) => a.line - b.line);
}

/** Convenience: tokenize + looseSignals in one call, for census callers. */
export function looseSignalsForContent(content: string): Signal[] {
  return looseSignals(tokenize(content));
}
