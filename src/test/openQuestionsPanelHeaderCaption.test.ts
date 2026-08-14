/**
 * Real behavioral tests (webviewHarness — actually runs the panel's
 * `<script>` block, not a source-shape regex) for the flush-right project
 * name in the "Question N of M" header. Gleaner's brief 2026-08-14, item 4
 * — Jérémie's own spec, verbatim: show the owning root's caption flush-
 * right, default on only when the current question set spans more than
 * one root, with a setting for permanently off / always on.
 */

import { describe, it, expect } from 'vitest'
import { createWebviewHarness } from './helpers/webviewHarness'

function q(id: string, rootNamespace: string, rootCaption: string) {
  return {
    id, text: `Question ${id}`, adrPath: `/fake/${rootNamespace}.md`, adrNumber: 1, lineStart: 1,
    draftKey: `key-${id}`, fileChecksum: 'c1', totalOccurrences: 1, groupLabel: 'ADR-0001',
    groupSortKey: `0-${id}`, sourceKind: 'adr', rootNamespace, rootCaption,
  }
}

describe('Open Questions panel: flush-right project name in the counter header', () => {
  it('default (auto) mode: hidden when every question shares the same root', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [q('a', 'proj', 'jlumbroso/proj'), q('b', 'proj', 'jlumbroso/proj')] })
    expect(h.element('counter-project').style.display).toBe('none')
  })

  it('auto mode: visible and shows the CURRENT question\'s caption when the set spans more than one root', () => {
    const h = createWebviewHarness()
    h.postToWebview({
      type: 'questions', generation: 0,
      questions: [q('a', 'pneumatic', 'jlumbroso/pneumatic'), q('b', 'ios-client', 'jlumbroso/ios-client')],
    })
    expect(h.element('counter-project').style.display).toBe('')
    expect(h.element('counter-project').textContent).toBe('jlumbroso/pneumatic')
    h.click('btn-skip')
    expect(h.element('counter-project').textContent).toBe('jlumbroso/ios-client')
  })

  it('"off" mode stays hidden even across a multi-root question set', () => {
    const h = createWebviewHarness()
    h.postToWebview({
      type: 'questions', generation: 0, projectNameInHeader: 'off',
      questions: [q('a', 'pneumatic', 'jlumbroso/pneumatic'), q('b', 'ios-client', 'jlumbroso/ios-client')],
    })
    expect(h.element('counter-project').style.display).toBe('none')
  })

  it('"always" mode shows it even in a single-root question set', () => {
    const h = createWebviewHarness()
    h.postToWebview({
      type: 'questions', generation: 0, projectNameInHeader: 'always',
      questions: [q('a', 'proj', 'jlumbroso/proj')],
    })
    expect(h.element('counter-project').style.display).toBe('')
    expect(h.element('counter-project').textContent).toBe('jlumbroso/proj')
  })

  it('a missing/garbage mode value falls back to auto, not a crash', () => {
    const h = createWebviewHarness()
    expect(() => h.postToWebview({
      type: 'questions', generation: 0, projectNameInHeader: 'not-a-real-mode',
      questions: [q('a', 'pneumatic', 'jlumbroso/pneumatic'), q('b', 'ios-client', 'jlumbroso/ios-client')],
    })).not.toThrow()
    // 'not-a-real-mode' isn't 'off', so the multi-root auto-show behavior still applies.
    expect(h.element('counter-project').style.display).toBe('')
  })
})
