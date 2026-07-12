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

describe('AdrIndex.removeFile', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-remove-test-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('drops the ADR from the index and emits a removed event', () => {
    const filePath = path.join(dir, '0001-storage-backend.md')
    fs.writeFileSync(filePath, '# ADR-0001: Storage Backend\n\n- **Status**: Draft\n')

    const index = new AdrIndex()
    index.indexFile(filePath)
    expect(index.size).toBe(1)

    let event: import('../index/adrIndex').IndexChangeEvent | undefined
    index.onChange((e) => { event = e })

    index.removeFile(filePath)

    expect(index.size).toBe(0)
    expect(index.getByPath(filePath)).toBeUndefined()
    expect(index.getByNumber(1)).toBeUndefined()
    expect(event?.type).toBe('removed')
    if (event?.type === 'removed') {
      expect(event.adrPath).toBe(filePath)
      expect(event.adrNumber).toBe(1)
    }
  })

  it('is a no-op (no event, no throw) when the path was never indexed', () => {
    const index = new AdrIndex()
    let fired = false
    index.onChange(() => { fired = true })

    expect(() => index.removeFile('/never/indexed.md')).not.toThrow()
    expect(fired).toBe(false)
  })
})

describe('AdrIndex.onChange unsubscribe', () => {
  it('the returned disposer stops delivering events to that listener only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-unsub-test-'))
    try {
      const filePath = path.join(dir, '0001-storage-backend.md')
      fs.writeFileSync(filePath, '# ADR-0001: Storage Backend\n\n- **Status**: Draft\n')

      const index = new AdrIndex()
      let callsToA = 0
      let callsToB = 0
      const unsubscribeA = index.onChange(() => { callsToA += 1 })
      index.onChange(() => { callsToB += 1 })

      index.indexFile(filePath) // both listeners fire (added)
      unsubscribeA()
      fs.writeFileSync(filePath, '# ADR-0001: Storage Backend\n\n- **Status**: Accepted\n')
      index.indexFile(filePath) // only B should fire now (updated)

      expect(callsToA).toBe(1)
      expect(callsToB).toBe(2)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a throwing listener does not prevent other listeners from being called', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-badlistener-test-'))
    try {
      const filePath = path.join(dir, '0001-storage-backend.md')
      fs.writeFileSync(filePath, '# ADR-0001: Storage Backend\n\n- **Status**: Draft\n')

      const index = new AdrIndex()
      let goodListenerCalled = false
      index.onChange(() => { throw new Error('a badly-behaved listener') })
      index.onChange(() => { goodListenerCalled = true })

      expect(() => index.indexFile(filePath)).not.toThrow()
      expect(goodListenerCalled).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('AdrIndex.indexDirectory: duplicate ADR number detection (ADR-0012)', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-dup-test-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('flags two files that resolve to the same number (3-digit vs 4-digit prefix) with DUPLICATE_NUMBER on both', async () => {
    // A real, observed collision shape: 001-foo.md and 0001-bar.md both
    // extract to ADR number 1 (ADR-0012's variable-digit-count tolerance).
    fs.writeFileSync(path.join(dir, '001-foo.md'), '# ADR-0001: Foo\n\n- **Status**: Draft\n')
    fs.writeFileSync(path.join(dir, '0001-bar.md'), '# ADR-0001: Bar\n\n- **Status**: Draft\n')

    const index = new AdrIndex()
    const results = await index.indexDirectory(dir)

    expect(results).toHaveLength(2)
    for (const adr of results) {
      expect(adr.parseWarnings.some((w) => w.code === 'DUPLICATE_NUMBER')).toBe(true)
    }
  })

  it('does not flag distinct ADR numbers', async () => {
    fs.writeFileSync(path.join(dir, '0001-foo.md'), '# ADR-0001: Foo\n\n- **Status**: Draft\n')
    fs.writeFileSync(path.join(dir, '0002-bar.md'), '# ADR-0002: Bar\n\n- **Status**: Draft\n')

    const index = new AdrIndex()
    const results = await index.indexDirectory(dir)

    for (const adr of results) {
      expect(adr.parseWarnings.some((w) => w.code === 'DUPLICATE_NUMBER')).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// AdrIndex.indexContent / SeedIndex.indexContent — "question doesn't
// advance" residual (Lapidary 5, 2026-07-12). Root cause: the refresh
// pipeline was disk-watcher-only, so a write path where the buffer edit
// landed but the disk save silently failed or raced left the panel stale.
// indexContent() lets a caller that already has the text (a live editor
// buffer, or the panel's own post-write reindex) index without a disk
// round-trip — this is what both halves of the fix (extension.ts's new
// onDidChangeTextDocument trigger, and the panel's writeAnswer hardening)
// are built on.
// ---------------------------------------------------------------------------

describe('AdrIndex.indexContent (no disk read, buffer-truth reindex)', () => {
  it('indexes content directly without touching the filesystem', () => {
    const index = new AdrIndex()
    // A path that does not exist on disk — if this touched fs, it would throw.
    const adr = index.indexContent('/fake/does-not-exist/0001-storage.md', '# ADR-0001: Storage\n\n- **Status**: Draft\n')
    expect(adr.number).toBe(1)
    expect(adr.status).toBe('Draft')
  })

  it('fires the same onChange event shape as indexFile (added, then updated)', () => {
    const index = new AdrIndex()
    const events: string[] = []
    index.onChange(e => events.push(e.type))

    index.indexContent('/fake/0001-storage.md', '# ADR-0001: Storage\n\n- **Status**: Draft\n')
    index.indexContent('/fake/0001-storage.md', '# ADR-0001: Storage\n\n- **Status**: Accepted\n')

    expect(events).toEqual(['added', 'updated'])
  })

  it('indexFile() and indexContent() produce the same result for the same text (indexFile is now a thin wrapper)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-index-content-test-'))
    try {
      const filePath = path.join(dir, '0001-storage.md')
      const text = '# ADR-0001: Storage\n\n- **Status**: Draft\n'
      fs.writeFileSync(filePath, text)

      const viaFile = new AdrIndex().indexFile(filePath)
      const viaContent = new AdrIndex().indexContent(filePath, text)

      expect(viaContent.checksum).toBe(viaFile.checksum)
      expect(viaContent.status).toBe(viaFile.status)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reflects unsaved buffer content even when disk has stale (or no) content — the actual fix', () => {
    // Simulates the failure mode directly: a write reached the "buffer"
    // (represented here as a content string never written to disk) — the
    // reindex must reflect it regardless of what's on disk.
    const index = new AdrIndex()
    const bufferContent = '# ADR-0001: Storage\n\n- **Status**: Accepted\n'
    const adr = index.indexContent('/fake/0001-storage.md', bufferContent)
    expect(adr.status).toBe('Accepted')
  })
})

describe('SeedIndex.indexContent (no disk read, buffer-truth reindex)', () => {
  it('indexes content directly without touching the filesystem', () => {
    const index = new SeedIndex()
    const seed = index.indexContent('/fake/does-not-exist/seed-2026-07-12-test.md', '# SEED: Test\n\n- **Date**: 2026-07-12\n')
    expect(seed.topic).toBe('Test')
  })

  it('indexFile() and indexContent() produce the same result for the same text', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-index-content-test-'))
    try {
      const filePath = path.join(dir, 'seed-2026-07-12-test.md')
      const text = '# SEED: Test\n\n- **Date**: 2026-07-12\n'
      fs.writeFileSync(filePath, text)

      const viaFile = new SeedIndex().indexFile(filePath)
      const viaContent = new SeedIndex().indexContent(filePath, text)

      expect(viaContent.checksum).toBe(viaFile.checksum)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
