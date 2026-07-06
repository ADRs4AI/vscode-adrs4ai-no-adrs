/**
 * Tests for src/deeplink/protocol.ts (Codex GPT-5, May 2026) — ADR-0008's
 * reference grammar parser/builder. This module sat unimported for two
 * months (Touchstone 4.7's implementation-status ledger flagged it as
 * "existing without executing"). Direct read (Relay 5, 2026-07-06): it
 * already implements ADR-0008's committed grammar correctly and completely
 * — local ADR/seed shorthand, cross-project alias, canonical `adr://v1/...`
 * URIs with `ref=`/`iter=` query params — and nothing in that grammar has
 * changed since May. Adopting it as the foundation for `lookup()` /
 * `get_sections()` (ADR-0021 Tier 1) rather than reimplementing the same
 * parsing rules from scratch. Test cases are ADR-0008's own worked examples.
 */

import { describe, it, expect } from 'vitest'
import {
  parseDeepLinkRef,
  buildLocalAdrRef,
  buildLocalSeedRef,
  buildCanonicalRef,
  formatAdrNumber,
  seedSlugFromPath,
} from '../deeplink/protocol'

describe('parseDeepLinkRef — local ADR shorthand', () => {
  it('parses a bare ADR reference', () => {
    const parsed = parseDeepLinkRef('adr:0001')
    expect(parsed).toMatchObject({ format: 'local-adr', scope: 'local', artifact: 'adr', number: 1 })
    expect(parsed?.anchor).toBeUndefined()
  })

  it('parses an ADR reference with a section anchor', () => {
    const parsed = parseDeepLinkRef('adr:0008#decision')
    expect(parsed).toMatchObject({ format: 'local-adr', number: 8, anchor: 'decision' })
  })

  it('parses a QST-shaped anchor', () => {
    const parsed = parseDeepLinkRef('adr:0001#qst-what-is-the-scope')
    expect(parsed).toMatchObject({ number: 1, anchor: 'qst-what-is-the-scope' })
  })

  it('parses a subfolder-qualified locator (ADR-0008 provenance/migration case)', () => {
    const parsed = parseDeepLinkRef('adr:imported/elenchus-app/0001#decision')
    expect(parsed).toMatchObject({ format: 'local-adr', number: 1, subpath: 'imported/elenchus-app', anchor: 'decision' })
  })
})

describe('parseDeepLinkRef — local seed shorthand', () => {
  it('parses a bare seed reference', () => {
    const parsed = parseDeepLinkRef('seed:2026-03-04-potential-forma-5-web-storage')
    expect(parsed).toMatchObject({ format: 'local-seed', artifact: 'seed', seedSlug: '2026-03-04-potential-forma-5-web-storage' })
  })

  it('parses a seed reference with an anchor', () => {
    const parsed = parseDeepLinkRef('seed:2026-03-04-potential-forma-5-web-storage#brain-dump')
    expect(parsed).toMatchObject({ format: 'local-seed', anchor: 'brain-dump' })
  })
})

describe('parseDeepLinkRef — cross-project alias', () => {
  it('parses the tolerated shorthand (accepted as input, not emitted as canonical)', () => {
    const parsed = parseDeepLinkRef('elenchus-app.0001#decision')
    expect(parsed).toMatchObject({ format: 'xproject-alias', namespace: 'elenchus-app', number: 1, anchor: 'decision' })
  })
})

describe('parseDeepLinkRef — canonical adr://v1/... URIs', () => {
  it('parses a canonical project URI', () => {
    const parsed = parseDeepLinkRef('adr://v1/project/elenchus-app/adr/0001#decision')
    expect(parsed).toMatchObject({ format: 'canonical', scope: 'project', namespace: 'elenchus-app', artifact: 'adr', number: 1, anchor: 'decision' })
  })

  it('parses a canonical repo URI with a ref= query param', () => {
    const parsed = parseDeepLinkRef('adr://v1/repo/jlumbroso/vscode-adrs-for-ai/adr/0008?ref=main#decision')
    expect(parsed).toMatchObject({
      format: 'canonical', scope: 'repo', owner: 'jlumbroso', repo: 'vscode-adrs-for-ai',
      number: 8, ref: 'main', anchor: 'decision',
    })
  })

  it('parses a canonical repo URI with a subfolder-qualified locator', () => {
    const parsed = parseDeepLinkRef('adr://v1/repo/jlumbroso/vscode-adrs-for-ai/adr/imported/elenchus-app/0001#decision')
    expect(parsed).toMatchObject({ format: 'canonical', number: 1, subpath: 'imported/elenchus-app' })
  })

  it('parses a canonical seed URI', () => {
    const parsed = parseDeepLinkRef('adr://v1/repo/jlumbroso/vscode-adrs-for-ai/seed/2026-03-04-potential-forma-5-web-storage#brain-dump')
    expect(parsed).toMatchObject({ format: 'canonical', artifact: 'seed', seedSlug: '2026-03-04-potential-forma-5-web-storage', anchor: 'brain-dump' })
  })

  it('parses an iter= query param as a number', () => {
    const parsed = parseDeepLinkRef('adr://v1/project/elenchus-app/adr/0001?iter=2#qst-auth-strategy')
    expect(parsed).toMatchObject({ iter: 2, anchor: 'qst-auth-strategy' })
  })
})

describe('parseDeepLinkRef — malformed input returns undefined, never throws', () => {
  it('rejects a canonical-looking URI with the wrong protocol', () => {
    expect(parseDeepLinkRef('http://v1/project/x/adr/1')).toBeUndefined()
  })

  it('rejects a canonical URI missing the artifact segment', () => {
    expect(parseDeepLinkRef('adr://v1/project/elenchus-app')).toBeUndefined()
  })

  it('rejects an ADR locator with a non-numeric final segment', () => {
    expect(parseDeepLinkRef('adr:not-a-number')).toBeUndefined()
  })

  it('rejects a plain word that matches none of the four grammars', () => {
    expect(parseDeepLinkRef('just some text')).toBeUndefined()
  })
})

describe('builders round-trip what the parser accepts', () => {
  it('buildLocalAdrRef produces a string parseDeepLinkRef re-parses identically', () => {
    const ref = buildLocalAdrRef({ number: 8, anchor: 'decision' })
    expect(ref).toBe('adr:0008#decision')
    expect(parseDeepLinkRef(ref)).toMatchObject({ number: 8, anchor: 'decision' })
  })

  it('buildLocalSeedRef round-trips', () => {
    const ref = buildLocalSeedRef('2026-03-04-potential-forma-5-web-storage', 'brain-dump')
    expect(parseDeepLinkRef(ref)).toMatchObject({ seedSlug: '2026-03-04-potential-forma-5-web-storage', anchor: 'brain-dump' })
  })

  it('buildCanonicalRef (project scope) round-trips', () => {
    const ref = buildCanonicalRef({ scope: 'project', artifact: 'adr', namespace: 'elenchus-app', number: 1, anchor: 'decision' })
    expect(ref).toBe('adr://v1/project/elenchus-app/adr/0001#decision')
    expect(parseDeepLinkRef(ref)).toMatchObject({ scope: 'project', namespace: 'elenchus-app', number: 1 })
  })

  it('buildCanonicalRef (repo scope) round-trips with a ref= param', () => {
    const ref = buildCanonicalRef({ scope: 'repo', artifact: 'adr', owner: 'jlumbroso', repo: 'vscode-adrs-for-ai', number: 8, ref: 'main', anchor: 'decision' })
    expect(ref).toBe('adr://v1/repo/jlumbroso/vscode-adrs-for-ai/adr/0008?ref=main#decision')
  })

  it('buildCanonicalRef throws a clear error rather than emitting a malformed reference when required fields are missing', () => {
    expect(() => buildCanonicalRef({ scope: 'project', artifact: 'adr' })).toThrow(/namespace/)
    expect(() => buildCanonicalRef({ scope: 'project', artifact: 'adr', namespace: 'x' })).toThrow(/number/)
  })
})

describe('small helpers', () => {
  it('formatAdrNumber zero-pads to four digits', () => {
    expect(formatAdrNumber(1)).toBe('0001')
    expect(formatAdrNumber(21)).toBe('0021')
  })

  it('seedSlugFromPath strips the seed- prefix and .md extension', () => {
    expect(seedSlugFromPath('/repo/docs/adr/seed-2026-07-05-async-question-queue.md')).toBe('2026-07-05-async-question-queue')
  })
})
