/**
 * statusInfo.ts had zero direct test coverage despite gating two real
 * parser diagnostics (MISSING_SCOPE_REMAINING, UNKNOWN_STATUS — see
 * extractor.ts:230,266). Most of the file is a literal data table plus
 * one-line Map lookups, which a per-field test would just restate — these
 * tests cover the three things that are actual behavioral contracts a
 * refactor or copy-paste edit could silently break: the unknown-status
 * fallback, the requiresScope rule's single-status scope, and table
 * uniqueness. `statusThemeIcon` is tested via injected constructors (its
 * own design already avoids needing the real `vscode` module).
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
  statusThemeIcon,
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

describe('statusThemeIcon', () => {
  // Injected fakes standing in for vscode.ThemeIcon/ThemeColor — the
  // function's own signature was already designed to make this possible
  // without importing the real vscode module.
  class FakeThemeColor {
    constructor(public token: string) {}
  }
  class FakeThemeIcon {
    constructor(public codicon: string, public color?: FakeThemeColor) {}
  }

  it('builds an icon with the status\'s codicon and color for a known status', () => {
    const icon = statusThemeIcon('Accepted', FakeThemeIcon as never, FakeThemeColor as never) as unknown as FakeThemeIcon
    expect(icon.codicon).toBe('check')
    expect((icon.color as unknown as FakeThemeColor).token).toBe('testing.iconPassed')
  })

  it('falls back to a plain file-text icon with no color for an unknown status', () => {
    const icon = statusThemeIcon('Nonstandard', FakeThemeIcon as never, FakeThemeColor as never) as unknown as FakeThemeIcon
    expect(icon.codicon).toBe('file-text')
    expect(icon.color).toBeUndefined()
  })
})
