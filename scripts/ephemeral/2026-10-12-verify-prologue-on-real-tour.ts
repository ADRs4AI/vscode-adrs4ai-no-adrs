/**
 * 2026-10-12 — first real-file verification of the tour prologue (v0.7.130).
 *
 * CONTEXT: the prologue shipped with unit + harness + end-to-end-on-fixture
 * coverage, but no REAL authored tour had one until Concertmaster put a
 * prologue on étude tour eight. The stakes are specific: the frozen
 * `parseTourFile` is in the Phase-1 moving set and I could not add the field
 * to it, so the panel reads the prologue out-of-band. If that frozen parser
 * REJECTED an unknown top-level key, the tour would not merely lose its card
 * — it would be INVISIBLE, which is the exact "tour could not be found" class
 * v0.7.124/125 closed. Verifying through the real parser and the real reader
 * before the founder clicks, not after.
 */
import * as fs from 'fs'
import { discoverTourFiles, parseTourFile } from '../../src/index/tourIndex'
import { readPrologue } from '../../src/index/tourPrologue'

const adrDir = '/Users/jlumbroso/Programming/system3/companion-thinking-stream-etude/docs/adr'
const SLUG = '2026-10-12-the-three-asks-brought-home'

const found = discoverTourFiles(adrDir).find(t => t.slug === SLUG)
console.log('discovered by the frozen index:', !!found)
if (!found) { console.error('FAIL — the tour is INVISIBLE to the index'); process.exit(1) }

// parseTourFile(filePath, content) takes TWO args. My first run passed one,
// so JSON.parse(undefined) threw and it returned null — and I nearly reported
// that as "the frozen parser rejects the prologue". The probe lied, not the
// code, and discoverTourFiles succeeding above was already the proof.
const parsed = parseTourFile(found.path, fs.readFileSync(found.path, 'utf-8'))
console.log('frozen parseTourFile accepted it:', !!parsed)
console.log('  title :', parsed?.title)
console.log('  stops :', parsed?.entries.length)

const prologue = readPrologue(found.path)
console.log('readPrologue found a card:', !!prologue)
console.log('  rationale chars:', prologue?.rationale.length ?? 0)
console.log('  context present:', !!prologue?.context)
console.log(prologue && found && parsed ? '\nPASS — visible, parsed, and the card reads.' : '\nFAIL')

/*
 * OUTCOME (2026-10-12): PASS on étude tour eight
 * ("2026-10-12-the-three-asks-brought-home", Concertmaster-authored).
 *   discovered by the frozen index : true   <- NOT invisible; the feared class
 *   frozen parseTourFile accepted  : true   <- unknown top-level key tolerated
 *   readPrologue found a card      : true   (531-char rationale + context)
 *
 * So the out-of-band read is safe: the frozen parser ignores `prologue`
 * gracefully rather than rejecting the file, which was the one way this
 * feature could have made a tour INVISIBLE instead of merely cardless.
 * Confirms Concertmaster's `just tour-walk` datum independently.
 *
 * Also recorded: my FIRST run reported "frozen parseTourFile accepted it:
 * false" because I called parseTourFile with one argument instead of two.
 * I checked the signature before reporting a parser bug — the memory
 * `probe-scope-absence-as-fact`, written an hour earlier, paying for itself.
 */
