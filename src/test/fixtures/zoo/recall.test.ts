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
  // block `**ANS:** (fill in)`) cluster. D4 was the sole blocker — README's
  // own empirical finding: parseAdr requires a detectable answer
  // placeholder to confirm a question is open, and `(fill in)` inline
  // wasn't recognized as one (D1/D2/D3 were already tolerated — heading
  // detection doesn't care about section name, and bold field forms
  // already parsed). ADR-0031 Phase A′ (Riddle 5, 2026-07-13): "(fill in)"
  // peels to "fill in" via stripPlaceholderWrapper — it just wasn't in
  // PLACEHOLDER_LEXICON_RE. Ground truth and baseline now agree at 2.
  'zoo-001-bold-fields-open-questions.md': { groundTruth: 2, baselineToday: 2 },
  // D5: Decision-style ADR, no Questions section at all. Zero questions is
  // CORRECT here, not a gap — ground truth and baseline agree at 0.
  'zoo-002-decision-style-no-qsts.md': { groundTruth: 0, baselineToday: 0 },
  // D2b: bold Status with trailing parenthetical. Same D4-shaped blocker
  // as zoo-001 (`**ANS:** (fill in)`) — fixed by the same Phase A′ lexicon
  // addition. Ground truth and baseline now agree at 2.
  'zoo-003-status-with-parenthetical.md': { groundTruth: 2, baselineToday: 2 },
  // D9.4 morphology #4 (wrapped placeholder `_(pending)_`) + inline-
  // attribution recommendation — Flint's same-day fix (v0.7.5) closed
  // both. Ground truth and baseline agree: this one the corpus already
  // protects against regressing.
  'zoo-004-wrapped-placeholder-inline-attribution.md': { groundTruth: 2, baselineToday: 2 },
  // Ecosystem sweep (2026-07-12, llm-orchestration-mcp/lyrical-mcp): a
  // FIFTH placeholder token, `[Awaiting answer]`. Flint's same-day fix
  // (same session as the sweep) added "awaiting" to the lexicon — ground
  // truth and baseline now agree at 2; corpus entry protects it going forward.
  'zoo-005-nonstandard-placeholder-token.md': { groundTruth: 2, baselineToday: 2 },
  // Ecosystem sweep (penn__hugo-canvas-sync): a real answer with the
  // "(by [name])" attribution dropped entirely — answer text starts
  // immediately after "**ANS:**". Parser correctly reads this as answered
  // (attribution is cosmetic to the isAnswered signal) — ground truth and
  // baseline agree at 0 open; corpus entry protects this against regressing.
  'zoo-006-ans-block-missing-attribution.md': { groundTruth: 0, baselineToday: 0 },
  // Ecosystem sweep (bluesky-mcp-oauth-server, warm-call, caring-form — this
  // exact form recurs across 3+ independent files): "**ANS**: (from X)" —
  // colon OUTSIDE the bold span, "from" instead of "by". Parser correctly
  // reads both as answered — ground truth and baseline agree at 0; corpus
  // entry protects a morphology common enough to appear repeatedly in the wild.
  'zoo-007-ans-attribution-from-outside-bold.md': { groundTruth: 0, baselineToday: 0 },
  // Ecosystem sweep (warm-call): no "Status:" field anywhere in the QST
  // block at all (not even bold — just absent), plus "**Recommended**:"
  // instead of "**Recommendation**:". Parser correctly falls back to
  // ANS-content evidence and reads both as answered — ground truth and
  // baseline agree at 0; corpus entry protects the no-Status-field case.
  'zoo-008-missing-status-field-recommended-typo.md': { groundTruth: 2, baselineToday: 0 },
  // Ecosystem sweep (spotify-mcp-server): real QST headings, genuinely
  // still open, but NO Status field and NO ANS block anywhere — pure
  // heading-only signal. Parser correctly recalls both via heading presence
  // alone — ground truth and baseline agree at 2; corpus entry protects the
  // "question with no scaffold at all yet" case, which multi-signal
  // candidacy (ADR-0031 element 1) exists partly to generalize.
  'zoo-009-heading-only-no-status-no-ans.md': { groundTruth: 2, baselineToday: 2 },
  // Ecosystem sweep (flightaware/overfly-report): a section title reuses the
  // QST token as a generic label ("## QST: Open Questions" — not an actual
  // question), and the THREE real open questions below are bullet items
  // ("- QST: ...") instead of "### QST:" headings, with no Status/ANS
  // scaffold. Ground truth 3. baselineToday is 1 — but that "1" is the
  // MISREAD SECTION LABEL itself (a false positive), not any of the three
  // real questions, which are all invisible. Kept at 1 for honest regression
  // protection (if this ever drops to 0, that's still worth catching), not
  // because 1/3 partial credit is actually happening.
  'zoo-010-bulleted-questions-no-headings.md': { groundTruth: 3, baselineToday: 1 },
  // Ecosystem sweep (warm-call): the entire QST/ANS vocabulary abandoned —
  // "### Q1:"/"### Q2:" headings (no QST token), "**ANSWER: <text>**"
  // inline instead of the two-line ANS pattern. One question left
  // genuinely open in this specimen. Parser recognizes NOTHING in this file
  // as belonging to the Questions structure at all — ground truth 1, baseline 0.
  'zoo-011-alternate-vocabulary-no-qst-ans-tokens.md': { groundTruth: 1, baselineToday: 0 },
  // Ecosystem sweep (batch-renderer): the question is bold inline body text
  // ("**QST: ...**"), not a heading of any level, so a heading-node-based
  // parser never sees it — and the "answer" is delivered via "**NOT**:",
  // this project's OWN navigation code for a note/observation, not an
  // answer marker, so even finding the bold text wouldn't pair it with a
  // recognizable answer field. Genuinely open (no real decision made).
  // Ground truth 1, baseline 0.
  'zoo-012-bold-inline-question-not-a-heading.md': { groundTruth: 1, baselineToday: 0 },
  // Empty ANS attribution "(by )" (Grafter's 2026-07-14 diagnosis; recurred
  // 2026-07-19 in HQ ADR-0015 with six questions invisible BEFORE the
  // dispatched fix shipped — the dispatch-aging lesson). "(by )" leaked into
  // the answer body and defeated the whole-content placeholder anchoring →
  // false-answered. Fixed v0.7.21: the empty attribution is consumed by the
  // marker, the placeholder is seen, both questions recall as open.
  'zoo-013-empty-ans-attribution-false-answered.md': { groundTruth: 2, baselineToday: 2 },
  // Space-separated ordinal handles ("### QST 1:") — system3 ADR-0046,
  // 2026-07-19: eight questions silently dropped with zero warnings (the
  // form matched no regex, including the malformed net, which requires the
  // hyphen). The template's own "Iteration 1" convention is the
  // interpolation source. Fixed v0.7.22: full handle semantics + fix-it
  // warning; both specimen questions recall as open.
  'zoo-014-spaced-ordinal-qst-headings.md': { groundTruth: 2, baselineToday: 2 },
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
