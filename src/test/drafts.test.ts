/**
 * Draft persistence tests — ADR-0023 (Anti-Clobbering Posture)
 *
 * Real Jérémie report, not a hypothetical: DEBRIEF-001 recorded an agent
 * renaming and wholesale-rewriting an ADR file while he was mid-answer in
 * the Open Questions panel, destroying his in-progress input. The
 * acceptance fixture at the end of this file replays that exact sequence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  normalizeQuestionText,
  questionTextHash,
  computeOccurrenceOrdinals,
  computeOccurrenceCounts,
  computeDraftKey,
} from '../drafts/draftKey'
import { DraftStore, textSimilarity, bestReattachCandidate } from '../drafts/draftStore'
import { parseAdr } from '../parser/extractor'

// ---------------------------------------------------------------------------
// draftKey.ts
// ---------------------------------------------------------------------------

describe('normalizeQuestionText', () => {
  it('trims, collapses whitespace, and lowercases', () => {
    expect(normalizeQuestionText('  What   is the  Scope?  ')).toBe('what is the scope?')
  })

  it('strips a leading "QST:" prefix', () => {
    expect(normalizeQuestionText('QST: What is the scope?')).toBe('what is the scope?')
  })

  it('is stable across cosmetic edits (extra space, case)', () => {
    const a = normalizeQuestionText('What is the scope?')
    const b = normalizeQuestionText('what   is the scope?')
    expect(a).toBe(b)
  })
})

describe('computeOccurrenceOrdinals', () => {
  it('assigns 0 to the first occurrence and increments for duplicates', () => {
    const texts = ['Which database?', 'Which database?', 'What about caching?', 'Which database?']
    expect(computeOccurrenceOrdinals(texts)).toEqual([0, 1, 0, 2])
  })

  it('is line-number robust: order depends only on relative document position', () => {
    // Same texts, reordered — ordinals track the new order, not any absolute line.
    const texts = ['A', 'B', 'A']
    expect(computeOccurrenceOrdinals(texts)).toEqual([0, 0, 1])
  })
})

describe('computeDraftKey', () => {
  it('is identical for the same ADR + question + ordinal', () => {
    const k1 = computeDraftKey(3, 'Which database?', 0)
    const k2 = computeDraftKey(3, 'Which database?', 0)
    expect(k1).toBe(k2)
  })

  it('differs across ADR number, question text, or ordinal', () => {
    const base = computeDraftKey(3, 'Which database?', 0)
    expect(computeDraftKey(4, 'Which database?', 0)).not.toBe(base)
    expect(computeDraftKey(3, 'Which cache?', 0)).not.toBe(base)
    expect(computeDraftKey(3, 'Which database?', 1)).not.toBe(base)
  })

  it('is robust to line-shift-only changes (same key before/after reordering elsewhere)', () => {
    // Answering an earlier question in the file shifts every later question's
    // line number — the key must not depend on line number at all.
    const key = computeDraftKey(3, 'Which database?', 0)
    expect(key).toBe(computeDraftKey(3, 'Which database?', 0))
    expect(key).toContain(questionTextHash('Which database?'))
  })
})

// ---------------------------------------------------------------------------
// DraftStore
// ---------------------------------------------------------------------------

describe('DraftStore', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-drafts-test-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('save() then get() round-trips the draft text', () => {
    const store = new DraftStore(dir)
    const key = computeDraftKey(3, 'Which database?', 0)
    store.save(key, '/fake/0003.md', 3, 'Which database?', 'I think Postgres.', '2026-07-06T20:00:00Z')
    expect(store.get(key)?.draftText).toBe('I think Postgres.')
  })

  it('persists to docs/adr/.working/drafts.json (committed substrate, not a sidecar)', () => {
    const store = new DraftStore(dir)
    const key = computeDraftKey(3, 'Which database?', 0)
    store.save(key, '/fake/0003.md', 3, 'Which database?', 'Draft text', '2026-07-06T20:00:00Z')
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'drafts.json'), 'utf8'))
    expect(onDisk).toHaveLength(1)
    expect(onDisk[0].draftText).toBe('Draft text')
  })

  it('a fresh DraftStore instance reloads persisted drafts from disk', () => {
    const key = computeDraftKey(3, 'Which database?', 0)
    const store1 = new DraftStore(dir)
    store1.save(key, '/fake/0003.md', 3, 'Which database?', 'Persisted draft', '2026-07-06T20:00:00Z')

    const store2 = new DraftStore(dir)
    expect(store2.get(key)?.draftText).toBe('Persisted draft')
  })

  it('save() keeps prior revisions in history (capped)', () => {
    const store = new DraftStore(dir)
    const key = computeDraftKey(3, 'Which database?', 0)
    store.save(key, '/fake/0003.md', 3, 'Which database?', 'v1', '2026-07-06T20:00:00Z')
    store.save(key, '/fake/0003.md', 3, 'Which database?', 'v2', '2026-07-06T20:00:01Z')
    store.save(key, '/fake/0003.md', 3, 'Which database?', 'v3', '2026-07-06T20:00:02Z')
    const draft = store.get(key)!
    expect(draft.draftText).toBe('v3')
    expect(draft.history).toEqual(['v1', 'v2'])
  })

  it('promote() archives the draft and removes it from the active set', () => {
    const store = new DraftStore(dir)
    const key = computeDraftKey(3, 'Which database?', 0)
    store.save(key, '/fake/0003.md', 3, 'Which database?', 'Final answer text', '2026-07-06T20:00:00Z')
    store.promote(key, '2026-07-06T20:05:00Z')

    expect(store.get(key)).toBeUndefined()
    const archived = store.allArchived()
    expect(archived).toHaveLength(1)
    expect(archived[0].draftText).toBe('Final answer text')
    expect(archived[0].reason).toBe('promoted')
  })

  it('promote() never deletes — the archive is a separate, permanent file', () => {
    const store = new DraftStore(dir)
    const key = computeDraftKey(3, 'Which database?', 0)
    store.save(key, '/fake/0003.md', 3, 'Which database?', 'Answer', '2026-07-06T20:00:00Z')
    store.promote(key, '2026-07-06T20:05:00Z')

    const archivePath = path.join(dir, 'drafts-archive.json')
    expect(fs.existsSync(archivePath)).toBe(true)
    const onDisk = JSON.parse(fs.readFileSync(archivePath, 'utf8'))
    expect(onDisk).toHaveLength(1)
  })

  it('orphans() finds drafts whose key no longer matches any live question', () => {
    const store = new DraftStore(dir)
    const staleKey = computeDraftKey(3, 'Which database?', 0)
    const liveKey = computeDraftKey(3, 'Which cache?', 0)
    store.save(staleKey, '/fake/0003.md', 3, 'Which database?', 'Old draft', '2026-07-06T20:00:00Z')
    store.save(liveKey, '/fake/0003.md', 3, 'Which cache?', 'Live draft', '2026-07-06T20:01:00Z')

    const orphans = store.orphans([{ key: liveKey, text: 'Which cache?', adrNumber: 3 }])
    expect(orphans).toHaveLength(1)
    expect(orphans[0].key).toBe(staleKey)
  })

  it('reattach() moves a draft to a new key without touching its text — never silent (caller-confirmed only)', () => {
    const store = new DraftStore(dir)
    const oldKey = computeDraftKey(3, 'Which database?', 0)
    const newKey = computeDraftKey(3, 'Which database engine?', 0)
    store.save(oldKey, '/fake/0003.md', 3, 'Which database?', 'My answer', '2026-07-06T20:00:00Z')

    store.reattach(oldKey, newKey, '2026-07-06T20:10:00Z')

    expect(store.get(oldKey)).toBeUndefined()
    expect(store.get(newKey)?.draftText).toBe('My answer')
  })
})

describe('textSimilarity + bestReattachCandidate', () => {
  it('scores identical text as 1 and disjoint text as 0', () => {
    expect(textSimilarity('Which database?', 'Which database?')).toBe(1)
    expect(textSimilarity('Which database?', 'Completely unrelated topic here')).toBeLessThan(0.3)
  })

  it('suggests the same-ADR question with highest word overlap by default', () => {
    const orphan = {
      key: 'stale',
      adrPath: '/fake/0003.md',
      adrNumber: 3,
      questionText: 'Which database backend should we use?',
      draftText: 'Postgres.',
      updatedAt: '2026-07-06T20:00:00Z',
      history: [],
    }
    const live = [
      { key: 'k1', text: 'Which database engine should we use?', adrNumber: 3 },
      { key: 'k2', text: 'What is the deploy target?', adrNumber: 3 },
      { key: 'k3', text: 'Which database backend should we use?', adrNumber: 9 }, // exact match, wrong ADR
    ]
    expect(bestReattachCandidate(orphan, live)).toBe('k1')
  })

  it('falls back to any live question when none share the ADR number', () => {
    const orphan = {
      key: 'stale', adrPath: '/fake/0003.md', adrNumber: 3,
      questionText: 'Which database?', draftText: '', updatedAt: '', history: [],
    }
    const live = [{ key: 'k1', text: 'Which database engine?', adrNumber: 9 }]
    expect(bestReattachCandidate(orphan, live)).toBe('k1')
  })

  it('returns undefined when there are no live questions at all', () => {
    const orphan = {
      key: 'stale', adrPath: '/fake/0003.md', adrNumber: 3,
      questionText: 'Which database?', draftText: '', updatedAt: '', history: [],
    }
    expect(bestReattachCandidate(orphan, [])).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Acceptance fixture (ADR-0023, DEBRIEF-001): the exact destroying sequence,
// replayed, must preserve the answer.
// ---------------------------------------------------------------------------

describe('DEBRIEF-001 acceptance fixture: rename + rewrite must not destroy an in-progress draft', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-drafts-debrief-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('replays: human answers in the panel, agent renames + rewrites the file, draft survives', () => {
    // 1. The original ADR, as it exists when the human starts answering.
    const original = `# ADR-0022: The Shipping Posture (freeze draft)

- **Status**: Draft

## Questions

### QST: What is the mechanism that keeps ship pressure present-but-not-absolute?
- Status: unanswered

**ANS:** (by Jérémie)
[Fill this in]
`
    const originalPath = path.join(dir, '0022-shipping-posture.md')
    fs.writeFileSync(originalPath, original)

    const adrBefore = parseAdr(original, originalPath)
    const q = adrBefore.questions[0]
    const ordinals = computeOccurrenceOrdinals(adrBefore.questions.map(qq => qq.text))
    const key = computeDraftKey(adrBefore.number, q.text, ordinals[0])

    const store = new DraftStore(dir)

    // 2. Human starts typing an answer — auto-saved as a draft (debounced
    //    ~500ms in the real panel; synchronous here since DraftStore itself
    //    doesn't debounce).
    store.save(
      key, originalPath, adrBefore.number, q.text,
      'A one-line Ship-path declaration per workstream, not a gate.',
      '2026-07-06T21:05:00Z',
    )

    // 3. THE INCIDENT: an agent renames the file and wholesale-rewrites its
    //    content — completely different prose, same underlying topic.
    const renamedPath = path.join(dir, '0022-shipping-posture-v2.md')
    fs.rmSync(originalPath)
    const rewritten = `# ADR-0022: The Shipping Posture — Convergence as a Companion Force

- **Status**: Draft

## Questions

### QST: What is the mechanism that keeps ship pressure present-but-not-absolute?
- Status: unanswered

**ANS:** (by Jérémie)
[Fill this in]
`
    fs.writeFileSync(renamedPath, rewritten)

    // 4. Reindex after the rewrite (what a file-watcher-triggered reindex sees).
    const adrAfter = parseAdr(rewritten, renamedPath)
    const qAfter = adrAfter.questions[0]
    const ordinalsAfter = computeOccurrenceOrdinals(adrAfter.questions.map(qq => qq.text))
    const keyAfter = computeDraftKey(adrAfter.number, qAfter.text, ordinalsAfter[0])

    // Same question text, same ADR number (the rewrite didn't change the
    // question or the file's number) → same key → the draft survives
    // *because it was never touched by the rewrite* (it lives in
    // .working/drafts.json, entirely outside the rewritten file).
    expect(keyAfter).toBe(key)
    const survivingDraft = store.get(keyAfter)
    expect(survivingDraft).toBeDefined()
    expect(survivingDraft?.draftText).toBe('A one-line Ship-path declaration per workstream, not a gate.')
  })

  it('replays the worse case: the rewrite also changes the question text — draft becomes a listed orphan, never lost', () => {
    const originalPath = path.join(dir, '0022-shipping-posture.md')
    const original = `# ADR-0022: Ship Posture

- **Status**: Draft

## Questions

### QST: What is the mechanism that keeps ship pressure present-but-not-absolute?
- Status: unanswered

**ANS:** (by Jérémie)
[Fill this in]
`
    fs.writeFileSync(originalPath, original)
    const adrBefore = parseAdr(original, originalPath)
    const q = adrBefore.questions[0]
    const key = computeDraftKey(adrBefore.number, q.text, 0)

    const store = new DraftStore(dir)
    store.save(key, originalPath, adrBefore.number, q.text, 'In-progress human answer.', '2026-07-06T21:05:00Z')

    // Rewrite changes the question's wording too (not just surrounding prose).
    const rewritten = `# ADR-0022: Ship Posture

- **Status**: Draft

## Questions

### QST: What keeps ship pressure present but never absolute?
- Status: unanswered

**ANS:** (by Jérémie)
[Fill this in]
`
    fs.writeFileSync(originalPath, rewritten)
    const adrAfter = parseAdr(rewritten, originalPath)
    const liveRefs = adrAfter.questions.map((qq, i) => ({
      key: computeDraftKey(adrAfter.number, qq.text, i),
      text: qq.text,
      adrNumber: adrAfter.number,
    }))

    // The old key no longer matches any live question — it's an orphan,
    // not gone. The draft text is still fully recoverable from the store.
    const orphans = store.orphans(liveRefs)
    expect(orphans).toHaveLength(1)
    expect(orphans[0].draftText).toBe('In-progress human answer.')

    // And the reattach picker can suggest exactly this question back (same
    // ADR, near-identical wording).
    expect(bestReattachCandidate(orphans[0], liveRefs)).toBe(liveRefs[0].key)
  })
})

// ---------------------------------------------------------------------------
// Adversarial findings (Quarry 5, write-adversary seat — ADR-0022's chartered
// "make it misbehave" seat). ADR-0023 was built to make DEBRIEF-001's failure
// class unreachable; these three tests are currently FAILING — each is a
// distinct path back to that same failure class (silent loss or silent
// misattachment of a human's in-progress answer) that the shipped
// implementation does not close. Filed to Fitter 5 (implementer) per
// docs/inbox/2026-07-07-2018-quarry-to-fitter-three-catches-in-the-shipped-draft-store.md
// — routed as catches per CONVENTIONS §3, not fixed unilaterally here.
// ---------------------------------------------------------------------------

describe('Adversarial findings: DraftStore silent-loss and silent-misattachment paths', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-drafts-adversarial-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('CATCH 1 — a truncated drafts.json (process dies mid-write) silently discards every OTHER draft on the next autosave, with no error ever surfaced', () => {
    // Not exotic: a VS Code crash, OS kill, or disk-full event mid-`fs.writeFileSync`
    // is exactly what DEBRIEF-001's "partial-failure states" target names.
    const store1 = new DraftStore(dir)
    const keyA = computeDraftKey(3, 'Which database?', 0)
    const keyB = computeDraftKey(4, 'Which cache?', 0)
    store1.save(keyA, '/fake/0003.md', 3, 'Which database?', 'Answer A, in progress.', '2026-07-06T20:00:00Z')
    store1.save(keyB, '/fake/0004.md', 4, 'Which cache?', 'Answer B, in progress.', '2026-07-06T20:01:00Z')

    // Simulate the crash: the OS flushed only half the buffered write.
    const draftsPath = path.join(dir, 'drafts.json')
    const full = fs.readFileSync(draftsPath, 'utf8')
    fs.writeFileSync(draftsPath, full.slice(0, Math.floor(full.length / 2)))

    // VS Code reopens the window after the crash — a fresh DraftStore loads
    // over the truncated file. load()'s catch block swallows the parse
    // error and resets to an EMPTY in-memory map, with no warning to the
    // human and no quarantine of the damaged file.
    const store2 = new DraftStore(dir)

    // The human, unaware anything happened, keeps typing — the very next
    // debounced autosave for the question they're actively on (A) persists
    // that empty-except-A map back to disk, permanently erasing B (which
    // was never touched, never in conflict, and had nothing to do with A).
    store2.save(keyA, '/fake/0003.md', 3, 'Which database?', 'Retyped answer A.', '2026-07-06T20:05:00Z')

    const store3 = new DraftStore(dir)
    expect(store3.get(keyB)?.draftText).toBe('Answer B, in progress.')
  })

  it('CATCH 2 — two concurrent DraftStore instances (two VS Code windows on one workspace) silently drop each other\'s saves; no lock, no merge, last full-file write wins', () => {
    // Two windows on the same workspace answering different ADRs is ordinary
    // multi-window usage, not a contrived scenario — the brief names this
    // target explicitly ("concurrent writes to one QST from two sessions").
    const keyA = computeDraftKey(3, 'Which database?', 0)
    const keyB = computeDraftKey(4, 'Which cache?', 0)

    const session1 = new DraftStore(dir)
    session1.save(keyA, '/fake/0003.md', 3, 'Which database?', 'Session 1 answer.', '2026-07-06T20:00:00Z')

    // Session 2 opens a moment later; DraftStore.load() only runs once, in
    // the constructor — session2's in-memory map never learns about keyA,
    // and vice versa going forward.
    const session2 = new DraftStore(dir)
    session2.save(keyB, '/fake/0004.md', 4, 'Which cache?', 'Session 2 answer.', '2026-07-06T20:01:00Z')

    // Session 1's next keystroke autosave persists ITS in-memory map — which
    // never contained keyB — clobbering the whole drafts.json file.
    session1.save(keyA, '/fake/0003.md', 3, 'Which database?', 'Session 1 answer, continued.', '2026-07-06T20:02:00Z')

    const onDisk = new DraftStore(dir)
    expect(onDisk.get(keyB)?.draftText).toBe('Session 2 answer.')
  })

  it('CATCH 3 — inserting a new occurrence of duplicate question text hands an existing draft\'s key to a DIFFERENT question; getIfMatching() refuses to restore it, and orphans() still flags it', () => {
    // Duplicated boilerplate QST wording across sections (e.g. a repeated
    // closing question) is common, ordinary ADR authoring — not exotic.
    //
    // Note on this test's shape (a correction to the originally-filed catch):
    // computeDraftKey(3, 'Any other concerns?', 1) is a pure function of its
    // three arguments — calling it twice with identical arguments can only
    // ever produce the identical string, so no fix expressible as "make
    // store.get() of that same string return something different" can exist
    // without get() itself becoming unsound for ordinary lookups (which
    // CATCH 1/2's own assertions, and every non-adversarial test above,
    // depend on). The real fix closes the actual danger Quarry named
    // (silent misattachment across a duplicate-text ordinal shift) at the
    // two places it's actually observable: the RESTORE path (a safe
    // accessor that refuses to trust a key whose duplicate-group shape
    // changed) and the ORPHAN-DETECTION path (still flags it for the
    // reattach picker even though the bare key is technically "live").
    const textsBefore = ['Which database?', 'Any other concerns?', 'Any other concerns?']
    const ordinalsBefore = computeOccurrenceOrdinals(textsBefore)
    const totalsBefore = computeOccurrenceCounts(textsBefore) // [1, 2, 2]
    const keyForDeploySectionClosingQ = computeDraftKey(3, 'Any other concerns?', ordinalsBefore[2]) // ordinal 1

    const store = new DraftStore(dir)
    store.save(
      keyForDeploySectionClosingQ, '/fake/0003.md', 3, 'Any other concerns?',
      'No, this covers it for the deploy section.', '2026-07-06T20:00:00Z',
      totalsBefore[2], // 2 siblings shared this hash at save time
    )

    // Human inserts a THIRD occurrence of the same duplicate text earlier in
    // the document (a new section's closing question, placed before the
    // deploy section) — an ordinary edit, not a rename, not a deletion.
    // Document order among duplicates shifts: what was ordinal-1 (deploy
    // section) is now ordinal-2; a DIFFERENT question now occupies ordinal-1,
    // and the *sibling count* for that hash is now 3, not 2.
    const textsAfter = ['Which database?', 'Any other concerns?', 'Any other concerns?', 'Any other concerns?']
    const totalsAfter = computeOccurrenceCounts(textsAfter) // [1, 3, 3, 3]
    const keyNowAtOrdinal1 = computeDraftKey(3, 'Any other concerns?', 1) // same string as keyForDeploySectionClosingQ

    // The key is technically "live" (a real, different question occupies
    // ordinal 1 now) and its text even matches ('Any other concerns?' is
    // the shared boilerplate) — so a check on text alone isn't enough. The
    // sibling-count mismatch (2 at save time vs. 3 now) is the signal that
    // something in this duplicate-text group shifted, and getIfMatching()
    // refuses to restore on that basis: silently pre-filling the wrong
    // question's answer box would be worse than not restoring at all.
    expect(store.getIfMatching(keyNowAtOrdinal1, 'Any other concerns?', totalsAfter[1])).toBeUndefined()

    // And it's not silently lost either — orphans() still flags it (even
    // though liveByKey technically has this key) because the live totals
    // don't match what was saved, so the reattach picker gets a chance to
    // ask a human rather than the panel silently misattaching it.
    const liveRefs = [
      { key: computeDraftKey(3, 'Which database?', 0), text: 'Which database?', adrNumber: 3, totalOccurrences: totalsAfter[0] },
      { key: keyNowAtOrdinal1, text: 'Any other concerns?', adrNumber: 3, totalOccurrences: totalsAfter[1] },
    ]
    const orphans = store.orphans(liveRefs)
    expect(orphans).toHaveLength(1)
    expect(orphans[0].key).toBe(keyForDeploySectionClosingQ)
    expect(orphans[0].draftText).toBe('No, this covers it for the deploy section.')
  })
})
