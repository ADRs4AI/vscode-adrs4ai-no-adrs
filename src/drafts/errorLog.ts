/**
 * Panel error harvesting — Jérémie's charter, 2026-07-25 (verbatim intent:
 * "every time there's an error in the open questions dialog, it's logged
 * in .working/errors.jsonl... capture the full text of the ADR, the full
 * text of the box, and all of the metadata — absolutely everything you
 * need to rebuild things... deliver me from having to harvest these
 * problems and prepare them for you").
 *
 * Every specimen this program ever fixed arrived because a human noticed,
 * screenshotted, backed up, and carried it here by hand. This module makes
 * the failure site do the harvesting: one JSONL line per error event,
 * appended to the OWNING ROOT's `docs/adr/.working/errors.jsonl` (per-root
 * by construction — multi-root correct, and `.working/` is right here:
 * these records embed full file text and draft text, bulky and private,
 * pull-collected by crew tooling rather than git-pushed).
 *
 * Disciplines inherited:
 * - JSONL, append-only, one record per line — streams clean (the wake-log
 *   shape). O_APPEND-style appends; no read-modify-write.
 * - Failure-soft: logging NEVER breaks the panel (a coordination surface
 *   must not be held hostage by its audit trail).
 * - Everything-to-rebuild: adrContent (file at error time), boxText (the
 *   human's typed text — the thing whose loss hurts most), the full
 *   triggering message, and the parsed-question snapshot.
 */

import * as fs from 'fs'
import * as path from 'path'

export interface PanelErrorRecord {
  schema: 'panel-error/1'
  ts: string
  extensionVersion?: string
  /** Stable machine kind: 'write-refusal' | 'question-relocation-failed' | 'drift-detected' | 'write-fidelity-violation' | 'unhandled-exception' | ... */
  kind: string
  /** The human-facing message that was (or would have been) shown. */
  message: string
  adrPath: string
  questionId?: string
  draftKey?: string
  /** Full text of the answer box at error time — the irreplaceable part. */
  boxText?: string
  /** Full ADR/seed file content at error time. */
  adrContent?: string
  /** The complete triggering webview message and any extra diagnostic state. */
  meta?: Record<string, unknown>
}

/** The owning root's error log path for a given ADR/seed file. */
export function errorLogPathFor(adrPath: string): string {
  return path.join(path.dirname(adrPath), '.working', 'errors.jsonl')
}

/**
 * Append one record. Returns the path written, or undefined on any failure
 * (failure-soft by contract — callers never branch on this).
 */
export function appendErrorRecord(record: PanelErrorRecord): string | undefined {
  try {
    const logPath = errorLogPathFor(record.adrPath)
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8')
    return logPath
  } catch {
    return undefined
  }
}

/**
 * Build a record with best-effort capture — the file read happens HERE so
 * every call site gets the everything-to-rebuild guarantee without
 * remembering to gather it.
 */
export function buildErrorRecord(
  kind: string,
  message: string,
  adrPath: string,
  extras: {
    extensionVersion?: string
    questionId?: string
    draftKey?: string
    boxText?: string
    meta?: Record<string, unknown>
  } = {},
): PanelErrorRecord {
  let adrContent: string | undefined
  try { adrContent = fs.readFileSync(adrPath, 'utf8') } catch { /* capture what we can */ }
  return {
    schema: 'panel-error/1',
    ts: new Date().toISOString(),
    extensionVersion: extras.extensionVersion,
    kind,
    message,
    adrPath,
    questionId: extras.questionId,
    draftKey: extras.draftKey,
    boxText: extras.boxText,
    adrContent,
    meta: extras.meta,
  }
}
