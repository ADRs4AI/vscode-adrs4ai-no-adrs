/**
 * adrPath portability — Loftsman (ios-client) RFC, 2026-07-22 `1951`, ruled
 * by Lapidary `2140`: Option 1, repo-relative `adrPath` becomes the source
 * of truth. `drafts.json` is committed and travels between machines by
 * design; a machine-local absolute path inside it was always a latent
 * cross-machine bug — ios-client (no local git checkout at all) found it
 * first, but a second laptop on the same repo would hit the identical bug.
 */

import { describe, it, expect } from 'vitest'
import * as path from 'path'
import { isAbsoluteStoredPath, toRepoRelative, resolveStoredAdrPath } from '../drafts/adrPathPortability'

describe('isAbsoluteStoredPath', () => {
  it('recognizes a POSIX absolute path', () => {
    expect(isAbsoluteStoredPath('/Users/jlumbroso/repo/docs/adr/0022-x.md')).toBe(true)
  })

  it('recognizes a Windows drive-letter absolute path (forward or back slash)', () => {
    expect(isAbsoluteStoredPath('C:\\Users\\jer\\repo\\docs\\adr\\0022-x.md')).toBe(true)
    expect(isAbsoluteStoredPath('C:/Users/jer/repo/docs/adr/0022-x.md')).toBe(true)
  })

  it('a repo-relative path is not absolute', () => {
    expect(isAbsoluteStoredPath('docs/adr/0022-x.md')).toBe(false)
  })
})

describe('toRepoRelative', () => {
  it('converts an absolute path under workspaceRoot to a repo-relative, POSIX form', () => {
    const root = path.join('/Users', 'jlumbroso', 'repo')
    const abs = path.join(root, 'docs', 'adr', '0022-x.md')
    expect(toRepoRelative(abs, root)).toBe('docs/adr/0022-x.md')
  })

  it('an already-relative path passes through unchanged (idempotent — re-saving a canonical entry is a no-op)', () => {
    expect(toRepoRelative('docs/adr/0022-x.md', '/Users/jlumbroso/repo')).toBe('docs/adr/0022-x.md')
  })

  it('an absolute path under a multi-root subproject keeps the subproject prefix', () => {
    const root = '/Users/jlumbroso/hq'
    const abs = '/Users/jlumbroso/hq/vscode-adrs-for-ai/docs/adr/0022-x.md'
    expect(toRepoRelative(abs, root)).toBe('vscode-adrs-for-ai/docs/adr/0022-x.md')
  })
})

describe('resolveStoredAdrPath', () => {
  const workspaceRoot = '/Users/jlumbroso/repo'

  it('a canonical (repo-relative) entry resolves directly against workspaceRoot, no existence check needed', () => {
    const result = resolveStoredAdrPath('docs/adr/0022-x.md', workspaceRoot, [workspaceRoot], 'docs/adr', () => false)
    expect(result).toEqual({ kind: 'resolved', absolutePath: path.join(workspaceRoot, 'docs/adr/0022-x.md') })
  })

  it('a legacy absolute entry matching exactly one known root resolves unambiguously', () => {
    const legacy = '/Users/otherlaptop/somewhere/vscode-adrs-for-ai/docs/adr/0022-x.md'
    const expected = path.join(workspaceRoot, 'docs/adr/0022-x.md')
    const result = resolveStoredAdrPath(legacy, workspaceRoot, [workspaceRoot], 'docs/adr', p => p === expected)
    expect(result).toEqual({ kind: 'resolved', absolutePath: expected })
  })

  it('a legacy absolute entry matching no known root is not-found — never a silent pick', () => {
    const legacy = '/Users/otherlaptop/somewhere/vscode-adrs-for-ai/docs/adr/0022-x.md'
    const result = resolveStoredAdrPath(legacy, workspaceRoot, [workspaceRoot], 'docs/adr', () => false)
    expect(result).toEqual({ kind: 'not-found' })
  })

  it('a legacy absolute entry whose suffix exists under TWO known roots is ambiguous — structured error, never a silent pick', () => {
    const legacy = '/Users/otherlaptop/somewhere/docs/adr/0022-x.md'
    const rootA = '/Users/jlumbroso/hq/vscode-adrs-for-ai'
    const rootB = '/Users/jlumbroso/hq-mirror/vscode-adrs-for-ai'
    const result = resolveStoredAdrPath(legacy, workspaceRoot, [rootA, rootB], 'docs/adr', () => true)
    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') {
      expect(result.candidates).toHaveLength(2)
      expect(result.candidates).toContain(path.join(rootA, 'docs/adr/0022-x.md'))
      expect(result.candidates).toContain(path.join(rootB, 'docs/adr/0022-x.md'))
    }
  })

  it('a legacy absolute entry with no recognizable adrDirRel segment at all is not-found', () => {
    const result = resolveStoredAdrPath('/completely/unrelated/file.md', workspaceRoot, [workspaceRoot], 'docs/adr', () => true)
    expect(result).toEqual({ kind: 'not-found' })
  })
})
