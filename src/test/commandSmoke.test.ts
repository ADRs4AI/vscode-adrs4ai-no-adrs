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

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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
  queueWarningMessage,
  setConfigOverride,
  extensions,
  Uri,
  TreeItemCollapsibleState,
} from './helpers/vscodeMock'
import { relativeRootPath } from '../index/rootsConfigWriter'

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

  function readLastLedgerRecord(): { kind: string; message: string; payload: { commandId?: string } } {
    const ledgerPath = path.join(workspaceRoot, 'docs', 'adr', '.working', 'errors.jsonl')
    const lines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n')
    return JSON.parse(lines.at(-1)!)
  }

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

    // Fixture 5's catch, 2026-09-06 (docs/inbox/2026-09-06-0522-fixture-to-
    // gleaner-priority-a-command-smoke-deepening-plus-real-catches.md):
    // openAdr's real signature passes a plain STRING as args[0] (the file
    // path itself, not an AdrTreeItem) — anchorPathFromCommandArg used to
    // silently miss that shape entirely, fall through to a bare workspace-
    // root DIRECTORY, and errorLogPathFor's dirname() then stripped one
    // level too many — a real stray errors.jsonl landed one level ABOVE
    // Fixture's own temp workspace during testing, confirmed live, not
    // theoretical. Fixed in extension.ts's anchorPathFromCommandArg: a
    // string arg is used as-is. This proves the fix end to end — the
    // ledger lands INSIDE the workspace's own docs/adr/.working/, not a
    // sibling of it.
    it('openAdr surviving a throwing dependency logs INSIDE the workspace, not one level above it', async () => {
      resetInteractionState()
      const adrPath = fixtures().adr.resourceUri!.fsPath
      vi.mocked(mockWorkspace.openTextDocument).mockImplementationOnce(() => {
        throw new Error('simulated: openTextDocument failure')
      })
      const handler = getRegisteredCommand('adrManager.openAdr')!
      await expect(handler(adrPath)).rejects.toThrow('simulated: openTextDocument failure')

      const ledgerPath = path.join(workspaceRoot, 'docs', 'adr', '.working', 'errors.jsonl')
      expect(fs.existsSync(ledgerPath)).toBe(true) // not one level above workspaceRoot
      const lines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n')
      const record = JSON.parse(lines.at(-1)!)
      expect(record.kind).toBe('command-execution-failed')
      expect(record.payload.commandId).toBe('adrManager.openAdr')
      expect(record.anchorPath).toBe(adrPath) // the real file path, not a synthetic root placeholder

      // The stray-sibling-file regression, checked directly: nothing named
      // .working landed as a SIBLING of the workspace root.
      const strayPath = path.join(path.dirname(workspaceRoot), '.working', 'errors.jsonl')
      expect(fs.existsSync(strayPath)).toBe(false)
    })
  })

  // ---------------------------------------------------------------------
  // Priority-A pass (Fixture 5, 2026-09-06, Jérémie's stated order B, A, C
  // after the harness itself shipped): "doesn't throw" cannot distinguish
  // a command that did the right thing from one that silently no-op'd or
  // wrote the wrong value. These deepen exactly the commands where that
  // gap is highest-cost — file-writing commands, and one representative
  // config-toggle pair to prove the pattern generalizes — per Gleaner's
  // brief's own "grow on demand" discipline, not a blanket conversion of
  // all 28 shallow commands.
  // ---------------------------------------------------------------------

  describe('copyPath / copyRelativePath — clipboard gets the CORRECT value, not just any value', () => {
    it('copyPath writes the real absolute fsPath', async () => {
      resetInteractionState()
      const adr = fixtures().adr
      const handler = getRegisteredCommand('adrManager.copyPath')!
      await handler(adr)
      const { env } = await import('./helpers/vscodeMock')
      expect(vi.mocked(env.clipboard.writeText)).toHaveBeenCalledWith(adr.resourceUri!.fsPath)
    })

    it('copyRelativePath writes the workspace-relative path, not the absolute one', async () => {
      resetInteractionState()
      const adr = fixtures().adr
      const handler = getRegisteredCommand('adrManager.copyRelativePath')!
      await handler(adr)
      const { env } = await import('./helpers/vscodeMock')
      const written = vi.mocked(env.clipboard.writeText).mock.calls.at(-1)?.[0]
      expect(written).toBe(relativeRootPath(adr.resourceUri!.fsPath, workspaceRoot))
      expect(written).not.toBe(adr.resourceUri!.fsPath) // would indicate copyPath's arg leaked into copyRelativePath
    })
  })

  describe('createAdr — a real ADR file actually appears on disk, not just a resolved promise', () => {
    it('writes a new numbered ADR file into the adr directory, with the picked title in its heading', async () => {
      resetInteractionState()
      queueQuickPick({ value: 'adr' })
      queueInputBox('Fixture Priority A Decision')
      const adrDirPath = path.join(workspaceRoot, 'docs', 'adr')
      const before = new Set(fs.readdirSync(adrDirPath).filter(f => /^\d{4}-/.test(f)))
      const handler = getRegisteredCommand('adrManager.createAdr')!
      await handler(fixtures().root)
      const created = fs.readdirSync(adrDirPath).filter(f => /^\d{4}-/.test(f) && !before.has(f))
      expect(created.length, 'expected exactly one new numbered ADR file').toBe(1)
      const content = fs.readFileSync(path.join(adrDirPath, created[0]), 'utf8')
      expect(content).toContain('# Fixture Priority A Decision')
      expect(content).toContain('- **Status**: Draft')
    })

    it('a cancelled kind picker (Escape) writes no file at all', async () => {
      resetInteractionState() // no queued quickpick/inputbox — defaults to undefined, same as pressing Escape
      const adrDirPath = path.join(workspaceRoot, 'docs', 'adr')
      const before = new Set(fs.readdirSync(adrDirPath))
      const handler = getRegisteredCommand('adrManager.createAdr')!
      await handler(fixtures().root)
      const after = fs.readdirSync(adrDirPath)
      expect(after).toEqual(Array.from(before))
    })
  })

  describe('addSeedThreadTurn — the real seed file is extended, never clobbered (CONVENTIONS §4 hazard class)', () => {
    it('appends the new turn while preserving every byte of the seed\'s existing content', async () => {
      resetInteractionState()
      const seed = fixtures().seed
      const before = fs.readFileSync(seed.seed!.path, 'utf8')
      const handler = getRegisteredCommand('adrManager.addSeedThreadTurn')!
      await handler(seed)
      const after = fs.readFileSync(seed.seed!.path, 'utf8')

      expect(after.length).toBeGreaterThan(before.length)
      // Every line that existed before the write still exists after it, in
      // order — the "never clobber" assertion this command's own history
      // (Lapidary's founder-escalation dispatch, CONVENTIONS §4's DEBRIEF-001
      // hazard class) makes non-negotiable for a seed a human may be
      // mid-iteration on.
      const beforeLines = before.split('\n')
      const afterLines = after.split('\n')
      let cursor = 0
      for (const line of beforeLines) {
        cursor = afterLines.indexOf(line, cursor)
        expect(cursor, `original line dropped or reordered: ${JSON.stringify(line)}`).toBeGreaterThanOrEqual(0)
        cursor++
      }
      // And the new scaffold actually landed — not just "something changed".
      expect(after).toContain('**Model Response Request:**')
      expect(after).toContain('- [ ] Chunk this into ADRs')
    })
  })

  describe('excludeRoot — the roots.json exclusion actually persists to disk', () => {
    it('the modal "Exclude" choice writes the root\'s real relative path into the block list', async () => {
      resetInteractionState()
      queueWarningMessage('Exclude')
      const handler = getRegisteredCommand('adrManager.excludeRoot')!
      await handler(fixtures().root)

      const rootsJsonPath = path.join(workspaceRoot, 'docs', 'adr', '.settings', 'roots.json')
      expect(fs.existsSync(rootsJsonPath), 'roots.json was never written to disk').toBe(true)
      const relPath = relativeRootPath(rootNode().path, workspaceRoot)
      const config = JSON.parse(fs.readFileSync(rootsJsonPath, 'utf8'))
      expect(config.block).toContain(relPath)
    })

    it('declining the modal ("Cancel", Escape) writes nothing', async () => {
      resetInteractionState() // no queued warning-message response — defaults to undefined, same as dismissing the modal
      const rootsJsonPath = path.join(workspaceRoot, 'docs', 'adr', '.settings', 'roots.json')
      const existedBefore = fs.existsSync(rootsJsonPath)
      const beforeContent = existedBefore ? fs.readFileSync(rootsJsonPath, 'utf8') : undefined
      const handler = getRegisteredCommand('adrManager.excludeRoot')!
      await handler(fixtures().root)
      expect(fs.existsSync(rootsJsonPath)).toBe(existedBefore)
      if (existedBefore) expect(fs.readFileSync(rootsJsonPath, 'utf8')).toBe(beforeContent)
    })
  })

  describe('mintTourFromFilter — a real .tour.json file lands on disk with the filtered questions', () => {
    it('mints a tour containing the currently-visible (unanswered) question, under the given title', async () => {
      resetInteractionState()
      queueInputBox('Fixture Mint Test')
      const toursDir = path.join(workspaceRoot, 'docs', 'adr', 'tours')
      const before = new Set(fs.existsSync(toursDir) ? fs.readdirSync(toursDir) : [])
      const handler = getRegisteredCommand('adrManager.mintTourFromFilter')!
      await handler()
      const created = fs.readdirSync(toursDir).filter(f => !before.has(f))
      expect(created.length, 'expected exactly one new tour file').toBe(1)
      const tour = JSON.parse(fs.readFileSync(path.join(toursDir, created[0]), 'utf8'))
      expect(tour.title).toBe('Fixture Mint Test')
      expect(tour.entries.length).toBeGreaterThan(0)
    })
  })

  describe('hideCompletedTours / showCompletedTours — the config setting actually flips both ways', () => {
    it('hide sets tours.hideCompleted to true; show sets it back to false', async () => {
      resetInteractionState()
      const { workspace } = await import('./helpers/vscodeMock')
      const hide = getRegisteredCommand('adrManager.hideCompletedTours')!
      const show = getRegisteredCommand('adrManager.showCompletedTours')!

      await hide()
      expect(workspace.getConfiguration('adrManager').get('tours.hideCompleted', false)).toBe(true)

      await show()
      expect(workspace.getConfiguration('adrManager').get('tours.hideCompleted', false)).toBe(false)
    })
  })

  // ---------------------------------------------------------------------
  // The priority-A pass's own real catch (2026-09-06): auditing every
  // non-async handler in this file for the SAME bug class the 2026-09-05
  // commitAdrs fix claimed to have closed completely ("this was the one
  // gap") found four more instances — openAdr, createAdr, filterQuestions,
  // changeStatus, and goToAnswerInFile (sharing openAdrFile with openAdr).
  // Each is now `async`/`await`ed. These regression tests prove the
  // rejection actually PROPAGATES (before the fix, `await handler(...)`
  // resolved to `undefined` instantly — `.rejects` would have failed
  // outright, exactly like createAdr's original failure surfaced as a
  // deferred "Unhandled Rejection" instead of a same-tick assertion
  // failure). They deliberately do NOT also assert a ledger write, unlike
  // commitAdrs'/changeStatus's own contract tests: openAdr, createAdr (via
  // a root item), and filterQuestions (no item at all) all resolve their
  // `anchorPathFromCommandArg` through the `rootNode`/`compositeIndex`
  // fallback branches — which is a SEPARATE real bug, found and safely
  // documented (pure, no real disk write) in errorLog.test.ts's new
  // "CATCH" case, and routed to Gleaner rather than fixed here: those
  // branches hand `errorLogPathFor` a DIRECTORY, which it treats as a
  // file and strips one path segment too many, landing the ledger OUTSIDE
  // the workspace. Exercising that through a real command invocation in
  // THIS file would repeat the exact live escape it took manual cleanup
  // to undo during this pass — not a risk worth re-taking just to make
  // this describe block symmetrical with commitAdrs'.
  // ---------------------------------------------------------------------

  describe('the priority-A audit\'s four further fixes — the rejection now actually propagates', () => {
    // openAdr, createAdr (via a root item), and filterQuestions all still
    // resolve their anchor to `compositeIndex.root.path` (== workspaceRoot)
    // via the buggy fallback documented above — registerLoggedCommand's
    // catch block still runs `appendLedgerRecord` against that WRONG,
    // escaped location on every real run of these three tests, not just
    // hypothetically. Clean it up after each one so this file's own test
    // run doesn't leave the exact stray host-filesystem file (one level
    // above the temp workspace) that this finding is about — computed
    // precisely from the known anchor, never a blind/wildcard rm.
    afterEach(() => {
      const escapedWorkingDir = path.join(path.dirname(workspaceRoot), '.working')
      fs.rmSync(escapedWorkingDir, { recursive: true, force: true })
    })

    it('openAdr: a rejected openTextDocument now propagates instead of resolving silently', async () => {
      resetInteractionState()
      const { workspace } = await import('./helpers/vscodeMock')
      vi.mocked(workspace.openTextDocument).mockImplementationOnce(() => { throw new Error('simulated: openTextDocument failure') })
      const handler = getRegisteredCommand('adrManager.openAdr')!
      await expect(handler(realAdr().path, 1)).rejects.toThrow('simulated: openTextDocument failure')
    })

    it('goToAnswerInFile: shares openAdrFile with openAdr — same contract, AND a well-formed anchor reaches the ledger correctly', async () => {
      resetInteractionState()
      const { workspace } = await import('./helpers/vscodeMock')
      vi.mocked(workspace.openTextDocument).mockImplementationOnce(() => { throw new Error('simulated: openTextDocument failure') })
      const handler = getRegisteredCommand('adrManager.goToAnswerInFile')!
      await expect(handler(fixtures().question)).rejects.toThrow('simulated: openTextDocument failure')
      // Unlike openAdr's raw-string argument, a tree item carries `.question.adrPath` —
      // anchorPathFromCommandArg resolves a real FILE here, so this one's ledger
      // write lands correctly and is safe to assert on.
      const record = readLastLedgerRecord()
      expect(record.kind).toBe('command-execution-failed')
      expect(record.payload.commandId).toBe('adrManager.goToAnswerInFile')
    })

    it('createAdr: a rejected kind-picker QuickPick now propagates instead of resolving silently', async () => {
      resetInteractionState()
      const { window } = await import('./helpers/vscodeMock')
      vi.mocked(window.showQuickPick).mockImplementationOnce(() => { throw new Error('simulated: showQuickPick failure') })
      const handler = getRegisteredCommand('adrManager.createAdr')!
      await expect(handler(fixtures().root)).rejects.toThrow('simulated: showQuickPick failure')
    })

    it('filterQuestions: a rejected QuickPick now propagates instead of resolving silently', async () => {
      resetInteractionState()
      const { window } = await import('./helpers/vscodeMock')
      vi.mocked(window.showQuickPick).mockImplementationOnce(() => { throw new Error('simulated: showQuickPick failure') })
      const handler = getRegisteredCommand('adrManager.filterQuestions')!
      await expect(handler()).rejects.toThrow('simulated: showQuickPick failure')
    })

    it('changeStatus: a rejected QuickPick reaches errors.jsonl', async () => {
      resetInteractionState()
      const { window } = await import('./helpers/vscodeMock')
      vi.mocked(window.showQuickPick).mockImplementationOnce(() => { throw new Error('simulated: showQuickPick failure') })
      const handler = getRegisteredCommand('adrManager.changeStatus')!
      await expect(handler(fixtures().adr)).rejects.toThrow('simulated: showQuickPick failure')
      const record = readLastLedgerRecord()
      expect(record.kind).toBe('command-execution-failed')
      expect(record.payload.commandId).toBe('adrManager.changeStatus')
    })
  })
})
