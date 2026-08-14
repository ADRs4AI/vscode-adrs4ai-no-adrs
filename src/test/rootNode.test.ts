/**
 * Root discovery tests — ADR-0025 (Multi-Root Recursive Project Roots)
 *
 * Real temp directories, no fs mocking (project convention — see
 * index.test.ts). Covers: the N=1 trivial case, the HQ validating case
 * (a root containing a nested root two levels down through a transparent
 * intermediate directory), the three opt-out mechanisms from Decision 1,
 * and namespace computation's three-tier fallback.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { discoverRoots, computeNamespace, gitRemoteSlugFor } from '../index/rootNode'

function mkdirp(p: string): void {
  fs.mkdirSync(p, { recursive: true })
}

describe('discoverRoots', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'root-node-test-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('N=1 case: a single project with an ADR dir and no nested roots has no children', () => {
    mkdirp(path.join(dir, 'docs', 'adr'))
    const result = discoverRoots(dir, { adrDirRel: 'docs/adr' })
    expect(result.hasAdrDir).toBe(true)
    expect(result.path).toBe(dir)
    expect(result.children).toHaveLength(0)
  })

  it('HQ validating case: a nested ADR dir two levels down through a transparent directory is found as a child root', () => {
    mkdirp(path.join(dir, 'docs', 'adr'))
    mkdirp(path.join(dir, 'subprojects', 'vscode-adrs-for-ai', 'docs', 'adr'))
    const result = discoverRoots(dir, { adrDirRel: 'docs/adr' })
    expect(result.hasAdrDir).toBe(true)
    expect(result.children).toHaveLength(1)
    expect(result.children[0].path).toBe(path.join(dir, 'subprojects', 'vscode-adrs-for-ai'))
    expect(result.children[0].hasAdrDir).toBe(true)
  })

  it('a "forest" workspace with no top-level ADR dir yields a synthetic root whose real content lives in its children', () => {
    mkdirp(path.join(dir, 'projectA', 'docs', 'adr'))
    mkdirp(path.join(dir, 'projectB', 'docs', 'adr'))
    const result = discoverRoots(dir, { adrDirRel: 'docs/adr' })
    expect(result.hasAdrDir).toBe(false)
    expect(result.children.map(c => path.basename(c.path)).sort()).toEqual(['projectA', 'projectB'])
  })

  it('node_modules and .git are never descended into even if they contain a docs/adr-shaped path', () => {
    mkdirp(path.join(dir, 'docs', 'adr'))
    mkdirp(path.join(dir, 'node_modules', 'some-pkg', 'docs', 'adr'))
    const result = discoverRoots(dir, { adrDirRel: 'docs/adr' })
    expect(result.children).toHaveLength(0)
  })

  it('.adrignore at a candidate root excludes it and its subtree (opt-out mechanism 1)', () => {
    mkdirp(path.join(dir, 'docs', 'adr'))
    const excluded = path.join(dir, 'docs', 'research', 'some-clone')
    mkdirp(path.join(excluded, 'docs', 'adr'))
    fs.writeFileSync(path.join(excluded, '.adrignore'), '')
    const result = discoverRoots(dir, { adrDirRel: 'docs/adr' })
    expect(result.children).toHaveLength(0)
  })

  it('.adr-root-ignore is accepted as an alternate spelling of the marker file', () => {
    mkdirp(path.join(dir, 'docs', 'adr'))
    const excluded = path.join(dir, 'sub', 'docs', 'adr')
    mkdirp(excluded)
    fs.writeFileSync(path.join(dir, 'sub', '.adr-root-ignore'), '')
    const result = discoverRoots(dir, { adrDirRel: 'docs/adr' })
    expect(result.children).toHaveLength(0)
  })

  it('.settings/roots.json block pattern excludes a matching candidate (opt-out mechanism 2)', () => {
    mkdirp(path.join(dir, 'docs', 'adr', '.settings'))
    mkdirp(path.join(dir, 'sandbox', 'docs', 'adr'))
    fs.writeFileSync(
      path.join(dir, 'docs', 'adr', '.settings', 'roots.json'),
      JSON.stringify({ block: ['sandbox'] }),
    )
    const result = discoverRoots(dir, { adrDirRel: 'docs/adr' })
    expect(result.children).toHaveLength(0)
  })

  it('.settings/roots.json allow pattern restricts discovery to only the listed roots', () => {
    mkdirp(path.join(dir, 'docs', 'adr', '.settings'))
    mkdirp(path.join(dir, 'keep', 'docs', 'adr'))
    mkdirp(path.join(dir, 'drop', 'docs', 'adr'))
    fs.writeFileSync(
      path.join(dir, 'docs', 'adr', '.settings', 'roots.json'),
      JSON.stringify({ allow: ['keep'] }),
    )
    const result = discoverRoots(dir, { adrDirRel: 'docs/adr' })
    expect(result.children.map(c => path.basename(c.path))).toEqual(['keep'])
  })

  it('isSubmodule is true when a discovered root has a gitlink file (submodule), false for a plain directory', () => {
    mkdirp(path.join(dir, 'docs', 'adr'))
    const sub = path.join(dir, 'vendored', 'docs', 'adr')
    mkdirp(sub)
    fs.writeFileSync(path.join(dir, 'vendored', '.git'), 'gitdir: ../.git/modules/vendored\n')
    const result = discoverRoots(dir, { adrDirRel: 'docs/adr' })
    expect(result.children[0].isSubmodule).toBe(true)
  })
})

describe('discoverRoots against this repo itself (dogfooding the ADR-0025 QST-1 motivating example)', () => {
  it('the committed docs/adr/.settings/roots.json block pattern keeps docs/research/*/ clones from becoming surprise subroots', () => {
    // This is the exact scenario ADR-0025's QST-1 named as the reason
    // automatic-only discovery (Option A) was rejected in favor of
    // automatic-with-opt-out (Option C): "research clones under
    // docs/research/ — this very repo has ~10 of them — would become
    // subroots without user opt-in." Several of those clones (imessage-mcp,
    // inbox-alchemy, elenchus-app, ...) have their own docs/adr/, so without
    // the block pattern this repo's own workspace root would discover a
    // handful of spurious roots the moment this scanner is wired into
    // extension.ts.
    const repoRoot = path.resolve(__dirname, '..', '..')
    const result = discoverRoots(repoRoot, { adrDirRel: 'docs/adr' })
    const childPaths = result.children.map(c => c.path)
    expect(childPaths.some(p => p.includes(`${path.sep}docs${path.sep}research${path.sep}`))).toBe(false)
  })
})

describe('computeNamespace', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'namespace-test-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('derives the namespace from the git remote origin URL when present', () => {
    mkdirp(path.join(dir, '.git'))
    fs.writeFileSync(
      path.join(dir, '.git', 'config'),
      '[remote "origin"]\n\turl = git@github.com:jlumbroso/vscode-adrs-for-ai.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
    )
    expect(computeNamespace(dir)).toBe('jlumbroso-vscode-adrs-for-ai')
  })

  it('falls back to a CLAUDE.md **Project**: field when there is no git remote', () => {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# CLAUDE.md\n\n- **Project**: VSCode ADRs for AI Extension\n')
    expect(computeNamespace(dir)).toBe('vscode-adrs-for-ai-extension')
  })

  it('falls back to the directory basename when neither a git remote nor a project doc is present', () => {
    const namedDir = path.join(dir, 'My Cool Project')
    mkdirp(namedDir)
    expect(computeNamespace(namedDir)).toBe('my-cool-project')
  })
})

// Regression tests (fixes real bug, Gleaner's brief 2026-08-14, docs/inbox/
// 2026-08-14-1740-gleaner-to-fitter-four-tree-root-features-batch.md, item
// A): root-caused as "submodule git-remote detection never fires" —
// computeNamespace's own git-remote reader only ever tries
// `<root>/.git/config` directly, which doesn't exist for a submodule (whose
// `.git` is a one-line gitlink FILE, not a directory). gitRemoteSlugFor is
// the new, separate, submodule-aware reader built for the caption feature —
// these tests pin the exact gitlink-following behavior that was missing.
describe('gitRemoteSlugFor', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-remote-slug-test-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('parses owner/repo from an ordinary (non-submodule) repo\'s .git/config', () => {
    mkdirp(path.join(dir, '.git'))
    fs.writeFileSync(
      path.join(dir, '.git', 'config'),
      '[remote "origin"]\n\turl = git@github.com:jlumbroso/vscode-adrs-for-ai.git\n',
    )
    expect(gitRemoteSlugFor(dir)).toEqual({ owner: 'jlumbroso', repo: 'vscode-adrs-for-ai' })
  })

  it('follows a submodule\'s .git gitlink file to the real gitdir and reads ITS config — the exact case computeNamespace misses', () => {
    const gitdir = path.join(dir, '.git-modules-ios-client')
    mkdirp(gitdir)
    fs.writeFileSync(path.join(gitdir, 'config'), '[remote "origin"]\n\turl = https://github.com/jlumbroso/ios-client.git\n')
    const submodule = path.join(dir, 'ios-client')
    mkdirp(submodule)
    fs.writeFileSync(path.join(submodule, '.git'), `gitdir: ${path.relative(submodule, gitdir)}\n`)
    expect(gitRemoteSlugFor(submodule)).toEqual({ owner: 'jlumbroso', repo: 'ios-client' })
  })

  it('returns undefined when there is no .git at all (a local-only, non-git directory)', () => {
    expect(gitRemoteSlugFor(dir)).toBeUndefined()
  })

  it('returns undefined when .git exists but has no origin remote configured', () => {
    mkdirp(path.join(dir, '.git'))
    fs.writeFileSync(path.join(dir, '.git', 'config'), '[core]\n\tbare = false\n')
    expect(gitRemoteSlugFor(dir)).toBeUndefined()
  })

  it('a submodule gitlink pointing at a nonexistent gitdir degrades to undefined, not a throw', () => {
    const submodule = path.join(dir, 'broken-submodule')
    mkdirp(submodule)
    fs.writeFileSync(path.join(submodule, '.git'), 'gitdir: ../.git/modules/nonexistent\n')
    expect(() => gitRemoteSlugFor(submodule)).not.toThrow()
    expect(gitRemoteSlugFor(submodule)).toBeUndefined()
  })
})
