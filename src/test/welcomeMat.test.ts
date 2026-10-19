import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CompositeIndex } from '../index/compositeIndex'
import { AdrIndex } from '../index/adrIndex'
import { SeedIndex } from '../index/seedIndex'
import { isCorpusEmpty } from '../webview/corpusEmpty'

/**
 * The welcome mat (2026-10-19, pre-announcement launch feature — Jérémie's go
 * on Lapidary's pick, walkthrough half Jérémie's own suggestion from the VS
 * Code UX guidelines): an EMPTY corpus must get an invitation, never the
 * "All caught up" checkmark — the empty-state-that-says-nothing family's
 * third member (broken tour 2026-10-10, fresh tour same day, and this).
 */
const root = resolve(__dirname, '..', '..')

describe('isCorpusEmpty — the mat\'s one predicate', () => {
  it('true when no root holds any ADR or seed (the fresh-install stranger)', () => {
    const composite = CompositeIndex.wrapSingle('', new AdrIndex(), new SeedIndex())
    expect(isCorpusEmpty(composite)).toBe(true)
  })

  it('false the moment one ADR exists — documents-but-no-questions keeps the earned checkmark', () => {
    const adrs = new AdrIndex()
    adrs.indexContent('/x/docs/adr/0001-a-decision.md', '# A Decision\n\n- **Status**: Accepted\n')
    const composite = CompositeIndex.wrapSingle('/x', adrs, new SeedIndex())
    expect(isCorpusEmpty(composite)).toBe(false)
  })
})

describe('Regression tests: the mat is wired, natively and in the panel', () => {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

  it('viewsWelcome contributes the invitation on adrExplorer, gated on the context key', () => {
    const vw = pkg.contributes.viewsWelcome
    expect(vw).toBeDefined()
    const mat = vw.find((w: any) => w.view === 'adrExplorer')
    expect(mat.when).toBe('adrManager.corpusEmpty')
    expect(mat.contents).toContain('command:adrManager.createAdr')
  })

  it('the walkthrough exists: one walkthrough, four steps, every step media file present', () => {
    const wts = pkg.contributes.walkthroughs
    expect(wts).toHaveLength(1)
    expect(wts[0].steps).toHaveLength(4)
    for (const step of wts[0].steps) {
      const md = readFileSync(resolve(root, step.media.markdown), 'utf8')
      expect(md.length).toBeGreaterThan(50)
    }
  })

  it('extension.ts re-derives the context key on every composite refresh, not only activation', () => {
    const src = readFileSync(resolve(root, 'src/extension.ts'), 'utf8')
    expect(src).toContain("setContext', 'adrManager.corpusEmpty'")
    const refreshFn = src.slice(src.indexOf('function onCompositeRefreshed'))
    expect(refreshFn.slice(0, 400)).toContain('updateCorpusEmptyContext()')
  })

  it('the panel branch: empty corpus renders the invitation, non-empty keeps "All caught up"', () => {
    const src = readFileSync(resolve(root, 'src/webview/openQuestionsPanel.ts'), 'utf8')
    expect(src).toContain("'No decision records yet'")
    expect(src).toContain('else if (corpusEmpty)')
    // the earned checkmark survives as the final else — pinned so the mat
    // never replaces it for corpora that have genuinely finished their work
    expect(src).toContain("textContent = 'All caught up'")
  })
})
