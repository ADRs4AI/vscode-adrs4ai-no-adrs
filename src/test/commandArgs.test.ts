import { describe, it, expect } from 'vitest'
import { coerceTourSlug } from '../webview/commandArgs'

describe('Regression tests', () => {
  // Bug (2026-08-18, caught by Jérémie while re-recording the marketplace
  // GIFs in the fixture workspace): the "Answer Open Questions" view/title
  // button rendered "All caught up" over a corpus with 3 open questions,
  // while the tree's header item worked. Cause: the command handler trusted
  // its VS Code-injected first argument as a tour slug; a truthy non-string
  // sent the panel into tour mode for an unresolvable tour, whose walk is
  // legitimately empty. coerceTourSlug is the boundary guard.
  it('passes through explicit tour slugs from tour tree items', () => {
    expect(coerceTourSlug('cartographers-answer-surface')).toBe('cartographers-answer-surface')
  })
  it('rejects VS Code-injected non-string invocation context (the bug)', () => {
    expect(coerceTourSlug({ preserveFocus: false })).toBeUndefined() // object injection
    expect(coerceTourSlug(undefined)).toBeUndefined() // palette / header item path
    expect(coerceTourSlug(null)).toBeUndefined()
    expect(coerceTourSlug(3)).toBeUndefined()
    expect(coerceTourSlug('')).toBeUndefined() // empty string must mean "full walk", not a tour named ""
  })
})
