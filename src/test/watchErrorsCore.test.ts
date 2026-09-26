/**
 * Regression tests for the errors.jsonl watcher's core (scripts/watch-errors-
 * core.mjs) — three real blind spots, found in ONE session (2026-09-26) by
 * the seat whose whole job is that watcher:
 *
 * 1. Depth: a ledger four levels down (moreover, under lumbroso-hq/subprojects/
 *    commons-hq/subprojects/) was invisible to the old hard-coded 2-level walk;
 *    four founder Reports (09-22, 09-26) reached no one.
 * 2. Restart: whatever existed at startup was a baseline "never alerted on", so
 *    after the 09-20 reboot killed the watcher, six days of Reports were
 *    silently baselined away the moment it was re-armed.
 * 3. A log first seen mid-run (the first Report ever filed in a newly-enabled
 *    repo — the seat's founding scar) was baselined, so that Report never woke
 *    anyone.
 * The script had no tests at all despite two earlier "BUG FOUND IN PRODUCTION"
 * comments; these run the real functions against real temp directories.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
// @ts-expect-error — plain .mjs script module, no type declarations
import { findLogs, decideNewLines, loadState, saveState } from '../../scripts/watch-errors-core.mjs'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-errors-core-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

function ledgerAt(rel: string, lines: string[] = ['{"ts":"2026-01-01T00:00:00.000Z","kind":"observation"}']) {
  const dir = path.join(tmp, rel, 'docs', 'adr', '.working')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'errors.jsonl'), lines.join('\n') + '\n')
}
const rec = (ts: string) => JSON.stringify({ ts, kind: 'observation', message: 'x' })

describe('findLogs — depth', () => {
  it('finds a ledger four levels below the root (the real moreover layout) with the default depth, which the old hard-coded 2 could not', () => {
    ledgerAt('subprojects/commons-hq/subprojects/moreover')
    expect(findLogs(tmp)).toHaveLength(1)
    expect(findLogs(tmp, 2)).toHaveLength(0) // the old behavior, kept as a parameter — and proven to have missed it
  })

  it('unions a root\'s own ledger with nested ones, and skips node_modules and dot-directories', () => {
    ledgerAt('')
    ledgerAt('a/b')
    ledgerAt('node_modules/pkg')
    ledgerAt('.hidden/x')
    expect(findLogs(tmp).map((p: string) => path.relative(tmp, p)).sort()).toEqual([
      path.join('a', 'b', 'docs', 'adr', '.working', 'errors.jsonl'),
      path.join('docs', 'adr', '.working', 'errors.jsonl'),
    ])
  })
})

describe('decideNewLines — what counts as new', () => {
  const started = Date.parse('2026-09-26T12:00:00.000Z')

  it('steady state: only lines past the remembered count are new', () => {
    const lines = [rec('2026-09-26T13:00:00.000Z'), rec('2026-09-26T13:05:00.000Z')]
    expect(decideNewLines({ lines, savedCount: 1, isStartup: false, startedAtMs: started })).toMatchObject({ alertLines: [lines[1]], nextSeen: 2, kind: 'steady' })
  })

  it('RESTART CATCH-UP: lines appended while the watcher was down are alerted, not baselined away (the 09-20 reboot gap)', () => {
    const lines = [rec('2026-09-13T22:06:00.000Z'), rec('2026-09-22T04:25:00.000Z'), rec('2026-09-26T17:27:00.000Z')]
    const r = decideNewLines({ lines, savedCount: 1, isStartup: true, startedAtMs: started })
    expect(r.kind).toBe('catch-up')
    expect(r.alertLines).toEqual([lines[1], lines[2]])
  })

  it('a first-ever startup (no saved state) still baselines everything — no wake storm on first run', () => {
    const lines = [rec('2026-09-01T00:00:00.000Z'), rec('2026-09-02T00:00:00.000Z')]
    expect(decideNewLines({ lines, savedCount: undefined, isStartup: true, startedAtMs: started })).toMatchObject({ alertLines: [], nextSeen: 2, kind: 'baseline' })
  })

  it('FIRST REPORT IN A NEW LEDGER: a log first seen mid-run alerts on records stamped after the watcher started (the founding scar)', () => {
    const lines = [rec('2026-09-26T13:30:00.000Z')]
    const r = decideNewLines({ lines, savedCount: undefined, isStartup: false, startedAtMs: started })
    expect(r.kind).toBe('discovered')
    expect(r.alertLines).toEqual(lines)
  })

  it('...but committed history that arrives with a `git pull` (older timestamps) is still baseline — a pull cannot cause a wake storm', () => {
    const lines = [rec('2026-08-01T00:00:00.000Z'), rec('2026-08-02T00:00:00.000Z'), rec('2026-09-26T13:30:00.000Z')]
    const r = decideNewLines({ lines, savedCount: undefined, isStartup: false, startedAtMs: started })
    expect(r.alertLines).toEqual([lines[2]])
    expect(r.nextSeen).toBe(3)
  })

  it('a truncated/rotated log (fewer lines than remembered) re-baselines and alerts nothing', () => {
    expect(decideNewLines({ lines: [rec('2026-09-26T13:00:00.000Z')], savedCount: 9, isStartup: true, startedAtMs: started })).toMatchObject({ alertLines: [], nextSeen: 1 })
  })

  it('an unparseable line in a mid-run-discovered log is never alerted (and never throws)', () => {
    expect(decideNewLines({ lines: ['not json'], savedCount: undefined, isStartup: false, startedAtMs: started }).alertLines).toEqual([])
  })
})

describe('state file — the cursor survives a restart', () => {
  it('round-trips per-log line counts', () => {
    const file = path.join(tmp, 'sub', 'state.json')
    saveState(file, new Map([['/a/errors.jsonl', 4], ['/b/errors.jsonl', 9]]))
    expect(loadState(file)).toEqual(new Map([['/a/errors.jsonl', 4], ['/b/errors.jsonl', 9]]))
  })

  it('a missing or corrupt state file degrades to empty (the old baseline-on-restart), never throws', () => {
    expect(loadState(path.join(tmp, 'nope.json')).size).toBe(0)
    const bad = path.join(tmp, 'bad.json')
    fs.writeFileSync(bad, '{ not json')
    expect(loadState(bad).size).toBe(0)
  })
})

// End to end, against the REAL script in a real child process and real temp
// directories: the pure functions above can be right while the wiring is wrong
// (this script has had two "BUG FOUND IN PRODUCTION" comments already).
describe('scripts/watch-errors.mjs — end to end: live alert, then restart catch-up', () => {
  const script = path.resolve(__dirname, '../../scripts/watch-errors.mjs')
  const liveRecord = (message: string) => JSON.stringify({ schema: 'error-record/2', ts: new Date().toISOString(), kind: 'observation', source: 'panel', message, anchorPath: '/x/y.md' }) + '\n'

  function start(root: string, state: string): { proc: ChildProcess; out: () => string; waitFor: (needle: string, ms?: number) => Promise<void> } {
    const proc = spawn(process.execPath, [script, '--poll-secs', '0.2', '--state', state, root], { stdio: ['ignore', 'pipe', 'pipe'] })
    let buf = ''
    proc.stdout!.on('data', (d) => { buf += d })
    proc.stderr!.on('data', (d) => { buf += d })
    const waitFor = (needle: string, ms = 6000) => new Promise<void>((resolve, reject) => {
      const t0 = Date.now()
      const tick = setInterval(() => {
        if (buf.includes(needle)) { clearInterval(tick); resolve() }
        else if (Date.now() - t0 > ms) { clearInterval(tick); reject(new Error(`timed out waiting for "${needle}"; output so far:\n${buf}`)) }
      }, 50)
    })
    return { proc, out: () => buf, waitFor }
  }
  const stop = (proc: ChildProcess) => new Promise<void>((resolve) => { proc.once('exit', () => resolve()); proc.kill() })

  it('a report filed while running is alerted (in a ledger 4 levels deep); one filed while the watcher was DOWN is announced as CATCH-UP on restart, not baselined away', async () => {
    ledgerAt('a/b/c/hive', [rec('2026-01-01T00:00:00.000Z')])
    const ledger = path.join(tmp, 'a/b/c/hive/docs/adr/.working/errors.jsonl')
    const state = path.join(tmp, 'state.json')

    const first = start(tmp, state)
    await first.waitFor('baseline set')
    fs.appendFileSync(ledger, liveRecord('live report'))
    await first.waitFor('live report')
    expect(first.out()).not.toContain('CATCH-UP')
    await stop(first.proc)

    fs.appendFileSync(ledger, liveRecord('filed while down'))

    const second = start(tmp, state)
    await second.waitFor('filed while down')
    expect(second.out()).toContain('CATCH-UP')
    expect(second.out()).not.toContain('live report') // already alerted in the first run; must not repeat
    await stop(second.proc)
  }, 20000)
})
