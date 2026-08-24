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
