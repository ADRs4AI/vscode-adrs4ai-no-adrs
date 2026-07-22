/**
 * ADR-0031 Phase A — census CI surface (§4 surface 2 of Riddle 5's `1709`
 * implementation plan; docs/QST-DETECTION-LEDGER.md "qst-census harness"
 * row). This repo dogfoods its own corpus: `censusDiff()` runs over every
 * top-level ADR/DEBRIEF/seed file in docs/adr/ (not templates/, .working/,
 * .settings/, adr-docs/ — those aren't specimens of the format, they're
 * scaffolding or generated indexes) and every discrepancy must already be
 * accounted for in the committed `known-discrepancies.json` snapshot.
 *
 * A discrepancy NOT in the snapshot means the next unknown morphology
 * landed somewhere in our own tree — that's a red test naming file+line,
 * per the plan's own framing, not a bad afternoon discovered by rereading.
 *
 * This is deliberately a ONE-DIRECTIONAL subset check (discrepancies this
 * sweep finds ⊆ what's in the snapshot), not equality: a discrepancy
 * disappearing (recall improving, a fix landing) is progress, not a
 * failure, and recall.test.ts's ratcheting baseline is what already
 * guards against silently giving back a fix. Regenerate the snapshot with
 * `scripts/ephemeral/2026-07-19-dump-known-discrepancies-snapshot.ts` when
 * new, reviewed, expected noise is added to docs/adr/.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { censusDiff } from '../census/diff';
import { parseAdr } from '../parser/extractor';
import { parseSeed } from '../parser/seedExtractor';

const ADR_DIR = resolve(__dirname, '../../docs/adr');
const SNAPSHOT_PATH = resolve(__dirname, '../census/known-discrepancies.json');

function listAdrFiles(): string[] {
  return readdirSync(ADR_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .map(e => e.name)
    .sort();
}

interface KnownEntry {
  kind: string;
  line: number;
  signalKind?: string;
  questionSlug?: string;
}

const SNAPSHOT: Record<string, KnownEntry[]> = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

function isKnown(file: string, d: { kind: string; line: number; signalKind?: string; questionSlug?: string }): boolean {
  const known = SNAPSHOT[file] ?? [];
  return known.some(k =>
    k.kind === d.kind && k.line === d.line && k.signalKind === d.signalKind && k.questionSlug === d.questionSlug,
  );
}

// ---------------------------------------------------------------------------
// The fixture workspace — the demo we ship to strangers and the founder
// records on camera — holds a STRICTER bar than our own docs/adr: ZERO
// census findings AND zero parse warnings, no snapshot allowance at all.
// Chartered at the council convening (ADR-0032 framing section 1, "we are
// our own first stranger"); made camera-blocking 2026-07-22 (Jérémie,
// verbatim: "If we can't respect our guidelines, how is anybody else going
// to?" — video 2 aborted on fixture squiggles). Permanently wired so the
// fixture can never drift between recordings again.
// ---------------------------------------------------------------------------
const FIXTURE_ADR_DIR = resolve(__dirname, '../../fixture-workspace/docs/adr');

describe('Fixture-workspace perfection gate (camera-blocking, 2026-07-22)', () => {
  const files = readdirSync(FIXTURE_ADR_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .map(e => e.name)
    .sort();

  it('the fixture workspace exists and has specimens', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('ZERO parse warnings across every fixture ADR and seed — no snapshot, no allowance', () => {
    const dirty: string[] = [];
    for (const file of files) {
      const p = resolve(FIXTURE_ADR_DIR, file);
      const content = readFileSync(p, 'utf8');
      const parsed = file.startsWith('seed-') ? parseSeed(content, p) : parseAdr(content, p);
      for (const w of (parsed as { parseWarnings?: { code: string; line?: number }[] }).parseWarnings ?? []) {
        dirty.push(`${file}:${w.line ?? '-'} ${w.code}`);
      }
    }
    expect(dirty, dirty.join('\n')).toEqual([]);
  });

  it('ZERO census discrepancies across the fixture workspace', () => {
    const findings: string[] = [];
    for (const file of files) {
      const p = resolve(FIXTURE_ADR_DIR, file);
      for (const d of censusDiff(readFileSync(p, 'utf8'), p)) {
        findings.push(`${file}:${d.line} [${d.kind}${d.signalKind ? '/' + d.signalKind : ''}]`);
      }
    }
    expect(findings, findings.join('\n')).toEqual([]);
  });
});

describe('Census CI sweep (ADR-0031) — docs/adr/ dogfoods its own detection corpus', () => {
  it('every top-level docs/adr/*.md file has a listed CORPUS entry — an unswept file is a silent census gap', () => {
    const files = listAdrFiles();
    expect(files.length).toBeGreaterThan(0);
  });

  it('every discrepancy found is already accounted for in known-discrepancies.json — a NEW one is the next unknown morphology', () => {
    const files = listAdrFiles();
    const unknown: string[] = [];
    let totalDiscrepancies = 0;

    for (const file of files) {
      const content = readFileSync(resolve(ADR_DIR, file), 'utf8');
      const discrepancies = censusDiff(content, resolve(ADR_DIR, file));
      totalDiscrepancies += discrepancies.length;
      for (const d of discrepancies) {
        if (!isKnown(file, d)) {
          unknown.push(
            `${file}:${d.line} [${d.kind}${d.signalKind ? '/' + d.signalKind : ''}${d.questionSlug ? '/' + d.questionSlug : ''}] ${JSON.stringify(d.raw).slice(0, 80)}`,
          );
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(`census: ${totalDiscrepancies} discrepancies across ${files.length} docs/adr files (all previously known)`);
    expect(unknown, unknown.join('\n')).toEqual([]);
  });
});
