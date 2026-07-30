/**
 * Structural tests for the granular `adrManager.logging.<sublog>` settings
 * (Lapidary's 2026-07-30 addendum to the report-button seed: "logging.
 * <sublog> settings, individually toggleable, because logging costs
 * speed" — replacing the single shared `adrManager.logErrors` switch with
 * one key per ledger writer). Ship-flip discipline: all three default
 * true now (collection era), all flip to false before the first public
 * release — see docs/RELEASE-CHECKLIST.md.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const PANEL_SRC = readFileSync(resolve(__dirname, '../webview/openQuestionsPanel.ts'), 'utf8')
const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')
const RELEASE_CHECKLIST = readFileSync(resolve(__dirname, '../../docs/RELEASE-CHECKLIST.md'), 'utf8')

describe('Each ledger writer gates on its own sublog key, not a shared switch', () => {
  it('the old shared adrManager.logErrors key is gone from the source', () => {
    expect(PANEL_SRC).not.toContain("'logErrors'")
  })

  it('harvestError (panel v1 errors) gates on logging.panelErrors', () => {
    const method = PANEL_SRC.match(/private harvestError\([\s\S]*?\n  \}/)![0]
    expect(method).toContain("get<boolean>('logging.panelErrors', true)")
  })

  it('logTourUnresolvedIfNeeded gates on logging.tourUnresolvedRefs', () => {
    const method = PANEL_SRC.match(/private logTourUnresolvedIfNeeded\([\s\S]*?\n  \}/)![0]
    expect(method).toContain("get<boolean>('logging.tourUnresolvedRefs', true)")
  })

  it('reportObservation gates on logging.observations, checked BEFORE the input box prompts', () => {
    const method = PANEL_SRC.match(/private async reportObservation\([\s\S]*?\n  \}/)![0]
    const gateIdx = method.indexOf("get<boolean>('logging.observations', true)")
    const promptIdx = method.indexOf('showInputBox')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(promptIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeLessThan(promptIdx)
  })
})

describe('package.json declares all three sublog settings, default true, old key removed', () => {
  it('adrManager.logErrors is no longer declared', () => {
    expect(PKG).not.toContain('"adrManager.logErrors"')
  })

  for (const key of ['adrManager.logging.panelErrors', 'adrManager.logging.tourUnresolvedRefs', 'adrManager.logging.observations']) {
    it(`${key} exists, default true`, () => {
      const match = PKG.match(new RegExp(`"${key.replace(/\./g, '\\.')}":\\s*\\{[^}]*\\}`))
      expect(match, `${key} missing from package.json`).toBeTruthy()
      expect(match![0]).toContain('"default": true')
    })
  }
})

describe('RELEASE-CHECKLIST.md carries the ship-flip item', () => {
  it('names flipping the logging.* defaults before the first public release', () => {
    expect(RELEASE_CHECKLIST.toLowerCase()).toContain('ship-flip')
    expect(RELEASE_CHECKLIST).toContain('adrManager.logging')
  })
})
