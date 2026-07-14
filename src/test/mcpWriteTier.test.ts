/**
 * Behavioral tests for the ADR-0021 write tier (`answer_question`,
 * `add_recommendation`, `append_iteration`, `update_resolution`) — the
 * second half of the launch sprint's Track 1.
 *
 * The mock RepositoryContext here is backed by a real in-memory file map and
 * re-parses via the actual `parseAdr` on every `getAdr`/`readFile` call —
 * closer to how the real VS Code-backed context will behave than a
 * hand-built AdrFile fixture would be, and it exercises the real
 * `writeOps.ts` mutation logic against real markdown, not a stand-in shape.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'crypto'
import type { RepositoryContext } from '../mcp/repositoryContext'
import { answerQuestion, addRecommendation, appendIteration, updateResolution } from '../mcp/handlers'
import { parseAdr } from '../parser/extractor'
import { _resetDedupeCacheForTests } from '../mcp/dedupe'

const ADR_PATH = '/fake/docs/adr/0001-test-decision.md'

const FIXTURE = `# ADR-0001: Test Decision

- **Date**: 2026-01-01
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

---

## Questions

### QST: What is the scope?
- Status: unanswered
- Why asking: Because it matters.

**ANS:** (by nobody)
[Fill this in]

---

## Iterations

### Iteration 1 (2026-01-01)
- Human: Started.
- AI: Drafted.
- Outcome: Draft created.

---

## Links
`

function sha1(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

function makeContext(initialContent: string): { ctx: RepositoryContext; files: Map<string, string>; writeCount: () => number } {
  const files = new Map<string, string>([[ADR_PATH, initialContent]])
  let writes = 0
  const ctx: RepositoryContext = {
    listAdrs: () => [...files.entries()].map(([path, content]) => parseAdr(content, path)),
    getAdr: (ref: string) => {
      const num = parseInt(ref.replace(/^adr:/, ''), 10)
      const entry = [...files.entries()].find(([path, content]) => parseAdr(content, path).number === num)
      return entry ? parseAdr(entry[1], entry[0]) : undefined
    },
    listSeeds: () => [],
    getSeed: () => undefined,
    readFile: async (path: string) => {
      const content = files.get(path)
      if (content === undefined) throw new Error(`mock context: no such file ${path}`)
      return content
    },
    writeFile: async (path: string, content: string) => {
      files.set(path, content)
      writes += 1
    },
    listFiles: async () => [...files.keys()],
  }
  return { ctx, files, writeCount: () => writes }
}

beforeEach(() => {
  _resetDedupeCacheForTests()
})

describe('answerQuestion', () => {
  it('replaces status and the ANS placeholder, and returns a diff', async () => {
    const { ctx, files } = makeContext(FIXTURE)
    const result = await answerQuestion(ctx, '1', 'adr-0001-qst-what-is-the-scope', 'The scope is X.', { author: 'Relay 5' })

    expect(result).toContain('Answered adr-0001-qst-what-is-the-scope in adr:0001')
    const newContent = files.get(ADR_PATH)!
    expect(newContent).toContain('- Status: answered')
    expect(newContent).toContain('**ANS:** (by Relay 5)')
    expect(newContent).toContain('The scope is X.')
    expect(newContent).not.toContain('[Fill this in]')
  })

  it('requires an explicit author — never defaults to "AI"', async () => {
    const { ctx, writeCount } = makeContext(FIXTURE)
    const result = await answerQuestion(ctx, '1', 'adr-0001-qst-what-is-the-scope', 'The scope is X.')
    expect(result).toContain('error: missing_author')
    expect(writeCount()).toBe(0)
  })

  it('detects a stale base_checksum and refuses to overwrite', async () => {
    const { ctx, writeCount } = makeContext(FIXTURE)
    const result = await answerQuestion(ctx, '1', 'adr-0001-qst-what-is-the-scope', 'X', {
      author: 'Relay 5',
      baseChecksum: 'not-the-real-checksum',
    })
    expect(result).toContain('status: conflict')
    expect(result).toContain('options: refresh | branch-anyway | cancel')
    expect(writeCount()).toBe(0)
  })

  it('proceeds without base_checksum — anchored writes are safe with no prior read', async () => {
    const { ctx, writeCount } = makeContext(FIXTURE)
    const result = await answerQuestion(ctx, '1', 'adr-0001-qst-what-is-the-scope', 'X', { author: 'Relay 5' })
    expect(result).toContain('Answered')
    expect(writeCount()).toBe(1)
  })

  it('accepts a matching base_checksum and writes normally', async () => {
    const { ctx, writeCount } = makeContext(FIXTURE)
    const result = await answerQuestion(ctx, '1', 'adr-0001-qst-what-is-the-scope', 'X', {
      author: 'Relay 5',
      baseChecksum: sha1(FIXTURE),
    })
    expect(result).toContain('Answered')
    expect(writeCount()).toBe(1)
  })

  it('dedupes on client_msg_id: a repeated call returns the cached result without writing again', async () => {
    const { ctx, writeCount } = makeContext(FIXTURE)
    const first = await answerQuestion(ctx, '1', 'adr-0001-qst-what-is-the-scope', 'X', { author: 'Relay 5', clientMsgId: 'm1' })
    const second = await answerQuestion(ctx, '1', 'adr-0001-qst-what-is-the-scope', 'Y (should not land)', { author: 'Relay 5', clientMsgId: 'm1' })
    expect(second).toBe(first)
    expect(writeCount()).toBe(1)
  })

  it('returns a structured error, not a throw, when the question id no longer exists', async () => {
    const { ctx, writeCount } = makeContext(FIXTURE)
    const result = await answerQuestion(ctx, '1', 'adr-0001-qst-does-not-exist', 'X', { author: 'Relay 5' })
    expect(result).toContain('error: write_failed')
    expect(writeCount()).toBe(0)
  })
})

describe('addRecommendation', () => {
  it('inserts a stacked Recommendation block before the ANS header, author+date auto-stamped', async () => {
    const { ctx, files } = makeContext(FIXTURE)
    const result = await addRecommendation(ctx, '1', 'adr-0001-qst-what-is-the-scope', 'Relay 5', 'Ship it.')

    expect(result).toContain('Added recommendation (by Relay 5)')
    const newContent = files.get(ADR_PATH)!
    expect(newContent).toMatch(/\*\*Recommendation\*\*: \(by Relay 5, \d{4}-\d{2}-\d{2}\)/)
    const recIdx = newContent.indexOf('**Recommendation**:')
    const ansIdx = newContent.indexOf('**ANS:**')
    expect(recIdx).toBeGreaterThan(-1)
    expect(recIdx).toBeLessThan(ansIdx)
    expect(newContent).toContain('Ship it.')
  })

  it('requires an explicit author here too', async () => {
    const { ctx } = makeContext(FIXTURE)
    const result = await addRecommendation(ctx, '1', 'adr-0001-qst-what-is-the-scope', '', 'Ship it.')
    expect(result).toContain('error: missing_author')
  })
})

describe('appendIteration', () => {
  it('computes the next iteration number from the actual log (MAX+1), not the header field', async () => {
    const { ctx, files } = makeContext(FIXTURE)
    const result = await appendIteration(ctx, '1', { human: 'Reviewed.', ai: 'Implemented.', outcome: 'Shipped.', date: '2026-07-07' })

    expect(result).toContain('Appended Iteration 2 to adr:0001')
    const newContent = files.get(ADR_PATH)!
    expect(newContent).toContain('### Iteration 2 (2026-07-07)')
    expect(newContent).toContain('- Human: Reviewed.')
    expect(newContent).toContain('- AI: Implemented.')
    expect(newContent).toContain('- Outcome: Shipped.')
  })

  it('keeps incrementing across successive calls', async () => {
    const { ctx, files } = makeContext(FIXTURE)
    await appendIteration(ctx, '1', { outcome: 'first', date: '2026-07-07' })
    const result = await appendIteration(ctx, '1', { outcome: 'second', date: '2026-07-08' })
    expect(result).toContain('Appended Iteration 3 to adr:0001')
    expect(files.get(ADR_PATH)).toContain('### Iteration 3 (2026-07-08)')
  })

  it('regression: the trailing --- separator stays the terminator before ## Links, not shoved mid-log (Quarry 5\'s bonus artifact, 2026-07-09)', async () => {
    // AdrSection.lineEnd for the last section in a file includes its
    // trailing --- separator as part of the body; the original insertion
    // logic spliced there naively, moving that --- into the middle of the
    // Iterations log (between the old last entry and the new one) instead
    // of leaving it as the terminator before the next section. This
    // reproduced on every single call, not just under concurrency -- caught
    // while investigating Quarry's report, but never given its own
    // regression test at the time. Fixing that gap now.
    const { ctx, files } = makeContext(FIXTURE)
    await appendIteration(ctx, '1', { outcome: 'second', date: '2026-07-08' })
    const content = files.get(ADR_PATH)!

    const iterEndIdx = content.indexOf('- Outcome: second')
    const separatorIdx = content.indexOf('---', iterEndIdx)
    const linksIdx = content.indexOf('## Links')

    expect(separatorIdx).toBeGreaterThan(-1)
    expect(separatorIdx).toBeLessThan(linksIdx)
    // Exactly one --- between the new entry and ## Links, not the entry
    // wedged between two --- lines.
    expect(content.slice(iterEndIdx, linksIdx).match(/^---$/gm)?.length).toBe(1)
  })
})

describe('updateResolution', () => {
  it('sets a resolution that does not require a note', async () => {
    const { ctx, files } = makeContext(FIXTURE)
    const result = await updateResolution(ctx, '1', 'consensus')
    expect(result).toContain("Updated resolution for adr:0001 to 'consensus'")
    expect(files.get(ADR_PATH)).toContain('- **Resolution**: consensus')
  })

  it('rejects fiat without a note, per ADR-0009, and does not write', async () => {
    const { ctx, writeCount } = makeContext(FIXTURE)
    const result = await updateResolution(ctx, '1', 'fiat')
    expect(result).toContain('error: missing_resolution_note')
    expect(writeCount()).toBe(0)
  })

  it('accepts fiat with a note and writes both fields', async () => {
    const { ctx, files } = makeContext(FIXTURE)
    const result = await updateResolution(ctx, '1', 'fiat', 'Time pressure before the demo.')
    expect(result).toContain("to 'fiat'")
    const content = files.get(ADR_PATH)!
    expect(content).toContain('- **Resolution**: fiat')
    expect(content).toContain('- **Resolution Note**: Time pressure before the demo.')
  })

  it('replaces an existing Resolution (+ Note) rather than duplicating it', async () => {
    const { ctx, files } = makeContext(FIXTURE)
    await updateResolution(ctx, '1', 'fiat', 'First reason.')
    await updateResolution(ctx, '1', 'contested', 'Second reason.')
    const content = files.get(ADR_PATH)!
    expect(content.match(/- \*\*Resolution\*\*:/g)?.length).toBe(1)
    expect(content).toContain('- **Resolution**: contested')
    expect(content).toContain('- **Resolution Note**: Second reason.')
    expect(content).not.toContain('First reason.')
  })

  it('rejects an unrecognized resolution value', async () => {
    const { ctx, writeCount } = makeContext(FIXTURE)
    const result = await updateResolution(ctx, '1', 'maybe')
    expect(result).toContain('error: invalid_resolution')
    expect(writeCount()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Adversarial findings (Quarry 5, write-adversary seat). All currently
// FAILING — every mutating tool reads the whole file, computes new content in
// memory, then writes the whole file back; nothing serializes two concurrent
// calls against the same path. `base_checksum` is OPTIONAL (by design, per
// ADR-0021 — "anchored writes are safe with no prior read"), so the common,
// unguarded call shape is exactly the one exercised here. Filed to Relay per
// docs/inbox/2026-07-09-1934-quarry-to-relay-three-concurrency-catches-in-the-write-tier.md
// (routed per CONVENTIONS §3, not fixed unilaterally here).
// ---------------------------------------------------------------------------

const TWO_QUESTION_FIXTURE = `# ADR-0001: Test Decision

- **Date**: 2026-01-01
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: Jérémie Lumbroso

---

## Questions

### QST: What is the scope?
- Status: unanswered

**ANS:** (by nobody)
[Fill this in]

### QST: What is the deploy target?
- Status: unanswered

**ANS:** (by nobody)
[Fill this in]

---

## Iterations

### Iteration 1 (2026-01-01)
- Human: Started.
- AI: Drafted.
- Outcome: Draft created.

---

## Links
`

describe('Adversarial findings: concurrency races in the write tier', () => {
  it('CATCH 7 — two concurrent answer_question calls on TWO DIFFERENT questions in the same file: the second write silently discards the first answer', async () => {
    // Two ordinary sessions (or two MCP clients) answering different open
    // questions in the SAME ADR at roughly the same moment — not a contrived
    // double-write to one QST, just two callers who happen to share a file.
    // Neither supplies base_checksum (the documented common case: "anchored
    // writes are safe with no prior read").
    const { ctx, files } = makeContext(TWO_QUESTION_FIXTURE)
    const adr = parseAdr(TWO_QUESTION_FIXTURE, ADR_PATH)
    const scopeQ = adr.questions.find((q) => q.text === 'What is the scope?')!
    const deployQ = adr.questions.find((q) => q.text === 'What is the deploy target?')!

    await Promise.all([
      answerQuestion(ctx, '1', scopeQ.id, 'Postgres.', { author: 'quarry-test' }),
      answerQuestion(ctx, '1', deployQ.id, 'AWS.', { author: 'quarry-test' }),
    ])

    const content = files.get(ADR_PATH)!
    expect(content).toContain('Postgres.')
    expect(content).toContain('AWS.') // FAILS today — whichever write lands second wins the WHOLE file, discarding the other's answer
  })

  it('CATCH 8 — a genuine retry race (same client_msg_id, near-simultaneous) reapplies the write twice instead of deduping it — masked by content coincidence unless you check writeCount', async () => {
    // The documented purpose of client_msg_id is exactly this: "retries never
    // double-answer or double-append." A network retry that fires before the
    // first call's response returns — not sequential, actually concurrent —
    // is the realistic shape of "retry storm," not a second call made after
    // seeing the first one fail.
    //
    // First cut of this test asserted on the stacked-recommendation COUNT in
    // the final content and it passed — which looked like "no bug" but
    // wasn't: both calls compute the identical insert against the identical
    // *original* content (the dedup check race means neither sees the
    // other's write), so the second write silently overwrites the first with
    // content that happens to look the same. writeCount() unmasks it: two
    // writes happen despite one client_msg_id, which is the actual contract
    // violation ("returns the cached prior result rather than reapplying").
    const { ctx, writeCount } = makeContext(FIXTURE)
    const adr = parseAdr(FIXTURE, ADR_PATH)
    const q = adr.questions[0]

    await Promise.all([
      addRecommendation(ctx, '1', q.id, 'quarry-test', 'Use Postgres.', { clientMsgId: 'retry-abc' }),
      addRecommendation(ctx, '1', q.id, 'quarry-test', 'Use Postgres.', { clientMsgId: 'retry-abc' }),
    ])

    expect(writeCount()).toBe(1) // FAILS today — both calls pass the cache-miss check before either records success, so both write (writeCount is 2)
  })

  it('CATCH 9 — two concurrent append_iteration calls both read the same pre-write MAX: the second call\'s entire entry is silently lost, not just mis-numbered', async () => {
    // ADR-0021's own stated justification for moving this server-side was to
    // fix a real miscount Lapidary hit doing this by hand. Moving the
    // computation server-side doesn't serialize the read-compute-write
    // sequence against a second concurrent caller — it just moves the same
    // shaped race into the tool that was supposed to close it.
    //
    // First cut of this test asserted on duplicate iteration NUMBERS and it
    // passed — also masked: the second write overwrites the file wholesale
    // (built from the same pre-write content the first call read), so the
    // final file has exactly ONE "### Iteration 2", not two. That looks like
    // "no collision" but is actually worse: one caller's entire iteration
    // entry — human/AI/outcome text and all — vanished with no error, the
    // same silent-loss shape as CATCH 7, just for the iterations log instead
    // of an answer.
    const { ctx, files } = makeContext(FIXTURE)

    await Promise.all([
      appendIteration(ctx, '1', { outcome: 'first', date: '2026-07-08' }),
      appendIteration(ctx, '1', { outcome: 'second', date: '2026-07-08' }),
    ])

    const content = files.get(ADR_PATH)!
    expect(content).toContain('- Outcome: first')
    expect(content).toContain('- Outcome: second') // FAILS today — whichever call wrote first is silently discarded
  })

  it('CATCH 10 — a question with no ANS scaffold of its own, followed by a handle-form QST heading: answering it must never write into the next question\'s block (Riddle 5\'s escalation, Lapidary\'s 2026-07-14 adjudication)', async () => {
    // The search window used to stop at the first line matching
    // /^### QST:/ — which does NOT match the ratified handle form
    // (### QST-B:). QST-1 here has no **ANS:** header of its own (a
    // realistic case: a freshly-authored or freshly-ported question whose
    // ANS scaffold hasn't been added yet). Before the fix, scanning for
    // QST-1's answer block would fail to stop at QST-2's heading, keep
    // going, and find — and overwrite — QST-2's perfectly good ANS block
    // instead. The answer must land in QST-1's own extent or refuse;
    // it must NEVER land in QST-2.
    const TWO_QUESTIONS_HANDLE_FORM = `# ADR-0001: Test Decision

- **Date**: 2026-01-01
- **Iteration**: 1
- **Status**: Draft

---

## Questions

### QST: First question, no ANS scaffold yet?
- Status: unanswered

### QST-B: Second question, has its own complete ANS block?
- Status: unanswered

**ANS:** (by nobody)
[Fill this in]

---

## Iterations

### Iteration 1 (2026-01-01)
- Outcome: Draft created.

---

## Links
`
    const { ctx, files } = makeContext(TWO_QUESTIONS_HANDLE_FORM)
    const adr = parseAdr(TWO_QUESTIONS_HANDLE_FORM, ADR_PATH)
    const firstQuestion = adr.questions.find((q) => q.text.startsWith('First question'))!
    const secondQuestion = adr.questions.find((q) => q.text.startsWith('Second question'))!

    const result = await answerQuestion(ctx, '1', firstQuestion.id, 'Meant for QST-1 only.', { author: 'relay-test' })

    const content = files.get(ADR_PATH)!
    // Never land in QST-2's block:
    expect(content).not.toContain('**ANS:** (by relay-test)\nMeant for QST-1 only.')
    const secondBlockStart = content.indexOf(secondQuestion.text)
    expect(content.slice(secondBlockStart)).not.toContain('Meant for QST-1 only.')
    // Either it refused (structured error, no write) or it landed inside
    // QST-1's own extent — both are acceptable; silent misattribution is not.
    if (result.startsWith('error:') || result.includes('Could not find')) {
      expect(content).toBe(TWO_QUESTIONS_HANDLE_FORM) // refused — file untouched
    } else {
      const firstBlockEnd = content.indexOf(secondQuestion.text)
      expect(content.slice(0, firstBlockEnd)).toContain('Meant for QST-1 only.')
    }
  })
})
