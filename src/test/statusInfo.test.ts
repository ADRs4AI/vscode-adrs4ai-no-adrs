/**
 * statusInfo.ts had zero direct test coverage despite gating two real
 * parser diagnostics (MISSING_SCOPE_REMAINING, UNKNOWN_STATUS — see
 * extractor.ts:230,266). Most of the file is a literal data table plus
 * one-line Map lookups, which a per-field test would just restate — these
 * tests cover the three things that are actual behavioral contracts a
 * refactor or copy-paste edit could silently break: the unknown-status
 * fallback, the requiresScope rule's single-status scope, and table
 * uniqueness. `statusThemeIcon` moved to `src/views/statusIcon.ts` (Phase
 * 0(a), docket ADR-0001) — see `statusIcon.test.ts`.
 */

import { describe, it, expect } from 'vitest'
import {
  ADR_STATUSES,
  KNOWN_STATUS_VALUES,
  getStatusInfo,
  statusEmoji,
  statusCodicon,
  statusColorToken,
  requiresScopeRemaining,
  isSettledAdrStatus,
} from '../parser/statusInfo'

describe('unknown-status fallback', () => {
  // This is the path a real user-authored ADR takes when its Status field
  // has a typo or a value from a different template lineage — AdrStatus's
  // own type comment documents tolerating unknown values, not rejecting them.
  const UNKNOWN = 'Some Nonstandard Status'

  it('getStatusInfo returns undefined rather than throwing', () => {
    expect(getStatusInfo(UNKNOWN)).toBeUndefined()
  })

  it('statusEmoji/statusCodicon/statusColorToken degrade to their documented defaults', () => {
    expect(statusEmoji(UNKNOWN)).toBe('📄')
    expect(statusCodicon(UNKNOWN)).toBe('file-text')
    expect(statusColorToken(UNKNOWN)).toBe('foreground')
  })

  it('requiresScopeRemaining defaults to false for an unrecognized status', () => {
    expect(requiresScopeRemaining(UNKNOWN)).toBe(false)
  })
})

describe('requiresScopeRemaining — the MISSING_SCOPE_REMAINING diagnostic gate', () => {
  it('is true for exactly one status: Partially Implemented', () => {
    const trueFor = ADR_STATUSES.filter((s) => requiresScopeRemaining(s.value)).map((s) => s.value)
    expect(trueFor).toEqual(['Partially Implemented'])
  })

  it('is false for every other known status', () => {
    for (const status of ADR_STATUSES) {
      if (status.value === 'Partially Implemented') continue
      expect(requiresScopeRemaining(status.value)).toBe(false)
    }
  })
})

describe('ADR_STATUSES table invariants', () => {
  it('has no duplicate `value` entries — a duplicate would silently shadow in the lookup Map', () => {
    const values = ADR_STATUSES.map((s) => s.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('every entry has a non-empty emoji, codicon, and colorToken', () => {
    for (const s of ADR_STATUSES) {
      expect(s.emoji).not.toBe('')
      expect(s.codicon).not.toBe('')
      expect(s.colorToken).not.toBe('')
    }
  })

  it('KNOWN_STATUS_VALUES (consumed by the UNKNOWN_STATUS diagnostic) matches ADR_STATUSES exactly', () => {
    expect(KNOWN_STATUS_VALUES).toEqual(ADR_STATUSES.map((s) => s.value))
  })
})

// Category-header filter checkboxes (Facet's go-ahead, 2026-08-16; built
// per Jérémie's live "clear your queue" ask, 2026-08-25).
describe('isSettledAdrStatus', () => {
  it('Implemented and Superseded are settled — the decision itself is closed', () => {
    expect(isSettledAdrStatus('Implemented')).toBe(true)
    expect(isSettledAdrStatus('Superseded')).toBe(true)
  })

  it('the pause family is settled — the document itself is closed', () => {
    expect(isSettledAdrStatus('Deferred')).toBe(true)
    expect(isSettledAdrStatus('Paused')).toBe(true)
    expect(isSettledAdrStatus('Suspended')).toBe(true)
    expect(isSettledAdrStatus('On Hold')).toBe(true)
  })

  it('Draft/Proposed/Accepted/Partially Implemented are NOT settled — exactly where a human is still the bottleneck', () => {
    expect(isSettledAdrStatus('Draft')).toBe(false)
    expect(isSettledAdrStatus('Proposed')).toBe(false)
    expect(isSettledAdrStatus('Accepted')).toBe(false)
    expect(isSettledAdrStatus('Partially Implemented')).toBe(false)
  })

  it('tolerates a real annotated status line, same as the rest of this file\'s normalized reads', () => {
    expect(isSettledAdrStatus('Implemented — see PR #123')).toBe(true)
    expect(isSettledAdrStatus('Deferred — designed in full, not pursued now')).toBe(true)
  })

  it('an unrecognized or missing status is NOT settled — recall-first, never hide something we can\'t classify', () => {
    expect(isSettledAdrStatus('Nonstandard')).toBe(false)
    expect(isSettledAdrStatus(undefined)).toBe(false)
  })
})
