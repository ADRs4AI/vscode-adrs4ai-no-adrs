/**
 * Coordinator — ADR-0013
 *
 * Runs all registered ViolationHandlers in dependency order and applies
 * the resulting patches. The Coordinator is the only entity that knows
 * about all handlers — handlers themselves are weakly coupled to each other
 * (Simon's near-decomposability principle).
 *
 * Ordering: handlers are topologically sorted by their dependsOn declarations.
 * Handlers with no dependsOn run first; when ordering is ambiguous, the
 * registration order is used as a tie-breaker. For cases where ordering
 * cannot be determined statically, the LLM orchestrator (ADR-0013) may
 * invoke handlers manually in a custom sequence.
 */

import type { AdrFile } from '../parser/types'
import type { ViolationHandler, ViolationRecord, Patch } from './types'
import { applyPatches } from './patch-applicator'

export interface NormalizerResult {
  /** Normalized file content */
  result: string
  /** All violation records detected */
  records: ViolationRecord[]
  /** All patches applied (in the order they were computed, before reversal) */
  patches: Patch[]
}

export class Coordinator {
  constructor(private readonly handlers: ViolationHandler[]) {}

  /** Run all detectors and return violation records without modifying content. */
  detectAll(content: string, parseResult: AdrFile): ViolationRecord[] {
    const ordered = this.topologicalSort()
    return ordered.flatMap(h => h.detect(content, parseResult))
  }

  /**
   * Detect all violations, produce patches, and apply them in reverse order.
   * Returns the modified content plus a full audit trail.
   */
  processAll(content: string, parseResult: AdrFile): NormalizerResult {
    const ordered = this.topologicalSort()
    const records: ViolationRecord[] = []
    const patches: Patch[] = []

    for (const handler of ordered) {
      // Suggest-only handlers (bulkApply === false) are detected by
      // detectAll() for their diagnostics but NEVER applied in bulk — their
      // fix has a cost the author must choose (see ViolationHandler.bulkApply).
      if (handler.bulkApply === false) continue
      const recs = handler.detect(content, parseResult)
      for (const rec of recs) {
        const patch = handler.fix(content, rec)
        records.push(rec)
        patches.push(patch)
      }
    }

    const result = applyPatches(content, patches)
    return { result, records, patches }
  }

  /** Title for a suggest-only handler's per-record Quick Fix (states the cost, when there is one). */
  quickFixTitle(handlerId: string): string {
    return this.handlers.find(h => h.id === handlerId)?.quickFixTitle ?? 'Apply this suggested fix'
  }

  /** IDs of handlers whose fixes are suggest-only (never part of processAll). */
  suggestOnlyHandlerIds(): ReadonlySet<string> {
    return new Set(this.handlers.filter(h => h.bulkApply === false).map(h => h.id))
  }

  /**
   * The patch for ONE violation of ONE handler, found by its heading/line —
   * the per-record path a suggest-only fix is offered through. Undefined when
   * the handler is unknown or no longer detects a violation on that line (a
   * stale diagnostic must not apply a guess).
   */
  processOne(content: string, parseResult: AdrFile, handlerId: string, lineStart: number): Patch | undefined {
    const handler = this.handlers.find(h => h.id === handlerId)
    if (!handler) return undefined
    const record = handler.detect(content, parseResult).find(r => r.lineStart === lineStart)
    return record ? handler.fix(content, record) : undefined
  }

  /** Topological sort of handlers by dependsOn. */
  private topologicalSort(): ViolationHandler[] {
    const byId = new Map(this.handlers.map(h => [h.id, h]))
    const visited = new Set<string>()
    const result: ViolationHandler[] = []

    const visit = (h: ViolationHandler): void => {
      if (visited.has(h.id)) return
      for (const depId of h.dependsOn ?? []) {
        const dep = byId.get(depId)
        if (dep) visit(dep)
      }
      visited.add(h.id)
      result.push(h)
    }

    for (const h of this.handlers) visit(h)
    return result
  }
}
