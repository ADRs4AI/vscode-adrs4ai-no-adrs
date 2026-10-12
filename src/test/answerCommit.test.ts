/**
 * Real behavioral tests for commit/answerCommit.ts — no vscode mock
 * needed, since the module only ever touches plain objects shaped like
 * the vscode.git extension's Repository. Context: Concertmaster 5's
 * forensics brief (companion etude, 2026-10-11) — a human's submitted
 * answer got overwritten by a crew `git checkout` before anyone had
 * committed it; this module stakes the answer with its own commit right
 * after it's written, closing that window.
 */
import { describe, it, expect, vi } from 'vitest'
import { findRepoForFile, commitAnswerFile, type GitRepoLike } from '../commit/answerCommit'

function fakeRepo(rootPath: string, branchName = 'main'): GitRepoLike & { add: ReturnType<typeof vi.fn>; commit: ReturnType<typeof vi.fn> } {
  return {
    rootUri: { fsPath: rootPath },
    // Realistic default: ON a branch, so tests not specifically about the
    // detached-HEAD case don't accidentally exercise it (`!undefined ===
    // true` would make every repo without a `state` field look detached).
    state: { HEAD: { name: branchName } },
    add: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
  }
}

describe('findRepoForFile: longest-matching-root wins, same idiom as CompositeIndex.findRoot', () => {
  it('finds the single repo containing the file', () => {
    const repo = fakeRepo('/Users/x/project')
    expect(findRepoForFile([repo], '/Users/x/project/docs/adr/0001.md')).toBe(repo)
  })

  it('a submodule nested inside a parent repo: the longer, more specific root wins', () => {
    const parent = fakeRepo('/Users/x/project')
    const submodule = fakeRepo('/Users/x/project/vendor/sub')
    const file = '/Users/x/project/vendor/sub/docs/adr/0001.md'
    expect(findRepoForFile([parent, submodule], file)).toBe(submodule)
    // Order independence — the longest-prefix rule, not "first match wins".
    expect(findRepoForFile([submodule, parent], file)).toBe(submodule)
  })

  it('returns undefined for a file outside every known repo — not a throw', () => {
    const repo = fakeRepo('/Users/x/project')
    expect(findRepoForFile([repo], '/Users/elsewhere/docs/adr/0001.md')).toBeUndefined()
  })

  it('ignores a repo with no rootUri rather than crashing on it', () => {
    const broken = { add: vi.fn(), commit: vi.fn() } as GitRepoLike
    const real = fakeRepo('/Users/x/project')
    expect(findRepoForFile([broken, real], '/Users/x/project/a.md')).toBe(real)
  })

  it('a bare match at the root path itself (file === root) still matches, not just a startsWith', () => {
    const repo = fakeRepo('/Users/x/project')
    // Pathological but shouldn't crash or false-negative on the edge.
    expect(findRepoForFile([repo], '/Users/x/project')).toBe(repo)
  })
})

describe('commitAnswerFile: pathspec\'d to exactly one file, never a bare commit()', () => {
  it('stages and commits ONLY the one path — never the whole index', async () => {
    const repo = fakeRepo('/Users/x/project')
    const result = await commitAnswerFile([repo], '/Users/x/project/docs/adr/0001.md', 'FACE-BOOTSTRAP', 'Jérémie')
    expect(result).toEqual({ committed: true, detachedHead: false })
    expect(repo.add).toHaveBeenCalledWith(['/Users/x/project/docs/adr/0001.md'])
    expect(repo.commit).toHaveBeenCalledTimes(1)
    const message = repo.commit.mock.calls[0][0] as string
    expect(message).toContain('QST-FACE-BOOTSTRAP')
    expect(message).toContain('Jérémie')
  })

  it('falls back to a generic label when no QST handle is known', async () => {
    const repo = fakeRepo('/Users/x/project')
    await commitAnswerFile([repo], '/Users/x/project/a.md', undefined, 'Jérémie')
    expect(repo.commit.mock.calls[0][0]).toContain('a question')
  })

  it('an empty/whitespace author name falls back to "Human", matching writeAnswer\'s own ANS-byline convention', async () => {
    const repo = fakeRepo('/Users/x/project')
    await commitAnswerFile([repo], '/Users/x/project/a.md', 'X', '   ')
    expect(repo.commit.mock.calls[0][0]).toContain('(by Human)')
  })

  it('returns committed:false, without calling add/commit, when no repo owns the path — a no-op, not an error', async () => {
    const repo = fakeRepo('/Users/x/project')
    const result = await commitAnswerFile([repo], '/elsewhere/a.md', 'X', 'Human')
    expect(result).toEqual({ committed: false, detachedHead: false })
    expect(repo.add).not.toHaveBeenCalled()
    expect(repo.commit).not.toHaveBeenCalled()
  })

  it('detachedHead is true when the repo\'s own state says so (Concertmaster 5\'s amendment, 2026-10-11) — the commit still lands, it\'s just a recoverable stray, not something a branch carries forward', async () => {
    const repo = fakeRepo('/Users/x/project')
    repo.state!.HEAD!.name = undefined // detached — the real git extension's own shape for this state
    const result = await commitAnswerFile([repo], '/Users/x/project/a.md', 'X', 'Human')
    expect(result).toEqual({ committed: true, detachedHead: true })
    expect(repo.add).toHaveBeenCalled()
    expect(repo.commit).toHaveBeenCalled()
  })

  it('a repo with no state field at all is treated as detached (fail toward "tell the human", not toward silence)', async () => {
    const repo = fakeRepo('/Users/x/project')
    delete repo.state
    const result = await commitAnswerFile([repo], '/Users/x/project/a.md', 'X', 'Human')
    expect(result.detachedHead).toBe(true)
  })

  it('a git failure (e.g. a commit hook rejection) propagates — the caller\'s job to catch and log, never this module\'s to swallow silently', async () => {
    const repo = fakeRepo('/Users/x/project')
    repo.commit.mockRejectedValueOnce(new Error('pre-commit hook rejected'))
    await expect(commitAnswerFile([repo], '/Users/x/project/a.md', 'X', 'Human')).rejects.toThrow('pre-commit hook rejected')
  })

  it('a shared tree with two repos: only the one that actually owns the file gets touched', async () => {
    const unrelated = fakeRepo('/Users/x/other-project')
    const owner = fakeRepo('/Users/x/project')
    await commitAnswerFile([unrelated, owner], '/Users/x/project/docs/adr/0001.md', 'X', 'Human')
    expect(unrelated.add).not.toHaveBeenCalled()
    expect(unrelated.commit).not.toHaveBeenCalled()
    expect(owner.add).toHaveBeenCalledTimes(1)
  })
})

// Context (2026-10-11, Jérémie's own correction, same evening): committing
// only the answer file left drafts.json/drafts-archive.json — what
// actually saved a real clobbered answer — no better protected, and on a
// more stale commit cadence than the answer file now has. `extraPaths`
// closes that gap by committing them in the SAME stroke.
describe('commitAnswerFile: extraPaths (drafts.json/drafts-archive.json) ride in the SAME commit', () => {
  it('stages adrPath AND every extra path together, in one commit', async () => {
    const repo = fakeRepo('/Users/x/project')
    await commitAnswerFile(
      [repo],
      '/Users/x/project/docs/adr/0001.md',
      'X',
      'Human',
      ['/Users/x/project/docs/adr/.working/drafts.json', '/Users/x/project/docs/adr/.working/drafts-archive.json'],
    )
    expect(repo.add).toHaveBeenCalledWith([
      '/Users/x/project/docs/adr/0001.md',
      '/Users/x/project/docs/adr/.working/drafts.json',
      '/Users/x/project/docs/adr/.working/drafts-archive.json',
    ])
    expect(repo.commit).toHaveBeenCalledTimes(1) // one commit, not one per file
  })

  it('an extra path belonging to a DIFFERENT repo is dropped, not committed into the wrong repo\'s history', async () => {
    const owner = fakeRepo('/Users/x/project')
    const otherRepo = fakeRepo('/Users/x/other-project')
    await commitAnswerFile(
      [owner, otherRepo],
      '/Users/x/project/docs/adr/0001.md',
      'X',
      'Human',
      ['/Users/x/other-project/docs/adr/.working/drafts.json'],
    )
    expect(owner.add).toHaveBeenCalledWith(['/Users/x/project/docs/adr/0001.md'])
    expect(otherRepo.add).not.toHaveBeenCalled()
  })

  it('defaults to no extra paths when the caller omits the argument — same behavior as before this feature existed', async () => {
    const repo = fakeRepo('/Users/x/project')
    await commitAnswerFile([repo], '/Users/x/project/a.md', 'X', 'Human')
    expect(repo.add).toHaveBeenCalledWith(['/Users/x/project/a.md'])
  })
})
