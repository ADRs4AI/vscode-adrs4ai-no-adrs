/**
 * Structural tests (vscode-import wall — adrTreeProvider.ts imports vscode
 * at module scope, same discipline as treeItemIdentity.test.ts) for the
 * root-caption-mode wiring (Gleaner's brief, 2026-08-14, item A). The
 * actual caption decision logic is pure and has real behavioral tests in
 * rootCaption.test.ts; this file only pins that the provider actually
 * calls it and threads the result through.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const TREE_SRC = readFileSync(resolve(__dirname, '../views/adrTreeProvider.ts'), 'utf8')
const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')

describe('adrTreeProvider.ts: getRootItems computes captions for the whole discovered-roots list at once', () => {
  const fn = TREE_SRC.match(/private getRootItems\(\): AdrTreeItem\[\] \{[\s\S]*?\n  \}/)![0]

  it('reads adrManager.roots.captionMode, defaulting to git-auto', () => {
    expect(fn).toContain("get<RootCaptionMode>('roots.captionMode', 'git-auto')")
  })

  it('computes captions for ALL nodes in one call — git-auto\'s majority-owner disambiguation needs the whole list, not one node at a time', () => {
    expect(fn).toContain('computeRootCaptions(nodes, captionMode)')
  })

  it('threads the per-index caption into each constructed root item', () => {
    expect(fn).toContain('rootCaption: captions[i]')
  })
})

describe('adrTreeProvider.ts: makeLabel uses the resolved caption, falls back to namespace', () => {
  it('root label prefers rootCaption, falls back to rootNode.namespace when absent (e.g. getParent\'s identity-only reconstruction)', () => {
    const fn = TREE_SRC.match(/private static makeLabel\(opts: AdrTreeItemOpts\): string \{[\s\S]*?\n  \}/)![0]
    expect(fn).toContain('opts.rootCaption ?? opts.rootNode.namespace')
  })
})

describe('package.json: adrManager.roots.captionMode', () => {
  it('declares the three modes with git-auto as the default', () => {
    const match = PKG.match(/"adrManager\.roots\.captionMode":\s*\{[\s\S]*?\n\s*\}/)
    expect(match, 'setting declaration missing').toBeTruthy()
    const decl = match![0]
    expect(decl).toContain('"git-slugs"')
    expect(decl).toContain('"git-repo-names"')
    expect(decl).toContain('"git-auto"')
    expect(decl).toContain('"default": "git-auto"')
  })
})
