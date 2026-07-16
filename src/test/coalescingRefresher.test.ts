/**
 * Regression tests for the Decision 5 refresh state machine: "two rapid
 * .settings/roots.json saves cannot leak an intermediate state." The real
 * failure this guards against: request A starts a rebuild; request B
 * arrives mid-rebuild (a second save landing before the first finishes);
 * without coalescing, B would start its OWN overlapping rebuild, and
 * whichever finishes last "wins" nondeterministically — including the
 * possibility that A's (now-stale) result lands after B's, silently
 * reverting the root set to a target that's no longer current.
 */

import { describe, it, expect, vi } from 'vitest'
import { CoalescingRefresher } from '../watchers/coalescingRefresher'

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

describe('CoalescingRefresher', () => {
  it('a single request runs the work exactly once', async () => {
    const work = vi.fn(async () => {})
    const refresher = new CoalescingRefresher(work)
    await refresher.request()
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('a request arriving WHILE one is running does not start a second overlapping run', async () => {
    const gate = deferred<void>()
    const work = vi.fn(async () => { await gate.promise })
    const refresher = new CoalescingRefresher(work)

    const first = refresher.request()
    expect(refresher.isRunning).toBe(true)

    // Second request arrives mid-run -- must be coalesced, not run concurrently.
    const second = refresher.request()
    expect(work).toHaveBeenCalledTimes(1) // still just the one in-flight call

    gate.resolve()
    await first
    await second

    // Coalesced into exactly one MORE run after the first finished -- two
    // requests, two total invocations, never overlapping.
    expect(work).toHaveBeenCalledTimes(2)
  })

  it('three rapid requests during one run coalesce into exactly two total invocations, not three', async () => {
    const gate = deferred<void>()
    let callCount = 0
    const work = vi.fn(async () => {
      callCount++
      if (callCount === 1) await gate.promise // first call blocks; later calls resolve immediately
    })
    const refresher = new CoalescingRefresher(work)

    const p1 = refresher.request()
    const p2 = refresher.request() // coalesced
    const p3 = refresher.request() // also coalesced -- same pending slot as p2

    gate.resolve()
    await Promise.all([p1, p2, p3])

    expect(work).toHaveBeenCalledTimes(2)
  })

  it('sequential requests (no overlap) each run independently', async () => {
    const work = vi.fn(async () => {})
    const refresher = new CoalescingRefresher(work)
    await refresher.request()
    await refresher.request()
    await refresher.request()
    expect(work).toHaveBeenCalledTimes(3)
  })

  it('isRunning reflects true only while work is in flight', async () => {
    const gate = deferred<void>()
    const refresher = new CoalescingRefresher(async () => { await gate.promise })
    expect(refresher.isRunning).toBe(false)
    const p = refresher.request()
    expect(refresher.isRunning).toBe(true)
    gate.resolve()
    await p
    expect(refresher.isRunning).toBe(false)
  })
})
