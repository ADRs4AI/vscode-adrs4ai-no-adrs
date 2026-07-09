/**
 * CompositeIndex — the recursive walker over a RootNode tree.
 *
 * ADR-0025: every consumer that needs to see "all ADRs" or "all seeds"
 * across a (possibly multi-root) project reads through this class rather
 * than special-casing depth. The N=1 case — `root.children = []` — is not
 * a special path; `allAdrs()`/`allSeeds()`/etc. all degrade to exactly what
 * a bare `AdrIndex`/`SeedIndex` would return, with zero conditionals.
 *
 * Per-file logic (parseAdr, parseSeed, normalizer handlers) stays oblivious
 * to root structure — this class is the only place that walks the tree.
 */

import * as path from 'path'
import { AdrIndex } from './adrIndex'
import { SeedIndex } from './seedIndex'
import { discoverRoots, type DiscoveredRoot, type RootDiscoveryOptions } from './rootNode'
import type { AdrFile, SeedFile } from '../parser/types'

export interface RootNode {
  path: string
  namespace: string
  adrs: AdrIndex
  seeds: SeedIndex
  children: RootNode[]
  parent?: RootNode
  isSubmodule: boolean
  /** False only for the synthetic top-of-tree node in a "forest" workspace — see rootNode.ts's discoverRoots doc. */
  hasAdrDir: boolean
}

export interface ResolveContext {
  /** Caller's location, for root-local resolution (ADR-0025 Decision 2). */
  currentRoot?: RootNode
}

export interface AmbiguousResolution {
  kind: 'ambiguous'
  ref: string
  candidates: Array<{ namespace: string; adrNumber: number }>
}

export function isAmbiguousResolution(value: unknown): value is AmbiguousResolution {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'ambiguous'
}

async function buildNode(discovered: DiscoveredRoot, parent: RootNode | undefined): Promise<RootNode> {
  const adrs = new AdrIndex(discovered.namespace)
  const seeds = new SeedIndex()
  if (discovered.hasAdrDir) {
    await adrs.indexDirectory(discovered.adrDirPath)
    await seeds.indexDirectory(discovered.adrDirPath)
  }
  const node: RootNode = {
    path: discovered.path,
    namespace: discovered.namespace,
    adrs,
    seeds,
    children: [],
    parent,
    isSubmodule: discovered.isSubmodule,
    hasAdrDir: discovered.hasAdrDir,
  }
  node.children = await Promise.all(discovered.children.map(child => buildNode(child, node)))
  return node
}

export class CompositeIndex {
  readonly root: RootNode

  private constructor(root: RootNode) {
    this.root = root
  }

  /** Scan `workspaceRoot` on disk and build a live composite index from what's found. */
  static async fromWorkspace(workspaceRoot: string, options: RootDiscoveryOptions): Promise<CompositeIndex> {
    const discovered = discoverRoots(workspaceRoot, options)
    return new CompositeIndex(await buildNode(discovered, undefined))
  }

  /**
   * Wrap an already-populated single AdrIndex/SeedIndex pair as a trivial
   * (N=1, no scan) composite — the seam existing single-root callers
   * (extension.ts, tests) can adopt without doing a filesystem discovery
   * pass of their own.
   */
  static wrapSingle(rootPath: string, adrs: AdrIndex, seeds: SeedIndex, namespace = 'project'): CompositeIndex {
    return new CompositeIndex({ path: rootPath, namespace, adrs, seeds, children: [], isSubmodule: false, hasAdrDir: true })
  }

  /** Depth-first walk of every node in the tree, including the root itself. */
  *walk(node: RootNode = this.root): IterableIterator<RootNode> {
    yield node
    for (const child of node.children) yield* this.walk(child)
  }

  allAdrs(): AdrFile[] {
    const out: AdrFile[] = []
    for (const node of this.walk()) out.push(...node.adrs.allAdrs())
    return out
  }

  allSeeds(): SeedFile[] {
    const out: SeedFile[] = []
    for (const node of this.walk()) out.push(...node.seeds.allSeeds())
    return out
  }

  /** The RootNode that owns `filePath` — the node whose `path` is the longest matching prefix. */
  findRoot(filePath: string): RootNode | null {
    let best: RootNode | null = null
    for (const node of this.walk()) {
      const isMatch = filePath === node.path || filePath.startsWith(node.path + path.sep)
      if (isMatch && (!best || node.path.length > best.path.length)) best = node
    }
    return best
  }

  namespaces(): string[] {
    return Array.from(this.walk(), node => node.namespace)
  }

  /**
   * ADR-0025 Decision 2: root-local first, error on ambiguity. Accepts a
   * bare number, "adr:NNNN", or a "@namespace/NNNN" qualified reference.
   * Returns null on no match, the AdrFile on an unambiguous match, or an
   * AmbiguousResolution describing the candidates when more than one root
   * has the same number and no `ctx.currentRoot` resolves it locally.
   */
  resolve(ref: string, ctx: ResolveContext = {}): AdrFile | AmbiguousResolution | null {
    const qualified = ref.match(/^@([^/]+)\/(\d+)$/)
    if (qualified) {
      const [, namespace, numStr] = qualified
      const num = parseInt(numStr, 10)
      for (const node of this.walk()) {
        if (node.namespace !== namespace) continue
        const found = node.adrs.getByNumber(num)
        if (found) return found
      }
      return null
    }

    const num = parseInt(ref.replace(/^adr:/, ''), 10)
    if (isNaN(num)) return null

    if (ctx.currentRoot) {
      const local = ctx.currentRoot.adrs.getByNumber(num)
      if (local) return local
    }

    const matches: Array<{ node: RootNode; adr: AdrFile }> = []
    for (const node of this.walk()) {
      const found = node.adrs.getByNumber(num)
      if (found) matches.push({ node, adr: found })
    }
    if (matches.length === 0) return null
    if (matches.length === 1) return matches[0].adr
    return {
      kind: 'ambiguous',
      ref,
      candidates: matches.map(m => ({ namespace: m.node.namespace, adrNumber: num })),
    }
  }
}
