/**
 * File-identity guards — regression tests for the phantom-ADR incident.
 *
 * Incident (2026-07-14, reported live by Jérémie, system3-conversations):
 * "ADR-2026: 2026-07-14-...-gpt-5.6-sol [Draft]" appeared in the tree with
 * no source file anywhere under docs/adr. The buffer-change trigger indexed
 * any digit-prefixed .md merely OPENED in the editor — a research report in
 * docs/reports/ — because the basename-shape predicate was reused without
 * the disk-watcher glob that had made it sufficient. Fixed by pairing the
 * shape checks with an explicit direct-child containment check.
 */

import { describe, it, expect } from 'vitest'
import { isAdrBasename, isSeedBasename, isDirectChildOf } from '../index/fileGuards'

const WS = '/Users/x/Programming/system3/system3-conversations'
const ADR_DIR = `${WS}/docs/adr`

describe('fileGuards', () => {
  describe('Regression tests', () => {
    it('the real phantom: date-prefixed report OUTSIDE docs/adr passes the shape check but fails containment (fixes ADR-2026 phantom, 2026-07-14)', () => {
      const phantom = `${WS}/docs/reports/2026-07-14-claude-memory-controls-research_perplexity-search-gpt-5.6-sol.md`
      // The shape check alone matches — this is exactly why it was never
      // safe to use as the buffer trigger's only guard.
      expect(isAdrBasename('2026-07-14-claude-memory-controls-research_perplexity-search-gpt-5.6-sol.md')).toBe(true)
      // Containment is what keeps it out of the index.
      expect(isDirectChildOf(phantom, ADR_DIR)).toBe(false)
    })

    it('a real ADR in docs/adr passes both shape and containment', () => {
      expect(isAdrBasename('0031-incremental-sync-mechanism.md')).toBe(true)
      expect(isDirectChildOf(`${ADR_DIR}/0031-incremental-sync-mechanism.md`, ADR_DIR)).toBe(true)
    })

    it('containment is direct-child only, matching the disk watcher glob — a nested dir under docs/adr is out of scope', () => {
      expect(isDirectChildOf(`${ADR_DIR}/templates/0000-template.md`, ADR_DIR)).toBe(false)
    })

    it('containment cannot be defeated by ../ traversal', () => {
      expect(isDirectChildOf(`${ADR_DIR}/../reports/2026-07-14-report.md`, ADR_DIR)).toBe(false)
      expect(isDirectChildOf(`${WS}/docs/reports/../adr/0001-real.md`, ADR_DIR)).toBe(true)
    })
  })

  it('basename shapes: ADR vs seed vs neither', () => {
    expect(isAdrBasename('0001-foo.md')).toBe(true)
    expect(isAdrBasename('001_foo.md')).toBe(true)
    expect(isAdrBasename('seed-2026-04-19-claude-shares.md')).toBe(false)
    expect(isAdrBasename('README.md')).toBe(false)
    expect(isSeedBasename('seed-2026-04-19-claude-shares.md')).toBe(true)
    expect(isSeedBasename('0001-foo.md')).toBe(false)
  })
})
