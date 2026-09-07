import { defineConfig } from '@vscode/test-cli'
import { resolve } from 'path'

// Fixture 5 (2026-09-06, ADR-00XX): a real-VS-Code-instance test tier,
// deliberately separate from `npm test` (vitest). Compiled JS lives in
// out-integration/ (see tsconfig.integration.json + package.json's
// pretest:integration script) — Mocha, via @vscode/test-cli, cannot load
// TypeScript directly.
export default defineConfig({
  files: 'out-integration/**/*.test.js',
  workspaceFolder: resolve(import.meta.dirname, 'src/test-integration/fixture-workspace'),
  mocha: {
    timeout: 30000,
  },
})
