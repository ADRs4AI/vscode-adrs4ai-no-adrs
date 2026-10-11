/**
 * Structural wiring test — `commitAnswerOnSubmit`'s own logic is pure
 * enough to get real behavioral coverage (answerCommit.test.ts); this
 * file only pins the one thing that logic alone can't prove: that
 * writeAnswer actually CALLS it, after a successful save and before
 * telling the webview the answer landed. Same vscode-touching-glue
 * discipline as writeAnswerOverlapFix.test.ts/adr0036.test.ts — writeAnswer
 * isn't independently invocable outside a real extension host.
 *
 * Context: Concertmaster 5's forensics brief (companion etude,
 * 2026-10-11) — a submitted answer was clobbered by a crew git operation
 * before anyone committed it. `commitAnswerOnSubmit` is the founder-
 * commissioned protection; this test exists so a future refactor of
 * writeAnswer can't silently drop the call and have nothing notice.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const PANEL_SRC = readFileSync(resolve(__dirname, '../webview/openQuestionsPanel.ts'), 'utf8')
const PANEL_LINES = PANEL_SRC.split('\n')
const writeAnswerStart = PANEL_LINES.findIndex(l => l.trim().startsWith('private async writeAnswer('))
const commitMethodStart = PANEL_LINES.findIndex(l => l.trim().startsWith('private async commitAnswerOnSubmit('))

describe('openQuestionsPanel.ts: writeAnswer calls commitAnswerOnSubmit after a successful save', () => {
  it('sanity: found both anchors in the real source', () => {
    expect(writeAnswerStart).toBeGreaterThan(-1)
    expect(commitMethodStart).toBeGreaterThan(writeAnswerStart)
  })

  const retrySaveStart = PANEL_LINES.findIndex(l => l.trim().startsWith('private async retrySave('))
  const writeAnswerBody = PANEL_LINES.slice(writeAnswerStart, retrySaveStart).join('\n')

  it('writeAnswer\'s body calls this.commitAnswerOnSubmit(...)', () => {
    expect(writeAnswerBody).toMatch(/this\.commitAnswerOnSubmit\(/)
  })

  it('the call happens AFTER the `if (!saved)` early-return, not before — a failed save has nothing worth committing', () => {
    const savedGuardIdx = writeAnswerBody.indexOf('if (!saved)')
    const commitCallIdx = writeAnswerBody.indexOf('this.commitAnswerOnSubmit(')
    expect(savedGuardIdx).toBeGreaterThan(-1)
    expect(commitCallIdx).toBeGreaterThan(savedGuardIdx)
  })

  it('the call happens BEFORE the final "answered" postMessage — the commit is part of what "answered" means now, not an afterthought that could race it', () => {
    const commitCallIdx = writeAnswerBody.indexOf('this.commitAnswerOnSubmit(')
    const finalPostMessageIdx = writeAnswerBody.lastIndexOf("type: 'answered'")
    expect(commitCallIdx).toBeGreaterThan(-1)
    expect(finalPostMessageIdx).toBeGreaterThan(commitCallIdx)
  })
})

describe('commitAnswerOnSubmit: gated on the opt-in setting, never on by default', () => {
  const nextMethodStart = PANEL_LINES.findIndex((l, i) => i > commitMethodStart && /^\s*(private|public|static)\s/.test(l) && l.trim().startsWith('private async retrySave('))
  const body = PANEL_LINES.slice(commitMethodStart, nextMethodStart).join('\n')

  it('sanity: sliced a non-empty body', () => {
    expect(nextMethodStart).toBeGreaterThan(commitMethodStart)
    expect(body.length).toBeGreaterThan(0)
  })

  it('reads adrManager.commitOnAnswerSubmit with a false default — opt-in, matching the package.json contribution', () => {
    expect(body).toMatch(/getConfiguration\('adrManager'\)\.get<boolean>\('commitOnAnswerSubmit',\s*false\)/)
  })

  it('a thrown error is caught into harvestError, never left to propagate and fail the answer that already succeeded', () => {
    expect(body).toMatch(/catch \(err\)/)
    expect(body).toMatch(/this\.harvestError\('answer-commit-failed'/)
  })

  it('a detached-HEAD commit (Concertmaster 5\'s amendment, 2026-10-11) is surfaced with a warning, not silently accepted', () => {
    expect(body).toMatch(/result\.detachedHead/)
    expect(body).toMatch(/showWarningMessage/)
  })
})

describe('package.json: adrManager.commitOnAnswerSubmit is declared, boolean, default false', () => {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'))
  const setting = pkg.contributes.configuration.properties['adrManager.commitOnAnswerSubmit']

  it('exists with the expected type and default', () => {
    expect(setting).toBeDefined()
    expect(setting.type).toBe('boolean')
    expect(setting.default).toBe(false)
  })
})
