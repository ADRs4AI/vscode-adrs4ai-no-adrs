/**
 * The central registry that did not exist.
 *
 * `CompositeIndex` is REPLACED wholesale on a root-set/`.adrignore` refresh,
 * so anything holding one as a VALUE is holding a snapshot that silently dies.
 * `extension.ts`'s `onCompositeRefreshed` re-wires each subscriber BY HAND,
 * and that hand-maintained list is itself a thing that rots: three occurrences
 * of the same class, three different subscribers, every one found in the field
 * rather than by a test.
 *
 *   1. 2026-07-16 (Flint 5)  — the status bar froze after a root-set refresh.
 *   2. (same finding)        — the tree view froze; fixed by `setComposite`.
 *   3. 2026-10-11 (Concertmaster) — the PANEL held a dead index, so the newest
 *      tours walked as empty while the treeview rendered them correctly.
 *
 * After #3 I told Gleaner "if you ever see a view holding a composite, that's
 * a defect in waiting", and they swept `src/` and cleared the other three
 * sites — then correctly observed that a one-time sweep protects nothing,
 * because the real exposure is the NEXT subscriber someone adds. This file is
 * that protection: it fails when a new `CompositeIndex` holder appears without
 * joining one of the known-safe patterns, and when a holder that HAS a re-wire
 * method is never actually called from `onCompositeRefreshed`.
 *
 * A structural test is the right instrument here, unlike for the behavioral
 * half of the panel bug (see panelCompositeRefresh.test.ts): the question
 * "does an unregistered holder exist?" is a question about declaration sites,
 * which is exactly what source text can answer.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const SRC = resolve(__dirname, '..')

/** Any field or constructor-parameter property typed `CompositeIndex`. Module-level `let compositeIndex` is the OWNER, not a subscriber, so an access modifier is required. */
const HOLDER = /\b(?:private|public|protected|readonly)\s+(?:readonly\s+)?composite\s*[!?]?:\s*CompositeIndex/

/**
 * Holders that re-wire themselves, mapped to the call that MUST appear in
 * `onCompositeRefreshed`. Having the method is not enough — occurrence #3
 * would still have shipped if the panel had owned a `setComposite` nobody
 * called. Add a row here when you add a subscriber.
 */
const WIRED: Record<string, string> = {
  'views/adrTreeProvider.ts': 'treeProvider?.setComposite(compositeIndex)',
  'webview/openQuestionsPanel.ts': 'OpenQuestionsPanel.refreshComposite(compositeIndex)',
}

/**
 * Holders that are safe for a reason OTHER than being re-wired. Each needs a
 * reason good enough that a reader can check it, not just an assertion that
 * someone looked once.
 */
const EXEMPT: Record<string, string> = {
  // Not a holder at all, on inspection: `get composite() { return composite }`
  // over the closure variable the refresher reassigns. This is the AUTHORITATIVE
  // live source and the pattern the other sites should imitate — hold an
  // accessor, never a value. Its own doc comment says so ("read this, don't
  // cache the reference from setup time").
  'watchers/rootWatcherLifecycle.ts': 'live getter over the owning closure — the source of the replacements, not a subscriber',
  // Separate process with an independent lifecycle: the MCP server rebuilds
  // its own composite in `refreshCorpus()` per invocation and never observes
  // the extension host's refresh event. Not a passive subscriber of this
  // mechanism.
  'mcp/session.ts': 'self-refreshing via DocketSession.refreshCorpus(); independent per-invocation lifecycle',
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === 'test' ? [] : tsFiles(full)
    return name.endsWith('.ts') ? [full] : []
  })
}

const holders = tsFiles(SRC)
  .filter(f => HOLDER.test(readFileSync(f, 'utf8')))
  .map(f => relative(SRC, f).split('\\').join('/'))
  .sort()

describe('every CompositeIndex holder is either re-wired on refresh or documented as exempt', () => {
  it('the audit is complete — a NEW holder fails this test until it is classified', () => {
    // The guard Gleaner asked for: this is the assertion that protects the
    // next subscriber, not the four that exist today. If it fails, you added
    // a field holding a CompositeIndex. Either give the class a re-wire method
    // and a WIRED row (plus the call in onCompositeRefreshed), or expose a
    // getter over the live value, or add an EXEMPT row saying why it is safe.
    expect(holders).toEqual([...Object.keys(WIRED), ...Object.keys(EXEMPT)].sort())
  })

  it('every WIRED holder is actually CALLED from onCompositeRefreshed — owning the method is not enough', () => {
    const ext = readFileSync(join(SRC, 'extension.ts'), 'utf8')
    const fn = ext.match(/function onCompositeRefreshed\([\s\S]*?\n\}/)
    expect(fn, 'onCompositeRefreshed must exist — it is the registry').not.toBeNull()

    for (const [file, call] of Object.entries(WIRED)) {
      expect(fn![0], `${file} re-wires itself but onCompositeRefreshed never calls it`).toContain(call)
    }
  })

  it('the two subscribers that froze in the field are both still wired (occurrences 1-3 stay closed)', () => {
    const ext = readFileSync(join(SRC, 'extension.ts'), 'utf8')
    const fn = ext.match(/function onCompositeRefreshed\([\s\S]*?\n\}/)![0]
    // Flint 5's own finding, 2026-07-16: these two re-subscribe against the
    // NEW composite's node instances, because onChange binds at call time.
    expect(fn).toContain('compositeIndex.onChange(updateStatusBarText)')
    expect(fn).toContain('compositeIndex.onChange(updateBadge)')
  })

  it('the panel holds a swappable field, not a frozen one (occurrence 3)', () => {
    const panel = readFileSync(join(SRC, 'webview', 'openQuestionsPanel.ts'), 'utf8')
    expect(panel).not.toContain('private readonly composite: CompositeIndex')
    // Dispose-and-resubscribe, or the swap fixes the data and leaves the
    // panel deaf — the second half of the same bug.
    expect(panel).toContain('this.compositeSubscription?.()')
    expect(panel).toContain('this.compositeSubscription = composite.onChange(')
  })
})
