/**
 * Menu-command smoke-test harness (Fixture 5's founding mission, docs/inbox/
 * 2026-09-05-2236-gleaner-founding-brief-menu-command-smoke-test-harness.md).
 *
 * Every prior test touching extension.ts was structural — it regex-matched
 * the file's own source text (see any `*Wiring.test.ts`) because there was
 * no `vscode` mock anywhere, so no test could actually CALL a registered
 * command handler. That gap is exactly what let copyDeepLink's SLUG_RE
 * crash ship and sit unlogged for three days (Jérémie's founder Report,
 * 2026-09-02/05): a structural test can confirm a string never appears near
 * a function; it cannot confirm the function survives being called with a
 * real mixed-case git remote (this repo's own GitHub org, "ADRs4AI").
 *
 * This file runs `activate()` for real, against a real temporary workspace
 * on disk (real ADR/seed markdown, a real `.git/config` with a mixed-case
 * remote), under a mocked `vscode` (src/test/helpers/vscodeMock.ts, wired
 * in via vite.config.ts's `test.alias` — vitest-only, never touches
 * `vite build`). It captures every handler `activate()` registers through
 * the mock's `commands.registerCommand`, then invokes each one with a
 * synthetic `AdrTreeItem` built from real parsed data via the REAL
 * `AdrTreeItem` constructor — not a hand-invented parallel shape.
 *
 * Coexists with, does not replace, the existing structural wiring tests —
 * those pin the SHAPE of the registration code; this pins that calling the
 * result doesn't throw.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { readFileSync } from 'fs'
import { resolve } from 'path'

import { activate } from '../extension'
import { AdrTreeItem } from '../views/adrTreeProvider'
import { CompositeIndex } from '../index/compositeIndex'
import type { TourFile } from '../index/tourIndex'
import {
  getRegisteredCommand,
  resetVscodeMock,
  resetInteractionState,
  mockWorkspace,
  queueInputBox,
  queueQuickPick,
  setConfigOverride,
  extensions,
  Uri,
  TreeItemCollapsibleState,
} from './helpers/vscodeMock'

const PACKAGE_JSON = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'))
const DECLARED_COMMANDS: string[] = PACKAGE_JSON.contributes.commands.map((c: { command: string }) => c.command)

/**
 * The ground-truth regression fixture: a real workspace whose real
 * `.git/config` origin remote is mixed-case, same shape as this repo's own
 * ("ADRs4AI/vscode-adrs4ai") — the exact input that crashed copyDeepLink in
 * production for three days before the same-day fix (commit 2208f31).
 * `gitRemoteSlugFor` (src/index/rootNode.ts) reads `.git/config` directly
 * off disk — no real `git` binary or network needed, just the file.
 */
function buildFixtureWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-cmd-smoke-'))
  fs.mkdirSync(path.join(root, 'docs', 'adr'), { recursive: true })
  fs.mkdirSync(path.join(root, '.git'), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.git', 'config'),
    '[remote "origin"]\n\turl = https://github.com/ADRs4AI/Some-Repo.git\n',
  )
  fs.writeFileSync(
    path.join(root, 'docs', 'adr', '0001-example-decision.md'),
    [
      '# ADR-0001: Example Decision',
      '',
      '- **Date**: 2026-01-01',
      '- **Iteration**: 1',
      '- **Status**: Draft',
      '- **Deciders**: Fixture 5, Test Human',
      '',
      '---',
      '',
      '## Questions',
      '',
      '### QST: Does this work?',
      '- Status: unanswered',
      '- Why asking: smoke-test fixture',
      '- Need: yes/no',
      '',
    ].join('\n'),
    'utf8',
  )
  fs.writeFileSync(
    path.join(root, 'docs', 'adr', 'seed-2026-01-01-example-seed.md'),
    [
      '# SEED: Example seed',
      '',
      '- **Date**: 2026-01-01',
      '- **From**: Test Human',
      '',
      '---',
      '',
      '## Brain Dump',
      '',
      'Fixture content for the smoke-test harness.',
      '',
    ].join('\n'),
    'utf8',
  )
  return root
}

function fakeExtensionContext(root: string) {
  return {
    subscriptions: [] as Array<{ dispose(): void }>,
    extension: { packageJSON: { version: '0.0.0-fixture-test' } },
    extensionUri: Uri.file(root),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('command registration completeness', () => {
  it('activate() registers a real handler for every command.command declared in package.json', async () => {
    resetVscodeMock()
    const root = buildFixtureWorkspace()
    try {
      await activate(fakeExtensionContext(root))
      const missing = DECLARED_COMMANDS.filter(id => !getRegisteredCommand(id))
      expect(missing, `declared in package.json but activate() never registered: ${missing.join(', ')}`).toEqual([])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('menu-command smoke test — real handlers, real fixture data, mixed-case git remote', () => {
  let workspaceRoot: string
  let composite: CompositeIndex

  beforeAll(async () => {
    resetVscodeMock()
    workspaceRoot = buildFixtureWorkspace()
    mockWorkspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot) }]
    await activate(fakeExtensionContext(workspaceRoot))
    // Independently re-parsed from the SAME real files — not extension.ts's
    // own private compositeIndex (which it never exports) — so these
    // fixtures carry real paths/data that the real handlers' own internal
    // compositeIndex.findRoot() resolves correctly, without any coupling to
    // extension.ts's internals.
    composite = await CompositeIndex.fromWorkspace(workspaceRoot, { adrDirRel: 'docs/adr' })
  })

  afterAll(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  })

  const rootNode = () => composite.root
  const realAdr = () => composite.root.adrs.allAdrs()[0]
  const realSeed = () => composite.root.seeds.allSeeds()[0]
  const realQuestion = () => realAdr().questions[0]

  function fixtures() {
    const fakeTour: TourFile = {
      path: path.join(workspaceRoot, 'docs', 'adr', 'tours', 'example.tour.json'),
      slug: 'example',
      schema: 'tour/1',
      title: 'Example tour',
      author: { name: 'Fixture 5' },
      minted_at: '2026-01-01T00:00:00.000Z',
      retired: false,
      entries: [],
    }
    return {
      root: new AdrTreeItem({ kind: 'root', rootNode: rootNode(), pathFragment: '', openCount: 0 }),
      adr: new AdrTreeItem({ kind: 'adr', adr: realAdr(), collapsibleState: TreeItemCollapsibleState.None }),
      seed: new AdrTreeItem({ kind: 'seed', seed: realSeed() }),
      question: new AdrTreeItem({ kind: 'question', question: realQuestion(), adr: realAdr() }),
      adrGroup: new AdrTreeItem({ kind: 'adr-group', count: 1, rootNode: rootNode() }),
      seedGroup: new AdrTreeItem({ kind: 'seed-group', count: 1, rootNode: rootNode() }),
      tourGroup: new AdrTreeItem({ kind: 'tour-group', count: 0, rootNode: rootNode() }),
      openQuestionsHeader: new AdrTreeItem({ kind: 'open-questions-header', count: 1, rootNode: rootNode() }),
      tour: new AdrTreeItem({ kind: 'tour', tour: fakeTour, done: false, rootNode: rootNode() }),
      tourEntry: new AdrTreeItem({
        kind: 'tour-entry',
        question: realQuestion(),
        tour: fakeTour,
        entry: { ref: `adr:0001#${realQuestion().slug}`, mustRespond: true, resolution: { kind: 'error', error: 'not_found', message: 'fixture — never resolved' } },
      }),
    }
  }

  it('every AdrTreeItem kind constructs without throwing, using real parsed data', () => {
    expect(() => fixtures()).not.toThrow()
  })

  // One representative, well-formed invocation per declared command — the
  // Set-equality check below fails loudly if a command is added/removed
  // here without updating this table, per the founding brief's ask that a
  // newly added, uncovered command should fail loudly rather than pass by
  // omission.
  function buildInvocationTable(f: ReturnType<typeof fixtures>): Record<string, unknown[]> {
    return {
      'adrManager.open': [],
      'adrManager.createAdr': [f.root],
      'adrManager.refresh': [],
      'adrManager.expandAll': [],
      'adrManager.expandRoot': [f.root],
      'adrManager.focusRoot': [f.root],
      'adrManager.showVersion': [],
      'adrManager.configureMcpServer': [],
      'adrManager.openAdr': [realAdr().path, 3],
      'adrManager.commitAdrs': [f.adr],
      'adrManager.copyDeepLink': [f.adr],
      'adrManager.copyPath': [f.adr],
      'adrManager.copyRelativePath': [f.adr],
      'adrManager.reportTreeItem': [f.adr],
      'adrManager.excludeRoot': [f.root],
      'adrManager.mintTourFromFilter': [],
      'adrManager.hideCompletedTours': [],
      'adrManager.showCompletedTours': [],
      'adrManager.hideSettledAdrs': [],
      'adrManager.showSettledAdrs': [],
      'adrManager.hideAdrsWithoutOpenQuestions': [],
      'adrManager.showAdrsWithoutOpenQuestions': [],
      'adrManager.hideClosedSeeds': [],
      'adrManager.showClosedSeeds': [],
      'adrManager.hideSeedsWithoutOpenQuestions': [],
      'adrManager.showSeedsWithoutOpenQuestions': [],
      'adrManager.hideWithoutOpenQuestions': [],
      'adrManager.showWithoutOpenQuestions': [],
      'adrManager.addSeedThreadTurn': [f.seed],
      'adrManager.openQuestionsPanel': [],
      'adrManager.filterQuestions': [],
      'adrManager.changeStatus': [f.adr],
      'adrManager.goToQuestionInPanel': [f.question],
      'adrManager.goToAnswerInFile': [f.question],
    }
  }

  it('the invocation table covers every declared command, exactly — no drift either direction', () => {
    const table = buildInvocationTable(fixtures())
    const tableIds = Object.keys(table).sort()
    const declared = [...DECLARED_COMMANDS].sort()
    expect(tableIds).toEqual(declared)
  })

  // `DECLARED_COMMANDS` is collection-time-safe (pure package.json data);
  // fixtures/table are built fresh INSIDE each test body instead of at
  // `it.each(...)` collection time, since they depend on `composite`, which
  // only exists after `beforeAll` has run.
  it.each(DECLARED_COMMANDS)('%s does not throw when invoked with a well-formed real fixture', async commandId => {
    resetInteractionState()
    const args = buildInvocationTable(fixtures())[commandId]
    const handler = getRegisteredCommand(commandId)
    expect(handler, `${commandId} was never registered`).toBeDefined()
    await expect(handler!(...args)).resolves.not.toThrow()
  })

  describe('copyDeepLink — the SLUG_RE ground-truth regression (mixed-case owner "ADRs4AI")', () => {
    it('an ADR item resolves to a repo-scoped canonical ref that PRESERVES the real case, not lowercased', async () => {
      resetInteractionState()
      const handler = getRegisteredCommand('adrManager.copyDeepLink')!
      await handler(fixtures().adr)
      const { env } = await import('./helpers/vscodeMock')
      const written = vi.mocked(env.clipboard.writeText).mock.calls.at(-1)?.[0]
      expect(written).toBeDefined()
      expect(written).toContain('ADRs4AI') // real case preserved — the pre-fix bug lowercased this
      expect(written).not.toContain('adrs4ai/') // would indicate the old lowercasing regression
    })

    it('a seed item and a question item also survive the same mixed-case root without throwing', async () => {
      resetInteractionState()
      const handler = getRegisteredCommand('adrManager.copyDeepLink')!
      const f = fixtures()
      await expect(handler(f.seed)).resolves.not.toThrow()
      await expect(handler(f.question)).resolves.not.toThrow()
    })
  })

  describe('reportTreeItem — the tree-wide report, with logging enabled', () => {
    it('writes a real observation record to the owning root\'s errors.jsonl', async () => {
      resetInteractionState()
      setConfigOverride('adrManager.logging.observations', true)
      queueInputBox('smoke-test observation')
      const handler = getRegisteredCommand('adrManager.reportTreeItem')!
      await handler(fixtures().adr)

      const ledgerPath = path.join(workspaceRoot, 'docs', 'adr', '.working', 'errors.jsonl')
      const lines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n')
      const record = JSON.parse(lines.at(-1)!)
      expect(record.kind).toBe('observation')
      expect(record.message).toBe('smoke-test observation')
      expect(record.source).toBe('treeview')
    })
  })

  describe('changeStatus — exercised end to end with a real status pick', () => {
    it('applies a WorkspaceEdit replacing the Status line when a new status is picked', async () => {
      resetInteractionState()
      queueQuickPick({ value: 'Accepted' })
      const handler = getRegisteredCommand('adrManager.changeStatus')!
      await expect(handler(fixtures().adr)).resolves.not.toThrow()
      // applyEdit is the mock's own vi.fn — confirms the write path actually ran, not just the read path.
      const { workspace } = await import('./helpers/vscodeMock')
      expect(vi.mocked(workspace.applyEdit)).toHaveBeenCalled()
    })
  })

  describe('registerLoggedCommand contract — a handler that throws still reaches errors.jsonl', () => {
    it('commitAdrs surviving a throwing dependency (simulated git-extension failure) still logs to the ledger before re-throwing', async () => {
      resetInteractionState()
      const adr = fixtures().adr
      vi.mocked(extensions.getExtension).mockImplementationOnce(() => {
        throw new Error('simulated: vscode.git extension API failure')
      })
      const handler = getRegisteredCommand('adrManager.commitAdrs')!
      await expect(handler(adr)).rejects.toThrow('simulated: vscode.git extension API failure')

      const ledgerPath = path.join(workspaceRoot, 'docs', 'adr', '.working', 'errors.jsonl')
      const lines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n')
      const record = JSON.parse(lines.at(-1)!)
      expect(record.kind).toBe('command-execution-failed')
      expect(record.payload.commandId).toBe('adrManager.commitAdrs')
      expect(record.message).toContain('simulated: vscode.git extension API failure')
    })
  })
})
