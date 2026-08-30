/**
 * Regression test for DEBRIEF-002 — "Commit ADR Changes" silently reports
 * nothing to commit in a multi-repo workspace because api.repositories[0]
 * is a positional guess, not an identity lookup.
 *
 * Real scenario this reproduces: a workspace with several git repositories
 * (HQ + submodules) where VS Code's git extension happens to discover the
 * target repo in a position other than 0 — the exact shape DEBRIEF-002
 * names as the actual incident (Jérémie's own edits were real and staged,
 * but the command reported "No ADR changes to commit" because it was
 * looking at a sibling submodule's repo instead).
 */

import { describe, it, expect } from 'vitest'
import { resolveWorkspaceRepository, isNewGitStatus, groupChangesByOwningRoot, refreshRepositories, type GitApiLike } from '../commit/repositoryResolution'
import type { RootNode } from '../index/compositeIndex'

interface FakeRepo {
  name: string
  rootUri: { fsPath: string }
}

function fakeApi(repos: FakeRepo[]): GitApiLike<FakeRepo> {
  return {
    repositories: repos,
    getRepository(uri) {
      return repos.find(r => r.rootUri.fsPath === uri.fsPath) ?? null
    },
  }
}

describe('resolveWorkspaceRepository (DEBRIEF-002)', () => {
  it('finds the correct repository when it is NOT at index 0', () => {
    const hq: FakeRepo = { name: 'hq', rootUri: { fsPath: '/work/hq' } }
    const submoduleA: FakeRepo = { name: 'submodule-a', rootUri: { fsPath: '/work/hq/subprojects/a' } }
    const target: FakeRepo = { name: 'vscode-adrs-for-ai', rootUri: { fsPath: '/work/hq/subprojects/vscode-adrs-for-ai' } }
    // Discovery order deliberately does NOT match workspace-folder order —
    // this is the actual failure mode: repositories[0] is submoduleA, not
    // the repo commitAdrChanges actually needs.
    const api = fakeApi([submoduleA, hq, target])

    const resolved = resolveWorkspaceRepository(api, { fsPath: '/work/hq/subprojects/vscode-adrs-for-ai' })

    expect(resolved).toBe(target)
    expect(resolved).not.toBe(api.repositories[0])
  })

  it('resolves correctly even in the single-repo case (N=1 must stay the trivial case)', () => {
    const onlyRepo: FakeRepo = { name: 'solo', rootUri: { fsPath: '/work/solo' } }
    const api = fakeApi([onlyRepo])

    expect(resolveWorkspaceRepository(api, { fsPath: '/work/solo' })).toBe(onlyRepo)
  })

  it('returns null (not a wrong guess) when no repository owns the given workspace folder', () => {
    const api = fakeApi([{ name: 'unrelated', rootUri: { fsPath: '/work/unrelated' } }])

    expect(resolveWorkspaceRepository(api, { fsPath: '/work/not-a-repo' })).toBeNull()
  })
})

// commitMessage.ts's A1 (Lapidary's 2026-07-29 dispatch): "new seed: <topic>"
// vs "human feedback on seed" hinges on whether git considers the path new.
describe('isNewGitStatus', () => {
  it('INDEX_ADDED (1) and UNTRACKED (7) both count as new', () => {
    expect(isNewGitStatus(1)).toBe(true)
    expect(isNewGitStatus(7)).toBe(true)
  })

  it('INTENT_TO_ADD (9, "git add -N") counts as new', () => {
    expect(isNewGitStatus(9)).toBe(true)
  })

  it('MODIFIED (5) and INDEX_MODIFIED (0) are not new', () => {
    expect(isNewGitStatus(5)).toBe(false)
    expect(isNewGitStatus(0)).toBe(false)
  })

  it('undefined defaults to false — never claims "new" without git confirming it', () => {
    expect(isNewGitStatus(undefined)).toBe(false)
  })
})

// Lapidary's 2026-07-31 dispatch: DEBRIEF-002's doctrine finished. Live
// repro at HQ — a genuine multi-FOLDER VS Code workspace (`.code-workspace`
// with the parent repo and a submodule as SEPARATE top-level folders, not
// nested under one directory tree that a single `getRepository(root.path)`
// lookup can resolve). commitAdrChanges used to scan root-first (ask git
// to resolve a repo FOR each ADR root's bare directory); this inverts it —
// repo-first, resolving the owning root from each changed FILE's path.
describe('groupChangesByOwningRoot (DEBRIEF-002, finished)', () => {
  function fakeRoot(p: string, hasAdrDir = true): RootNode {
    return { path: p, hasAdrDir } as unknown as RootNode
  }
  function fakeChange(fsPath: string, status?: number) {
    return { uri: { fsPath }, status }
  }
  function fakeRepo(changes: ReturnType<typeof fakeChange>[]) {
    return { state: { workingTreeChanges: changes, indexChanges: [] } }
  }

  it('the founding incident: TWO separate repos (parent + submodule as sibling workspace folders, not nested), each correctly attributed to its own ADR root — no root-path-based getRepository() lookup involved at all', () => {
    const parentRoot = fakeRoot('/work/hq')
    const submoduleRoot = fakeRoot('/work/hq/subprojects/initial-meta-repository')

    const parentRepo = fakeRepo([fakeChange('/work/hq/docs/adr/0001-x.md')])
    const submoduleRepo = fakeRepo([fakeChange('/work/hq/subprojects/initial-meta-repository/docs/adr/0022-y.md')])

    const findRoot = (fp: string): RootNode | null => {
      if (fp.startsWith(submoduleRoot.path)) return submoduleRoot
      if (fp.startsWith(parentRoot.path)) return parentRoot
      return null
    }

    const groups = groupChangesByOwningRoot([parentRepo, submoduleRepo], 'docs/adr', findRoot)

    expect(groups).toHaveLength(2)
    const bySubmodule = groups.find(g => g.node.path === submoduleRoot.path)
    const byParent = groups.find(g => g.node.path === parentRoot.path)
    expect(bySubmodule?.repo).toBe(submoduleRepo)
    expect(bySubmodule?.changes).toHaveLength(1)
    expect(byParent?.repo).toBe(parentRepo)
    expect(byParent?.changes).toHaveLength(1)
  })

  it('a change outside any known ADR root is silently excluded, not misattributed', () => {
    const root = fakeRoot('/work/hq')
    const repo = fakeRepo([fakeChange('/unrelated/path/file.md')])
    const groups = groupChangesByOwningRoot([repo], 'docs/adr', () => null)
    expect(groups).toHaveLength(0)
  })

  it('a change under a root whose adrDirPath does not exist (hasAdrDir: false — the synthetic forest top node) is excluded', () => {
    const syntheticTop = fakeRoot('/work/forest', false)
    const repo = fakeRepo([fakeChange('/work/forest/docs/adr/x.md')])
    const groups = groupChangesByOwningRoot([repo], 'docs/adr', () => syntheticTop)
    expect(groups).toHaveLength(0)
  })

  it('a change resolved to a real root but OUTSIDE that root\'s own ADR dir is excluded (a file elsewhere in a big monorepo root)', () => {
    const root = fakeRoot('/work/hq')
    const repo = fakeRepo([fakeChange('/work/hq/README.md')])
    const groups = groupChangesByOwningRoot([repo], 'docs/adr', () => root)
    expect(groups).toHaveLength(0)
  })

  it('multiple changes in the SAME root/repo group together as one entry', () => {
    const root = fakeRoot('/work/hq')
    const repo = fakeRepo([
      fakeChange('/work/hq/docs/adr/0001-a.md'),
      fakeChange('/work/hq/docs/adr/0002-b.md'),
    ])
    const groups = groupChangesByOwningRoot([repo], 'docs/adr', () => root)
    expect(groups).toHaveLength(1)
    expect(groups[0].changes).toHaveLength(2)
  })

  it('no repos, no changes: empty, no crash', () => {
    expect(groupChangesByOwningRoot([], 'docs/adr', () => null)).toEqual([])
  })
})

// Jérémie's 2026-08-29 founder Report: "commit adrs in this root just now
// said 'no changes'" moments after answering a question in-panel (a real
// file write). His own hypothesis — commit-scoping coupled to the "Hide
// ADRs Without Open Questions" tree filter — was checked against the call
// graph and refuted: `commitAdrChanges` never reads tree display state,
// only `repo.state`. The actual cause is a race against the git
// extension's OWN async refresh of that state off its file watcher.
describe('refreshRepositories (2026-08-29 "commit says no changes right after saving")', () => {
  function fakeRoot(p: string): RootNode {
    return { path: p, hasAdrDir: true } as unknown as RootNode
  }
  function fakeChange(fsPath: string) {
    return { uri: { fsPath } }
  }

  it('a repo whose cached state has not caught up to a just-saved file is missed without a refresh, and seen with one', async () => {
    const root = fakeRoot('/work/hq')
    // Simulates the git extension's real behavior: `.state` reflects
    // whatever the last background refresh saw (stale, empty) until
    // `.status()` is awaited, which is the extension's own documented
    // synchronous-refresh call.
    const repo = {
      state: { workingTreeChanges: [] as ReturnType<typeof fakeChange>[], indexChanges: [] as ReturnType<typeof fakeChange>[] },
      status: async () => {
        repo.state.workingTreeChanges = [fakeChange('/work/hq/docs/adr/0001-just-answered.md')]
      },
    }

    const staleGroups = groupChangesByOwningRoot([repo], 'docs/adr', () => root)
    expect(staleGroups).toHaveLength(0) // the exact "no changes" symptom from the report

    await refreshRepositories([repo])
    const freshGroups = groupChangesByOwningRoot([repo], 'docs/adr', () => root)
    expect(freshGroups).toHaveLength(1)
    expect(freshGroups[0].changes).toHaveLength(1)
  })

  it('a repo with no status() (older fixture shape) is left untouched, not crashed', async () => {
    const repo = { state: { workingTreeChanges: [fakeChange('/work/hq/docs/adr/0001-a.md')], indexChanges: [] } }
    await expect(refreshRepositories([repo])).resolves.toBeUndefined()
  })
})
