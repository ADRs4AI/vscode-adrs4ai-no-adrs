/**
 * ADR-0039 §2, Tier 0 of the round-trip gate: `serialize(tokenize(x)) === x`,
 * byte-for-byte, unconditionally — not gated on census-cleanliness or
 * hard-wrap (that scoping is Tier 1's, once the semantic model is what's
 * being reconstructed). Tokenize() never drops or normalizes a line, so
 * this holds for ANY markdown input, malformed or not; the sweep below is
 * the CI gate that keeps it true — a future tokenizer change that trims,
 * normalizes, or drops a raw line fails this same-day, before it ever
 * reaches a lossy `body`/`answer.text` field downstream.
 *
 * Swept: every top-level docs/adr/*.md (this repo's own corpus, including
 * DEBRIEFs and seeds), the fixture workspace (the stranger-facing demo),
 * and the zoo corpus (deliberately malformed/wild specimens — the property
 * must hold there too, since tokenize() doesn't get to fail gracefully by
 * dropping bytes, only by mis-classifying tokens).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { tokenize, serialize } from '../parser/tokenizer';

function listMdFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .map(e => e.name)
    .sort();
}

function assertRoundTrips(dir: string, label: string) {
  const files = listMdFiles(dir);
  expect(files.length, `${label}: expected at least one .md file to sweep`).toBeGreaterThan(0);

  const mismatches: string[] = [];
  for (const file of files) {
    const content = readFileSync(resolve(dir, file), 'utf8');
    const rebuilt = serialize(tokenize(content));
    if (rebuilt !== content) mismatches.push(file);
  }
  expect(mismatches, `${label}: tokenizer round-trip broke for: ${mismatches.join(', ')}`).toEqual([]);
}

describe('Tokenizer round-trip gate (ADR-0039 Tier 0)', () => {
  it('docs/adr/*.md — every top-level ADR/DEBRIEF/seed reconstructs byte-for-byte', () => {
    assertRoundTrips(resolve(__dirname, '../../docs/adr'), 'docs/adr');
  });

  it('fixture-workspace/docs/adr/*.md — the stranger-facing demo reconstructs byte-for-byte', () => {
    assertRoundTrips(resolve(__dirname, '../../fixture-workspace/docs/adr'), 'fixture-workspace/docs/adr');
  });

  it('the zoo corpus (deliberately wild/malformed specimens) still reconstructs byte-for-byte — tokenize() never drops a line, only mis-classifies it', () => {
    assertRoundTrips(resolve(__dirname, 'fixtures/zoo'), 'zoo corpus');
  });

  it('unit-level: a trailing newline, no trailing newline, and an empty file all round-trip', () => {
    for (const content of ['line one\nline two\n', 'line one\nline two', '', '\n', '# Title only']) {
      expect(serialize(tokenize(content))).toBe(content);
    }
  });
});
