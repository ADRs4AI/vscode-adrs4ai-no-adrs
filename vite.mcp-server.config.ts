import { defineConfig } from 'vite'
import { resolve } from 'path'
import { execSync } from 'child_process'

// Separate build target for the standalone stdio MCP server
// (src/mcp/stdioServer.ts). Deliberately NOT bundled with extension.js:
// this runs as its own Node process, spawned directly by an MCP client
// (Claude Code), with no VS Code extension host involved. Unlike
// extension.ts, node_modules dependencies (@modelcontextprotocol/sdk, zod)
// ARE bundled here (only Node built-ins stay external) so the resulting
// file is portable and runnable from any working directory without a
// node_modules alongside it.

// Build-time SHA injection (2026-09-16, Gadfly 5's ledger row —
// docs/inbox/2026-09-10-0318-gadfly-to-relay-mcp-parser-two-findings-handled-qsts.md):
// both reported parser bugs failed to reproduce against current source, and
// root-caused instead to a deployment gap: `dist/mcp-server.js` is
// gitignored (a pure local build artifact, never kept in sync with `src/`
// automatically), and every repo's `.mcp.json` in this ecosystem points at
// the literal absolute path in THIS dev tree — a long-running MCP server
// process spawned from an older build has no way to tell its own caller
// "I'm stale." Previously flagged and deliberately parked (docket ADR-0001
// Phase-0 item (c), 2026-09-06) pending evidence a real report would supply;
// this is that evidence. `readServerVersion()` in stdioServer.ts now reports
// this alongside package.json's version, so "is my server actually current"
// becomes a one-line diagnostic (`project_overview`'s version: field)
// instead of a silent guess. `-dirty` suffix when the tree has uncommitted
// changes at build time, since the SHA alone would otherwise overstate
// precision.
function getBuildSha(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execSync('git status --porcelain', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0
    return dirty ? `${sha}-dirty` : sha
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(getBuildSha()),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/mcp/stdioServer.ts'),
      formats: ['cjs'],
      fileName: () => 'mcp-server.js',
    },
    rollupOptions: {
      external: ['path', 'fs', 'os', 'crypto', 'child_process', 'util', 'events', 'stream'],
      output: {
        preserveModules: false,
        entryFileNames: 'mcp-server.js',
      },
    },
    outDir: 'dist',
    emptyOutDir: false, // don't wipe extension.js from the other build
    sourcemap: true,
    minify: false,
    target: 'node18',
    ssr: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
