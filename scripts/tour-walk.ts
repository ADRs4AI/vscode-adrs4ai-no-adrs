/**
 * tour-walk — let a transformer WALK its own tour before it costs a human a slot.
 *
 * Why this exists (ADR-0034 Iterations 11-12): every QuestionTour in this
 * project's history was minted, shipped, and "verified" by someone who could
 * not see it. The reference implementation shipped with "not verified live —
 * no Extension Dev Host in this environment"; two later versions were packaged
 * the same way. The human is not the first witness of a broken tour — he is the
 * ONLY witness. That is why a broken tour has never been fixed in one iteration,
 * and it is why "be more diligent" was never the fix. Instruments were.
 *
 * The readiness standard this serves (ADR-0034 iter-12, Shipwright's catch 3):
 *   the minter walks it always; a cold transformer walks it before it
 *   schedules the founder's attention.
 *
 * HOW THIS DIFFERS FROM `tour-lint` — and why both exist:
 *
 *   tour-lint answers "does every ref resolve?"  It is necessary and it is not
 *   sufficient. Measured 2026-08-16: tour-lint passes the Cartographer tour
 *   CLEAN — ten refs, zero warnings — and that is the tour the founder called
 *   "never usable... a disaster," because six of its ten stops render as blank
 *   walls. There are two kinds of unready:
 *
 *     structurally broken -> a machine can see it        (tour-lint's job)
 *     hollow              -> only a WALKER can see it    (this tool's job)
 *
 *   So this tool does NOT try to compute hollowness. It renders each stop as
 *   the panel renders it and makes a human-or-model read it. The one thing it
 *   does enforce is the single piece of answerability that IS mechanically
 *   decidable (see POLICY below). Everything else it measures and shows.
 *
 * Fidelity: field selection and ordering below mirror `openQuestionsPanel.ts`
 * (buildRow ~line 415, buildTourQuestions ~line 561, render ~line 2860-2950),
 * and resolution goes through the SAME `resolveTourEntries` the panel calls, so
 * this cannot drift into rendering a tour that does not exist.
 *
 * Usage:
 *   npx tsx scripts/tour-walk.ts <workspaceRoot> [tour-slug]
 *   just tour-walk [workspaceRoot] [tour-slug]
 *
 * Exit codes: 0 = nothing mechanically wrong (NOT "the tour is good" — read it).
 *             1 = unwalkable entries, or a POLICY violation.
 */

import * as path from 'path'
import { CompositeIndex } from '../src/index/compositeIndex'
import { createRepositoryContextAdapter } from '../src/index/repositoryContextAdapter'
import { discoverTourFiles, resolveTourEntries, type ResolvedTourEntry } from '../src/index/tourIndex'
import type { TourFile } from '../src/index/tourIndex'
import { assessTour, composeClaimLine } from '../src/index/tourReadiness'

const BAR = '='.repeat(78)
const RULE = '-'.repeat(78)

function section(label: string, text: string | undefined): string[] {
  const t = (text ?? '').trim()
  if (!t) return []
  return [`  ${label}:`, ...t.split('\n').map(l => `    ${l}`), '']
}

function walkTour(tour: TourFile, resolved: ResolvedTourEntry[]) {
  // One definition of "ready", shared with the mint gate and the MCP surface.
  const a = assessTour(resolved)

  console.log(BAR)
  // Provenance first — doctrine 2: no ordering ever reads as authoritative.
  console.log(`TOUR: ${tour.title}`)
  console.log(`  by ${tour.author?.name ?? '(unattributed)'}${tour.author?.model ? ` (${tour.author.model})` : ''}` +
              `${tour.minted_at ? ` · minted ${tour.minted_at}` : ''}${tour.retired ? ' · RETIRED' : ''}`)
  console.log(`  file: ${path.basename(tour.path)}`)
  console.log(BAR)

  // What the panel SILENTLY DROPS (buildTourQuestions: `if (kind !== 'question') continue`).
  // Rendering the drop loudly is half this tool's purpose — the founder's words
  // for the silent version were "like being gaslit by the software."
  for (const d of a.dropped) {
    console.log(`\n  ✗ DROPPED  ${d.ref}\n      ${d.reason}`)
  }
  if (a.dropped.length) console.log()

  if (!a.stops.length) {
    console.log('\n  *** THIS TOUR IS AN EMPTY WALK. A human opening it sees nothing. ***\n')
    return a
  }

  a.stops.forEach(({ entry: e, assessment }, i) => {
    if (e.resolution.kind !== 'question') return
    const q = e.resolution.question

    console.log(RULE)
    console.log(`Stop ${i + 1} of ${a.stops.length} · ${a.awaiting} awaiting you`)
    console.log(RULE)

    const claim = composeClaimLine(e)
    if (claim) console.log(`  [authored claim] ${claim}\n`)
    console.log(`  ${q.text}\n`)
    // Provenance, shown per stop (ADR-0034 iter-11 item 7, Jérémie's ask):
    // "some discrete UI/UX affordance to know which ADR a QST in a tour is
    // coming from... rather than the feeling that the QSTs are disembodied."
    // It is also his own detection instrument — he could not spot the Parallax
    // rewrite precisely because the stops rendered without their source. The
    // container KIND is named too, since seed-vs-ADR is the distinction the
    // illicit-copy class hid behind.
    const c = e.resolution.container
    const from = c.kind === 'adr' ? `ADR ${path.basename(c.adr.path)}` : `SEED ${path.basename(c.seed.path)}`
    console.log(`  (from ${from} · status: ${q.statusText})\n`)

    const out: string[] = []
    const ctx = [q.whyAsking, q.whyDeferring ? `Why deferring: ${q.whyDeferring}` : '', q.need ? `Need: ${q.need}` : '']
      .filter(Boolean).join('\n\n')
    out.push(...section('why', ctx))
    out.push(...section('body', q.rawBody))
    const recs = q.recommendations?.length ? q.recommendations.map(r => r.text).join('\n\n') : q.recommendation
    out.push(...section('recommendation', recs))
    out.push(...section('body-post', q.rawBodyPost))
    console.log(out.join('\n') || '')

    if (assessment.isReviewStop) {
      console.log(`  [review stop — already answered${e.disposition ? ' · ' + e.disposition : ''}]`)
      console.log(`  answer: ${(q.answer?.text ?? '(no answer text on file)').split('\n')[0].slice(0, 200)}`)
    } else {
      console.log('  [ answer box — empty, waiting for the human ]')
    }

    // MEASUREMENT (shown, never failed on): what a walker actually has to read.
    console.log(`\n  [content below the title: ${assessment.contentChars} chars]`)
    if (assessment.thin) {
      console.log('  ^ THIN. Read this stop as the human will. Is it answerable as it stands?')
    }
    if (assessment.policyViolation) {
      console.log(`  ✗ POLICY: ${assessment.policyReason}`)
    }
    console.log()
  })

  return a
}

async function main() {
  const workspaceRoot = path.resolve(process.argv[2] ?? process.cwd())
  const only = process.argv[3]

  const composite = await CompositeIndex.fromWorkspace(workspaceRoot, { adrDirRel: 'docs/adr' })
  const ctx = createRepositoryContextAdapter(composite)
  let tours = discoverTourFiles(path.join(workspaceRoot, 'docs/adr'))
  if (only) tours = tours.filter(t => t.slug === only || t.slug.includes(only))

  if (!tours.length) {
    console.log(`No tours found under ${path.join(workspaceRoot, 'docs/adr/tours')}${only ? ` matching "${only}"` : ''}.`)
    process.exit(0)
  }

  const failures: string[] = []
  const thin: string[] = []
  for (const tour of tours) {
    const a = walkTour(tour, resolveTourEntries(tour, ctx))
    failures.push(...a.hardFailures.map(f => `${tour.slug}: ${f}`))
    thin.push(...a.thin.map(t => `${tour.slug}: ${t}`))
  }

  console.log(BAR)
  console.log(`Walked ${tours.length} tour(s).`)
  if (thin.length) {
    console.log(`\n${thin.length} thin stop(s) — not failures, but read them as the human will:`)
    thin.forEach(t => console.log(`  · ${t}`))
  }
  if (failures.length) {
    console.log(`\n${failures.length} hard failure(s):`)
    failures.forEach(f => console.log(`  ✗ ${f}`))
    console.log('\nDo not put this tour in front of a human.')
    process.exit(1)
  }
  // The anti-tour-lint guard. A green check here is what let the Cartographer
  // tour reach the founder; this tool must never be read as a certificate.
  console.log('\nNothing mechanically wrong.')
  console.log('That is NOT the same as ready. You have the stops above — read them.')
  console.log('A tour is ready when a transformer has walked it and found nothing wrong.')
}

main().catch(e => { console.error(e); process.exit(1) })
