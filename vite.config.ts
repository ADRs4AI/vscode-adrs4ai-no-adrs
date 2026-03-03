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
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
