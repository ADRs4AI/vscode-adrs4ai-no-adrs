/**
 * Context: follow-up to 2026-09-26-sweep-trailing-alias-handles-real-corpus.ts —
 * lists the real trailing-petname headings that did NOT bind (2 in the
 * companion etude) with the parser's own warning, to confirm they are honest
 * collisions/grammar refusals rather than a recognizer miss.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { parseAdr } from '../../src/parser/extractor'

const ROOT = '/Users/jlumbroso/Programming/system3/companion-thinking-stream-etude'
const TRAILING = /\(QST-[^)\s]+\)\s*$/i
function* walk(dir: string, depth = 0): Generator<string> {
  if (depth > 6) return
  let names: string[]
  try { names = readdirSync(dir) } catch { return }
  for (const n of names) {
    if (n === 'node_modules' || n === '.git') continue
    const p = join(dir, n)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) yield* walk(p, depth + 1)
    else if (n.endsWith('.md') && p.includes(`${sep}docs${sep}adr${sep}`)) yield p
  }
}
for (const file of walk(ROOT)) {
  const content = readFileSync(file, 'utf8')
  const adr = parseAdr(content, file)
  for (const q of adr.questions) {
    const heading = (content.split('\n')[q.lineStart - 1] ?? '').trim()
    if (!TRAILING.test(heading) || q.aliasSlug) continue
    console.log(`${file.slice(ROOT.length)}:${q.lineStart}\n  ${heading}`)
    for (const w of adr.parseWarnings.filter(w => w.line === q.lineStart && w.code === 'ALIAS_HANDLE_COLLISION')) console.log(`  → ${w.message.slice(0, 200)}`)
  }
}
