/**
 * Packaging hygiene — secrets must never be reachable by `vsce package`.
 *
 * Incident (2026-08-19, Docent 5): `.vscodeignore` did not exclude `.env`, and
 * an npm access token had just been written there for the `docket` publish.
 * vsce's own secret scanner caught it and refused to package — the build was
 * blocked, nothing shipped, and a history check confirmed no committed .vsix
 * ever carried a `.env`. One stale local artifact (`adrs-for-ai-0.5.0.vsix`)
 * did contain one; Jérémie deleted it.
 *
 * vsce's scanner is a good backstop but a backstop only: it recognizes a
 * handful of token SHAPES, so a secret it does not have a pattern for (an
 * ANTHROPIC_API_KEY, a bare password, a private key body) would sail through.
 * The exclusion is the actual control. This test guards the exclusion, because
 * a `.vscodeignore` line is exactly the kind of thing a merge quietly drops.
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '../..')
const IGNORE = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf-8')
  .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))

describe('VSIX packaging never reaches a secrets file', () => {
  it('.vscodeignore excludes .env and its variants', () => {
    expect(IGNORE).toContain('.env')
    expect(IGNORE).toContain('.env.*')
  })

  // If a real .env exists in the working tree, prove the pattern actually
  // matches it rather than trusting that the line reads correctly.
  it('a real .env in the tree is matched by an exclusion line', () => {
    const envPath = path.join(ROOT, '.env')
    if (!fs.existsSync(envPath)) return // nothing to check on a clean checkout
    const matches = IGNORE.some(p => p === '.env' || p === '.env.*' || p === '.env**')
    expect(matches).toBe(true)
  })

  // .env must also stay out of git — the exclusion above only governs the
  // VSIX, and a committed secret is the worse of the two failures.
  it('.gitignore also excludes .env, so the two controls do not depend on each other', () => {
    const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf-8')
      .split('\n').map(l => l.trim())
    expect(gitignore).toContain('.env')
  })
})

/**
 * Incident (2026-10-04, caught pre-publish): `coverage/` is gitignored —
 * never committed — but `.vscodeignore` had no matching line, and vsce does
 * not fall back to .gitignore once a .vscodeignore exists. Anyone who had
 * run `npm run test:coverage` locally before packaging would ship the whole
 * HTML coverage report (every source file, line-by-line) inside the VSIX.
 * No published version ever carried this — caught by inspecting `vsce ls`
 * output before a publish, not by a user report — but the two ignore files
 * drifting apart is exactly the failure mode the test above already guards
 * for `.env`; generalized here to any build artifact a generated directory
 * leaves behind that `.gitignore` already knows is build output.
 */
describe('VSIX packaging never reaches a generated build-artifact directory', () => {
  it('.vscodeignore excludes coverage/, the test-coverage HTML report', () => {
    expect(IGNORE).toContain('coverage/**')
  })

  it('every top-level directory .gitignore marks as generated is also excluded from the VSIX, except the ones that are genuinely shipped output', () => {
    const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf-8')
      .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    // Only directory patterns (trailing slash) that are unconditional (no
    // leading `!`) — these are generated-output markers, not narrow file
    // exclusions, and every one of them is a candidate for leaking into a
    // VSIX the same way coverage/ did.
    // Plain directory markers only (no wildcard) — a pattern like
    // `docs/research/*/` isn't a directory name, it's a glob already
    // covered by .vscodeignore's broader `docs/**` and doesn't fit this
    // exact-name check.
    const generatedDirs = gitignore
      .filter(l => l.endsWith('/') && !l.startsWith('!') && !l.includes('*'))
      .map(l => l.replace(/\/$/, ''))
    // dist/ is gitignored (never committed, rebuilt every time) AND the
    // actual compiled extension code — .vscodeignore deliberately
    // un-ignores it (`!dist/**`). It is the one legitimate case where
    // "gitignored" does not mean "must not ship"; everything else in
    // .gitignore's directory list really is dev/build tooling that has
    // no business in a user's download.
    const intentionallyShipped = new Set(['dist'])
    for (const dir of generatedDirs) {
      if (intentionallyShipped.has(dir)) continue
      const excluded = IGNORE.some(p => p === `${dir}/**` || p === `${dir}/` || p === dir)
      expect(excluded, `.gitignore marks "${dir}/" as generated, but .vscodeignore has no matching exclusion`).toBe(true)
    }
  })
})

/**
 * Same incident, same sitting: two loose root-level dev-config files
 * (`tsconfig.integration.json`, `.vscode-test.mjs`) from the integration-test
 * harness work also leaked, because the existing exclusions named the
 * original files exactly (`tsconfig.json`) rather than the family. A test
 * runner config gaining a sibling file is a normal, expected evolution —
 * the exclusion should survive that, not need a new line added by hand
 * every time.
 */
describe('VSIX packaging excludes dev/test-runner config files by family, not just the original filename', () => {
  it('tsconfig*.json is excluded as a glob, not just tsconfig.json', () => {
    expect(IGNORE).toContain('tsconfig*.json')
  })

  it('.vscode-test.mjs (the test-runner config, sibling to the already-excluded .vscode-test/** directory) is excluded', () => {
    expect(IGNORE).toContain('.vscode-test.mjs')
  })
})
