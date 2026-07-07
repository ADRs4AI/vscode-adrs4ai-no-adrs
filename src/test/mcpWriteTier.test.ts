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
