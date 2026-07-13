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

/** Scan raw markdown text for `[label](adr:...)` / `[label](seed:...)` links. */
export function detectDeepLinks(text: string): DetectedLink[] {
  const links: DetectedLink[] = []
  const re = new RegExp(LINK_HREF_RE)
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const scheme = match[1]
    const rest = match[2]
    const ref = `${scheme}:${rest}`
    const startOffset = match.index + 2 // past "]("
    links.push({ ref, startOffset, endOffset: startOffset + ref.length })
  }
  return links
}
