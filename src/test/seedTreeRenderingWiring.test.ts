/**
 * Structural tests for ADR-0041's tree-rendering wiring (ratified
 * 2026-08-12) — vscode-touching glue, same "vscode-import wall precludes
 * executing the provider here" discipline as treeItemIdentity.test.ts /
 * adr0036.test.ts. The actual classification/threshold logic has its own
 * behavioral tests (seedLifecycle.test.ts, seedAging.test.ts); this file
 * only pins that adrTreeProvider.ts is wired to call them correctly.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const TREE_SRC = readFileSync(resolve(__dirname, '../views/adrTreeProvider.ts'), 'utf8')

describe('adrTreeProvider.ts: getSeedGroupChildren computes ADR-0041 axis-1/axis-2 once per root, not per item', () => {
  const fn = TREE_SRC.match(/private getSeedGroupChildren\([\s\S]*?\n  \}/)![0]

  it('reads all three seed-aging settings, defaults matching seedAging.ts\'s own DEFAULT_SEED_AGING_CONFIG', () => {
    expect(fn).toContain("get<'adaptive' | 'fixed'>('seeds.agingMode', 'adaptive')")
    expect(fn).toContain("get<number>('seeds.adaptiveMultiplier', 0.5)")
    expect(fn).toContain("get<number>('seeds.fixedThresholdDays', 14)")
  })

  it('scopes the median population to unchunked, non-closed-family seeds — Naturalist\'s own "iterating-family" scope', () => {
    expect(fn).toContain('!closedFamilyToken(s.status) && !s.isProcessed')
  })

  it('computes the threshold ONCE, outside the per-seed map — a repo-wide statistic, not a per-item one', () => {
    const thresholdIdx = fn.indexOf('computeDisplayThresholdDays(eligibleAges, agingConfig)')
    const mapIdx = fn.indexOf('seeds.map(seed =>')
    expect(thresholdIdx).toBeGreaterThan(-1)
    expect(mapIdx).toBeGreaterThan(-1)
    expect(thresholdIdx).toBeLessThan(mapIdx)
  })

  it('classifies each seed against that shared threshold and computes its own rollup via the ADR-status lookup', () => {
    expect(fn).toContain('classifySeedAxis1(seed, age, thresholdDays)')
    expect(fn).toContain('computeSeedRollup(seed.derivedAdrs, n => node.adrs.getByNumber(n)?.status)')
  })

  it('passes both computed values into the constructor', () => {
    expect(fn).toContain('seedAxis1State: axis1')
    expect(fn).toContain('seedRollup: rollup')
  })
})

describe('adrTreeProvider.ts: makeIcon — six distinct seed glyphs, "brightness not hue" for staleness', () => {
  const fn = TREE_SRC.match(/private static makeIcon\([\s\S]*?\n  \}/)![0]

  it('all six axis-1 states get an explicit icon branch', () => {
    for (const state of ['parked', 'superseded', 'terminated', 'chunked', 'dormant', 'iterating']) {
      expect(fn, `missing case '${state}'`).toContain(`case '${state}':`)
    }
  })

  it('iterating and dormant share the SAME icon shape (wrench) — distinguished by color only, not a new glyph', () => {
    const iteratingLine = fn.match(/case 'iterating':\s*\n\s*return ([^\n]+)/)?.[1]
    const dormantLine = fn.match(/case 'dormant':\s*\n\s*return ([^\n]+)/)?.[1]
    expect(iteratingLine).toContain("ThemeIcon('wrench'")
    expect(dormantLine).toContain("ThemeIcon('wrench'")
    expect(iteratingLine).not.toBe(dormantLine) // different color arg
  })

  it('the undefined case (getParent identity-only reconstruction) falls back to the pre-ADR-0041 isProcessed check', () => {
    expect(fn).toContain('case undefined:')
    expect(fn).toContain('opts.seed.isProcessed')
  })
})

describe('adrTreeProvider.ts: makeDescription — vocabulary firewall (axis-2 badge never borrows axis-1 words)', () => {
  const fn = TREE_SRC.match(/private static makeDescription\([\s\S]*?\n  \}/)![0]

  it('the ADR\'s own cited conformance-fixture wording is used verbatim: "chunked · rollup: <value>"', () => {
    expect(fn).toContain('`[chunked · rollup: ${opts.seedRollup}]`')
  })

  it('the closed-family states each get their own bracket tag, matching their axis-1 token exactly', () => {
    expect(fn).toContain("case 'parked':")
    expect(fn).toContain("case 'superseded':")
    expect(fn).toContain("case 'terminated':")
    expect(fn).toContain('`[${opts.seedAxis1State}]`')
  })

  it('"dormant" displays as "[quiet]", never the word "dormant" or "stale" — Jérémie\'s own non-judgmental framing', () => {
    expect(fn).toContain("lifecyclePart = '[quiet]'")
    expect(fn).not.toMatch(/\[dormant\]|\[stale\]/)
  })

  it('"iterating" (the common case) gets NO bracket tag — salience via icon color only, not text crowding every row', () => {
    const iteratingCase = fn.match(/case 'iterating':\s*\n\s*lifecyclePart = ([^\n]+)/)?.[1]
    expect(iteratingCase).toBe("''")
  })

  it('the open-question count is gated by adrManager.seeds.showOpenQuestionCount — Jérémie\'s explicit "badges should be customizable" ask', () => {
    expect(fn).toContain("get<boolean>('seeds.showOpenQuestionCount', true)")
    expect(fn).toContain('showOpenCount && openCount > 0')
  })
})

describe('package.json: adrManager.seeds.showOpenQuestionCount setting exists, default true', () => {
  it('declared with a boolean type and default true', () => {
    const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')
    const match = PKG.match(/"adrManager\.seeds\.showOpenQuestionCount":\s*\{[^}]*\}/)
    expect(match, 'setting missing from package.json').toBeTruthy()
    expect(match![0]).toContain('"type": "boolean"')
    expect(match![0]).toContain('"default": true')
  })
})
