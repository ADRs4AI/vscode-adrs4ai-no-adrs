/**
 * Pure text-mutation core for the ADR-0021 write tier. No `vscode` imports —
 * takes raw file content in, returns raw file content out. `handlers.ts`
 * wires these to `RepositoryContext.readFile`/`writeFile`; the actual disk
 * write and undo-history integration happen there, not here.
 *
 * The QST search-window algorithm below deliberately mirrors
 * `src/webview/openQuestionsPanel.ts`'s `writeAnswer` (ADR-0023, with
 * Quarry 5's write-adversary fix for stale-line misattribution) rather than
 * inventing a divergent one: re-resolve the question by id from a FRESH
 * parse of the content actually being written (never trust a caller-supplied
 * line number), scan a bounded window from the QST heading forward. Not
 * literally shared code yet — the panel's write path is vscode-coupled and
 * already shipped/tested; unifying them into one shared core is worth doing
 * later, but isn't this pass's call to make on someone else's file.
 */

// STATUS_LINE_RE is the extractor's own definition ("one parser, N
// consumers") — it tolerates the bold `- **Status**:` form the private
// `/^- Status:/` copy here couldn't see, which left Status un-flipped on
// bold-form files (the D2 write-back class) even when the answer wrote fine.
import { parseAdr, STATUS_LINE_RE } from '../parser/extractor'
import type { AdrIteration, AdrFile, Question } from '../parser/types'
import { findSectionForQuestion } from './reference'

export type WriteResult =
  | { ok: true; newContent: string; diff: string }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Write-fidelity check — ADR-0021 Iteration 8 doctrine, step 4: "parse
// fresh → anchor on extents → splice only → reparse and verify the delta."
// Launch-gating per Lapidary's 2026-07-18 ratification of DEBRIEF-006's
// escalation: "a doctrine that predicts an incident but isn't enforced is a
// prophecy, not a defense." DEBRIEF-006's mechanism — a scan cap silently
// splicing an answer into an unrelated question's recommendation — is
// exactly the shape this catches: the *intended* edit succeeded (the tool
// reported success), the corruption was elsewhere. A check that only asks
// "did my own edit look right" never sees it; this re-parses what the
// write actually produced and asks "did anything ELSE change."
// ---------------------------------------------------------------------------

function questionFingerprint(q: Question): string {
  return JSON.stringify({
    text: q.text,
    statusText: q.statusText,
    isAnswered: q.isAnswered,
    recommendation: q.recommendation ?? null,
    recommendations: (q.recommendations ?? []).map((r) => ({ author: r.author ?? null, text: r.text })),
    answer: q.answer ? { text: q.answer.text, author: q.answer.author ?? null } : null,
  })
}

/**
 * Reparses `newContent` and verifies every question NOT in `allowedToChange`
 * is byte-for-byte identical (text/status/recommendations/answer) to its
 * pre-write state. Returns the reparsed AdrFile on success so callers don't
 * pay for a third parse, or a collateral-diff error naming exactly which
 * question moved and how — never a bare "write rejected."
 */
export function verifyNoCollateralQuestionChanges(
  before: AdrFile,
  newContent: string,
  adrPath: string,
  allowedToChange: Set<string>,
): { ok: true; after: AdrFile } | { ok: false; error: string } {
  const after = parseAdr(newContent, adrPath)
  const beforeById = new Map(before.questions.map((q) => [q.id, q]))
  const afterById = new Map(after.questions.map((q) => [q.id, q]))

  for (const [id, beforeQ] of beforeById) {
    if (allowedToChange.has(id)) continue
    const afterQ = afterById.get(id)
    if (!afterQ) {
      return {
        ok: false,
        error: `error: write_fidelity_violation\nmessage: question "${id}" disappeared from ${adrPath} as a side effect of this write — rejected before touching disk.`,
      }
    }
    if (questionFingerprint(beforeQ) !== questionFingerprint(afterQ)) {
      return {
        ok: false,
        error: `error: write_fidelity_violation\nmessage: question "${id}" changed unexpectedly as a collateral side effect of this write (DEBRIEF-006 class) — rejected before touching disk. This operation should only have changed a different question.`,
      }
    }
  }
  return { ok: true, after }
}

const ANS_HEADER_RE = /^\*\*ANS:\*\*/
const FILL_PLACEHOLDER_RE = /^\[\s*fill\s+this\s+in[^\]]*\]$/i

/**
 * Same-day hazard fix (Lapidary's 2026-07-14 adjudication, Riddle 5's
 * escalation): the search window used to stop at the next line matching
 * `/^### QST:/` — a private regex that doesn't recognize every heading form
 * the extractor accepts (the ratified `### QST-<ID>:` handle form included).
 * If a question has no complete ANS scaffold of its own (a realistic case
 * for freshly-authored or freshly-ported ADRs) and the regex fails to
 * recognize the *next* question's heading as a boundary, the scan kept
 * going and could land on — and overwrite — the wrong question's ANS
 * block. "One parser, N consumers": the window is now the extractor's own
 * already-correct section extent for this question (`findSectionForQuestion`,
 * `src/mcp/reference.ts`), never a private regex re-derivation of where
 * that boundary is. `section.lineEnd` is 1-indexed inclusive; the scan
 * loops below are 0-indexed exclusive-of-end, so bounding at it directly
 * needs no off-by-one adjustment.
 */

/** Answer a question — replace semantics (a QST has exactly one current answer). */
export function applyAnswerQuestion(
  currentContent: string,
  adrPath: string,
  questionId: string,
  answerText: string,
  author: string,
): WriteResult {
  const freshAdr = parseAdr(currentContent, adrPath)
  const question = freshAdr.questions.find((q) => q.id === questionId)
  if (!question) {
    return { ok: false, error: `Could not locate question "${questionId}" in the current file content — it may have been edited or removed since last read.` }
  }

  const lines = currentContent.split('\n')
  const start = question.lineStart - 1
  const section = findSectionForQuestion(freshAdr, question)
  // section.lineEnd is 1-indexed inclusive; the loop below is 0-indexed
  // exclusive-of-end, so no off-by-one adjustment needed to bound at it.
  const end = section ? Math.min(section.lineEnd, lines.length) : Math.min(start + 40, lines.length)

  let statusLineIdx = -1
  let ansHeaderLineIdx = -1
  let fillLineIdx = -1

  for (let i = start; i < end; i++) {
    const trimmed = lines[i].trim()
    if (STATUS_LINE_RE.test(trimmed) && statusLineIdx === -1) statusLineIdx = i
    if (ANS_HEADER_RE.test(trimmed) && ansHeaderLineIdx === -1) ansHeaderLineIdx = i
    if (FILL_PLACEHOLDER_RE.test(trimmed) && ansHeaderLineIdx !== -1 && fillLineIdx === -1) fillLineIdx = i
  }

  if (ansHeaderLineIdx === -1) {
    return { ok: false, error: `Could not find a **ANS:** block near line ${question.lineStart} in ${adrPath} — this question may use a non-standard format.` }
  }

  const beforeSnippet = lines.slice(ansHeaderLineIdx, (fillLineIdx >= 0 ? fillLineIdx : ansHeaderLineIdx) + 1).join('\n')

  const newLines = [...lines]
  if (statusLineIdx >= 0) newLines[statusLineIdx] = '- Status: answered'
  if (fillLineIdx >= 0) {
    newLines[ansHeaderLineIdx] = `**ANS:** (by ${author})`
    newLines[fillLineIdx] = answerText
  } else {
    // The ANS block holds REAL content (a draft under Status-authority) —
    // REPLACE its whole extent, per the documented replace semantics ("a
    // QST has exactly one current answer"). The old insert-after-header
    // path prepended the new answer onto the existing one, and on the
    // same-line ANS form ("**ANS:** (by X) text…") the header rewrite
    // destroyed the old answer's first line (elenchus legacy, 2026-07-23 —
    // panel twin fixed in the same pass).
    let contentEnd = end
    while (contentEnd > ansHeaderLineIdx + 1 && (newLines[contentEnd - 1] ?? '').trim() === '') contentEnd--
    newLines.splice(ansHeaderLineIdx, contentEnd - ansHeaderLineIdx, `**ANS:** (by ${author})`, answerText)
  }

  const afterSnippet = [newLines[ansHeaderLineIdx], answerText].join('\n')
  const diff = `- ${beforeSnippet.replace(/\n/g, '\\n')}\n+ ${afterSnippet.replace(/\n/g, '\\n')}`

  const newContent = newLines.join('\n')
  const fidelity = verifyNoCollateralQuestionChanges(freshAdr, newContent, adrPath, new Set([questionId]))
  if (!fidelity.ok) return { ok: false, error: fidelity.error }

  return { ok: true, newContent, diff }
}

/** Add a recommendation — append semantics (recommendations stack; ANS stays singular). */
export function applyAddRecommendation(
  currentContent: string,
  adrPath: string,
  questionId: string,
  author: string,
  text: string,
  date: string,
): WriteResult {
  const freshAdr = parseAdr(currentContent, adrPath)
  const question = freshAdr.questions.find((q) => q.id === questionId)
  if (!question) {
    return { ok: false, error: `Could not locate question "${questionId}" in the current file content — it may have been edited or removed since last read.` }
  }

  const lines = currentContent.split('\n')
  const start = question.lineStart - 1
  const section = findSectionForQuestion(freshAdr, question)
  const end = section ? Math.min(section.lineEnd, lines.length) : Math.min(start + 60, lines.length)

  let ansHeaderLineIdx = -1
  for (let i = start; i < end; i++) {
    const trimmed = lines[i].trim()
    if (ANS_HEADER_RE.test(trimmed)) { ansHeaderLineIdx = i; break }
  }
  if (ansHeaderLineIdx === -1) {
    return { ok: false, error: `Could not find a **ANS:** block near line ${question.lineStart} in ${adrPath} to insert the recommendation before — this question may use a non-standard format.` }
  }

  const block = [`**Recommendation**: (by ${author}, ${date})`, '', text, '']
  const newLines = [...lines.slice(0, ansHeaderLineIdx), ...block, ...lines.slice(ansHeaderLineIdx)]
  const diff = `+ ${block.join('\\n')}`

  const newContent = newLines.join('\n')
  const fidelity = verifyNoCollateralQuestionChanges(freshAdr, newContent, adrPath, new Set([questionId]))
  if (!fidelity.ok) return { ok: false, error: fidelity.error }

  return { ok: true, newContent, diff }
}

/** Append an iteration entry — the number is computed server-side (MAX+1), never trusted from a caller. */
export function applyAppendIteration(
  currentContent: string,
  adrPath: string,
  entry: { human?: string; ai?: string; outcome?: string; date: string },
): WriteResult & { iterationNumber?: number } {
  const freshAdr = parseAdr(currentContent, adrPath)
  const iterationsSection = freshAdr.sections.find((s) => s.heading.trim().toLowerCase() === 'iterations')
  if (!iterationsSection) {
    return { ok: false, error: `Could not find a "## Iterations" section in ${adrPath}.` }
  }

  // Computed from the actual logged entries, not the header's `Iteration:`
  // field — that field has been observed out of sync with its own log
  // (ADR-0008, found 2026-07-07), so it is not a trustworthy source of truth.
  const nextNumber = Math.max(0, ...freshAdr.iterations.map((it: AdrIteration) => it.number)) + 1

  const lines = currentContent.split('\n')
  const bodyLines: string[] = [
    '',
    `### Iteration ${nextNumber} (${entry.date})`,
  ]
  if (entry.human) bodyLines.push(`- Human: ${entry.human}`)
  if (entry.ai) bodyLines.push(`- AI: ${entry.ai}`)
  if (entry.outcome) bodyLines.push(`- Outcome: ${entry.outcome}`)

  // `iterationsSection.lineEnd` includes the section's trailing `---`
  // separator and any blank lines before the next heading (confirmed by
  // direct inspection — the parser's body text for a trailing section runs
  // through that `---`). Inserting naively at `lineEnd` shoves that
  // separator into the middle of the iterations log instead of leaving it
  // as the terminator before the next section. Insert right after the last
  // real content line instead, skipping trailing blank/`---` lines.
  let insertAt = iterationsSection.lineEnd - 1 // 0-indexed, inclusive last body line
  while (insertAt > 0 && (lines[insertAt].trim() === '' || lines[insertAt].trim() === '---')) {
    insertAt--
  }
  insertAt += 1 // slice point: right after the last real content line

  const newLines = [...lines.slice(0, insertAt), ...bodyLines, ...lines.slice(insertAt)]
  const diff = `+ ${bodyLines.join('\\n')}`

  const newContent = newLines.join('\n')
  // No question should change at all from an iteration append.
  const fidelity = verifyNoCollateralQuestionChanges(freshAdr, newContent, adrPath, new Set())
  if (!fidelity.ok) return { ok: false, error: fidelity.error }

  return { ok: true, newContent, diff, iterationNumber: nextNumber }
}

export type ResolutionType = 'consensus' | 'fiat' | 'unresolved' | 'forked' | 'contested'
const VALID_RESOLUTIONS: ResolutionType[] = ['consensus', 'fiat', 'unresolved', 'forked', 'contested']

/** Update the ADR's Resolution header field — required Resolution Note for fiat/contested, per ADR-0009. */
export function applyUpdateResolution(
  currentContent: string,
  adrPath: string,
  resolution: string,
  note: string | undefined,
): WriteResult {
  if (!VALID_RESOLUTIONS.includes(resolution as ResolutionType)) {
    return { ok: false, error: `error: invalid_resolution\nmessage: "${resolution}" is not a recognized resolution type.\nvalid_values: ${VALID_RESOLUTIONS.join(', ')}` }
  }
  if ((resolution === 'fiat' || resolution === 'contested') && !note?.trim()) {
    return {
      ok: false,
      error:
        `error: missing_resolution_note\n` +
        `message: Resolution type '${resolution}' requires a Resolution Note explaining the constraint that made a ${resolution} decision necessary.\n` +
        `example: "Time pressure before demo; team agreed JWT was better but couldn't reach formal consensus on token storage."`,
    }
  }

  const lines = currentContent.split('\n')
  const headerEnd = lines.indexOf('---')
  if (headerEnd === -1) {
    return { ok: false, error: 'Could not find the header block (no "---" separator) to write the Resolution field into.' }
  }

  const statusIdx = lines.slice(0, headerEnd).findIndex((l) => /^- \*\*Status\*\*:/.test(l.trim()))
  const existingResolutionIdx = lines.slice(0, headerEnd).findIndex((l) => /^- \*\*Resolution\*\*:/.test(l.trim()))
  const existingNoteIdx = lines.slice(0, headerEnd).findIndex((l) => /^- \*\*Resolution Note\*\*:/.test(l.trim()))

  const newFieldLines = [`- **Resolution**: ${resolution}`]
  if (note?.trim()) newFieldLines.push(`- **Resolution Note**: ${note.trim()}`)

  let newLines: string[]
  if (existingResolutionIdx >= 0) {
    // Replace the existing Resolution line, and its Note line if one directly follows.
    const removeCount = existingNoteIdx === existingResolutionIdx + 1 ? 2 : 1
    newLines = [...lines.slice(0, existingResolutionIdx), ...newFieldLines, ...lines.slice(existingResolutionIdx + removeCount)]
  } else if (statusIdx >= 0) {
    newLines = [...lines.slice(0, statusIdx + 1), ...newFieldLines, ...lines.slice(statusIdx + 1)]
  } else {
    return { ok: false, error: 'Could not find a "- **Status**:" header line to anchor the Resolution field to.' }
  }

  const newContent = newLines.join('\n')
  // A header-field edit should never touch any question either.
  const beforeAdr = parseAdr(currentContent, adrPath)
  const fidelity = verifyNoCollateralQuestionChanges(beforeAdr, newContent, adrPath, new Set())
  if (!fidelity.ok) return { ok: false, error: fidelity.error }

  return { ok: true, newContent, diff: `+ ${newFieldLines.join('\\n')}` }
}
