/**
 * Watcher instrumentation — ADR-0025 Decision 3, required v1 audit surface.
 *
 * Per-root file watchers (Decision 3: one per RootNode) are expected to be
 * a "lower-order term" compared to agent-harness costs on multi-root
 * projects — but that's an assumption, not a fact, and Jérémie's own
 * framing was explicit: instrumentation is what lets us confirm or falsify
 * it rather than assume it. This module is the pure, testable core of that
 * surface: event counting, a sliding-window resource-usage estimate, a
 * running debounce-latency average, and exceptional-event detection
 * (glob-storm / event-rate spikes). It does not touch vscode.FileSystemWatcher
 * or vscode.window.createOutputChannel directly — extension.ts's activation
 * wiring calls recordEvent()/recordDebounce() from its own watcher
 * callbacks and drains exceptional events for the Problems-panel surface;
 * that wiring is a separate, larger seam left for its own commit.
 */

export type WatcherEventKind = 'created' | 'changed' | 'deleted'

export interface WatcherMetricsSnapshot {
  namespace: string
  totalEvents: number
  eventsByKind: Record<WatcherEventKind, number>
  lastEventAt?: number
  averageDebounceMs?: number
  /**
   * A coarse proxy (events observed in the trailing window, extrapolated to
   * a per-minute rate) — not a real CPU/memory measurement. Precise enough
   * to falsify "the watcher is a lower-order term" if it's ever wildly
   * wrong, which is the only thing the v1 audit surface needs it for.
   */
  estimatedEventsPerMinute: number
}

export interface ExceptionalEvent {
  kind: 'event-rate-spike'
  namespace: string
  windowMs: number
  eventCount: number
  threshold: number
  detectedAt: number
}

export interface WatcherMetricsOptions {
  /** Sliding window (ms) used for the resource-usage estimate and spike detection. */
  windowMs?: number
  /** Event count within `windowMs` that trips an exceptional-event report. */
  spikeThreshold?: number
  /** Injectable clock — avoids real timers/sleeps in unit tests. */
  now?: () => number
}

const DEFAULT_WINDOW_MS = 60_000
// An ordinary save-and-reindex cycle is 1-2 events. Hundreds within a
// minute is glob-storm territory: a recursive watch pattern matching far
// more than intended, or some other process rewriting files in a loop.
const DEFAULT_SPIKE_THRESHOLD = 200
// Bounded so a long-running session's debounce history can't grow
// unboundedly; recent samples are what a "how's the watcher doing right
// now" audit actually needs.
const MAX_DEBOUNCE_SAMPLES = 200

export class WatcherMetrics {
  private readonly namespace: string
  private readonly windowMs: number
  private readonly spikeThreshold: number
  private readonly now: () => number

  private windowEvents: number[] = [] // timestamps only, within the sliding window
  private debounceSamples: number[] = []
  private pendingExceptionalEvents: ExceptionalEvent[] = []
  private totalEvents = 0
  private eventsByKind: Record<WatcherEventKind, number> = { created: 0, changed: 0, deleted: 0 }
  private lastEventAt: number | undefined

  constructor(namespace: string, options: WatcherMetricsOptions = {}) {
    this.namespace = namespace
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
    this.spikeThreshold = options.spikeThreshold ?? DEFAULT_SPIKE_THRESHOLD
    this.now = options.now ?? (() => Date.now())
  }

  /** Call when the raw fs event fires (before debouncing). */
  recordEvent(kind: WatcherEventKind): void {
    const timestampMs = this.now()
    this.windowEvents.push(timestampMs)
    this.totalEvents += 1
    this.eventsByKind[kind] += 1
    this.lastEventAt = timestampMs
    this.pruneWindow(timestampMs)
    this.checkForSpike(timestampMs)
  }

  /** Call when the debounced handler actually runs, with the ms elapsed since the triggering event. */
  recordDebounce(elapsedMs: number): void {
    this.debounceSamples.push(elapsedMs)
    if (this.debounceSamples.length > MAX_DEBOUNCE_SAMPLES) this.debounceSamples.shift()
  }

  private pruneWindow(nowMs: number): void {
    const cutoff = nowMs - this.windowMs
    while (this.windowEvents.length > 0 && this.windowEvents[0] < cutoff) this.windowEvents.shift()
  }

  private checkForSpike(nowMs: number): void {
    if (this.windowEvents.length < this.spikeThreshold) return
    this.pendingExceptionalEvents.push({
      kind: 'event-rate-spike',
      namespace: this.namespace,
      windowMs: this.windowMs,
      eventCount: this.windowEvents.length,
      threshold: this.spikeThreshold,
      detectedAt: nowMs,
    })
  }

  /** New, not-yet-surfaced exceptional events. Draining clears them — callers own de-duplication against their own display surface. */
  drainExceptionalEvents(): ExceptionalEvent[] {
    const drained = this.pendingExceptionalEvents
    this.pendingExceptionalEvents = []
    return drained
  }

  snapshot(): WatcherMetricsSnapshot {
    const nowMs = this.now()
    this.pruneWindow(nowMs)
    const averageDebounceMs = this.debounceSamples.length > 0
      ? this.debounceSamples.reduce((sum, ms) => sum + ms, 0) / this.debounceSamples.length
      : undefined
    return {
      namespace: this.namespace,
      totalEvents: this.totalEvents,
      eventsByKind: { ...this.eventsByKind },
      lastEventAt: this.lastEventAt,
      averageDebounceMs,
      estimatedEventsPerMinute: (this.windowEvents.length / this.windowMs) * 60_000,
    }
  }

  /** One-line, greppable entry for docs/adr/.settings/metrics.log. */
  formatLogLine(): string {
    const s = this.snapshot()
    const debounce = s.averageDebounceMs !== undefined ? `${s.averageDebounceMs.toFixed(1)}ms` : 'n/a'
    const timestamp = new Date(this.now()).toISOString()
    return `[${timestamp}] namespace=${s.namespace} total=${s.totalEvents} created=${s.eventsByKind.created} changed=${s.eventsByKind.changed} deleted=${s.eventsByKind.deleted} avgDebounce=${debounce} estRate=${s.estimatedEventsPerMinute.toFixed(1)}/min`
  }
}
