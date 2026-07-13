/**
 * Adapts an already-aggregated index (AdrIndex+SeedIndex singleton, or a
 * CompositeIndex — both structurally satisfy IndexSource) into ADR-0021's
 * RepositoryContext. This is the "thin adapter over the existing AdrIndex"
 * Lapidary's 2026-07-13 brief asked for: it contains no resolution logic of
 * its own — every consumer resolves references via `src/mcp/reference.ts`
 * against whatever RepositoryContext it's handed.
 *
 * Deliberately typed against the minimal `IndexSource` shape rather than a
 * concrete `AdrIndex`/`SeedIndex` pair: `CompositeIndex` already exposes
 * `allAdrs()`/`allSeeds()` (aggregated across roots, single-root today via
 * `CompositeIndex.wrapSingle()`, multi-root once that lands) — passing it
 * here directly means this adapter is already multi-root-ready without
 * calling into Fitter's own `CompositeIndex.resolve()` (a separate resolver
 * this thread is deliberately not entangling with — see the resolver-
 * unification conversation routed to Cairn).
 */

import * as fs from 'fs'
import * as path from 'path'
import type { AdrFile, SeedFile } from '../parser/types'
import type { RepositoryContext } from '../mcp/repositoryContext'

export interface IndexSource {
  allAdrs(): AdrFile[]
  allSeeds(): SeedFile[]
}

export function createRepositoryContextAdapter(source: IndexSource): RepositoryContext {
  return {
    listAdrs: () => source.allAdrs(),
    getAdr: (ref: string) => {
      const num = parseInt(ref.replace(/^adr:/, ''), 10)
      return isNaN(num) ? undefined : source.allAdrs().find((a) => a.number === num)
    },
    listSeeds: () => source.allSeeds(),
    getSeed: (ref: string) => {
      const slug = ref.replace(/^seed:/, '')
      return source.allSeeds().find((s) => path.basename(s.path, '.md') === `seed-${slug}`)
    },
    readFile: async (filePath: string) => fs.promises.readFile(filePath, 'utf-8'),
    writeFile: async (filePath: string, content: string) => fs.promises.writeFile(filePath, content, 'utf-8'),
    listFiles: async (dir: string) => fs.promises.readdir(dir),
  }
}
