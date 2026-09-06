/**
 * Behavioral tests for report_observation (Lapidary's 2026-08-13 dispatch,
 * founder-ratified: "the Report button for transformers" — appends an
 * error-record/2 line to the target root's docs/adr/.working/errors.jsonl,
 * source: 'mcp', kind: 'observation', sibling to the panel's own
 * reportObservation (src/webview/openQuestionsPanel.ts). Real filesystem
 * (temp dirs), same discipline as errorLog.test.ts — this is a pure
 * handler, not vscode-touching glue, so it gets real behavioral coverage,
 * not just source-shape assertions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { reportObservation } from '../mcp/handlers'
import type { RepositoryContext } from '../mcp/repositoryContext'
import type { AdrFile } from '../parser/types'
import type { LedgerRecord } from '../drafts/errorLog'
import { parseAdr } from '../parser/extractor'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-report-observation-test-'))
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

function makeContext(adrs: AdrFile[]): RepositoryContext {
  return {
    listAdrs: () => adrs,
    getAdr: (ref: string) => {
      const num = parseInt(ref.replace(/^adr:/, ''), 10)
      return adrs.find((a) => a.number === num)
    },
    listSeeds: () => [],
    getSeed: () => undefined,
    readFile: async () => { throw new Error('not needed by these tests') },
    writeFile: async () => { throw new Error('not needed by these tests') },
    listFiles: async () => [],
  }
}

function readLastRecord(logPath: string): LedgerRecord {
  const lines = fs.readFileSync(logPath, 'utf8').trimEnd().split('\n')
  return JSON.parse(lines[lines.length - 1]) as LedgerRecord
}

describe('reportObservation', () => {
  it('requires an explicit author — never defaults to "AI"', async () => {
    const result = await reportObservation(makeContext([]), 'Something looked off.', '/fake/workspace/docs/adr/.anchor', {
      author: '',
    })
    expect(result).toContain('error: missing_author')
  })

  it('requires a non-empty note', async () => {
    const result = await reportObservation(makeContext([]), '   ', '/fake/workspace/docs/adr/.anchor', {
      author: 'Relay 5',
    })
    expect(result).toContain('error: missing_note')
  })

  it('writes an error-record/2 line to the default anchor when adr_ref is omitted — a workspace-wide observation', async () => {
    const defaultAnchor = path.join(tmpDir, 'docs/adr/.mcp-report-observation-anchor')
    const result = await reportObservation(makeContext([]), 'The corpus feels stale after a mid-session commit.', defaultAnchor, {
      author: 'Relay 5',
      scannedAt: '2026-08-13T00:00:00.000Z',
      serverVersion: '0.8.0',
    })
    expect(result).toContain('Observation recorded to')

    const logPath = path.join(tmpDir, 'docs/adr/.working/errors.jsonl')
    const rec = readLastRecord(logPath)
    expect(rec.schema).toBe('error-record/2')
    expect(rec.source).toBe('mcp')
    expect(rec.kind).toBe('observation')
    expect(rec.message).toBe('The corpus feels stale after a mid-session commit.')
    expect(rec.extensionVersion).toBe('0.8.0')
    expect(rec.payload?.author).toBe('Relay 5')
    expect(rec.payload?.scannedAt).toBe('2026-08-13T00:00:00.000Z')
    // No adr_ref given — no document should be captured, and adrRef stays undefined.
    expect(rec.documents).toBeUndefined()
    expect(rec.payload?.adrRef).toBeUndefined()
  })

  it('resolves adr_ref and captures the full referenced document, same as the panel does', async () => {
    const adrContent = '# ADR-0099\n\n## Questions\n\n### QST: Does the MCP report capture me whole?\n- Status: unanswered\n'
    const adrPath = adrAt('docs/adr/0099-test.md', adrContent)
    const adr = parseAdr(adrContent, adrPath)

    const result = await reportObservation(makeContext([adr]), 'This QST is answered upstream but never flipped here.', '/unused-default', {
      author: 'Relay 5',
      adrRef: '99',
      context: 'found while cross-checking system3',
    })
    expect(result).toContain('Observation recorded to')

    const logPath = path.join(tmpDir, 'docs/adr/.working/errors.jsonl')
    const rec = readLastRecord(logPath)
    expect(rec.anchorPath).toBe(adrPath)
    expect(rec.documents?.[adrPath]?.text).toBe(adrContent)
    expect(rec.documents?.[adrPath]?.md5).toMatch(/^[0-9a-f]{32}$/)
    expect(rec.payload?.adrRef).toBe('99')
    expect(rec.payload?.context).toBe('found while cross-checking system3')
  })

  it('returns a structured error, does not fall back to the default anchor, when adr_ref does not resolve', async () => {
    const result = await reportObservation(makeContext([]), 'A note about a nonexistent ADR.', '/fake/workspace/docs/adr/.anchor', {
      author: 'Relay 5',
      adrRef: '9999',
    })
    expect(result).toContain('error: not_found')
  })

  // Bug: with no adr_ref, the observation always landed at defaultAnchorPath
  // — a single path fixed at server startup from this process's own
  // workspaceRoot. Correct for single-root; in a genuine multi-root
  // composite there is no one "the workspace's own root" for an unscoped
  // observation to mean, and this silently misfiled a real observation into
  // the wrong repo's ledger (Riddle 5's ledger row, 2026-09-05, from
  // Prothonotary's 14-root docket workspace: an HQ-vs-docket misfile).
  // Fixed: fail loud with the known namespaces, same discipline
  // resolveAdrByNumber already applies to bare-number cross-root ambiguity,
  // rather than silently picking the launch-time root.
  it('refuses an unscoped observation in a multi-root workspace rather than silently misfiling it (regression, Riddle/Prothonotary)', async () => {
    const docketAdr = parseAdr('# ADR-0001\n', '/fake/docket/docs/adr/0001-x.md', { namespace: 'adrs4ai-docket' })
    const hqAdr = parseAdr('# ADR-0001\n', '/fake/hq/docs/adr/0001-x.md', { namespace: 'adrs4ai-hq' })
    const defaultAnchor = path.join(tmpDir, 'docs/adr/.mcp-report-observation-anchor')

    const result = await reportObservation(makeContext([docketAdr, hqAdr]), 'A note with no adr_ref.', defaultAnchor, {
      author: 'Prothonotary 5',
    })

    expect(result).toContain('error: ambiguous_root')
    expect(result).toContain('adrs4ai-docket')
    expect(result).toContain('adrs4ai-hq')
    // Nothing should have been written anywhere — no ledger file created.
    expect(fs.existsSync(path.join(tmpDir, 'docs/adr/.working/errors.jsonl'))).toBe(false)
  })

  it('an unscoped observation still works when every ADR shares one namespace (the common single-root case, unaffected)', async () => {
    const adr = parseAdr('# ADR-0001\n', path.join(tmpDir, 'docs/adr/0001-x.md'), { namespace: 'my-project' })
    const defaultAnchor = path.join(tmpDir, 'docs/adr/.mcp-report-observation-anchor')

    const result = await reportObservation(makeContext([adr]), 'A workspace-wide note.', defaultAnchor, { author: 'Relay 5' })

    expect(result).toContain('Observation recorded to')
  })

  it('v1 panel records and v2 mcp records coexist in one ledger, distinguishable by source', async () => {
    const defaultAnchor = path.join(tmpDir, 'docs/adr/.mcp-report-observation-anchor')
    await reportObservation(makeContext([]), 'First observation.', defaultAnchor, { author: 'Relay 5' })
    await reportObservation(makeContext([]), 'Second observation.', defaultAnchor, { author: 'Riddle 5' })

    const logPath = path.join(tmpDir, 'docs/adr/.working/errors.jsonl')
    const lines = fs.readFileSync(logPath, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l) as LedgerRecord)
    expect(lines).toHaveLength(2)
    expect(lines.every((r) => r.source === 'mcp')).toBe(true)
    expect(lines.map((r) => r.payload?.author)).toEqual(['Relay 5', 'Riddle 5'])
  })
})
