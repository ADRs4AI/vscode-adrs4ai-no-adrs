/**
 * QuestionSource — ADR-0029 (Open-Questions Sidebar Badge), Decision QST-E.
 *
 * The badge's count is not a hardcoded ADR+seed sum — it's a computed
 * aggregate over an open set of question sources (today: ADRs, seeds; soon:
 * the async question queue, ADR-0027; potentially later, sources not yet
 * designed). Per the ratified Decision: "a QuestionSource-shaped
 * contribution seam... the badge, status bar, and tree header all read the
 * same aggregation function over the enabled sources — one computation,
 * three consumers." This module is that shared computation, pure and
 * vscode-free so it's directly testable.
 *
 * Pragmatic deviation from the Decision's exact wording, named honestly: the
 * Decision says "AdrIndex and SeedIndex both implement [QuestionSource]
 * today." They don't literally implement one common interface here —
 * AdrIndex.onChange's listener carries an IndexChangeEvent payload several
 * existing callers (diagnostics) depend on, while SeedIndex.onChange's is
 * bare; unifying those signatures is a real refactor with its own blast
 * radius, out of scope for tonight's camera-gating build. Instead, each
 * source is a small adapter closing over the real index's existing shape.
 * The functional requirement that actually matters — a third source is
 * addable without rewiring the badge/status-bar/tree-header call sites — is
 * fully met: it's one new entry in QUESTION_SOURCES.
 */

import type { RootNode } from './compositeIndex'

export interface QuestionSource {
  /** Stable settings-key fragment: adrManager.badge.include.<key> */
  readonly key: string
  /** Open-question count this source contributes for one root node. */
  openQuestionCount(node: RootNode): number
}

export const ADR_QUESTION_SOURCE: QuestionSource = {
  key: 'adr',
  openQuestionCount: node => node.adrs.openQuestionCount,
}

export const SEED_QUESTION_SOURCE: QuestionSource = {
  key: 'seed',
  openQuestionCount: node => node.seeds.allOpenQuestions().length,
}

/** Registered sources, in display/settings order. Add a new source here — no call site elsewhere changes. */
export const QUESTION_SOURCES: QuestionSource[] = [ADR_QUESTION_SOURCE, SEED_QUESTION_SOURCE]

/** Per-source-key on/off, e.g. `{ adr: true, seed: false }`. A missing key defaults to included. */
export type SourceInclusion = Record<string, boolean>

/** Sum of every enabled source's open-question count, for one root node. */
export function openQuestionCountForNode(node: RootNode, inclusion: SourceInclusion): number {
  return QUESTION_SOURCES
    .filter(source => inclusion[source.key] !== false)
    .reduce((sum, source) => sum + source.openQuestionCount(node), 0)
}

/** Sum across every node in a composite tree (badge/status-bar scope — the whole workspace). */
export function aggregateOpenQuestionCount(nodes: Iterable<RootNode>, inclusion: SourceInclusion): number {
  let total = 0
  for (const node of nodes) total += openQuestionCountForNode(node, inclusion)
  return total
}
