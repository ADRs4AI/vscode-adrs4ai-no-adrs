/**
 * D9.8 — the SUGGESTED migrate-to-leading quick-fix for the trailing
 * "(QST-PETNAME)" dialect (ledger ruling 2026-09-26, Riddle 5, clause 5:
 * "SUGGESTED, author's choice, never bulk-applied; migration changes the id,
 * so any ref holding the old auto-derived long slug breaks — state it in the
 * quick-fix copy"). Founder Report 2026-09-13 is the origin of the dialect.
 *
 * What these tests protect, each a way this could have hurt a real author:
 *  - the migration must NOT ride along inside the bulk "Normalize to adr
 *    format" action (it would silently re-stamp every petname'd id in a file);
 *  - the copy must name the old and new id (an author can't weigh a cost the
 *    message doesn't state);
 *  - what the message PROMISES must be true after applying the fix: the
 *    short `#qst-<handle>` ref keeps resolving, the old long slug does not.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseAdr } from '../parser/extractor'
import { resolveReference } from '../mcp/reference'
import { Coordinator } from '../normalizer/coordinator'
import { D98TrailingAliasHandleHandler } from '../normalizer/handlers/d9-8-trailing-alias-handle'
import { D96NoncanonicalNavCodeHeadingHandler } from '../normalizer/handlers/d9-6-noncanonical-nav-code-heading'
import { applyPatches } from '../normalizer/patch-applicator'
import type { RepositoryContext } from '../mcp/repositoryContext'
import type { AdrFile } from '../parser/types'

const PATH = '/fake/docs/adr/0004-x.md'

function doc(...headings: string[]): string {
  return `# ADR 0004: Petname specimen

- **Date**: 2026-09-26
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

## Questions

${headings.map(h => `${h}\n\n- Status: unanswered\n`).join('\n')}
`
}

function ctxFor(adr: AdrFile): RepositoryContext {
  return {
    listAdrs: () => [adr],
    getAdr: () => adr,
    listSeeds: () => [],
    getSeed: () => undefined,
    readFile: async () => { throw new Error('n/a') },
    writeFile: async () => { throw new Error('n/a') },
    listFiles: async () => [],
  }
}

describe('D98TrailingAliasHandleHandler', () => {
  const handler = new D98TrailingAliasHandleHandler()
  const H = '### QST: Which store do we use? (QST-STORE)'

  it('flags a BOUND trailing alias and states the id-change cost with the old and new id both named', () => {
    const content = doc(H)
    const adr = parseAdr(content, PATH)
    const records = handler.detect(content, adr)
    expect(records).toHaveLength(1)
    expect(records[0].handlerId).toBe('d9-8-trailing-alias-handle')
    expect(records[0].lineStart).toBe(adr.questions[0].lineStart)
    const msg = records[0].description
    expect(msg).toContain('CHANGES this question\'s id')
    expect(msg).toContain(adr.questions[0].id) // old, auto-derived long id
    expect(msg).toContain('adr-0004-qst-store') // new id
    expect(msg).toContain('### QST-STORE: Which store do we use?')
  })

  it('the suggested rewrite is the canonical leading form, preserving a trailing dismissal marker verbatim', () => {
    const content = doc('### QST: Which store do we use? (QST-STORE) <!-- @adr-dismissed: not-a-question -->')
    const adr = parseAdr(content, PATH)
    const [patch] = handler.process(content, adr)
    expect(patch.replacement).toBe('### QST-STORE: Which store do we use? <!-- @adr-dismissed: not-a-question -->')
  })

  it('folds like the parser: an accented lowercase petname migrates to the folded canonical handle', () => {
    const content = doc('### QST: Same person? (qst-jérémie)')
    const [patch] = handler.process(content, parseAdr(content, PATH))
    expect(patch.replacement).toBe('### QST-JEREMIE: Same person?')
  })

  it('offers nothing where the alias did NOT bind — a refused collision has its own diagnostic and no safe migration target', () => {
    const content = doc('### QST: One? (QST-SAME)', '### QST: Two? (QST-SAME)')
    expect(handler.detect(content, parseAdr(content, PATH))).toHaveLength(0)
  })

  it('offers nothing where a leading handle already outranks the trailing one, or where there is no trailing petname', () => {
    const content = doc('### QST-A: Leading wins? (QST-B)', '### QST: Plain question?')
    expect(handler.detect(content, parseAdr(content, PATH))).toHaveLength(0)
  })

  it('leaves non-canonical heading shapes to D9.6 rather than rewriting them (a rewrite could drop an annotation)', () => {
    const content = doc('### qst: lowercase keyword (QST-STORE)')
    const adr = parseAdr(content, PATH)
    expect(adr.questions[0].aliasSlug).toBe('qst-store') // the alias still BINDS (read-wide)…
    expect(handler.detect(content, adr)).toHaveLength(0) // …this handler just doesn't touch the heading
  })

  describe('after applying the fix, the message\'s promises are true', () => {
    const content = doc(H)
    const before = parseAdr(content, PATH).questions[0]
    const [patch] = handler.process(content, parseAdr(content, PATH))
    const migrated = parseAdr(applyPatches(content, [patch]), PATH)
    const after = migrated.questions[0]

    it('the id changed to exactly the id the message named', () => {
      expect(after.id).toBe('adr-0004-qst-store')
      expect(after.id).not.toBe(before.id)
      expect(after.qstId).toBe(before.qstId)
    })

    it('`#qst-store` keeps resolving; the OLD auto-derived long slug no longer does (the cost, made concrete)', () => {
      const ctx = ctxFor(migrated)
      expect(resolveReference(ctx, 'adr:0004#qst-store').kind).toBe('question')
      const old = resolveReference(ctx, `adr:0004#${before.slug}`)
      expect(old.kind === 'question' && old.question.id === after.id).toBe(false)
    })
  })
})

describe('Coordinator — suggest-only handlers are never applied in bulk (clause 5: "never bulk")', () => {
  // A real mixed file: one D9.6-class heading deviation (bulk-safe) AND a
  // trailing-petname heading (suggest-only).
  const content = doc('### qst:Glued colon question?', '### QST: Which store do we use? (QST-STORE)')
  const adr = parseAdr(content, PATH)
  const coordinator = new Coordinator([new D96NoncanonicalNavCodeHeadingHandler(), new D98TrailingAliasHandleHandler()])

  it('detectAll still reports the suggestion (the diagnostic is visible)', () => {
    expect(coordinator.detectAll(content, adr).map(r => r.handlerId)).toContain('d9-8-trailing-alias-handle')
  })

  it('processAll (the bulk "Normalize to adr format" path) applies the bulk-safe fix and leaves the petname heading untouched', () => {
    const { result, records } = coordinator.processAll(content, adr)
    expect(records.map(r => r.handlerId)).toEqual(['d9-6-noncanonical-nav-code-heading'])
    expect(result).toContain('### QST: Glued colon question?')
    expect(result).toContain('### QST: Which store do we use? (QST-STORE)') // NOT migrated
    expect(result).not.toContain('### QST-STORE:')
  })

  it('processOne applies exactly the one requested record, by line', () => {
    const line = adr.questions[1].lineStart
    const patch = coordinator.processOne(content, adr, 'd9-8-trailing-alias-handle', line)
    expect(patch?.replacement).toBe('### QST-STORE: Which store do we use?')
  })

  it('processOne refuses a stale line or unknown handler instead of guessing', () => {
    expect(coordinator.processOne(content, adr, 'd9-8-trailing-alias-handle', 1)).toBeUndefined()
    expect(coordinator.processOne(content, adr, 'no-such-handler', adr.questions[1].lineStart)).toBeUndefined()
  })

  it('reports which handlers are suggest-only, with a cost-stating quick-fix title', () => {
    expect([...coordinator.suggestOnlyHandlerIds()]).toEqual(['d9-8-trailing-alias-handle'])
    expect(coordinator.quickFixTitle('d9-8-trailing-alias-handle')).toMatch(/changes this question's id/)
  })
})

describe('extension.ts wiring (source-shape — the provider is vscode glue)', () => {
  const EXT = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')

  it('registers D9.8 and offers it per-diagnostic, keeping suggest-only diagnostics out of the bulk action', () => {
    expect(EXT).toContain('new D98TrailingAliasHandleHandler()')
    expect(EXT).toContain('normalizerCoordinator.suggestOnlyHandlerIds()')
    expect(EXT).toContain('normalizerCoordinator.processOne(')
    expect(EXT).toContain('action.diagnostics = normDiags.filter(d => !suggestOnly.has(String(d.code)))')
  })
})
