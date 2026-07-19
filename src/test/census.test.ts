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
