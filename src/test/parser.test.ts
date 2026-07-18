/**
 * Parser Unit Tests
 *
 * Tests the tokenizer and extractor against real ADR content patterns.
 * These tests do NOT require VS Code APIs — they run under vitest directly.
 *
 * Per the Fourth Directive: tests must cover real scenarios, not contrived ones.
 * All fixtures below are derived from actual ADR patterns in this project.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { tokenize, extractRawSections } from '../parser/tokenizer'
import { parseAdr, detectFormat, slugify } from '../parser/extractor'
import { parseSeed } from '../parser/seedExtractor'
import { findReferencingAdrs, looksLikeSeedByContent } from '../index/seedIndex'

// ---------------------------------------------------------------------------
// Real-file fixtures — ground-truth benchmarks (user-reported failures)
// These tests read the actual committed ADR files. If parsing silently drops
// content a human can see in the file, one of these tests will catch it.
// ---------------------------------------------------------------------------

const ADR_ROOT = resolve(__dirname, '../../docs/adr')

function readAdr(filename: string): string {
  return readFileSync(resolve(ADR_ROOT, filename), 'utf8')
}

// ---------------------------------------------------------------------------
// Ground-truth benchmark helpers
// ---------------------------------------------------------------------------

/** Wrap a QST section in a minimal ADR frame so parseAdr can process it. */
function wrapQst(qstSection: string): string {
  return `# ADR-0001: Benchmark\n\n---\n\n## Questions\n\n${qstSection}\n\n---\n`
}

// ---------------------------------------------------------------------------
// Benchmark: ADR-0003 Phase 4 QST (lines 348–363)
// Exact section text used as the fixture — every significant field asserted.
// ---------------------------------------------------------------------------

const BENCH_ADR0003_PHASE4 = wrapQst(`### QST: What does Phase 4 (AI features) need from Phase 3 (MCP) to work — and should those tools be specced in this ADR?
- Status: unanswered
- Why asking: Phase 4 (Haiku-powered question prioritization, CLAUDE.md directive management, smart answer drafting) is the first major consumer of Phase 3. If Phase 3's tools don't support what Phase 4 needs, Phase 4 requires a Phase 3 patch. The synergy should be explicit.
- Need: a list of Phase 4's MCP tool requirements; confirm whether to add them to this ADR or an ADR-0008 tool spec

**My recommendation**: Three tools Phase 4 specifically needs:
1. \`list_open_questions(fields: 'rich')\` — already specced; needs \`whyAsking\`, \`need\`, \`recommendation\`, and \`adr_context\` fields in rich mode
2. \`update_question_priority(question_id, priority: 1|2|3|4, reasoning?: string)\` — Haiku writes priorities back; not yet in any spec
3. \`get_claude_md(fields?: 'directives' | 'all')\` — Phase 4's CLAUDE.md parser needs an MCP tool to read the parsed directive structure (not raw markdown)

Add these to ADR-0003 supporting materials. The full tool spec should live in ADR-0008 (see below).

**ANS:** (by Jérémie)
[Fill this in]`)

describe('Benchmark: ADR-0003 Phase 4 QST — all fields exhaustively asserted', () => {
  const adr = parseAdr(BENCH_ADR0003_PHASE4, '/fake/0001-benchmark.md')
  const q = adr.questions[0]

  it('parses exactly one unanswered question', () => {
    expect(adr.questions).toHaveLength(1)
    expect(q.isAnswered).toBe(false)
  })

  it('text: full question heading', () => {
    expect(q.text).toBe('What does Phase 4 (AI features) need from Phase 3 (MCP) to work — and should those tools be specced in this ADR?')
  })

  it('whyAsking: full sentence including Haiku mention and patch consequence', () => {
    expect(q.whyAsking).toContain('Haiku-powered question prioritization')
    expect(q.whyAsking).toContain('CLAUDE.md directive management')
    expect(q.whyAsking).toContain('Phase 4 requires a Phase 3 patch')
    expect(q.whyAsking).toContain('The synergy should be explicit')
  })

  it('need: full sentence including ADR-0008 reference', () => {
    expect(q.need).toContain('MCP tool requirements')
    expect(q.need).toContain('ADR-0008 tool spec')
  })

  it('recommendation: all three numbered tool names present', () => {
    expect(q.recommendation).toContain('Three tools Phase 4 specifically needs')
    expect(q.recommendation).toContain('list_open_questions')
    expect(q.recommendation).toContain('update_question_priority')
    expect(q.recommendation).toContain('get_claude_md')
  })

  it('recommendation: includes rich-mode field list', () => {
    // The first tool item says: needs whyAsking, need, recommendation, adr_context fields
    expect(q.recommendation).toContain('whyAsking')
    expect(q.recommendation).toContain('adr_context')
  })

  it('rawBodyPost: orphaned sentence after blank-line recommendation stop', () => {
    // This sentence comes AFTER the blank line that stops the recommendation parser.
    // It is post-recommendation content → rawBodyPost, not rawBody.
    expect(q.rawBodyPost).toContain('Add these to ADR-0003 supporting materials')
    expect(q.rawBodyPost).toContain('ADR-0008')
  })

  it('rawBody: undefined for this QST (no pre-recommendation body content)', () => {
    // The Phase 4 QST has no content between the field bullets and the recommendation.
    // The blank separator line is trimmed away, leaving rawBody empty.
    expect(q.rawBody).toBeUndefined()
  })

  it('rawBody: does NOT contain the recommendation text (separation of concerns)', () => {
    expect(q.rawBody ?? '').not.toContain('list_open_questions')
  })
})

// ---------------------------------------------------------------------------
// Benchmark: ADR-0003 deep-link QST (lines 404–418)
// ---------------------------------------------------------------------------

const BENCH_ADR0003_DEEPLINK = wrapQst(`### QST: What is the complete syntax for ADR deep links — and should this be specced before Forma 3 implementation?
- Status: unanswered
- Why asking: The deep link format (\`adr:0001#qst-scope\`) is used throughout the codebase (parser, tree view, copy-deep-link command, MCP tools). If we implement the MCP tools without a stable link spec, the tools will use an ad-hoc format that breaks when we formalize.
- Need: yes/no for creating a deep link protocol ADR before Forma 3; or confirm current format is sufficient for Forma 3

**My recommendation**: Create a minimal deep link ADR (ADR-0008 or ADR-0009) that specifies:
- **Local format** (Forma 1-4): \`adr:NNNN\` or \`adr:NNNN#section-slug\` — already implemented
- **Global format** (Forma 5+): \`@namespace/NNNN#section-slug\` — needs to be specified now
- **Version annotation** (Forma 5+): \`@NNNN@iter:2\` or \`@NNNN@HEAD\` — for versioned deep links
- **Protocol version prefix** (Forma 6+): \`adr://v1/namespace/NNNN/section\` — future-proof URL scheme

Speccing local + global now costs little but prevents a breaking change when Forma 5 arrives.

**ANS:** (by Jérémie)
[Fill this in]`)

describe('Benchmark: ADR-0003 deep-link QST — all fields exhaustively asserted', () => {
  const adr = parseAdr(BENCH_ADR0003_DEEPLINK, '/fake/0001-benchmark.md')
  const q = adr.questions[0]

  it('parses exactly one unanswered question', () => {
    expect(adr.questions).toHaveLength(1)
    expect(q.isAnswered).toBe(false)
  })

  it('whyAsking: contains the ad-hoc format breakage warning', () => {
    expect(q.whyAsking).toContain('adr:0001#qst-scope')
    expect(q.whyAsking).toContain('ad-hoc format that breaks when we formalize')
  })

  it('need: contains both options', () => {
    expect(q.need).toContain('deep link protocol ADR before Forma 3')
  })

  it('recommendation: contains all four format bullet points', () => {
    expect(q.recommendation).toContain('Create a minimal deep link ADR')
    expect(q.recommendation).toContain('Local format')
    expect(q.recommendation).toContain('Global format')
    expect(q.recommendation).toContain('Version annotation')
    expect(q.recommendation).toContain('Protocol version prefix')
  })

  it('recommendation: contains the actual format syntax examples', () => {
    expect(q.recommendation).toContain('adr:NNNN#section-slug')
    expect(q.recommendation).toContain('@namespace/NNNN#section-slug')
  })

  it('rawBodyPost: orphaned closing sentence (previously dropped)', () => {
    // Comes after the recommendation's blank-line stop → rawBodyPost.
    expect(q.rawBodyPost).toContain('Speccing local + global now costs little')
    expect(q.rawBodyPost).toContain('Forma 5')
  })
})

// ---------------------------------------------------------------------------
// Benchmark: ADR-0008 local reference QST (lines 46–68)
// ---------------------------------------------------------------------------

const BENCH_ADR0008_LOCAL = wrapQst(`### QST: What is the canonical local reference format?
- Status: unanswered
- Why asking: We currently use \`adr:0001\` and \`adr:0001#qst-scope\`. This is not formally specified anywhere. Before implementing MCP tools that generate and consume these, we need to nail the grammar.
- Need: confirm the grammar below or propose amendments

**Proposed grammar (local, Forma 3):**
\`\`\`
local_ref     := "adr:" adr_num ("#" section_slug)?
adr_num       := [0-9]{4}         # zero-padded: "0001"
section_slug  := [a-z0-9-]+       # slugified section heading

Examples:
  adr:0001                         # entire ADR
  adr:0001#decision                # decision section
  adr:0001#qst-what-is-the-scope   # specific question
  adr:0001#iterations              # iterations section
\`\`\`

**My recommendation**: Confirm as-is. The format is already in use and working. The only addition needed is the \`@version\` annotation for when we need to reference a specific iteration (Forma 5 concern, but spec it now).

**ANS:** (by Jérémie)
[Fill this in]`)

describe('Benchmark: ADR-0008 local reference QST — all fields exhaustively asserted', () => {
  const adr = parseAdr(BENCH_ADR0008_LOCAL, '/fake/0001-benchmark.md')
  const q = adr.questions[0]

  it('parses exactly one unanswered question', () => {
    expect(adr.questions).toHaveLength(1)
    expect(q.isAnswered).toBe(false)
  })

  it('whyAsking: mentions both informal forms already in use', () => {
    expect(q.whyAsking).toContain('adr:0001')
    expect(q.whyAsking).toContain('adr:0001#qst-scope')
    expect(q.whyAsking).toContain('nail the grammar')
  })

  it('rawBody: contains the complete BNF grammar block', () => {
    expect(q.rawBody).toContain('Proposed grammar (local, Forma 3)')
    expect(q.rawBody).toContain('local_ref')
    expect(q.rawBody).toContain('adr_num')
    expect(q.rawBody).toContain('section_slug')
  })

  it('rawBody: contains all four examples', () => {
    expect(q.rawBody).toContain('adr:0001')
    expect(q.rawBody).toContain('adr:0001#decision')
    expect(q.rawBody).toContain('adr:0001#qst-what-is-the-scope')
    expect(q.rawBody).toContain('adr:0001#iterations')
  })

  it('recommendation: the confirm statement with @version note', () => {
    expect(q.recommendation).toContain('Confirm as-is')
    expect(q.recommendation).toContain('@version')
    expect(q.recommendation).toContain('Forma 5 concern')
  })
})

// ---------------------------------------------------------------------------
// Benchmark: ADR-0008 global reference QST (lines 71–101)
// ---------------------------------------------------------------------------

const BENCH_ADR0008_GLOBAL = wrapQst(`### QST: What is the canonical global reference format for cross-project citations?
- Status: unanswered
- Why asking: We use \`elenchus-app.0001\` informally in conversation. This needs to be formally specified so the parser can detect it, the MCP server can resolve it, and the code lens feature can render it.
- Need: confirm the cross-project format

**Proposed grammar (cross-project, Forma 3):**
\`\`\`
xproject_ref  := namespace "." adr_num ("#" section_slug)?
namespace     := [a-z0-9-]+       # project slug (e.g., "elenchus-app")

Examples:
  elenchus-app.0001              # ADR 0001 from elenchus-app
  elenchus-app.0001#decision     # decision section from elenchus-app ADR-0001
\`\`\`

**How namespace is resolved in Forma 3 (local):**
- If the referenced project is cloned locally (e.g., under \`docs/research/elenchus-app/\`), the extension can resolve the reference by finding the ADR directory within that clone
- If not locally available, the reference is shown as unresolvable (no hover, no code lens) — graceful degradation
- In Forma 5: namespace maps to \`@username/repo\` in the global index, resolvable via GitHub API

**My recommendation**: Confirm. Additionally: the extension should maintain a small \`namespace_registry.json\` in \`.vscode/\` mapping namespace strings to local paths or future URLs.

**ANS:** (by Jérémie)
[Fill this in]`)

describe('Benchmark: ADR-0008 global reference QST — all fields exhaustively asserted', () => {
  const adr = parseAdr(BENCH_ADR0008_GLOBAL, '/fake/0001-benchmark.md')
  const q = adr.questions[0]

  it('parses exactly one unanswered question', () => {
    expect(adr.questions).toHaveLength(1)
    expect(q.isAnswered).toBe(false)
  })

  it('whyAsking: mentions all three consumers (parser, MCP server, code lens)', () => {
    expect(q.whyAsking).toContain('elenchus-app.0001')
    expect(q.whyAsking).toContain('parser can detect it')
    expect(q.whyAsking).toContain('MCP server can resolve it')
    expect(q.whyAsking).toContain('code lens feature can render it')
  })

  it('rawBody: contains the complete cross-project BNF grammar', () => {
    expect(q.rawBody).toContain('Proposed grammar (cross-project, Forma 3)')
    expect(q.rawBody).toContain('xproject_ref')
    expect(q.rawBody).toContain('namespace')
  })

  it('rawBody: contains both cross-project examples', () => {
    expect(q.rawBody).toContain('elenchus-app.0001')
    expect(q.rawBody).toContain('elenchus-app.0001#decision')
  })

  it('rawBody: contains the namespace resolution section with all three rules', () => {
    expect(q.rawBody).toContain('How namespace is resolved')
    expect(q.rawBody).toContain('cloned locally')
    expect(q.rawBody).toContain('graceful degradation')
    expect(q.rawBody).toContain('@username/repo')
  })

  it('recommendation: confirm statement with namespace_registry mention', () => {
    expect(q.recommendation).toContain('Confirm')
    expect(q.recommendation).toContain('namespace_registry.json')
  })
})

// ---------------------------------------------------------------------------
// Real-file cross-check: parse actual committed ADRs and verify same results
// ---------------------------------------------------------------------------

describe('Real-file cross-check: ADR-0003 and ADR-0008 parse correctly from disk', () => {
  // These two QSTs were reformatted (2026-06-10) from legacy **My recommendation**:
  // prose to the protocol form (**Recommendation**: (by Author, date) + multi-
  // paragraph body). The recommendation content — including what was once an
  // "orphaned sentence" in rawBodyPost — now lives inside the recommendation field.
  it('ADR-0003: Phase 4 QST has all fields from disk (protocol form)', () => {
    const content = readAdr('0003-mcp-server-design.md')
    const adr = parseAdr(content, resolve(ADR_ROOT, '0003-mcp-server-design.md'))
    const q = adr.questions.find(q => q.text.includes('Phase 4'))
    expect(q?.recommendation).toContain('list_open_questions')
    expect(q?.recommendation).toContain('update_question_priority')
    expect(q?.recommendation).toContain('get_claude_md')
    expect(q?.recommendation).toContain('Add these to ADR-0003 supporting materials')
  })

  it('ADR-0003: deep-link QST carries the full stacked recommendations from disk', () => {
    const content = readAdr('0003-mcp-server-design.md')
    const adr = parseAdr(content, resolve(ADR_ROOT, '0003-mcp-server-design.md'))
    const q = adr.questions.find(q => q.text.includes('deep link'))
    expect(q?.recommendation).toContain('Speccing local + global now costs little')
    // Stacked blocks: both models' attributions survive in the bridged field
    expect(q?.recommendation).toContain('(by Sonnet 4.6, 2026-03-05)')
    expect(q?.recommendation).toContain('(by Fable 5, 2026-05-24)')
  })

  it('ADR-0019: ADR-0003 deep-link QST splits into attributed Recommendation objects from disk', () => {
    const content = readAdr('0003-mcp-server-design.md')
    const adr = parseAdr(content, resolve(ADR_ROOT, '0003-mcp-server-design.md'))
    const q = adr.questions.find(q => q.text.includes('deep link'))
    const recs = q?.recommendations
    expect(recs && recs.length).toBeGreaterThanOrEqual(2)
    const sonnet = recs!.find(r => r.author === 'Sonnet 4.6')
    const fable = recs!.find(r => r.author === 'Fable 5')
    expect(sonnet?.date).toBe('2026-03-05')
    expect(sonnet?.text).toContain('Speccing local + global now costs little')
    expect(fable?.date).toBe('2026-05-24')
  })

  it('ADR-0019: ADR-0016 QST with @adr-anchor comment still parses stacked recommendations correctly', () => {
    // Acceptance criterion from Facet's dispatch: <!-- @adr-anchor: ... --> on a
    // QST/recommendation block must continue to work identically to today.
    const content = readAdr('0016-seed-incomplete-diagnostic.md')
    const adr = parseAdr(content, resolve(ADR_ROOT, '0016-seed-incomplete-diagnostic.md'))
    const q = adr.questions.find(q => q.text.includes('SEED_INCOMPLETE fire'))
    expect(q?.slug).toBe('seed-incomplete-trigger') // anchor override still resolves
    const recs = q?.recommendations
    expect(recs && recs.length).toBeGreaterThanOrEqual(2)
    const sonnet = recs!.find(r => r.author === 'Sonnet 4.6')
    const fable = recs!.find(r => r.author === 'Fable 5')
    expect(sonnet?.date).toBe('2026-04-17')
    expect(fable?.date).toBe('2026-05-24')
    // Fable's recommendation opens with a bold lean — the "pick"
    expect(fable?.pick).toBeTruthy()
  })

  it('ADR-0008: local reference QST has grammar in rawBody from disk', () => {
    const content = readAdr('0008-deep-link-protocol.md')
    const adr = parseAdr(content, resolve(ADR_ROOT, '0008-deep-link-protocol.md'))
    const q = adr.questions.find(q => q.text.includes('local reference format'))
    expect(q?.rawBody).toContain('local_ref')
    expect(q?.rawBody).toContain('adr:0001#decision')
  })

  it('ADR-0008: global reference QST has grammar and resolution rules in rawBody from disk', () => {
    const content = readAdr('0008-deep-link-protocol.md')
    const adr = parseAdr(content, resolve(ADR_ROOT, '0008-deep-link-protocol.md'))
    const q = adr.questions.find(q => q.text.includes('global reference format'))
    expect(q?.rawBody).toContain('xproject_ref')
    expect(q?.rawBody).toContain('How namespace is resolved')
    expect(q?.rawBody).toContain('graceful degradation')
  })
})

// ---------------------------------------------------------------------------
// Fixtures: real ADR content patterns
// ---------------------------------------------------------------------------

/** A minimal but complete collab-adr-lean ADR */
const COLLAB_ADR_LEAN_MINIMAL = `# ADR-0001: Project Specifications

- **Date**: 2026-03-02
- **Iteration**: 2
- **Status**: Accepted
- **Deciders**: Jérémie Lumbroso, Sonnet 4.6 (1M)

---

## Quick Reference

**Navigation codes** (for grep):
- \`QST:\` Questions
- \`ANS:\` Answers

---

## Questions

### QST: What is the scope?
- Status: unanswered
- Why asking: Determines engineering scope.
- Need: clear positioning

**ANS:** (by Jérémie)
This is a full replacement.

---

### QST: Is the format stable?
- Status: answered
- Why asking: Affects parser design.
- Need: stability estimate

**ANS:** (by Jérémie)
Yes, stable for 4 months.

---

## Decision

### Context
We are building a full replacement.

### Chosen: Full replacement

---

## Iterations

### Iteration 1 (2026-03-02)
- Human: Asked for specs
- AI: Created ADR with QSTs
- Outcome: Draft created

### Iteration 2 (2026-03-02)
- Human: Answered all QSTs
- AI (Sonnet 4.6): Filled decision section
- Outcome: ADR accepted
`

/** A standard MADR format ADR (as found in older elenchus ADRs) */
const MADR_STANDARD = `# Authentication Architecture with Penn CAS and Future OAuth

* Status: accepted
* Deciders: Jérémie Lumbroso, Claude (Sonnet 4.5)
* Date: 2026-01-09

## Context and Problem Statement

The system must authenticate users from Penn via CAS SSO.

## Decision Drivers

* Must integrate with Penn's PHP CAS proxy
* Must generate Supabase-compatible JWTs

## Considered Options

* Option 1: Supabase Auth only
* Option 2: Custom backend
* Option 3: Supabase Edge Functions for CAS (chosen)

## Decision Outcome

Chosen option: Option 3.
`

// ---------------------------------------------------------------------------
// Tokenizer tests
// ---------------------------------------------------------------------------

describe('tokenizer', () => {
  it('tokenizes headings with correct levels', () => {
    const tokens = tokenize('# H1\n## H2\n### H3\n#### H4')
    const headings = tokens.filter(t => t.kind === 'heading')
    expect(headings).toHaveLength(4)
    expect(headings[0]).toMatchObject({ kind: 'heading', level: 1, text: 'H1' })
    expect(headings[1]).toMatchObject({ kind: 'heading', level: 2, text: 'H2' })
    expect(headings[2]).toMatchObject({ kind: 'heading', level: 3, text: 'H3' })
    expect(headings[3]).toMatchObject({ kind: 'heading', level: 4, text: 'H4' })
  })

  it('assigns correct 1-indexed line numbers', () => {
    const tokens = tokenize('line one\n## Heading\nline three')
    expect(tokens[0]).toMatchObject({ kind: 'body', line: 1 })
    expect(tokens[1]).toMatchObject({ kind: 'heading', line: 2 })
    expect(tokens[2]).toMatchObject({ kind: 'body', line: 3 })
  })

  it('detects HTML anchor comments', () => {
    const tokens = tokenize('<!-- @adr-anchor: qst-scope -->')
    expect(tokens[0]).toMatchObject({ kind: 'html_comment', content: '@adr-anchor: qst-scope' })
  })

  it('tokenizes blank lines as blank tokens', () => {
    const tokens = tokenize('## Heading\n\nBody text')
    expect(tokens[1]).toMatchObject({ kind: 'blank' })
  })

  it('handles headings with trailing spaces gracefully', () => {
    const tokens = tokenize('## Heading with trailing   ')
    const h = tokens.find(t => t.kind === 'heading')
    expect(h).toMatchObject({ text: 'Heading with trailing' })
  })
})

describe('extractRawSections', () => {
  it('extracts title and top-level sections', () => {
    const tokens = tokenize(COLLAB_ADR_LEAN_MINIMAL)
    const { title, sections } = extractRawSections(tokens)

    expect(title).toBe('ADR-0001: Project Specifications')
    const sectionNames = sections.map(s => s.heading.text)
    expect(sectionNames).toContain('Quick Reference')
    expect(sectionNames).toContain('Questions')
    expect(sectionNames).toContain('Decision')
    expect(sectionNames).toContain('Iterations')
  })

  it('does not include the # title heading as a section', () => {
    const tokens = tokenize('# Title\n## Section A\n## Section B')
    const { title, sections } = extractRawSections(tokens)
    expect(title).toBe('Title')
    expect(sections).toHaveLength(2)
    expect(sections[0].heading.text).toBe('Section A')
  })
})

// ---------------------------------------------------------------------------
// Format detection tests
// ---------------------------------------------------------------------------

describe('detectFormat', () => {
  it('detects collab-adr-lean from nav code headings', () => {
    const tokens = tokenize('# Title\n## Questions\n### QST: Some question')
    const result = detectFormat(tokens)
    expect(result.format).toBe('collab-adr-lean')
    expect(result.confidence).toBe('high')
  })

  it('detects collab-adr-lean from Quick Reference section', () => {
    const tokens = tokenize('# Title\n## Quick Reference\n## Iterations')
    const result = detectFormat(tokens)
    expect(result.format).toBe('collab-adr-lean')
  })

  it('detects standard MADR from Context and Problem Statement', () => {
    const tokens = tokenize(MADR_STANDARD)
    const result = detectFormat(tokens)
    expect(result.format).toBe('madr-standard')
    expect(result.confidence).toBe('high')
  })

  it('returns madr-partial for an ADR with title + sections but no known signals', () => {
    const tokens = tokenize('# My Decision\n## Background\n## Outcome')
    const result = detectFormat(tokens)
    expect(result.format).toBe('madr-partial')
  })

  it('returns unknown for content with no structure', () => {
    const tokens = tokenize('Just some plain text with no headings.')
    const result = detectFormat(tokens)
    expect(result.format).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// Full parseAdr tests
// ---------------------------------------------------------------------------

describe('parseAdr', () => {
  it('parses a collab-adr-lean ADR correctly', () => {
    const adr = parseAdr(COLLAB_ADR_LEAN_MINIMAL, '/fake/docs/adr/0001-project-specs.md')

    expect(adr.number).toBe(1)
    expect(adr.title).toBe('ADR-0001: Project Specifications')
    expect(adr.status).toBe('Accepted')
    expect(adr.iteration).toBe(2)
    expect(adr.deciders).toEqual(['Jérémie Lumbroso', 'Sonnet 4.6 (1M)'])
    expect(adr.format).toBe('collab-adr-lean')
  })

  it('extracts questions from a collab-adr-lean ADR', () => {
    const adr = parseAdr(COLLAB_ADR_LEAN_MINIMAL, '/fake/docs/adr/0001-project-specs.md')

    expect(adr.questions).toHaveLength(2)

    const q1 = adr.questions[0]
    expect(q1.text).toBe('What is the scope?')
    expect(q1.isAnswered).toBe(true) // has an ANS block even though status says unanswered
    expect(q1.answer?.text).toBe('This is a full replacement.')
    expect(q1.answer?.author).toBe('Jérémie')

    const q2 = adr.questions[1]
    expect(q2.text).toBe('Is the format stable?')
    expect(q2.statusText).toBe('answered')
    expect(q2.isAnswered).toBe(true)
  })

  it('parses iterations from a collab-adr-lean ADR', () => {
    const adr = parseAdr(COLLAB_ADR_LEAN_MINIMAL, '/fake/docs/adr/0001-project-specs.md')

    expect(adr.iterations).toHaveLength(2)
    expect(adr.iterations[0].number).toBe(1)
    expect(adr.iterations[0].date).toBe('2026-03-02')
    expect(adr.iterations[1].number).toBe(2)
    expect(adr.iterations[1].ai).toContain('Sonnet 4.6')
  })

  it('parses standard MADR without crashing', () => {
    const adr = parseAdr(MADR_STANDARD, '/fake/docs/adr/0003-auth.md')

    expect(adr.number).toBe(3)
    expect(adr.format).toBe('madr-standard')
    expect(adr.title).toContain('Authentication Architecture')
    expect(adr.questions).toHaveLength(0) // standard MADR has no QST blocks
  })

  it('warns about BULLET_FORMAT for asterisk-style metadata', () => {
    const adr = parseAdr(MADR_STANDARD, '/fake/docs/adr/0003-auth.md')

    const bulletWarnings = adr.parseWarnings.filter(w => w.code === 'BULLET_FORMAT')
    expect(bulletWarnings.length).toBeGreaterThan(0)
  })

  it('generates a stable checksum', () => {
    const content = COLLAB_ADR_LEAN_MINIMAL
    const adr1 = parseAdr(content, '/fake/0001.md')
    const adr2 = parseAdr(content, '/fake/0001.md')
    expect(adr1.checksum).toBe(adr2.checksum)

    const adr3 = parseAdr(content + '\n', '/fake/0001.md')
    expect(adr1.checksum).not.toBe(adr3.checksum)
  })

  it('generates deep links for all questions', () => {
    const adr = parseAdr(COLLAB_ADR_LEAN_MINIMAL, '/fake/docs/adr/0001-project-specs.md')
    const questionLinks = adr.deepLinks.filter(l => l.type === 'question')
    expect(questionLinks).toHaveLength(adr.questions.length)
  })

  it('warns about MISSING_STATUS when status field is absent', () => {
    const content = '# My ADR\n\n- **Date**: 2026-01-01\n\n## Context\nSome context.'
    const adr = parseAdr(content, '/fake/docs/adr/0005-missing-status.md')
    const statusWarnings = adr.parseWarnings.filter(w => w.code === 'MISSING_STATUS')
    expect(statusWarnings).toHaveLength(1)
    expect(adr.status).toBe('Draft') // fallback
  })

  it('warns about UNKNOWN_STATUS for non-canonical status values', () => {
    const content = '# My ADR\n\n- **Status**: proposed\n\n## Context\nSome context.'
    const adr = parseAdr(content, '/fake/docs/adr/0006-unknown-status.md')
    const statusWarnings = adr.parseWarnings.filter(w => w.code === 'UNKNOWN_STATUS')
    expect(statusWarnings).toHaveLength(1)
  })

  it('ADR-0014 Decision 2: parses the "awaiting" preamble field as free-form text', () => {
    const content = '# My ADR\n\n- **Status**: Partially Implemented\n- **Scope Remaining**: MCP\n- **Awaiting**: human review of the tool spec\n\n## Context\nSome context.'
    const adr = parseAdr(content, '/fake/docs/adr/0008-awaiting.md')
    expect(adr.awaiting).toBe('human review of the tool spec')
    expect(adr.awaitingCondition).toBeUndefined()
  })

  it('ADR-0014 Iteration 2: parses the "ADR-NNNN == predicate" DSL inside "awaiting"', () => {
    const content = '# My ADR\n\n- **Status**: Draft\n- **Awaiting**: ADR-0035 == implemented\n\n## Context\nSome context.'
    const adr = parseAdr(content, '/fake/docs/adr/0009-awaiting-dsl.md')
    expect(adr.awaiting).toBe('ADR-0035 == implemented')
    expect(adr.awaitingCondition).toEqual({ adr: '0035', predicate: 'implemented' })
  })

  it('ADR-0014 D6.5: tolerates unbold preamble Status field ("- Status: Draft") — no false MISSING_STATUS', () => {
    // Regression: temp/misc-problem-adr-08-with-tooltip/README.md — an unbold
    // "- Status: Draft" preamble field previously fired MISSING_STATUS even
    // though the field is present. Postel's Law (ADR-0012): parser accepts
    // and extracts the value; the normalizer's D6.5 handler proposes the bold form.
    const content = '# My ADR\n\n- Status: Draft\n\n## Context\nSome context.'
    const adr = parseAdr(content, '/fake/docs/adr/0007-unbold-status.md')
    expect(adr.status).toBe('Draft')
    expect(adr.parseWarnings.some(w => w.code === 'MISSING_STATUS')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Slug generation tests
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('converts text to lowercase hyphen-separated slug', () => {
    expect(slugify('What is the scope?')).toBe('what-is-the-scope')
  })

  it('removes special characters', () => {
    expect(slugify('QST: Auth & Security!')).toBe('qst-auth-security')
  })

  it('collapses multiple spaces and hyphens', () => {
    expect(slugify('  multiple   spaces  ')).toBe('multiple-spaces')
  })

  it('handles empty string', () => {
    expect(slugify('')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Regression tests
// ---------------------------------------------------------------------------

describe('Regression tests', () => {
  it('should not crash on ADR file with only a title heading (empty document)', () => {
    // Regression: early version of extractor threw when sections array was empty
    const content = '# Minimal ADR\n\n'
    const adr = parseAdr(content, '/fake/docs/adr/0001-minimal.md')
    expect(adr.title).toBe('Minimal ADR')
    expect(adr.sections).toHaveLength(0)
    expect(adr.questions).toHaveLength(0)
    expect(adr.parseWarnings.some(w => w.code === 'MISSING_STATUS')).toBe(true)
  })

  it('should handle a QST with no ANS block (answer placeholder not filled)', () => {
    // Real case: collab-adr-lean ADR with unanswered questions (the normal state)
    const content = `# ADR-0002: Parser

- **Status**: Draft
- **Iteration**: 1

## Questions

### QST: Which parser library?
- Status: unanswered
- Why asking: Affects bundle size.
- Need: yes/no with reasoning

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0002-parser.md')
    expect(adr.questions).toHaveLength(1)
    expect(adr.questions[0].isAnswered).toBe(false)
    expect(adr.questions[0].answer).toBeUndefined()
  })

  it('should not treat # headings inside fenced code blocks as document headings', () => {
    // Bug: ADR-0005 title was parsed as "# CLAUDE.md - Project Guidance ← header (always)"
    // because the tokenizer didn't skip heading detection inside fenced code blocks.
    // Fixed in commit: fenced code block tracking added to tokenizer.ts
    const content = `# ADR-0005: CLAUDE.md Parser

- **Status**: Draft

## Supporting Materials

### NOT: CLAUDE.md structure observed in this project

\`\`\`
# CLAUDE.md - Project Guidance          ← header (always)
  - Project / Human / AI / Last Updated ← project context fields
## Prime Directive                       ← framework directive (numbered)
\`\`\`

More content here.
`
    const adr = parseAdr(content, '/fake/docs/adr/0005-claudemd-parser.md')
    expect(adr.title).toBe('ADR-0005: CLAUDE.md Parser')
    expect(adr.number).toBe(5)
  })

  it('should extract the recommendation field from a QST block', () => {
    // Regression: recommendation was defined in types.ts but never populated by the extractor
    const content = `# ADR-0002: Parser

- **Status**: Draft

## Questions

### QST: Which deep-link approach?
- Status: unanswered
- Why asking: Affects stability of cross-file references.
- Need: pick one

**Option A**: Slug from heading text
- Pros: human-readable

**My recommendation**: Option A with HTML comment override as opt-in.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0002-parser.md')
    expect(adr.questions).toHaveLength(1)
    expect(adr.questions[0].recommendation).toBe('Option A with HTML comment override as opt-in.')
  })

  it('should extract a protocol-form recommendation spanning blank lines (ADR-0019 bridge)', () => {
    // Regression (2026-07-05): the extractor only knew the legacy
    // **My recommendation**: pattern, so QSTs reformatted to the protocol form
    // (**Recommendation**: (by Author, date) + multi-paragraph body, commit
    // 3b49a8e) parsed with recommendation === undefined and rendered nothing
    // in the Open Questions panel. Interim bridge documented in ADR-0019
    // ("the bridge is small and ships first"); caught live by the real-file
    // cross-check tests after Jérémie's first-wave answer edits to ADR-0003.
    const content = `# ADR-0002: Parser

- **Status**: Draft

## Questions

### QST: Which deep-link approach?
- Status: unanswered
- Why asking: Affects stability of cross-file references.
- Need: pick one

**Recommendation**: (by Sonnet 4.6, 2026-03-05)

First paragraph of the recommendation.

Second paragraph after a blank line, with \`list_tools\` detail.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0002-parser.md')
    expect(adr.questions).toHaveLength(1)
    const rec = adr.questions[0].recommendation
    expect(rec).toContain('(by Sonnet 4.6, 2026-03-05)')
    expect(rec).toContain('First paragraph of the recommendation.')
    expect(rec).toContain('Second paragraph after a blank line')
  })

  it('should accumulate stacked protocol-form recommendations from multiple models', () => {
    // Regression companion (2026-07-05): stacked blocks — several models
    // recommending on the same QST — are the live shape of ADR-0003 after the
    // 2026-06-10 reformat. Until ADR-0019's multi-recommendation model lands,
    // the bridge concatenates the stack (no silent loss of the later blocks).
    const content = `# ADR-0002: Parser

- **Status**: Draft

## Questions

### QST: Which deep-link approach?
- Status: unanswered

**Recommendation**: (by Sonnet 4.6, 2026-03-05)

Original proposal text.

**Recommendation**: (by Fable 5, 2026-05-24)

Overtaken by events — recommend closing.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0002-parser.md')
    const rec = adr.questions[0].recommendation
    expect(rec).toContain('Original proposal text.')
    expect(rec).toContain('(by Fable 5, 2026-05-24)')
    expect(rec).toContain('Overtaken by events')
  })

  it('ADR-0019: splits stacked protocol-form recommendations into attributed Recommendation objects', () => {
    // Same fixture as the accumulation test above, but asserting the
    // per-block, per-author array used for stacked panel rendering with
    // attribution chips (ADR-0019) — distinct blocks, not one flat string.
    const content = `# ADR-0002: Parser

- **Status**: Draft

## Questions

### QST: Which deep-link approach?
- Status: unanswered

**Recommendation**: (by Sonnet 4.6, 2026-03-05)

Original proposal text.

**Recommendation**: (by Fable 5, 2026-05-24)

Overtaken by events — recommend closing.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0002-parser.md')
    const recs = adr.questions[0].recommendations
    expect(recs).toHaveLength(2)
    expect(recs![0]).toMatchObject({ author: 'Sonnet 4.6', date: '2026-03-05', authorInferred: undefined })
    expect(recs![0].text).toBe('Original proposal text.')
    expect(recs![1]).toMatchObject({ author: 'Fable 5', date: '2026-05-24' })
    expect(recs![1].text).toContain('Overtaken by events')
  })

  it('ADR-0019: "(by Author)" protocol form with no date leaves date undefined', () => {
    const content = `# ADR-0002: Parser

- **Status**: Draft

## Questions

### QST: Which deep-link approach?
- Status: unanswered

**Recommendation**: (by Sonnet 4.6)

Confirm as-is.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0002-parser.md')
    const recs = adr.questions[0].recommendations
    expect(recs).toHaveLength(1)
    expect(recs![0].author).toBe('Sonnet 4.6')
    expect(recs![0].date).toBeUndefined()
    expect(recs![0].authorInferred).toBeUndefined()
  })

  // Fixture-escape (Lapidary 5, 2026-07-15/16 — Format Stability Council
  // convening, Item 0): our OWN fixture-workspace/docs/adr/0002-primary-
  // datastore.md rendered attribution-only, body escaped as unstyled prose
  // — in the demo we ship to strangers. Root cause: the model name itself
  // contains a paren ("Sonnet 4.6 (1M)"), and the old REC_ATTRIBUTION_RE
  // excluded ")" from the author-name character class entirely (to find
  // the "real" close paren before an optional ", date") — so it couldn't
  // span the nested paren and failed to match at all. recProtocolForm
  // computed false, and the multi-paragraph body escaped past the first
  // blank line into rawBodyPost, exactly like the v0.7.10 rec-extent
  // escape but triggered by a different mechanism.
  it('protocol-form attribution whose author name itself contains a paren still spans the multi-paragraph body', () => {
    const content = `# ADR-0002: Test

## Questions

### QST: Test?
- Status: unanswered

**Recommendation**: (by Sonnet 4.6 (1M), 2026-06-10)

**Ship it.** First paragraph of justification, several sentences long, explaining the reasoning in detail.

**ANS:** (by Human)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0002-test.md')
    const rec = adr.questions[0].recommendations![0]
    expect(rec.author).toBe('Sonnet 4.6 (1M)')
    expect(rec.date).toBe('2026-06-10')
    expect(rec.text).toContain('Ship it.')
    expect(rec.text).toContain('First paragraph of justification')
    expect(adr.questions[0].rawBodyPost).toBeUndefined()
  })

  // Ground truth: our real fixture-workspace demo file, exact shape.
  it('ground truth: fixture-workspace/docs/adr/0002-primary-datastore.md — both QSTs\' recommendations fully captured', () => {
    const content = `# ADR-0002: Primary Datastore — Embedded SQLite vs. Postgres

## Questions

### QST-SCALE: Should we plan for horizontal scaling from day one, or ship SQLite and migrate later if a hosted tier happens?

<!-- @adr-anchor: horizontal-scaling-from-day-one -->

- Status: unanswered
- Why asking: This is the ADR-0001 tension again, one layer down.
- Need: a decision, or an explicit "defer until the hosted tier is real"

**Recommendation**: (by Sonnet 4.6 (1M), 2026-06-10)

**Ship SQLite now; treat the Postgres migration as a scoped, deferred task, not a design constraint on today's schema.** SQLite's write-serialization is a real limit, but it's a *hosted-tier* limit — a single household doing occasional concurrent writes will never observe it (SQLite's WAL mode handles concurrent readers plus one writer without contention that a human would notice).

**ANS:** (by Ren Okafor)
[Fill this in]

---

### QST: How do we handle concurrent writes from multiple household members on the same pantry?
- Status: unanswered
- Why asking: Even without the hosted-tier question, this is a real, near-term scenario.
- Need: a concurrency strategy for the common case (household-scale, not hosted-scale)

**Recommendation**: (by Sonnet 4.6 (1M), 2026-06-10)

**Last-write-wins at the row level, with a \`updated_at\` optimistic-concurrency check on the pantry-item table only** (not the whole schema). If two people toggle the same item within the same second, the second write wins.

**ANS:** (by Ren Okafor)
[Fill this in]

---
`
    const adr = parseAdr(content, '/fake/docs/adr/0002-primary-datastore.md')
    expect(adr.questions).toHaveLength(2)
    for (const q of adr.questions) {
      expect(q.recommendations).toHaveLength(1)
      expect(q.recommendations![0].author).toBe('Sonnet 4.6 (1M)')
      expect(q.recommendations![0].date).toBe('2026-06-10')
      expect(q.rawBodyPost).toBeUndefined()
    }
    expect(adr.questions[0].recommendations![0].text).toContain('Ship SQLite now')
    expect(adr.questions[1].recommendations![0].text).toContain('Last-write-wins at the row level')
  })

  it('ADR-0019 QST-1: legacy "**My recommendation**:" infers author from Deciders, marked authorInferred', () => {
    const content = `# ADR-0002: Parser

- **Status**: Draft
- **Deciders**: Jérémie Lumbroso, Sonnet 4.6 (1M)

## Questions

### QST: Which deep-link approach?
- Status: unanswered

**My recommendation**: Option A with HTML comment override as opt-in.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0002-parser.md')
    const recs = adr.questions[0].recommendations
    expect(recs).toHaveLength(1)
    expect(recs![0]).toMatchObject({
      author: 'Sonnet 4.6', // "Sonnet 4.6 (1M)" → stripped parenthetical
      authorInferred: true,
      text: 'Option A with HTML comment override as opt-in.',
    })
  })

  it('ADR-0019: legacy recommendation with no AI decider leaves author/authorInferred undefined', () => {
    const content = `# ADR-0002: Parser

- **Status**: Draft

## Questions

### QST: Which deep-link approach?
- Status: unanswered

**My recommendation**: Option A with HTML comment override as opt-in.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0002-parser.md')
    const recs = adr.questions[0].recommendations
    expect(recs).toHaveLength(1)
    expect(recs![0].author).toBeUndefined()
    expect(recs![0].authorInferred).toBeUndefined()
    expect(recs![0].text).toBe('Option A with HTML comment override as opt-in.')
  })

  it('ADR-0019: extracts the bold-first-sentence "pick" when present', () => {
    const content = `# ADR-0002: Parser

- **Status**: Draft

## Questions

### QST: Which deep-link approach?
- Status: unanswered

**Recommendation**: (by Fable 5, 2026-06-10)

**B — infer from Deciders, marked as inferred; explicitly not C.** The inference is almost always correct.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0002-parser.md')
    const recs = adr.questions[0].recommendations
    expect(recs![0].pick).toBe('B — infer from Deciders, marked as inferred; explicitly not C.')
    expect(recs![0].text).toContain('The inference is almost always correct.')
  })

  it('recommendations[] is undefined when there is no recommendation block', () => {
    const content = `# ADR-0002: Parser

- **Status**: Draft

## Questions

### QST: Which deep-link approach?
- Status: unanswered

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0002-parser.md')
    expect(adr.questions[0].recommendations).toBeUndefined()
  })

  it('should keep legacy recommendation blank-line termination intact (ADR-0010 behavior)', () => {
    // Guard: the bridge must not change how legacy **My recommendation**:
    // blocks terminate — a blank line still ends them, and trailing orphaned
    // prose still lands in rawBodyPost (the pre-reformat ADR-0003 shape).
    const content = `# ADR-0002: Parser

- **Status**: Draft

## Questions

### QST: Which deep-link approach?
- Status: unanswered

**My recommendation**: Option A, single paragraph.

Orphaned closing remark after the block.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0002-parser.md')
    const q = adr.questions[0]
    expect(q.recommendation).toBe('Option A, single paragraph.')
    expect(q.rawBodyPost).toContain('Orphaned closing remark after the block.')
  })

  it('should exclude answered questions from the unanswered list after status changes', () => {
    // Regression (2026-03-12): Off-by-one in the Open Questions panel when answering
    // the second-to-last question (ADR-0010, Problem 6).
    //
    // Root cause: the webview's 'answered' handler and the 'questions' refresh handler
    // both advanced idx independently, causing a double-move. The fix designates the
    // 'questions' refresh as the sole owner of idx advancement.
    //
    // This test verifies the invariant the fix relies on: after a file is saved with
    // "Status: answered", the parser produces N-1 open questions. The refresh handler
    // receives exactly the right list — the answered question is gone, not duplicated.
    const content = `# ADR-0001: Test

- **Status**: Draft

## Questions

### QST: First question
- Status: answered
- Why asking: Testing the invariant.
- Need: yes/no

**ANS:** (by Jérémie)
The answer is yes.

---

### QST: Second question (should still be open)
- Status: unanswered
- Why asking: Testing the invariant.
- Need: yes/no

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-test.md')
    const open = adr.questions.filter(q => !q.isAnswered)
    expect(adr.questions).toHaveLength(2)
    expect(open).toHaveLength(1)
    expect(open[0].text).toBe('Second question (should still be open)')
    // If this breaks, the refresh sends a wrong-length array and the
    // single-owner idx advancement fix in the webview will be ineffective.
  })

  it('should parse an inline NOT that appears without a QST header', () => {
    // Real case: model adds **NOT:** observations inline within section bodies
    const content = `# ADR-0001: Specs

- **Status**: Draft

## AI Interpretation

**NOT:** (from Sonnet 4.6) This is a key observation that should be captured.

Some other content here.
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-specs.md')
    const nots = adr.inlineCodes.filter(c => c.code === 'NOT')
    expect(nots).toHaveLength(1)
    expect(nots[0].author).toBe('Sonnet 4.6')
  })
})

// ---------------------------------------------------------------------------
// Seed parser tests (ADR-0011: Seeds as First-Class Artifacts)
// ---------------------------------------------------------------------------

describe('Seed parser (seedExtractor.ts)', () => {
  const NEW_FORMAT_SEED = `# SEED: Auth Strategy Thoughts

- **Date**: 2026-03-07
- **From**: Jérémie Lumbroso

---

## Brain Dump

I've been thinking about whether to use JWT or session tokens.
The main tension is between statelessness and revocability.

---

**Model Response Request:**

- [ ] Chunk this into ADRs (I'm ready to formalize)
- [X] Iterate with me (keep exploring)
- [ ] Structure in place (organize but don't split)

---

## Thread

### Sonnet 4.6 - 2026-03-07

JWT gives you statelessness but makes revocation hard.
Session tokens are easy to revoke but require server-side state.
My recommendation: session tokens for now, JWT when you need multi-service.

---

**Model Response Request:**

- [ ] Chunk this into ADRs (I'm ready to formalize)
- [X] Iterate with me (keep exploring)
- [ ] Structure in place (organize but don't split)

### Jérémie - 2026-03-07

OK, let's go with sessions. What about refresh tokens?

---

## Derived Into

*(This seed has not yet been chunked into ADRs)*

<!-- comment -->
`

  it('should parse title, topic, date, and from fields', () => {
    const seed = parseSeed(NEW_FORMAT_SEED, '/fake/docs/adr/seed-2026-03-07-auth.md')
    expect(seed.title).toBe('SEED: Auth Strategy Thoughts')
    expect(seed.topic).toBe('Auth Strategy Thoughts')
    expect(seed.date).toBe('2026-03-07')
    expect(seed.from).toBe('Jérémie Lumbroso')
  })

  it('should extract the Brain Dump section', () => {
    const seed = parseSeed(NEW_FORMAT_SEED, '/fake/docs/adr/seed-2026-03-07-auth.md')
    expect(seed.brainDump).toBeDefined()
    expect(seed.brainDump).toContain('JWT or session tokens')
  })

  it('should parse thread entries with authors and dates', () => {
    // Real scenario: human and AI both contribute to a seed thread
    const seed = parseSeed(NEW_FORMAT_SEED, '/fake/docs/adr/seed-2026-03-07-auth.md')
    expect(seed.threadEntries).toHaveLength(2)
    expect(seed.threadEntries[0].author).toBe('Sonnet 4.6')
    expect(seed.threadEntries[0].date).toBe('2026-03-07')
    expect(seed.threadEntries[0].content).toContain('JWT gives you statelessness')
    expect(seed.threadEntries[1].author).toBe('Jérémie')
    expect(seed.threadEntries[1].content).toContain("let's go with sessions")
  })

  it('should parse Model Response Request checkboxes on thread entries', () => {
    // Real scenario: AI marks [X] Iterate to signal intent to keep exploring
    const seed = parseSeed(NEW_FORMAT_SEED, '/fake/docs/adr/seed-2026-03-07-auth.md')
    const firstEntry = seed.threadEntries[0]
    expect(firstEntry.request).toBeDefined()
    expect(firstEntry.request!.chunk).toBe(false)
    expect(firstEntry.request!.iterate).toBe(true)
    expect(firstEntry.request!.structure).toBe(false)
  })

  it('should report isProcessed=false when Derived Into has the placeholder', () => {
    const seed = parseSeed(NEW_FORMAT_SEED, '/fake/docs/adr/seed-2026-03-07-auth.md')
    expect(seed.isProcessed).toBe(false)
    expect(seed.derivedAdrs).toHaveLength(0)
    expect(seed.derivedIntoHasPlaceholder).toBe(true) // ADR-0016 precondition
  })

  it('should report isProcessed=true and parse derived ADRs when section has real content', () => {
    // Real scenario: Jérémie has chunked the seed into ADRs
    const processed = NEW_FORMAT_SEED.replace(
      '*(This seed has not yet been chunked into ADRs)*',
      '- ADR-0010: Open Questions UX\n- ADR-0011: Seeds as First-Class Artifacts',
    )
    const seed = parseSeed(processed, '/fake/docs/adr/seed-2026-03-07-auth.md')
    expect(seed.isProcessed).toBe(true)
    expect(seed.derivedAdrs).toHaveLength(2)
    expect(seed.derivedAdrs[0].number).toBe(10)
    expect(seed.derivedAdrs[0].title).toBe('Open Questions UX')
    expect(seed.derivedAdrs[1].number).toBe(11)
    expect(seed.derivedIntoHasPlaceholder).toBe(false)
  })

  it('should parse an older-style seed gracefully (no Thread section)', () => {
    // Real scenario: seeds written before the Thread format was established
    const oldSeed = `# SEED: Bug Reports

- **Date**: 2026-03-07
- **From**: Jérémie Lumbroso

---

## Problems

### Problem 1 — Markdown not rendering

The open questions panel shows raw markdown.

---
`
    const seed = parseSeed(oldSeed, '/fake/docs/adr/seed-2026-03-07-bug-reports.md')
    expect(seed.title).toBe('SEED: Bug Reports')
    expect(seed.topic).toBe('Bug Reports')
    expect(seed.date).toBe('2026-03-07')
    expect(seed.threadEntries).toHaveLength(0)
    expect(seed.isProcessed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ADR-0018 Step 2: QST/ANS substrate applied to seeds — questions embedded
// in a seed's Brain Dump / Thread were previously invisible to the panel
// categorically, not by bug (three layers excluded seed files by design).
// ---------------------------------------------------------------------------

describe('Seed parser — QST extraction (ADR-0018 Step 2)', () => {
  it('extracts a QST block from the Brain Dump section', () => {
    const seed = `# SEED: Storage Thoughts

- **Date**: 2026-07-07

---

## Brain Dump

Some prose here.

### QST: Which database engine?

- Status: unanswered
- Why asking: Affects deployment complexity.

**ANS:** (fill in)
`
    const parsed = parseSeed(seed, '/fake/docs/adr/seed-2026-07-07-storage.md')
    expect(parsed.questions).toHaveLength(1)
    expect(parsed.questions[0].text).toBe('Which database engine?')
    expect(parsed.questions[0].sourceKind).toBe('seed')
  })

  it('extracts a QST block from the Thread section', () => {
    const seed = `# SEED: Storage Thoughts

- **Date**: 2026-07-07

---

## Thread

### Sonnet 5 - 2026-07-07

### QST: Should we cache reads?

- Status: unanswered

**ANS:** (fill in)
`
    const parsed = parseSeed(seed, '/fake/docs/adr/seed-2026-07-07-storage.md')
    expect(parsed.questions).toHaveLength(1)
    expect(parsed.questions[0].text).toBe('Should we cache reads?')
  })

  it('gives seed questions a source-scoped id, not "adr-0000-..."', () => {
    const seed = `# SEED: Storage Thoughts

## Brain Dump

### QST: Which database engine?

- Status: unanswered

**ANS:** (fill in)
`
    const parsed = parseSeed(seed, '/fake/docs/adr/seed-2026-07-07-storage-thoughts.md')
    expect(parsed.questions[0].id).toBe('seed-2026-07-07-storage-thoughts-qst-which-database-engine')
    expect(parsed.questions[0].id).not.toContain('adr-0000')
  })

  it('parses status/why-asking/answer fields identically to ADR QSTs (shared field parser)', () => {
    const seed = `# SEED: Storage Thoughts

## Brain Dump

### QST: Which database engine?

- Status: answered
- Why asking: Affects deployment complexity.

**ANS:** (by Jérémie)
Postgres, we already run it elsewhere.
`
    const parsed = parseSeed(seed, '/fake/docs/adr/seed-2026-07-07-storage.md')
    const q = parsed.questions[0]
    expect(q.isAnswered).toBe(true)
    expect(q.whyAsking).toBe('Affects deployment complexity.')
    expect(q.answer?.text).toBe('Postgres, we already run it elsewhere.')
    expect(q.answer?.author).toBe('Jérémie')
  })

  it('recognizes a noncanonical QST heading the same way ADRs do (ADR-0024 reuse)', () => {
    const seed = `# SEED: Storage Thoughts

## Brain Dump

### qst: Which database engine?

- Status: unanswered
`
    const parsed = parseSeed(seed, '/fake/docs/adr/seed-2026-07-07-storage.md')
    expect(parsed.questions).toHaveLength(1)
    expect(parsed.questions[0].text).toBe('Which database engine?')
  })

  it('returns an empty questions array for a seed with no QST blocks', () => {
    const seed = `# SEED: Storage Thoughts

## Brain Dump

Just prose, no structured questions.
`
    const parsed = parseSeed(seed, '/fake/docs/adr/seed-2026-07-07-storage.md')
    expect(parsed.questions).toEqual([])
  })

  // Was: "does NOT extract QST blocks from sections other than Brain Dump /
  // Thread" (asserted toEqual([])). Flipped 2026-07-12 per Lapidary's
  // dispatch item 2 / Jérémie's ruling: a correctly-formatted seed QST
  // under "## Lineage" was silently invisible to the panel because
  // extractSeedQuestions() only ever descended into a fixed allowlist of
  // top-level section names. parseAdr() has never had that restriction —
  // it scans every top-level section uniformly — so the seed extractor now
  // matches it ("one substrate, two container kinds," ADR-0018). A QST
  // under an arbitrary heading (Derived Into, Lineage, or otherwise) is now
  // extracted the same way an ADR's would be.
  it('extracts QST blocks from ANY top-level section, not just Brain Dump / Thread', () => {
    const seed = `# SEED: Storage Thoughts

## Derived Into

### QST: Should this be extracted?

- Status: unanswered
`
    const parsed = parseSeed(seed, '/fake/docs/adr/seed-2026-07-07-storage.md')
    expect(parsed.questions).toHaveLength(1)
    expect(parsed.questions[0].text).toBe('Should this be extracted?')
  })

  // Ground-truth benchmark: the actual committed file Jérémie reported the
  // question invisible in (Lapidary's dispatch item 2, 2026-07-12) —
  // docs/adr/seed-2026-07-12-epistemic-programming-lane-doctrine.md. Its
  // QST lives under "## Lineage", several sections deep into a dictation-
  // shaped seed with no "## Thread"/"## Brain Dump" section at all.
  it('ground truth: extracts the QST from the real epistemic-programming-lane-doctrine seed', () => {
    const content = readAdr('seed-2026-07-12-epistemic-programming-lane-doctrine.md')
    const parsed = parseSeed(content, resolve(ADR_ROOT, 'seed-2026-07-12-epistemic-programming-lane-doctrine.md'))
    expect(parsed.questions).toHaveLength(1)
    expect(parsed.questions[0].text).toBe('Does "epistemic programming" become the project\'s public term of art?')
    expect(parsed.questions[0].isAnswered).toBe(false)
  })

  // Real specimen (Lapidary's dispatch item 2, 2026-07-12): a seed with
  // custom, dictation-shaped top-level section names ("## Lineage" among
  // others) whose QST was reported invisible in the panel on v0.7.3.
  it('specimen: a QST under "## Lineage" (the reported-invisible seed shape) is extracted', () => {
    const seed = `# Seed: "Epistemic programming"

- **Date**: 2026-07-12

## The raw material (verbatim, from ADR-0029 QST-C ANS)

> Some quoted material.

## Lineage (fished 2026-07-12 at Jérémie's request)

Some prose about lineage.

### QST: Does "epistemic programming" become the project's public term of art?

- Status: unanswered
- Why asking: The term appeared in an ANS block, not a decision.

**Recommendation**: Ratify it.

**ANS:** (by Jérémie)
[Fill this in]
`
    const parsed = parseSeed(seed, '/fake/docs/adr/seed-2026-07-12-epistemic-programming-lane-doctrine.md')
    expect(parsed.questions).toHaveLength(1)
    expect(parsed.questions[0].text).toBe('Does "epistemic programming" become the project\'s public term of art?')
    expect(parsed.questions[0].isAnswered).toBe(false)
  })

  // Item 1 of the same dispatch: a QST heading at the wrong LEVEL (h2/h4
  // instead of h3) should still parse — silently dropping it is the same
  // nemesis class NONCANONICAL_NAV_CODE_HEADING already covers for heading
  // FORM (case/colon spacing); this is the LEVEL axis. Louder than the
  // form-deviation warning: mapped to DiagnosticSeverity.Warning in
  // extension.ts (parseWarningSeverity), not Information.
  it('tolerates a QST heading at the wrong level (## instead of ###) with a louder warning', () => {
    const seed = `# SEED: Storage Thoughts

## QST: Which database engine?

- Status: unanswered
`
    const parsed = parseSeed(seed, '/fake/docs/adr/seed-2026-07-07-storage.md')
    expect(parsed.questions).toHaveLength(1)
    expect(parsed.questions[0].text).toBe('Which database engine?')
    expect(parsed.parseWarnings.some(w => w.code === 'NONCANONICAL_NAV_CODE_LEVEL')).toBe(true)
  })

  it('tolerates a QST heading nested one level too deep (#### instead of ###)', () => {
    const seed = `# SEED: Storage Thoughts

## Brain Dump

#### QST: Which database engine?

- Status: unanswered
`
    const parsed = parseSeed(seed, '/fake/docs/adr/seed-2026-07-07-storage.md')
    expect(parsed.questions).toHaveLength(1)
    expect(parsed.parseWarnings.some(w => w.code === 'NONCANONICAL_NAV_CODE_LEVEL')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// SEED_INCOMPLETE cross-reference detection (ADR-0016 Decision 1, condition b)
// ---------------------------------------------------------------------------

describe('findReferencingAdrs (seedIndex.ts)', () => {
  const seedPath = '/fake/docs/adr/seed-2026-03-07-bug-reports.md'

  it('detects an ADR whose content mentions the seed filename stem', () => {
    const adrs = [
      { number: 10, title: 'Open Questions UX', content: 'Triggered by: seed-2026-03-07-bug-reports.md (Problems 1, 4, 6)' },
      { number: 11, title: 'Seeds as First-Class Artifacts', content: 'No relation here.' },
    ]
    const detected = findReferencingAdrs(seedPath, adrs)
    expect(detected).toEqual([{ number: 10, title: 'Open Questions UX' }])
  })

  it('returns an empty array when no ADR references the seed', () => {
    const adrs = [{ number: 5, title: 'Unrelated Decision', content: 'Nothing about seeds here.' }]
    expect(findReferencingAdrs(seedPath, adrs)).toEqual([])
  })

  it('detects multiple referencing ADRs, in index order', () => {
    const adrs = [
      { number: 10, title: 'Open Questions UX', content: 'seed-2026-03-07-bug-reports' },
      { number: 11, title: 'Seeds as First-Class Artifacts', content: 'see seed-2026-03-07-bug-reports.md Problem 4' },
    ]
    expect(findReferencingAdrs(seedPath, adrs)).toHaveLength(2)
  })

  it('does not false-positive on a coincidental date-only match (requires the full stem)', () => {
    // Only the bare date, not the full seed filename stem — should not match
    const adrs = [{ number: 12, title: 'Some Decision', content: 'Discussed on 2026-03-07 during standup.' }]
    expect(findReferencingAdrs(seedPath, adrs)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// looksLikeSeedByContent (seedIndex.ts) — ADR-0016 Iteration 2 precondition
// (Fable 5, 2026-05-24): seeds with drifted filenames (not "seed-*.md") are
// invisible to a filename-only scan, so SEED_INCOMPLETE can never fire for
// them. This is the content-based fallback half of that precondition.
// ---------------------------------------------------------------------------

describe('looksLikeSeedByContent (seedIndex.ts)', () => {
  it('detects a "# SEED:" title regardless of filename', () => {
    const content = '# SEED: Async question queue and temporal provenance\n\n- **Date**: 2026-07-05\n'
    expect(looksLikeSeedByContent(content)).toBe(true)
  })

  it('is case-insensitive on the SEED: prefix', () => {
    expect(looksLikeSeedByContent('# seed: lowercase title\n')).toBe(true)
  })

  it('tolerates a leading blank line (same tolerance as parseSeed)', () => {
    expect(looksLikeSeedByContent('\n# SEED: Leading blank line\n')).toBe(true)
  })

  it('does NOT flag an ADR title as a seed', () => {
    expect(looksLikeSeedByContent('# ADR-0001: Storage Backend\n')).toBe(false)
  })

  it('does NOT flag a DEBRIEF title as a seed', () => {
    expect(looksLikeSeedByContent('# DEBRIEF-001: In-progress panel answers destroyed\n')).toBe(false)
  })

  it('does NOT flag content with no heading in the first 5 lines', () => {
    expect(looksLikeSeedByContent('Just some text.\n\nNo heading here at all within the scan window.\n')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Question field extraction (coverage gaps from zoarium README)
// ---------------------------------------------------------------------------

/** ADR with rich QST fields in standard collab-adr-lean format */
const ADR_RICH_QUESTIONS = `# ADR-0001: Test ADR

- **Date**: 2026-03-16
- **Status**: Draft
- **Deciders**: Jérémie, Sonnet 4.6

---

## Questions

### QST: Should we use server-side rendering?

- Status: unanswered
- Why asking: Client-side hydration is expensive on low-end devices.
- Need: A clear preference before we start the build.

**My recommendation**: Use SSR for initial load, hydrate only interactive components.

**ANS:** (by Jérémie)

[Fill this in]

---

### QST: What caching strategy?

- Status: answered
- Why asking: Cache invalidation is the hardest part.
- Need: Specific TTLs per resource type.

**ANS:** (by Jérémie)

Use stale-while-revalidate with a 60s TTL for API responses.
`

describe('Question field extraction — standard collab-adr-lean format', () => {
  it('extracts whyAsking from a QST block', () => {
    const adr = parseAdr(ADR_RICH_QUESTIONS, '/fake/docs/adr/0001-test.md')
    expect(adr.questions[0].whyAsking).toBe('Client-side hydration is expensive on low-end devices.')
  })

  it('extracts need from a QST block', () => {
    const adr = parseAdr(ADR_RICH_QUESTIONS, '/fake/docs/adr/0001-test.md')
    expect(adr.questions[0].need).toBe('A clear preference before we start the build.')
  })

  it('extracts recommendation from a QST block', () => {
    const adr = parseAdr(ADR_RICH_QUESTIONS, '/fake/docs/adr/0001-test.md')
    expect(adr.questions[0].recommendation).toBe(
      'Use SSR for initial load, hydrate only interactive components.',
    )
  })

  it('marks question with [Fill this in] placeholder as unanswered', () => {
    const adr = parseAdr(ADR_RICH_QUESTIONS, '/fake/docs/adr/0001-test.md')
    expect(adr.questions[0].isAnswered).toBe(false)
  })

  it('marks question with real answer text as answered', () => {
    const adr = parseAdr(ADR_RICH_QUESTIONS, '/fake/docs/adr/0001-test.md')
    expect(adr.questions[1].isAnswered).toBe(true)
    expect(adr.questions[1].answer?.text).toBe(
      'Use stale-while-revalidate with a 60s TTL for API responses.',
    )
  })
})

// ---------------------------------------------------------------------------
// Zoarium: D2/D3 — bold field variants (current parser behavior)
// ---------------------------------------------------------------------------

const ZOO_D2_BOLD_FIELDS = `# ADR-0003: Widget Rendering

- **Date**: 2026-03-16
- **Status**: Draft

---

## Questions

### QST: Should we support client-side hydration?

- **Status**: unanswered
- **Why asking**: Some widgets need interactivity.
- **Need**: Decision on whether hydration is in scope.

**ANS:** (by Human)

[Fill this in]

---

### QST: Was this already decided?

- **Status**: answered
- **Why asking**: Double-checking prior decisions.

**ANS:** (by Human)

Yes, decided in the kickoff meeting.
`

describe('Zoarium D2/D3 — bold field variants: current parser behavior', () => {
  // ADR-0031 signal S2 (Riddle 5's crossfoot ADR-0029 specimen, 2026-07-14):
  // STATUS_LINE_RE now tolerates the bold form ("- **Status**:") alongside
  // plain — statusText is genuinely read from the file now, not defaulted.
  it('question with bold "- **Status**: unanswered" is correctly parsed (isAnswered=false)', () => {
    const adr = parseAdr(ZOO_D2_BOLD_FIELDS, '/fake/docs/adr/zoo/0003-widget.md')
    expect(adr.questions).toHaveLength(2)
    expect(adr.questions[0].isAnswered).toBe(false)
    expect(adr.questions[0].statusText).toBe('unanswered')
    expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_STATUS_LINE_FORM')).toBe(true)
  })

  it('bold "- **Why asking**:" is NOT parsed — whyAsking is undefined (display degradation)', () => {
    // WHY_ASKING_RE = /^-\s+Why asking:\s+/ requires plain field name.
    // Bold variant silently dropped → panel shows empty "Why asking" context.
    const adr = parseAdr(ZOO_D2_BOLD_FIELDS, '/fake/docs/adr/zoo/0003-widget.md')
    expect(adr.questions[0].whyAsking).toBeUndefined()
  })

  it('bold "- **Need**:" is NOT parsed — need is undefined', () => {
    const adr = parseAdr(ZOO_D2_BOLD_FIELDS, '/fake/docs/adr/zoo/0003-widget.md')
    expect(adr.questions[0].need).toBeUndefined()
  })

  it('question with bold "- **Status**: answered" is genuinely read as answered now', () => {
    const adr = parseAdr(ZOO_D2_BOLD_FIELDS, '/fake/docs/adr/zoo/0003-widget.md')
    expect(adr.questions[1].isAnswered).toBe(true)
    expect(adr.questions[1].statusText).toBe('answered')
  })
})

// ---------------------------------------------------------------------------
// Zoarium: D4 — collapsed ANS block (current parser behavior)
// ---------------------------------------------------------------------------

const ZOO_D4_COLLAPSED_ANS = `# ADR-0002: Python Package Toolchain

- **Date**: 2026-03-16
- **Status**: Draft

---

## Questions

### QST: Should we pin to a specific version?

- Status: unanswered
- Why asking: Latest install may include breaking changes.

**ANS:** (fill in)

---

### QST: Should we publish to PyPI?

- Status: unanswered
- Why asking: Affects install story for end users.

**ANS:** (fill in)
`

describe('Zoarium D4 — collapsed ANS block: current parser behavior', () => {
  // Was: "'**ANS:** (fill in)' causes question to be treated as ANSWERED —
  // the primary blocker" (asserted 0 unanswered — documenting the bug as a
  // known limitation). Fixed 2026-07-13 (Riddle 5's ADR-0031 Phase A′):
  // "(fill in)" peels to "fill in" via stripPlaceholderWrapper (paren-
  // wrapped, no italics) and is now in PLACEHOLDER_LEXICON_RE — recognized
  // as a non-canonical placeholder (NONSTANDARD_FILL_PLACEHOLDER), not a
  // real answer. Both zoo-001/zoo-003 questions now correctly surface as
  // unanswered without needing the D4 normalizer pass first.
  it('"**ANS:** (fill in)" is recognized as an unanswered placeholder, not a real answer', () => {
    const adr = parseAdr(ZOO_D4_COLLAPSED_ANS, '/fake/docs/adr/zoo/0002-toolchain.md')
    expect(adr.questions).toHaveLength(2)
    expect(adr.questions.filter(q => !q.isAnswered)).toHaveLength(2)
    expect(adr.parseWarnings.filter(w => w.code === 'NONSTANDARD_FILL_PLACEHOLDER')).toHaveLength(2)
  })

  it('after D4 normalization, both questions surface correctly', () => {
    const normalized = ZOO_D4_COLLAPSED_ANS
      .replaceAll('**ANS:** (fill in)', '**ANS:** (by Human)\n\n[Fill this in]')
    const adr = parseAdr(normalized, '/fake/docs/adr/zoo/0002-toolchain.md')
    expect(adr.questions).toHaveLength(2)
    expect(adr.questions[0].isAnswered).toBe(false)
    expect(adr.questions[1].isAnswered).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Zoarium: D1 — "Open Questions" section name (current parser behavior)
// ---------------------------------------------------------------------------

const ZOO_D1_OPEN_QUESTIONS = `# ADR-0001: Storage Backend

- **Date**: 2026-03-16
- **Status**: Draft

---

## Context

Some background context here.

---

## Open Questions

### QST: Which database?

- Status: unanswered
- Why asking: Affects deployment complexity.

**ANS:** (by Human)

[Fill this in]
`

describe('Zoarium D1 — "Open Questions" section name: current parser behavior', () => {
  it('QST headings inside "## Open Questions" ARE indexed — questions surface', () => {
    // The parser finds ### QST: headings by navCode, not by parent section name.
    // D1 does NOT prevent questions from appearing in the tree.
    const adr = parseAdr(ZOO_D1_OPEN_QUESTIONS, '/fake/docs/adr/zoo/0001-storage.md')
    expect(adr.questions).toHaveLength(1)
    expect(adr.questions[0].text).toBe('Which database?')
  })

  it('"Open Questions" section heading is NOT "Questions" — exact-match lookup fails', () => {
    // Historical note: the panel's context box used to anchor on
    // adr.sections.find(s => s.heading === 'Questions') — undefined here →
    // boundary = Infinity → the ADR context box showed the entire file.
    // Fixed 2026-07-14 (overfly hq ADR-0031 incident): the boundary is now
    // DERIVED from question positions (parser/adrContext.ts), so this
    // name-lookup fact no longer controls the panel. Kept as a parser-level
    // fact check; panel behavior is covered in adrContext.test.ts.
    const adr = parseAdr(ZOO_D1_OPEN_QUESTIONS, '/fake/docs/adr/zoo/0001-storage.md')
    expect(adr.sections.find(s => s.heading === 'Questions')).toBeUndefined()
    expect(adr.sections.find(s => s.heading === 'Open Questions')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Zoarium: D5 — multi-line field values (word-wrapped by LLM at ~80 chars)
// Source: temp/misc-problem-adr-02/009-pdf-visual-review-mcp.md
// All three QSTs in that file have 2-space-indented continuation lines.
// Bug: WHY_ASKING_RE only captured the first line; continuation lines fell
// into rawBody and were displayed in the wrong position/context.
// ---------------------------------------------------------------------------

const ZOO_D5_MULTILINE_WHY = `# ADR-0009: PDF Visual Review MCP Server

---

## Questions

### QST: PyMuPDF vs pdf2image preference

- Status: unanswered
- Why asking: PyMuPDF has zero system deps (ships its own libmupdf binary);
  pdf2image requires poppler.  PyMuPDF is my preference but you may already
  have poppler installed via MacTeX.
- Need: yes/no + which you prefer

**ANS:** (by Jérémie Lumbroso)
[Fill this in]

---

### QST: MCP server process lifecycle

- Status: unanswered
- Why asking: Does Claude Code on your machine keep MCP servers running between
  sessions, or restart them each time?  Affects whether we need startup
  optimisation.
- Need: brief observation

**ANS:** (by Jérémie Lumbroso)
[Fill this in]

---

### QST: Reference PDF for diffs

- Status: unanswered
- Why asking: For \`pdf_diff_page\` to be useful we need a "golden" reference PDF
  checked into the repo (or stored somewhere).  Should we commit a reference
  PDF, or generate one on-demand and stash it locally?
- Need: preferred approach

**ANS:** (by Jérémie Lumbroso)
[Fill this in]
`

describe('Zoarium D5 — multi-line field values (word-wrapped continuations)', () => {
  const adr = parseAdr(ZOO_D5_MULTILINE_WHY, '/fake/docs/adr/zoo/0009-pdf-mcp.md')

  it('parses all three questions as unanswered', () => {
    expect(adr.questions).toHaveLength(3)
    expect(adr.questions.every(q => !q.isAnswered)).toBe(true)
  })

  it('QST-1: whyAsking includes ALL continuation lines, not just the first', () => {
    // Bug: only "PyMuPDF has zero system deps (ships its own libmupdf binary);"
    // was captured; continuation lines went to rawBody instead.
    const q = adr.questions[0]
    expect(q.whyAsking).toContain('PyMuPDF has zero system deps')
    expect(q.whyAsking).toContain('pdf2image requires poppler')
    expect(q.whyAsking).toContain('poppler installed via MacTeX')
  })

  it('QST-1: need is correctly parsed (field after multi-line whyAsking)', () => {
    expect(adr.questions[0].need).toBe('yes/no + which you prefer')
  })

  it('QST-1: rawBody is empty — continuation lines must NOT appear there', () => {
    // Before the fix, "pdf2image requires poppler..." appeared in rawBody,
    // showing below the Need box instead of as part of Why asking.
    const q = adr.questions[0]
    expect(q.rawBody ?? '').not.toContain('pdf2image requires poppler')
    expect(q.rawBody ?? '').not.toContain('poppler installed via MacTeX')
  })

  it('QST-2: multi-line whyAsking spanning 3 lines fully captured', () => {
    const q = adr.questions[1]
    expect(q.whyAsking).toContain('keep MCP servers running between')
    expect(q.whyAsking).toContain('restart them each time')
    expect(q.whyAsking).toContain('startup')
    expect(q.whyAsking).toContain('optimisation')
  })

  it('QST-3: whyAsking with inline backtick code across continuation lines', () => {
    const q = adr.questions[2]
    expect(q.whyAsking).toContain('pdf_diff_page')
    expect(q.whyAsking).toContain('golden')
    expect(q.whyAsking).toContain('checked into the repo')
    expect(q.whyAsking).toContain('generate one on-demand')
  })
})

// ---------------------------------------------------------------------------
// Hard-wrap robustness (Lapidary 5, 2026-07-13 reframe of the 0420 brief) —
// distinct from the D5 suite above. D5's continuations are INDENTED (soft
// word-wrap, 2-space hanging indent, already handled). Hard-wrapping (an
// editor folding prose at a fixed column) produces FLUSH-LEFT continuation
// lines with no indent at all — a different morphology, unhandled by the
// existing isContinuation logic for anything other than Why-asking/Need.
// Jérémie: "there's *never* a time where you want" a viewport's line-fold
// baked into the substrate — the fix is robustness at extraction time, not
// a recommendation to avoid hard-wrapping (that's the separate, weaker,
// diagnostic-only ask in the same charter).
// ---------------------------------------------------------------------------

describe('Hard-wrap robustness: rawBody option bullets', () => {
  it('a hard-wrapped option bullet (flush-left continuation, no indent) joins into one line in rawBody', () => {
    const content = `# ADR-0021: Test

## Questions

### QST: When does wave 2 trigger?
- Status: unanswered
- Why asking: MCP/Relay and Assayer seats should land on substrate, not idle.
- Need: criterion confirmation

- **A — Calendar**: fixed date.
- **B — Milestone**: when the pipeline round-trips a real email end-to-end
  (intake → match → extract → draft → validation surface), so the MCP server
  exposes something true and the Assayer has a working loop to mine.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0021-test.md')
    const rawBody = adr.questions[0].rawBody ?? ''
    expect(rawBody).toContain('- **B — Milestone**: when the pipeline round-trips a real email end-to-end (intake → match → extract → draft → validation surface), so the MCP server exposes something true and the Assayer has a working loop to mine.')
    // The continuation lines must not survive as separate lines — that's
    // exactly what let the webview's line-based list renderer treat them
    // as sibling paragraphs instead of part of Option B's <li>.
    expect(rawBody.split('\n')).toHaveLength(2)
  })

  it('does not merge two distinct option bullets into one', () => {
    const content = `# ADR-0021: Test

## Questions

### QST: Test?
- Status: unanswered

- **A — First option**: short.
- **B — Second option**: also short.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0021-test.md')
    const rawBody = adr.questions[0].rawBody ?? ''
    expect(rawBody.split('\n')).toEqual([
      '- **A — First option**: short.',
      '- **B — Second option**: also short.',
    ])
  })
})

describe('Hard-wrap robustness: recommendation text', () => {
  it('a hard-wrapped legacy-form recommendation joins into one flowing paragraph', () => {
    const content = `# ADR-0021: Test

## Questions

### QST: When does wave 2 trigger?
- Status: unanswered

**Recommendation** (by Athanor 5, Claude Fable 5): **B — milestone-triggered.**
Same argument as the Tablée two-wave decision: stable intermediate forms.
A calendar trigger could seat the MCP/Relay before there is anything to relay.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0021-test.md')
    const rec = adr.questions[0].recommendations![0]
    expect(rec.text).toBe(
      '**B — milestone-triggered.** Same argument as the Tablée two-wave decision: stable intermediate forms. A calendar trigger could seat the MCP/Relay before there is anything to relay.',
    )
    expect(rec.pick).toBe('B — milestone-triggered.')
    expect(rec.author).toBe('Athanor 5, Claude Fable 5')
  })

  it('a hard-wrapped protocol-form recommendation joins lines within each paragraph, keeps paragraph breaks', () => {
    const content = `# ADR-0021: Test

## Questions

### QST: Test?
- Status: unanswered

**Recommendation**: (by Fable 5, 2026-07-13)

First paragraph wraps
across two lines.

Second paragraph is
also wrapped.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0021-test.md')
    const rec = adr.questions[0].recommendations![0]
    expect(rec.author).toBe('Fable 5')
    expect(rec.text).toBe('First paragraph wraps across two lines.\n\nSecond paragraph is also wrapped.')
  })
})

// Ground truth: Athanor 5's actual inbox-alchemy ADR-0021, verbatim as
// originally authored (hard-wrapped), before the manual unwrap-adrs.mjs
// pass (inbox-alchemy commit 031dacf). This is Lapidary's named test of
// done: "Athanor's original wrapped 0021 — un-unwrapped — renders and
// parses perfectly." Inlined (a different project's repo, not a fixture
// this repo can read from disk).
describe('Hard-wrap robustness: ground truth — Athanor\'s original wrapped inbox-alchemy 0021', () => {
  const content = `# ADR-0021: Crew Architecture, Staffing, and the Athanor Mission

- **Date**: 2026-07-12
- **Iteration**: 1
- **Status**: Accepted
- **Deciders**: Jérémie Lumbroso, Athanor 5 (Claude Fable 5)

---

## Questions

### QST: When does wave 2 trigger?
- Status: unanswered
- Why asking: MCP/Relay and Assayer seats should land on substrate, not idle.
- Need: criterion confirmation

- **A — Calendar**: fixed date.
- **B — Milestone**: when the pipeline round-trips a real email end-to-end
  (intake → match → extract → draft → validation surface), so the MCP server
  exposes something true and the Assayer has a working loop to mine.

**Recommendation** (by Athanor 5, Claude Fable 5): **B — milestone-triggered.**
Same argument as the Tablée two-wave decision: stable intermediate forms.
A calendar trigger could seat the MCP/Relay before there is anything to relay.

**ANS:** (by Jérémie Lumbroso)
[Fill this in]

---

### QST: Is the Assayer a persistent seat or on-demand subagent dispatches?
- Status: unanswered
- Why asking: Concept-mining (this repo + the adrs4ai corpus) is recurrent
  but bursty; the Tablée ADR judged corpus-shopping to be subagent work,
  while its Atelier precedent showed taste-accumulating streams deserve
  persistent seats.
- Need: option choice

- **A — On-demand first, graduate if recurrent**: Athanor dispatches scout
  subagents; if the assay proves to be a standing stream (Jérémie's research
  program suggests it might), mint the seat in wave 2.
- **B — Persistent seat from wave 2**: the assay accumulates taste (which
  concepts matter to Jérémie's fingerprint) the way Tablée's Atelier
  accumulates visual taste.

**Recommendation** (by Athanor 5, Claude Fable 5): **A — on-demand first.**
The first scout was dispatched 2026-07-12 (adrs4ai corpus inventory); its
yield will show whether the stream is standing or episodic. Graduation is
cheap; un-seating is awkward.

**ANS:** (by Jérémie Lumbroso)
[Fill this in]

---
`
  const adr = parseAdr(content, '/fake/docs/adr/0021-crew-architecture-and-staffing.md')

  it('recalls both questions, both unanswered', () => {
    expect(adr.questions).toHaveLength(2)
    expect(adr.questions.every(q => !q.isAnswered)).toBe(true)
  })

  it('QST-1: whyAsking, need, recommendation, and rawBody are all fully joined', () => {
    const q = adr.questions[0]
    expect(q.whyAsking).toBe('MCP/Relay and Assayer seats should land on substrate, not idle.')
    expect(q.need).toBe('criterion confirmation')
    expect(q.recommendations![0].text).not.toContain('\n')
    expect(q.rawBody?.split('\n')).toHaveLength(2)
  })

  it('QST-2: whyAsking spans 4 wrapped lines, fully joined; recommendation and rawBody joined', () => {
    const q = adr.questions[1]
    expect(q.whyAsking).toBe(
      'Concept-mining (this repo + the adrs4ai corpus) is recurrent but bursty; the Tablée ADR judged corpus-shopping to be subagent work, while its Atelier precedent showed taste-accumulating streams deserve persistent seats.',
    )
    expect(q.recommendations![0].text).not.toContain('\n')
    expect(q.rawBody?.split('\n')).toHaveLength(2)
  })

  it('no parse warnings — this is well-formed collab-adr-lean, just hard-wrapped', () => {
    expect(adr.parseWarnings).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Block-extent tail-swallow (Lapidary 5, 2026-07-13, grammar-seed +
// temp/0011-consent-ui-modes.md specimens). A subsection's body used to run
// until the next level>=3 heading, with no boundary at all for the LAST
// subsection in an enclosing section — so its body ran to the enclosing
// section's own end, swallowing a trailing "---" divider and whatever
// non-heading structural content followed it (a seed's "**Model Response
// Request:**" checkbox block; an ADR's own trailing "---" before the next
// top-level "##" section). Fixed in buildSubsections() by treating a bare
// thematic break as also closing the current subsection.
// ---------------------------------------------------------------------------

describe('Block-extent tail-swallow: the LAST question in a section', () => {
  it('does not swallow a trailing thematic break + seed-template checkbox block into rawBody', () => {
    const content = `# SEED: Test

## Brain Dump

### Open QSTs

### QST: First question?
- Status: unanswered
- Why asking: Reason one.

---

### QST: Last question?
- Status: unanswered
- Why asking: Reason two.

---

**Model Response Request:**

- [ ] Chunk this into ADRs
- [X] Iterate with me
- [ ] Structure in place

---

## Thread

### Someone — 2026-07-13
Some thread content.
`
    const seed = parseSeed(content, '/fake/docs/adr/seed-2026-07-13-test.md')
    expect(seed.questions).toHaveLength(2)
    const last = seed.questions[1]
    expect(last.rawBody ?? '').not.toContain('Model Response Request')
    expect(last.rawBody ?? '').not.toContain('Chunk this into ADRs')
    expect(last.whyAsking).toBe('Reason two.')
  })

  it('does not leave a trailing "---" divider in the last question\'s rawBody (ADR container)', () => {
    const content = `# ADR-0011: Test

## Questions

### QST: Only question?
- Status: unanswered
- Options:
  - A — first option.
  - B — second option.

Some prose discussing the trade-offs between the two options.

---

## Action Items

- [ ] Do the thing
`
    const adr = parseAdr(content, '/fake/docs/adr/0011-test.md')
    expect(adr.questions).toHaveLength(1)
    const q = adr.questions[0]
    expect((q.rawBody ?? '').trim()).not.toMatch(/^-{3,}$/m)
    expect(q.rawBody ?? '').not.toContain('---')
    expect(q.rawBody ?? '').toContain('Some prose discussing the trade-offs')
  })

  it('a mid-document QST (not the last) is unaffected — same behavior as before', () => {
    const content = `# ADR-0011: Test

## Questions

### QST: First?
- Status: unanswered

---

### QST: Second?
- Status: unanswered

---
`
    const adr = parseAdr(content, '/fake/docs/adr/0011-test.md')
    expect(adr.questions).toHaveLength(2)
    expect(adr.questions[0].text).toBe('First?')
    expect(adr.questions[1].text).toBe('Second?')
  })
})

// ---------------------------------------------------------------------------
// Dash-bullet Recommendation form (Lapidary 5, 2026-07-13, temp/0015-
// database-schema.md specimen): "- Recommendation: text" instead of the
// canonical standalone "**Recommendation**:" block. Lapidary's diagnosis:
// the model regularized toward LOCAL consistency — three dash-bullet
// fields (Status/Why asking/Need) in a row invite a fourth. Ground-truth
// verified against the real file: 3 plain "- Recommendation: text" cases
// plus one with an inline attribution, "- Recommendation (Azoth): text".
// ---------------------------------------------------------------------------

describe('Dash-bullet Recommendation form (NONSTANDARD_RECOMMENDATION_FORM)', () => {
  it('extracts a plain dash-bullet Recommendation with an inferred author', () => {
    const content = `# ADR-0015: Test

## Questions

### QST: Should we use pgvector?
- Status: unanswered
- Recommendation: **Use pgvector from day 1.** It is one line in the migration.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0015-test.md')
    expect(adr.questions[0].recommendations).toHaveLength(1)
    const rec = adr.questions[0].recommendations![0]
    expect(rec.text).toBe('**Use pgvector from day 1.** It is one line in the migration.')
    expect(rec.pick).toBe('Use pgvector from day 1.')
    expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_RECOMMENDATION_FORM')).toBe(true)
  })

  it('extracts a dash-bullet Recommendation with an inline attribution: "- Recommendation (Author): text"', () => {
    const content = `# ADR-0015: Test

## Questions

### QST: Which option?
- Status: unanswered
- Recommendation (Azoth): **C.** It's the only option that doesn't require a schema migration.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0015-test.md')
    const rec = adr.questions[0].recommendations![0]
    expect(rec.author).toBe('Azoth')
    expect(rec.authorInferred).toBeFalsy()
    expect(rec.text).toContain("It's the only option")
  })

  it('does NOT flag the canonical standalone "**Recommendation**:" block', () => {
    const content = `# ADR-0015: Test

## Questions

### QST: Test?
- Status: unanswered

**Recommendation**: (by Someone)

Some recommendation text.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0015-test.md')
    expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_RECOMMENDATION_FORM')).toBe(false)
  })

  it('ground truth: extracts all four dash-bullet Recommendations from the real temp/0015 specimen shape', () => {
    // Inlined (temp/ is gitignored, not a committed fixture) — the exact
    // shape of all four real occurrences in temp/0015-database-schema.md.
    const content = `# ADR-0015: Database Schema

## Questions

### QST: Should \`template_query_embeddings\` use pgvector's \`vector\` type or store as JSONB array?
- Status: unanswered
- Recommendation: **Use pgvector from day 1**. The \`CREATE EXTENSION vector;\` is literally one line in migration 0001.

**ANS:** (by Jérémie)
[Fill this in]

---

### QST: Should SQLAlchemy use async (asyncpg) or sync (psycopg2) in the application layer?
- Status: unanswered
- Recommendation: **Async SQLAlchemy throughout.** The \`asyncio_mode = "auto"\` setting confirms this was the intent.

**ANS:** (by Jérémie)
[Fill this in]

---

### QST: How should the test database be structured?
- Status: unanswered
- Recommendation: **Neon test branch for integration tests.** Neon branches are zero-cost copies of the schema.

**ANS:** (by Jérémie)
[Fill this in]

---

### QST: \`drafts.confidence REAL NOT NULL\` assumes a number the QA-checklist match model doesn't produce
- Status: unanswered
- Recommendation (Azoth): **C.** It's the only option that doesn't require a schema migration.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0015-database-schema.md')
    expect(adr.questions).toHaveLength(4)
    expect(adr.questions.every(q => q.recommendations && q.recommendations.length === 1)).toBe(true)
    expect(adr.questions[3].recommendations![0].author).toBe('Azoth')
    const formWarnings = adr.parseWarnings.filter(w => w.code === 'NONSTANDARD_RECOMMENDATION_FORM')
    expect(formWarnings).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// Regression tests: rawBody capture (ADR-0003 / ADR-0008 parsing failures)
// ---------------------------------------------------------------------------

describe('Regression tests: QST rawBody — content beyond recognized fields', () => {
  it('captures proposed grammar block between field lines and ANS (ADR-0008 pattern)', () => {
    // Bug: lines not matching STATUS/WHY/NEED/RECOMMENDATION/ANS were silently dropped.
    // ADR-0008 QSTs have "**Proposed grammar:**" + code block after the field lines.
    // These completely disappeared from the Open Questions panel.
    const content = `# ADR-0008: Deep Link Protocol

---

## Questions

### QST: What is the canonical local reference format?

- Status: unanswered
- Why asking: We use adr:0001 informally already.
- Need: Formal grammar so the parser can validate citations.

**Proposed grammar (local, Forma 3):**
\`\`\`
local_ref := "adr:" adr_num ("#" section_slug)?
adr_num   := [0-9]{4}
\`\`\`

Example: \`adr:0001#decision\`

**ANS:** (by Human)

[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0008-deep-link.md')
    expect(adr.questions).toHaveLength(1)
    expect(adr.questions[0].isAnswered).toBe(false)
    expect(adr.questions[0].rawBody).toBeDefined()
    expect(adr.questions[0].rawBody).toContain('Proposed grammar')
    expect(adr.questions[0].rawBody).toContain('local_ref')
    expect(adr.questions[0].rawBody).toContain('adr:0001#decision')
  })

  it('captures orphaned sentence after recommendation blank-line stop (ADR-0003 pattern)', () => {
    // Bug: recommendation parser stops at the first blank line. Sentences after the
    // blank line (e.g., "Add these to ADR-0003 supporting materials...") were dropped.
    // ADR-0003 line 358: "Add these to ADR-0003 supporting materials. The full tool
    // spec should live in ADR-0008 (see below)." — completely missing from panel.
    const content = `# ADR-0003: MCP Server Design

---

## Questions

### QST: What does Phase 4 need from Phase 3?

- Status: unanswered
- Why asking: Phase 4 is the first consumer of Phase 3 tools.
- Need: List of Phase 4 tool requirements.

**My recommendation**: Three tools Phase 4 specifically needs:
1. \`list_open_questions(fields: 'rich')\` — already specced
2. \`update_question_priority\` — not yet in any spec
3. \`get_claude_md\` — needed for directive management

Add these to ADR-0003 supporting materials. The full tool spec should live in ADR-0008.

**ANS:** (by Human)

[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0003-mcp.md')
    expect(adr.questions).toHaveLength(1)
    expect(adr.questions[0].recommendation).toBeDefined()
    expect(adr.questions[0].recommendation).toContain('Three tools Phase 4')
    // The orphaned sentence after the blank line must appear in rawBodyPost
    expect(adr.questions[0].rawBodyPost).toBeDefined()
    expect(adr.questions[0].rawBodyPost).toContain('Add these to ADR-0003 supporting materials')
    expect(adr.questions[0].rawBodyPost).toContain('ADR-0008')
  })

  it('captures cross-project grammar block (ADR-0008 global reference QST pattern)', () => {
    // ADR-0008 line 71: "**Proposed grammar (cross-project, Forma 3):**" + code block
    // + "**How namespace is resolved in Forma 3 (local):**" + bullet list — all missing.
    const content = `# ADR-0008: Deep Link Protocol

---

## Questions

### QST: What is the canonical global reference format?

- Status: unanswered
- Why asking: We use elenchus-app.0001 informally.
- Need: Formal cross-project grammar.

**Proposed grammar (cross-project, Forma 3):**
\`\`\`
xproject_ref := namespace "." adr_num ("#" section_slug)?
namespace    := [a-z0-9-]+
\`\`\`

**How namespace is resolved in Forma 3 (local):**
- If cloned locally, resolve via the local ADR directory
- If not available, show as unresolvable — graceful degradation

**ANS:** (by Human)

[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0008-deep-link.md')
    expect(adr.questions[0].rawBody).toBeDefined()
    expect(adr.questions[0].rawBody).toContain('Proposed grammar (cross-project')
    expect(adr.questions[0].rawBody).toContain('xproject_ref')
    expect(adr.questions[0].rawBody).toContain('How namespace is resolved')
  })

  it('does not include recognized field lines in rawBody', () => {
    // Status, Why asking, Need lines must NOT appear in rawBody
    const content = `# ADR-0001: Test

---

## Questions

### QST: Simple question with only field lines?

- Status: unanswered
- Why asking: Just a simple test.
- Need: Confirmation.

**ANS:** (by Human)

[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-test.md')
    // rawBody should be empty or undefined — no extra content
    const body = adr.questions[0].rawBody
    if (body !== undefined) {
      expect(body).not.toContain('Why asking')
      expect(body).not.toContain('Status')
      expect(body).not.toContain('Need:')
    }
  })
})

// ---------------------------------------------------------------------------
// Regression tests
// ---------------------------------------------------------------------------

describe('Regression tests', () => {
  it('should parse seed title when file starts with a leading blank line', () => {
    // Bug: parseSeed checked lines[0]?.startsWith('# ') for the title heading.
    // Files saved with a leading blank line (e.g. seed-2026-03-11-enforcing-adr-format-better.md)
    // had lines[0] === '' so the title fell back to the filename.
    // Fixed by scanning the first 5 lines instead of only lines[0].
    const content = `\n# SEED: Enforcing ADR Format Better\n\n- **Date**: 2026-03-11\n- **From**: Jérémie Lumbroso\n`
    const seed = parseSeed(content, '/fake/docs/adr/seed-2026-03-11-enforcing-adr-format-better.md')
    expect(seed.title).toBe('SEED: Enforcing ADR Format Better')
    expect(seed.topic).toBe('Enforcing ADR Format Better')
    expect(seed.date).toBe('2026-03-11')
  })

  it('should strip ADR prefix regardless of separator (space, hyphen, or none)', () => {
    // Bug (round 1): /^ADR-\d+/ only matched hyphen — "ADR 001:" was not stripped.
    // Bug (round 2): /^ADR[-\s]\d+/ required exactly one separator — "ADR001:" was not stripped.
    // Fixed by using [-\s]* (zero or more separators).
    const STRIP_RE = /^ADR[-\s]*\d+[:\s\-]+/i
    expect('ADR 001: Tech Stack'.replace(STRIP_RE, '').trim()).toBe('Tech Stack')   // space
    expect('ADR-0001: Tech Stack'.replace(STRIP_RE, '').trim()).toBe('Tech Stack')  // hyphen
    expect('ADR001: Tech Stack'.replace(STRIP_RE, '').trim()).toBe('Tech Stack')    // no separator
    expect('ADR-0028: Read Path Scope'.replace(STRIP_RE, '').trim()).toBe('Read Path Scope')
    // Should not strip titles that don't start with an ADR prefix
    expect('Tech Stack'.replace(STRIP_RE, '').trim()).toBe('Tech Stack')
  })

  // ADR-0024: `### qst:` (wrong case) and `### QST:Question` (glued colon) both
  // failed NAV_CODE_HEADING_RE's exact-match, case-sensitive test. navCode came
  // back undefined, collectQuestions() never built a Question, and the block
  // vanished from the Open Questions panel with zero diagnostic trail — a
  // worse failure mode than a wrong-but-loud parse warning. Fixed by accepting
  // a case-insensitive, glued-colon-tolerant form (Postel's law) while always
  // emitting NONCANONICAL_NAV_CODE_HEADING so the deviation is never silent.
  it('should recognize a lowercase nav code heading ("### qst:") and still flag it', () => {
    const content = `# ADR-0001: Storage choice

---

## Questions

### qst: Which database?

- Status: unanswered
- Why asking: Affects deployment complexity.
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-storage.md')
    expect(adr.questions).toHaveLength(1)
    expect(adr.questions[0].text).toBe('Which database?')
    const warning = adr.parseWarnings.find(w => w.code === 'NONCANONICAL_NAV_CODE_HEADING')
    expect(warning).toBeDefined()
    expect(warning?.message).toContain('QST: Which database?')
  })

  it('should recognize a glued-colon nav code heading ("### QST:Question") and still flag it', () => {
    const content = `# ADR-0001: Storage choice

---

## Questions

### QST:Which database?

- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-storage.md')
    expect(adr.questions).toHaveLength(1)
    expect(adr.questions[0].text).toBe('Which database?')
    expect(adr.parseWarnings.some(w => w.code === 'NONCANONICAL_NAV_CODE_HEADING')).toBe(true)
  })

  it('should slug a glued-colon nav code heading canonically, not merge the code into the first word', () => {
    // Without the tolerant fallback in sectionSlug(), slugify() on the raw
    // heading text turns "QST:Which database?" into "qstwhich-database" —
    // the nav code and first word fuse because the colon (the only separator)
    // gets stripped before the space-collapse step ever sees it.
    const content = `# ADR-0001: Storage choice

---

## Questions

### QST:Which database?

- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-storage.md')
    const qstSection = adr.sections.flatMap(s => [s, ...s.children]).find(s => s.navCode === 'QST')
    expect(qstSection?.slug).toBe('qst-which-database')
  })

  it('should NOT flag a canonical "### QST: text" heading with NONCANONICAL_NAV_CODE_HEADING', () => {
    const content = `# ADR-0001: Storage choice

---

## Questions

### QST: Which database?

- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-storage.md')
    expect(adr.parseWarnings.some(w => w.code === 'NONCANONICAL_NAV_CODE_HEADING')).toBe(false)
  })

  // Jérémie's ruling, 2026-07-12 (Lapidary's dispatch item 1, same session
  // as the seed specimen above): a nav-code heading at the wrong LEVEL is a
  // different axis than wrong FORM (case/colon) — NONCANONICAL_NAV_CODE_HEADING
  // covers form; NONCANONICAL_NAV_CODE_LEVEL covers level. Both tolerate
  // (never silently drop) and both warn (never silently accept).
  it('tolerates a QST heading one level too shallow ("## QST:") with NONCANONICAL_NAV_CODE_LEVEL', () => {
    const content = `# ADR-0001: Storage choice

---

## QST: Which database?

- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-storage.md')
    expect(adr.questions).toHaveLength(1)
    expect(adr.questions[0].text).toBe('Which database?')
    const warning = adr.parseWarnings.find(w => w.code === 'NONCANONICAL_NAV_CODE_LEVEL')
    expect(warning).toBeDefined()
    expect(warning?.message).toContain('### QST: Which database?')
  })

  it('tolerates a QST heading one level too deep ("#### QST:") with NONCANONICAL_NAV_CODE_LEVEL', () => {
    const content = `# ADR-0001: Storage choice

---

## Questions

#### QST: Which database?

- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-storage.md')
    expect(adr.questions).toHaveLength(1)
    expect(adr.parseWarnings.some(w => w.code === 'NONCANONICAL_NAV_CODE_LEVEL')).toBe(true)
  })

  it('should NOT flag a canonical level-3 "### QST:" heading with NONCANONICAL_NAV_CODE_LEVEL', () => {
    const content = `# ADR-0001: Storage choice

---

## Questions

### QST: Which database?

- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-storage.md')
    expect(adr.parseWarnings.some(w => w.code === 'NONCANONICAL_NAV_CODE_LEVEL')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Write-adversary finding (Quarry 5): openQuestionsPanel.ts's writeAnswer()
// re-resolves a question's current position by id from a fresh parse rather
// than trusting a client-supplied lineStart, which can go stale if the file
// shifted under an in-flight answer (critical under the drift fence's
// "force" path, which skips the checksum check entirely). writeAnswer()
// itself isn't unit-testable here (private method, live vscode.workspace
// dependency, no vscode-mock harness in this repo yet) — this test verifies
// the mechanism the fix depends on: parseAdr + find-by-id survives a line
// shift and lands on the question's NEW correct line, not the stale one.
// See docs/inbox/2026-07-07-2018-quarry-to-fitter-three-catches-in-the-
// shipped-draft-store.md's "flagged-not-yet-reproduced finding" section.
// ---------------------------------------------------------------------------

describe('Write-adversary finding: question re-resolution by id survives a line shift', () => {
  it('find-by-id locates the question at its NEW lineStart after content shifts above it, not the stale render-time line', () => {
    const original = `# ADR-0099: Two Questions

- **Status**: Draft

## Questions

### QST: Which database?
- Status: unanswered

**ANS:** (by Jérémie)
[Fill this in]

### QST: Which cache?
- Status: unanswered

**ANS:** (by Jérémie)
[Fill this in]
`
    const before = parseAdr(original, '/fake/0099-two-questions.md')
    const cacheQuestion = before.questions.find(q => q.text === 'Which cache?')!
    const staleLineStart = cacheQuestion.lineStart

    // Someone answers the FIRST question (adds lines), shifting everything below it.
    const shifted = original.replace(
      '**ANS:** (by Jérémie)\n[Fill this in]\n\n### QST: Which cache?',
      '**ANS:** (by Jérémie)\nWe use Postgres.\nDecided after benchmarking three options over two weeks.\n\n### QST: Which cache?',
    )
    const after = parseAdr(shifted, '/fake/0099-two-questions.md')
    const relocated = after.questions.find(q => q.id === cacheQuestion.id)!

    expect(relocated.lineStart).toBeGreaterThan(staleLineStart)
    expect(relocated.text).toBe('Which cache?')
    // A write using the STALE line number would search starting well above
    // where "Which cache?" now actually is — exactly the misattribution risk
    // the id-based re-resolution fix closes.
  })

  it('find-by-id correctly returns no match when a question\'s heading text itself changed (safe refusal, not silent misattachment)', () => {
    const original = `# ADR-0099: One Question

- **Status**: Draft

## Questions

### QST: Which database?
- Status: unanswered

**ANS:** (by Jérémie)
[Fill this in]
`
    const before = parseAdr(original, '/fake/0099-one-question.md')
    const question = before.questions[0]

    const rewritten = original.replace('Which database?', 'Which database engine?')
    const after = parseAdr(rewritten, '/fake/0099-one-question.md')

    expect(after.questions.find(q => q.id === question.id)).toBeUndefined()
  })

  it('CATCH 6 (fixed at the source) — a duplicate-heading-text question\'s id now survives a line shift: DUPLICATE_SLUG disambiguates by occurrence ordinal, not the raw line number', () => {
    // Quarry 5 (write-adversary) caught this: extractor.ts's buildSection
    // used to disambiguate a duplicate slug with `${slug}-${raw.heading.line}`
    // — the raw line number — so any edit ABOVE a duplicate-heading-text
    // question changed its id even though the question itself never changed.
    // Duplicated boilerplate QST wording (a repeated closing question across
    // sections) is ordinary authoring, not exotic — the same premise CATCH 3
    // already established for draftKey.ts's occurrence-ordinal scheme. This
    // was the same fragility one layer up, in Question.id itself, which
    // writeAnswer's re-resolution fix (and ADR-0021's "question_id...
    // stable, from Question.id... safe with no prior read" MCP write-tool
    // claim) both depend on. Fixed by disambiguating with an occurrence
    // ordinal (1st duplicate, 2nd duplicate, ...) instead of the line number
    // — stable unless a NEW duplicate is inserted before this one, the same
    // narrower threat model already accepted elsewhere in this codebase.
    const original = `# ADR-0099: Duplicate Closing Question

- **Status**: Draft

## Questions

### QST: Any other concerns?
- Status: unanswered

**ANS:** (by Jérémie)
[Fill this in]

### QST: Any other concerns?
- Status: unanswered

**ANS:** (by Jérémie)
[Fill this in]
`
    const before = parseAdr(original, '/fake/0099-duplicate.md')
    const secondOccurrenceIdBefore = before.questions[1].id // e.g. "...-1" (1st duplicate)

    // An ordinary edit completely unrelated to either duplicate question:
    // someone stacks a recommendation under the FIRST occurrence, growing
    // the file by a few lines and shifting the second occurrence downward.
    const shifted = original.replace(
      '[Fill this in]\n\n### QST: Any other concerns?',
      '[Fill this in]\n\n**Recommendation**: (by Someone, 2026-07-07)\nExtra context line one.\nExtra context line two.\n\n### QST: Any other concerns?',
    )
    const after = parseAdr(shifted, '/fake/0099-duplicate.md')

    // The id now stays IDENTICAL despite the line shift: writeAnswer's
    // re-resolution by id (with draftKey as a redundant secondary check)
    // no longer refuses a legitimate "Write anyway" submission just because
    // something unrelated changed above a duplicate-text question, and
    // ADR-0021's "question_id is stable" MCP write-tool claim now actually
    // holds for this case too.
    expect(after.questions[1].id).toBe(secondOccurrenceIdBefore)
  })
})

// ---------------------------------------------------------------------------
// D9.4 — live specimen, 2026-07-10: temp/0011-agent-sessions-json-linter-
// fuzzy-field-and-shape-validation.md. A freshly-emitted ADR used
// "**ANS:** [unanswered]" (inline, wrong stock token) where canon is
// "**ANS:**" + newline + "[Fill this in]". Before this fix, [unanswered]
// matched no placeholder pattern, became a real `answer`, and the question
// silently vanished from the Open Questions panel AS ANSWERED — the
// ADR-0024 founding bug's mirror image (there: vanishes as nonexistent;
// here: vanishes as done). Reported by Lapidary 5,
// docs/inbox/2026-07-10-0541-lapidary-to-flint-d9-4-specimen-live-
// placeholder-drift-reads-as-answered.md.
// ---------------------------------------------------------------------------

describe('D9.4 — nonstandard ANS placeholder tokens ("[unanswered]" etc.)', () => {
  it('the live specimen\'s exact pattern: "**ANS:** [unanswered]" is NOT read as a real answer', () => {
    const content = `# ADR-0011: agent-sessions.json Linter

- **Status**: Proposed

---

## Questions

### QST: Hardcoded known-field vocabulary, or derived by scanning sibling registries?
- Status: unanswered
- Why asking: Trades simplicity against staying current.

**ANS:** [unanswered]
`
    const adr = parseAdr(content, '/fake/docs/adr/0011-linter.md')
    expect(adr.questions).toHaveLength(1)
    expect(adr.questions[0].isAnswered).toBe(false)
    expect(adr.questions[0].answer).toBeUndefined()
  })

  it('flags the deviation with NONSTANDARD_FILL_PLACEHOLDER — never silent (Postel + DMA)', () => {
    const content = `# ADR-0011: Test

## Questions

### QST: Which vocabulary?
- Status: unanswered

**ANS:** [unanswered]
`
    const adr = parseAdr(content, '/fake/docs/adr/0011-test.md')
    const warning = adr.parseWarnings.find(w => w.code === 'NONSTANDARD_FILL_PLACEHOLDER')
    expect(warning).toBeDefined()
    expect(warning?.message).toContain('[Fill this in]')
  })

  it.each(['[to be answered]', '[TBD]', '[pending]', '[todo]', '[Awaiting answer]', '[awaiting]'])(
    'also recognizes the synonym placeholder %s',
    (placeholder) => {
      const content = `# ADR-0011: Test

## Questions

### QST: Which vocabulary?
- Status: unanswered

**ANS:** ${placeholder}
`
      const adr = parseAdr(content, '/fake/docs/adr/0011-test.md')
      expect(adr.questions[0].isAnswered).toBe(false)
      expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_FILL_PLACEHOLDER')).toBe(true)
    },
  )

  // Ecosystem sweep (Quarry 5, 2026-07-12, llm-orchestration-mcp/lyrical-
  // mcp — corpus zoo-005): a fifth stock token, "awaiting"/"awaiting
  // answer", not yet in the lexicon at the time of the sweep. Same-day fix.
  it.each(['_(awaiting answer)_', '(awaiting)', '*(awaiting response)*'])(
    'also recognizes wrapped "awaiting" placeholders %s',
    (placeholder) => {
      const content = `# ADR-0011: Test

## Questions

### QST: Which vocabulary?
- Status: unanswered

**ANS:** (by Jérémie)
${placeholder}
`
      const adr = parseAdr(content, '/fake/docs/adr/0011-test.md')
      expect(adr.questions[0].isAnswered).toBe(false)
      expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_FILL_PLACEHOLDER')).toBe(true)
    },
  )

  it('does NOT flag the canonical "[Fill this in]" placeholder — no new noise on existing behavior', () => {
    const content = `# ADR-0011: Test

## Questions

### QST: Which vocabulary?
- Status: unanswered

**ANS:** (by Human)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0011-test.md')
    expect(adr.questions[0].isAnswered).toBe(false)
    expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_FILL_PLACEHOLDER')).toBe(false)
  })

  it('guard the guard: a real answer that references something in brackets is NOT misread as a placeholder', () => {
    // Lapidary 5's explicit ask: "[see ADR-0014]"-style bracketed *references*
    // must still count as real content — only a body that IS one of the
    // stock placeholder tokens, whole-content, counts as unanswered.
    const content = `# ADR-0011: Test

## Questions

### QST: Which vocabulary?
- Status: unanswered

**ANS:** (by Human)
[see ADR-0014]
`
    const adr = parseAdr(content, '/fake/docs/adr/0011-test.md')
    expect(adr.questions[0].isAnswered).toBe(true)
    expect(adr.questions[0].answer?.text).toBe('[see ADR-0014]')
    expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_FILL_PLACEHOLDER')).toBe(false)
  })

  it('guard the guard: a synonym word embedded in real prose (not the whole answer) is real content', () => {
    const content = `# ADR-0011: Test

## Questions

### QST: Which vocabulary?
- Status: unanswered

**ANS:** (by Human)
This is pending final review, but our lean is option A.
`
    const adr = parseAdr(content, '/fake/docs/adr/0011-test.md')
    expect(adr.questions[0].isAnswered).toBe(true)
    expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_FILL_PLACEHOLDER')).toBe(false)
  })

  // Regression (fixes bug reported 2026-07-12 by Jérémie, live specimen
  // temp/0048-mcp-support-rfc-connecting-external-tool-servers.md): a bare
  // "[ ]" on its own line after "**ANS:** (by Jérémie)" was not recognized
  // by PLACEHOLDER_SYNONYM_RE (which only matched named stock tokens like
  // "[unanswered]"), so it became a real `answer` of literally "[ ]" ->
  // isAnswered: true -> the question silently vanished from the Open
  // Questions panel as done, even though nobody had answered it. Same bug
  // class as D9.4 (a live specimen it didn't cover), fixed by adding
  // PLACEHOLDER_EMPTY_RE alongside the synonym regex.
  it.each(['[ ]', '[]', '[   ]'])(
    'regression: bare empty-bracket placeholder %s is recognized as unanswered, not a real answer',
    (placeholder) => {
      const content = `# ADR-0011: Test

## Questions

### QST: Which vocabulary?
- Status: unanswered

**ANS:** (by Jérémie)
${placeholder}
`
      const adr = parseAdr(content, '/fake/docs/adr/0011-test.md')
      expect(adr.questions[0].isAnswered).toBe(false)
      expect(adr.questions[0].answer).toBeUndefined()
      expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_FILL_PLACEHOLDER')).toBe(true)
    },
  )

  // D9.4 morphology #4 (Lapidary's charter, 2026-07-12, live specimen
  // temp/0021-crew-architecture-and-staffing.md, Athanor 5 / Claude Fable
  // 5): a bracket-free, italic/paren-wrapped stock word — "_(pending)_" —
  // matched none of the bracket-anchored regexes above, became a real
  // `answer`, and the QST silently vanished as answered even though
  // "- Status: unanswered" was declared correctly right there. The
  // declared-vs-derived conflict Lapidary's posture charter names directly.
  it.each(['_(pending)_', '(pending)', '*(TBD)*', '_todo_', '(TBD)', '_(unanswered)_'])(
    'wrapped-placeholder morphology %s is recognized as unanswered, not a real answer',
    (placeholder) => {
      const content = `# ADR-0021: Test

## Questions

### QST: When does wave 2 trigger?
- Status: unanswered

**ANS:** (by Jérémie Lumbroso)
${placeholder}
`
      const adr = parseAdr(content, '/fake/docs/adr/0021-test.md')
      expect(adr.questions[0].isAnswered).toBe(false)
      expect(adr.questions[0].answer).toBeUndefined()
      expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_FILL_PLACEHOLDER')).toBe(true)
    },
  )

  // ADR-0031 Phase A′ (Riddle 5, 2026-07-13, real zoo-001/zoo-003
  // specimens): "(fill in)" — paren-wrapped, no italics, missing "this" —
  // already peeled to "fill in" via stripPlaceholderWrapper, but "fill in"
  // wasn't in the lexicon, so it read as a real answer. Distinct from
  // PLACEHOLDER_CANONICAL_RE's silent "[Fill this in]" — this is a
  // deviation from canonical (parens not brackets, no "this"), so it's
  // tolerated AND warned, same as the other wrapped morphologies.
  it.each(['(fill in)', '(fill this in)', '_(fill in)_'])(
    'wrapped "fill (this) in" morphology %s is recognized as unanswered, not a real answer',
    (placeholder) => {
      const content = `# ADR-0021: Test

## Questions

### QST: Test?
- Status: unanswered

**ANS:** ${placeholder}
`
      const adr = parseAdr(content, '/fake/docs/adr/0021-test.md')
      expect(adr.questions[0].isAnswered).toBe(false)
      expect(adr.questions[0].answer).toBeUndefined()
      expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_FILL_PLACEHOLDER')).toBe(true)
    },
  )

  it('guard the guard: a real short answer that happens to be wrapped in parens/italics for emphasis is NOT a placeholder', () => {
    const content = `# ADR-0021: Test

## Questions

### QST: Which vendor?
- Status: unanswered

**ANS:** (by Jérémie)
_yes, definitely_
`
    const adr = parseAdr(content, '/fake/docs/adr/0021-test.md')
    expect(adr.questions[0].isAnswered).toBe(true)
    expect(adr.questions[0].answer?.text).toBe('_yes, definitely_')
    expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_FILL_PLACEHOLDER')).toBe(false)
  })

  it('guard the guard: a real answer wrapped only in parens, not a stock word, is NOT a placeholder', () => {
    const content = `# ADR-0021: Test

## Questions

### QST: Which vendor?
- Status: unanswered

**ANS:** (by Jérémie)
(see ADR-0014 for the full argument)
`
    const adr = parseAdr(content, '/fake/docs/adr/0021-test.md')
    expect(adr.questions[0].isAnswered).toBe(true)
    expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_FILL_PLACEHOLDER')).toBe(false)
  })

  it('guard the guard: bare unwrapped prose starting with a lexicon word is NOT a placeholder (no wrapper to strip)', () => {
    const content = `# ADR-0021: Test

## Questions

### QST: Which vendor?
- Status: unanswered

**ANS:** (by Jérémie)
Pending final budget approval, but we lean toward option A.
`
    const adr = parseAdr(content, '/fake/docs/adr/0021-test.md')
    expect(adr.questions[0].isAnswered).toBe(true)
    expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_FILL_PLACEHOLDER')).toBe(false)
  })

  // Recommendation-attribution tolerance (same charter, same specimen):
  // "**Recommendation** (by Athanor 5, Claude Fable 5): text" — attribution
  // lands BETWEEN the bold marker and the colon. RECOMMENDATION_RE required
  // the colon immediately after "**Recommendation**", so this form matched
  // nothing at all: the recommendation fell through to rawBody as plain
  // prose, silently losing its structured (attributed) recommendation shape.
  it('recognizes inline-attribution recommendations: "**Recommendation** (by Author): text"', () => {
    const content = `# ADR-0021: Test

## Questions

### QST: When does wave 2 trigger?
- Status: unanswered

**Recommendation** (by Athanor 5, Claude Fable 5): **B — milestone-triggered.**
Same argument as the Tablée two-wave decision.

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0021-test.md')
    expect(adr.questions[0].recommendations).toHaveLength(1)
    const rec = adr.questions[0].recommendations![0]
    expect(rec.author).toBe('Athanor 5, Claude Fable 5')
    expect(rec.authorInferred).toBeFalsy()
    expect(rec.text).toContain('B — milestone-triggered')
    expect(rec.text).toContain('Same argument as the Tablée two-wave decision')
  })

  it('recognizes KEYWORD-LESS inline attribution: "**Recommendation** (Author): text" (fixes HQ mobile-clients seed, 2026-07-18)', () => {
    // Bug: the attribution group required "by"/"from" — "(Portolan 5,
    // Claude Fable 5)" had neither, the group failed, the colon wasn't
    // where the strict form expected it, and all four of the seed's
    // recommendations fell through to raw body text: unstyled,
    // unattributed, absent from recommendations[]. The between-bold-and-
    // colon position is unambiguously attribution, so the keyword is
    // optional there (and ONLY there — a parenthetical AFTER a marker can
    // be content, e.g. "**ANS:** (see ADR-14) real answer").
    const content = `# ADR-0021: Test

## Questions

### QST: Data plane for v0 — direct-to-GitHub, or backend from day one?
- Status: unanswered

**Recommendation** (Portolan 5, Claude Fable 5): **Serverless v0** — direct GitHub API.

A backend enters only when multi-tenant caching forces it.
`
    const adr = parseAdr(content, '/fake/docs/adr/0021-test.md')
    expect(adr.questions[0].recommendations).toHaveLength(1)
    const rec = adr.questions[0].recommendations![0]
    expect(rec.author).toBe('Portolan 5, Claude Fable 5')
    expect(rec.authorInferred).toBeFalsy()
    expect(rec.text).toContain('Serverless v0')
    // Extent parity rides the attribution, keyword or not (v0.7.10 lesson):
    // the follow-on paragraph belongs to the recommendation, not rawBodyPost.
    expect(rec.text).toContain('multi-tenant caching')
    expect(adr.questions[0].rawBodyPost).toBeUndefined()
  })

  it('recognizes keyword-less ANS attribution in the colon-outside form: "**ANS** (Jérémie): text" (the sweep\'s logged wild pattern)', () => {
    const content = `# ADR-0021: Test

## Questions

### QST: Logged variant?
- Status: unanswered

**ANS** (Jérémie): Yes — this exact form recurs in caring-form.
`
    const adr = parseAdr(content, '/fake/docs/adr/0021-test.md')
    expect(adr.questions[0].isAnswered).toBe(true)
    expect(adr.questions[0].answer?.author).toBe('Jérémie')
    expect(adr.questions[0].answer?.text).toContain('recurs in caring-form')
  })

  // Rec-extent escape (Lapidary 5, 2026-07-13, inbox-alchemy ADR-0022
  // specimen: "Is 'InboxAlchemy' the permanent name?"). v0.7.5's inline-
  // attribution tolerance captured only the same-line content — the
  // first body line is real content, not an attribution-only line, so
  // legacy single-paragraph rules applied and a multi-paragraph
  // justification escaped past the first blank line into rawBodyPost,
  // rendering as bare paragraphs below the styled recommendation block.
  it('an inline-attribution recommendation spans multiple paragraphs, not just the first blank-line-terminated one', () => {
    const content = `# ADR-0022: Test

## Questions

### QST: Is the name permanent?
- Status: unanswered
- Need: option choice

- **A — Keep it.**
- **B — Rename.**

**Recommendation** (by Athanor 5, Claude Fable 5): **A.**

*For the name*: first paragraph of justification, several sentences long.

*For the decoupling*: second paragraph, a different argument entirely.

*Boundary note*: third paragraph, a closing caveat.

**ANS:** (by Jérémie Lumbroso)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0022-test.md')
    const rec = adr.questions[0].recommendations![0]
    expect(rec.author).toBe('Athanor 5, Claude Fable 5')
    expect(rec.text).toContain('For the name')
    expect(rec.text).toContain('For the decoupling')
    expect(rec.text).toContain('Boundary note')
    // The escape bug's signature: none of this should have leaked into
    // rawBodyPost as orphaned bare-paragraph text.
    expect(adr.questions[0].rawBodyPost).toBeUndefined()
  })

  // Ground truth: the actual live specimen, verbatim from inbox-alchemy's
  // docs/adr/0022-project-name-vs-product-brand.md (a different project's
  // repo, not a fixture this repo can read from disk — inlined).
  it('ground truth: the real inbox-alchemy ADR-0022 specimen — three-paragraph inline-attribution recommendation', () => {
    const content = `# ADR-0022: Project Name vs. Product Brand

## Originating Context

Jérémie, 2026-07-13, in conversation: "Do you think 'Inbox Alchemy' is a good permanent name?"

### QST: Is "InboxAlchemy" the permanent name?
- Status: unanswered
- Need: option choice

- **A — Permanent project name; product brand decided at launch.** The
  repo, crew, ADRs, and lore keep InboxAlchemy forever.
- **B — Permanent for everything**, project and product both, now.
- **C — Rename now** before more lore accretes.

**Recommendation** (by Athanor 5, Claude Fable 5): **A.**

*For the name (why not C)*: the alchemical register turned out to be
semantically load-bearing, not decorative — transmutation IS the core loop.

*For the decoupling (why not B)*: three product-side cautions deserve
fresh eyes at launch, not inheritance by default.

*Boundary note*: **Episteme** (ADR-0018) is unaffected — the public,
MPL v2 framework name carries the scholarship regardless of what the
product is called.

**ANS:** (by Jérémie Lumbroso)
_(pending)_

---
`
    const adr = parseAdr(content, '/fake/docs/adr/0022-project-name-vs-product-brand.md')
    expect(adr.questions).toHaveLength(1)
    const q = adr.questions[0]
    expect(q.isAnswered).toBe(false)
    const rec = q.recommendations![0]
    expect(rec.author).toBe('Athanor 5, Claude Fable 5')
    expect(rec.text).toContain('For the name (why not C)')
    expect(rec.text).toContain('For the decoupling (why not B)')
    expect(rec.text).toContain('Boundary note')
    expect(rec.text).toContain('Episteme')
    expect(q.rawBodyPost).toBeUndefined()
  })

  // Ground truth: the actual reported specimen, verbatim from temp/0021-
  // crew-architecture-and-staffing.md (gitignored scratch content, inlined
  // here since it can't be a committed fixture) — both fixes together,
  // exactly as Jérémie hit them.
  it('ground truth: the real Athanor specimen (wrapped placeholder + inline-attribution recommendation together)', () => {
    const content = `# ADR-0021: Crew Architecture, Staffing, and the Athanor Mission

- **Date**: 2026-07-12
- **Iteration**: 1
- **Status**: Accepted
- **Deciders**: Jérémie Lumbroso, Athanor 5 (Claude Fable 5)

---

## Questions

### QST: When does wave 2 trigger?
- Status: unanswered
- Why asking: MCP/Relay and Assayer seats should land on substrate, not idle.
- Need: criterion confirmation

- **A — Calendar**: fixed date.
- **B — Milestone**: when the pipeline round-trips a real email end-to-end.

**Recommendation** (by Athanor 5, Claude Fable 5): **B — milestone-triggered.**
Same argument as the Tablée two-wave decision: stable intermediate forms.

**ANS:** (by Jérémie Lumbroso)
_(pending)_

---
`
    const adr = parseAdr(content, '/fake/docs/adr/0021-crew-architecture-and-staffing.md')
    expect(adr.questions).toHaveLength(1)
    const q = adr.questions[0]
    expect(q.isAnswered).toBe(false)
    expect(q.answer).toBeUndefined()
    expect(q.recommendations).toHaveLength(1)
    expect(q.recommendations![0].author).toBe('Athanor 5, Claude Fable 5')
    expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_FILL_PLACEHOLDER')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Crossfoot ADR-0029 compound specimen (Riddle 5, 2026-07-14) — three
// independent morphologies, all required for correct reading: colon-
// outside-bold ANS with inline attribution, bold Status field, and an
// annotated status value. Jérémie's real ADR rendered as four OPEN
// questions with the answers displayed as body text — a false-open, the
// direction opposite most specimens this session (those silently answered
// real-open questions; this one silently reopened real-answered ones).
// ---------------------------------------------------------------------------

describe('Crossfoot compound specimen: ANS colon-outside-bold + bold Status + annotated status value', () => {
  it('"**ANS** (by X): text" (colon outside bold) is recognized, attribution captured, full text extent preserved', () => {
    const content = `# ADR-0029: Test

## Questions

### QST: Which registrar?
- Status: unanswered

**Recommendation** (by Opus 4.7): **A — Spaceship.**
Justification paragraph one.

Justification paragraph two.

**ANS** (by Jérémie): *"I registered crossfoot.tools."* Follow-up sentence. Another sentence.
`
    const adr = parseAdr(content, '/fake/docs/adr/0029-test.md')
    const q = adr.questions[0]
    expect(q.answer?.author).toBe('Jérémie')
    expect(q.answer?.text).toContain('I registered crossfoot.tools')
    expect(q.answer?.text).toContain('Follow-up sentence')
    expect(q.answer?.text).toContain('Another sentence')
    expect(q.isAnswered).toBe(true)
    expect(adr.parseWarnings.some(w => w.code === 'NONCANONICAL_ANS_MARKER')).toBe(true)
  })

  it('does NOT flag the canonical "**ANS:**" form with NONCANONICAL_ANS_MARKER', () => {
    const content = `# ADR-0029: Test

## Questions

### QST: Test?
- Status: unanswered

**ANS:** (by Jérémie) Real answer.
`
    const adr = parseAdr(content, '/fake/docs/adr/0029-test.md')
    expect(adr.parseWarnings.some(w => w.code === 'NONCANONICAL_ANS_MARKER')).toBe(false)
  })

  it('"- **Status**: value" (bold field) is recognized the same as plain "- Status:"', () => {
    const content = `# ADR-0029: Test

## Questions

### QST: Test?
- **Status**: unanswered

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0029-test.md')
    expect(adr.questions[0].statusText).toBe('unanswered')
    expect(adr.questions[0].isAnswered).toBe(false)
    expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_STATUS_LINE_FORM')).toBe(true)
  })

  it('does NOT flag the canonical plain "- Status:" form with NONSTANDARD_STATUS_LINE_FORM', () => {
    const content = `# ADR-0029: Test

## Questions

### QST: Test?
- Status: unanswered

**ANS:** (by Jérémie)
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0029-test.md')
    expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_STATUS_LINE_FORM')).toBe(false)
  })

  it('an annotated status value ("answered 2026-07-13 (reason)") is recognized as answered via leading-token match', () => {
    const content = `# ADR-0029: Test

## Questions

### QST: Test?
- Status: answered 2026-07-13 (registrar implicit — DNS wired already)

Some discussion.
`
    const adr = parseAdr(content, '/fake/docs/adr/0029-test.md')
    const q = adr.questions[0]
    expect(q.isAnswered).toBe(true)
    expect(q.statusText).toBe('answered 2026-07-13 (registrar implicit — DNS wired already)')
    expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_STATUS_ANNOTATION')).toBe(true)
  })

  it('does NOT flag the bare canonical "answered" value with NONSTANDARD_STATUS_ANNOTATION', () => {
    const content = `# ADR-0029: Test

## Questions

### QST: Test?
- Status: answered

**ANS:** (by Jérémie) Real answer.
`
    const adr = parseAdr(content, '/fake/docs/adr/0029-test.md')
    expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_STATUS_ANNOTATION')).toBe(false)
  })

  it('guard the guard: "unanswered" (annotated or not) never gets misread as answered', () => {
    const content = `# ADR-0029: Test

## Questions

### QST: Test?
- Status: unanswered — awaiting registrar decision

Some discussion, no real answer yet.
`
    const adr = parseAdr(content, '/fake/docs/adr/0029-test.md')
    expect(adr.questions[0].isAnswered).toBe(false)
    expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_STATUS_ANNOTATION')).toBe(false)
  })

  // Ground truth: the real crossfoot 0029-domain-plan.md QST-1, verbatim
  // (a sibling project's repo, not a fixture this repo can read from disk
  // — inlined). All three morphologies compound in one real question.
  it('ground truth: the real crossfoot ADR-0029 QST-1 recalls as answered with full answer text', () => {
    const content = `# ADR-0029: Domain Plan for Crossfoot

## Questions

### QST-1: Which registrar?

- **Status**: answered 2026-07-13 (registrar implicit — DNS wired and resolving at time of ADR acceptance; specific registrar not named in the ANS)
- **Why asking**: The registrar affects renewal-year pricing, DNS UX, and account portability.
- **Need**: pick + rationale note if not the recommendation.

**Option A**: **Spaceship** (Namecheap subsidiary, redesigned UI).

**Option B**: **Cloudflare Registrar**.

**Recommendation** (by Opus 4.7): **A — Spaceship.** The snapshot is already on record, the account is already set up, and Jérémie has already done the diligence pass on this registrar's shape.

**ANS** (by Jérémie): *"I registered crossfoot.tools ... and put Github pages dns configured so its ready."* The specific registrar is not named; DNS at time of ADR acceptance shows GitHub Pages A/AAAA at the apex and a CNAME to \`jlumbroso.github.io\` on \`www\`, so the registrar decision is downstream-invisible to the rest of the plan.

---
`
    const adr = parseAdr(content, '/fake/docs/adr/0029-domain-plan.md')
    expect(adr.questions).toHaveLength(1)
    const q = adr.questions[0]
    expect(q.isAnswered).toBe(true)
    expect(q.answer?.author).toBe('Jérémie')
    expect(q.answer?.text).toContain('I registered crossfoot.tools')
    expect(q.answer?.text).toContain('downstream-invisible to the rest of the plan')
    const codes = adr.parseWarnings.map(w => w.code)
    expect(codes).toContain('NONCANONICAL_ANS_MARKER')
    expect(codes).toContain('NONSTANDARD_STATUS_LINE_FORM')
    expect(codes).toContain('NONSTANDARD_STATUS_ANNOTATION')
  })
})

// ---------------------------------------------------------------------------
// HQ ADR-0012 — QST Identifier Grammar ("Blessing the Handle"), 2026-07-11.
// "### QST-<ID>: <title>" is now canonical-optional alongside plain
// "### QST: <title>". Motivating incident (companion-thinking-stream-etude,
// escalated by concertmaster-5): five lettered questions "### QST-A:"
// through "### QST-E:" were silently absent from the Open Questions panel —
// neither NAV_CODE_HEADING_RE nor NAV_CODE_HEADING_TOLERANT_RE recognize a
// hyphenated id (both require literal "QST:" immediately). Facet 5 confirmed
// the identical gap in this repo's own parser the same day.
// ---------------------------------------------------------------------------

describe('HQ ADR-0012 — QST identifier grammar ("### QST-<ID>: title")', () => {
  it('the motivating incident, verbatim: five lettered questions all parse (previously all silently dropped)', () => {
    const content = `# ADR-0046: Export Error Handling

## Questions

### QST-A: Should exports carry errored attempts?
- Status: unanswered

### QST-B: Should retries be automatic?
- Status: unanswered

### QST-C: What's the timeout?
- Status: unanswered

### QST-D: Who gets notified on failure?
- Status: unanswered

### QST-E: Is this reversible?
- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0046-export-errors.md')
    expect(adr.questions).toHaveLength(5)
    expect(adr.questions.map(q => q.qstId)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('the id is separate from the title — text does not include the "QST-A:" prefix', () => {
    const content = `# ADR-0001: Test

## Questions

### QST-A: Should exports carry errored attempts?
- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-test.md')
    expect(adr.questions[0].text).toBe('Should exports carry errored attempts?')
    expect(adr.questions[0].qstId).toBe('A')
  })

  it('plain "### QST: title" (no id) still parses with qstId undefined — no regression', () => {
    const content = `# ADR-0001: Test

## Questions

### QST: Which database?
- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-test.md')
    expect(adr.questions[0].qstId).toBeUndefined()
  })

  it('digit-only ids are legal ("### QST-2: title")', () => {
    const content = `# ADR-0001: Test

## Questions

### QST-2: Which database?
- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-test.md')
    expect(adr.questions[0].qstId).toBe('2')
  })

  it('the handle IS the default anchor: slug is "qst-" + lowercase(id)', () => {
    const content = `# ADR-0001: Test

## Questions

### QST-B: Should retries be automatic?
- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-test.md')
    expect(adr.questions[0].slug).toBe('qst-b')
    expect(adr.questions[0].id).toBe('adr-0001-qst-b')
  })

  it('accents fold on input: "QST-JÉRÉMIE" -> id "JEREMIE", not two different ids for two spellings', () => {
    // HQ ADR-0012 Iteration 2, Cartographer's refinement: "fold, don't
    // forbid" — É is two different byte sequences (precomposed vs combining)
    // that render identically; folding to ASCII at parse time is what makes
    // "QST-JÉRÉMIE" and a dictation-transcribed "QST-JEREMIE" resolve to the
    // SAME id instead of silently forking into two.
    const content = `# ADR-0001: Test

## Questions

### QST-JÉRÉMIE: A question with an accented handle
- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-test.md')
    expect(adr.questions[0].qstId).toBe('JEREMIE')
    expect(adr.questions[0].slug).toBe('qst-jeremie')
  })

  it('Josette-Violaine\'s specimen from the ADR itself: "QST-ÉDF" folds to "EDF"', () => {
    const content = `# ADR-0001: Test

## Questions

### QST-ÉDF: Utility question
- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-test.md')
    expect(adr.questions[0].qstId).toBe('EDF')
  })

  it('a lowercase "qst-a:" keyword is still recognized (tolerant fallback) and flagged, never silently dropped', () => {
    const content = `# ADR-0001: Test

## Questions

### qst-a: Should exports carry errored attempts?
- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-test.md')
    expect(adr.questions).toHaveLength(1)
    expect(adr.questions[0].qstId).toBe('A')
    expect(adr.parseWarnings.some(w => w.code === 'NONCANONICAL_NAV_CODE_HEADING')).toBe(true)
  })

  it('does NOT flag the canonical uppercase "QST-A:" form with NONCANONICAL_NAV_CODE_HEADING', () => {
    const content = `# ADR-0001: Test

## Questions

### QST-A: Should exports carry errored attempts?
- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-test.md')
    expect(adr.parseWarnings.some(w => w.code === 'NONCANONICAL_NAV_CODE_HEADING')).toBe(false)
  })

  it('@adr-anchor still overrides the id-derived slug (highest precedence, per ADR-0012 Decision 5)', () => {
    const content = `# ADR-0001: Test

## Questions

### QST-A: Should exports carry errored attempts?
<!-- @adr-anchor: custom-stable-anchor -->
- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-test.md')
    expect(adr.questions[0].slug).toBe('custom-stable-anchor')
  })

  it('duplicate ids in one file: both parse, first keeps the clean slug, second is disambiguated, never silent', () => {
    // Reuses the existing DUPLICATE_SLUG mechanism (write-adversary CATCH 6
    // fix) rather than a parallel one — an id collision IS a slug collision,
    // and that machinery already satisfies ADR-0012's "parse both + never
    // silent + first-occurrence wins for resolution" requirement.
    const content = `# ADR-0001: Test

## Questions

### QST-A: First question with this id
- Status: unanswered

### QST-A: A different question, same id by mistake
- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-test.md')
    expect(adr.questions).toHaveLength(2)
    expect(adr.questions[0].slug).toBe('qst-a')
    expect(adr.questions[1].slug).not.toBe('qst-a')
    expect(adr.parseWarnings.some(w => w.code === 'DUPLICATE_SLUG')).toBe(true)
  })

  it('a heading nested under #### (level 4) still recognizes the QST handle grammar', () => {
    const content = `# ADR-0001: Test

## Questions

#### QST-A: A deeply-nested question
- Status: unanswered
`
    const adr = parseAdr(content, '/fake/docs/adr/0001-test.md')
    expect(adr.questions).toHaveLength(1)
    expect(adr.questions[0].qstId).toBe('A')
  })
})
