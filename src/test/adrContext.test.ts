/**
 * ADR-context boundary — regression + property tests.
 *
 * Bug (2026-07-14, reported live by Jérémie, overfly hq ADR-0031): the Open
 * Questions panel's collapsible "ADR context" box showed the ENTIRE file —
 * QSTs and freshly-written answers included — whenever an ADR's questions
 * didn't live under a section literally named "Questions". The old boundary
 * was name-anchored (exact-match 'Questions' + a denylist of canonical
 * template headings); freeform layouts sailed past both. Fixed in
 * parser/adrContext.ts by DERIVING the boundary from where the extracted
 * questions actually sit.
 *
 * The anti-whack-a-mole guarantee is the property test at the bottom: over
 * every corpus specimen AND this repo's own real ADRs, no context section
 * may overlap any extracted question. New wild layouts that break the
 * invariant become a red test naming the file, not a human's discovery.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseAdr } from '../parser/extractor'
import { computeAdrContext, contextSections } from '../parser/adrContext'

// Minimized from overfly hq ADR-0031 ("Scraper data split"): no "Questions"
// section at all; QSTs live under freeform "## Design: ..." and
// "## Open Follow-ups" sections; non-question design sections sit between
// and after them.
const OVERFLY_FREEFORM = `# ADR-0031: Scraper data split

- **Date**: 2026-07-14
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

## Current state (inventory, 2026-07-14)

The repo holds 2.7MB of raw logs; see QST-1 for the backup question.

## Design: workflow re-targeting auth

Some design prose.

### QST: Fresh deploy key — who mints it and when?

- Status: unanswered
- Why asking: Auth must be re-targeted before the split.

**ANS:** (awaiting Jérémie)
[Fill this in]

## Pipeline pause window

Mid-document design detail, not preamble context.

## Open Follow-ups

### QST: Has the Phase 0.4 backup actually happened?

- Status: unanswered

**ANS:** (awaiting Jérémie)
[Fill this in]

## Action Items

- [ ] Jérémie: confirm backup
`

const D1_OPEN_QUESTIONS = `# ADR-0001: Storage

- **Status**: Draft

## Human Context

Real context the answerer needs.

## Open Questions

### QST: Which database?

- Status: unanswered

**ANS:**
[Fill this in]
`

const CANONICAL = `# ADR-0002: Canonical

- **Status**: Draft

## Quick Reference

Boilerplate.

## Human Context

The human's framing.

## AI Interpretation

What I understood.

## Questions

### QST: Is this canonical?

- Status: unanswered

**ANS:**
[Fill this in]

## Decision

### Context

Decided things.
`

describe('ADR context boundary (derived from questions, not section names)', () => {
  describe('Regression tests', () => {
    it('freeform ADR with no "Questions" section: context is only the pre-question prefix (fixes overfly hq ADR-0031, 2026-07-14)', () => {
      // Bug: name-anchored boundary found no 'Questions' section → Infinity
      // → context box contained the whole file, including the QST Jérémie
      // had just answered. The derived boundary stops at the first
      // question-bearing section ("## Design: workflow re-targeting auth").
      const adr = parseAdr(OVERFLY_FREEFORM, '/fake/docs/adr/0031-scraper-data-split.md')
      expect(adr.questions.length).toBe(2)
      const ctx = computeAdrContext(adr)
      expect(ctx).toBeDefined()
      expect(ctx).toContain('Current state (inventory, 2026-07-14)')
      expect(ctx).not.toContain('QST:')
      expect(ctx).not.toContain('ANS:')
      expect(ctx).not.toContain('Open Follow-ups')
      // Mid-document sections after the first question-bearing one are not
      // preamble context either.
      expect(ctx).not.toContain('Pipeline pause window')
    })

    it('D1 "## Open Questions": context excludes the question-bearing section (closes the documented D1 context gap)', () => {
      // The Zoarium README documented this as known behavior: exact-match
      // 'Questions' lookup failed on "Open Questions" → context = whole file.
      const adr = parseAdr(D1_OPEN_QUESTIONS, '/fake/docs/adr/0001-storage.md')
      const ctx = computeAdrContext(adr)
      expect(ctx).toContain('Real context the answerer needs')
      expect(ctx).not.toContain('Which database?')
      expect(ctx).not.toContain('[Fill this in]')
    })

    it('canonical template: behavior unchanged — Human Context + AI Interpretation in, boilerplate out', () => {
      const adr = parseAdr(CANONICAL, '/fake/docs/adr/0002-canonical.md')
      const ctx = computeAdrContext(adr)
      expect(ctx).toContain('## Human Context')
      expect(ctx).toContain('## AI Interpretation')
      expect(ctx).not.toContain('Quick Reference')
      expect(ctx).not.toContain('Is this canonical?')
      expect(ctx).not.toContain('## Decision')
    })

    it('question in the very first section → no context at all (never a whole-file fallback)', () => {
      const adr = parseAdr(
        '# ADR-0003: Immediate\n\n## Questions\n\n### QST: First thing?\n\n- Status: unanswered\n\n**ANS:**\n[Fill this in]\n',
        '/fake/docs/adr/0003-immediate.md',
      )
      expect(computeAdrContext(adr)).toBeUndefined()
    })
  })

  describe('Property: context never overlaps any extracted question', () => {
    // The anti-whack-a-mole clause: whatever layout the wild produces, a
    // context section containing a question's line is a red test naming the
    // file — the invariant is checked against real corpora, not synthetic
    // expectations.
    const corpora: Array<{ label: string; dir: string }> = [
      { label: 'zoo', dir: resolve(__dirname, 'fixtures/zoo') },
      { label: 'own-adrs', dir: resolve(__dirname, '../../docs/adr') },
    ]

    for (const { label, dir } of corpora) {
      it(`${label}: no context section contains any question's start line`, () => {
        const files = readdirSync(dir).filter(f => f.endsWith('.md'))
        expect(files.length).toBeGreaterThan(0)
        const violations: string[] = []
        for (const file of files) {
          const full = resolve(dir, file)
          const adr = parseAdr(readFileSync(full, 'utf8'), full)
          for (const s of contextSections(adr)) {
            for (const q of adr.questions) {
              if (q.lineStart >= s.lineStart && q.lineStart <= s.lineEnd) {
                violations.push(`${file}: context section "${s.heading}" contains question "${q.text}" (line ${q.lineStart})`)
              }
            }
          }
        }
        expect(violations, violations.join('\n')).toEqual([])
      })
    }
  })
})
