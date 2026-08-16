/**
 * Regression test for the fixture deep-link click failure (item 1b,
 * docs/inbox/2026-07-13-1844-...): loads the actual fixture-workspace ADRs
 * (not synthetic fixtures) and resolves the exact link that failed —
 * `[ADR-0001](adr:0001#qst-session-cookies-or-jwt)` in
 * fixture-workspace/docs/adr/0003-recipe-photo-storage.md:27 — through the
 * real AdrIndex + adapter + resolveReference chain, end to end.
 *
 * Shipwright clause: single-root only. Multi-root topology (a link crossing
 * roots) is not exercised here — it awaits the CompositeIndex unification.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as path from 'path'
import { AdrIndex } from '../index/adrIndex'
import { SeedIndex } from '../index/seedIndex'
import { createRepositoryContextAdapter } from '../index/repositoryContextAdapter'
import { resolveReference, seedRefString } from '../mcp/reference'

const FIXTURE_DIR = path.resolve(__dirname, '../../fixture-workspace/docs/adr')

describe('repositoryContextAdapter against the real fixture-workspace', () => {
  let ctx: ReturnType<typeof createRepositoryContextAdapter>

  beforeAll(async () => {
    const adrIndex = new AdrIndex()
    const seedIndex = new SeedIndex()
    await adrIndex.indexDirectory(FIXTURE_DIR)
    await seedIndex.indexDirectory(FIXTURE_DIR)
    ctx = createRepositoryContextAdapter({
      allAdrs: () => adrIndex.allAdrs(),
      allSeeds: () => seedIndex.allSeeds(),
    })
  })

  it('resolves the exact link that failed to click (adr:0001#qst-session-cookies-or-jwt)', () => {
    const result = resolveReference(ctx, 'adr:0001#qst-session-cookies-or-jwt')
    expect(result.kind).toBe('question')
    if (result.kind === 'question') {
      // ADR-0034 iter-12: a resolved question now names its container
      // explicitly, so a seed-borne question is expressible at all.
      expect(result.container.kind).toBe('adr')
      if (result.container.kind === 'adr') {
        expect(result.container.adr.number).toBe(1)
        expect(result.container.adr.path.endsWith('0001-authentication-strategy.md')).toBe(true)
      }
      expect(result.question.text).toBe('Session cookies or JWT?')
      expect(result.question.lineStart).toBeGreaterThan(0)
    }
  })

  it('resolves a bare ADR reference to the right file', () => {
    const result = resolveReference(ctx, 'adr:0003')
    expect(result.kind).toBe('adr')
    if (result.kind === 'adr') {
      expect(result.adr.path.endsWith('0003-recipe-photo-storage.md')).toBe(true)
    }
  })

  it('is status-agnostic — an answered question resolves the same as an unanswered one (ADR-0030 QST-RENDER)', () => {
    const result = resolveReference(ctx, 'adr:0001#qst-session-cookies-or-jwt')
    expect(result.kind).toBe('question')
    // Whichever status the fixture's question actually has, resolution must
    // succeed regardless — the assertion is "it resolved," not "it's answered."
  })
})

describe('Regression tests', () => {
  let ctx: ReturnType<typeof createRepositoryContextAdapter>

  beforeAll(async () => {
    const adrIndex = new AdrIndex()
    const seedIndex = new SeedIndex()
    await adrIndex.indexDirectory(FIXTURE_DIR)
    await seedIndex.indexDirectory(FIXTURE_DIR)
    ctx = createRepositoryContextAdapter({
      allAdrs: () => adrIndex.allAdrs(),
      allSeeds: () => seedIndex.allSeeds(),
    })
  })

  // Bug (found 2026-08-16 while repairing seed-question addressability,
  // ADR-0034 iter-12): `seedRefString` emitted the full basename, producing
  // `seed:seed-2026-…`, while `getSeed` matched on `seed-${slug}` — so every
  // seed reference the MCP printed back to a model (`project_overview` rows,
  // `lookup` headers) was one the model could not then use. Nothing tested the
  // round trip, so the two halves drifted silently from the start.
  it('a seed ref the MCP emits can be resolved when handed back (round trip)', () => {
    const seeds = ctx.listSeeds()
    expect(seeds.length).toBeGreaterThan(0)
    for (const seed of seeds) {
      const emitted = seedRefString(seed)
      expect(emitted).not.toContain('seed:seed-')
      const back = resolveReference(ctx, emitted)
      expect(back.kind).toBe('seed')
      if (back.kind === 'seed') expect(back.seed.path).toBe(seed.path)
    }
  })

  // The fix accepts both forms, so refs already written down in tours and
  // briefs under the old shape keep resolving rather than breaking on upgrade.
  it('still accepts the legacy seed:seed-<basename> form', () => {
    const seed = ctx.listSeeds()[0]
    const legacy = `seed:${path.basename(seed.path, '.md')}`
    expect(legacy).toContain('seed:seed-')
    const back = resolveReference(ctx, legacy)
    expect(back.kind).toBe('seed')
    if (back.kind === 'seed') expect(back.seed.path).toBe(seed.path)
  })
})
