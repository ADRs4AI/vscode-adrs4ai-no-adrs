/**
 * Structural tests for the untracked-referenced-files checklist's
 * extension.ts wiring (addition 2, 2026-07-30 founder-escalation
 * dispatch). vscode-touching glue with no live Extension Development Host
 * here — verified by source-shape assertions, same discipline as
 * tourDiagnosticsWiring.test.ts. The pure detection logic itself
 * (findReferencedUntrackedFiles) has its own behavioral tests in
 * untrackedReferences.test.ts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8')
const PKG = readFileSync(resolve(__dirname, '../../package.json'), 'utf8')

describe('extension.ts: untracked candidates are collected per dirty root', () => {
  it('untrackedCandidates excludes anything already inside the ADR-dir change set', () => {
    const loop = EXT_SRC.match(/const untrackedCandidates = allChanges[\s\S]*?\.map\(\(c: any\) => c\.uri\.fsPath as string\); \/\/ eslint-disable-line[^\n]*/)
    expect(loop).toBeTruthy()
    expect(loop![0]).toContain('isNewGitStatus(c.status)')
    expect(loop![0]).toContain('!c.uri.fsPath.startsWith(adrDirAbs)')
  })
})

describe('extension.ts: resolveUntrackedReferencesToStage', () => {
  const fn = EXT_SRC.match(/async function resolveUntrackedReferencesToStage\([\s\S]*?\n\}/)![0]

  it('auto-ignore short-circuits before reading any file content', () => {
    expect(fn).toContain("if (mode === 'auto-ignore') return [];")
  })

  it('auto-commit returns every referenced file with no prompt', () => {
    expect(fn).toContain("if (mode === 'auto-commit') return referenced;")
  })

  it('ask never prompts in the batch (non-interactive) path', () => {
    expect(fn).toMatch(/if \(!interactive\) return \[\]; \/\/ batch path/)
  })

  it('ask shows a pre-checked canPickMany QuickPick in the interactive path', () => {
    expect(fn).toContain("title: 'Additional references mentioned — commit these?'")
    expect(fn).toContain('canPickMany: true')
    expect(fn).toContain('picked: true')
  })

  it('reads settings resource-scoped to the dirty root, not the global window default', () => {
    expect(fn).toContain("vscode.Uri.file(dr.node.path)")
  })

  it('an unreadable/binary committed file is skipped, not fatal', () => {
    expect(fn).toMatch(/try \{ committedContents\.push\(fs\.readFileSync\(c\.uri\.fsPath, 'utf8'\)\); \} catch \{/)
  })
})

describe('extension.ts: commitOneRoot stages extra files and reflects them in the confirmation', () => {
  const fn = EXT_SRC.match(/async function commitOneRoot\([\s\S]*?\n\}/)![0]

  it('extra files are appended to what gets staged', () => {
    expect(fn).toContain('const extraFiles = await resolveUntrackedReferencesToStage(dr, interactive);')
    expect(fn).toContain('const allPaths = [...dr.changes.map((c: any) => c.uri.fsPath as string), ...extraFiles];')
    expect(fn).toContain('await dr.repo.add(allPaths);')
  })

  it('the confirmation summary counts allPaths, not just the primary ADR-dir changes', () => {
    expect(fn).toContain('summarizeCommittedArtifacts(allPaths)')
  })
})

describe('package.json: adrManager.commit.untrackedReferences', () => {
  it('declares ask/auto-commit/auto-ignore, default ask', () => {
    const match = PKG.match(/"adrManager\.commit\.untrackedReferences":\s*\{[\s\S]*?\n {8}\}/)
    expect(match).toBeTruthy()
    expect(match![0]).toContain('"ask"')
    expect(match![0]).toContain('"auto-commit"')
    expect(match![0]).toContain('"auto-ignore"')
    expect(match![0]).toContain('"default": "ask"')
  })
})
