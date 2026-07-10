/**
 * WatcherMetrics tests — ADR-0025 Decision 3 (required v1 audit surface)
 *
 * Injectable clock throughout — no real timers/sleeps, matching this
 * project's convention against contrived flakiness. Covers event counting,
 * sliding-window pruning, debounce averaging, and the exceptional-event
 * (glob-storm) detector that's the actual point of Decision 3: telling a
 * pathological watcher apart from ordinary usage.
 */

import { describe, it, expect } from 'vitest'
import { WatcherMetrics } from '../index/watcherMetrics'

function fakeClock(startMs = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = startMs
  return { now: () => current, advance: (ms: number) => { current += ms } }
}

describe('WatcherMetrics', () => {
  it('counts events by kind and in total', () => {
    const clock = fakeClock()
    const metrics = new WatcherMetrics('acme/project', { now: clock.now })
    metrics.recordEvent('created')
    metrics.recordEvent('changed')
    metrics.recordEvent('changed')
    metrics.recordEvent('deleted')

    const snapshot = metrics.snapshot()
    expect(snapshot.totalEvents).toBe(4)
    expect(snapshot.eventsByKind).toEqual({ created: 1, changed: 2, deleted: 1 })
  })

  it('prunes events outside the sliding window from the rate estimate but not from the running total', () => {
    const clock = fakeClock()
    const metrics = new WatcherMetrics('acme/project', { now: clock.now, windowMs: 1000 })
    metrics.recordEvent('changed')
    clock.advance(2000) // past the 1000ms window
    metrics.recordEvent('changed')

    const snapshot = metrics.snapshot()
    expect(snapshot.totalEvents).toBe(2) // total is cumulative, never pruned
    expect(snapshot.estimatedEventsPerMinute).toBeCloseTo(60, 0) // only the 1 in-window event, extrapolated to /min
  })

  it('computes the running average debounce latency', () => {
    const metrics = new WatcherMetrics('acme/project')
    metrics.recordDebounce(100)
    metrics.recordDebounce(200)
    metrics.recordDebounce(300)
    expect(metrics.snapshot().averageDebounceMs).toBe(200)
  })

  it('reports no average debounce latency before any debounced handler has run', () => {
    const metrics = new WatcherMetrics('acme/project')
    expect(metrics.snapshot().averageDebounceMs).toBeUndefined()
  })

  it('flags an exceptional event once the in-window event count crosses the spike threshold', () => {
    const clock = fakeClock()
    const metrics = new WatcherMetrics('acme/project', { now: clock.now, spikeThreshold: 5 })
    for (let i = 0; i < 4; i++) metrics.recordEvent('changed')
    expect(metrics.drainExceptionalEvents()).toHaveLength(0)

    metrics.recordEvent('changed') // 5th event in-window crosses the threshold
    const drained = metrics.drainExceptionalEvents()
    expect(drained).toHaveLength(1)
    expect(drained[0]).toMatchObject({ kind: 'event-rate-spike', namespace: 'acme/project', eventCount: 5, threshold: 5 })
  })

  it('draining exceptional events clears them — a second drain with no new events returns empty', () => {
    const metrics = new WatcherMetrics('acme/project', { spikeThreshold: 1 })
    metrics.recordEvent('changed')
    expect(metrics.drainExceptionalEvents()).toHaveLength(1)
    expect(metrics.drainExceptionalEvents()).toHaveLength(0)
  })

  it('an ordinary save-and-reindex cycle (1-2 events) never trips the default spike threshold', () => {
    const metrics = new WatcherMetrics('acme/project')
    metrics.recordEvent('changed')
    metrics.recordEvent('changed')
    expect(metrics.drainExceptionalEvents()).toHaveLength(0)
  })

  it('formatLogLine produces a one-line, greppable entry with the namespace and counts', () => {
    const metrics = new WatcherMetrics('acme/project')
    metrics.recordEvent('created')
    metrics.recordDebounce(50)
    const line = metrics.formatLogLine()
    expect(line).toContain('namespace=acme/project')
    expect(line).toContain('total=1')
    expect(line).toContain('created=1')
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/)
  })
})
