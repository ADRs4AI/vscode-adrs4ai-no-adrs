/**
 * Regression test for the "New Seed" template drift Jérémie flagged
 * (2026-07-12): "I'm not sure the 'new seed' [command] in the extension is
 * the most up-to-date seed-template.md." He was right — see seedTemplate.ts's
 * header comment for what had drifted and why embedding (rather than
 * reading the template file at runtime) is deliberate.
 *
 * This test is the single source of truth's honesty check: it diffs the
 * embedded generator's output against the actual template file's content,
 * so a future edit to either one that isn't mirrored in the other fails
 * loudly here instead of silently reappearing as "the seed shelf looks
 * stale" months later.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { generateSeedTemplate } from '../creation/seedTemplate'

const TEMPLATE_PATH = resolve(__dirname, '../../docs/adr/templates/seed-template.md')

describe('generateSeedTemplate vs docs/adr/templates/seed-template.md', () => {
  it('produces exactly the template file\'s content when fed the template\'s own placeholder brackets', () => {
    // The template file uses bracketed placeholders ([Topic], [YYYY-MM-DD],
    // [Your name]) for the three fields generateSeedTemplate fills in at
    // creation time. Feeding those same literal brackets back in and
    // comparing is the actual "diff the embedded copy against the
    // template file" Lapidary's dispatch asked for — not a paraphrase of
    // it, an exact structural comparison.
    const generated = generateSeedTemplate('[Topic]', '[YYYY-MM-DD]', '[Your name]')
    const template = readFileSync(TEMPLATE_PATH, 'utf-8')

    // Trailing-newline convention differs (generated files end with \n per
    // usual text-file practice; the template file on disk doesn't) — that's
    // not the drift this test exists to catch, so normalize it away.
    expect(generated.trimEnd()).toBe(template.trimEnd())
  })

  it('substitutes the three dynamic fields correctly', () => {
    const generated = generateSeedTemplate('Auth strategy thoughts', '2026-07-12', 'Jérémie')
    expect(generated).toContain('# SEED: Auth strategy thoughts')
    expect(generated).toContain('- **Date**: 2026-07-12')
    expect(generated).toContain('- **From**: Jérémie')
  })
})
