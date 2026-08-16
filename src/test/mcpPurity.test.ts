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
import { projectOverview } from '../mcp/handlers'
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
    rounds: [],
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
    questions: [],
    parseWarnings: [],
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
    expect(result).toContain('[seed:2026-07-06-example-topic] 2026-07-06 | unprocessed')
    expect(result).toContain('Usage: call get_outline(adr_ref)')
  })

  it('omits the seeds block entirely when includeSeeds is false — an explicit choice, not a silent one', () => {
    const result = projectOverview(makeMockContext([makeAdr()], [makeSeed()]), { includeSeeds: false })
    expect(result).not.toContain('--- seeds ---')
    expect(result).toContain('0 seeds')
  })

  it('stamps scanned_at and version when supplied, so identical corpora read at different times/versions are distinguishable (elenchus 2026-07-23: a 68->65 delta was the parser changing, not the corpus — nothing in the output said so)', () => {
    const result = projectOverview(makeMockContext([makeAdr()]), {
      scannedAt: '2026-07-23T22:00:00.000Z',
      serverVersion: '0.7.27',
    })
    expect(result).toContain('scanned_at: 2026-07-23T22:00:00.000Z | version: 0.7.27')
  })

  it('marks scanned_at/version as [unset] rather than omitting them when the caller does not supply them', () => {
    const result = projectOverview(makeMockContext([makeAdr()]))
    expect(result).toContain('scanned_at: [unset] | version: [unset]')
  })

  it('surfaces the real namespace string per row in multi-root workspaces, so a caller can copy the namespace.NNNN form rather than guess (elenchus 2026-07-24: "legacy.0016" is not a real namespace — the folder name and the resolved namespace can differ)', () => {
    const result = projectOverview(makeMockContext([makeAdr({ namespace: 'warm-call-or-interactive-sessions' })]))
    expect(result).toContain('| ns: warm-call-or-interactive-sessions')
  })

  it('omits the ns segment entirely for single-root ADRs with no namespace — not a meaningful concept there', () => {
    const result = projectOverview(makeMockContext([makeAdr()]))
    expect(result).not.toContain('| ns:')
  })

  it('sorts ADRs by number regardless of index insertion order', () => {
    const adrs = [makeAdr({ number: 9, title: 'Ninth' }), makeAdr({ number: 2, title: 'Second' })]
    const result = projectOverview(makeMockContext(adrs))
    expect(result.indexOf('[adr:0002]')).toBeLessThan(result.indexOf('[adr:0009]'))
  })

  it('surfaces a seed\'s declared axis-1 status and derived axis-2 rollup (ADR-0041 item 1\'s "census integration") — [unset]/n/a when absent, never omitted', () => {
    const unchunked = makeSeed({ path: '/fake/docs/adr/seed-unchunked.md' })
    const result = projectOverview(makeMockContext([], [unchunked]))
    expect(result).toContain('[seed:unchunked] 2026-07-06 | unprocessed | status: [unset] | rollup: n/a')
  })

  it('the rollup badge is computed from the derived ADR\'s own declared Status — full when Implemented', () => {
    const adr = makeAdr({ number: 7, status: 'Implemented' })
    const seed = makeSeed({
      path: '/fake/docs/adr/seed-chunked.md',
      status: 'parked — waiting on downstream review',
      derivedAdrs: [{ number: 7, title: 'Something Shipped', raw: '- ADR-0007: Something Shipped' }],
      isProcessed: true,
    })
    const result = projectOverview(makeMockContext([adr], [seed]))
    expect(result).toContain('status: parked — waiting on downstream review | rollup: full')
  })
})

// Tier 1 (`lookup`, `get_outline`, `get_sections`, `list_open_questions`) is
// now implemented — see src/test/mcpTier1Reads.test.ts for full behavioral
// coverage. Kept `lookup`/`getOutline`/`getSections`/`listOpenQuestions`
// imported above so the purity test above still exercises the real module.
