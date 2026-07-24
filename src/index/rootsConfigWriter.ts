/**
 * roots.json writer — ADR-0025 Decision 1 mechanism 2, "Exclude this root"
 * context-menu action (Jérémie's design, dispatched by Lapidary 2026-07-24
 * `0710`): "I like that you can right-click a root and rename it or exclude
 * it and it changes the .settings file — that's how things are
 * discoverable, by making the edit an option, like we did with .working."
 *
 * Pure and vscode-free so the JSON-patch logic is directly testable — the
 * command handler (extension.ts) owns the vscode-facing consent-surface
 * preview and the actual file write.
 *
 * Exclude writes an EXACT relative path, never a glob — the dead-pattern
 * class Lapidary named from 2026-07-22 (`c2165cf`): `*` is single-segment
 * in this format's globs, so a careless pattern can silently match nothing,
 * or something else entirely. An exact path has no such failure mode.
 *
 * Rename ("names: {<relPath>: alias}") is explicitly NOT implemented here —
 * the brief itself calls out that schema addition as needing Riddle/
 * Touchstone's council blessing first (roots.json is a shared, format-we-
 * control file). `RootsConfig.names` is typed so this module's read/spread
 * never clobbers a `names` map a human (or a future blessed writer) has
 * already added, but nothing here creates or edits one.
 */

import * as path from 'path'

export interface RootsConfig {
  allow?: string[]
  block?: string[]
  /** Not yet a blessed schema addition — see this file's header. Preserved untouched if present, never written by this module. */
  names?: Record<string, string>
}

/** Tolerant parse: missing, empty, malformed, or non-object JSON all start fresh rather than throwing. */
export function parseRootsConfig(text: string | undefined): RootsConfig {
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as RootsConfig
  } catch {
    // fall through to fresh config
  }
  return {}
}

export function serializeRootsConfig(config: RootsConfig): string {
  return JSON.stringify(config, null, 2) + '\n'
}

export interface RootsConfigEditResult {
  config: RootsConfig
  text: string
  /** False when the requested change was already true on disk — a safe no-op, not an error. */
  changed: boolean
}

/** Repo-relative, POSIX-separated path for a root — matches this project's own hand-authored roots.json style (no leading `./`, forward slashes even on Windows). */
export function relativeRootPath(rootAbsolutePath: string, workspaceRoot: string): string {
  return path.relative(workspaceRoot, rootAbsolutePath).split(path.sep).join('/')
}

/** Idempotent: a path already present in `block` is a no-op (changed: false), never duplicated. */
export function addBlockEntry(existingText: string | undefined, relPath: string): RootsConfigEditResult {
  const config = parseRootsConfig(existingText)
  const block = config.block ?? []
  if (block.includes(relPath)) return { config, text: serializeRootsConfig(config), changed: false }
  const next: RootsConfig = { ...config, block: [...block, relPath] }
  return { config: next, text: serializeRootsConfig(next), changed: true }
}

/** Undo path for addBlockEntry. Removes exactly one occurrence; drops the `block` key entirely once empty rather than leaving `"block": []` behind. Absent entry is a no-op (changed: false). */
export function removeBlockEntry(existingText: string | undefined, relPath: string): RootsConfigEditResult {
  const config = parseRootsConfig(existingText)
  const block = config.block ?? []
  if (!block.includes(relPath)) return { config, text: serializeRootsConfig(config), changed: false }
  const filtered = block.filter(entry => entry !== relPath)
  const next: RootsConfig = { ...config }
  if (filtered.length > 0) next.block = filtered
  else delete next.block
  return { config: next, text: serializeRootsConfig(next), changed: true }
}
