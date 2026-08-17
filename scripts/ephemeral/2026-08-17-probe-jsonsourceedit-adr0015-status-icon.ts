/**
 * Context: founder Report against json-source-edit's ADR-0015 ("Status
 * icon seems incorrect, is there a status parsing problem?"). Header is
 * `- **Status**: Implemented — <long trailing annotation>` — same shape
 * as the already-OPEN ledger row (docs/QST-DETECTION-LEDGER.md, "Any
 * known document Status value with a trailing annotation fires spurious
 * UNKNOWN_STATUS"). Checking against the real parser whether this is
 * that exact class recurring, not guessing from the shape alone.
 */
import { readFileSync } from 'fs'
import { parseAdr } from '../../src/parser/extractor'

const path = '/Users/jlumbroso/Programming/adrs4ai/initial-meta-repository/subprojects/json-source-edit/docs/adr/0015-path-resolution-error-contract.md'
const content = readFileSync(path, 'utf8')
const adr = parseAdr(content, path)
console.log('adr.status:', JSON.stringify(adr.status))
console.log('adr.statusCategory (if present):', (adr as any).statusCategory)
console.log('questions:', adr.questions.map(q => ({ id: q.id, isAnswered: q.isAnswered, statusText: q.statusText })))
