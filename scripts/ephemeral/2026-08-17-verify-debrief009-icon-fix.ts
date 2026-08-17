import { statusThemeIcon } from '../../src/parser/statusInfo'
class FakeThemeIcon { constructor(public id: string, public color?: any) {} }
class FakeThemeColor { constructor(public id: string) {} }
const icon = statusThemeIcon('Implemented — the two-seam architecture, the exceptions.py extraction...', FakeThemeIcon as any, FakeThemeColor as any)
console.log(JSON.stringify(icon))

// OUTCOME (2026-08-17): confirmed real. statusThemeIcon() on the exact
// live specimen (json-source-edit ADR-0015's annotated "Implemented —
// ..." status) now returns { codicon: 'verified', colorToken:
// 'testing.iconPassed' } -- the correct Implemented icon, not the
// file-text fallback. Riddle's DEBRIEF-009 fix (statusInfo.ts's layered
// resolveStatusInfo: exact-first, normalized fallback) verified against
// the real reported specimen, not just its own unit tests. Full suite
// 1338/1338 green. Ledger row closed SHIPPED for real this time.
