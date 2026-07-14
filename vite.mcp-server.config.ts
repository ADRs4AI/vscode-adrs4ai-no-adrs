import { defineConfig } from 'vite'
import { resolve } from 'path'

// Separate build target for the standalone stdio MCP server
// (src/mcp/stdioServer.ts). Deliberately NOT bundled with extension.js:
// this runs as its own Node process, spawned directly by an MCP client
// (Claude Code), with no VS Code extension host involved. Unlike
// extension.ts, node_modules dependencies (@modelcontextprotocol/sdk, zod)
// ARE bundled here (only Node built-ins stay external) so the resulting
// file is portable and runnable from any working directory without a
// node_modules alongside it.
export default defineConfig({
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
