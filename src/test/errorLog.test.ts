/**
 * Panel error harvesting tests — errors.jsonl (Jérémie's charter, 2026-07-25)
 *
 * The feature's whole promise is "absolutely everything you need to rebuild
 * things" — so these tests verify the reconstruction guarantee (full ADR
 * text + full box text + metadata survive a round-trip through the JSONL),
 * the append-only streaming shape (N events = N parseable lines, no
 * read-modify-write), and the failure-soft contract (harvesting can never
 * throw into the panel, even when the disk says no).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  errorLogPathFor,
  buildErrorRecord,
  appendErrorRecord,
  appendLedgerRecord,
  captureDocument,
  errorSignature,
  type PanelErrorRecord,
  type LedgerRecord,
} from '../drafts/errorLog'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'errorlog-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function adrAt(rel: string, content: string): string {
  const p = path.join(tmpDir, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content, 'utf8')
  return p
}

describe('errorLogPathFor', () => {
  it('targets the OWNING root — .working sibling of the ADR, so multi-root logs never mix', () => {
    const p = errorLogPathFor('/repo-a/docs/adr/0031-detection.md')
    expect(p).toBe('/repo-a/docs/adr/.working/errors.jsonl')
    const q = errorLogPathFor('/repo-b/docs/adr/seed-2026-07-18-blocking-docket.md')
    expect(q).toBe('/repo-b/docs/adr/.working/errors.jsonl')
  })

  /**
   * Real catch (Fixture 5, 2026-09-06, priority-A command-smoke pass —
   * routed to Gleaner, not fixed here: this is `anchorPathFromCommandArg`'s
   * design in extension.ts, which Gleaner (Ledger Warden) owns, not this
   * module's own contract). `errorLogPathFor` unconditionally assumes its
   * argument IS a file — it strips exactly one path segment via
   * `path.dirname`. `anchorPathFromCommandArg`'s own fallback chain
   * (`item?.rootNode?.path ?? ... ?? compositeIndex?.root.path`) can hand it
   * a DIRECTORY instead (a workspace/root path, not a file inside it) —
   * every command invoked with no tree-item argument at all (the Command
   * Palette form of `adrManager.filterQuestions`, `adrManager.expandAll`,
   * etc.) or with a bare string argument that doesn't carry `.adr`/`.seed`/
   * `.question` (e.g. `adrManager.openAdr(filePath, line)` — ALWAYS a raw
   * string, by its own signature, so it ALWAYS falls through to this
   * branch) hits this. The result: `path.dirname(aDirectory)` strips one
   * level too many, writing `.working/errors.jsonl` as a SIBLING of the
   * workspace root, not inside it — verified live during the priority-A
   * pass: a real command-smoke test run left a stray
   * `<tmp-parent>/.working/errors.jsonl` on the actual host filesystem,
   * one level above the test's own temp workspace, until it was manually
   * cleaned up. In a real install this means `adrManager.openAdr` errors —
   * and any Command-Palette-invoked command's errors — land OUTSIDE the
   * project (potentially a sibling of an unrelated repo), or fail silently
   * if that parent directory isn't writable.
   */
  it('CATCH: given a directory (not a file) — the real shape of the rootNode/compositeIndex fallback branches in extension.ts\'s anchorPathFromCommandArg — lands the ledger OUTSIDE the given path, not inside it', () => {
    const workspaceRoot = '/Users/someone/Programming/some-project'
    const p = errorLogPathFor(workspaceRoot)
    expect(p).toBe('/Users/someone/Programming/.working/errors.jsonl') // NOT inside `some-project` at all — a sibling of it
    expect(p.startsWith(workspaceRoot)).toBe(false)
  })
})

describe('buildErrorRecord — the everything-to-rebuild guarantee', () => {
  it('captures the full ADR text at error time, the full box text, and the metadata', () => {
    const adrContent = '# ADR-0099\n\n### QST: Does the harvest capture me whole?\n- Status: unanswered\n'
    const adrPath = adrAt('docs/adr/0099-test.md', adrContent)
    const rec = buildErrorRecord(
      'ans-anchor-not-found',
      'Could not find the ANS block near line 3.',
      adrPath,
      {
        extensionVersion: '0.7.35',
        questionId: 'q-abc',
        draftKey: 'dk-123',
        boxText: 'The human typed this and it must never be lost.',
        meta: { triggeringMessage: { lineStart: 3, force: false } },
      },
    )
    expect(rec.schema).toBe('panel-error/1')
    expect(rec.adrContent).toBe(adrContent) // byte-identical, not a summary
    expect(rec.boxText).toBe('The human typed this and it must never be lost.')
    expect(rec.kind).toBe('ans-anchor-not-found')
    expect(rec.questionId).toBe('q-abc')
    expect(rec.draftKey).toBe('dk-123')
    expect(rec.extensionVersion).toBe('0.7.35')
    expect((rec.meta?.triggeringMessage as { lineStart: number }).lineStart).toBe(3)
    expect(Date.parse(rec.ts)).not.toBeNaN()
  })

  it('still produces a record when the ADR file is unreadable (capture what we can, never nothing)', () => {
    const rec = buildErrorRecord('unhandled-exception', 'ENOENT during write', path.join(tmpDir, 'docs/adr/gone.md'), {
      boxText: 'draft survives even when the file is gone',
    })
    expect(rec.adrContent).toBeUndefined()
    expect(rec.boxText).toBe('draft survives even when the file is gone')
  })
})

describe('appendErrorRecord — JSONL streaming shape', () => {
  it('creates .working/ on first append and each event is one independently parseable line', () => {
    const adrPath = adrAt('docs/adr/0099-test.md', 'content v1')
    const r1 = buildErrorRecord('drift-detected', 'checksum moved', adrPath, { boxText: 'first' })
    const r2 = buildErrorRecord('workspace-edit-rejected', 'edit refused', adrPath, { boxText: 'second' })
    const logPath1 = appendErrorRecord(r1)
    const logPath2 = appendErrorRecord(r2)
    expect(logPath1).toBe(path.join(tmpDir, 'docs/adr/.working/errors.jsonl'))
    expect(logPath2).toBe(logPath1)

    const lines = fs.readFileSync(logPath1!, 'utf8').trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    const parsed = lines.map((l) => JSON.parse(l) as PanelErrorRecord)
    expect(parsed[0].kind).toBe('drift-detected')
    expect(parsed[1].kind).toBe('workspace-edit-rejected')
    // Append-only: the second write did not disturb the first record.
    expect(parsed[0].boxText).toBe('first')
  })

  it('round-trips multi-line ADR content and box text intact through JSON', () => {
    const gnarly = '# Title\n\n**ANS:** (by Jérémie)\nline with `backticks` and "quotes"\n\n\ttab-indented\n'
    const adrPath = adrAt('docs/adr/0100-gnarly.md', gnarly)
    const logPath = appendErrorRecord(
      buildErrorRecord('question-relocation-failed', 'moved', adrPath, { boxText: 'a\nmulti\nline\ndraft' }),
    )
    const rec = JSON.parse(fs.readFileSync(logPath!, 'utf8').trimEnd()) as PanelErrorRecord
    expect(rec.adrContent).toBe(gnarly)
    expect(rec.boxText).toBe('a\nmulti\nline\ndraft')
  })

  it('is failure-soft: an unwritable destination returns undefined instead of throwing', () => {
    // A FILE where the .working DIRECTORY should be → mkdir fails → soft undefined.
    const adrDir = path.join(tmpDir, 'docs/adr')
    fs.mkdirSync(adrDir, { recursive: true })
    fs.writeFileSync(path.join(adrDir, '.working'), 'i am a file, not a directory', 'utf8')
    const rec = buildErrorRecord('unhandled-exception', 'boom', path.join(adrDir, '0101-x.md'))
    expect(() => appendErrorRecord(rec)).not.toThrow()
    expect(appendErrorRecord(rec)).toBeUndefined()
  })
})

describe('error-record/2 — the ledger generalized to many writers (seed 2026-07-29, QST-ERRLEDGER)', () => {
  it('a tour-resolver record round-trips: full tour payload + referenced documents with MD5s', () => {
    const adrContent = '# ADR-0028\n\n### QST: Q?\n- Status: unanswered\n'
    const adrPath = adrAt('docs/adr/0028-identity.md', adrContent)
    const doc = captureDocument(adrPath)!
    expect(doc.text).toBe(adrContent)
    expect(doc.md5).toMatch(/^[0-9a-f]{32}$/)

    const logPath = appendLedgerRecord({
      schema: 'error-record/2',
      ts: '2026-07-29T00:00:00.000Z',
      source: 'tour-resolver',
      kind: 'tour-unresolved-refs',
      message: '2 of 9 entries failed to resolve',
      anchorPath: adrPath,
      payload: {
        tourJson: '{"schema":"question-tour/1","entries":[]}',
        unresolved: [{ ref: 'adr:0028#qst-gone', reason: 'no such anchor' }],
      },
      documents: { [adrPath]: doc },
    })
    const rec = JSON.parse(fs.readFileSync(logPath!, 'utf8').trimEnd()) as LedgerRecord
    expect(rec.source).toBe('tour-resolver')
    expect(rec.documents![adrPath].text).toBe(adrContent) // scoped reconstruction guarantee
    expect((rec.payload!.unresolved as unknown[]).length).toBe(1)
  })

  it('v1 and v2 records coexist in one ledger — same file, distinguishable by schema', () => {
    const adrPath = adrAt('docs/adr/0001-x.md', 'content')
    appendErrorRecord(buildErrorRecord('drift-detected', 'moved', adrPath, {}))
    const logPath = appendLedgerRecord({
      schema: 'error-record/2', ts: '2026-07-29T00:00:00.000Z', source: 'census',
      kind: 'orphan-signal', message: 'S2 signal with no candidate', anchorPath: adrPath,
    })
    const lines = fs.readFileSync(logPath!, 'utf8').trimEnd().split('\n').map(l => JSON.parse(l))
    expect(lines.map(r => r.schema)).toEqual(['panel-error/1', 'error-record/2'])
  })

  it('captureDocument is failure-soft: missing file returns undefined, never throws', () => {
    expect(captureDocument(path.join(tmpDir, 'nope.md'))).toBeUndefined()
  })
})

// Retry-storm dedupe (Riddle's adjudication of Gleaner's first ledger
// sweep, 2026-07-31): lumbroso-hq logged 27 workspace-edit-rejected
// records in ~8 seconds, one question, one specimen — the panel's own
// save-retry loop was re-logging on every retry cycle instead of once per
// actual failure. errorSignature is the pure piece harvestError() dedupes
// against; a real test here catches a real regression class (a retry
// storm silently flooding the ledger again), not just source shape.
describe('errorSignature — retry-storm dedupe key', () => {
  it('identical kind/adrPath/questionId/message produce the same signature', () => {
    const s1 = errorSignature('workspace-edit-rejected', '/repo/docs/adr/0028-x.md', 'q-1', 'edit refused')
    const s2 = errorSignature('workspace-edit-rejected', '/repo/docs/adr/0028-x.md', 'q-1', 'edit refused')
    expect(s1).toBe(s2)
  })

  it('a different kind, adrPath, questionId, or message each produce a distinct signature', () => {
    const base = errorSignature('workspace-edit-rejected', '/repo/docs/adr/0028-x.md', 'q-1', 'edit refused')
    expect(errorSignature('ans-anchor-not-found', '/repo/docs/adr/0028-x.md', 'q-1', 'edit refused')).not.toBe(base)
    expect(errorSignature('workspace-edit-rejected', '/repo/docs/adr/0029-y.md', 'q-1', 'edit refused')).not.toBe(base)
    expect(errorSignature('workspace-edit-rejected', '/repo/docs/adr/0028-x.md', 'q-2', 'edit refused')).not.toBe(base)
    expect(errorSignature('workspace-edit-rejected', '/repo/docs/adr/0028-x.md', 'q-1', 'edit refused again, differently')).not.toBe(base)
  })

  it('a missing questionId is treated consistently, not as a wildcard that matches any question', () => {
    const withoutQ1 = errorSignature('workspace-edit-rejected', '/repo/docs/adr/0028-x.md', undefined, 'edit refused')
    const withoutQ2 = errorSignature('workspace-edit-rejected', '/repo/docs/adr/0028-x.md', undefined, 'edit refused')
    const withQ = errorSignature('workspace-edit-rejected', '/repo/docs/adr/0028-x.md', 'q-1', 'edit refused')
    expect(withoutQ1).toBe(withoutQ2)
    expect(withoutQ1).not.toBe(withQ)
  })
})
