/**
 * Seed aging thresholds (ADR-0041 QST-SEEDTHRESHOLDS, ratified 2026-08-12):
 * "Adaptive by default: 0.5 × repository median activity... Make both the
 * mode (fixed/adaptive) and the constant/multiplier user-configurable."
 * Jérémie's own framing: the threshold's purpose is visual salience for
 * attention-steering under cognitive overload, not a value judgment — "a
 * fixed 14-day threshold dims 71% of live iterating seeds immediately...
 * adaptive = constant × median makes 'dim' mean 'unusually quiet for THIS
 * house's rhythm'." Pure date/statistics math, vscode-import-free, same
 * reasoning as this directory's other pure helpers (categoryOrder.ts,
 * rootPathFragment.ts, treeItemIdentity.ts) — the renderer that actually
 * classifies which seeds feed this computation is Flint's rollup-parser
 * lane (axis-1 "iterating" classification), landing separately; this
 * module only does the math once given a list of activity ages.
 *
 * Deliberately scoped to the DISPLAY threshold only (item 6's "the tree's
 * color bar") — the SWEEP threshold (Gleaner's triage bar) is a separate,
 * independently-configured lane per the same ADR item, owned there.
 */

export type SeedAgingMode = 'fixed' | 'adaptive'

export interface SeedAgingConfig {
  mode: SeedAgingMode
  /** Multiplier applied to the repo's median activity age in 'adaptive' mode. ADR-0041's ratified default: 0.5. */
  adaptiveMultiplier: number
  /** Threshold in days, used directly in 'fixed' mode. */
  fixedThresholdDays: number
}

export const DEFAULT_SEED_AGING_CONFIG: SeedAgingConfig = {
  mode: 'adaptive',
  adaptiveMultiplier: 0.5,
  fixedThresholdDays: 14,
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Whole days elapsed from `dateStr` (a "YYYY-MM-DD"-shaped date, the
 * format's own convention for seed/thread-turn dates) to `now`. Undefined
 * for an unparseable date — the caller decides whether to exclude it or
 * treat it as "no measurable age" (Naturalist's own framing: "n=41 WITH
 * MEASURABLE age" — unparseable/missing dates are excluded, not zeroed).
 */
export function daysSince(dateStr: string, now: Date): number | undefined {
  const parsed = new Date(dateStr)
  if (Number.isNaN(parsed.getTime())) return undefined
  const diffMs = now.getTime() - parsed.getTime()
  if (diffMs < 0) return undefined // a future-dated entry has no meaningful "age"
  return Math.floor(diffMs / MS_PER_DAY)
}

/** Ordinary statistical median — the "middle value," average of the two middles for an even-length list. Undefined for an empty list (no repo-wide activity signal to adapt to). */
export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * The display-dimming threshold, in days, per ADR-0041 QST-SEEDTHRESHOLDS.
 * `activityDaysList` is the caller's own responsibility to scope correctly
 * — per Naturalist's ratified demography, this should be "days since last
 * activity" for the axis-1 "iterating"-family seeds specifically, not
 * every seed in the repo (a chunked/parked/superseded seed's age isn't
 * part of the salience signal this threshold exists to compute). Falls
 * back to `fixedThresholdDays` when there's no measurable activity to
 * adapt to (an empty repo, or every seed missing a parseable date) — an
 * adaptive mode with nothing to adapt to must never silently produce a
 * zero or NaN threshold that dims everything.
 */
export function computeDisplayThresholdDays(activityDaysList: number[], config: SeedAgingConfig): number {
  if (config.mode === 'fixed') return config.fixedThresholdDays
  const m = median(activityDaysList)
  return m === undefined ? config.fixedThresholdDays : config.adaptiveMultiplier * m
}

/** Whether a seed with `daysSinceLastActivity` age should render as dimmed/stale under the given threshold. Equal-to-threshold does NOT dim — the threshold is "unusually quiet," not "at or past normal." */
export function isStale(daysSinceLastActivity: number, thresholdDays: number): boolean {
  return daysSinceLastActivity > thresholdDays
}

/**
 * The most recent parseable date among candidates — a seed's "last
 * activity" per ADR-0041 item 4's own load-bearing dependency (Thread
 * turn heading dates). Callers pass `[seed.date, ...seed.threadEntries.
 * map(e => e.date)]` (or the axis-1-relevant subset once Flint's rollup
 * parser lands) without this module needing to import SeedFile's own
 * types — kept decoupled, primitives in, primitives out. Undefined
 * entries and unparseable date strings are both silently skipped, never
 * thrown on — malformed/missing dates are common in wild seed prose.
 */
export function mostRecentDate(candidates: Array<string | undefined>): string | undefined {
  let best: { raw: string; time: number } | undefined
  for (const raw of candidates) {
    if (!raw) continue
    const time = new Date(raw).getTime()
    if (Number.isNaN(time)) continue
    if (!best || time > best.time) best = { raw, time }
  }
  return best?.raw
}
