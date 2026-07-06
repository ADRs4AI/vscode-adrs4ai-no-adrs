/**
 * MCP tool handlers — ADR-0021's tool contract, implemented against
 * RepositoryContext only. Zero `vscode` imports (ADR-0003 Decision, "handler
 * purity" requirement) — mechanically enforced by src/test/mcpPurity.test.ts.
 *
 * This file is a skeleton (ADR-0021 sequencing step 2): only `project_overview`
 * (Tier 0) is fully implemented, to give the purity test real behavior to
 * exercise. Tier-1 reads (`lookup`, `get_outline`, `get_sections`,
 * `list_open_questions`) land in step 3 against the stdio transport.
 */

import type { RepositoryContext } from './repositoryContext'
import type { AdrFile } from '../parser/types'

export interface ProjectOverviewOptions {
  includeSeeds?: boolean
  tokenBudget?: number
}

function bracket(ref: string): string {
  return `[${ref}]`
}

function adrRef(adr: AdrFile): string {
  return `adr:${String(adr.number).padStart(4, '0')}`
}

function seedRef(seed: { path: string; title: string }): string {
  const filename = seed.path.split('/').pop() ?? seed.title
  const slug = filename.replace(/\.md$/, '')
  return `seed:${slug}`
}

/**
 * Tier 0 — project_overview (ADR-0021).
 *
 * Pre-linearized project map: one row per ADR, one row per seed. Summary
 * line first, `optimized`-format grammar (bracketed refs, `--- label ---`
 * blocks, explicit-over-absent, self-teaching Usage footer).
 */
export function projectOverview(ctx: RepositoryContext, options: ProjectOverviewOptions = {}): string {
  const includeSeeds = options.includeSeeds ?? true
  const adrs = [...ctx.listAdrs()].sort((a, b) => a.number - b.number)
  const seeds = includeSeeds ? ctx.listSeeds() : []

  const adrsWithOpenQuestions = adrs.filter((adr) => adr.questions.some((q) => !q.isAnswered))
  const openQuestionTotal = adrs.reduce(
    (sum, adr) => sum + adr.questions.filter((q) => !q.isAnswered).length,
    0,
  )

  const lines: string[] = []
  lines.push(
    `${adrs.length} ADRs, ${seeds.length} seeds — ${openQuestionTotal} open questions across ${adrsWithOpenQuestions.length} ADRs`,
  )

  lines.push('--- adrs ---')
  for (const adr of adrs) {
    const openCount = adr.questions.filter((q) => !q.isAnswered).length
    // `resolution` is not yet a parsed field on AdrFile — ADR-0009's Action
    // Item (owner: Hearth 4.6) adds it. Explicit-over-absent in the
    // meantime: always emit `[unset]`, never omit the field.
    lines.push(
      `${bracket(adrRef(adr))} ${adr.title} | ${adr.status} | resolution: [unset] | open: ${openCount} | iter: ${adr.iteration}`,
    )
  }

  if (includeSeeds) {
    lines.push('--- seeds ---')
    for (const seed of seeds) {
      lines.push(
        `${bracket(seedRef(seed))} ${seed.date ?? '[unknown date]'} | ${seed.isProcessed ? 'processed' : 'unprocessed'}`,
      )
    }
  }

  lines.push('Usage: call get_outline(adr_ref) for a section map of any ADR above.')
  return lines.join('\n')
}

// --- Tier 1 reads: signatures reserved, implementation lands in ADR-0021 sequencing step 3 ---

export function lookup(_ctx: RepositoryContext, _ref: string, _contextLines?: number): string {
  throw new Error('lookup: not implemented yet — ADR-0021 Tier 1, sequencing step 3')
}

export function getOutline(_ctx: RepositoryContext, _adrRef: string): string {
  throw new Error('getOutline: not implemented yet — ADR-0021 Tier 1, sequencing step 3')
}

export function getSections(_ctx: RepositoryContext, _refs: string[]): string {
  throw new Error('getSections: not implemented yet — ADR-0021 Tier 1, sequencing step 3')
}

export function listOpenQuestions(_ctx: RepositoryContext, _options?: Record<string, unknown>): string {
  throw new Error('listOpenQuestions: not implemented yet — ADR-0021 Tier 1, sequencing step 3')
}
