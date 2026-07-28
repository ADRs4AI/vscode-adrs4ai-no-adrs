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
import { scanAnswerWriteAnchors, buildInsertionPreview } from '../webview/answerWriteScan'
import { parseAdr } from '../parser/extractor'
import { applyAnswerQuestion, applyAddRecommendation } from '../mcp/writeOps'

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

describe('Regression tests: replace-extent for existing draft answers (elenchus legacy, 2026-07-23)', () => {
  // Status-authority's normal open-with-draft state: `- Status: unanswered`
  // + a real answer awaiting the flip. Submitting from the panel used to
  // insert-after-header (PREPENDING the new answer onto the old), and on
  // the same-line ANS form the header rewrite destroyed the old answer's
  // first line. The scan now exposes the existing answer's extent so both
  // write paths REPLACE it whole.
  const sameLineAns = [
    '### QST: When does auto-promotion happen?',
    '- Status: unanswered',
    '',
    '**ANS:** (by Jérémie) Option A. When a student cancels a sign up,',
    'garbage collect by checking the Tier 1 waitlist.',
    '',
    '---',
    '',
    '### QST: Next question?',
  ]

  it('ansContentEndLineIdx spans the whole existing answer (same-line form + wrapped continuation), trimmed of trailing blanks', () => {
    const anchors = scanAnswerWriteAnchors(sameLineAns, 0)
    expect(anchors.ansHeaderLineIdx).toBe(3)
    expect(anchors.ansContentEndLineIdx).toBe(5) // exclusive: header + continuation line
    expect(sameLineAns[anchors.ansContentEndLineIdx - 1]).toContain('Tier 1 waitlist')
    expect(anchors.boundaryKind).toBe('break')
  })

  it('writeOps replace semantics: the old draft is replaced whole — never prepended, never half-destroyed', () => {
    const content = `# ADR 0005: Waitlist mechanics

## Questions

${sameLineAns.join('\n')}
- Status: unanswered

**ANS:**
[Fill this in]
`
    const adr = parseAdr(content, '/fake/docs/adr/0005-waitlist.md')
    const q1 = adr.questions[0]
    const result = applyAnswerQuestion(content, '/fake/docs/adr/0005-waitlist.md', q1.id, 'Confirmed: Option A, garbage-collect on cancel.', 'Jérémie')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.newContent).toContain('Confirmed: Option A, garbage-collect on cancel.')
      // The old draft is GONE from the block — replaced, not prepended-to.
      expect(result.newContent).not.toContain('When a student cancels a sign up')
      expect(result.newContent).not.toContain('garbage collect by checking')
      // Exactly one ANS block remains in the question, canonical form.
      expect(result.newContent).toContain('**ANS:** (by Jérémie)\nConfirmed: Option A')
      // The next question is untouched (fidelity).
      expect(result.newContent).toContain('[Fill this in]')
    }
  })
})

describe('Regression tests: dialogue layering — answers stack, writes target the LAST slot (system3 ADR-0033, 2026-07-24)', () => {
  // Minimized from the real specimen: rec -> ANS (Jérémie's hold) ->
  // "Recommendation (updated)" -> "ANS (to the updated recommendation)"
  // empty slot at EOF. Before this class landed, everything after the first
  // ANS was swallowed into one blob (the panel showed a truncated "Hold —"
  // as THE answer), Herald's updated recommendation was invisible, and a
  // panel submit would have replaced the entire dialogue.
  const DIALOGUE = `# ADR 0033: Team completism

## Status meta

### QST: The stated promotion trigger has fired — design now, hold, or fold?
- Status: unanswered (added by the 2026-07-09 ORJ tour)

**Recommendation**: (by Herald 5, 2026-07-09)

**B — hold with the concrete trigger.**

**ANS:** (by Jérémie Lumbroso — given in chat 2026-07-14, transcribed by Herald 5)
Hold — "I'd like to put the Team completism a bit on hold, and tackle it as
the last standing thing for full sync."

**Recommendation (updated)**: (by Herald 5, 2026-07-24)

**Your hold stands unchanged — but it's time to stop letting time-windowed analytics expire.**

Recommend a ~20-line ride-along snapshot. This stops the bleeding while the hold holds.

**ANS (to the updated recommendation):** (by Jérémie Lumbroso)
`

  it('the dialogue parses as layers: 2 recommendations (qualifier captured), 1 real answer, current answer = the OPEN slot (undefined)', () => {
    const adr = parseAdr(DIALOGUE, '/fake/docs/adr/0033-t.md')
    const q = adr.questions[0]
    expect(q.isAnswered).toBe(false) // declared unanswered; awaiting ANS-2
    expect(q.recommendations).toHaveLength(2)
    expect(q.recommendations![1].text).toContain('stops the bleeding')
    expect(q.answers).toHaveLength(1)
    expect(q.answers![0].text).toContain('last standing thing for full sync')
    expect(q.answer).toBeUndefined() // last layer is the empty re-ask slot
  })

  it('the write anchors on the LAST ANS marker — the open slot, never the history', () => {
    const lines = DIALOGUE.split('\n')
    const start = lines.findIndex(l => l.startsWith('### QST:'))
    const anchors = scanAnswerWriteAnchors(lines, start)
    expect(lines[anchors.ansHeaderLineIdx]).toContain('to the updated recommendation')
  })

  it('applyAnswerQuestion fills the open slot and leaves the whole dialogue history intact', () => {
    const adr = parseAdr(DIALOGUE, '/fake/docs/adr/0033-t.md')
    const result = applyAnswerQuestion(DIALOGUE, '/fake/docs/adr/0033-t.md', adr.questions[0].id, 'Approved — ship the ride-along snapshot; the hold stands.', 'Jérémie')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.newContent).toContain('Approved — ship the ride-along snapshot')
      // Every prior layer survives byte-for-byte intact:
      expect(result.newContent).toContain('last standing thing for full sync')
      expect(result.newContent).toContain('stops the bleeding while the hold holds')
      expect(result.newContent).toContain('**B — hold with the concrete trigger.**')
    }
  })

  it('applyAddRecommendation on an already-layered question appends after the LAST ANS marker, not the first (regression: it used to splice between the ORIGINAL recommendation and ORIGINAL answer — a DEBRIEF-006-class wrong-location corruption, found by probing before assuming)', () => {
    const adr = parseAdr(DIALOGUE, '/fake/docs/adr/0033-t.md')
    const result = applyAddRecommendation(DIALOGUE, '/fake/docs/adr/0033-t.md', adr.questions[0].id, 'Probe Agent', 'A brand new third-round recommendation.', '2026-07-25')
    expect(result.ok).toBe(true)
    if (result.ok) {
      const newBlockIdx = result.newContent.indexOf('A brand new third-round recommendation.')
      const originalAnsIdx = result.newContent.indexOf('**ANS:** (by Jérémie Lumbroso — given in chat 2026-07-14')
      const updatedRecIdx = result.newContent.indexOf('**Recommendation (updated)**')
      const openSlotIdx = result.newContent.indexOf('**ANS (to the updated recommendation):**')
      // The new block must land after the WHOLE existing history, not
      // wedged between the first recommendation and the first answer.
      expect(newBlockIdx).toBeGreaterThan(originalAnsIdx)
      expect(newBlockIdx).toBeGreaterThan(updatedRecIdx)
      expect(newBlockIdx).toBeLessThan(openSlotIdx)
      // Every prior layer survives byte-for-byte intact:
      expect(result.newContent).toContain('last standing thing for full sync')
      expect(result.newContent).toContain('stops the bleeding while the hold holds')
    }
  })
})

describe('buildInsertionPreview (insertion-preview protocol, DEBRIEF-006 prevention)', () => {
  const lines = [
    'line0', 'line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7', 'line8',
  ]

  it('the ordinary case: 3 lines before, 3 lines starting at the insertion point', () => {
    const preview = buildInsertionPreview(lines, 4)
    expect(preview.before).toEqual(['line1', 'line2', 'line3'])
    expect(preview.after).toEqual(['line4', 'line5', 'line6'])
    expect(preview.insertLineIdx).toBe(4)
  })

  it('near the start of the document: "before" clamps rather than going negative or wrapping', () => {
    const preview = buildInsertionPreview(lines, 1)
    expect(preview.before).toEqual(['line0'])
    expect(preview.after).toEqual(['line1', 'line2', 'line3'])
  })

  it('at the very start: "before" is empty, not an out-of-bounds slice', () => {
    const preview = buildInsertionPreview(lines, 0)
    expect(preview.before).toEqual([])
    expect(preview.after).toEqual(['line0', 'line1', 'line2'])
  })

  it('near the end of the document: "after" clamps to whatever remains', () => {
    const preview = buildInsertionPreview(lines, 8)
    expect(preview.before).toEqual(['line5', 'line6', 'line7'])
    expect(preview.after).toEqual(['line8'])
  })

  it('at EOF (insertLineIdx === lines.length): "after" is empty', () => {
    const preview = buildInsertionPreview(lines, lines.length)
    expect(preview.after).toEqual([])
    expect(preview.before).toEqual(['line6', 'line7', 'line8'])
  })

  it('contextSize is configurable', () => {
    const preview = buildInsertionPreview(lines, 4, 1)
    expect(preview.before).toEqual(['line3'])
    expect(preview.after).toEqual(['line4'])
  })

  it('reproduces the actual DEBRIEF-006 shape: previews land squarely inside the recommendation, exactly what the confirm step exists to catch', () => {
    // The old (buggy) behavior would have inserted at heading+40, landing
    // inside this exact recommendation sentence. The preview must show
    // that collision plainly if a caller ever computed the wrong index —
    // this is the safety net's own acceptance case, not just API plumbing.
    const block = [
      '### QST: wave 2 trigger',
      '- Status: answered',
      '**Recommendation**: (by Commodore 5) **"This weekend," done from the',
      'manifest.** It unblocks the entire landing arc (round-3 convergence →',
      'Builder implementation → the public face), retires the oldest stall.',
      '',
      '---',
    ]
    const wrongInsertionPoint = 3 // mid-recommendation -- what DEBRIEF-006's bug actually did
    const preview = buildInsertionPreview(block, wrongInsertionPoint)
    expect(preview.before.join(' ')).toContain('Recommendation')
    expect(preview.after.join(' ')).toContain('manifest')
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

describe('Regression tests: scan uses the extractor\'s FULL marker + placeholder recognition (2026-07-26)', () => {
  // Jérémie, 2026-07-26: "the inability to insert answers is becoming
  // really almost omnipresent" — live specimen was his OWN ADR-0036 edit,
  // "**ANS**: (by Jérémie)" (colon outside the bold) over a
  // "[Fill this out]" placeholder. The extractor read both tolerantly
  // (COLON_OUTSIDE since crossfoot ADR-0029; placeholder family since
  // D9.4), but this scan carried private narrower copies: ANS_INLINE_RE
  // only + canonical-"[Fill this in]" only. Result: header invisible to
  // the write path → append-fallback previews/duplicate ANS blocks for
  // questions that had a perfectly good anchor.
  it('finds a colon-outside ANS header ("**ANS**: (by X)") as the write anchor (fixes the ADR-0036 refusal)', () => {
    const lines = [
      '### QST-UNRES-TOKEN: Is `unresolved` the right word?',
      '- Status: unanswered',
      '',
      '**ANS**: (by Jérémie)',
      '[Fill this out]',
      '',
      '### Next question',
    ]
    const a = scanAnswerWriteAnchors(lines, 0)
    expect(a.ansHeaderLineIdx).toBe(3)
    expect(a.fillLineIdx).toBe(4)
    expect(a.boundaryKind).toBe('heading')
  })

  it('recognizes the whole placeholder family as fill lines — "[Fill this out]", "[tbd]", "_pending — routing to Jérémie_"', () => {
    for (const placeholder of ['[Fill this out]', '[tbd]', '_pending — routing to Jérémie_', '[]']) {
      const lines = ['### QST: Q?', '- Status: unanswered', '**ANS:** (from Jérémie)', placeholder, '', '### Next']
      const a = scanAnswerWriteAnchors(lines, 0)
      expect(a.fillLineIdx, `placeholder form: ${placeholder}`).toBe(3)
    }
  })

  it('never mistakes a REAL short answer for a fill line (bare prose is not a placeholder)', () => {
    const lines = ['### QST: Q?', '- Status: unanswered', '**ANS:** (by Jérémie)', 'Pending on budget approval.', '', '### Next']
    const a = scanAnswerWriteAnchors(lines, 0)
    expect(a.fillLineIdx).toBe(-1)
  })
})

describe('Regression tests: the elenchus 0002 same-line multi-paragraph destruction (2026-07-24, reported 2026-07-27)', () => {
  // Real incident, reconstructed from the vault + file forensics: legacy
  // 0002-section-models.md held "**ANS:** (by Jérémie) Wow, what a great
  // anticipation…" — same-line first paragraph, then two more paragraphs —
  // with "- Status: unanswered". Answering through the panel (v0.7.27 era)
  // destroyed paragraph 1 AND the typed answer: the file ended up holding
  // only paragraphs 2-3 under a rewritten byline. Three fix generations
  // later (v0.7.29 replace-extent, v0.7.32 prefill/swap, v0.7.37 shared
  // predicates), this pins the invariants that make the class impossible:
  // the parse used for prefill must carry the FULL text including the
  // same-line start, and the write extent must cover the ENTIRE old answer
  // so what lands is exactly the submitted box, never a splice of both.
  const SPECIMEN = [
    '## Open Questions',
    '',
    '### QST: How do we handle capacity fairness in cross-registration?',
    '- Status: unanswered',
    '- Why asking: If Section 001 has 50 students…',
    '- Need: Policy decision + implementation approach',
    '',
    '**ANS:** (by Jérémie) Wow, what a great anticipation of a failure mode! Perhaps preallocation rules by proportion.',
    '',
    "I don't think we should give users more control besides FCFS vs preallocation.",
    '',
    'Thanks again for your generative question!',
    '',
    '---',
    '',
    '### QST: Do sections share TARGET_SESSIONS requirement?',
    '- Status: unanswered',
  ].join('\n')

  it('prefill source (q.answer.text) carries the same-line first paragraph AND the later paragraphs', () => {
    const adr = parseAdr(SPECIMEN, '/fake/legacy/docs/adr/0002-section-models.md')
    const q = adr.questions[0]
    expect(q.isAnswered).toBe(false) // declared Status wins; content is a draft
    expect(q.answer?.text).toContain('Wow, what a great anticipation')
    expect(q.answer?.text).toContain('generative question!')
  })

  it('the write extent spans header line through last paragraph — replacing leaves NO orphaned fragment behind', () => {
    const lines = SPECIMEN.split('\n')
    const a = scanAnswerWriteAnchors(lines, 2)
    expect(a.ansHeaderLineIdx).toBe(7)
    // Content end (exclusive) sits just past 'Thanks again…' at index 11 —
    // the extent [7..12) covers the same-line start and both later paragraphs.
    expect(a.ansContentEndLineIdx).toBe(12)
    expect(a.boundaryKind).toBe('break')
  })

  it('end-to-end (MCP path): the written file holds exactly the submitted answer — old paragraphs fully replaced, never spliced', () => {
    const adr = parseAdr(SPECIMEN, '/fake/legacy/docs/adr/0002-section-models.md')
    const q = adr.questions[0]
    const result = applyAnswerQuestion(
      SPECIMEN, '/fake/legacy/docs/adr/0002-section-models.md', q.id,
      'I think that question has been debated at length in the legacy ADRs. You should check it out.',
      'Jérémie Lumbroso',
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.newContent).toContain('debated at length in the legacy ADRs')
      // The incident's signature: paragraphs 2-3 surviving while the typed
      // answer vanished. Neither fragment of the old draft may remain.
      expect(result.newContent).not.toContain('Wow, what a great anticipation')
      expect(result.newContent).not.toContain("I don't think we should give users")
      expect(result.newContent).not.toContain('generative question!')
      // The neighboring question is untouched (wrong-question guard).
      expect(result.newContent).toContain('Do sections share TARGET_SESSIONS requirement?')
    }
  })
})
