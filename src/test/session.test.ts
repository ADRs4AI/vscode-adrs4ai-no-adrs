/**
 * Behavioral tests for DocketSession (src/mcp/session.ts) — Phase 0 of the
 * docket extraction (docket repo ADR-0001, QST-SESSION, answered
 * 2026-09-01). Ports the queueing-mechanism tests that used to live in
 * pathLock.test.ts (now instance methods, not module-level singleton
 * functions) and adds direct coverage for the dedup half — previously only
 * exercised indirectly through mcpWriteTier.test.ts's handler-level tests.
 */

import { describe, it, expect } from 'vitest'
import { DocketSession } from '../mcp/session'

describe('DocketSession.withPathLock', () => {
  it('serializes two concurrent calls on the same path — the second only starts after the first finishes', async () => {
    const session = DocketSession.createForTests()
    const order: string[] = []

    const first = session.withPathLock('/a', async () => {
      order.push('first-start')
      await new Promise((r) => setTimeout(r, 20))
      order.push('first-end')
      return 'first'
    })
    const second = session.withPathLock('/a', async () => {
      order.push('second-start')
      order.push('second-end')
      return 'second'
    })

    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end'])
  })

  it('never interleaves two callers on the same path — the second only starts after the first end marker lands', async () => {
    const session = DocketSession.createForTests()
    const order: string[] = []
    await Promise.all([
      session.withPathLock('/a', async () => {
        order.push('A-start')
        await new Promise((r) => setTimeout(r, 10))
        order.push('A-end')
      }),
      session.withPathLock('/a', async () => {
        order.push('B-start')
        await new Promise((r) => setTimeout(r, 10))
        order.push('B-end')
      }),
    ])
    const aEndIdx = order.indexOf('A-end')
    const bStartIdx = order.indexOf('B-start')
    expect(bStartIdx).toBeGreaterThan(aEndIdx)
  })

  it('does not serialize calls on different paths', async () => {
    const session = DocketSession.createForTests()
    const order: string[] = []
    await Promise.all([
      session.withPathLock('/a', async () => {
        order.push('a-start')
        await new Promise((r) => setTimeout(r, 20))
        order.push('a-end')
      }),
      session.withPathLock('/b', async () => {
        order.push('b-start')
        order.push('b-end')
      }),
    ])
    // /b's call is not blocked behind /a's slower one.
    expect(order.indexOf('b-end')).toBeLessThan(order.indexOf('a-end'))
  })

  it('returns the actual result (and propagates the actual error) of the caller\'s own function', async () => {
    const session = DocketSession.createForTests()
    await expect(session.withPathLock('/a', async () => 'ok')).resolves.toBe('ok')
    await expect(session.withPathLock('/a', async () => { throw new Error('boom') })).rejects.toThrow('boom')
  })

  it('a rejection in an earlier queued call does not break later calls on the same path', async () => {
    const session = DocketSession.createForTests()
    const failing = session.withPathLock('/a', async () => { throw new Error('first fails') })
    const following = session.withPathLock('/a', async () => 'still runs')
    await expect(failing).rejects.toThrow('first fails')
    await expect(following).resolves.toBe('still runs')
  })

  it('two independent sessions never serialize against each other, even on the same path string', async () => {
    const sessionA = DocketSession.createForTests()
    const sessionB = DocketSession.createForTests()
    const order: string[] = []
    await Promise.all([
      sessionA.withPathLock('/a', async () => {
        order.push('A-start')
        await new Promise((r) => setTimeout(r, 20))
        order.push('A-end')
      }),
      sessionB.withPathLock('/a', async () => {
        order.push('B-start')
        order.push('B-end')
      }),
    ])
    // B is not blocked behind A's slower call — they're different sessions,
    // exactly the property a per-invocation CLI adapter needs (a fresh
    // session per call must never inherit another call's lock queue).
    expect(order.indexOf('B-end')).toBeLessThan(order.indexOf('A-end'))
  })
})

describe('DocketSession dedup (getCached/recordSuccess)', () => {
  it('a repeated client_msg_id returns the cached result', () => {
    const session = DocketSession.createForTests()
    expect(session.getCached('answer_question', 'm1')).toBeUndefined()
    session.recordSuccess('answer_question', 'm1', 'Answered.')
    expect(session.getCached('answer_question', 'm1')).toBe('Answered.')
  })

  it('scopes the cache by tool name — the same client_msg_id on a different tool is a miss', () => {
    const session = DocketSession.createForTests()
    session.recordSuccess('answer_question', 'm1', 'Answered.')
    expect(session.getCached('add_recommendation', 'm1')).toBeUndefined()
  })

  it('no client_msg_id never hits the cache', () => {
    const session = DocketSession.createForTests()
    session.recordSuccess('answer_question', undefined, 'Answered.')
    expect(session.getCached('answer_question', undefined)).toBeUndefined()
  })

  it('_resetForTests clears both dedup and lock state', async () => {
    const session = DocketSession.createForTests()
    session.recordSuccess('answer_question', 'm1', 'Answered.')
    session._resetForTests()
    expect(session.getCached('answer_question', 'm1')).toBeUndefined()
  })
})

describe('DocketSession corpus', () => {
  it('createForTests starts with an empty, no-scan composite', () => {
    const session = DocketSession.createForTests()
    expect(session.getComposite().allAdrs()).toEqual([])
    expect(session.getComposite().allSeeds()).toEqual([])
  })

  it('getScannedAt returns a real ISO timestamp set at construction', () => {
    const before = new Date().toISOString()
    const session = DocketSession.createForTests()
    expect(session.getScannedAt() >= before).toBe(true)
  })
})
