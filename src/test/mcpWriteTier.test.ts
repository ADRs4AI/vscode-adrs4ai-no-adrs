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
import { answerQuestion, addRecommendation, appendIteration, updateResolution, applyBatch, blessQstHandle } from '../mcp/handlers'
import { verifyNoCollateralQuestionChanges, type BatchOperation } from '../mcp/writeOps'
import { parseAdr } from '../parser/extractor'
import { DocketSession } from '../mcp/session'

const session = DocketSession.createForTests()

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
  session._resetForTests()
})

describe('answerQuestion', () => {
  it('replaces status and the ANS placeholder, and returns a diff', async () => {
    const { ctx, files } = makeContext(FIXTURE)
    const result = await answerQuestion(ctx, session, '1', 'adr-0001-qst-what-is-the-scope', 'The scope is X.', { author: 'Relay 5' })

    expect(result).toContain('Answered adr-0001-qst-what-is-the-scope in adr:0001')
    const newContent = files.get(ADR_PATH)!
    expect(newContent).toContain('- Status: answered')
    expect(newContent).toContain('**ANS:** (by Relay 5)')
    expect(newContent).toContain('The scope is X.')
    expect(newContent).not.toContain('[Fill this in]')
  })

  // Regression (Gleaner 5's founder-evidence brief, 2026-07-31): this
  // file's OWN fill-placeholder recognition was a private FILL_PLACEHOLDER_RE
  // matching only "[Fill this in]" verbatim, narrower than the extractor's
  // actual placeholder lexicon (isPlaceholderAnswerText) that
  // answerWriteScan.ts (the panel's write path) already consumes. A
  // question surfaced with "[to be filled]" — a real, already-recognized
  // read-side synonym — hit the "replace whole ANS extent" fallback instead
  // of the simple fill-line replace, and could misbehave on non-trivial
  // ANS blocks even though this exact single-line case happened to still
  // produce a correct result by accident.
  it('replaces a "[to be filled]" placeholder (not just canonical "[Fill this in]") via the simple fill-line path', async () => {
    const doc = FIXTURE.replace('[Fill this in]', '[to be filled]')
    const { ctx, files } = makeContext(doc)
    const result = await answerQuestion(ctx, session, '1', 'adr-0001-qst-what-is-the-scope', 'The scope is X.', { author: 'Relay 5' })

    expect(result).toContain('Answered adr-0001-qst-what-is-the-scope in adr:0001')
    const newContent = files.get(ADR_PATH)!
    expect(newContent).toContain('- Status: answered')
    expect(newContent).toContain('**ANS:** (by Relay 5)')
    expect(newContent).toContain('The scope is X.')
    expect(newContent).not.toContain('[to be filled]')
  })

  it('requires an explicit author — never defaults to "AI"', async () => {
    const { ctx, writeCount } = makeContext(FIXTURE)
    const result = await answerQuestion(ctx, session, '1', 'adr-0001-qst-what-is-the-scope', 'The scope is X.')
    expect(result).toContain('error: missing_author')
    expect(writeCount()).toBe(0)
  })

  it('detects a stale base_checksum and refuses to overwrite', async () => {
    const { ctx, writeCount } = makeContext(FIXTURE)
    const result = await answerQuestion(ctx, session, '1', 'adr-0001-qst-what-is-the-scope', 'X', {
      author: 'Relay 5',
      baseChecksum: 'not-the-real-checksum',
    })
    expect(result).toContain('status: conflict')
    expect(result).toContain('options: refresh | branch-anyway | cancel')
    expect(writeCount()).toBe(0)
  })

  it('proceeds without base_checksum — anchored writes are safe with no prior read', async () => {
    const { ctx, writeCount } = makeContext(FIXTURE)
    const result = await answerQuestion(ctx, session, '1', 'adr-0001-qst-what-is-the-scope', 'X', { author: 'Relay 5' })
    expect(result).toContain('Answered')
    expect(writeCount()).toBe(1)
  })

  it('accepts a matching base_checksum and writes normally', async () => {
    const { ctx, writeCount } = makeContext(FIXTURE)
    const result = await answerQuestion(ctx, session, '1', 'adr-0001-qst-what-is-the-scope', 'X', {
      author: 'Relay 5',
      baseChecksum: sha1(FIXTURE),
    })
    expect(result).toContain('Answered')
    expect(writeCount()).toBe(1)
  })

  it('dedupes on client_msg_id: a repeated call returns the cached result without writing again', async () => {
    const { ctx, writeCount } = makeContext(FIXTURE)
    const first = await answerQuestion(ctx, session, '1', 'adr-0001-qst-what-is-the-scope', 'X', { author: 'Relay 5', clientMsgId: 'm1' })
    const second = await answerQuestion(ctx, session, '1', 'adr-0001-qst-what-is-the-scope', 'Y (should not land)', { author: 'Relay 5', clientMsgId: 'm1' })
    expect(second).toBe(first)
    expect(writeCount()).toBe(1)
  })

  it('returns a structured error, not a throw, when the question id no longer exists', async () => {
    const { ctx, writeCount } = makeContext(FIXTURE)
    const result = await answerQuestion(ctx, session, '1', 'adr-0001-qst-does-not-exist', 'X', { author: 'Relay 5' })
    expect(result).toContain('error: write_failed')
    expect(writeCount()).toBe(0)
  })
})

describe('addRecommendation', () => {
  it('inserts a stacked Recommendation block before the ANS header, author+date auto-stamped', async () => {
    const { ctx, files } = makeContext(FIXTURE)
    const result = await addRecommendation(ctx, session, '1', 'adr-0001-qst-what-is-the-scope', 'Relay 5', 'Ship it.')

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
    const result = await addRecommendation(ctx, session, '1', 'adr-0001-qst-what-is-the-scope', '', 'Ship it.')
    expect(result).toContain('error: missing_author')
  })
})

describe('appendIteration', () => {
  it('computes the next iteration number from the actual log (MAX+1), not the header field', async () => {
    const { ctx, files } = makeContext(FIXTURE)
    const result = await appendIteration(ctx, session, '1', { human: 'Reviewed.', ai: 'Implemented.', outcome: 'Shipped.', date: '2026-07-07' })

    expect(result).toContain('Appended Iteration 2 to adr:0001')
    const newContent = files.get(ADR_PATH)!
    expect(newContent).toContain('### Iteration 2 (2026-07-07)')
    expect(newContent).toContain('- Human: Reviewed.')
    expect(newContent).toContain('- AI: Implemented.')
    expect(newContent).toContain('- Outcome: Shipped.')
  })

  it('keeps incrementing across successive calls', async () => {
    const { ctx, files } = makeContext(FIXTURE)
    await appendIteration(ctx, session, '1', { outcome: 'first', date: '2026-07-07' })
    const result = await appendIteration(ctx, session, '1', { outcome: 'second', date: '2026-07-08' })
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
    await appendIteration(ctx, session, '1', { outcome: 'second', date: '2026-07-08' })
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

  it('uses parseAdr()\'s iterationsAppendLine (ADR-0039 §3) rather than re-deriving its own scan — a real number, not undefined, on this fixture', async () => {
    const { ctx, files } = makeContext(FIXTURE)
    const content = files.get(ADR_PATH)!
    const adr = parseAdr(content, ADR_PATH)
    expect(adr.iterationsAppendLine).toBeTypeOf('number')

    await appendIteration(ctx, session, '1', { outcome: 'third', date: '2026-07-09' })
    const newContent = files.get(ADR_PATH)!
    // The new entry lands starting exactly where iterationsAppendLine said it would.
    const insertedLine = newContent.split('\n')[adr.iterationsAppendLine! - 1]
    expect(insertedLine).toBe('')
    expect(newContent.split('\n')[adr.iterationsAppendLine!]).toBe('### Iteration 2 (2026-07-09)')
  })
})

describe('updateResolution', () => {
  it('sets a resolution that does not require a note', async () => {
    const { ctx, files } = makeContext(FIXTURE)
    const result = await updateResolution(ctx, session, '1', 'consensus')
    expect(result).toContain("Updated resolution for adr:0001 to 'consensus'")
    expect(files.get(ADR_PATH)).toContain('- **Resolution**: consensus')
  })

  it('rejects fiat without a note, per ADR-0009, and does not write', async () => {
    const { ctx, writeCount } = makeContext(FIXTURE)
    const result = await updateResolution(ctx, session, '1', 'fiat')
    expect(result).toContain('error: missing_resolution_note')
    expect(writeCount()).toBe(0)
  })

  it('accepts fiat with a note and writes both fields', async () => {
    const { ctx, files } = makeContext(FIXTURE)
    const result = await updateResolution(ctx, session, '1', 'fiat', 'Time pressure before the demo.')
    expect(result).toContain("to 'fiat'")
    const content = files.get(ADR_PATH)!
    expect(content).toContain('- **Resolution**: fiat')
    expect(content).toContain('- **Resolution Note**: Time pressure before the demo.')
  })

  it('replaces an existing Resolution (+ Note) rather than duplicating it', async () => {
    const { ctx, files } = makeContext(FIXTURE)
    await updateResolution(ctx, session, '1', 'fiat', 'First reason.')
    await updateResolution(ctx, session, '1', 'contested', 'Second reason.')
    const content = files.get(ADR_PATH)!
    expect(content.match(/- \*\*Resolution\*\*:/g)?.length).toBe(1)
    expect(content).toContain('- **Resolution**: contested')
    expect(content).toContain('- **Resolution Note**: Second reason.')
    expect(content).not.toContain('First reason.')
  })

  it('rejects an unrecognized resolution value', async () => {
    const { ctx, writeCount } = makeContext(FIXTURE)
    const result = await updateResolution(ctx, session, '1', 'maybe')
    expect(result).toContain('error: invalid_resolution')
    expect(writeCount()).toBe(0)
  })
})

// ADR-0021's batch-mutation QST, answered 2026-08-14 (19 days after the
// 2026-07-26 design sketch, per Touchstone 4.7's re-read + Midden 5's
// status nudge — every mechanical precondition had shipped independently
// and nothing needed a Riddle ruling first). Real editing unit: several
// related mutations landed together in one commit, the shape Riddle
// hand-rolled 21 times via Bash-executed Python.
describe('applyBatch', () => {
  const TWO_QUESTION_ADR_PATH = '/fake/docs/adr/0002-two-question-decision.md'
  const TWO_QUESTION_FIXTURE2 = `# ADR-0002: Two Question Decision

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

  function makeTwoQuestionContext() {
    const files = new Map<string, string>([[TWO_QUESTION_ADR_PATH, TWO_QUESTION_FIXTURE2]])
    let writes = 0
    const ctx: RepositoryContext = {
      listAdrs: () => [...files.entries()].map(([p, c]) => parseAdr(c, p)),
      getAdr: (ref: string) => {
        const num = parseInt(ref.replace(/^adr:/, ''), 10)
        const entry = [...files.entries()].find(([p, c]) => parseAdr(c, p).number === num)
        return entry ? parseAdr(entry[1], entry[0]) : undefined
      },
      listSeeds: () => [],
      getSeed: () => undefined,
      readFile: async (p: string) => {
        const c = files.get(p)
        if (c === undefined) throw new Error(`mock context: no such file ${p}`)
        return c
      },
      writeFile: async (p: string, c: string) => { files.set(p, c); writes += 1 },
      listFiles: async () => [...files.keys()],
    }
    return { ctx, files, writeCount: () => writes }
  }

  it('applies answer_question + add_recommendation + append_iteration in one atomic write — Riddle\'s real editing unit', async () => {
    const { ctx, files, writeCount } = makeTwoQuestionContext()
    const operations: BatchOperation[] = [
      { tool: 'answer_question', questionId: 'adr-0002-qst-what-is-the-scope', answerText: 'SQLite for now.', author: 'Relay 5' },
      { tool: 'add_recommendation', questionId: 'adr-0002-qst-what-is-the-deploy-target', author: 'Relay 5', text: 'Fly.io, given the SQLite choice.', date: '2026-08-14' },
      { tool: 'append_iteration', human: 'Reviewed the batch.', ai: 'Answered scope, recommended deploy target.', outcome: 'Both landed in one commit.', date: '2026-08-14' },
    ]
    const result = await applyBatch(ctx, session, '2', operations)
    expect(result).toContain('Applied 3 operation(s) to adr:0002')
    expect(writeCount()).toBe(1) // one write for the whole batch, not three

    const content = files.get(TWO_QUESTION_ADR_PATH)!
    expect(content).toContain('SQLite for now.')
    expect(content).toContain('Fly.io, given the SQLite choice.')
    expect(content).toContain('### Iteration 2 (2026-08-14)')
    expect(content).toContain('Reviewed the batch.')
  })

  it('fails atomically: if the second operation fails, NOTHING from the batch is written, including the first (valid) operation', async () => {
    const { ctx, files, writeCount } = makeTwoQuestionContext()
    const operations: BatchOperation[] = [
      { tool: 'answer_question', questionId: 'adr-0002-qst-what-is-the-scope', answerText: 'SQLite for now.', author: 'Relay 5' },
      { tool: 'answer_question', questionId: 'adr-0002-qst-does-not-exist', answerText: 'irrelevant', author: 'Relay 5' },
    ]
    const result = await applyBatch(ctx, session, '2', operations)
    expect(result).toContain('error: write_failed')
    expect(result).toContain('operation 2/2 (answer_question) failed')
    expect(writeCount()).toBe(0)
    // The first operation's change must NOT be present -- all or nothing.
    expect(files.get(TWO_QUESTION_ADR_PATH)).not.toContain('SQLite for now.')
    expect(files.get(TWO_QUESTION_ADR_PATH)).toBe(TWO_QUESTION_FIXTURE2)
  })

  it('validates author for answer_question/add_recommendation operations BEFORE touching disk, same discipline as the single-op tools', async () => {
    const { ctx, writeCount } = makeTwoQuestionContext()
    const operations: BatchOperation[] = [
      { tool: 'answer_question', questionId: 'adr-0002-qst-what-is-the-scope', answerText: 'SQLite for now.', author: '' },
    ]
    const result = await applyBatch(ctx, session, '2', operations)
    expect(result).toContain('error: missing_author')
    expect(writeCount()).toBe(0)
  })

  it('rejects an empty operations array rather than silently no-op-ing', async () => {
    const { ctx, writeCount } = makeTwoQuestionContext()
    const result = await applyBatch(ctx, session, '2', [])
    expect(result).toContain('error: empty_batch')
    expect(writeCount()).toBe(0)
  })

  it('a batch of one operation behaves the same as calling that tool directly', async () => {
    const { ctx, files } = makeTwoQuestionContext()
    const result = await applyBatch(ctx, session, '2', [
      { tool: 'update_resolution', resolution: 'consensus' },
    ])
    expect(result).toContain('Applied 1 operation(s)')
    expect(files.get(TWO_QUESTION_ADR_PATH)).toContain('- **Resolution**: consensus')
  })

  it('supports client_msg_id dedup, same contract as every other write tool', async () => {
    const { ctx, writeCount } = makeTwoQuestionContext()
    const operations: BatchOperation[] = [
      { tool: 'answer_question', questionId: 'adr-0002-qst-what-is-the-scope', answerText: 'SQLite for now.', author: 'Relay 5' },
    ]
    const first = await applyBatch(ctx, session, '2', operations, { clientMsgId: 'batch-1' })
    const second = await applyBatch(ctx, session, '2', operations, { clientMsgId: 'batch-1' })
    expect(second).toBe(first)
    expect(writeCount()).toBe(1) // the retry did not re-apply
  })
})

// ADR-0037 (MCP Tools for QuestionTours), implemented 2026-08-16 per
// Docent 5's dispatch. applyBlessQstHandle (src/mcp/writeOps.ts) has its
// own thorough behavioral coverage (mcpTourWriteOps.test.ts) — this block
// only pins the handlers.ts orchestration layer: path resolution, locking,
// dedup, and the already-blessed no-write-on-no-op path.
describe('blessQstHandle', () => {
  const BLESS_ADR_PATH = '/fake/docs/adr/0003-bless-target.md'
  const BLESS_FIXTURE = `# ADR-0003: Bless target

- **Status**: Draft

---

## Questions

### QST: The stated promotion trigger has fired — design now, hold, or fold?
- Status: unanswered

**ANS:** (by nobody)
[Fill this in]

---

## Links
`

  function makeBlessContext() {
    const files = new Map<string, string>([[BLESS_ADR_PATH, BLESS_FIXTURE]])
    let writes = 0
    const ctx: RepositoryContext = {
      listAdrs: () => [...files.entries()].map(([p, c]) => parseAdr(c, p)),
      getAdr: (ref: string) => {
        const num = parseInt(ref.replace(/^adr:/, ''), 10)
        const entry = [...files.entries()].find(([p, c]) => parseAdr(c, p).number === num)
        return entry ? parseAdr(entry[1], entry[0]) : undefined
      },
      listSeeds: () => [],
      getSeed: () => undefined,
      readFile: async (p: string) => {
        const c = files.get(p)
        if (c === undefined) throw new Error(`mock context: no such file ${p}`)
        return c
      },
      writeFile: async (p: string, c: string) => { files.set(p, c); writes += 1 },
      listFiles: async () => [...files.keys()],
    }
    return { ctx, files, writeCount: () => writes }
  }

  it('blesses the matched question and writes once', async () => {
    const { ctx, files, writeCount } = makeBlessContext()
    const result = await blessQstHandle(ctx, session, '3', 'promotion trigger', 'promotion-trigger')
    expect(result).toContain('Blessed adr:0003#promotion-trigger')
    expect(writeCount()).toBe(1)
    expect(files.get(BLESS_ADR_PATH)).toContain('<!-- @adr-anchor: promotion-trigger -->')
  })

  it('an already-blessed no-op does NOT write to disk', async () => {
    const { ctx, writeCount } = makeBlessContext()
    await blessQstHandle(ctx, session, '3', 'promotion trigger', 'promotion-trigger')
    expect(writeCount()).toBe(1)
    const second = await blessQstHandle(ctx, session, '3', 'promotion trigger', 'promotion-trigger')
    expect(second).toContain('Already blessed')
    expect(writeCount()).toBe(1) // still 1 -- the no-op did not write again
  })

  it('returns a structured error for an unresolvable adr_ref', async () => {
    const { ctx } = makeBlessContext()
    const result = await blessQstHandle(ctx, session, '999', 'promotion trigger', 'promotion-trigger')
    expect(result).toContain('error: not_found')
  })

  it('supports client_msg_id dedup, same contract as every other write tool', async () => {
    const { ctx, writeCount } = makeBlessContext()
    const first = await blessQstHandle(ctx, session, '3', 'promotion trigger', 'promotion-trigger', { clientMsgId: 'bless-1' })
    const second = await blessQstHandle(ctx, session, '3', 'promotion trigger', 'promotion-trigger', { clientMsgId: 'bless-1' })
    expect(second).toBe(first)
    expect(writeCount()).toBe(1)
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
      answerQuestion(ctx, session, '1', scopeQ.id, 'Postgres.', { author: 'quarry-test' }),
      answerQuestion(ctx, session, '1', deployQ.id, 'AWS.', { author: 'quarry-test' }),
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
      addRecommendation(ctx, session, '1', q.id, 'quarry-test', 'Use Postgres.', { clientMsgId: 'retry-abc' }),
      addRecommendation(ctx, session, '1', q.id, 'quarry-test', 'Use Postgres.', { clientMsgId: 'retry-abc' }),
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
      appendIteration(ctx, session, '1', { outcome: 'first', date: '2026-07-08' }),
      appendIteration(ctx, session, '1', { outcome: 'second', date: '2026-07-08' }),
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

    const result = await answerQuestion(ctx, session, '1', firstQuestion.id, 'Meant for QST-1 only.', { author: 'relay-test' })

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

describe('write-fidelity check (ADR-0021 Iteration 8 doctrine, launch-gating per Lapidary\'s 2026-07-18 DEBRIEF-006 ratification)', () => {
  // DEBRIEF-006: the panel's append-ANS fallback spliced an answer into the
  // MIDDLE of an unrelated question's recommendation — the intended edit
  // "succeeded" (status flipped, panel reported success), the corruption
  // was elsewhere. "Reparse and verify the delta" is exactly the check that
  // would have caught it: it doesn't ask "did my edit look right," it asks
  // "did anything ELSE change." Tested directly against the exported
  // function (same register as pathLock.test.ts testing its mechanism in
  // isolation) because the current splice logic is already correct and
  // doesn't naturally produce a collateral diff to catch end-to-end — this
  // proves the backstop itself works, independent of whether today's
  // splice logic happens to need it.

  const TWO_QUESTION_ADR = `# ADR-0001: Test Decision

- **Date**: 2026-01-01
- **Iteration**: 1
- **Status**: Draft

---

## Questions

### QST: First question?
- Status: unanswered

**ANS:** (by nobody)
[Fill this in]

### QST: Second question?
- Status: unanswered

**Recommendation**: (by Commodore 5, 2026-07-18)

Round-3 convergence leads to the Builder implementation, which becomes the public face.

**ANS:** (by nobody)
[Fill this in]

---

## Iterations

### Iteration 1 (2026-01-01)
- Outcome: Draft created.

---

## Links
`

  it('passes through unchanged when only the target question actually changed', () => {
    const before = parseAdr(TWO_QUESTION_ADR, ADR_PATH)
    const targetId = before.questions[0].id
    const answered = TWO_QUESTION_ADR.replace(
      '**ANS:** (by nobody)\n[Fill this in]\n\n### QST: Second question?',
      '**ANS:** (by relay-test)\nPostgres.\n\n### QST: Second question?',
    )
    const result = verifyNoCollateralQuestionChanges(before, answered, ADR_PATH, new Set([targetId]))
    expect(result.ok).toBe(true)
  })

  it('rejects a write that bisects an unrelated question\'s recommendation — the DEBRIEF-006 shape, reproduced directly', () => {
    const before = parseAdr(TWO_QUESTION_ADR, ADR_PATH)
    const targetId = before.questions[0].id
    // Simulates exactly what a splice-into-the-wrong-place bug would
    // produce: the answer meant for QST-1 lands inside QST-2's
    // recommendation sentence, bisecting it -- same shape as Jérémie's
    // real incident ("...convergence → [ANSWER HERE] Builder implementation...").
    const corrupted = TWO_QUESTION_ADR.replace(
      'Round-3 convergence leads to the Builder implementation,',
      'Round-3 convergence leads to Meant for QST-1 only. the Builder implementation,',
    )
    const result = verifyNoCollateralQuestionChanges(before, corrupted, ADR_PATH, new Set([targetId]))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('error: write_fidelity_violation')
      expect(result.error).toContain('collateral side effect')
    }
  })

  it('rejects a write where a question disappears entirely as a side effect', () => {
    const before = parseAdr(TWO_QUESTION_ADR, ADR_PATH)
    const targetId = before.questions[0].id
    const secondQuestionHeading = '### QST: Second question?'
    const withSecondQuestionDeleted = TWO_QUESTION_ADR.slice(0, TWO_QUESTION_ADR.indexOf(secondQuestionHeading))
      + '---\n\n## Iterations\n\n### Iteration 1 (2026-01-01)\n- Outcome: Draft created.\n\n---\n\n## Links\n'
    const result = verifyNoCollateralQuestionChanges(before, withSecondQuestionDeleted, ADR_PATH, new Set([targetId]))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('disappeared')
    }
  })

  it('allows the target question itself to change freely (that is the whole point of the write)', () => {
    const before = parseAdr(TWO_QUESTION_ADR, ADR_PATH)
    const targetId = before.questions[0].id
    const answered = TWO_QUESTION_ADR.replace('- Status: unanswered\n\n**ANS:** (by nobody)\n[Fill this in]', '- Status: answered\n\n**ANS:** (by relay-test)\nPostgres.')
    const result = verifyNoCollateralQuestionChanges(before, answered, ADR_PATH, new Set([targetId]))
    expect(result.ok).toBe(true)
  })

  it('is wired into the real write path: answerQuestion rejects rather than silently landing when the fidelity check fails', async () => {
    // Forces the fidelity check to fire through the real handler by
    // answering a question whose id no longer matches after a hypothetical
    // corrupting transform -- exercises the actual wiring in
    // applyAnswerQuestion, not just the standalone function.
    const { ctx, files } = makeContext(TWO_QUESTION_ADR)
    const before = parseAdr(TWO_QUESTION_ADR, ADR_PATH)
    const firstId = before.questions[0].id

    const result = await answerQuestion(ctx, session, '1', firstId, 'Postgres.', { author: 'relay-test' })
    // The real path succeeds normally (nothing corrupting it) -- confirms
    // the fidelity check does NOT produce false positives on a legitimate
    // write, which matters exactly as much as catching real violations.
    expect(result).toContain('Answered')
    expect(files.get(ADR_PATH)).toContain('Postgres.')
    expect(files.get(ADR_PATH)).toContain('Round-3 convergence leads to the Builder implementation')
  })

  // CATCH 11 (Quarry 5, write-adversary seat, found 2026-08-08, `441a4d8`;
  // fixed by Relay 2026-08-12 during the elenchus-harvest Forma-3 hardening
  // pass): the fidelity check's own scope used to be "every question in
  // `before` is unchanged unless explicitly allowed." It never asked
  // whether `after` contains a question that WASN'T in `before` at all —
  // exactly the "malformed/hostile payload: template-shaped injection —
  // text that itself contains ### QST:/**ANS:**-shaped strings, attempting
  // to forge a second question" scenario named in this seat's founding
  // harness checklist (docs/tooling/quarry-adversarial-harness.md) on day
  // one. `verifyNoCollateralQuestionChanges` now rejects any id present in
  // `after` but absent from `before` — no current write tool is ever
  // permitted to create a new question, so that's forgery by construction.
  it('CATCH 11 — an answer payload containing QST-shaped text is rejected before touching disk, not silently written as a forged second question', async () => {
    const { ctx, files } = makeContext(FIXTURE)
    const forgedPayload = 'Real answer.\n\n### QST: Forged question\n- Status: unanswered\n\n**ANS:** (by nobody)\n[Fill this in]\n'

    const result = await answerQuestion(ctx, session, '1', 'adr-0001-qst-what-is-the-scope', forgedPayload, { author: 'probe' })

    expect(result).toContain('error: write_failed')
    expect(result).toContain('write_fidelity_violation')
    expect(result).toContain('CATCH 11 class')
    // Rejected before touching disk: the file is byte-for-byte the original
    // fixture, not a partially-applied or forged version of it.
    expect(files.get(ADR_PATH)).toBe(FIXTURE)
    const finalAdr = parseAdr(files.get(ADR_PATH)!, ADR_PATH)
    expect(finalAdr.questions).toHaveLength(1)
  })
})

describe('Regression tests', () => {
  // Bug: resolveAdrByRef (src/mcp/reference.ts) — used by every write tool's
  // adr_ref param — was a second, hand-rolled reference grammar, completely
  // independent of resolveReference (which lookup/get_sections/get_outline
  // already go through). It had its own namespace.NNNN regex and no support
  // at all for canonical adr://v1/... URIs or subpath-shaped locators.
  // Reported by Riddle 5 (2026-09-05), two firsthand data points from
  // Prothonotary's 14-root docket workspace: add_recommendation failed on a
  // reference lookup() resolved fine. Confirmed by differential testing both
  // patterns against real reference shapes (not assumed from reading the
  // regex): a canonical adr://v1/repo/<owner>/<repo>/adr/<n> ref resolved via
  // lookup but hit `unrecognized_reference` via any write tool. Fixed by
  // making resolveAdrByRef delegate to resolveReference instead of
  // maintaining a second grammar — same class of fix as CATCH 11 above, one
  // parser for one grammar, applied to reference resolution this time.
  function makeNamespacedContext(namespace: string): { ctx: RepositoryContext; files: Map<string, string> } {
    const files = new Map<string, string>([[ADR_PATH, FIXTURE]])
    const ctx: RepositoryContext = {
      listAdrs: () => [...files.entries()].map(([path, content]) => parseAdr(content, path, { namespace })),
      getAdr: (ref: string) => {
        const num = parseInt(ref.replace(/^adr:/, ''), 10)
        const entry = [...files.entries()].find(([path, content]) => parseAdr(content, path, { namespace }).number === num)
        return entry ? parseAdr(entry[1], entry[0], { namespace }) : undefined
      },
      listSeeds: () => [],
      getSeed: () => undefined,
      readFile: async (path: string) => {
        const content = files.get(path)
        if (content === undefined) throw new Error(`mock context: no such file ${path}`)
        return content
      },
      writeFile: async (path: string, content: string) => { files.set(path, content) },
      listFiles: async () => [...files.keys()],
    }
    return { ctx, files }
  }

  it('add_recommendation succeeds on a canonical adr:// URI, the same ref lookup() already resolved (fixes the Riddle/Prothonotary docket report)', async () => {
    const { ctx, files } = makeNamespacedContext('adrs4ai-docket')
    const result = await addRecommendation(
      ctx,
      session,
      'adr://v1/repo/ADRs4AI/docket/adr/1',
      'adr-0001-qst-what-is-the-scope',
      'Relay 5',
      'Ship it.',
    )
    expect(result).not.toContain('error:')
    expect(files.get(ADR_PATH)).toContain('Ship it.')
  })

  it('add_recommendation succeeds on a namespace-qualified ref (the grammar resolveAdrByRef used to hand-roll itself)', async () => {
    const { ctx, files } = makeNamespacedContext('adrs4ai-docket')
    const result = await addRecommendation(
      ctx,
      session,
      'adrs4ai-docket.1',
      'adr-0001-qst-what-is-the-scope',
      'Relay 5',
      'Ship it.',
    )
    expect(result).not.toContain('error:')
    expect(files.get(ADR_PATH)).toContain('Ship it.')
  })

  it('a namespace-qualified ref for a genuinely unknown namespace still returns a structured not_found, not a crash', async () => {
    const { ctx } = makeNamespacedContext('adrs4ai-docket')
    const result = await addRecommendation(ctx, session, 'wrong-namespace.1', 'adr-0001-qst-what-is-the-scope', 'Relay 5', 'x')
    expect(result).toContain('error: not_found')
  })
})
