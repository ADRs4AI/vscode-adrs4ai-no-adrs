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
})
