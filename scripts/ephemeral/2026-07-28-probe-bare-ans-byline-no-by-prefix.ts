// Context: Jérémie reports "(Jérémie Lumbroso)" leaking into answer text
// for Herald's tour-2 questions in system3-conversations. Earlier probe
// (2026-07-28-probe-herald-answer-byline-leak.ts) showed "**ANS:** (by
// Jérémie Lumbroso)" parses cleanly. ADR-0028's actual text uses a bare
// "**ANS:** (Jérémie Lumbroso)" -- no "by"/"from" prefix. ANS_MARKER_RE's
// own comment only documents "(by Author)"/"(from Author)" forms.
// Testing whether the bare form falls through attribution capture.
import { parseAdr } from '../../src/parser/extractor';

const doc = [
  '## Open Questions',
  '',
  '### QST: Some earlier question',
  '- Status: answered',
  '',
  '**ANS:** (Jérémie Lumbroso)',
  '',
  '---',
  '',
  '### QST I4-3: How do two Chrome profiles resolve to the same System3 account?',
  '<!-- @adr-anchor: qst-i4-two-profiles-one-account -->',
  '- Status: unanswered',
  '- Why asking: test',
  '',
  '**ANS:** (Jérémie Lumbroso)',
  'Option C, proceed.',
  '',
].join('\n');

const adr = parseAdr(doc, '/fake/docs/adr/0028-x.md');
for (const q of adr.questions) {
  console.log(`\n--- ${q.text.slice(0, 50)} ---`);
  console.log('isAnswered:', q.isAnswered);
  console.log('answer.author:', JSON.stringify((q as any).answer?.author));
  console.log('answer.text:', JSON.stringify((q as any).answer?.text));
}

// Outcome: confirmed. answer.author is undefined and the bare "(Name)"
// parenthetical leaks as the leading line of answer.text -- ANS_INLINE_RE's
// attribution group requires "by"/"from" but ANS_COLON_OUTSIDE_RE's sibling
// group already tolerates a bare name in the same position. Dispatched to
// Flint, 2026-07-28-2006, with the exact regex citations.
