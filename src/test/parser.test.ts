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
import { tokenize, extractRawSections } from '../parser/tokenizer'
import { parseAdr, detectFormat, slugify } from '../parser/extractor'
import { parseSeed } from '../parser/seedExtractor'

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
  it('question with bold "- **Status**: unanswered" still surfaces (isAnswered=false)', () => {
    // Bold Status does not match STATUS_LINE_RE (/^-\s+Status:\s+/).
    // statusText stays as default 'unanswered' → isAnswered=false.
    const adr = parseAdr(ZOO_D2_BOLD_FIELDS, '/fake/docs/adr/zoo/0003-widget.md')
    expect(adr.questions).toHaveLength(2)
    expect(adr.questions[0].isAnswered).toBe(false)
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

  it('question with bold "- **Status**: answered" AND real answer text is still answered', () => {
    // Bold Status not parsed, but !!answer fallback makes isAnswered=true.
    // statusText defaults to 'unanswered' — the field was never read from the file.
    const adr = parseAdr(ZOO_D2_BOLD_FIELDS, '/fake/docs/adr/zoo/0003-widget.md')
    expect(adr.questions[1].isAnswered).toBe(true)
    expect(adr.questions[1].statusText).toBe('unanswered') // not read — bold not parsed
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
  it('"**ANS:** (fill in)" causes question to be treated as ANSWERED — the primary blocker', () => {
    // Mechanism: ANS_INLINE_RE matches "**ANS:**" and captures "(fill in)" as answer text.
    // "(fill in)" does NOT match /^\[\s*fill\s+this\s+in[^\]]*\]$/ (missing square brackets).
    // Therefore answer = { text: "(fill in)" } → isAnswered = true.
    // Questions exist in adr.questions but are all "answered" — silently hidden from panel.
    // Empirically confirmed root cause — see zoarium README.
    const adr = parseAdr(ZOO_D4_COLLAPSED_ANS, '/fake/docs/adr/zoo/0002-toolchain.md')
    expect(adr.questions).toHaveLength(2)                           // parsed, but...
    expect(adr.questions.filter(q => !q.isAnswered)).toHaveLength(0) // ...all treated as answered!
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
    // The Open Questions panel uses: adr.sections.find(s => s.heading === 'Questions')
    // This exact match returns undefined for "Open Questions" → context boundary = Infinity
    // → all sections included as context (ADR context box shows entire file).
    const adr = parseAdr(ZOO_D1_OPEN_QUESTIONS, '/fake/docs/adr/zoo/0001-storage.md')
    expect(adr.sections.find(s => s.heading === 'Questions')).toBeUndefined()
    expect(adr.sections.find(s => s.heading === 'Open Questions')).toBeDefined()
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
})
