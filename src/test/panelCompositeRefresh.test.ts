/**
 * Regression tests — the Open Questions panel must never hold a dead index.
 *
 * BUG (Concertmaster's specimen, 2026-10-11 étude inbox `0215`; third
 * occurrence of Flint 5's class, 2026-07-16). `CompositeIndex` is REPLACED
 * wholesale on a root-set/`.adrignore` refresh, and `onChange` is a one-time
 * subscription against the node instances live at call time — not a live
 * aggregate. `extension.ts`'s `onCompositeRefreshed` re-wires index/seedIndex,
 * diagnostics, the status bar, the badge and `treeProvider.setComposite(...)`.
 * The panel was never on that list: it captured its composite in a `readonly`
 * constructor field, and `createOrShow` DISCARDED the fresh one it was handed
 * whenever an instance already existed.
 *
 * Symptom the founder actually hit: the treeview rendered the three newest
 * tours with their questions, while clicking any of them showed the empty
 * state — the panel's frozen composite had no such tour, so `findTour`
 * returned undefined and `buildTourQuestions` returned `[]`. Before v0.7.124
 * that rendered as "All caught up", i.e. "your work is done." A window reload
 * "fixed" it only because it constructed a new panel.
 *
 * WHY THIS FILE IS BEHAVIORAL, against this directory's convention. Every
 * other panel-host test is structural (the "vscode-import wall") and pins that
 * a line of source exists. A structural test cannot catch this: the broken
 * code was *well-formed* — a `readonly` field and a deliberately-ignored
 * argument. Only calling the thing twice across an index swap shows it. That
 * wall is what Fixture 5's `helpers/vscodeMock.ts` exists to break, so this
 * runs the real panel against a real temp workspace under the mocked `vscode`
 * (aliased in `vite.config.ts`, vitest-only).
 *
 * The panel is a module-level singleton with a private `dispose`, so all three
 * cases share ONE panel created in `beforeAll` — each test drives it to the
 * state it needs rather than assuming a clean one.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { OpenQuestionsPanel } from '../webview/openQuestionsPanel'
import { CompositeIndex } from '../index/compositeIndex'
import { mockWorkspace, mockWindow, Uri } from './helpers/vscodeMock'

const SLUG = '2026-10-10-the-wave-a-gate'

const ADR = `# ADR-0001: Storage backend

- **Status**: Draft

## Questions

### QST: Which database?
- Status: unanswered
- Why asking: we need to pick before the migration, and it is hard to reverse.

**Recommendation**: (by Docent 5)
Postgres — we already run it elsewhere.
`

const TOUR = {
  schema: 'question-tour/1',
  title: 'The wave: a gate',
  author: { name: 'Concertmaster', role: 'ai' },
  minted_at: '2026-10-10T22:55:00.000Z',
  retired: false,
  // must_respond TRUE and unanswered — so this is NOT the vacuous-doneness
  // class (v0.7.122/123), and the ref resolves, so it is not the broken-ref
  // class either. The panel simply could not see the tour file.
  entries: [{ ref: 'adr:0001#qst-which-database', must_respond: true }],
}

type MockWebview = { postMessage: { mock: { calls: unknown[][] } } }

let dir: string
let staleIndex: CompositeIndex
let webview: MockWebview

/** Every `questions` message this panel has pushed, oldest first. */
function pushes(): Array<{ questions: unknown[]; tour: { emptyReason?: string } | null }> {
  return webview.postMessage.mock.calls
    .map(c => c[0] as { type: string; questions: unknown[]; tour: { emptyReason?: string } | null })
    .filter(m => m.type === 'questions')
}

function lastPush(): { questions: unknown[]; tour: { emptyReason?: string } | null } {
  const all = pushes()
  return all[all.length - 1]
}

const freshIndex = () => CompositeIndex.fromWorkspace(dir, { adrDirRel: 'docs/adr' })

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-composite-refresh-'))
  fs.mkdirSync(path.join(dir, 'docs', 'adr'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'docs', 'adr', '0001-storage.md'), ADR)
  mockWorkspace.workspaceFolders = [{ uri: Uri.file(dir) }]

  // The panel opens against an index built BEFORE the tour file exists —
  // the founder's actual sequence (panel already open, tour minted later).
  staleIndex = await freshIndex()
  expect(staleIndex.findTour(SLUG)).toBeUndefined()
  OpenQuestionsPanel.createOrShow(staleIndex)

  const created = mockWindow.createWebviewPanel.mock.results
  webview = (created[created.length - 1].value as { webview: MockWebview }).webview

  // Mint the tour on disk, after the panel is already holding `staleIndex`.
  const toursDir = path.join(dir, 'docs', 'adr', 'tours')
  fs.mkdirSync(toursDir, { recursive: true })
  fs.writeFileSync(path.join(toursDir, `${SLUG}.tour.json`), JSON.stringify(TOUR, null, 2))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('Regression tests: the panel adopts a REPLACED CompositeIndex (Concertmaster, 2026-10-11)', () => {
  // ORDER MATTERS, deliberately. The panel is a shared singleton, and the
  // decisive test below must run while it still holds `staleIndex` from
  // beforeAll — that is the only state in which the ORIGINAL bug is
  // observable. Each later test restores the state it needs explicitly.

  it('premise: a tour live on disk is invisible while the panel holds the stale index', async () => {
    // Not the regression test — the specimen. Passes before and after the
    // fix, and pins that the setup really does reproduce what the founder
    // saw: 0 rows, and the `tour-not-found` reason v0.7.124 renders where
    // "All caught up" used to lie.
    const live = await freshIndex()
    expect(live.findTour(SLUG)).toBeDefined()

    OpenQuestionsPanel.createOrShow(staleIndex, SLUG)

    expect(lastPush().questions).toHaveLength(0)
    expect(lastPush().tour?.emptyReason).toBe('tour-not-found')
  })

  it('THE REGRESSION: createOrShow on an already-open panel adopts the fresh index instead of discarding it', async () => {
    // This is the one that fails on the unfixed code, for the right reason:
    // the panel is still holding `staleIndex`, every caller hands
    // createOrShow the CURRENT composite, and the old code dropped that
    // argument on the floor whenever an instance existed — so the click
    // landed on a frozen index and rendered nothing. No new API is used
    // here; only the behaviour the founder's click actually went through.
    const live = await freshIndex()

    OpenQuestionsPanel.createOrShow(live, SLUG)

    expect(lastPush().questions).toHaveLength(1)
    expect(lastPush().tour?.emptyReason).toBeUndefined()
  })

  it('refreshComposite makes a stale panel walkable again — the call onCompositeRefreshed now makes', async () => {
    // The primary wiring: extension.ts re-wires every other subscriber on a
    // root-set refresh, and this is the panel finally joining that list.
    OpenQuestionsPanel.refreshComposite(staleIndex)
    expect(lastPush().questions).toHaveLength(0)

    OpenQuestionsPanel.refreshComposite(await freshIndex())

    expect(lastPush().questions).toHaveLength(1)
    expect(lastPush().tour?.emptyReason).toBeUndefined()
  })

  it('after a swap, a change on the NEW index still refreshes the panel (the dead-subscription half)', async () => {
    // Flint 5's actual finding: onChange binds to the node instances live at
    // call time. A panel that swapped its composite but kept the old
    // subscription would render correctly once and then freeze forever —
    // the same silent-staleness bug wearing a different hat.
    const live = await freshIndex()
    OpenQuestionsPanel.refreshComposite(live)

    const before = pushes().length
    live.root.adrs.indexContent(path.join(dir, 'docs', 'adr', '0001-storage.md'), ADR)

    expect(pushes().length).toBeGreaterThan(before)
  })
})
