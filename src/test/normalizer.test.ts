/**
 * Normalizer Tests — ADR-0013 (TDD)
 *
 * Tests written BEFORE implementation to drive design.
 * Each describe block corresponds to one module in src/normalizer/.
 *
 * Zoarium specimens provide realistic fixtures — each deviation type was
 * empirically confirmed against real project ADRs (temp/misc-adr, 2026-03-16).
 */

import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { applyPatches, contentChecksum } from '../normalizer/patch-applicator'
import { Coordinator } from '../normalizer/coordinator'
import { D1OpenQuestionsSectionHandler } from '../normalizer/handlers/d1-open-questions-section'
import { D2BoldStatusFieldHandler } from '../normalizer/handlers/d2-bold-status-field'
import { D4CollapsedAnsBlockHandler } from '../normalizer/handlers/d4-collapsed-ans-block'
import { D6NonStandardPreambleFieldHandler } from '../normalizer/handlers/d6-non-standard-preamble-field'
import { D62StatusWithAnnotationHandler } from '../normalizer/handlers/d6-2-status-with-annotation'
import { D65MissingBoldPreambleFieldHandler } from '../normalizer/handlers/d6-5-missing-bold-preamble-field'
import { D96NoncanonicalNavCodeHeadingHandler } from '../normalizer/handlers/d9-6-noncanonical-nav-code-heading'
import { D95MissingRecommendationHandler } from '../normalizer/handlers/d9-5-missing-recommendation'
import { D94NonstandardFillPlaceholderHandler } from '../normalizer/handlers/d9-4-nonstandard-fill-placeholder'
import { parseAdr } from '../parser/extractor'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** zoo-001: D1 + D2 + D3 + D4 combined (the common real-world cluster) */
const ZOO_001 = `# ADR-0003: Widget Rendering Strategy

- **Date**: 2026-03-16
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso, Claude Sonnet 4.6

---

## Context

When rendering widgets, use client-side JS or server-side HTML?

---

## Open Questions

### QST: Should we support client-side hydration for interactive widgets?

- **Status**: unanswered
- **Why asking**: Some widgets (date pickers, sliders) need client-side interactivity.
- **Need**: Decision on whether hydration is in scope for v1.

**ANS:** (fill in)

---

### QST: Should the widget registry be static or dynamic?

- **Status**: unanswered
- **Why asking**: A static registry is simpler but requires a rebuild to add new widgets.
- **Options**:
  1. Static registry — simpler, faster
  2. Dynamic registry — extensible, but requires a plugin API

**ANS:** (fill in)
`

/** zoo-003: D2b — status with trailing parenthetical */
const ZOO_003 = `# ADR-0005: Deployment Strategy

- **Date**: 2026-03-16
- **Status**: Draft

---

## Open Questions

### QST: Should we auto-commit deployment artifacts?

- **Status**: unanswered (linked to ADR 0004 decision on git permissions)
- **Why asking**: Auto-commit requires write permissions.

**ANS:** (fill in)
`

/** Conformant ADR — no violations */
const CONFORMANT_ADR = `# ADR-0001: Storage Backend

- **Date**: 2026-03-16
- **Status**: Draft

---

## Questions

### QST: Which database?

- Status: unanswered
- Why asking: Affects deployment complexity.

**ANS:** (by Human)

[Fill this in]
`

// ---------------------------------------------------------------------------
// PatchApplicator
// ---------------------------------------------------------------------------

describe('applyPatches', () => {
  it('returns content unchanged when no patches', () => {
    expect(applyPatches('line1\nline2\nline3', [])).toBe('line1\nline2\nline3')
  })

  it('replaces a single line', () => {
    const result = applyPatches('line1\nOLD\nline3', [
      { lineStart: 2, lineEnd: 2, replacement: 'NEW' },
    ])
    expect(result).toBe('line1\nNEW\nline3')
  })

  it('replaces a line with multiple lines (expansion)', () => {
    const result = applyPatches('line1\nOLD\nline3', [
      { lineStart: 2, lineEnd: 2, replacement: 'NEW_A\n\nNEW_B' },
    ])
    expect(result).toBe('line1\nNEW_A\n\nNEW_B\nline3')
  })

  it('deletes a line when replacement is empty string', () => {
    const result = applyPatches('line1\nDELETE_ME\nline3', [
      { lineStart: 2, lineEnd: 2, replacement: '' },
    ])
    expect(result).toBe('line1\nline3')
  })

  it('applies multiple patches preserving offsets (reverse order)', () => {
    // Two patches on different lines — applying last-first preserves earlier offsets
    const content = 'A\nB\nC\nD'
    const result = applyPatches(content, [
      { lineStart: 1, lineEnd: 1, replacement: 'AA' },
      { lineStart: 3, lineEnd: 3, replacement: 'CC' },
    ])
    expect(result).toBe('AA\nB\nCC\nD')
  })
})

describe('contentChecksum', () => {
  it('returns a hex string', () => {
    expect(contentChecksum('hello')).toMatch(/^[0-9a-f]+$/)
  })

  it('returns different values for different content', () => {
    expect(contentChecksum('hello')).not.toBe(contentChecksum('world'))
  })

  it('returns same value for same content', () => {
    expect(contentChecksum('hello')).toBe(contentChecksum('hello'))
  })
})

// ---------------------------------------------------------------------------
// Adversarial findings (Quarry 5, write-adversary seat). Both currently
// FAILING — filed to Fitter per
// docs/inbox/2026-07-07-2032-quarry-to-fitter-two-catches-in-the-patch-applicator.md
// (routed per CONVENTIONS §3, not fixed unilaterally here).
// ---------------------------------------------------------------------------

describe('Adversarial findings: contentChecksum contract mismatch and applyPatches silent corruption', () => {
  it('CATCH 4 — contentChecksum is documented as SHA1 but is actually a 32-bit djb2 hash: the staleness contract this function exists to serve is unenforceable as written', () => {
    // types.ts:23 and :38 both say, verbatim, "SHA1 of the full file content"
    // / "SHA1 of the file content at detection time; check before applying
    // fix". A real SHA1 hex digest is 40 characters. Any caller who reads
    // the documented contract and independently computes SHA1 to verify a
    // ViolationRecord.contentChecksum (exactly what the contract instructs:
    // "Caller must verify record.contentChecksum matches the current
    // content before applying") will NEVER get a match, on any input —
    // the two algorithms don't even produce comparable output shapes. The
    // staleness check the type system promises does not exist anywhere in
    // the codebase; the doc describes a contract that was never built.
    const sha1Hex = createHash('sha1').update('hello').digest('hex')
    expect(contentChecksum('hello')).toBe(sha1Hex) // FAILS today: '0a9cede7' !== real sha1
    expect(contentChecksum('hello')).toHaveLength(40) // FAILS today: length is 8
  })

  it('CATCH 5 — overlapping patches now refuse to apply rather than silently corrupting content', () => {
    // Two ViolationRecords whose line ranges spatially overlap is not exotic:
    // nothing in Coordinator.processAll() or ViolationHandler.detect() checks
    // for overlap between different handlers' violations before computing
    // patches — dependsOn only orders *which handler runs first*, not
    // whether their target ranges collide. A heavily malformed real ADR
    // (exactly what the "800-file corpus audit" v1 scope item exists to
    // stress-test) can easily produce two adjacent-or-overlapping violations.
    //
    // Chosen fix (of the two Quarry offered, not prescribed): refuse rather
    // than silently resolve. Before this fix, patches were applied in raw
    // lineStart-descending order with no overlap check — patch 2 spliced
    // first (removing L3-L5, inserting 'BBB'), shifting the array; patch 1's
    // *fixed-width* splice (still computed against the ORIGINAL line
    // numbers) then consumed 3 lines starting at its original offset —
    // sweeping up 'BBB' (patch 2's entire replacement, gone) AND 'L6' (a
    // line neither patch targeted, silently deleted), no error, no signal.
    // "Never write blind" (ADR-0021/0023's write-tier posture) means
    // refusing here, not guessing which patch should silently win.
    const content = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].join('\n')
    expect(() => applyPatches(content, [
      { lineStart: 2, lineEnd: 4, replacement: 'AAA' },
      { lineStart: 3, lineEnd: 5, replacement: 'BBB' }, // overlaps patch 1 on lines 3-4
    ])).toThrow(/overlapping patches/i)
  })

  it('CATCH 5b — a patch fully containing another also refuses (silent-but-benign is still silent)', () => {
    const content = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].join('\n')
    expect(() => applyPatches(content, [
      { lineStart: 2, lineEnd: 5, replacement: 'OUTER' },
      { lineStart: 3, lineEnd: 4, replacement: 'INNER' }, // fully contained within the first
    ])).toThrow(/overlapping patches/i)
  })

  it('non-overlapping (even adjacent) patches still apply cleanly', () => {
    const content = ['L1', 'L2', 'L3', 'L4'].join('\n')
    const result = applyPatches(content, [
      { lineStart: 1, lineEnd: 2, replacement: 'AAA' },
      { lineStart: 3, lineEnd: 4, replacement: 'BBB' },
    ])
    expect(result).toBe('AAA\nBBB')
  })
})

// ---------------------------------------------------------------------------
// D4: CollapsedAnsBlockHandler
// ---------------------------------------------------------------------------

describe('D4CollapsedAnsBlockHandler', () => {
  const handler = new D4CollapsedAnsBlockHandler()
  const parseResult = parseAdr(CONFORMANT_ADR, '/fake/0001.md')

  it('detects "**ANS:** (fill in)" as a violation', () => {
    const records = handler.detect(ZOO_001, parseResult)
    expect(records.length).toBeGreaterThan(0)
    expect(records.every(r => r.handlerId === 'd4-collapsed-ans-block')).toBe(true)
  })

  it('detects all occurrences in zoo-001 (2 violations)', () => {
    const records = handler.detect(ZOO_001, parseResult)
    expect(records).toHaveLength(2)
  })

  it('does NOT flag "**ANS:** (by Human)" as a violation', () => {
    const records = handler.detect(CONFORMANT_ADR, parseResult)
    expect(records).toHaveLength(0)
  })

  it('does NOT flag "**ANS:** (by Jérémie)" as a violation', () => {
    const content = CONFORMANT_ADR.replace('(by Human)', '(by Jérémie)')
    const records = handler.detect(content, parseResult)
    expect(records).toHaveLength(0)
  })

  it('fix() expands collapsed ANS to standard two-line form', () => {
    const records = handler.detect(ZOO_001, parseResult)
    const patch = handler.fix(ZOO_001, records[0])
    expect(patch.replacement).toBe('**ANS:** (by Human)\n\n[Fill this in]')
  })

  it('fix() targets the exact violating line', () => {
    const records = handler.detect(ZOO_001, parseResult)
    const patch = handler.fix(ZOO_001, records[0])
    expect(patch.lineStart).toBe(records[0].lineStart)
    expect(patch.lineEnd).toBe(records[0].lineEnd)
  })

  it('process() on zoo-001 returns 2 patches', () => {
    const patches = handler.process(ZOO_001, parseResult)
    expect(patches).toHaveLength(2)
  })

  it('applying process() patches makes both questions surface as open', () => {
    const patches = handler.process(ZOO_001, parseResult)
    const normalized = applyPatches(ZOO_001, patches)
    const adr = parseAdr(normalized, '/fake/zoo/0003-widget.md')
    // After normalization, questions should appear and be open
    const openQuestions = adr.questions.filter(q => !q.isAnswered)
    expect(openQuestions.length).toBeGreaterThan(0)
  })

  it('ADR-0015 interim: description includes a SEE reference to the governing ADR', () => {
    expect(handler.description).toContain('SEE: docs/adr/0013-normalizer-format-conformance.md')
  })
})

// ---------------------------------------------------------------------------
// D2: BoldStatusFieldHandler
// ---------------------------------------------------------------------------

describe('D2BoldStatusFieldHandler', () => {
  const handler = new D2BoldStatusFieldHandler()
  const parseResult = parseAdr(CONFORMANT_ADR, '/fake/0001.md')

  it('detects "- **Status**: unanswered" as a violation', () => {
    const records = handler.detect(ZOO_001, parseResult)
    expect(records.length).toBeGreaterThan(0)
    expect(records.every(r => r.handlerId === 'd2-bold-status-field')).toBe(true)
  })

  it('does NOT flag "- Status: unanswered" (plain) as a violation', () => {
    const records = handler.detect(CONFORMANT_ADR, parseResult)
    expect(records).toHaveLength(0)
  })

  it('fix() removes bold markers from status field', () => {
    const records = handler.detect(ZOO_001, parseResult)
    const patch = handler.fix(ZOO_001, records[0])
    expect(patch.replacement).toBe('- Status: unanswered')
  })

  it('fix() normalizes status value to lowercase', () => {
    const content = 'some content\n- **Status**: Unanswered\nmore content'
    const records = handler.detect(content, parseResult)
    const patch = handler.fix(content, records[0])
    expect(patch.replacement).toBe('- Status: unanswered')
  })

  it('D2b: fix() strips trailing parenthetical from status value', () => {
    // "- **Status**: unanswered (linked to ADR 0004)" → "- Status: unanswered"
    const records = handler.detect(ZOO_003, parseResult)
    expect(records).toHaveLength(1)
    const patch = handler.fix(ZOO_003, records[0])
    expect(patch.replacement).toBe('- Status: unanswered')
  })

  it('applying process() patches makes QST status lines parseable', () => {
    const patches = handler.process(ZOO_001, parseResult)
    const normalized = applyPatches(ZOO_001, patches)
    // QST-body status fields are now plain
    expect(normalized).toContain('- Status: unanswered')
    // QST-body bold variants are gone
    expect(normalized).not.toContain('- **Status**: unanswered')
    expect(normalized).not.toContain('- **Status**: answered')
    // ADR header bold status is PRESERVED (correct format)
    expect(normalized).toContain('- **Status**: Draft')
  })

  it('ADR-0015 interim: description includes a SEE reference to the governing ADR', () => {
    expect(handler.description).toContain('SEE: docs/adr/0013-normalizer-format-conformance.md')
  })
})

// ---------------------------------------------------------------------------
// D1: OpenQuestionsSectionHandler
// ---------------------------------------------------------------------------

describe('D1OpenQuestionsSectionHandler', () => {
  const handler = new D1OpenQuestionsSectionHandler()
  const parseResult = parseAdr(CONFORMANT_ADR, '/fake/0001.md')

  it('detects "## Open Questions" as a violation', () => {
    const records = handler.detect(ZOO_001, parseResult)
    expect(records).toHaveLength(1)
    expect(records[0].handlerId).toBe('d1-open-questions-section')
  })

  it('does NOT flag "## Questions" as a violation', () => {
    const records = handler.detect(CONFORMANT_ADR, parseResult)
    expect(records).toHaveLength(0)
  })

  it('fix() renames section to "## Questions"', () => {
    const records = handler.detect(ZOO_001, parseResult)
    const patch = handler.fix(ZOO_001, records[0])
    expect(patch.replacement).toBe('## Questions')
  })

  it('fix() preserves heading level for ### Open Questions', () => {
    const content = '### Open Questions\nsome content'
    const records = handler.detect(content, parseResult)
    expect(records).toHaveLength(1)
    const patch = handler.fix(content, records[0])
    expect(patch.replacement).toBe('### Questions')
  })

  it('fix() is case-insensitive — detects "## open questions"', () => {
    const content = '## open questions\n### QST: Something?\n- Status: unanswered'
    const records = handler.detect(content, parseResult)
    expect(records).toHaveLength(1)
  })

  it('applying process() patches restores correct section boundary', () => {
    const patches = handler.process(ZOO_001, parseResult)
    const normalized = applyPatches(ZOO_001, patches)
    const adr = parseAdr(normalized, '/fake/zoo/0003-widget.md')
    // After D1 fix, the section exists with the correct name
    expect(adr.sections.find(s => s.heading === 'Questions')).toBeDefined()
    expect(adr.sections.find(s => s.heading === 'Open Questions')).toBeUndefined()
  })

  it('ADR-0015 interim: description includes a SEE reference to the governing ADR', () => {
    expect(handler.description).toContain('SEE: docs/adr/0013-normalizer-format-conformance.md')
  })
})

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

describe('Coordinator', () => {
  it('detectAll collects violations from all handlers', () => {
    const coordinator = new Coordinator([
      new D1OpenQuestionsSectionHandler(),
      new D2BoldStatusFieldHandler(),
      new D4CollapsedAnsBlockHandler(),
    ])
    const parseResult = parseAdr(CONFORMANT_ADR, '/fake/0001.md')
    const records = coordinator.detectAll(ZOO_001, parseResult)
    // zoo-001 has: 1× D1, 2× D2, 2× D4 = 5 violations
    expect(records).toHaveLength(5)
  })

  it('detectAll returns zero records for a conformant ADR', () => {
    const coordinator = new Coordinator([
      new D1OpenQuestionsSectionHandler(),
      new D2BoldStatusFieldHandler(),
      new D4CollapsedAnsBlockHandler(),
    ])
    const parseResult = parseAdr(CONFORMANT_ADR, '/fake/0001.md')
    const records = coordinator.detectAll(CONFORMANT_ADR, parseResult)
    expect(records).toHaveLength(0)
  })

  it('processAll returns normalized content with all violations fixed', () => {
    const coordinator = new Coordinator([
      new D1OpenQuestionsSectionHandler(),
      new D2BoldStatusFieldHandler(),
      new D4CollapsedAnsBlockHandler(),
    ])
    const parseResult = parseAdr(CONFORMANT_ADR, '/fake/0001.md')
    const { result } = coordinator.processAll(ZOO_001, parseResult)
    // After full normalization, re-parsing should surface open questions
    const adr = parseAdr(result, '/fake/zoo/0003-widget.md')
    expect(adr.questions.filter(q => !q.isAnswered).length).toBeGreaterThan(0)
    // No violations should remain
    const remaining = coordinator.detectAll(result, adr)
    expect(remaining).toHaveLength(0)
  })

  it('processAll provides full audit trail (records + patches)', () => {
    const coordinator = new Coordinator([
      new D4CollapsedAnsBlockHandler(),
    ])
    const parseResult = parseAdr(CONFORMANT_ADR, '/fake/0001.md')
    const { records, patches } = coordinator.processAll(ZOO_001, parseResult)
    expect(records).toHaveLength(2)
    expect(patches).toHaveLength(2)
  })

  it('topological sort: D1 runs before D2 when D2 declares dependsOn D1', () => {
    // NOTE: the Coordinator test below is the last one — D6 tests follow separately
    // Create a D2 variant that depends on D1
    class D2WithDep extends D2BoldStatusFieldHandler {
      override readonly dependsOn = ['d1-open-questions-section'] as const
    }
    const coordinator = new Coordinator([
      new D2WithDep(),            // registered first
      new D1OpenQuestionsSectionHandler(), // registered second
    ])
    const parseResult = parseAdr(CONFORMANT_ADR, '/fake/0001.md')
    const records = coordinator.detectAll(ZOO_001, parseResult)
    // D1 records should appear before D2 records in the result
    const d1Idx = records.findIndex(r => r.handlerId === 'd1-open-questions-section')
    const d2Idx = records.findIndex(r => r.handlerId === 'd2-bold-status-field')
    expect(d1Idx).toBeLessThan(d2Idx)
  })
})

// ---------------------------------------------------------------------------
// D6: NonStandardPreambleFieldHandler
// Specimen: temp/misc-problem-adr-03/8001-freirean-problem-posing-pedagogy.md
// ---------------------------------------------------------------------------

const ZOO_006_COLON_INSIDE = `# ADR-8001: Freirean Problem-Posing Pedagogy

**Status:** Accepted
**Type:** General — Philosophical
**Date:** 2026-03-17
**Authors:** Jérémie Lumbroso + Claude Sonnet 4.5

---

## Context

Some context here.
`

const ZOO_006_COLON_OUTSIDE_NO_DASH = `# ADR-0005: Some Decision

**Status**: Draft
**Date**: 2026-03-17

---

## Context
`

const ZOO_006_WITH_DASH_COLON_INSIDE = `# ADR-0007: Another Decision

- **Status:** Accepted
- **Date:** 2026-03-17

---

## Context
`

describe('D6NonStandardPreambleFieldHandler', () => {
  const handler = new D6NonStandardPreambleFieldHandler()
  const parseResult = parseAdr(CONFORMANT_ADR, '/fake/0001.md')

  it('detects "**Key:** value" (colon inside, no dash) — exact zoo-006 specimen', () => {
    const records = handler.detect(ZOO_006_COLON_INSIDE, parseResult)
    // Should detect Status, Type, Date, Authors (4 fields; all non-standard)
    expect(records.length).toBeGreaterThanOrEqual(3)
    expect(records.every(r => r.handlerId === 'd6-non-standard-preamble-field')).toBe(true)
  })

  it('detects "**Key**: value" (colon outside, no dash)', () => {
    const records = handler.detect(ZOO_006_COLON_OUTSIDE_NO_DASH, parseResult)
    expect(records.length).toBeGreaterThanOrEqual(2)
  })

  it('detects "- **Key:** value" (has dash, colon inside)', () => {
    const records = handler.detect(ZOO_006_WITH_DASH_COLON_INSIDE, parseResult)
    expect(records.length).toBeGreaterThanOrEqual(2)
  })

  it('does NOT flag "- **Status**: Accepted" (standard format)', () => {
    const records = handler.detect(CONFORMANT_ADR, parseResult)
    expect(records).toHaveLength(0)
  })

  it('fix() converts "**Status:** Accepted" to "- **Status**: Accepted"', () => {
    const records = handler.detect(ZOO_006_COLON_INSIDE, parseResult)
    const statusRecord = records.find(r => r.originalText.includes('Status'))!
    const patch = handler.fix(ZOO_006_COLON_INSIDE, statusRecord)
    expect(patch.replacement).toBe('- **Status**: Accepted')
  })

  it('fix() converts "- **Date:** 2026-03-17" to "- **Date**: 2026-03-17"', () => {
    const records = handler.detect(ZOO_006_WITH_DASH_COLON_INSIDE, parseResult)
    const dateRecord = records.find(r => r.originalText.includes('Date'))!
    const patch = handler.fix(ZOO_006_WITH_DASH_COLON_INSIDE, dateRecord)
    expect(patch.replacement).toBe('- **Date**: 2026-03-17')
  })

  it('applying process() makes the Status field parseable by extractMetadata', () => {
    // After normalization, the ADR header should have a recognized Status
    const patches = handler.process(ZOO_006_COLON_INSIDE, parseResult)
    const normalized = applyPatches(ZOO_006_COLON_INSIDE, patches)
    const adr = parseAdr(normalized, '/fake/zoo/8001-freirean.md')
    // Status should now be parsed from the preamble
    expect(adr.status).toBe('Accepted')
  })

  it('does NOT flag content lines inside ## sections', () => {
    // Handler must stop scanning at the first ## heading
    const content = `# ADR-0001: Test

- **Status**: Accepted

---

## Context

**Bold text in context**: this should not be flagged.
`
    const records = handler.detect(content, parseResult)
    expect(records).toHaveLength(0)
  })

  it('ADR-0015 interim: description includes a SEE reference to the governing ADR', () => {
    expect(handler.description).toContain('SEE: docs/adr/0013-normalizer-format-conformance.md')
  })
})

// ---------------------------------------------------------------------------
// D6.5: MissingBoldPreambleFieldHandler
// Specimen: temp/misc-problem-adr-08-with-tooltip/README.md
// ---------------------------------------------------------------------------

const ZOO_0065_UNBOLD_STATUS = `# ADR-0009: Phonemize Tool Integration

- Status: Draft
- Date: 2026-05-11

---

## Context

Some context here.
`

describe('D65MissingBoldPreambleFieldHandler', () => {
  const handler = new D65MissingBoldPreambleFieldHandler()
  const parseResult = parseAdr(CONFORMANT_ADR, '/fake/0001.md')

  it('detects "- Status: Draft" (unbold key, dash bullet) — exact specimen', () => {
    const records = handler.detect(ZOO_0065_UNBOLD_STATUS, parseResult)
    expect(records.length).toBeGreaterThanOrEqual(2) // Status + Date
    expect(records.every(r => r.handlerId === 'd6-5-missing-bold-preamble-field')).toBe(true)
  })

  it('does NOT flag "- **Status**: Accepted" (standard bold format)', () => {
    const records = handler.detect(CONFORMANT_ADR, parseResult)
    expect(records).toHaveLength(0)
  })

  it('fix() converts "- Status: Draft" to "- **Status**: Draft"', () => {
    const records = handler.detect(ZOO_0065_UNBOLD_STATUS, parseResult)
    const statusRecord = records.find(r => r.originalText.includes('Status'))!
    const patch = handler.fix(ZOO_0065_UNBOLD_STATUS, statusRecord)
    expect(patch.replacement).toBe('- **Status**: Draft')
  })

  it('DMA: diagnostic message never says "missing" — the field is present', () => {
    const records = handler.detect(ZOO_0065_UNBOLD_STATUS, parseResult)
    const statusRecord = records.find(r => r.originalText.includes('Status'))!
    expect(statusRecord.description.toLowerCase()).not.toContain('missing status')
    expect(statusRecord.description).toContain('Draft')
  })

  it('test discipline (ADR-0014): message contains the deviation-type slug', () => {
    const records = handler.detect(ZOO_0065_UNBOLD_STATUS, parseResult)
    expect(records.every(r => r.description.includes('MISSING_BOLD_ON_PREAMBLE_FIELD'))).toBe(true)
  })

  it('applying process() makes the Status field bold and parseable', () => {
    const patches = handler.process(ZOO_0065_UNBOLD_STATUS, parseResult)
    const normalized = applyPatches(ZOO_0065_UNBOLD_STATUS, patches)
    expect(normalized).toContain('- **Status**: Draft')
    const adr = parseAdr(normalized, '/fake/zoo/0009-phonemize.md')
    expect(adr.status).toBe('Draft')
  })

  it('does NOT flag content lines inside ## sections', () => {
    const content = `# ADR-0001: Test

- Status: Accepted

---

## Context

Not a preamble field: this should not be flagged.
`
    const records = handler.detect(content, parseResult)
    expect(records).toHaveLength(1) // only the Status line
  })
})

// ---------------------------------------------------------------------------
// D6.2: StatusWithAnnotationHandler (was "D7")
// Specimen: seed-2026-03-18 Interaction 1 — "Draft — awaiting human answers"
// ---------------------------------------------------------------------------

const ZOO_0062_EM_DASH = `# ADR-0010: Some Decision

- **Status**: Draft — awaiting human answers
- **Date**: 2026-04-17

---

## Context
`

const ZOO_0062_PAREN = `# ADR-0011: Another Decision

- **Status**: Accepted (updated)

---

## Context
`

const ZOO_0062_COLON = `# ADR-0012: Yet Another Decision

- Status: Draft: awaiting review

---

## Context
`

describe('D62StatusWithAnnotationHandler', () => {
  const handler = new D62StatusWithAnnotationHandler()
  const parseResult = parseAdr(CONFORMANT_ADR, '/fake/0001.md')

  it('detects em-dash annotation: "Draft — awaiting human answers"', () => {
    const records = handler.detect(ZOO_0062_EM_DASH, parseResult)
    expect(records).toHaveLength(1)
    expect(records[0].handlerId).toBe('d6-2-status-with-annotation')
  })

  it('detects parenthetical annotation: "Accepted (updated)" — no short-decoratives exemption', () => {
    const records = handler.detect(ZOO_0062_PAREN, parseResult)
    expect(records).toHaveLength(1)
  })

  it('detects colon-extended annotation: "Draft: awaiting review" (unbold key too)', () => {
    const records = handler.detect(ZOO_0062_COLON, parseResult)
    expect(records).toHaveLength(1)
  })

  it('does NOT flag a plain status value with no annotation', () => {
    const records = handler.detect(CONFORMANT_ADR, parseResult)
    expect(records).toHaveLength(0)
  })

  it('fix() strips the annotation, keeping the bold canonical form', () => {
    const records = handler.detect(ZOO_0062_EM_DASH, parseResult)
    const patch = handler.fix(ZOO_0062_EM_DASH, records[0])
    expect(patch.replacement).toBe('- **Status**: Draft')
  })

  it('pedagogical message validates the impulse and offers a pattern menu (not prescription)', () => {
    const records = handler.detect(ZOO_0062_EM_DASH, parseResult)
    expect(records[0].description).toContain('not wrong to add')
    expect(records[0].description).toContain('**Awaiting**:')
    expect(records[0].description).toContain('**Scope Remaining**:')
    expect(records[0].description).toContain('**Last Updated**:')
  })

  it('test discipline (ADR-0014): message contains the deviation-type slug', () => {
    const records = handler.detect(ZOO_0062_EM_DASH, parseResult)
    expect(records[0].description).toContain('STATUS_WITH_ANNOTATION')
  })

  // DMA (ADR-0014): buildMessage() always re-synthesized the quoted example with
  // an em-dash ("Accepted — updated"), even when the source used parens or a
  // colon. A user who wrote "Accepted (updated)" then reads a diagnostic
  // claiming to quote them back with a different separator — not what they
  // wrote. Fixed by quoting the actual matched value verbatim instead of
  // reconstructing base/annotation with a hardcoded separator.
  it('DMA: quotes the actual separator used, not always an em-dash (paren case)', () => {
    const records = handler.detect(ZOO_0062_PAREN, parseResult)
    expect(records[0].description).toContain('"Accepted (updated)"')
    expect(records[0].description).not.toContain('Accepted — updated')
  })

  it('DMA: quotes the actual separator used, not always an em-dash (colon case)', () => {
    const records = handler.detect(ZOO_0062_COLON, parseResult)
    expect(records[0].description).toContain('"Draft: awaiting review"')
  })

  it('does NOT confuse QST-body "- Status: answered" (D2 scope) with preamble Status', () => {
    // D6.2 must stop scanning at the first ## heading — QST bodies are out of scope
    const content = `# ADR-0001: Test

- **Status**: Draft

---

## Questions

### QST: Something?
- Status: answered (see ADR 4)
`
    const records = handler.detect(content, parseResult)
    expect(records).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// D9.6: NoncanonicalNavCodeHeadingHandler (ADR-0024)
// Specimen: the "panel shows nothing" symptom — case/glued-colon QST headings
// ---------------------------------------------------------------------------

const ZOO_0096_LOWERCASE = `# ADR-0013: Storage choice

---

## Questions

### qst: Which database?

- Status: unanswered
`

const ZOO_0096_GLUED_COLON = `# ADR-0013: Storage choice

---

## Questions

### QST:Which database?

- Status: unanswered
`

describe('D96NoncanonicalNavCodeHeadingHandler', () => {
  const handler = new D96NoncanonicalNavCodeHeadingHandler()
  const parseResult = parseAdr(CONFORMANT_ADR, '/fake/0001.md')

  it('detects a lowercase nav code heading ("### qst:")', () => {
    const records = handler.detect(ZOO_0096_LOWERCASE, parseResult)
    expect(records).toHaveLength(1)
    expect(records[0].handlerId).toBe('d9-6-noncanonical-nav-code-heading')
  })

  it('detects a glued-colon nav code heading ("### QST:Question")', () => {
    const records = handler.detect(ZOO_0096_GLUED_COLON, parseResult)
    expect(records).toHaveLength(1)
  })

  it('does NOT flag a canonical "### QST: text" heading', () => {
    const records = handler.detect(CONFORMANT_ADR, parseResult)
    expect(records).toHaveLength(0)
  })

  it('fix() rewrites the lowercase heading to canonical case, preserving heading level', () => {
    const records = handler.detect(ZOO_0096_LOWERCASE, parseResult)
    const patch = handler.fix(ZOO_0096_LOWERCASE, records[0])
    expect(patch.replacement).toBe('### QST: Which database?')
  })

  it('fix() rewrites the glued colon to canonical spacing', () => {
    const records = handler.detect(ZOO_0096_GLUED_COLON, parseResult)
    const patch = handler.fix(ZOO_0096_GLUED_COLON, records[0])
    expect(patch.replacement).toBe('### QST: Which database?')
  })

  it('DMA: message is faithful — recognized, not missing/wrong data', () => {
    const records = handler.detect(ZOO_0096_LOWERCASE, parseResult)
    expect(records[0].description).toContain('Recognized anyway — no data lost')
  })

  it('test discipline (ADR-0014): message contains the deviation-type slug', () => {
    const records = handler.detect(ZOO_0096_LOWERCASE, parseResult)
    expect(records[0].description).toContain('NONCANONICAL_NAV_CODE_HEADING')
  })

  it('applying process() makes the heading parse as a canonical QST', () => {
    const patches = handler.process(ZOO_0096_GLUED_COLON, parseResult)
    const normalized = applyPatches(ZOO_0096_GLUED_COLON, patches)
    expect(normalized).toContain('### QST: Which database?')
    const adr = parseAdr(normalized, '/fake/zoo/0013-storage.md')
    expect(adr.questions).toHaveLength(1)
    expect(adr.parseWarnings.some(w => w.code === 'NONCANONICAL_NAV_CODE_HEADING')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// D9.5: MissingRecommendationHandler (ADR-0019 QST-2, answered)
// ---------------------------------------------------------------------------

const ZOO_0095_NO_RECOMMENDATION = `# ADR-0002: Parser

- **Status**: Draft

## Questions

### QST: Which deep-link approach?
- Status: unanswered
- Why asking: Affects stability of cross-file references.

**ANS:** (by Jérémie)
[Fill this in]
`

const ZOO_0095_ANSWERED_NO_RECOMMENDATION = `# ADR-0002: Parser

- **Status**: Draft

## Questions

### QST: Which deep-link approach?
- Status: answered

**ANS:** (by Jérémie)
Went with option A.
`

const ZOO_0095_HAS_RECOMMENDATION = `# ADR-0002: Parser

- **Status**: Draft

## Questions

### QST: Which deep-link approach?
- Status: unanswered

**Recommendation**: (by Sonnet 4.6)

Use option A.

**ANS:** (by Jérémie)
[Fill this in]
`

describe('D95MissingRecommendationHandler', () => {
  const handler = new D95MissingRecommendationHandler()
  const parseResult = parseAdr(CONFORMANT_ADR, '/fake/0001.md')

  it('fires on an open QST with no Recommendation block', () => {
    const adr = parseAdr(ZOO_0095_NO_RECOMMENDATION, '/fake/0002.md')
    const records = handler.detect(ZOO_0095_NO_RECOMMENDATION, adr)
    expect(records).toHaveLength(1)
    expect(records[0].handlerId).toBe('d9-5-missing-recommendation')
  })

  it('does NOT fire on an answered QST with no Recommendation block (QST-2: open-only)', () => {
    const adr = parseAdr(ZOO_0095_ANSWERED_NO_RECOMMENDATION, '/fake/0002.md')
    const records = handler.detect(ZOO_0095_ANSWERED_NO_RECOMMENDATION, adr)
    expect(records).toHaveLength(0)
  })

  it('does NOT fire on an open QST that already has a Recommendation block', () => {
    const adr = parseAdr(ZOO_0095_HAS_RECOMMENDATION, '/fake/0002.md')
    const records = handler.detect(ZOO_0095_HAS_RECOMMENDATION, adr)
    expect(records).toHaveLength(0)
  })

  it('message is verbatim per ADR-0019 (Socratic, not paraphrased)', () => {
    const adr = parseAdr(ZOO_0095_NO_RECOMMENDATION, '/fake/0002.md')
    const records = handler.detect(ZOO_0095_NO_RECOMMENDATION, adr)
    expect(records[0].description).toContain('MISSING_RECOMMENDATION: this open QST has no Recommendation block.')
    expect(records[0].description).toContain('asking without a position shifts the entire cognitive load to the human.')
    expect(records[0].description).toContain('**Recommendation**: (by [your model name])')
    expect(records[0].description).toContain('ORJ: never divorce')
  })

  it('test discipline (ADR-0014): message contains the deviation-type slug', () => {
    const adr = parseAdr(ZOO_0095_NO_RECOMMENDATION, '/fake/0002.md')
    const records = handler.detect(ZOO_0095_NO_RECOMMENDATION, adr)
    expect(records[0].description).toContain('MISSING_RECOMMENDATION')
  })

  it('fix() inserts the SUGGESTED scaffold immediately before **ANS:**', () => {
    const adr = parseAdr(ZOO_0095_NO_RECOMMENDATION, '/fake/0002.md')
    const records = handler.detect(ZOO_0095_NO_RECOMMENDATION, adr)
    const patch = handler.fix(ZOO_0095_NO_RECOMMENDATION, records[0])
    expect(patch.replacement).toContain('**Recommendation**: (by [your model name])')
    expect(patch.replacement.endsWith('**ANS:** (by Jérémie)')).toBe(true)
  })

  it('applying process() makes the QST have a parseable recommendation', () => {
    const adr = parseAdr(ZOO_0095_NO_RECOMMENDATION, '/fake/0002.md')
    const patches = handler.process(ZOO_0095_NO_RECOMMENDATION, adr)
    const normalized = applyPatches(ZOO_0095_NO_RECOMMENDATION, patches)
    const reparsed = parseAdr(normalized, '/fake/0002.md')
    expect(reparsed.questions[0].recommendations?.length).toBeGreaterThan(0)
  })

  it('is self-quieting: does not fire once the coordinator-applied fix scaffold is filled and QST answered', () => {
    const adr = parseAdr(ZOO_0095_ANSWERED_NO_RECOMMENDATION, '/fake/0002.md')
    const records = handler.detect(ZOO_0095_ANSWERED_NO_RECOMMENDATION, adr)
    expect(records).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// D9.4: NonstandardFillPlaceholderHandler
// Live specimen, 2026-07-10: temp/0011-agent-sessions-json-linter-fuzzy-
// field-and-shape-validation.md — "**ANS:** [unanswered]" where canon is
// "**ANS:**" + newline + "[Fill this in]".
// ---------------------------------------------------------------------------

const ZOO_0094_SPECIMEN = `# ADR-0011: agent-sessions.json Linter

- **Status**: Proposed

---

## Questions

### QST: Hardcoded known-field vocabulary, or derived by scanning sibling registries?
- Status: unanswered
- Why asking: Trades simplicity against staying current.

**ANS:** [unanswered]
`

const ZOO_0094_WITH_ATTRIBUTION = `# ADR-0011: Test

## Questions

### QST: Which vocabulary?
- Status: unanswered

**ANS:** (by Jérémie) [pending]
`

describe('D94NonstandardFillPlaceholderHandler', () => {
  const handler = new D94NonstandardFillPlaceholderHandler()
  const parseResult = parseAdr(CONFORMANT_ADR, '/fake/0001.md')

  it('detects the exact live specimen: "**ANS:** [unanswered]"', () => {
    const records = handler.detect(ZOO_0094_SPECIMEN, parseResult)
    expect(records).toHaveLength(1)
    expect(records[0].handlerId).toBe('d9-4-nonstandard-fill-placeholder')
  })

  it('does NOT flag the canonical two-line "**ANS:**" + "[Fill this in]" form', () => {
    const records = handler.detect(CONFORMANT_ADR, parseResult)
    expect(records).toHaveLength(0)
  })

  it('does NOT flag a real inline answer', () => {
    const content = `# ADR-0001: Test

## Questions

### QST: Which database?
- Status: unanswered

**ANS:** (by Human) We use Postgres.
`
    const records = handler.detect(content, parseResult)
    expect(records).toHaveLength(0)
  })

  it('fix() rewrites to canonical two-line form, preserving indentation', () => {
    const records = handler.detect(ZOO_0094_SPECIMEN, parseResult)
    const patch = handler.fix(ZOO_0094_SPECIMEN, records[0])
    expect(patch.replacement).toBe('**ANS:**\n[Fill this in]')
  })

  it('fix() preserves an attribution parenthetical when present', () => {
    const records = handler.detect(ZOO_0094_WITH_ATTRIBUTION, parseResult)
    expect(records).toHaveLength(1)
    const patch = handler.fix(ZOO_0094_WITH_ATTRIBUTION, records[0])
    expect(patch.replacement).toBe('**ANS:** (by Jérémie)\n[Fill this in]')
  })

  it('DMA: message validates the structure was correct before naming the deviation', () => {
    const records = handler.detect(ZOO_0094_SPECIMEN, parseResult)
    expect(records[0].description).toContain('QST heading and structure here are correct')
  })

  it('test discipline (ADR-0014): message contains the deviation-type slug', () => {
    const records = handler.detect(ZOO_0094_SPECIMEN, parseResult)
    expect(records[0].description).toContain('NONSTANDARD_FILL_PLACEHOLDER')
  })

  it('applying process() makes the ANS block canonical and re-parses cleanly', () => {
    const patches = handler.process(ZOO_0094_SPECIMEN, parseResult)
    const normalized = applyPatches(ZOO_0094_SPECIMEN, patches)
    expect(normalized).toContain('**ANS:**\n[Fill this in]')
    const adr = parseAdr(normalized, '/fake/zoo/0011-linter.md')
    expect(adr.questions[0].isAnswered).toBe(false)
    expect(adr.parseWarnings.some(w => w.code === 'NONSTANDARD_FILL_PLACEHOLDER')).toBe(false)
  })
})
