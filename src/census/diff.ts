/**
 * ADR-0031 element 2 — the census diff engine (`docs/QST-DETECTION-LEDGER.md`
 * "qst-census harness" row). Spec: the `1709` implementation plan, §4.
 *
 * Diff semantics are COVERAGE, not counts — Quarry's `0001` sweep warning is
 * load-bearing: a raw-count comparison under-flags zoo-010 (1 parsed count
 * happens to equal a phantom section-label match, hiding that all three
 * real questions are invisible) and would over-flag any file where a
 * placeholder-ish word legitimately appears twice in one answered question.
 * So: a discrepancy is a loose-signal LINE not covered by any parsed
 * question's LINE EXTENT (orphan_signal), or, symmetrically, a parsed
 * question whose extent covers zero loose-signal lines (phantom_question —
 * catches a future regression where candidacy outruns the loose tier, which
 * the invariant test in signals.test.ts should already prevent, but the
 * census is the second, file-content-driven line of defense).
 *
 * This module depends on signals.ts and extractor.ts only — per the 1709
 * plan's explicit rule, it must never grow a private grep of its own.
 */

import { tokenize } from '../parser/tokenizer';
import { looseSignals, type Signal } from '../parser/signals';
import { parseAdr } from '../parser/extractor';
import type { AdrSection } from '../parser/types';

export interface CensusDiscrepancy {
  kind: 'orphan_signal' | 'phantom_question';
  line: number;
  raw: string;
  signalKind?: Signal['kind'];
  questionSlug?: string;
}

interface QuestionExtent {
  slug: string;
  lineStart: number;
  lineEnd: number;
}

function collectQuestionExtents(sections: AdrSection[]): QuestionExtent[] {
  const extents: QuestionExtent[] = [];
  for (const section of sections) {
    if (section.navCode === 'QST') {
      extents.push({ slug: section.slug, lineStart: section.lineStart, lineEnd: section.lineEnd });
    }
    extents.push(...collectQuestionExtents(section.children));
  }
  return extents;
}

function coveringExtent(line: number, extents: QuestionExtent[]): QuestionExtent | undefined {
  return extents.find(e => line >= e.lineStart && line <= e.lineEnd);
}

/**
 * Diff one file's loose signals against what parseAdr() actually recalled
 * as questions. Returns discrepancies only — an empty array means every
 * loose-tier hit in this file falls inside some parsed question's extent,
 * and every parsed question's extent contains at least one loose signal.
 */
export function censusDiff(content: string, filePath: string): CensusDiscrepancy[] {
  const tokens = tokenize(content);
  const loose = looseSignals(tokens);
  const adr = parseAdr(content, filePath);
  const extents = collectQuestionExtents(adr.sections);

  const discrepancies: CensusDiscrepancy[] = [];

  for (const signal of loose) {
    const extent = coveringExtent(signal.line, extents);
    if (!extent) {
      discrepancies.push({
        kind: 'orphan_signal',
        line: signal.line,
        raw: signal.raw,
        signalKind: signal.kind,
      });
    }
  }

  for (const extent of extents) {
    const covered = loose.some(s => s.line >= extent.lineStart && s.line <= extent.lineEnd);
    if (!covered) {
      discrepancies.push({
        kind: 'phantom_question',
        line: extent.lineStart,
        raw: '',
        questionSlug: extent.slug,
      });
    }
  }

  return discrepancies.sort((a, b) => a.line - b.line);
}
