/**
 * Regenerates src/census/known-discrepancies.json.
 *
 * Content-keyed as of 2026-08-08 (Riddle 5's dispatch: the same ADR-0032
 * entry needed 3 manual recalibrations in 3 days — every edit to that
 * living document shifts line numbers below the insertion point, and the
 * old line-keyed snapshot treated an unchanged discrepancy sitting on a
 * new line as a brand-new, unknown one). `line` is still recorded for a
 * human's benefit when reading the file, but matching (census.test.ts's
 * isKnown()) keys on `raw` (the flagged text itself) for orphan_signal,
 * or `questionSlug` for phantom_question (whose `raw` is always empty) —
 * neither shifts when unrelated content moves around them.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { censusDiff } from '../../src/census/diff';

const dir = resolve(__dirname, '../../docs/adr');
const files = readdirSync(dir).filter(f => f.endsWith('.md')).sort();
const snapshot: Record<string, { kind: string; line: number; raw?: string; signalKind?: string; questionSlug?: string }[]> = {};
for (const file of files) {
  const path = resolve(dir, file);
  const content = readFileSync(path, 'utf8');
  const discrepancies = censusDiff(content, path);
  if (discrepancies.length) {
    snapshot[file] = discrepancies.map(d => ({
      kind: d.kind,
      line: d.line,
      ...(d.raw ? { raw: d.raw } : {}),
      ...(d.signalKind ? { signalKind: d.signalKind } : {}),
      ...(d.questionSlug ? { questionSlug: d.questionSlug } : {}),
    }));
  }
}
writeFileSync(resolve(__dirname, '../../src/census/known-discrepancies.json'), JSON.stringify(snapshot, null, 2) + '\n');
console.log('wrote', Object.keys(snapshot).length, 'files worth of known discrepancies');
