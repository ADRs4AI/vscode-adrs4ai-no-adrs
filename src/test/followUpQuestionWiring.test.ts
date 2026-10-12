/**
 * Structural tests (vscode-import wall — openQuestionsPanel.ts imports
 * vscode at module scope, same discipline as every other *Wiring.test.ts
 * in this suite) for "this answer opens a follow-up question" (Riddle's
 * brief, 2026-10-12; Docent's review). The mint/collision logic and the
 * marker-recognition predicate have real behavioral tests in
 * followUpQuestion.test.ts; this file only pins that the host wires that
 * logic in correctly — refuse-BEFORE-build, the forward-only ref
 * direction, and the webview affordance actually posting the field.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const PANEL_SRC = readFileSync(resolve(__dirname, '../webview/openQuestionsPanel.ts'), 'utf8')

describe('openQuestionsPanel.ts: writeAnswer — follow-up mint is refuse-or-succeed, validated before the edit exists', () => {
  const fn = PANEL_SRC.match(/private async writeAnswer\(msg: \{[\s\S]*?\n  \}\): Promise<void> \{[\s\S]*?\n  \}\n/)![0]

  it('accepts an optional mintFollowUp field on the message, distinct from targetStatus:\'unresolved\'', () => {
    expect(fn).toContain('mintFollowUp?: { title: string }')
  })

  it('validates and mints BEFORE `const edit = new vscode.WorkspaceEdit()` — a refusal never gets as far as building an edit', () => {
    const mintIdx = fn.indexOf('mintFollowUpQuestionBlock(')
    const editIdx = fn.indexOf('const edit = new vscode.WorkspaceEdit()')
    expect(mintIdx).toBeGreaterThan(0)
    expect(editIdx).toBeGreaterThan(0)
    expect(mintIdx).toBeLessThan(editIdx)
  })

  it('a refused mint posts the error and returns — the answer itself never gets written either', () => {
    const mintBlock = fn.match(/if \(msg\.mintFollowUp\) \{[\s\S]*?\n      \}/)![0]
    expect(mintBlock).toContain('if (!mintResult.ok)')
    expect(mintBlock).toContain("this.panel.webview.postMessage({ type: 'error', message: mintResult.error })")
    expect(mintBlock).toContain('return')
  })

  it('collision checking reuses collectExistingHandleSlugs against the freshly re-parsed questions, not a stale snapshot', () => {
    expect(fn).toContain('collectExistingHandleSlugs(freshQuestions)')
  })
})

describe('openQuestionsPanel.ts: the marker is a FORWARD pointer, never folded into the ANS slot', () => {
  const fn = PANEL_SRC.match(/private async writeAnswer\(msg: \{[\s\S]*?\n  \}\): Promise<void> \{[\s\S]*?\n  \}\n/)![0]

  it('the marker line is built via buildFollowUpMarkerLine, appended OUTSIDE the answer text, not concatenated into it directly', () => {
    expect(fn).toContain('buildFollowUpMarkerLine(')
    expect(fn).toContain('const followUpSuffix = followUp')
  })

  it('all three answer-writing branches (fill placeholder, replace existing, append fresh ANS) append followUpSuffix', () => {
    expect(fn).toContain('lineRange(doc, fillLineIdx), msg.answerText + followUpSuffix)')
    expect(fn).toContain('`**ANS:** (by ${author})\\n${msg.answerText}` + followUpSuffix')
    expect(fn).toContain('`\\n**ANS:** (by ${author})\\n${msg.answerText}${followUpSuffix}\\n`')
  })

  it('the ref built for the marker uses the LOCAL (same-file) builders, not a repo/namespace-qualified form — both live in the same file by construction', () => {
    expect(fn).toContain('buildLocalSeedRef(seedSlugFromPath(msg.adrPath), followUp.slug)')
    expect(fn).toContain('buildLocalAdrRef({ number: freshAdrNumber!, anchor: followUp.slug })')
  })

  it('the minted block itself is inserted ONCE, unconditionally, independent of which of the three branches fired', () => {
    const insertBlock = fn.match(/if \(followUp\) \{\s*let followUpInsertIdx[\s\S]*?\n      \}/)![0]
    expect(insertBlock).toContain('followUp.blockText')
    expect(insertBlock).toContain('blockEndLineIdx')
  })
})

describe('openQuestionsPanel.ts (webview script): the affordance is a standing, always-rendered door — distinct from "Request Follow-up"', () => {
  it('checkbox + title input both exist, input starts disabled (layout-surgery: no element ever appears/disappears)', () => {
    expect(PANEL_SRC).toContain('<input type="checkbox" id="follow-up-toggle" />')
    expect(PANEL_SRC).toContain('id="follow-up-title" type="text"')
    expect(PANEL_SRC).toMatch(/id="follow-up-title"[^>]*disabled/)
  })

  it('toggling the checkbox only enables/disables the input — never shows/hides it', () => {
    const listener = PANEL_SRC.match(/\$id\('follow-up-toggle'\)\.addEventListener\('change', \(\) => \{[\s\S]*?\n\}\);/)![0]
    expect(listener).toContain("$id('follow-up-title').disabled = !on")
    expect(listener).not.toMatch(/style\.display/)
  })

  it('submit() refuses (does not post) when the box is checked but the title is blank', () => {
    const fn = PANEL_SRC.match(/function submit\(force, targetStatus\) \{[\s\S]*?\n\}/)![0]
    expect(fn).toContain('if (followUpOn && !followUpTitle)')
    const refusalBranch = fn.match(/if \(followUpOn && !followUpTitle\) \{[\s\S]*?\n  \}/)![0]
    expect(refusalBranch).not.toContain('postMessage')
    expect(refusalBranch).toContain('return')
  })

  it('submit() posts mintFollowUp only when the box is checked', () => {
    const fn = PANEL_SRC.match(/function submit\(force, targetStatus\) \{[\s\S]*?\n\}/)![0]
    expect(fn).toContain('mintFollowUp: followUpOn ? { title: followUpTitle } : undefined')
  })

  it('render() resets the toggle/input for a genuinely NEW question — a checked box never leaks onto the next question', () => {
    const fn = PANEL_SRC.match(/\} else if \(isNewQuestion\) \{[\s\S]{0,400}/)![0]
    expect(fn).toContain("$id('follow-up-toggle').checked = false")
    expect(fn).toContain("$id('follow-up-title').disabled = true")
  })
})
