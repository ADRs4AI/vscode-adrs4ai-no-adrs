/**
 * ADR-0043 (Implementation-Drift Heuristics), H1–H3 — QST-APPLY ratified
 * option A (H1 one-click, H2/H3 suggest-only) on the falsifier "replay H1
 * over the sweep's 13 corrected files — if it proposes even one wrong
 * bump, A is dead." Every H1 fixture below is the REAL git-historical
 * "before" content of a file from Touchstone's 2026-08-16 status sweep
 * (commit e7d7a86) — this is that falsifier, not a synthetic stand-in.
 *
 * Two real parser bugs surfaced verifying against this corpus (documented
 * in extractor.ts/driftHeuristics.ts where fixed): a trailing em-dash
 * title on an Iteration heading was silently unrecognized, and a genuine
 * duplicate "### Iteration 2" heading (ADR-0041) needed counting by
 * distinct number, not raw occurrence.
 */

import { execSync } from 'child_process'
import { describe, it, expect } from 'vitest'
import { parseAdr } from '../parser/extractor'
import { detectImplementationDrift, DEFAULT_DRIFT_LEXICON, type DriftLexicon } from '../parser/driftHeuristics'

const SWEEP_COMMIT = 'e7d7a86'

function beforeContent(path: string): string {
  return execSync(`git show ${SWEEP_COMMIT}^:${path}`, { cwd: process.cwd(), encoding: 'utf-8' })
}

describe('H1 — counter drift, replayed over Touchstone\'s real 13-file sweep (QST-APPLY\'s own falsifier)', () => {
  const GENUINE_DRIFT: Array<[string, number]> = [
    ['docs/adr/0004-ui-paradigm.md', 3],
    ['docs/adr/0008-deep-link-protocol.md', 3],
    ['docs/adr/0013-normalizer-format-conformance.md', 5],
    ['docs/adr/0014-constructive-diagnostic-design.md', 3],
    ['docs/adr/0015-adr-documentation-index.md', 2],
    ['docs/adr/0021-mcp-tool-specification.md', 16],
    ['docs/adr/0039-secretariat-sourcerange-and-the-round-trip-gate.md', 2],
    // Real duplicate "### Iteration 2" heading (1, 2, 2) in the raw file —
    // Touchstone's real correction bumped to 2 (distinct count), confirming
    // this is genuine drift, not a control (see driftHeuristics.ts H1 comment).
    ['docs/adr/0041-seed-lifecycle-and-rollup-two-axes-one-spine.md', 2],
  ]

  it.each(GENUINE_DRIFT)('fires exactly once with the correct suggestedIteration for %s', (path, expectedBump) => {
    const adr = parseAdr(beforeContent(path), path)
    const h1 = detectImplementationDrift(adr).filter(f => f.heuristic === 'H1')
    expect(h1).toHaveLength(1)
    expect(h1[0].suggestedIteration).toBe(expectedBump)
  })

  const NO_DRIFT = [
    'docs/adr/0025-multi-root-recursive-project-roots.md',
    'docs/adr/0029-open-questions-sidebar-badge-anti-gamification-check.md',
    'docs/adr/0030-captioned-references-resolving-question-handles-in-ui.md',
    'docs/adr/0036-unresolved-returning-the-ball.md',
    'docs/adr/0038-answer-box-inherits-editor-typography.md',
  ]

  it.each(NO_DRIFT)('never fires on %s — these six files added a NEW Iteration heading in the same commit as the header bump, so their "before" header was already correct (a false positive here kills option A per the falsifier)', (path) => {
    const adr = parseAdr(beforeContent(path), path)
    const h1 = detectImplementationDrift(adr).filter(f => f.heuristic === 'H1')
    expect(h1).toHaveLength(0)
  })
})

describe('H1 — real specimen edge cases found verifying against the sweep corpus', () => {
  it('recognizes an Iteration heading with a trailing em-dash title (real specimen: ADR-0004\'s "Iteration 2 (2026-07-05) — Treeview as visual question dashboard")', () => {
    const doc = `# ADR-0099: Test

- **Iteration**: 1
- **Status**: Draft

## Iterations

### Iteration 1 (2026-01-01)
- Outcome: first pass

### Iteration 2 (2026-01-02) — some title *(chunked from elsewhere)*
- Outcome: second pass
`
    const adr = parseAdr(doc, '/fake/x.md')
    expect(adr.iterations).toHaveLength(2)
    const h1 = detectImplementationDrift(adr).filter(f => f.heuristic === 'H1')
    expect(h1[0].suggestedIteration).toBe(2)
  })

  it('counts a misplaced Iteration heading (landed outside "## Iterations", real specimen: ADR-0004\'s "### Iteration 3" nested under "## Questions") toward the document-wide H1 count', () => {
    const doc = `# ADR-0099: Test

- **Iteration**: 1
- **Status**: Draft

## Iterations

### Iteration 1 (2026-01-01)
- Outcome: first pass

## Questions

### QST: something

- Status: unanswered

### Iteration 2 (2026-01-03) — a misplaced entry
- Outcome: landed in the wrong section
`
    const adr = parseAdr(doc, '/fake/x.md')
    // AdrFile.iterations stays scoped to "## Iterations" children — the
    // misplaced entry doesn't corrupt the append-point computation.
    expect(adr.iterations).toHaveLength(1)
    // H1's document-wide scan still sees it, matching Touchstone's real correction.
    const h1 = detectImplementationDrift(adr).filter(f => f.heuristic === 'H1')
    expect(h1[0].suggestedIteration).toBe(2)
  })

  it('deduplicates a genuine duplicate iteration number (real specimen: ADR-0041\'s "1, 2, 2") to the distinct count, not raw occurrence', () => {
    const doc = `# ADR-0099: Test

- **Iteration**: 1
- **Status**: Draft

## Iterations

### Iteration 2 (2026-01-02) — first written entry
- Outcome: a

### Iteration 1 (2026-01-01)
- Outcome: b

### Iteration 2 (2026-01-02)
- Outcome: c, the real duplicate
`
    const adr = parseAdr(doc, '/fake/x.md')
    const h1 = detectImplementationDrift(adr).filter(f => f.heuristic === 'H1')
    expect(h1[0].suggestedIteration).toBe(2) // distinct {1, 2}, not raw count 3
  })
})

describe('H2/H3 — the ADR\'s own motivating specimen (real: ADR-0039\'s pre-sweep state)', () => {
  const adr = parseAdr(
    beforeContent('docs/adr/0039-secretariat-sourcerange-and-the-round-trip-gate.md'),
    'docs/adr/0039-secretariat-sourcerange-and-the-round-trip-gate.md',
  )
  const findings = detectImplementationDrift(adr)

  it('H2 fires: Status is Accepted, but Iteration 2 reads like shipped work ("shipped")', () => {
    const h2 = findings.filter(f => f.heuristic === 'H2')
    expect(h2).toHaveLength(1)
    expect(h2[0].message).toContain('shipped')
  })

  it('H3 refines it: the same entry\'s Outcome line also names remaining work ("queued")', () => {
    const h3 = findings.filter(f => f.heuristic === 'H3')
    expect(h3).toHaveLength(1)
    expect(h3[0].message).toContain('Partially Implemented')
  })
})

describe('H2 — status-gating and lexicon behavior', () => {
  function makeDoc(status: string, outcome: string): string {
    return `# ADR-0099: Test

- **Iteration**: 1
- **Status**: ${status}

## Iterations

### Iteration 1 (2026-01-01)
- Outcome: ${outcome}
`
  }

  it('never fires when Status is already Implemented, Partially Implemented, or Superseded — H2 exists to catch STALE Draft/Accepted claims, not to re-flag an already-advanced status', () => {
    for (const status of ['Implemented', 'Partially Implemented', 'Superseded']) {
      const adr = parseAdr(makeDoc(status, 'shipped and merged, v1.2.0'), '/fake/x.md')
      expect(detectImplementationDrift(adr).filter(f => f.heuristic === 'H2')).toHaveLength(0)
    }
  })

  it('fires on Draft with completion vocabulary, not just Accepted', () => {
    const adr = parseAdr(makeDoc('Draft', 'shipped end to end'), '/fake/x.md')
    expect(detectImplementationDrift(adr).filter(f => f.heuristic === 'H2')).toHaveLength(1)
  })

  it('recognizes a version tag and a commit hash as completion evidence, not just the word lexicon', () => {
    const versionAdr = parseAdr(makeDoc('Accepted', 'released as v0.7.46'), '/fake/x.md')
    expect(detectImplementationDrift(versionAdr).filter(f => f.heuristic === 'H2')).toHaveLength(1)

    const hashAdr = parseAdr(makeDoc('Accepted', 'fixed in bfd618c'), '/fake/x.md')
    expect(detectImplementationDrift(hashAdr).filter(f => f.heuristic === 'H2')).toHaveLength(1)
  })

  it('a genuinely quiet Iteration entry with no completion vocabulary never fires', () => {
    const adr = parseAdr(makeDoc('Accepted', 'discussed the approach, no code yet'), '/fake/x.md')
    expect(detectImplementationDrift(adr).filter(f => f.heuristic === 'H2')).toHaveLength(0)
  })

  it('the lexicon is tweakable — a caller-supplied DriftLexicon is used instead of the default, never hard-coded (Jérémie\'s QST-APPLY rider: localization-ready)', () => {
    const customLexicon: DriftLexicon = {
      completionTerms: ['livré'], // French "delivered" — not in DEFAULT_DRIFT_LEXICON
      remainingWorkTerms: [],
    }
    const adr = parseAdr(makeDoc('Accepted', 'livré et testé'), '/fake/x.md')
    expect(detectImplementationDrift(adr).filter(f => f.heuristic === 'H2')).toHaveLength(0) // default lexicon: no match
    expect(detectImplementationDrift(adr, customLexicon).filter(f => f.heuristic === 'H2')).toHaveLength(1) // custom: matches
  })

  it('DEFAULT_DRIFT_LEXICON is exported and usable as a base to extend, not a private constant callers must reinvent', () => {
    expect(DEFAULT_DRIFT_LEXICON.completionTerms).toContain('shipped')
    expect(DEFAULT_DRIFT_LEXICON.remainingWorkTerms).toContain('queued')
  })
})

describe('H3 — refines H2 via an open question, when the same Iteration entry has no remaining-work vocabulary of its own', () => {
  it('fires when the entry reads as shipped but a real open QST elsewhere in the document remains', () => {
    const doc = `# ADR-0099: Test

- **Iteration**: 1
- **Status**: Accepted

## Iterations

### Iteration 1 (2026-01-01)
- Outcome: shipped and merged

## Questions

### QST: what about the edge case?

- Status: unanswered
`
    const adr = parseAdr(doc, '/fake/x.md')
    const h3 = detectImplementationDrift(adr).filter(f => f.heuristic === 'H3')
    expect(h3).toHaveLength(1)
    expect(h3[0].message).toContain('edge case')
  })

  it('does not fire when the entry reads as shipped and no open questions remain, and no remaining-work vocabulary is present — genuinely looks fully done', () => {
    const doc = `# ADR-0099: Test

- **Iteration**: 1
- **Status**: Accepted

## Iterations

### Iteration 1 (2026-01-01)
- Outcome: shipped and merged, fully done
`
    const adr = parseAdr(doc, '/fake/x.md')
    expect(detectImplementationDrift(adr).filter(f => f.heuristic === 'H3')).toHaveLength(0)
  })
})
