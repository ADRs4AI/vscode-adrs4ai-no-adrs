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
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createHash } from 'crypto'
import {
  parseDeepLinkRef,
  buildLocalAdrRef,
  buildLocalSeedRef,
  buildCanonicalRef,
  buildXProjectAdrRef,
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

  // Founder Report, 2026-09-02/05: "copy deep link" threw "Canonical repo
  // references require slug owner and repo." for EVERY item in this very
  // repo, because its own GitHub org is "ADRs4AI" (mixed case) and the
  // slug grammar was lowercase-only — real git remote owner/repo names
  // aren't tool-chosen slugs, they're external and case-preserving.
  it('a mixed-case owner/repo (this repo\'s own remote, "ADRs4AI") no longer throws', () => {
    const ref = buildCanonicalRef({ scope: 'repo', artifact: 'adr', owner: 'ADRs4AI', repo: 'vscode-adrs4ai', number: 1 })
    expect(ref).toBe('adr://v1/repo/ADRs4AI/vscode-adrs4ai/adr/0001')
  })

  // Jérémie's correction, same day: normalize at COMPARE time, not STORE
  // time — a canonical ref is pasted around as a human-visible identifier
  // (this repo's own ADRs cite "ADRs4AI" throughout), so silently
  // lowercasing it at build time would erase the real name everywhere the
  // ref got read, for a scheme's own administrative convenience. GitHub
  // itself preserves display case while resolving routing case-
  // insensitively — this matches that, not a normalize-on-write scheme.
  it('preserves the real case exactly as given — does NOT normalize to lowercase on build', () => {
    const ref = buildCanonicalRef({ scope: 'repo', artifact: 'adr', owner: 'ADRs4AI', repo: 'docket', number: 1 })
    expect(ref).toContain('/repo/ADRs4AI/docket/')
    expect(ref).not.toContain('/repo/adrs4ai/')
  })

  it('still accepts lowercase owner/repo unchanged (most real remotes) — the fix only widens what\'s accepted, never narrows it', () => {
    const ref = buildCanonicalRef({ scope: 'repo', artifact: 'adr', owner: 'jlumbroso', repo: 'vscode-adrs-for-ai', number: 8 })
    expect(ref).toBe('adr://v1/repo/jlumbroso/vscode-adrs-for-ai/adr/0008')
  })

  // ADR-0025 Decision 7 (context-aware deep-link copy format): the missing
  // write-side counterpart to parseXProjectAlias above — a bare `adr:NNNN`
  // copied from a multi-root workspace would resolve against whichever
  // root the paste lands in, not necessarily the root it was copied from.
  it('buildXProjectAdrRef produces a string parseDeepLinkRef re-parses as the SAME xproject-alias format already covered above', () => {
    const ref = buildXProjectAdrRef({ namespace: 'adrs4ai-vscode-adrs-for-ai', number: 25, anchor: 'decision-7' })
    expect(ref).toBe('adrs4ai-vscode-adrs-for-ai.0025#decision-7')
    expect(parseDeepLinkRef(ref)).toMatchObject({ format: 'xproject-alias', namespace: 'adrs4ai-vscode-adrs-for-ai', number: 25, anchor: 'decision-7' })
  })

  it('buildXProjectAdrRef with no anchor round-trips too', () => {
    const ref = buildXProjectAdrRef({ namespace: 'elenchus-app', number: 1 })
    expect(ref).toBe('elenchus-app.0001')
    expect(parseDeepLinkRef(ref)).toMatchObject({ format: 'xproject-alias', namespace: 'elenchus-app', number: 1 })
  })

  it('buildXProjectAdrRef supports a subpath, matching buildLocalAdrRef\'s own shape', () => {
    const ref = buildXProjectAdrRef({ namespace: 'elenchus-app', number: 3, subpath: 'archive' })
    expect(ref).toBe('elenchus-app.archive/0003')
    expect(parseDeepLinkRef(ref)).toMatchObject({ format: 'xproject-alias', namespace: 'elenchus-app', number: 3, subpath: 'archive' })
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

// ---------------------------------------------------------------------------
// Grammar conformance — mechanical drift check against ADR-0008.
//
// Jérémie's question (2026-07-07, via Facet): is protocol.ts verified against
// ADR-0008's *current* grammar, and is there a plan to keep it that way?
// A comment convention isn't enough — ADR-0008's own header `Iteration` field
// is already out of sync with its own Iterations log (checked directly:
// header says 1, the log has an Iteration 2 entry), which is proof that
// "someone remembers to update a marker" doesn't hold even in the ADR that
// most needs it to. This hashes the grammar's actual defining text instead.
// ---------------------------------------------------------------------------

describe('Grammar conformance — mechanical drift check against ADR-0008', () => {
  // On failure: re-read ADR-0008's "### COD: Reference grammar" block,
  // verify protocol.ts still implements it correctly (update protocol.ts if
  // the grammar changed), then replace this constant with the hash reported
  // in the failure message.
  const GRAMMAR_BLOCK_SHA1 = '4e59c9501f3b90f4a1380e2947d2ff1d95db6aab'

  function extractGrammarBlock(): string {
    const source = readFileSync(resolve(__dirname, '../../docs/adr/0008-deep-link-protocol.md'), 'utf-8')
    const lines = source.split('\n')
    const startIdx = lines.findIndex((l) => l.startsWith('### COD: Reference grammar'))
    if (startIdx === -1) {
      throw new Error(
        'ADR-0008 no longer has a "### COD: Reference grammar" heading — protocol.ts conformance ' +
        'can\'t be located automatically. Find where the grammar moved to and update this test.',
      )
    }
    const rest = lines.slice(startIdx + 1)
    const endOffset = rest.findIndex((l) => l.startsWith('### '))
    const sectionLines = endOffset === -1 ? rest : rest.slice(0, endOffset)
    const fenceStart = sectionLines.findIndex((l) => l.trim().startsWith('```'))
    const fenceEnd = sectionLines.findIndex((l, i) => i > fenceStart && l.trim().startsWith('```'))
    if (fenceStart === -1 || fenceEnd === -1) {
      throw new Error('Could not find a fenced code block inside ADR-0008\'s grammar section.')
    }
    return sectionLines.slice(fenceStart + 1, fenceEnd).join('\n').trim()
  }

  it('the grammar block protocol.ts was verified against has not changed underneath it', () => {
    const block = extractGrammarBlock()
    const hash = createHash('sha1').update(block).digest('hex')
    if (hash !== GRAMMAR_BLOCK_SHA1) {
      throw new Error(
        `ADR-0008's grammar block changed (new hash ${hash}, expected ${GRAMMAR_BLOCK_SHA1}).\n` +
        'Re-verify src/deeplink/protocol.ts against the current text in docs/adr/0008-deep-link-protocol.md, ' +
        `then update GRAMMAR_BLOCK_SHA1 in this test to ${hash}.`,
      )
    }
    expect(hash).toBe(GRAMMAR_BLOCK_SHA1)
  })
})

import { detectDeepLinks } from '../deeplink/linkDetection'

describe("Regression tests: clickability detection — bare refs + canonical URIs (founder demand, 2026-08-26)", () => {
  it('bare refs and canonical URIs are found; wrapped links not double-counted; mid-token never matches', () => {
    const text = [
      'See [scope](adr:0001#qst-scope) and bare adr:0008#decision in prose.',
      'Canonical: adr://v1/repo/jlumbroso/vscode-adrs-for-ai/adr/0008#decision here.',
      'Not a ref: consider madr:0001 (mid-token guard).',
    ].join('\n')
    const refs = detectDeepLinks(text).map(l => l.ref)
    expect(refs).toContain('adr:0001#qst-scope')
    expect(refs).toContain('adr:0008#decision')
    expect(refs).toContain('adr://v1/repo/jlumbroso/vscode-adrs-for-ai/adr/0008#decision')
    expect(refs.filter(r => r === 'adr:0001#qst-scope')).toHaveLength(1)
    expect(refs.some(r => r.includes('madr'))).toBe(false)
  })
})
