/**
 * Zombie-question migration — Jérémie's own germ-of-idea from his ADR-0031
 * Status-authority ANS, made runnable: "any question from a file not changed
 * before [cutoff] gets a `- Status: answered`" so the ratified authority
 * rule (v0.7.23) doesn't resurface long-settled questions as open.
 *
 * A zombie = a question with a DECLARED non-answered Status but a real ANS
 * answer, in a file whose last git commit predates the cutoff. The migration
 * flips only the Status line (span-splice, canonical form) — answers and
 * everything else stay byte-identical. Database-migration principle:
 * non-backward-compatible semantic changes ship with a palatability script.
 *
 * Usage:
 *   npx tsx scripts/ephemeral/2026-07-19-close-zombie-questions.ts <docs/adr-dir> <cutoff-YYYY-MM-DD> [--apply]
 * Without --apply: report only. Measured blast radius at authoring time:
 * 38/431 questions across 5 repos (mostly system3 ADRs 0012-0015, March era).
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseAdr } from '../../src/parser/extractor'
import { STATUS_LINE_RE } from '../../src/parser/extractor'

const [dir, cutoff, applyFlag] = process.argv.slice(2)
if (!dir || !cutoff) { console.error('usage: <docs/adr-dir> <cutoff-YYYY-MM-DD> [--apply]'); process.exit(1) }
const apply = applyFlag === '--apply'
const cutoffTs = new Date(cutoff + 'T00:00:00Z').getTime()

let zombies = 0
for (const f of readdirSync(dir).filter(f => f.endsWith('.md') && /^\d+[-_]/.test(f))) {
  const p = resolve(dir, f)
  let lastCommit = 0
  try { lastCommit = parseInt(execSync(`git log -1 --format=%ct -- "${p}"`, { cwd: dir }).toString().trim(), 10) * 1000 } catch { /* untracked */ }
  if (!lastCommit || lastCommit >= cutoffTs) continue

  const content = readFileSync(p, 'utf8')
  const adr = parseAdr(content, p)
  const lines = content.split('\n')
  let changed = false
  for (const q of adr.questions) {
    const declared = q.statusText?.trim() ?? ''
    if (/^answered\b/i.test(declared) || !q.answer) continue
    // Find the question's Status line within its extent and flip it.
    for (let i = q.lineStart - 1; i < Math.min(lines.length, q.answer.line); i++) {
      if (STATUS_LINE_RE.test(lines[i].trim())) {
        zombies++
        console.log(`${apply ? 'FLIP' : 'would flip'}: ${f} :: ${(q.qstId ?? q.text).slice(0, 50)} :: "${declared.slice(0, 40)}"`)
        if (apply) { lines[i] = '- Status: answered'; changed = true }
        break
      }
    }
  }
  if (changed) writeFileSync(p, lines.join('\n'))
}
console.log(`${zombies} zombie question(s) ${apply ? 'closed' : 'found (dry run — pass --apply to close)'}`)

// OUTCOME (append after use):
// - 2026-07-19: authored alongside v0.7.23 (Status-authority implementation).
//   Offered to Jérémie per-repo — HIS call where to run it; never run
//   unsolicited on another crew's tree (CONVENTIONS §4).
