/**
 * Structural tests for commitAdrChanges' repo-first rewrite (Lapidary's
 * 2026-07-31 dispatch — live repro at HQ, a genuine multi-FOLDER VS Code
 * workspace). vscode-touching glue, no live Extension Development Host
 * here — verified by source-shape assertions, same discipline as
 * tourDiagnosticsWiring.test.ts. The actual grouping logic has its own
 * behavioral tests in repositoryResolution.test.ts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')

describe('extension.ts: commitAdrChanges resolves repo-first, not root-first', () => {
  const fn = EXT_SRC.match(/async function commitAdrChanges\([\s\S]*?\n\}/)![0]

  it('starts from api.repositories, not compositeIndex.walk()', () => {
    expect(fn).toContain('groupChangesByOwningRoot<any, any>(api.repositories, adrDirRel')
    expect(fn).not.toMatch(/for \(const node of compositeIndex\.walk\(\)\)/)
  })

  it('resolves the owning root from each changed file\'s path via compositeIndex.findRoot, never getRepository(root.path)', () => {
    expect(fn).toContain('fp => compositeIndex!.findRoot(fp)')
    expect(fn).not.toContain('resolveWorkspaceRepository')
  })

  it('untrackedCandidates is still computed per group, excluding the group\'s own primary changes', () => {
    expect(fn).toContain('!g.changes.includes(c)')
  })
})
