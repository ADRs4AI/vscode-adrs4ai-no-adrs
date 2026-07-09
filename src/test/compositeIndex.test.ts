/**
 * CompositeIndex tests — ADR-0025
 *
 * Real temp directories (project convention). Covers the N=1 trivial
 * pass-through (single-root behavior must be unchanged from a bare
 * AdrIndex/SeedIndex), the two-level HQ validating case, and Decision 2's
 * root-local-first / error-on-ambiguity resolution policy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { CompositeIndex, isAmbiguousResolution } from '../index/compositeIndex'
import { AdrIndex } from '../index/adrIndex'
import { SeedIndex } from '../index/seedIndex'

function mkdirp(p: string): void {
  fs.mkdirSync(p, { recursive: true })
}

function writeAdr(adrDir: string, filename: string, number: number, title: string): void {
  mkdirp(adrDir)
  fs.writeFileSync(path.join(adrDir, filename), `# ADR-${String(number).padStart(4, '0')}: ${title}\n\n- **Status**: Draft\n`)
}

describe('CompositeIndex.fromWorkspace', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composite-index-test-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('N=1 case: a single-root workspace behaves exactly like a bare AdrIndex — same ADRs, no children', async () => {
    const adrDir = path.join(dir, 'docs', 'adr')
    writeAdr(adrDir, '0001-storage.md', 1, 'Storage Backend')
    writeAdr(adrDir, '0002-testing.md', 2, 'Testing Strategy')

    const composite = await CompositeIndex.fromWorkspace(dir, { adrDirRel: 'docs/adr' })
    expect(composite.root.children).toHaveLength(0)

    const direct = new AdrIndex()
    await direct.indexDirectory(adrDir)

    expect(composite.allAdrs().map(a => a.number).sort()).toEqual(direct.allAdrs().map(a => a.number).sort())
  })

  it('HQ validating case: allAdrs() aggregates across both the parent root and its nested root', async () => {
    writeAdr(path.join(dir, 'docs', 'adr'), '0001-hq-decision.md', 1, 'HQ Decision')
    const nestedRoot = path.join(dir, 'subprojects', 'vscode-adrs-for-ai')
    writeAdr(path.join(nestedRoot, 'docs', 'adr'), '0001-nested-decision.md', 1, 'Nested Decision')

    const composite = await CompositeIndex.fromWorkspace(dir, { adrDirRel: 'docs/adr' })
    expect(composite.root.children).toHaveLength(1)
    expect(composite.allAdrs()).toHaveLength(2)

    const found = composite.findRoot(path.join(nestedRoot, 'docs', 'adr', '0001-nested-decision.md'))
    expect(found?.path).toBe(nestedRoot)
  })

  it('namespaces() lists every root in the tree, parent first', async () => {
    mkdirp(path.join(dir, '.git'))
    fs.writeFileSync(path.join(dir, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:acme/hq.git\n')
    writeAdr(path.join(dir, 'docs', 'adr'), '0001-a.md', 1, 'A')
    const nested = path.join(dir, 'sub', 'proj')
    mkdirp(path.join(nested, '.git'))
    fs.writeFileSync(path.join(nested, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:acme/proj.git\n')
    writeAdr(path.join(nested, 'docs', 'adr'), '0001-b.md', 1, 'B')

    const composite = await CompositeIndex.fromWorkspace(dir, { adrDirRel: 'docs/adr' })
    expect(composite.namespaces()).toEqual(['acme-hq', 'acme-proj'])
  })

  it('resolve(): root-local first — the same ADR number in two roots resolves to the caller\'s own root when ctx.currentRoot is given', async () => {
    writeAdr(path.join(dir, 'docs', 'adr'), '0001-parent.md', 1, 'Parent Decision')
    const nestedRoot = path.join(dir, 'nested')
    writeAdr(path.join(nestedRoot, 'docs', 'adr'), '0001-child.md', 1, 'Child Decision')

    const composite = await CompositeIndex.fromWorkspace(dir, { adrDirRel: 'docs/adr' })
    const childNode = composite.root.children[0]

    const resolved = composite.resolve('0001', { currentRoot: childNode })
    expect(resolved && !isAmbiguousResolution(resolved) ? resolved.title : null).toBe('ADR-0001: Child Decision')
  })

  it('resolve(): errors with structured candidates when the number is ambiguous and there is no root context', async () => {
    writeAdr(path.join(dir, 'docs', 'adr'), '0001-parent.md', 1, 'Parent Decision')
    writeAdr(path.join(dir, 'nested', 'docs', 'adr'), '0001-child.md', 1, 'Child Decision')

    const composite = await CompositeIndex.fromWorkspace(dir, { adrDirRel: 'docs/adr' })
    const resolved = composite.resolve('0001')

    expect(isAmbiguousResolution(resolved)).toBe(true)
    if (isAmbiguousResolution(resolved)) {
      expect(resolved.candidates).toHaveLength(2)
    }
  })

  it('resolve(): @namespace/NNNN resolves directly to the root with that namespace, bypassing ambiguity', async () => {
    mkdirp(path.join(dir, '.git'))
    fs.writeFileSync(path.join(dir, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:acme/hq.git\n')
    writeAdr(path.join(dir, 'docs', 'adr'), '0001-parent.md', 1, 'Parent Decision')
    const nested = path.join(dir, 'nested')
    mkdirp(path.join(nested, '.git'))
    fs.writeFileSync(path.join(nested, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:acme/child.git\n')
    writeAdr(path.join(nested, 'docs', 'adr'), '0001-child.md', 1, 'Child Decision')

    const composite = await CompositeIndex.fromWorkspace(dir, { adrDirRel: 'docs/adr' })
    const resolved = composite.resolve('@acme-child/1')
    expect(resolved && !isAmbiguousResolution(resolved) ? resolved.title : null).toBe('ADR-0001: Child Decision')
  })
})

describe('CompositeIndex.wrapSingle', () => {
  it('wraps an already-populated AdrIndex/SeedIndex pair with zero scanning', () => {
    const adrs = new AdrIndex()
    const seeds = new SeedIndex()
    const composite = CompositeIndex.wrapSingle('/fake/path', adrs, seeds)
    expect(composite.root.children).toHaveLength(0)
    expect(composite.allAdrs()).toEqual([])
    expect(composite.allSeeds()).toEqual([])
  })
})
