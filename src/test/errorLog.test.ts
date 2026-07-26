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
  type PanelErrorRecord,
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
