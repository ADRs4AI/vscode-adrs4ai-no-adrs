/**
 * "Add Thread Turn" — the seeds-as-issues minimum lovable slice
 * (Lapidary's 2026-07-31 founder-escalation dispatch). The composer IS the
 * rails: given a seed's current content, computes where and what to
 * insert so a human/model never hand-authors MRR checkbox scaffolding or
 * gets a heading level wrong.
 */

import { describe, it, expect } from 'vitest'
import { planSeedThreadTurnInsertion } from '../creation/seedThreadTurn'

describe('planSeedThreadTurnInsertion', () => {
  it('inserts immediately before "## Derived Into" when there is no blank-line gap to trim', () => {
    const content = [
      '# SEED: Topic',
      '',
      '## Thread',
      '',
      '### Someone - 2026-07-30',
      '',
      'Their turn.',
      '## Derived Into',
      '',
      '*(not yet chunked)*',
    ].join('\n')

    const plan = planSeedThreadTurnInsertion(content, 'Jérémie', '2026-07-31')
    const lines = content.split('\n')
    expect(lines[plan.insertLineIndex]).toBe('## Derived Into')
  })

  it('trims back over trailing blank lines before "## Derived Into" so the turn lands right after real content', () => {
    const content = [
      '## Thread',
      '',
      '### Someone - 2026-07-30',
      '',
      'Their turn.',
      '',
      '',
      '',
      '## Derived Into',
    ].join('\n')

    const plan = planSeedThreadTurnInsertion(content, 'Jérémie', '2026-07-31')
    const lines = content.split('\n')
    // insertLineIndex should point at the FIRST of the trailing blank run,
    // not the "## Derived Into" line itself (there are 3 blanks before it).
    expect(lines[plan.insertLineIndex]).toBe('')
    expect(lines[plan.insertLineIndex - 1]).toBe('Their turn.')
  })

  it('falls back to end-of-file when there is no "## Derived Into" heading at all', () => {
    const content = ['## Thread', '', '### Someone - 2026-07-30', '', 'Their turn.'].join('\n')
    const plan = planSeedThreadTurnInsertion(content, 'Jérémie', '2026-07-31')
    expect(plan.insertLineIndex).toBe(content.split('\n').length)
  })

  it('the scaffold is a correctly-attributed heading + fresh MRR block, exact template shape', () => {
    const plan = planSeedThreadTurnInsertion('## Derived Into', 'Jérémie', '2026-07-31')
    expect(plan.text).toBe([
      '',
      '### Jérémie - 2026-07-31',
      '',
      '',
      '',
      '---',
      '',
      '**Model Response Request:**',
      '',
      '- [ ] Chunk this into ADRs',
      '- [ ] Iterate with me',
      '- [ ] Structure in place',
      '',
      '---',
      '',
    ].join('\n'))
  })

  it('the heading is a real ### (level 3), never accidentally ## — the exact fragility this feature exists to remove', () => {
    const plan = planSeedThreadTurnInsertion('## Derived Into', 'Someone', '2026-01-01')
    expect(plan.text).toMatch(/^\n### Someone - 2026-01-01\n/)
    expect(plan.text).not.toMatch(/\n## Someone/)
  })

  it('cursorLineOffset points at the blank content line right after the heading', () => {
    const plan = planSeedThreadTurnInsertion('## Derived Into', 'Someone', '2026-01-01')
    const scaffoldLines = plan.text.split('\n')
    expect(scaffoldLines[plan.cursorLineOffset - 1]).toBe('### Someone - 2026-01-01')
    expect(scaffoldLines[plan.cursorLineOffset]).toBe('')
  })

  it('every MRR checkbox starts unchecked — the human/model decides fresh each turn, never inherits a stale check', () => {
    const plan = planSeedThreadTurnInsertion('## Derived Into', 'Someone', '2026-01-01')
    expect(plan.text).not.toMatch(/\[x\]/i)
    expect(plan.text).toContain('- [ ] Chunk this into ADRs')
    expect(plan.text).toContain('- [ ] Iterate with me')
    expect(plan.text).toContain('- [ ] Structure in place')
  })
})
