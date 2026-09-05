/**
 * Structural tests (vscode-import wall — extension.ts imports vscode at
 * module scope, same discipline as commitRepoFirstWiring.test.ts) for
 * ADR-0025 Decision 6's extension.ts/package.json wiring. The actual
 * root-resolution and numbering decision logic is pure and has real
 * behavioral tests in creationTarget.test.ts; this file only pins that
 * the command/menu/settings glue is wired correctly.
 *
 * Fixes a real bug Jérémie reported live (2026-08-25): "Create New ADR"
 * asked for a title but never asked which project in a multi-root
 * workspace — createNewAdr() used vscode.workspace.workspaceFolders[0]
 * and the single-root `index` global, predating ADR-0025 entirely (a
 * known, documented gap — see extension.ts's own "Extension state"
 * comment: "Decision 6's per-root creation-target logic is its own
 * follow-up pass, not this one").
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')
const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')

describe('extension.ts: createNewAdr no longer guesses workspaceFolders[0]', () => {
  it('resolveCreationTargetRoot reads compositeIndex, not vscode.workspace.workspaceFolders', () => {
    const fn = EXT_SRC.match(/async function resolveCreationTargetRoot\(\): Promise<RootNode \| undefined> \{[\s\S]*?\n\}/)![0]
    expect(fn).toContain('compositeIndex.walk()')
    expect(fn).toContain('resolveTargetRootPolicy(nodes,')
    expect(fn).not.toContain('workspaceFolders')
  })

  it('createNewAdr itself no longer references workspaceFolders[0] or the stale single-root index', () => {
    const fn = EXT_SRC.match(/async function createNewAdr\([\s\S]*?\n\}/)![0]
    expect(fn).not.toContain('workspaceFolders')
    expect(fn).not.toContain('determineNextNumber')
  })

  it('determineNextNumber (the single-root-only accessor) is fully retired, not just unused', () => {
    expect(EXT_SRC).not.toContain('function determineNextNumber')
  })
})

describe('extension.ts: per-root numbering + exclusive-create collision guard', () => {
  it('nextAdrNumberFor scans the TARGET root\'s own AdrIndex, not the stale single-root global', () => {
    const fn = EXT_SRC.match(/function nextAdrNumberFor\(root: RootNode, adrDirRel: string\): number \{[\s\S]*?\n\}/)![0]
    expect(fn).toContain('root.adrs.allAdrs()')
    expect(fn).toContain('computeNextNumber(seed, existing)')
  })

  it('the ADR file write uses exclusive-create (wx) and retries past a real collision, never silently overwriting', () => {
    const fn = EXT_SRC.match(/async function writeAdrFileExclusive\([\s\S]*?\n\}/)![0]
    expect(fn).toContain("{ flag: 'wx' }")
    expect(fn).toMatch(/code !== 'EEXIST'\) throw err/)
  })

  it('the seed file write also uses exclusive-create, with a suffixed-slug retry (seeds have no numbered slot to bump instead)', () => {
    const fn = EXT_SRC.match(/async function writeSeedFileExclusive\([\s\S]*?\n\}/)![0]
    expect(fn).toContain("{ flag: 'wx' }")
    expect(fn).toMatch(/code !== 'EEXIST'\) throw err/)
  })
})

describe('extension.ts: read-before-write status bar visibility (Decision 6)', () => {
  it('the resolved root is shown BEFORE the title prompt, not just implied by what gets written', () => {
    const fn = EXT_SRC.match(/async function createNewAdr\([\s\S]*?\n\}/)![0]
    const statusIdx = fn.indexOf('setStatusBarMessage')
    const promptIdx = fn.indexOf('showInputBox')
    expect(statusIdx).toBeGreaterThan(-1)
    expect(promptIdx).toBeGreaterThan(-1)
    expect(statusIdx).toBeLessThan(promptIdx)
  })
})

describe('extension.ts: adrManager.createAdr command routes root-click and category-click context', () => {
  const fn = EXT_SRC.match(/registerLoggedCommand\('adrManager\.createAdr'[\s\S]*?\}\),/)![0]

  it('a root right-click passes item.rootNode straight through — no resolution, matching the explicit-override spec', () => {
    expect(fn).toContain("item?.kind === 'root' ? item.rootNode")
  })

  it('adr-group / seed-group right-clicks fall back to compositeIndex.root in the N=1 case (category items carry no rootNode there)', () => {
    expect(fn).toContain("item?.kind === 'adr-group' || item?.kind === 'seed-group' ? (item.rootNode ?? compositeIndex?.root)")
  })

  it('adr-group forces kind adr, seed-group forces kind seed — the kind-picker is skipped for both', () => {
    expect(fn).toContain("item?.kind === 'adr-group' ? 'adr' : item?.kind === 'seed-group' ? 'seed' : undefined")
  })

  it('no item at all (palette/nav button) passes undefined for both — unchanged fallback to full resolution + kind-picker', () => {
    expect(fn).toContain('createNewAdr(adrDir, { targetRoot, forceKind })')
  })
})

describe('package.json: adrManager.newAdrTargetRoot / alwaysPromptOnMultiRoot settings', () => {
  it('newAdrTargetRoot defaults to active-editor', () => {
    const match = PKG.match(/"adrManager\.newAdrTargetRoot":\s*\{[\s\S]*?\n\s*\}/)
    expect(match, 'setting declaration missing').toBeTruthy()
    expect(match![0]).toContain('"default": "active-editor"')
  })

  it('alwaysPromptOnMultiRoot defaults to false', () => {
    const match = PKG.match(/"adrManager\.alwaysPromptOnMultiRoot":\s*\{[\s\S]*?\n\s*\}/)
    expect(match, 'setting declaration missing').toBeTruthy()
    expect(match![0]).toContain('"default": false')
  })
})

describe('package.json: Create New ADR on root, ADR category, and Seed category context menus', () => {
  it('adrManager.createAdr appears on all three, first in its own group', () => {
    const entries = [...PKG.matchAll(/\{\s*"command": "adrManager\.createAdr",\s*"when": "view == adrExplorer && viewItem == ([a-z-]+)",\s*"group": "([^"]+)"/g)]
    const byViewItem = Object.fromEntries(entries.map(m => [m[1], m[2]]))
    expect(byViewItem['root']).toBe('0_create@1')
    expect(byViewItem['adr-group']).toBe('0_create@1')
    expect(byViewItem['seed-group']).toBe('0_create@1')
  })
})
