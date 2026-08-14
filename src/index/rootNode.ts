/**
 * Root discovery — ADR-0025 (Multi-Root Recursive Project Roots)
 *
 * Scans a workspace for directories that contain an ADR directory
 * (default `docs/adr/`) and assembles them into a `DiscoveredRoot` tree.
 * A directory is a root atom iff it has an ADR directory; intermediate
 * directories (e.g. `subprojects/`) are transparent — they're walked
 * through, never wrapped in a node of their own. This is what makes the
 * N=1 case (a single project, no subroots) and the N>1 case (HQ containing
 * this repo as a submodule, itself containing further subroots) the exact
 * same data shape at every depth.
 *
 * This module is pure discovery: it returns a plain tree describing what
 * was found on disk. `compositeIndex.ts` turns that tree into live
 * `AdrIndex`/`SeedIndex` instances.
 */

import * as fs from 'fs'
import * as path from 'path'

export interface RootDiscoveryOptions {
  /** Relative path to the ADR directory within each candidate root, e.g. "docs/adr". */
  adrDirRel: string
  /** Directory names to always skip during the scan, beyond the built-in defaults. */
  skipDirNames?: string[]
  /**
   * Recursion guard against pathological trees (not the "unlimited depth"
   * data-model property from ADR-0025 Decision 4, which is a UI paging
   * concern handled by the tree-view consumer, not the scanner). This is
   * purely a safety bound on how far the filesystem walk will descend.
   */
  maxScanDepth?: number
}

export interface DiscoveredRoot {
  /** Absolute path to the root directory (the directory containing the ADR dir, not the ADR dir itself). */
  path: string
  /** Absolute path to this root's own ADR directory. */
  adrDirPath: string
  /** Whether adrDirPath actually exists — false only for the synthetic top-of-tree node in a "forest" workspace (see discoverRoots). */
  hasAdrDir: boolean
  namespace: string
  /** Discovered sub-roots, recursive. Empty for leaves and for the trivial single-project case. */
  children: DiscoveredRoot[]
  /** True when `path/.git` is a file (gitlink) rather than a directory — a git submodule. Metadata only, not a structural discriminator. */
  isSubmodule: boolean
  /**
   * `owner/repo` parsed from the `origin` remote, submodule-aware (Gleaner's
   * brief 2026-08-14, root-caused: `namespace`'s OWN git-remote reader never
   * follows a submodule's `.git` gitlink file to the real gitdir, so it
   * silently falls through to a slugified CLAUDE.md description for every
   * submodule root). Display-only, for the tree caption — deliberately NOT
   * fed back into `namespace` itself, which stays untouched to protect
   * existing `namespace.NNNN` deep links from changing identity underneath
   * anyone who's already saved one. undefined when there's no discoverable
   * origin remote (e.g. a local-only repo with no `.git` at all).
   */
  gitRemoteSlug?: GitOwnerRepo
}

export interface GitOwnerRepo {
  owner: string
  repo: string
}

const DEFAULT_SKIP_DIRS = new Set([
  'node_modules', 'dist', 'out', 'coverage', '.git', '.vscode-test', '.nyc_output',
])
const DEFAULT_MAX_SCAN_DEPTH = 12

// ADR-0025 Decision 1, mechanism 1: per-subroot marker file. Canonical name
// is `.adrignore` (matches this project's own dotfile-config naming, e.g.
// `.gitignore`); `.adr-root-ignore` is accepted too, for readers who find
// the longer name self-documenting out of context.
const IGNORE_MARKER_FILES = ['.adrignore', '.adr-root-ignore']

// ---------------------------------------------------------------------------
// Namespace computation: git-remote-slug || CLAUDE.md/AGENTS.md project name || dirname
// ---------------------------------------------------------------------------

export function computeNamespace(rootPath: string): string {
  return namespaceFromGitRemote(rootPath) ?? namespaceFromProjectDoc(rootPath) ?? slugify(path.basename(rootPath))
}

function namespaceFromGitRemote(rootPath: string): string | undefined {
  const configPath = path.join(rootPath, '.git', 'config')
  if (!fs.existsSync(configPath)) return undefined
  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    const match = content.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/)
    if (!match) return undefined
    return slugFromGitUrl(match[1])
  } catch {
    return undefined
  }
}

function slugFromGitUrl(url: string): string | undefined {
  // Handles both "git@host:owner/repo.git" and "https://host/owner/repo.git" shapes.
  const cleaned = url.trim().replace(/\.git$/, '')
  const match = cleaned.match(/[:/]([^/]+\/[^/]+)$/)
  if (!match) return undefined
  return slugify(match[1])
}

function namespaceFromProjectDoc(rootPath: string): string | undefined {
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const docPath = path.join(rootPath, name)
    if (!fs.existsSync(docPath)) continue
    try {
      const content = fs.readFileSync(docPath, 'utf-8')
      const match = content.match(/\*\*Project\*\*:\s*(.+)/)
      if (match) return slugify(match[1])
    } catch {
      // fall through to the next candidate file
    }
  }
  return undefined
}

function slugify(raw: string): string {
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'project'
}

// ---------------------------------------------------------------------------
// Git remote owner/repo (display-only — see DiscoveredRoot.gitRemoteSlug)
// ---------------------------------------------------------------------------

/**
 * `path/.git` is a directory for an ordinary repo, but a one-line gitlink
 * FILE for a submodule ("gitdir: ../../.git/modules/<name>") — this is the
 * exact case `namespaceFromGitRemote` above never follows, since it only
 * ever tries `path.join(rootPath, '.git', 'config')` directly. Resolving
 * the gitlink to the real gitdir first is the standard, reliable way to
 * reach a submodule's own `config` (same shape as a regular gitdir).
 */
function resolveGitDir(rootPath: string): string | undefined {
  const gitPath = path.join(rootPath, '.git')
  let stat: fs.Stats
  try {
    stat = fs.statSync(gitPath)
  } catch {
    return undefined
  }
  if (stat.isDirectory()) return gitPath
  if (!stat.isFile()) return undefined
  try {
    const content = fs.readFileSync(gitPath, 'utf-8')
    const match = content.match(/^gitdir:\s*(.+)$/m)
    if (!match) return undefined
    const gitdir = match[1].trim()
    return path.isAbsolute(gitdir) ? gitdir : path.resolve(rootPath, gitdir)
  } catch {
    return undefined
  }
}

export function gitRemoteSlugFor(rootPath: string): GitOwnerRepo | undefined {
  const gitDir = resolveGitDir(rootPath)
  if (!gitDir) return undefined
  const configPath = path.join(gitDir, 'config')
  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    const match = content.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/)
    if (!match) return undefined
    return ownerRepoFromGitUrl(match[1])
  } catch {
    return undefined
  }
}

function ownerRepoFromGitUrl(url: string): GitOwnerRepo | undefined {
  // Same two URL shapes as slugFromGitUrl above ("git@host:owner/repo.git",
  // "https://host/owner/repo.git"), split into owner/repo separately rather
  // than joined into one slug — the caption feature needs them independent
  // to implement "repo alone unless disambiguation is needed."
  const cleaned = url.trim().replace(/\.git$/, '')
  const match = cleaned.match(/[:/]([^/]+)\/([^/]+)$/)
  if (!match) return undefined
  return { owner: match[1], repo: match[2] }
}

// ---------------------------------------------------------------------------
// .settings/roots.json — workspace-scoped allow/block glob config
// ---------------------------------------------------------------------------

interface RootsConfig {
  allow?: string[]
  block?: string[]
}

function readRootsConfig(workspaceRoot: string, adrDirRel: string): RootsConfig | undefined {
  const configPath = path.join(workspaceRoot, adrDirRel, '.settings', 'roots.json')
  if (!fs.existsSync(configPath)) return undefined
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    return { allow: parsed.allow, block: parsed.block }
  } catch {
    return undefined
  }
}

/**
 * Minimal glob: `**` matches across path separators, `*` matches within a
 * single segment. Tokenizes rather than round-tripping through a
 * placeholder character substitution, which is fragile -- a placeholder
 * that happens to collide with real pattern content silently corrupts the
 * match instead of failing loudly.
 */
function globToRegExp(pattern: string): RegExp {
  const escapeLiteral = (segment: string): string => segment.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const body = pattern
    .split(/(\*\*|\*)/)
    .map(token => (token === '**' ? '.*' : token === '*' ? '[^/]*' : escapeLiteral(token)))
    .join('')
  return new RegExp(`^${body}$`)
}

function matchesAny(relPath: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false
  return patterns.some(pattern => globToRegExp(pattern).test(relPath))
}

function hasIgnoreMarker(dirPath: string): boolean {
  return IGNORE_MARKER_FILES.some(name => fs.existsSync(path.join(dirPath, name)))
}

// ---------------------------------------------------------------------------
// discoverRoots
// ---------------------------------------------------------------------------

/**
 * Scan `workspaceRoot` for ADR-bearing directories and assemble the
 * `DiscoveredRoot` tree. The workspace root is always the single top node
 * (composability requires exactly one `root: RootNode` per ADR-0025's
 * sketch) — if the workspace root itself has no ADR directory (a "forest"
 * workspace containing several independent projects but no top-level ADRs
 * of its own), the top node is synthetic: `hasAdrDir: false`, contributing
 * nothing itself, with the real content living entirely in its children.
 * This is an interpretation choice not spelled out in ADR-0025's text —
 * flagged in the accompanying brief for review rather than assumed silently
 * correct.
 */
export function discoverRoots(workspaceRoot: string, options: RootDiscoveryOptions): DiscoveredRoot {
  const skipDirs = new Set([...DEFAULT_SKIP_DIRS, ...(options.skipDirNames ?? [])])
  const maxDepth = options.maxScanDepth ?? DEFAULT_MAX_SCAN_DEPTH
  const rootsConfig = readRootsConfig(workspaceRoot, options.adrDirRel)

  function isExcludedByConfig(candidatePath: string): boolean {
    if (!rootsConfig) return false
    const rel = path.relative(workspaceRoot, candidatePath)
    if (rootsConfig.allow && rootsConfig.allow.length > 0) {
      return !matchesAny(rel, rootsConfig.allow)
    }
    return matchesAny(rel, rootsConfig.block)
  }

  function isSubmodule(dirPath: string): boolean {
    const gitPath = path.join(dirPath, '.git')
    try {
      return fs.statSync(gitPath).isFile()
    } catch {
      return false
    }
  }

  // Dirent.isDirectory() reports the entry's own type without following
  // symlinks, so a symlinked directory is skipped by the `!isDirectory()`
  // check below — deliberate, and the reason a symlink cycle can't spin
  // this scan forever even with maxScanDepth as a second-line guard.
  function scan(dirPath: string, depth: number): DiscoveredRoot[] {
    if (depth > maxDepth) return []
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true })
    } catch {
      return []
    }

    const found: DiscoveredRoot[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      if (skipDirs.has(entry.name)) continue

      const childPath = path.join(dirPath, entry.name)
      if (hasIgnoreMarker(childPath)) continue
      if (isExcludedByConfig(childPath)) continue

      const adrDirPath = path.join(childPath, options.adrDirRel)
      let hasAdrDir = false
      try {
        hasAdrDir = fs.statSync(adrDirPath).isDirectory()
      } catch {
        hasAdrDir = false
      }

      if (hasAdrDir) {
        found.push({
          path: childPath,
          adrDirPath,
          hasAdrDir: true,
          namespace: computeNamespace(childPath),
          children: scan(childPath, depth + 1),
          isSubmodule: isSubmodule(childPath),
          gitRemoteSlug: gitRemoteSlugFor(childPath),
        })
      } else {
        // Transparent directory: not a root itself, but nested roots may
        // still live below it (e.g. a bare `subprojects/` container).
        found.push(...scan(childPath, depth + 1))
      }
    }
    return found
  }

  const workspaceAdrDir = path.join(workspaceRoot, options.adrDirRel)
  let workspaceHasAdrDir = false
  try {
    workspaceHasAdrDir = fs.statSync(workspaceAdrDir).isDirectory()
  } catch {
    workspaceHasAdrDir = false
  }

  return {
    path: workspaceRoot,
    adrDirPath: workspaceAdrDir,
    hasAdrDir: workspaceHasAdrDir,
    namespace: computeNamespace(workspaceRoot),
    children: scan(workspaceRoot, 1),
    isSubmodule: false,
    gitRemoteSlug: gitRemoteSlugFor(workspaceRoot),
  }
}
