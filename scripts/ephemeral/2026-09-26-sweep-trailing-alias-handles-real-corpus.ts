/**
 * Context: ledger ruling 2026-09-26 (trailing "(QST-PETNAME)" alias) — the
 * ledger cites a wild census of 167 such headings across 4 repos (HQ meta-repo
 * 77, companion etude 68, caring-form 15, tablee 7). Sweeps every docs/adr
 * tree under ~/Programming with the NEW parser and reports, per repo: how many
 * trailing-petname headings, how many BOUND, how many REFUSED (collision), and
 * any bound alias whose `id` does not still end with its long-slug tail (which
 * would mean id derivation moved — clause 1 says it must not).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { parseAdr } from '../../src/parser/extractor'

const ROOT = '/Users/jlumbroso/Programming'
const TRAILING = /\(QST-[^)\s]+\)\s*$/i

function* walk(dir: string, depth = 0): Generator<string> {
  if (depth > 7) return
  let names: string[]
  try { names = readdirSync(dir) } catch { return }
  for (const n of names) {
    if (n === 'node_modules' || n === '.git' || n.startsWith('.venv')) continue
    const p = join(dir, n)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) yield* walk(p, depth + 1)
    else if (n.endsWith('.md') && p.includes(`${sep}docs${sep}adr${sep}`) && !p.includes(`${sep}archive${sep}`)) yield p
  }
}

const perRepo = new Map<string, { headings: number; bound: number; refused: number; idDrift: string[] }>()
const seen = new Set<string>()
for (const file of walk(ROOT)) {
  const repo = file.slice(ROOT.length + 1).split(sep).slice(0, 2).join('/')
  let content: string
  try { content = readFileSync(file, 'utf8') } catch { continue }
  if (!/^###\s+QST[^\n]*\(QST-/im.test(content)) continue
  const key = content.length + ':' + file.split(sep).slice(-1)[0]
  if (seen.has(key)) continue // submodule checkouts duplicate files; count each once
  seen.add(key)
  const adr = parseAdr(content, file)
  const rec = perRepo.get(repo) ?? { headings: 0, bound: 0, refused: 0, idDrift: [] }
  for (const q of adr.questions) {
    const heading = content.split('\n')[q.lineStart - 1] ?? ''
    if (!TRAILING.test(heading.trim())) continue
    rec.headings++
    if (q.aliasSlug) {
      rec.bound++
      // id must still be the long slug (contain the alias tail), not the short handle slug
      if (q.slug === q.aliasSlug) rec.idDrift.push(`${file}:${q.lineStart}`)
    } else rec.refused++
  }
  perRepo.set(repo, rec)
}
let total = 0, bound = 0, refused = 0
for (const [repo, r] of [...perRepo].sort()) {
  total += r.headings; bound += r.bound; refused += r.refused
  console.log(`${repo.padEnd(48)} headings=${String(r.headings).padStart(3)} bound=${String(r.bound).padStart(3)} not-bound=${String(r.refused).padStart(3)} idDrift=${r.idDrift.length}`)
}
console.log(`TOTAL headings=${total} bound=${bound} not-bound=${refused}`)
