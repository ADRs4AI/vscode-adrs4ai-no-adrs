/**
 * ADR-0004 ("ADR Commit" UI feature, answered 2026-07-05): Jérémie's exact
 * spec for the pre-filled commit message — "docs: human feedback on ADRs"
 * followed by the affected ADR numbers, comma-separated.
 *
 * Extended per Lapidary's 2026-07-29 feedback-seed dispatch (A1/A2, source:
 * docs/adr/seed-2026-07-29-random-feedback-from-experience.md): seeds now
 * get their own vocabulary — Jérémie's own words, dictated in the seed —
 * instead of silently falling back to the generic ADR message or being
 * ignored entirely. A mixed changeset (ADRs + seeds together) composes both
 * halves rather than picking one.
 *
 * `composeCommitMessage` is the pure core (no fs) — directly unit-testable.
 * `buildAdrCommitMessage` is the thin fs-reading wrapper the real call site
 * uses (still no vscode import, so it stays usable outside the extension
 * host — same purity boundary as before, just Node fs instead of zero I/O).
 */

import * as fs from 'fs'
import { extractAdrNumber } from '../parser/extractor'
import { parseSeed } from '../parser/seedExtractor'
import { isSeedBasename } from '../index/fileGuards'

export interface ChangedFile {
  path: string
  /**
   * True when git reports this path as newly added/untracked — distinguishes
   * "new seed: <topic>" from an edit to an already-existing one. Undefined/
   * false is the safe default (never claims "new" without git confirming it).
   */
  isNew?: boolean
}

/** A seed's commit-message-relevant facts, already extracted from its parsed content. */
export interface SeedCommitInfo {
  topic: string
  isNew: boolean
  /** Count of ## Thread entries already on file BEFORE this edit is described — 0 means this edit is the seed's first engagement beyond the Brain Dump. */
  threadEntryCount: number
}

function seedFragment(seed: SeedCommitInfo): string {
  if (seed.isNew) return `new seed: ${seed.topic}`
  if (seed.threadEntryCount === 0) return `human feedback on seed: ${seed.topic}`
  return `human iterated on seed: ${seed.topic}`
}

const pluralize = (n: number, singular: string, plural = singular + 's'): string =>
  n === 1 ? `one ${singular}` : `${n} ${plural}`

/** Pure composer — given already-extracted ADR numbers and seed info, builds the pre-filled commit message. Jérémie's vocabulary throughout (seed-2026-07-29). */
export function composeCommitMessage(adrNumbers: number[], seeds: SeedCommitInfo[]): string {
  const numbers = [...new Set(adrNumbers.filter(n => n > 0))].sort((a, b) => a - b)
  const adrList = numbers.map(n => String(n).padStart(4, '0')).join(', ')

  if (numbers.length === 0 && seeds.length === 0) return 'docs: update ADRs'

  if (numbers.length === 0) {
    // Seed-only changeset: use the topic-specific vocabulary for exactly
    // one seed (A1); more than one collapses to a pluralized count rather
    // than composing several topics into one line (A1 doesn't spec this —
    // multi-seed-only commits are rare, and per-category counts would need
    // their own bucketing to stay accurate).
    if (seeds.length === 1) return `docs: ${seedFragment(seeds[0])}`
    return `docs: human feedback on ${pluralize(seeds.length, 'seed')}`
  }

  if (seeds.length === 0) return `docs: human feedback on ADRs ${adrList}`

  // Mixed changeset (A2): keep the ADR phrasing intact, append a
  // pluralized seed-count fragment — Lapidary's own example, verbatim:
  // "human feedback on ADRs 0031, 0034 + one seed".
  return `docs: human feedback on ADRs ${adrList} + ${pluralize(seeds.length, 'seed')}`
}

/** Real call site's entry point — reads seed content from disk to extract topic/thread state, then delegates to the pure composer. */
export function buildAdrCommitMessage(changes: ChangedFile[]): string {
  const adrNumbers: number[] = []
  const seeds: SeedCommitInfo[] = []

  for (const change of changes) {
    const base = change.path.replace(/\\/g, '/').split('/').pop() ?? ''
    if (isSeedBasename(base)) {
      let content: string
      try {
        content = fs.readFileSync(change.path, 'utf-8')
      } catch {
        continue // deleted/unreadable — nothing to classify, skip rather than guess
      }
      const parsed = parseSeed(content, change.path)
      seeds.push({ topic: parsed.topic, isNew: !!change.isNew, threadEntryCount: parsed.threadEntries.length })
      continue
    }
    const n = extractAdrNumber(change.path)
    if (n > 0) adrNumbers.push(n)
  }

  return composeCommitMessage(adrNumbers, seeds)
}
