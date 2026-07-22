/**
 * ADR-0031 Phase A — src/parser/signals.ts. Spec: the `1709` implementation
 * plan (§1 signal set, §3 module boundaries: "loose ⊇ candidate as an
 * invariant living in one file"). See docs/QST-DETECTION-LEDGER.md.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { tokenize } from '../parser/tokenizer';
import { candidateSignals, looseSignals } from '../parser/signals';

const ZOO_DIR = resolve(__dirname, 'fixtures/zoo');

function zooSpecimens(): string[] {
  return readdirSync(ZOO_DIR).filter(f => f.endsWith('.md') && f !== 'README.md');
}

describe('signals.ts — loose ⊇ candidate invariant', () => {
  it('every candidate signal line is also a loose signal line, for every zoo specimen', () => {
    for (const file of zooSpecimens()) {
      const content = readFileSync(resolve(ZOO_DIR, file), 'utf8');
      const tokens = tokenize(content);
      const candidateLines = new Set(candidateSignals(tokens).map(s => s.line));
      const looseLines = new Set(looseSignals(tokens).map(s => s.line));
      for (const line of candidateLines) {
        expect(looseLines.has(line), `${file}:${line} is a candidate but not a loose signal`).toBe(true);
      }
    }
  });

  it('holds on this repo\'s own ADR corpus too (docs/adr/*.md), not just the zoo', () => {
    const adrDir = resolve(__dirname, '../../docs/adr');
    const files = readdirSync(adrDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const content = readFileSync(resolve(adrDir, file), 'utf8');
      const tokens = tokenize(content);
      const candidateLines = new Set(candidateSignals(tokens).map(s => s.line));
      const looseLines = new Set(looseSignals(tokens).map(s => s.line));
      for (const line of candidateLines) {
        expect(looseLines.has(line), `${file}:${line} is a candidate but not a loose signal`).toBe(true);
      }
    }
  });
});

describe('signals.ts — S1 heading candidacy', () => {
  it('recognizes a canonical ### QST: heading as both candidate and loose', () => {
    const tokens = tokenize('### QST: Is this a question?\n');
    expect(candidateSignals(tokens)).toEqual([{ kind: 'S1', line: 1, raw: '### QST: Is this a question?' }]);
    expect(looseSignals(tokens).filter(s => s.kind === 'S1')).toHaveLength(1);
  });

  it('does NOT candidate-flag a plain prose heading with no QST token', () => {
    const tokens = tokenize('### Just a regular heading\n');
    expect(candidateSignals(tokens)).toEqual([]);
    expect(looseSignals(tokens)).toEqual([]);
  });
});

describe('signals.ts — S1 loose extension: abandoned-vocabulary "Q1:" headings (zoo-011)', () => {
  it('flags "### Q1:" as a loose-only S1 signal, never a candidate (extractor genuinely does not parse it)', () => {
    const content = readFileSync(resolve(ZOO_DIR, 'zoo-011-alternate-vocabulary-no-qst-ans-tokens.md'), 'utf8');
    const tokens = tokenize(content);
    const candidates = candidateSignals(tokens);
    const loose = looseSignals(tokens);
    expect(candidates.some(s => s.raw.includes('Q1:'))).toBe(false);
    expect(loose.some(s => s.kind === 'S1' && s.raw.includes('Q1:'))).toBe(true);
    expect(loose.some(s => s.kind === 'S1' && s.raw.includes('Q2:'))).toBe(true);
  });
});

describe('signals.ts — S2 bare Status declaration', () => {
  it('flags a plain "- Status:" line', () => {
    const tokens = tokenize('- Status: unanswered\n');
    expect(looseSignals(tokens)).toEqual([{ kind: 'S2', line: 1, raw: '- Status: unanswered' }]);
  });

  it('flags a bold "- **Status**:" line too (D2 morphology, same regex the extractor already tolerates)', () => {
    const tokens = tokenize('- **Status**: answered\n');
    expect(looseSignals(tokens)).toEqual([{ kind: 'S2', line: 1, raw: '- **Status**: answered' }]);
  });
});

describe('signals.ts — S3 ANS-marker variants (zoo-011 abandoned-vocabulary form)', () => {
  it('flags inline "**ANSWER: text**" as a loose S3 signal even though the extractor cannot pair it', () => {
    const content = readFileSync(resolve(ZOO_DIR, 'zoo-011-alternate-vocabulary-no-qst-ans-tokens.md'), 'utf8');
    const tokens = tokenize(content);
    const loose = looseSignals(tokens);
    expect(loose.filter(s => s.kind === 'S3')).toHaveLength(2);
  });
});

describe('signals.ts — S4 placeholder-ish content, loosened past whole-line anchoring', () => {
  it('flags a lexicon word wrapped inline, not only when it is the entire line', () => {
    const tokens = tokenize('Some prose that mentions [pending] in passing.\n');
    expect(looseSignals(tokens).some(s => s.kind === 'S4')).toBe(true);
  });

  it('flags a bare empty box "[ ]"', () => {
    const tokens = tokenize('[ ]\n');
    expect(looseSignals(tokens).some(s => s.kind === 'S4')).toBe(true);
  });

  it('does not flag ordinary prose with no placeholder wrapper or lexicon word', () => {
    const tokens = tokenize('This paragraph is a real, substantive answer.\n');
    expect(looseSignals(tokens).some(s => s.kind === 'S4')).toBe(false);
  });
});

describe('signals.ts — S5 QST token off-heading (zoo-010 bullets, zoo-012 bold-inline)', () => {
  it('flags "- QST: ..." bullet items (zoo-010)', () => {
    const content = readFileSync(resolve(ZOO_DIR, 'zoo-010-bulleted-questions-no-headings.md'), 'utf8');
    const tokens = tokenize(content);
    expect(looseSignals(tokens).filter(s => s.kind === 'S5')).toHaveLength(3);
  });

  it('flags "**QST: text**" fully-bold-inline body text (zoo-012)', () => {
    const content = readFileSync(resolve(ZOO_DIR, 'zoo-012-bold-inline-question-not-a-heading.md'), 'utf8');
    const tokens = tokenize(content);
    expect(looseSignals(tokens).some(s => s.kind === 'S5')).toBe(true);
  });
});

describe('signals.ts — fence-awareness (§1 mandatory guard)', () => {
  it('does not false-fire on a Status/ANS example pasted inside a fenced code block', () => {
    const content = [
      '```',
      "grep 'Status: unanswered' docs/adr/",
      '- Status: unanswered',
      '**ANS:** placeholder text',
      '```',
      '',
    ].join('\n');
    const tokens = tokenize(content);
    expect(looseSignals(tokens)).toEqual([]);
  });

  it('still fires on the identical line once it is outside the fence', () => {
    const tokens = tokenize('- Status: unanswered\n');
    expect(looseSignals(tokens).some(s => s.kind === 'S2')).toBe(true);
  });
});

describe('signals.ts — precision guard (zoo-002)', () => {
  it('a Decision-style ADR with no Questions section at all produces zero CANDIDATE signals', () => {
    const content = readFileSync(resolve(ZOO_DIR, 'zoo-002-decision-style-no-qsts.md'), 'utf8');
    const tokens = tokenize(content);
    expect(candidateSignals(tokens)).toEqual([]);
  });

  it('the loose tier NO LONGER fires on the header\'s own "- **Status**: Draft" metadata line — the preamble exclusion (2026-07-22 fixture perfection pass) retired what this test used to document as expected noise: a question signal needs a section to live in, and the preamble structurally cannot hold a QST. This was the census\'s single largest noise class (63 of 75 snapshot entries).', () => {
    const content = readFileSync(resolve(ZOO_DIR, 'zoo-002-decision-style-no-qsts.md'), 'utf8');
    const tokens = tokenize(content);
    expect(looseSignals(tokens)).toEqual([]);
  });
});
