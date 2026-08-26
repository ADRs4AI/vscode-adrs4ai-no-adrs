/**
 * Structural tests for the context-menu symmetry pass (Jérémie's seed,
 * 2026-08-06, docs/adr/seed-2026-08-06-feedback-on-treeview-context-
 * menus.md, dispatched by Lapidary): copy path / copy relative path /
 * copy deep link, symmetric across ADRs, seeds, and tours (today's
 * asymmetry — ADRs had deep-link, seeds didn't, tours had nothing — is the
 * named bug). vscode-touching glue, no live Extension Development Host
 * here — verified by source-shape assertions, same discipline as
 * commitRepoFirstWiring.test.ts. The actual ref-building logic
 * (buildLocalAdrRef/buildLocalSeedRef/seedSlugFromPath) has its own
 * behavioral tests in deeplinkProtocol.test.ts; this file only pins that
 * extension.ts's glue calls them correctly.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')
const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')

describe('extension.ts: copyDeepLink no longer produces adr:0000 for seed-sourced questions', () => {
  const fn = EXT_SRC.match(/function copyDeepLink\([\s\S]*?\n\}/)![0]

  it('branches on question.sourceKind, not just adrNumber', () => {
    expect(fn).toContain("item.question.sourceKind === 'seed'")
  })

  it('the seed branch builds a seed: ref via the shared, grammar-tested builders', () => {
    expect(fn).toContain('buildLocalSeedRef(seedSlugFromPath(item.question.adrPath), item.question.slug)')
  })

  it('the adr branch still uses buildLocalAdrRef with the question\'s own adrNumber + slug', () => {
    expect(fn).toContain('buildLocalAdrRef({ number: item.question.adrNumber, anchor: item.question.slug })')
  })

  it('a whole-seed tree item (not just a seed-sourced question) also gets a deep link now', () => {
    expect(fn).toContain("item.kind === 'seed' && item.seed")
    expect(fn).toContain('buildLocalSeedRef(seedSlugFromPath(item.seed.path))')
  })

  it('the old hand-rolled adr:NNNN string templates are gone — everything routes through the shared builders', () => {
    expect(fn).not.toMatch(/`adr:\$\{String\(/)
  })
})

// ADR-0025 Decision 7 (context-aware deep-link copy format): a bare
// adr:NNNN copied from a multi-root workspace resolves against whichever
// root the paste lands in, not necessarily the root it was copied from.
// The actual xproject-alias builder has its own behavioral tests in
// deeplinkProtocol.test.ts; this file only pins that copyDeepLink's glue
// branches on owningRootNamespace correctly for every item kind.
describe('extension.ts: copyDeepLink is multi-root aware (ADR-0025 Decision 7)', () => {
  const fn = EXT_SRC.match(/function copyDeepLink\([\s\S]*?\n\}/)![0]

  it('isMultiRootWorkspace / owningRootNamespace fold to undefined in the N=1 case — composability, same as Decision 6', () => {
    const helperFn = EXT_SRC.match(/function isMultiRootWorkspace\(\): boolean \{[\s\S]*?\n\}/)![0]
    expect(helperFn).toContain('compositeIndex.walk()).length : 1) > 1')
    const nsFn = EXT_SRC.match(/function owningRootNamespace\(filePath: string\): string \| undefined \{[\s\S]*?\n\}/)![0]
    expect(nsFn).toContain('if (!isMultiRootWorkspace()) return undefined')
  })

  it('an ADR item uses the xproject-alias form when multi-root, the bare local form otherwise', () => {
    expect(fn).toContain('buildXProjectAdrRef({ namespace, number: item.adr.number })')
    expect(fn).toContain('buildLocalAdrRef({ number: item.adr.number })')
  })

  it('an ADR-sourced question uses the xproject-alias form with its anchor when multi-root', () => {
    expect(fn).toContain('buildXProjectAdrRef({ namespace, number: item.question.adrNumber, anchor: item.question.slug })')
  })

  it('a seed (whole item or seed-sourced question) has no xproject alias available — falls to the canonical project-scope form when multi-root, never an invented alias syntax', () => {
    expect(fn).toContain("buildCanonicalRef({ scope: 'project', namespace, artifact: 'seed', seedSlug: seedSlugFromPath(item.seed.path) })")
    expect(fn).toContain("buildCanonicalRef({ scope: 'project', namespace, artifact: 'seed', seedSlug: seedSlugFromPath(item.question.adrPath), anchor: item.question.slug })")
  })
})

// Facet's brief (2026-08-26, docs/inbox/2026-08-26-facet-to-fitter-
// copydeeplink-never-reaches-repo-scope-plus-terminal-link-provider-
// ask.md — a live founder bug report): copyDeepLink never once reached
// ADR-0008's tier-3 repo-scoped canonical form. Fixed by checking
// root.gitRemoteSlug FIRST, ahead of the namespace-alias tier, and
// applying it even in the N=1 case (unlike the namespace tier, a
// repo-scope ref identifies the source repo regardless of which
// workspace it's read from). The gitRemoteSlug field itself (submodule-
// aware git-remote resolution) has its own behavioral tests in
// rootNode.test.ts; this file only pins that copyDeepLink's glue
// prioritizes it correctly for every item kind.
describe('extension.ts: copyDeepLink reaches repo-scope when a git remote resolves (Facet\'s brief, 2026-08-26)', () => {
  const fn = EXT_SRC.match(/function copyDeepLink\([\s\S]*?\n\}/)![0]

  it('owningRootGitSlug reads the already-computed RootNode field — no new git-parsing logic', () => {
    const helperFn = EXT_SRC.match(/function owningRootGitSlug\(filePath: string\)[\s\S]*?\n\}/)![0]
    expect(helperFn).toContain('compositeIndex?.findRoot(filePath)?.gitRemoteSlug')
  })

  it('an ADR item prefers the repo-scope canonical form over the xproject-alias/bare-local tiers', () => {
    expect(fn).toContain("gitSlug\n      ? buildCanonicalRef({ scope: 'repo', owner: gitSlug.owner, repo: gitSlug.repo, artifact: 'adr', number: item.adr.number })")
  })

  it('an ADR-sourced question carries its anchor through to the repo-scope form too', () => {
    expect(fn).toContain("buildCanonicalRef({ scope: 'repo', owner: gitSlug.owner, repo: gitSlug.repo, artifact: 'adr', number: item.question.adrNumber, anchor: item.question.slug })")
  })

  it('a seed (whole item or seed-sourced question) reaches repo-scope too, not just the project-scope canonical form', () => {
    expect(fn).toContain("buildCanonicalRef({ scope: 'repo', owner: gitSlug.owner, repo: gitSlug.repo, artifact: 'seed', seedSlug: seedSlugFromPath(item.seed.path) })")
    expect(fn).toContain("buildCanonicalRef({ scope: 'repo', owner: gitSlug.owner, repo: gitSlug.repo, artifact: 'seed', seedSlug: seedSlugFromPath(item.question.adrPath), anchor: item.question.slug })")
  })

  it('gitSlug is computed unconditionally (not gated behind isMultiRootWorkspace) — applies even in N=1, unlike the namespace tier', () => {
    expect(fn).toMatch(/const gitSlug = owningRootGitSlug\([^)]+\);\s*const namespace = owningRootNamespace/)
  })
})

describe('extension.ts: copyItemPath / copyItemRelativePath — new commands for menu symmetry', () => {
  it('copyItemPath copies resourceUri.fsPath verbatim', () => {
    const fn = EXT_SRC.match(/function copyItemPath\([\s\S]*?\n\}/)![0]
    expect(fn).toContain('item.resourceUri?.fsPath')
    expect(fn).toContain('vscode.env.clipboard.writeText(fsPath)')
  })

  it('copyItemRelativePath uses the same relativeRootPath helper roots.json exclusion already uses', () => {
    const fn = EXT_SRC.match(/function copyItemRelativePath\([\s\S]*?\n\}/)![0]
    expect(fn).toContain('relativeRootPath(fsPath, workspaceRoot)')
  })

  it('both commands are registered', () => {
    expect(EXT_SRC).toContain("vscode.commands.registerCommand('adrManager.copyPath'")
    expect(EXT_SRC).toContain("vscode.commands.registerCommand('adrManager.copyRelativePath'")
  })
})

describe('package.json: menu symmetry — copy path/relative-path/deep-link, ADR/seed/tour', () => {
  // Menu entries (not the plain `commands[]` declaration, which shares the
  // same command-id string) always co-occur with "when" — anchor on that
  // to find the view/item/context object specifically.
  function menuEntryFor(command: string): string {
    const re = new RegExp(`\\{\\s*"command": "${command.replace(/\./g, '\\.')}",\\s*"when":[^}]*\\}`)
    const match = PKG.match(re)
    expect(match, `${command} missing a view/item/context menu entry`).toBeTruthy()
    return match![0]
  }

  for (const command of ['adrManager.copyPath', 'adrManager.copyRelativePath']) {
    it(`${command} exists and appears for adr, seed, AND tour (today's asymmetry fixed)`, () => {
      const menuEntry = menuEntryFor(command)
      expect(menuEntry).toContain('viewItem == adr')
      expect(menuEntry).toContain('viewItem == seed')
      expect(menuEntry).toContain('viewItem == tour')
    })
  }

  it('adrManager.copyDeepLink appears for adr, question, AND seed — tour deliberately excluded (no ratified tour: grammar yet)', () => {
    const menuEntry = menuEntryFor('adrManager.copyDeepLink')
    expect(menuEntry).toContain('viewItem == adr')
    expect(menuEntry).toContain('viewItem == question')
    expect(menuEntry).toContain('viewItem == seed')
    expect(menuEntry).not.toContain('viewItem == tour')
  })

  it('the copy commands share one menu group, separate from item-specific actions (the doctrine\'s separator)', () => {
    for (const command of ['adrManager.copyPath', 'adrManager.copyRelativePath', 'adrManager.copyDeepLink']) {
      expect(menuEntryFor(command), `${command} should be in the 3_copy group`).toContain('"group": "3_copy@')
    }
  })
})
