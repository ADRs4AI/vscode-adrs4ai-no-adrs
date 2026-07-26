/**
 * QuestionSource tests — ADR-0029 (Open-Questions Sidebar Badge), QST-E.
 *
 * The badge, status bar, and tree header must never disagree (Cairn's
 * swap, folded into the Decision) — these tests pin the shared aggregation
 * function's actual counting rule, not just that it returns *a* number.
 */

import { describe, it, expect } from 'vitest'
import { AdrIndex } from '../index/adrIndex'
import { SeedIndex } from '../index/seedIndex'
import type { RootNode } from '../index/compositeIndex'
import {
  ADR_QUESTION_SOURCE, SEED_QUESTION_SOURCE, QUESTION_SOURCES,
  openQuestionCountForNode, aggregateOpenQuestionCount,
} from '../index/questionSource'

const ADR_WITH_TWO_OPEN = `# ADR-0001: Storage backend

- **Status**: Draft

## Questions

### QST: Which database?
- Status: unanswered

### QST: Which cache?
- Status: unanswered

### QST: Which host?
- Status: answered

**ANS:** (by Jérémie)
AWS.
`

const SEED_WITH_ONE_OPEN = `# SEED (2026-07-23): Camera prep

## Questions

### QST: Are we ready for the shoot?
- Status: unanswered
`

function makeNode(adrContent: string | null, seedContent: string | null): RootNode {
  const adrs = new AdrIndex('test')
  const seeds = new SeedIndex()
  if (adrContent) adrs.indexContent('/fake/root/docs/adr/0001-storage.md', adrContent)
  if (seedContent) seeds.indexContent('/fake/root/docs/adr/seed-2026-07-23-camera.md', seedContent)
  return { path: '/fake/root', namespace: 'test', adrs, seeds, tours: [], children: [], isSubmodule: false, hasAdrDir: true }
}

describe('QUESTION_SOURCES', () => {
  it('registers exactly ADR and seed today (v1 per Lapidary\'s spec, even though the seam is open-ended)', () => {
    expect(QUESTION_SOURCES.map(s => s.key)).toEqual(['adr', 'seed'])
  })
})

describe('ADR_QUESTION_SOURCE / SEED_QUESTION_SOURCE', () => {
  it('counts only unanswered questions from their own source', () => {
    const node = makeNode(ADR_WITH_TWO_OPEN, SEED_WITH_ONE_OPEN)
    expect(ADR_QUESTION_SOURCE.openQuestionCount(node)).toBe(2)
    expect(SEED_QUESTION_SOURCE.openQuestionCount(node)).toBe(1)
  })
})

describe('openQuestionCountForNode', () => {
  const node = makeNode(ADR_WITH_TWO_OPEN, SEED_WITH_ONE_OPEN)

  it('sums every source when all are included', () => {
    expect(openQuestionCountForNode(node, { adr: true, seed: true })).toBe(3)
  })

  it('excludes a source whose inclusion is explicitly false', () => {
    expect(openQuestionCountForNode(node, { adr: true, seed: false })).toBe(2)
    expect(openQuestionCountForNode(node, { adr: false, seed: true })).toBe(1)
  })

  it('a source missing from the inclusion map defaults to included (matches the settings default)', () => {
    expect(openQuestionCountForNode(node, {})).toBe(3)
  })

  it('every source disabled is the implicit "badge off" state — zero, no separate master toggle needed', () => {
    expect(openQuestionCountForNode(node, { adr: false, seed: false })).toBe(0)
  })
})

describe('aggregateOpenQuestionCount', () => {
  it('sums across multiple root nodes (the badge/status-bar scope — the whole workspace)', () => {
    const nodeA = makeNode(ADR_WITH_TWO_OPEN, null)
    const nodeB = makeNode(null, SEED_WITH_ONE_OPEN)
    expect(aggregateOpenQuestionCount([nodeA, nodeB], { adr: true, seed: true })).toBe(3)
  })

  it('an empty node set aggregates to zero', () => {
    expect(aggregateOpenQuestionCount([], { adr: true, seed: true })).toBe(0)
  })
})
