/**
 * Per-path async serialization for the write tier — the fix for Quarry 5's
 * three concurrency catches (2026-07-09): every mutating tool does
 * check-dedup → read → compute-in-memory → write, and nothing serialized two
 * concurrent calls against the same file. Two calls racing on the same path
 * both read the same pre-write snapshot and whichever writes last silently
 * wins — not a merge, a wholesale overwrite (CATCH 7, CATCH 9). The same gap
 * let a genuine retry race defeat the dedup cache, since the check and the
 * write weren't atomic with respect to each other (CATCH 8).
 *
 * `withPathLock` queues callers by path: each caller's whole operation
 * (dedup check through write) runs only after every earlier-queued caller
 * for the *same path* has finished, so a second call always sees the first
 * call's result rather than a stale pre-write snapshot. Calls on different
 * paths are never serialized against each other. Process-lifetime only —
 * the same scope already documented for the dedup cache — a Forma-5 remote
 * server needs a real lock service for the same guarantee.
 */

const queues = new Map<string, Promise<void>>()

export async function withPathLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prior = queues.get(path) ?? Promise.resolve()
  const run = prior.then(fn, fn)
  const queued = run.then(
    () => undefined,
    () => undefined,
  )
  queues.set(path, queued)
  queued.then(() => {
    // Only clean up if no newer call re-queued behind us in the meantime —
    // avoids one call's cleanup racing ahead of a call queued after it.
    if (queues.get(path) === queued) queues.delete(path)
  })
  return run
}

/** Test-only: clear all queues between test cases. */
export function _resetPathLocksForTests(): void {
  queues.clear()
}
