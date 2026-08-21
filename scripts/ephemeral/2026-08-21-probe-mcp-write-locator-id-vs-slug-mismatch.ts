/**
 * Context: Cicerone's MCP self-report (HQ, 2026-08-21) — add_recommendation
 * can't locate a question by the slug list_open_questions/get_outline
 * displayed (`adr:0022#qst-org-home`), tried both cases, both failed.
 * Cicerone's hypothesis: write-path only understands anchor-comment/bare-QST
 * forms, not the explicit-id heading grammar. Checking against the real
 * parser + real HQ file whether that's precisely right, or whether the
 * actual mismatch is more general (id vs slug, any question).
 */
import { readFileSync } from 'fs'
import { parseAdr } from '../../src/parser/extractor'

const path = '/Users/jlumbroso/Programming/adrs4ai/initial-meta-repository/docs/adr/0022-codetour-lane-naming-and-publication.md'
const content = readFileSync(path, 'utf8')
const adr = parseAdr(content, path)
for (const q of adr.questions) {
  console.log('id:', q.id, '| slug:', q.slug, '| text:', q.text.slice(0, 50))
}

// Simulate exactly what the write path does: freshAdr.questions.find(q => q.id === questionId)
const triedBare = adr.questions.find(q => q.id === 'qst-org-home')
const triedUpper = adr.questions.find(q => q.id === 'QST-ORG-HOME')
const triedFullId = adr.questions.find(q => q.id === (adr.questions.find(x => x.slug === 'qst-org-home')?.id))
console.log('\nSimulated write-path lookups:')
console.log('  question_id="qst-org-home" (bare slug, what list_open_questions displayed) ->', triedBare ? 'FOUND' : 'NOT FOUND')
console.log('  question_id="QST-ORG-HOME" ->', triedUpper ? 'FOUND' : 'NOT FOUND')
console.log('  question_id=<full id from slug lookup> ->', triedFullId ? 'FOUND' : 'NOT FOUND')
