/**
 * Pure detection of ADR-0008-grammar deep links inside markdown link syntax
 * (`[text](adr:0001#qst-scope)`). No `vscode` import — the DocumentLinkProvider
 * that consumes this (src/views/documentLinkProvider.ts) is the thin,
 * vscode-coupled wrapper; this module is the testable part.
 */

const LINK_HREF_RE = /\]\((adr|seed):([^)\s]+)\)/g

export interface DetectedLink {
  /** The full reference string, e.g. "adr:0001#qst-scope" */
  ref: string
  /** 0-indexed character offset where the href starts (right after "](") */
  startOffset: number
  /** 0-indexed character offset where the href ends (before the closing ")") */
  endOffset: number
}

// Bare refs + canonical URIs (2026-08-26, founder demand via ADR-0008's 🔲
// pair): the panel's v0.7.91 autolink pattern, mirrored exactly — word-
// boundary guarded so mid-token text never matches. Canonical URIs match
// FIRST (adr:// would otherwise half-match as a bare adr: ref).
const CANONICAL_RE = /\badr:\/\/v\d+\/[a-zA-Z0-9._/-]+(?:\?[a-zA-Z0-9=&._-]*)?(?:#[a-z0-9][a-z0-9-]*)?/g
const BARE_REF_RE = /\b(?:adr|seed):[a-zA-Z0-9._/-]+(?:#[a-z0-9][a-z0-9-]*)?/g

/** Scan raw markdown text for deep links: wrapped `[label](adr:...)`, bare `adr:NNNN#slug`, and canonical `adr://v1/...` forms. */
export function detectDeepLinks(text: string): DetectedLink[] {
  const links: DetectedLink[] = []
  const claimed: Array<[number, number]> = []
  const overlaps = (a: number, b: number) => claimed.some(([s2, e2]) => a < e2 && b > s2)

  const re = new RegExp(LINK_HREF_RE)
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const scheme = match[1]
    const rest = match[2]
    const ref = `${scheme}:${rest}`
    const startOffset = match.index + 2 // past "]("
    links.push({ ref, startOffset, endOffset: startOffset + ref.length })
  }
  for (const [, e] of links.map((l, i) => [i, l] as const)) claimed.push([e.startOffset, e.endOffset])

  for (const rx of [CANONICAL_RE, BARE_REF_RE]) {
    const r = new RegExp(rx)
    let m2: RegExpExecArray | null
    while ((m2 = r.exec(text))) {
      const start = m2.index, end = m2.index + m2[0].length
      if (overlaps(start, end)) continue
      // skip pure-scheme noise like "adr:" mid-prose (no locator)
      if (/^(?:adr|seed):$/.test(m2[0])) continue
      links.push({ ref: m2[0], startOffset: start, endOffset: end })
      claimed.push([start, end])
    }
  }

  links.sort((a, b) => a.startOffset - b.startOffset)
  return links
}
