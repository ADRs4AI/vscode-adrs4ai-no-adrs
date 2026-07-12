/**
 * Wild-format corpus recall — ADR-0031 (Recall-First Question Detection),
 * Action Item "Quarry: wild-format corpus harvest (standing program) +
 * recall number wired into test output."
 *
 * The Zoarium (`src/test/fixtures/zoo/`) is a curated collection of real,
 * minimized, model-authored ADR deviations — previously regression fodder
 * for `src/normalizer/` alone. This file repurposes it as the corpus ADR-
 * 0031 charters: for each specimen, does `parseAdr` actually recall the
 * open questions a human reading the file would recognize?
 *
 * Two numbers per specimen, deliberately kept separate:
 *
 * - GROUND_TRUTH: what a human reading the raw file would count as open
 *   questions. Hand-verified once, per specimen, against the file's own
 *   content — not derived from a second parallel "loose grep" detector,
 *   which would just be another thing that could be wrong.
 * - BASELINE_TODAY: what `parseAdr` (bare, no normalizer pass) actually
 *   detects right now. For specimens whose deviation the normalizer fixes
 *   (D1/D2/D4 — zoo-001, zoo-003) this is HONESTLY 0: the Open Questions
 *   panel shows raw `parseAdr` output today, with no automatic
 *   normalization, so a bare 0 here is the real, current, silent-drop
 *   experience these debriefs are about — not a test-authoring mistake.
 *
 * The hard assertion is BASELINE_TODAY (regression protection — "recall
 * becomes a tracked number... a regression is a red test, not a bad
 * afternoon"). The GROUND_TRUTH vs. BASELINE_TODAY gap is reported, not
 * asserted to be zero — closing it is ADR-0031's own outstanding Action
 * Items (`placeholder.ts`, the `qst-census` reconciliation, multi-signal
 * candidacy), not something this corpus can force green by itself.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseAdr } from '../../../parser/extractor'

const ZOO_DIR = resolve(__dirname, '.')

interface SpecimenTruth {
  /** What a human reading the file would count as open questions. */
  groundTruth: number
  /** What bare `parseAdr` (no normalizer pass) detects today — the regression-protection baseline. */
  baselineToday: number
}

const CORPUS: Record<string, SpecimenTruth> = {
  // D1 (## Open Questions) + D2/D3 (bold field names) + D4 (collapsed ANS
  // block `**ANS:** (fill in)`) cluster. D4 alone is the blocker — README's
  // own empirical finding: parseAdr requires a detectable answer
  // placeholder to confirm a question is open, and `(fill in)` inline isn't
  // one. Ground truth 2, baseline 0 until the normalizer runs (manual
  // Quick-Fix today, not automatic) or ADR-0031's multi-signal candidacy ships.
  'zoo-001-bold-fields-open-questions.md': { groundTruth: 2, baselineToday: 0 },
  // D5: Decision-style ADR, no Questions section at all. Zero questions is
  // CORRECT here, not a gap — ground truth and baseline agree at 0.
  'zoo-002-decision-style-no-qsts.md': { groundTruth: 0, baselineToday: 0 },
  // D2b: bold Status with trailing parenthetical. Same D4-shaped blocker
  // as zoo-001 (`**ANS:** (fill in)`) — ground truth 2, baseline 0.
  'zoo-003-status-with-parenthetical.md': { groundTruth: 2, baselineToday: 0 },
  // D9.4 morphology #4 (wrapped placeholder `_(pending)_`) + inline-
  // attribution recommendation — Flint's same-day fix (v0.7.5) closed
  // both. Ground truth and baseline agree: this one the corpus already
  // protects against regressing.
  'zoo-004-wrapped-placeholder-inline-attribution.md': { groundTruth: 2, baselineToday: 2 },
}

function listSpecimens(): string[] {
  return readdirSync(ZOO_DIR).filter(f => f.endsWith('.md') && f !== 'README.md')
}

describe('Wild-format corpus recall (ADR-0031)', () => {
  it('every specimen in the Zoarium has a declared ground-truth/baseline entry — an unlisted fixture is a silent corpus gap, not a pass', () => {
    const undeclared = listSpecimens().filter(f => !(f in CORPUS))
    expect(undeclared, `add a CORPUS entry for: ${undeclared.join(', ')}`).toEqual([])
  })

  it('reports corpus recall as a single tracked number, and guards against regressing below today\'s known baseline', () => {
    const files = Object.keys(CORPUS)
    let groundTruthTotal = 0
    let baselineTotal = 0
    let detectedTotal = 0
    const regressions: string[] = []

    for (const file of files) {
      const { groundTruth, baselineToday } = CORPUS[file]
      const content = readFileSync(resolve(ZOO_DIR, file), 'utf8')
      const adr = parseAdr(content, resolve(ZOO_DIR, file))
      const detected = adr.questions.filter(q => !q.isAnswered).length

      groundTruthTotal += groundTruth
      baselineTotal += baselineToday
      detectedTotal += detected

      if (detected < baselineToday) {
        regressions.push(`${file}: baseline ${baselineToday}, now detecting ${detected} — regression`)
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `detection: ${detectedTotal}/${groundTruthTotal} corpus specimens ` +
      `(known baseline ${baselineTotal}/${groundTruthTotal}; gap is ADR-0031's outstanding Action Items, not a bug in this test)`,
    )
    expect(regressions, regressions.join('\n')).toEqual([])
  })
})
