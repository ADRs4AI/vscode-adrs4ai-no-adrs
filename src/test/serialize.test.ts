/**
 * serializeAdr() unit tests — precise synthetic edge cases, complementing
 * serializeRoundTrip.test.ts's real-corpus sweep (ADR-0039 §2, Tier 1).
 */

import { describe, it, expect } from 'vitest';
import { parseAdr } from '../parser/extractor';
import { serializeAdr, hasRoundTripFidelity } from '../parser/serialize';

describe('serializeAdr', () => {
  it('reconstructs a simple ADR byte-for-byte, including exact blank-line spacing', () => {
    const content = [
      '# ADR-0001: Title',
      '',
      '- **Status**: Draft',
      '',
      '',
      '## Section One',
      '',
      'Some body text.',
      '',
      '## Section Two',
      'No blank line before this text.',
      '',
    ].join('\n');
    const adr = parseAdr(content, '/fake/docs/adr/0001-x.md');
    expect(hasRoundTripFidelity(adr)).toBe(true);
    expect(serializeAdr(adr)).toBe(content);
  });

  it('reconstructs a title + preamble with no sections at all', () => {
    const content = '# ADR-0001: Title\n\nJust preamble, no ## sections.\n';
    const adr = parseAdr(content, '/fake/docs/adr/0001-x.md');
    expect(serializeAdr(adr)).toBe(content);
  });

  it('reconstructs nested subsections (### under ##) verbatim, since a top-level body already contains its children raw', () => {
    const content = [
      '# ADR-0001: Title', '',
      '## Questions', '',
      '### QST: A question?', '- Status: unanswered', '',
      '**ANS:**', '[Fill this in]', '',
    ].join('\n');
    const adr = parseAdr(content, '/fake/docs/adr/0001-x.md');
    expect(serializeAdr(adr)).toBe(content);
  });

  it('preserves trailing whitespace-only lines and no-trailing-newline files', () => {
    for (const content of [
      '# ADR-0001: Title\n\n## Section\n\nBody.',
      '# ADR-0001: Title\n\n## Section\n\nBody.\n\n\n',
    ]) {
      const adr = parseAdr(content, '/fake/docs/adr/0001-x.md');
      expect(serializeAdr(adr)).toBe(content);
    }
  });

  it('returns null (never throws, never silently mis-reconstructs) when there is no title line at all', () => {
    const content = '## Just a section, no # title\n\nBody.\n';
    const adr = parseAdr(content, '/fake/docs/adr/0001-x.md');
    expect(hasRoundTripFidelity(adr)).toBe(false);
    expect(serializeAdr(adr)).toBeNull();
  });

  it('returns null for a hand-built AdrSection missing headingRaw/bodyRaw (a fixture, not a real parse)', () => {
    const adr = parseAdr('# ADR-0001: Title\n\n## Section\n\nBody.\n', '/fake/docs/adr/0001-x.md');
    adr.sections[0] = { ...adr.sections[0], headingRaw: undefined, bodyRaw: undefined };
    expect(hasRoundTripFidelity(adr)).toBe(false);
    expect(serializeAdr(adr)).toBeNull();
  });
});
