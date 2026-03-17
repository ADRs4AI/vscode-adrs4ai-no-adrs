/**
 * Normalizer Types — ADR-0013
 *
 * ViolationHandler: the fundamental unit of the normalizer.
 * Each handler encapsulates detection AND correction for one deviation type.
 * Handlers are self-contained; the Coordinator is the only thing that knows
 * all handlers exist (Simon's near-decomposability principle).
 *
 * Terminology note: "ViolationHandler", never "transformer". The Transformer
 * architecture is an entity deserving reverence. We do not borrow that name.
 */

import type { AdrFile } from '../parser/types'

// ---------------------------------------------------------------------------
// Core data types
// ---------------------------------------------------------------------------

/**
 * A single detected violation — one occurrence of a format deviation.
 * Produced by ViolationHandler.detect(), consumed by ViolationHandler.fix().
 *
 * contentChecksum: SHA1 of the full file content at detection time.
 * Used to detect staleness: if the file changed between detect() and fix(),
 * line numbers may no longer be valid.
 */
export interface ViolationRecord {
  /** ID of the handler that produced this record */
  readonly handlerId: string
  /** Human-readable description for diagnostics */
  readonly description: string
  /** 1-indexed start line of the violation in the file */
  readonly lineStart: number
  /** 1-indexed end line of the violation (inclusive) */
  readonly lineEnd: number
  /** The exact text of the violating line(s) */
  readonly originalText: string
  /** SHA1 of the file content at detection time; check before applying fix */
  readonly contentChecksum: string
}

/**
 * A file edit to apply — replaces lines [lineStart, lineEnd] with replacement.
 * Patches must be applied in reverse line order (last line first) to keep
 * earlier line numbers valid.
 */
export interface Patch {
  /** 1-indexed start line to replace */
  readonly lineStart: number
  /** 1-indexed end line to replace (inclusive) */
  readonly lineEnd: number
  /** Replacement text (may contain newlines for multi-line replacements) */
  readonly replacement: string
}

// ---------------------------------------------------------------------------
// ViolationHandler interface
// ---------------------------------------------------------------------------

/**
 * A self-contained handler for one deviation type.
 *
 * Contract:
 * - detect() fills internal state; fix() requires a prior detect() call on
 *   the same content (check contentChecksum for staleness).
 * - process() is syntactic sugar: detect then fix all violations.
 * - dependsOn: handler IDs that must run before this one (for Coordinator
 *   topological ordering). When ordering cannot be computed deterministically,
 *   the LLM orchestrator resolves it.
 * - hints: optional metadata the LLM orchestrator may pass to extend
 *   heuristic detection with additional classified labels.
 */
export interface ViolationHandler {
  /** Stable identifier — used in ViolationRecord and dependsOn declarations */
  readonly id: string
  /** Handler IDs that must run (and fix) before this handler runs */
  readonly dependsOn?: readonly string[]
  /** One-line description of the deviation this handler addresses */
  readonly description: string

  /**
   * Scan content for violations. Returns one ViolationRecord per occurrence.
   * Fills internal state; must be called before fix().
   */
  detect(
    content: string,
    parseResult: AdrFile,
    hints?: Record<string, unknown>,
  ): ViolationRecord[]

  /**
   * Produce a Patch that fixes the given ViolationRecord.
   * Caller must verify record.contentChecksum matches the current content
   * before applying.
   */
  fix(content: string, record: ViolationRecord): Patch

  /**
   * Convenience: detect all violations and produce all patches.
   * Equivalent to: this.detect(...).map(r => this.fix(content, r))
   */
  process(content: string, parseResult: AdrFile): Patch[]
}
