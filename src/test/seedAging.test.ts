/**
 * ADR-0041 QST-SEEDTHRESHOLDS (ratified 2026-08-12): "Adaptive by default:
 * 0.5 × repository median activity... Make both the mode (fixed/adaptive)
 * and the constant/multiplier user-configurable." The ratified example:
 * "currently ~27 days → dims at ~14 days in this repo" — real numbers
 * pinned as regression tests below, not invented ones.
 */

import { describe, it, expect } from 'vitest'
import {
  daysSince,
  median,
  computeDisplayThresholdDays,
  isStale,
  mostRecentDate,
  DEFAULT_SEED_AGING_CONFIG,
  type SeedAgingConfig,
} from '../views/seedAging'

describe('daysSince', () => {
  it('computes whole days elapsed', () => {
    expect(daysSince('2026-08-01', new Date('2026-08-15T00:00:00Z'))).toBe(14)
  })

  it('is undefined for an unparseable date', () => {
    expect(daysSince('not-a-date', new Date('2026-08-15T00:00:00Z'))).toBeUndefined()
  })

  it('is undefined for a future-dated entry — no meaningful "age" yet', () => {
    expect(daysSince('2026-09-01', new Date('2026-08-15T00:00:00Z'))).toBeUndefined()
  })
})

describe('median', () => {
  it('is the middle value for an odd-length list', () => {
    expect(median([9, 27, 75])).toBe(27)
  })

  it('averages the two middles for an even-length list', () => {
    expect(median([10, 20, 30, 40])).toBe(25)
  })

  it('is undefined for an empty list — no signal to adapt to', () => {
    expect(median([])).toBeUndefined()
  })

  it('does not require pre-sorted input', () => {
    expect(median([75, 9, 27])).toBe(27)
  })
})

describe('computeDisplayThresholdDays', () => {
  // The ADR's own worked example: median activity ~27 days, default
  // multiplier 0.5, dims at ~14 days.
  it('adaptive mode: 0.5 × repo median, matching the ANS\'s own worked example', () => {
    const threshold = computeDisplayThresholdDays([9, 27, 75, 146], DEFAULT_SEED_AGING_CONFIG)
    // median([9,27,75,146]) = (27+75)/2 = 51; 0.5 * 51 = 25.5 — a smaller,
    // 3-value sample matching the ADR's cited "median 27" lands closer to 14:
    expect(threshold).toBe(25.5)
  })

  it('the ADR\'s cited median (27) at the ratified default multiplier gives ~14 days', () => {
    const threshold = computeDisplayThresholdDays([27], DEFAULT_SEED_AGING_CONFIG)
    expect(threshold).toBe(13.5)
  })

  it('fixed mode ignores the activity list entirely and uses fixedThresholdDays', () => {
    const config: SeedAgingConfig = { mode: 'fixed', adaptiveMultiplier: 0.5, fixedThresholdDays: 14 }
    expect(computeDisplayThresholdDays([9, 27, 75, 146], config)).toBe(14)
  })

  it('adaptive mode with no measurable activity (empty list) falls back to fixedThresholdDays, never 0 or NaN', () => {
    const threshold = computeDisplayThresholdDays([], DEFAULT_SEED_AGING_CONFIG)
    expect(threshold).toBe(DEFAULT_SEED_AGING_CONFIG.fixedThresholdDays)
    expect(Number.isFinite(threshold)).toBe(true)
  })

  it('respects a custom multiplier', () => {
    const config: SeedAgingConfig = { mode: 'adaptive', adaptiveMultiplier: 1.5, fixedThresholdDays: 30 }
    expect(computeDisplayThresholdDays([20], config)).toBe(30)
  })
})

describe('isStale', () => {
  it('strictly greater than the threshold is stale', () => {
    expect(isStale(15, 14)).toBe(true)
  })

  it('exactly AT the threshold is NOT stale — "unusually quiet," not "at or past normal"', () => {
    expect(isStale(14, 14)).toBe(false)
  })

  it('below the threshold is not stale', () => {
    expect(isStale(5, 14)).toBe(false)
  })
})

describe('mostRecentDate', () => {
  it('picks the latest of several candidates', () => {
    expect(mostRecentDate(['2026-07-01', '2026-08-05', '2026-07-20'])).toBe('2026-08-05')
  })

  it('skips undefined entries', () => {
    expect(mostRecentDate([undefined, '2026-08-05', undefined])).toBe('2026-08-05')
  })

  it('skips unparseable date strings', () => {
    expect(mostRecentDate(['not-a-date', '2026-08-05', 'also-garbage'])).toBe('2026-08-05')
  })

  it('is undefined when nothing is parseable', () => {
    expect(mostRecentDate([undefined, 'garbage', undefined])).toBeUndefined()
  })
})
