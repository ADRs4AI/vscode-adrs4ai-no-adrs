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
import type { RepositoryContext, RootScope } from '../mcp/repositoryContext'

export interface IndexSource {
  allAdrs(): AdrFile[]
  allSeeds(): SeedFile[]
}

/** Walk up from a directory to the nearest entry containing `.git` (dir OR file — submodules use a gitdir pointer file). */
function findGitRoot(startDir: string): string | undefined {
  let dir = startDir
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** Read a git root's origin remote URL (first remote as fallback); handles submodule `.git` pointer files. */
function readRemoteUrl(gitRoot: string): string | undefined {
  try {
    const dotGit = path.join(gitRoot, '.git')
    let configPath: string
    if (fs.statSync(dotGit).isFile()) {
      const pointer = fs.readFileSync(dotGit, 'utf-8').match(/^gitdir:\s*(.+)\s*$/m)
      if (!pointer) return undefined
      configPath = path.join(path.isAbsolute(pointer[1]) ? pointer[1] : path.resolve(gitRoot, pointer[1]), 'config')
    } else {
      configPath = path.join(dotGit, 'config')
    }
    const config = fs.readFileSync(configPath, 'utf-8')
    return parseRemoteUrlFromConfig(config)
  } catch {
    return undefined
  }
}

/** Exported for tests: origin's url, else the first remote's url, from raw git-config text. */
export function parseRemoteUrlFromConfig(config: string): string | undefined {
  const sections = config.split(/^(?=\[)/m)
  let firstUrl: string | undefined
  for (const section of sections) {
    const header = section.match(/^\[remote "([^"]+)"\]/)
    if (!header) continue
    const url = section.match(/^\s*url\s*=\s*(.+)\s*$/m)?.[1]?.trim()
    if (!url) continue
    if (header[1] === 'origin') return url
    firstUrl ??= url
  }
  return firstUrl
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
      // Tolerant on the `seed-` filename prefix, in BOTH directions (fix,
      // 2026-08-16): this matched only `seed-${slug}`, while `seedRefString`
      // emitted the full basename — so every seed reference the MCP printed
      // back (`project_overview` rows, `lookup` headers) was a reference that
      // could not be resolved when a model handed it back. `seedRefString` now
      // emits the canonical prefix-less form; accepting both here means neither
      // side has to be upgraded in lockstep, and refs already written down in
      // the wild keep working.
      return source.allSeeds().find((s) => {
        const name = path.basename(s.path, '.md')
        return name === `seed-${slug}` || name === slug
      })
    },
    readFile: async (filePath: string) => fs.promises.readFile(filePath, 'utf-8'),
    writeFile: async (filePath: string, content: string) => fs.promises.writeFile(filePath, content, 'utf-8'),
    listFiles: async (dir: string) => fs.promises.readdir(dir),
    // Scope identities for canonical-ref filtering (2026-10-01 fix: scope
    // dropped at the delegation seam — the founder's live-hit specimen).
    // Derived per call, lazily, by grouping indexed files under their
    // nearest git root and reading each root's remote once: an
    // availability-class machine fact, read at runtime, never cached in
    // module state (the DocketSession lesson: no new singletons).
    listRootScopes: (): RootScope[] => {
      const dirToRoot = new Map<string, string | undefined>()
      const rootInfo = new Map<string, RootScope>()
      const visit = (filePath: string, namespace?: string) => {
        const dir = path.dirname(filePath)
        if (!dirToRoot.has(dir)) dirToRoot.set(dir, findGitRoot(dir))
        const root = dirToRoot.get(dir)
        if (!root) return
        const existing = rootInfo.get(root)
        if (existing) {
          existing.namespace ??= namespace
        } else {
          rootInfo.set(root, { rootPath: root, namespace, remote: readRemoteUrl(root) })
        }
      }
      for (const a of source.allAdrs()) visit(a.path, a.namespace)
      for (const s of source.allSeeds()) visit(s.path, (s as { namespace?: string }).namespace)
      return Array.from(rootInfo.values())
    },
  }
}
