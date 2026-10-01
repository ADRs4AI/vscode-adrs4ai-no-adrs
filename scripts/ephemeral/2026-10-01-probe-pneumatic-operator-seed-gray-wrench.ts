/**
 * Context: live founder Report (pneumatic, 2026-10-01T23:02:46Z, treeview):
 * "why is the wrench gray, we just iteratd?" — anchor: seed-2026-09-07-
 * pneumatic-operator.md. git log shows the latest real commit (8837fdb,
 * "operator seed freshness pass") marked three QST Status lines `moot`
 * with an inline `[Freshness pass: Plenum 5, 2026-10-01]` note — real,
 * substantive, dated work, but NOT a new "### Name - Date" Thread turn.
 * lastActivityDate (seedExtractor.ts) only scans the header Date field and
 * Thread-turn headings. This runs the REAL parser + the real classifier
 * (seedLifecycle.ts, seedAging.ts) against the real file to confirm,
 * rather than trust the grep-based read.
 */
import { readFileSync } from 'fs'
import { parseSeed } from '../../src/parser/seedExtractor'
import { classifySeedAxis1 } from '../../src/views/seedLifecycle'
import { daysSince, computeDisplayThresholdDays } from '../../src/views/seedAging'

const path = '/Users/jlumbroso/Programming/adrs4ai/initial-meta-repository/subprojects/pneumatic/docs/adr/seed-2026-09-07-pneumatic-operator.md'
const seed = parseSeed(readFileSync(path, 'utf8'), path)
console.log('header date:', seed.date)
console.log('lastActivityDate:', seed.lastActivityDate)
console.log('threadEntries:', seed.threadEntries.length, 'last turn date:', seed.threadEntries.at(-1)?.date)
console.log('status:', seed.status)

const now = new Date()
const days = seed.lastActivityDate ? daysSince(seed.lastActivityDate, now) : undefined
console.log('days since lastActivityDate (as of now):', days)
const threshold = computeDisplayThresholdDays([days ?? 0], { mode: 'adaptive', adaptiveMultiplier: 0.5, fixedThresholdDays: 14 })
console.log('adaptive threshold (population of 1, this seed only — NOT the real repo-wide median):', threshold)
console.log('axis1 state:', classifySeedAxis1({ status: seed.status, isProcessed: seed.isProcessed }, days, threshold))

// OUTCOME (2026-10-01): lastActivityDate stuck at the Thread's last real turn
// (2026-09-08) — the 2026-10-01 "freshness pass" edited `- Status:` lines with
// a bracketed `[Freshness pass: Name, date]` note, not a new Thread turn, so
// it is structurally invisible to activity-date derivation. ~23 days stale,
// correctly classified 'dormant' by the EXISTING rule, operating exactly as
// designed on an input the designer didn't anticipate: a REAL, dated edit
// that intentionally isn't a deliberation turn. Not a parser bug (confirmed:
// this is reading the file correctly) -- a genuine design question (does
// "iteration" for staleness purposes mean "a new Thread turn" or "any dated,
// attributed edit"?), reported to Jérémie rather than silently resolved.
