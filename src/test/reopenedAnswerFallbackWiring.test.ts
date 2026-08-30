/**
 * Structural test (vscode-import wall — openQuestionsPanel.ts imports
 * vscode at module scope, same discipline as panelLinkSupportHostWiring.
 * test.ts) for Jérémie's founder Report, 2026-08-30 (real specimen:
 * companion-thinking-stream-etude's QST-STATESMAN-MCP): "a ANS: placeholder
 * placed after my own confuses the parser into missing an answer... nothing
 * is displayed in the Open Questions dialog."
 *
 * Root cause (see parser.test.ts's "Question.rounds" describe block for the
 * behavioral confirmation): a bare trailing ANS placeholder round with no
 * new Recommendation between it and a real prior answer reopens the
 * question, per the fold's own documented, intentional rule — `q.answer`
 * (the CURRENT round only) is correctly undefined. But the real answer
 * survives in `q.answers` (plural, full round history), and buildRow's
 * `existingAnswer` field — the one thing the panel actually renders into
 * the answer box — only ever read `q.answer`, so the box showed nothing at
 * all: not blank-because-genuinely-unanswered, blank because the one place
 * that could show the prior answer wasn't looking at the field that has it.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const PANEL_SRC = readFileSync(resolve(__dirname, '../webview/openQuestionsPanel.ts'), 'utf8')

describe('openQuestionsPanel.ts: buildRow\'s existingAnswer falls back to the last real round when the current one is a reopened placeholder', () => {
  const fn = PANEL_SRC.match(/existingAnswer: !q\.isAnswered[^\n]+/)![0]

  it('reads q.answers (plural, round history) when q.answer (current round) is undefined', () => {
    expect(fn).toContain('q.answer?.text')
    expect(fn).toContain('q.answers?.[q.answers.length - 1]?.text')
  })

  it('still gates on !q.isAnswered — an actually-answered question is untouched by this fallback', () => {
    expect(fn).toMatch(/^existingAnswer: !q\.isAnswered \?/)
  })
})
