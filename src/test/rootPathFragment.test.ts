/**
 * ADR-0025 Decision 4 (Linear Multi-Root Tree Projection) — the parenthetical
 * path fragment shown next to each root. Founder-priority fix (2026-07-16,
 * "provenance vertigo" — Jérémie answered a question belonging to a
 * different root via the panel and the tree showed nothing for it).
 */

import { describe, it, expect } from 'vitest'
import { pathFragmentFor } from '../views/rootPathFragment'
import type { RootNode } from '../index/compositeIndex'

function fakeNode(nodePath: string): RootNode {
  return { path: nodePath, namespace: 'x', adrs: {} as never, seeds: {} as never, tours: [], children: [], isSubmodule: false, hasAdrDir: true }
}

describe('pathFragmentFor', () => {
  it('the workspace root itself gets the literal fragment "root", matching ADR-0025\'s own worked example', () => {
    expect(pathFragmentFor(fakeNode('/work/hq'), '/work/hq')).toBe('root')
  })

  it('a nested root gets its path relative to the workspace root', () => {
    expect(pathFragmentFor(fakeNode('/work/hq/subprojects/elenchus-app'), '/work/hq')).toBe('subprojects/elenchus-app')
  })

  it('a deeply nested root still resolves correctly, arbitrary depth', () => {
    expect(pathFragmentFor(fakeNode('/work/hq/a/b/c/d'), '/work/hq')).toBe('a/b/c/d')
  })

  it('falls back to "root" if the relative path somehow resolves empty (defensive — should be unreachable given the exact-match check above)', () => {
    expect(pathFragmentFor(fakeNode('/work/hq/'), '/work/hq')).toBe('root')
  })
})
