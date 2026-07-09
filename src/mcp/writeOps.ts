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

import { parseAdr } from '../parser/extractor'
import type { AdrIteration } from '../parser/types'

export type WriteResult =
  | { ok: true; newContent: string; diff: string }
  | { ok: false; error: string }

const ANS_HEADER_RE = /^\*\*ANS:\*\*/
const FILL_PLACEHOLDER_RE = /^\[\s*fill\s+this\s+in[^\]]*\]$/i
const STATUS_LINE_RE = /^- Status:/
const QST_HEADING_RE = /^### QST:/

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
  const end = Math.min(start + 40, lines.length)

  let statusLineIdx = -1
  let ansHeaderLineIdx = -1
  let fillLineIdx = -1

  for (let i = start; i < end; i++) {
    const trimmed = lines[i].trim()
    if (STATUS_LINE_RE.test(trimmed) && statusLineIdx === -1) statusLineIdx = i
    if (ANS_HEADER_RE.test(trimmed) && ansHeaderLineIdx === -1) ansHeaderLineIdx = i
    if (FILL_PLACEHOLDER_RE.test(trimmed) && ansHeaderLineIdx !== -1 && fillLineIdx === -1) fillLineIdx = i
    if (i > start && QST_HEADING_RE.test(trimmed)) break
  }

  if (ansHeaderLineIdx === -1) {
    return { ok: false, error: `Could not find a **ANS:** block near line ${question.lineStart} in ${adrPath} — this question may use a non-standard format.` }
  }

  const beforeSnippet = lines.slice(ansHeaderLineIdx, (fillLineIdx >= 0 ? fillLineIdx : ansHeaderLineIdx) + 1).join('\n')

  const newLines = [...lines]
  if (statusLineIdx >= 0) newLines[statusLineIdx] = '- Status: answered'
  newLines[ansHeaderLineIdx] = `**ANS:** (by ${author})`
  if (fillLineIdx >= 0) {
    newLines[fillLineIdx] = answerText
  } else {
    newLines.splice(ansHeaderLineIdx + 1, 0, answerText)
  }

  const afterSnippet = [newLines[ansHeaderLineIdx], answerText].join('\n')
  const diff = `- ${beforeSnippet.replace(/\n/g, '\\n')}\n+ ${afterSnippet.replace(/\n/g, '\\n')}`

  return { ok: true, newContent: newLines.join('\n'), diff }
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
  const end = Math.min(start + 60, lines.length)

  let ansHeaderLineIdx = -1
  for (let i = start; i < end; i++) {
    const trimmed = lines[i].trim()
    if (ANS_HEADER_RE.test(trimmed)) { ansHeaderLineIdx = i; break }
    if (i > start && QST_HEADING_RE.test(trimmed)) break
  }
  if (ansHeaderLineIdx === -1) {
    return { ok: false, error: `Could not find a **ANS:** block near line ${question.lineStart} in ${adrPath} to insert the recommendation before — this question may use a non-standard format.` }
  }

  const block = [`**Recommendation**: (by ${author}, ${date})`, '', text, '']
  const newLines = [...lines.slice(0, ansHeaderLineIdx), ...block, ...lines.slice(ansHeaderLineIdx)]
  const diff = `+ ${block.join('\\n')}`

  return { ok: true, newContent: newLines.join('\n'), diff }
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

  return { ok: true, newContent: newLines.join('\n'), diff, iterationNumber: nextNumber }
}

export type ResolutionType = 'consensus' | 'fiat' | 'unresolved' | 'forked' | 'contested'
const VALID_RESOLUTIONS: ResolutionType[] = ['consensus', 'fiat', 'unresolved', 'forked', 'contested']

/** Update the ADR's Resolution header field — required Resolution Note for fiat/contested, per ADR-0009. */
export function applyUpdateResolution(
  currentContent: string,
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

  return { ok: true, newContent: newLines.join('\n'), diff: `+ ${newFieldLines.join('\\n')}` }
}
