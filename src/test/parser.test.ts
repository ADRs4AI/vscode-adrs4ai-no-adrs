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
