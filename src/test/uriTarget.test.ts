import { describe, it, expect } from 'vitest'
import { decideRoute, parseUriHandlerTarget } from '../deeplink/uriTarget'
import type { ResolvedRef, RefError } from '../mcp/reference'
import type { AdrFile, Question, SeedFile } from '../parser/types'

describe('parseUriHandlerTarget', () => {
  it('decodes the target query param off a real pigeonhole-shaped URL', () => {
    // vscode://jlumbroso.adrs4ai/open?target=adr%3A%2F%2Fv1%2Frepo%2Fjlumbroso%2Fvscode-adrs-for-ai%2Fadr%2F0008%3Fref%3Dhead%23decision
    const raw = 'adr://v1/repo/jlumbroso/vscode-adrs-for-ai/adr/0008?ref=head#decision'
    const query = `target=${encodeURIComponent(raw)}`
    expect(parseUriHandlerTarget({ path: '/open', query })).toBe(raw)
  })

  it('decodes a bare local ref too, not just canonical URIs', () => {
    expect(parseUriHandlerTarget({ path: '/open', query: 'target=adr%3A0008%23decision' })).toBe('adr:0008#decision')
  })

  it('ignores any path other than /open — a deliberate extension point, not an error', () => {
    expect(parseUriHandlerTarget({ path: '/somethingElse', query: 'target=adr%3A0008' })).toBeUndefined()
  })

  it('returns undefined when there is no target param at all', () => {
    expect(parseUriHandlerTarget({ path: '/open', query: '' })).toBeUndefined()
    expect(parseUriHandlerTarget({ path: '/open', query: 'foo=bar' })).toBeUndefined()
  })

  it('returns undefined for an explicitly empty target value', () => {
    expect(parseUriHandlerTarget({ path: '/open', query: 'target=' })).toBeUndefined()
  })
})

describe('decideRoute', () => {
  const adr: AdrFile = { path: '/repo/docs/adr/0008-x.md', number: 8, isSeed: false } as AdrFile
  const seed: SeedFile = { path: '/repo/docs/adr/2026-09-14-x.seed.md' } as SeedFile
  const question: Question = { id: 'qst-x', adrPath: adr.path, lineStart: 10, slug: 'qst-x' } as Question

  const resolvedQuestion: ResolvedRef = { kind: 'question', container: { kind: 'adr', adr }, question }
  const resolvedAdr: ResolvedRef = { kind: 'adr', adr }
  const resolvedSection: ResolvedRef = { kind: 'section', adr, section: { lineStart: 5 } as any }
  const resolvedSeed: ResolvedRef = { kind: 'seed', seed }
  const error: RefError = { kind: 'error', error: 'not_found', message: 'nope' }

  it('a resolved question with openIn=question-dialog (the default) opens the dialog — the founder\'s stated preference', () => {
    expect(decideRoute(resolvedQuestion, 'question-dialog')).toBe('question-dialog')
  })

  it('a resolved ADR/section/seed with openIn=question-dialog degrades to tree — there is no question to navigate the dialog to', () => {
    expect(decideRoute(resolvedAdr, 'question-dialog')).toBe('tree')
    expect(decideRoute(resolvedSection, 'question-dialog')).toBe('tree')
    expect(decideRoute(resolvedSeed, 'question-dialog')).toBe('tree')
  })

  it('openIn=tree always reveals in the tree, even for a question — his "always on treeview" preference', () => {
    expect(decideRoute(resolvedQuestion, 'tree')).toBe('tree')
    expect(decideRoute(resolvedAdr, 'tree')).toBe('tree')
  })

  it('openIn=markdown is the off-switch — always the plain file, regardless of what resolved', () => {
    expect(decideRoute(resolvedQuestion, 'markdown')).toBe('markdown')
    expect(decideRoute(resolvedAdr, 'markdown')).toBe('markdown')
  })

  it('a resolution failure always routes to markdown, under every openIn setting — nothing resolved to reveal in the tree or the dialog', () => {
    expect(decideRoute(error, 'question-dialog')).toBe('markdown')
    expect(decideRoute(error, 'tree')).toBe('markdown')
    expect(decideRoute(error, 'markdown')).toBe('markdown')
  })
})
