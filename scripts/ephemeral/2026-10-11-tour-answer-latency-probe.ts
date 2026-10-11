/**
 * 2026-10-11 — tour-answer-latency probe (Jérémie's question, ADR-0034 iter-27)
 *
 * CONTEXT. He asked: "does a tour record when a question gets answered? I'd
 * love to see if being listed in a tour accelerates how fast a question gets
 * answered on a consistent basis — do we already collect data, or can we start?"
 *
 * The answer to the first part is NO, deliberately: a tour stores no
 * answeredness (doctrine 1 — the substrate is sovereign, the tour only
 * comments; doneness is derived fresh on every read and cached nowhere), and
 * `QuestionAnswer` has no date field. So no instrument records this today.
 *
 * THIS PROBE EXISTS TO TEST THE SECOND PART: whether the data already exists
 * in git and can be mined RETROSPECTIVELY, with zero new collection. Method:
 * replay every revision of each ADR/seed a tour points at, parse it with the
 * REAL parser (project convention — never a stub, since the parser is the
 * thing whose output we are claiming to trust), and build a per-question
 * status timeline. First-seen and first-answered then come from commit dates.
 *
 *   git log <file>  ->  for each sha: git show sha:file  ->  parseAdr/parseSeed
 *   ->  per-question (slug, isAnswered)  ->  timeline  ->  join tour minted_at
 *
 * WHAT IT DELIBERATELY DOES NOT DO: claim causation. Questions enter tours
 * BECAUSE someone judged them ripe, so toured questions would answer faster
 * even if tours did nothing. The only design this probe supports is the
 * WITHIN-QUESTION one — a question's own dwell time before tour entry versus
 * its latency after — where each question is its own control.
 *
 * Usage:
 *   npx tsx scripts/ephemeral/2026-10-11-tour-answer-latency-probe.ts <repoRoot> [--adr-dir docs/adr]
 *
 * OUTCOME (filled in after the run — see bottom of file).
 */

import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { parseAdr } from '../../src/parser/extractor'
import { parseSeed } from '../../src/parser/seedExtractor'

const repoRoot = path.resolve(process.argv[2] ?? '.')
const adrDirRel = (() => {
  const i = process.argv.indexOf('--adr-dir')
  return i > 0 ? process.argv[i + 1] : 'docs/adr'
})()
const adrDir = path.join(repoRoot, adrDirRel)

const git = (args: string[]): string => {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch {
    return ''
  }
}

const DAY = 86_400_000
const days = (a: number, b: number): number => Math.round(((b - a) / DAY) * 10) / 10

// --- 1. tours: minted_at + the refs they point at -------------------------
interface TourRow { slug: string; mintedAt: number; refs: string[] }

function readTours(): TourRow[] {
  const dir = path.join(adrDir, 'tours')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.tour.json'))
    .flatMap(f => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
        const t = Date.parse(j.minted_at ?? '')
        if (!Number.isFinite(t)) return []
        return [{
          slug: f.replace(/\.tour\.json$/, ''),
          mintedAt: t,
          refs: (j.entries ?? []).map((e: { ref: string }) => e.ref).filter(Boolean),
        }]
      } catch { return [] }
    })
}

// --- 2. refs -> (file, question-slug) -------------------------------------
/** `adr:0072#qst-foo` / `seed:2026-07-29-topic#qst-foo`. Resolved by filename scan, not the extension's resolver, to keep this script standalone. */
function resolveRef(ref: string): { file: string; qslug: string } | null {
  const [head, anchor] = ref.split('#')
  if (!anchor) return null
  const [kind, body] = head.split(':')
  const files = fs.existsSync(adrDir) ? fs.readdirSync(adrDir) : []
  if (kind === 'adr') {
    const num = body.padStart(4, '0')
    const f = files.find(x => x.startsWith(num + '-') && x.endsWith('.md'))
    return f ? { file: path.join(adrDirRel, f), qslug: anchor } : null
  }
  if (kind === 'seed') {
    const f = files.find(x => x.endsWith('.md') && x.includes(body))
      ?? files.find(x => x.startsWith('seed-' + body))
    return f ? { file: path.join(adrDirRel, f), qslug: anchor } : null
  }
  return null
}

// --- 3. replay one file's history through the real parser -----------------
interface Timeline { firstSeen: number; firstAnswered?: number }

const timelineCache = new Map<string, Map<string, Timeline>>()

function fileTimelines(fileRel: string): Map<string, Timeline> {
  const cached = timelineCache.get(fileRel)
  if (cached) return cached

  const out = new Map<string, Timeline>()
  const log = git(['log', '--follow', '--reverse', '--format=%H|%cI', '--', fileRel]).trim()
  if (!log) { timelineCache.set(fileRel, out); return out }

  for (const line of log.split('\n')) {
    const [sha, iso] = line.split('|')
    if (!sha) continue
    const when = Date.parse(iso)
    const content = git(['show', `${sha}:${fileRel}`])
    if (!content) continue
    let questions: Array<{ slug: string; aliasSlug?: string; isAnswered: boolean }> = []
    try {
      questions = path.basename(fileRel).startsWith('seed-')
        ? parseSeed(content, fileRel).questions
        : parseAdr(content, fileRel).questions
    } catch { continue }
    for (const q of questions) {
      // A ref resolves by `id || slug || aliasSlug` (ADR-0032 handle
      // blessing, ledger clause 4). Keying on `slug` alone made every
      // trailing-petname heading — "(QST-HEADER-COMPANION)" — look like a
      // question with no history, which is most seed stops in the corpus.
      // First version of this probe reported 8/19 stops as missing data;
      // that was THIS bug, not a gap in the substrate.
      for (const key of [q.slug, q.aliasSlug].filter((k): k is string => !!k)) {
        const prior = out.get(key)
        if (!prior) out.set(key, { firstSeen: when, firstAnswered: q.isAnswered ? when : undefined })
        else if (q.isAnswered && prior.firstAnswered === undefined) prior.firstAnswered = when
      }
    }
  }
  timelineCache.set(fileRel, out)
  return out
}

// --- 4. join and report ---------------------------------------------------
const tours = readTours()
if (!tours.length) {
  console.log(`no tours with a parseable minted_at under ${adrDir}/tours`)
  process.exit(0)
}

console.log(`repo: ${repoRoot}`)
console.log(`tours: ${tours.length}\n`)

interface Row { tour: string; ref: string; dwellBefore?: number; latencyAfter?: number; answered: boolean }
const rows: Row[] = []
const touredSlugs = new Set<string>()

for (const t of tours) {
  for (const ref of t.refs) {
    const r = resolveRef(ref)
    if (!r) { rows.push({ tour: t.slug, ref: ref + '  [UNRESOLVED]', answered: false }); continue }
    touredSlugs.add(`${r.file}#${r.qslug}`)
    const tl = fileTimelines(r.file).get(r.qslug)
    if (!tl) { rows.push({ tour: t.slug, ref: ref + '  [no timeline]', answered: false }); continue }
    rows.push({
      tour: t.slug,
      ref,
      dwellBefore: days(tl.firstSeen, t.mintedAt),
      latencyAfter: tl.firstAnswered !== undefined ? days(t.mintedAt, tl.firstAnswered) : undefined,
      answered: tl.firstAnswered !== undefined,
    })
  }
}

for (const r of rows) {
  const dwell = r.dwellBefore === undefined ? '    ?' : `${r.dwellBefore}d`
  const lat = r.latencyAfter === undefined ? (r.answered ? '?' : 'still open') : `${r.latencyAfter}d`
  console.log(`  ${r.tour.slice(0, 34).padEnd(34)} ${String(dwell).padStart(7)} before -> ${String(lat).padStart(10)} after   ${r.ref}`)
}

// --- 5. the within-question comparison, which is the only honest one -----
const paired = rows.filter(r => r.dwellBefore !== undefined && r.latencyAfter !== undefined && r.dwellBefore >= 0)
console.log(`\n--- within-question (each question its own control) ---`)
console.log(`answered-after-tour pairs: ${paired.length} of ${rows.length} stops`)
if (paired.length) {
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
  console.log(`median dwell BEFORE tour entry : ${med(paired.map(r => r.dwellBefore!))}d`)
  console.log(`median latency AFTER tour entry: ${med(paired.map(r => r.latencyAfter!))}d`)
  const faster = paired.filter(r => r.latencyAfter! < r.dwellBefore!).length
  console.log(`answered faster than they had already waited: ${faster}/${paired.length}`)

  // The informative stratum. A question CREATED and toured the same day has
  // no dwell to accelerate away from, so short-dwell pairs cannot evidence
  // anything either way and would just inflate n.
  const STALE = 7
  const longDwell = rows.filter(r => (r.dwellBefore ?? -1) >= STALE)
  console.log(`\n--- long-dwell stratum (sat >= ${STALE}d before tour entry) ---`)
  for (const r of longDwell) {
    const lat = r.latencyAfter === undefined ? 'STILL OPEN' : `${r.latencyAfter}d`
    console.log(`  ${String(r.dwellBefore).padStart(6)}d sat  ->  ${String(lat).padStart(10)}   ${r.ref}  (${r.tour})`)
  }
  const resolved = longDwell.filter(r => r.latencyAfter !== undefined)
  console.log(`  answered after entry: ${resolved.length}/${longDwell.length}`)
  if (resolved.length) {
    const med2 = (xs: number[]) => { const q = [...xs].sort((a, b) => a - b); return q[Math.floor(q.length / 2)] }
    console.log(`  median latency once toured: ${med2(resolved.map(r => r.latencyAfter!))}d (after a median ${med2(resolved.map(r => r.dwellBefore!))}d wait)`)
  }
}

// --- 6. crude control: untoured questions in the same files --------------
let control = 0, controlAnswered = 0
for (const fileRel of timelineCache.keys()) {
  for (const [qslug, tl] of timelineCache.get(fileRel)!) {
    if (touredSlugs.has(`${fileRel}#${qslug}`)) continue
    control++
    if (tl.firstAnswered !== undefined) controlAnswered++
  }
}
console.log(`\n--- crude control (same files, never toured) ---`)
console.log(`untoured questions: ${control}; ever answered: ${controlAnswered}`)
console.log(`\nNOTE: selection bias dominates any cross-question comparison —`)
console.log(`questions enter tours BECAUSE someone judged them ripe. Only the`)
console.log(`within-question figures above are interpretable, and even those are`)
console.log(`associational, not causal.`)

/*
 * OUTCOME (2026-10-11): see the run output recorded in ADR-0034 iter-27.
 * Verdict on feasibility: the git-replay method WORKS — per-question
 * first-seen/first-answered timelines are reconstructable from history with
 * the real parser and no new instrumentation. Its limits are (a) commit-date
 * granularity, which is coarse for same-day answers, and (b) a question whose
 * heading text was edited gets a new slug and reads as a new question, which
 * truncates its timeline. Both are arguments for recording the two timestamps
 * going forward rather than relying on archaeology alone.
 */
