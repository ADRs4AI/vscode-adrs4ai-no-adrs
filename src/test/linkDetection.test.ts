import { describe, it, expect } from 'vitest'
import { detectDeepLinks } from '../deeplink/linkDetection'

describe('detectDeepLinks', () => {
  it('finds an adr: link inside markdown link syntax and reports the href span', () => {
    const text = 'see [ADR-0001](adr:0001#qst-session-cookies-or-jwt) for context'
    const links = detectDeepLinks(text)
    expect(links).toHaveLength(1)
    expect(links[0].ref).toBe('adr:0001#qst-session-cookies-or-jwt')
    expect(text.slice(links[0].startOffset, links[0].endOffset)).toBe('adr:0001#qst-session-cookies-or-jwt')
  })

  it('finds a seed: link', () => {
    const text = '[the seed](seed:2026-07-05-async-question-queue#brain-dump)'
    const links = detectDeepLinks(text)
    expect(links).toHaveLength(1)
    expect(links[0].ref).toBe('seed:2026-07-05-async-question-queue#brain-dump')
  })

  it('finds multiple links in the same document, each with its own span', () => {
    const text = '[A](adr:0001) then [B](adr:0002#decision)'
    const links = detectDeepLinks(text)
    expect(links.map((l) => l.ref)).toEqual(['adr:0001', 'adr:0002#decision'])
  })

  it('ignores ordinary markdown links with unrelated schemes', () => {
    const text = '[GitHub](https://github.com/jlumbroso/vscode-adrs-for-ai) and [local file](./README.md)'
    expect(detectDeepLinks(text)).toEqual([])
  })

  it('returns an empty array for text with no links at all', () => {
    expect(detectDeepLinks('just some prose, no links here')).toEqual([])
  })
})
