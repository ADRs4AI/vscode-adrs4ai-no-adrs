/**
 * Structural tests for the granular `adrManager.logging.<sublog>` settings
 * (Lapidary's 2026-07-30 addendum to the report-button seed: "logging.
 * <sublog> settings, individually toggleable, because logging costs
 * speed" — replacing the single shared `adrManager.logErrors` switch with
 * one key per ledger writer). Ship-flip discipline: all three defaulted
 * true during the collection era; flipped to false 2026-08-21 for the
 * first public release — see docs/RELEASE-CHECKLIST.md.
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
    expect(method).toContain("get<boolean>('logging.panelErrors', false)")
  })

  it('logTourUnresolvedIfNeeded gates on logging.tourUnresolvedRefs', () => {
    const method = PANEL_SRC.match(/private logTourUnresolvedIfNeeded\([\s\S]*?\n  \}/)![0]
    expect(method).toContain("get<boolean>('logging.tourUnresolvedRefs', false)")
  })

  it('reportObservation gates on logging.observations, checked BEFORE the input box prompts', () => {
    const method = PANEL_SRC.match(/private async reportObservation\([\s\S]*?\n  \}/)![0]
    const gateIdx = method.indexOf("get<boolean>('logging.observations', false)")
    const promptIdx = method.indexOf('showInputBox')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(promptIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeLessThan(promptIdx)
  })
})

describe('package.json declares all three sublog settings, default false (post-ship-flip), old key removed', () => {
  it('adrManager.logErrors is no longer declared', () => {
    expect(PKG).not.toContain('"adrManager.logErrors"')
  })

  for (const key of ['adrManager.logging.panelErrors', 'adrManager.logging.tourUnresolvedRefs', 'adrManager.logging.observations']) {
    it(`${key} exists, default false`, () => {
      const match = PKG.match(new RegExp(`"${key.replace(/\./g, '\\.')}":\\s*\\{[^}]*\\}`))
      expect(match, `${key} missing from package.json`).toBeTruthy()
      expect(match![0]).toContain('"default": false')
    })
  }
})

describe('RELEASE-CHECKLIST.md carries the ship-flip item', () => {
  it('names flipping the logging.* defaults before the first public release', () => {
    expect(RELEASE_CHECKLIST.toLowerCase()).toContain('ship-flip')
    expect(RELEASE_CHECKLIST).toContain('adrManager.logging')
  })
})

// Retry-storm dedupe (Riddle's adjudication of Gleaner's first ledger
// sweep, 2026-07-31): the actual dedupe-key logic lives in errorSignature
// (src/drafts/errorLog.ts, unit-tested for real behavior in
// errorLog.test.ts) — these only pin that harvestError() is actually
// WIRED to it, fail-open, per ADR-0035's failure-soft clause.
describe('harvestError: retry-storm dedupe wiring', () => {
  const method = PANEL_SRC.match(/private harvestError\([\s\S]*?\n  \}/)![0]

  it('checks a session-scoped signature set before writing, and records it after', () => {
    expect(method).toContain('errorSignature(kind, msg.adrPath, msg.questionId, message)')
    expect(method).toContain('this.harvestErrorSignaturesLogged.has(signature)')
    expect(method).toContain('this.harvestErrorSignaturesLogged.add(signature)')
  })

  it('the signature computation is itself wrapped so a failure there falls through to logging, not skips it', () => {
    const sigBlock = method.match(/try \{\s*const signature[\s\S]*?\} catch \{[\s\S]*?\}/)
    expect(sigBlock, 'expected the dedupe signature computation in its own inner try/catch').toBeTruthy()
    expect(sigBlock![0]).toContain('fall through and log anyway')
  })
})
