/**
 * tour-lint core — pre-share validation for docs/adr/tours/*.tour.json.
 * Pure, vscode-free (per the RepositoryContext portability boundary),
 * so it's directly testable without a filesystem-backed CompositeIndex —
 * see src/test/tourLint.test.ts. The CLI entrypoint (scripts/tour-lint.ts)
 * is a thin wrapper: argv/env parsing, CompositeIndex.fromWorkspace,
 * console output, exit code.
 *
 * Context (Facet 5, 2026-07-28 dispatch, docs/inbox/2026-07-28-0507-...):
 * Jérémie hit a broken cross-repo tour live — 5 of 7 broken refs were an
 * author picking a clean handle they'd never actually added the
 * `<!-- @adr-anchor: --> ` comment for. Doctrine 3 (ADR-0034) already
 * gives *walk-time* visibility (the broken-refs banner in the walk
 * dialog); this fills the *pre-share* gap — checkable before a tour is
 * handed to someone else.
 */

import type { RepositoryContext } from '../mcp/repositoryContext'
import { resolveTourEntries, type TourFile } from './tourIndex'

export interface TourLintEntryFinding {
  tourSlug: string
  tourPath: string
  namespace: string
  retired: boolean
  entryIndex: number
  ref: string
  /** 'error': the ref doesn't resolve at all. 'warning': it resolves, but not to a question. */
  severity: 'error' | 'warning'
  message: string
}

export interface TourLintResult {
  toursChecked: number
  findings: TourLintEntryFinding[]
}

/**
 * Lint every given tour's entries against the live substrate (doctrine 1:
 * facts read fresh, via the same shared resolver every other consumer —
 * tree, walk dialog, this — uses; never a parallel resolution
 * implementation). A ref that fails to resolve at all is an error; a ref
 * that resolves but to something other than a question (a whole ADR,
 * section, or seed) is a warning — plausibly intentional tour design, not
 * necessarily a mistake, so it doesn't fail the lint by itself.
 */
export function lintTours(
  tours: Array<{ tour: TourFile; namespace: string }>,
  ctx: RepositoryContext,
): TourLintResult {
  const findings: TourLintEntryFinding[] = []

  for (const { tour, namespace } of tours) {
    const resolved = resolveTourEntries(tour, ctx)
    resolved.forEach((entry, i) => {
      if (entry.resolution.kind === 'error') {
        findings.push({
          tourSlug: tour.slug,
          tourPath: tour.path,
          namespace,
          retired: tour.retired,
          entryIndex: i,
          ref: entry.ref,
          severity: 'error',
          message: `${entry.resolution.error}: ${entry.resolution.message}`,
        })
      } else if (entry.resolution.kind !== 'question') {
        findings.push({
          tourSlug: tour.slug,
          tourPath: tour.path,
          namespace,
          retired: tour.retired,
          entryIndex: i,
          ref: entry.ref,
          severity: 'warning',
          message: `resolves, but to a ${entry.resolution.kind}, not a question`,
        })
      }
    })
  }

  return { toursChecked: tours.length, findings }
}
