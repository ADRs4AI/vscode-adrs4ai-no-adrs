/**
 * Real-VS-Code-instance spike (Fixture 5, ADR-00XX): runs inside an actual
 * Extension Development Host via @vscode/test-electron / @vscode/test-cli,
 * NOT the vitest mock. Proves a fidelity class the mock
 * (src/test/helpers/vscodeMock.ts) structurally cannot reach: real
 * extension-manifest resolution and real activation, driven by the real
 * `workspaceContains` activation event (glob: "any docs/adr/*.md file") against
 * the real fixture workspace this test opens.
 *
 * Verified empirically during this spike, not assumed: a corrupted
 * `package.json` `main` field (pointing at a file that doesn't exist) makes
 * this test fail with a real Node module-resolution error from inside the
 * real extension host — `npm test` (vitest) stays fully green throughout,
 * because it imports `../extension` directly from TypeScript source and
 * never reads `package.json`'s `main`/`engines`/`activationEvents` at all.
 * A DISPROVEN hypothesis from the same spike, for the record: `createTreeView`
 * with a view id that isn't declared in `contributes.views` does NOT throw
 * in VS Code 1.136.1 — it succeeds silently (the mismatch would only ever
 * surface if something later tries to actually render that view in the UI,
 * which is out of reach for an activate()-level test like this one).
 *
 * Deliberately minimal — this is a spike proving the tier is worth having,
 * not a full second test suite. Separate from `npm test` (see
 * package.json's `test:integration` script and `.vscode-test.mjs`) so it
 * never joins the fast default gate Directive Five requires before commits.
 */

import * as assert from 'assert'
import * as vscode from 'vscode'

suite('Real VS Code instance — manifest resolution and activation fidelity', () => {
  test('the extension resolves its real manifest and activates for real', async () => {
    const ext = vscode.extensions.getExtension('jlumbroso.adrs4ai')
    assert.ok(ext, 'extension jlumbroso.adrs4ai not found by the real host — publisher/name drifted from package.json')

    // A real host loads `main` as a real Node module and honors the real
    // `workspaceContains` activation event against the real workspace this
    // test opened (src/test-integration/fixture-workspace, which contains
    // docs/adr/0001-example.md). Getting past this line, in a REAL host,
    // is the actual proof — the vitest mock never touches any of it.
    await ext!.activate()
    assert.strictEqual(ext!.isActive, true, 'activate() did not leave the extension marked active')
  })
})
