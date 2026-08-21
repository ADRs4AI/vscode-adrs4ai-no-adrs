/**
 * Context: founder Report, HQ pneumatic ADR-0011 QST-WHOIS-2 — "The anchor
 * link is not clickable to ADR 15 in my answer, why?" His ANS text contains
 * a BARE reference: "(see also the discussion at adr:0015#qst-inbox-4,
 * suggesting...)" -- NOT markdown-link-wrapped ([text](adr:0015#...)).
 * Checking two things against real source: (1) does detectDeepLinks even
 * recognize bare (unwrapped) adr: refs, and (2) where is detectDeepLinks
 * actually wired -- the panel's own renderInline, or only the VS Code
 * text-editor DocumentLinkProvider (a different surface entirely)?
 */
import { detectDeepLinks } from '../../src/deeplink/linkDetection'

const bare = 'see also the discussion at adr:0015#qst-inbox-4, suggesting the possibility'
console.log('bare ref, detectDeepLinks:', JSON.stringify(detectDeepLinks(bare)))

const wrapped = 'see also [the discussion](adr:0015#qst-inbox-4), suggesting the possibility'
console.log('markdown-wrapped ref, detectDeepLinks:', JSON.stringify(detectDeepLinks(wrapped)))
