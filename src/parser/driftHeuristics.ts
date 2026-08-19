/**
 * Implementation-drift heuristics (ADR-0043, H1–H3) — reading an ADR's
 * declared Status/Iteration against its own body. "One parser, one
 * recognition pass, N output modes": this is a SEPARATE, opt-in output mode
 * over an already-parsed AdrFile, not baked into parseAdr()'s always-on
 * warnings — Jérémie's own QST-APPLY rider ("we should be able to turn off
 * the suggestion") needs a caller that can simply not call this function,
 * not a warning filtered out after the fact. H4–H6 (git/inbox mining) live
 * in a composer above this — the parser must not grow a filesystem/git
 * dependency (ADR-0039 §4, the conformance zoo stays language-neutral).
 *
 * Two invariants from the ADR, non-negotiable:
 *  - Suggest, never set. Only H1 (structural, certain) carries a
 *    `suggestedIteration` a future one-click fix could splice; H2/H3 are
 *    evidence beside the claim, nothing more.
 *  - Recall-first: verified against the real "before" state of all 13 files
 *    in Touchstone's 2026-08-16 status sweep (`e7d7a86`) — the ADR's own
 *    stated ground truth (`docs/parser-drift-conformance.md` records the
 *    corpus) — before shipping, per QST-APPLY's falsifier.
 */

import type { AdrFile, AdrIteration, AdrSection } from './types';
import { parseIterationHeading } from './extractor';

// ---------------------------------------------------------------------------
// Lexicon — tweakable, not hard-coded into control flow (Jérémie's
// QST-APPLY rider: "not fully hard-coded... localization down the road").
// A caller building a different-language or house-specific vocabulary
// passes their own DriftLexicon; nothing here assumes DEFAULT_DRIFT_LEXICON.
// ---------------------------------------------------------------------------

export interface DriftLexicon {
  /** Case-insensitive terms in an Iteration entry that suggest shipped work. */
  completionTerms: string[];
  /** Case-insensitive terms suggesting work still pending. */
  remainingWorkTerms: string[];
  /** Extra regexes counted as completion evidence, merged with the built-in version-tag/commit-hash patterns below. */
  completionPatterns?: RegExp[];
}

/** `vX.Y.Z` version tags ("v0.7.46") and short/long hex commit hashes (7–40 chars), both real specimens in this repo's own Iteration entries. */
const VERSION_TAG_RE = /\bv\d+\.\d+\.\d+\b/i;
const COMMIT_HASH_RE = /\b[0-9a-f]{7,40}\b/i;

export const DEFAULT_DRIFT_LEXICON: DriftLexicon = {
  completionTerms: ['shipped', 'landed', 'green', 'ci-gated', 'merged', 'released'],
  remainingWorkTerms: ['queued', 'remaining', 'second slice', 'deferred', 'still open', 'todo'],
};

function containsAny(text: string, terms: string[]): string | undefined {
  const lower = text.toLowerCase();
  return terms.find(t => lower.includes(t.toLowerCase()));
}

function iterationText(entry: AdrIteration): string {
  return [entry.human, entry.ai, entry.outcome].filter(Boolean).join(' ');
}

function hasCompletionEvidence(text: string, lexicon: DriftLexicon): string | undefined {
  const term = containsAny(text, lexicon.completionTerms);
  if (term) return term;
  if (VERSION_TAG_RE.test(text)) return VERSION_TAG_RE.exec(text)![0];
  if (COMMIT_HASH_RE.test(text)) return COMMIT_HASH_RE.exec(text)![0];
  for (const re of lexicon.completionPatterns ?? []) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type DriftHeuristicId = 'H1' | 'H2' | 'H3';

export interface DriftFinding {
  heuristic: DriftHeuristicId;
  message: string;
  /** 1-indexed line to anchor a diagnostic on. */
  line: number;
  /** H1 only — the value a future one-click fix would splice into the header. */
  suggestedIteration?: number;
}

const DRAFT_OR_ACCEPTED = new Set(['Draft', 'Accepted']);

/**
 * H1 — counter drift, certain: header Iteration < count of "### Iteration N"
 * headings actually in the body. Literal per the ADR's own wording (count,
 * not max iteration number) — the identity check that needs no vocabulary
 * or interpretation, which is exactly why QST-APPLY ratified it as the one
 * heuristic allowed a one-click fix.
 */
/** All headings anywhere in the document, any depth — not just AdrFile.iterations, which is scoped to "## Iterations"'s own children (correct for that field's append-point purpose, but a real specimen, ADR-0004's pre-sweep state, has an "### Iteration 3" entry that physically landed under "## Questions" instead — a content-placement anomaly Touchstone's real correction still counted). */
function allHeadings(sections: AdrSection[]): string[] {
  const out: string[] = [];
  for (const s of sections) {
    out.push(s.heading);
    out.push(...allHeadings(s.children));
  }
  return out;
}

function detectH1(adr: AdrFile): DriftFinding[] {
  // Distinct NUMBERS, not raw heading count — found verifying against
  // Touchstone's real sweep (ADR-0041's "before" state has a genuine
  // duplicate "### Iteration 2" heading; the sweep bumped its header to 2,
  // not 3, so the ground truth counts distinct iteration numbers, not raw
  // heading occurrences, tolerating a stray/malformed duplicate the same
  // way recall-first elsewhere tolerates wild imperfection). Scanned across
  // the WHOLE document (not just AdrFile.iterations) for the same reason.
  const numbers = allHeadings(adr.sections)
    .map(parseIterationHeading)
    .filter((m): m is { number: number; date?: string } => m !== undefined)
    .map(m => m.number);
  const distinctNumbers = new Set(numbers).size;
  if (adr.iteration >= distinctNumbers) return [];
  return [{
    heuristic: 'H1',
    message: `Header declares Iteration ${adr.iteration}, but the body contains ${distinctNumbers} distinct "### Iteration N" headings. SUGGESTED: bump the header to Iteration ${distinctNumbers}.`,
    line: adr.iterationLine ?? 1,
    suggestedIteration: distinctNumbers,
  }];
}

/**
 * H2 — Status is still Draft/Accepted, but some Iteration entry's own text
 * (human/AI summary or Outcome) already reads like shipped work. "Post-
 * acceptance" per the ADR's table has no separate acceptance-date field to
 * gate on in this parser, so every Iteration entry is in scope — each
 * entry's own text is what supplies or withholds the evidence.
 */
function detectH2WithLexicon(adr: AdrFile, lexicon: DriftLexicon): DriftFinding[] {
  if (!DRAFT_OR_ACCEPTED.has(adr.status)) return [];
  const findings: DriftFinding[] = [];
  for (const entry of adr.iterations) {
    const text = iterationText(entry);
    const evidence = hasCompletionEvidence(text, lexicon);
    if (evidence) {
      findings.push({
        heuristic: 'H2',
        message: `Status is "${adr.status}", but Iteration ${entry.number} reads like shipped work ("${evidence}"). Evidence beside the claim — the document Status is unchanged.`,
        line: entry.lineStart,
      });
    }
  }
  return findings;
}

/**
 * H3 — refines an H2 hit: the same Iteration entry (or an open QST) ALSO
 * carries remaining-work vocabulary, meaning the evidence points at
 * Partially, not fully, Implemented.
 */
function detectH3WithLexicon(adr: AdrFile, h2: DriftFinding[], lexicon: DriftLexicon): DriftFinding[] {
  if (h2.length === 0) return [];
  const findings: DriftFinding[] = [];
  const entriesByLine = new Map(adr.iterations.map(e => [e.lineStart, e]));
  for (const h2Finding of h2) {
    const entry = entriesByLine.get(h2Finding.line);
    if (!entry) continue;
    const text = iterationText(entry);
    const term = containsAny(text, lexicon.remainingWorkTerms);
    if (term) {
      findings.push({
        heuristic: 'H3',
        message: `Iteration ${entry.number} also names remaining work ("${term}") alongside its shipped evidence — reads as Partially Implemented, not fully Implemented.`,
        line: entry.lineStart,
      });
      continue;
    }
    const openQuestion = adr.questions.find(q => !q.isAnswered);
    if (openQuestion) {
      findings.push({
        heuristic: 'H3',
        message: `Iteration ${entry.number} reads like shipped work, but "${openQuestion.text}" is still an open question — reads as Partially Implemented, not fully Implemented.`,
        line: entry.lineStart,
      });
    }
  }
  return findings;
}

/**
 * Runs H1–H3 over an already-parsed AdrFile. Opt-in — call this only when a
 * caller wants drift diagnostics (extension.ts gates it on a setting per
 * Jérémie's "turn off the suggestion" rider); parseAdr() itself never calls
 * this, keeping the one recognition pass unconditional and this an
 * additional, separate output mode over its result.
 */
export function detectImplementationDrift(adr: AdrFile, lexicon: DriftLexicon = DEFAULT_DRIFT_LEXICON): DriftFinding[] {
  const h1 = detectH1(adr);
  const h2 = detectH2WithLexicon(adr, lexicon);
  const h3 = detectH3WithLexicon(adr, h2, lexicon);
  return [...h1, ...h2, ...h3];
}
