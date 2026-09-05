/**
 * Structural tests (vscode-import wall — extension.ts imports vscode at
 * module scope, same discipline as commitMenuCoherenceWiring.test.ts) for
 * the Commit scope-filter correction (Jérémie, live, 2026-08-26): "the
 * commit menu item commits multiple things, not just the item or group
 * items below." The menu-coherence pass (v0.7.93) routed every Commit
 * invocation to the item's OWNING ROOT, but committed that root's ENTIRE
 * change set regardless of which specific item/group was clicked — an
 * individual ADR's Commit swept in every other changed file under
 * docs/adr/ too. This narrows the actual staged/committed file set to
 * match the clicked scope. isAdrBasename/isSeedBasename (the type
 * predicates used for the category-header scopes) already have their own
 * behavioral tests in fileGuards.test.ts; this file only pins that
 * extension.ts's glue selects the right predicate for each item kind and
 * actually applies it before committing.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')

describe('extension.ts: adrManager.commitAdrs computes a scopeFilter matching the clicked item', () => {
  const fn = EXT_SRC.match(/registerLoggedCommand\('adrManager\.commitAdrs'[\s\S]*?\}\),/)![0]

  it('an individual adr item scopes to EXACTLY that file — nothing else in the root', () => {
    expect(fn).toContain("item?.kind === 'adr' && item.adr ? (p: string) => p === item.adr!.path")
  })

  it('an individual seed item scopes to EXACTLY that file', () => {
    expect(fn).toContain("item?.kind === 'seed' && item.seed ? (p: string) => p === item.seed!.path")
  })

  it('the ADRs category header scopes to every ADR-shaped file, via the same isAdrBasename predicate the watchers use — never a re-invented check', () => {
    expect(fn).toContain("item?.kind === 'adr-group' ? (p: string) => isAdrBasename(path.basename(p))")
  })

  it('the Seeds category header scopes to every seed-shaped file, via isSeedBasename', () => {
    expect(fn).toContain("item?.kind === 'seed-group' ? (p: string) => isSeedBasename(path.basename(p))")
  })

  it('root (and the tree-wide palette/button, no item at all) gets no scope filter — undefined means "whole root", the one kind where that IS the correct scope', () => {
    expect(fn).toMatch(/: undefined;/)
    expect(fn).toContain('commitAdrChanges(adrDir, targetRootPath, scopeFilter);')
  })
})

describe('extension.ts: commitAdrChanges applies the scope filter before committing, not after', () => {
  const fn = EXT_SRC.match(/async function commitAdrChanges\([\s\S]*?\n\}/)![0]

  it('narrows targeted.changes via the filter, using the SAME dr.changes shape commitOneRoot already reads (no parallel data path)', () => {
    expect(fn).toContain('const scopedChanges = targeted.changes.filter((c: any) => scopeFilter(c.uri.fsPath));')
    expect(fn).toContain('targeted = { ...targeted, changes: scopedChanges };')
  })

  it('an empty scoped result shows its own message and returns — never silently commits nothing, never falls back to the unscoped set', () => {
    expect(fn).toMatch(/if \(scopedChanges\.length === 0\) \{\s*vscode\.window\.showInformationMessage\('ADR Manager: No changes to commit for this item\.'\);\s*return;\s*\}/)
  })

  it('the narrowed DirtyRoot still goes through the ordinary commitOneRoot path — commit message, staging, and untracked-reference scanning all inherit the narrower scope for free', () => {
    const targetedBlock = fn.match(/if \(targetRootPath\) \{[\s\S]*?\n  \}/)![0]
    expect(targetedBlock).toContain('await commitOneRoot(targeted, true);')
  })
})
