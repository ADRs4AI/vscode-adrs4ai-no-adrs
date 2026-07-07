/**
 * AdrIndex / SeedIndex directory-scanning tests — ADR-0023
 *
 * ADR-0023 introduces docs/adr/.working/ as the extension's own byproduct
 * directory (drafts.json, drafts-archive.json). This must never be treated
 * as ADR or seed source, now or if the scan logic becomes recursive later
 * (ADR-0025's multi-root work). These tests exercise indexDirectory()
 * against a real temp directory rather than mocking fs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { AdrIndex } from '../index/adrIndex'
import { SeedIndex } from '../index/seedIndex'

describe('AdrIndex.indexDirectory: docs/adr/.working/ exclusion (ADR-0023)', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-index-test-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('indexes real numbered ADRs and ignores a .working/ subdirectory alongside them', () => {
    fs.writeFileSync(path.join(dir, '0001-storage-backend.md'), '# ADR-0001: Storage Backend\n\n- **Status**: Draft\n')
    const workingDir = path.join(dir, '.working')
    fs.mkdirSync(workingDir)
    fs.writeFileSync(path.join(workingDir, 'drafts.json'), '[]')

    const index = new AdrIndex()
    const results = index.indexDirectory(dir)
    return results.then(adrs => {
      expect(adrs).toHaveLength(1)
      expect(adrs[0].number).toBe(1)
    })
  })

  it('does not crash when a stray dot-prefixed .md file sits at the top level', () => {
    fs.writeFileSync(path.join(dir, '0001-storage-backend.md'), '# ADR-0001: Storage Backend\n\n- **Status**: Draft\n')
    fs.writeFileSync(path.join(dir, '.hidden.md'), '# Not an ADR\n')

    const index = new AdrIndex()
    return index.indexDirectory(dir).then(adrs => {
      expect(adrs).toHaveLength(1)
      expect(adrs.some(a => a.path.includes('.hidden.md'))).toBe(false)
    })
  })
})

describe('AdrIndex.indexFile: synchronous reindex on a write we just made (bug fix)', () => {
  // Regression: seed-2026-07-06-panel-submit-no-refresh-bug.md — the panel
  // wrote an answer, then relied entirely on the async FileSystemWatcher
  // round-trip to notice its own change. When that watcher was slow or
  // missed, the panel stayed stuck on the already-answered question until
  // an unrelated manual editor save nudged it. The fix (writeAnswer() and
  // changeAdrStatus() in extension.ts) calls index.indexFile() directly
  // after a self-made write, rather than waiting on the watcher. This test
  // verifies the mechanism the fix depends on: indexFile() re-parses and
  // fires onChange synchronously, with no dependency on watcher timing.
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-reindex-test-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('re-parsing a file after an external content change fires onChange synchronously, same tick', () => {
    const filePath = path.join(dir, '0001-storage-backend.md')
    fs.writeFileSync(filePath, '# ADR-0001: Storage Backend\n\n- **Status**: Draft\n')

    const index = new AdrIndex()
    index.indexFile(filePath)

    let fired = false
    let statusSeen: string | undefined
    index.onChange(event => {
      fired = true
      if (event.type === 'updated') statusSeen = event.adr.status
    })

    // Simulate what writeAnswer()/changeAdrStatus() do: the extension itself
    // just wrote new content to disk (via applyEdit + save).
    fs.writeFileSync(filePath, '# ADR-0001: Storage Backend\n\n- **Status**: Accepted\n')
    index.indexFile(filePath) // the fix: reindex directly, don't wait for the watcher

    expect(fired).toBe(true)
    expect(statusSeen).toBe('Accepted')
  })
})

describe('SeedIndex.indexDirectory: docs/adr/.working/ exclusion (ADR-0023)', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-index-test-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('indexes real seeds and ignores a .working/ subdirectory alongside them', () => {
    fs.writeFileSync(
      path.join(dir, 'seed-2026-07-06-bug-reports.md'),
      '# SEED: Bug Reports\n\n- **Date**: 2026-07-06\n',
    )
    const workingDir = path.join(dir, '.working')
    fs.mkdirSync(workingDir)
    fs.writeFileSync(path.join(workingDir, 'drafts.json'), '[]')

    const index = new SeedIndex()
    return index.indexDirectory(dir).then(seeds => {
      expect(seeds).toHaveLength(1)
      expect(seeds[0].topic).toBe('Bug Reports')
    })
  })

  it('the content-based fallback does not sweep up a dot-prefixed seed-like markdown file', () => {
    // Regression: the content-based fallback (ADR-0016 Iteration 2) matches
    // any .md file that isn't ADR-numbered and isn't seed-prefixed — broad
    // enough that, without an explicit dot-guard, a stray dotfile with
    // seed-like content ("# SEED: ...") would be swept in.
    fs.writeFileSync(path.join(dir, '.hidden-seed-like.md'), '# SEED: Should not be indexed\n\n- **Date**: 2026-07-06\n')

    const index = new SeedIndex()
    return index.indexDirectory(dir).then(seeds => {
      expect(seeds).toHaveLength(0)
    })
  })
})

describe('SeedIndex.allOpenQuestions (ADR-0018 Step 3)', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-index-questions-test-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('aggregates unanswered questions across multiple seeds', () => {
    fs.writeFileSync(
      path.join(dir, 'seed-2026-07-07-a.md'),
      '# SEED: A\n\n## Brain Dump\n\n### QST: Open one?\n\n- Status: unanswered\n',
    )
    fs.writeFileSync(
      path.join(dir, 'seed-2026-07-07-b.md'),
      '# SEED: B\n\n## Brain Dump\n\n### QST: Open two?\n\n- Status: unanswered\n\n### QST: Answered one?\n\n- Status: answered\n\n**ANS:** (by Jérémie)\nDone.\n',
    )

    const index = new SeedIndex()
    return index.indexDirectory(dir).then(() => {
      const open = index.allOpenQuestions()
      expect(open).toHaveLength(2)
      expect(open.map(q => q.text).sort()).toEqual(['Open one?', 'Open two?'])
      expect(open.every(q => q.sourceKind === 'seed')).toBe(true)
    })
  })

  it('returns an empty array when no seed has open questions', () => {
    fs.writeFileSync(path.join(dir, 'seed-2026-07-07-c.md'), '# SEED: C\n\n## Brain Dump\n\nJust prose.\n')
    const index = new SeedIndex()
    return index.indexDirectory(dir).then(() => {
      expect(index.allOpenQuestions()).toEqual([])
    })
  })
})
