import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { censusDiff } from '../../src/census/diff';

const dir = resolve(__dirname, '../../docs/adr');
const files = readdirSync(dir).filter(f => f.endsWith('.md')).sort();
const snapshot: Record<string, { kind: string; line: number; signalKind?: string; questionSlug?: string }[]> = {};
for (const file of files) {
  const path = resolve(dir, file);
  const content = readFileSync(path, 'utf8');
  const discrepancies = censusDiff(content, path);
  if (discrepancies.length) {
    snapshot[file] = discrepancies.map(d => ({
      kind: d.kind,
      line: d.line,
      ...(d.signalKind ? { signalKind: d.signalKind } : {}),
      ...(d.questionSlug ? { questionSlug: d.questionSlug } : {}),
    }));
  }
}
writeFileSync(resolve(__dirname, '../../src/census/known-discrepancies.json'), JSON.stringify(snapshot, null, 2) + '\n');
console.log('wrote', Object.keys(snapshot).length, 'files worth of known discrepancies');
