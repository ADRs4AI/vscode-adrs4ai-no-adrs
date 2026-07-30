/**
 * Ephemeral verification — Flint 5, 2026-07-30.
 * Context: Facet's dispatch (docs/inbox/2026-07-30-0103-facet-to-flint-owns-
 * placeholder-parsing-seed.md), seed docs/adr/seed-2026-07-29-issue-parsing-
 * text-after-ans-placeholder-of-qsts.md. Jérémie's report: the Open
 * Questions panel's editing field for QST-COMMITPROVENANCE (in
 * seed-2026-07-29-random-feedback-from-experience.md) pre-filled with
 * "[Fill this in]" followed by an unrelated "**ADR mapping**:" paragraph
 * that belongs to the WHOLE THREAD, not this question — leading to
 * duplicated text on submit. Reconstructing the exact "before" specimen
 * (Facet's quoted blocks) to check whether parseSeed()/extractQuestion()
 * itself swallows the trailing content, before assuming it's a webview-only
 * bug.
 *
 * Outcome: confirmed the extractor itself was the culprit — the whole-
 * content-anchored placeholder check requires answerText to be JUST the
 * placeholder, so "[Fill this in]\n\n\n**ADR mapping**: ..." (blank lines
 * only between them, no "---", no next heading) failed that anchor and
 * the whole paragraph became literal answer content. Root cause: the
 * answer-collection loop had no stop-check for a new bold-key field once
 * only a placeholder had been collected so far (unlike the recommendation-
 * continuation loop, which already stops at a new "**Key**:" line).
 * Fixed in extractor.ts (isPlaceholderOnly() + a bold-key stop-check
 * scoped to placeholder-only content, so a real in-progress answer that
 * legitimately contains a "**Note**:"-shaped line is untouched). Two of
 * my own regression-test assertions were miscalibrated on first pass
 * (status-authority forbids isAnswered=true under a declared "unanswered"
 * status; the leftover paragraph lands in `rawBody`, not `rawBodyPost`,
 * when there's no Recommendation block ahead of it) — caught and
 * corrected by Riddle 5, shipped together as v0.7.54 (946/946 green).
 */
import { parseSeed } from '../../src/parser/seedExtractor'

const specimen = `# SEED: Random Feedback From Experience

- **Date**: 2026-07-29
- **From**: Human

---

## Brain Dump

placeholder brain dump text.

---

**Model Response Request:**

- [ ] Chunk this into ADRs (I'm ready to formalize)
- [X] Iterate with me (keep exploring)
- [ ] Structure in place (organize but don't split)

---

## Thread

### Lapidary 5 (Claude Fable 5) - 2026-07-29

Some structured reply text here.

### QST-COMMITPROVENANCE: (reach) Should ADR-Commit messages cite the tour that drove the session?

- Status: unanswered
- Why asking: When you answer through a tour, the commit could read "human feedback on ADR-0110 (via tour: gadfly-sprint-priority)" — decision-provenance extended to the attention layer; the changelog idea's sibling.
- Need: yes/no; costs one field the panel already has.

**Recommendation**: (Lapidary 5) Yes, when a tour context exists — free provenance, and it makes tours legible in git history, which is where the anthropologist digs.

**ANS:** (by Jérémie)
[Fill this in]


**ADR mapping**: A (commit surface) → small NEW ADR (the button has no ADR; it has earned one — behavior, messages, multi-root, provenance). C5/C6 (error ledger) → NEW small ADR or a section in ADR-0031's census family (my lean: standalone small ADR, referenced by 0031/0034 — the primitive outlives both). C4 + tour treeview refinements → ADR-0034 Iteration (expand, don't new). B (icons/order) → no ADR; settings + one CHANGELOG line. All dispatched as above; QSTs await you.

---

**Model Response Request:**

- [ ] Chunk this into ADRs
- [X] Iterate with me
- [ ] Structure in place

### Riddle 5 (Claude Fable 5) — 2026-07-29, the error-ledger design

Some other reply text entirely unrelated to QST-COMMITPROVENANCE.

---

## Derived Into

*(This seed has not yet been chunked into ADRs)*
`

const seed = parseSeed(specimen, '/fake/docs/adr/seed-2026-07-29-random-feedback-from-experience.md')
const q = seed.questions.find(q => q.qstId === 'COMMITPROVENANCE')
console.log('isAnswered:', q?.isAnswered)
console.log('answer:', JSON.stringify(q?.answer, null, 2))
console.log('rawBodyPost:', JSON.stringify(q?.rawBodyPost))
