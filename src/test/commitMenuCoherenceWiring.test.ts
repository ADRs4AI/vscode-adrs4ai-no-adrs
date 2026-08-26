/**
 * Structural tests (vscode-import wall — extension.ts imports vscode at
 * module scope, same discipline as commitRepoFirstWiring.test.ts) for
 * "Commit" menu coherence (Jérémie, 2026-08-25 live ask): the action
 * should appear on every tree node it can meaningfully apply to — root,
 * the ADR/Seed category headers, and individual ADR/seed items — never
 * on questions. Root resolution only, covered here; WHICH FILES within
 * that root actually get committed is a separate concern — see
 * commitScopeFilterWiring.test.ts (Jérémie's 2026-08-26 correction: the
 * original "every invocation commits the whole root" design was wrong).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')
const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')

describe('extension.ts: adrManager.commitAdrs resolves the owning root for every item kind', () => {
  const fn = EXT_SRC.match(/registerCommand\('adrManager\.commitAdrs'[\s\S]*?\}\),/)![0]

  it('root/category-header items use item.rootNode.path directly (unchanged)', () => {
    expect(fn).toContain('item?.rootNode?.path')
  })

  it('an individual adr item resolves its owning root via compositeIndex.findRoot on its own path', () => {
    expect(fn).toContain("item?.kind === 'adr' && item.adr ? compositeIndex?.findRoot(item.adr.path)?.path")
  })

  it('an individual seed item resolves its owning root the same way', () => {
    expect(fn).toContain("item?.kind === 'seed' && item.seed ? compositeIndex?.findRoot(item.seed.path)?.path")
  })
})

describe('package.json: Commit appears on root, adr-group, seed-group, adr, and seed — never on question', () => {
  it('every non-question kind that can own changes has a Commit entry', () => {
    const entries = [...PKG.matchAll(/\{\s*"command": "adrManager\.commitAdrs",\s*"when": "view == adrExplorer(?: && viewItem == ([a-z-]+))?"/g)]
    const viewItems = entries.map(m => m[1]).filter(Boolean)
    expect(viewItems).toContain('root')
    expect(viewItems).toContain('adr')
    expect(viewItems).toContain('seed')
    expect(viewItems).toContain('adr-group')
    expect(viewItems).toContain('seed-group')
  })

  it('question never gets a Commit entry — not a container of its own changes', () => {
    const questionScoped = PKG.match(/\{\s*"command": "adrManager\.commitAdrs",\s*"when": "view == adrExplorer && viewItem == question"/)
    expect(questionScoped).toBeNull()
  })
})
