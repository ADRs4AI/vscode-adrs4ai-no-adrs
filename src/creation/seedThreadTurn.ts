/**
 * "Add Thread Turn" — the minimum lovable slice of the seeds-as-issues
 * conversation UX (Lapidary's 2026-07-31 founder-escalation dispatch,
 * third ask on the same pain: "every time I iterate on seeds, it's
 * terrible... copying MRR checkbox blocks, reproducing the Instructions-
 * for-Model tail, getting heading levels right where one `##` vs `###`
 * silently breaks parsing — it broke the founder; it broke a model too").
 *
 * One gesture appends a correctly-scaffolded, attributed turn + fresh
 * `Model Response Request` block at the right location — the composer IS
 * the rails; nobody hand-authors this scaffolding again. Deliberately NOT
 * the full transcript-view chat UI from the 2026-07-12 seeds-as-issues
 * seed (transcript renderer, turn composer, @seat tagging) — that stays
 * ADR-0034-adjacent future work; this slice only kills the copy-paste
 * trauma.
 *
 * Vscode-import-free by design, same reasoning as seedTemplate.ts:
 * extension.ts imports 'vscode' at module load time, which makes it
 * untestable outside a real extension host — the insertion-point/text
 * computation lives here instead, directly testable.
 */

export interface SeedThreadTurnInsertion {
  /** 0-indexed line to insert the scaffold BEFORE (in the original, un-split content). */
  insertLineIndex: number
  /** The scaffold text itself — starts with a blank-line separator, ends with the closing "---". */
  text: string
  /** Line offset from `insertLineIndex`, within `text` once inserted, where the cursor should land — the blank content line right after the "### Author - Date" heading, so the human just starts typing. */
  cursorLineOffset: number
}

/**
 * Computes where and what to insert. Always appends a FRESH turn + MRR
 * block immediately before `## Derived Into` (or at the end of the file
 * if that heading is missing) — deliberately does not try to detect and
 * consume an existing `[Your Name] - [Date]` placeholder from the
 * template. That classification is exactly the kind of "getting heading
 * levels right" fragility this feature exists to remove; always producing
 * fresh, correct scaffolding at a well-defined location is strictly safer
 * than a heuristic that could misfire and corrupt real content. Any
 * leftover unfilled placeholder from the original template stays inert
 * and harmless.
 */
export function planSeedThreadTurnInsertion(content: string, authorName: string, date: string): SeedThreadTurnInsertion {
  const lines = content.split('\n')
  let insertLineIndex = lines.findIndex(l => /^##\s+Derived Into/i.test(l.trim()))
  if (insertLineIndex === -1) insertLineIndex = lines.length

  // Trim back over trailing blank lines so the new turn lands directly
  // after the last real content, not floating in accumulated whitespace —
  // same discipline as the missing-ANS insertion fallback (DEBRIEF-006).
  while (insertLineIndex > 0 && lines[insertLineIndex - 1].trim() === '') insertLineIndex--

  const scaffoldLines = [
    '',
    `### ${authorName} - ${date}`,
    '',
    '',
    '',
    '---',
    '',
    '**Model Response Request:**',
    '',
    '- [ ] Chunk this into ADRs',
    '- [ ] Iterate with me',
    '- [ ] Structure in place',
    '',
    '---',
    '',
  ]

  return {
    insertLineIndex,
    text: scaffoldLines.join('\n'),
    // Index 0: leading blank separator. Index 1: the heading. Index 2: the
    // blank content line right after it — where the cursor lands.
    cursorLineOffset: 2,
  }
}
