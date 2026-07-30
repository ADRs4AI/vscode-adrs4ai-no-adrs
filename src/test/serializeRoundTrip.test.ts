/**
 * ADR-0039 §2, Tier 1 of the round-trip gate: semantic-model round-trip —
 * `serializeAdr(parseAdr(x)) === x`, byte-for-byte — over census-clean,
 * non-hard-wrapped, non-seed files. Scope, precisely:
 *
 * - "Census-clean" (`censusDiff(x, path).length === 0`) is exactly "fully
 *   recognized" per ADR-0031/the census infrastructure — this IS the file
 *   filter ADR-0039 asked for, already shipped, reused directly.
 * - "Non-hard-wrapped" isn't independently detectable yet (that lands with
 *   hard-wrap reversibility, ADR-0039's second slice) — in practice, every
 *   census-clean file in this repo's own corpus happens to be non-wrapped
 *   today, so the filter is currently a no-op; this comment is the flag
 *   for whoever adds wrap detection that this test's scope needs revisiting.
 * - "Non-seed": seeds parse through a structurally different path
 *   (`seedExtractor.ts`/`SeedFile`) that doesn't yet populate the raw
 *   spans `serializeAdr()` needs (`titleRaw`/`preambleRaw` on `SeedFile`,
 *   analogous to `AdrFile`'s) — a real, separate follow-up, not swept
 *   under this test's green checkmark. Probed 2026-07-30
 *   (`scripts/ephemeral/2026-07-30-probe-tier1-serialize-baseline.ts`):
 *   every one of this repo's census-clean seed files currently has zero
 *   round-trip fidelity for exactly this reason.
 *
 * Unlike census.test.ts's snapshot-subset pattern, this is a HARD,
 * unconditional assertion for the scoped set — probed 2026-07-30 at
 * 36/36 with zero mismatches, so there's no known-noise floor to track.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseAdr } from '../parser/extractor';
import { serializeAdr, hasRoundTripFidelity } from '../parser/serialize';
import { censusDiff } from '../census/diff';

const ADR_DIR = resolve(__dirname, '../../docs/adr');

function listCensusCleanNonSeedFiles(): string[] {
  return readdirSync(ADR_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('seed-'))
    .map(e => e.name)
    .filter(name => {
      const p = resolve(ADR_DIR, name);
      return censusDiff(readFileSync(p, 'utf8'), p).length === 0;
    })
    .sort();
}

describe('Semantic round-trip gate (ADR-0039 Tier 1) — census-clean, non-seed docs/adr files', () => {
  it('at least one file is in scope — an empty sweep would pass vacuously and hide a real regression', () => {
    expect(listCensusCleanNonSeedFiles().length).toBeGreaterThan(0);
  });

  it('every in-scope file has full round-trip fidelity (titleRaw/preambleRaw/headingRaw/bodyRaw all present) — a gap here means buildSection()/parseAdr() stopped populating a raw span', () => {
    const files = listCensusCleanNonSeedFiles();
    const missingFidelity = files.filter(f => {
      const p = resolve(ADR_DIR, f);
      return !hasRoundTripFidelity(parseAdr(readFileSync(p, 'utf8'), p));
    });
    expect(missingFidelity, missingFidelity.join('\n')).toEqual([]);
  });

  it('every in-scope file reconstructs byte-for-byte: serializeAdr(parseAdr(x)) === x', () => {
    const files = listCensusCleanNonSeedFiles();
    const mismatches: string[] = [];
    for (const file of files) {
      const p = resolve(ADR_DIR, file);
      const content = readFileSync(p, 'utf8');
      const serialized = serializeAdr(parseAdr(content, p));
      if (serialized !== content) mismatches.push(file);
    }
    // eslint-disable-next-line no-console
    console.log(`Tier 1 round-trip: ${files.length - mismatches.length}/${files.length} census-clean non-seed files reconstruct exactly`);
    expect(mismatches, mismatches.join('\n')).toEqual([]);
  });
});
