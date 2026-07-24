/**
 * roots.json writer tests — "Exclude this root" (Jérémie's design, dispatched
 * by Lapidary 2026-07-24 `0710`): a right-click on a root writes an EXACT
 * relative path into roots.json's `block` list, never a glob — the
 * dead-pattern class named 2026-07-22 (`c2165cf`, this repo's own
 * roots.json: "fixture-workspace" was blocked by exact path specifically
 * because "fixture-workspace/*" would have been a single-segment glob that
 * doesn't match the directory itself).
 */

import { describe, it, expect } from 'vitest'
import * as path from 'path'
import {
  parseRootsConfig, serializeRootsConfig, addBlockEntry, removeBlockEntry, relativeRootPath,
} from '../index/rootsConfigWriter'

describe('parseRootsConfig', () => {
  it('parses a real roots.json shape (this repo\'s own, verbatim)', () => {
    const text = '{\n  "block": ["docs/research/*", "fixture-workspace", "fixture-workspace/**"]\n}\n'
    expect(parseRootsConfig(text)).toEqual({ block: ['docs/research/*', 'fixture-workspace', 'fixture-workspace/**'] })
  })

  it('missing file (undefined) starts fresh', () => {
    expect(parseRootsConfig(undefined)).toEqual({})
  })

  it('malformed JSON starts fresh rather than throwing', () => {
    expect(parseRootsConfig('{ not json')).toEqual({})
  })

  it('a JSON array (structurally wrong shape) starts fresh rather than being trusted as a config object', () => {
    expect(parseRootsConfig('["a", "b"]')).toEqual({})
  })

  it('preserves an unrelated `names` field untouched (not this module\'s to write, but not to clobber either)', () => {
    const text = '{"block": ["a"], "names": {"a": "Alias"}}'
    expect(parseRootsConfig(text)).toEqual({ block: ['a'], names: { a: 'Alias' } })
  })
})

describe('relativeRootPath', () => {
  it('produces a forward-slash relative path with no leading ./', () => {
    const workspaceRoot = path.join('/Users', 'jlumbroso', 'repo')
    const rootPath = path.join(workspaceRoot, 'subprojects', 'elenchus-app')
    expect(relativeRootPath(rootPath, workspaceRoot)).toBe('subprojects/elenchus-app')
  })
})

describe('addBlockEntry', () => {
  it('appends an exact path to an empty/missing config', () => {
    const result = addBlockEntry(undefined, 'subprojects/foo')
    expect(result.changed).toBe(true)
    expect(result.config).toEqual({ block: ['subprojects/foo'] })
    expect(result.text).toBe(serializeRootsConfig({ block: ['subprojects/foo'] }))
  })

  it('appends to an existing block list without disturbing existing entries', () => {
    const existing = serializeRootsConfig({ block: ['docs/research/*'] })
    const result = addBlockEntry(existing, 'subprojects/foo')
    expect(result.config.block).toEqual(['docs/research/*', 'subprojects/foo'])
  })

  it('is idempotent — re-excluding an already-blocked path is a no-op, not a duplicate', () => {
    const existing = serializeRootsConfig({ block: ['subprojects/foo'] })
    const result = addBlockEntry(existing, 'subprojects/foo')
    expect(result.changed).toBe(false)
    expect(result.config.block).toEqual(['subprojects/foo'])
  })

  it('preserves an `allow` list already present', () => {
    const existing = serializeRootsConfig({ allow: ['subprojects/*'], block: [] })
    const result = addBlockEntry(existing, 'subprojects/foo')
    expect(result.config.allow).toEqual(['subprojects/*'])
  })
})

describe('removeBlockEntry (the Undo path)', () => {
  it('removes the exact path that was just added', () => {
    const existing = serializeRootsConfig({ block: ['docs/research/*', 'subprojects/foo'] })
    const result = removeBlockEntry(existing, 'subprojects/foo')
    expect(result.changed).toBe(true)
    expect(result.config.block).toEqual(['docs/research/*'])
  })

  it('drops the `block` key entirely once it empties out, rather than leaving "block": []', () => {
    const existing = serializeRootsConfig({ block: ['subprojects/foo'] })
    const result = removeBlockEntry(existing, 'subprojects/foo')
    expect(result.config.block).toBeUndefined()
    expect(result.text).not.toContain('"block"')
  })

  it('is a no-op (changed: false) when the path was never blocked', () => {
    const existing = serializeRootsConfig({ block: ['docs/research/*'] })
    const result = removeBlockEntry(existing, 'subprojects/foo')
    expect(result.changed).toBe(false)
    expect(result.config.block).toEqual(['docs/research/*'])
  })

  it('round-trips: add then remove restores the pre-exclude state exactly (Undo must be exact, not approximate)', () => {
    const original = serializeRootsConfig({ block: ['docs/research/*', 'fixture-workspace'] })
    const added = addBlockEntry(original, 'subprojects/foo')
    const removed = removeBlockEntry(added.text, 'subprojects/foo')
    expect(removed.config).toEqual(parseRootsConfig(original))
  })
})
