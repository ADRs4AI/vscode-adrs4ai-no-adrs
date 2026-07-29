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
import { resolveWorkspaceRepository, isNewGitStatus, type GitApiLike } from '../commit/repositoryResolution'

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
