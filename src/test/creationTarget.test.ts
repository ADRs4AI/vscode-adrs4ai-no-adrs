/**
 * Real behavioral tests for ADR-0025 Decision 6's pure decision logic —
 * which root a new ADR/Seed targets, and which number it gets. This is
 * the multi-root fix Jérémie reported live (2026-08-25): "Create New ADR"
 * asked for a title but never asked which project, because createNewAdr
 * predated Decision 6's implementation entirely (a known, documented gap
 * — see extension.ts's own "Extension state" comment).
 */

import { describe, it, expect } from 'vitest'
import { resolveTargetRootPolicy, computeNextNumber } from '../views/creationTarget'

describe('resolveTargetRootPolicy', () => {
  it('N=1 resolves silently to the only root — composability, unchanged from before Decision 6', () => {
    const nodes = [{ namespace: 'solo-project' }]
    const decision = resolveTargetRootPolicy(nodes, { alwaysPrompt: false, pinnedNamespace: 'active-editor', activeEditorRootNamespace: undefined })
    expect(decision).toEqual({ kind: 'silent', namespace: 'solo-project' })
  })

  it('N=0 (defensive — should not occur in practice) prompts rather than crashing', () => {
    const decision = resolveTargetRootPolicy([], { alwaysPrompt: false, pinnedNamespace: 'active-editor', activeEditorRootNamespace: undefined })
    expect(decision).toEqual({ kind: 'prompt' })
  })

  it('multi-root, default settings, active editor resolves to a real root — silent, that root wins', () => {
    const nodes = [{ namespace: 'pneumatic' }, { namespace: 'ios-client' }]
    const decision = resolveTargetRootPolicy(nodes, { alwaysPrompt: false, pinnedNamespace: 'active-editor', activeEditorRootNamespace: 'ios-client' })
    expect(decision).toEqual({ kind: 'silent', namespace: 'ios-client' })
  })

  it('multi-root, no active editor — prompts (this is the exact bug: Jérémie clicked the palette command, no file was active, and it used to silently guess workspaceFolders[0] instead of asking)', () => {
    const nodes = [{ namespace: 'pneumatic' }, { namespace: 'ios-client' }]
    const decision = resolveTargetRootPolicy(nodes, { alwaysPrompt: false, pinnedNamespace: 'active-editor', activeEditorRootNamespace: undefined })
    expect(decision).toEqual({ kind: 'prompt' })
  })

  it('multi-root, active editor lives outside every discovered root — prompts, does not guess', () => {
    const nodes = [{ namespace: 'pneumatic' }, { namespace: 'ios-client' }]
    const decision = resolveTargetRootPolicy(nodes, { alwaysPrompt: false, pinnedNamespace: 'active-editor', activeEditorRootNamespace: undefined })
    expect(decision).toEqual({ kind: 'prompt' })
  })

  it('a pinned namespace wins over the active editor, "regardless of which file is active" (ADR-0025 Decision 6\'s own wording)', () => {
    const nodes = [{ namespace: 'pneumatic' }, { namespace: 'ios-client' }]
    const decision = resolveTargetRootPolicy(nodes, { alwaysPrompt: false, pinnedNamespace: 'pneumatic', activeEditorRootNamespace: 'ios-client' })
    expect(decision).toEqual({ kind: 'silent', namespace: 'pneumatic' })
  })

  it('a stale pinned namespace (renamed/removed root) falls through to the active-editor default rather than erroring', () => {
    const nodes = [{ namespace: 'pneumatic' }, { namespace: 'ios-client' }]
    const decision = resolveTargetRootPolicy(nodes, { alwaysPrompt: false, pinnedNamespace: 'no-longer-exists', activeEditorRootNamespace: 'ios-client' })
    expect(decision).toEqual({ kind: 'silent', namespace: 'ios-client' })
  })

  it('a stale pinned namespace with no active editor either falls all the way through to prompt', () => {
    const nodes = [{ namespace: 'pneumatic' }, { namespace: 'ios-client' }]
    const decision = resolveTargetRootPolicy(nodes, { alwaysPrompt: false, pinnedNamespace: 'no-longer-exists', activeEditorRootNamespace: undefined })
    expect(decision).toEqual({ kind: 'prompt' })
  })

  it('alwaysPromptOnMultiRoot forces the picker even when a pinned namespace would otherwise resolve silently', () => {
    const nodes = [{ namespace: 'pneumatic' }, { namespace: 'ios-client' }]
    const decision = resolveTargetRootPolicy(nodes, { alwaysPrompt: true, pinnedNamespace: 'pneumatic', activeEditorRootNamespace: 'pneumatic' })
    expect(decision).toEqual({ kind: 'prompt' })
  })

  it('alwaysPromptOnMultiRoot has no effect in the N=1 case — still silent (nothing to prompt about)', () => {
    const nodes = [{ namespace: 'solo-project' }]
    const decision = resolveTargetRootPolicy(nodes, { alwaysPrompt: true, pinnedNamespace: 'active-editor', activeEditorRootNamespace: undefined })
    expect(decision).toEqual({ kind: 'silent', namespace: 'solo-project' })
  })
})

describe('computeNextNumber', () => {
  it('no collision: the candidate seed is returned as-is', () => {
    expect(computeNextNumber(9, ['0001-foo.md', '0008-bar.md'])).toBe(9)
  })

  it('a single collision advances past it', () => {
    expect(computeNextNumber(9, ['0009-existing.md'])).toBe(10)
  })

  it('a run of collisions advances past all of them — the overlapping-number failure mode Jérémie named explicitly ("one of the most frequent failure modes I\'ve seen")', () => {
    expect(computeNextNumber(9, ['0009-a.md', '0010-b.md', '0011-c.md'])).toBe(12)
  })

  it('matches on the number PREFIX before the dash, not a substring anywhere in the filename', () => {
    // A file that merely CONTAINS "0009" later in its name must not be
    // mistaken for the numbered slot 0009 — only a leading "0009-" counts.
    expect(computeNextNumber(9, ['0001-mentions-0009-in-the-title.md'])).toBe(9)
  })

  it('an empty directory listing returns the seed unchanged', () => {
    expect(computeNextNumber(1, [])).toBe(1)
  })
})
