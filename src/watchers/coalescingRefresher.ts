/**
 * Coalescing refresh state machine — ADR-0025 Decision 5.
 *
 * "A composite-level refresh path guards re-materialization
 * deterministically: a single `refreshing` boolean + a pending-refresh
 * promise. When the root set changes... the refresh computes the target
 * set at the END of the current refresh, not per incoming event — two
 * rapid `.settings/roots.json` saves cannot leak an intermediate state."
 *
 * Pure and vscode-free by design: the actual disposal/rebuild work (real
 * FileSystemWatchers, real filesystem scans) is vscode- and fs-heavy and
 * lives in rootWatcherLifecycle.ts. This class only owns the SHAPE of "run
 * `work`, but if triggered again while already running, don't start a
 * second overlapping run — run once more after the current one finishes,"
 * which is independently testable without any of that machinery.
 */
export class CoalescingRefresher {
  private running = false
  private pending = false

  constructor(private readonly work: () => Promise<void>) {}

  /**
   * Request a refresh. If one is already in flight, this call doesn't start
   * a second, overlapping one — it marks that the target set needs
   * recomputing once the current run finishes, so N rapid requests settle
   * on exactly one final rebuild rather than N racing ones.
   */
  async request(): Promise<void> {
    if (this.running) {
      this.pending = true
      return
    }
    this.running = true
    try {
      do {
        this.pending = false
        await this.work()
      } while (this.pending)
    } finally {
      this.running = false
    }
  }

  get isRunning(): boolean {
    return this.running
  }
}
