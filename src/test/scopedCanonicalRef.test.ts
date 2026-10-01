/**
 * Regression tests: canonical adr:// scope FILTERS resolution across roots.
 *
 * Incident (founder live-hit, 2026-10-01, routed by Plenum's brief
 * `2026-10-01-2043-plenum-to-riddle-scoped-adr-ref-reported-ambiguous-…`):
 * opening a pigeonhole card's deep link `adr://v1/repo/ADRs4AI/pneumatic/
 * adr/0026#qst-census-id-shape` from a 4-root HQ-shaped window failed with
 * "ADR 0026 exists in 4 roots/namespaces — specify a namespace-qualified
 * reference" even though the ref was fully scoped. The scope was parsed,
 * echoed back in the error text, and DROPPED at the canonical→short-ref
 * delegation call (reference.ts, the one-resolver seam).
 *
 * The invariant under test (Plenum's phrasing, kept): a scoped canonical
 * ref can never be legitimately ambiguous — it binds to the root(s) whose
 * identity matches the scope, or fails as not-found NAMING the scope.
 */
import { describe, it, expect } from 'vitest'
import { parseAdr } from '../parser/extractor'
import { resolveReference, extractOwnerRepo } from '../mcp/reference'
import { parseRemoteUrlFromConfig } from '../index/repositoryContextAdapter'
import type { RepositoryContext, RootScope } from '../mcp/repositoryContext'
import type { AdrFile } from '../parser/types'

function adr0026(root: string, namespace: string): AdrFile {
  const content = `# ADR 0026: Census shape (${namespace})

- **Date**: 2026-09-03
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

## Questions

### QST-CENSUS-ID-SHAPE: What shape is the census id?

- Status: unanswered
`
  const parsed = parseAdr(content, `${root}/docs/adr/0026-census-shape.md`)
  parsed.namespace = namespace
  return parsed
}

const ROOTS: RootScope[] = [
  { rootPath: '/ws/initial-meta-repository', namespace: 'hq', remote: 'git@github.com:ADRs4AI/initial-meta-repository.git' },
  { rootPath: '/ws/initial-meta-repository/subprojects/pneumatic', namespace: 'pneumatic', remote: 'https://github.com/ADRs4AI/pneumatic.git' },
  { rootPath: '/ws/docket', namespace: 'docket', remote: 'ssh://git@github.com/ADRs4AI/docket.git' },
  { rootPath: '/ws/vscode-adrs-for-ai', namespace: 'vscode', remote: 'git@github.com:jlumbroso/vscode-adrs-for-ai.git' },
]

// Four roots, each with its own ADR 0026 — the founder's exact collision shape.
const ADRS = [
  adr0026('/ws/initial-meta-repository', 'hq'),
  adr0026('/ws/initial-meta-repository/subprojects/pneumatic', 'pneumatic'),
  adr0026('/ws/docket', 'docket'),
  adr0026('/ws/vscode-adrs-for-ai', 'vscode'),
]

function multiRootCtx(roots: RootScope[] | undefined, adrs: AdrFile[] = ADRS): RepositoryContext {
  return {
    listAdrs: () => adrs,
    getAdr: (ref: string) => adrs.find((a) => a.number === parseInt(ref.replace(/^adr:/, ''), 10)),
    listSeeds: () => [],
    getSeed: () => undefined,
    readFile: async () => { throw new Error('n/a') },
    writeFile: async () => { throw new Error('n/a') },
    listFiles: async () => [],
    ...(roots ? { listRootScopes: () => roots } : {}),
  }
}

describe('Regression tests: scoped canonical refs across multi-root workspaces (founder report 2026-10-01)', () => {
  const FOUNDER_REF = 'adr://v1/repo/ADRs4AI/pneumatic/adr/0026#qst-census-id-shape'

  it('binds a fully-scoped ref to the one root whose remote matches — never ambiguous (the live-hit specimen)', () => {
    // Bug: scope parsed, echoed in the error, then dropped at delegation;
    // bare 0026 fanned across 4 roots and refused as ambiguous.
    const result = resolveReference(multiRootCtx(ROOTS), FOUNDER_REF)
    expect(result.kind).toBe('question')
    if (result.kind === 'question' && result.container.kind === 'adr') {
      expect(result.container.adr.namespace).toBe('pneumatic')
    }
  })

  it('submodule mount still matches: the nested root wins by ITS OWN remote, not the enclosing window root', () => {
    // The subtler variant Plenum named: an HQ window whose own remote is
    // initial-meta-repository must still bind subprojects/pneumatic.
    const result = resolveReference(multiRootCtx(ROOTS), 'adr://v1/repo/ADRs4AI/pneumatic/adr/0026')
    expect(result.kind).toBe('adr')
    if (result.kind === 'adr') expect(result.adr.namespace).toBe('pneumatic')
  })

  it('an unmatched scope fails as not-found NAMING the scope — never ambiguous', () => {
    const result = resolveReference(multiRootCtx(ROOTS), 'adr://v1/repo/SomeoneElse/elsewhere/adr/0026')
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.error).toBe('not_found')
      expect(result.message).toContain('repo/SomeoneElse/elsewhere')
      expect(result.message).not.toContain('ambiguous')
    }
  })

  it('project/<ns> scope binds by namespace', () => {
    const result = resolveReference(multiRootCtx(ROOTS), 'adr://v1/project/docket/adr/0026')
    expect(result.kind).toBe('adr')
    if (result.kind === 'adr') expect(result.adr.namespace).toBe('docket')
  })

  it('the same repo genuinely mounted at two roots stays honestly ambiguous, limited to those two', () => {
    const twice: RootScope[] = [
      ...ROOTS,
      { rootPath: '/ws/pneumatic-standalone', namespace: 'pneumatic-live', remote: 'git@github.com:ADRs4AI/pneumatic.git' },
    ]
    const adrs = [...ADRS, adr0026('/ws/pneumatic-standalone', 'pneumatic-live')]
    const result = resolveReference(multiRootCtx(twice, adrs), 'adr://v1/repo/ADRs4AI/pneumatic/adr/0026')
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.error).toBe('ambiguous')
      expect(result.message).toContain('2') // two candidates, not four
    }
  })

  it('a context without listRootScopes keeps the pre-fix delegation behavior (older adapters, minimal tests)', () => {
    const result = resolveReference(multiRootCtx(undefined), FOUNDER_REF)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.error).toBe('ambiguous')
      expect(result.message).toContain('canonical ref scoped to repo/ADRs4AI/pneumatic')
    }
  })

  it('scope filtering reaches seeds too (the view filters every artifact kind)', () => {
    const ctx = multiRootCtx(ROOTS)
    const result = resolveReference(ctx, 'adr://v1/repo/ADRs4AI/docket/seed/nonexistent-seed')
    // Not found WITHIN the scoped root — and the message names the binding.
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.message).toContain('scoped to repo/ADRs4AI/docket')
  })
})

describe('extractOwnerRepo — one matcher for every wild remote form', () => {
  it.each([
    ['git@github.com:ADRs4AI/pneumatic.git', 'adrs4ai/pneumatic'],
    ['https://github.com/ADRs4AI/pneumatic.git', 'adrs4ai/pneumatic'],
    ['https://github.com/ADRs4AI/pneumatic', 'adrs4ai/pneumatic'],
    ['ssh://git@github.com/ADRs4AI/docket.git', 'adrs4ai/docket'],
    ['https://github.com/jlumbroso/vscode-adrs-for-ai/', 'jlumbroso/vscode-adrs-for-ai'],
  ])('%s → %s', (url, expected) => {
    expect(extractOwnerRepo(url)).toBe(expected)
  })

  it('returns undefined for unreadable forms rather than guessing', () => {
    expect(extractOwnerRepo('not-a-url')).toBeUndefined()
  })
})

describe('parseRemoteUrlFromConfig — origin preferred, first remote as fallback', () => {
  it('prefers origin even when listed second', () => {
    const config = `[core]\n\trepositoryformatversion = 0\n[remote "upstream"]\n\turl = git@github.com:other/fork.git\n[remote "origin"]\n\turl = git@github.com:ADRs4AI/pneumatic.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`
    expect(parseRemoteUrlFromConfig(config)).toBe('git@github.com:ADRs4AI/pneumatic.git')
  })

  it('falls back to the first remote when origin is absent', () => {
    const config = `[remote "upstream"]\n\turl = https://github.com/other/fork.git\n`
    expect(parseRemoteUrlFromConfig(config)).toBe('https://github.com/other/fork.git')
  })

  it('returns undefined with no remotes at all', () => {
    expect(parseRemoteUrlFromConfig('[core]\n\tbare = false\n')).toBeUndefined()
  })
})
