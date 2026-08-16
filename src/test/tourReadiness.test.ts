/**
 * Tour readiness tests — ADR-0034 Iterations 11-12.
 *
 * Every case here reproduces a defect that actually reached Jérémie, or guards
 * a property whose loss would let one reach him again. Real parser output and
 * the real shared resolver throughout (project convention, tourIndex.test.ts):
 * a stubbed resolution would test the stub, and the whole finding behind this
 * module is that the resolver is where the truth diverged from the doctrine.
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { parseAdr } from '../parser/extractor'
import { parseSeed } from '../parser/seedExtractor'
import { createRepositoryContextAdapter } from '../index/repositoryContextAdapter'
import { resolveTourEntries, type TourFile } from '../index/tourIndex'
import { assessTour, assessStop, composeClaimLine, THIN_CONTENT_CHARS } from '../index/tourReadiness'

const ADR = `# ADR-0001: Storage backend

- **Status**: Draft

## Questions

### QST: Which database?
- Status: unanswered
- Why asking: we need to pick before the migration, and the choice is hard to reverse later on.

**Recommendation**: (by Docent 5)
Postgres — the operational story is better and we already run it elsewhere.

### QST: Which host?
- Status: answered

**ANS:** (by Jérémie)
AWS.

### QST: Which region?
- Status: unanswered
`

const SEED = `# SEED: deployment questions

- **Date**: 2026-08-16

## Brain Dump

### QST: Should we ship to one region first?

<!-- @adr-anchor: qst-one-region -->

- Status: unanswered
- Why asking: staged rollout versus all-at-once.

**Recommendation**: (by Docent 5)
One region first.
`

function ctx() {
  const adr = parseAdr(ADR, '/fake/root/docs/adr/0001-storage.md')
  const seed = parseSeed(SEED, '/fake/root/docs/adr/seed-2026-08-16-deployment.md')
  return createRepositoryContextAdapter({ allAdrs: () => [adr], allSeeds: () => [seed] })
}

function tour(entries: TourFile['entries']): TourFile {
  return {
    schema: 'question-tour/1',
    title: 'test walk',
    author: { name: 'Docent', model: 'claude-opus-5' },
    minted_at: '2026-08-16T00:00:00Z',
    slug: 'test-walk',
    path: '/fake/root/docs/adr/tours/test-walk.tour.json',
    entries,
  } as TourFile
}

describe('assessTour — the silent-drop class', () => {
  // Specimen A, HQ's 2026-07-30 modularization tour: four seed-anchored entries,
  // zero walkable, zero disclosed broken, and it sat as an empty walk from July
  // 30 until Docent probed it — never reported, because a tour that renders
  // nothing gives a human nothing to report. The panel's buildTourQuestions
  // does `if (kind !== 'question') continue`; the ONLY defense is naming it.
  it('reports a seed-anchored entry as dropped rather than omitting it silently', () => {
    const resolved = resolveTourEntries(
      tour([{ ref: 'seed:2026-08-16-deployment#qst-one-region', must_respond: true }]),
      ctx(),
    )
    const a = assessTour(resolved)

    expect(a.stops).toHaveLength(0)
    expect(a.dropped).toHaveLength(1)
    expect(a.dropped[0].reason).toContain("resolved to 'seed'")
    expect(a.dropped[0].reason).toContain('NOT WALKABLE')
    expect(a.ready).toBe(false)
  })

  it('names a tour with no walkable stops as an empty walk', () => {
    const resolved = resolveTourEntries(
      tour([{ ref: 'seed:2026-08-16-deployment#qst-one-region', must_respond: true }]),
      ctx(),
    )
    expect(assessTour(resolved).hardFailures.join(' ')).toContain('zero walkable stops')
  })

  it('still surfaces a genuinely unresolvable ref (doctrine 3 is not weakened by the new class)', () => {
    const resolved = resolveTourEntries(tour([{ ref: 'adr:0001#qst-nonexistent', must_respond: true }]), ctx())
    const a = assessTour(resolved)
    expect(a.dropped).toHaveLength(1)
    expect(a.ready).toBe(false)
  })
})

describe('assessTour — the answerability policy', () => {
  // This is the case tour-lint passes clean. Measured 2026-08-16: tour-lint
  // reports zero warnings on HQ's Cartographer tour — the one the founder
  // called "never usable... a disaster" — because every ref resolves. Asking a
  // human to DECIDE while offering no recommendation is ADR-0034 register item
  // 8's violation ("a cheap claim on human attention"), and it is the one slice
  // of answerability a machine can actually decide.
  it('fails a must_respond decide-stop that offers no recommendation', () => {
    const resolved = resolveTourEntries(
      tour([{ ref: 'adr:0001#qst-which-region', must_respond: true, disposition: 'decide' }]),
      ctx(),
    )
    const a = assessTour(resolved)

    expect(a.stops).toHaveLength(1)
    expect(a.stops[0].assessment.policyViolation).toBe(true)
    expect(a.ready).toBe(false)
    expect(a.hardFailures.join(' ')).toContain('NO recommendation')
  })

  it('passes a decide-stop that does offer a recommendation', () => {
    const resolved = resolveTourEntries(
      tour([{ ref: 'adr:0001#qst-which-database', must_respond: true, disposition: 'decide' }]),
      ctx(),
    )
    const a = assessTour(resolved)
    expect(a.stops[0].assessment.policyViolation).toBe(false)
    expect(a.ready).toBe(true)
  })

  // Doctrine 9: an answered entry stays in the walk as a read-only review stop.
  // No decision is being requested there, so the policy must not fire — a gate
  // that cries wolf on settled questions is a gate people learn to bypass,
  // which is exactly how tour-lint became advisory in practice.
  it('exempts a review stop, where no decision is being asked for', () => {
    const resolved = resolveTourEntries(
      tour([{ ref: 'adr:0001#qst-which-host', must_respond: true, disposition: 'decide' }]),
      ctx(),
    )
    const a = assessTour(resolved)
    expect(a.stops[0].assessment.isReviewStop).toBe(true)
    expect(a.stops[0].assessment.policyViolation).toBe(false)
    expect(a.ready).toBe(true)
  })

  it('counts only unanswered stops in `awaiting`, matching the panel counter', () => {
    const resolved = resolveTourEntries(
      tour([
        { ref: 'adr:0001#qst-which-database', must_respond: true },
        { ref: 'adr:0001#qst-which-host', must_respond: true },
      ]),
      ctx(),
    )
    const a = assessTour(resolved)
    expect(a.stops).toHaveLength(2)
    expect(a.awaiting).toBe(1)
  })
})

describe('assessStop — thinness is measured, never enforced', () => {
  // The load-bearing restraint (ADR-0034 iter-12): hollowness is NOT
  // mechanically decidable, and a tool that pretends otherwise repeats
  // tour-lint's failure with a fresh green check. Thin must inform a walker
  // and never, on its own, block a tour.
  it('flags a thin stop without making it a hard failure', () => {
    const resolved = resolveTourEntries(tour([{ ref: 'adr:0001#qst-which-region', must_respond: false }]), ctx())
    const a = assessTour(resolved)

    expect(a.stops[0].assessment.contentChars).toBeLessThan(THIN_CONTENT_CHARS)
    expect(a.stops[0].assessment.thin).toBe(true)
    expect(a.thin).toHaveLength(1)
    expect(a.hardFailures).toHaveLength(0)
    expect(a.ready).toBe(true)
  })

  it('returns undefined for an entry that is not a question', () => {
    const resolved = resolveTourEntries(
      tour([{ ref: 'seed:2026-08-16-deployment#qst-one-region', must_respond: true }]),
      ctx(),
    )
    expect(assessStop(resolved[0])).toBeUndefined()
  })
})

describe('composeClaimLine — fidelity to the panel', () => {
  it('composes disposition, optional marker, answer shape, and comment in panel order', () => {
    const resolved = resolveTourEntries(
      tour([{
        ref: 'adr:0001#qst-which-database',
        must_respond: false,
        disposition: 'ratify',
        answer_path: 'one word',
        comment: 'crew lean is Postgres',
      }]),
      ctx(),
    )
    expect(composeClaimLine(resolved[0])).toBe(
      'ratify · optional for this walk · Answer shape: one word · crew lean is Postgres',
    )
  })

  it('omits the optional marker when the entry must be responded to', () => {
    const resolved = resolveTourEntries(
      tour([{ ref: 'adr:0001#qst-which-database', must_respond: true, comment: 'read this one' }]),
      ctx(),
    )
    expect(composeClaimLine(resolved[0])).toBe('read this one')
  })

  // ANTI-DRIFT GUARD. tour-walk exists so a transformer can see what the human
  // will see; if the panel's caption composition changes and this module does
  // not follow, the tool starts showing a walker something no human will ever
  // encounter — a false witness, which is worse than no witness. This reads the
  // panel's real source, in the spirit of the repo's own real-file cross-checks.
  it("matches openQuestionsPanel's tour-entry-info composition, field for field", () => {
    const panel = fs.readFileSync(
      path.resolve(__dirname, '../webview/openQuestionsPanel.ts'), 'utf-8',
    )
    const start = panel.indexOf('if (q.tourEntry) {')
    expect(start).toBeGreaterThan(-1)
    const rest = panel.slice(start)
    const end = rest.indexOf("$id('tour-entry-info').innerHTML")
    expect(end).toBeGreaterThan(-1)
    const block = rest.slice(0, end)
    // Self-defense: if either marker ever stops matching, `block` must not
    // quietly widen to the whole file and let the ordering assertion pass on
    // unrelated text. The real block is ~380 chars — four push lines.
    expect(block.length).toBeLessThan(1000)

    // The four fields, in the order the panel pushes them.
    const order = ['disposition', 'optional for this walk', 'answerPath', 'comment']
    const positions = order.map(f => block.indexOf(f))
    expect(positions.every(p => p >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    // And the separator this module joins on.
    expect(panel).toContain("parts.join(' · ')")
  })
})
