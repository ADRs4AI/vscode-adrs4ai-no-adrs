/**
 * Structural tests (vscode-import wall) for the ADR/Seed category-header
 * filter checkboxes (Facet's go-ahead, 2026-08-16, docs/inbox/2026-08-16-
 * facet-to-fitter-category-header-filters-unblocked-plus-two-stuck-
 * items.md — mechanism (a): toggle commands, `when`-clause-driven, one
 * boolean setting per filter dimension). Built per Jérémie's live "clear
 * your queue" ask, 2026-08-25. Same shape as the already-shipped Tours
 * "hide completed" pair — see hideCompletedToursWiring.test.ts. The
 * actual settled-status classifier is pure and has real behavioral tests
 * in statusInfo.test.ts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const TREE_SRC = readFileSync(resolve(__dirname, '../views/adrTreeProvider.ts'), 'utf8')
const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')
const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')

describe('adrTreeProvider.ts: visibleAdrs() — two independent filter dimensions', () => {
  const fn = TREE_SRC.match(/private visibleAdrs\(node: RootNode\): AdrFile\[\] \{[\s\S]*?\n  \}/)![0]

  it('reads both settings, default false (nothing hidden until asked for)', () => {
    expect(fn).toContain("get<boolean>('adrs.hideSettled', false)")
    expect(fn).toContain("get<boolean>('adrs.hideWithoutOpenQuestions', false)")
  })

  it('uses the pure isSettledAdrStatus classifier, not a re-invented status check', () => {
    expect(fn).toContain('isSettledAdrStatus(adr.status)')
  })

  it('the open-questions filter respects document-pause, same as the collapsibleState fix', () => {
    expect(fn).toContain('isDocumentPausedStatus(adr.status) ? [] : this.filterQuestions(adr.questions)')
  })
})

describe('adrTreeProvider.ts: visibleSeeds() — closed-family filter, aging median unaffected', () => {
  it('getSeedGroupChildren computes the aging median from the FULL seed list, not the filtered one', () => {
    const fn = TREE_SRC.match(/private getSeedGroupChildren\(node: RootNode\): AdrTreeItem\[\] \{[\s\S]*?\n  \}/)![0]
    expect(fn).toContain('const allSeeds = node.seeds.allSeeds()')
    expect(fn).toContain('const seeds = this.visibleSeeds(node)')
    expect(fn).toContain('allSeeds\n      .filter(s => !closedFamilyToken(s.status) && !s.isProcessed)')
  })

  it('visibleSeeds reads seeds.hideClosed, default false', () => {
    const fn = TREE_SRC.match(/private visibleSeeds\(node: RootNode\): SeedFile\[\] \{[\s\S]*?\n  \}/)![0]
    expect(fn).toContain("get<boolean>('seeds.hideClosed', false)")
    expect(fn).toContain('closedFamilyToken(s.status)')
  })
})

describe('adrTreeProvider.ts: header counts match what the filters actually leave visible', () => {
  it('getContainerChildren computes adrCount/seedCount through the same visible*() filters as the children lists', () => {
    const fn = TREE_SRC.match(/private getContainerChildren\(node: RootNode\): AdrTreeItem\[\] \{[\s\S]*?\n  \}/)![0]
    expect(fn).toContain('const adrCount = this.visibleAdrs(node).length')
    expect(fn).toContain('const seedCount = this.visibleSeeds(node).length')
  })
})

describe('extension.ts: six toggle commands, refreshing the tree explicitly after each write', () => {
  const pairs: Array<[string, string, string]> = [
    ['hideSettledAdrs', 'showSettledAdrs', 'adrs.hideSettled'],
    ['hideAdrsWithoutOpenQuestions', 'showAdrsWithoutOpenQuestions', 'adrs.hideWithoutOpenQuestions'],
    ['hideClosedSeeds', 'showClosedSeeds', 'seeds.hideClosed'],
  ]

  for (const [hideCmd, showCmd, setting] of pairs) {
    it(`${hideCmd}/${showCmd} write ${setting} and refresh the tree`, () => {
      const hideBlock = EXT_SRC.match(new RegExp(`registerCommand\\('adrManager\\.${hideCmd}'[\\s\\S]*?\\}\\),`))![0]
      const showBlock = EXT_SRC.match(new RegExp(`registerCommand\\('adrManager\\.${showCmd}'[\\s\\S]*?\\}\\),`))![0]
      expect(hideBlock).toContain(`update('${setting}', true)`)
      expect(hideBlock).toContain('treeProvider?.refresh();')
      expect(showBlock).toContain(`update('${setting}', false)`)
      expect(showBlock).toContain('treeProvider?.refresh();')
    })
  }
})

describe('package.json: filter settings + menu entries', () => {
  it('all three settings default to false', () => {
    for (const key of ['adrManager.adrs.hideSettled', 'adrManager.adrs.hideWithoutOpenQuestions', 'adrManager.seeds.hideClosed']) {
      const match = PKG.match(new RegExp(`"${key.replace(/\./g, '\\.')}":\\s*\\{[\\s\\S]*?\\n\\s*\\}`))
      expect(match, `${key} declaration missing`).toBeTruthy()
      expect(match![0]).toContain('"default": false')
    }
  })

  it('the two ADR filter pairs and one Seed filter pair appear on their category headers with complementary when clauses', () => {
    const cases: Array<[string, string, string, string]> = [
      ['adrManager.hideSettledAdrs', 'adrManager.showSettledAdrs', 'adr-group', 'config.adrManager.adrs.hideSettled'],
      ['adrManager.hideAdrsWithoutOpenQuestions', 'adrManager.showAdrsWithoutOpenQuestions', 'adr-group', 'config.adrManager.adrs.hideWithoutOpenQuestions'],
      ['adrManager.hideClosedSeeds', 'adrManager.showClosedSeeds', 'seed-group', 'config.adrManager.seeds.hideClosed'],
    ]
    for (const [hideCmd, showCmd, viewItem, configKey] of cases) {
      const hideEntry = PKG.match(new RegExp(`\\{\\s*"command": "${hideCmd.replace(/\./g, '\\.')}",\\s*"when": "([^"]+)"`))
      const showEntry = PKG.match(new RegExp(`\\{\\s*"command": "${showCmd.replace(/\./g, '\\.')}",\\s*"when": "([^"]+)"`))
      expect(hideEntry, `${hideCmd} menu entry missing`).toBeTruthy()
      expect(showEntry, `${showCmd} menu entry missing`).toBeTruthy()
      expect(hideEntry![1]).toContain(`viewItem == ${viewItem}`)
      expect(hideEntry![1]).toContain(`!${configKey}`)
      expect(showEntry![1]).toContain(`viewItem == ${viewItem}`)
      expect(showEntry![1]).toContain(configKey)
      expect(showEntry![1]).not.toContain(`!${configKey}`)
    }
  })
})
