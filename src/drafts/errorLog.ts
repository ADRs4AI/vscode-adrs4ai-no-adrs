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

import * as crypto from 'crypto'
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

/**
 * error-record/2 — the ledger generalized to MANY WRITERS (Jérémie's seed
 * 2026-07-29 "other opportunities to log errors... and therefore learn
 * faster" + Lapidary's QST-ERRLEDGER lean, reconciled with the shipped
 * ADR-0035 primitive rather than re-invented beside it). One ledger file,
 * one line-shape, N sources: 'panel' (v1 records remain valid history),
 * 'tour-resolver', 'census', 'write-fidelity', 'roots-config', 'mcp'.
 *
 * Capture policy (Lapidary's size guard, adopted): a record embeds the
 * full text of the documents the incident REFERENCES — never "all ADRs" —
 * each with an MD5 so harvest tooling can dedupe and verify against git.
 * The reconstruction guarantee is scoped, not unbounded.
 */
export interface LedgerRecord {
  schema: 'error-record/2'
  ts: string
  extensionVersion?: string
  /**
   * Which subsystem wrote this record. 'treeview' (2026-08-06): the
   * tree-wide "most excellent report" — the panel Report button's
   * mechanism extended to every sidebar item, per Gleaner's spec
   * (docs/inbox/2026-08-06-0408-...); also reused for other tree-context-
   * menu command failures (addSeedThreadTurn), rather than a third
   * generic tag. 'commit' (2026-08-13): the ADR Commit button's own
   * failure path — a real, reproducible git-policy pre-commit rejection
   * sat invisible to the ledger until a human manually pasted it into
   * conversation (Gleaner's brief, docs/inbox/2026-08-13-gleaner-to-
   * fitter-commit-failures-never-reach-error-record.md) — genuinely
   * distinct from a panel/roots-config/treeview event, so its own tag.
   */
  source: 'panel' | 'tour-resolver' | 'census' | 'write-fidelity' | 'roots-config' | 'mcp' | 'treeview' | 'commit'
  kind: string
  message: string
  /** Any file inside the owning root's docs/adr — decides which ledger this lands in. */
  anchorPath: string
  /** Kind-specific structured payload (e.g. the full tour JSON string + unresolved refs). */
  payload?: Record<string, unknown>
  /** Full text of each REFERENCED document at incident time, keyed by path. */
  documents?: Record<string, { text: string; md5: string }>
}

/**
 * Retry-storm dedupe signature (Riddle's adjudication of Gleaner's first
 * ledger sweep, 2026-07-31: lumbroso-hq logged 27 workspace-edit-rejected
 * records in ~8 seconds, one question, one specimen — a save-retry loop
 * re-logging on every retry cycle instead of once per actual failure).
 * kind+adrPath+questionId+message: a genuinely different failure (different
 * kind, different question, different message) always produces a different
 * signature and still logs. Pure so the dedupe logic itself gets a real
 * unit test, not just a source-shape assertion on vscode-touching glue.
 */
export function errorSignature(kind: string, adrPath: string, questionId: string | undefined, message: string): string {
  return [kind, adrPath, questionId ?? '', message].join('|')
}

/** Capture one referenced document: full text + MD5, best-effort. */
export function captureDocument(filePath: string): { text: string; md5: string } | undefined {
  try {
    const text = fs.readFileSync(filePath, 'utf8')
    const md5 = crypto.createHash('md5').update(text).digest('hex')
    return { text, md5 }
  } catch {
    return undefined
  }
}

/**
 * Append an error-record/2 line to the anchor's owning ledger. Failure-soft,
 * same contract as v1. Returns the ledger path, or undefined on any failure.
 */
export function appendLedgerRecord(record: LedgerRecord): string | undefined {
  try {
    const logPath = errorLogPathFor(record.anchorPath)
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8')
    return logPath
  } catch {
    return undefined
  }
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
