/**
 * File-identity guards shared by the disk watchers and the buffer-change
 * trigger — pure, vscode-free, unit-testable.
 *
 * Phantom-ADR incident (2026-07-14, reported live by Jérémie, system3):
 * "ADR-2026: 2026-07-14-...-gpt-5.6-sol [Draft]" appeared in the tree with
 * no corresponding file under docs/adr. Root cause: the buffer-change
 * trigger (extension.ts setupBufferChangeTrigger) guarded only on the
 * BASENAME shape (digit-prefix .md), because that predicate was borrowed
 * from the disk watchers — where it was sufficient purely thanks to the
 * watcher glob (`docs/adr/*.md`) already scoping the directory. Reused
 * without the glob, it matched any date-prefixed markdown file merely
 * OPENED in the editor (here: a research report in docs/reports/) and
 * injected it into the ADR index as a phantom. The containment check the
 * glob used to provide now lives here, explicitly, next to the basename
 * checks it was never safe to separate from.
 */

import * as path from 'path'

/** ADR filename shape: one-or-more digits, - or _, title, .md — not a seed. */
export function isAdrBasename(basename: string): boolean {
  return /^\d+[-_].+\.md$/.test(basename) && !basename.startsWith('seed-')
}

/** Seed filename shape: seed-*.md. */
export function isSeedBasename(basename: string): boolean {
  return basename.startsWith('seed-') && basename.endsWith('.md')
}

/**
 * True when `filePath` is a DIRECT child of `dirPath` — the same scope the
 * disk watchers' non-recursive `<adrDir>/*.md` glob enforces. Both paths
 * are compared resolved, so `.`/`..` segments and trailing separators
 * can't defeat the check.
 */
export function isDirectChildOf(filePath: string, dirPath: string): boolean {
  return path.dirname(path.resolve(filePath)) === path.resolve(dirPath)
}
