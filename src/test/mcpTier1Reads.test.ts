/**
 * Behavioral tests for ADR-0021 Tier 1 reads (`lookup`, `get_outline`,
 * `get_sections`, `list_open_questions`) — the launch sprint's Track 1.
 * Fixtures mirror a realistic ADR shape (a "## Questions" section containing
 * "### QST:" children) rather than empty stand-ins, so the anchor-resolution
 * precedence rule (override wins over heading-derived slug, Cairn 4.7's
 * 2026-07-06 catch) is actually exercised, not just declared.
 */

import { describe, it, expect } from 'vitest'
import type { RepositoryContext } from '../mcp/repositoryContext'
import { lookup, getOutline, getSections, listOpenQuestions } from '../mcp/handlers'
import type { AdrFile, AdrSection, Question, SeedFile } from '../parser/types'

const SCOPE_SECTION: AdrSection = {
  level: 3,
  heading: 'QST: What is the scope?',
  navCode: 'QST',
  navCodeText: 'What is the scope?',
  body: '- Status: unanswered\n- Why asking: because scope matters.',
  lineStart: 16,
  lineEnd: 25,
  slug: 'qst-what-is-the-scope',
  children: [],
}

const FORMAT_SECTION: AdrSection = {
  level: 3,
  heading: 'QST: Is the format stable?',
  navCode: 'QST',
  navCodeText: 'Is the format stable?',
  body: '- Status: answered',
  lineStart: 27,
  lineEnd: 39,
  slug: 'qst-is-the-format-stable',
  anchorOverride: 'stable-format',
  children: [],
}

const QUESTIONS_SECTION: AdrSection = {
  level: 2,
  heading: 'Questions',
  body: '',
  lineStart: 14,
  lineEnd: 40,
  slug: 'questions',
  children: [SCOPE_SECTION, FORMAT_SECTION],
}

const HUMAN_CONTEXT_SECTION: AdrSection = {
  level: 2,
  heading: 'Human Context',
  body: 'This ADR exists because we needed a parser.',
  lineStart: 10,
  lineEnd: 12,
  slug: 'human-context',
  children: [],
}

const DECISION_SECTION: AdrSection = {
  level: 2,
  heading: 'Decision',
  body: 'We decided to use a hand-written tokenizer.',
  lineStart: 42,
  lineEnd: 44,
  slug: 'decision',
  children: [],
}

const SCOPE_QUESTION: Question = {
  id: 'adr-0001-qst-what-is-the-scope',
  slug: 'qst-what-is-the-scope',
  text: 'What is the scope?',
  statusText: 'unanswered',
  isAnswered: false,
  adrNumber: 1,
  adrPath: '/fake/docs/adr/0001-example.md',
  lineStart: 16,
}

const FORMAT_QUESTION: Question = {
  id: 'adr-0001-qst-is-the-format-stable',
  slug: 'qst-is-the-format-stable',
  text: 'Is the format stable?',
  statusText: 'answered',
  isAnswered: true,
  recommendation: 'Yes, ship it.',
  answer: { text: 'Confirmed.', author: 'Jérémie', line: 35 },
  adrNumber: 1,
  adrPath: '/fake/docs/adr/0001-example.md',
  lineStart: 27,
}

function makeAdr(overrides: Partial<AdrFile> = {}): AdrFile {
  return {
    path: '/fake/docs/adr/0001-example.md',
    number: 1,
    title: 'Project Specifications',
    iteration: 1,
    status: 'Draft',
    deciders: ['Jérémie Lumbroso'],
    format: 'collab-adr-lean',
    sections: [HUMAN_CONTEXT_SECTION, QUESTIONS_SECTION, DECISION_SECTION],
    questions: [SCOPE_QUESTION, FORMAT_QUESTION],
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
    path: '/fake/docs/adr/seed-2026-07-05-async-question-queue.md',
    title: 'SEED: Async Question Queue',
    topic: 'Async Question Queue',
    date: '2026-07-05',
    brainDump: 'What if questions could exist outside any ADR?',
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

function makeContext(adrs: AdrFile[], seeds: SeedFile[] = []): RepositoryContext {
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
    readFile: async () => { throw new Error('not needed by these tests') },
    writeFile: async () => { throw new Error('not needed by these tests') },
    listFiles: async () => [],
  }
}

describe('lookup', () => {
  const ctx = makeContext([makeAdr()])

  it('resolves a bare ADR number to a compact summary, not the full content', () => {
    const result = lookup(ctx, '1')
    expect(result).toContain('[adr:0001] Project Specifications')
    expect(result).toContain('open: 1')
    expect(result).toContain('Usage: call get_outline')
  })

  it('resolves adr:NNNN#slug to the section body', () => {
    const result = lookup(ctx, 'adr:0001#decision')
    expect(result).toContain('[adr:0001#decision]')
    expect(result).toContain('We decided to use a hand-written tokenizer.')
  })

  it('resolves adr:NNNN#slug for an unanswered question, with an explicit [none] answer', () => {
    const result = lookup(ctx, 'adr:0001#qst-what-is-the-scope')
    expect(result).toContain('status: unanswered')
    expect(result).toContain('answer: [none]')
  })

  it('resolves an answered question with recommendation and answer/author', () => {
    const result = lookup(ctx, 'adr:0001#qst-is-the-format-stable')
    expect(result).toContain('status: answered')
    expect(result).toContain('recommendation: Yes, ship it.')
    expect(result).toContain('answer: Confirmed.')
    expect(result).toContain('answered_by: Jérémie')
  })

  it('resolves the section anchorOverride to the QUESTION it represents, not generic section text', () => {
    // Regression case for the bug caught while building these tests:
    // a QST section's <!-- @adr-anchor: --> override names the same
    // question, not a separate node — looking it up must not silently
    // fall back to "section" formatting and lose status/answer/recommendation.
    const result = lookup(ctx, 'adr:0001#stable-format')
    expect(result).toContain('status: answered')
    expect(result).toContain('answered_by: Jérémie')
  })

  it('accepts a bare Question.id (tool-local tolerance, pending ADR-0008 fold-in)', () => {
    const result = lookup(ctx, 'adr-0001-qst-what-is-the-scope')
    expect(result).toContain('status: unanswered')
  })

  it('returns a structured ambiguous error rather than silently picking, on a genuine substring collision', () => {
    // "format" fuzzy-matches only the format question/section (already one
    // logical node) in the base fixture — add an unrelated section that
    // also contains "format" to force a real two-way ambiguity.
    const adrWithCollision = makeAdr({
      sections: [
        HUMAN_CONTEXT_SECTION,
        QUESTIONS_SECTION,
        DECISION_SECTION,
        { level: 2, heading: 'Format Notes', body: 'Prose.', lineStart: 46, lineEnd: 47, slug: 'format-notes', children: [] },
      ],
    })
    const result = lookup(makeContext([adrWithCollision]), 'adr:0001#format')
    expect(result).toContain('error: ambiguous')
    expect(result).toContain('hint: specify the full slug')
  })

  it('returns a structured ambiguous error, not a silent first-match, when two sections share an exact effective anchor (Cairn\'s RFC-Q1 edge case, 2026-07-13)', () => {
    // A copy-pasted @adr-anchor override colliding with another section's
    // heading-derived slug. Before this fix, .find() would silently return
    // the first section in document order — surfacing here so it's a
    // named regression, not just a passing assertion.
    const adrWithDuplicateAnchor = makeAdr({
      sections: [
        HUMAN_CONTEXT_SECTION,
        QUESTIONS_SECTION,
        { level: 2, heading: 'Decision', body: 'First.', lineStart: 42, lineEnd: 44, slug: 'other-slug', anchorOverride: 'decision', children: [] },
        DECISION_SECTION, // slug: 'decision' — same effective anchor as the section above
      ],
    })
    const result = lookup(makeContext([adrWithDuplicateAnchor]), 'adr:0001#decision')
    expect(result).toContain('error: ambiguous')
    expect(result).toContain('duplicate @adr-anchor')
  })

  it('returns a structured not_found error for an unknown ADR number', () => {
    const result = lookup(ctx, 'adr:9999')
    expect(result).toContain('error: not_found')
  })

  it('returns a structured unrecognized_reference error for garbage input', () => {
    const result = lookup(ctx, 'not a reference at all')
    expect(result).toContain('error: unrecognized_reference')
  })

  it('resolves against live namespace data (2026-07-14) rather than a registry file — not_found when no ADR carries that namespace', () => {
    // The fixture ADR has no `namespace` set, so no ADR matches
    // "elenchus-app" — a real not_found, not a blanket rejection. Naming
    // the available namespaces (none here) rather than a fixed hint string.
    const result = lookup(ctx, 'elenchus-app.0001#decision')
    expect(result).toContain('error: not_found')
    expect(result).toContain('namespace "elenchus-app"')
  })

  it('resolves a namespace-qualified alias when an ADR actually carries that namespace (multi-root composite)', () => {
    const namespacedAdr = makeAdr({ namespace: 'elenchus-legacy' })
    const result = lookup(makeContext([namespacedAdr]), 'elenchus-legacy.0001#decision')
    expect(result).toContain('We decided to use a hand-written tokenizer.')
  })

  it('flags cross-root ambiguity rather than silently picking one ADR when two roots share a number', () => {
    const first = makeAdr({ namespace: 'root-a', path: '/fake/root-a/docs/adr/0001-a.md' })
    const second = makeAdr({ namespace: 'root-b', path: '/fake/root-b/docs/adr/0001-b.md' })
    const result = lookup(makeContext([first, second]), 'adr:0001')
    expect(result).toContain('error: ambiguous')
    expect(result).toContain('root-a.0001 (0001-a.md)')
    expect(result).toContain('root-b.0001 (0001-b.md)')
    expect(result).toContain('use "<namespace>.0001" to disambiguate')
  })

  it('flags same-namespace ambiguity with a distinct message, and disambiguates by filename since the namespace qualifier can\'t (a real elenchus specimen: two files, both "0016", in the same legacy/ root)', () => {
    const first = makeAdr({ number: 16, namespace: 'legacy', path: '/fake/legacy/docs/adr/0016-dev-debug-mode.md' })
    const second = makeAdr({ number: 16, namespace: 'legacy', path: '/fake/legacy/docs/adr/0016-implementation-plan.md' })
    const result = lookup(makeContext([first, second]), 'adr:0016')
    expect(result).toContain('error: ambiguous')
    expect(result).toContain('appears 2 times within the same namespace/root ("legacy")')
    expect(result).toContain('legacy.0016 (0016-dev-debug-mode.md)')
    expect(result).toContain('legacy.0016 (0016-implementation-plan.md)')
    expect(result).toContain('fix the duplicate ADR number at the source')
  })

  it('resolves a whole seed when given a seed: reference', () => {
    const seedCtx = makeContext([], [makeSeed()])
    const result = lookup(seedCtx, 'seed:2026-07-05-async-question-queue')
    expect(result).toContain('[seed:seed-2026-07-05-async-question-queue]')
    expect(result).toContain('What if questions could exist outside any ADR?')
  })

  it('includes neighboring section context when context_lines is requested', () => {
    const result = lookup(ctx, 'adr:0001#decision', 5)
    expect(result).toContain('--- context before')
  })
})

describe('get_outline', () => {
  it('lists every section in document order with line ranges, plus inline QST status', () => {
    const result = getOutline(makeContext([makeAdr()]), '1')
    expect(result).toContain('[adr:0001] Project Specifications')
    expect(result).toContain('human-context | Human Context | level 2 | lines 10-12')
    expect(result).toContain('qst-what-is-the-scope | QST: What is the scope? | level 3 | lines 16-25')
    expect(result).toContain('status: unanswered')
    expect(result).toContain('stable-format | QST: Is the format stable? | level 3 | lines 27-39')
    expect(result).toContain('status: answered')
    expect(result).toContain('Usage: call get_sections(')
  })

  it('returns a structured error for an unknown ADR rather than throwing', () => {
    const result = getOutline(makeContext([]), '1')
    expect(result).toContain('error: not_found')
  })
})

describe('get_sections', () => {
  const ctx = makeContext([makeAdr()])

  it('fetches multiple refs in one call, each in its own labeled block', () => {
    const result = getSections(ctx, ['adr:0001#decision', 'adr:0001#qst-what-is-the-scope'])
    expect(result).toContain('--- adr:0001#decision ---')
    expect(result).toContain('We decided to use a hand-written tokenizer.')
    expect(result).toContain('--- adr:0001#qst-what-is-the-scope ---')
  })

  it('embeds a per-ref error rather than aborting the whole batch', () => {
    const result = getSections(ctx, ['adr:0001#decision', 'adr:9999'])
    expect(result).toContain('We decided to use a hand-written tokenizer.')
    expect(result).toContain('error: not_found')
  })

  it('drops whole refs from the end under a tight token_budget, never truncating mid-node', () => {
    const result = getSections(ctx, ['adr:0001#decision', 'adr:0001#qst-is-the-format-stable'], 5)
    expect(result).toContain('Usage: result truncated at token_budget=5')
    expect(result).toContain('dropped')
  })
})

describe('list_open_questions', () => {
  it('summarizes open-question count first, then one bracketed row per question', () => {
    const result = listOpenQuestions(makeContext([makeAdr()]))
    expect(result).toContain('1 open across 1 ADRs')
    expect(result).toContain('[adr:0001#qst-what-is-the-scope] What is the scope? — status: unanswered | priority: [none]')
    expect(result).not.toContain('qst-is-the-format-stable') // answered — must not appear
  })

  it('scopes to a single ADR when adr_ref is given', () => {
    const other = makeAdr({ number: 2, title: 'Other ADR', questions: [{ ...SCOPE_QUESTION, id: 'adr-0002-qst-x', slug: 'qst-x' }] })
    const result = listOpenQuestions(makeContext([makeAdr(), other]), { adrRef: '1' })
    expect(result).toContain('1 open across 1 ADRs')
    expect(result).not.toContain('qst-x')
  })

  it('respects limit, and states it explicitly in the summary line', () => {
    const many = makeAdr({
      questions: Array.from({ length: 5 }, (_, i) => ({
        ...SCOPE_QUESTION,
        id: `adr-0001-qst-${i}`,
        slug: `qst-${i}`,
        text: `Question ${i}?`,
      })),
    })
    const result = listOpenQuestions(makeContext([many]), { limit: 2 })
    expect(result).toContain('5 open across 1 ADRs (limit: 2)')
    expect(result.match(/\[adr:0001#qst-\d\]/g)?.length).toBe(2)
  })
})
