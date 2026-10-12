/**
 * 2026-10-12 — review probe for Fitter's v0.7.131 follow-up marker.
 *
 * CONTEXT: reviewing the `**Follows up on**: <ref>` marker I ruled in
 * ADR-0034 It-34. The new recognizer is /^\*\*Follows up on\*\*:\s*\S/ while
 * the ANS family it joins tolerates a bullet prefix (debulletAnsLine),
 * colon-inside-OR-outside bold, and parenthetical attributions. Checking
 * whether that gap is real before reporting it, because the consequence of a
 * NON-match is the exact bug just fixed: the marker gets swallowed into
 * q.answer.text and deleted on the next re-answer.
 */
import { isFollowUpMarkerLine, isAnsMarkerLine } from '../../src/parser/extractor'

const follow = [
  '**Follows up on**: adr:0064#qst-stream',
  '- **Follows up on**: adr:0064#qst-stream',
  '  **Follows up on**: adr:0064#qst-stream',
  '**Follows Up On**: adr:0064#qst-stream',
  '**Follows up on** : adr:0064#qst-stream',
]
console.log('follow-up marker:')
for (const c of follow) console.log(' ', String(isFollowUpMarkerLine(c)).padEnd(5), JSON.stringify(c))

console.log('ANS family, same variant shapes:')
for (const c of ['**ANS:** x', '- **ANS:** x', '**ANS** (by J): x']) {
  console.log(' ', String(isAnsMarkerLine(c)).padEnd(5), JSON.stringify(c))
}

/*
 * OUTCOME (2026-10-12): gap CONFIRMED, three variants.
 *   false  "- **Follows up on**: ..."   (bullet prefix — ANS tolerates it)
 *   false  "**Follows Up On**: ..."     (case)
 *   false  "**Follows up on** : ..."    (space before colon)
 *   true   "  **Follows up on**: ..."   (leading indent is fine)
 * ANS tolerated all three analogous shapes. Not a shipped bug — the affordance
 * always writes the canonical form — but a latent trap in the HAND-AUTHORED
 * path now being taught, where a non-match reproduces the exact defect just
 * fixed (swallowed into q.answer.text, deleted on re-answer). Reported to
 * Fitter with a recommendation to reuse the family's own tolerance
 * (debulletAnsLine + case-insensitive) rather than keep a fourth hand-rolled
 * recognizer; grammar-tier question flagged to Riddle, who owns extractor.ts.
 */
