/**
 * Context: QST-DETECTION-LEDGER row (08-21, Cicerone 5 via report_observation,
 * HQ; re-verified still-open by Gleaner 5, 2026-09-18): write tools located a
 * question with `q.id === questionId` only (full `adr-NNNN-slug` form), while
 * every read tool advertises the bare `slug`. Companion to
 * 2026-08-21-probe-mcp-write-locator-id-vs-slug-mismatch.ts, which only
 * SIMULATED the old lookup inline; this one calls the REAL writeOps functions
 * against the same real HQ file, before/after the findQuestionByIdOrSlug fix.
 *
 * Usage: npx tsx scripts/ephemeral/2026-09-26-verify-write-locator-accepts-bare-slug.ts
 *
 * Outcome (2026-09-26): see the run log in the commit that added this script.
 */
import { readFileSync, existsSync } from 'fs'
import { parseAdr } from '../../src/parser/extractor'
import { applyAddRecommendation, applyAnswerQuestion } from '../../src/mcp/writeOps'

const path = '/Users/jlumbroso/Programming/adrs4ai/initial-meta-repository/docs/adr/0022-codetour-lane-naming-and-publication.md'
if (!existsSync(path)) {
  console.log(`HQ file not present at ${path} — nothing to verify against.`)
  process.exit(0)
}
const content = readFileSync(path, 'utf8')
const adr = parseAdr(content, path)
const target = adr.questions.find((q) => q.slug === 'qst-org-home')
if (!target) {
  console.log('qst-org-home not found by slug in the parse — the file may have changed since 08-21.')
  process.exit(1)
}
console.log(`target: id=${target.id} slug=${target.slug} answered=${target.isAnswered}`)

const bare = applyAddRecommendation(content, path, target.slug, 'Relay 5', 'Verification recommendation.', '2026-09-26')
console.log(`add_recommendation, bare slug "${target.slug}" (what list_open_questions displays): ${bare.ok ? 'OK' : 'FAILED — ' + bare.error}`)

const full = applyAddRecommendation(content, path, target.id, 'Relay 5', 'Verification recommendation.', '2026-09-26')
console.log(`add_recommendation, full id "${target.id}" (pre-existing form, must still work): ${full.ok ? 'OK' : 'FAILED — ' + full.error}`)

const ans = applyAnswerQuestion(content, path, target.slug, 'Verification answer.', 'Relay 5')
console.log(`answer_question, bare slug: ${ans.ok ? 'OK' : 'FAILED — ' + ans.error}`)

if (!bare.ok || !full.ok || !ans.ok) process.exit(1)
