/**
 * Unit tests for the per-path lock (Quarry 5's concurrency-catch fix,
 * 2026-07-09) in isolation from the write tier — the property being tested
 * is the queueing mechanism itself, not any particular tool's behavior.
 */

import { describe, it, expect } from 'vitest'
import { withPathLock, _resetPathLocksForTests } from '../mcp/pathLock'

describe('withPathLock', () => {
  it('serializes two concurrent calls on the same path — the second only starts after the first finishes', async () => {
    _resetPathLocksForTests()
    const order: string[] = []

    const first = withPathLock('/a', async () => {
      order.push('first-start')
      await new Promise((r) => setTimeout(r, 20))
      order.push('first-end')
      return 'first'
    })
    const second = withPathLock('/a', async () => {
      order.push('second-start')
      order.push('second-end')
      return 'second'
    })

    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second-start', 'second-end'])
  })

  it('never interleaves two callers on the same path — the second only starts after the first end marker lands', async () => {
    _resetPathLocksForTests()
    const order: string[] = []
    await Promise.all([
      withPathLock('/a', async () => {
        order.push('A-start')
        await new Promise((r) => setTimeout(r, 10))
        order.push('A-end')
      }),
      withPathLock('/a', async () => {
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
    _resetPathLocksForTests()
    const order: string[] = []
    await Promise.all([
      withPathLock('/a', async () => {
        order.push('a-start')
        await new Promise((r) => setTimeout(r, 20))
        order.push('a-end')
      }),
      withPathLock('/b', async () => {
        order.push('b-start')
        order.push('b-end')
      }),
    ])
    // /b's call is not blocked behind /a's slower one.
    expect(order.indexOf('b-end')).toBeLessThan(order.indexOf('a-end'))
  })

  it('returns the actual result (and propagates the actual error) of the caller\'s own function', async () => {
    _resetPathLocksForTests()
    await expect(withPathLock('/a', async () => 'ok')).resolves.toBe('ok')
    await expect(withPathLock('/a', async () => { throw new Error('boom') })).rejects.toThrow('boom')
  })

  it('a rejection in an earlier queued call does not break later calls on the same path', async () => {
    _resetPathLocksForTests()
    const failing = withPathLock('/a', async () => { throw new Error('first fails') })
    const following = withPathLock('/a', async () => 'still runs')
    await expect(failing).rejects.toThrow('first fails')
    await expect(following).resolves.toBe('still runs')
  })
})
