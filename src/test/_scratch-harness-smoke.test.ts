import { describe, it, expect } from 'vitest'
import { createWebviewHarness } from './helpers/webviewHarness'

const Q1 = { id: 'q1', text: 'Q1 text', adrPath: '/fake/0029.md', adrNumber: 29, lineStart: 10, draftKey: 'key-q1', fileChecksum: 'c1', totalOccurrences: 1, groupLabel: 'ADR-0029', groupSortKey: '0-0029', sourceKind: 'adr' }
const Q2 = { id: 'q2', text: 'Q2 text', adrPath: '/fake/0029.md', adrNumber: 29, lineStart: 20, draftKey: 'key-q2', fileChecksum: 'c1', totalOccurrences: 1, groupLabel: 'ADR-0029', groupSortKey: '0-0029', sourceKind: 'adr' }

describe('smoke 2', () => {
  it('Back never re-fetches from the server: a draft autosaved while on Q1 is invisible after skip-then-back, because the cached questions[] array was never updated', () => {
    const h = createWebviewHarness()
    h.postToWebview({ type: 'questions', generation: 0, questions: [Q1, Q2] })
    h.typeAnswer('my in-progress answer')
    // Autosave fires (debounced ~500ms in real life; the harness's 'input'
    // handler posts the draft message synchronously enough for this model —
    // the real timing detail doesn't change the mechanism under test).
    console.log('sentMessages after typing:', JSON.stringify(h.sentMessages))

    h.click('btn-skip')
    console.log('after skip, ans value:', JSON.stringify(h.element('ans').value))

    h.click('btn-back')
    console.log('after back, ans value:', JSON.stringify(h.element('ans').value))

    expect(h.element('ans').value).toBe('my in-progress answer')
  })
})
