// Context: verifying live why 4 of 7 tour-referenced questions aren't showing
// in system3-conversations' Tours tree after the anchor-placement fix + v0.7.40
// (Flint's resolveNavHeadingIdentity refactor). Jérémie reports entries 1,2,7
// (all ADR-0051, all "### QST (Iteration N):" headings) show; entries 3-6
// (ADR-0045/0053/0017/0033, plain "### QST:" headings) don't. Running the
// actual parser against the real files rather than reasoning from source.
import * as fs from 'fs';
import { parseAdr } from '../../src/parser/extractor';

const files = [
  '/Users/jlumbroso/Programming/system3/system3-conversations/docs/adr/0045-serverless-ingest-valve-for-the-extension-facing-backend.md',
  '/Users/jlumbroso/Programming/system3/system3-conversations/docs/adr/0053-seat-identity-attribution-for-claude-code-conversations.md',
  '/Users/jlumbroso/Programming/system3/system3-conversations/docs/adr/0017-synthesis-hierarchy-and-shares.md',
  '/Users/jlumbroso/Programming/system3/system3-conversations/docs/adr/0033-team-completism-admin-atoms.md',
  '/Users/jlumbroso/Programming/system3/system3-conversations/docs/adr/0051-mirror-aware-account-lifecycle.md',
];

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const adr = parseAdr(content, f);
  console.log(`\n=== ${f.split('/').pop()} ===`);
  console.log(`questions found: ${adr.questions.length}`);
  for (const q of adr.questions) {
    console.log(`  id=${q.id} slug=${q.slug} text="${q.text.slice(0, 60)}"`);
  }
  if (adr.parseWarnings?.length) {
    console.log(`  warnings: ${adr.parseWarnings.map(w => w.code).join(', ')}`);
  }
}

// Outcome: all 5 ADRs, all 7 tour-referenced questions resolved with the
// EXACT slugs the tour expects — the parser is not the bug. Ruled out the
// heading-annotation-vs-plain hypothesis entirely (both forms resolve
// identically). Confirmed a second way via `just tour-lint`, which reuses
// the runtime's actual CompositeIndex/resolveTourEntries path (not this
// script's raw parseAdr call) and also reported all 7 clean. The remaining
// symptom (3 of 7 tree rows visible, 4 "gray"/missing, some labels showing
// as bare "?") is therefore a rendering bug in adrTreeProvider.ts's
// tour-entry children/label construction, not a data-layer bug. Dispatched
// to Fitter, 2026-07-28.

