/**
 * Moved from statusInfo.test.ts alongside statusThemeIcon's move to
 * src/views/statusIcon.ts (Phase 0(a) of the docket extraction, ADR-0001 —
 * the parser package carries zero vscode surface, not even type-only).
 */

import { describe, it, expect } from 'vitest'
import { statusThemeIcon } from '../views/statusIcon'

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
