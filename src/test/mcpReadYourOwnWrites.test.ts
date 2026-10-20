/**
 * Regression test for the read-your-own-writes bug (Shipwright 5's
 * dogfooding finding, docket errors.jsonl, 2026-10-20 13:07 UTC — found in
 * docket's twin implementation, confirmed identical here): every write
 * handler wrote to disk and recorded dedupe success, but never refreshed
 * `DocketSession`'s cached `CompositeIndex` — so `list_open_questions`
 * (and every other read) kept serving the PRE-write composite until a
 * manual `refresh_corpus`, inside the very same session that just wrote.
 *
 * Unlike mcpWriteTier.test.ts's in-memory-map RepositoryContext (which
 * re-parses fresh on every call by construction, and so can never exhibit
 * this bug), this test uses a REAL temp directory on disk and a REAL
 * `DocketSession.create()` scan — the only way to reproduce the actual
 * failure, which lives entirely in the session's cached composite, not in
 * any one RepositoryContext implementation.
 *
 * One handler (`answer_question`) is exercised end to end, matching
 * Shipwright's own dogfood shape ("before=1-open, write, after=0-open").
 * The fix is the identical one-line `await session.refreshCorpus()` call,
 * in the identical position, in all six write handlers (verified by
 * inspection) — repeating this same proof five more times would not add
 * signal.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { answerQuestion, listOpenQuestions } from '../mcp/handlers'
import { DocketSession } from '../mcp/session'
import { createRepositoryContextAdapter } from '../index/repositoryContextAdapter'

describe('read-your-own-writes: list_open_questions sees a write from earlier in the SAME session', () => {
  let workspaceRoot: string
  let session: DocketSession

  beforeAll(async () => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-read-your-own-writes-'))
    fs.mkdirSync(path.join(workspaceRoot, 'docs', 'adr'), { recursive: true })
    fs.writeFileSync(
      path.join(workspaceRoot, 'docs', 'adr', '0001-test-decision.md'),
      [
        '# ADR-0001: Test Decision',
        '',
        '- **Date**: 2026-01-01',
        '- **Iteration**: 1',
        '- **Status**: Draft',
        '- **Deciders**: Jérémie Lumbroso',
        '',
        '---',
        '',
        '## Questions',
        '',
        '### QST: What is the scope?',
        '- Status: unanswered',
        '- Why asking: Because it matters.',
        '',
        '**ANS:** (by nobody)',
        '[Fill this in]',
        '',
        '---',
      ].join('\n'),
      'utf8',
    )
    session = await DocketSession.create({ workspaceRoot })
  })

  afterAll(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('before the write: the question is open', () => {
    const ctx = createRepositoryContextAdapter(session.getComposite())
    expect(listOpenQuestions(ctx)).toMatch(/^1 open across 1 ADRs/)
  })

  it('after answer_question, in the SAME session, list_open_questions no longer sees it as open', async () => {
    const ctxBefore = createRepositoryContextAdapter(session.getComposite())
    const result = await answerQuestion(ctxBefore, session, '1', 'adr-0001-qst-what-is-the-scope', 'The scope is X.', { author: 'Test Human' })
    expect(result).toMatch(/^Answered /)

    // The fix: session.getComposite() must now return a FRESHLY rescanned
    // index, not the one captured by ctxBefore above. A new adapter built
    // from session.getComposite() is exactly what stdioServer.ts does on
    // every tool call (`ctx = () => createRepositoryContextAdapter(session.getComposite())`).
    const ctxAfter = createRepositoryContextAdapter(session.getComposite())
    expect(listOpenQuestions(ctxAfter)).toMatch(/^0 open across 0 ADRs/)
  })
})
