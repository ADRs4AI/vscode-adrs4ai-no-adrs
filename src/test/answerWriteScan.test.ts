/**
 * Answer-write anchor scan — regression tests.
 *
 * Incident (2026-07-16, reported live by Jérémie): crossfoot ADR-0030's
 * QST-1 — bold `- **Status**:` fields, `### QST-1:` handle heading, no ANS
 * block — was refused by the panel's writeAnswer ("Could not find the ANS
 * block near line 52... Please answer this one manually") even though the
 * extractor had surfaced the question since v0.7.13. The panel's private
 * scan knew only plain `- Status:`, so the v0.7.8 append-ANS fallback had
 * no anchor. The scan now lives in answerWriteScan.ts, built from the
 * extractor's exported regexes.
 */

import { describe, it, expect } from 'vitest'
import { scanAnswerWriteAnchors } from '../webview/answerWriteScan'
import { parseAdr } from '../parser/extractor'
import { applyAnswerQuestion } from '../mcp/writeOps'

// Minimized from crossfoot/docs/adr/0030-intermittent-use-memory-support.md
const CROSSFOOT_0030 = `# ADR 0030: Intermittent-use memory support

- **Date**: 2026-07-15
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

## Questions

### QST-1: Which intervention shape for intermittent-use memory support?

- **Status**: unanswered
- **Why asking**: The two intervention shapes have very different cost profiles.
- **Need**: pick + any nuance.

**Option A**: **Link to instructions only** — a small "How to use" link.

**Option B**: **Dismissible in-panel tour** — 3-4 overlay steps.

**Recommendation** (by Opus 4.7):

**A now, consider C in a future release.** Ship the cheap, verifiable thing first.

---

### QST-2: Where in the panel does the help affordance live?

- **Status**: unanswered

**ANS:**
[Fill this in]
`

describe('scanAnswerWriteAnchors', () => {
  const lines = CROSSFOOT_0030.split('\n')
  const qst1Start = lines.findIndex(l => l.startsWith('### QST-1:'))

  describe('Regression tests', () => {
    it('bold Status is a recognized anchor — the append-ANS fallback has somewhere to stand (fixes crossfoot ADR-0030 refusal, 2026-07-16)', () => {
      const anchors = scanAnswerWriteAnchors(lines, qst1Start, qst1Start + 40)
      expect(anchors.statusLineIdx).toBeGreaterThan(qst1Start)
      expect(lines[anchors.statusLineIdx].trim()).toBe('- **Status**: unanswered')
      // No ANS block in QST-1 — correctly absent, which is exactly why the
      // Status anchor must be found for the fallback to fire.
      expect(anchors.ansHeaderLineIdx).toBe(-1)
    })

    it('block end stops at the thematic break, never bleeding into QST-2', () => {
      const anchors = scanAnswerWriteAnchors(lines, qst1Start, lines.length)
      const boundary = lines[anchors.blockEndLineIdx].trim()
      expect(boundary).toBe('---')
      // QST-2's canonical ANS/placeholder must NOT be claimed by QST-1's scan
      // (the wrong-question-write shape, panel edition).
      expect(anchors.fillLineIdx).toBe(-1)
    })

    it('a handle-form heading (### QST-2:) is a boundary even without a thematic break', () => {
      const noBreak = lines.filter(l => l.trim() !== '---')
      const start = noBreak.findIndex(l => l.startsWith('### QST-1:'))
      const anchors = scanAnswerWriteAnchors(noBreak, start, noBreak.length)
      expect(noBreak[anchors.blockEndLineIdx].startsWith('### QST-2:')).toBe(true)
    })
  })

  describe('Regression tests: the block longer than any scan window (DEBRIEF-006)', () => {
    // Minimized from caring-form's seed-2026-07-18-blocking-docket.md QST-1:
    // a rich ORJ block (~50 lines: aperture, long why-asking, options, a
    // multi-line recommendation) with Status near the top and NO ANS block.
    // The old 40-line window found no boundary inside the cap, defaulted
    // blockEnd to the cap, and the append fallback spliced Jérémie's answer
    // into the middle of the recommendation sentence at heading+40.
    const longBlock = [
      '### QST: The landing page — will you do the rating sitting?',
      '',
      '- Status: answered',
      ...Array.from({ length: 40 }, (_, i) => `- Why asking line ${i}: context context context.`),
      '**Recommendation**: (by Commodore 5) **"This weekend," done from the',
      'manifest.** It unblocks the entire landing arc (round-3 convergence →',
      'Builder implementation → the public face), retires the oldest stall.',
      '',
      '---',
      '',
      '### QST: The evaluation harness — manifest alone, or full instrument?',
    ]

    it('the block end is the real boundary (the ---), NOT an arbitrary cap — the splice class is dead', () => {
      const anchors = scanAnswerWriteAnchors(longBlock, 0)
      expect(anchors.boundaryKind).toBe('break')
      expect(longBlock[anchors.blockEndLineIdx].trim()).toBe('---')
      // The insertion point sits AFTER the full recommendation — never inside it.
      expect(anchors.blockEndLineIdx).toBeGreaterThan(
        longBlock.findIndex(l => l.includes('the public face')),
      )
    })

    it('an explicit too-small window reports boundaryKind "window" — callers must refuse to append there', () => {
      const anchors = scanAnswerWriteAnchors(longBlock, 0, 40)
      expect(anchors.boundaryKind).toBe('window')
    })

    it('a last-question block with no trailing divider terminates at EOF — a real boundary, appendable', () => {
      const tail = longBlock.slice(0, longBlock.length - 3) // strip ---, blank, next QST
      const anchors = scanAnswerWriteAnchors(tail, 0)
      expect(anchors.boundaryKind).toBe('eof')
      expect(anchors.blockEndLineIdx).toBe(tail.length)
    })

    it('a non-QST heading (e.g. "## Thread") is a block boundary too', () => {
      const withSection = [...longBlock.slice(0, longBlock.length - 3), '## Thread']
      const anchors = scanAnswerWriteAnchors(withSection, 0)
      expect(anchors.boundaryKind).toBe('heading')
      expect(withSection[anchors.blockEndLineIdx]).toBe('## Thread')
    })
  })

  it('canonical scaffold still resolves all anchors (behavior pinned)', () => {
    const canonical = [
      '### QST: Simple?',
      '',
      '- Status: unanswered',
      '',
      '**ANS:**',
      '[Fill this in]',
    ]
    const anchors = scanAnswerWriteAnchors(canonical, 0, canonical.length)
    expect(anchors.statusLineIdx).toBe(2)
    expect(anchors.ansHeaderLineIdx).toBe(4)
    expect(anchors.fillLineIdx).toBe(5)
  })
})

describe('writeOps bold-Status write-back', () => {
  describe('Regression tests', () => {
    it('answering a bold-Status question flips its Status (D2 write-back class, closed via the shared extractor regex)', () => {
      const adr = parseAdr(CROSSFOOT_0030, '/fake/docs/adr/0030-intermittent.md')
      const qst2 = adr.questions.find(q => q.text.startsWith('Where in the panel'))
      expect(qst2).toBeDefined()
      const result = applyAnswerQuestion(
        CROSSFOOT_0030,
        '/fake/docs/adr/0030-intermittent.md',
        qst2!.id,
        'Footer link, per Dinesh.',
        'Jérémie',
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.newContent).toContain('Footer link, per Dinesh.')
        // The bold Status line is recognized and flipped to the CANONICAL
        // form (write canonical — never emit the tolerated form).
        expect(result.newContent).toContain('- Status: answered')
        // QST-1's bold status is untouched (wrong-question guard).
        expect(result.newContent).toContain('- **Status**: unanswered')
      }
    })
  })
})
