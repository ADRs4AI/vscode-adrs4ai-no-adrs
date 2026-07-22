/**
 * adrPath portability — Loftsman RFC (ios-client, 2026-07-22 `1951`), ruled
 * by Lapidary (`2140`): `drafts.json` is a COMMITTED artifact, so a
 * machine-local absolute filesystem path inside it was always a latent
 * cross-machine bug — ios-client (no local git checkout, ever) just found it
 * first. Canonical form is repo-relative, POSIX-separated (portable to a
 * non-Node reader, e.g. ios-client's Swift store, and to a second laptop).
 *
 * Migration mechanics (the ruling's own words): read tolerant, write
 * canonical, heal opportunistically. This module is the "read tolerant"
 * half — pure and vscode-free. DraftStore.ts owns "write canonical" +
 * "heal opportunistically" by calling toRepoRelative() at every persist.
 */

import * as fs from 'fs'
import * as path from 'path'

const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/

/** True for a machine-local absolute path (POSIX `/...` or a Windows drive letter) — the legacy form. */
export function isAbsoluteStoredPath(p: string): boolean {
  return p.startsWith('/') || WINDOWS_DRIVE_RE.test(p)
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

/**
 * Canonical write form: repo-relative, POSIX-separated. An already-relative
 * input passes through (just posix-ized) — idempotent, so re-saving an
 * already-canonical entry is a no-op in substance.
 */
export function toRepoRelative(storedOrAbsolutePath: string, workspaceRoot: string): string {
  if (!isAbsoluteStoredPath(storedOrAbsolutePath)) return toPosix(storedOrAbsolutePath)
  return toPosix(path.relative(workspaceRoot, storedOrAbsolutePath))
}

export type ResolvedAdrPath =
  | { kind: 'resolved'; absolutePath: string }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'not-found' }

/**
 * Tolerant read: resolves a stored `adrPath` (either form) to a real
 * absolute path on THIS machine.
 *
 * - Canonical (repo-relative) input resolves directly against
 *   `workspaceRoot` — unambiguous by construction, no existence check
 *   needed (mirrors how every other repo-relative path in this codebase is
 *   trusted once joined to a known root).
 * - Legacy absolute input (written on a possibly different machine/checkout
 *   location) is suffix-normalized: everything from its last `adrDirRel`
 *   segment onward is re-resolved against every known root. Matching
 *   exactly one root's real file on disk is unambiguous; matching more than
 *   one is a structured `ambiguous` result (never a silent pick, per the
 *   ruling); matching none is `not-found`.
 */
export function resolveStoredAdrPath(
  stored: string,
  workspaceRoot: string,
  knownRootPaths: string[],
  adrDirRel: string,
  exists: (p: string) => boolean = fs.existsSync,
): ResolvedAdrPath {
  if (!isAbsoluteStoredPath(stored)) {
    return { kind: 'resolved', absolutePath: path.join(workspaceRoot, stored) }
  }

  const marker = path.sep + adrDirRel.split('/').join(path.sep) + path.sep
  const markerIdx = stored.lastIndexOf(marker)
  if (markerIdx === -1) return { kind: 'not-found' }
  const suffix = stored.slice(markerIdx + 1) // drop only the leading separator

  const candidates = Array.from(
    new Set(knownRootPaths.map(root => path.join(root, suffix)).filter(candidate => exists(candidate))),
  )

  if (candidates.length === 1) return { kind: 'resolved', absolutePath: candidates[0] }
  if (candidates.length > 1) return { kind: 'ambiguous', candidates }
  return { kind: 'not-found' }
}
