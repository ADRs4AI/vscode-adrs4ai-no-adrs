/**
 * Structural tests (vscode-import wall — same discipline as
 * commitRepoFirstWiring.test.ts / addSeedThreadTurnWiring.test.ts) for
 * commitOneRoot's error-ledger wiring. Fixes a real gap Gleaner found
 * source-grepped (docs/inbox/2026-08-13-gleaner-to-fitter-commit-
 * failures-never-reach-error-record.md): a real, reproducible git-policy
 * pre-commit rejection sat invisible to errors.jsonl until a human
 * manually pasted it into conversation — the founding incident's exact
 * shape, in a code path ADR-0035 predates.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')

describe('extension.ts: commitOneRoot harvests its own catch block, not just toasting', () => {
  const fn = EXT_SRC.match(/async function commitOneRoot\([\s\S]*?\n\}/)![0]
  const catchBlock = fn.match(/\} catch \(err\) \{[\s\S]*?\n  \}\n\}/)![0]

  it('still shows the error toast unchanged — this is additive, not a replacement', () => {
    expect(catchBlock).toContain('vscode.window.showErrorMessage(`ADR Manager: Commit failed (${label}) — ${err}`)')
  })

  it('writes a real-record with its own dedicated source tag', () => {
    expect(catchBlock).toContain("source: 'commit'")
    expect(catchBlock).toContain("kind: 'commit-failed'")
  })

  it('anchors on the first changed file, not a synthesized/guessed path — already known to be under the owning root', () => {
    expect(catchBlock).toContain('anchorPath = allPaths[0]')
  })

  it('captures the raw error object in payload — Gleaner\'s own ask, "the whole diagnosis"', () => {
    expect(catchBlock).toContain('rawError:')
    expect(catchBlock).toContain('changedPaths: allPaths')
  })

  it('is failure-soft — wrapped so a ledger-write failure can never break the commit error path itself', () => {
    expect(catchBlock).toMatch(/try \{[\s\S]*appendLedgerRecord[\s\S]*\} catch \{/)
  })
})

describe('drafts/errorLog.ts: LedgerRecord.source gains \'commit\'', () => {
  it('the union includes commit alongside the existing sources', () => {
    const src = readFileSync(resolve(__dirname, '../drafts/errorLog.ts'), 'utf8')
    const line = src.match(/source: '[^\n]*'/)![0]
    expect(line).toContain("'panel'")
    expect(line).toContain("'commit'")
  })
})
