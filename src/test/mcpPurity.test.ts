/**
 * ADR-0003 Decision — "handler purity" portability requirement, mechanically
 * enforced: src/mcp/handlers.ts must have zero `vscode` imports and must
 * work against a plain-object RepositoryContext in a bare Node process (no
 * VS Code extension host). This is the test Lapidary 5's ADR-0003 mining
 * pass recommended ("a test that imports handlers.ts in a bare Node process
 * and runs a handler against a mock RepositoryContext would enforce
 * requirement 1 mechanically").
 *
 * Two layers, deliberately:
 *  1. Static source check — catches a value-import of 'vscode' even if it
 *     happens to be unreachable at runtime in this particular test.
 *  2. Dynamic behavioral check — proves the handlers actually produce
 *     correct output against a mock context, not just that they "don't
 *     crash." A file that imports nothing and does nothing would pass a
 *     purity check trivially; it wouldn't pass this one.
 *
 * Note: `import type { ... } from 'vscode'` would NOT be caught by the
 * dynamic check (type-only imports are erased at compile time and carry no
 * runtime dependency) — the static check below deliberately doesn't special
 * case this, since a type-only vscode import in handlers.ts would still be
 * an architecture smell worth catching, even though it's runtime-harmless.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { RepositoryContext } from '../mcp/repositoryContext'
import { projectOverview, lookup, getOutline, getSections, listOpenQuestions } from '../mcp/handlers'
import type { AdrFile, Question, SeedFile } from '../parser/types'

describe('MCP handler purity (ADR-0003 portability requirement 1)', () => {
  it('handlers.ts source contains no import from vscode', () => {
    const source = readFileSync(resolve(__dirname, '../mcp/handlers.ts'), 'utf-8')
    expect(source).not.toMatch(/from ['"]vscode['"]/)
    expect(source).not.toMatch(/require\(['"]vscode['"]\)/)
  })

  it('repositoryContext.ts source contains no import from vscode', () => {
    const source = readFileSync(resolve(__dirname, '../mcp/repositoryContext.ts'), 'utf-8')
    expect(source).not.toMatch(/from ['"]vscode['"]/)
  })

  it('imported and ran in this bare-Node vitest process without a vscode module present', () => {
    // If handlers.ts (or anything it imports) had a runtime `import ... from
    // 'vscode'`, the top-level import above would already have thrown
    // "Cannot find module 'vscode'" before this test file could even run —
    // vitest.config.ts aliases nothing for 'vscode' (checked: no such alias
    // exists), so this is a real absence, not a mocked one.
    expect(typeof projectOverview).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Minimal mock RepositoryContext — enough to exercise projectOverview's real
// behavior without touching disk or vscode.
// ---------------------------------------------------------------------------

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'adr-0001-qst-example',
    slug: 'qst-example',
    text: 'An example question?',
    statusText: 'unanswered',
    isAnswered: false,
    adrNumber: 1,
    adrPath: '/fake/docs/adr/0001-example.md',
    lineStart: 10,
    ...overrides,
  }
}

function makeAdr(overrides: Partial<AdrFile> = {}): AdrFile {
  return {
    path: '/fake/docs/adr/0001-example.md',
    number: 1,
    title: 'Example Decision',
    iteration: 1,
    status: 'Draft',
    deciders: ['Jérémie Lumbroso'],
    format: 'collab-adr-lean',
    sections: [],
    questions: [],
    inlineCodes: [],
    iterations: [],
    deepLinks: [],
    isSeed: false,
    checksum: 'deadbeef',
    parsedAt: 1751500000000,
    parseWarnings: [],
    ...overrides,
  }
}

function makeSeed(overrides: Partial<SeedFile> = {}): SeedFile {
  return {
    path: '/fake/docs/adr/seed-2026-07-06-example-topic.md',
    title: 'SEED: Example Topic',
    topic: 'Example Topic',
    date: '2026-07-06',
    threadEntries: [],
    derivedAdrs: [],
    isProcessed: false,
    derivedIntoHasPlaceholder: true,
    checksum: 'cafef00d',
    parsedAt: 1751500000000,
    ...overrides,
  }
}

function makeMockContext(adrs: AdrFile[], seeds: SeedFile[] = []): RepositoryContext {
  return {
    listAdrs: () => adrs,
    getAdr: (ref: string) => {
      const num = parseInt(ref.replace(/^adr:/, ''), 10)
      return adrs.find((a) => a.number === num)
    },
    listSeeds: () => seeds,
    getSeed: (ref: string) => {
      const slug = ref.replace(/^seed:/, '')
      return seeds.find((s) => s.path.includes(slug))
    },
    readFile: async () => {
      throw new Error('mock context: readFile not needed by this test')
    },
    writeFile: async () => {
      throw new Error('mock context: writeFile not needed by this test')
    },
    listFiles: async () => [],
  }
}

describe('projectOverview (Tier 0)', () => {
  it('summarizes ADR and question counts, with a bracketed ref per ADR and an explicit [unset] resolution', () => {
    const adrs = [
      makeAdr({
        number: 1,
        title: 'Project Specifications',
        status: 'Accepted',
        iteration: 2,
        questions: [makeQuestion({ isAnswered: true }), makeQuestion({ isAnswered: false })],
      }),
      makeAdr({
        number: 3,
        title: 'MCP Server Design',
        status: 'Partially Implemented',
        iteration: 5,
        questions: [],
      }),
    ]
    const seeds = [makeSeed()]

    const result = projectOverview(makeMockContext(adrs, seeds))

    expect(result).toContain('2 ADRs, 1 seeds — 1 open questions across 1 ADRs')
    expect(result).toContain('--- adrs ---')
    expect(result).toContain('[adr:0001] Project Specifications | Accepted | resolution: [unset] | open: 1 | iter: 2')
    expect(result).toContain('[adr:0003] MCP Server Design | Partially Implemented | resolution: [unset] | open: 0 | iter: 5')
    expect(result).toContain('--- seeds ---')
    expect(result).toContain('[seed:seed-2026-07-06-example-topic] 2026-07-06 | unprocessed')
    expect(result).toContain('Usage: call get_outline(adr_ref)')
  })

  it('omits the seeds block entirely when includeSeeds is false — an explicit choice, not a silent one', () => {
    const result = projectOverview(makeMockContext([makeAdr()], [makeSeed()]), { includeSeeds: false })
    expect(result).not.toContain('--- seeds ---')
    expect(result).toContain('0 seeds')
  })

  it('sorts ADRs by number regardless of index insertion order', () => {
    const adrs = [makeAdr({ number: 9, title: 'Ninth' }), makeAdr({ number: 2, title: 'Second' })]
    const result = projectOverview(makeMockContext(adrs))
    expect(result.indexOf('[adr:0002]')).toBeLessThan(result.indexOf('[adr:0009]'))
  })
})

describe('Tier 1 read stubs (ADR-0021 sequencing step 3 — not implemented yet)', () => {
  it('lookup names its own sequencing step rather than failing silently', () => {
    const ctx = makeMockContext([])
    expect(() => lookup(ctx, 'adr:0001')).toThrow(/sequencing step 3/)
  })

  it('getOutline, getSections, and listOpenQuestions all name the same deferral', () => {
    const ctx = makeMockContext([])
    expect(() => getOutline(ctx, 'adr:0001')).toThrow(/sequencing step 3/)
    expect(() => getSections(ctx, ['adr:0001#decision'])).toThrow(/sequencing step 3/)
    expect(() => listOpenQuestions(ctx)).toThrow(/sequencing step 3/)
  })
})
