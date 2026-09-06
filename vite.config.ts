import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/extension.ts'),
      formats: ['cjs'],
      fileName: () => 'extension.js',
    },
    rollupOptions: {
      // VS Code and Node built-ins must not be bundled
      external: [
        'vscode',
        'path',
        'fs',
        'os',
        'crypto',
        'child_process',
        'util',
        'events',
        'stream',
      ],
      output: {
        // Preserve the module structure for easier debugging
        preserveModules: false,
      },
    },
    outDir: 'dist',
    // Regression (2026-08-16): default emptyOutDir wiped dist/mcp-server.js on every
    // extension-only build (build:watch, vsce prepublish), silently killing the MCP
    // for every repo whose .mcp.json points at it (-32000 / MODULE_NOT_FOUND).
    // Both bundles share dist/; neither may empty it. See src/test/buildConfig.test.ts.
    emptyOutDir: false,
    sourcemap: true,
    minify: false, // Keep readable for debugging during development
    target: 'node18',
    ssr: true, // Enables Node.js mode (avoids browser shims)
  },
  test: {
    // Vitest configuration — only tests that don't require VS Code APIs
    include: ['src/test/**/*.test.ts'],
    exclude: ['src/test/**/*.vscode.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/parser/**', 'src/index/**'],
    },
    // Fixture 5 (2026-09-05, docs/inbox/2026-09-05-2236-gleaner-founding-
    // brief-menu-command-smoke-test-harness.md): a `vscode`-mocking test
    // seam, scoped to `test.alias` (NOT the top-level `resolve.alias` below)
    // so it can never leak into `vite build` — extension.ts's real 'vscode'
    // import must stay untouched and externalized there. Deliberately does
    // NOT use the `*.vscode.test.ts` naming the `exclude` glob above
    // reserves — that lane predates every seat on this crew and its
    // original intent (a heavier, real-VS-Code-instance suite?) is
    // undocumented; claiming it as a side effect of this mock would risk
    // squatting on someone else's future plan. See commandSmoke.test.ts.
    alias: {
      vscode: resolve(__dirname, 'src/test/helpers/vscodeMock.ts'),
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
