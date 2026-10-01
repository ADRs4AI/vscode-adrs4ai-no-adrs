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

describe('Regression tests: canonical adr://v1 parser (ADR-0008 Scope Remaining, founder demand 2026-08-26)', () => {
  let ctx: ReturnType<typeof createRepositoryContextAdapter>
  beforeAll(async () => {
    const adrIndex = new AdrIndex()
    const seedIndex = new SeedIndex()
    await adrIndex.indexDirectory(FIXTURE_DIR)
    await seedIndex.indexDirectory(FIXTURE_DIR)
    ctx = createRepositoryContextAdapter({ allAdrs: () => adrIndex.allAdrs(), allSeeds: () => seedIndex.allSeeds() })
  })
  // POSTURE CHANGE (2026-10-01, founder live-hit via Plenum's brief): scope
  // now FILTERS instead of decorating. The original 08-26 behavior — a URI
  // naming a foreign repo that "still resolves locally" — was the exact bug
  // that fanned a fully-scoped pneumatic ref across 4 roots and refused it
  // as ambiguous. These two tests previously encoded that superseded
  // posture (a made-up scope resolving against local fixtures); they now
  // pin scope identity hermetically via a declared listRootScopes view,
  // never the checkout's real remote (forks/CI must not change results).
  const scoped = (remote: string, namespace?: string) => ({
    ...ctx,
    listRootScopes: () => [{ rootPath: FIXTURE_DIR, namespace, remote }],
  })
  it('canonical URI resolves to the same target as its short form (delegated once, within the scope-matched root)', () => {
    const view = scoped('git@github.com:jlumbroso/fixture.git')
    const short = resolveReference(view, 'adr:0001#qst-session-cookies-or-jwt')
    const canon = resolveReference(view, 'adr://v1/repo/jlumbroso/fixture/adr/0001#qst-session-cookies-or-jwt')
    expect(short.kind).toBe('question')
    expect(canon.kind).toBe('question')
    if (short.kind === 'question' && canon.kind === 'question') {
      expect(canon.question.id).toBe(short.question.id)
    }
  })
  it('project-scoped form binds by namespace and delegates', () => {
    expect(resolveReference(scoped('git@github.com:jlumbroso/fixture.git', 'fixture'), 'adr://v1/project/fixture/adr/0001').kind).toBe('adr')
  })
  it('the real adapter exposes listRootScopes with this root and some identity (shape only — never asserts the checkout remote)', () => {
    const roots = ctx.listRootScopes?.()
    expect(roots).toBeDefined()
    expect(roots!.length).toBeGreaterThanOrEqual(1)
    expect(roots!.some((r) => FIXTURE_DIR.startsWith(r.rootPath))).toBe(true)
  })
  it('a scope matching no root fails as not-found naming the scope — never ambiguous (the 2026-10-01 invariant)', () => {
    const r = resolveReference(scoped('git@github.com:jlumbroso/fixture.git'), 'adr://v1/repo/jlumbroso/elsewhere/adr/0001')
    expect(r.kind).toBe('error')
    if (r.kind === 'error') {
      expect(r.error).toBe('not_found')
      expect(r.message).toContain('repo/jlumbroso/elsewhere')
    }
  })
  it('unsupported version + malformed refs fail LOUDLY with grammar named', () => {
    const v2 = resolveReference(ctx, 'adr://v2/repo/o/r/adr/0001')
    expect(v2.kind).toBe('error')
    if (v2.kind === 'error') expect(v2.error).toBe('unsupported_reference')
    const bad = resolveReference(ctx, 'adr://v1/nonsense')
    expect(bad.kind).toBe('error')
    if (bad.kind === 'error') expect(bad.message).toContain('canonical_ref')
  })
  it('a not-found canonical ref names its scope — wrong-workspace stays diagnosable', () => {
    const r = resolveReference(ctx, 'adr://v1/repo/other/elsewhere/adr/9999')
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toContain('repo/other/elsewhere')
  })
})
