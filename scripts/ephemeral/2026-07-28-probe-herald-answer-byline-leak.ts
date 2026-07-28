// Context: Jérémie reports "(Jérémie Lumbroso)" appearing preparsed inside
// the answer text for Herald's tour questions in system3-conversations,
// noise in the doctrine-9 review-stop display. Checking whether
// q.answer.text (what buildRow's finalAnswerText comes from) actually
// includes the byline, or whether the bug is downstream of the parser.
import * as fs from 'fs';
import { parseAdr } from '../../src/parser/extractor';

const f = '/Users/jlumbroso/Programming/system3/system3-conversations/docs/adr/0045-serverless-ingest-valve-for-the-extension-facing-backend.md';
const adr = parseAdr(fs.readFileSync(f, 'utf8'), f);
for (const q of adr.questions) {
  console.log(`\n--- ${q.text.slice(0, 50)} ---`);
  console.log('isAnswered:', q.isAnswered);
  console.log('answer.author:', JSON.stringify((q as any).answer?.author));
  console.log('answer.text:', JSON.stringify((q as any).answer?.text));
}
