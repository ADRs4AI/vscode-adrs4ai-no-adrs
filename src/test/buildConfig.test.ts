import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Regression tests — the two vite bundles (extension.js, mcp-server.js) share
 * `dist/`. On 2026-08-16 an extension-only build (`vite build`, i.e. build:watch
 * or the vsce prepublish step) ran with vite's default `emptyOutDir: true` and
 * deleted dist/mcp-server.js — every repo whose .mcp.json pointed at it lost its
 * MCP server (MODULE_NOT_FOUND / -32000) until someone happened to run the full
 * `npm run build`. Both configs must opt out of emptying the shared outDir.
 */
describe('Regression tests', () => {
  const root = resolve(__dirname, '..', '..')
  for (const cfg of ['vite.config.ts', 'vite.mcp-server.config.ts']) {
    it(`${cfg} does not empty the shared dist/ (would delete the sibling bundle)`, () => {
      const src = readFileSync(resolve(root, cfg), 'utf8')
      expect(src).toMatch(/emptyOutDir:\s*false/)
    })
  }

  // Bug: `dist/mcp-server.js` is gitignored — a pure local build artifact
  // never automatically kept in sync with `src/` — and every repo's
  // .mcp.json in this ecosystem points at the same literal absolute path in
  // this one dev tree. A long-running MCP server process spawned from an
  // older build has no way to signal "I'm stale" to its own caller, which
  // made two already-fixed parser behaviors (2026-07-16) look like live
  // bugs when reported five weeks later (Gadfly 5, 2026-09-09/10,
  // docs/inbox/2026-09-10-0318-gadfly-to-relay-mcp-parser-two-findings-handled-qsts.md)
  // — verified against current source with a byte-exact reconstruction of
  // the real elenchus corpus file: neither bug reproduces. The version
  // string is the one self-diagnostic surface every caller already reads
  // (project_overview); it must carry build provenance, not just semver.
  it('vite.mcp-server.config.ts injects a build-time __BUILD_SHA__ (regression, Gadfly 5 ledger row)', () => {
    const src = readFileSync(resolve(root, 'vite.mcp-server.config.ts'), 'utf8')
    expect(src).toMatch(/__BUILD_SHA__/)
    expect(src).toMatch(/define:\s*\{/)
  })

  it('stdioServer.ts actually reports __BUILD_SHA__ in its version string, not just declares it', () => {
    const src = readFileSync(resolve(root, 'src/mcp/stdioServer.ts'), 'utf8')
    expect(src).toMatch(/declare const __BUILD_SHA__/)
    expect(src).toMatch(/\$\{__BUILD_SHA__\}/)
  })
})
